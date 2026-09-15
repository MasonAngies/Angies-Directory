// Read-only directory lookup contract (docs/SPEC.md section 8). It is a
// lookup, not a router: exact Store Number match, fail closed, typed reasons.

import { loadDirectoryConfig, loadEnvConfig } from '../config.js';
import { FIELD_CODES } from '../directory/fields.js';
import { blocksApproval, fromKintoneRecord, isCanonicalStoreNumber, validateRecord } from '../directory/rules.js';
import { createKintoneClient, escapeQueryValue } from '../kintone/client.js';

export const REASON_CODES = Object.freeze({
  DIRECTORY_OK: 'DIRECTORY_OK',
  INVALID_STORE_NUMBER: 'INVALID_STORE_NUMBER',
  STORE_NOT_FOUND: 'STORE_NOT_FOUND',
  DUPLICATE_STORE: 'DUPLICATE_STORE',
  STORE_NOT_ACTIVE: 'STORE_NOT_ACTIVE',
  DIRECTORY_INCOMPLETE: 'DIRECTORY_INCOMPLETE',
  KINTONE_UNAVAILABLE: 'KINTONE_UNAVAILABLE',
});

// Free-text notes are never needed by consumers.
export const LOOKUP_FIELDS = ['$id', '$revision', ...FIELD_CODES.filter((code) => code !== 'Routing_Notes')];

function toContractRecord(plain) {
  return {
    storeNumber: plain.Store_Number,
    storeName: plain.Store_Name,
    activeStatus: plain.Active_Status,
    concept: plain.Concept,
    district: plain.District,
    storeEmail: plain.Store_Email,
    storeManagerName: plain.Store_Manager_Name,
    storeManagerEmail: plain.Store_Manager_Email,
    districtManagerName: plain.District_Manager_Name,
    districtManagerEmail: plain.District_Manager_Email,
    // Added with the owner's roster fields (2026-09-15); additive to the spec contract.
    storeManagerPhone: plain.Store_Manager_Phone,
    districtManagerPhone: plain.District_Manager_Phone,
    directorName: plain.Director_Name,
    directorEmail: plain.Director_Email,
    directorPhone: plain.Director_Phone,
    streetAddress: plain.Street_Address,
    city: plain.City,
    state: plain.State,
    toastLocationId: plain.Toast_Location_ID,
    sevenShiftsLocationId: plain.SevenShifts_Location_ID,
    recordId: plain.$id,
    recordRevision: plain.$revision,
  };
}

function normalizeInput(storeNumber) {
  if (typeof storeNumber === 'string') return storeNumber.trim();
  if (Number.isSafeInteger(storeNumber) && storeNumber >= 0) return String(storeNumber);
  return '';
}

export function createDirectoryLookup({ client, appId, config, logger = () => {} }) {
  return async function getStoreDirectoryRecord({ storeNumber, correlationId } = {}) {
    const started = performance.now();
    const normalized = normalizeInput(storeNumber);

    const finish = (reasonCode, { record = null, plain = null, issues, error } = {}) => {
      logger({
        event: 'directory_lookup',
        reasonCode,
        storeNumber: normalized.slice(0, 32),
        recordId: plain?.$id ?? null,
        recordRevision: plain?.$revision ?? null,
        latencyMs: Math.round(performance.now() - started),
        correlationId: correlationId ?? null,
        ...(error ? { errorStatus: error.status ?? null, errorCode: error.code ?? null } : {}),
      });
      const result = { ok: reasonCode === REASON_CODES.DIRECTORY_OK, reasonCode, record };
      if (issues) result.issues = issues.map(({ code, field }) => ({ code, field }));
      return result;
    };

    if (!isCanonicalStoreNumber(normalized, config.storeNumberPattern)) return finish(REASON_CODES.INVALID_STORE_NUMBER);

    let records;
    try {
      ({ records } = await client.get('records', {
        app: appId,
        query: `Store_Number = ${escapeQueryValue(normalized)} limit 3`,
        fields: LOOKUP_FIELDS,
      }));
    } catch (error) {
      return finish(REASON_CODES.KINTONE_UNAVAILABLE, { error });
    }

    const matches = records.filter((record) => record.Store_Number?.value === normalized);
    if (matches.length === 0) return finish(REASON_CODES.STORE_NOT_FOUND);
    if (matches.length > 1) return finish(REASON_CODES.DUPLICATE_STORE);

    const plain = fromKintoneRecord(matches[0]);
    if (plain.Active_Status !== 'Active') return finish(REASON_CODES.STORE_NOT_ACTIVE, { plain });

    // Kintone already enforces option values, and admins may add options
    // without a config change, so option membership is not re-checked here.
    const issues = validateRecord(plain, { config }).filter((issue) => issue.code !== 'INVALID_OPTION');
    const blockers = issues.filter((issue) => issue.blocksApproval);
    if (blocksApproval(issues)) return finish(REASON_CODES.DIRECTORY_INCOMPLETE, { plain, issues: blockers });

    return finish(REASON_CODES.DIRECTORY_OK, { plain, record: toContractRecord(plain) });
  };
}

let defaultLookup;

// Convenience entry point configured from environment variables.
export function getStoreDirectoryRecord(args) {
  if (!defaultLookup) {
    const env = loadEnvConfig();
    defaultLookup = createDirectoryLookup({
      client: createKintoneClient(env),
      appId: env.appId,
      config: loadDirectoryConfig(),
    });
  }
  return defaultLookup(args);
}
