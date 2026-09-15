// RFC 4180 CSV parsing and writing (no dependencies).

export function parseCsv(text) {
  let input = String(text);
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let quotedField = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch !== '"') field += ch;
      else if (input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else inQuotes = false;
      continue;
    }
    if (ch === '"') {
      if (field !== '' || quotedField) throw new Error(`Malformed CSV: unexpected quote in row ${rows.length + 1}`);
      inQuotes = true;
      quotedField = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      quotedField = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      quotedField = false;
    } else {
      if (quotedField) throw new Error(`Malformed CSV: text after closing quote in row ${rows.length + 1}`);
      field += ch;
    }
  }
  if (inQuotes) throw new Error('Malformed CSV: unterminated quoted field');
  if (field !== '' || quotedField || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ''));
}

// guardFormulas prefixes cells that spreadsheets would evaluate as formulas.
// Use it for human-facing reports, never for backups meant to be re-imported.
export function toCsv(rows, { guardFormulas = false } = {}) {
  return `${rows
    .map((cells) =>
      cells
        .map((cell) => {
          let value = cell === null || cell === undefined ? '' : String(cell);
          if (guardFormulas && /^[=+\-@\t\r]/.test(value)) value = `'${value}`;
          return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(','),
    )
    .join('\r\n')}\r\n`;
}
