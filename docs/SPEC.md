# Kintone Store & Org Directory

## Claude-ready build specification

**Version:** 2.0  
**Scope:** Directory only  
**System of record:** Kintone

## 1. Purpose and boundaries

Build a maintainable Kintone directory that maps each restaurant to its district, leaders, operational email address, and external-system identifiers. The directory is shared reference data for future tools, but this project does **not** build or modify any downstream automation.

### In scope

- Create the Kintone app, fields, field codes, options, validation, permissions, form layout, and saved views defined here.
- Seed or import directory records after the owner supplies approved data.
- Provide a small read-only directory client or lookup contract only if an existing repository is supplied for it.
- Provide data-quality checks, change governance, monitoring for directory health, tests, deployment notes, and an operator runbook.

### Explicitly out of scope

- Invoice collection, generation, grouping, emailing, or Microsoft Graph integration.
- Prep sheets, daily performance snapshots, alerts, or other store communications.
- Scheduling, attachments, email templates, recipient policies for a specific workflow, send logs, or message idempotency.
- Microsoft 365 hierarchy discovery, HR master-data replacement, or an org-chart visualization.
- Migration of existing automation recipient lists.

Future tools may read this directory, but each future integration requires its own separately approved scope, recipient policy, safeguards, and acceptance criteria.

## 2. Operating model

Kintone is the authoritative source for store-to-organization relationships. Maintain one record per store. `Store_Number` is the canonical key and must never be reused for a different location.

The directory owns facts: store identity, status, district, operational mailbox, managers, external IDs, ownership, and verification metadata. It does not own business-workflow logic. Consumers must use exact identifiers, perform read-only lookups, and treat missing or ambiguous records as errors rather than guessing.

### Ownership

- **Directory owner:** accountable for schema, access, and data-quality policy.
- **Record owner:** accountable for the accuracy of assigned store records.
- **Editor:** may propose and enter approved changes.
- **Verifier:** independently checks routing-sensitive data and records verification.
- **Runtime reader:** read-only API identity, if a lookup client is implemented.

## 3. Exact Kintone schema

Field codes are an API contract. Labels may be adjusted for readability only if the field codes remain exactly as specified.

### Core identity and organization fields

| Form label | Exact field code | Kintone field type | Rules and configuration |
|---|---|---|---|
| Store Number | `Store_Number` | Single-line text | Required; prohibit duplicate values; trim whitespace; canonical store key. |
| Store Name | `Store_Name` | Single-line text | Required; operational name used in Toast and 7shifts. |
| Active Status | `Active_Status` | Drop-down | Required; values: `Active`, `Inactive`, `Opening`, `Closed`; default `Active`. |
| Concept | `Concept` | Drop-down | Optional; configure approved concept values before import. |
| District | `District` | Drop-down | Required for Active stores; configure approved district values such as Central, West, and North. |
| Store Email | `Store_Email` | Link, email format | Required for Active stores; primary operational mailbox. |
| Store Manager Name | `Store_Manager_Name` | Single-line text | Required for Active stores. |
| Store Manager Email | `Store_Manager_Email` | Link, email format | Required for Active stores. |
| District Manager Name | `District_Manager_Name` | Single-line text | Required for Active stores. |
| District Manager Email | `District_Manager_Email` | Link, email format | Required for Active stores. |
| Routing Notes | `Routing_Notes` | Multi-line text | Optional human context only; consumers must not parse this field. |

### External identifiers and governance fields

| Form label | Exact field code | Kintone field type | Rules and configuration |
|---|---|---|---|
| Toast Location ID | `Toast_Location_ID` | Single-line text | Optional initially; unique when populated. |
| 7shifts Location ID | `SevenShifts_Location_ID` | Single-line text | Optional initially; unique when populated. |
| Effective Start | `Effective_Start` | Date | Optional; beginning of the record's valid period. |
| Effective End | `Effective_End` | Date | Optional; end of the record's valid period. |
| Last Verified | `Last_Verified` | Date | Required before an Active record is approved for use. |
| Verified By | `Verified_By` | User selection | Required before an Active record is approved for use. |
| Record Owner | `Record_Owner` | User selection | Required; accountable maintainer. |
| Change Reason | `Change_Reason` | Multi-line text | Required by process whenever identity, status, district, contact, or external-ID data changes. |

Kintone-managed fields such as record number, creator, created time, modifier, updated time, record ID, and revision remain available for auditing and must not be recreated as custom fields.

## 4. Exact desktop form positioning

Create the following collapsible groups and rows in this exact top-to-bottom order. Fields listed on the same row are placed left to right. Mobile layouts may stack naturally while preserving order.

| Row | Group | Left column | Middle column | Right column |
|---:|---|---|---|---|
| 1 | Identity | Store Number | Store Name | Active Status |
| 2 | Identity | Concept | District | Record Owner |
| 3 | Store Contacts | Store Email | Store Manager Name | Store Manager Email |
| 4 | District Leadership | District Manager Name | District Manager Email | - |
| 5 | External Systems | Toast Location ID | 7shifts Location ID | - |
| 6 | Governance | Effective Start | Effective End | Last Verified |
| 7 | Governance | Verified By | Change Reason, spanning two columns | - |
| 8 | Notes | Routing Notes, full width | - | - |
| 9 | System Audit | Created time and Creator | Updated time and Modifier | Record number |

### Group behavior and field guidance

- Identity, Store Contacts, and District Leadership are expanded by default.
- External Systems, Governance, Notes, and System Audit may be collapsed by default.
- Help text for Store Number: **Canonical key used by connected systems. Do not reuse or renumber.**
- Help text for Store Email: **Primary operational store mailbox; required when status is Active.**
- Trim names and identifiers. Compare email addresses case-insensitively. Never infer an email address from a person's name.
- If Kintone JavaScript customization is supported, add an editor-side validation hook for Active records. Server-side import validation and data-quality reporting are still required because UI checks can be bypassed.

## 5. Saved views

| View name | Filter and sort | Visible columns |
|---|---|---|
| Active Directory | `Active_Status = Active`; sort District then Store Number ascending | Store Number, Store Name, District, Store Email, manager names and emails, Last Verified |
| Needs Verification | Active and Last Verified blank or older than 90 days | Store Number, Store Name, District, Last Verified, Verified By, Record Owner |
| Directory Exceptions | Active and any required field blank | Store Number, Store Name, District, missing-data indicator, Record Owner, Updated time |
| Inactive and Closed | Status is Inactive or Closed | Store Number, Store Name, District, Active Status, Effective End |
| External ID Mapping | All records; sort Store Number ascending | Store Number, Store Name, Toast Location ID, 7shifts Location ID |

If a computed missing-data indicator is not practical in Kintone, create separate exception views for missing store email, manager information, district, ownership, and verification.

## 6. Validation and fail-closed data safeguards

The directory must never silently accept uncertain identity or ownership data.

| Validation | Pass condition | Failure behavior |
|---|---|---|
| Store key | Store Number is present, canonical, and unique | Block save/import or flag the record as an exception. |
| Active record completeness | All required Active-store fields are present | Block approval for use and show the missing fields. |
| Email syntax | Store and manager emails have valid email structure | Block approval; never manufacture or substitute an address. |
| Effective dates | End date is not before start date | Block save/import. |
| External ID uniqueness | Each populated external ID maps to one store | Block import or flag duplicates for resolution. |
| Verification | Last Verified and Verified By are present for Active records | Keep record in Needs Verification and out of approved exports. |
| Lookup result | A consumer finds exactly one active/effective record | Return a typed error; never fuzzy-match or fall back to another store. |

Use a two-person verification process for initial production records and material changes to store identity, status, district, email, manager, or external IDs. Enable Kintone record change history. Export a backup CSV before initial import, bulk updates, or schema changes.

## 7. Permissions and security

- Directory administrators may manage schema, views, permissions, and all records.
- Approved editors may create and edit records but may not alter the app schema or permissions.
- Operational readers have read-only access.
- Any runtime API token has record-read permission only and requests only the fields it needs.
- Restrict sensitive governance fields if broader directory visibility is required.
- Keep API tokens in the existing secret manager or deployment environment, never in source code, Kintone records, documentation, or logs.
- Separate development, staging, and production apps and credentials.
- Do not make destructive schema changes in production. Export app settings and data before approved migrations.

## 8. Optional read-only lookup contract

Implement this only when a repository for shared infrastructure is in scope. It is a directory lookup, not a workflow router.

```text
getStoreDirectoryRecord({ storeNumber, asOfDate })
  -> { ok, reasonCode, record }

record = {
  storeNumber, storeName, activeStatus, concept, district,
  storeEmail, storeManagerName, storeManagerEmail,
  districtManagerName, districtManagerEmail,
  toastLocationId, sevenShiftsLocationId,
  recordId, recordRevision, lastVerified
}
```

Required reason codes:

| Reason code | Meaning |
|---|---|
| `DIRECTORY_OK` | Exactly one valid active/effective record was returned. |
| `INVALID_STORE_NUMBER` | Input is blank or malformed. |
| `STORE_NOT_FOUND` | No exact Store Number match exists. |
| `DUPLICATE_STORE` | More than one matching record exists. |
| `STORE_NOT_ACTIVE` | Record is not Active or is outside effective dates. |
| `DIRECTORY_INCOMPLETE` | Required directory data is missing or invalid. |
| `KINTONE_UNAVAILABLE` | Kintone lookup failed after bounded retries. |

Queries must use exact matching and safe escaping. Set connection and request timeouts. Retry only transient throttling, network, and server failures with bounded exponential backoff and jitter. Do not cache validation failures or fall back to stale or hard-coded records. Log safe metadata such as reason code, store number, record ID/revision, latency, and correlation ID; never log tokens.

## 9. Directory health monitoring and runbook

At minimum, provide a scheduled or operator-runnable directory audit that performs no downstream actions.

Report:

- Active record count and counts by district.
- Missing or duplicate Store Numbers.
- Missing required fields on Active records.
- Invalid or duplicate email addresses.
- Duplicate populated external IDs.
- Invalid effective-date ranges.
- Records never verified or not verified within 90 days.
- Records changed since the last audit, including record owner and verification state.

The audit output may be a Kintone view, CSV report, structured log, or existing monitoring dashboard. It must identify the record and issue without exposing credentials. A critical alert is appropriate for duplicate Store Numbers or external IDs; ordinary completeness and verification issues may appear in a daily or weekly review.

### Operator runbook

1. Open the affected record by exact Store Number.
2. Compare it with the approved organizational roster and external-system source.
3. Correct the data and enter a Change Reason.
4. Have a second authorized person verify material identity/contact changes.
5. Update Last Verified and Verified By.
6. Re-run the directory audit and confirm the exception is cleared.
7. Export a fresh backup after significant approved bulk changes.

## 10. Acceptance criteria

| ID | Release criterion |
|---|---|
| AC-01 | The app exists with every exact field code, field type, option, uniqueness rule, permission, group, row, and saved view specified here. |
| AC-02 | Store Number is required and duplicate values are prohibited. |
| AC-03 | Active records cannot be approved for use while required identity, district, contact, ownership, or verification fields are missing. |
| AC-04 | The desktop form matches the documented group and row positioning. |
| AC-05 | Saved views surface active records, overdue verification, exceptions, inactive/closed stores, and external-ID mappings. |
| AC-06 | Permissions enforce administrator, editor, reader, and optional runtime-reader boundaries. |
| AC-07 | Initial records are backed up, imported, reconciled to the approved source, and independently verified. |
| AC-08 | The directory audit detects missing keys, duplicates, incomplete records, invalid emails, duplicate external IDs, bad dates, and stale verification. |
| AC-09 | If implemented, exact lookup returns the correct record and typed errors for invalid, absent, duplicate, inactive, incomplete, and unavailable cases. |
| AC-10 | Schema export, sanitized import template, test evidence, configuration notes, ownership, and operator runbook are handed off. |

## 11. Claude Code execution prompt

> Implement only the Kintone Store & Org Directory described in this document. Do not build or modify invoice tools, prep sheets, scheduled email, Microsoft Graph delivery, attachments, or any other downstream automation.
>
> First inspect the supplied repository and Kintone development environment. Summarize the current state and produce a concise implementation plan. Preserve unrelated changes and follow existing project conventions.
>
> Create an idempotent Kintone schema/setup artifact, or exact administrator instructions if schema APIs are unavailable, using every exact field code, type, option, rule, group, row position, view, and permission in this specification. Work in development or staging by default; do not change production without explicit authorization.
>
> Add import validation, a sanitized CSV template, directory health checks, tests, schema backup/export instructions, configuration notes, and the operator runbook. If a shared-code repository is explicitly supplied, implement only the optional read-only `getStoreDirectoryRecord` contract. It must exact-match Store Number, fail closed, return typed reason codes, and never guess or use a hard-coded fallback.
>
> Never expose credentials or perform downstream sends. Do not make destructive schema changes. At completion, run relevant tests, list changed files and remaining manual steps, and map AC-01 through AC-10 to passing evidence or required operator verification.

## 12. Required handoff deliverables

- Kintone app schema/setup artifact or exact admin build instructions.
- Sanitized import CSV template with the exact field codes as headers.
- Directory validation and health-audit implementation or procedure.
- Automated tests where code is present.
- Schema/data backup and restore procedure.
- Configuration and secret-name inventory without secret values.
- Ownership and operator runbook.
- Acceptance evidence mapped to AC-01 through AC-10.

