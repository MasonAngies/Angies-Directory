// Directory data-quality rules shared by the audit, the import validator, and
// the lookup contract (docs/SPEC.md section 6).

import {
  ACTIVE_REQUIRED,
  ALWAYS_REQUIRED,
  EMAIL_FIELDS,
  EXTERNAL_ID_FIELDS,
  FIELD_CODES,
  FIELD_LABELS,
  MULTI_VALUE_FIELDS,
  PHONE_FIELDS,
  STATUS_VALUES,
  TRIMMED_TEXT_FIELDS,
  USER_FIELDS,
} from './fields.js';

const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim() === '';
}

export function normalizeSpacing(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}

// Districts are free text with strict matching: "Central" and "central " are
// the same district typed two ways, which the audit reports as a conflict.
export function districtKey(value) {
  return normalizeSpacing(value).toLowerCase();
}

export function isCanonicalStoreNumber(value, pattern) {
  return typeof value === 'string' && value !== '' && value === value.trim() && pattern.test(value);
}

export function isValidEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function isValidPhone(value) {
  return typeof value === 'string' && /^\d{3}-\d{3}-\d{4}$/.test(value);
}

export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// Converts a Kintone REST record into plain values: strings for most fields,
// arrays of user codes for user-selection fields.
export function fromKintoneRecord(record) {
  const plain = {};
  for (const code of FIELD_CODES) {
    const value = record[code]?.value;
    if (USER_FIELDS.includes(code)) plain[code] = (value ?? []).map((user) => user.code);
    else if (MULTI_VALUE_FIELDS.includes(code)) plain[code] = value ?? [];
    else plain[code] = value ?? '';
  }
  plain.$id = record.$id?.value ?? '';
  plain.$revision = record.$revision?.value ?? '';
  plain.Updated_datetime = record.Updated_datetime?.value ?? '';
  plain.Updated_by = record.Updated_by?.value?.code ?? '';
  return plain;
}

// Issues with blocksApproval=true keep an Active record from being handed to
// a consumer. Warnings that do not block are review items only.
export function validateRecord(record, { config }) {
  const issues = [];
  const add = (code, severity, field, message, blocksApproval = severity !== 'warning') =>
    issues.push({ code, severity, field, message, blocksApproval });
  const label = (field) => FIELD_LABELS[field] ?? field;

  const storeNumber = record.Store_Number ?? '';
  if (isBlank(storeNumber)) add('STORE_NUMBER_MISSING', 'critical', 'Store_Number', 'Store Number is blank.');
  else if (!isCanonicalStoreNumber(storeNumber, config.storeNumberPattern)) {
    add(
      'STORE_NUMBER_NOT_CANONICAL',
      'error',
      'Store_Number',
      `Store Number must match ${config.storeNumberPattern.source} with no surrounding spaces.`,
    );
  }

  for (const field of ALWAYS_REQUIRED) {
    if (field !== 'Store_Number' && isBlank(record[field])) add('REQUIRED_FIELD_MISSING', 'error', field, `${label(field)} is required.`);
  }

  const status = record.Active_Status;
  const options = { Active_Status: STATUS_VALUES, Concept: config.concepts };
  for (const [field, allowed] of Object.entries(options)) {
    const values = Array.isArray(record[field]) ? record[field] : isBlank(record[field]) ? [] : [record[field]];
    for (const value of values) {
      if (!allowed.includes(value)) add('INVALID_OPTION', 'error', field, `${label(field)} "${value}" is not an approved value.`);
    }
  }

  const district = record.District ?? '';
  if (!isBlank(district) && district !== normalizeSpacing(district)) {
    add('DISTRICT_NOT_CANONICAL', 'error', 'District', 'District must not have leading, trailing, or repeated spaces.');
  }

  const active = status === 'Active';
  if (active) {
    for (const field of ACTIVE_REQUIRED) {
      if (isBlank(record[field])) add('ACTIVE_FIELD_MISSING', 'error', field, `${label(field)} is required for Active stores.`);
    }
  }

  for (const field of EMAIL_FIELDS) {
    if (!isBlank(record[field]) && !isValidEmail(record[field])) {
      add('INVALID_EMAIL', 'error', field, `${label(field)} is not a valid email address.`);
    }
  }

  for (const field of PHONE_FIELDS) {
    if (!isBlank(record[field]) && !isValidPhone(record[field])) add('INVALID_PHONE', 'error', field, `${label(field)} must look like 480-555-0123.`);
  }
  if (!isBlank(record.State) && !/^[A-Z]{2}$/.test(record.State)) {
    add('INVALID_STATE', 'error', 'State', 'State must be a two-letter code such as AZ.');
  }

  for (const field of TRIMMED_TEXT_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() !== '' && value !== value.trim()) {
      add('UNTRIMMED_VALUE', 'warning', field, `${label(field)} has leading or trailing spaces.`);
    }
  }

  return issues;
}

export function blocksApproval(issues) {
  return issues.some((issue) => issue.blocksApproval);
}

// Cross-record checks. Each issue lists the indexes of the records involved.
export function findCrossRecordIssues(records) {
  const issues = [];
  const duplicates = (keyOf) => {
    const byKey = new Map();
    records.forEach((record, index) => {
      const key = keyOf(record);
      if (!key) return;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(index);
    });
    return [...byKey].filter(([, indexes]) => indexes.length > 1);
  };

  // Case-insensitive so "a12" and "A12" are caught even if Kintone allows both.
  for (const [value, indexes] of duplicates((record) => record.Store_Number?.trim().toUpperCase())) {
    issues.push({
      code: 'DUPLICATE_STORE_NUMBER',
      severity: 'critical',
      field: 'Store_Number',
      value,
      recordIndexes: indexes,
      message: `Store Number ${value} is used by ${indexes.length} records.`,
    });
  }

  for (const field of EXTERNAL_ID_FIELDS) {
    for (const [value, indexes] of duplicates((record) => record[field]?.trim())) {
      issues.push({
        code: 'DUPLICATE_EXTERNAL_ID',
        severity: 'critical',
        field,
        value,
        recordIndexes: indexes,
        message: `${FIELD_LABELS[field]} ${value} is used by ${indexes.length} records.`,
      });
    }
  }

  for (const [value, indexes] of duplicates((record) => record.Store_Email?.trim().toLowerCase())) {
    issues.push({
      code: 'DUPLICATE_STORE_EMAIL',
      severity: 'error',
      field: 'Store_Email',
      value,
      recordIndexes: indexes,
      message: `Store Email ${value} is shared by ${indexes.length} stores.`,
    });
  }

  const spellingsByDistrict = new Map();
  records.forEach((record, index) => {
    if (isBlank(record.District)) return;
    const key = districtKey(record.District);
    if (!spellingsByDistrict.has(key)) spellingsByDistrict.set(key, new Map());
    const spellings = spellingsByDistrict.get(key);
    spellings.set(record.District, [...(spellings.get(record.District) ?? []), index]);
  });
  for (const spellings of spellingsByDistrict.values()) {
    if (spellings.size > 1) {
      const variants = [...spellings.keys()];
      issues.push({
        code: 'DISTRICT_SPELLING_CONFLICT',
        severity: 'error',
        field: 'District',
        value: variants.join(' | '),
        recordIndexes: [...spellings.values()].flat(),
        message: `District is typed ${variants.length} different ways: ${variants.map((v) => `"${v}"`).join(', ')}.`,
      });
    }
  }

  // The same manager email should always carry the same name, and vice versa.
  const namesByEmail = new Map();
  const emailsByName = new Map();
  records.forEach((record, index) => {
    for (const [nameField, emailField] of [
      ['Store_Manager_Name', 'Store_Manager_Email'],
      ['District_Manager_Name', 'District_Manager_Email'],
    ]) {
      const name = record[nameField]?.trim();
      const email = record[emailField]?.trim().toLowerCase();
      if (!name || !email) continue;
      const nameKey = name.toLowerCase();
      if (!namesByEmail.has(email)) namesByEmail.set(email, new Map());
      namesByEmail.get(email).set(nameKey, [...(namesByEmail.get(email).get(nameKey) ?? []), index]);
      if (!emailsByName.has(nameKey)) emailsByName.set(nameKey, new Map());
      emailsByName.get(nameKey).set(email, [...(emailsByName.get(nameKey).get(email) ?? []), index]);
    }
  });
  for (const [email, names] of namesByEmail) {
    if (names.size > 1) {
      issues.push({
        code: 'MANAGER_EMAIL_NAME_CONFLICT',
        severity: 'warning',
        field: 'Manager email',
        value: email,
        recordIndexes: [...new Set([...names.values()].flat())],
        message: `Manager email ${email} is recorded under ${names.size} different names.`,
      });
    }
  }
  // One phone number recorded for two different people is usually a copy-paste slip.
  const namesByPhone = new Map();
  records.forEach((record, index) => {
    for (const [nameField, phoneField] of [
      ['Store_Manager_Name', 'Store_Manager_Phone'],
      ['District_Manager_Name', 'District_Manager_Phone'],
      ['Director_Name', 'Director_Phone'],
    ]) {
      const name = record[nameField]?.trim().toLowerCase();
      const phone = record[phoneField]?.trim();
      if (!name || !phone) continue;
      if (!namesByPhone.has(phone)) namesByPhone.set(phone, new Map());
      namesByPhone.get(phone).set(name, [...(namesByPhone.get(phone).get(name) ?? []), index]);
    }
  });
  for (const [phone, names] of namesByPhone) {
    if (names.size > 1) {
      issues.push({
        code: 'PHONE_NAME_CONFLICT',
        severity: 'warning',
        field: 'Phone',
        value: phone,
        recordIndexes: [...new Set([...names.values()].flat())],
        message: `Phone ${phone} is recorded for ${names.size} different people.`,
      });
    }
  }

  for (const [name, emails] of emailsByName) {
    if (emails.size > 1) {
      issues.push({
        code: 'MANAGER_NAME_EMAIL_CONFLICT',
        severity: 'warning',
        field: 'Manager name',
        value: name,
        recordIndexes: [...new Set([...emails.values()].flat())],
        message: `Manager name "${name}" is recorded with ${emails.size} different emails.`,
      });
    }
  }

  return issues;
}
