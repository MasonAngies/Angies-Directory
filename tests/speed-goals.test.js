import assert from 'node:assert/strict';
import test from 'node:test';

import { planSpeedGoalFill, speedFillsToFieldFills } from '../src/directory/speed-goals.js';

const FULL = 'Full Food Platform';
const LIMITED = 'Healthy/Limited Menu';
const STANDARD_DT = { Number_2: '120', Number_3: '70', Number_4: '85', Number: '420', Number_0: '420', Number_1: '420' };
const NO_GOALS = { Number_2: '', Number_3: '', Number_4: '', Number: '', Number_0: '', Number_1: '' };

let nextId = 1;
const store = (overrides) => ({
  $id: String(nextId++),
  $revision: '4',
  Store_Number: '11101',
  Active_Status: 'Active',
  Radio_button: FULL,
  Check_box_0: ['Drive-Thru'],
  Check_box: ['No'],
  ...STANDARD_DT,
  ...overrides,
});
const newStore = (overrides) => store({ Store_Number: '11199', Check_box: [], ...NO_GOALS, ...overrides });

test('a new store copies the goals of peers with the same format and order methods', () => {
  const plan = planSpeedGoalFill([store({ Store_Number: '11103' }), store({ Store_Number: '11301' }), newStore()]);
  assert.equal(plan.fills.length, 1);
  assert.deepEqual(plan.fills[0].values, { ...STANDARD_DT, Check_box: ['No'] });
  assert.deepEqual(plan.fills[0].copiedFrom, ['11103', '11301']);
  assert.deepEqual(plan.unmatched, []);
});

test('stores with an exception, another format, or other order methods are not peers', () => {
  const plan = planSpeedGoalFill([
    store({ Store_Number: '11125', Check_box: ['Yes'], Number: '360' }),
    store({ Store_Number: '11102', Radio_button: LIMITED, Number: '300' }),
    store({ Store_Number: '11101', Check_box_0: ['Drive-Thru', 'Kiosk'], Number: '400' }),
    newStore(),
  ]);
  assert.deepEqual(plan.fills, []);
  assert.match(plan.unmatched[0].reason, /No other Full Food Platform store with Drive-Thru and no speed exception/);
});

test('order methods match regardless of the order they were ticked in', () => {
  const plan = planSpeedGoalFill([store({ Check_box_0: ['Kiosk', 'Drive-Thru'] }), newStore({ Check_box_0: ['Drive-Thru', 'Kiosk'] })]);
  assert.equal(plan.fills.length, 1);
});

test('blank goals on a peer are copied as blank, not invented', () => {
  const kioskOnly = { Number_2: '', Number_3: '', Number_4: '', Number: '420', Number_0: '420', Number_1: '420' };
  const plan = planSpeedGoalFill([store({ Check_box_0: ['Kiosk'], ...kioskOnly }), newStore({ Check_box_0: ['Kiosk'] })]);
  assert.deepEqual(plan.fills[0].values, { Number: '420', Number_0: '420', Number_1: '420', Check_box: ['No'] });
});

test('peers that disagree stop the copy and are reported', () => {
  const plan = planSpeedGoalFill([store({ Store_Number: '11103' }), store({ Store_Number: '11301', Number_3: '75' }), newStore()]);
  assert.deepEqual(plan.fills, []);
  assert.match(plan.unmatched[0].reason, /have different goals \(11103, 11301\)/);
});

test('a new store whose exception box already says No (the Kintone default) is still filled', () => {
  const plan = planSpeedGoalFill([store(), newStore({ Check_box: ['No'] })]);
  assert.equal(plan.fills.length, 1);
  assert.deepEqual(plan.fills[0].values, STANDARD_DT, 'the box is already No, so it is not rewritten');
});

test('a new store with an exception granted is reported, not given the standard goals', () => {
  const plan = planSpeedGoalFill([store(), newStore({ Check_box: ['Yes'] })]);
  assert.deepEqual(plan.fills, []);
  assert.match(plan.unmatched[0].reason, /Speed Exceptions Granted is Yes/);
});

test('a store with any goal already set, or that is not Active, is left alone', () => {
  const plan = planSpeedGoalFill([store(), newStore({ Number_3: '70' }), newStore({ Store_Number: '11198', Active_Status: 'Opening' })]);
  assert.deepEqual([plan.fills, plan.unmatched], [[], []]);
});

test('missing format or order methods is reported rather than guessed', () => {
  const plan = planSpeedGoalFill([store(), newStore({ Check_box_0: [] }), newStore({ Store_Number: '11198', Radio_button: '' })]);
  assert.deepEqual(plan.unmatched.map((u) => u.reason.split(',')[0]), [
    'Order Method(s) is blank',
    'Store Format is blank',
  ]);
});

test('a format filled earlier in the same run is used for matching', () => {
  const pending = newStore({ Radio_button: '' });
  const plan = planSpeedGoalFill([store(), pending], { formatFills: new Map([[pending.$id, FULL]]) });
  assert.equal(plan.fills.length, 1);
});

test('fills flatten into per-field updates', () => {
  const plan = planSpeedGoalFill([store(), newStore()]);
  const fields = speedFillsToFieldFills(plan.fills);
  assert.equal(fields.length, 7);
  assert.deepEqual(fields.find((f) => f.field === 'Check_box').value, ['No']);
});

test('the alert lists copied goals and stores it could not fill', async () => {
  const { buildSyncAlert } = await import('../src/directory/external-ids.js');
  const alert = buildSyncAlert(
    {
      conflicts: [],
      missingFromKintone: [],
      missingFromDb: [],
      speedUnmatched: [{ storeNumber: '11198', reason: 'Order Method(s) is blank, so there is nothing to match on.' }],
    },
    { speedFills: [{ storeNumber: '11199', copiedFrom: ['11103', '11301'] }], applied: [{ storeNumber: '11199', field: 'Radio_button', value: 'Full Food Platform' }] },
  );
  assert.match(alert.text, /Store 11198 — Speed goals not filled: Order Method\(s\) is blank/);
  assert.match(alert.text, /Set that field; the goals fill in the next morning/);
  assert.match(alert.text, /11199: Store Format = Full Food Platform; 11199: speed goals copied from 11103, 11301/);
});
