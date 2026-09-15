#!/usr/bin/env node
// Exports app settings and all records to backups/<timestamp>-manual/.
import { parseArgs } from 'node:util';

import { backupDir, exportAppSettings, exportRecords } from '../src/backup.js';
import { loadEnvConfig } from '../src/config.js';
import { createKintoneClient } from '../src/kintone/client.js';

const { values } = parseArgs({ options: { 'settings-only': { type: 'boolean', default: false }, label: { type: 'string', default: 'manual' } } });

try {
  const env = loadEnvConfig();
  const client = createKintoneClient(env);
  const dir = backupDir(values.label.replace(/[^A-Za-z0-9_-]/g, '-'));
  const files = await exportAppSettings(client, env.appId, dir);
  console.log(`Saved ${files} settings files.`);
  if (!values['settings-only']) console.log(`Saved ${await exportRecords(client, env.appId, dir)} records (records.json, records.csv).`);
  console.log(`Backup folder: ${dir}`);
} catch (error) {
  console.error(`Backup failed: ${error.message}`);
  process.exitCode = 1;
}
