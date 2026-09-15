// Directory health audit (docs/SPEC.md section 9). Read-only: it never writes
// to Kintone or triggers anything downstream.

import { findCrossRecordIssues, fromKintoneRecord, validateRecord } from '../directory/rules.js';

const SEVERITY_ORDER = { critical: 0, error: 1, warning: 2 };

const countBy = (items, keyOf) => {
  const counts = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
};

export function runAudit(kintoneRecords, { config, today, previousState = null, now = new Date() }) {
  const records = kintoneRecords.map(fromKintoneRecord);
  const ref = (record) => ({ recordId: record.$id, storeNumber: record.Store_Number, storeName: record.Store_Name });

  const issues = [];
  for (const record of records) {
    for (const issue of validateRecord(record, { config })) issues.push({ ...ref(record), ...issue });
  }
  // Duplicate keys, external IDs, or store mailboxes make every record involved
  // untrustworthy. A district spelling conflict must be fixed but does not make
  // each store's contact data wrong, so it does not mark those rows unusable.
  for (const { recordIndexes, ...issue } of findCrossRecordIssues(records)) {
    const blocks = issue.severity === 'critical' || issue.code === 'DUPLICATE_STORE_EMAIL';
    for (const index of recordIndexes) issues.push({ ...ref(records[index]), ...issue, blocksApproval: blocks });
  }
  issues.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      String(a.storeNumber).localeCompare(String(b.storeNumber)) ||
      a.code.localeCompare(b.code),
  );

  const active = records.filter((record) => record.Active_Status === 'Active');
  const blockedIds = new Set(issues.filter((issue) => issue.blocksApproval).map((issue) => issue.recordId));
  const complete = active.filter((record) => !blockedIds.has(record.$id));

  const changes = [];
  if (previousState) {
    const currentIds = new Set(records.map((record) => record.$id));
    for (const record of records) {
      const previous = previousState.records[record.$id];
      if (previous && previous.revision === record.$revision) continue;
      changes.push({
        change: previous ? 'modified' : 'added',
        ...ref(record),
        previousRevision: previous?.revision ?? '',
        revision: record.$revision,
        activeStatus: record.Active_Status,
        updatedAt: record.Updated_datetime,
        updatedBy: record.Updated_by,
      });
    }
    for (const [recordId, previous] of Object.entries(previousState.records)) {
      if (!currentIds.has(recordId)) changes.push({ change: 'removed', recordId, storeNumber: previous.storeNumber, previousRevision: previous.revision });
    }
  }

  const summary = {
    auditedAt: now.toISOString(),
    today,
    previousAuditAt: previousState?.auditedAt ?? null,
    totalRecords: records.length,
    activeRecords: active.length,
    activeComplete: complete.length,
    recordsByStatus: countBy(records, (record) => record.Active_Status || '(blank)'),
    activeByDistrict: countBy(active, (record) => record.District || '(blank)'),
    issuesBySeverity: countBy(issues, (issue) => issue.severity),
    issuesByCode: countBy(issues, (issue) => issue.code),
    changesSinceLastAudit: previousState ? changes.length : null,
  };

  const nextState = {
    auditedAt: summary.auditedAt,
    records: Object.fromEntries(records.map((record) => [record.$id, { revision: record.$revision, storeNumber: record.Store_Number }])),
  };

  return { summary, issues, changes, completeRecordIds: complete.map((record) => record.$id), nextState };
}

// 2 = critical (duplicate keys or external IDs), 1 = errors, 0 = clean or warnings only.
export function exitCodeFor(report) {
  if (report.issues.some((issue) => issue.severity === 'critical')) return 2;
  if (report.issues.some((issue) => issue.severity === 'error')) return 1;
  return 0;
}
