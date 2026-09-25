import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSyncAlert, fillsToUpdates, planExternalIdSync } from '../src/directory/external-ids.js';

const record = (overrides) => ({
  $id: '1',
  $revision: '2',
  Store_Number: '11101',
  Store_Name: 'Baseline & Hardy',
  Active_Status: 'Active',
  Toast_Location_ID: '',
  SevenShifts_Location_ID: '',
  ...overrides,
});
const dbStore = (overrides) => ({
  store_number: '11101',
  store_name: 'Baseline & Hardy',
  status: 'active',
  toast_guid: 'guid-1',
  sevenshifts_location_id: 216941,
  ...overrides,
});

test('blank IDs are filled from the matching database row', () => {
  const plan = planExternalIdSync([record()], [dbStore()]);
  assert.deepEqual(plan.fills, [
    { recordId: '1', revision: '2', storeNumber: '11101', field: 'Toast_Location_ID', value: 'guid-1' },
    { recordId: '1', revision: '2', storeNumber: '11101', field: 'SevenShifts_Location_ID', value: '216941' },
  ]);
  assert.deepEqual([plan.conflicts, plan.missingFromDb, plan.missingFromKintone], [[], [], []]);
});

test('an ID that disagrees is reported, never overwritten', () => {
  const plan = planExternalIdSync([record({ Toast_Location_ID: 'other-guid', SevenShifts_Location_ID: '216941' })], [dbStore()]);
  assert.deepEqual(plan.fills, []);
  assert.deepEqual(plan.conflicts, [{ storeNumber: '11101', field: 'Toast_Location_ID', kintone: 'other-guid', db: 'guid-1', reason: 'differs' }]);
});

test('Toast GUIDs match case-insensitively; 7shifts IDs must match exactly', () => {
  const plan = planExternalIdSync([record({ Toast_Location_ID: 'GUID-1', SevenShifts_Location_ID: '216941' })], [dbStore()]);
  assert.deepEqual([plan.fills, plan.conflicts], [[], []]);
  const digits = planExternalIdSync([record({ SevenShifts_Location_ID: '0216941' })], [dbStore({ toast_guid: '' })]);
  assert.equal(digits.conflicts[0].field, 'SevenShifts_Location_ID');
});

test('stores missing on either side are reported, and excluded rows are ignored', () => {
  const plan = planExternalIdSync(
    [record({ Store_Number: '99999' }), record({ $id: '2', Store_Number: '11105', Active_Status: 'Closed' })],
    [dbStore(), dbStore({ store_number: '11106', store_name: 'Litchfield & Waddell' }), dbStore({ store_number: '15199', status: 'excluded' })],
  );
  assert.deepEqual(plan.missingFromDb, [{ storeNumber: '99999', storeName: 'Baseline & Hardy' }], 'closed stores are not chased');
  assert.deepEqual(plan.missingFromKintone.map((s) => s.storeNumber), ['11101', '11106']);
  assert.equal(plan.conflicts.length, 0, 'excluded database rows are not matched');
});

test('two database rows with one store number are flagged, not guessed', () => {
  const plan = planExternalIdSync([record()], [dbStore(), dbStore({ toast_guid: 'guid-2' })]);
  assert.deepEqual(plan.fills, []);
  assert.equal(plan.conflicts[0].reason, 'ambiguous');
});

test('rows without a store number are counted, and updates are grouped per record', () => {
  const plan = planExternalIdSync([record()], [dbStore(), dbStore({ store_number: null, store_name: 'Pre-opening' })]);
  assert.equal(plan.dbWithoutStoreNumber, 1);
  assert.deepEqual(fillsToUpdates(plan.fills), [
    { id: '1', revision: '2', record: { Toast_Location_ID: { value: 'guid-1' }, SevenShifts_Location_ID: { value: '216941' } } },
  ]);
});

test('a clean sync sends no alert', () => {
  const plan = planExternalIdSync([record()], [dbStore()]);
  assert.equal(buildSyncAlert(plan), null, 'filling blanks alone is not worth an email');
});

test('the alert names each item, the fills, and says the file still went out', () => {
  const plan = planExternalIdSync(
    [record({ Toast_Location_ID: 'other-guid' }), record({ $id: '2', Store_Number: '99999', Store_Name: 'Ghost' })],
    [dbStore(), dbStore({ store_number: '11106', store_name: 'Litchfield & Waddell' })],
  );
  const alert = buildSyncAlert(plan, { applied: plan.fills, kintoneUrl: 'https://example.kintone.com/k/897/' });
  assert.match(alert.subject, /^Store directory: 3 items need attention$/);
  assert.match(alert.text, /Store 11101 — IDs disagree: Toast Location ID — directory: other-guid; database: guid-1/);
  assert.match(alert.text, /Store 11106 — Not in the directory: Litchfield & Waddell is active in the database/);
  assert.match(alert.text, /Store 99999 — Not in the database: Ghost is Active in the directory/);
  assert.match(alert.text, /Filled in automatically: 11101: SevenShifts Location ID = 216941/);
  assert.match(alert.text, /published as usual/);
});

test('the HTML body is a table, with values escaped and a link into Kintone', () => {
  const plan = planExternalIdSync(
    [record({ Store_Name: 'Tom & Jerry <b>', Toast_Location_ID: 'other-guid', SevenShifts_Location_ID: '216941' })],
    [dbStore({ store_number: '11106', store_name: 'Litchfield & Waddell' })],
  );
  const { html } = buildSyncAlert(plan, { kintoneUrl: 'https://example.kintone.com/k/897/' });
  assert.match(html, /<th[^>]*>Store<\/th>/);
  assert.match(html, /<th[^>]*>What to do<\/th>/);
  assert.equal((html.match(/<tr>/g) ?? []).length, 2, 'one row per finding');
  assert.match(html, /Tom &amp; Jerry &lt;b&gt;/, 'store names are escaped, not injected');
  assert.ok(!html.includes('<b>'), 'raw markup from data never reaches the body');
  assert.match(html, /<a href="https:\/\/example\.kintone\.com\/k\/897\/"/);
});

test('one item reads as singular', () => {
  const plan = planExternalIdSync([record({ Toast_Location_ID: 'other-guid', SevenShifts_Location_ID: '216941' })], [dbStore()]);
  assert.match(buildSyncAlert(plan).subject, /1 item needs attention/);
});
