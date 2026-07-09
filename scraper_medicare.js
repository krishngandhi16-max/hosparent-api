require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function main() {
  console.log('Medicare Scraper Starting...');

  await pool.query(`CREATE TABLE IF NOT EXISTS medicare_rates (
    id SERIAL PRIMARY KEY, cpt_code TEXT, modifier TEXT, description TEXT,
    facility_rate NUMERIC(10,2), non_facility_rate NUMERIC(10,2),
    work_rvu NUMERIC(8,4), year INTEGER DEFAULT 2026,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS medicare_cpt_idx ON medicare_rates(cpt_code)`);
  await pool.query(`ALTER TABLE procedures ADD COLUMN IF NOT EXISTS medicare_facility_rate NUMERIC(10,2)`);
  await pool.query(`ALTER TABLE procedures ADD COLUMN IF NOT EXISTS medicare_non_facility_rate NUMERIC(10,2)`);

  const url = 'https://www.cms.gov/files/zip/rvu26a-updated-12-29-2025.zip';
  console.log('Downloading...');
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  fs.writeFileSync('tmp_rvu.zip', Buffer.from(res.data));
  console.log(`Downloaded ${(res.data.byteLength/1024/1024).toFixed(1)} MB`);

  const zip = new AdmZip('tmp_rvu.zip');
  let content = null;
  let fileName = null;

  for (const entry of zip.getEntries()) {
    if (entry.entryName.includes('PPRRVU') && entry.entryName.endsWith('.csv')) {
      content = entry.getData().toString('utf8');
      fileName = entry.entryName;
    }
  }

  fs.unlinkSync('tmp_rvu.zip');
  if (!content) { console.log('No CSV found'); await pool.end(); return; }
  console.log(`Parsing: ${fileName}`);

  const lines = content.split('\n');

  // Find header row
  let dataStart = 0;
  let headers = [];
  for (let i = 0; i < 20; i++) {
    const row = lines[i]?.split(',').map(c => c.trim().replace(/"/g, '').toLowerCase());
    if (row && (row[0] === 'hcpcs' || row[1] === 'mod' || row[0] === 'cpt')) {
      headers = row;
      dataStart = i + 1;
      console.log('ALL HEADERS:', JSON.stringify(headers));
      break;
    }
  }

  if (!headers.length) {
    console.log('No header found. First 10 rows:');
    for (let i = 0; i < 10; i++) console.log(`Row ${i}:`, lines[i]?.substring(0, 300));
    await pool.end();
    return;
  }

  // Headers updated with shifted indexes:
  const workIdx = 5;
  const nonFacPEIdx = 6;
  const facPEIdx = 8;
  const mpIdx = 10;
  // Column 25 is the conversion factor per row
  // Calculate price = (work + pe + mp) * CF from column 25
  const cfIdx = 25;
  console.log('Using fixed column indexes for CMS PFS format');
  console.log('Sample data row:', lines[dataStart]?.substring(0, 500));

  const CF = 32.35;
  await pool.query('DELETE FROM medicare_rates');
  let inserted = 0;

  for (let i = dataStart; i < lines.length; i++) {
    const parts = lines[i]?.split(',').map(p => p.trim().replace(/"/g, ''));
    if (!parts || parts.length < 5) continue;

    const cpt = parts[0]?.trim();
    if (!cpt || cpt.length < 4 || cpt.length > 10) continue;

    const modifier = parts[1] || null;
    const desc = parts[2] || null;
    const status = parts[3];
    if (status && ['B','C','D','E','N','P','R','T','X'].includes(status.toUpperCase())) continue;

    let facRate = null;
    let nonFacRate = null;

    const workRVU = parseFloat(parts[workIdx]) || 0;
    const nonFacPE = parseFloat(parts[nonFacPEIdx]) || 0;
    const facPE = parseFloat(parts[facPEIdx]) || 0;
    const mpRVU = parseFloat(parts[mpIdx]) || 0;
    const rowCF = parseFloat(parts[cfIdx]) || CF;
    
    facRate = (workRVU + facPE + mpRVU) * rowCF;
    nonFacRate = (workRVU + nonFacPE + mpRVU) * rowCF;

    if (!facRate && !nonFacRate) continue;

    try {
      await pool.query(
        `INSERT INTO medicare_rates (cpt_code, modifier, description, facility_rate, non_facility_rate)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [cpt, modifier, desc, facRate?.toFixed(2) || null, nonFacRate?.toFixed(2) || null]
      );
      inserted++;
    } catch(e) {}

    if (inserted % 5000 === 0 && inserted > 0) console.log(`  ${inserted} inserted...`);
  }

  console.log(`\nInserted ${inserted} Medicare rates`);

  const updated = await pool.query(`
    UPDATE procedures p
    SET medicare_facility_rate = m.facility_rate,
        medicare_non_facility_rate = m.non_facility_rate
    FROM medicare_rates m
    WHERE p.cpt_code = m.cpt_code AND m.modifier IS NULL
  `);
  console.log(`Matched ${updated.rowCount} procedures`);

  const sample = await pool.query(`
    SELECT cpt_code, description, facility_rate, non_facility_rate
    FROM medicare_rates WHERE cpt_code IN ('70551','74177','27130','99213','43239')
    ORDER BY cpt_code LIMIT 10
  `);
  console.log('\nSample:');
  for (const r of sample.rows) {
    console.log(`  CPT ${r.cpt_code}: Fac $${r.facility_rate} | NonFac $${r.non_facility_rate} | ${r.description?.substring(0,40)}`);
  }

  const count = await pool.query('SELECT COUNT(*) FROM medicare_rates');
  console.log(`Total: ${count.rows[0].count}`);

  await pool.end();
}

main().catch(console.error);