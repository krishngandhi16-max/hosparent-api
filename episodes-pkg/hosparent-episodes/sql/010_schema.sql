-- ============================================================
-- Hosparent Episode-of-Care Estimator: Schema (Migration 010)
-- Defensive: safe to re-run. Run preflight_inspect.sql FIRST and
-- verify no naming collisions with your existing tables.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------
-- 1. Canonical code descriptors (free CMS sources only)
--    Sources: HCPCS quarterly ZIP, OPPS Addendum B, PFS RVU file,
--    MS-DRG Definitions Manual. Do NOT load AMA CPT long descriptors.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS code_descriptors (
    code                 TEXT NOT NULL,
    code_type            TEXT NOT NULL,   -- 'CPT','HCPCS','MS-DRG','APC'
    canonical_short_desc TEXT,            -- CMS short descriptor (internal matching only)
    consumer_friendly_desc TEXT,          -- OUR OWN authored plain-language name (safe to display)
    source               TEXT NOT NULL,   -- 'HCPCS_QUARTERLY','OPPS_ADDENDUM_B','PFS_RVU','MSDRG_MANUAL','HOSPARENT_AUTHORED'
    source_version       TEXT,            -- e.g. 'JUL2026','RVU26A','v43.0'
    loaded_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (code, code_type, source)
);

CREATE INDEX IF NOT EXISTS idx_code_descriptors_code ON code_descriptors (code);
CREATE INDEX IF NOT EXISTS idx_code_descriptors_desc_trgm
    ON code_descriptors USING gin (canonical_short_desc gin_trgm_ops);

-- ------------------------------------------------------------
-- 2. Medicare ground-truth benchmarks (Dallas + Fort Worth localities)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS medicare_benchmarks (
    code                 TEXT NOT NULL,
    code_type            TEXT NOT NULL DEFAULT 'CPT',
    locality             TEXT NOT NULL,   -- 'NATIONAL','TX_DALLAS','TX_FORT_WORTH'
    pfs_facility_amt     NUMERIC(12,2),   -- professional fee, facility setting
    pfs_nonfacility_amt  NUMERIC(12,2),   -- professional fee, office setting
    opps_apc_rate        NUMERIC(12,2),   -- hospital outpatient facility rate
    asc_rate             NUMERIC(12,2),   -- surgery-center facility rate
    clfs_rate            NUMERIC(12,2),   -- clinical lab fee schedule (labs)
    global_days          TEXT,            -- '000','010','090','XXX','ZZZ'
    status_indicator     TEXT,            -- OPPS status indicator from Addendum B
    apc                  TEXT,
    effective_year       INT NOT NULL,
    loaded_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (code, code_type, locality, effective_year)
);

CREATE INDEX IF NOT EXISTS idx_medicare_benchmarks_code ON medicare_benchmarks (code);

-- ------------------------------------------------------------
-- 3. Anesthesia model tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anesthesia_base_units (
    anes_cpt     TEXT PRIMARY KEY,        -- 00100-01999
    base_units   INT NOT NULL,
    description  TEXT,
    source       TEXT NOT NULL DEFAULT 'OWCP_BASE_UNIT_TABLE',
    is_verified  BOOLEAN NOT NULL DEFAULT FALSE  -- verified against current-year OWCP/ASA file
);

CREATE TABLE IF NOT EXISTS cpt_anesthesia_crosswalk (
    surg_cpt          TEXT NOT NULL,
    anes_cpt          TEXT NOT NULL REFERENCES anesthesia_base_units (anes_cpt),
    needs_verification BOOLEAN NOT NULL DEFAULT TRUE, -- flip FALSE once checked vs ASA CROSSWALK
    notes             TEXT,
    PRIMARY KEY (surg_cpt, anes_cpt)
);

CREATE TABLE IF NOT EXISTS locality_anesthesia_cf (
    locality      TEXT NOT NULL,          -- 'NATIONAL','TX_DALLAS','TX_FORT_WORTH'
    cf_non_apm    NUMERIC(10,4) NOT NULL,
    cf_apm        NUMERIC(10,4),
    effective_year INT NOT NULL,
    source        TEXT,
    PRIMARY KEY (locality, effective_year)
);

-- ------------------------------------------------------------
-- 4. Component weight defaults (percentage-model fallback, per procedure)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS episode_component_weights (
    primary_cpt     TEXT NOT NULL,        -- 'DEFAULT' row = generic facility-based surgery
    component_type  TEXT NOT NULL,        -- professional|facility|anesthesia|pathology|labs|radiology|drugs|implant
    weight          NUMERIC(5,4) NOT NULL CHECK (weight >= 0 AND weight <= 1),
    notes           TEXT,
    PRIMARY KEY (primary_cpt, component_type)
);

-- ------------------------------------------------------------
-- 5. Episode cost tables (created if absent; extended if present)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procedure_episode_costs (
    id                 BIGSERIAL PRIMARY KEY,
    primary_cpt        TEXT NOT NULL,
    facility_id        BIGINT,             -- FK to your facilities/hospitals table; add constraint after verifying its name
    component_type     TEXT NOT NULL,
    component_cpt      TEXT,               -- code priced for this component (e.g. anes CPT, path CPT)
    estimated_amount   NUMERIC(12,2) NOT NULL,
    estimation_method  TEXT NOT NULL,      -- mrf_direct|medicare_derived|percentage_model
    mapping_confidence NUMERIC(4,3),       -- 0-1, from mapping-confidence pipeline
    price_type         TEXT,               -- cash|negotiated|gross (when mrf_direct)
    payer              TEXT,
    source_row_id      BIGINT,             -- FK to your prices/MRF rows table
    commercial_multiplier NUMERIC(6,3),    -- multiplier applied when medicare_derived
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- In case the table already existed with an older shape:
ALTER TABLE procedure_episode_costs ADD COLUMN IF NOT EXISTS component_type TEXT;
ALTER TABLE procedure_episode_costs ADD COLUMN IF NOT EXISTS estimation_method TEXT;
ALTER TABLE procedure_episode_costs ADD COLUMN IF NOT EXISTS mapping_confidence NUMERIC(4,3);
ALTER TABLE procedure_episode_costs ADD COLUMN IF NOT EXISTS source_row_id BIGINT;
ALTER TABLE procedure_episode_costs ADD COLUMN IF NOT EXISTS commercial_multiplier NUMERIC(6,3);

CREATE INDEX IF NOT EXISTS idx_pec_cpt_facility ON procedure_episode_costs (primary_cpt, facility_id);

CREATE TABLE IF NOT EXISTS procedure_episode_summary (
    id               BIGSERIAL PRIMARY KEY,
    primary_cpt      TEXT NOT NULL,
    facility_id      BIGINT,
    setting          TEXT,                 -- 'HOPD','ASC'
    total_estimate   NUMERIC(12,2) NOT NULL,
    low_estimate     NUMERIC(12,2),
    high_estimate    NUMERIC(12,2),
    n_mrf_components INT NOT NULL DEFAULT 0,
    n_derived_components INT NOT NULL DEFAULT 0,
    n_pct_components INT NOT NULL DEFAULT 0,
    overall_confidence NUMERIC(4,3),
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (primary_cpt, facility_id, setting)
);

-- ------------------------------------------------------------
-- 6. Mapping confidence on raw price rows
--    NOTE: assumes your MRF price rows live in a table named `prices`.
--    Verify with preflight_inspect.sql; if it is named differently,
--    change the table name here and in 020_mapping_confidence.sql.
-- ------------------------------------------------------------
-- ALTER TABLE prices ADD COLUMN IF NOT EXISTS mapping_confidence NUMERIC(4,3);
-- ALTER TABLE prices ADD COLUMN IF NOT EXISTS confidence_flags JSONB;
-- (Left commented so this migration cannot touch a table I have not seen.
--  Uncomment after preflight confirms the table name.)

COMMIT;
