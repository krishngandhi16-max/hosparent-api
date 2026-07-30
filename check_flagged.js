require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
async function run() {
  console.log('\n=== Sample of what got flagged as suspicious (are these really bad?) ===\n');
  const r = await pool.query(`
    SELECT p.cpt_code, LEFT(p.standard_name,50) AS name, pr.price,
           p.medicare_facility_rate AS medicare,
           ROUND((pr.price/NULLIF(p.medicare_facility_rate,0))::numeric,0) AS ratio
    FROM prices pr JOIN procedures p ON p.id=pr.procedure_id
    WHERE pr.is_suspicious IS TRUE AND pr.price_type='cash'
      AND p.medicare_facility_rate > 0 AND p.is_searchable IS TRUE
    ORDER BY random() LIMIT 30
  `);
  console.table(r.rows);
  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });