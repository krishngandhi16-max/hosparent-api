require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const csv = require('csv-parse/sync');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const HOSPITALS = [
  {
    name: 'Parkland Memorial Hospital',
    city: 'Dallas',
    url: 'https://www.parklandhealth.org/Uploads/Public/Documents/PDFs/Reports-Discolures/2026/price%20transparency/756004221_parkland-health_standardcharges_052926.zip',
  },
];

function buildSchema(headers) {
  const schema = { descIdx: -1, cptIdx: -1, cashIdx: -1, grossIdx: -1, payerIdx: -1, planIdx: -1, rateIdx: -1 };
  headers.forEach((h, i) => {
    const clean = (h || '').toLowerCase().trim().replace(/\ufeff/g, '');
    if (clean === 'description') schema.descIdx = i;
    if (clean === 'standard_charge|discounted_cash') schema.cashIdx = i;
    if (clean === 'standard_charge|gross') schema.grossIdx = i;
    if (clean === 'payer_name') schema.payerIdx = i;
    if (clean === 'plan_name') schema.planIdx = i;
    if (clean === 'standard_charge|negotiated_dollar') schema.rateIdx = i;
    if (clean === 'code|1') schema.cptIdx = i;
    if (schema.descIdx < 0 && /description|procdesc|servicename/.test(clean)) schema.descIdx = i;
    if (schema.cptIdx < 0 && /^code$|cpt|billingcode|procedurecode/.test(clean)) schema.cptIdx = i;
    if (schema.cashIdx < 0 && /cash|discountedcash|selfpay|uninsured/.test(clean)) schema.cashIdx = i;
    if (schema.grossIdx < 0 && /gross|listprice/.test(clean)) schema.grossIdx = i;
  });
  return schema;
}

async function downloadZip(url, tmpPath) {
  console.log(`  Downloading...`);
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 300000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  fs.writeFileSync(tmpPath, Buffer.from(res.data));
  console.log(`  Downloaded ${(res.data.byteLength / 1024 / 1024).toFixed(1)} MB`);
}

function extractCSV(zipPath) {
  const zip = new AdmZip(zipPath);
  for (const entry of zip.getEntries()) {
    if (entry.entryName.endsWith('.csv') && !entry.entryName.includes('shoppable')) {
      console.log(`  Extracting: ${entry.entryName} (${(entry.header.size/1024/1024).toFixed(1)} MB)`);
      return entry.getData();
    }
  }
  for (const entry of zip.getEntries()) {
    if (entry.entryName.endsWith('.csv')) return entry.getData();
  }
  return null;
}

async function getOrCreateHospital(name, city) {
  const ex = await pool.query('SELECT id FROM hospitals WHERE name = $1 LIMIT 1', [name]);
  if (ex.rows.length > 0) return ex.rows[0].id;
  const r = await pool.query(`INSERT INTO hospitals (name, city, state, is_compliant) VALUES ($1, $2, 'TX', true) RETURNING id`, [name, city]);
  return r.rows[0].id;
}

async function getOrCreateProcedure(name, cpt) {
  if (!name?.trim()) return null;
  const cleanName = name.trim().substring(0, 500);
  const cleanCpt = cpt?.trim().substring(0, 20) || null;
  const ex = await pool.query('SELECT id FROM procedures WHERE standard_name = $1 LIMIT 1', [cleanName]);
  if (ex.rows.length > 0) return ex.rows[0].id;
  const r = await pool.query(`INSERT INTO procedures (standard_name, cpt_code) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`, [cleanName, cleanCpt]);
  if (r.rows.length > 0) return r.rows[0].id;
  const retry = await pool.query('SELECT id FROM procedures WHERE standard_name = $1 LIMIT 1', [cleanName]);
  return retry.rows[0]?.id || null;
}

const parsePrice = (v) => {
  if (!v) return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isNaN(n) || n <= 0 ? null : n;
};

async function processBuffer(buffer, hospitalId) {
  let records;
  try {
    records = csv.parse(buffer, { columns: false, skip_empty_lines: true, relax_column_count: true, bom: true });
  } catch (err) {
    console.log(`  CSV parse error: ${err.message}`);
    return 0;
  }

  let headerRow = 0;
  let schema = null;
  for (let i = 0; i < Math.min(5, records.length); i++) {
    const s = buildSchema(records[i]);
    if (s.descIdx >= 0 && (s.cashIdx >= 0 || s.grossIdx >= 0)) {
      schema = s; headerRow = i; break;
    }
  }

  if (!schema) {
    console.log('  Could not find header. Row 0:', records[0]?.slice(0, 6));
    console.log('  Row 2:', records[2]?.slice(0, 10));
    return 0;
  }

  console.log(`  Header row ${headerRow}: desc=${schema.descIdx} cpt=${schema.cptIdx} cash=${schema.cashIdx} gross=${schema.grossIdx}`);

  let inserted = 0;
  let batch = [];

  for (let i = headerRow + 1; i < records.length; i++) {
    const row = records[i];
    const desc = schema.descIdx >= 0 ? row[schema.descIdx] : null;
    const cpt = schema.cptIdx >= 0 ? row[schema.cptIdx] : null;
    const cash = parsePrice(schema.cashIdx >= 0 ? row[schema.cashIdx] : null);
    const gross = parsePrice(schema.grossIdx >= 0 ? row[schema.grossIdx] : null);
    const payer = schema.payerIdx >= 0 ? row[schema.payerIdx] : null;
    const plan = schema.planIdx >= 0 ? row[schema.planIdx] : null;
    const rate = parsePrice(schema.rateIdx >= 0 ? row[schema.rateIdx] : null);
    if ((!desc && !cpt) || (!cash && !gross && !rate)) continue;
    batch.push({ desc, cpt, cash, gross, payer, plan, rate });
    if (batch.length >= 1000) { inserted += await flush(batch, hospitalId); batch = []; if (inserted % 50000 === 0 && inserted > 0) console.log(`  ${inserted} rows...`); }
  }
  if (batch.length > 0) inserted += await flush(batch, hospitalId);
  return inserted;
}

async function flush(batch, hospitalId) {
  let count = 0;
  for (const item of batch) {
    try {
      const pid = await getOrCreateProcedure(item.desc, item.cpt);
      if (!pid) continue;
      if (item.cash) { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type,is_cash_price) VALUES ($1,$2,$3,'cash',true) ON CONFLICT DO NOTHING`, [hospitalId, pid, item.cash]); count++; }
      if (item.gross) { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type) VALUES ($1,$2,$3,'gross') ON CONFLICT DO NOTHING`, [hospitalId, pid, item.gross]); count++; }
      if (item.rate && item.payer) { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type,payer_name,plan_name) VALUES ($1,$2,$3,'negotiated',$4,$5) ON CONFLICT DO NOTHING`, [hospitalId, pid, item.rate, item.payer, item.plan]); count++; }
    } catch (e) {}
  }
  return count;
}

async function main() {
  console.log('Hosparent — Parkland Scraper');
  console.log('=============================');
  const tmpDir = path.join(process.cwd(), 'tmp_parkland');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
  let total = 0;

  for (const h of HOSPITALS) {
    console.log(`\nScraping: ${h.name}`);
    const tmpZip = path.join(tmpDir, 'tmp.zip');
    try {
      await downloadZip(h.url, tmpZip);
      const buf = extractCSV(tmpZip);
      if (!buf) { console.log('  No CSV found'); fs.unlinkSync(tmpZip); continue; }
      const hid = await getOrCreateHospital(h.name, h.city);
      console.log(`  Hospital ID: ${hid}`);
      const n = await processBuffer(buf, hid);
      console.log(`  Done: ${n} rows`);
      total += n;
      fs.unlinkSync(tmpZip);
    } catch (err) {
      console.log(`  Error: ${err.message}`);
      if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
    }
  }

  console.log(`\nTotal: ${total} rows`);
  await pool.end();
}

main().catch(console.error);