// pipeline/01_audit.js — evaluate EVERY price row against per-procedure evidence.
//
//   node pipeline/01_audit.js                 -> DRY RUN: builds work tables,
//                                                prints what WOULD change, changes nothing in
//                                                prices/procedures
//   node pipeline/01_audit.js --apply         -> applies flags in batches, verifies each step
//   node pipeline/01_audit.js --apply --unflag-pattern "20x%"
//                                             -> additionally UN-flags rows whose only reason
//                                                matches the pattern and which this smarter
//                                                audit considers fine (use to undo the blunt
//                                                fix_all_leaks 20x pass; get the exact pattern
//                                                from 00_preflight's validation_reason list)
//
// WHAT IT DOES (all evidence-based, all non-destructive):
//   A. benchmarks   — per-CPT Medicare benchmark (procedures.medicare_* first,
//                     medicare_rates as fallback, columns detected at runtime)
//   B. cohorts      — per CPT x price_type percentiles over the real data
//   C. name match   — procedures.standard_name vs medicare_rates.short_description
//                     (pg_trgm similarity, or JS token-overlap fallback)
//   D. setting leaks— DRG-bundle-named procedures carrying outpatient CPTs
//   E. price rules  — banded Medicare multiples (NOT a blanket 20x):
//                       bench <= $50   -> flag above 80x   (labs/EKGs: high multiples are normal)
//                       bench <= $200  -> flag above 50x
//                       bench <= $1000 -> flag above 30x
//                       bench >  $1000 -> flag above 20x   (big surgery: 20x really is absurd)
//                     plus impossibly-low, sub-dollar, and per-type hand-bounds rules
//   F. confidence   — 0-100 mapping_confidence per procedure
//
// THE "DON'T HIDE REAL PRICES" RULE (hard rule 5, mechanized):
//   A high price whose procedure NAME correctly matches its CPT (good mapping)
//   is NOT auto-flagged — it goes to audit_review_queue for a human decision.
//   Only high prices with bad/DRG/mismatched names get auto-flagged.
//
// Re-runnable: every flag it writes is prefixed 'AUDIT:'. On each run, stale
// 'AUDIT:' flags whose rows no longer trip any rule are automatically removed.
// It never touches flags written by other systems (bounds, hand fixes) unless
// you explicitly pass --unflag-pattern.

const { pool, q, one, assertSchema, tableExists, tableColumns, hasColumn,
        countBefore, applyInBatches, verifyAfter, writeReport } = require('./db');

const APPLY = process.argv.includes('--apply');
const UNFLAG_PATTERN = (() => {
  const i = process.argv.indexOf('--unflag-pattern');
  return i > -1 ? process.argv[i + 1] : null;
})();

const CONFIG = {
  bands: [ // [maxBench, allowedMultiple]
    [50, 80], [200, 50], [1000, 30], [Infinity, 20],
  ],
  cohortHighGuard: 4,      // price must ALSO exceed cohort p75 x this to flag high
  lowRatio: 0.10,          // below 10% of Medicare = impossibly cheap
  lowMinBench: 100,        // only apply low rule when benchmark >= $100 (labs are noisy)
  goodNameSim: 0.45,       // name-vs-CPT-description similarity >= this = "well mapped"
  drgNameRegex: "(with mcc|w/mcc|w mcc|without cc|w/o cc|with cc|w cc|w/o mcc|\\bdrg\\b|>96 (hours|hrs)|o\\.?r\\.? procedure|major joint replacement|septicemia|system diagnosis|procedures with|diagnoses)",
  batchSize: 500000,
};

function bandCaseSql(benchExpr) {
  // returns SQL CASE giving the allowed multiple for a benchmark value
  const parts = CONFIG.bands
    .map(([max, mult]) => max === Infinity ? `ELSE ${mult}` : `WHEN ${benchExpr} <= ${max} THEN ${mult}`);
  return `CASE ${parts.slice(0, -1).join(' ')} ${parts[parts.length - 1]} END`;
}

async function detectMedicareRatesShape() {
  if (!(await tableExists('medicare_rates'))) return null;
  const cols = (await tableColumns('medicare_rates')).map(c => c.column_name);
  const codeCol = ['cpt_code', 'hcpcs_code', 'hcpcs', 'code'].find(c => cols.includes(c));
  const rateCol = ['facility_rate', 'non_facility_rate', 'payment_rate', 'rate', 'national_payment'].find(c => cols.includes(c));
  const descCol = ['short_description', 'description', 'short_desc'].find(c => cols.includes(c));
  if (!codeCol) return null;
  return { codeCol, rateCol, descCol, cols };
}

async function main() {
  console.log(`PIPELINE 01 — AUDIT ${APPLY ? '(APPLY MODE)' : '(DRY RUN — nothing will change)'}`);
  console.log('='.repeat(60));
  const report = { at: new Date().toISOString(), apply: APPLY, stages: {} };

  await assertSchema('prices', ['id', 'procedure_id', 'price', 'price_type', 'is_suspicious', 'validation_reason']);
  await assertSchema('procedures', ['id', 'cpt_code', 'standard_name', 'medicare_facility_rate', 'medicare_non_facility_rate']);
  const mr = await detectMedicareRatesShape();
  console.log(`medicare_rates shape: ${mr ? JSON.stringify({ codeCol: mr.codeCol, rateCol: mr.rateCol, descCol: mr.descCol }) : 'unavailable — using procedures.medicare_* only'}`);

  // ── A. benchmarks ───────────────────────────────────────────────────────
  console.log('\n[A] Building audit_benchmarks (per CPT)...');
  await q(`DROP TABLE IF EXISTS audit_benchmarks`);
  await q(`
    CREATE UNLOGGED TABLE audit_benchmarks AS
    SELECT cpt_code, MAX(bench) AS bench FROM (
      SELECT cpt_code, COALESCE(medicare_facility_rate, medicare_non_facility_rate) AS bench
      FROM procedures WHERE cpt_code IS NOT NULL
        AND COALESCE(medicare_facility_rate, medicare_non_facility_rate) > 0
      ${mr && mr.rateCol ? `UNION ALL
      SELECT ${mr.codeCol}::text, NULLIF(${mr.rateCol}::numeric, 0) FROM medicare_rates WHERE ${mr.rateCol} IS NOT NULL` : ''}
    ) s WHERE bench IS NOT NULL GROUP BY cpt_code`);
  await q(`CREATE INDEX ON audit_benchmarks(cpt_code)`);
  const nb = await one(`SELECT COUNT(*) AS n FROM audit_benchmarks`);
  console.log(`  ${Number(nb.n).toLocaleString()} CPTs have a Medicare benchmark`);
  report.stages.benchmarks = Number(nb.n);

  // ── B. cohorts ──────────────────────────────────────────────────────────
  console.log('\n[B] Building audit_cohorts (per CPT x price_type percentiles over 48.6M rows — slowest step)...');
  await q(`DROP TABLE IF EXISTS audit_cohorts`);
  await q(`
    CREATE UNLOGGED TABLE audit_cohorts AS
    SELECT p.cpt_code, pr.price_type, COUNT(*) AS n,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY pr.price) AS p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY pr.price) AS median,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY pr.price) AS p75,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY pr.price) AS p95
    FROM prices pr JOIN procedures p ON p.id = pr.procedure_id
    WHERE pr.price > 0 AND p.cpt_code IS NOT NULL
    GROUP BY p.cpt_code, pr.price_type`);
  await q(`CREATE INDEX ON audit_cohorts(cpt_code, price_type)`);
  const nc = await one(`SELECT COUNT(*) AS n FROM audit_cohorts`);
  console.log(`  ${Number(nc.n).toLocaleString()} cohorts`);
  report.stages.cohorts = Number(nc.n);

  // ── C. name-vs-CPT match ────────────────────────────────────────────────
  console.log('\n[C] Scoring name-vs-CPT match...');
  let simAvailable = false;
  if (mr && mr.descCol) {
    try { await q(`CREATE EXTENSION IF NOT EXISTS pg_trgm`); simAvailable = true; }
    catch (e) { console.log(`  pg_trgm unavailable (${e.message}) — using JS token overlap`); }
  }
  await q(`DROP TABLE IF EXISTS audit_name_match`);
  await q(`CREATE UNLOGGED TABLE audit_name_match (procedure_id BIGINT PRIMARY KEY, cpt_code TEXT, sim REAL, is_drg_name BOOLEAN)`);
  if (mr && mr.descCol && simAvailable) {
    await q(`
      INSERT INTO audit_name_match
      SELECT p.id, p.cpt_code,
             MAX(similarity(lower(p.standard_name), lower(m.${mr.descCol}))) AS sim,
             p.standard_name ~* $1 AS is_drg_name
      FROM procedures p
      JOIN medicare_rates m ON m.${mr.codeCol}::text = p.cpt_code
      WHERE p.cpt_code IS NOT NULL AND p.standard_name IS NOT NULL
      GROUP BY p.id, p.cpt_code, p.standard_name`, [CONFIG.drgNameRegex]);
  } else if (mr && mr.descCol) {
    // JS fallback: Dice coefficient over word sets (only ~tens of thousands of pairs)
    const pairs = await q(`
      SELECT p.id, p.cpt_code, lower(p.standard_name) AS name,
             lower(string_agg(m.${mr.descCol}, ' ')) AS descr,
             p.standard_name ~* $1 AS is_drg_name
      FROM procedures p JOIN medicare_rates m ON m.${mr.codeCol}::text = p.cpt_code
      WHERE p.cpt_code IS NOT NULL AND p.standard_name IS NOT NULL
      GROUP BY p.id, p.cpt_code, p.standard_name`, [CONFIG.drgNameRegex]);
    const tok = s => new Set(String(s).split(/[^a-z0-9]+/).filter(w => w.length > 2));
    for (let i = 0; i < pairs.rows.length; i += 1000) {
      const chunk = pairs.rows.slice(i, i + 1000);
      const values = chunk.map(r => {
        const a = tok(r.name), b = tok(r.descr);
        let shared = 0; for (const w of a) if (b.has(w)) shared++;
        const sim = (a.size + b.size) ? (2 * shared) / (a.size + b.size) : 0;
        return `(${r.id}, '${r.cpt_code.replace(/'/g, "''")}', ${sim.toFixed(3)}, ${r.is_drg_name})`;
      });
      await q(`INSERT INTO audit_name_match VALUES ${values.join(',')}`);
    }
  } else {
    await q(`
      INSERT INTO audit_name_match
      SELECT id, cpt_code, NULL, standard_name ~* $1 FROM procedures
      WHERE cpt_code IS NOT NULL AND standard_name IS NOT NULL`, [CONFIG.drgNameRegex]);
  }
  const nm = await one(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE is_drg_name) AS drg, COUNT(*) FILTER (WHERE sim >= ${CONFIG.goodNameSim}) AS well_mapped FROM audit_name_match`);
  console.log(`  ${Number(nm.n).toLocaleString()} procedures scored | DRG-named: ${Number(nm.drg).toLocaleString()} | well-mapped names: ${Number(nm.well_mapped).toLocaleString()}`);
  report.stages.name_match = nm;

  // ── D. setting leaks (procedure level) ──────────────────────────────────
  console.log('\n[D] Detecting setting leaks (DRG-bundle names on outpatient CPT codes)...');
  await q(`DROP TABLE IF EXISTS audit_setting_leaks`);
  await q(`
    CREATE UNLOGGED TABLE audit_setting_leaks AS
    SELECT p.id AS procedure_id, p.cpt_code, p.standard_name, b.bench,
           c.median AS cohort_median
    FROM procedures p
    LEFT JOIN audit_benchmarks b ON b.cpt_code = p.cpt_code
    LEFT JOIN audit_cohorts c ON c.cpt_code = p.cpt_code AND c.price_type = 'negotiated'
    WHERE p.cpt_code ~ '^[0-9]{4}[0-9A-Z]$'
      AND p.standard_name ~* $1`, [CONFIG.drgNameRegex]);
  const sl = await one(`SELECT COUNT(*) AS n FROM audit_setting_leaks`);
  console.log(`  ${Number(sl.n).toLocaleString()} procedures have DRG-bundle names on CPT codes -> setting should be 'inpatient'`);
  report.stages.setting_leaks = Number(sl.n);

  // ── E. price rules -> candidate flags ───────────────────────────────────
  console.log('\n[E] Evaluating price rules across all clean rows...');
  await q(`DROP TABLE IF EXISTS audit_price_flags`);
  await q(`CREATE UNLOGGED TABLE audit_price_flags (price_id BIGINT, rule TEXT, reason TEXT)`);

  const bandSql = bandCaseSql('b.bench');

  // E1: high vs Medicare, banded, cohort-guarded, and NOT well-name-mapped
  //     (well-mapped high prices go to the review queue instead — rule 5)
  await q(`
    INSERT INTO audit_price_flags
    SELECT pr.id, 'HIGH_VS_MEDICARE',
           'AUDIT: ' || ROUND(pr.price / b.bench) || 'x medicare $' || ROUND(b.bench) ||
           ' (limit ' || (${bandSql}) || 'x' ||
           CASE WHEN nm.is_drg_name THEN ', DRG-named' ELSE '' END || ')'
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN audit_benchmarks b ON b.cpt_code = p.cpt_code
    JOIN audit_cohorts c ON c.cpt_code = p.cpt_code AND c.price_type = pr.price_type
    LEFT JOIN audit_name_match nm ON nm.procedure_id = p.id
    WHERE pr.is_suspicious IS NOT TRUE
      AND pr.price > b.bench * (${bandSql})
      AND pr.price > c.p75 * ${CONFIG.cohortHighGuard}
      AND (nm.sim IS NULL OR nm.sim < ${CONFIG.goodNameSim} OR nm.is_drg_name)`);

  // E2: impossibly low (unit errors, professional-fee fragments under surgical CPTs)
  await q(`
    INSERT INTO audit_price_flags
    SELECT pr.id, 'LOW_VS_MEDICARE',
           'AUDIT: ' || ROUND(100 * pr.price / b.bench) || '% of medicare $' || ROUND(b.bench) || ' (impossibly low)'
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN audit_benchmarks b ON b.cpt_code = p.cpt_code
    WHERE pr.is_suspicious IS NOT TRUE
      AND b.bench >= ${CONFIG.lowMinBench}
      AND pr.price > 0 AND pr.price < b.bench * ${CONFIG.lowRatio}
      AND pr.price_type IN ('cash', 'negotiated')`);

  // E3: sub-dollar artifacts in cohorts that clearly aren't sub-dollar
  await q(`
    INSERT INTO audit_price_flags
    SELECT pr.id, 'SUB_DOLLAR', 'AUDIT: sub-dollar artifact (cohort median $' || ROUND(c.median) || ')'
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN audit_cohorts c ON c.cpt_code = p.cpt_code AND c.price_type = pr.price_type
    WHERE pr.is_suspicious IS NOT TRUE AND pr.price < 1 AND c.median > 20`);

  // E4: hand-set bounds (per price_type where the columns exist)
  if (await tableExists('cpt_price_bounds')) {
    const bcols = (await tableColumns('cpt_price_bounds')).map(c => c.column_name);
    const typed = bcols.includes('min_negotiated');
    await q(`
      INSERT INTO audit_price_flags
      SELECT pr.id, 'HAND_BOUNDS',
             'AUDIT: outside hand bounds for ' || pr.price_type
      FROM prices pr
      JOIN procedures p ON p.id = pr.procedure_id
      JOIN cpt_price_bounds b ON b.cpt_code = p.cpt_code
      WHERE pr.is_suspicious IS NOT TRUE
        AND CASE pr.price_type
          ${typed ? `
          WHEN 'cash' THEN pr.price < b.min_cash OR pr.price > b.max_cash
          WHEN 'negotiated' THEN pr.price < COALESCE(b.min_negotiated, b.min_cash * 0.3) OR pr.price > COALESCE(b.max_negotiated, b.max_cash)
          WHEN 'gross' THEN pr.price < COALESCE(b.min_gross, b.min_cash) OR pr.price > COALESCE(b.max_gross, b.max_cash * 1.5)` : `
          WHEN 'cash' THEN pr.price < b.min_cash OR pr.price > b.max_cash
          WHEN 'negotiated' THEN pr.price < b.min_cash * 0.3 OR pr.price > b.max_cash
          WHEN 'gross' THEN pr.price < b.min_cash OR pr.price > b.max_cash * 1.5`}
          ELSE false END`);
  }

  await q(`CREATE INDEX ON audit_price_flags(price_id)`);
  const flagSummary = await q(`SELECT rule, COUNT(*) AS n FROM audit_price_flags GROUP BY rule ORDER BY n DESC`);
  report.stages.price_flags = flagSummary.rows;
  console.log('  Candidate flags by rule:');
  for (const r of flagSummary.rows) console.log(`    ${r.rule}: ${Number(r.n).toLocaleString()}`);

  // Review queue: high prices that are WELL-mapped (persisted, human decides)
  await q(`
    CREATE TABLE IF NOT EXISTS audit_review_queue (
      cpt_code TEXT, price_type TEXT, n_rows BIGINT, bench NUMERIC,
      cohort_median NUMERIC, cohort_p95 NUMERIC, example_name TEXT,
      reason TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await q(`TRUNCATE audit_review_queue`);
  await q(`
    INSERT INTO audit_review_queue (cpt_code, price_type, n_rows, bench, cohort_median, cohort_p95, example_name, reason)
    SELECT p.cpt_code, pr.price_type, COUNT(*), MAX(b.bench), MAX(c.median), MAX(c.p95), MIN(p.standard_name),
           'high vs medicare but name matches CPT — human decision needed (hard rule 5)'
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN audit_benchmarks b ON b.cpt_code = p.cpt_code
    JOIN audit_cohorts c ON c.cpt_code = p.cpt_code AND c.price_type = pr.price_type
    JOIN audit_name_match nm ON nm.procedure_id = p.id
    WHERE pr.is_suspicious IS NOT TRUE
      AND pr.price > b.bench * (${bandSql})
      AND pr.price > c.p75 * ${CONFIG.cohortHighGuard}
      AND nm.sim >= ${CONFIG.goodNameSim} AND NOT nm.is_drg_name
    GROUP BY p.cpt_code, pr.price_type`);
  const rq = await one(`SELECT COUNT(*) AS n, COALESCE(SUM(n_rows),0) AS rows FROM audit_review_queue`);
  console.log(`  Review queue (NOT auto-flagged, needs your eyes): ${Number(rq.n).toLocaleString()} cohorts / ${Number(rq.rows).toLocaleString()} rows -> SELECT * FROM audit_review_queue ORDER BY n_rows DESC;`);
  report.stages.review_queue = rq;

  if (!APPLY) {
    const sample = await q(`
      SELECT f.rule, f.reason, pr.price, p.cpt_code, p.standard_name
      FROM audit_price_flags f JOIN prices pr ON pr.id = f.price_id
      JOIN procedures p ON p.id = pr.procedure_id ORDER BY random() LIMIT 20`);
    console.log('\nDRY RUN SAMPLE of would-be flags:');
    for (const r of sample.rows) console.log(`  [${r.rule}] ${r.cpt_code} ${String(r.standard_name).slice(0, 40)} $${r.price} — ${r.reason}`);
    writeReport('audit_dryrun', report);
    console.log('\nDRY RUN COMPLETE — nothing changed. Re-run with --apply to write flags.');
    await pool.end();
    return;
  }

  // ── F. APPLY (rule 2: count -> apply in batches -> verify) ──────────────
  console.log('\n[F] APPLYING (batched, non-destructive)...');

  // F0: ensure flag columns exist
  for (const [col, ddl] of [
    ['setting', `ALTER TABLE procedures ADD COLUMN IF NOT EXISTS setting TEXT`],
    ['mapping_confidence', `ALTER TABLE procedures ADD COLUMN IF NOT EXISTS mapping_confidence INT`],
  ]) { await q(ddl); }

  // F1: price flags
  const expected = await countBefore('new price flags',
    `SELECT COUNT(DISTINCT f.price_id) AS n FROM audit_price_flags f
     JOIN prices pr ON pr.id = f.price_id WHERE pr.is_suspicious IS NOT TRUE`);
  const applied = await applyInBatches({
    label: 'flag prices', workTable: 'audit_price_flags', batchSize: CONFIG.batchSize,
    applySqlFn: (lo, hi) => ({
      sql: `UPDATE prices pr
            SET is_suspicious = true,
                validation_reason = f.reason
            FROM (SELECT DISTINCT ON (price_id) price_id, reason FROM audit_price_flags
                  WHERE price_id BETWEEN $1 AND $2 ORDER BY price_id, rule) f
            WHERE pr.id = f.price_id AND pr.is_suspicious IS NOT TRUE`,
      params: [lo, hi],
    }),
  });
  console.log(`  Applied ${applied.toLocaleString()} flags (expected ${expected.toLocaleString()})`);
  await verifyAfter('all candidates now flagged',
    `SELECT COUNT(*) AS n FROM audit_price_flags f JOIN prices pr ON pr.id = f.price_id
     WHERE pr.is_suspicious IS NOT TRUE`);
  report.stages.applied_flags = applied;

  // F2: remove stale AUDIT flags (re-runnability / self-correction)
  await q(`DROP TABLE IF EXISTS audit_stale`);
  await q(`
    CREATE UNLOGGED TABLE audit_stale AS
    SELECT pr.id AS price_id FROM prices pr
    WHERE pr.is_suspicious IS TRUE AND pr.validation_reason LIKE 'AUDIT:%'
      AND NOT EXISTS (SELECT 1 FROM audit_price_flags f WHERE f.price_id = pr.id)`);
  const staleN = await countBefore('stale AUDIT flags to remove', `SELECT COUNT(*) AS n FROM audit_stale`);
  if (staleN > 0) {
    const unflagged = await applyInBatches({
      label: 'unflag stale', workTable: 'audit_stale', batchSize: CONFIG.batchSize,
      applySqlFn: (lo, hi) => ({
        sql: `UPDATE prices pr SET is_suspicious = false, validation_reason = NULL
              FROM (SELECT price_id FROM audit_stale WHERE price_id BETWEEN $1 AND $2) s
              WHERE pr.id = s.price_id AND pr.validation_reason LIKE 'AUDIT:%'`,
        params: [lo, hi],
      }),
    });
    await verifyAfter('stale flags removed',
      `SELECT COUNT(*) AS n FROM audit_stale s JOIN prices pr ON pr.id = s.price_id
       WHERE pr.is_suspicious IS TRUE AND pr.validation_reason LIKE 'AUDIT:%'`);
    report.stages.unflagged_stale = unflagged;
  }

  // F3: optional undo of an earlier blunt pass (e.g. fix_all_leaks 20x)
  if (UNFLAG_PATTERN) {
    await q(`DROP TABLE IF EXISTS audit_unflag_old`);
    await q(`
      CREATE UNLOGGED TABLE audit_unflag_old AS
      SELECT pr.id AS price_id FROM prices pr
      WHERE pr.is_suspicious IS TRUE AND pr.validation_reason LIKE $1
        AND NOT EXISTS (SELECT 1 FROM audit_price_flags f WHERE f.price_id = pr.id)`,
      [UNFLAG_PATTERN]);
    const oldN = await countBefore(`old flags matching "${UNFLAG_PATTERN}" that this audit does NOT re-flag`,
      `SELECT COUNT(*) AS n FROM audit_unflag_old`);
    if (oldN > 0) {
      const un = await applyInBatches({
        label: 'unflag old blunt pass', workTable: 'audit_unflag_old', batchSize: CONFIG.batchSize,
        applySqlFn: (lo, hi) => ({
          sql: `UPDATE prices pr SET is_suspicious = false, validation_reason = NULL
                FROM (SELECT price_id FROM audit_unflag_old WHERE price_id BETWEEN $1 AND $2) s
                WHERE pr.id = s.price_id AND pr.validation_reason LIKE $3`,
          params: [lo, hi, UNFLAG_PATTERN],
        }),
      });
      await verifyAfter('old blunt flags removed',
        `SELECT COUNT(*) AS n FROM audit_unflag_old s JOIN prices pr ON pr.id = s.price_id
         WHERE pr.is_suspicious IS TRUE AND pr.validation_reason LIKE '${UNFLAG_PATTERN.replace(/'/g, "''")}'`);
      report.stages.unflagged_old = un;
    }
  }

  // F4: setting leaks -> procedures.setting = 'inpatient' (non-destructive; /search hides them)
  const slN = await countBefore('procedures to mark inpatient',
    `SELECT COUNT(*) AS n FROM audit_setting_leaks s JOIN procedures p ON p.id = s.procedure_id
     WHERE p.setting IS DISTINCT FROM 'inpatient'`);
  if (slN > 0) {
    const r = await q(`
      UPDATE procedures p SET setting = 'inpatient'
      FROM audit_setting_leaks s WHERE p.id = s.procedure_id
      AND p.setting IS DISTINCT FROM 'inpatient'`);
    console.log(`  Marked ${r.rowCount.toLocaleString()} procedures setting='inpatient'`);
    await verifyAfter('setting leaks reclassified',
      `SELECT COUNT(*) AS n FROM audit_setting_leaks s JOIN procedures p ON p.id = s.procedure_id
       WHERE p.setting IS DISTINCT FROM 'inpatient'`);
    report.stages.setting_applied = r.rowCount;
  }

  // F5: mapping confidence 0-100
  const conf = await q(`
    UPDATE procedures p SET mapping_confidence = LEAST(100, GREATEST(0,
      50
      + CASE WHEN p.cpt_code ~ '^[0-9]{4}[0-9A-Z]$' THEN 15 ELSE -20 END
      + CASE WHEN nm.is_drg_name THEN -40 ELSE 0 END
      + CASE WHEN nm.sim IS NULL THEN 0 WHEN nm.sim >= ${CONFIG.goodNameSim} THEN 25
             WHEN nm.sim >= 0.25 THEN 10 ELSE -15 END
      + CASE WHEN b.bench IS NOT NULL AND c.median IS NOT NULL
             THEN CASE WHEN c.median BETWEEN b.bench * 0.5 AND b.bench * 15 THEN 10
                       WHEN c.median > b.bench * 30 THEN -20 ELSE 0 END
             ELSE 0 END))
    FROM audit_name_match nm
    LEFT JOIN audit_benchmarks b ON b.cpt_code = nm.cpt_code
    LEFT JOIN audit_cohorts c ON c.cpt_code = nm.cpt_code AND c.price_type = 'negotiated'
    WHERE nm.procedure_id = p.id`);
  console.log(`  mapping_confidence set on ${conf.rowCount.toLocaleString()} procedures`);
  report.stages.confidence = conf.rowCount;

  // ── final state ──────────────────────────────────────────────────────────
  const final = await q(`SELECT price_type, is_suspicious, COUNT(*) AS n FROM prices GROUP BY 1, 2 ORDER BY 1, 2`);
  report.final_state = final.rows;
  console.log('\nFINAL SUSPICIOUS STATE:');
  for (const r of final.rows) console.log(`  ${r.price_type} / ${r.is_suspicious === true ? 'FLAGGED' : 'clean'}: ${Number(r.n).toLocaleString()}`);

  writeReport('audit_apply', report);
  console.log('\nDONE. Next: node pipeline/02_rebuild_summaries.js');
  await pool.end();
}

main().catch(e => { console.error('\nAUDIT FAILED: ' + (e.stack || e.message)); process.exit(1); });
