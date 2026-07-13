// pipeline/00_preflight.js — READ-ONLY orientation + health report.
// Run: node pipeline/00_preflight.js
//
// Changes NOTHING. Verifies the schema matches what every later stage
// assumes, then prints the actual current state of the data:
//   - row counts, suspicious counts, validation_reason breakdown
//   - is_searchable / setting / code_type / name_type distributions
//   - remaining unflagged leaks vs Medicare (>20x, >50x) per price_type
//   - fix_all_leaks.js aftermath: per-CPT flag rates that look like
//     over-flagging (>90% of a big cohort flagged), and a sample of rows
//     flagged in the 20-25x band (the "was 20x too aggressive?" evidence)
//
// Every later stage refuses to run unless this passes.

const { pool, q, one, assertSchema, tableExists, tableColumns, approxCount, writeReport } = require('./db');

const REQUIRED = {
  prices: ['id', 'hospital_id', 'procedure_id', 'payer_name', 'payer_category',
           'plan_name', 'price_type', 'price', 'is_cash_price', 'is_suspicious',
           'validation_reason'],
  procedures: ['id', 'cpt_code', 'standard_name', 'medicare_facility_rate',
               'medicare_non_facility_rate'],
  hospitals: ['id', 'name'],
};

// columns previous sessions added; missing ones are created by 01_audit --apply
const OPTIONAL_PROC_COLS = ['code_type', 'name_type', 'is_mismatch', 'setting',
                            'severity', 'is_searchable', 'mapping_confidence'];

async function main() {
  const report = { at: new Date().toISOString(), schema: {}, health: {} };
  console.log('PIPELINE 00 — PREFLIGHT (read-only)');
  console.log('='.repeat(60));

  // ── 1. schema (rule 1: look, don't assume) ────────────────────────────
  for (const [table, cols] of Object.entries(REQUIRED)) {
    const actual = await assertSchema(table, cols);
    report.schema[table] = actual;
    console.log(`  ${table}: ${actual.length} columns OK (${cols.length} required present)`);
  }
  // guard against the historical footgun explicitly:
  if (report.schema.prices.includes('billing_code')) {
    console.log('  NOTE: prices.billing_code exists now (it did not before) — scripts still join via procedure_id.');
  } else {
    console.log('  Confirmed: prices has NO billing_code column. CPT is prices.procedure_id -> procedures.cpt_code.');
  }
  const procCols = (await tableColumns('procedures')).map(c => c.column_name);
  report.schema.procedures_optional = {};
  for (const c of OPTIONAL_PROC_COLS) {
    report.schema.procedures_optional[c] = procCols.includes(c);
    if (!procCols.includes(c)) console.log(`  procedures.${c}: MISSING (01_audit --apply will add it)`);
  }
  for (const t of ['medicare_rates', 'medicare_drg_rates', 'medicare_opps_rates', 'cpt_price_bounds']) {
    const ex = await tableExists(t);
    report.schema[t] = ex ? (await tableColumns(t)).map(c => c.column_name) : 'MISSING';
    console.log(`  ${t}: ${ex ? 'present [' + report.schema[t].join(', ') + ']' : 'MISSING'}`);
  }
  // NULL-id / missing-PK landmine (found 2026-07-12: 13.7M Methodist rows had
  // NULL id and prices has no PK — id-keyed updates silently skipped them)
  const nullIds = await one(`SELECT COUNT(*) AS n FROM prices WHERE id IS NULL`);
  const pk = await q(`SELECT conname FROM pg_constraint WHERE conrelid = 'prices'::regclass AND contype = 'p'`);
  report.schema.prices_null_ids = Number(nullIds.n);
  report.schema.prices_pk = pk.rows.length ? pk.rows[0].conname : null;
  console.log(`  prices.id NULLs: ${Number(nullIds.n).toLocaleString()} ${Number(nullIds.n) > 0 ? '<<< RUN pipeline/01a_backfill_ids.js --apply BEFORE THE AUDIT' : '(good)'}`);
  console.log(`  prices primary key: ${pk.rows.length ? pk.rows[0].conname : 'NONE — add after pitch (exclusive lock)'}`);

  const trgm = await one(`SELECT COUNT(*)::int AS n FROM pg_extension WHERE extname = 'pg_trgm'`);
  report.schema.pg_trgm = trgm.n > 0;
  console.log(`  pg_trgm extension: ${trgm.n > 0 ? 'installed' : 'NOT installed (01_audit will try CREATE EXTENSION, else fall back to keyword overlap)'}`);

  // ── 2. row counts ─────────────────────────────────────────────────────
  console.log('\nROW COUNTS');
  for (const t of ['prices', 'procedures', 'hospitals', 'medicare_rates', 'medicare_drg_rates']) {
    if (report.schema[t] === 'MISSING') continue;
    const n = await approxCount(t);
    report.health[`${t}_rows`] = n;
    console.log(`  ${t}: ~${n.toLocaleString()}`);
  }

  // ── 3. suspicious state ───────────────────────────────────────────────
  console.log('\nSUSPICIOUS FLAG STATE (exact counts — takes a minute on 48.6M rows)');
  const susp = await q(`
    SELECT price_type, is_suspicious, COUNT(*) AS n
    FROM prices GROUP BY price_type, is_suspicious ORDER BY price_type, is_suspicious`);
  report.health.suspicious = susp.rows;
  for (const r of susp.rows) {
    console.log(`  ${r.price_type} / ${r.is_suspicious === true ? 'FLAGGED' : 'clean'}: ${Number(r.n).toLocaleString()}`);
  }

  console.log('\nTOP validation_reason VALUES (identifies what fix_all_leaks.js wrote)');
  const reasons = await q(`
    SELECT COALESCE(validation_reason,'(null)') AS reason, COUNT(*) AS n
    FROM prices WHERE is_suspicious IS TRUE
    GROUP BY 1 ORDER BY n DESC LIMIT 30`);
  report.health.reasons = reasons.rows;
  for (const r of reasons.rows) console.log(`  ${Number(r.n).toLocaleString().padStart(12)}  ${r.reason.slice(0, 90)}`);

  // ── 4. procedures classification state ────────────────────────────────
  console.log('\nPROCEDURES CLASSIFICATION');
  for (const col of ['code_type', 'name_type', 'setting', 'is_searchable', 'is_mismatch']) {
    if (!report.schema.procedures_optional[col]) continue;
    const d = await q(`SELECT COALESCE(${col}::text,'(null)') AS v, COUNT(*) AS n FROM procedures GROUP BY 1 ORDER BY n DESC LIMIT 10`);
    report.health[`proc_${col}`] = d.rows;
    console.log(`  ${col}: ` + d.rows.map(r => `${r.v}=${Number(r.n).toLocaleString()}`).join('  '));
  }

  // ── 5. remaining unflagged leaks vs Medicare ──────────────────────────
  console.log('\nREMAINING UNFLAGGED LEAKS (price vs Medicare benchmark, clean rows only)');
  const leaks = await q(`
    SELECT pr.price_type,
           COUNT(*) FILTER (WHERE pr.price > 20 * m.bench) AS over_20x,
           COUNT(*) FILTER (WHERE pr.price > 50 * m.bench) AS over_50x,
           COUNT(*) AS clean_with_benchmark
    FROM prices pr
    JOIN (SELECT id, COALESCE(medicare_facility_rate, medicare_non_facility_rate) AS bench
          FROM procedures WHERE COALESCE(medicare_facility_rate, medicare_non_facility_rate) > 0) m
      ON m.id = pr.procedure_id
    WHERE pr.is_suspicious IS NOT TRUE AND pr.price > 0
    GROUP BY pr.price_type`);
  report.health.leaks = leaks.rows;
  for (const r of leaks.rows) {
    console.log(`  ${r.price_type}: >20x=${Number(r.over_20x).toLocaleString()}  >50x=${Number(r.over_50x).toLocaleString()}  (of ${Number(r.clean_with_benchmark).toLocaleString()} clean rows with a benchmark)`);
  }

  // ── 6. over-flagging suspects (was 20x too aggressive?) ───────────────
  console.log('\nOVER-FLAGGING SUSPECTS: CPTs where >90% of a >=200-row cohort is flagged');
  const overflag = await q(`
    SELECT p.cpt_code, MIN(p.standard_name) AS name, pr.price_type,
           COUNT(*) AS total, COUNT(*) FILTER (WHERE pr.is_suspicious IS TRUE) AS flagged,
           ROUND(100.0 * COUNT(*) FILTER (WHERE pr.is_suspicious IS TRUE) / COUNT(*), 1) AS pct,
           MAX(COALESCE(p.medicare_facility_rate, p.medicare_non_facility_rate)) AS medicare
    FROM prices pr JOIN procedures p ON p.id = pr.procedure_id
    WHERE p.cpt_code ~ '^[0-9]{5}$'
    GROUP BY p.cpt_code, pr.price_type
    HAVING COUNT(*) >= 200
       AND COUNT(*) FILTER (WHERE pr.is_suspicious IS TRUE) > 0.9 * COUNT(*)
    ORDER BY total DESC LIMIT 40`);
  report.health.overflag_suspects = overflag.rows;
  for (const r of overflag.rows) {
    console.log(`  ${r.cpt_code} ${String(r.name).slice(0, 40).padEnd(40)} ${r.price_type.padEnd(10)} ${r.pct}% of ${Number(r.total).toLocaleString()} flagged (medicare $${r.medicare})`);
  }

  console.log('\nSAMPLE: flagged rows sitting at 20-25x Medicare (borderline band — eyeball these)');
  const borderline = await q(`
    SELECT p.cpt_code, p.standard_name, pr.price_type, pr.price,
           ROUND(pr.price / m.bench, 1) AS ratio, pr.validation_reason
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN LATERAL (SELECT COALESCE(p.medicare_facility_rate, p.medicare_non_facility_rate) AS bench) m ON m.bench > 0
    WHERE pr.is_suspicious IS TRUE
      AND pr.price BETWEEN 20 * m.bench AND 25 * m.bench
    ORDER BY random() LIMIT 25`);
  report.health.borderline_sample = borderline.rows;
  for (const r of borderline.rows) {
    console.log(`  ${r.cpt_code} ${String(r.standard_name).slice(0, 38).padEnd(38)} ${r.price_type.padEnd(10)} $${r.price} (${r.ratio}x)  ${String(r.validation_reason || '').slice(0, 40)}`);
  }

  writeReport('preflight', report);
  console.log('\nPREFLIGHT PASSED. Next: node pipeline/01_audit.js   (dry run, still changes nothing)');
  await pool.end();
}

main().catch(e => { console.error('\n' + e.message); process.exit(1); });
