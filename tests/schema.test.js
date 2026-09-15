import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDirectoryConfig } from '../src/config.js';
import { FIELDS } from '../src/directory/fields.js';
import { buildDefinition, GROUPS } from '../src/schema/definition.js';
import { buildPermissions, planFields, planLayout, planPermissions, planViews } from '../src/schema/plan.js';

const config = loadDirectoryConfig();
const definition = buildDefinition(config);

// docs/SPEC.md section 3, with the owner's approved changes to Concept and District.
const SPEC_FIELDS = {
  Store_Number: 'SINGLE_LINE_TEXT',
  Store_Name: 'SINGLE_LINE_TEXT',
  Active_Status: 'DROP_DOWN',
  Concept: 'MULTI_SELECT',
  District: 'SINGLE_LINE_TEXT',
  Store_Email: 'LINK',
  Store_Manager_Name: 'SINGLE_LINE_TEXT',
  Store_Manager_Email: 'LINK',
  District_Manager_Name: 'SINGLE_LINE_TEXT',
  District_Manager_Email: 'LINK',
  Routing_Notes: 'MULTI_LINE_TEXT',
  Toast_Location_ID: 'SINGLE_LINE_TEXT',
  SevenShifts_Location_ID: 'SINGLE_LINE_TEXT',
  Effective_Start: 'DATE',
  Effective_End: 'DATE',
  Last_Verified: 'DATE',
  Verified_By: 'USER_SELECT',
  Record_Owner: 'USER_SELECT',
  Change_Reason: 'MULTI_LINE_TEXT',
  // Added at the owner's request (2026-09-15).
  Street_Address: 'SINGLE_LINE_TEXT',
  City: 'SINGLE_LINE_TEXT',
  State: 'SINGLE_LINE_TEXT',
  Store_Manager_Phone: 'LINK',
  District_Manager_Phone: 'LINK',
  Director_Name: 'SINGLE_LINE_TEXT',
  Director_Email: 'LINK',
  Director_Phone: 'LINK',
};

test('every spec field code exists with the specified type and rules (AC-01, AC-02)', () => {
  const fields = definition.fields;
  for (const [code, type] of Object.entries(SPEC_FIELDS)) assert.equal(fields[code]?.type, type, code);
  assert.equal(FIELDS.length, Object.keys(SPEC_FIELDS).length);
  assert.deepEqual([fields.Store_Number.required, fields.Store_Number.unique], [true, true]);
  assert.deepEqual(Object.keys(fields.Active_Status.options), ['Active', 'Inactive', 'Opening', 'Closed']);
  assert.equal(fields.Active_Status.defaultValue, 'Active');
  assert.deepEqual(Object.keys(fields.Concept.options), ['Prime', 'Lobster', 'Chicken', 'Burger', 'Pizza']);
  for (const code of ['Store_Name', 'Active_Status', 'Record_Owner']) assert.equal(fields[code].required, true, code);
  for (const code of ['Toast_Location_ID', 'SevenShifts_Location_ID']) assert.equal(fields[code].unique, true, code);
  for (const code of ['Store_Email', 'Store_Manager_Email', 'District_Manager_Email', 'Director_Email']) assert.equal(fields[code].protocol, 'MAIL', code);
  for (const code of ['Store_Manager_Phone', 'District_Manager_Phone', 'Director_Phone']) assert.equal(fields[code].protocol, 'CALL', code);
});

test('form groups and rows follow the spec order (AC-04)', () => {
  const rowsOf = (group) =>
    group.layout.map((row) => row.fields.filter((field) => field.code).map((field) => field.code)).filter((codes) => codes.length);
  const layout = Object.fromEntries(definition.layout.map((group) => [group.code, rowsOf(group)]));
  assert.deepEqual(definition.layout.map((group) => group.code), GROUPS.map((group) => group.code));
  assert.deepEqual(layout, {
    Group_Identity: [
      ['Store_Number', 'Store_Name', 'Active_Status'],
      ['Concept', 'District', 'Record_Owner'],
      ['Street_Address', 'City', 'State'],
    ],
    Group_Store_Contacts: [['Store_Email', 'Store_Manager_Name', 'Store_Manager_Email'], ['Store_Manager_Phone']],
    Group_District_Leadership: [
      ['District_Manager_Name', 'District_Manager_Email', 'District_Manager_Phone'],
      ['Director_Name', 'Director_Email', 'Director_Phone'],
    ],
    Group_External_Systems: [['Toast_Location_ID', 'SevenShifts_Location_ID']],
    Group_Governance: [
      ['Effective_Start', 'Effective_End', 'Last_Verified'],
      ['Verified_By', 'Change_Reason'],
    ],
    Group_Notes: [['Routing_Notes']],
    Group_System_Audit: [['Created_datetime', 'Created_by', 'Updated_datetime', 'Updated_by', 'Record_number']],
  });
  const expanded = GROUPS.filter((group) => group.openGroup).map((group) => group.label);
  for (const label of ['Identity', 'Store Contacts', 'District Leadership']) assert.ok(expanded.includes(label), label);
});

test('views cover the spec and never mix AND with OR (AC-05)', () => {
  const views = definition.views;
  for (const name of ['Active Directory', 'Needs Verification', 'Inactive and Closed', 'External ID Mapping']) {
    assert.ok(views[name], name);
  }
  assert.deepEqual(Object.keys(views).filter((name) => name.startsWith('Exceptions - ')), [], 'per-gap views are retired');
  for (const name of ['Exceptions - Missing Store Email', 'Needs Verification - No Verifier']) {
    assert.ok(definition.retiredViews.includes(name), name);
  }
  assert.equal(views['Active Directory'].filterCond, 'Active_Status in ("Active")');
  assert.equal(views['Active Directory'].sort, 'District asc, Store_Number asc');
  const known = new Set([...Object.keys(SPEC_FIELDS), 'Updated_datetime']);
  for (const view of Object.values(views)) {
    assert.ok(!(/ and /.test(view.filterCond) && / or /.test(view.filterCond)), view.name);
    for (const code of view.fields) assert.ok(known.has(code), `${view.name}: ${code}`);
  }
  const indexes = Object.values(views).map((view) => Number(view.index));
  assert.deepEqual(indexes, [...indexes.keys()]);
});

test('planFields adds missing fields, ignores matching ones, and never changes types', () => {
  const empty = planFields(definition.fields, {});
  assert.equal(Object.keys(empty.add).length, Object.keys(definition.fields).length);

  const current = Object.fromEntries(Object.entries(definition.fields).map(([code, field]) => [code, { ...field, noLabel: false, maxLength: '' }]));
  const same = planFields(definition.fields, { ...current, Status: { type: 'STATUS', code: 'Status' } });
  assert.deepEqual([Object.keys(same.add), Object.keys(same.update), same.conflicts, same.unmanaged], [[], [], [], []]);

  const drifted = planFields(definition.fields, {
    ...current,
    Store_Name: { ...current.Store_Name, label: 'Name' },
    Store_Email: { ...current.Store_Email, type: 'SINGLE_LINE_TEXT' },
    Extra_Field: { type: 'NUMBER', code: 'Extra_Field' },
  });
  assert.deepEqual(Object.keys(drifted.update), ['Store_Name']);
  assert.match(drifted.conflicts[0], /Store_Email exists as SINGLE_LINE_TEXT/);
  assert.deepEqual(drifted.unmanaged, ['Extra_Field']);
});

test('options added in Kintone are kept, not removed', () => {
  const current = {
    ...definition.fields,
    Concept: { ...definition.fields.Concept, options: { ...definition.fields.Concept.options, Tacos: { label: 'Tacos', index: '5' } } },
  };
  const plan = planFields(definition.fields, current);
  assert.deepEqual(Object.keys(plan.update), []);
  assert.match(plan.notes[0], /Tacos/);
});

test('planLayout and planViews preserve elements the spec does not own', () => {
  const layoutPlan = planLayout(definition.layout, definition.layout, ['Extra_Field'], { Extra_Field: { type: 'NUMBER' } });
  assert.equal(layoutPlan.changed, true);
  assert.deepEqual(layoutPlan.layout.at(-1), { type: 'ROW', fields: [{ type: 'NUMBER', code: 'Extra_Field', size: {} }] });
  assert.equal(planLayout(definition.layout, definition.layout, [], {}).changed, false);

  const current = { ...definition.views, 'My View': { id: '9', type: 'LIST', name: 'My View', index: '0', fields: [], filterCond: '', sort: '' } };
  const viewPlan = planViews(definition.views, current);
  assert.deepEqual(viewPlan.unmanaged, ['My View']);
  assert.equal(viewPlan.views['My View'].index, String(Object.keys(definition.views).length));
  assert.equal(viewPlan.views['My View'].id, undefined);
  assert.equal(planViews(definition.views, definition.views).changed, false);

  const retiredName = definition.retiredViews[0];
  const withRetired = { ...definition.views, [retiredName]: { type: 'LIST', name: retiredName, index: '99', fields: [] } };
  const retiredPlan = planViews(definition.views, withRetired, definition.retiredViews);
  assert.deepEqual([retiredPlan.changed, retiredPlan.removed, retiredPlan.views[retiredName]], [true, [retiredName], undefined]);
});

test('permissions are only managed when explicitly enabled (AC-06)', () => {
  assert.deepEqual(planPermissions({ apply: false }, [], []), { managed: false, changed: false });
  assert.throws(() => buildPermissions({ editors: [{ type: 'GROUP', code: 'ops' }] }), /at least one administrator/);
  assert.throws(
    () => buildPermissions({ admins: [{ type: 'USER', code: 'a' }], readers: [{ type: 'USER', code: 'a' }] }),
    /more than one permission role/,
  );
  const { rights, fieldRights } = buildPermissions({
    admins: [{ type: 'USER', code: 'admin' }],
    verifiers: [{ type: 'GROUP', code: 'verifiers' }],
    editors: [{ type: 'GROUP', code: 'editors' }],
    readers: [{ type: 'GROUP', code: 'everyone' }],
  });
  assert.deepEqual(rights.map((r) => [r.entity.code, r.appEditable, r.recordEditable, r.recordDeletable]), [
    ['admin', true, true, true],
    ['verifiers', false, true, false],
    ['editors', false, true, false],
    ['everyone', false, false, false],
  ]);
  assert.deepEqual(fieldRights.map((f) => f.code), ['Last_Verified', 'Verified_By']);
  assert.deepEqual(fieldRights[0].entities.map((e) => e.accessibility), ['WRITE', 'WRITE', 'READ', 'READ']);
});
