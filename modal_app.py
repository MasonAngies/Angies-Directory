"""Modal deployment of the daily SharePoint export of the store directory.

The directory lives in Kintone, but other departments have no Kintone access, so
this job rebuilds one Excel file and replaces it in SharePoint each morning. The
file is a copy for reading: Kintone stays the system of record.

Before exporting it tops up the directory's derived data: blank Toast / 7shifts
IDs from the shared stores table (the nightly Toast + 7shifts sync), and blank
Store Format from the store's concepts. Values that disagree with their source
are reported, never overwritten.

Schedules are in UTC. Arizona has no DST, so 13:45 UTC = 6:45 AM Arizona --
after the overnight pipelines, so the file reflects any early-morning edits.

Deploy:   modal deploy modal_app.py
Test now: modal run modal_app.py::daily_export
"""

import subprocess

import modal

app = modal.App("angies-store-directory")

# Node 22 on Debian; the export itself has no npm dependencies, so there is
# nothing to install beyond the runtime. The repo ships in without its local
# .env -- credentials come from the Modal Secret below.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl", "ca-certificates")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs",
    )
    # psycopg is only for scripts/dump-db-stores.py, which feeds the ID sync.
    .pip_install("psycopg[binary]")
    .add_local_dir(
        ".",
        remote_path="/root/app",
        ignore=[".git", ".env", "node_modules", "backups", "reports", "exports"],
    )
)

# KINTONE_BASE_URL, KINTONE_APP_ID, KINTONE_API_TOKEN (needs edit rights for the
# ID sync), DATABASE_URL (read-only use), GRAPH_TENANT_ID, GRAPH_CLIENT_ID,
# GRAPH_CLIENT_SECRET, SHAREPOINT_HOST, SHAREPOINT_SITE_PATH, and optionally
# SHAREPOINT_LIBRARY / SHAREPOINT_FOLDER / EXPORT_FILE_NAME.
# ALERT_RECIPIENTS + GRAPH_SENDER_ADDRESS turn on the email when the ID sync
# finds something a person must settle; without them it only writes to this log.
# Created with `modal secret create angies-store-directory ...`.
secret = modal.Secret.from_name("angies-store-directory")


@app.function(image=image, secrets=[secret], schedule=modal.Cron("45 13 * * *"), timeout=900)
def daily_export() -> None:
    """Top up external IDs, then rebuild the workbook and replace the SharePoint copy.

    The export is fail-fast: a non-zero exit raises and shows the run red in
    Modal. It refuses to publish an empty file, so a Kintone outage leaves
    yesterday's copy in place rather than blanking it for every reader.

    The sync is deliberately not fail-fast. Exit code 1 means it found
    something a person must settle (an ID that disagrees with the database, or a
    store missing from one side), which is no reason to withhold the file — so
    the export runs first and the run is only marked failed afterwards. Those
    findings are also emailed to ALERT_RECIPIENTS, so nobody has to watch Modal.
    """
    sync = subprocess.run(
        ["node", "scripts/sync-directory.js", "--apply", "--alert"],
        cwd="/root/app",
        check=False,
    )
    if sync.returncode == 2:
        print("Directory sync could not run; continuing to the export.")

    subprocess.run(
        ["node", "scripts/export-directory.js", "--upload"],
        cwd="/root/app",
        check=True,
    )

    if sync.returncode != 0:
        raise RuntimeError(
            f"Directory sync needs attention (exit {sync.returncode}); see the log above. "
            "The directory file was published."
        )


@app.local_entrypoint()
def main() -> None:
    """`modal run modal_app.py` runs the export once, outside the schedule."""
    daily_export.remote()
