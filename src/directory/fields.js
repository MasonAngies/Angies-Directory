// Directory field contract from docs/SPEC.md section 3, in form order.
// Field codes are an API contract: never rename them.

export const FIELDS = [
  { code: 'Store_Number', label: 'Store Number', type: 'SINGLE_LINE_TEXT' },
  { code: 'Store_Name', label: 'Store Name', type: 'SINGLE_LINE_TEXT' },
  { code: 'Active_Status', label: 'Active Status', type: 'DROP_DOWN' },
  // Spec lists Drop-down; the directory owner changed this to multi-select (2026-09-15).
  { code: 'Concept', label: 'Concept', type: 'MULTI_SELECT' },
  // Spec lists Drop-down; the directory owner chose strict-match text (2026-09-15)
  // so new districts can be typed without a schema change. See rules.js.
  { code: 'District', label: 'District', type: 'SINGLE_LINE_TEXT' },
  { code: 'Record_Owner', label: 'Record Owner', type: 'USER_SELECT' },
  { code: 'Store_Email', label: 'Store Email', type: 'LINK' },
  { code: 'Store_Manager_Name', label: 'Store Manager Name', type: 'SINGLE_LINE_TEXT' },
  { code: 'Store_Manager_Email', label: 'Store Manager Email', type: 'LINK' },
  { code: 'District_Manager_Name', label: 'District Manager Name', type: 'SINGLE_LINE_TEXT' },
  { code: 'District_Manager_Email', label: 'District Manager Email', type: 'LINK' },
  { code: 'Toast_Location_ID', label: 'Toast Location ID', type: 'SINGLE_LINE_TEXT' },
  { code: 'SevenShifts_Location_ID', label: '7shifts Location ID', type: 'SINGLE_LINE_TEXT' },
  { code: 'Effective_Start', label: 'Effective Start', type: 'DATE' },
  { code: 'Effective_End', label: 'Effective End', type: 'DATE' },
  { code: 'Last_Verified', label: 'Last Verified', type: 'DATE' },
  { code: 'Verified_By', label: 'Verified By', type: 'USER_SELECT' },
  { code: 'Change_Reason', label: 'Change Reason', type: 'MULTI_LINE_TEXT' },
  { code: 'Routing_Notes', label: 'Routing Notes', type: 'MULTI_LINE_TEXT' },
];

export const FIELD_CODES = FIELDS.map((field) => field.code);
export const FIELD_LABELS = Object.fromEntries(FIELDS.map((field) => [field.code, field.label]));

export const STATUS_VALUES = ['Active', 'Inactive', 'Opening', 'Closed'];
export const ALWAYS_REQUIRED = ['Store_Number', 'Store_Name', 'Active_Status', 'Record_Owner'];
export const ACTIVE_REQUIRED = [
  'District',
  'Store_Email',
  'Store_Manager_Name',
  'Store_Manager_Email',
  'District_Manager_Name',
  'District_Manager_Email',
];
export const VERIFICATION_FIELDS = ['Last_Verified', 'Verified_By'];
export const EMAIL_FIELDS = ['Store_Email', 'Store_Manager_Email', 'District_Manager_Email'];
export const EXTERNAL_ID_FIELDS = ['Toast_Location_ID', 'SevenShifts_Location_ID'];
export const DATE_FIELDS = ['Effective_Start', 'Effective_End', 'Last_Verified'];
export const USER_FIELDS = FIELDS.filter((field) => field.type === 'USER_SELECT').map((field) => field.code);
export const MULTI_VALUE_FIELDS = FIELDS.filter((field) => field.type === 'MULTI_SELECT').map((field) => field.code);
export const TRIMMED_TEXT_FIELDS = [
  'Store_Name',
  'Store_Manager_Name',
  'District_Manager_Name',
  'Toast_Location_ID',
  'SevenShifts_Location_ID',
];
