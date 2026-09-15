/*
 * Editor-side validation for the Store & Org Directory app (docs/SPEC.md 4, 6).
 * Upload manually: App Settings > JavaScript and CSS Customization (PC and mobile).
 * UI checks can be bypassed by imports and the API, so `npm run audit` and
 * `npm run import:validate` remain required. Keep CONFIG in sync with
 * config/directory.config.json (a test enforces this).
 */
(function () {
  'use strict';

  var CONFIG = { storeNumberPattern: '^[0-9]{1,6}$' };

  var ACTIVE_REQUIRED = {
    District: 'District',
    Store_Email: 'Store Email',
    Store_Manager_Name: 'Store Manager Name',
    Store_Manager_Email: 'Store Manager Email',
    District_Manager_Name: 'District Manager Name',
    District_Manager_Email: 'District Manager Email'
  };
  var EMAIL_FIELDS = ['Store_Email', 'Store_Manager_Email', 'District_Manager_Email'];
  var TRIM_FIELDS = ['Store_Number', 'Store_Name', 'District', 'Store_Manager_Name', 'District_Manager_Name',
    'Toast_Location_ID', 'SevenShifts_Location_ID', 'Store_Email', 'Store_Manager_Email', 'District_Manager_Email'];
  var EMAIL_PATTERN = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

  function isBlank(value) {
    return value === null || value === undefined || String(value).trim() === '';
  }

  // Trims identifiers in place, then returns { fieldCode: message } for problems.
  function validate(record) {
    var errors = {};
    TRIM_FIELDS.forEach(function (code) {
      if (record[code] && typeof record[code].value === 'string') {
        var trimmed = record[code].value.trim();
        record[code].value = code === 'District' ? trimmed.replace(/\s+/g, ' ') : trimmed;
      }
    });

    var storeNumber = record.Store_Number ? record.Store_Number.value : '';
    if (!isBlank(storeNumber) && !new RegExp(CONFIG.storeNumberPattern).test(storeNumber)) {
      errors.Store_Number = 'Store Number must be digits only (for example 11101).';
    }

    if (record.Active_Status && record.Active_Status.value === 'Active') {
      Object.keys(ACTIVE_REQUIRED).forEach(function (code) {
        if (isBlank(record[code] && record[code].value)) errors[code] = ACTIVE_REQUIRED[code] + ' is required for Active stores.';
      });
    }

    EMAIL_FIELDS.forEach(function (code) {
      var value = record[code] && record[code].value;
      if (!isBlank(value) && !EMAIL_PATTERN.test(value)) errors[code] = 'Enter a valid email address. Never guess an address from a name.';
    });

    var start = record.Effective_Start && record.Effective_Start.value;
    var end = record.Effective_End && record.Effective_End.value;
    if (start && end && end < start) errors.Effective_End = 'Effective End cannot be before Effective Start.';
    return errors;
  }

  // Returns the existing spelling when `district` differs from it only by case.
  function findSpellingConflict(district, otherDistricts) {
    if (isBlank(district)) return null;
    var key = district.toLowerCase();
    for (var i = 0; i < otherDistricts.length; i += 1) {
      var other = otherDistricts[i];
      if (other && other !== district && other.toLowerCase() === key) return other;
    }
    return null;
  }

  function fetchOtherDistricts(recordId) {
    var districts = [];
    function page(offset) {
      var query = 'District != ""' + (recordId ? ' and $id != ' + recordId : '') + ' order by $id asc limit 500 offset ' + offset;
      return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: kintone.app.getId(), query: query, fields: ['District'] })
        .then(function (response) {
          response.records.forEach(function (r) { districts.push(r.District.value); });
          return response.records.length === 500 && offset < 9500 ? page(offset + 500) : districts;
        });
    }
    return page(0);
  }

  function onSubmit(event) {
    var record = event.record;
    var errors = validate(record);
    var recordId = record.$id && record.$id.value;
    return fetchOtherDistricts(recordId).then(function (others) {
      var existing = findSpellingConflict(record.District && record.District.value, others);
      if (existing) errors.District = 'This district already exists as "' + existing + '". Type it exactly the same way.';
      var codes = Object.keys(errors);
      if (codes.length) {
        codes.forEach(function (code) { if (record[code]) record[code].error = errors[code]; });
        event.error = 'Fix the highlighted fields before saving.';
      }
      return event;
    });
  }

  if (typeof kintone !== 'undefined' && kintone.events) {
    kintone.events.on(['app.record.create.submit', 'app.record.edit.submit', 'app.record.index.edit.submit',
      'mobile.app.record.create.submit', 'mobile.app.record.edit.submit'], onSubmit);
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { CONFIG: CONFIG, validate: validate, findSpellingConflict: findSpellingConflict, onSubmit: onSubmit };
  }
})();
