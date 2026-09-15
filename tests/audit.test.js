import assert from 'node:assert/strict';
import test from 'node:test';

import { exitCodeFor, runAudit } from '../src/audit/audit.js';
import { loadDirectoryConfig } from '../src/config.js';
import { kintoneRecord, TODAY } from './fixtures/records.js';

const config = loadDirectoryConfig();
const now = new Date('2026-09-15T15:00:00Z');

const records = [
  kintoneRecord({ Store_Number: '11101', Toast_Location_ID: 'T-1' }, { id: '1', revision: '2' }),
  kintoneRecord({ Store_Number: '11102', Store_Email: 'bad@', District: 'West', Toast_Location_ID: 'T-1' }, { id: '2', revision: '5' }),
  kintoneRecord({ Store_Number: '11103', Active_Status: 'Closed', Store_Email: '' }, { id: '3', revision: '1' }),
  kintoneRecord({ Store_Number: '11104', Last_Verified: '2026-01-01', Store_Email: 'store4@example.com' }, { id: '4', revision: '1' }),
  kintoneRecord({ Store_Number: '11105', Verified_By: [], Store_Email: 'store5@example.com' }, { id: '5', revision: '1' }),
];

test('audit summarizes counts and detects every issue class (AC-08)', () => {
  const report = runAudit(records, { config, today: TODAY, now });
  assert.equal(report.summary.totalRecords, 5);
  assert.equal(report.summary.activeRecords, 4);
  assert.deepEqual(report.summary.recordsByStatus, { Active: 4, Closed: 1 });
  assert.deepEqual(report.summary.activeByDistrict, { Central: 3, West: 1 });
  const found = report.issues.map((issue) => `${issue.storeNumber}:${issue.code}`);
  for (const expected of [
    '11101:DUPLICATE_EXTERNAL_ID',
    '11102:DUPLICATE_EXTERNAL_ID',
    '11102:INVALID_EMAIL',
    '11104:VERIFICATION_STALE',
    '11105:VERIFICATION_MISSING',
  ]) {
    assert.ok(found.includes(expected), expected);
  }
  assert.equal(report.issues[0].severity, 'critical', 'critical issues sort first');
  // 11101 and 11102 share a Toast ID, 11105 is unverified; 11104 is only stale.
  assert.deepEqual(report.approvedRecordIds, ['4']);
  assert.equal(exitCodeFor(report), 2);
  assert.equal(report.summary.changesSinceLastAudit, null);
});

test('audit reports records added, modified, and removed since the last run', () => {
  const previousState = {
    auditedAt: '2026-09-14T15:00:00Z',
    records: { 1: { revision: '2', storeNumber: '11101' }, 2: { revision: '4', storeNumber: '11102' }, 9: { revision: '1', storeNumber: '11109' } },
  };
  const report = runAudit(records.slice(0, 3), { config, today: TODAY, now, previousState });
  assert.deepEqual(
    report.changes.map((change) => `${change.change}:${change.storeNumber}`),
    ['modified:11102', 'added:11103', 'removed:11109'],
  );
  const modified = report.changes[0];
  assert.deepEqual([modified.previousRevision, modified.revision, modified.recordOwner, modified.verifiedBy], ['4', '5', 'owner', 'verifier']);
  assert.deepEqual(Object.keys(report.nextState.records), ['1', '2', '3']);
});

test('district spelling conflicts are errors but do not pull stores from approved exports', () => {
  const report = runAudit(
    [kintoneRecord({ District: 'Central' }, { id: '1' }), kintoneRecord({ Store_Number: '11102', Store_Email: 'b@example.com', District: 'central' }, { id: '2' })],
    { config, today: TODAY, now },
  );
  assert.deepEqual(report.issues.map((issue) => issue.code), ['DISTRICT_SPELLING_CONFLICT', 'DISTRICT_SPELLING_CONFLICT']);
  assert.deepEqual(report.approvedRecordIds, ['1', '2']);
  assert.equal(exitCodeFor(report), 1);
});

test('exit codes: errors only is 1, warnings only is 0', () => {
  const errorsOnly = runAudit([kintoneRecord({ Store_Email: 'bad@' })], { config, today: TODAY, now });
  assert.equal(exitCodeFor(errorsOnly), 1);
  const warningsOnly = runAudit([kintoneRecord({ Last_Verified: '2026-01-01' })], { config, today: TODAY, now });
  assert.equal(exitCodeFor(warningsOnly), 0);
});
