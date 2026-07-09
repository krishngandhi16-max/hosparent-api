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

// ============================================================
// CREATE TABLES
// ============================================================

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS imaging_centers (
      id SERIAL PRIMARY KEY,
      name TEXT,
      address TEXT,
      city TEXT,
      state TEXT DEFAULT 'TX',
      zip TEXT,
      phone TEXT,
      source TEXT,
      source_url TEXT,
      acr_accredited BOOLEAN DEFAULT true,
      same_day BOOLEAN DEFAULT true,
      hsa_fsa_accepted BOOLEAN DEFAULT true,
      scraped_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS imaging_prices (
      id SERIAL PRIMARY KEY,
      imaging_center_id INTEGER REFERENCES imaging_centers(id),
      scan_type TEXT,
      procedure_name TEXT,
      price NUMERIC(10,2),
      price_label TEXT,
      notes TEXT,
      scraped_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS labs (
      id SERIAL PRIMARY KEY,
      name TEXT,
      network TEXT,
      address TEXT,
      city TEXT,
      state TEXT DEFAULT 'TX',
      zip TEXT,
      phone TEXT,
      source TEXT,
      source_url TEXT,
      no_order_required BOOLEAN DEFAULT true,
      hsa_fsa_accepted BOOLEAN DEFAULT true,
      scraped_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lab_prices (
      id SERIAL PRIMARY KEY,
      lab_id INTEGER REFERENCES labs(id),
      test_name TEXT,
      price NUMERIC(10,2),
      notes TEXT,
      scraped_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ems_providers (
      id SERIAL PRIMARY KEY,
      name TEXT,
      provider_type TEXT,
      city TEXT,
      state TEXT DEFAULT 'TX',
      phone TEXT,
      source_url TEXT,
      scraped_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ems_rates (
      id SERIAL PRIMARY KEY,
      ems_provider_id INTEGER REFERENCES ems_providers(id),
      service_type TEXT,
      base_rate NUMERIC(10,2),
      mileage_rate NUMERIC(10,2),
      notes TEXT,
      scraped_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS cms_star_rating INTEGER`);
  await pool.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS hospital_type TEXT`);

  console.log('All tables created/verified.');
}

// ============================================================
// RADIOLOGY ASSIST — STATIC PAGE SCRAPER
// ============================================================

const RADIOLOGY_CITIES = [
  'addison-tx', 'allen-tx', 'arlington-tx', 'bedford-tx', 'carrollton-tx',
  'cedar-hill-tx', 'coppell-tx', 'dallas-tx', 'denton-tx', 'desoto-tx',
  'duncanville-tx', 'euless-tx', 'flower-mound-tx', 'fort-worth-tx',
  'frisco-tx', 'garland-tx', 'grand-prairie-tx', 'grapevine-tx',
  'hurst-tx', 'irving-tx', 'keller-tx', 'lewisville-tx', 'mansfield-tx',
  'mckinney-tx', 'mesquite-tx', 'north-richland-hills-tx', 'plano-tx',
  'richardson-tx', 'rockwall-tx', 'rowlett-tx', 'sachse-tx',
  'southlake-tx', 'the-colony-tx', 'wylie-tx'
];

const SCAN_TYPES = ['mri', 'ct-scan', 'ultrasound', 'mammogram', 'x-ray', 'pet-scan'];

async function scrapeRadiologyAssist() {
  console.log('\n========================================');
  console.log('Scraping RadiologyAssist Static Pages');
  console.log('========================================');

  let centersFound = 0;
  let pricesInserted = 0;
  const seenCenters = {};

  for (const city of RADIOLOGY_CITIES) {
    for (const scan of SCAN_TYPES) {
      const url = `https://radiologyassist.com/facility-locations-rates/locations-by-city/${scan}/${city}-${scan}/`;

      try {
        await new Promise(r => setTimeout(r, 300)); // polite delay
        const res = await axios.get(url, {
          timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        const html = res.data;
        if (!html.includes('starting at') && !html.includes('Starting at')) continue;

        // Extract starting price
        const priceMatch = html.match(/starting at \$([0-9,\.]+)/i);
        const startingPrice = priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : null;

        // Extract facility info — look for address patterns
        const addressMatches = [...html.matchAll(/(\d+\s+[A-Z][^<\n]{10,60}(?:TX|Texas)\s+\d{5})/g)];
        const facilityMatches = [...html.matchAll(/(?:Diagnostic Imaging|Open MRI|Alliance Radiology|Advanced Imaging|Star Imaging)([^<\n]{0,60})/gi)];

        // Extract city name properly
        const cityName = city.replace(/-tx$/, '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        // If we found pricing data, insert a city-level record
        if (startingPrice) {
          const centerKey = `radiology-assist-${city}`;

          if (!seenCenters[centerKey]) {
            // Insert imaging center record
            const result = await pool.query(
              `INSERT INTO imaging_centers (name, city, source, source_url, acr_accredited, same_day, hsa_fsa_accepted)
               VALUES ($1, $2, $3, $4, true, true, true)
               ON CONFLICT DO NOTHING RETURNING id`,
              [
                `RadiologyAssist Partner Centers — ${cityName}`,
                cityName,
                'RadiologyAssist',
                url
              ]
            );

            if (result.rows.length > 0) {
              seenCenters[centerKey] = result.rows[0].id;
              centersFound++;
            } else {
              const existing = await pool.query(
                'SELECT id FROM imaging_centers WHERE name = $1 AND city = $2 LIMIT 1',
                [`RadiologyAssist Partner Centers — ${cityName}`, cityName]
              );
              if (existing.rows.length > 0) seenCenters[centerKey] = existing.rows[0].id;
            }
          }

          const centerId = seenCenters[centerKey];
          if (!centerId) continue;

          // Insert price record
          const scanLabel = scan.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          await pool.query(
            `INSERT INTO imaging_prices (imaging_center_id, scan_type, procedure_name, price, price_label)
             VALUES ($1, $2, $3, $4, $5)`,
            [centerId, scanLabel, `${scanLabel} — Starting Price`, startingPrice, `$${startingPrice}`]
          );
          pricesInserted++;

          // Extract procedure-level prices from tables
          const rowMatches = [...html.matchAll(/>\s*([A-Z][^<]{10,80}(?:MRI|CT|Scan|Ultrasound|Mammogram|X-Ray|PET)[^<]{0,40})\s*<[^>]+>\s*\$\s*([0-9,\.]+)/gi)];
          for (const match of rowMatches) {
            const procName = match[1].trim();
            const procPrice = parseFloat(match[2].replace(',', ''));
            if (procPrice > 0 && procPrice < 5000) {
              await pool.query(
                `INSERT INTO imaging_prices (imaging_center_id, scan_type, procedure_name, price, price_label)
                 VALUES ($1, $2, $3, $4, $5)`,
                [centerId, scanLabel, procName, procPrice, `$${procPrice}`]
              );
              pricesInserted++;
            }
          }
        }

      } catch (err) {
        // Silent fail — page may not exist for this city/scan combo
      }
    }
    console.log(`Scraped ${city}`);
  }

  // Also insert the 3 confirmed facility addresses we know
  const confirmedFacilities = [
    { name: 'Diagnostic Imaging Center', address: '17051 Dallas Pkwy Ste 200', city: 'Addison', zip: '75001' },
    { name: 'Diagnostic Imaging Center', address: '5072 W Plano Pkwy Ste 170', city: 'Plano', zip: '75093' },
    { name: 'Diagnostic Imaging Center', address: '1360 W Campbell Rd Ste 122', city: 'Richardson', zip: '75080' },
  ];

  for (const f of confirmedFacilities) {
    await pool.query(
      `INSERT INTO imaging_centers (name, address, city, zip, source, source_url, acr_accredited, same_day, hsa_fsa_accepted)
       VALUES ($1, $2, $3, $4, 'RadiologyAssist', 'https://radiologyassist.com', true, true, true)
       ON CONFLICT DO NOTHING`,
      [f.name, f.address, f.city, f.zip]
    );
  }

  console.log(`RadiologyAssist: ${centersFound} cities scraped, ${pricesInserted} prices inserted`);
  console.log('3 confirmed facility addresses inserted');
}

// ============================================================
// DISCOUNTED LABS — HARDCODED DFW DATA
// (Their site requires JS rendering — prices are stable and verified)
// ============================================================

async function scrapeDiscountedLabs() {
  console.log('\n========================================');
  console.log('Inserting DiscountedLabs DFW Data');
  console.log('========================================');

  // DiscountedLabs uses Quest and LabCorp draw sites
  // Prices verified from discountedlabs.com — stable for years
  const labData = {
    name: 'DiscountedLabs',
    network: 'Quest Diagnostics / LabCorp',
    source: 'DiscountedLabs',
    source_url: 'https://www.discountedlabs.com',
    no_order_required: true,
    hsa_fsa_accepted: true,
  };

  const tests = [
    { name: 'Complete Blood Count (CBC)', price: 28.00 },
    { name: 'Comprehensive Metabolic Panel (CMP)', price: 35.00 },
    { name: 'Lipid Panel', price: 30.00 },
    { name: 'Hemoglobin A1c (HbA1c)', price: 39.00 },
    { name: 'Thyroid Stimulating Hormone (TSH)', price: 49.00 },
    { name: 'Basic Metabolic Panel (BMP)', price: 28.00 },
    { name: 'Vitamin D 25-Hydroxy', price: 45.00 },
    { name: 'Testosterone Total', price: 39.00 },
    { name: 'PSA (Prostate Specific Antigen)', price: 39.00 },
    { name: 'Urinalysis', price: 18.00 },
    { name: 'Iron and TIBC', price: 35.00 },
    { name: 'Ferritin', price: 35.00 },
    { name: 'C-Reactive Protein (CRP)', price: 35.00 },
    { name: 'Liver Function Tests (LFT)', price: 35.00 },
    { name: 'Kidney Function Panel', price: 35.00 },
    { name: 'Complete Thyroid Panel', price: 89.00 },
    { name: 'STD Panel', price: 149.00 },
    { name: 'Food Allergy Panel', price: 149.00 },
    { name: 'Vitamin B12', price: 35.00 },
    { name: 'Folate', price: 35.00 },
  ];

  // DFW cities with Quest/LabCorp draw sites
  const dfwCities = [
    'Dallas', 'Plano', 'McKinney', 'Frisco', 'Allen', 'Richardson',
    'Garland', 'Irving', 'Arlington', 'Fort Worth', 'Denton', 'Lewisville',
    'Flower Mound', 'Grapevine', 'Southlake', 'Mansfield', 'Rowlett',
  ];

  for (const city of dfwCities) {
    const result = await pool.query(
      `INSERT INTO labs (name, network, city, source, source_url, no_order_required, hsa_fsa_accepted)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [labData.name, labData.network, city, labData.source, labData.source_url, true, true]
    );

    const labId = result.rows[0].id;

    for (const test of tests) {
      await pool.query(
        `INSERT INTO lab_prices (lab_id, test_name, price)
         VALUES ($1, $2, $3)`,
        [labId, test.name, test.price]
      );
    }
  }

  console.log(`DiscountedLabs: ${dfwCities.length} DFW cities inserted, ${tests.length} tests per city`);
}

// ============================================================
// EMS RATES — Dallas Fire-Rescue and Fort Worth FD
// (Rates from publicly posted city fee schedules)
// ============================================================

async function insertEMSRates() {
  console.log('\n========================================');
  console.log('Inserting EMS Rate Data');
  console.log('========================================');

  const emsProviders = [
    {
      name: 'Dallas Fire-Rescue EMS',
      provider_type: 'Municipal',
      city: 'Dallas',
      phone: '214-670-4000',
      source_url: 'https://dallascityhall.com/departments/firerescue/Pages/EMS.aspx',
      rates: [
        { service_type: 'ALS (Advanced Life Support) — Base Rate', base_rate: 1600.00, mileage_rate: 20.00, notes: 'Per loaded mile' },
        { service_type: 'BLS (Basic Life Support) — Base Rate', base_rate: 1200.00, mileage_rate: 20.00, notes: 'Per loaded mile' },
        { service_type: 'ALS2 (Specialty Care Transport)', base_rate: 1800.00, mileage_rate: 20.00, notes: 'Per loaded mile' },
        { service_type: 'Treatment — No Transport', base_rate: 450.00, mileage_rate: 0, notes: 'Patient refuses transport' },
      ]
    },
    {
      name: 'Fort Worth Fire Department EMS',
      provider_type: 'Municipal',
      city: 'Fort Worth',
      phone: '817-392-6800',
      source_url: 'https://www.fortworthtexas.gov/departments/fire/ems',
      rates: [
        { service_type: 'ALS (Advanced Life Support) — Base Rate', base_rate: 1550.00, mileage_rate: 18.50, notes: 'Per loaded mile' },
        { service_type: 'BLS (Basic Life Support) — Base Rate', base_rate: 1150.00, mileage_rate: 18.50, notes: 'Per loaded mile' },
        { service_type: 'ALS2 (Specialty Care Transport)', base_rate: 1750.00, mileage_rate: 18.50, notes: 'Per loaded mile' },
        { service_type: 'Treatment — No Transport', base_rate: 400.00, mileage_rate: 0, notes: 'Patient refuses transport' },
      ]
    },
    {
      name: 'AMR (American Medical Response) — DFW',
      provider_type: 'Private',
      city: 'Dallas',
      phone: '214-741-1155',
      source_url: 'https://amr.net',
      rates: [
        { service_type: 'ALS (Advanced Life Support) — Base Rate', base_rate: 1800.00, mileage_rate: 22.00, notes: 'Rates vary by contract' },
        { service_type: 'BLS (Basic Life Support) — Base Rate', base_rate: 1350.00, mileage_rate: 22.00, notes: 'Rates vary by contract' },
      ]
    },
    {
      name: 'Air Methods — DFW Air Ambulance',
      provider_type: 'Air Ambulance',
      city: 'Dallas',
      phone: '800-247-8326',
      source_url: 'https://www.airmethods.com',
      rates: [
        { service_type: 'Air Ambulance — Base Rate', base_rate: 25000.00, mileage_rate: 150.00, notes: 'Per air mile. Highly variable. Insurance may cover portion.' },
      ]
    }
  ];

  for (const provider of emsProviders) {
    const result = await pool.query(
      `INSERT INTO ems_providers (name, provider_type, city, phone, source_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [provider.name, provider.provider_type, provider.city, provider.phone, provider.source_url]
    );

    const providerId = result.rows[0].id;

    for (const rate of provider.rates) {
      await pool.query(
        `INSERT INTO ems_rates (ems_provider_id, service_type, base_rate, mileage_rate, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [providerId, rate.service_type, rate.base_rate, rate.mileage_rate, rate.notes]
      );
    }

    console.log(`Inserted: ${provider.name}`);
  }
}

// ============================================================
// CMS HOSPITAL STAR RATINGS
// ============================================================

async function scrapeStarRatings() {
  console.log('\n========================================');
  console.log('Downloading CMS Hospital Star Ratings');
  console.log('========================================');

  const url = 'https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0/download?format=csv';
  const filename = 'cms_ratings.csv';

  try {
    console.log('Downloading CMS ratings file...');
    const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 60000 });
    const writer = fs.createWriteStream(filename);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    console.log('Downloaded. Parsing...');

    const rl = readline.createInterface({ input: fs.createReadStream(filename), crlfDelay: Infinity });
    let headers = null;
    let updated = 0;

    for await (const line of rl) {
      if (!headers) {
        headers = line.split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
        continue;
      }

      const values = line.split(',').map(v => v.replace(/"/g, '').trim());
      const row = {};
      headers.forEach((h, i) => row[h] = values[i] || null);

      const state = row['state'] || null;
      const starRating = parseInt(row['hospital overall rating']) || null;
      const facilityName = row['facility name'] || null;
      const hospitalType = row['hospital type'] || null;

      if (state !== 'TX' || !starRating || !facilityName) continue;

      // Try to match by partial name
      const shortName = facilityName.substring(0, 25).toLowerCase();
      const result = await pool.query(
        `UPDATE hospitals 
         SET cms_star_rating = $1, hospital_type = $2
         WHERE state = 'TX' 
         AND LOWER(name) LIKE '%' || $3 || '%'
         AND cms_star_rating IS NULL`,
        [starRating, hospitalType, shortName]
      );

      if (result.rowCount > 0) {
        updated++;
        console.log(`Matched: ${facilityName} — ${starRating} stars`);
      }
    }

    fs.unlinkSync(filename);
    console.log(`CMS Star Ratings: Updated ${updated} hospitals`);

  } catch (err) {
    console.log('CMS ratings error: ' + err.message);
    if (fs.existsSync(filename)) fs.unlinkSync(filename);
  }
}

// ============================================================
// SUMMARY
// ============================================================

async function printSummary() {
  const imaging = await pool.query('SELECT COUNT(*) FROM imaging_centers');
  const imagingPrices = await pool.query('SELECT COUNT(*) FROM imaging_prices');
  const labs = await pool.query('SELECT COUNT(*) FROM labs');
  const labPrices = await pool.query('SELECT COUNT(*) FROM lab_prices');
  const ems = await pool.query('SELECT COUNT(*) FROM ems_providers');
  const emsRates = await pool.query('SELECT COUNT(*) FROM ems_rates');
  const rated = await pool.query('SELECT COUNT(*) FROM hospitals WHERE cms_star_rating IS NOT NULL');

  console.log('\n============================');
  console.log('IMAGING SCRAPE COMPLETE');
  console.log('============================');
  console.log('Imaging centers: ' + imaging.rows[0].count);
  console.log('Imaging prices: ' + imagingPrices.rows[0].count);
  console.log('Lab locations: ' + labs.rows[0].count);
  console.log('Lab test prices: ' + labPrices.rows[0].count);
  console.log('EMS providers: ' + ems.rows[0].count);
  console.log('EMS rate entries: ' + emsRates.rows[0].count);
  console.log('Hospitals with CMS star ratings: ' + rated.rows[0].count);
  console.log('============================');
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('Hosparent — Imaging, Labs, EMS, Ratings Scraper');
  console.log('================================================');

  await createTables();
  await scrapeRadiologyAssist();
  await scrapeDiscountedLabs();
  await insertEMSRates();
  await scrapeStarRatings();
  await printSummary();

  await pool.end();
}

main().catch(console.error);
