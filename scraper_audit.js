require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function main() {
  console.log('Hosparent Full Search Audit');
  console.log('===========================\n');

  // Get every unique procedure with price data
  const procedures = await pool.query(`
    SELECT 
      p.standard_name,
      p.cpt_code,
      p.medicare_facility_rate,
      COUNT(DISTINCT h.id) as hospital_count,
      COUNT(DISTINCT pr.payer_name) FILTER (WHERE pr.payer_name IS NOT NULL) as payer_count,
      MIN(pr.price) FILTER (WHERE pr.price_type = 'cash' AND pr.price > 5) as min_cash,
      MAX(pr.price) FILTER (WHERE pr.price_type = 'cash' AND pr.price > 5) as max_cash,
      MIN(pr.price) FILTER (WHERE pr.price_type = 'gross' AND pr.price > 5) as min_gross
    FROM procedures p
    JOIN prices pr ON pr.procedure_id = p.id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE p.standard_name NOT ILIKE '%hchg%'
    AND pr.price > 5
    GROUP BY p.standard_name, p.cpt_code, p.medicare_facility_rate
    HAVING COUNT(DISTINCT h.id) >= 2
    ORDER BY COUNT(DISTINCT h.id) DESC, p.standard_name
  `);

  console.log(`Total searchable procedures: ${procedures.rows.length}\n`);

  const issues = [];
  const good = [];
  const noCpt = [];
  const noMedicare = [];
  const highVariation = [];

  for (const row of procedures.rows) {
    const variation = row.max_cash && row.min_cash 
      ? parseFloat(row.max_cash) / parseFloat(row.min_cash) 
      : 0;

    const entry = {
      name: row.standard_name,
      cpt: row.cpt_code,
      hospitals: parseInt(row.hospital_count),
      payers: parseInt(row.payer_count),
      minCash: parseFloat(row.min_cash || 0).toFixed(0),
      maxCash: parseFloat(row.max_cash || 0).toFixed(0),
      variation: variation.toFixed(1),
      medicare: row.medicare_facility_rate ? `$${parseFloat(row.medicare_facility_rate).toFixed(0)}` : null,
    };

    // Flag issues
    if (!row.cpt_code || !/^\d{5}$/.test(row.cpt_code)) noCpt.push(entry);
    if (!row.medicare_facility_rate) noMedicare.push(entry);
    if (variation >= 5) highVariation.push(entry);
    if (row.hospital_count >= 5 && row.min_cash > 0) good.push(entry);
  }

  // Sort high variation by variation descending
  highVariation.sort((a, b) => parseFloat(b.variation) - parseFloat(a.variation));

  // Write full report
  const report = {
    summary: {
      total_procedures: procedures.rows.length,
      good_coverage: good.length,
      missing_cpt: noCpt.length,
      missing_medicare: noMedicare.length,
      high_variation: highVariation.length,
    },
    high_variation_procedures: highVariation.slice(0, 50),
    good_coverage: good.slice(0, 100),
    missing_cpt: noCpt.slice(0, 50),
    missing_medicare: noMedicare.slice(0, 50),
  };

  fs.writeFileSync('search_audit.json', JSON.stringify(report, null, 2));

  // Console summary
  console.log('SUMMARY');
  console.log('=======');
  console.log(`Total procedures with 2+ hospitals: ${procedures.rows.length}`);
  console.log(`Good coverage (5+ hospitals, has cash price): ${good.length}`);
  console.log(`Missing standard CPT code: ${noCpt.length}`);
  console.log(`Missing Medicare benchmark: ${noMedicare.length}`);
  console.log(`High price variation (5x+): ${highVariation.length}`);

  console.log('\nTOP 20 HIGHEST PRICE VARIATION (best demo procedures):');
  console.log('=======================================================');
  highVariation.slice(0, 20).forEach(r => {
    console.log(`  ${r.variation}x | "${r.name}" | CPT:${r.cpt || 'NONE'} | $${r.minCash}-$${r.maxCash} | ${r.hospitals} hospitals | Medicare:${r.medicare || 'NONE'}`);
  });

  console.log('\nFull report saved to search_audit.json');
  await pool.end();
}

main().catch(console.error);