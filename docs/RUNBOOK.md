# Operator Runbook

Named owners (fill in before production):

| Responsibility | Owner |
|---|---|
| Directory owner (schema, access, data-quality policy) | _TBD_ |
| Kintone app administrator | _TBD_ |
| Automation code in this repo | _TBD_ |
| API tokens and secret rotation | _TBD_ |
| Verifiers (second person for material changes) | _TBD_ |

## Routine checks

Run `npm run audit` daily or weekly (it only reads from Kintone). It prints a summary and writes to `reports/`:

- `audit-<time>.json`: full report, including changes since the previous audit.
- `audit-<time>-issues.csv`: one row per issue.
- `approved-directory-<time>.csv`: Active stores that are complete and verified. This is the only export to share as "approved".

| Exit code | Meaning | Response |
|---|---|---|
| 2 | Critical: duplicate Store Number or external ID | Same day. See [Duplicates](#duplicate-store-number-or-external-id) |
| 1 | Errors: missing/invalid required data, bad dates, district spelling conflicts, shared store mailbox | Fix within the review cycle |
| 0 | Clean, or warnings only (stale verification, untidy spacing) | Review warnings weekly |
| 3 | The audit could not run (credentials, network, Kintone outage) | Check `.env` and Kintone status; re-run |

Inside Kintone, the `Needs Verification` view lists Active stores never verified or verified more than 90 days ago. The audit is the only complete exception list.

## Fixing a record

1. Open the record by exact Store Number.
2. Compare it with the approved organizational roster and the Toast/7shifts source.
3. Correct the data and write a **Change Reason**.
4. For identity, status, district, email, manager, or external-ID changes, have a second authorized person check the change.
5. The verifier updates **Last Verified** and **Verified By**.
6. Re-run `npm run audit` and confirm the exception is gone.
7. After significant bulk changes, run `npm run backup`.

## Duplicate Store Number or external ID

Kintone blocks duplicate Store Numbers and populated Toast/7shifts IDs on save, so a duplicate means data got in some other way, for example after a uniqueness rule was relaxed.

1. Stop any consumer that depends on the affected stores; lookups already return `DUPLICATE_STORE` for them.
2. Identify which record is correct from the roster or external system.
3. Correct or retire the wrong record (set it to Inactive/Closed with a Change Reason; do not reuse its Store Number).
4. Re-run the audit and confirm exit code 0 or 1.

## Adding a district

District is strict-match text, so no schema change is needed:

1. Agree the exact spelling first (for example `North Shore`). Capitalization and spacing matter.
2. Type it on the store record. The form script rejects a spelling that differs from an existing district only by capitalization, and it collapses extra spaces.
3. Run `npm run audit`. `Active by district` lists every district, so a new one is visible, and `DISTRICT_SPELLING_CONFLICT` catches variants that got in through import or the API.

To rename a district, update every store in it in one sitting, then run the audit.

## Adding a concept

Add the value to `concepts` in `config/directory.config.json`, then run `npm run schema:plan` and `npm run schema:apply`. An admin can also add the option directly in Kintone; the audit and import validator read live options, and setup never removes options.

## Importing records

1. `npm run backup` (before any initial or bulk import).
2. Fill a copy of `templates/store_directory_import_template.csv`. Multi-value cells (Concept, Record Owner, Verified By) put one value per line inside the cell. User fields take Kintone login names. Dates are `YYYY-MM-DD`.
3. `npm run import:validate -- stores.csv` and fix everything reported as critical or error. Missing verification is a warning at import time; those stores stay out of approved exports until verified.
4. Import in Kintone: App > ... > Import from File. Map columns by field code and choose **Store Number** as the key for updates.
5. `npm run import:validate -- stores.csv --reconcile` must report that every row matches Kintone exactly.
6. A second person verifies the records against the approved source and sets Last Verified and Verified By.
7. `npm run audit`, then `npm run backup`.

## Lookup reason codes (for consumers)

| Code | Meaning | Operator action |
|---|---|---|
| `DIRECTORY_OK` | One complete, verified, active, effective record | None |
| `INVALID_STORE_NUMBER` | Input blank or not digits | Fix the calling data |
| `STORE_NOT_FOUND` | No exact match | Confirm the store exists; add it through the import procedure |
| `DUPLICATE_STORE` | More than one match | Follow [Duplicates](#duplicate-store-number-or-external-id) |
| `STORE_NOT_ACTIVE` | Status not Active or outside effective dates | Confirm status/dates with the record owner |
| `DIRECTORY_INCOMPLETE` | Required data missing/invalid or not verified; `issues` lists the fields | Fix the record, then verify it |
| `KINTONE_UNAVAILABLE` | Kintone failed after bounded retries (or auth failed) | Check Kintone status and token; retry later. Never substitute a hard-coded list |

## Schema changes

1. Edit `src/schema/definition.js` (and `src/directory/fields.js` for new fields). Never rename field codes.
2. `npm test`, then `npm run schema:plan` and read the plan.
3. `npm run schema:apply`. It refuses to run if someone has undeployed changes in Kintone, saves current settings to `backups/<time>-pre-setup/`, applies changes to preview, deploys, and re-reads the live app to verify. If a step fails, preview changes are discarded and the live app is untouched.

Setup never deletes fields or drop-down options and keeps views and fields it does not own. To retire a view this project created, add its name to `RETIRED_VIEWS`. A field type cannot be changed in place; the plan reports it as a conflict for a manual migration.

## Backup and restore

- **Backup:** `npm run backup` writes `app.json`, settings, fields, layout, views, app/field/record permissions, process management, `records.json`, and an import-ready `records.csv`.
- **Restore schema:** `npm run schema:apply` recreates spec fields, layout, and views. For settings outside the spec, re-enter them in Kintone from the backup JSON files.
- **Restore records:** import `records.csv` from the backup, keyed on Store Number (step 4 of [Importing records](#importing-records)), then reconcile against the same file. Records deleted in Kintone come back with new record numbers and lose their comment/history trail.

## Form validation script (manual install)

The API token cannot upload customization, so an app admin uploads it once and again after every change:

1. App Settings > Customization and Integration > JavaScript and CSS Customization.
2. Upload `customization/directory-form-validation.js` under **both** "JavaScript Files for PC" and "JavaScript Files for Mobile".
3. Save, then Update App.
4. Test: create a record with status Active and a blank Store Email. Save must be blocked with the field highlighted.

It trims identifiers, requires Active-store contact fields, checks email syntax and date order, and rejects district spellings that differ only by capitalization. Imports and API writes bypass it; the audit and import validator catch those.

## Daily SharePoint export

Other departments read `Angies Store Directory.xlsx` in SharePoint, rebuilt from Kintone every morning. Only the contact fields are exported, plus a **Verified** and a **Data Check** column. The file is replaced in place, so its link and permissions stay put, and edits made in the file are overwritten the next morning.

### One-time setup

1. **Graph permission (needs a Microsoft admin).** Use the app registration that already sends mail, or a new one. Add the *application* permission **Sites.Selected** and grant admin consent. Do not use Sites.ReadWrite.All: Sites.Selected limits the app to the one site below.
2. **Grant the app write access to that site.** An admin with `Sites.FullControl.All` runs, in Graph Explorer:
   - `GET https://graph.microsoft.com/v1.0/sites/<host>:/sites/<SiteName>` to get the site id
   - `POST https://graph.microsoft.com/v1.0/sites/<site id>/permissions` with body
     `{"roles":["write"],"grantedToIdentities":[{"application":{"id":"<client id>","displayName":"Angies Store Directory"}}]}`
3. **Create the Modal secret** with the Kintone values (a View-records-only token is enough) and the Microsoft ones:
   `modal secret create angies-store-directory KINTONE_BASE_URL=... KINTONE_APP_ID=... KINTONE_API_TOKEN=... GRAPH_TENANT_ID=... GRAPH_CLIENT_ID=... GRAPH_CLIENT_SECRET=... SHAREPOINT_HOST=... SHAREPOINT_SITE_PATH=... SHAREPOINT_FOLDER=...`
4. **Deploy:** `modal deploy modal_app.py`, then `modal run modal_app.py::daily_export` for a first run.
5. **Trigger it daily.** The workspace allows five scheduled functions and all five are taken, so an existing daily job calls this one, the same way food cost calls DC inventory:
   `modal.Function.from_name("angies-store-directory", "daily_export").remote()`
   If a slot frees up, uncomment the `schedule=` line in `modal_app.py` and drop the caller.
6. **Share the file** with the departments that need it (read-only), and point them at the file, not the folder.

### Checking and fixing it

- Test any time without touching SharePoint: `npm run export` writes to `exports/` only.
- The Modal run log prints the store count, how many rows are complete, and the uploaded file URL.
- `accessDenied` from Graph means step 2 was not done for this site, or the permission was granted to a different app registration.
- "refusing to publish an empty file" means Kintone returned no active stores. Check Kintone, then re-run; the previous file is untouched.
- Wrong or missing data in the file is a directory problem, not an export problem: fix the record in Kintone and the next run picks it up.

## Tokens

- Rotate the setup token after initial build and whenever it may have been exposed. Generate a new one in App Settings > API Token, update `.env`/the secret store, then delete the old token.
- Give consumers a separate **View records** token. Never put tokens in code, Kintone records, docs, tickets, or logs.
