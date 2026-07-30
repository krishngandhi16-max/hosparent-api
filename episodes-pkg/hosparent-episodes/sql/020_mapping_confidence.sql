-- ============================================================
-- Migration 020: 5-factor mapping-confidence scoring
--
-- !! BEFORE RUNNING: replace `prices` with your actual MRF row
-- table name from 000_preflight_inspect.sql output, and confirm
-- column names (billing_code, description, price, price_type,
-- facility_id). Set-based SQL so it scales to ~49.5M rows —
-- run during off-hours; the trigram join is the expensive step.
--
-- Factors (weights):
--   f1 code-format validity          0.20
--   f2 description trigram match     0.25
--   f3 price plausibility vs Medicare 0.30
--   f4 cross-facility corroboration  0.15
--   f5 setting/units sanity          0.10
-- ============================================================

BEGIN;

ALTER TABLE prices ADD COLUMN IF NOT EXISTS mapping_confidence NUMERIC(4,3);
ALTER TABLE prices ADD COLUMN IF NOT EXISTS confidence_flags JSONB;

-- ------------------------------------------------------------
-- Per-code cross-facility stats (f4) computed once into a temp table
-- ------------------------------------------------------------
CREATE TEMP TABLE code_price_stats AS
SELECT
    billing_code,
    price_type,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY ln(NULLIF(price,0))) AS median_ln_price,
    COUNT(DISTINCT facility_id) AS n_facilities
FROM prices
WHERE price > 0
GROUP BY billing_code, price_type;

CREATE INDEX ON code_price_stats (billing_code, price_type);

-- ------------------------------------------------------------
-- Score. Batched by id range recommended for 49.5M rows; template:
-- add  AND p.id BETWEEN :start AND :end  and loop in PowerShell.
-- ------------------------------------------------------------
WITH scored AS (
    SELECT
        p.id,

        -- f1: code format
        CASE
            WHEN p.billing_code ~ '^[0-9]{5}$'            THEN 1.0  -- CPT
            WHEN p.billing_code ~ '^[A-Z][0-9]{4}$'       THEN 1.0  -- HCPCS II
            WHEN p.billing_code ~ '^[0-9]{3}$'            THEN 0.8  -- MS-DRG (ok but inpatient)
            WHEN p.billing_code IS NULL
              OR p.billing_code ~ '^9{5,}$'               THEN 0.0  -- null/placeholder
            ELSE 0.3                                                -- internal PX/rev codes
        END AS f1,

        -- f2: description similarity to CMS canonical short descriptor
        COALESCE((
            SELECT MAX(similarity(lower(p.description), lower(cd.canonical_short_desc)))
            FROM code_descriptors cd
            WHERE cd.code = p.billing_code
        ), 0.5) AS f2,  -- 0.5 neutral when no canonical descriptor loaded

        -- f3: price plausibility vs Medicare benchmark (0.5x - 15x band)
        COALESCE((
            SELECT CASE
                WHEN mb_amt IS NULL OR mb_amt = 0 THEN 0.5           -- neutral: no benchmark
                WHEN p.price BETWEEN 0.5*mb_amt AND 15*mb_amt THEN 1.0
                WHEN p.price BETWEEN 0.2*mb_amt AND 30*mb_amt THEN 0.4
                ELSE 0.0
            END
            FROM (
                SELECT COALESCE(mb.opps_apc_rate, mb.pfs_facility_amt,
                                mb.asc_rate, mb.clfs_rate) AS mb_amt
                FROM medicare_benchmarks mb
                WHERE mb.code = p.billing_code
                  AND mb.locality = 'NATIONAL'
                ORDER BY mb.effective_year DESC
                LIMIT 1
            ) b
        ), 0.5) AS f3,

        -- f4: agreement with cross-facility median (within e^1.5 ~ 4.5x of median)
        COALESCE((
            SELECT CASE
                WHEN s.n_facilities < 3 THEN 0.5                      -- too few peers: neutral
                WHEN abs(ln(NULLIF(p.price,0)) - s.median_ln_price) <= 1.5 THEN 1.0
                WHEN abs(ln(NULLIF(p.price,0)) - s.median_ln_price) <= 2.5 THEN 0.4
                ELSE 0.0
            END
            FROM code_price_stats s
            WHERE s.billing_code = p.billing_code AND s.price_type = p.price_type
        ), 0.5) AS f4,

        -- f5: setting/units sanity — 4-digit numeric = revenue code masquerading as CPT
        CASE
            WHEN p.billing_code ~ '^[0-9]{4}$' THEN 0.0
            WHEN p.price IS NOT NULL AND p.price > 0 THEN 1.0
            ELSE 0.0
        END AS f5
    FROM prices p
    WHERE p.price IS NOT NULL
    -- AND p.id BETWEEN :start AND :end   -- << batching hook
)
UPDATE prices p SET
    mapping_confidence = ROUND(
        (0.20*s.f1 + 0.25*s.f2 + 0.30*s.f3 + 0.15*s.f4 + 0.10*s.f5)::numeric, 3),
    confidence_flags = jsonb_build_object(
        'code_format', ROUND(s.f1::numeric,2),
        'desc_match',  ROUND(s.f2::numeric,2),
        'price_plaus', ROUND(s.f3::numeric,2),
        'cross_src',   ROUND(s.f4::numeric,2),
        'setting',     ROUND(s.f5::numeric,2))
FROM scored s
WHERE p.id = s.id;

COMMIT;

-- ------------------------------------------------------------
-- Post-run reports
-- ------------------------------------------------------------
-- Quarantine candidates:
-- SELECT COUNT(*) FROM prices WHERE mapping_confidence < 0.5;
--
-- Facilities needing parser review (>20% rows below 0.5):
-- SELECT facility_id,
--        COUNT(*) FILTER (WHERE mapping_confidence < 0.5)::float / COUNT(*) AS pct_low
-- FROM prices GROUP BY facility_id HAVING
--        COUNT(*) FILTER (WHERE mapping_confidence < 0.5)::float / COUNT(*) > 0.20
-- ORDER BY pct_low DESC;
