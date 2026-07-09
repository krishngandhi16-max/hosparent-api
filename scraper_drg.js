require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const AdmZip = require('adm-zip');
const XLSX = require('xlsx');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function main() {
  console.log('Downloading Medicare DRG Table 5 (FY2026)...');

  await pool.query(`CREATE TABLE IF NOT EXISTS medicare_drg_rates (
    id SERIAL PRIMARY KEY,
    drg_code TEXT,
    description TEXT,
    relative_weight NUMERIC(8,4),
    geometric_mean_los NUMERIC(6,2),
    arithmetic_mean_los NUMERIC(6,2),
    national_rate NUMERIC(10,2),
    year INTEGER DEFAULT 2026,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS drg_code_idx ON medicare_drg_rates(drg_code)`);

  const url = 'https://www.cms.gov/files/zip/fy2026-ipps-fr-table-5.zip';
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });

  fs.writeFileSync('tmp_drg.zip', Buffer.from(res.data));
  console.log(`Downloaded ${(res.data.byteLength/1024/1024).toFixed(1)} MB`);

  const zip = new AdmZip('tmp_drg.zip');
  let xlsxData = null;
  let fileName = null;

  for (const entry of zip.getEntries()) {
    console.log(`  Found: ${entry.entryName}`);
    if (entry.entryName.toLowerCase().endsWith('.xlsx') || entry.entryName.toLowerCase().endsWith('.xls')) {
      xlsxData = entry.getData();
      fileName = entry.entryName;
    }
  }

  if (!xlsxData) {
    // Try CSV
    for (const entry of zip.getEntries()) {
      if (entry.entryName.toLowerCase().endsWith('.csv')) {
        const content = entry.getData().toString('utf8');
        console.log('CSV found, first 3 lines:');
        content.split('\n').slice(0,3).forEach((l,i) => console.log(`  Row ${i}:`, l.substring(0,200)));
        fs.unlinkSync('tmp_drg.zip');
        await pool.end();
        return;
      }
    }
  }

  fs.unlinkSync('tmp_drg.zip');

  if (!xlsxData) { console.log('No XLSX or CSV found'); await pool.end(); return; }
  console.log(`Parsing: ${fileName}`);

  // Write temp xlsx
  fs.writeFileSync('tmp_drg.xlsx', xlsxData);
  const wb = XLSX.readFile('tmp_drg.xlsx');
  fs.unlinkSync('tmp_drg.xlsx');

  console.log('Sheets:', wb.SheetNames);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  console.log(`Total rows: ${rows.length}`);
  console.log('Row 0:', rows[0]?.slice(0,8));
  console.log('Row 1:', rows[1]?.slice(0,8));
  console.log('Row 2:', rows[2]?.slice(0,8));

  // FY2026 base rate for DFW (Texas wage index ~0.99, labor share 66%)
  // National standardized amount FY2026 ~$7,183 operating
  const NATIONAL_RATE = 7183;

  await pool.query('DELETE FROM medicare_drg_rates');
  let inserted = 0;

  // Hardcoded data start as header is row 1 (0-indexed 1)
  let dataStart = 2;

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    const drg = String(row[0]).trim();
    if (!drg || !drg.match(/^\d+$/)) continue;

    const desc = String(row[5] || '').trim();
    const weight = parseFloat(row[7] || row[6] || 0) || 0;
    const geoMean = parseFloat(row[8] || 0) || 0;
    const arithMean = parseFloat(row[9] || 0) || 0;

    if (!weight) continue;

    // National rate = weight * standardized amount
    const rate = (weight * NATIONAL_RATE).toFixed(2);

    try {
      await pool.query(`
        INSERT INTO medicare_drg_rates (drg_code, description, relative_weight, geometric_mean_los, arithmetic_mean_los, national_rate)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING
      `, [drg, desc, weight, geoMean, arithMean, rate]);
      inserted++;
    } catch(e) {}
  }

  console.log(`\nInserted ${inserted} DRG rates`);

  // Show key DRGs
  const sample = await pool.query(`
    SELECT drg_code, description, relative_weight, national_rate, geometric_mean_los
    FROM medicare_drg_rates
    WHERE drg_code IN ('470','469','392','291','292','247','246','765','766','871','872')
    ORDER BY drg_code
  `);
  console.log('\nKey DRG rates:');
  for (const r of sample.rows) {
    console.log(`  DRG ${r.drg_code}: $${r.national_rate} (${r.geometric_mean_los} days avg) | ${r.description?.substring(0,50)}`);
  }

  const count = await pool.query('SELECT COUNT(*) FROM medicare_drg_rates');
  console.log(`\nTotal DRGs: ${count.rows[0].count}`);

  await pool.end();
}

main().catch(console.error);