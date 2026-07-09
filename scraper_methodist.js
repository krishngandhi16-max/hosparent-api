require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const readline = require('readline');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const HOSPITALS = [
  { name: 'Methodist Dallas Medical Center', city: 'Dallas', url: 'https://www.methodisthealthsystem.org/sites/default/files/Price%20Transparency/750800661_MethodistDallasMedicalCenter_standardcharges.zip' },
  { name: 'Methodist Charlton Medical Center', city: 'Dallas', url: 'https://www.methodisthealthsystem.org/sites/default/files/Price%20Transparency/750800661_MethodistCharltonMedicalCenter_standardcharges.zip' },
  { name: 'Methodist Mansfield Medical Center', city: 'Mansfield', url: 'https://www.methodisthealthsystem.org/sites/default/files/Price%20Transparency/750800661_MethodistMansfieldMedicalCenter_standardcharges.zip' },
  { name: 'Methodist Southlake Medical Center', city: 'Southlake', url: 'https://www.methodisthealthsystem.org/sites/default/files/Price%20Transparency/750800661_MethodistSouthlakeMedicalCenter_standardcharges.zip' },
  { name: 'Methodist Midlothian Medical Center', city: 'Midlothian', url: 'https://www.methodisthealthsystem.org/sites/default/files/Price%20Transparency/750800661_MethodistMidlothianMedicalCenter_standardcharges.zip' },
];

const parsePrice = (v) => {
  if (!v) return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isNaN(n) || n <= 0 ? null : n;
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
  const r = await pool.query(`INSERT INTO procedures (standard_name, cpt_code) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id`, [cleanName, cleanCpt]);
  if (r.rows.length > 0) return r.rows[0].id;
  const retry = await pool.query('SELECT id FROM procedures WHERE standard_name = $1 LIMIT 1', [cleanName]);
  return retry.rows[0]?.id || null;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuotes = !inQuotes;
    } else if (line[i] === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += line[i];
    }
  }
  result.push(current.trim());
  return result;
}

async function processHospital(hospital) {
  console.log(`\n========================================`);
  console.log(`Scraping: ${hospital.name}`);
  console.log(`========================================`);

  const tmpZip = path.join(process.cwd(), 'tmp_methodist.zip');
  const tmpCsv = path.join(process.cwd(), 'tmp_methodist.csv');

  try {
    // Download
    console.log('  Downloading...');
    const res = await axios.get(hospital.url, { responseType: 'arraybuffer', timeout: 180000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    fs.writeFileSync(tmpZip, Buffer.from(res.data));
    console.log(`  Downloaded ${(res.data.byteLength/1024/1024).toFixed(1)} MB`);

    // Extract CSV to disk (don't load into memory)
    const zip = new AdmZip(tmpZip);
    let csvEntry = null;
    for (const entry of zip.getEntries()) {
      if (entry.entryName.endsWith('.csv') && !entry.entryName.includes('shoppable')) {
        csvEntry = entry;
        break;
      }
    }
    if (!csvEntry) { console.log('  No CSV found'); return 0; }
    
    console.log(`  Extracting: ${csvEntry.entryName} (${(csvEntry.header.size/1024/1024).toFixed(1)} MB)`);
    zip.extractEntryTo(csvEntry, process.cwd(), false, true);
    fs.renameSync(path.join(process.cwd(), csvEntry.entryName), tmpCsv);
    fs.unlinkSync(tmpZip);

    const hospitalId = await getOrCreateHospital(hospital.name, hospital.city);
    console.log(`  Hospital ID: ${hospitalId}`);

    // Stream CSV line by line
    const rl = readline.createInterface({ input: fs.createReadStream(tmpCsv, { encoding: 'utf8' }), crlfDelay: Infinity });

    let lineNum = 0;
    let headers = [];
    let schema = null;
    let inserted = 0;
    let batch = [];
    const BATCH_SIZE = 500;

    for await (const line of rl) {
      lineNum++;
      const parts = parseCSVLine(line);

      // Find header row (row 2 in Methodist CMS 2024 format)
      if (!schema && lineNum <= 5) {
        const cleaned = parts.map(h => (h || '').toLowerCase().trim().replace(/\ufeff/g, ''));
        if (cleaned[0] === 'description' && cleaned.some(h => h.includes('standard_charge'))) {
          headers = cleaned;
          // CMS 2024 format exact column positions
          schema = {
            descIdx: headers.indexOf('description'),
            cptIdx: headers.indexOf('code|1'),
            cashIdx: headers.indexOf('standard_charge|discounted_cash'),
            grossIdx: headers.indexOf('standard_charge|gross'),
            payerIdx: headers.indexOf('payer_name'),
            planIdx: headers.indexOf('plan_name'),
            rateIdx: headers.indexOf('standard_charge|negotiated_dollar'),
          };
          console.log(`  Header at line ${lineNum}: desc=${schema.descIdx} cpt=${schema.cptIdx} cash=${schema.cashIdx} gross=${schema.grossIdx}`);
          continue;
        }
        continue;
      }

      if (!schema) continue;

      const desc = schema.descIdx >= 0 ? parts[schema.descIdx] : null;
      const cpt = schema.cptIdx >= 0 ? parts[schema.cptIdx] : null;
      const cash = parsePrice(schema.cashIdx >= 0 ? parts[schema.cashIdx] : null);
      const gross = parsePrice(schema.grossIdx >= 0 ? parts[schema.grossIdx] : null);
      const payer = schema.payerIdx >= 0 ? parts[schema.payerIdx] : null;
      const plan = schema.planIdx >= 0 ? parts[schema.planIdx] : null;
      const rate = parsePrice(schema.rateIdx >= 0 ? parts[schema.rateIdx] : null);

      if ((!desc && !cpt) || (!cash && !gross && !rate)) continue;

      batch.push({ desc, cpt, cash, gross, payer, plan, rate });

      if (batch.length >= BATCH_SIZE) {
        for (const item of batch) {
          try {
            const pid = await getOrCreateProcedure(item.desc, item.cpt);
            if (!pid) continue;
            if (item.cash) { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type,is_cash_price) VALUES ($1,$2,$3,'cash',true) ON CONFLICT DO NOTHING`, [hospitalId, pid, item.cash]); inserted++; }
            if (item.gross) { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type) VALUES ($1,$2,$3,'gross') ON CONFLICT DO NOTHING`, [hospitalId, pid, item.gross]); inserted++; }
            if (item.rate && item.payer) { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type,payer_name,plan_name) VALUES ($1,$2,$3,'negotiated',$4,$5) ON CONFLICT DO NOTHING`, [hospitalId, pid, item.rate, item.payer, item.plan]); inserted++; }
          } catch(e) {}
        }
        batch = [];
        if (inserted % 50000 === 0 && inserted > 0) console.log(`  ${inserted} rows inserted...`);
      }
    }

    // Flush remaining
    for (const item of batch) {
      try {
        const pid = await getOrCreateProcedure(item.desc, item.cpt);
        if (!pid) continue;
        if (item.cash) { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type,is_cash_price) VALUES ($1,$2,$3,'cash',true) ON CONFLICT DO NOTHING`, [hospitalId, pid, item.cash]); inserted++; }
        if (item.gross) { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type) VALUES ($1,$2,$3,'gross') ON CONFLICT DO NOTHING`, [hospitalId, pid, item.gross]); inserted++; }
        if (item.rate && item.payer) { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type,payer_name,plan_name) VALUES ($1,$2,$3,'negotiated',$4,$5) ON CONFLICT DO NOTHING`, [hospitalId, pid, item.rate, item.payer, item.plan]); inserted++; }
      } catch(e) {}
    }

    if (fs.existsSync(tmpCsv)) fs.unlinkSync(tmpCsv);
    console.log(`  Done: ${inserted} rows inserted`);
    return inserted;

  } catch(err) {
    console.log(`  Error: ${err.message}`);
    if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
    if (fs.existsSync(tmpCsv)) fs.unlinkSync(tmpCsv);
    return 0;
  }
}

async function main() {
  console.log('Hosparent — Methodist Streaming Scraper');
  console.log('========================================');
  let total = 0;
  for (const h of HOSPITALS) {
    total += await processHospital(h);
  }
  console.log(`\nTOTAL: ${total} rows`);
  await pool.end();
}

main().catch(console.error);