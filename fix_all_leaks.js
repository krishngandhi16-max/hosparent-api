require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});

async function run() {
  console.log('\n=== FIXING inpatient/DRG-bundle price leaks across ALL CPTs & hospitals ===\n');

  // Fix 1: flag any price >20x its own Medicare rate as suspicious.
  // Catches DRG bundles mismapped to outpatient CPTs AND inflated outliers.
  // Applies to cash, gross, AND negotiated so it's consistent everywhere.
  const r1 = await pool.query(`
    UPDATE prices pr
    SET is_suspicious = true
    FROM procedures p
    WHERE pr.procedure_id = p.id
      AND p.medicare_facility_rate > 0
      AND pr.price > p.medicare_facility_rate * 20
      AND pr.is_suspicious IS NOT TRUE
  `);
  console.log(`Fix 1 (>20x Medicare, all price types): flagged ${r1.rowCount} rows`);

  // Fix 2: mark procedures whose NAME contains DRG/inpatient markers we missed
  // (the "WITHOUT CC/MCC" variant) as inpatient setting, so they route out of
  // outpatient search regardless of price.
  const r2 = await pool.query(`
    UPDATE procedures
    SET setting = 'inpatient'
    WHERE code_type = 'CPT'
      AND setting = 'outpatient'
      AND standard_name ~* '(without cc/mcc|without cc|w/o cc/mcc|cc/mcc|drg|spinal fusion except|ventilator|>96 hours)'
  `);
  console.log(`Fix 2 (DRG-name variants -> inpatient): reclassified ${r2.rowCount} procedures`);

  // Report remaining leaks after fixes
  const check = await pool.query(`
    SELECT COUNT(*) AS remaining_leaks
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    WHERE p.is_searchable IS TRUE
      AND (p.setting = 'outpatient' OR p.setting IS NULL)
      AND pr.is_suspicious IS NOT TRUE
      AND pr.price_type = 'cash'
      AND p.medicare_facility_rate > 0
      AND pr.price > p.medicare_facility_rate * 20
  `);
  console.log(`\nRemaining outpatient leaks after fix: ${check.rows[0].remaining_leaks}`);

  await pool.end();
  console.log('\n=== DONE. Restart the server to serve clean data. ===\n');
}
run().catch(e => { console.error('Error:', e.message); process.exit(1); });