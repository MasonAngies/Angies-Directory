import assert from 'node:assert/strict';
import test from 'node:test';

import { toSnapshotRow } from '../src/export/directory-snapshot.js';

const v = (value) => ({ value });

test('directory records become database rows with real nulls and numbers', () => {
  const row = toSnapshotRow({
    $id: v('12'),
    $revision: v('7'),
    Updated_datetime: v('2026-10-01T22:42:00Z'),
    Store_Number: v('11122'),
    Store_Name: v(' Lone Cactus & 7th '),
    Active_Status: v('Active'),
    Concept: v(['Prime', 'Chicken']),
    Radio_button: v('Healthy/Limited Menu'),
    Check_box_0: v(['Kiosk', 'Drive-Thru']),
    Check_box: v(['No']),
    Store_Email: v(''),
    SevenShifts_Location_ID: v('379780'),
    Number_2: v(''),
    Number: v('360'),
  });
  assert.equal(row.store_name, 'Lone Cactus & 7th');
  assert.deepEqual(row.order_methods, ['Drive-Thru', 'Kiosk'], 'sorted so equal sets compare equal');
  assert.equal(row.store_email, null, 'blank becomes null');
  assert.equal(row.sevenshifts_location_id, 379780);
  assert.equal(row.speed_exceptions_granted, false);
  assert.equal(row.window_goal_breakfast_sec, null);
  assert.equal(row.kiosk_goal_breakfast_sec, 360);
  assert.equal(row.kintone_record_id, 12);
  assert.equal(row.kintone_updated_at, '2026-10-01T22:42:00Z');
});

test('the exception box maps Yes / No / empty to true / false / null', () => {
  assert.equal(toSnapshotRow({ Check_box: v(['Yes']) }).speed_exceptions_granted, true);
  assert.equal(toSnapshotRow({ Check_box: v([]) }).speed_exceptions_granted, null);
  assert.equal(toSnapshotRow({}).speed_exceptions_granted, null);
});

test('a non-numeric goal is stored as null rather than guessed', () => {
  assert.equal(toSnapshotRow({ Number_3: v('1:10') }).window_goal_lunch_sec, null);
});
