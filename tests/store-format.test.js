import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSyncAlert } from '../src/directory/external-ids.js';
import { formatForConcepts, FULL_FORMAT, LIMITED_FORMAT, planStoreFormatSync, STORE_FORMAT_FIELD } from '../src/directory/store-format.js';

const store = (overrides) => ({
  $id: '1',
  $revision: '2',
  Store_Number: '11101',
  Concept: ['Prime', 'Lobster', 'Burger', 'Chicken'],
  [STORE_FORMAT_FIELD]: '',
  ...overrides,
});

test('all four core concepts is the full platform; fewer is the limited menu', () => {
  assert.equal(formatForConcepts(['Prime', 'Lobster', 'Burger', 'Chicken']), FULL_FORMAT);
  assert.equal(formatForConcepts(['Prime', 'Lobster', 'Burger', 'Chicken', 'Pizza']), FULL_FORMAT, 'Pizza does not change it');
  assert.equal(formatForConcepts(['Prime', 'Lobster']), LIMITED_FORMAT);
  assert.equal(formatForConcepts(['Prime']), LIMITED_FORMAT);
  assert.equal(formatForConcepts([]), null, 'no concepts means no answer');
});

test('blank formats are filled and a value someone set is never changed', () => {
  const plan = planStoreFormatSync([
    store(),
    store({ $id: '2', Store_Number: '11102', Concept: ['Prime'] }),
    store({ $id: '3', Store_Number: '11103', [STORE_FORMAT_FIELD]: FULL_FORMAT }),
  ]);
  assert.deepEqual(plan.fills, [
    { recordId: '1', revision: '2', storeNumber: '11101', field: STORE_FORMAT_FIELD, value: FULL_FORMAT },
    { recordId: '2', revision: '2', storeNumber: '11102', field: STORE_FORMAT_FIELD, value: LIMITED_FORMAT },
  ]);
  assert.deepEqual([plan.conflicts, plan.withoutConcepts], [[], []]);
});

test('a format that disagrees with the concepts is reported, not corrected', () => {
  const plan = planStoreFormatSync([store({ Concept: ['Prime'], [STORE_FORMAT_FIELD]: FULL_FORMAT })]);
  assert.deepEqual(plan.fills, []);
  assert.deepEqual(plan.conflicts, [{ storeNumber: '11101', current: FULL_FORMAT, computed: LIMITED_FORMAT, concepts: ['Prime'] }]);
});

test('stores with no concepts are listed, not guessed at', () => {
  const plan = planStoreFormatSync([store({ Concept: [] }), store({ $id: '2', Store_Number: '15101', Concept: [], [STORE_FORMAT_FIELD]: FULL_FORMAT })]);
  assert.deepEqual([plan.fills, plan.conflicts], [[], []]);
  assert.deepEqual(plan.withoutConcepts, ['11101'], 'one already has a value, so it needs no attention');
});

test('format conflicts reach the alert, and filled formats read by their label', () => {
  const plan = planStoreFormatSync([store({ Concept: ['Prime', 'Lobster'], [STORE_FORMAT_FIELD]: FULL_FORMAT })]);
  const alert = buildSyncAlert(
    { conflicts: [], missingFromKintone: [], missingFromDb: [], formatConflicts: plan.conflicts },
    { applied: [{ storeNumber: '11102', field: STORE_FORMAT_FIELD, value: LIMITED_FORMAT }] },
  );
  assert.match(alert.subject, /1 item needs attention/);
  assert.match(alert.text, /Store 11101 — Format disagrees: Store Format is "Full Food Platform" but the concepts \(Prime, Lobster\) say "Healthy\/Limited Menu"/);
  assert.match(alert.text, /Filled in automatically: 11102: Store Format = Healthy\/Limited Menu/);
  assert.match(alert.html, /Format disagrees/);
});
