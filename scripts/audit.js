#!/usr/bin/env node
// Operator-runnable directory health audit. Read-only against Kintone; writes
// reports to reports/ (gitignored). Exit code: 2 critical, 1 errors, 0 otherwise.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { exitCodeFor, runAudit } from '../src/audit/audit.js';
import { recordToCsvCells } from '../src/backup.js';
import { loadDirectoryConfig, loadEnvConfig, withLiveOptions } from '../src/config.js';
import { toCsv } from '../src/csv.js';
import { FIELD_CODES } from '../src/directory/fields.js';
import { todayIn } from '../src/directory/rules.js';
import { createKintoneClient } from '../src/kintone/client.js';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: fileURLToPath(new URL('../reports/', import.meta.url)) },
    'no-state-update': { type: 'boolean', default: false },
  },
});

try {
  const env = loadEnvConfig();
  const client = createKintoneClient(env);
  const config = await withLiveOptions(loadDirectoryConfig(), client, env.appId);
  const records = await client.getAllRecords({ app: env.appId });

  mkdirSync(values.out, { recursive: true });
  const statePath = join(values.out, 'audit-state.json');
  const previousState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  const today = todayIn(config.timeZone);
  const report = runAudit(records, { config, today, previousState });

  const stamp = report.summary.auditedAt.replace(/[:.]/g, '-');
  const reportPath = join(values.out, `audit-${stamp}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, (key, value) => (key === 'nextState' ? undefined : value), 2)}\n`);

  const issueColumns = ['severity', 'code', 'storeNumber', 'storeName', 'recordId', 'field', 'message'];
  const issuesPath = join(values.out, `audit-${stamp}-issues.csv`);
  writeFileSync(issuesPath, toCsv([issueColumns, ...report.issues.map((issue) => issueColumns.map((c) => issue[c]))], { guardFormulas: true }));

  // Active records with no blocking issues: the list that is safe to share.
  const completeIds = new Set(report.completeRecordIds);
  const completePath = join(values.out, `complete-directory-${stamp}.csv`);
  writeFileSync(completePath, toCsv([FIELD_CODES, ...records.filter((r) => completeIds.has(r.$id.value)).map(recordToCsvCells)], { guardFormulas: true }));

  if (!values['no-state-update']) writeFileSync(statePath, `${JSON.stringify(report.nextState, null, 2)}\n`);

  const { summary } = report;
  console.log(`Directory audit ${summary.auditedAt} (today ${summary.today})`);
  console.log(`Records: ${summary.totalRecords} total, ${summary.activeRecords} active, ${summary.activeComplete} active with complete data`);
  console.log(`By status: ${JSON.stringify(summary.recordsByStatus)}`);
  console.log(`Active by district: ${JSON.stringify(summary.activeByDistrict)}`);
  console.log(`Issues: ${JSON.stringify(summary.issuesBySeverity)}`);
  for (const issue of report.issues.filter((i) => i.severity !== 'warning').slice(0, 25)) {
    console.log(`  [${issue.severity}] ${issue.code} store ${issue.storeNumber || '(blank)'} (record ${issue.recordId}): ${issue.message}`);
  }
  console.log(`Changes since last audit: ${summary.changesSinceLastAudit ?? 'n/a (first audit)'}`);
  console.log(`Reports: ${reportPath}\n         ${issuesPath}\n         ${completePath}`);
  process.exitCode = exitCodeFor(report);
} catch (error) {
  console.error(`Audit failed: ${error.message}`);
  process.exitCode = 3;
}
