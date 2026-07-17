// diagnose_missing_hospitals.js — find out WHY hospitals are missing from /search
// results for a given CPT: no data at all, vs. data that exists but gets
// silently dropped by the HAVING clause (e.g. gross-price-only, no payer_name).
//
// Usage: node diagnose_missing_hospitals.js 47562,47563
require('dotenv').config();
const { pool } = require('./db');

const PRICE_IS_VALID_SQL = `
  (pr.is_suspicious IS NOT TRUE)
  AND NOT EXISTS (
    SELECT 1 FROM cpt_price_bounds b
    WHERE b.cpt_code = p.cpt_code
    AND (
      pr.price < CASE lower(pr.price_type)
                   WHEN 'negotiated' THEN COALESCE(b.min_negotiated, b.min_cash)
                   WHEN 'gross'      THEN COALESCE(b.min_gross, b.min_cash)
                   ELSE b.min_cash END
      OR
      pr.price > CASE lower(pr.price_type)
                   WHEN 'negotiated' THEN COALESCE(b.max_negotiated, b.max_cash)
                   WHEN 'gross'      THEN COALESCE(b.max_gross, b.max_cash)
                   ELSE b.max_cash END
    )
  )`;

async function main() {
  const cptCodes = (process.argv[2] || '47562,47563').split(',').map((s) => s.trim());
  console.log(`\n=== Diagnosing CPT ${cptCodes.join(', ')} ===\n`);

  // 1. Total DFW hospitals
  const totalH = await pool.query(`SELECT COUNT(*)::int AS n FROM hospitals`);
  console.log(`Total hospitals in DB: ${totalH.rows[0].n}`);

  // 2. Hospitals that appear in /search results (exact query logic from server.js)
  const shown = await pool.query(`
    SELECT h.id, h.name,
      MIN(pr.price) FILTER (WHERE pr.price_type = 'cash' AND ${PRICE_IS_VALID_SQL}) as cash_price,
      COUNT(DISTINCT pr.payer_name) FILTER (WHERE pr.payer_name IS NOT NULL AND ${PRICE_IS_VALID_SQL}) as payer_count
    FROM procedures p
    JOIN prices pr ON pr.procedure_id = p.id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE p.cpt_code = ANY($1::text[])
      AND p.standard_name NOT ILIKE '%hchg%'
      AND pr.price > 5 AND pr.price < 500000
    GROUP BY h.id, h.name
    HAVING MIN(pr.price) FILTER (WHERE pr.price_type = 'cash' AND ${PRICE_IS_VALID_SQL}) IS NOT NULL
      OR COUNT(DISTINCT pr.payer_name) FILTER (WHERE pr.payer_name IS NOT NULL AND ${PRICE_IS_VALID_SQL}) > 0
  `, [cptCodes]);
  const shownIds = new Set(shown.rows.map((r) => r.id));
  console.log(`Hospitals shown by /search: ${shown.rows.length}\n`);

  // 3. ALL hospitals with ANY price row for this CPT (regardless of validity/type)
  const anyData = await pool.query(`
    SELECT h.id, h.name,
      COUNT(*)::int AS total_rows,
      COUNT(*) FILTER (WHERE pr.price_type = 'cash')::int AS cash_rows,
      COUNT(*) FILTER (WHERE pr.price_type = 'gross')::int AS gross_rows,
      COUNT(*) FILTER (WHERE pr.price_type = 'negotiated')::int AS negotiated_rows,
      COUNT(*) FILTER (WHERE pr.payer_name IS NOT NULL)::int AS rows_with_payer,
      COUNT(*) FILTER (WHERE pr.is_suspicious IS TRUE)::int AS flagged_rows,
      COUNT(*) FILTER (WHERE pr.price <= 5 OR pr.price >= 500000)::int AS out_of_range_rows
    FROM procedures p
    JOIN prices pr ON pr.procedure_id = p.id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE p.cpt_code = ANY($1::text[])
    GROUP BY h.id, h.name
    ORDER BY h.name
  `, [cptCodes]);

  console.log(`Hospitals with ANY price row for this CPT: ${anyData.rows.length}`);
  console.log(`Hospitals with ZERO price rows at all: ${totalH.rows[0].n - anyData.rows.length}\n`);

  // 4. The gap: has data, but excluded from /search
  const excluded = anyData.rows.filter((r) => !shownIds.has(r.id));
  console.log(`=== EXCLUDED despite having price rows (${excluded.length}) ===`);
  if (excluded.length === 0) {
    console.log('None — every hospital with data is being shown. The 14 missing are a real data gap (no MRF scrape for this CPT), not a bug.\n');
  } else {
    excluded.forEach((r) => {
      const reasons = [];
      if (r.cash_rows > 0) reasons.push(`${r.cash_rows} cash rows exist but all flagged/out-of-bounds`);
      if (r.gross_rows > 0 && r.rows_with_payer === 0) reasons.push(`${r.gross_rows} gross rows but NO payer_name (invisible to HAVING clause)`);
      if (r.negotiated_rows > 0 && r.rows_with_payer === 0) reasons.push(`${r.negotiated_rows} negotiated rows but NO payer_name`);
      if (r.flagged_rows === r.total_rows) reasons.push('ALL rows flagged is_suspicious');
      if (r.out_of_range_rows === r.total_rows) reasons.push('ALL rows outside 5-500000 range');
      console.log(`  ${r.name}: ${r.total_rows} total rows (cash=${r.cash_rows} gross=${r.gross_rows} negotiated=${r.negotiated_rows}, with_payer=${r.rows_with_payer}, flagged=${r.flagged_rows}) → ${reasons.join('; ') || 'unclear — needs manual look'}`);
    });
  }

  // 5. Hospitals with truly zero rows (real gap, needs scraping)
  const anyIds = new Set(anyData.rows.map((r) => r.id));
  const zeroData = await pool.query(`SELECT id, name FROM hospitals WHERE NOT (id = ANY($1::int[])) ORDER BY name`, [[...anyIds]]);
  console.log(`\n=== ZERO price rows at all for this CPT (${zeroData.rows.length}) — real MRF/scraper gap ===`);
  zeroData.rows.forEach((r) => console.log(`  ${r.name}`));

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
