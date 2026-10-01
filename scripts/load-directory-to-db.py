"""Load the store directory (and the morning sync's findings) into the shared database.

    python3 scripts/load-directory-to-db.py --directory /tmp/directory.json --findings /tmp/findings.json
    python3 scripts/load-directory-to-db.py --directory /tmp/directory.json --sync-failed

Applies sql/store_directory.sql (idempotent), then in ONE transaction:
  - upserts every directory row and deletes rows for stores no longer in Kintone;
  - replaces the current findings with this run's;
  - records the run in store_directory_runs.
FAIL-SAFE: refuses to load an empty directory, so a Kintone outage leaves yesterday's
copy in place rather than deleting every store. With --sync-failed the findings are
left as they were and the run is recorded as failed.
"""

import argparse
import json
import os
import pathlib
import sys
from datetime import datetime, timezone

try:
    import psycopg  # psycopg 3
except ImportError:  # pragma: no cover
    import psycopg2 as psycopg

ROOT = pathlib.Path(__file__).resolve().parent.parent
COLUMNS = [
    "store_number", "store_name", "active_status", "store_format", "order_methods", "concepts",
    "district", "street_address", "city", "state", "store_email",
    "store_manager_name", "store_manager_email", "store_manager_phone",
    "district_manager_name", "district_manager_email", "district_manager_phone",
    "director_name", "director_email", "director_phone",
    "toast_location_id", "sevenshifts_location_id", "speed_exceptions_granted",
    "window_goal_breakfast_sec", "window_goal_lunch_sec", "window_goal_dinner_sec",
    "kiosk_goal_breakfast_sec", "kiosk_goal_lunch_sec", "kiosk_goal_dinner_sec",
    "routing_notes", "kintone_record_id", "kintone_revision", "kintone_updated_at",
]


def ddl_statements():
    text = (ROOT / "sql" / "store_directory.sql").read_text()
    lines = [line for line in text.splitlines() if not line.strip().startswith("--")]
    return [s.strip() for s in "\n".join(lines).split(";") if s.strip()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", required=True)
    parser.add_argument("--findings")
    parser.add_argument("--sync-failed", action="store_true")
    args = parser.parse_args()
    if not args.findings and not args.sync_failed:
        raise SystemExit("Pass --findings <file>, or --sync-failed when the sync did not run.")

    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set.")

    rows = json.loads(pathlib.Path(args.directory).read_text())
    if not rows:
        raise SystemExit("The directory export is empty; refusing to wipe store_directory.")
    findings = json.loads(pathlib.Path(args.findings).read_text()) if args.findings else None
    run_at = (findings or {}).get("runAt") or datetime.now(timezone.utc).isoformat()

    placeholders = ", ".join(["%s"] * len(COLUMNS))
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in COLUMNS if c != "store_number")
    upsert = (
        f"INSERT INTO store_directory ({', '.join(COLUMNS)}) VALUES ({placeholders}) "
        f"ON CONFLICT (store_number) DO UPDATE SET {updates}, synced_at = now()"
    )

    conn = psycopg.connect(url)
    try:
        with conn.cursor() as cur:
            for statement in ddl_statements():
                cur.execute(statement)
            for row in rows:
                cur.execute(upsert, [row.get(c) for c in COLUMNS])
            numbers = [row["store_number"] for row in rows]
            cur.execute("DELETE FROM store_directory WHERE NOT (store_number = ANY(%s))", (numbers,))
            removed = cur.rowcount
            items = (findings or {}).get("items", [])
            if findings is not None:
                cur.execute("DELETE FROM store_directory_findings")
                for item in items:
                    cur.execute(
                        "INSERT INTO store_directory_findings (run_at, store_number, issue, detail, action) "
                        "VALUES (%s, %s, %s, %s, %s)",
                        (run_at, item["store"], item["issue"], item["detail"], item["action"]),
                    )
            cur.execute(
                "INSERT INTO store_directory_runs (run_at, stores, findings, filled, sync_ok) VALUES (%s, %s, %s, %s, %s)",
                (run_at, len(rows), len(items), (findings or {}).get("filled", 0), findings is not None),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    status = f"{len(items)} finding(s)" if findings is not None else "sync failed, previous findings kept"
    print(f"database: {len(rows)} stores loaded, {removed} removed; {status}")


if __name__ == "__main__":
    main()
