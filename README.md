# Angie's Store & Org Directory (Kintone)

Kintone is the system of record for which restaurant belongs to which district, who manages it, its operational mailbox, and its Toast/7shifts IDs. This repo holds everything around that app: an idempotent schema setup, import validation, a health audit, backups, and a read-only lookup client that future tools can use.

Scope is **directory only** ([docs/SPEC.md](docs/SPEC.md)). Nothing here sends email or touches invoices. The one outside call is the daily export that writes a read-only copy of the directory to SharePoint for departments without Kintone access.

## Quick start

Requires Node.js 22.9+. No npm dependencies.

```bash
cp .env.example .env        # fill in the base URL, app ID, and token (never commit .env)
npm test                    # unit tests, no network
npm run schema:plan         # dry run: what setup would change in the app
```

| Command | What it does | Writes to Kintone? |
|---|---|---|
| `npm run schema:plan` | Compares the app with the spec and prints the differences | No |
| `npm run schema:apply` | Backs up settings, applies additive changes, deploys, re-verifies | Yes (app settings) |
| `npm run audit` | Directory health report; exit 2 = critical, 1 = errors, 0 = clean/warnings | No |
| `npm run import:validate -- file.csv` | Checks a CSV before import (`--offline`, or `--reconcile` after import) | No |
| `npm run backup` | Exports settings and all records to `backups/` (`--settings-only` available) | No |
| `npm run lookup -- 11101` | Runs the lookup contract for one store | No |
| `npm run sync:ids` | Compares Toast / 7shifts IDs with the shared stores table (`--apply` writes the blanks) | Only with `--apply` |
| `npm run export` | Builds the shared Excel file in `exports/` | No |
| `npm run export -- --upload` | Builds it and replaces the SharePoint copy | SharePoint only |

`backups/` and `reports/` contain directory contact data and are gitignored. Keep it that way; this repository is public.

## Decisions that differ from the written spec

| Topic | Spec | Built | Why |
|---|---|---|---|
| `Concept` | Drop-down | Multi-choice: Prime, Lobster, Chicken, Burger, Pizza | Owner decision: stores can carry more than one concept |
| `District` | Drop-down | Single-line text, strict exact matching | Owner decision: new districts need no schema change (see [Adding a district](docs/RUNBOOK.md#adding-a-district)) |
| Extra fields | Not in spec | Street Address, City, State; Store Manager Phone; District Manager Phone; Director Name/Email/Phone; plus a `Leadership Contacts` view | Owner request (2026-09-15). All optional. Phones must look like `480-555-0123` (the form script reformats other layouts); State is a two-letter code |
| Store Number format | "canonical" (undefined) | Digits only, 1-6 digits (e.g. `11101`), exact match | Owner decision; change `storeNumberPattern` in `config/directory.config.json` and the customization file together |
| Exception views | One combined view with a missing-data column | None; `npm run audit` is the exception report | Kintone views cannot mix AND with OR, and formulas cannot read Link or User fields. Per-gap `Exceptions - ...` views were used during the initial load, then retired by the owner (2026-09-15) |
| Help text | Under Store Number / Store Email | Small label rows beneath those fields (and District) | Kintone has no per-field help text API |
| Governance fields | Record Owner, Effective Start/End, Last Verified, Verified By, Change Reason | **Removed** — the owner deleted them from the app on 2026-09-15 | The directory is contact data only. Lookups no longer withhold unverified stores, there is no effective-date window, and Kintone's own record history is the edit trail |
| Permissions | Admin / editor / reader | Built and tested, **not applied** | Owner decision until Kintone user/group codes are supplied |

## Configuration and secrets inventory

Environment variables (names only; values live in `.env` or your secret manager):

| Name | Purpose |
|---|---|
| `KINTONE_BASE_URL` | Kintone site origin, `https://<subdomain>.kintone.com` |
| `KINTONE_APP_ID` | Directory app ID (dev app until production is approved) |
| `KINTONE_API_TOKEN` | Setup/admin token: **View records** + **Manage app**. Consumers of the lookup should get a separate token with **View records** only |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | Export job only: app registration with the Graph **Sites.Selected** permission, granted write on the one site |
| `SHAREPOINT_HOST`, `SHAREPOINT_SITE_PATH`, `SHAREPOINT_LIBRARY`, `SHAREPOINT_FOLDER`, `EXPORT_FILE_NAME` | Where the workbook is written; library/folder/name may be left blank for the defaults |
| `DATABASE_URL` | Read-only use of the shared `stores` table for the external-ID sync. `scripts/dump-db-stores.py` needs psycopg; set `PYTHON_BIN` if it is not on the default `python3` |

Committed configuration:

- `config/directory.config.json`: store-number pattern, concept options, verification age (90 days), business time zone.
- `config/permissions.json`: role membership. Set `"apply": true` only once admins/verifiers/editors/readers are filled in; entries look like `{ "type": "GROUP", "code": "store-ops" }` or `{ "type": "USER", "code": "name@company.com" }`. An entity can hold one role.

Kintone limits worth knowing: the API token cannot upload JavaScript customization, and record change history is an app setting to confirm in the UI.

## Daily SharePoint export

Departments without Kintone read an Excel copy in SharePoint. `npm run export -- --upload`
rebuilds `Angies Store Directory.xlsx` from the live app and replaces the file in place, so
its link never changes. The sheet holds the contact fields only; a footer says the file is a
daily copy and that Kintone is the system of record. Verification state and data gaps stay
in `npm run audit`, not in the shared file.

Each morning, before the file is built, `npm run sync:ids -- --apply` fills any blank Toast
or 7shifts ID from the shared stores table, matching on exact store number. An ID that
disagrees with the database is reported and left alone, as are stores present on only one
side. Those reports mark the Modal run failed *after* the file is published, so a data
question never withholds the directory.

The job refuses to publish an empty file, so a Kintone outage leaves yesterday's copy in
place instead of blanking it for every reader. It runs on Modal (see `modal_app.py`), and
[docs/RUNBOOK.md](docs/RUNBOOK.md#daily-sharepoint-export) covers the one-time Microsoft
permission, the secret, and how it is triggered.

## Using the lookup contract

```js
import { getStoreDirectoryRecord } from 'angies-store-directory/lookup';

const result = await getStoreDirectoryRecord({ storeNumber: '11101', asOfDate: '2026-09-15', correlationId: 'job-123' });
if (!result.ok) {
  // DIRECTORY_INCOMPLETE, STORE_NOT_FOUND, ...: block and surface result.reasonCode; never guess.
}
```

It exact-matches `Store_Number` and returns a record only when the store is Active and its contact data is complete and valid. Otherwise it returns one of the typed reason codes. It never caches, fuzzy-matches, or falls back. For tests or custom wiring use `createDirectoryLookup({ client, appId, config, logger })`.

## Project layout

```
config/          directory and permission configuration
customization/   form validation script to upload into Kintone
docs/            SPEC.md (source of truth), RUNBOOK.md, ACCEPTANCE.md
scripts/         CLI entry points (setup, audit, import validation, backup, lookup, export)
src/             Kintone client, field contract, rules, schema plan, audit, lookup, export, Graph
modal_app.py     Modal deployment of the daily SharePoint export
templates/       import CSV template (headers are the exact field codes)
tests/           node:test suites with fictional fixtures
```
