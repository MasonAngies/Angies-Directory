import { USER_FIELDS } from '../../src/directory/fields.js';

export const TODAY = '2026-09-15';

// A complete, verified Active store. All contact data is fictional.
export function plainRecord(overrides = {}) {
  return {
    Store_Number: '11101',
    Store_Name: 'Test Store',
    Active_Status: 'Active',
    Concept: ['Lobster'],
    District: 'Central',
    Store_Email: 'store11101@example.com',
    Store_Manager_Name: 'Sam Manager',
    Store_Manager_Email: 'sam@example.com',
    District_Manager_Name: 'Dana District',
    District_Manager_Email: 'dana@example.com',
    Toast_Location_ID: '',
    SevenShifts_Location_ID: '',
    Routing_Notes: '',
    ...overrides,
  };
}

export function kintoneRecord(overrides = {}, { id = '1', revision = '3' } = {}) {
  const record = {
    $id: { type: '__ID__', value: id },
    $revision: { type: '__REVISION__', value: revision },
    Updated_datetime: { type: 'UPDATED_TIME', value: '2026-09-15T12:00:00Z' },
    Updated_by: { type: 'MODIFIER', value: { code: 'editor', name: 'Editor' } },
  };
  for (const [code, value] of Object.entries(plainRecord(overrides))) {
    record[code] = { value: USER_FIELDS.includes(code) ? value.map((user) => ({ code: user, name: user })) : value };
  }
  return record;
}
