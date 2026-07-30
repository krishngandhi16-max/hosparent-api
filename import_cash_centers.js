#!/usr/bin/env node
// import_cash_centers.js — import transparent cash-price surgery centers.
//
// Two sources, both verified live (Jul 2026):
//
//   1. NTTC Surgery Center (Mesquite, TX — DFW): flat-rate all-inclusive
//      bundles published as a plain HTML table at
//      nttcsurgerycenter.com/pricelist/flat-rate/  → cash_bundle_prices table
//      (bundles include surgeon+anesthesia+facility, so they are NOT mixed
//      into the per-facility `prices` table — different animal).
//
//   2. Texas Institute for Surgery at Texas Health Dallas: publishes the
//      official CMS v3 machine-readable file (standardcharges.csv, ~8K rows,
//      CPT-coded, gross + discounted cash + per-payer negotiated). Imported
//      as a REAL hospital into hospitals/procedures/prices, so it shows up in
//      normal /search results next to the big systems.
//
// Idempotent: each source clears its own previous rows and re-inserts.
// After running, run validation_system.js (or the office daily) so new
// prices get bounds-checked, then restart the server / GET /cache-clear.
//
// Run: node import_cash_centers.js
require('dotenv').config();
require('dns').setDefaultResultOrder('ipv4first');
const { pool } = require('./db');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Hosparent price importer';

async function fetchText(url, timeoutMs = 60000) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch (e) {
      lastErr = e;
      console.log(`  fetch attempt ${attempt}/4 failed for ${url}: ${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}`);
      if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  throw lastErr;
}

// ── source 1: NTTC flat-rate bundles ────────────────────────────────────────
const NTTC = {
  provider: 'North Texas Team Care Surgery Center',
  city: 'Mesquite, TX',
  url: 'https://www.nttcsurgerycenter.com/pricelist/flat-rate/',
  includes: 'All-inclusive flat rate (facility + surgeon + anesthesia). Published cash price.',
};

async function importNTTC() {
  console.log(`\n[NTTC] fetching ${NTTC.url}`);
  const html = await fetchText(NTTC.url);
  // Rows look like:
  // <td class="column-1">ColoRectal</td><td class="column-2">46260</td>
  // <td class="column-3">Hemorroidectomy</td><td class="column-4">$4,209</td>
  const rowRe = /<td class="column-1">(.*?)<\/td><td class="column-2">(.*?)<\/td><td class="column-3">(.*?)<\/td><td class="column-4">\$([\d,]+)/g;
  const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
  const rows = [];
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const price = Number(m[4].replace(/,/g, ''));
    if (!Number.isFinite(price) || price <= 0) continue;
    rows.push({ category: strip(m[1]), cpt: strip(m[2]).slice(0, 40), name: strip(m[3]), price });
  }
  if (rows.length < 20) throw new Error(`NTTC parse found only ${rows.length} rows — page layout may have changed`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_bundle_prices (
      id SERIAL PRIMARY KEY,
      provider_name TEXT NOT NULL, city TEXT,
      category TEXT, procedure_name TEXT, cpt_code TEXT,
      all_inclusive_price NUMERIC,
      includes_description TEXT, source_url TEXT,
      scraped_at TIMESTAMP DEFAULT NOW()
    )`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM cash_bundle_prices WHERE provider_name = $1`, [NTTC.provider]);
    for (const r of rows) {
      await client.query(
        `INSERT INTO cash_bundle_prices (provider_name, city, category, procedure_name, cpt_code, all_inclusive_price, includes_description, source_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [NTTC.provider, NTTC.city, r.category, r.name, r.cpt, r.price, NTTC.includes, NTTC.url]
      );
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  console.log(`[NTTC] imported ${rows.length} all-inclusive bundles (e.g. ${rows[0].name} $${rows[0].price}).`);
  return rows.length;
}

// ── source 2: Texas Institute for Surgery CMS standard-charges CSV ─────────
const TIS = {
  hospital: 'Texas Institute for Surgery at Texas Health Dallas',
  city: 'Dallas',
  page: 'https://www.texasinstituteforsurgery.com/standard-pricing/',
  fallbackCsv: 'https://www.texasinstituteforsurgery.com/wp-content/uploads/2026/03/770628004_Texas-Institute-for-Surgery-at-Texas-Health-Dallas_standardcharges.csv',
};

// Minimal RFC-4180 CSV parser (quoted fields, embedded commas/newlines).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (s) => { const n = parseFloat(String(s || '').replace(/[$,]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

async function importTIS() {
  console.log(`\n[TIS] discovering standard-charges CSV from ${TIS.page}`);
  let csvUrl = TIS.fallbackCsv;
  try {
    const page = await fetchText(TIS.page);
    const link = page.match(/href="([^"]*standardcharges\.csv[^"]*)"/i);
    if (link) csvUrl = link[1].startsWith('http') ? link[1] : `https://www.texasinstituteforsurgery.com${link[1]}`;
  } catch (_) { /* fall back to known URL */ }
  console.log(`[TIS] downloading ${csvUrl}`);
  const csv = await fetchText(csvUrl, 120000);
  const rows = parseCsv(csv);
  if (rows.length < 10) throw new Error('TIS CSV looks empty — format may have changed');

  // CMS v3 layout: row0 meta names, row1 meta values, row2 = real column header.
  const header = rows[2].map((h) => String(h).trim());
  const idx = (name) => header.findIndex((h) => h.toLowerCase() === name);
  const iDesc = idx('description');
  const iSetting = idx('setting');
  const iGross = header.findIndex((h) => /^standard_charge\|gross$/i.test(h));
  const iCash = header.findIndex((h) => /^standard_charge\|discounted_cash$/i.test(h));
  // code|N + code|N|type pairs — pick the CPT/HCPCS one per row
  const codePairs = [];
  for (let n = 1; n <= 4; n++) {
    const c = idx(`code|${n}`), t = idx(`code|${n}|type`);
    if (c !== -1 && t !== -1) codePairs.push([c, t]);
  }
  // every per-payer negotiated_dollar column
  const negCols = header.map((h, i) => ({ h, i }))
    .filter(({ h }) => /^standard_charge\|.+\|negotiated_dollar$/i.test(h));
  if (iDesc === -1 || (iGross === -1 && iCash === -1)) throw new Error('TIS CSV header not recognized');
  console.log(`[TIS] ${rows.length - 3} data rows, ${negCols.length} payer columns.`);

  // Upsert the hospital
  let hosp = await pool.query(`SELECT id FROM hospitals WHERE name = $1`, [TIS.hospital]);
  if (!hosp.rows.length) {
    hosp = await pool.query(
      `INSERT INTO hospitals (name, city, is_compliant, mrf_last_updated) VALUES ($1,$2,true,NOW()) RETURNING id`,
      [TIS.hospital, TIS.city]
    );
    console.log(`[TIS] created hospital id ${hosp.rows[0].id}`);
  } else {
    await pool.query(`UPDATE hospitals SET mrf_last_updated = NOW() WHERE id = $1`, [hosp.rows[0].id]).catch(() => {});
  }
  const hospitalId = hosp.rows[0].id;

  // procedure cache: cpt -> procedure_id (reuse existing procedures where possible)
  const procCache = new Map();
  async function procIdFor(cpt, name) {
    if (procCache.has(cpt)) return procCache.get(cpt);
    let r = await pool.query(`SELECT id FROM procedures WHERE cpt_code = $1 ORDER BY id LIMIT 1`, [cpt]);
    if (!r.rows.length) {
      r = await pool.query(
        `INSERT INTO procedures (standard_name, cpt_code) VALUES ($1,$2) RETURNING id`,
        [String(name || cpt).slice(0, 200), cpt]
      );
    }
    procCache.set(cpt, r.rows[0].id);
    return r.rows[0].id;
  }

  const client = await pool.connect();
  let inserted = 0, procedures = 0;
  try {
    await client.query('BEGIN');
    const del = await client.query(`DELETE FROM prices WHERE hospital_id = $1`, [hospitalId]);
    console.log(`[TIS] cleared ${del.rowCount} previous rows for this hospital (fresh refresh).`);

    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length < header.length - 5) continue;
      // find a CPT (5 digits) or HCPCS (letter + 4 digits) code on this row
      let code = null;
      for (const [c, t] of codePairs) {
        const type = String(row[t] || '').toUpperCase();
        const val = String(row[c] || '').trim();
        if ((type === 'CPT' && /^\d{5}$/.test(val)) || (type === 'HCPCS' && /^[A-Z]\d{4}$/.test(val))) { code = val; break; }
      }
      if (!code) continue;
      const desc = String(row[iDesc] || '').trim();
      const procedureId = await procIdFor(code, desc);
      procedures++;

      const inserts = [];
      const gross = iGross !== -1 ? num(row[iGross]) : null;
      const cash = iCash !== -1 ? num(row[iCash]) : null;
      if (gross) inserts.push(['gross', gross]);
      if (cash) inserts.push(['cash', cash]);
      for (const { i } of negCols) {
        const v = num(row[i]);
        if (v) inserts.push(['negotiated', v]);
      }
      for (const [ptype, price] of inserts) {
        await client.query(
          `INSERT INTO prices (procedure_id, hospital_id, price, price_type, is_suspicious)
           VALUES ($1,$2,$3,$4,false)`,
          [procedureId, hospitalId, price, ptype]
        );
        inserted++;
      }
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  console.log(`[TIS] imported ${inserted} prices across ${procCache.size} coded procedures.`);
  return inserted;
}

if (require.main === module) {
  (async () => {
    console.log('=== CASH-PRICE SURGERY CENTER IMPORT ===');
    const results = [];
    for (const [label, fn] of [['NTTC bundles', importNTTC], ['Texas Institute for Surgery MRF', importTIS]]) {
      try { results.push(`${label}: ${await fn()} rows`); }
      catch (e) { console.error(`${label} FAILED: ${e.message}`); results.push(`${label}: FAILED (${e.message.slice(0, 80)})`); }
    }
    console.log(`\nSummary: ${results.join(' | ')}`);
    console.log('Next: node validation_system.js  (bounds-check the new prices), then restart the server.');
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { parseCsv, importNTTC, importTIS };
