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

const HOSPITALS = [
  { name: 'Medical City Alliance', city: 'Fort Worth', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/46-4027347_MEDICAL-CITY-ALLIANCE_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Arlington', city: 'Arlington', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682201_MEDICAL-CITY-ARLINGTON_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Dallas', city: 'Dallas', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682198_MEDICAL-CITY-DALLAS_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Denton', city: 'Denton', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682213_MEDICAL-CITY-DENTON_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Fort Worth', city: 'Fort Worth', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682202_MEDICAL-CITY-FORT-WORTH_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Frisco', city: 'Frisco', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682203_MEDICAL-CITY-FRISCO_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Green Oaks Hospital', city: 'Dallas', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1797829_MEDICAL-CITY-GREEN-OAKS-HOSPITAL_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Las Colinas', city: 'Irving', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1650582_MEDICAL-CITY-LAS-COLINAS_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Lewisville', city: 'Lewisville', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682210_MEDICAL-CITY-LEWISVILLE_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City McKinney', city: 'McKinney', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682207_MEDICAL-CITY-MCKINNEY_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City North Hills', city: 'North Richland Hills', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682205_MEDICAL-CITY-NORTH-HILLS_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
  { name: 'Medical City Plano', city: 'Plano', url: 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1682203_MEDICAL-CITY-PLANO_standardcharges.json?si=pt-json-access-policy&spr=https&sv=2024-11-04&sr=c&sig=o5IofreS%2F7ETlsnhPakPWCwHVVUZRobywQ5wUKGjVuQ%3D' },
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

async function flushBatch(batch, hospitalId) {
  let count = 0;
  for (const item of batch) {
    try {
      const pid = await getOrCreateProcedure(item.desc, item.cpt);
      if (!pid) continue;
      if (item.cash) { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type,is_cash_price) VALUES ($1,$2,$3,'cash',true) ON CONFLICT DO NOTHING`, [hospitalId, pid, item.cash]); count++; }
      if (item.gross) { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type) VALUES ($1,$2,$3,'gross') ON CONFLICT DO NOTHING`, [hospitalId, pid, item.gross]); count++; }
      if (item.rate && item.payer) { await pool.query(`INSERT INTO prices (hospital_id,procedure_id,price,price_type,payer_name) VALUES ($1,$2,$3,'negotiated',$4) ON CONFLICT DO NOTHING`, [hospitalId, pid, item.rate, item.payer.substring(0, 200)]); count++; }
    } catch(e) {}
  }
  return count;
}

async function scrapeHospital(hospital) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Scraping: ${hospital.name}`);
  const tmpFile = path.join(process.cwd(), 'tmp_mc.json');

  try {
    console.log('  Downloading...');
    const res = await axios.get(hospital.url, { responseType: 'stream', timeout: 600000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const writer = fs.createWriteStream(tmpFile);
    res.data.pipe(writer);
    await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

    const sizeMB = (fs.statSync(tmpFile).size / 1024 / 1024).toFixed(1);
    console.log(`  Downloaded ${sizeMB} MB`);

    const hospitalId = await getOrCreateHospital(hospital.name, hospital.city);
    console.log(`  Hospital ID: ${hospitalId}`);

    // Use Node.js stream with JSON parsing — avoids loading entire file into memory
    let inserted = 0;
    let batch = [];
    const BATCH = 100;

    // Read file in small chunks, find standard_charge_information array items
    const fileSize = fs.statSync(tmpFile).size;
    const CHUNK = 128 * 1024; // 128KB chunks
    const fd = fs.openSync(tmpFile, 'r');
    const buf = Buffer.alloc(CHUNK);
    let offset = 0;
    let carry = ''; // small carry buffer
    let inArray = false;
    let depth = 0;
    let itemStart = -1;
    let inStr = false;
    let esc = false;

    while (offset < fileSize) {
      const bytesRead = fs.readSync(fd, buf, 0, CHUNK, offset);
      if (!bytesRead) break;
      offset += bytesRead;

      const chunk = carry + buf.toString('utf8', 0, bytesRead);
      carry = '';

      if (!inArray) {
        const idx = chunk.indexOf('"standard_charge_information"');
        if (idx >= 0) {
          const arrIdx = chunk.indexOf('[', idx);
          if (arrIdx >= 0) {
            inArray = true;
            // Reset parse state
            depth = 0; itemStart = -1; inStr = false; esc = false;
            // Process rest of chunk from array start
            let rest = chunk.substring(arrIdx + 1);
            carry = rest.length > 2 * 1024 * 1024 ? rest.substring(rest.length - 500 * 1024) : rest;
          }
        } else {
          // Keep last 200 chars as overlap
          carry = chunk.length > 200 ? chunk.substring(chunk.length - 200) : chunk;
        }
        continue;
      }

      // Parse objects from chunk
      let i = 0;
      const extracted = [];

      while (i < chunk.length) {
        const ch = chunk[i];
        if (esc) { esc = false; i++; continue; }
        if (ch === '\\' && inStr) { esc = true; i++; continue; }
        if (ch === '"') { inStr = !inStr; i++; continue; }
        if (inStr) { i++; continue; }

        if (ch === '{') {
          if (depth === 0) itemStart = i;
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && itemStart >= 0) {
            const objStr = chunk.substring(itemStart, i + 1);
            // Only parse if reasonably sized
            if (objStr.length < 500 * 1024) {
              try {
                extracted.push(JSON.parse(objStr));
              } catch(e) {}
            }
            itemStart = -1;
          }
        } else if (ch === ']' && depth === 0) {
          break;
        }
        i++;
      }

      // Keep incomplete item as carry
      if (itemStart >= 0) {
        const remaining = chunk.substring(itemStart);
        carry = remaining.length < 2 * 1024 * 1024 ? remaining : '';
        itemStart = -1;
      } else if (i < chunk.length) {
        const remaining = chunk.substring(Math.max(0, i - 50));
        carry = remaining.length < 100 * 1024 ? remaining : '';
      }

      // Process extracted objects
      for (const obj of extracted) {
        const desc = obj.description;
        if (!desc) continue;

        let cpt = null;
        if (Array.isArray(obj.code_information)) {
          const entry = obj.code_information.find(c => c.type === 'CPT' || c.type === 'HCPCS');
          cpt = entry?.code || null;
        }

        if (!Array.isArray(obj.standard_charges)) continue;

        for (const charge of obj.standard_charges) {
          const cash = parsePrice(charge.discounted_cash);
          const gross = parsePrice(charge.minimum) || parsePrice(charge.maximum);

          if (cash || gross) batch.push({ desc, cpt, cash, gross, payer: null, rate: null });

          if (Array.isArray(charge.payers_information)) {
            for (const p of charge.payers_information) {
              const rate = parsePrice(p.standard_charge_dollar);
              if (rate && p.payer_name) batch.push({ desc, cpt, cash: null, gross: null, payer: p.payer_name, rate });
            }
          }
        }

        if (batch.length >= BATCH) {
          inserted += await flushBatch(batch, hospitalId);
          batch = [];
          if (inserted % 10000 === 0 && inserted > 0) {
            console.log(`  ${inserted} rows (${((offset/fileSize)*100).toFixed(0)}%)...`);
          }
        }
      }
    }

    fs.closeSync(fd);
    if (batch.length > 0) inserted += await flushBatch(batch, hospitalId);
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    console.log(`  ✓ Done: ${inserted} rows`);
    return inserted;

  } catch(err) {
    console.log(`  ✗ Error: ${err.message}`);
    if (fs.existsSync(tmpFile)) try { fs.unlinkSync(tmpFile); } catch(e) {}
    return 0;
  }
}

async function main() {
  console.log('Medical City HCA Scraper v3');
  console.log('============================');
  let total = 0;

  for (const h of HOSPITALS) {
    total += await scrapeHospital(h);
  }

  console.log(`\nTOTAL: ${total} rows`);
  const r = await pool.query(`SELECT h.name, COUNT(pr.id) as prices FROM hospitals h LEFT JOIN prices pr ON pr.hospital_id=h.id WHERE h.name ILIKE '%medical city%' GROUP BY h.name ORDER BY prices DESC`);
  for (const row of r.rows) console.log(`  ${row.name}: ${row.prices}`);
  const t = await pool.query('SELECT COUNT(*) FROM prices');
  console.log(`Total DB: ${t.rows[0].count}`);
  await pool.end();
}

main().catch(console.error);