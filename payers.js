require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function run() {
  console.log('\n=== Gallbladder (47562) negotiated price by payer, at UT Southwestern ===\n');
  const r = await pool.query(`
    SELECT pr.payer_name,
           ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price)::numeric, 0) AS median_price,
           COUNT(*) AS rows
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE p.cpt_code = '27447'
      AND h.name ILIKE '%UT Southwestern%'
      AND pr.price_type = 'negotiated'
      AND pr.is_suspicious IS NOT TRUE
    GROUP BY pr.payer_name
    HAVING COUNT(*) > 0
    ORDER BY median_price DESC
    LIMIT 20
  `);
  console.table(r.rows);
  await pool.end();
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });