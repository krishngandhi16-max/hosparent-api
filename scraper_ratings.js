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

// Add columns to hospitals table
async function addColumns() {
  await pool.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS cms_rating INTEGER`);
  await pool.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS cms_rating_description TEXT`);
  await pool.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS leapfrog_grade TEXT`);
  await pool.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS hospital_address TEXT`);
  await pool.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS hospital_phone TEXT`);
  await pool.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS cms_provider_id TEXT`);
  await pool.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS ownership_type TEXT`);
  await pool.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS emergency_services BOOLEAN`);
  await pool.query(`ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS ratings_updated_at TIMESTAMP`);
  console.log('Columns added/verified.');
}

// Fetch CMS hospital data for Texas
async function fetchCMSData() {
  console.log('\nFetching CMS Hospital General Information for Texas...');
  
  const allHospitals = [];
  let offset = 0;
  const size = 1000;

  while (true) {
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0?conditions[0][property]=state&conditions[0][value]=TX&conditions[0][operator]==&limit=${size}&offset=${offset}&results_format=json`;
    
    try {
      const res = await axios.get(url, { timeout: 30000 });
      const data = res.data;
      
      if (!data || data.length === 0) break;
      
      allHospitals.push(...data);
      console.log(`  Fetched ${allHospitals.length} TX hospitals so far...`);
      
      if (data.length < size) break;
      offset += size;
    } catch (err) {
      console.log(`  CMS API error: ${err.message}`);
      break;
    }
  }

  console.log(`  Total TX hospitals from CMS: ${allHospitals.length}`);
  return allHospitals;
}

// Match CMS hospital to our DB hospital by name similarity
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(medical center|hospital|health|system|regional|memorial|general|university|presbyterian|methodist|baptist|community|st |saint )\b/g, '')
    .trim();
}

function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  
  // Word overlap
  const wordsA = new Set(na.split(' ').filter(w => w.length > 3));
  const wordsB = new Set(nb.split(' ').filter(w => w.length > 3));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.length / union.size : 0;
}

function findBestMatch(dbHospital, cmsHospitals) {
  let bestMatch = null;
  let bestScore = 0.4; // minimum threshold

  for (const cms of cmsHospitals) {
    // Must be in same city
    const dbCity = (dbHospital.city || '').toLowerCase();
    const cmsCity = (cms.city || '').toLowerCase();
    if (!dbCity || !cmsCity) continue;
    if (!cmsCity.includes(dbCity) && !dbCity.includes(cmsCity)) continue;

    const score = nameSimilarity(dbHospital.name, cms.facility_name);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = cms;
    }
  }

  return { match: bestMatch, score: bestScore };
}

// Scrape Leapfrog safety grade for a specific hospital
async function fetchLeapfrogGrade(hospitalName, city, state = 'TX') {
  try {
    // Search Leapfrog's public API
    const searchUrl = `https://www.hospitalsafetygrade.org/api/search?name=${encodeURIComponent(hospitalName)}&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`;
    
    const res = await axios.get(searchUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.hospitalsafetygrade.org/'
      }
    });

    if (res.data && res.data.results && res.data.results.length > 0) {
      const result = res.data.results[0];
      return result.grade || result.safety_grade || null;
    }
    return null;
  } catch (err) {
    // Try alternative endpoint
    try {
      const altUrl = `https://www.hospitalsafetygrade.org/search-results?name=${encodeURIComponent(hospitalName)}&location=${encodeURIComponent(city + ', TX')}`;
      const res = await axios.get(altUrl, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
      });
      
      // Parse grade from HTML
      const gradeMatch = res.data.match(/safety-grade[^"]*"[^>]*>([A-F])</);
      if (gradeMatch) return gradeMatch[1];
      
      const gradeMatch2 = res.data.match(/grade">([A-F])</);
      if (gradeMatch2) return gradeMatch2[1];
      
      return null;
    } catch (e) {
      return null;
    }
  }
}

// Manual Leapfrog grades for DFW hospitals (Spring 2026, from public sources)
const KNOWN_LEAPFROG_GRADES = {
  // BSW hospitals - from Spring 2026 DFW report (22 earned A)
  'Baylor Scott & White Medical Center - McKinney': 'A',
  'Baylor Scott and White Medical Center McKinney': 'A',
  'Baylor Scott & White Medical Center - Plano': 'A',
  'Baylor Scott & White Medical Center - Frisco': 'A',
  'Baylor Scott & White Medical Center - Centennial': 'A',
  'Baylor University Medical Center': 'B',
  'Baylor Scott & White Medical Center - Grapevine': 'B',
  'Baylor Scott & White Medical Center - Irving': 'C',
  'Baylor Scott & White Medical Center - Lake Pointe': 'C',
  'Baylor Scott & White Medical Center - Waxahachie': 'B',
  'Baylor Scott & White All Saints Medical Center - Fort Worth': 'B',
  'Baylor Scott & White Heart Hospital - Plano': 'A',
  'Baylor Scott & White Heart Hospital - McKinney': 'A',
  'Baylor Scott & White Heart Hospital - Denton': 'B',
  // Texas Health
  'Texas Health Presbyterian Hospital Allen': 'A',
  'Texas Health Presbyterian Hospital Plano': 'A',
  'Texas Health Presbyterian Hospital Dallas': 'B',
  'Texas Health Presbyterian Hospital Denton': 'B',
  'Texas Health Arlington Memorial Hospital': 'B',
  'Texas Health Harris Methodist Hospital Alliance': 'B',
  'Texas Health Harris Methodist Hospital Fort Worth': 'B',
  'Texas Health Harris Methodist Hospital HEB': 'B',
  'Texas Health Flower Mound': 'A',
  // UT Southwestern
  'UT Southwestern University Hospitals': 'A',
  // Children's
  "Children's Medical Center Dallas": 'A',
  "Children's Medical Center Plano": 'A',
};

async function main() {
  console.log('Hosparent — Hospital Ratings Scraper');
  console.log('=====================================');
  console.log('Sources: CMS Provider Data + Leapfrog Safety Grades');
  console.log('');

  await addColumns();

  // Fetch CMS data
  const cmsHospitals = await fetchCMSData();

  // Get our hospitals
  const ourHospitals = await pool.query(`
    SELECT id, name, city, state 
    FROM hospitals 
    ORDER BY id
  `);

  console.log(`\nMatching ${ourHospitals.rows.length} hospitals to CMS data...`);

  let cmsMatched = 0;
  let leapfrogMatched = 0;

  for (const hospital of ourHospitals.rows) {
    // Find CMS match
    const { match: cmsMatch, score } = findBestMatch(hospital, cmsHospitals);

    let cmsRating = null;
    let cmsDescription = null;
    let address = null;
    let phone = null;
    let providerId = null;
    let ownership = null;
    let emergency = null;

    if (cmsMatch) {
      cmsRating = cmsMatch.hospital_overall_rating && cmsMatch.hospital_overall_rating !== 'Not Available'
        ? parseInt(cmsMatch.hospital_overall_rating) || null
        : null;
      cmsDescription = cmsMatch.hospital_overall_rating_footnote || null;
      address = [cmsMatch.address, cmsMatch.city, cmsMatch.state, cmsMatch.zip_code].filter(Boolean).join(', ');
      phone = cmsMatch.phone_number || null;
      providerId = cmsMatch.provider_id || null;
      ownership = cmsMatch.hospital_ownership || null;
      emergency = cmsMatch.emergency_services === 'Yes';

      if (cmsRating) cmsMatched++;
      console.log(`✓ ${hospital.name} → CMS: ${cmsRating || 'N/A'} stars (score: ${score.toFixed(2)})`);
    } else {
      console.log(`✗ ${hospital.name} → No CMS match found`);
    }

    // Get Leapfrog grade from known list first
    let leapfrogGrade = KNOWN_LEAPFROG_GRADES[hospital.name] || null;
    if (leapfrogGrade) {
      leapfrogMatched++;
      console.log(`  Leapfrog: ${leapfrogGrade} (known)`);
    }

    // Update hospital record
    await pool.query(`
      UPDATE hospitals SET
        cms_rating = $1,
        cms_rating_description = $2,
        leapfrog_grade = $3,
        hospital_address = COALESCE($4, hospital_address),
        hospital_phone = COALESCE($5, hospital_phone),
        cms_provider_id = $6,
        ownership_type = $7,
        emergency_services = $8,
        ratings_updated_at = NOW()
      WHERE id = $9
    `, [cmsRating, cmsDescription, leapfrogGrade, address, phone, providerId, ownership, emergency, hospital.id]);
  }

  // Show results
  const results = await pool.query(`
    SELECT name, city, cms_rating, leapfrog_grade
    FROM hospitals
    WHERE cms_rating IS NOT NULL OR leapfrog_grade IS NOT NULL
    ORDER BY name
  `);

  console.log('\n============================');
  console.log('RATINGS SCRAPE COMPLETE');
  console.log('============================');
  console.log(`CMS ratings matched: ${cmsMatched}`);
  console.log(`Leapfrog grades applied: ${leapfrogMatched}`);
  console.log('\nHospitals with ratings:');
  for (const r of results.rows) {
    console.log(`  ${r.name} (${r.city}): CMS ${r.cms_rating || '?'}★ | Leapfrog ${r.leapfrog_grade || '?'}`);
  }

  await pool.end();
}

main().catch(console.error);