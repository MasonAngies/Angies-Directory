// Desired Kintone app configuration (docs/SPEC.md sections 3-5), expressed as
// REST API payload fragments. scripts/setup-app.js diffs this against the app.

import { FIELDS, STATUS_VALUES } from '../directory/fields.js';

const W = { third: '260', twoThirds: '536', full: '812', audit: '150' };

const optionsFrom = (labels) => Object.fromEntries(labels.map((label, index) => [label, { label, index: String(index) }]));

// Only the keys listed here are managed; anything else Kintone stores is left alone.
function fieldProperties(config) {
  const base = Object.fromEntries(FIELDS.map((field) => [field.code, { type: field.type, code: field.code, label: field.label }]));
  const set = (code, props) => Object.assign(base[code], props);

  for (const field of FIELDS) {
    if (['SINGLE_LINE_TEXT', 'LINK'].includes(field.type)) set(field.code, { required: false, unique: false });
    else if (field.type === 'DATE') set(field.code, { required: false, unique: false, defaultNowValue: false });
    else set(field.code, { required: false });
  }
  set('Store_Number', { required: true, unique: true });
  set('Store_Name', { required: true });
  set('Active_Status', { required: true, options: optionsFrom(STATUS_VALUES), defaultValue: 'Active' });
  set('Concept', { options: optionsFrom(config.concepts), defaultValue: [] });
  set('Record_Owner', { required: true });
  for (const code of ['Store_Email', 'Store_Manager_Email', 'District_Manager_Email']) set(code, { protocol: 'MAIL' });
  set('Toast_Location_ID', { unique: true });
  set('SevenShifts_Location_ID', { unique: true });
  return base;
}

// Governance stays expanded because editors must fill Change Reason on every
// material edit; the spec allows (but does not require) collapsing it.
export const GROUPS = [
  { code: 'Group_Identity', label: 'Identity', openGroup: true },
  { code: 'Group_Store_Contacts', label: 'Store Contacts', openGroup: true },
  { code: 'Group_District_Leadership', label: 'District Leadership', openGroup: true },
  { code: 'Group_External_Systems', label: 'External Systems', openGroup: false },
  { code: 'Group_Governance', label: 'Governance', openGroup: true },
  { code: 'Group_Notes', label: 'Notes', openGroup: false },
  { code: 'Group_System_Audit', label: 'System Audit', openGroup: false },
];

export const HELP_TEXT = {
  Store_Number: 'Canonical key used by connected systems. Do not reuse or renumber.',
  District: 'Type exactly as on other stores (e.g. Central). A new spelling creates a new district.',
  Store_Email: 'Primary operational store mailbox; required when status is Active.',
};

const cell = (type, code, width, extra = {}) => ({ type, code, size: { width, ...extra } });
const row = (...fields) => ({ type: 'ROW', fields });
const label = (code) => ({ type: 'LABEL', label: `<div><small>${HELP_TEXT[code]}</small></div>`, size: { width: W.third } });
const help = (code) => row(label(code));
const group = (code, ...rows) => ({ type: 'GROUP', code, layout: rows });

export function buildLayout() {
  return [
    group(
      'Group_Identity',
      row(
        cell('SINGLE_LINE_TEXT', 'Store_Number', W.third),
        cell('SINGLE_LINE_TEXT', 'Store_Name', W.third),
        cell('DROP_DOWN', 'Active_Status', W.third),
      ),
      help('Store_Number'),
      row(cell('MULTI_SELECT', 'Concept', W.third), cell('SINGLE_LINE_TEXT', 'District', W.third), cell('USER_SELECT', 'Record_Owner', W.third)),
      row({ type: 'SPACER', elementId: '', size: { width: W.third } }, label('District')),
    ),
    group(
      'Group_Store_Contacts',
      row(cell('LINK', 'Store_Email', W.third), cell('SINGLE_LINE_TEXT', 'Store_Manager_Name', W.third), cell('LINK', 'Store_Manager_Email', W.third)),
      help('Store_Email'),
    ),
    group(
      'Group_District_Leadership',
      row(cell('SINGLE_LINE_TEXT', 'District_Manager_Name', W.third), cell('LINK', 'District_Manager_Email', W.third)),
    ),
    group(
      'Group_External_Systems',
      row(cell('SINGLE_LINE_TEXT', 'Toast_Location_ID', W.third), cell('SINGLE_LINE_TEXT', 'SevenShifts_Location_ID', W.third)),
    ),
    group(
      'Group_Governance',
      row(cell('DATE', 'Effective_Start', W.third), cell('DATE', 'Effective_End', W.third), cell('DATE', 'Last_Verified', W.third)),
      row(cell('USER_SELECT', 'Verified_By', W.third), cell('MULTI_LINE_TEXT', 'Change_Reason', W.twoThirds, { innerHeight: '80' })),
    ),
    group('Group_Notes', row(cell('MULTI_LINE_TEXT', 'Routing_Notes', W.full, { innerHeight: '100' }))),
    group(
      'Group_System_Audit',
      row(
        cell('CREATED_TIME', 'Created_datetime', W.audit),
        cell('CREATOR', 'Created_by', W.audit),
        cell('UPDATED_TIME', 'Updated_datetime', W.audit),
        cell('MODIFIER', 'Updated_by', W.audit),
        cell('RECORD_NUMBER', 'Record_number', W.audit),
      ),
    ),
  ];
}

const ACTIVE = 'Active_Status in ("Active")';
const EXCEPTION_COLUMNS = ['Store_Number', 'Store_Name', 'District', 'Record_Owner', 'Updated_datetime'];

// Kintone view filters cannot mix AND with OR, and formulas cannot read Link or
// User selection fields, so a combined "any required field blank" view or a
// computed missing-data column is not possible. Per the spec's fallback, each
// gap gets its own view. `npm run audit` is the complete combined report.
const gapView = (name, condition, extraColumns) => ({
  name,
  fields: [...EXCEPTION_COLUMNS, ...extraColumns],
  filterCond: `${ACTIVE} and ${condition}`,
});

// Record_Owner and Store_Name are required by Kintone itself, so they cannot be blank.
export function buildViews() {
  const list = [
    {
      name: 'Active Directory',
      fields: ['Store_Number', 'Store_Name', 'District', 'Store_Email', 'Store_Manager_Name', 'Store_Manager_Email', 'District_Manager_Name', 'District_Manager_Email', 'Last_Verified'],
      filterCond: ACTIVE,
      sort: 'District asc, Store_Number asc',
    },
    // Kintone treats a blank date as earlier than any date, so this single filter
    // catches never-verified and overdue records alike (confirmed live 2026-09-15).
    {
      name: 'Needs Verification',
      fields: ['Store_Number', 'Store_Name', 'District', 'Last_Verified', 'Verified_By', 'Record_Owner'],
      filterCond: `${ACTIVE} and Last_Verified < FROM_TODAY(-90, DAYS)`,
      sort: 'Last_Verified asc',
    },
    gapView('Needs Verification - No Verifier', 'Verified_By in ("")', ['Last_Verified']),
    gapView('Exceptions - Missing District', 'District = ""', []),
    gapView('Exceptions - Missing Store Email', 'Store_Email = ""', ['Store_Email']),
    gapView('Exceptions - Missing Store Manager Name', 'Store_Manager_Name = ""', ['Store_Manager_Email']),
    gapView('Exceptions - Missing Store Manager Email', 'Store_Manager_Email = ""', ['Store_Manager_Name']),
    gapView('Exceptions - Missing District Manager Name', 'District_Manager_Name = ""', ['District_Manager_Email']),
    gapView('Exceptions - Missing District Manager Email', 'District_Manager_Email = ""', ['District_Manager_Name']),
    {
      name: 'Inactive and Closed',
      fields: ['Store_Number', 'Store_Name', 'District', 'Active_Status', 'Effective_End'],
      filterCond: 'Active_Status in ("Inactive", "Closed")',
    },
    {
      name: 'External ID Mapping',
      fields: ['Store_Number', 'Store_Name', 'Toast_Location_ID', 'SevenShifts_Location_ID'],
      filterCond: '',
    },
  ];
  return Object.fromEntries(
    list.map((view, index) => [view.name, { type: 'LIST', index: String(index), sort: 'Store_Number asc', ...view }]),
  );
}

// Views this project created earlier and has since replaced. Setup removes only
// these names; views anyone else creates are always preserved.
export const RETIRED_VIEWS = ['Needs Verification - Over 90 Days', 'Needs Verification - Never Verified'];

export function buildDefinition(config) {
  const fields = fieldProperties(config);
  for (const { code, label: groupLabel, openGroup } of GROUPS) fields[code] = { type: 'GROUP', code, label: groupLabel, openGroup };
  return { fields, layout: buildLayout(), views: buildViews(), retiredViews: RETIRED_VIEWS };
}
