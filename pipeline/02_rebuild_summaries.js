// pipeline/02_rebuild_summaries.js — rebuild the UI-facing summary tables
// from CLEAN data only, then atomically swap them in.
//
//   node pipeline/02_rebuild_summaries.js            -> build *_new tables + sanity report, NO swap
//   node pipeline/02_rebuild_summaries.js --swap     -> swap _new into place (old kept as _old)
//
// Produces three tables (this is the "organize 50M rows for the UI" layer —
// every CPT correctly linked to its prices, bundles grouped):
//
//   cpt_price_summary    one row per hospital x CPT: price stats, medicare ratio,
//                        bundling_signal ('lean' pro-fee-only feeds vs 'inclusive'
//                        facility-loaded feeds — the ~2x vs ~10x medicare split)
//   payer_price_summary  one row per hospital x CPT x payer: negotiated stats
//   cpt_ui_catalog       ONE ROW PER CPT for the UI list/search page:
//                        display name, hospitals count, best/median prices,
//                        medicare benchmark, mapping confidence, bundle_key +
//                        bundle_components so linked procedures group together
//
// Source filter (matches server.js /search intent):
//   prices.is_suspicious IS NOT TRUE
//   procedures.is_searchable IS TRUE (when the column exists)
//   procedures.setting != 'inpatient' (when the column exists)
//
// Non-destructive: builds into *_new; --swap renames current -> *_old first.

const { pool, q, one, tableExists, tableColumns, writeReport } = require('./db');

const SWAP = process.argv.includes('--swap');

// Episode/bundle seeds. episode_rulebook.js (local, not in repo) is the richer
// source — merge it here when it lands in git. Keys group CPTs the UI should
// show together as one shoppable thing.
const BUNDLES = {
  colonoscopy:      ['45378', '45380', '45385', '74263'],
  knee_replacement: ['27447', '29881', '73721', '97110', '97530'],
  hip_replacement:  ['27130'],
  gallbladder:      ['47562', '47563', '76700', '80053', '85025'],
  brain_mri:        ['70551', '70552', '70553'],
  childbirth:       ['59400', '59410', '59510', '59515'],
  cardiac_workup:   ['93000', '93306', '93015', '93454'],
  spine:            ['22612', '22551', '63030', '72141', '72148'],
  bariatric:        ['43775', '43644'],
  endoscopy_upper:  ['43235', '43239'],
};

async function cleanFilterSql() {
  const cols = (await tableColumns('procedures')).map(c => c.column_name);
  let f = `pr.is_suspicious IS NOT TRUE AND pr.price > 0`;
  if (cols.includes('is_searchable')) f += ` AND p.is_searchable IS TRUE`;
  if (cols.includes('setting')) f += ` AND (p.setting IS NULL OR p.setting <> 'inpatient')`;
  return f;
}

async function main() {
  console.log(`PIPELINE 02 — REBUILD SUMMARIES ${SWAP ? '(WITH SWAP)' : '(build only, no swap)'}`);
  console.log('='.repeat(60));
  const report = { at: new Date().toISOString(), swap: SWAP };
  const CLEAN = await cleanFilterSql();
  console.log(`Clean-row filter: ${CLEAN}`);

  // ── cpt_price_summary_new ────────────────────────────────────────────────
  console.log('\n[1/3] cpt_price_summary_new (hospital x CPT)...');
  await q(`DROP TABLE IF EXISTS cpt_price_summary_new`);
  await q(`
    CREATE TABLE cpt_price_summary_new AS
    WITH base AS (
      SELECT pr.hospital_id, p.cpt_code,
             MIN(p.display_name) FILTER (WHERE p.display_name IS NOT NULL) AS display_name,
             MIN(p.standard_name) AS standard_name,
             MAX(COALESCE(p.medicare_facility_rate, p.medicare_non_facility_rate)) AS medicare_rate,
             COUNT(*) AS n_prices,
             COUNT(DISTINCT pr.payer_name) FILTER (WHERE pr.payer_name IS NOT NULL) AS n_payers,
             MIN(pr.price) FILTER (WHERE pr.price_type = 'cash') AS min_cash,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price) FILTER (WHERE pr.price_type = 'cash') AS median_cash,
             MIN(pr.price) FILTER (WHERE pr.price_type = 'negotiated') AS min_negotiated,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price) FILTER (WHERE pr.price_type = 'negotiated') AS median_negotiated,
             MAX(pr.price) FILTER (WHERE pr.price_type = 'negotiated') AS max_negotiated,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price) FILTER (WHERE pr.price_type = 'gross') AS median_gross
      FROM prices pr JOIN procedures p ON p.id = pr.procedure_id
      WHERE ${CLEAN} AND p.cpt_code IS NOT NULL
      GROUP BY pr.hospital_id, p.cpt_code
    )
    SELECT *,
           CASE WHEN medicare_rate > 0 THEN ROUND((median_negotiated / medicare_rate)::numeric, 2) END AS negotiated_to_medicare,
           CASE
             WHEN medicare_rate IS NULL OR median_negotiated IS NULL THEN 'unknown'
             WHEN median_negotiated < medicare_rate * 3.5 THEN 'lean'        -- pro-fee-only style feed
             ELSE 'inclusive'                                               -- facility-loaded feed
           END AS bundling_signal,
           NOW() AS updated_at
    FROM base`);
  await q(`CREATE INDEX ON cpt_price_summary_new(cpt_code)`);
  await q(`CREATE INDEX ON cpt_price_summary_new(hospital_id)`);
  const s1 = await one(`SELECT COUNT(*) AS n, COUNT(DISTINCT cpt_code) AS cpts FROM cpt_price_summary_new`);
  console.log(`  ${Number(s1.n).toLocaleString()} rows across ${Number(s1.cpts).toLocaleString()} CPTs`);
  report.cpt_price_summary = s1;

  // ── payer_price_summary_new ──────────────────────────────────────────────
  console.log('\n[2/3] payer_price_summary_new (hospital x CPT x payer)...');
  await q(`DROP TABLE IF EXISTS payer_price_summary_new`);
  await q(`
    CREATE TABLE payer_price_summary_new AS
    SELECT pr.hospital_id, p.cpt_code, pr.payer_name,
           MIN(pr.payer_category) AS payer_category,
           COUNT(*) AS n_prices,
           MIN(pr.price) FILTER (WHERE pr.price_type = 'negotiated') AS min_negotiated,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price) FILTER (WHERE pr.price_type = 'negotiated') AS median_negotiated,
           MAX(pr.price) FILTER (WHERE pr.price_type = 'negotiated') AS max_negotiated,
           NOW() AS updated_at
    FROM prices pr JOIN procedures p ON p.id = pr.procedure_id
    WHERE ${CLEAN} AND p.cpt_code IS NOT NULL AND pr.payer_name IS NOT NULL
    GROUP BY pr.hospital_id, p.cpt_code, pr.payer_name`);
  await q(`CREATE INDEX ON payer_price_summary_new(cpt_code)`);
  await q(`CREATE INDEX ON payer_price_summary_new(hospital_id, cpt_code)`);
  const s2 = await one(`SELECT COUNT(*) AS n FROM payer_price_summary_new`);
  console.log(`  ${Number(s2.n).toLocaleString()} rows`);
  report.payer_price_summary = s2;

  // ── cpt_ui_catalog_new ───────────────────────────────────────────────────
  console.log('\n[3/3] cpt_ui_catalog_new (one row per CPT, with bundle links)...');
  await q(`DROP TABLE IF EXISTS cpt_ui_catalog_new`);
  const bundleValues = Object.entries(BUNDLES)
    .flatMap(([key, cpts]) => cpts.map(c => `('${c}','${key}')`)).join(',');
  await q(`
    CREATE TABLE cpt_ui_catalog_new AS
    WITH bundle_map(cpt_code, bundle_key) AS (VALUES ${bundleValues}),
    agg AS (
      SELECT s.cpt_code,
             MIN(COALESCE(s.display_name, s.standard_name)) AS display_name,
             COUNT(DISTINCT s.hospital_id) AS n_hospitals,
             SUM(s.n_prices) AS n_prices,
             MIN(s.min_cash) AS best_cash,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY s.median_cash) AS median_cash,
             MIN(s.min_negotiated) AS best_negotiated,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY s.median_negotiated) AS median_negotiated,
             MAX(s.medicare_rate) AS medicare_rate
      FROM cpt_price_summary_new s
      GROUP BY s.cpt_code
    )
    SELECT a.*, bm.bundle_key,
           (SELECT array_agg(b2.cpt_code) FROM bundle_map b2
            WHERE b2.bundle_key = bm.bundle_key AND b2.cpt_code <> a.cpt_code) AS bundle_components,
           NOW() AS updated_at
    FROM agg a LEFT JOIN bundle_map bm ON bm.cpt_code = a.cpt_code`);
  await q(`CREATE UNIQUE INDEX ON cpt_ui_catalog_new(cpt_code)`);
  const s3 = await one(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE bundle_key IS NOT NULL) AS bundled FROM cpt_ui_catalog_new`);
  console.log(`  ${Number(s3.n).toLocaleString()} CPTs in catalog (${Number(s3.bundled).toLocaleString()} in bundles)`);
  report.cpt_ui_catalog = s3;

  // ── sanity checks before any swap ────────────────────────────────────────
  console.log('\nSANITY CHECKS');
  const checks = [];
  for (const cpt of ['47562', '27447', '45378', '70551']) {
    const r = await one(`SELECT COUNT(*) AS n, MIN(min_cash) AS best_cash FROM cpt_price_summary_new WHERE cpt_code = $1`, [cpt]);
    const ok = Number(r.n) > 0;
    checks.push({ cpt, hospitals: Number(r.n), best_cash: r.best_cash, ok });
    console.log(`  ${cpt}: ${r.n} hospitals, best cash $${r.best_cash} -> ${ok ? 'OK' : 'FAIL (missing!)'}`);
  }
  report.checks = checks;
  const allOk = checks.every(c => c.ok) && Number(s1.n) > 0 && Number(s2.n) > 0;

  if (!allOk) {
    writeReport('summaries_build', report);
    console.error('\nSANITY FAILED — not swapping. Old tables untouched.');
    process.exit(1);
  }

  if (!SWAP) {
    writeReport('summaries_build', report);
    console.log('\nBUILD COMPLETE (no swap). Inspect *_new tables, then re-run with --swap.');
    await pool.end();
    return;
  }

  // ── swap ─────────────────────────────────────────────────────────────────
  console.log('\nSWAPPING (old tables kept as *_old)...');
  for (const t of ['cpt_price_summary', 'payer_price_summary', 'cpt_ui_catalog']) {
    await q('BEGIN');
    try {
      await q(`DROP TABLE IF EXISTS ${t}_old`);
      if (await tableExists(t)) await q(`ALTER TABLE ${t} RENAME TO ${t}_old`);
      await q(`ALTER TABLE ${t}_new RENAME TO ${t}`);
      await q('COMMIT');
      console.log(`  ${t}: swapped (previous version -> ${t}_old)`);
    } catch (e) {
      await q('ROLLBACK');
      throw new Error(`swap failed for ${t}: ${e.message} — everything rolled back for this table`);
    }
  }
  // verify
  for (const t of ['cpt_price_summary', 'payer_price_summary', 'cpt_ui_catalog']) {
    const r = await one(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`  [verify-after] ${t}: ${Number(r.n).toLocaleString()} rows live`);
  }
  writeReport('summaries_swap', report);
  console.log('\nDONE. Next: restart server, then node pipeline/03_verify_live.js');
  await pool.end();
}

main().catch(e => { console.error('\nREBUILD FAILED: ' + (e.stack || e.message)); process.exit(1); });
