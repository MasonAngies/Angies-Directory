#!/usr/bin/env node
// Keeps the directory's derived data in step: fills blank Toast / 7shifts IDs
// from the shared stores table, fills blank Store Format from the store's
// concepts, and reports anything it will not decide on its own.
//   npm run sync                  dry run: show what would be filled
//   npm run sync -- --apply       write the fills into Kintone
//   npm run sync -- --source db-stores.json   use a dump instead of querying
//   npm run sync -- --apply --alert           also email ALERT_RECIPIENTS when
//                                             something needs a person
// Exit code: 1 when something needs a person, 2 when the sync could not run.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { loadEnvConfig } from '../src/config.js';
import { buildSyncAlert, fillsToUpdates, planExternalIdSync } from '../src/directory/external-ids.js';
import { fromKintoneRecord } from '../src/directory/rules.js';
import { planStoreFormatSync, STORE_FORMAT_FIELD } from '../src/directory/store-format.js';
import { createGraphClient } from '../src/graph/client.js';
import { createKintoneClient } from '../src/kintone/client.js';

const FIELDS = ['$id', '$revision', 'Store_Number', 'Store_Name', 'Active_Status', 'Toast_Location_ID', 'SevenShifts_Location_ID', 'Concept', STORE_FORMAT_FIELD];

// Store Format is not part of the exported field contract, so it is carried
// alongside the plain record rather than through fromKintoneRecord.
const toPlain = (record) => ({ ...fromKintoneRecord(record), [STORE_FORMAT_FIELD]: record[STORE_FORMAT_FIELD]?.value ?? '' });

function readDbStores(sourcePath) {
  if (sourcePath) return JSON.parse(readFileSync(sourcePath, 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'directory-sync-'));
  const out = join(dir, 'db-stores.json');
  try {
    const script = fileURLToPath(new URL('dump-db-stores.py', import.meta.url));
    const log = execFileSync(process.env.PYTHON_BIN ?? 'python3', [script, out], { encoding: 'utf8' });
    process.stdout.write(log);
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Emails the operator summary. A mail failure must not lose the findings, which
// are already in the log, so it is reported and the exit code stands.
async function sendAlert(alert, env = process.env) {
  const recipients = (env.ALERT_RECIPIENTS ?? '')
    .split(/[,;]/)
    .map((address) => address.trim())
    .filter(Boolean);
  const sender = env.GRAPH_SENDER_ADDRESS;
  if (!recipients.length || !sender) {
    console.log('Alert not sent: ALERT_RECIPIENTS and GRAPH_SENDER_ADDRESS must both be set.');
    return;
  }
  try {
    const graph = createGraphClient({
      tenantId: env.GRAPH_TENANT_ID,
      clientId: env.GRAPH_CLIENT_ID,
      clientSecret: env.GRAPH_CLIENT_SECRET,
    });
    await graph.sendMail({ sender, to: recipients, subject: alert.subject, text: alert.text, html: alert.html });
    console.log(`Alert emailed to ${recipients.join(', ')}`);
  } catch (error) {
    console.log(`Alert could not be emailed (${error.message}); the findings above still stand.`);
  }
}

async function main() {
  const { values } = parseArgs({
    options: { apply: { type: 'boolean', default: false }, source: { type: 'string' }, alert: { type: 'boolean', default: false } },
  });
  const env = loadEnvConfig();
  const client = createKintoneClient(env);
  const dbStores = readDbStores(values.source);

  let plan;
  let formats;
  let fills;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const records = (await client.getAllRecords({ app: env.appId, fields: FIELDS })).map(toPlain);
    plan = planExternalIdSync(records, dbStores);
    formats = planStoreFormatSync(records);
    fills = [...plan.fills, ...formats.fills];
    if (!values.apply || !fills.length) break;
    try {
      await client.put('records', { app: env.appId, records: fillsToUpdates(fills) });
      break;
    } catch (error) {
      if (error.code !== 'GAIA_CO02' || attempt === 2) throw error;
      console.log('A record changed while syncing; re-reading and retrying.');
    }
  }

  const verb = values.apply ? 'Filled' : 'Would fill';
  console.log(`${verb} ${fills.length} value(s)${values.apply ? '' : ' (dry run)'}`);
  for (const fill of plan.fills) console.log(`  ${fill.storeNumber}: ${fill.field} = ${fill.value}`);
  for (const fill of formats.fills) console.log(`  ${fill.storeNumber}: Store Format = ${fill.value}`);
  for (const conflict of formats.conflicts) {
    console.log(`  CONFLICT ${conflict.storeNumber}: Store Format is "${conflict.current}" but concepts (${conflict.concepts.join(', ')}) say "${conflict.computed}"; left alone`);
  }
  if (formats.withoutConcepts.length) {
    console.log(`  ${formats.withoutConcepts.length} store(s) have no concepts recorded, so Store Format was left blank: ${formats.withoutConcepts.join(', ')}`);
  }
  for (const conflict of plan.conflicts) {
    console.log(`  CONFLICT ${conflict.storeNumber}: ${conflict.field} is "${conflict.kintone}" in Kintone, "${conflict.db}" in the database (${conflict.reason}); left alone`);
  }
  for (const store of plan.missingFromKintone) console.log(`  NOT IN DIRECTORY: store ${store.storeNumber} (${store.storeName}) is active in the database`);
  for (const store of plan.missingFromDb) console.log(`  NOT IN DATABASE: store ${store.storeNumber} (${store.storeName}) is Active in the directory`);
  if (plan.dbWithoutStoreNumber) console.log(`  ${plan.dbWithoutStoreNumber} database row(s) have no store number yet (pre-opening); nothing to match`);

  const findings = { ...plan, formatConflicts: formats.conflicts };
  const needsAttention = plan.conflicts.length + plan.missingFromKintone.length + plan.missingFromDb.length + formats.conflicts.length;
  if (needsAttention) {
    console.log(`${needsAttention} item(s) need a person.`);
    const kintoneUrl = `${env.baseUrl.replace(/\/$/, '')}/k/${env.appId}/`;
    const alert = buildSyncAlert(findings, { applied: values.apply ? fills : [], kintoneUrl });
    if (values.alert && alert) await sendAlert(alert);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`External ID sync failed: ${error.message}`);
  process.exitCode = 2;
});
