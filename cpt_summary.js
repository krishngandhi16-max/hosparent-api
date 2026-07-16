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
  console.log('\n=== HOSPARENT ANALYZER ===\n');

  console.log('STEP 1: Building summary (60-90s)...');
  const t0 = Date.now();
  await pool.query('DROP TABLE IF EXISTS cpt_price_summary');
  await pool.query(`CREATE TABLE cpt_price_summary AS
    SELECT p.cpt_code, p.standard_name, pr.hospital_id, h.name AS hospital_name, pr.price_type,
      COUNT(*) AS price_rows, COUNT(DISTINCT pr.payer_name) AS payers,
      ROUND(MIN(pr.price)::numeric,2) AS min_price,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price)::numeric,2) AS median_price,
      ROUND(MAX(pr.price)::numeric,2) AS max_price,
      MAX(COALESCE(p.medicare_facility_rate,p.medicare_non_facility_rate)) AS medicare_rate,
      ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price)/NULLIF(MAX(COALESCE(p.medicare_facility_rate,p.medicare_non_facility_rate)),0))::numeric,1) AS ratio_to_medicare
    FROM prices pr
    JOIN procedures p ON p.id=pr.procedure_id
    JOIN hospitals h ON h.id=pr.hospital_id
    WHERE p.is_searchable IS TRUE AND (p.setting='outpatient' OR p.setting IS NULL)
      AND pr.is_suspicious IS NOT TRUE AND pr.price>0
    GROUP BY p.cpt_code, p.standard_name, pr.hospital_id, h.name, pr.price_type`);
  await pool.query('CREATE INDEX idx_summary_cpt ON cpt_price_summary(cpt_code)');
  const s = await pool.query('SELECT COUNT(*) AS rows, COUNT(DISTINCT cpt_code) AS cpts FROM cpt_price_summary');
  console.log(`  Done in ${((Date.now()-t0)/1000).toFixed(1)}s. Rows: ${s.rows[0].rows}, CPTs: ${s.rows[0].cpts}\n`);

  console.log('STEP 2: Bundling + all-in modeling...');
  await pool.query(`ALTER TABLE cpt_price_summary ADD COLUMN IF NOT EXISTS bundling_signal TEXT`);
  await pool.query(`ALTER TABLE cpt_price_summary ADD COLUMN IF NOT EXISTS estimated_all_in NUMERIC`);
  await pool.query(`ALTER TABLE cpt_price_summary ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT FALSE`);
  await pool.query(`UPDATE cpt_price_summary SET bundling_signal = CASE
    WHEN medicare_rate IS NULL THEN 'no_benchmark'
    WHEN ratio_to_medicare < 4 THEN 'lean'
    WHEN ratio_to_medicare >= 6 THEN 'inclusive' ELSE 'mixed' END`);
  await pool.query(`UPDATE cpt_price_summary SET estimated_all_in=ROUND(LEAST(median_price/0.15, median_price+medicare_rate*9)::numeric,2), is_estimated=TRUE WHERE bundling_signal='lean'`);
  await pool.query(`UPDATE cpt_price_summary SET estimated_all_in=median_price, is_estimated=FALSE WHERE bundling_signal IN ('inclusive','mixed')`);
  console.log('  Done.\n');

  console.log('REPORT 1 - Bundling breakdown (cash):');
  console.table((await pool.query(`SELECT bundling_signal, COUNT(*) AS n, ROUND(AVG(ratio_to_medicare),1) AS avg_ratio FROM cpt_price_summary WHERE price_type='cash' GROUP BY bundling_signal ORDER BY 2 DESC`)).rows);

  console.log('\nREPORT 2 - Possible bad data (extreme ratios):');
  console.table((await pool.query(`SELECT cpt_code, hospital_name, median_price, ratio_to_medicare FROM cpt_price_summary WHERE price_type='cash' AND (ratio_to_medicare>30 OR ratio_to_medicare<0.3) ORDER BY ratio_to_medicare DESC LIMIT 15`)).rows);

  console.log('\nREPORT 3 - Gallbladder (47562) bundling:');
  console.table((await pool.query(`SELECT hospital_name, median_price, ratio_to_medicare, bundling_signal, estimated_all_in, is_estimated FROM cpt_price_summary WHERE cpt_code='47562' AND price_type='negotiated' ORDER BY median_price`)).rows);

  await pool.end();
  console.log('\n=== DONE ===\n');
}
run().catch(e => { console.error('Error:', e.message); process.exit(1); });