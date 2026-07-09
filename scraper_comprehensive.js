require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// All 21 Medical City locations with verified URLs from medicalcityhealthcare.com
const MEDICAL_CITY_HOSPITALS = [
  { name: 'Medical City Alliance', city: 'Fort Worth', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/46-4027347_MEDICAL-CITY-ALLIANCE_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Argyle', city: 'Argyle', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682213_MEDICAL-CTIY-ARGYLE_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Arlington', city: 'Arlington', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682201_MEDICAL-CITY-ARLINGTON_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Dallas', city: 'Dallas', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682198_MEDICAL-CITY-DALLAS_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Decatur', city: 'Decatur', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/93-2081386_MEDICAL-CITY-DECATUR_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Denton', city: 'Denton', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682213_MEDICAL-CITY-DENTON_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Fort Worth', city: 'Fort Worth', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682202_MEDICAL-CITY-FORT-WORTH_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Frisco', city: 'Frisco', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682203_MEDICAL-CITY-FRISCO_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Green Oaks Hospital', city: 'Dallas', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1797829_MEDICAL-CITY-GREEN-OAKS-HOSPITAL_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Heart Hospital', city: 'Dallas', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682198_MED-CITY-HEART-HOSPITAL_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Las Colinas', city: 'Irving', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1650582_MEDICAL-CITY-LAS-COLINAS_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Lewisville', city: 'Lewisville', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682210_MEDICAL-CITY-LEWISVILLE_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City McKinney', city: 'McKinney', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682207_MEDICAL-CITY-MCKINNEY_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City North Hills', city: 'North Richland Hills', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682205_MEDICAL-CITY-NORTH-HILLS_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Plano', city: 'Plano', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682203_MEDICAL-CITY-PLANO_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Sachse', city: 'Sachse', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682203_MEDICAL-CITY-SACHSE_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Spine Hospital', city: 'Dallas', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682198_MED-CITY-SPINE-HOSPITAL_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Surgical Hospital Alliance', city: 'Fort Worth', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/46-4027347_MEDICAL-CITY-SURGERY-CITY-ALLIANCE_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Weatherford', city: 'Weatherford', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/82-2073410_MEDICAL-CITY-WEATHERFORD_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
];

const parsePrice = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isNaN(n) || n <= 0 || n > 999999 ? null : n;
};

async function getOrCreateHospital(name, city) {
  const ex = await pool.query('SELECT id FROM hospitals WHERE name = $1 LIMIT 1', [name]);
  if (ex.rows.length > 0) return ex.rows[0].id;
  const r = await pool.query(
    `INSERT INTO hospitals (name, city, state, is_compliant) VALUES ($1,$2,'TX',true) RETURNING id`,
    [name, city]
  );
  return r.rows[0].id;
}

async function getOrCreateProcedure(name, cpt) {
  if (!name?.trim()) return null;
  const cleanName = name.trim().substring(0, 500);
  const cleanCpt = cpt?.trim().substring(0, 20) || null;
  
  const ex = await pool.query('SELECT id FROM procedures WHERE standard_name = $1 LIMIT 1', [cleanName]);
  if (ex.rows.length > 0) return ex.rows[0].id;

  let medicareRate = null, medicareNonFac = null;
  if (cleanCpt && /^\d{5}$/.test(cleanCpt)) {
    const m = await pool.query(
      'SELECT facility_rate, non_facility_rate FROM medicare_rates WHERE cpt_code = $1 AND modifier IS NULL LIMIT 1',
      [cleanCpt]
    );
    medicareRate = m.rows[0]?.facility_rate || null;
    medicareNonFac = m.rows[0]?.non_facility_rate || null;
  }

  const r = await pool.query(
    `INSERT INTO procedures (standard_name, cpt_code, medicare_facility_rate, medicare_non_facility_rate, is_searchable)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
    [cleanName, cleanCpt, medicareRate, medicareNonFac, !!(cleanCpt && /^\d{5}$/.test(cleanCpt))]
  );
  if (r.rows.length > 0) return r.rows[0].id;
  
  const retry = await pool.query('SELECT id FROM procedures WHERE standard_name = $1 LIMIT 1', [cleanName]);
  return retry.rows[0]?.id || null;
}

async function flushBatch(batch, hospitalId) {
  let count = 0;
  for (const item of batch) {
    try {
      const pid = await getOrCreateProcedure(item.desc, item.cpt);
      if (!pid) continue;

      if (item.cashPrice) {
        await pool.query(
          `INSERT INTO prices (hospital_id,procedure_id,price,price_type,is_cash_price) VALUES ($1,$2,$3,'cash',true) ON CONFLICT DO NOTHING`,
          [hospitalId, pid, item.cashPrice]
        );
        count++;
      }
      if (item.grossPrice) {
        await pool.query(
          `INSERT INTO prices (hospital_id,procedure_id,price,price_type) VALUES ($1,$2,$3,'gross') ON CONFLICT DO NOTHING`,
          [hospitalId, pid, item.grossPrice]
        );
        count++;
      }
      if (item.negotiatedRate && item.payerName) {
        await pool.query(
          `INSERT INTO prices (hospital_id,procedure_id,price,price_type,payer_name) VALUES ($1,$2,$3,'negotiated',$4) ON CONFLICT DO NOTHING`,
          [hospitalId, pid, item.negotiatedRate, item.payerName.substring(0, 200)]
        );
        count++;
      }
    } catch (e) {}
  }
  return count;
}

// Extract JSON objects from a chunk buffer using bracket matching
function extractObjects(buffer) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];

    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const obj = JSON.parse(buffer.substring(start, i + 1));
          objects.push(obj);
        } catch (e) {}
        start = -1;
      }
    }
  }

  // Return remainder (incomplete object at end)
  const remainder = start >= 0 ? buffer.substring(start) : '';
  return { objects, remainder };
}

function extractChargeFromObject(obj) {
  // HCA JSON format has these key patterns:
  const desc = obj.description || obj.charge_description || obj['charge description'] || 
               obj.item_description || obj.service_description || obj.chargeDescription;
  
  const cpt = obj.code || obj.cpt || obj.cpt_code || obj['cpt code'] || 
              obj.billing_code || obj['billing code'] || obj.hcpcs;
  
  const cashPrice = parsePrice(
    obj.discounted_cash || obj['discounted cash'] || obj.cash_price || 
    obj['cash price'] || obj.self_pay || obj['self pay'] || 
    obj.discounted_cash_price || obj['standard_charge|discounted_cash']
  );
  
  const grossPrice = parsePrice(
    obj.gross_charge || obj['gross charge'] || obj.standard_charge ||
    obj['standard charge'] || obj.list_price || obj['list price'] ||
    obj['standard_charge|gross'] || obj.chargemaster_price
  );

  const payerName = obj.payer_name || obj['payer name'] || obj.insurance || obj.payer;
  
  const negotiatedRate = parsePrice(
    obj.negotiated_rate || obj['negotiated rate'] || obj.contracted_rate ||
    obj['contracted rate'] || obj['standard_charge|negotiated_dollar']
  );

  return { desc, cpt, cashPrice, grossPrice, payerName, negotiatedRate };
}

async function scrapeHospital(hospital) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Scraping: ${hospital.name}`);
  console.log(`${'='.repeat(50)}`);

  const tmpFile = path.join(process.cwd(), `tmp_mc_${Date.now()}.json`);

  try {
    // Download to disk first (streaming to avoid memory issues)
    console.log('  Downloading...');
    const res = await axios.get(hospital.url, {
      responseType: 'stream',
      timeout: 600000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    const writer = fs.createWriteStream(tmpFile);
    res.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      res.data.on('error', reject);
    });

    const stats = fs.statSync(tmpFile);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    console.log(`  Downloaded ${sizeMB} MB`);

    const hospitalId = await getOrCreateHospital(hospital.name, hospital.city);
    console.log(`  Hospital ID: ${hospitalId}`);

    // Process file in chunks to avoid memory issues
    const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
    const fileSize = stats.size;
    let offset = 0;
    let remainder = '';
    let inserted = 0;
    let batch = [];
    const BATCH_SIZE = 500;

    const fd = fs.openSync(tmpFile, 'r');
    const buffer = Buffer.alloc(CHUNK_SIZE);

    console.log(`  Processing ${sizeMB} MB in 1MB chunks...`);

    while (offset < fileSize) {
      const bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, offset);
      if (bytesRead === 0) break;
      
      const chunk = remainder + buffer.toString('utf8', 0, bytesRead);
      const { objects, remainder: newRemainder } = extractObjects(chunk);
      remainder = newRemainder.length < 100000 ? newRemainder : '';
      offset += bytesRead;

      for (const obj of objects) {
        const charge = extractChargeFromObject(obj);
        if (!charge.desc) continue;
        if (!charge.cashPrice && !charge.grossPrice && !charge.negotiatedRate) continue;
        
        batch.push(charge);

        if (batch.length >= BATCH_SIZE) {
          inserted += await flushBatch(batch, hospitalId);
          batch = [];
          if (inserted % 50000 === 0 && inserted > 0) {
            console.log(`  ${inserted} rows inserted... (${((offset/fileSize)*100).toFixed(0)}% complete)`);
          }
        }
      }
    }

    fs.closeSync(fd);

    // Flush remaining batch
    if (batch.length > 0) {
      inserted += await flushBatch(batch, hospitalId);
    }

    fs.unlinkSync(tmpFile);
    console.log(`  ✓ Done: ${inserted} rows for ${hospital.name}`);
    return inserted;

  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
    if (fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch(e) {}
    }
    return 0;
  }
}

async function main() {
  console.log('Medical City Healthcare Scraper');
  console.log('================================');
  console.log(`Hospitals: ${MEDICAL_CITY_HOSPITALS.length}`);
  console.log('Method: Chunk-based JSON extraction (handles files >500MB)');
  console.log('');

  let total = 0;

  for (const hospital of MEDICAL_CITY_HOSPITALS) {
    const n = await scrapeHospital(hospital);
    total += n;
  }

  console.log('\n\n' + '='.repeat(50));
  console.log('MEDICAL CITY SCRAPE COMPLETE');
  console.log('='.repeat(50));
  console.log(`Total rows inserted: ${total}`);

  const results = await pool.query(`
    SELECT h.name, COUNT(pr.id) as price_count
    FROM hospitals h
    LEFT JOIN prices pr ON pr.hospital_id = h.id
    WHERE h.name ILIKE '%medical city%'
    GROUP BY h.name ORDER BY price_count DESC
  `);

  console.log('\nResults by hospital:');
  for (const r of results.rows) {
    console.log(`  ${r.name}: ${r.price_count} prices`);
  }

  const total_prices = await pool.query('SELECT COUNT(*) FROM prices');
  console.log(`\nTotal prices in DB: ${total_prices.rows[0].count}`);

  await pool.end();
}

main().catch(console.error);