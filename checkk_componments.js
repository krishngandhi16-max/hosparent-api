require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});

async function run() {
  console.log('\n=== Do anesthesia CPT codes exist with prices? ===\n');
  const anes = await pool.query(`
    SELECT p.cpt_code, p.standard_name, COUNT(pr.id) AS price_rows
    FROM procedures p
    LEFT JOIN prices pr ON pr.procedure_id = p.id
    WHERE p.cpt_code IN ('00790','00840','00812','01402','01214','00142','00810','00811')
    GROUP BY p.cpt_code, p.standard_name
    ORDER BY p.cpt_code
  `);
  console.table(anes.rows);

  console.log('\n=== Any procedures with "anesthesia" in the name? ===\n');
  const byName = await pool.query(`
    SELECT p.cpt_code, p.standard_name, COUNT(pr.id) AS price_rows
    FROM procedures p
    LEFT JOIN prices pr ON pr.procedure_id = p.id
    WHERE p.standard_name ILIKE '%anesth%'
    GROUP BY p.cpt_code, p.standard_name
    ORDER BY price_rows DESC
    LIMIT 15
  `);
  console.table(byName.rows);

  console.log('\n=== Any facility / OR / recovery room line items? ===\n');
  const facility = await pool.query(`
    SELECT p.cpt_code, p.standard_name, COUNT(pr.id) AS price_rows
    FROM procedures p
    LEFT JOIN prices pr ON pr.procedure_id = p.id
    WHERE p.standard_name ILIKE '%operating room%' OR p.standard_name ILIKE '%recovery room%' OR p.standard_name ILIKE '%facility fee%'
    GROUP BY p.cpt_code, p.standard_name
    ORDER BY price_rows DESC
    LIMIT 15
  `);
  console.table(facility.rows);

  await pool.end();
}
run().catch(e => { console.error('Error:', e.message); process.exit(1); });