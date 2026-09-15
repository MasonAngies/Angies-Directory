"""Modal deployment of the daily SharePoint export of the store directory.

The directory lives in Kintone, but other departments have no Kintone access, so
this job rebuilds one Excel file and replaces it in SharePoint each morning. The
file is a copy for reading: Kintone stays the system of record.

This function is deliberately NOT scheduled. The workspace caps scheduled
functions at five and all five are in use, so an existing daily job calls this
one instead -- the same arrangement food cost uses for DC inventory:

    modal.Function.from_name("angies-store-directory", "daily_export").remote()

If a schedule slot frees up, uncomment the schedule below and drop the caller.
Arizona has no DST, so 13:15 UTC = 6:15 AM Arizona.

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
    .add_local_dir(
        ".",
        remote_path="/root/app",
        ignore=[".git", ".env", "node_modules", "backups", "reports", "exports"],
    )
)

# KINTONE_BASE_URL, KINTONE_APP_ID, KINTONE_API_TOKEN (read-only token is enough),
# GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, SHAREPOINT_HOST,
# SHAREPOINT_SITE_PATH, and optionally SHAREPOINT_LIBRARY / SHAREPOINT_FOLDER /
# EXPORT_FILE_NAME. Created with `modal secret create angies-store-directory ...`.
secret = modal.Secret.from_name("angies-store-directory")


@app.function(image=image, secrets=[secret], timeout=900)
# @app.function(image=image, secrets=[secret], schedule=modal.Cron("15 13 * * *"), timeout=900)
def daily_export() -> None:
    """Rebuild the workbook and replace the SharePoint copy.

    Fail-fast: a non-zero exit raises here and shows the run red in Modal. The
    export refuses to publish an empty file, so a Kintone outage leaves
    yesterday's copy in place rather than blanking it for every reader.
    """
    subprocess.run(
        ["node", "scripts/export-directory.js", "--upload"],
        cwd="/root/app",
        check=True,
    )


@app.local_entrypoint()
def main() -> None:
    daily_export.remote()
