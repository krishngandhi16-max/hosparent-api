#!/usr/bin/env node
// import_costplus.js — import the FULL Mark Cuban Cost Plus Drugs catalog into
// drug_prices, using their OFFICIAL public API (no scraping, no HTML parsing).
//
//   API: https://us-central1-costplusdrugs-publicapi.cloudfunctions.net/main
//   Docs: https://costplusdrugs.github.io/apidocs/
//
// Verified July 2026: returns ~2,371 medications as JSON with medication_name,
// brand_name, strength, form, NDC, unit_price, pack size, and product URL.
// (The old drug_checker.js scraped costplusdrugs.com HTML with cheerio — that
// returns nothing on their React site and wrote to a table /search-drugs never
// reads. This replaces it.)
//
// Refresh model: DELETE the previous Cost Plus rows, INSERT the fresh catalog.
// Other sources (GoodRx rows, agent-added rows) are untouched. Idempotent —
// run as often as you like; run_office_daily.js runs it on schedule.
//
// After importing, runs the J-code backfill (fix_drug_codes.js) so injectables
// in the catalog are searchable by billing code too.
//
// Run: node import_costplus.js
require('dotenv').config();
// Windows Node often fails fetch with a bare "fetch failed" when the host
// resolves to IPv6 first but the network has no IPv6 route. Prefer IPv4.
require('dns').setDefaultResultOrder('ipv4first');
const { pool } = require('./db');
const { backfillJCodes } = require('./fix_drug_codes');

const API = 'https://us-central1-costplusdrugs-publicapi.cloudfunctions.net/main';
const SOURCE = 'costplusdrugs.com public API';

// Retry wrapper: the catalog is one big response; transient DNS/TLS hiccups are
// common on home connections, so try a few times and surface the REAL cause.
async function fetchCatalog() {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const resp = await fetch(API, { signal: AbortSignal.timeout(120000) });
      if (!resp.ok) throw new Error(`Cost Plus API HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      lastErr = e;
      const cause = e.cause ? ` (cause: ${e.cause.code || e.cause.message || e.cause})` : '';
      console.log(`  attempt ${attempt}/4 failed: ${e.message}${cause}`);
      if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  throw new Error(`could not reach the Cost Plus API after 4 tries: ${lastErr.message}${lastErr.cause ? ` — cause: ${lastErr.cause.code || lastErr.cause.message}` : ''}. Check firewall/antivirus or try again later.`);
}

function parseMoney(s) {
  const n = parseFloat(String(s || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drug_prices (
      id SERIAL PRIMARY KEY,
      drug_name TEXT, brand_name TEXT, ndc TEXT, j_code TEXT,
      strength TEXT, form TEXT, quantity TEXT,
      pharmacy_name TEXT, pharmacy_chain TEXT, pharmacy_address TEXT,
      pharmacy_zip TEXT, pharmacy_lat DOUBLE PRECISION, pharmacy_lng DOUBLE PRECISION,
      price NUMERIC, price_type TEXT, source TEXT, source_url TEXT,
      conditions TEXT, is_generic BOOLEAN, added_from TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
  // The table may predate this script with fewer columns — add any that are missing.
  const cols = [
    ['j_code', 'TEXT'], ['ndc', 'TEXT'], ['strength', 'TEXT'], ['form', 'TEXT'],
    ['quantity', 'TEXT'], ['pharmacy_chain', 'TEXT'], ['pharmacy_address', 'TEXT'],
    ['pharmacy_zip', 'TEXT'], ['pharmacy_lat', 'DOUBLE PRECISION'], ['pharmacy_lng', 'DOUBLE PRECISION'],
    ['price_type', 'TEXT'], ['source', 'TEXT'], ['source_url', 'TEXT'],
    ['conditions', 'TEXT'], ['is_generic', 'BOOLEAN'], ['added_from', 'TEXT'],
  ];
  for (const [name, type] of cols) {
    await pool.query(`ALTER TABLE drug_prices ADD COLUMN IF NOT EXISTS ${name} ${type}`).catch(() => {});
  }
  // The table may predate this script with quantity as INTEGER — we store
  // patient-friendly pack strings like "30 ea", so widen it to TEXT.
  await pool.query(`ALTER TABLE drug_prices ALTER COLUMN quantity TYPE TEXT USING quantity::text`).catch(() => {});
  // The ALTER can fail (e.g. a view depends on the column) — check what the
  // column actually is and adapt the insert instead of crashing on "30 ea".
  const q = await pool.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'drug_prices' AND column_name = 'quantity'`).catch(() => ({ rows: [] }));
  const t = (q.rows[0] && q.rows[0].data_type || 'text').toLowerCase();
  return { quantityIsText: t.includes('text') || t.includes('char') };
}

async function main() {
  console.log('=== COST PLUS DRUGS FULL-CATALOG IMPORT (official public API) ===\n');
  console.log('Fetching catalog...');
  const data = await fetchCatalog();
  const meds = data.results || data;
  if (!Array.isArray(meds) || meds.length < 100) {
    throw new Error(`unexpected API response (${Array.isArray(meds) ? meds.length : typeof meds} entries) — aborting, existing data untouched`);
  }
  console.log(`Catalog entries: ${meds.length}`);

  const { quantityIsText } = await ensureTable();
  if (!quantityIsText) console.log('note: quantity column is numeric (a view may block widening) — storing pack size as a number.');
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    const del = await client.query(`DELETE FROM drug_prices WHERE source = $1`, [SOURCE]);
    console.log(`Cleared ${del.rowCount} previous Cost Plus rows (fresh refresh).`);

    for (const m of meds) {
      const unit = parseMoney(m.unit_price);
      if (!unit) continue;
      const packSize = parseFloat(m.medispan_pack_size);
      // Patient-facing price = one standard pack (e.g. 30 tablets), not one pill.
      const price = Number.isFinite(packSize) && packSize > 0 ? Math.round(unit * packSize * 100) / 100 : unit;
      const quantity = quantityIsText
        ? (m.medispan_pack_size ? `${m.medispan_pack_size} ${m.medispan_pack_size_units || ''}`.trim() : null)
        : (Number.isFinite(packSize) && packSize > 0 ? Math.round(packSize) : null);
      await client.query(
        `INSERT INTO drug_prices
           (drug_name, brand_name, ndc, strength, form, quantity,
            pharmacy_name, pharmacy_chain, price, price_type, source, source_url,
            conditions, is_generic, added_from)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'cash',$10,$11,$12,$13,$14)`,
        [
          m.medication_name || null,
          m.brand_name || null,
          m.ndc || null,
          m.strength || null,
          m.form || null,
          quantity,
          'Mark Cuban Cost Plus Drugs',
          'Cost Plus Drugs (mail order)',
          price,
          SOURCE,
          m.url || null,
          m.insurance_eligible === 'Yes' ? 'insurance-eligible; price shown is cash/self-pay per pack, excl. shipping' : 'cash/self-pay per pack, excl. shipping',
          m.brand_generic === 'Generic',
          SOURCE,
        ]
      );
      inserted++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  console.log(`Imported ${inserted} medications from Cost Plus Drugs.`);

  const tagged = await backfillJCodes();
  console.log(`J-code backfill tagged ${tagged} injectable row(s).`);

  const stats = await pool.query(
    `SELECT COUNT(*)::int AS n, COUNT(ndc)::int AS with_ndc, COUNT(j_code)::int AS with_jcode
     FROM drug_prices WHERE source = $1`, [SOURCE]);
  const s = stats.rows[0];
  console.log(`\nNow searchable: ${s.n} Cost Plus medications (${s.with_ndc} with NDC, ${s.with_jcode} with J-code).`);
  console.log('Test: curl "http://localhost:3001/search-drugs?q=atorvastatin"');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('Import failed:', e.message); process.exit(1); });
}
module.exports = { main };
