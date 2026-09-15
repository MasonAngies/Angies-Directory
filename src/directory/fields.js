// Directory field contract. Field codes are an API contract: never rename them.
// The spec's governance fields (Record Owner, effective dates, Last Verified,
// Verified By, Change Reason) were removed from the app by the directory owner
// on 2026-09-15, so the directory now holds contact data only.

export const FIELDS = [
  { code: 'Store_Number', label: 'Store Number', type: 'SINGLE_LINE_TEXT' },
  { code: 'Store_Name', label: 'Store Name', type: 'SINGLE_LINE_TEXT' },
  { code: 'Active_Status', label: 'Active Status', type: 'DROP_DOWN' },
  // Spec lists Drop-down; the owner changed this to multi-select (2026-09-15).
  { code: 'Concept', label: 'Concept', type: 'MULTI_SELECT' },
  // Spec lists Drop-down; the owner chose strict-match text (2026-09-15) so new
  // districts need no schema change. See rules.js.
  { code: 'District', label: 'District', type: 'SINGLE_LINE_TEXT' },
  { code: 'Street_Address', label: 'Street Address', type: 'SINGLE_LINE_TEXT' },
  { code: 'City', label: 'City', type: 'SINGLE_LINE_TEXT' },
  { code: 'State', label: 'State', type: 'SINGLE_LINE_TEXT' },
  { code: 'Store_Email', label: 'Store Email', type: 'LINK' },
  { code: 'Store_Manager_Name', label: 'Store Manager Name', type: 'SINGLE_LINE_TEXT' },
  { code: 'Store_Manager_Email', label: 'Store Manager Email', type: 'LINK' },
  { code: 'Store_Manager_Phone', label: 'Store Manager Phone', type: 'LINK' },
  { code: 'District_Manager_Name', label: 'District Manager Name', type: 'SINGLE_LINE_TEXT' },
  { code: 'District_Manager_Email', label: 'District Manager Email', type: 'LINK' },
  { code: 'District_Manager_Phone', label: 'District Manager Phone', type: 'LINK' },
  { code: 'Director_Name', label: 'Director Name', type: 'SINGLE_LINE_TEXT' },
  { code: 'Director_Email', label: 'Director Email', type: 'LINK' },
  { code: 'Director_Phone', label: 'Director Phone', type: 'LINK' },
  { code: 'Toast_Location_ID', label: 'Toast Location ID', type: 'SINGLE_LINE_TEXT' },
  { code: 'SevenShifts_Location_ID', label: '7shifts Location ID', type: 'SINGLE_LINE_TEXT' },
  { code: 'Routing_Notes', label: 'Routing Notes', type: 'MULTI_LINE_TEXT' },
];

export const FIELD_CODES = FIELDS.map((field) => field.code);
export const FIELD_LABELS = Object.fromEntries(FIELDS.map((field) => [field.code, field.label]));

export const STATUS_VALUES = ['Active', 'Inactive', 'Opening', 'Closed'];
export const ALWAYS_REQUIRED = ['Store_Number', 'Store_Name', 'Active_Status'];
export const ACTIVE_REQUIRED = [
  'District',
  'Store_Email',
  'Store_Manager_Name',
  'Store_Manager_Email',
  'District_Manager_Name',
  'District_Manager_Email',
];
export const EMAIL_FIELDS = ['Store_Email', 'Store_Manager_Email', 'District_Manager_Email', 'Director_Email'];
// Phones are optional; when present they must use the 480-555-0123 format.
export const PHONE_FIELDS = ['Store_Manager_Phone', 'District_Manager_Phone', 'Director_Phone'];
export const EXTERNAL_ID_FIELDS = ['Toast_Location_ID', 'SevenShifts_Location_ID'];
export const USER_FIELDS = FIELDS.filter((field) => field.type === 'USER_SELECT').map((field) => field.code);
export const MULTI_VALUE_FIELDS = FIELDS.filter((field) => field.type === 'MULTI_SELECT').map((field) => field.code);
export const TRIMMED_TEXT_FIELDS = [
  'Store_Name',
  'Street_Address',
  'City',
  'Store_Manager_Name',
  'District_Manager_Name',
  'Director_Name',
  'Toast_Location_ID',
  'SevenShifts_Location_ID',
];
