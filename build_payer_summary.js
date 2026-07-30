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
  console.log('\n=== BUILDING PAYER SUMMARY ACROSS ENTIRE DB (60-120s) ===\n');
  const t0 = Date.now();

  await pool.query('DROP TABLE IF EXISTS payer_price_summary');
  await pool.query(`
    CREATE TABLE payer_price_summary AS
    SELECT
      p.cpt_code,
      p.standard_name,
      pr.hospital_id,
      h.name AS hospital_name,
      pr.payer_name,
      COUNT(*) AS price_rows,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price)::numeric, 0) AS median_price,
      ROUND(MIN(pr.price)::numeric, 0) AS min_price,
      ROUND(MAX(pr.price)::numeric, 0) AS max_price,
      MAX(COALESCE(p.medicare_facility_rate, p.medicare_non_facility_rate)) AS medicare_rate
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE p.is_searchable IS TRUE
      AND (p.setting = 'outpatient' OR p.setting IS NULL)
      AND pr.price_type = 'negotiated'
      AND pr.is_suspicious IS NOT TRUE
      AND pr.price > 0
      AND pr.payer_name IS NOT NULL
    GROUP BY p.cpt_code, p.standard_name, pr.hospital_id, h.name, pr.payer_name
  `);
  await pool.query('CREATE INDEX idx_pps_cpt ON payer_price_summary(cpt_code)');
  await pool.query('CREATE INDEX idx_pps_payer ON payer_price_summary(payer_name)');
  await pool.query('CREATE INDEX idx_pps_hosp ON payer_price_summary(hospital_id)');

  const stats = await pool.query(`
    SELECT COUNT(*) AS summary_rows,
           COUNT(DISTINCT cpt_code) AS cpts,
           COUNT(DISTINCT payer_name) AS payers,
           COUNT(DISTINCT hospital_id) AS hospitals
    FROM payer_price_summary
  `);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  console.table(stats.rows);

  console.log('\n=== SANITY CHECK: how much prices vary by payer, across all procedures ===\n');
  const spread = await pool.query(`
    SELECT cpt_code, standard_name,
           COUNT(DISTINCT payer_name) AS payers,
           ROUND(MIN(median_price)::numeric, 0) AS cheapest_payer_price,
           ROUND(MAX(median_price)::numeric, 0) AS priciest_payer_price,
           ROUND((MAX(median_price) / NULLIF(MIN(median_price), 0))::numeric, 1) AS spread_multiple
    FROM payer_price_summary
    WHERE median_price > 100
    GROUP BY cpt_code, standard_name
    HAVING COUNT(DISTINCT payer_name) >= 5
    ORDER BY spread_multiple DESC
    LIMIT 20
  `);
  console.table(spread.rows);

  await pool.end();
  console.log('\n=== DONE. Table "payer_price_summary" now holds every CPT x hospital x payer. ===\n');
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });