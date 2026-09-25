"""Dump the shared stores table to JSON for the external-ID sync.

Read-only. Used by scripts/sync-external-ids.js, which has no Postgres driver
of its own; DATABASE_URL comes from the environment.

Usage: python3 scripts/dump-db-stores.py /tmp/db-stores.json
"""

import json
import os
import sys

try:
    import psycopg  # psycopg 3
except ImportError:  # pragma: no cover - whichever driver the host has
    import psycopg2 as psycopg

COLUMNS = ["store_number", "store_name", "status", "toast_guid", "sevenshifts_location_id"]


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/dump-db-stores.py <output.json>")
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set; the store table cannot be read.")

    conn = psycopg.connect(url)
    try:
        try:
            conn.read_only = True
        except Exception:
            pass
        with conn.cursor() as cur:
            cur.execute(f"select {', '.join(COLUMNS)} from stores")
            rows = [dict(zip(COLUMNS, row)) for row in cur.fetchall()]
    finally:
        conn.close()

    with open(sys.argv[1], "w", encoding="utf-8") as handle:
        json.dump(rows, handle, default=str)
    print(f"read {len(rows)} rows from the stores table")


if __name__ == "__main__":
    main()
