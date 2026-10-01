// Fills speed goals for a new store by copying them from its peers: Active
// stores with the same Store Format and Order Method(s) and no speed
// exception. It only copies when every peer agrees, and never touches a store
// that already has any goal set. "New" means all six goals are blank; the
// exception box defaults to No in Kintone, so it cannot be used to tell.

import { CUSTOM_FIELDS, SPEED_GOAL_FIELDS } from './custom-fields.js';

const { storeFormat: FORMAT, orderMethods: METHODS, speedExceptions: EXCEPTIONS } = CUSTOM_FIELDS;

const blank = (value) => (Array.isArray(value) ? value.length === 0 : value === '' || value === null || value === undefined);
const methodsKey = (methods) => [...(methods ?? [])].sort().join(' + ');
const goalsOf = (record) => SPEED_GOAL_FIELDS.map((code) => String(record[code] ?? ''));

/**
 * @param {object[]} records plain records carrying the custom fields
 * @param {{ formatFills?: Map<string, string> }} options Store Format values
 *   being filled in this same run, keyed by record id, so a store whose format
 *   is set this morning can also get its goals this morning.
 */
export function planSpeedGoalFill(records, { formatFills = new Map() } = {}) {
  const formatOf = (record) => formatFills.get(record.$id) ?? String(record[FORMAT] ?? '');

  const isNew = (record) => SPEED_GOAL_FIELDS.every((code) => blank(record[code]));
  const exceptionOf = (record) => (Array.isArray(record[EXCEPTIONS]) ? record[EXCEPTIONS] : []);
  const peers = records.filter(
    (record) => record.Active_Status === 'Active' && !isNew(record) && JSON.stringify(exceptionOf(record)) === JSON.stringify(['No']),
  );

  const fills = [];
  const unmatched = [];

  for (const record of records) {
    if (record.Active_Status !== 'Active' || !isNew(record)) continue;
    const store = record.Store_Number;
    if (exceptionOf(record).includes('Yes')) {
      unmatched.push({ storeNumber: store, reason: 'Speed Exceptions Granted is Yes, so its goals have to be set by hand.' });
      continue;
    }
    const format = formatOf(record);
    const methods = methodsKey(record[METHODS]);
    if (!format) {
      unmatched.push({ storeNumber: store, reason: 'Store Format is blank, so there is nothing to match on.' });
      continue;
    }
    if (!methods) {
      unmatched.push({ storeNumber: store, reason: 'Order Method(s) is blank, so there is nothing to match on.' });
      continue;
    }

    const matches = peers.filter((peer) => formatOf(peer) === format && methodsKey(peer[METHODS]) === methods);
    if (!matches.length) {
      unmatched.push({ storeNumber: store, reason: `No other ${format} store with ${methods} and no speed exception to copy from.` });
      continue;
    }
    const variants = [...new Set(matches.map((peer) => JSON.stringify(goalsOf(peer))))];
    if (variants.length > 1) {
      unmatched.push({
        storeNumber: store,
        reason: `The ${format} stores with ${methods} have different goals (${matches.map((p) => p.Store_Number).join(', ')}), so none was copied.`,
      });
      continue;
    }

    const goals = JSON.parse(variants[0]);
    const values = Object.fromEntries(SPEED_GOAL_FIELDS.map((code, index) => [code, goals[index]]).filter(([, value]) => value !== ''));
    fills.push({
      recordId: record.$id,
      revision: record.$revision,
      storeNumber: store,
      // Only write the exception box when it is empty; Kintone usually defaults it to No.
      values: blank(record[EXCEPTIONS]) ? { ...values, [EXCEPTIONS]: ['No'] } : values,
      copiedFrom: matches.map((peer) => peer.Store_Number),
    });
  }

  return { fills, unmatched };
}

// Same shape as the ID and format fills, so one Kintone update covers them all.
export function speedFillsToFieldFills(fills) {
  return fills.flatMap((fill) =>
    Object.entries(fill.values).map(([field, value]) => ({ recordId: fill.recordId, revision: fill.revision, storeNumber: fill.storeNumber, field, value })),
  );
}
