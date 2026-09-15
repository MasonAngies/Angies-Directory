import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDirectoryConfig } from '../src/config.js';
import { KintoneError } from '../src/kintone/client.js';
import { createDirectoryLookup, LOOKUP_FIELDS } from '../src/lookup/getStoreDirectoryRecord.js';
import { kintoneRecord } from './fixtures/records.js';

const config = loadDirectoryConfig();

function setup(response) {
  const requests = [];
  const events = [];
  const client = {
    get: async (path, params) => {
      requests.push({ path, params });
      if (response instanceof Error) throw response;
      return { records: response };
    },
  };
  const lookup = createDirectoryLookup({ client, appId: '897', config, logger: (event) => events.push(event) });
  return { lookup, requests, events };
}

test('DIRECTORY_OK returns the contract record from an exact, minimal query', async () => {
  const { lookup, requests } = setup([kintoneRecord({}, { id: '42', revision: '9' })]);
  const result = await lookup({ storeNumber: ' 11101 ' });
  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, 'DIRECTORY_OK');
  assert.deepEqual(result.record, {
    storeNumber: '11101',
    storeName: 'Test Store',
    activeStatus: 'Active',
    concept: ['Lobster'],
    district: 'Central',
    storeEmail: 'store11101@example.com',
    storeManagerName: 'Sam Manager',
    storeManagerEmail: 'sam@example.com',
    districtManagerName: 'Dana District',
    districtManagerEmail: 'dana@example.com',
    storeManagerPhone: '',
    districtManagerPhone: '',
    directorName: '',
    directorEmail: '',
    directorPhone: '',
    streetAddress: '',
    city: '',
    state: '',
    toastLocationId: '',
    sevenShiftsLocationId: '',
    recordId: '42',
    recordRevision: '9',
  });
  assert.equal(requests[0].params.query, 'Store_Number = "11101" limit 3');
  assert.deepEqual(requests[0].params.fields, LOOKUP_FIELDS);
  assert.ok(!LOOKUP_FIELDS.includes('Routing_Notes') && !LOOKUP_FIELDS.includes('Change_Reason'));
});

test('INVALID_STORE_NUMBER never queries Kintone', async () => {
  for (const storeNumber of ['', '   ', 'abc', '11-101', null, undefined, {}, -5, '1234567']) {
    const { lookup, requests } = setup([]);
    const result = await lookup({ storeNumber });
    assert.equal(result.reasonCode, 'INVALID_STORE_NUMBER', String(storeNumber));
    assert.equal(result.record, null);
    assert.equal(requests.length, 0);
  }
});

test('STORE_NOT_FOUND when nothing matches exactly', async () => {
  assert.equal((await setup([]).lookup({ storeNumber: '11101' })).reasonCode, 'STORE_NOT_FOUND');
  const nearMiss = setup([kintoneRecord({ Store_Number: '11101 ' })]);
  assert.equal((await nearMiss.lookup({ storeNumber: '11101' })).reasonCode, 'STORE_NOT_FOUND');
});

test('DUPLICATE_STORE when more than one record matches', async () => {
  const { lookup } = setup([kintoneRecord({}, { id: '1' }), kintoneRecord({}, { id: '2' })]);
  const result = await lookup({ storeNumber: '11101' });
  assert.equal(result.reasonCode, 'DUPLICATE_STORE');
  assert.equal(result.record, null);
});

test('STORE_NOT_ACTIVE for any status other than Active', async () => {
  const cases = [{ Active_Status: 'Closed' }, { Active_Status: 'Opening' }, { Active_Status: 'Inactive' }];
  for (const overrides of cases) {
    const result = await setup([kintoneRecord(overrides)]).lookup({ storeNumber: '11101' });
    assert.equal(result.reasonCode, 'STORE_NOT_ACTIVE', JSON.stringify(overrides));
    assert.equal(result.record, null);
  }
});

test('DIRECTORY_INCOMPLETE for missing or invalid data, listing fields but not values', async () => {
  const cases = [
    [{ Store_Email: '' }, 'ACTIVE_FIELD_MISSING', 'Store_Email'],
    [{ District_Manager_Email: 'dana@' }, 'INVALID_EMAIL', 'District_Manager_Email'],
    [{ Store_Manager_Phone: '555-0123' }, 'INVALID_PHONE', 'Store_Manager_Phone'],
    [{ District: 'Central ' }, 'DISTRICT_NOT_CANONICAL', 'District'],
  ];
  for (const [overrides, code, field] of cases) {
    const result = await setup([kintoneRecord(overrides)]).lookup({ storeNumber: '11101' });
    assert.equal(result.reasonCode, 'DIRECTORY_INCOMPLETE', code);
    assert.equal(result.record, null);
    assert.deepEqual(result.issues, [{ code, field }]);
  }
});

test('concept options added in Kintone do not block lookups', async () => {
  const result = await setup([kintoneRecord({ Concept: ['Tacos'] })]).lookup({ storeNumber: '11101' });
  assert.equal(result.reasonCode, 'DIRECTORY_OK');
});

test('KINTONE_UNAVAILABLE when the request fails; no fallback record', async () => {
  const { lookup, events } = setup(new KintoneError('down', { status: 503, code: 'X', retryable: true }));
  const result = await lookup({ storeNumber: '11101', correlationId: 'job-1' });
  assert.deepEqual(result, { ok: false, reasonCode: 'KINTONE_UNAVAILABLE', record: null });
  assert.equal(events[0].errorStatus, 503);
});

test('logs carry safe metadata only', async () => {
  const { lookup, events } = setup([kintoneRecord({}, { id: '42', revision: '9' })]);
  await lookup({ storeNumber: '11101', correlationId: 'job-7' });
  assert.equal(events.length, 1);
  const { latencyMs, ...event } = events[0];
  assert.equal(typeof latencyMs, 'number');
  assert.deepEqual(event, {
    event: 'directory_lookup',
    reasonCode: 'DIRECTORY_OK',
    storeNumber: '11101',
    recordId: '42',
    recordRevision: '9',
    correlationId: 'job-7',
  });
  assert.ok(!JSON.stringify(events).includes('@'));
});

