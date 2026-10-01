#!/usr/bin/env node
// Writes the directory as rows for the database load:
//   node scripts/dump-directory.js /tmp/directory.json
import { writeFileSync } from 'node:fs';

import { loadEnvConfig } from '../src/config.js';
import { toSnapshotRow } from '../src/export/directory-snapshot.js';
import { createKintoneClient } from '../src/kintone/client.js';

try {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/dump-directory.js <output.json>');
  const env = loadEnvConfig();
  const records = await createKintoneClient(env).getAllRecords({ app: env.appId });
  const rows = records.map(toSnapshotRow);
  writeFileSync(process.argv[2], JSON.stringify(rows));
  console.log(`dumped ${rows.length} directory rows`);
} catch (error) {
  console.error(`Directory dump failed: ${error.message}`);
  process.exitCode = 1;
}
