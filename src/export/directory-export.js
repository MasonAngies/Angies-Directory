// Builds the shared directory workbook: the contact fields other departments
// need, plus columns showing how trustworthy each row is.

import { FIELD_LABELS } from '../directory/fields.js';
import { daysBetween, fromKintoneRecord, isBlank, isValidDate, validateRecord } from '../directory/rules.js';
import { buildXlsx } from './xlsx.js';

export const EXPORT_COLUMNS = [
  { code: 'Store_Number', header: 'Store #', width: 9 },
  { code: 'Store_Name', header: 'Store Name', width: 26 },
  { code: 'Active_Status', header: 'Status', width: 9 },
  { code: 'Concept', header: 'Concept', width: 24 },
  { code: 'District', header: 'District', width: 18 },
  { code: 'Street_Address', header: 'Street Address', width: 28 },
  { code: 'City', header: 'City', width: 16 },
  { code: 'State', header: 'State', width: 7 },
  { code: 'Store_Email', header: 'Store Email', width: 26 },
  { code: 'Store_Manager_Name', header: 'Store Manager', width: 20 },
  { code: 'Store_Manager_Email', header: 'Store Manager Email', width: 28 },
  { code: 'Store_Manager_Phone', header: 'Store Manager Phone', width: 17 },
  { code: 'District_Manager_Name', header: 'District Manager', width: 20 },
  { code: 'District_Manager_Email', header: 'District Manager Email', width: 28 },
  { code: 'District_Manager_Phone', header: 'District Manager Phone', width: 17 },
  { code: 'Director_Name', header: 'Director', width: 20 },
  { code: 'Director_Email', header: 'Director Email', width: 28 },
  { code: 'Director_Phone', header: 'Director Phone', width: 17 },
];

export const STATUS_COLUMNS = [
  { header: 'Verified', width: 26 },
  { header: 'Data Check', width: 40 },
];

// Issues a reader of the export should know about before using a row.
const READER_VISIBLE = new Set(['ACTIVE_FIELD_MISSING', 'REQUIRED_FIELD_MISSING', 'INVALID_EMAIL', 'INVALID_PHONE']);

export function verificationLabel(record, { config, today }) {
  if (isBlank(record.Last_Verified) || isBlank(record.Verified_By)) return 'Not verified yet';
  if (!isValidDate(record.Last_Verified)) return 'Verification date unreadable';
  const age = daysBetween(record.Last_Verified, today);
  return age > config.verificationMaxAgeDays ? `${record.Last_Verified} (over ${config.verificationMaxAgeDays} days old)` : record.Last_Verified;
}

const cellValue = (value) => (Array.isArray(value) ? value.join(', ') : String(value ?? ''));

export function buildExportRows(kintoneRecords, { config, today }) {
  const records = kintoneRecords
    .map(fromKintoneRecord)
    .filter((record) => record.Active_Status === 'Active')
    .sort(
      (a, b) =>
        a.District.localeCompare(b.District) || a.Store_Number.localeCompare(b.Store_Number, undefined, { numeric: true }),
    );

  let complete = 0;
  const rows = records.map((record) => {
    const issues = validateRecord(record, { config, today }).filter((issue) => READER_VISIBLE.has(issue.code));
    const missing = [...new Set(issues.map((issue) => FIELD_LABELS[issue.field] ?? issue.field))];
    if (!missing.length) complete += 1;
    return [
      ...EXPORT_COLUMNS.map((column) => cellValue(record[column.code])),
      verificationLabel(record, { config, today }),
      missing.length ? `Missing or invalid: ${missing.join(', ')}` : 'Complete',
    ];
  });

  return {
    columns: [...EXPORT_COLUMNS, ...STATUS_COLUMNS],
    rows,
    summary: { activeStores: records.length, completeRows: complete, incompleteRows: records.length - complete },
  };
}

export function buildDirectoryWorkbook(kintoneRecords, { config, today, generatedAt = new Date() }) {
  const { columns, rows, summary } = buildExportRows(kintoneRecords, { config, today });
  const stamp = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(generatedAt);
  const footer =
    `Exported ${stamp} from the Kintone store directory, which is the system of record. ` +
    'This file is replaced daily, so edits here are lost. Ask the directory owner to correct anything wrong.';
  return { file: buildXlsx({ sheetName: 'Store Directory', columns, rows, footer }), summary };
}
