import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { loadDirectoryConfig } from '../src/config.js';
import { buildDirectoryWorkbook, buildExportRows, EXPORT_COLUMNS } from '../src/export/directory-export.js';
import { buildXlsx, columnName, escapeXml } from '../src/export/xlsx.js';
import { kintoneRecord, TODAY } from './fixtures/records.js';

const config = loadDirectoryConfig();

// Minimal ZIP reader: walk the local file headers written by buildXlsx.
function readZip(buffer) {
  const files = {};
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    files[name] = inflateRawSync(buffer.subarray(start, start + compressedSize)).toString('utf8');
    offset = start + compressedSize;
  }
  return files;
}

test('the workbook is a readable zip with the parts Excel needs', () => {
  const file = buildXlsx({ sheetName: 'Store Directory', columns: [{ header: 'A' }, { header: 'B' }], rows: [['1', '2'], ['3', '4']] });
  const parts = readZip(file);
  assert.deepEqual(Object.keys(parts), [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
  ]);
  assert.match(parts['xl/workbook.xml'], /name="Store Directory"/);
  const sheet = parts['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<c r="A1" t="inlineStr" s="1">/, 'header row is bold');
  assert.match(sheet, /<c r="B3" t="inlineStr"><is><t xml:space="preserve">4<\/t>/);
  assert.match(sheet, /autoFilter ref="A1:B3"/);
  assert.match(sheet, /state="frozen"/);
});

test('values are escaped, control characters dropped, and the footer sits below the data', () => {
  assert.equal(escapeXml('Tom & "Jerry" <b>'), 'Tom &amp; &quot;Jerry&quot; &lt;b&gt;');
  assert.equal(escapeXml(`bad${String.fromCharCode(7)}char`), 'badchar');
  assert.deepEqual([columnName(0), columnName(25), columnName(26), columnName(27)], ['A', 'Z', 'AA', 'AB']);
  const sheet = readZip(buildXlsx({ columns: [{ header: 'A & B' }], rows: [['x']], footer: 'Replaced daily' }))['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /A &amp; B/);
  assert.match(sheet, /<row r="4"><c r="A4"[^>]*><is><t xml:space="preserve">Replaced daily/);
  assert.match(sheet, /autoFilter ref="A1:A2"/, 'the footer is outside the filter range');
});

const records = [
  kintoneRecord({ Store_Number: '11134', District: 'East District', Concept: ['Prime', 'Lobster'], Street_Address: '1 Power Rd', City: 'Mesa', State: 'AZ' }, { id: '1' }),
  kintoneRecord({ Store_Number: '11101', District: 'East District', Last_Verified: '', Verified_By: [] }, { id: '2' }),
  kintoneRecord({ Store_Number: '9001', District: 'Central District A', Last_Verified: '2026-01-01', District_Manager_Email: '' }, { id: '3' }),
  kintoneRecord({ Store_Number: '15103', Active_Status: 'Closed' }, { id: '4' }),
];

test('the export covers active stores only, sorted by district then store number', () => {
  const { rows, columns, summary } = buildExportRows(records, { config, today: TODAY });
  assert.deepEqual(rows.map((row) => row[0]), ['9001', '11101', '11134'], 'closed store excluded; 9001 before 11101');
  assert.equal(columns.length, EXPORT_COLUMNS.length);
  assert.equal(columns.at(-1).header, 'Director Phone', 'contact fields only: no Verified or Data Check column');
  assert.deepEqual(summary, { activeStores: 3, completeRows: 2, incompleteRows: 1 }, 'gaps are still counted for the run log');
});

test('rows carry the contact fields, with multi-select values joined', () => {
  const { rows } = buildExportRows(records, { config, today: TODAY });
  const [, , complete] = rows;
  assert.equal(complete.length, EXPORT_COLUMNS.length);
  assert.equal(complete[3], 'Prime, Lobster', 'multi-select values are joined');
  assert.deepEqual(complete.slice(5, 8), ['1 Power Rd', 'Mesa', 'AZ']);
  assert.ok(!rows.flat().some((value) => /Not verified|Missing or invalid/.test(value)));
});

test('the workbook explains that it is a daily copy of Kintone', () => {
  const { file, summary } = buildDirectoryWorkbook(records, { config, today: TODAY, generatedAt: new Date('2026-09-15T18:00:00Z') });
  const sheet = readZip(file)['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /system of record/);
  assert.match(sheet, /replaced daily/);
  assert.match(sheet, /Sep 15, 2026/);
  assert.equal(summary.activeStores, 3);
});
