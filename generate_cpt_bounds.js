#!/usr/bin/env node
// generate_cpt_bounds.js — give EVERY real 5-digit CPT a price-bounds window,
// so the strict bounds-gate can hide junk (non-CPT / unvalidated) codes without
// hiding your real catalog.
//
// SAFE & NON-DESTRUCTIVE: it only INSERTS bounds for CPTs that don't already have
// a row. Your hand-curated bounds (e.g. 45378) are never overwritten. Junk codes
// (non-5-digit like 231/207, or codes with too few prices) get NO bounds and so
// stay hidden once the gate is on — exactly what you asked for.
//
// Bounds are generous order-of-magnitude fences from the data itself:
//   min = max(5, round(p10 * 0.25))     max = round(p90 * 4)
// This keeps real price spread but rejects 10x+ data-entry errors.
//
// Run:  node generate_cpt_bounds.js         (add bounds for unbounded real CPTs)
//       node generate_cpt_bounds.js --dry   (show what it WOULD add, write nothing)
require('dotenv').config();
const { pool } = require('./db');
const { ensureBoundsColumns } = require('./db');

const DRY = process.argv.includes('--dry');
const MIN_SAMPLE = 8; // need at least this many prices of a type to trust percentiles

function fences(p10, p90) {
  if (p10 == null || p90 == null || p90 <= 0) return null;
  const min = Math.max(5, Math.round(Number(p10) * 0.25));
  const max = Math.round(Number(p90) * 4);
  return max > min ? { min, max } : null;
}

async function main() {
  console.log(`=== GENERATE CPT BOUNDS ${DRY ? '(dry run)' : ''} ===\n`);
  await ensureBoundsColumns();

  // Real 5-digit CPTs that have NO bounds row yet, with per-type percentiles.
  const rows = (await pool.query(`
    SELECT p.cpt_code,
      COALESCE(MIN(p.display_name) FILTER (WHERE p.display_name IS NOT NULL),
               MIN(p.standard_name)) AS label,
      COUNT(*) FILTER (WHERE pr.price_type='cash') AS n_cash,
      percentile_cont(0.10) WITHIN GROUP (ORDER BY pr.price) FILTER (WHERE pr.price_type='cash') AS cash_p10,
      percentile_cont(0.90) WITHIN GROUP (ORDER BY pr.price) FILTER (WHERE pr.price_type='cash') AS cash_p90,
      COUNT(*) FILTER (WHERE pr.price_type='negotiated') AS n_neg,
      percentile_cont(0.10) WITHIN GROUP (ORDER BY pr.price) FILTER (WHERE pr.price_type='negotiated') AS neg_p10,
      percentile_cont(0.90) WITHIN GROUP (ORDER BY pr.price) FILTER (WHERE pr.price_type='negotiated') AS neg_p90,
      COUNT(*) FILTER (WHERE pr.price_type='gross') AS n_gross,
      percentile_cont(0.10) WITHIN GROUP (ORDER BY pr.price) FILTER (WHERE pr.price_type='gross') AS gross_p10,
      percentile_cont(0.90) WITHIN GROUP (ORDER BY pr.price) FILTER (WHERE pr.price_type='gross') AS gross_p90
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    WHERE p.cpt_code ~ '^[0-9]{5}$'
      AND pr.is_suspicious IS NOT TRUE
      AND pr.price > 5 AND pr.price < 500000
      AND p.cpt_code NOT IN (SELECT cpt_code FROM cpt_price_bounds)
    GROUP BY p.cpt_code
    HAVING COUNT(*) FILTER (WHERE pr.price_type='cash') >= ${MIN_SAMPLE}
    ORDER BY p.cpt_code
  `)).rows;

  console.log(`Real 5-digit CPTs missing bounds with >=${MIN_SAMPLE} cash prices: ${rows.length}\n`);

  let added = 0, skipped = 0;
  for (const r of rows) {
    const cash = fences(r.cash_p10, r.cash_p90);
    if (!cash) { skipped++; continue; } // no usable cash window → leave unbounded (gated out)
    const neg = Number(r.n_neg) >= MIN_SAMPLE ? fences(r.neg_p10, r.neg_p90) : null;
    const gross = Number(r.n_gross) >= MIN_SAMPLE ? fences(r.gross_p10, r.gross_p90) : null;

    if (DRY) {
      if (added < 25) {
        console.log(`  ${r.cpt_code} cash[$${cash.min}-$${cash.max}]` +
          `${neg ? ` neg[$${neg.min}-$${neg.max}]` : ''}${gross ? ` gross[$${gross.min}-$${gross.max}]` : ''}  ${r.label || ''}`);
      }
      added++;
      continue;
    }

    await pool.query(
      `INSERT INTO cpt_price_bounds
         (cpt_code, procedure_label, min_cash, max_cash, min_negotiated, max_negotiated, min_gross, max_gross)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (cpt_code) DO NOTHING`,
      [r.cpt_code, r.label || null, cash.min, cash.max,
       neg ? neg.min : null, neg ? neg.max : null,
       gross ? gross.min : null, gross ? gross.max : null]
    ).catch(async (e) => {
      // If there's no unique constraint on cpt_code, fall back to a guarded insert.
      if (/no unique|exclusion|ON CONFLICT/i.test(e.message)) {
        await pool.query(
          `INSERT INTO cpt_price_bounds
             (cpt_code, procedure_label, min_cash, max_cash, min_negotiated, max_negotiated, min_gross, max_gross)
           SELECT $1,$2,$3,$4,$5,$6,$7,$8
           WHERE NOT EXISTS (SELECT 1 FROM cpt_price_bounds WHERE cpt_code=$1)`,
          [r.cpt_code, r.label || null, cash.min, cash.max,
           neg ? neg.min : null, neg ? neg.max : null,
           gross ? gross.min : null, gross ? gross.max : null]
        );
      } else { throw e; }
    });
    added++;
  }

  console.log(`\n${DRY ? 'Would add' : 'Added'} bounds for ${added} CPTs. Skipped ${skipped} (no usable window).`);
  const total = (await pool.query('SELECT COUNT(*) FROM cpt_price_bounds')).rows[0].count;
  console.log(`cpt_price_bounds now has ${total} rows.`);
  if (!DRY) {
    console.log('\nNext: set STRICT_BOUNDS_GATE=true in .env and restart to hide unbounded junk codes.');
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('Generate failed:', e.message);
  process.exit(1);
});
