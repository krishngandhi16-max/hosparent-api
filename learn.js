// learn.js — backend for the consumer-facing "Learn" tab.
//   - Premium/deductible vs. cash-price calculator (the "are you being scammed by
//     insurance" hook from the whiteboard sketch): compares what a patient actually paid
//     (premium + deductible/out-of-pocket) against what the same procedures would have
//     cost shopping cash across every facility type we track (hospital, ASC, imaging).
//   - Insurance-news feed, served from the insurance_news table — populated by
//     refresh_insurance_news.js on a schedule, never fetched live per pageview.
//   - Static "how to get the cheapest price" guide.

const { pool } = require('./db');

async function ensureNewsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS insurance_news (
      id SERIAL PRIMARY KEY,
      headline TEXT NOT NULL,
      summary TEXT,
      source TEXT,
      story_date TEXT,
      url TEXT,
      fetched_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getInsuranceNews(limit = 10) {
  await ensureNewsTable();
  const r = await pool.query(
    `SELECT headline, summary, source, story_date, url, fetched_at
     FROM insurance_news ORDER BY fetched_at DESC LIMIT $1`,
    [limit]
  );
  return r.rows;
}

// Input: { annual_premium, annual_deductible_paid, procedures: [{cpt_code, label}] }
// Pulls the cheapest valid cash price per procedure across hospitals, ASCs, and imaging
// centers, sums it as "if you'd shopped cash," and compares to what was actually paid.
async function calculateSavings({ annual_premium = 0, annual_deductible_paid = 0, procedures = [] }) {
  const premium = Number(annual_premium) || 0;
  const deductiblePaid = Number(annual_deductible_paid) || 0;
  const amountPaid = premium + deductiblePaid;

  let cashTotal = 0;
  const breakdown = [];

  for (const proc of Array.isArray(procedures) ? procedures : []) {
    const cpt = String(proc.cpt_code || '').trim();
    if (!cpt) continue;

    const r = await pool.query(`
      SELECT MIN(price)::numeric AS min_price FROM (
        SELECT pr.price FROM prices pr
        JOIN procedures p ON p.id = pr.procedure_id
        WHERE p.cpt_code = $1 AND pr.price_type = 'cash'
          AND pr.is_suspicious IS NOT TRUE AND pr.price > 5 AND pr.price < 500000
        UNION ALL
        SELECT ap.asc_medicare_rate FROM asc_prices ap
        WHERE ap.cpt_code = $1 AND ap.asc_medicare_rate > 0
        UNION ALL
        SELECT ip.price FROM imaging_prices ip
        WHERE ip.cpt_code = $1 AND ip.is_suspicious IS NOT TRUE AND ip.price > 5
      ) x
    `, [cpt]);

    const cheapest = r.rows[0]?.min_price ? Number(r.rows[0].min_price) : null;
    if (cheapest) cashTotal += cheapest;
    breakdown.push({ cpt_code: cpt, label: proc.label || null, cheapest_cash_price: cheapest });
  }

  const couldHaveSaved = Math.max(0, amountPaid - cashTotal);

  return {
    amount_paid: Math.round(amountPaid),
    cash_shopping_total: Math.round(cashTotal),
    could_have_saved: Math.round(couldHaveSaved),
    breakdown,
    note: 'Cash-shopping total is the lowest verified cash/self-pay price we have per procedure across hospitals, ASCs, and imaging centers. It does not reflect your specific insurance discount, so this is a directional estimate, not a bill.',
  };
}

// ── verified stats for the Learn tab's charts ───────────────────────────────
// Every number here is a SQL aggregate over the hospital-published price files
// already in the database — nothing estimated, nothing model-generated. This is
// the endpoint the UI charts must read from so what a doctor sees is checkable:
// same query, same answer, with the source row counts attached.
const STATS_PROCEDURES = [
  { cpt: '45378', label: 'Colonoscopy (diagnostic)' },
  { cpt: '70551', label: 'MRI brain (no contrast)' },
  { cpt: '74177', label: 'CT abdomen & pelvis (contrast)' },
  { cpt: '29881', label: 'Knee arthroscopy (meniscectomy)' },
  { cpt: '85025', label: 'CBC blood test' },
  { cpt: '80053', label: 'Comprehensive metabolic panel' },
];

let _statsCache = null; // { at, data } — heavy aggregates over 48M rows; refresh every 6h
async function getLearnStats() {
  if (_statsCache && Date.now() - _statsCache.at < 6 * 3600 * 1000) return _statsCache.data;

  const spread = [];
  for (const { cpt, label } of STATS_PROCEDURES) {
    const r = await pool.query(`
      SELECT pr.price_type,
             MIN(pr.price)::numeric(12,2) AS min,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price)::numeric(12,2) AS median,
             MAX(pr.price)::numeric(12,2) AS max,
             COUNT(DISTINCT pr.hospital_id)::int AS hospitals,
             COUNT(*)::int AS price_rows
      FROM prices pr JOIN procedures p ON p.id = pr.procedure_id
      WHERE p.cpt_code = $1
        AND pr.is_suspicious IS NOT TRUE AND pr.price > 5 AND pr.price < 500000
        AND pr.price_type IN ('cash', 'negotiated', 'gross')
      GROUP BY pr.price_type`, [cpt]);
    if (!r.rows.length) continue;
    const byType = Object.fromEntries(r.rows.map((row) => [row.price_type, {
      min: Number(row.min), median: Number(row.median), max: Number(row.max),
      hospitals: row.hospitals, price_rows: row.price_rows,
    }]));
    spread.push({ cpt_code: cpt, label, ...byType });
  }

  const cov = await pool.query(`
    SELECT (SELECT COUNT(*)::int FROM hospitals) AS hospitals,
           (SELECT COUNT(*)::int FROM prices WHERE is_suspicious IS NOT TRUE) AS valid_prices,
           (SELECT COUNT(DISTINCT procedure_id)::int FROM prices) AS procedures,
           (SELECT MAX(mrf_last_updated)::date::text FROM hospitals) AS last_mrf_refresh`);
  let drugs = null, bundles = null;
  try { drugs = (await pool.query(`SELECT COUNT(*)::int AS n FROM drug_prices`)).rows[0].n; } catch (_) {}
  try { bundles = (await pool.query(`SELECT COUNT(*)::int AS n FROM cash_bundle_prices`)).rows[0].n; } catch (_) {}

  const data = {
    coverage: { ...cov.rows[0], drug_prices: drugs, cash_bundles: bundles },
    price_spread: spread,
    methodology: 'Computed directly from hospital machine-readable files (45 CFR 180) in our database. Min/median/max are across all valid prices of that type; flagged/out-of-bounds prices are excluded. Not estimates.',
    computed_at: new Date().toISOString(),
  };
  _statsCache = { at: Date.now(), data };
  return data;
}

// ── per-CPT price breakdown (the interchangeable-CPT chart) ────────────────
// GET /learn/price-breakdown?cpt=45378 — everything the Learn tab's "one
// procedure, four prices" chart needs, for ANY CPT code, computed live from
// the database. The by_hospital rows make the "same hospital" comparison
// honest: each row is ONE named hospital's own published gross / negotiated /
// cash prices. Medicare comes from CMS rate tables (ASC + hospital OPPS), not
// the hospital's file — labeled separately so the chart can say so.
const _breakdownCache = new Map(); // cpt -> { at, data }, 6h TTL

async function getPriceBreakdown(cptRaw) {
  const cpt = String(cptRaw || '').trim().toUpperCase();
  if (!/^[A-Z]?\d{4,5}$/.test(cpt)) throw new Error('cpt must be a 5-digit CPT or HCPCS code, e.g. 45378');
  const hit = _breakdownCache.get(cpt);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.data;

  const proc = await pool.query(
    `SELECT standard_name FROM procedures WHERE cpt_code = $1 ORDER BY id LIMIT 1`, [cpt]);

  // DFW-wide spread per price type (valid prices only — same filter /search uses)
  const summary = await pool.query(`
    SELECT pr.price_type,
           MIN(pr.price)::numeric(12,2) AS min,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price)::numeric(12,2) AS median,
           MAX(pr.price)::numeric(12,2) AS max,
           COUNT(DISTINCT pr.hospital_id)::int AS hospitals,
           COUNT(*)::int AS price_rows
    FROM prices pr JOIN procedures p ON p.id = pr.procedure_id
    WHERE p.cpt_code = $1
      AND pr.is_suspicious IS NOT TRUE AND pr.price > 5 AND pr.price < 500000
      AND pr.price_type IN ('cash', 'negotiated', 'gross')
    GROUP BY pr.price_type`, [cpt]);

  // Per-hospital rows: one named hospital's own published prices side by side.
  // Cash = that hospital's discounted-cash rate (lowest if several line items);
  // negotiated = median across its payer contracts; list = median gross.
  const byHospital = await pool.query(`
    SELECT h.name AS hospital, h.city,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price)
              FILTER (WHERE pr.price_type = 'gross'))::numeric(12,2) AS list_price,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price)
              FILTER (WHERE pr.price_type = 'negotiated'))::numeric(12,2) AS negotiated_median,
           MIN(pr.price) FILTER (WHERE pr.price_type = 'negotiated')::numeric(12,2) AS negotiated_min,
           MIN(pr.price) FILTER (WHERE pr.price_type = 'cash')::numeric(12,2) AS cash_price,
           COUNT(*) FILTER (WHERE pr.price_type = 'negotiated')::int AS payer_contracts
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE p.cpt_code = $1
      AND pr.is_suspicious IS NOT TRUE AND pr.price > 5 AND pr.price < 500000
      AND pr.price_type IN ('cash', 'negotiated', 'gross')
    GROUP BY h.id, h.name, h.city
    HAVING COUNT(DISTINCT pr.price_type) >= 2
    ORDER BY COUNT(DISTINCT pr.price_type) DESC, MIN(pr.price) ASC
    LIMIT 15`, [cpt]);

  // Medicare benchmarks from CMS rate tables already in the DB (not estimates)
  let medicare = null;
  try {
    const m = await pool.query(`
      SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY asc_medicare_rate)
                FILTER (WHERE asc_medicare_rate > 0))::numeric(12,2) AS asc_rate,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY hospital_opps_rate)
                FILTER (WHERE hospital_opps_rate > 0))::numeric(12,2) AS hospital_opps_rate
      FROM asc_prices WHERE cpt_code = $1`, [cpt]);
    const row = m.rows[0];
    if (row && (row.asc_rate || row.hospital_opps_rate)) {
      medicare = {
        asc_rate: row.asc_rate ? Number(row.asc_rate) : null,
        hospital_opps_rate: row.hospital_opps_rate ? Number(row.hospital_opps_rate) : null,
        source: 'CMS Medicare rate tables (ASC / hospital outpatient)',
      };
    }
  } catch (_) {}
  if (!medicare) {
    try {
      const m = await pool.query(`
        SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY medicare_opps_rate)
                  FILTER (WHERE medicare_opps_rate > 0))::numeric(12,2) AS opps
        FROM imaging_prices WHERE cpt_code = $1`, [cpt]);
      if (m.rows[0]?.opps) {
        medicare = { hospital_opps_rate: Number(m.rows[0].opps), asc_rate: null, source: 'CMS Medicare OPPS rate (imaging)' };
      }
    } catch (_) {}
  }

  // All-inclusive cash bundles (surgeon+anesthesia+facility — different animal,
  // labeled as such so the chart never compares them to facility-only prices)
  let bundles = [];
  try {
    const b = await pool.query(`
      SELECT provider_name, city, procedure_name, cpt_code, all_inclusive_price::numeric(12,2), includes_description
      FROM cash_bundle_prices WHERE cpt_code LIKE '%' || $1 || '%'
      ORDER BY all_inclusive_price ASC LIMIT 10`, [cpt]);
    bundles = b.rows.map((r) => ({ ...r, all_inclusive_price: Number(r.all_inclusive_price) }));
  } catch (_) {}

  const data = {
    cpt_code: cpt,
    procedure_name: proc.rows[0]?.standard_name || null,
    summary: Object.fromEntries(summary.rows.map((r) => [r.price_type, {
      min: Number(r.min), median: Number(r.median), max: Number(r.max),
      hospitals: r.hospitals, price_rows: r.price_rows,
    }])),
    by_hospital: byHospital.rows.map((r) => ({
      hospital: r.hospital, city: r.city,
      list_price: r.list_price ? Number(r.list_price) : null,
      negotiated_median: r.negotiated_median ? Number(r.negotiated_median) : null,
      negotiated_min: r.negotiated_min ? Number(r.negotiated_min) : null,
      cash_price: r.cash_price ? Number(r.cash_price) : null,
      payer_contracts: r.payer_contracts,
    })),
    medicare,
    cash_bundles: bundles,
    methodology: 'Hospital prices come from each hospital’s federally required machine-readable file (45 CFR 180); flagged/out-of-bounds prices are excluded. Medicare figures are CMS rate-table benchmarks, not hospital-published. All-inclusive bundles cover facility + surgeon + anesthesia and are not comparable to facility-only prices.',
    computed_at: new Date().toISOString(),
  };
  if (_breakdownCache.size > 200) _breakdownCache.clear();
  _breakdownCache.set(cpt, { at: Date.now(), data });
  return data;
}

const HOW_TO_SAVE_GUIDE = [
  {
    title: 'Ask for the cash/self-pay price, not the "sticker" price',
    body: 'Hospitals and ASCs often have a cash price well below their billed charge. Ask specifically for the "self-pay" or "cash-pay" rate before scheduling.',
  },
  {
    title: 'Consider an ASC or imaging center instead of a hospital',
    body: 'The same procedure at a hospital outpatient department gets billed with an added facility fee. An independent ASC or imaging center doing the identical procedure is frequently 40-70% cheaper.',
  },
  {
    title: 'Get the CPT code before you call around',
    body: "Ask your doctor's office for the exact CPT code of the procedure. Quoting the CPT code (not just a description) gets you an apples-to-apples price when you call multiple facilities.",
  },
  {
    title: 'Ask about bundled/package pricing',
    body: 'Many cash-pay procedures (colonoscopies, imaging, minor surgery) are quoted as an all-in bundle covering facility, anesthesia, and physician fees. Confirm what is and is not included before you agree to a price.',
  },
  {
    title: 'Negotiate — even after the bill arrives',
    body: 'Hospital billing departments frequently accept less than the billed amount, especially for self-pay patients or as a lump-sum payment. Ask for a self-pay discount or a payment plan with no interest.',
  },
];

module.exports = { calculateSavings, getInsuranceNews, ensureNewsTable, getLearnStats, getPriceBreakdown, HOW_TO_SAVE_GUIDE };
