require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Every search a patient might type
const SEARCHES = [
  // Imaging
  { q: 'MRI Brain', expectedCpt: ['70551','70552','70553'], minHospitals: 3 },
  { q: 'MRI Spine', expectedCpt: ['72141','72148','72156'], minHospitals: 3 },
  { q: 'MRI Knee', expectedCpt: ['73721','73723'], minHospitals: 3 },
  { q: 'MRI Shoulder', expectedCpt: ['73221','73223'], minHospitals: 3 },
  { q: 'MRI Hip', expectedCpt: ['73721'], minHospitals: 3 },
  { q: 'CT Abdomen', expectedCpt: ['74177','74178','74176'], minHospitals: 3 },
  { q: 'CT Chest', expectedCpt: ['71250','71260','71270'], minHospitals: 3 },
  { q: 'CT Head', expectedCpt: ['70450','70460','70470'], minHospitals: 3 },
  { q: 'Mammogram', expectedCpt: ['77067','77065','77066'], minHospitals: 3 },
  { q: 'Ultrasound Abdomen', expectedCpt: ['76700','76705'], minHospitals: 3 },
  { q: 'X-Ray Chest', expectedCpt: ['71046','71045'], minHospitals: 3 },
  { q: 'X-Ray Knee', expectedCpt: ['73564','73560'], minHospitals: 3 },
  { q: 'DEXA Bone Density', expectedCpt: ['77080','77081'], minHospitals: 2 },
  
  // Surgery
  { q: 'Knee Replacement', expectedCpt: ['27447','27446'], minHospitals: 3 },
  { q: 'Hip Replacement', expectedCpt: ['27130','27132'], minHospitals: 3 },
  { q: 'Gallbladder Removal', expectedCpt: ['47562','47563'], minHospitals: 3 },
  { q: 'Appendectomy', expectedCpt: ['44950','44960'], minHospitals: 2 },
  { q: 'Hernia Repair', expectedCpt: ['49505','49650'], minHospitals: 3 },
  { q: 'Cataract Surgery', expectedCpt: ['66984','66982'], minHospitals: 2 },
  { q: 'Tonsillectomy', expectedCpt: ['42820','42821'], minHospitals: 2 },
  { q: 'C-Section', expectedCpt: ['59510','59515'], minHospitals: 2 },
  { q: 'Spinal Fusion', expectedCpt: ['22612','22630'], minHospitals: 2 },
  { q: 'Shoulder Surgery', expectedCpt: ['29827','23430'], minHospitals: 2 },
  
  // GI Procedures
  { q: 'Colonoscopy', expectedCpt: ['45378','45380','45385'], minHospitals: 3 },
  { q: 'Upper Endoscopy', expectedCpt: ['43239','43235'], minHospitals: 3 },
  { q: 'Endoscopy', expectedCpt: ['43239','43235'], minHospitals: 3 },
  
  // Cardiology
  { q: 'EKG', expectedCpt: ['93000','93010'], minHospitals: 3 },
  { q: 'Echocardiogram', expectedCpt: ['93306','93308'], minHospitals: 2 },
  { q: 'Stress Test', expectedCpt: ['93015','93016'], minHospitals: 2 },
  { q: 'Heart Catheterization', expectedCpt: ['93454','93455'], minHospitals: 2 },
  
  // Office Visits
  { q: 'Office Visit', expectedCpt: ['99213','99203','99214'], minHospitals: 3 },
  { q: 'Annual Physical', expectedCpt: ['99395','99396'], minHospitals: 2 },
  
  // Labs
  { q: 'Blood Panel', expectedCpt: ['80053','80048'], minHospitals: 2 },
  { q: 'CBC', expectedCpt: ['85025','85027'], minHospitals: 2 },
  { q: 'Lipid Panel', expectedCpt: ['80061'], minHospitals: 2 },
  { q: 'TSH Thyroid', expectedCpt: ['84443'], minHospitals: 2 },
  
  // Physical Therapy
  { q: 'Physical Therapy', expectedCpt: ['97110','97530'], minHospitals: 2 },
  
  // Delivery
  { q: 'Vaginal Delivery', expectedCpt: ['59400','59410'], minHospitals: 2 },
  { q: 'Labor and Delivery', expectedCpt: ['59400','59510'], minHospitals: 2 },
];

async function auditSearch(search) {
  const results = await pool.query(`
    SELECT 
      h.name as hospital_name,
      h.city,
      p.standard_name,
      p.cpt_code,
      p.medicare_facility_rate,
      MIN(pr.price) FILTER (WHERE pr.price_type = 'cash') as cash_price,
      COUNT(DISTINCT pr.payer_name) as payer_count
    FROM procedures p
    JOIN prices pr ON pr.procedure_id = p.id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE (p.standard_name ILIKE $1 OR p.cpt_code ILIKE $1)
    AND p.standard_name NOT ILIKE '%hchg%'
    AND pr.price > 5
    GROUP BY h.name, h.city, p.standard_name, p.cpt_code, p.medicare_facility_rate
    ORDER BY cash_price ASC NULLS LAST
    LIMIT 30
  `, [`%${search.q}%`]);

  const rows = results.rows;
  const issues = [];

  // Check minimum hospitals
  const uniqueHospitals = new Set(rows.map(r => r.hospital_name)).size;
  if (uniqueHospitals < search.minHospitals) {
    issues.push(`Only ${uniqueHospitals} hospitals (expected ${search.minHospitals}+)`);
  }

  // Check CPT codes
  const foundCpts = new Set(rows.map(r => r.cpt_code).filter(Boolean));
  const hasExpectedCpt = search.expectedCpt.some(cpt => foundCpts.has(cpt));
  if (!hasExpectedCpt && search.expectedCpt.length > 0) {
    issues.push(`No expected CPT codes found. Got: ${[...foundCpts].slice(0,3).join(', ')} | Expected: ${search.expectedCpt.join(', ')}`);
  }

  // Check Medicare rates
  const withMedicare = rows.filter(r => r.medicare_facility_rate && r.medicare_facility_rate > 0).length;
  if (withMedicare === 0 && rows.length > 0) {
    issues.push(`No Medicare benchmark on any result`);
  }

  // Check price range
  const prices = rows.map(r => parseFloat(r.cash_price)).filter(p => p > 0);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const variation = prices.length > 1 ? (maxPrice / minPrice).toFixed(1) : 'N/A';

  return {
    search: search.q,
    results: rows.length,
    hospitals: uniqueHospitals,
    cpts: [...foundCpts].slice(0, 5).join(', '),
    minPrice: minPrice || 0,
    maxPrice: maxPrice || 0,
    variation,
    withMedicare,
    issues,
    status: issues.length === 0 ? '✅ OK' : '⚠️ ISSUES',
    topResults: rows.slice(0, 3).map(r => `${r.hospital_name} $${r.cash_price}`),
  };
}

async function main() {
  console.log('Hosparent Search Audit');
  console.log('======================');
  console.log(`Testing ${SEARCHES.length} procedure searches...\n`);

  const results = [];
  for (const s of SEARCHES) {
    const result = await auditSearch(s);
    results.push(result);
    
    const statusIcon = result.status === '✅ OK' ? '✅' : '⚠️';
    console.log(`${statusIcon} "${result.search}" → ${result.hospitals} hospitals | Price range: $${result.minPrice}–$${result.maxPrice} (${result.variation}x) | CPTs: ${result.cpts}`);
    if (result.issues.length > 0) {
      result.issues.forEach(issue => console.log(`   ❌ ${issue}`));
    }
  }

  console.log('\n============================');
  console.log('AUDIT SUMMARY');
  console.log('============================');
  const ok = results.filter(r => r.issues.length === 0).length;
  const issues = results.filter(r => r.issues.length > 0);
  console.log(`✅ Passing: ${ok}/${results.length}`);
  console.log(`⚠️  Issues: ${issues.length}/${results.length}`);
  
  if (issues.length > 0) {
    console.log('\nSearches needing fixes:');
    issues.forEach(r => {
      console.log(`\n  "${r.search}":`);
      r.issues.forEach(i => console.log(`    - ${i}`));
      console.log(`    Top results: ${r.topResults.join(' | ')}`);
    });
  }

  console.log('\n============================');
  console.log('BEST PERFORMING SEARCHES (highest price variation = best demo value)');
  console.log('============================');
  const byVariation = results
    .filter(r => r.variation !== 'N/A' && r.results > 1)
    .sort((a, b) => parseFloat(b.variation) - parseFloat(a.variation))
    .slice(0, 10);
  
  byVariation.forEach(r => {
    console.log(`  "${r.search}": ${r.variation}x price range ($${r.minPrice}–$${r.maxPrice}) across ${r.hospitals} hospitals`);
  });

  await pool.end();
}

main().catch(console.error);