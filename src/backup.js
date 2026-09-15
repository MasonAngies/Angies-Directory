import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toCsv } from './csv.js';
import { FIELD_CODES, MULTI_VALUE_FIELDS, USER_FIELDS } from './directory/fields.js';

const SETTINGS_ENDPOINTS = {
  settings: 'app/settings',
  fields: 'app/form/fields',
  layout: 'app/form/layout',
  views: 'app/views',
  appAcl: 'app/acl',
  fieldAcl: 'field/acl',
  recordAcl: 'record/acl',
  processManagement: 'app/status',
};

// Backups hold directory contact data: backups/ is gitignored and must stay that way.
export function backupDir(label, root = fileURLToPath(new URL('../backups/', import.meta.url))) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(root, `${stamp}-${label}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const writeJson = (dir, name, body) => writeFileSync(join(dir, name), `${JSON.stringify(body, null, 2)}\n`);

export async function exportAppSettings(client, appId, dir) {
  writeJson(dir, 'app.json', await client.get('app', { id: appId }));
  for (const [name, path] of Object.entries(SETTINGS_ENDPOINTS)) {
    writeJson(dir, `${name}.json`, await client.get(path, { app: appId }));
  }
  return Object.keys(SETTINGS_ENDPOINTS).length + 1;
}

// Cell format matches Kintone CSV import: multi-value cells are newline-separated.
export function recordToCsvCells(record) {
  return FIELD_CODES.map((code) => {
    const value = record[code]?.value;
    if (USER_FIELDS.includes(code)) return (value ?? []).map((user) => user.code).join('\n');
    if (MULTI_VALUE_FIELDS.includes(code)) return (value ?? []).join('\n');
    return value ?? '';
  });
}

export async function exportRecords(client, appId, dir) {
  const records = await client.getAllRecords({ app: appId });
  writeJson(dir, 'records.json', records);
  writeFileSync(join(dir, 'records.csv'), toCsv([FIELD_CODES, ...records.map(recordToCsvCells)]));
  return records.length;
}
