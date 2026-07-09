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
  { city: 'addison', label: 'Addison' },
  { city: 'allen', label: 'Allen' },
  { city: 'arlington', label: 'Arlington' },
  { city: 'bedford', label: 'Bedford' },
  { city: 'carrollton', label: 'Carrollton' },
  { city: 'cedar-hill', label: 'Cedar Hill' },
  { city: 'coppell', label: 'Coppell' },
  { city: 'dallas', label: 'Dallas' },
  { city: 'denton', label: 'Denton' },
  { city: 'desoto', label: 'DeSoto' },
  { city: 'duncanville', label: 'Duncanville' },
  { city: 'euless', label: 'Euless' },
  { city: 'flower-mound', label: 'Flower Mound' },
  { city: 'fort-worth', label: 'Fort Worth' },
  { city: 'frisco', label: 'Frisco' },
  { city: 'garland', label: 'Garland' },
  { city: 'grand-prairie', label: 'Grand Prairie' },
  { city: 'grapevine', label: 'Grapevine' },
  { city: 'hurst', label: 'Hurst' },
  { city: 'irving', label: 'Irving' },
  { city: 'keller', label: 'Keller' },
  { city: 'lewisville', label: 'Lewisville' },
  { city: 'mansfield', label: 'Mansfield' },
  { city: 'mckinney', label: 'McKinney' },
  { city: 'mesquite', label: 'Mesquite' },
  { city: 'north-richland-hills', label: 'North Richland Hills' },
  { city: 'plano', label: 'Plano' },
  { city: 'richardson', label: 'Richardson' },
  { city: 'rockwall', label: 'Rockwall' },
  { city: 'rowlett', label: 'Rowlett' },
  { city: 'sachse', label: 'Sachse' },
  { city: 'southlake', label: 'Southlake' },
  { city: 'the-colony', label: 'The Colony' },
  { city: 'wylie', label: 'Wylie' },
];

const SCAN_TYPES = [
  { slug: 'mri', label: 'MRI', altSlug: null },
  { slug: 'ct-scan', label: 'CT Scan', altSlug: 'cat-scan' },
  { slug: 'ultrasound', label: 'Ultrasound', altSlug: null },
  { slug: 'mammogram', label: 'Mammogram', altSlug: null },
  { slug: 'x-ray', label: 'X-Ray', altSlug: 'xray' },
  { slug: 'pet-scan', label: 'PET Scan', altSlug: null },
  { slug: 'dexa-scan', label: 'DEXA Scan', altSlug: 'dexa' },
];

const seenCenters = {};
let totalCenters = 0;
let totalPrices = 0;

async function fetchPage(url) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });
    return res.data;
  } catch (e) {
    return null;
  }
}

function extractData(html, cityLabel, scanLabel) {
  if (!html) return null;

  const results = {
    city: cityLabel,
    scan: scanLabel,
    startingPrice: null,
    procedures: [],
    facilities: [],
  };

  // Extract starting price
  const startMatch = html.match(/(?:starting\s+(?:at|from)|start\s+at)\s*\$\s*([0-9,\.]+)/i);
  if (startMatch) {
    results.startingPrice = parseFloat(startMatch[1].replace(',', ''));
  }

  // Also check meta description and title for price
  const metaMatch = html.match(/for\s+\$([0-9,\.]+)/i);
  if (!results.startingPrice && metaMatch) {
    results.startingPrice = parseFloat(metaMatch[1].replace(',', ''));
  }

  // Extract procedure-level prices from table rows
  // Pattern: procedure name followed by price in table
  const tableRowPattern = /<tr[^>]*>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>\s*\$\s*([0-9,\.]+)\s*<\/td>/gi;
  let match;
  while ((match = tableRowPattern.exec(html)) !== null) {
    const procName = match[1].replace(/<[^>]+>/g, '').trim();
    const price = parseFloat(match[2].replace(',', ''));
    if (procName.length > 2 && procName.length < 100 && price > 0 && price < 10000) {
      results.procedures.push({ name: procName, price });
    }
  }

  // Extract facility names and addresses
  // Look for common imaging center name patterns
  const facilityPatterns = [
    /(?:Diagnostic Imaging Center|Open MRI|Alliance Radiology|Advanced Imaging|Star Imaging|Southwest Diagnostic|North Texas Imaging|Medical Imaging)[^<\n]{0,60}/gi,
  ];

  for (const pattern of facilityPatterns) {
    let fMatch;
    while ((fMatch = pattern.exec(html)) !== null) {
      const name = fMatch[0].replace(/<[^>]+>/g, '').trim();
      if (name.length > 5 && !results.facilities.includes(name)) {
        results.facilities.push(name);
      }
    }
  }

  // Extract addresses (number + street pattern in TX)
  const addrPattern = /(\d+\s+[A-Z][^<\n,]{5,50},?\s+(?:Ste|Suite|#)\s*[^<\n,]{1,20},?\s+[A-Z][a-z]+,?\s+TX\s+\d{5})/gi;
  const addresses = [];
  let addrMatch;
  while ((addrMatch = addrPattern.exec(html)) !== null) {
    const addr = addrMatch[1].trim();
    if (!addresses.includes(addr)) addresses.push(addr);
  }
  results.addresses = addresses;

  // Extract all dollar amounts with context
  const priceContextPattern = /([A-Za-z][^$\n]{5,60})\s*\$\s*([0-9,\.]+)/gi;
  while ((match = priceContextPattern.exec(html)) !== null) {
    const context = match[1].replace(/<[^>]+>/g, '').trim();
    const price = parseFloat(match[2].replace(',', ''));
    if (price > 20 && price < 10000 && context.length > 3) {
      // Add as procedure if not already captured
      const exists = results.procedures.some(p => Math.abs(p.price - price) < 1);
      if (!exists) {
        results.procedures.push({ name: context.substring(0, 80), price });
      }
    }
  }

  return results;
}

async function getOrCreateCenter(name, city) {
  const key = `${name}|${city}`;
  if (seenCenters[key]) return seenCenters[key];

  const existing = await pool.query(
    'SELECT id FROM imaging_centers WHERE name = $1 AND city = $2 LIMIT 1',
    [name, city]
  );
  if (existing.rows.length > 0) {
    seenCenters[key] = existing.rows[0].id;
    return existing.rows[0].id;
  }

  const result = await pool.query(
    `INSERT INTO imaging_centers (name, city, state, source, source_url, acr_accredited, same_day, hsa_fsa_accepted)
     VALUES ($1, $2, 'TX', 'RadiologyAssist', 'https://radiologyassist.com', true, true, true)
     RETURNING id`,
    [name, city]
  );
  seenCenters[key] = result.rows[0].id;
  totalCenters++;
  return result.rows[0].id;
}

async function insertPrice(centerId, scanType, procedureName, price) {
  const existing = await pool.query(
    'SELECT id FROM imaging_prices WHERE imaging_center_id = $1 AND procedure_name = $2 LIMIT 1',
    [centerId, procedureName]
  );
  if (existing.rows.length > 0) return;

  await pool.query(
    `INSERT INTO imaging_prices (imaging_center_id, scan_type, procedure_name, price, price_label)
     VALUES ($1, $2, $3, $4, $5)`,
    [centerId, scanType, procedureName, price, '$' + price]
  );
  totalPrices++;
}

async function scrapeCity(citySlug, cityLabel, scan) {
  // Try multiple URL patterns
  const urls = [
    `https://radiologyassist.com/facility-locations-rates/locations-by-city/${scan.slug}/${citySlug}-tx-${scan.slug}/`,
    `https://radiologyassist.com/facility-locations-rates/locations-by-city/${scan.slug}/${scan.slug}-in-${citySlug}-tx/`,
  ];

  if (scan.altSlug) {
    urls.push(`https://radiologyassist.com/facility-locations-rates/locations-by-city/${scan.altSlug}/${citySlug}-tx-${scan.altSlug}/`);
  }

  for (const url of urls) {
    await new Promise(r => setTimeout(r, 400));
    const html = await fetchPage(url);
    if (!html || html.length < 1000) continue;

    // Check if this page has actual pricing content
    if (!html.includes('starting') && !html.includes('$265') && !html.includes('$130') && !html.match(/\$[0-9]{2,4}/)) continue;

    const data = extractData(html, cityLabel, scan.label);
    if (!data) continue;

    // Create a city-level center record for RadiologyAssist
    const centerName = `RadiologyAssist — ${cityLabel}`;
    const centerId = await getOrCreateCenter(centerName, cityLabel);

    // Update the center URL
    await pool.query(
      'UPDATE imaging_centers SET source_url = $1 WHERE id = $2',
      [url, centerId]
    );

    // Insert starting price
    if (data.startingPrice) {
      await insertPrice(centerId, scan.label, `${scan.label} — Starting Price`, data.startingPrice);
    }

    // Insert procedure-level prices
    for (const proc of data.procedures) {
      if (proc.price > 20 && proc.price < 10000) {
        await insertPrice(centerId, scan.label, proc.name.substring(0, 200), proc.price);
      }
    }

    // Update addresses if found
    if (data.addresses && data.addresses.length > 0) {
      await pool.query(
        'UPDATE imaging_centers SET address = $1 WHERE id = $2 AND (address IS NULL OR address = \'\')',
        [data.addresses[0], centerId]
      );
    }

    return { url, pricesFound: data.procedures.length + (data.startingPrice ? 1 : 0) };
  }

  return null;
}

async function main() {
  console.log('Hosparent — RadiologyAssist Static Page Scraper');
  console.log('================================================');
  console.log(`Cities: ${DFW_CITIES.length} | Scan types: ${SCAN_TYPES.length}`);
  console.log(`Total pages to check: ${DFW_CITIES.length * SCAN_TYPES.length}`);
  console.log('');

  let pagesFound = 0;
  let pagesMissed = 0;

  for (const cityObj of DFW_CITIES) {
    let cityResults = 0;

    for (const scan of SCAN_TYPES) {
      const result = await scrapeCity(cityObj.city, cityObj.label, scan);

      if (result) {
        cityResults += result.pricesFound;
        pagesFound++;
      } else {
        pagesMissed++;
      }
    }

    console.log(`${cityObj.label}: ${cityResults} prices found`);
  }

  // Also add the 3 known confirmed facility addresses
  const confirmedFacilities = [
    { name: 'Diagnostic Imaging Center', address: '17051 Dallas Pkwy Ste 200', city: 'Addison', zip: '75001' },
    { name: 'Diagnostic Imaging Center', address: '5072 W Plano Pkwy Ste 170', city: 'Plano', zip: '75093' },
    { name: 'Diagnostic Imaging Center', address: '1360 W Campbell Rd Ste 122', city: 'Richardson', zip: '75080' },
  ];

  for (const f of confirmedFacilities) {
    await pool.query(
      `INSERT INTO imaging_centers (name, address, city, state, zip, source, source_url, acr_accredited, same_day, hsa_fsa_accepted)
       VALUES ($1, $2, $3, 'TX', $4, 'RadiologyAssist', 'https://radiologyassist.com', true, true, true)
       ON CONFLICT DO NOTHING`,
      [f.name, f.address, f.city, f.zip]
    );
  }

  // Final summary
  const centerCount = await pool.query("SELECT COUNT(*) FROM imaging_centers WHERE source = 'RadiologyAssist'");
  const priceCount = await pool.query('SELECT COUNT(*) FROM imaging_prices');

  console.log('\n============================');
  console.log('STATIC SCRAPE COMPLETE');
  console.log('============================');
  console.log('Pages with data: ' + pagesFound);
  console.log('Pages with no data: ' + pagesMissed);
  console.log('RadiologyAssist centers in DB: ' + centerCount.rows[0].count);
  console.log('Total imaging prices in DB: ' + priceCount.rows[0].count);
  console.log('New centers created: ' + totalCenters);
  console.log('New prices inserted: ' + totalPrices);
  console.log('============================');

  await pool.end();
}

main().catch(console.error);