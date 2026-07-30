// ══════════════════════════════════════════════════════════════
// diagnose_price.js — pinpoint why a Hosparent price differs from TryBilly
//
// Run locally (where the DB lives):
//   node diagnose_price.js <CPT> "<hospital name fragment>"
//   e.g.  node diagnose_price.js 45378 "Baylor"
//
// It reports, for that CPT + hospital:
//   1. Every raw price, grouped by price_type (cash / gross / negotiated)
//   2. Which of those the LIVE API would actually show — using the exact
//      same filter server.js applies (is_suspicious + cash-bounds check)
//   3. The gap between "raw min" and "what /search returns" so you can see
//      immediately whether a price is MISSING, FLAGGED, or FILTERED OUT.
//   4. The bounds row (cash + negotiated/gross if those columns exist).
//
// Safe: read-only, never writes. Idempotent.
// ══════════════════════════════════════════════════════════════
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// EXACT copy of server.js PRICE_IS_VALID_SQL — this is what the API enforces.
// NOTE: it bounds-checks EVERY price_type against min_cash/max_cash only.
const PRICE_IS_VALID_SQL = `
  (pr.is_suspicious IS NOT TRUE)
  AND NOT EXISTS (
    SELECT 1 FROM cpt_price_bounds b
    WHERE b.cpt_code = p.cpt_code
    AND (pr.price < b.min_cash OR pr.price > b.max_cash)
  )
`;

async function columnExists(table, column) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
    [table, column]
  );
  return r.rows.length > 0;
}

async function diagnose(cpt, hospitalName) {
  console.log(`\n=== DIAGNOSTICS: CPT ${cpt} @ "${hospitalName}" ===\n`);

  // ── hospital ──
  const hosp = await pool.query(
    `SELECT id, name, city, is_compliant, mrf_last_updated
     FROM hospitals WHERE name ILIKE $1 ORDER BY name LIMIT 1`,
    [`%${hospitalName}%`]
  );
  if (hosp.rows.length === 0) {
    console.log('❌ Hospital not found. Closest matches:');
    const like = await pool.query(
      `SELECT DISTINCT name FROM hospitals WHERE name ILIKE $1 ORDER BY name LIMIT 20`,
      [`%${hospitalName.split(' ')[0]}%`]
    );
    console.log(like.rows.map(r => '   ' + r.name).join('\n') || '   (none)');
    return;
  }
  const h = hosp.rows[0];
  console.log(`✓ Hospital: ${h.name} (${h.city}) | compliant=${h.is_compliant} | MRF updated=${h.mrf_last_updated}`);

  // ── procedure(s) for this CPT ──
  const proc = await pool.query(
    `SELECT id, display_name, standard_name, cpt_code FROM procedures WHERE cpt_code = $1`,
    [cpt]
  );
  if (proc.rows.length === 0) {
    console.log(`\n❌ CPT ${cpt} not found in procedures. It may be re-coded (e.g. virtual colonoscopy → 74263) or unlinked (cpt_code=NULL).`);
    return;
  }
  const procIds = proc.rows.map(r => r.id);
  console.log(`✓ ${proc.rows.length} procedure row(s) for CPT ${cpt}: ${proc.rows.map(r => `#${r.id} "${r.display_name}"`).join(', ')}`);

  // ── all raw prices for this combo, grouped by type ──
  const all = await pool.query(
    `SELECT pr.price, pr.price_type, pr.payer_name, pr.is_suspicious, pr.validation_reason
     FROM prices pr
     JOIN procedures p ON p.id = pr.procedure_id
     WHERE pr.procedure_id = ANY($1::int[]) AND pr.hospital_id = $2
     ORDER BY pr.price_type, pr.price ASC`,
    [procIds, h.id]
  );

  console.log(`\nRaw prices in DB for this hospital+CPT: ${all.rows.length}`);
  if (all.rows.length === 0) {
    const any = await pool.query(
      `SELECT COUNT(*)::int AS cnt, COUNT(DISTINCT hospital_id)::int AS hosp
       FROM prices WHERE procedure_id = ANY($1::int[])`, [procIds]);
    console.log(`  ⚠️  ZERO prices here. CPT exists at ${any.rows[0].hosp} other hospital(s), ${any.rows[0].cnt} prices total.`);
    console.log(`  → ROOT CAUSE = MISSING DATA (no MRF scrape for this hospital+CPT).`);
    return;
  }

  const byType = {};
  for (const r of all.rows) (byType[r.price_type] ||= []).push(r);
  for (const [type, rows] of Object.entries(byType)) {
    const clean = rows.filter(r => !r.is_suspicious);
    const flagged = rows.filter(r => r.is_suspicious);
    console.log(`\n  ${type.toUpperCase()} — ${rows.length} rows`);
    console.log(`    range: $${Math.min(...rows.map(r => +r.price))} – $${Math.max(...rows.map(r => +r.price))}`);
    console.log(`    not flagged: ${clean.length} | is_suspicious=true: ${flagged.length}`);
    if (flagged.length) {
      const reason = flagged.find(r => r.validation_reason)?.validation_reason;
      console.log(`    flagged prices: ${flagged.map(r => '$' + r.price).join(', ')}${reason ? `  (reason: ${reason})` : ''}`);
    }
  }

  // ── what the LIVE API would actually return (same filter as server.js) ──
  const shown = await pool.query(
    `SELECT pr.price_type, MIN(pr.price) AS min_shown, COUNT(*)::int AS n
     FROM prices pr
     JOIN procedures p ON p.id = pr.procedure_id
     WHERE pr.procedure_id = ANY($1::int[]) AND pr.hospital_id = $2
       AND pr.price > 5 AND pr.price < 500000
       AND ${PRICE_IS_VALID_SQL}
     GROUP BY pr.price_type`,
    [procIds, h.id]
  );
  console.log(`\n  >>> WHAT THE API SHOWS (after is_suspicious + cash-bounds filter):`);
  if (shown.rows.length === 0) {
    console.log(`      (nothing) — every price for this combo is either flagged or outside the cash bounds.`);
  } else {
    for (const r of shown.rows) {
      console.log(`      ${r.price_type}: min $${r.min_shown} (${r.n} pass the filter)`);
    }
  }

  // ── bounds row ──
  const hasNeg = await columnExists('cpt_price_bounds', 'min_negotiated');
  const cols = hasNeg
    ? 'cpt_code, procedure_label, min_cash, max_cash, min_negotiated, max_negotiated, min_gross, max_gross'
    : 'cpt_code, procedure_label, min_cash, max_cash';
  const bounds = await pool.query(`SELECT ${cols} FROM cpt_price_bounds WHERE cpt_code = $1`, [cpt]);
  console.log(`\n  BOUNDS for ${cpt}: ${bounds.rows.length ? 'set' : 'NONE (CPT falls back to is_suspicious only)'}`);
  if (bounds.rows.length) {
    const b = bounds.rows[0];
    console.log(`      cash:       $${b.min_cash} – $${b.max_cash}   ← the ONLY window server.js enforces, for ALL price_types`);
    if (hasNeg) {
      console.log(`      negotiated: $${b.min_negotiated} – $${b.max_negotiated}   (stored, but server.js IGNORES it)`);
      console.log(`      gross:      $${b.min_gross} – $${b.max_gross}   (stored, but server.js IGNORES it)`);
    }
  }

  console.log(`\n  INTERPRETATION:`);
  console.log(`   • API shows a price but TryBilly differs → likely MIN-vs-other-statistic, or bounds clipping the low/high end.`);
  console.log(`   • Raw price exists but API shows nothing → FLAGGED (is_suspicious) or FILTERED (outside cash bounds).`);
  console.log(`   • A negotiated/gross price is being judged against the CASH window above → known cross-type bounds issue.\n`);
}

const [cpt, hospital] = process.argv.slice(2);
if (!cpt || !hospital) {
  console.log('Usage: node diagnose_price.js <CPT> "<hospital name fragment>"');
  process.exit(1);
}
diagnose(cpt, hospital)
  .catch(e => console.error('ERROR:', e.message))
  .finally(() => pool.end());
