# Acceptance Evidence (AC-01 to AC-10)

Environment: development app (ID in `.env`), built and checked on 2026-09-15. "Live check" means a scripted run against the dev app using throwaway stores 90001-90005 with `example.com` emails; every record it created was deleted afterwards.

| ID | Status | Evidence |
|---|---|---|
| AC-01 App matches spec | **Pass**, except permissions (see AC-06) | `npm run schema:apply` ended with "Verified: the live app matches the spec"; the next `schema:plan` reported no changes. `tests/schema.test.js` checks every field code, type, option, uniqueness rule, group, row, and view. Owner-approved deviations are listed in the README |
| AC-02 Store Number required and unique | **Pass** | Field is required + "prohibit duplicate values". Live check: a second record with Store Number 90001 was rejected (`CB_VA01: This value already exists in another record`) |
| AC-03 Incomplete Active records not approved for use | **Pass in code**; form blocking needs operator step | Live check: lookup returned `DIRECTORY_INCOMPLETE` for 90002 (unverified) and 90004 (missing Store Email and District Manager Email); the audit left both out of the approved export. **Operator:** upload the form script and run the test in RUNBOOK "Form validation script" |
| AC-04 Desktop form positioning | **Pass**; visual check recommended | Layout deployed and verified; row order asserted in `tests/schema.test.js`. **Operator:** open a record and confirm the groups look right |
| AC-05 Saved views | **Pass, with exceptions covered by the audit** (owner retired the per-gap exception views on 2026-09-15; see README) | Live check filter results: Active Directory → 90001, 90002, 90004, 90005; Needs Verification → 90002; Inactive and Closed → 90003; External ID Mapping → all five. Per-gap exception views were also confirmed working (Missing Store Email → 90004) before they were retired. Exceptions: `npm run audit` |
| AC-06 Permissions | **Not applied** (owner decision) | Role model and field-level verification rights built and tested (`buildPermissions`, `planPermissions`). **Operator:** supply user/group codes in `config/permissions.json`, set `"apply": true`, run `schema:plan`, then `schema:apply`. The dev app currently lets everyone view/add/edit/delete |
| AC-07 Initial records backed up, imported, reconciled, verified | **Pending data** | Tooling ready and exercised: `npm run backup` (settings + records), `npm run import:validate` (a sample file with 12 planted problems was fully reported, exit 2), `--reconcile`. **Operator:** follow RUNBOOK "Importing records" with approved data |
| AC-08 Audit detects data problems | **Pass** | `tests/audit.test.js` and `tests/rules.test.js` cover missing keys, duplicate Store Numbers/external IDs/store emails, incomplete records, invalid emails, bad dates, stale and missing verification, district spelling conflicts. Live check: audit found `DISTRICT_SPELLING_CONFLICT`, `ACTIVE_FIELD_MISSING` ×2, `VERIFICATION_MISSING` ×2 on the planted records |
| AC-09 Lookup returns correct record and typed errors | **Pass** | Live check: 90001 → `DIRECTORY_OK` (also with surrounding spaces), 90002/90004 → `DIRECTORY_INCOMPLETE`, 90003 (Closed) and 90005 (Effective End yesterday) → `STORE_NOT_ACTIVE`, 99999 → `STORE_NOT_FOUND`, `abc` → `INVALID_STORE_NUMBER`, invalid token → `KINTONE_UNAVAILABLE`. `DUPLICATE_STORE` is unit-tested only because Kintone's uniqueness rule prevents creating one live |
| AC-10 Handoff material | **Pass**, except named owners | Schema export in `backups/<time>-post-setup/` (local, gitignored) and `src/schema/definition.js`; import template; 51 passing tests (`npm test`); configuration and secret inventory in README; runbook with backup/restore. **Operator:** fill in the owners table in RUNBOOK |

Other confirmations from the live check:

- Toast and 7shifts IDs are unique when filled in, and several stores can leave them blank.
- Kintone view filters cannot mix AND/OR (`GAIA_IQ02`), and formulas cannot reference Link or User selection fields (`GAIA_IL01`). This is why the exception views are split.

Still to confirm in the Kintone UI: record change history is enabled for the app (App Settings > Advanced).
