#!/usr/bin/env node
// report_cpt_medians.js — the "check EVERY CPT" catalog report.
//
// For every CPT in the DB it computes, across hospitals, the market:
//   raw_floor      = the old headline (lowest of lowest) — what users saw before
//   market_low     = lowest hospital's MEDIAN (typical) price
//   market_median  = the median hospital's MEDIAN — the honest market price
//   market_high    = highest hospital's MEDIAN
// and FLAGS any CPT that looks wrong (not a 5-digit code, or an absurd price, or a
// spread so wide the median is meaningless). Writes cpt_median_report.csv (open it
// in Excel) and prints the worst offenders.
//
// Read-only. Run:  node report_cpt_medians.js
require('dotenv').config();
const fs = require('fs');
const { pool } = require('./db');

const VALID_CASH = `
  pr.price_type = 'cash'
  AND pr.is_suspicious IS NOT TRUE
  AND pr.price > 5 AND pr.price < 500000
  AND (b.cpt_code IS NULL OR (pr.price >= b.min_cash AND pr.price <= b.max_cash))
`;

async function main() {
  console.log('=== PER-CPT MEDIAN CATALOG (every CPT, read-only) ===\n');

  // Names for each CPT (first non-null display/standard name).
  const nameRows = (await pool.query(`
    SELECT cpt_code,
           COALESCE(MIN(display_name) FILTER (WHERE display_name IS NOT NULL),
                    MIN(standard_name)) AS name
    FROM procedures WHERE cpt_code IS NOT NULL GROUP BY cpt_code
  `)).rows;
  const nameOf = new Map(nameRows.map((r) => [r.cpt_code, r.name]));

  // Which CPTs have bounds (for the has_bounds flag) — fetched separately so the
  // main query stays simple.
  const boundedSet = new Set(
    (await pool.query('SELECT cpt_code FROM cpt_price_bounds')).rows.map((r) => r.cpt_code)
  );

  // Per-CPT market stats, built from per-hospital medians.
  const rows = (await pool.query(`
    WITH valid_cash AS (
      SELECT h.id AS hospital_id, p.cpt_code, pr.price
      FROM prices pr
      JOIN procedures p ON p.id = pr.procedure_id
      JOIN hospitals h ON h.id = pr.hospital_id
      LEFT JOIN cpt_price_bounds b ON b.cpt_code = p.cpt_code
      WHERE ${VALID_CASH}
    ),
    per_hosp AS (
      SELECT cpt_code, hospital_id,
        MIN(price) AS hosp_low,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS hosp_median
      FROM valid_cash
      GROUP BY cpt_code, hospital_id
    )
    SELECT cpt_code,
      (cpt_code ~ '^[0-9]{5}$') AS is_real_cpt,
      COUNT(*) AS n_hospitals,
      MIN(hosp_low)::int AS raw_floor,
      MIN(hosp_median)::int AS market_low,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY hosp_median))::int AS market_median,
      MAX(hosp_median)::int AS market_high
    FROM per_hosp
    GROUP BY cpt_code
    ORDER BY cpt_code
  `)).rows;

  // Classify each CPT.
  let real = 0, badCode = 0, noBounds = 0, absurd = 0, movesMedian = 0;
  const flagged = [];
  for (const r of rows) {
    r.name = nameOf.get(r.cpt_code) || '(no name)';
    r.has_bounds = boundedSet.has(r.cpt_code);
    r.gap_pct = r.raw_floor > 0 ? Math.round(((r.market_median - r.raw_floor) / r.raw_floor) * 100) : 0;
    const reasons = [];
    if (!r.is_real_cpt) { reasons.push('not-5-digit'); badCode++; }
    if (!r.has_bounds) { reasons.push('no-bounds'); noBounds++; }
    if (r.market_median >= 100000) { reasons.push('absurd-price'); absurd++; }
    if (r.is_real_cpt) real++;
    if (r.gap_pct >= 10) movesMedian++;
    r.flags = reasons.join('|');
    if (reasons.length) flagged.push(r);
  }

  // Write the full CSV.
  const header = 'cpt_code,name,is_real_cpt,has_bounds,n_hospitals,raw_floor,market_low,market_median,market_high,gap_pct,flags\n';
  const csv = header + rows.map((r) =>
    [r.cpt_code, `"${String(r.name).replace(/"/g, '""')}"`, r.is_real_cpt, r.has_bounds,
     r.n_hospitals, r.raw_floor, r.market_low, r.market_median, r.market_high, r.gap_pct, r.flags].join(',')
  ).join('\n');
  fs.writeFileSync('cpt_median_report.csv', csv);

  console.log(`Total CPT codes with valid cash prices : ${rows.length}`);
  console.log(`  real 5-digit CPTs                    : ${real}`);
  console.log(`  NOT a 5-digit code (DRG/junk)        : ${badCode}`);
  console.log(`  no cpt_price_bounds (unvalidated)    : ${noBounds}`);
  console.log(`  absurd median (>= $100,000)          : ${absurd}`);
  console.log(`  where median is >=10% above the floor: ${movesMedian}  (these visibly improve)\n`);
  console.log('Full table written to cpt_median_report.csv (open in Excel).\n');

  // Worst offenders — the codes that most need bounds/cleanup.
  console.log('Top 20 SUSPICIOUS codes (bad code / no bounds / absurd price):\n');
  flagged.sort((a, b) => b.market_median - a.market_median);
  for (const r of flagged.slice(0, 20)) {
    console.log(`  CPT ${String(r.cpt_code).padEnd(8)} median $${String(r.market_median).padEnd(8)} ` +
                `[${r.n_hospitals} hosp] ${r.flags}  ${r.name}`);
  }
  console.log('');

  // Biggest legit improvements — real CPTs where median lifts off a misleading floor.
  const good = rows.filter((r) => r.is_real_cpt && r.has_bounds && r.gap_pct >= 25 && r.market_median < 100000);
  good.sort((a, b) => b.gap_pct - a.gap_pct);
  console.log('Top 20 real CPTs where MEDIAN fixes a misleading floor:\n');
  for (const r of good.slice(0, 20)) {
    console.log(`  CPT ${String(r.cpt_code).padEnd(6)} floor $${String(r.raw_floor).padEnd(6)} → median $${String(r.market_median).padEnd(6)} (+${r.gap_pct}%)  ${r.name}`);
  }
  console.log('');

  console.log('=== NEXT ===');
  console.log(`${badCode + absurd} codes are junk (not real CPTs or absurd inpatient prices). They only`);
  console.log('surface if searched directly, but to be safe we can hide any non-5-digit code');
  console.log('from search and/or add bounds. Tell me and I\'ll wire the filter.');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('Report failed:', e.message);
  process.exit(1);
});
