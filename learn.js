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
  { cpt: '45380', label: 'Colonoscopy with biopsy' },
  { cpt: '43239', label: 'Upper GI endoscopy with biopsy' },
  { cpt: '70551', label: 'MRI brain (no contrast)' },
  { cpt: '72148', label: 'MRI lumbar spine (no contrast)' },
  { cpt: '73721', label: 'MRI knee / leg joint (no contrast)' },
  { cpt: '74177', label: 'CT abdomen & pelvis (with contrast)' },
  { cpt: '70450', label: 'CT head (no contrast)' },
  { cpt: '29827', label: 'Shoulder arthroscopy (rotator cuff)' },
  { cpt: '66984', label: 'Cataract surgery (one eye)' },
  { cpt: '85025', label: 'CBC blood test' },
  { cpt: '80053', label: 'Comprehensive metabolic panel' },
  { cpt: '93000', label: 'EKG (electrocardiogram)' },
  { cpt: '76700', label: 'Abdominal ultrasound' },
  { cpt: '59400', label: 'Vaginal delivery (routine)' },
];

// Format a number as whole dollars ("$2,774"), or null so the UI shows a real
// value or an explicit label — never a blank cell or "$NaN".
const fmtUSD = (n) => (n == null || !Number.isFinite(Number(n)) ? null : '$' + Math.round(Number(n)).toLocaleString('en-US'));
const round1 = (n) => Math.round(Number(n) * 10) / 10;

// Turn one normalized {cash,negotiated,gross} spread item into flat, pre-computed,
// pre-formatted fields the charts render directly. The spread (low→high) is CASH
// vs CASH — same price type, apples to apples — so the "N× more" figure is honest.
function enrichSpreadItem(item) {
  const cash = item.cash, neg = item.negotiated, list = item.gross;
  const low = cash?.min ?? null, median = cash?.median ?? null, high = cash?.max ?? null;
  const ratio = low && high && low > 0 ? round1(high / low) : null;
  const savings = low != null && high != null ? Math.round(high - low) : null;
  const hospitals = Math.max(cash?.hospitals || 0, neg?.hospitals || 0, list?.hospitals || 0) || null;
  return {
    ...item,
    hospitals,
    // flat cash range (what the spread chart + table bind to)
    low, median, high,
    spread_ratio: ratio,
    spread_ratio_label: ratio ? `${ratio}×` : null,
    savings,
    // pre-formatted strings so the frontend never does arithmetic (no NaN)
    display: {
      low: fmtUSD(low), median: fmtUSD(median), high: fmtUSD(high),
      savings: fmtUSD(savings), spread: ratio ? `${ratio}×` : null,
      cash_median: fmtUSD(cash?.median), negotiated_median: fmtUSD(neg?.median),
      list_median: fmtUSD(list?.median),
    },
    why: ratio
      ? `The cheapest DFW hospital lists ${fmtUSD(low)} cash for this; the most expensive lists ${fmtUSD(high)} — ${ratio}× more for the identical procedure (same CPT ${item.cpt_code}). What changes is the hospital's pricing power and billing department, not the medicine.`
      : null,
  };
}

// The narrative that pins the spread on the system, not the patient. Static,
// checkable claims — safe to show a clinician.
const LEARN_EXPLANATIONS = {
  why_prices_differ:
    'Hospitals set their own “chargemaster” list prices with no legal cap, then negotiate secret, wildly different rates with each insurer. A big hospital system with market leverage can charge many times what a leaner competitor down the road charges for the exact same CPT-coded procedure. None of it tracks the cost of care — it tracks billing power. Federal price-transparency law (45 CFR 180) finally forces those numbers into the open, which is the only reason we can show them to you here.',
  why_cash_can_beat_insurance:
    'The cash / self-pay price is often lower than the “negotiated” rate your insurer pays — and lower than your deductible. If you haven’t met your deductible, paying cash can cost less than running it through insurance, and it skips the insurer entirely. Hospitals are required to publish this cash price, but not to volunteer it. You have to ask.',
  who_this_helps:
    'This isn’t about blaming any one hospital — it’s a system where the same colonoscopy can be $414 or $6,169 in the same metro, and the patient is the only person in the room who wasn’t told. Knowing the number before you schedule is the whole advantage.',
};

// Always emit cash/negotiated/gross keys (null when that type has no data), so
// the UI can render every chart without null-checking three separate paths —
// a missing key was the most likely cause of a Learn-tab render crash.
const PRICE_TYPES = ['cash', 'negotiated', 'gross'];
function normalizePriceTypes(rows) {
  const byType = Object.fromEntries(rows.map((row) => [row.price_type, {
    min: Number(row.min), median: Number(row.median), max: Number(row.max),
    hospitals: row.hospitals, price_rows: row.price_rows,
  }]));
  const out = {};
  for (const t of PRICE_TYPES) out[t] = byType[t] || null;
  return out;
}

// Same per-type bounds validation the main /search uses (server.js
// PRICE_IS_VALID_PER_TYPE): drops flagged prices AND anything outside the
// curated per-type window for that CPT. Without this, procedures whose garbage
// outliers were never flagged (e.g. a $97k "cash" gallbladder) poison the
// medians. Requires `pr` (prices) and `p` (procedures) in the query's scope.
const VALID_PRICE_SQL = `
  (pr.is_suspicious IS NOT TRUE)
  AND EXISTS (SELECT 1 FROM cpt_price_bounds b WHERE b.cpt_code = p.cpt_code)
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

// Lenient variant for the "type any CPT" breakdown: applies the bounds window
// when the CPT HAS curated bounds, but still returns data for codes that don't
// (most of the 262k procedures) — flagged separately via `validated` so the UI
// can caveat unbounded codes instead of showing nothing.
const VALID_PRICE_LENIENT_SQL = `
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
        AND pr.price > 5 AND pr.price < 500000
        AND pr.price_type IN ('cash', 'negotiated', 'gross')
        AND ${VALID_PRICE_SQL}
      GROUP BY pr.price_type`, [cpt]);
    const enriched = enrichSpreadItem({ cpt_code: cpt, label, has_data: r.rows.length > 0, ...normalizePriceTypes(r.rows) });
    if (enriched.low != null && enriched.high != null) spread.push(enriched); // only rows with real cash data — never a blank cell
  }
  // Most dramatic spread first — best story for the charts and the table.
  spread.sort((a, b) => (b.spread_ratio || 0) - (a.spread_ratio || 0));

  const cov = await pool.query(`
    SELECT (SELECT COUNT(*)::int FROM hospitals) AS hospitals,
           (SELECT COUNT(*)::int FROM prices WHERE is_suspicious IS NOT TRUE) AS valid_prices,
           (SELECT COUNT(DISTINCT procedure_id)::int FROM prices) AS procedures,
           (SELECT MAX(mrf_last_updated)::date::text FROM hospitals) AS last_mrf_refresh`);
  let drugs = null, bundles = null;
  try { drugs = (await pool.query(`SELECT COUNT(*)::int AS n FROM drug_prices`)).rows[0].n; } catch (_) {}
  try { bundles = (await pool.query(`SELECT COUNT(*)::int AS n FROM cash_bundle_prices`)).rows[0].n; } catch (_) {}

  // Headline numbers for the three big stats at the top of the tab — computed,
  // formatted, never blank when we have any data.
  const topSpread = spread[0] || null;
  const topSavings = spread.slice().sort((a, b) => (b.savings || 0) - (a.savings || 0))[0] || null;
  const c = cov.rows[0];
  const headline_stats = {
    hospitals_tracked: c.hospitals,
    hospitals_tracked_display: c.hospitals != null ? `${c.hospitals}` : null,
    total_prices: c.valid_prices,
    total_prices_display: c.valid_prices != null ? Number(c.valid_prices).toLocaleString('en-US') : null,
    procedures_tracked: c.procedures,
    procedures_tracked_display: c.procedures != null ? Number(c.procedures).toLocaleString('en-US') : null,
    max_spread_ratio: topSpread?.spread_ratio ?? null,
    max_spread_display: topSpread?.spread_ratio_label ?? null,
    max_spread_procedure: topSpread?.label ?? null,
    max_savings: topSavings?.savings ?? null,
    max_savings_display: topSavings ? fmtUSD(topSavings.savings) : null,
    max_savings_procedure: topSavings?.label ?? null,
  };

  const data = {
    coverage: { ...c, drug_prices: drugs, cash_bundles: bundles },
    headline_stats,
    price_spread: spread,
    explanations: LEARN_EXPLANATIONS,
    methodology: 'Computed directly from hospital machine-readable files (45 CFR 180) in our database. The spread is cash-price low to cash-price high across DFW hospitals (same price type, apples to apples); flagged/out-of-bounds prices are excluded. Not estimates.',
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
  // Does this CPT have curated bounds? If not, prices are shown but flagged as
  // not-yet-validated so the UI can caveat them (honest > pretty for a clinician).
  const validated = (await pool.query(
    `SELECT 1 FROM cpt_price_bounds WHERE cpt_code = $1 LIMIT 1`, [cpt])).rows.length > 0;

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
      AND pr.price > 5 AND pr.price < 500000
      AND pr.price_type IN ('cash', 'negotiated', 'gross')
      AND ${VALID_PRICE_LENIENT_SQL}
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
      AND pr.price > 5 AND pr.price < 500000
      AND pr.price_type IN ('cash', 'negotiated', 'gross')
      AND ${VALID_PRICE_LENIENT_SQL}
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

  const summaryNorm = normalizePriceTypes(summary.rows);
  const byHospitalRows = byHospital.rows.map((r) => ({
    hospital: r.hospital, city: r.city,
    list_price: r.list_price ? Number(r.list_price) : null,
    negotiated_median: r.negotiated_median ? Number(r.negotiated_median) : null,
    negotiated_min: r.negotiated_min ? Number(r.negotiated_min) : null,
    cash_price: r.cash_price ? Number(r.cash_price) : null,
    payer_contracts: r.payer_contracts,
  }));

  // DFW-wide "four typical prices" — always populated when the procedure has
  // data, because it uses the median across ALL hospitals (not one that might
  // be missing a price type). This is what Chart 1 / Chart 3 should show so
  // nothing ever renders blank.
  const medicareRate = medicare ? (medicare.hospital_opps_rate || medicare.asc_rate) : null;
  const typical = {
    list: summaryNorm.gross?.median ?? null,
    negotiated: summaryNorm.negotiated?.median ?? null,
    cash: summaryNorm.cash?.median ?? null,
    cash_low: summaryNorm.cash?.min ?? null,
    medicare: medicareRate,
    hospitals: summaryNorm.cash?.hospitals ?? summaryNorm.gross?.hospitals ?? null,
    display: {
      list: fmtUSD(summaryNorm.gross?.median), negotiated: fmtUSD(summaryNorm.negotiated?.median),
      cash: fmtUSD(summaryNorm.cash?.median), cash_low: fmtUSD(summaryNorm.cash?.min),
      medicare: fmtUSD(medicareRate),
    },
  };

  // A single named hospital that actually has all three price types, for the
  // "four prices at [Hospital]" story — never one missing negotiated/list.
  const featured_hospital = byHospitalRows.find(
    (h) => h.cash_price != null && h.negotiated_median != null && h.list_price != null
  ) || byHospitalRows[0] || null;

  const data = {
    cpt_code: cpt,
    procedure_name: proc.rows[0]?.standard_name || null,
    has_data: summary.rows.length > 0,
    validated,
    validated_note: validated ? null : 'This code does not yet have curated price bounds — figures are shown from published files but are not bounds-validated.',
    summary: summaryNorm,
    typical,
    featured_hospital,
    by_hospital: byHospitalRows,
    medicare,
    cash_bundles: bundles,
    explanation: LEARN_EXPLANATIONS.why_prices_differ,
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
