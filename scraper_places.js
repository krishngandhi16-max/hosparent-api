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

const GOOGLE_API_KEY = 'AIzaSyB7lAHbedmreggzbl-LO-5zwQY6rIzxgg0';

// Add new columns to imaging_centers if they don't exist
async function addColumns() {
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS full_address TEXT`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS lat NUMERIC(10,7)`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS lng NUMERIC(10,7)`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS phone TEXT`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS google_rating NUMERIC(3,1)`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS google_review_count INTEGER`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS hours JSONB`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS google_place_id TEXT`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS google_maps_url TEXT`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS website TEXT`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS real_name TEXT`);
  console.log('Columns added/verified.');
}

// Search Google Places for a center
async function searchPlace(centerName, city) {
  // Build search query — strip "Diagnostic Imaging Center - " prefix and add city + TX
  const location = city && city !== 'Southwest' && city !== 'Greenville Ave' && city !== 'DMC' 
    ? city + ' TX' 
    : 'Dallas TX';

  // Map internal names to better search terms
  const nameMap = {
    'DMC': 'Diagnostic Imaging Center Dallas Medical Center',
    'Southwest': 'Diagnostic Imaging Center Southwest Dallas',
    'Greenville Ave': 'Diagnostic Imaging Center Greenville Avenue Dallas',
    'Jerome St': 'Diagnostic Imaging Center Jerome Street Dallas',
    '15th St': 'Diagnostic Imaging Center 15th Street Fort Worth',
    'SW Fort Worth': 'Diagnostic Imaging Center Southwest Fort Worth',
    'Frisco III': 'Diagnostic Imaging Center Frisco',
    'Frisco IV': 'Diagnostic Imaging Center Frisco',
    'Dallas Meadow': 'Algur Meadows Diagnostic Imaging Center Dallas',
    'North Fort Worth': 'Diagnostic Imaging Center North Fort Worth',
    'North McKinney': 'Diagnostic Imaging Center North McKinney',
    'Irving Las Colinas': 'Diagnostic Imaging Center Irving Las Colinas',
    'North Richland Hills': 'Diagnostic Imaging Center North Richland Hills',
  };

  // Extract the location part after "Diagnostic Imaging Center - "
  const locationPart = centerName.replace('Diagnostic Imaging Center - ', '').replace('Diagnostic Imaging Center', '').trim();
  const searchQuery = nameMap[locationPart] || `Diagnostic Imaging Center ${locationPart} ${location}`;

  console.log(`  Searching: "${searchQuery}"`);

  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
      params: {
        query: searchQuery,
        type: 'health',
        key: GOOGLE_API_KEY,
      },
      timeout: 10000,
    });

    if (res.data.results && res.data.results.length > 0) {
      const place = res.data.results[0];
      return {
        place_id: place.place_id,
        name: place.name,
        address: place.formatted_address,
        lat: place.geometry?.location?.lat,
        lng: place.geometry?.location?.lng,
        rating: place.rating,
        review_count: place.user_ratings_total,
      };
    }
    return null;
  } catch (err) {
    console.log(`  Search error: ${err.message}`);
    return null;
  }
}

// Get detailed place info including phone, hours, website
async function getPlaceDetails(placeId) {
  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
      params: {
        place_id: placeId,
        fields: 'name,formatted_address,formatted_phone_number,opening_hours,website,rating,user_ratings_total,geometry,url',
        key: GOOGLE_API_KEY,
      },
      timeout: 10000,
    });

    if (res.data.result) {
      const r = res.data.result;
      return {
        name: r.name,
        address: r.formatted_address,
        phone: r.formatted_phone_number,
        hours: r.opening_hours?.weekday_text || null,
        website: r.website,
        rating: r.rating,
        review_count: r.user_ratings_total,
        lat: r.geometry?.location?.lat,
        lng: r.geometry?.location?.lng,
        maps_url: r.url,
      };
    }
    return null;
  } catch (err) {
    console.log(`  Details error: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('Hosparent — Google Places Scraper');
  console.log('===================================');
  console.log('Finding real addresses for all imaging centers...\n');

  await addColumns();

  // Get all real imaging centers (not RadiologyAssist city-level records)
  const centers = await pool.query(`
    SELECT id, name, city 
    FROM imaging_centers 
    WHERE name NOT LIKE 'RadiologyAssist%'
    ORDER BY name
  `);

  console.log(`Found ${centers.rows.length} centers to look up.\n`);

  let found = 0;
  let notFound = 0;

  for (const center of centers.rows) {
    console.log(`\n[${found + notFound + 1}/${centers.rows.length}] ${center.name}`);

    // Search for the place
    const searchResult = await searchPlace(center.name, center.city);

    if (!searchResult) {
      console.log(`  NOT FOUND on Google Places`);
      notFound++;
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    console.log(`  Found: ${searchResult.name}`);
    console.log(`  Address: ${searchResult.address}`);
    console.log(`  Rating: ${searchResult.rating} (${searchResult.review_count} reviews)`);

    // Get detailed info
    const details = await getPlaceDetails(searchResult.place_id);

    if (details) {
      await pool.query(`
        UPDATE imaging_centers SET
          real_name = $1,
          full_address = $2,
          lat = $3,
          lng = $4,
          phone = $5,
          google_rating = $6,
          google_review_count = $7,
          hours = $8,
          google_place_id = $9,
          google_maps_url = $10,
          website = $11
        WHERE id = $12
      `, [
        details.name,
        details.address,
        details.lat,
        details.lng,
        details.phone,
        details.rating,
        details.review_count,
        details.hours ? JSON.stringify(details.hours) : null,
        searchResult.place_id,
        details.maps_url,
        details.website,
        center.id
      ]);

      console.log(`  Phone: ${details.phone || 'N/A'}`);
      console.log(`  Website: ${details.website || 'N/A'}`);
      console.log(`  Hours: ${details.hours ? details.hours[0] : 'N/A'}`);
      console.log(`  ✅ Saved to DB`);
      found++;
    }

    // Polite delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 800));
  }

  // Show results
  console.log('\n============================');
  console.log('PLACES SCRAPE COMPLETE');
  console.log('============================');
  console.log(`Centers found: ${found}`);
  console.log(`Centers not found: ${notFound}`);

  // Show what we got
  const results = await pool.query(`
    SELECT real_name, full_address, google_rating, google_review_count, phone
    FROM imaging_centers
    WHERE real_name IS NOT NULL
    ORDER BY real_name
  `);

  console.log('\nResults:');
  results.rows.forEach(r => {
    console.log(`\n${r.real_name}`);
    console.log(`  ${r.full_address}`);
    console.log(`  ⭐ ${r.google_rating} (${r.google_review_count} reviews)`);
    console.log(`  📞 ${r.phone || 'N/A'}`);
  });

  await pool.end();
}

main().catch(console.error);