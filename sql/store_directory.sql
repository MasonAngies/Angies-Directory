-- =============================================================================
-- Store directory mirror (written daily by the angies-store-directory job)
-- =============================================================================
-- Kintone app 897 is the system of record; these tables are a read-only copy so
-- reports, the dashboard and SQL can join directory data without Kintone access.
-- Re-runnable: every statement is IF NOT EXISTS. Do not edit rows by hand; the
-- next morning's load replaces them.
-- =============================================================================

-- One row per store, replaced each morning.
CREATE TABLE IF NOT EXISTS store_directory (
    store_number              TEXT PRIMARY KEY,
    store_name                TEXT NOT NULL,
    active_status             TEXT NOT NULL,          -- Active | Inactive | Opening | Closed
    store_format              TEXT,                   -- Full Food Platform | Healthy/Limited Menu
    order_methods             TEXT[] NOT NULL DEFAULT '{}',  -- Drive-Thru, Kiosk
    concepts                  TEXT[] NOT NULL DEFAULT '{}',
    district                  TEXT,
    street_address            TEXT,
    city                      TEXT,
    state                     TEXT,
    store_email               TEXT,
    store_manager_name        TEXT,
    store_manager_email       TEXT,
    store_manager_phone       TEXT,
    district_manager_name     TEXT,
    district_manager_email    TEXT,
    district_manager_phone    TEXT,
    director_name             TEXT,
    director_email            TEXT,
    director_phone            TEXT,
    toast_location_id         TEXT,                   -- joins stores.toast_guid
    sevenshifts_location_id   BIGINT,                 -- joins stores.sevenshifts_location_id
    speed_exceptions_granted  BOOLEAN,
    window_goal_breakfast_sec INTEGER,                -- speed goals in whole seconds (120 = 2:00)
    window_goal_lunch_sec     INTEGER,
    window_goal_dinner_sec    INTEGER,
    kiosk_goal_breakfast_sec  INTEGER,
    kiosk_goal_lunch_sec      INTEGER,
    kiosk_goal_dinner_sec     INTEGER,
    routing_notes             TEXT,
    kintone_record_id         BIGINT,
    kintone_revision          INTEGER,
    kintone_updated_at        TIMESTAMPTZ,
    synced_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What the morning sync could not decide on its own, as of its latest run.
CREATE TABLE IF NOT EXISTS store_directory_findings (
    id            BIGSERIAL PRIMARY KEY,
    run_at        TIMESTAMPTZ NOT NULL,
    store_number  TEXT NOT NULL,
    issue         TEXT NOT NULL,
    detail        TEXT NOT NULL,
    action        TEXT NOT NULL
);

-- One row per morning run, so a reader can tell "no findings" from "did not run".
CREATE TABLE IF NOT EXISTS store_directory_runs (
    id              BIGSERIAL PRIMARY KEY,
    run_at          TIMESTAMPTZ NOT NULL,
    stores          INTEGER NOT NULL,
    findings        INTEGER NOT NULL,
    filled          INTEGER NOT NULL,
    sync_ok         BOOLEAN NOT NULL
);

-- Same lock-down as the other tables: no public API access; scripts connect as
-- the privileged role.
ALTER TABLE store_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_directory_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_directory_runs ENABLE ROW LEVEL SECURITY;
