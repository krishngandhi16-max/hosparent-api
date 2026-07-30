# Hosparent Episode-of-Care Estimator — Implementation Package

Implements the research brief's staged plan: additive component episodes (professional + facility + anesthesia + pathology + labs + radiology + implant), anchored to free CMS ground-truth data, with a 5-factor MRF mapping-confidence score.

## Files

```
sql/000_preflight_inspect.sql   Run FIRST — verifies actual table/column names
sql/010_schema.sql              Tables: code_descriptors, medicare_benchmarks,
                                anesthesia tables, component weights, episode tables
sql/011_seed_reference_data.sql Anesthesia base units, crosswalk, 2026 CFs, weights
sql/020_mapping_confidence.sql  5-factor scoring over MRF rows (edit table name first)
scripts/load_cms_files.js       Parses downloaded CMS files into the DB
lib/episodeEstimator.js         Waterfall estimator + ASA anesthesia formula
routes/episodes.js              Express endpoints for server.js
```

## Run order (PowerShell)

```powershell
# 0. Preflight — READ THE OUTPUT. Confirm the real name of your MRF price
#    table and its columns before touching anything else.
psql -d hosparent -f sql/000_preflight_inspect.sql

# 1. Schema + seeds
psql -d hosparent -f sql/010_schema.sql
psql -d hosparent -f sql/011_seed_reference_data.sql
# Note: the 29881 crosswalk row intentionally fails FK until you add
# 01400's base units from the OWCP table — do not guess the value.

# 2. Download CMS files into .\cms_data (extract ZIPs, export Excel to CSV):
#    - HCPCS quarterly file (HCPC2026_*.csv)
#    - OPPS Addendum B -> addendum_b.csv
#    - PFS RVU file (PPRRVU26*.csv)
#    - ASC payment addendum -> asc_rates.csv
#    - 2026 Anesthesia CF file -> anes_cf_2026.csv (Dallas + Fort Worth rows)
npm i pg csv-parse
$env:PGDATABASE = "hosparent"   # plus PGUSER/PGPASSWORD/PGHOST as needed
node scripts/load_cms_files.js

# 3. Confidence scoring: EDIT sql/020_mapping_confidence.sql first —
#    replace `prices` with your real table name, confirm column names,
#    then run in batches (uncomment the id-range hook) off-hours.
psql -d hosparent -f sql/020_mapping_confidence.sql

# 4. Wire routes into server.js:
#    const episodeRoutes = require('./routes/episodes');
#    app.use('/api/episodes', episodeRoutes(pool));
```

If you write any of these files via here-strings, keep using `-Encoding ascii` — all files here are pure ASCII.

## Things deliberately left for you to verify (inspect before inferring)

1. **MRF table name/columns** — `020` and `lib/episodeEstimator.js` (CONFIG block) both assume `prices(billing_code, description, price, price_type, facility_id, is_suspicious)`. Fix from preflight output.
2. **Crosswalk rows marked `needs_verification`** — check against a licensed ASA CROSSWALK or payer policy docs before showing anesthesia lines for those procedures.
3. **DFW locality CFs and GPCIs** — national values are seeded; Dallas/Fort Worth anesthesia CFs load from the CMS ZIP; GPCI-adjusted PFS amounts are a Stage-1.5 enhancement (loader currently computes national GPCI=1.0 amounts).
4. **Commercial multipliers** — defaults are placeholders (2.0–2.5x). Run `estimator.calibrateMultipliers()` after confidence scoring and update CONFIG from your own DFW medians.
5. **Ancillary code map** — the estimator currently prices professional/facility off the primary CPT and derives ancillaries; the TODO in `estimateEpisode` is where per-procedure pathology/lab codes (e.g., 88304/88305, 85025) go.

## Stage gates (from the brief)

- **Stage 1 → 2:** ≥90% of your top-200 shoppable codes have a `medicare_benchmarks` row.
- **Stage 2 → 3:** confidence scored on all rows; facilities with >20% below 0.5 flagged for parser review (the query is at the bottom of `020`).
- **Stage 3 acceptance:** each assembled episode lands inside the min–max band of directly-observed all-in MRF prices for the same procedure/facility.

## Licensing guardrails baked in

- `code_descriptors` only ever holds CMS short descriptors (internal matching) and your own authored `consumer_friendly_desc` (the only text the UI should display for CPT codes). No AMA long or consumer-friendly descriptors anywhere.
- Every API response carries the "estimate, not a quote / Good Faith Estimate" disclaimer per the No Surprises Act framing.
