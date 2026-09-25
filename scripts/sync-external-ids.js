#!/usr/bin/env node
// Fills blank Toast / 7shifts IDs in the directory from the shared stores table,
// and reports anything it will not decide on its own.
//   npm run sync:ids                 dry run: show what would be filled
//   npm run sync:ids -- --apply      write the fills into Kintone
//   npm run sync:ids -- --source db-stores.json   use a dump instead of querying
//   npm run sync:ids -- --apply --alert           also email ALERT_RECIPIENTS when
//                                                 something needs a person
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
import { createGraphClient } from '../src/graph/client.js';
import { createKintoneClient } from '../src/kintone/client.js';

const FIELDS = ['$id', '$revision', 'Store_Number', 'Store_Name', 'Active_Status', 'Toast_Location_ID', 'SevenShifts_Location_ID'];

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
    await graph.sendMail({ sender, to: recipients, subject: alert.subject, text: alert.text });
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
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const records = (await client.getAllRecords({ app: env.appId, fields: FIELDS })).map(fromKintoneRecord);
    plan = planExternalIdSync(records, dbStores);
    if (!values.apply || !plan.fills.length) break;
    try {
      await client.put('records', { app: env.appId, records: fillsToUpdates(plan.fills) });
      break;
    } catch (error) {
      if (error.code !== 'GAIA_CO02' || attempt === 2) throw error;
      console.log('A record changed while syncing; re-reading and retrying.');
    }
  }

  const verb = values.apply ? 'Filled' : 'Would fill';
  console.log(`${verb} ${plan.fills.length} external ID(s)${values.apply ? '' : ' (dry run)'}`);
  for (const fill of plan.fills) console.log(`  ${fill.storeNumber}: ${fill.field} = ${fill.value}`);
  for (const conflict of plan.conflicts) {
    console.log(`  CONFLICT ${conflict.storeNumber}: ${conflict.field} is "${conflict.kintone}" in Kintone, "${conflict.db}" in the database (${conflict.reason}); left alone`);
  }
  for (const store of plan.missingFromKintone) console.log(`  NOT IN DIRECTORY: store ${store.storeNumber} (${store.storeName}) is active in the database`);
  for (const store of plan.missingFromDb) console.log(`  NOT IN DATABASE: store ${store.storeNumber} (${store.storeName}) is Active in the directory`);
  if (plan.dbWithoutStoreNumber) console.log(`  ${plan.dbWithoutStoreNumber} database row(s) have no store number yet (pre-opening); nothing to match`);

  const needsAttention = plan.conflicts.length + plan.missingFromKintone.length + plan.missingFromDb.length;
  if (needsAttention) {
    console.log(`${needsAttention} item(s) need a person.`);
    const alert = buildSyncAlert(plan, { applied: values.apply ? plan.fills : [] });
    if (values.alert && alert) await sendAlert(alert);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`External ID sync failed: ${error.message}`);
  process.exitCode = 2;
});
