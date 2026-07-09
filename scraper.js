require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');
const fs = require('fs');
const readline = require('readline');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const REMAINING_HOSPITALS = [
  // Texas Health HEB — try different key
  { name: 'Texas Health Harris Methodist Hospital HEB', city: 'Bedford', state: 'TX', zip: '76022', txtUrl: 'https://www.texashealth.org/cms-hpt.txt', key: 'BEDFORD' },

  // Methodist Health System
  { name: 'Methodist Dallas Medical Center', city: 'Dallas', state: 'TX', zip: '75203', txtUrl: 'https://www.methodisthealthsystem.org/cms-hpt.txt', key: 'DALLAS' },
  { name: 'Methodist McKinney Hospital', city: 'McKinney', state: 'TX', zip: '75070', txtUrl: 'https://www.methodisthealthsystem.org/cms-hpt.txt', key: 'MCKINNEY' },
  { name: 'Methodist Mansfield Medical Center', city: 'Mansfield', state: 'TX', zip: '76063', txtUrl: 'https://www.methodisthealthsystem.org/cms-hpt.txt', key: 'MANSFIELD' },
  { name: 'Methodist Southlake Medical Center', city: 'Southlake', state: 'TX', zip: '76092', txtUrl: 'https://www.methodisthealthsystem.org/cms-hpt.txt', key: 'SOUTHLAKE' },
  { name: 'Methodist Midlothian Medical Center', city: 'Midlothian', state: 'TX', zip: '76065', txtUrl: 'https://www.methodisthealthsystem.org/cms-hpt.txt', key: 'MIDLOTHIAN' },
  { name: 'Methodist Charlton Medical Center', city: 'Dallas', state: 'TX', zip: '75237', txtUrl: 'https://www.methodisthealthsystem.org/cms-hpt.txt', key: 'CHARLTON' },

  // Parkland
  { name: 'Parkland Memorial Hospital', city: 'Dallas', state: 'TX', zip: '75235', txtUrl: 'https://www.parklandhealth.org/cms-hpt.txt', key: 'PARKLAND' },

  // UT Southwestern
  { name: 'UT Southwestern Medical Center', city: 'Dallas', state: 'TX', zip: '75390', txtUrl: 'https://utswmed.org/cms-hpt.txt', key: 'SOUTHWESTERN' },
  { name: 'UT Southwestern University Hospitals', city: 'Dallas', state: 'TX', zip: '75390', txtUrl: 'https://utswmed.org/cms-hpt.txt', key: 'CLEMENTS' },

  // Childrens
  { name: "Children's Medical Center Dallas", city: 'Dallas', state: 'TX', zip: '75235', txtUrl: 'https://www.childrens.com/cms-hpt.txt', key: 'DALLAS' },
  { name: "Children's Medical Center Plano", city: 'Plano', state: 'TX', zip: '75024', txtUrl: 'https://www.childrens.com/cms-hpt.txt', key: 'PLANO' },
];

const txtCache = {};

async function getMRFUrl(txtUrl, key) {
  if (!txtCache[txtUrl]) {
    try {
      console.log('  Fetching: ' + txtUrl);
      const res = await axios.get(txtUrl, { timeout: 30000 });
      txtCache[txtUrl] = res.data;
    } catch (e) {
      console.log('  Failed to fetch txt: ' + e.message);
      return null;
    }
  }

  const text = txtCache[txtUrl];
  const lines = text.split('\n');
  let currentName = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('location-name:')) {
      currentName = line.replace('location-name:', '').trim().toUpperCase();
    }
    if (line.startsWith('mrf-url:') && currentName.includes(key.toUpperCase())) {
      return line.replace('mrf-url:', '').trim();
    }
  }

  // Partial match
  currentName = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('location-name:')) {
      currentName = line.replace('location-name:', '').trim().toUpperCase();
    }
    if (line.startsWith('mrf-url:')) {
      const keyWords = key.toUpperCase().split(' ').filter(w => w.length > 3);
      const matches = keyWords.filter(w => currentName.includes(w));
      if (matches.length > 0) {
        const url = line.replace('mrf-url:', '').trim();
        console.log('  Partial match: ' + currentName + ' for key: ' + key);
        return url;
      }
    }
  }

  // Log available locations for debugging
  console.log('  Available locations in txt:');
  currentName = '';
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('location-name:')) {
      currentName = line.replace('location-name:', '').trim();
      console.log('    - ' + currentName);
      count++;
      if (count > 20) { console.log('    ... and more'); break; }
    }
  }

  return null;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') { inQuotes = !inQuotes; }
    else if (char === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += char; }
  }
  result.push(current);
  return result;
}

async function downloadFile(url, filename) {
  const writer = fs.createWriteStream(filename);
  const response = await axios({
    url, method: 'GET', responseType: 'stream', timeout: 120000,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const totalBytes = parseInt(response.headers['content-length'], 10);
  let downloaded = 0;
  let lastLog = 0;
  response.data.on('data', (chunk) => {
    downloaded += chunk.length;
    if (totalBytes) {
      const pct = Math.floor((downloaded / totalBytes) * 100);
      if (pct >= lastLog + 25) {
        console.log(pct + '% downloaded (' + Math.round(downloaded / 1024 / 1024) + 'MB)');
        lastLog = pct;
      }
    }
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function insertHospital(hospital) {
  const existing = await pool.query(
    'SELECT id FROM hospitals WHERE name = $1 AND city = $2 LIMIT 1',
    [hospital.name, hospital.city]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const result = await pool.query(
    `INSERT INTO hospitals (name, city, state, zip, mrf_url, is_compliant, last_scraped)
     VALUES ($1, $2, $3, $4, $5, true, NOW()) RETURNING id`,
    [hospital.name, hospital.city, hospital.state, hospital.zip, hospital.url || null]
  );
  return result.rows[0].id;
}

async function parseAndInsert(filename, hospitalId) {
  const fileStream = fs.createReadStream(filename);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let lineNum = 0;
  let headers = null;
  let insertCount = 0;
  let batch = [];
  let publishDate = null;
  const BATCH_SIZE = 500;

  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) {
      const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        publishDate = dateMatch[1];
        console.log('Publish date: ' + publishDate);
      }
      continue;
    }
    if (lineNum === 2) continue;
    if (lineNum === 3) {
      headers = parseCSVLine(line).map(h => h.trim().toLowerCase());
      continue;
    }
    if (!headers) continue;

    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = values[i] ? values[i].trim() : null);

    const procedureName = row['description'] || null;
    if (!procedureName) continue;

    batch.push({
      procedureName,
      cptCode: row['code|1'] || null,
      payerName: row['payer_name'] || null,
      planName: row['plan_name'] || null,
      grossCharge: parseFloat(row['standard_charge|gross']) || null,
      cashPrice: parseFloat(row['standard_charge|discounted_cash']) || null,
      negotiatedDollar: parseFloat(row['standard_charge|negotiated_dollar']) || null,
      publishDate,
    });

    if (batch.length >= BATCH_SIZE) {
      await insertBatch(batch, hospitalId);
      insertCount += batch.length;
      batch = [];
      if (insertCount % 50000 === 0) console.log('Inserted ' + insertCount + ' rows...');
    }
  }

  if (batch.length > 0) {
    await insertBatch(batch, hospitalId);
    insertCount += batch.length;
  }

  if (publishDate) {
    await pool.query('UPDATE hospitals SET mrf_last_updated = $1 WHERE id = $2', [publishDate, hospitalId]);
    console.log('Publish date saved: ' + publishDate);
  }

  return insertCount;
}

async function insertBatch(batch, hospitalId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of batch) {
      let procedureId;
      const existing = await client.query(
        'SELECT id FROM procedures WHERE standard_name = $1 LIMIT 1',
        [row.procedureName]
      );
      if (existing.rows.length > 0) {
        procedureId = existing.rows[0].id;
      } else {
        const ins = await client.query(
          'INSERT INTO procedures (standard_name, cpt_code) VALUES ($1, $2) RETURNING id',
          [row.procedureName, row.cptCode]
        );
        procedureId = ins.rows[0].id;
      }

      if (row.grossCharge) {
        await client.query(
          `INSERT INTO prices (hospital_id, procedure_id, price_type, price, is_cash_price, mrf_last_updated, scraped_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [hospitalId, procedureId, 'gross', row.grossCharge, false, row.publishDate]
        );
      }
      if (row.cashPrice) {
        await client.query(
          `INSERT INTO prices (hospital_id, procedure_id, price_type, price, is_cash_price, mrf_last_updated, scraped_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [hospitalId, procedureId, 'cash', row.cashPrice, true, row.publishDate]
        );
      }
      if (row.negotiatedDollar && row.payerName) {
        await client.query(
          `INSERT INTO prices (hospital_id, procedure_id, payer_name, plan_name, price_type, price, is_cash_price, mrf_last_updated, scraped_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [hospitalId, procedureId, row.payerName, row.planName, 'negotiated', row.negotiatedDollar, false, row.publishDate]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

async function scrapeHospital(hospital) {
  console.log('\n========================================');
  console.log('Scraping: ' + hospital.name);
  console.log('========================================');

  // Skip if already in DB
  const existing = await pool.query(
    'SELECT id FROM hospitals WHERE name = $1 AND city = $2 LIMIT 1',
    [hospital.name, hospital.city]
  );
  if (existing.rows.length > 0) {
    console.log('SKIPPING — already in DB (id: ' + existing.rows[0].id + ')');
    return;
  }

  let mrfUrl = hospital.url;
  if (!mrfUrl && hospital.txtUrl) {
    mrfUrl = await getMRFUrl(hospital.txtUrl, hospital.key);
    if (!mrfUrl) {
      console.log('FAILED: Could not find MRF URL for ' + hospital.name);
      return;
    }
    console.log('MRF URL found: ' + mrfUrl.substring(0, 80) + '...');
  }

  const filename = hospital.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.csv';

  try {
    console.log('Downloading...');
    await downloadFile(mrfUrl, filename);
    console.log('Download complete.');

    const hospitalId = await insertHospital({ ...hospital, url: mrfUrl });
    console.log('Hospital ID: ' + hospitalId);

    const count = await parseAndInsert(filename, hospitalId);
    console.log('Done: ' + count + ' rows inserted for ' + hospital.name);

    fs.unlinkSync(filename);
    console.log('Temp file deleted.');
  } catch (err) {
    console.log('FAILED: ' + hospital.name + ' — ' + err.message);
    if (fs.existsSync(filename)) {
      try { fs.unlinkSync(filename); } catch (e) {}
    }
  }
}

async function main() {
  console.log('Hosparent — Remaining Hospitals Scraper');
  console.log('========================================');
  console.log('Hospitals: ' + REMAINING_HOSPITALS.length);
  console.log('Skipping: All BSW, Texas Health (7 done), Medical City (JSON issue)');
  console.log('');

  for (const hospital of REMAINING_HOSPITALS) {
    await scrapeHospital(hospital);
  }

  const totalPrices = await pool.query('SELECT COUNT(*) FROM prices');
  const totalHospitals = await pool.query('SELECT COUNT(*) FROM hospitals');

  console.log('\n============================');
  console.log('SCRAPE COMPLETE');
  console.log('Total hospitals: ' + totalHospitals.rows[0].count);
  console.log('Total price records: ' + totalPrices.rows[0].count);
  console.log('============================');

  await pool.end();
}

main().catch(console.error);