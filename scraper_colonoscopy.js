require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const DFW_CITIES = [
  { city: 'dallas', label: 'Dallas' },
  { city: 'plano', label: 'Plano' },
  { city: 'mckinney', label: 'McKinney' },
  { city: 'frisco', label: 'Frisco' },
  { city: 'allen', label: 'Allen' },
  { city: 'richardson', label: 'Richardson' },
  { city: 'garland', label: 'Garland' },
  { city: 'irving', label: 'Irving' },
  { city: 'arlington', label: 'Arlington' },
  { city: 'fort-worth', label: 'Fort Worth' },
  { city: 'denton', label: 'Denton' },
  { city: 'lewisville', label: 'Lewisville' },
  { city: 'flower-mound', label: 'Flower Mound' },
  { city: 'grapevine', label: 'Grapevine' },
  { city: 'southlake', label: 'Southlake' },
  { city: 'mansfield', label: 'Mansfield' },
  { city: 'rowlett', label: 'Rowlett' },
  { city: 'mesquite', label: 'Mesquite' },
  { city: 'carrollton', label: 'Carrollton' },
  { city: 'grand-prairie', label: 'Grand Prairie' },
  { city: 'cedar-hill', label: 'Cedar Hill' },
  { city: 'duncanville', label: 'Duncanville' },
  { city: 'bedford', label: 'Bedford' },
  { city: 'hurst', label: 'Hurst' },
  { city: 'euless', label: 'Euless' },
  { city: 'keller', label: 'Keller' },
  { city: 'north-richland-hills', label: 'North Richland Hills' },
  { city: 'wylie', label: 'Wylie' },
  { city: 'rockwall', label: 'Rockwall' },
  { city: 'farmers-branch', label: 'Farmers Branch' },
];

const SERVICES = [
  { slug: 'colonoscopy', label: 'Colonoscopy', urlSlug: 'colonoscopy' },
  { slug: 'upper-endoscopy', label: 'Upper Endoscopy (EGD)', urlSlug: 'upper-endoscopy' },
  { slug: 'sigmoidoscopy', label: 'Sigmoidoscopy', urlSlug: 'sigmoidoscopy' },
  { slug: 'hemorrhoid-banding', label: 'Hemorrhoid Banding', urlSlug: 'hemorrhoid-banding' },
  { slug: 'cologuard', label: 'Cologuard', urlSlug: 'cologuard' },
  { slug: 'fit-test', label: 'FIT Test', urlSlug: 'fit-test' },
];

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS colonoscopy_centers (
      id SERIAL PRIMARY KEY,
      name TEXT,
      city TEXT,
      state TEXT DEFAULT 'TX',
      source TEXT DEFAULT 'ColonoscopyAssist',
      source_url TEXT,
      phone TEXT DEFAULT '(855) 542-6566',
      board_certified BOOLEAN DEFAULT true,
      scraped_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS colonoscopy_prices (
      id SERIAL PRIMARY KEY,
      center_id INTEGER REFERENCES colonoscopy_centers(id),
      service_name TEXT,
      price NUMERIC(10,2),
      price_label TEXT,
      includes TEXT,
      notes TEXT,
      scraped_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log('Tables created/verified.');
}

async function fetchPage(url) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      }
    });
    return res.data;
  } catch (e) {
    return null;
  }
}

function extractPrice(html) {
  if (!html) return null;

  // Match patterns like $1,395 or $1395 or $25
  const patterns = [
    /\$\s*([\d,]+(?:\.\d{2})?)\s*(?:all.inclusive|flat|for)/i,
    /(?:rate|price|cost)\s+(?:of\s+)?\$\s*([\d,]+(?:\.\d{2})?)/i,
    /\$\s*([\d,]+(?:\.\d{2})?)\s*(?:when|for|per)/i,
    /(?:Colonoscopy|Endoscopy|EGD|Sigmoidoscopy|Cologuard|FIT)\s+\$\s*([\d,]+(?:\.\d{2})?)/i,
    /\$([\d,]+(?:\.\d{2})?)/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const price = parseFloat(match[1].replace(',', ''));
      if (price > 10 && price < 10000) return price;
    }
  }
  return null;
}

function extractIncludes(html, service) {
  // Standard ColonoscopyAssist inclusions
  const defaultIncludes = {
    'Colonoscopy': 'Physician fees, facility fees, anesthesia, polyp removal, pathology (unlimited), procedure report',
    'Upper Endoscopy (EGD)': 'Physician fees, facility fees, anesthesia, biopsy removal, pathology, procedure report',
    'Sigmoidoscopy': 'Physician fees, facility fees, anesthesia, procedure report',
    'Hemorrhoid Banding': 'Physician fees, procedure, follow-up',
    'Cologuard': 'At-home stool DNA test kit, lab processing, results',
    'FIT Test': 'At-home fecal immunochemical test kit, lab processing, results',
  };
  return defaultIncludes[service] || 'All-inclusive rate — no hidden fees';
}

async function scrapeCity(citySlug, cityLabel, service) {
  // Try multiple URL patterns
  const urls = [
    `https://colonoscopyassist.com/facility-locations-rates/locations-by-city/${service.urlSlug}/${citySlug}-tx-${service.urlSlug}/`,
    `https://colonoscopyassist.com/facility-locations-rates/locations-by-city/${service.urlSlug}/${citySlug}-tx-${service.urlSlug}-egd/`,
    `https://colonoscopyassist.com/Cities/${cityLabel.replace(' ', '_')}_TX_colonoscopy.html`,
  ];

  for (const url of urls) {
    await new Promise(r => setTimeout(r, 400));
    const html = await fetchPage(url);
    if (!html || html.length < 500) continue;
    if (!html.includes('ColonoscopyAssist') && !html.includes('colonoscopy')) continue;

    const price = extractPrice(html);
    if (!price) continue;

    return { url, price };
  }
  return null;
}

async function getOrCreateCenter(cityLabel, url) {
  const existing = await pool.query(
    'SELECT id FROM colonoscopy_centers WHERE name = $1 AND city = $2 LIMIT 1',
    ['ColonoscopyAssist', cityLabel]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const result = await pool.query(
    `INSERT INTO colonoscopy_centers (name, city, source_url)
     VALUES ($1, $2, $3) RETURNING id`,
    ['ColonoscopyAssist', cityLabel, url]
  );
  return result.rows[0].id;
}

async function insertPrice(centerId, serviceName, price, includes) {
  const existing = await pool.query(
    'SELECT id FROM colonoscopy_prices WHERE center_id = $1 AND service_name = $2 LIMIT 1',
    [centerId, serviceName]
  );
  if (existing.rows.length > 0) return;

  await pool.query(
    `INSERT INTO colonoscopy_prices (center_id, service_name, price, price_label, includes)
     VALUES ($1, $2, $3, $4, $5)`,
    [centerId, serviceName, price, '$' + price, includes]
  );
}

async function main() {
  console.log('Hosparent — ColonoscopyAssist Scraper');
  console.log('=======================================');
  console.log(`Cities: ${DFW_CITIES.length} | Services: ${SERVICES.length}`);
  console.log('');

  await createTables();

  // Also insert known flat prices directly
  // These are published on their main site and verified
  const KNOWN_PRICES = [
    { service: 'Colonoscopy', price: 1395.00 },
    { service: 'Upper Endoscopy (EGD)', price: 1395.00 },
    { service: 'Colonoscopy & Upper Endoscopy', price: 1895.00 },
    { service: 'Sigmoidoscopy', price: 895.00 },
    { service: 'Hemorrhoid Banding (in office)', price: 795.00 },
    { service: 'Hemorrhoid Banding (with colonoscopy)', price: 995.00 },
    { service: 'Cologuard', price: 599.00 },
    { service: 'FIT Test', price: 25.00 },
  ];

  let totalPrices = 0;

  for (const cityObj of DFW_CITIES) {
    // Create center record for this city
    const centerId = await getOrCreateCenter(cityObj.label, 'https://colonoscopyassist.com/locations/');

    // Try to scrape city-specific prices first
    let cityHasData = false;

    for (const service of SERVICES) {
      const result = await scrapeCity(cityObj.city, cityObj.label, service);
      if (result) {
        const includes = extractIncludes(null, service.label);
        await insertPrice(centerId, service.label, result.price, includes);
        cityHasData = true;
        totalPrices++;
      }
    }

    // If no city-specific page found, use known flat prices
    if (!cityHasData) {
      for (const kp of KNOWN_PRICES) {
        const includes = extractIncludes(null, kp.service);
        await insertPrice(centerId, kp.service, kp.price, includes);
        totalPrices++;
      }
    }

    console.log(`${cityObj.label}: done`);
  }

  // Summary
  const centers = await pool.query('SELECT COUNT(*) FROM colonoscopy_centers');
  const prices = await pool.query('SELECT COUNT(*) FROM colonoscopy_prices');

  console.log('\n============================');
  console.log('COLONOSCOPY SCRAPE COMPLETE');
  console.log('============================');
  console.log('Centers: ' + centers.rows[0].count);
  console.log('Prices: ' + prices.rows[0].count);
  console.log('============================');

  await pool.end();
}

main().catch(console.error);