# Operator Runbook

Named owners (fill in before production):

| Responsibility | Owner |
|---|---|
| Directory owner (schema, access, data-quality policy) | _TBD_ |
| Kintone app administrator | _TBD_ |
| Automation code in this repo | _TBD_ |
| API tokens and secret rotation | _TBD_ |
| Second reviewer for material changes | _TBD_ |

## Routine checks

Run `npm run audit` daily or weekly (it only reads from Kintone). It prints a summary and writes to `reports/`:

- `audit-<time>.json`: full report, including changes since the previous audit.
- `audit-<time>-issues.csv`: one row per issue.
- `complete-directory-<time>.csv`: Active stores whose contact data is complete and valid. This is the list that is safe to share.

| Exit code | Meaning | Response |
|---|---|---|
| 2 | Critical: duplicate Store Number or external ID | Same day. See [Duplicates](#duplicate-store-number-or-external-id) |
| 1 | Errors: missing/invalid required data, bad dates, district spelling conflicts, shared store mailbox | Fix within the review cycle |
| 0 | Clean, or warnings only (untidy spacing, one phone under two names) | Review warnings weekly |
| 3 | The audit could not run (credentials, network, Kintone outage) | Check `.env` and Kintone status; re-run |

The audit is the only complete exception list; the Kintone views show the directory itself, not its gaps.

## Fixing a record

1. Open the record by exact Store Number.
2. Compare it with the approved organizational roster and the Toast/7shifts source.
3. Correct the data. Note what changed in **Routing Notes** when it needs explaining; Kintone's record history keeps who changed what.
4. For identity, status, district, email, manager, or external-ID changes, have a second authorized person check the change.
5. Re-run `npm run audit` and confirm the exception is gone.
6. After significant bulk changes, run `npm run backup`.

## Duplicate Store Number or external ID

Kintone blocks duplicate Store Numbers and populated Toast/7shifts IDs on save, so a duplicate means data got in some other way, for example after a uniqueness rule was relaxed.

1. Stop any consumer that depends on the affected stores; lookups already return `DUPLICATE_STORE` for them.
2. Identify which record is correct from the roster or external system.
3. Correct or retire the wrong record (set it to Inactive/Closed and say why in Routing Notes; do not reuse its Store Number).
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
2. Fill a copy of `templates/store_directory_import_template.csv`. Concept holds one value per line inside the cell. Phones use `480-555-0123`.
3. `npm run import:validate -- stores.csv` and fix everything reported as critical or error.
4. Import in Kintone: App > ... > Import from File. Map columns by field code and choose **Store Number** as the key for updates.
5. `npm run import:validate -- stores.csv --reconcile` must report that every row matches Kintone exactly.
6. A second person checks the imported records against the approved source.
7. `npm run audit`, then `npm run backup`.

## Lookup reason codes (for consumers)

| Code | Meaning | Operator action |
|---|---|---|
| `DIRECTORY_OK` | One complete, verified, active, effective record | None |
| `INVALID_STORE_NUMBER` | Input blank or not digits | Fix the calling data |
| `STORE_NOT_FOUND` | No exact match | Confirm the store exists; add it through the import procedure |
| `DUPLICATE_STORE` | More than one match | Follow [Duplicates](#duplicate-store-number-or-external-id) |
| `STORE_NOT_ACTIVE` | Status not Active or outside effective dates | Confirm status/dates with the record owner |
| `DIRECTORY_INCOMPLETE` | Required contact data missing or invalid; `issues` lists the fields | Fix the record |
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

Other departments read `Angies Store Directory.xlsx` in SharePoint, rebuilt from Kintone every morning. Only the contact fields are exported; verification state and gaps stay in the audit. The file is replaced in place, so its link and permissions stay put, and edits made in the file are overwritten the next morning.

### One-time setup

1. **Graph permission (needs a Microsoft admin).** Use the app registration that already sends mail, or a new one. Add the *application* permission **Sites.Selected** and grant admin consent. Do not use Sites.ReadWrite.All: Sites.Selected limits the app to the one site below.
2. **Grant the app write access to that site.** An admin with `Sites.FullControl.All` runs, in Graph Explorer:
   - `GET https://graph.microsoft.com/v1.0/sites/<host>:/sites/<SiteName>` to get the site id
   - `POST https://graph.microsoft.com/v1.0/sites/<site id>/permissions` with body
     `{"roles":["write"],"grantedToIdentities":[{"application":{"id":"<client id>","displayName":"Angies Store Directory"}}]}`
3. **Create the Modal secret** with the Kintone values (a View-records-only token is enough) and the Microsoft ones:
   `modal secret create angies-store-directory KINTONE_BASE_URL=... KINTONE_APP_ID=... KINTONE_API_TOKEN=... GRAPH_TENANT_ID=... GRAPH_CLIENT_ID=... GRAPH_CLIENT_SECRET=... SHAREPOINT_HOST=... SHAREPOINT_SITE_PATH=... SHAREPOINT_FOLDER=...`
4. **Deploy:** `modal deploy modal_app.py`, then `modal run modal_app.py::daily_export` for a first run.
5. **Check the schedule.** Deploying registers the daily run at 13:45 UTC (6:45 AM Arizona, which has no DST). Change the `modal.Cron` line in `modal_app.py` and redeploy to move it.
6. **Share the file** with the departments that need it (read-only), and point them at the file, not the folder.

### External ID sync

The morning run calls `npm run sync:ids -- --apply` before building the file. It reads the shared `stores` table (the nightly Toast + 7shifts sync), matches on exact store number, and:

- **fills** a blank Toast or 7shifts ID in Kintone, logging each one;
- **reports and leaves alone** an ID that disagrees with the database. Usually the store was re-pointed at a different Toast location: check which is right, fix the wrong side by hand;
- **reports** `NOT IN DIRECTORY` (active in the database, absent from Kintone: add the store) and `NOT IN DATABASE` (Active in Kintone, absent from the database: usually a store number typo, or a location not yet in Toast/7shifts);
- **skips** database rows marked `excluded`, and counts pre-opening rows that have no store number yet.

Any of those reports makes the Modal run go red, but only after the file has been published. Run `npm run sync:ids` locally (no `--apply`) to see the same report without changing anything.

### Checking and fixing it

- Test any time without touching SharePoint: `npm run export` writes to `exports/` only.
- The Modal run log prints the store count, how many rows are complete, and the uploaded file URL.
- `accessDenied` from Graph means step 2 was not done for this site, or the permission was granted to a different app registration.
- "refusing to publish an empty file" means Kintone returned no active stores. Check Kintone, then re-run; the previous file is untouched.
- Wrong or missing data in the file is a directory problem, not an export problem: fix the record in Kintone and the next run picks it up.

## Tokens

- Rotate the setup token after initial build and whenever it may have been exposed. Generate a new one in App Settings > API Token, update `.env`/the secret store, then delete the old token.
- Give consumers a separate **View records** token. Never put tokens in code, Kintone records, docs, tickets, or logs.
