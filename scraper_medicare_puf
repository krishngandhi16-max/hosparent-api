require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// ══════════════════════════════════════════════════════════════
// MEDICARE PUF SCRAPER — what every DFW provider BILLED Medicare
// vs what Medicare actually PAID, per CPT/APC/DRG code.
// Auto-discovers current dataset UUIDs from data.cms.gov catalog
// (the old hardcoded-UUID approach died — UUIDs change yearly).
// Run: node scraper_medicare_puf.js   (takes 20-40 min)
// ══════════════════════════════════════════════════════════════

const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };

// DFW ZIP prefixes: Dallas 750-753, Fort Worth/Arlington 760-762
const DFW_ZIP_PREFIXES = ['750','751','752','753','760','761','762'];
const isDfwZip = z => z && DFW_ZIP_PREFIXES.some(p => String(z).startsWith(p));

// The three PUF datasets, matched by title keywords in the CMS catalog
const DATASETS = [
  {
    key: 'physician',
    titleMatch: ['medicare physician & other practitioners', 'by provider and service'],
    stateField: 'Rndrng_Prvdr_State_Abrvtn',
  },
  {
    key: 'outpatient',
    titleMatch: ['medicare outpatient hospitals', 'by provider and service'],
    stateField: 'Rndrng_Prvdr_State_Abrvtn',
  },
  {
    key: 'inpatient',
    titleMatch: ['medicare inpatient hospitals', 'by provider and service'],
    stateField: 'Rndrng_Prvdr_State_Abrvtn',
  },
];

// ── discover current dataset API URLs from the CMS catalog ────
async function discoverDatasets() {
  console.log('[discover] fetching data.cms.gov catalog...');
  const res = await axios.get('https://data.cms.gov/data.json', { timeout: 60000 });
  const catalog = res.data.dataset || [];
  const found = {};

  for (const spec of DATASETS) {
    // collect all catalog entries matching every title keyword
    const matches = catalog.filter(d => {
      const t = (d.title || '').toLowerCase();
      return spec.titleMatch.every(k => t.includes(k));
    });
    if (!matches.length) { console.log(`[discover] NOT FOUND: ${spec.key}`); continue; }

    // latest year: titles usually lack year; use 'modified' date, pick newest
    matches.sort((a, b) => new Date(b.modified || 0) - new Date(a.modified || 0));
    const best = matches[0];

    // find the data-api distribution
    const dist = (best.distribution || []).find(d =>
      (d.accessURL || '').includes('data-api') || (d.format || '').toLowerCase() === 'api'
    );
    if (!dist) { console.log(`[discover] no API distribution: ${spec.key}`); continue; }

    let apiUrl = dist.accessURL;
    // normalize: want .../data-api/v1/dataset/{uuid}/data
    if (!apiUrl.endsWith('/data')) apiUrl = apiUrl.replace(/\/$/, '') + '/data';

    found[spec.key] = { url: apiUrl, title: best.title, modified: best.modified, stateField: spec.stateField };
    console.log(`[discover] ${spec.key}: ${best.title} (${best.modified})`);
  }
  return found;
}

// ── setup table ───────────────────────────────────────────────
async function setup() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS medicare_billed (
      id SERIAL PRIMARY KEY,
      dataset TEXT,                 -- physician | outpatient | inpatient
      npi TEXT, ccn TEXT,
      provider_name TEXT,
      provider_type TEXT,
      city TEXT, state TEXT DEFAULT 'TX', zip TEXT,
      code TEXT,                    -- HCPCS/CPT, APC, or DRG
      code_type TEXT,               -- 'CPT' | 'APC' | 'DRG'
      description TEXT,
      services_count NUMERIC(12,1),
      beneficiaries NUMERIC(12,0),
      avg_billed NUMERIC(12,2),     -- what they charged Medicare
      avg_allowed NUMERIC(12,2),    -- what Medicare allowed
      avg_paid NUMERIC(12,2),       -- what Medicare actually paid
      markup_ratio NUMERIC(8,2),    -- billed / paid
      place_of_service TEXT,
      source_title TEXT,
      scraped_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (dataset, npi, ccn, code, place_of_service)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mb_code ON medicare_billed(code)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mb_name ON medicare_billed(provider_name)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mb_zip ON medicare_billed(zip)`);
  console.log('[setup] medicare_billed table ready');
}

// ── generic paginated fetch of TX rows ───────────────────────
async function* fetchTexasRows(apiUrl, stateField) {
  const SIZE = 5000;
  let offset = 0;
  while (true) {
    const url = `${apiUrl}?filter[${stateField}]=TX&size=${SIZE}&offset=${offset}`;
    let rows;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await axios.get(url, { timeout: 120000 });
        rows = res.data;
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        console.log(`  retry ${attempt} (offset ${offset}): ${e.message}`);
        await sleep(3000 * attempt);
      }
    }
    if (!Array.isArray(rows) || rows.length === 0) return;
    yield rows;
    if (rows.length < SIZE) return;
    offset += SIZE;
    await sleep(300);
  }
}

// ── PHYSICIAN & OTHER PRACTITIONERS (CPT level) ──────────────
async function loadPhysician(ds) {
  console.log('\n[physician] downloading TX rows (largest dataset, be patient)...');
  let inserted = 0, scanned = 0;
  for await (const rows of fetchTexasRows(ds.url, ds.stateField)) {
    const values = [];
    for (const r of rows) {
      scanned++;
      const zip = r.Rndrng_Prvdr_Zip5;
      if (!isDfwZip(zip)) continue;
      const billed = num(r.Avg_Sbmtd_Chrg);
      const paid = num(r.Avg_Mdcr_Pymt_Amt);
      values.push([
        'physician', r.Rndrng_NPI || null, null,
        [r.Rndrng_Prvdr_First_Name, r.Rndrng_Prvdr_Last_Org_Name].filter(Boolean).join(' ').trim(),
        r.Rndrng_Prvdr_Type || null,
        r.Rndrng_Prvdr_City || null, zip,
        r.HCPCS_Cd || null, 'CPT', (r.HCPCS_Desc || '').slice(0, 300),
        num(r.Tot_Srvcs), num(r.Tot_Benes),
        billed, num(r.Avg_Mdcr_Alowd_Amt), paid,
        billed && paid ? +(billed / paid).toFixed(2) : null,
        r.Place_Of_Srvc || null, ds.title,
      ]);
    }
    for (const v of values) {
      await pool.query(`
        INSERT INTO medicare_billed
          (dataset,npi,ccn,provider_name,provider_type,city,zip,code,code_type,description,
           services_count,beneficiaries,avg_billed,avg_allowed,avg_paid,markup_ratio,place_of_service,source_title)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (dataset,npi,ccn,code,place_of_service) DO UPDATE SET
          avg_billed = EXCLUDED.avg_billed, avg_paid = EXCLUDED.avg_paid,
          avg_allowed = EXCLUDED.avg_allowed, services_count = EXCLUDED.services_count
      `, v).catch(() => {});
      inserted++;
    }
    process.stdout.write(`  scanned ${scanned.toLocaleString()} TX rows → ${inserted.toLocaleString()} DFW inserted\r`);
  }
  console.log(`\n[physician] done: ${inserted.toLocaleString()} DFW provider×CPT rows`);
  return inserted;
}

// ── OUTPATIENT HOSPITALS (APC level) ─────────────────────────
async function loadOutpatient(ds) {
  console.log('\n[outpatient] downloading TX hospital rows...');
  let inserted = 0;
  for await (const rows of fetchTexasRows(ds.url, ds.stateField)) {
    for (const r of rows) {
      const zip = r.Rndrng_Prvdr_Zip5 || r.Rndrng_Prvdr_St_Zip;
      if (!isDfwZip(zip)) continue;
      const billed = num(r.Avg_Tot_Sbmtd_Chrgs);
      const paid = num(r.Avg_Mdcr_Pymt_Amt);
      await pool.query(`
        INSERT INTO medicare_billed
          (dataset,npi,ccn,provider_name,provider_type,city,zip,code,code_type,description,
           services_count,beneficiaries,avg_billed,avg_allowed,avg_paid,markup_ratio,place_of_service,source_title)
        VALUES ('outpatient',NULL,$1,$2,'Hospital Outpatient',$3,$4,$5,'APC',$6,$7,$8,$9,$10,$11,$12,'F',$13)
        ON CONFLICT (dataset,npi,ccn,code,place_of_service) DO UPDATE SET
          avg_billed = EXCLUDED.avg_billed, avg_paid = EXCLUDED.avg_paid
      `, [
        r.Rndrng_Prvdr_CCN || null, r.Rndrng_Prvdr_Org_Name || null,
        r.Rndrng_Prvdr_City || null, zip,
        r.APC_Cd || null, (r.APC_Desc || '').slice(0, 300),
        num(r.CAPC_Srvcs || r.Tot_Srvcs), num(r.Bene_Cnt || r.Tot_Benes),
        billed, num(r.Avg_Mdcr_Alowd_Amt), paid,
        billed && paid ? +(billed / paid).toFixed(2) : null,
        ds.title,
      ]).catch(() => {});
      inserted++;
    }
    process.stdout.write(`  ${inserted.toLocaleString()} DFW outpatient rows\r`);
  }
  console.log(`\n[outpatient] done: ${inserted.toLocaleString()} rows`);
  return inserted;
}

// ── INPATIENT HOSPITALS (DRG level) ──────────────────────────
async function loadInpatient(ds) {
  console.log('\n[inpatient] downloading TX hospital rows...');
  let inserted = 0;
  for await (const rows of fetchTexasRows(ds.url, ds.stateField)) {
    for (const r of rows) {
      const zip = r.Rndrng_Prvdr_Zip5 || r.Rndrng_Prvdr_St_Zip;
      if (!isDfwZip(zip)) continue;
      const billed = num(r.Avg_Submtd_Cvrd_Chrg);
      const paid = num(r.Avg_Mdcr_Pymt_Amt);
      await pool.query(`
        INSERT INTO medicare_billed
          (dataset,npi,ccn,provider_name,provider_type,city,zip,code,code_type,description,
           services_count,beneficiaries,avg_billed,avg_allowed,avg_paid,markup_ratio,place_of_service,source_title)
        VALUES ('inpatient',NULL,$1,$2,'Hospital Inpatient',$3,$4,$5,'DRG',$6,$7,$8,$9,$10,$11,$12,'F',$13)
        ON CONFLICT (dataset,npi,ccn,code,place_of_service) DO UPDATE SET
          avg_billed = EXCLUDED.avg_billed, avg_paid = EXCLUDED.avg_paid
      `, [
        r.Rndrng_Prvdr_CCN || null, r.Rndrng_Prvdr_Org_Name || null,
        r.Rndrng_Prvdr_City || null, zip,
        r.DRG_Cd || null, (r.DRG_Desc || '').slice(0, 300),
        num(r.Tot_Dschrgs), num(r.Tot_Dschrgs),
        billed, num(r.Avg_Tot_Pymt_Amt), paid,
        billed && paid ? +(billed / paid).toFixed(2) : null,
        ds.title,
      ]).catch(() => {});
      inserted++;
    }
    process.stdout.write(`  ${inserted.toLocaleString()} DFW inpatient rows\r`);
  }
  console.log(`\n[inpatient] done: ${inserted.toLocaleString()} rows`);
  return inserted;
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log('MEDICARE PUF SCRAPER — DFW billed vs paid');
  console.log('='.repeat(50));
  await setup();
  const ds = await discoverDatasets();

  const results = {};
  if (ds.physician)  { try { results.physician  = await loadPhysician(ds.physician); }  catch(e){ console.log('physician failed:',  e.message); } }
  if (ds.outpatient) { try { results.outpatient = await loadOutpatient(ds.outpatient); } catch(e){ console.log('outpatient failed:', e.message); } }
  if (ds.inpatient)  { try { results.inpatient  = await loadInpatient(ds.inpatient); }  catch(e){ console.log('inpatient failed:',  e.message); } }

  console.log('\n' + '='.repeat(50));
  console.log('TOP DFW MEDICARE MARKUPS (billed vs paid):');
  const top = await pool.query(`
    SELECT provider_name, city, code, LEFT(description,60) as descr,
      avg_billed, avg_paid, markup_ratio, services_count
    FROM medicare_billed
    WHERE markup_ratio IS NOT NULL AND services_count > 20
    ORDER BY markup_ratio DESC LIMIT 15
  `);
  for (const r of top.rows) {
    console.log(`  ${r.provider_name} (${r.city}) ${r.code}: billed $${r.avg_billed} → Medicare paid $${r.avg_paid} (${r.markup_ratio}x, n=${r.services_count})`);
  }

  const counts = await pool.query(`SELECT dataset, COUNT(*), COUNT(DISTINCT COALESCE(npi,ccn)) as providers FROM medicare_billed GROUP BY dataset`);
  console.log('\nTable totals:');
  for (const r of counts.rows) console.log(`  ${r.dataset}: ${parseInt(r.count).toLocaleString()} rows, ${r.providers} providers`);

  console.log('\nAdd to server.js:');
  console.log(`
app.get('/medicare-billed', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const result = await pool.query(\`
      SELECT provider_name, provider_type, city, zip, code, code_type, description,
        services_count, avg_billed, avg_allowed, avg_paid, markup_ratio, dataset
      FROM medicare_billed
      WHERE code = $1 OR provider_name ILIKE $2 OR description ILIKE $2
      ORDER BY avg_paid ASC NULLS LAST LIMIT 100
    \`, [q, \`%\${q}%\`]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});`);
  await pool.end();
}

main().catch(console.error);