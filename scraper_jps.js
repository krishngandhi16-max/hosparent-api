require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const parsePrice = (v) => {
  if (!v) return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isNaN(n) || n <= 0 || n > 999999 ? null : n;
};

async function getOrCreateHospital(name, city) {
  const ex = await pool.query('SELECT id FROM hospitals WHERE name = $1 LIMIT 1', [name]);
  if (ex.rows.length > 0) return ex.rows[0].id;
  const r = await pool.query(`INSERT INTO hospitals (name, city, state, is_compliant) VALUES ($1,$2,'TX',true) RETURNING id`, [name, city]);
  return r.rows[0].id;
}

async function getOrCreateProcedure(name, cpt) {
  if (!name?.trim()) return null;
  const cleanName = name.trim().substring(0, 500);
  const cleanCpt = cpt?.trim().substring(0, 20) || null;
  const ex = await pool.query('SELECT id FROM procedures WHERE standard_name = $1 LIMIT 1', [cleanName]);
  if (ex.rows.length > 0) return ex.rows[0].id;
  let mr = null, mn = null;
  if (cleanCpt && /^\d{5}$/.test(cleanCpt)) {
    const m = await pool.query('SELECT facility_rate, non_facility_rate FROM medicare_rates WHERE cpt_code = $1 AND modifier IS NULL LIMIT 1', [cleanCpt]);
    mr = m.rows[0]?.facility_rate || null;
    mn = m.rows[0]?.non_facility_rate || null;
  }
  const r = await pool.query(`INSERT INTO procedures (standard_name, cpt_code, medicare_facility_rate, medicare_non_facility_rate, is_searchable) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`, [cleanName, cleanCpt, mr, mn, !!(cleanCpt && /^\d{5}$/.test(cleanCpt))]);
  if (r.rows.length > 0) return r.rows[0].id;
  const retry = await pool.query('SELECT id FROM procedures WHERE standard_name = $1 LIMIT 1', [cleanName]);
  return retry.rows[0]?.id || null;
}

const HOSPITALS = [
  { name: 'JPS Health Network', city: 'Fort Worth', urls: [
    'https://www.ticmrf.com/75-6000439',
    'https://ticmrf.com/75-6000439',
    'https://www.jpshealthnet.org/sites/default/files/price-transparency/75-6000439_JPS-Health-Network_standardcharges.json',
    'https://www.jpshealthnet.org/financial-resources/price-transparency',
  ]},
  { name: 'Wise Health System', city: 'Decatur', urls: [
    'https://www.wisehealthsystem.com/patients/billing/price-transparency',
    'https://wisehealthsystem.com/wp-content/uploads/2024/01/standard-charges.json',
    'https://www.wisehealthsystem.com/standard-charges.json',
  ]},
  { name: 'Hunt Regional Medical Center', city: 'Greenville', urls: [
    'https://www.huntregional.org/standard-charges.json',
    'https://huntregional.org/wp-content/uploads/2024/standard-charges.json',
  ]},
  { name: 'Texas Institute for Surgery', city: 'Dallas', urls: [
    'https://texasinstituteofsurgery.com/standard-charges.json',
    'https://www.texasinstituteofsurgery.com/standard-charges.json',
    'https://tismd.com/standard-charges.json',
  ]},
];

async function scrapeHospital(hospital) {
  console.log(`\nScraping: ${hospital.name}`);
  for (const url of hospital.urls) {
    try {
      console.log(`  Trying: ${url.substring(0, 70)}`);
      const res = await axios.get(url, {
        timeout: 60000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json,text/html,*/*' },
        maxRedirects: 5,
      });

      // If HTML page, look for JSON link
      if (typeof res.data === 'string' && res.data.includes('<html')) {
        const jsonMatch = res.data.match(/href="([^"]*standard[^"]*\.json[^"]*)"/i) ||
                          res.data.match(/href="([^"]*standardcharge[^"]*)"/i);
        if (jsonMatch) {
          console.log(`  Found JSON link: ${jsonMatch[1]}`);
          const jsonUrl = jsonMatch[1].startsWith('http') ? jsonMatch[1] : `https://www.jpshealthnet.org${jsonMatch[1]}`;
          const jsonRes = await axios.get(jsonUrl, { timeout: 120000, headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (jsonRes.data) {
            return await processData(jsonRes.data, hospital);
          }
        }
        continue;
      }

      const result = await processData(res.data, hospital);
      if (result > 0) return result;

    } catch(e) {
      console.log(`  ✗ ${e.message}`);
    }
  }
  console.log(`  ✗ All URLs failed for ${hospital.name}`);
  return 0;
}

async function processData(data, hospital) {
  const hospitalId = await getOrCreateHospital(hospital.name, hospital.city);
  let inserted = 0;
  const charges = data.standard_charge_information || data.charges || data.items || [];
  if (charges.length === 0) return 0;

  console.log(`  Found ${charges.length} charge items`);

  for (const item of charges) {
    const desc = item.description || item.charge_description;
    if (!desc) continue;
    let cpt = null;
    if (Array.isArray(item.code_information)) {
      const e = item.code_information.find(c => c.type === 'CPT' || c.type === 'HCPCS');
      cpt = e?.code || null;
    }
    const chargeArr = item.standard_charges || [];
    for (const charge of chargeArr) {
      const cash = parsePrice(charge.discounted_cash);
      const gross = parsePrice(charge.minimum) || parsePrice(charge.maximum);
      if (!cash && !gross) continue;
      try {
        const pid = await getOrCreateProcedure(desc, cpt);
        if (!pid) continue;
        if (cash) { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type,is_cash_price) VALUES ($1,$2,$3,'cash',true) ON CONFLICT DO NOTHING`, [hospitalId, pid, cash]); inserted++; }
        else { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type) VALUES ($1,$2,$3,'gross') ON CONFLICT DO NOTHING`, [hospitalId, pid, gross]); inserted++; }
      } catch(e) {}
    }
  }
  console.log(`  ✓ ${hospital.name}: ${inserted} rows`);
  return inserted;
}

async function main() {
  console.log('JPS + Additional Hospital Scraper');
  let total = 0;
  for (const h of HOSPITALS) {
    total += await scrapeHospital(h);
  }
  console.log(`\nTotal: ${total} rows`);
  const t = await pool.query('SELECT COUNT(*) FROM prices');
  console.log(`DB total: ${t.rows[0].count}`);
  await pool.end();
}

main().catch(console.error);