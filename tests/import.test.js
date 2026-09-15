import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseCsv, toCsv } from '../src/csv.js';
import { FIELD_CODES } from '../src/directory/fields.js';
import { rowsToRecords } from '../src/directory/import-csv.js';

test('CSV parsing handles BOM, CRLF, quotes, embedded commas and newlines', () => {
  const text = '﻿a,b,c\r\n"1,2","say ""hi""","line1\nline2"\r\n,,\r\n';
  assert.deepEqual(parseCsv(text), [
    ['a', 'b', 'c'],
    ['1,2', 'say "hi"', 'line1\nline2'],
    ['', '', ''],
  ]);
  assert.throws(() => parseCsv('a,"b'), /unterminated/);
  assert.throws(() => parseCsv('a,b"c"'), /unexpected quote/);
});

test('CSV writing round-trips and can guard spreadsheet formulas', () => {
  const rows = [['Store_Number', 'Notes'], ['11101', 'has, comma\nand "quotes"'], ['11102', ' padded ']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
  assert.equal(toCsv([['=HYPERLINK("x")', '-5', 'ok']], { guardFormulas: true }), '"\'=HYPERLINK(""x"")",\'-5,ok\r\n');
});

test('the import template headers are exactly the field codes (AC-10)', () => {
  const [header] = parseCsv(readFileSync(new URL('../templates/store_directory_import_template.csv', import.meta.url), 'utf8'));
  assert.deepEqual(header, FIELD_CODES);
});

test('rows become records, splitting multi-value cells on newlines', () => {
  const values = Object.fromEntries(FIELD_CODES.map((code) => [code, '']));
  Object.assign(values, { Store_Number: '11101', Concept: 'Prime\nLobster' });
  const [record] = rowsToRecords([FIELD_CODES, FIELD_CODES.map((code) => values[code])]);
  assert.equal(record.$row, 2);
  assert.deepEqual(record.Concept, ['Prime', 'Lobster']);
  assert.equal(record.Store_Number, '11101');
});

test('header problems and ragged rows are rejected', () => {
  assert.throws(() => rowsToRecords([]), /empty/);
  assert.throws(() => rowsToRecords([FIELD_CODES.slice(1)]), /Missing columns: Store_Number/);
  assert.throws(() => rowsToRecords([[...FIELD_CODES, 'store_number']]), /Unknown columns: store_number/);
  assert.throws(() => rowsToRecords([FIELD_CODES, ['11101']]), /Row 2 has 1 cells/);
});
