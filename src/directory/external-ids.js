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

// Plain-text operator alert. Returns null when there is nothing worth an email:
// a silent sync should stay silent.
export function buildSyncAlert(plan, { applied = [], appName = 'angies-store-directory' } = {}) {
  const lines = [];
  for (const conflict of plan.conflicts) {
    lines.push(
      conflict.reason === 'ambiguous'
        ? `Store ${conflict.storeNumber}: two rows in the database share this store number, so nothing was matched.`
        : `Store ${conflict.storeNumber}: ${conflict.field} is "${conflict.kintone}" in the directory but "${conflict.db}" in the database. Left as it is.`,
    );
  }
  for (const store of plan.missingFromKintone) {
    lines.push(`Store ${store.storeNumber} (${store.storeName}) is active in the database but is not in the directory. Add it.`);
  }
  for (const store of plan.missingFromDb) {
    lines.push(`Store ${store.storeNumber} (${store.storeName}) is Active in the directory but not in the database. Check the store number.`);
  }
  if (!lines.length) return null;

  const filled = applied.length
    ? [`Filled in automatically: ${applied.map((fill) => `${fill.storeNumber} ${fill.field}`).join(', ')}.`, '']
    : [];
  return {
    subject: `Store directory: ${lines.length} item${lines.length === 1 ? ' needs' : 's need'} attention`,
    text: [
      `The daily store directory job found ${lines.length} thing${lines.length === 1 ? '' : 's'} it would not decide on its own.`,
      '',
      ...filled,
      ...lines.map((line) => `- ${line}`),
      '',
      'The directory file in SharePoint was published as usual; this is about data, not the export.',
      `Full log: the latest run of "${appName}" in Modal.`,
    ].join('\n'),
  };
}
