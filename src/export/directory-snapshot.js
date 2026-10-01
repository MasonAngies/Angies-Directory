// Flattens Kintone directory records into rows for the store_directory table
// (sql/store_directory.sql). Blank values become null so SQL sees real gaps.

import { CUSTOM_FIELDS } from '../directory/custom-fields.js';

const text = (field) => {
  const value = field?.value;
  return value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim();
};
const list = (field) => (Array.isArray(field?.value) ? field.value : []);
const integer = (field) => {
  const value = text(field);
  return value === null || !/^-?\d+$/.test(value) ? null : Number(value);
};

export function toSnapshotRow(record) {
  const exception = list(record[CUSTOM_FIELDS.speedExceptions]);
  return {
    store_number: text(record.Store_Number),
    store_name: text(record.Store_Name),
    active_status: text(record.Active_Status),
    store_format: text(record[CUSTOM_FIELDS.storeFormat]),
    order_methods: [...list(record[CUSTOM_FIELDS.orderMethods])].sort(),
    concepts: list(record.Concept),
    district: text(record.District),
    street_address: text(record.Street_Address),
    city: text(record.City),
    state: text(record.State),
    store_email: text(record.Store_Email),
    store_manager_name: text(record.Store_Manager_Name),
    store_manager_email: text(record.Store_Manager_Email),
    store_manager_phone: text(record.Store_Manager_Phone),
    district_manager_name: text(record.District_Manager_Name),
    district_manager_email: text(record.District_Manager_Email),
    district_manager_phone: text(record.District_Manager_Phone),
    director_name: text(record.Director_Name),
    director_email: text(record.Director_Email),
    director_phone: text(record.Director_Phone),
    toast_location_id: text(record.Toast_Location_ID),
    sevenshifts_location_id: integer(record.SevenShifts_Location_ID),
    speed_exceptions_granted: exception.includes('Yes') ? true : exception.includes('No') ? false : null,
    window_goal_breakfast_sec: integer(record[CUSTOM_FIELDS.breakfastWindow]),
    window_goal_lunch_sec: integer(record[CUSTOM_FIELDS.lunchWindow]),
    window_goal_dinner_sec: integer(record[CUSTOM_FIELDS.dinnerWindow]),
    kiosk_goal_breakfast_sec: integer(record[CUSTOM_FIELDS.breakfastKiosk]),
    kiosk_goal_lunch_sec: integer(record[CUSTOM_FIELDS.lunchKiosk]),
    kiosk_goal_dinner_sec: integer(record[CUSTOM_FIELDS.dinnerKiosk]),
    routing_notes: text(record.Routing_Notes),
    kintone_record_id: integer(record.$id),
    kintone_revision: integer(record.$revision),
    kintone_updated_at: text(record.Updated_datetime),
  };
}
