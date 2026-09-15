// Desired Kintone app configuration (docs/SPEC.md sections 3-5), expressed as
// REST API payload fragments. scripts/setup-app.js diffs this against the app.

import { EMAIL_FIELDS, FIELDS, PHONE_FIELDS, STATUS_VALUES } from '../directory/fields.js';

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
  for (const code of EMAIL_FIELDS) set(code, { protocol: 'MAIL' });
  for (const code of PHONE_FIELDS) set(code, { protocol: 'CALL' });
  set('Toast_Location_ID', { unique: true });
  set('SevenShifts_Location_ID', { unique: true });
  return base;
}

// The spec's Governance group is gone: the owner removed those fields from the
// app on 2026-09-15, so the directory holds contact data only.
export const GROUPS = [
  { code: 'Group_Identity', label: 'Identity', openGroup: true },
  { code: 'Group_Store_Contacts', label: 'Store Contacts', openGroup: true },
  { code: 'Group_District_Leadership', label: 'District Leadership', openGroup: true },
  { code: 'Group_External_Systems', label: 'External Systems', openGroup: false },
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
      row(cell('MULTI_SELECT', 'Concept', W.third), cell('SINGLE_LINE_TEXT', 'District', W.third)),
      row({ type: 'SPACER', elementId: '', size: { width: W.third } }, label('District')),
      row(cell('SINGLE_LINE_TEXT', 'Street_Address', W.third), cell('SINGLE_LINE_TEXT', 'City', W.third), cell('SINGLE_LINE_TEXT', 'State', W.third)),
    ),
    group(
      'Group_Store_Contacts',
      row(cell('LINK', 'Store_Email', W.third), cell('SINGLE_LINE_TEXT', 'Store_Manager_Name', W.third), cell('LINK', 'Store_Manager_Email', W.third)),
      row(label('Store_Email'), cell('LINK', 'Store_Manager_Phone', W.third)),
    ),
    group(
      'Group_District_Leadership',
      row(cell('SINGLE_LINE_TEXT', 'District_Manager_Name', W.third), cell('LINK', 'District_Manager_Email', W.third), cell('LINK', 'District_Manager_Phone', W.third)),
      row(cell('SINGLE_LINE_TEXT', 'Director_Name', W.third), cell('LINK', 'Director_Email', W.third), cell('LINK', 'Director_Phone', W.third)),
    ),
    group(
      'Group_External_Systems',
      row(cell('SINGLE_LINE_TEXT', 'Toast_Location_ID', W.third), cell('SINGLE_LINE_TEXT', 'SevenShifts_Location_ID', W.third)),
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

// The per-gap "Exceptions - ..." views were retired once the initial data was
// filled in (owner decision 2026-09-15). Kintone views cannot mix AND with OR,
// so there is no single combined exceptions view: `npm run audit` is the
// exception report.
export function buildViews() {
  const list = [
    {
      name: 'Active Directory',
      fields: ['Store_Number', 'Store_Name', 'District', 'Store_Email', 'Store_Manager_Name', 'Store_Manager_Email', 'Store_Manager_Phone', 'District_Manager_Name', 'District_Manager_Email', 'District_Manager_Phone'],
      filterCond: ACTIVE,
      sort: 'District asc, Store_Number asc',
    },
    {
      name: 'Leadership Contacts',
      fields: ['Store_Number', 'Street_Address', 'City', 'State', 'Director_Name', 'District_Manager_Name', 'District_Manager_Phone', 'Store_Manager_Name', 'Store_Manager_Phone'],
      filterCond: ACTIVE,
      sort: 'District asc, Store_Number asc',
    },
    {
      name: 'Inactive and Closed',
      fields: ['Store_Number', 'Store_Name', 'District', 'Active_Status'],
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
export const RETIRED_VIEWS = [
  'Needs Verification',
  'Needs Verification - Over 90 Days',
  'Needs Verification - Never Verified',
  'Needs Verification - No Verifier',
  'Exceptions - Missing District',
  'Exceptions - Missing Store Email',
  'Exceptions - Missing Store Manager Name',
  'Exceptions - Missing Store Manager Email',
  'Exceptions - Missing District Manager Name',
  'Exceptions - Missing District Manager Email',
];

export function buildDefinition(config) {
  const fields = fieldProperties(config);
  for (const { code, label: groupLabel, openGroup } of GROUPS) fields[code] = { type: 'GROUP', code, label: groupLabel, openGroup };
  return { fields, layout: buildLayout(), views: buildViews(), retiredViews: RETIRED_VIEWS };
}
