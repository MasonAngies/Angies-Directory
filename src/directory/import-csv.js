import { FIELD_CODES, MULTI_VALUE_FIELDS, USER_FIELDS } from './fields.js';

const splitLines = (cell) => cell.split(/\r?\n/).filter((item) => item !== '');

// Turns parsed CSV rows (header = exact field codes) into plain directory
// records. Values are not trimmed so the validator can report untidy input.
export function rowsToRecords(rows) {
  const [header, ...data] = rows;
  if (!header) throw new Error('The file is empty.');
  const missing = FIELD_CODES.filter((code) => !header.includes(code));
  const unknown = header.filter((code) => !FIELD_CODES.includes(code));
  const repeated = header.filter((code, index) => header.indexOf(code) !== index);
  if (missing.length || unknown.length || repeated.length) {
    throw new Error(
      [
        missing.length && `Missing columns: ${missing.join(', ')}`,
        unknown.length && `Unknown columns: ${unknown.join(', ')}`,
        repeated.length && `Repeated columns: ${repeated.join(', ')}`,
        'Headers must be the exact field codes from templates/store_directory_import_template.csv.',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return data.map((cells, index) => {
    if (cells.length !== header.length) throw new Error(`Row ${index + 2} has ${cells.length} cells; the header has ${header.length}.`);
    const record = { $row: index + 2 };
    header.forEach((code, column) => {
      const cell = cells[column];
      record[code] = USER_FIELDS.includes(code) || MULTI_VALUE_FIELDS.includes(code) ? splitLines(cell) : cell;
    });
    return record;
  });
}
