require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});

async function run() {
  console.log('\n=== Scanning for inpatient-priced rows leaking into outpatient results ===');
  console.log('(searchable, outpatient-tagged, not suspicious, cash price > 20x Medicare)\n');

  const r = await pool.query(`
    SELECT p.cpt_code, p.standard_name, h.name AS hospital,
           pr.price AS cash_price,
           p.medicare_facility_rate AS medicare,
           ROUND((pr.price / NULLIF(p.medicare_facility_rate,0))::numeric, 0) AS ratio
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE p.is_searchable IS TRUE
      AND (p.setting = 'outpatient' OR p.setting IS NULL)
      AND pr.is_suspicious IS NOT TRUE
      AND pr.price_type = 'cash'
      AND p.medicare_facility_rate > 0
      AND pr.price > p.medicare_facility_rate * 20
    ORDER BY ratio DESC
    LIMIT 40
  `);
  console.table(r.rows);

  const count = await pool.query(`
    SELECT COUNT(*) AS total_leaking_rows,
           COUNT(DISTINCT p.cpt_code) AS distinct_cpts,
           COUNT(DISTINCT pr.hospital_id) AS distinct_hospitals
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    WHERE p.is_searchable IS TRUE
      AND (p.setting = 'outpatient' OR p.setting IS NULL)
      AND pr.is_suspicious IS NOT TRUE
      AND pr.price_type = 'cash'
      AND p.medicare_facility_rate > 0
      AND pr.price > p.medicare_facility_rate * 20
  `);
  console.log('\n=== TOTAL SCOPE ===');
  console.table(count.rows);

  await pool.end();
}
run().catch(e => { console.error('Error:', e.message); process.exit(1); });