// Matches directory records against the shared stores table (the nightly Toast +
// 7shifts sync) so Toast and 7shifts IDs can be filled in for stores added by
// hand in Kintone. Blanks are filled; a value that disagrees is only reported.

const FIELD_SOURCES = [
  { field: 'Toast_Location_ID', column: 'toast_guid', caseSensitive: false },
  { field: 'SevenShifts_Location_ID', column: 'sevenshifts_location_id', caseSensitive: true },
];

const text = (value) => (value === null || value === undefined ? '' : String(value).trim());
const same = (a, b, caseSensitive) => (caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase());

/**
 * @param {object[]} records plain directory records (fromKintoneRecord)
 * @param {object[]} dbStores rows from the stores table
 */
export function planExternalIdSync(records, dbStores) {
  const bySource = new Map();
  let dbWithoutStoreNumber = 0;
  for (const store of dbStores) {
    const key = text(store.store_number);
    // 'excluded' rows are deliberate non-stores (test locations, production kitchen).
    if (store.status === 'excluded') continue;
    if (!key) {
      dbWithoutStoreNumber += 1;
      continue;
    }
    if (bySource.has(key)) bySource.get(key).duplicate = true;
    else bySource.set(key, { ...store, duplicate: false });
  }

  const fills = [];
  const conflicts = [];
  const missingFromDb = [];
  const seen = new Set();

  for (const record of records) {
    const key = text(record.Store_Number);
    const source = bySource.get(key);
    seen.add(key);
    if (!source) {
      if (record.Active_Status === 'Active') missingFromDb.push({ storeNumber: key, storeName: record.Store_Name });
      continue;
    }
    if (source.duplicate) {
      conflicts.push({ storeNumber: key, field: 'Store_Number', kintone: key, db: 'two rows with this store number', reason: 'ambiguous' });
      continue;
    }
    for (const { field, column, caseSensitive } of FIELD_SOURCES) {
      const current = text(record[field]);
      const incoming = text(source[column]);
      if (!incoming) continue;
      if (!current) fills.push({ recordId: record.$id, revision: record.$revision, storeNumber: key, field, value: incoming });
      else if (!same(current, incoming, caseSensitive)) conflicts.push({ storeNumber: key, field, kintone: current, db: incoming, reason: 'differs' });
    }
  }

  const missingFromKintone = [...bySource.values()]
    .filter((store) => store.status === 'active' && !seen.has(text(store.store_number)))
    .map((store) => ({ storeNumber: text(store.store_number), storeName: store.store_name }));

  return { fills, conflicts, missingFromDb, missingFromKintone, dbWithoutStoreNumber };
}

// One Kintone update per record, even when both IDs are filled at once.
export function fillsToUpdates(fills) {
  const byRecord = new Map();
  for (const fill of fills) {
    if (!byRecord.has(fill.recordId)) byRecord.set(fill.recordId, { id: fill.recordId, revision: fill.revision, record: {} });
    byRecord.get(fill.recordId).record[fill.field] = { value: fill.value };
  }
  return [...byRecord.values()];
}

// Operator alert. Returns null when there is nothing worth an email: a silent
// sync should stay silent. Both a plain-text and an HTML body are produced; the
// text one is what the run log and tests read.
const escapeHtml = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function alertItems(plan) {
  const items = [];
  for (const conflict of plan.conflicts) {
    items.push(
      conflict.reason === 'ambiguous'
        ? {
            store: conflict.storeNumber,
            issue: 'Two database rows',
            detail: 'Two rows in the stores table share this store number, so nothing was matched.',
            action: 'Retire or correct one of them.',
          }
        : {
            store: conflict.storeNumber,
            issue: 'IDs disagree',
            detail: `${conflict.field.replace(/_/g, ' ')} — directory: ${conflict.kintone}; database: ${conflict.db}.`,
            action: 'Check which is right, then fix that side by hand. Nothing was changed.',
          },
    );
  }
  for (const store of plan.missingFromKintone) {
    items.push({
      store: store.storeNumber,
      issue: 'Not in the directory',
      detail: `${store.storeName} is active in the database.`,
      action: 'Add the store to the directory.',
    });
  }
  for (const store of plan.missingFromDb) {
    items.push({
      store: store.storeNumber,
      issue: 'Not in the database',
      detail: `${store.storeName} is Active in the directory.`,
      action: 'Check the store number, or wait for Toast/7shifts to catch up.',
    });
  }
  return items;
}

export function buildSyncAlert(plan, { applied = [], appName = 'angies-store-directory', kintoneUrl = '' } = {}) {
  const items = alertItems(plan);
  if (!items.length) return null;

  const count = `${items.length} item${items.length === 1 ? ' needs' : 's need'} attention`;
  const filledLines = applied.map((fill) => `${fill.storeNumber}: ${fill.field.replace(/_/g, ' ')} = ${fill.value}`);

  const text = [
    `The daily store directory job found ${items.length} thing${items.length === 1 ? '' : 's'} it would not decide on its own.`,
    '',
    ...(filledLines.length ? [`Filled in automatically: ${filledLines.join('; ')}.`, ''] : []),
    ...items.map((item) => `- Store ${item.store} — ${item.issue}: ${item.detail} ${item.action}`),
    '',
    'The directory file in SharePoint was published as usual; this is about data, not the export.',
    `Full log: the latest run of "${appName}" in Modal.`,
  ].join('\n');

  const cell = 'padding:8px 10px;border-bottom:1px solid #e3e3e3;vertical-align:top;';
  const rows = items
    .map(
      (item) => `<tr>
        <td style="${cell}font-weight:600;white-space:nowrap;">${escapeHtml(item.store)}</td>
        <td style="${cell}white-space:nowrap;">${escapeHtml(item.issue)}</td>
        <td style="${cell}">${escapeHtml(item.detail)}</td>
        <td style="${cell}color:#444;">${escapeHtml(item.action)}</td>
      </tr>`,
    )
    .join('');

  const filledBlock = filledLines.length
    ? `<p style="margin:0 0 16px;color:#1a6c2f;">Filled in automatically: ${filledLines.map(escapeHtml).join('; ')}.</p>`
    : '';
  const kintoneLink = kintoneUrl
    ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(kintoneUrl)}" style="color:#0b5cab;">Open the directory in Kintone</a></p>`
    : '';

  const html = `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#222;max-width:760px;">
  <h2 style="margin:0 0 4px;font-size:18px;">Store directory: ${escapeHtml(count)}</h2>
  <p style="margin:0 0 16px;color:#555;">The daily sync found data it would not decide on its own. The directory file in SharePoint was published as usual.</p>
  ${filledBlock}
  <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;font-size:14px;">
    <thead>
      <tr style="background:#f3f4f6;text-align:left;">
        <th style="${cell}">Store</th><th style="${cell}">Issue</th><th style="${cell}">Detail</th><th style="${cell}">What to do</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  ${kintoneLink}
  <p style="margin:16px 0 0;color:#777;font-size:12px;">Sent by the "${escapeHtml(appName)}" job; the full log is in Modal.</p>
</div>`;

  return { subject: `Store directory: ${count}`, text, html };
}
