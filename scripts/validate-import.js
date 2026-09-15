#!/usr/bin/env node
// Validates a directory CSV before it is imported into Kintone.
//   npm run import:validate -- stores.csv              checks the file and compares with the live app
//   npm run import:validate -- stores.csv --offline    file-only checks
//   npm run import:validate -- stores.csv --reconcile  after import: list any field that differs from the live app
// Exit code: 2 critical, 1 errors, 0 otherwise.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { loadDirectoryConfig, loadEnvConfig, withLiveOptions } from '../src/config.js';
import { parseCsv, toCsv } from '../src/csv.js';
import { FIELD_CODES } from '../src/directory/fields.js';
import { rowsToRecords } from '../src/directory/import-csv.js';
import { findCrossRecordIssues, fromKintoneRecord, todayIn, validateRecord } from '../src/directory/rules.js';
import { createKintoneClient } from '../src/kintone/client.js';

const comparable = (value) => (Array.isArray(value) ? [...value].sort().join('\n') : String(value ?? ''));

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { offline: { type: 'boolean', default: false }, reconcile: { type: 'boolean', default: false } },
  });
  if (positionals.length !== 1) throw new Error('Usage: npm run import:validate -- <file.csv> [--offline | --reconcile]');
  if (values.offline && values.reconcile) throw new Error('--reconcile needs Kintone access; drop --offline.');

  let config = loadDirectoryConfig();
  const fileRecords = rowsToRecords(parseCsv(readFileSync(positionals[0], 'utf8')));
  const today = todayIn(config.timeZone);

  let liveRecords = [];
  if (!values.offline) {
    const env = loadEnvConfig();
    const client = createKintoneClient(env);
    config = await withLiveOptions(config, client, env.appId);
    liveRecords = (await client.getAllRecords({ app: env.appId })).map(fromKintoneRecord);
  }
  const liveByStore = new Map(liveRecords.map((record) => [record.Store_Number, record]));
  const fileStores = new Set(fileRecords.map((record) => record.Store_Number.trim()));

  const where = (record) => (record.$row ? `row ${record.$row}` : `live record ${record.$id}`);
  const issues = [];
  for (const record of fileRecords) {
    for (const issue of validateRecord(record, { config, today })) issues.push({ location: where(record), storeNumber: record.Store_Number, ...issue });
  }
  // Duplicates are checked across the file plus live records the file does not replace.
  const combined = [...fileRecords, ...liveRecords.filter((record) => !fileStores.has(record.Store_Number))];
  for (const { recordIndexes, ...issue } of findCrossRecordIssues(combined)) {
    const involved = recordIndexes.map((index) => combined[index]);
    if (!involved.some((record) => record.$row)) continue;
    for (const record of involved) issues.push({ location: where(record), storeNumber: record.Store_Number, ...issue });
  }

  const creates = fileRecords.filter((record) => !liveByStore.has(record.Store_Number)).length;
  console.log(
    `${fileRecords.length} rows: ${values.offline ? 'not compared with Kintone (--offline)' : `${creates} new stores, ${fileRecords.length - creates} updates to existing stores`}`,
  );

  let differences = 0;
  if (values.reconcile) {
    for (const record of fileRecords) {
      const live = liveByStore.get(record.Store_Number);
      if (!live) {
        console.log(`  row ${record.$row} store ${record.Store_Number}: not found in Kintone`);
        differences += 1;
        continue;
      }
      for (const code of FIELD_CODES) {
        if (comparable(record[code]) !== comparable(live[code])) {
          console.log(`  row ${record.$row} store ${record.Store_Number}: ${code} differs from Kintone`);
          differences += 1;
        }
      }
    }
    console.log(differences ? `Reconciliation: ${differences} difference(s).` : 'Reconciliation: every row matches Kintone exactly.');
  }

  const counts = issues.reduce((acc, issue) => ({ ...acc, [issue.severity]: (acc[issue.severity] ?? 0) + 1 }), {});
  console.log(`Issues: ${JSON.stringify(counts)}`);
  for (const issue of issues) console.log(`  [${issue.severity}] ${issue.location} store ${issue.storeNumber || '(blank)'}: ${issue.message}`);

  if (issues.length) {
    const outDir = fileURLToPath(new URL('../reports/', import.meta.url));
    mkdirSync(outDir, { recursive: true });
    const columns = ['severity', 'code', 'location', 'storeNumber', 'field', 'message'];
    const path = join(outDir, `import-validation-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    writeFileSync(path, toCsv([columns, ...issues.map((issue) => columns.map((c) => issue[c]))], { guardFormulas: true }));
    console.log(`Report: ${path}`);
  }

  if (issues.some((issue) => issue.severity === 'critical')) process.exitCode = 2;
  else if (differences || issues.some((issue) => issue.severity === 'error')) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Import validation failed: ${error.message}`);
  process.exitCode = 3;
});
