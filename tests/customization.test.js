import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../customization/directory-form-validation.js', import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function load(apiRecords = []) {
  const registered = [];
  const apiCalls = [];
  const sandbox = {
    module: { exports: {} },
    kintone: {
      events: { on: (events, handler) => registered.push({ events, handler }) },
      app: { getId: () => 897 },
      api: Object.assign(
        (url, method, params) => {
          apiCalls.push(params);
          return Promise.resolve({ records: apiRecords.map((district) => ({ District: { value: district } })) });
        },
        { url: (path) => `${path}.json` },
      ),
    },
  };
  vm.runInNewContext(source, sandbox);
  return { exports: sandbox.module.exports, registered, apiCalls };
}

const record = (overrides = {}) => {
  const values = {
    $id: '12',
    Store_Number: '11101',
    Store_Name: 'Test Store',
    Active_Status: 'Active',
    District: 'Central',
    Store_Email: 'store@example.com',
    Store_Manager_Name: 'Sam',
    Store_Manager_Email: 'sam@example.com',
    District_Manager_Name: 'Dana',
    District_Manager_Email: 'dana@example.com',
    Toast_Location_ID: '',
    SevenShifts_Location_ID: '',
    Effective_Start: '',
    Effective_End: '',
    ...overrides,
  };
  return Object.fromEntries(Object.entries(values).map(([code, value]) => [code, { value }]));
};

test('store number pattern matches config/directory.config.json', () => {
  const config = JSON.parse(readFileSync(new URL('../config/directory.config.json', import.meta.url), 'utf8'));
  assert.equal(load().exports.CONFIG.storeNumberPattern, config.storeNumberPattern);
});

test('registers on create, edit, inline edit, and mobile submit events', () => {
  assert.deepEqual(plain(load().registered[0].events), [
    'app.record.create.submit',
    'app.record.edit.submit',
    'app.record.index.edit.submit',
    'mobile.app.record.create.submit',
    'mobile.app.record.edit.submit',
  ]);
});

test('validate trims identifiers and blocks incomplete Active records', () => {
  const { validate } = load().exports;
  const r = record({ Store_Number: ' 11101 ', District: '  North   Shore ', Store_Email: '', Store_Manager_Email: 'sam@', Effective_Start: '2026-09-10', Effective_End: '2026-09-01' });
  const errors = plain(validate(r));
  assert.equal(r.Store_Number.value, '11101');
  assert.equal(r.District.value, 'North Shore');
  assert.deepEqual(Object.keys(errors).sort(), ['Effective_End', 'Store_Email', 'Store_Manager_Email']);
  assert.deepEqual(plain(validate(record({ Active_Status: 'Opening', Store_Email: '' }))), {});
  assert.ok(validate(record({ Store_Number: 'AB-1' })).Store_Number);
});

test('a district typed with different capitalization is rejected on submit', async () => {
  const { exports, apiCalls } = load(['Central', 'West']);
  const event = await exports.onSubmit({ record: record({ District: 'central' }) });
  assert.match(event.record.District.error, /already exists as "Central"/);
  assert.equal(event.error, 'Fix the highlighted fields before saving.');
  assert.match(apiCalls[0].query, /\$id != 12/);

  const ok = await exports.onSubmit({ record: record({ District: 'Central' }) });
  assert.equal(ok.error, undefined);
  const brandNew = await exports.onSubmit({ record: record({ District: 'North Shore' }) });
  assert.equal(brandNew.error, undefined, 'new districts are allowed');
});
