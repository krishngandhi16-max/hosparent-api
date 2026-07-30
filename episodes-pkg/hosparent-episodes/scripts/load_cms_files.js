/**
 * load_cms_files.js — Stage 1 loader for free CMS reference files.
 *
 * You download the files manually (auditability + CMS occasionally gates
 * downloads behind license-acknowledgment pages), drop them in ./cms_data,
 * then run:  node scripts/load_cms_files.js
 *
 * Expected files in ./cms_data (extract the ZIPs first):
 *   1. HCPC2026_*.csv / .txt   — HCPCS Level II quarterly file
 *      https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update
 *   2. addendum_b.csv          — OPPS Addendum B (export the Excel tab to CSV)
 *      cms.gov > Hospital Outpatient PPS > Quarterly Addenda Updates
 *   3. PPRRVU26*.csv           — PFS Relative Value File (RVU26A or later)
 *      cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files
 *   4. asc_rates.csv           — ASC Approved HCPCS + Payment Rates addendum (AA)
 *   5. anes_cf_2026.csv        — 2026 Anesthesia Conversion Factors (locality file)
 *      cms.gov Anesthesiologists Center; find Novitas JH Dallas + Fort Worth rows
 *
 * Uses pg + csv-parse: npm i pg csv-parse
 * Connection via env: PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD
 * (Windows PowerShell:  $env:PGDATABASE = "hosparent"  etc.)
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { parse } = require('csv-parse/sync');

const DATA_DIR = path.join(__dirname, '..', 'cms_data');
const pool = new Pool();

function readCsv(file, opts = {}) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) {
    console.warn(`[skip] ${file} not found in cms_data/`);
    return null;
  }
  const raw = fs.readFileSync(p, 'utf8');
  return parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true, ...opts });
}

// Case/space-insensitive column resolver — CMS renames headers between quarters.
function col(row, ...candidates) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const k = keys.find(k => k.toLowerCase().replace(/[\s_]/g, '') === c.toLowerCase().replace(/[\s_]/g, ''));
    if (k !== undefined) return row[k];
  }
  return undefined;
}

async function batchInsert(client, sql, rows, size = 1000) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    await Promise.all(chunk.map(r => client.query(sql, r)));
    process.stdout.write(`\r  ${Math.min(i + size, rows.length)}/${rows.length}`);
  }
  console.log();
}

async function loadHcpcs(client) {
  // Try common names; the quarterly file header includes HCPC + short/long desc.
  const files = fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter(f => /^HCPC.*\.(csv|txt)$/i.test(f)) : [];
  if (!files.length) return console.warn('[skip] no HCPC*.csv found');
  const rows = readCsv(files[0]);
  if (!rows) return;
  console.log(`HCPCS: ${rows.length} rows from ${files[0]}`);
  const params = rows.map(r => {
    const code = col(r, 'HCPC', 'HCPCS', 'HCPCSCode');
    const desc = col(r, 'SHORTDESCRIPTION', 'SHORTDESC', 'SD');
    return code ? [code.trim(), 'HCPCS', desc ? desc.trim() : null, 'HCPCS_QUARTERLY', 'JUL2026'] : null;
  }).filter(Boolean);
  await batchInsert(client, `
    INSERT INTO code_descriptors (code, code_type, canonical_short_desc, source, source_version)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (code, code_type, source) DO UPDATE
      SET canonical_short_desc = EXCLUDED.canonical_short_desc,
          source_version = EXCLUDED.source_version, loaded_at = now()`, params);
}

async function loadAddendumB(client) {
  const rows = readCsv('addendum_b.csv');
  if (!rows) return;
  console.log(`Addendum B: ${rows.length} rows`);
  const desc = rows.map(r => {
    const code = col(r, 'HCPCSCode', 'HCPCS');
    const sd = col(r, 'ShortDescriptor', 'ShortDescription');
    return code ? [code.trim(), 'CPT', sd ? sd.trim() : null, 'OPPS_ADDENDUM_B', '2026Q3'] : null;
  }).filter(Boolean);
  await batchInsert(client, `
    INSERT INTO code_descriptors (code, code_type, canonical_short_desc, source, source_version)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (code, code_type, source) DO UPDATE
      SET canonical_short_desc = EXCLUDED.canonical_short_desc, loaded_at = now()`, desc);

  const bench = rows.map(r => {
    const code = col(r, 'HCPCSCode', 'HCPCS');
    const rate = parseFloat(String(col(r, 'PaymentRate', 'APCPaymentRate') || '').replace(/[$,]/g, ''));
    const si = col(r, 'StatusIndicator', 'SI');
    const apc = col(r, 'APC');
    return code ? [code.trim(), 'CPT', 'NATIONAL', isNaN(rate) ? null : rate, si || null, apc || null, 2026] : null;
  }).filter(Boolean);
  await batchInsert(client, `
    INSERT INTO medicare_benchmarks (code, code_type, locality, opps_apc_rate, status_indicator, apc, effective_year)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (code, code_type, locality, effective_year) DO UPDATE
      SET opps_apc_rate = EXCLUDED.opps_apc_rate,
          status_indicator = EXCLUDED.status_indicator, apc = EXCLUDED.apc, loaded_at = now()`, bench);
}

async function loadPfsRvu(client) {
  const files = fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter(f => /^PPRRVU.*\.csv$/i.test(f)) : [];
  if (!files.length) return console.warn('[skip] no PPRRVU*.csv found');
  const rows = readCsv(files[0]);
  if (!rows) return;
  console.log(`PFS RVU: ${rows.length} rows from ${files[0]}`);
  const CF = 33.4009; // 2026 non-QP standard PFS CF (NOT the anesthesia CF)

  const params = rows.map(r => {
    const code = col(r, 'HCPCS');
    if (!code) return null;
    const w  = parseFloat(col(r, 'WorkRVU', 'RVUWork')) || 0;
    const peF = parseFloat(col(r, 'FacilityPERVU', 'TransitionedFacilityPERVU', 'PERVUFacility')) || 0;
    const peN = parseFloat(col(r, 'NonFacilityPERVU', 'TransitionedNonFacilityPERVU', 'PERVUNonFacility')) || 0;
    const mp = parseFloat(col(r, 'MPRVU', 'MalpracticeRVU')) || 0;
    const gd = col(r, 'GlobalDays', 'GlobSurg', 'GLOBDAYS');
    // National (GPCI=1.0) amounts; DFW locality pass applies GPCIs later.
    const fac = Math.round((w + peF + mp) * CF * 100) / 100;
    const non = Math.round((w + peN + mp) * CF * 100) / 100;
    return [code.trim(), 'CPT', 'NATIONAL', fac || null, non || null, gd ? String(gd).trim() : null, 2026];
  }).filter(Boolean);

  await batchInsert(client, `
    INSERT INTO medicare_benchmarks (code, code_type, locality, pfs_facility_amt, pfs_nonfacility_amt, global_days, effective_year)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (code, code_type, locality, effective_year) DO UPDATE
      SET pfs_facility_amt = EXCLUDED.pfs_facility_amt,
          pfs_nonfacility_amt = EXCLUDED.pfs_nonfacility_amt,
          global_days = EXCLUDED.global_days, loaded_at = now()`, params);

  // Short descriptors from the RVU file too
  const desc = rows.map(r => {
    const code = col(r, 'HCPCS');
    const sd = col(r, 'Description', 'ShortDescription', 'DESC');
    return code && sd ? [code.trim(), 'CPT', String(sd).trim(), 'PFS_RVU', 'RVU26A'] : null;
  }).filter(Boolean);
  await batchInsert(client, `
    INSERT INTO code_descriptors (code, code_type, canonical_short_desc, source, source_version)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (code, code_type, source) DO UPDATE
      SET canonical_short_desc = EXCLUDED.canonical_short_desc, loaded_at = now()`, desc);
}

async function loadAscRates(client) {
  const rows = readCsv('asc_rates.csv');
  if (!rows) return;
  console.log(`ASC rates: ${rows.length} rows`);
  const params = rows.map(r => {
    const code = col(r, 'HCPCSCode', 'HCPCS');
    const rate = parseFloat(String(col(r, 'PaymentRate', 'ASCPaymentRate', 'PaymentIndicatorRate') || '').replace(/[$,]/g, ''));
    return code && !isNaN(rate) ? [code.trim(), 'CPT', 'NATIONAL', rate, 2026] : null;
  }).filter(Boolean);
  await batchInsert(client, `
    INSERT INTO medicare_benchmarks (code, code_type, locality, asc_rate, effective_year)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (code, code_type, locality, effective_year) DO UPDATE
      SET asc_rate = EXCLUDED.asc_rate, loaded_at = now()`, params);
}

async function loadAnesCf(client) {
  const rows = readCsv('anes_cf_2026.csv');
  if (!rows) return console.warn('[skip] anes_cf_2026.csv — national CF already seeded by 011');
  for (const r of rows) {
    const name = String(col(r, 'LocalityName', 'Locality') || '').toUpperCase();
    const cf = parseFloat(col(r, 'AnesthesiaCF', 'ConversionFactor', 'CF'));
    if (isNaN(cf)) continue;
    let loc = null;
    if (name.includes('DALLAS')) loc = 'TX_DALLAS';
    else if (name.includes('FORT WORTH')) loc = 'TX_FORT_WORTH';
    if (!loc) continue;
    await client.query(`
      INSERT INTO locality_anesthesia_cf (locality, cf_non_apm, effective_year, source)
      VALUES ($1,$2,2026,'CMS 2026 Anesthesia CF file')
      ON CONFLICT (locality, effective_year) DO UPDATE SET cf_non_apm = EXCLUDED.cf_non_apm`, [loc, cf]);
    console.log(`  loaded ${loc} = ${cf}`);
  }
}

(async () => {
  const client = await pool.connect();
  try {
    await loadHcpcs(client);
    await loadAddendumB(client);
    await loadPfsRvu(client);
    await loadAscRates(client);
    await loadAnesCf(client);
    const { rows } = await client.query(`
      SELECT source, COUNT(*) FROM code_descriptors GROUP BY source
      UNION ALL SELECT 'benchmarks', COUNT(*) FROM medicare_benchmarks`);
    console.table(rows);
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
