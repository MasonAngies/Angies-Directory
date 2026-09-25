// Store Format is derived from the store's concepts: all four core concepts is
// the full platform, anything less is the limited menu. Stores with no concepts
// recorded are left alone, since there is nothing to judge from.

// Kintone generated this field code when the owner added the field by hand;
// the form label is "Store Format". Renaming the code is a UI-only change.
export const STORE_FORMAT_FIELD = 'Radio_button';
export const FULL_FORMAT = 'Full Food Platform';
export const LIMITED_FORMAT = 'Healthy/Limited Menu';
export const FULL_CONCEPTS = ['Prime', 'Lobster', 'Burger', 'Chicken'];

export function formatForConcepts(concepts = []) {
  if (!concepts.length) return null;
  // Pizza and anything added later do not change the decision; only the four core concepts do.
  return FULL_CONCEPTS.every((concept) => concepts.includes(concept)) ? FULL_FORMAT : LIMITED_FORMAT;
}

export function planStoreFormatSync(records) {
  const fills = [];
  const conflicts = [];
  const withoutConcepts = [];

  for (const record of records) {
    const concepts = record.Concept ?? [];
    const computed = formatForConcepts(concepts);
    const current = String(record[STORE_FORMAT_FIELD] ?? '').trim();
    if (!computed) {
      if (!current) withoutConcepts.push(record.Store_Number);
      continue;
    }
    if (!current) {
      fills.push({ recordId: record.$id, revision: record.$revision, storeNumber: record.Store_Number, field: STORE_FORMAT_FIELD, value: computed });
    } else if (current !== computed) {
      conflicts.push({ storeNumber: record.Store_Number, current, computed, concepts: [...concepts] });
    }
  }

  return { fills, conflicts, withoutConcepts };
}
