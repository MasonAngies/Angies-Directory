import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDirectoryConfig } from '../src/config.js';
import {
  findCrossRecordIssues,
  fromKintoneRecord,
  isEffectiveOn,
  isValidDate,
  isValidEmail,
  todayIn,
  validateRecord,
} from '../src/directory/rules.js';
import { kintoneRecord, plainRecord, TODAY } from './fixtures/records.js';

const config = loadDirectoryConfig();
const check = (overrides) => validateRecord(plainRecord(overrides), { config, today: TODAY });
const codes = (issues) => issues.map((issue) => `${issue.code}:${issue.field}`);

test('a complete, verified Active record has no issues', () => {
  assert.deepEqual(check({}), []);
});

test('store number must be present, digits only, and untrimmed input is not canonical', () => {
  assert.deepEqual(codes(check({ Store_Number: '' })), ['STORE_NUMBER_MISSING:Store_Number']);
  assert.equal(check({ Store_Number: '' })[0].severity, 'critical');
  for (const bad of [' 11101', '11101 ', 'A1101', '11-101', '1234567']) {
    assert.deepEqual(codes(check({ Store_Number: bad })), ['STORE_NUMBER_NOT_CANONICAL:Store_Number'], bad);
  }
  assert.deepEqual(check({ Store_Number: '0042' }), []);
});

test('Active stores need contact and district fields; other statuses do not', () => {
  const missing = { Store_Email: '', District: '', District_Manager_Email: '' };
  const issues = check(missing);
  assert.deepEqual(codes(issues), ['ACTIVE_FIELD_MISSING:District', 'ACTIVE_FIELD_MISSING:Store_Email', 'ACTIVE_FIELD_MISSING:District_Manager_Email']);
  assert.ok(issues.every((issue) => issue.blocksApproval));
  for (const status of ['Inactive', 'Opening', 'Closed']) assert.deepEqual(check({ ...missing, Active_Status: status }), [], status);
});

test('record owner, store name, and status are always required', () => {
  assert.deepEqual(codes(check({ Record_Owner: [], Store_Name: ' ', Active_Status: 'Closed' })), [
    'REQUIRED_FIELD_MISSING:Store_Name',
    'REQUIRED_FIELD_MISSING:Record_Owner',
  ]);
});

test('email syntax is validated conservatively and never repaired', () => {
  for (const bad of ['sam@', 'sam @example.com', 'sam@example', ' sam@example.com', 'sam..x@example.com', 'Sam Manager']) {
    assert.equal(isValidEmail(bad), false, bad);
  }
  for (const good of ['sam@example.com', 'Sam.O+ops@Example.co.uk']) assert.equal(isValidEmail(good), true, good);
  assert.deepEqual(codes(check({ Store_Manager_Email: 'sam@example' })), ['INVALID_EMAIL:Store_Manager_Email']);
});

test('concept values must be approved; district text must be canonically spaced', () => {
  assert.deepEqual(codes(check({ Concept: ['Lobster', 'Tacos'] })), ['INVALID_OPTION:Concept']);
  assert.deepEqual(codes(check({ Active_Status: 'Paused' })), ['INVALID_OPTION:Active_Status']);
  for (const bad of ['Central ', ' Central', 'North  Shore']) {
    assert.deepEqual(codes(check({ District: bad })), ['DISTRICT_NOT_CANONICAL:District'], bad);
  }
  assert.deepEqual(check({ District: 'North Shore', Concept: [] }), []);
});

test('phones and states are optional but must be well formed', () => {
  assert.deepEqual(check({ Store_Manager_Phone: '480-555-0123', Director_Phone: '', State: 'AZ' }), []);
  assert.deepEqual(codes(check({ Store_Manager_Phone: '(480) 555-0123', District_Manager_Phone: '5550123', State: 'az' })), [
    'INVALID_PHONE:Store_Manager_Phone',
    'INVALID_PHONE:District_Manager_Phone',
    'INVALID_STATE:State',
  ]);
});

test('dates must be real and effective ranges ordered', () => {
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('2028-02-29'), true);
  assert.deepEqual(codes(check({ Effective_Start: '2026-02-30' })), ['INVALID_DATE:Effective_Start']);
  assert.deepEqual(codes(check({ Effective_Start: '2026-09-10', Effective_End: '2026-09-01' })), ['EFFECTIVE_DATES_INVALID:Effective_End']);
});

test('missing verification blocks approval; stale verification is a non-blocking warning', () => {
  const missing = check({ Last_Verified: '', Verified_By: [] });
  assert.deepEqual(codes(missing), ['VERIFICATION_MISSING:Last_Verified', 'VERIFICATION_MISSING:Verified_By']);
  assert.ok(missing.every((issue) => issue.severity === 'warning' && issue.blocksApproval));

  assert.deepEqual(check({ Last_Verified: '2026-06-17' }), [], 'exactly 90 days is still current');
  const stale = check({ Last_Verified: '2026-06-16' });
  assert.deepEqual(codes(stale), ['VERIFICATION_STALE:Last_Verified']);
  assert.equal(stale[0].blocksApproval, false);
  assert.deepEqual(codes(check({ Last_Verified: '2026-09-20' })), ['VERIFICATION_DATE_IN_FUTURE:Last_Verified']);
});

test('effective dates are inclusive and optional', () => {
  assert.equal(isEffectiveOn(plainRecord(), TODAY), true);
  assert.equal(isEffectiveOn(plainRecord({ Effective_Start: TODAY, Effective_End: TODAY }), TODAY), true);
  assert.equal(isEffectiveOn(plainRecord({ Effective_Start: '2026-09-16' }), TODAY), false);
  assert.equal(isEffectiveOn(plainRecord({ Effective_End: '2026-09-14' }), TODAY), false);
});

test('cross-record checks find duplicates and inconsistent spellings', () => {
  const records = [
    plainRecord({ Toast_Location_ID: 'T-1', Store_Email: 'Shared@example.com', District: 'Central' }),
    plainRecord({ Store_Number: '11102', Toast_Location_ID: 'T-1', Store_Email: 'shared@example.com', District: 'central' }),
    plainRecord({ Store_Number: '11101', Store_Email: 'store3@example.com', Store_Manager_Name: 'Samuel Manager' }),
    plainRecord({ Store_Number: '11104', Store_Email: 'store4@example.com', SevenShifts_Location_ID: '' }),
  ];
  const issues = findCrossRecordIssues(records);
  const summary = Object.fromEntries(issues.map((issue) => [issue.code, issue.recordIndexes]));
  assert.deepEqual(summary.DUPLICATE_STORE_NUMBER, [0, 2]);
  assert.deepEqual(summary.DUPLICATE_EXTERNAL_ID, [0, 1]);
  assert.deepEqual(summary.DUPLICATE_STORE_EMAIL, [0, 1]);
  assert.deepEqual(summary.DISTRICT_SPELLING_CONFLICT, [0, 2, 3, 1]);
  assert.deepEqual(summary.MANAGER_EMAIL_NAME_CONFLICT, [0, 1, 3, 2]);
  assert.equal(issues.find((issue) => issue.code === 'DUPLICATE_STORE_NUMBER').severity, 'critical');
  assert.equal(issues.filter((issue) => issue.code === 'DUPLICATE_EXTERNAL_ID').length, 1, 'blank external IDs are not duplicates');
});

test('one phone recorded for two different people is flagged; the same person across roles is not', () => {
  const issues = findCrossRecordIssues([
    plainRecord({ Store_Manager_Name: 'Pat One', Store_Manager_Phone: '480-555-0100', District_Manager_Name: 'Dana District', District_Manager_Phone: '480-555-0199' }),
    plainRecord({ Store_Number: '11102', Store_Manager_Name: 'Lee Two', Store_Manager_Phone: '480-555-0100' }),
    plainRecord({ Store_Number: '11103', Store_Manager_Name: 'Dana District', Store_Manager_Phone: '480-555-0199' }),
  ]).filter((issue) => issue.code === 'PHONE_NAME_CONFLICT');
  assert.deepEqual(issues.map((issue) => [issue.value, issue.recordIndexes]), [['480-555-0100', [0, 1]]]);
});

test('Kintone records convert to plain values', () => {
  const plain = fromKintoneRecord(kintoneRecord({ Concept: ['Prime', 'Pizza'] }, { id: '7', revision: '12' }));
  assert.deepEqual(plain.Record_Owner, ['owner']);
  assert.deepEqual(plain.Concept, ['Prime', 'Pizza']);
  assert.equal(plain.$id, '7');
  assert.equal(plain.$revision, '12');
  assert.equal(plain.Updated_by, 'editor');
});

test('today is computed in the configured time zone', () => {
  assert.equal(todayIn('America/New_York', new Date('2026-09-16T02:00:00Z')), '2026-09-15');
  assert.equal(todayIn('UTC', new Date('2026-09-16T02:00:00Z')), '2026-09-16');
});
