#!/usr/bin/env node
// investigate_cash_medians.js — audit EVERY hospital+CPT in the DB to answer:
// "If we show the MEDIAN cash price instead of the LOWEST, does the number
//  actually change, and by how much?"
//
// I can't reach your DB from the cloud session, so this runs the scrape for you.
// Run it locally:  node investigate_cash_medians.js
// Then paste the whole output back to me and we'll know exactly what to do.
//
// Read-only: it never writes. It counts cash rows per (hospital, CPT), compares
// MIN vs MEDIAN vs MAX, and dumps the real Baylor colonoscopy (45378) rows so we
// can see why "$414" shows for every Baylor facility.
require('dotenv').config();
const { pool } = require('./db');

// A cash price counts as "valid" the same way the live API treats it: not flagged
// suspicious, inside the sane global window, and inside its CPT's cash bounds if
// bounds exist for that CPT.
const VALID_CASH = `
  pr.price_type = 'cash'
  AND pr.is_suspicious IS NOT TRUE
  AND pr.price > 5 AND pr.price < 500000
  AND (b.cpt_code IS NULL OR (pr.price >= b.min_cash AND pr.price <= b.max_cash))
`;

async function q(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

async function main() {
  console.log('=== CASH MEDIAN AUDIT (read-only, whole DB) ===\n');

  // 1) Distribution: how many distinct cash prices exist per hospital+CPT?
  //    This is the key number — it tells us whether "median" can ever differ
  //    from "lowest".
  console.log('1) How many distinct CASH prices exist per hospital + CPT?\n');
  const dist = await q(`
    WITH valid_cash AS (
      SELECT h.id AS hospital_id, p.cpt_code, pr.price
      FROM prices pr
      JOIN procedures p ON p.id = pr.procedure_id
      JOIN hospitals h ON h.id = pr.hospital_id
      LEFT JOIN cpt_price_bounds b ON b.cpt_code = p.cpt_code
      WHERE ${VALID_CASH}
    ),
    pairs AS (
      SELECT hospital_id, cpt_code,
        COUNT(DISTINCT price) AS n_distinct,
        MIN(price) AS min_cash,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median_cash,
        MAX(price) AS max_cash
      FROM valid_cash
      GROUP BY hospital_id, cpt_code
    )
    SELECT
      COUNT(*) AS total_pairs,
      COUNT(*) FILTER (WHERE n_distinct = 1) AS one_price,
      COUNT(*) FILTER (WHERE n_distinct BETWEEN 2 AND 3) AS two_to_three,
      COUNT(*) FILTER (WHERE n_distinct >= 4) AS four_plus,
      COUNT(*) FILTER (WHERE median_cash > min_cash * 1.1) AS median_10pct_above_floor,
      ROUND(AVG(n_distinct)::numeric, 2) AS avg_distinct_prices
    FROM pairs
  `);
  const d = dist[0] || {};
  const total = Number(d.total_pairs) || 0;
  const pct = (n) => (total ? `${Math.round((Number(n) / total) * 100)}%` : '0%');
  console.log(`   total hospital+CPT pairs with a valid cash price : ${total}`);
  console.log(`   ...with exactly ONE cash price                   : ${d.one_price} (${pct(d.one_price)})`);
  console.log(`   ...with 2–3 distinct cash prices                 : ${d.two_to_three} (${pct(d.two_to_three)})`);
  console.log(`   ...with 4+ distinct cash prices                  : ${d.four_plus} (${pct(d.four_plus)})`);
  console.log(`   ...where MEDIAN is >10% above the LOWEST          : ${d.median_10pct_above_floor} (${pct(d.median_10pct_above_floor)})`);
  console.log(`   average distinct cash prices per pair            : ${d.avg_distinct_prices}\n`);

  // 2) The biggest gaps: where showing the median instead of the floor changes
  //    the story the most.
  console.log('2) Top 15 pairs where MEDIAN cash is much higher than the LOWEST:\n');
  const gaps = await q(`
    WITH valid_cash AS (
      SELECT h.name AS hospital, p.cpt_code, p.display_name, pr.price
      FROM prices pr
      JOIN procedures p ON p.id = pr.procedure_id
      JOIN hospitals h ON h.id = pr.hospital_id
      LEFT JOIN cpt_price_bounds b ON b.cpt_code = p.cpt_code
      WHERE ${VALID_CASH}
    )
    SELECT hospital, cpt_code,
      MIN(display_name) AS name,
      COUNT(DISTINCT price) AS n,
      MIN(price)::int AS lowest,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY price))::int AS median,
      MAX(price)::int AS highest
    FROM valid_cash
    GROUP BY hospital, cpt_code
    HAVING COUNT(DISTINCT price) >= 2
    ORDER BY (percentile_cont(0.5) WITHIN GROUP (ORDER BY price) - MIN(price)) DESC
    LIMIT 15
  `);
  if (!gaps.length) {
    console.log('   (none — every hospital+CPT has a single cash price, so median = lowest)\n');
  } else {
    for (const g of gaps) {
      console.log(`   ${g.hospital} · CPT ${g.cpt_code} (${g.name}): lowest $${g.lowest} → median $${g.median} → highest $${g.highest}  [${g.n} prices]`);
    }
    console.log('');
  }

  // 3) The Baylor colonoscopy (45378) rows behind "$414".
  console.log('3) Every valid CASH price for colonoscopy (CPT 45378) at Baylor:\n');
  const baylor = await q(`
    SELECT h.name AS hospital, pr.price::int AS price, pr.payer_name, pr.is_suspicious
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE p.cpt_code = '45378' AND pr.price_type = 'cash' AND h.name ILIKE '%baylor%'
    ORDER BY h.name, pr.price
  `);
  if (!baylor.length) {
    console.log('   (no cash rows found for 45378 at Baylor — try a different CPT/name)\n');
  } else {
    for (const b of baylor) {
      const flag = b.is_suspicious ? ' [FLAGGED]' : '';
      console.log(`   ${b.hospital}: $${b.price}  (payer: ${b.payer_name || 'n/a'})${flag}`);
    }
    console.log('');
  }

  // 4) Per-Baylor min vs median for 45378 — does the fix move Baylor's number?
  console.log('4) Baylor 45378 — lowest vs median per facility:\n');
  const baylorAgg = await q(`
    SELECT h.name AS hospital,
      COUNT(DISTINCT pr.price) AS n,
      MIN(pr.price)::int AS lowest,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price))::int AS median,
      MAX(pr.price)::int AS highest
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN hospitals h ON h.id = pr.hospital_id
    LEFT JOIN cpt_price_bounds b ON b.cpt_code = p.cpt_code
    WHERE p.cpt_code = '45378' AND h.name ILIKE '%baylor%' AND ${VALID_CASH}
    GROUP BY h.name
    ORDER BY h.name
  `);
  for (const b of baylorAgg) {
    const moves = b.median > b.lowest ? '  ← median differs' : '  (single price)';
    console.log(`   ${b.hospital}: lowest $${b.lowest} → median $${b.median} [${b.n} prices]${moves}`);
  }
  console.log('');

  // Verdict.
  const onePct = total ? Math.round((Number(d.one_price) / total) * 100) : 0;
  console.log('=== WHAT THIS MEANS ===');
  if (onePct >= 80) {
    console.log(`~${onePct}% of hospital+CPT pairs have only ONE cash price. For those,`);
    console.log('"median cash" equals the number you already see — so switching MIN→median');
    console.log('will NOT change most rows. If Baylor 45378 shows "single price" above, the');
    console.log('$414 is Baylor\'s one published cash rate; the misleading part is the market');
    console.log('view, and the /search-summary median (across hospitals) is the real fix.');
  } else {
    console.log(`~${100 - onePct}% of pairs have multiple cash prices, so switching the headline`);
    console.log('from MIN to MEDIAN will visibly raise many rows off the floor. Good — the');
    console.log('code change does the job. Section 2 shows the biggest movers.');
  }
  console.log('\nPaste sections 1–4 back to me and I\'ll confirm the next step.');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('Audit failed:', e.message);
  process.exit(1);
});
