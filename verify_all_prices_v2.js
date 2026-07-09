require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

function boundsFor(row, priceType) {
  if (priceType === 'negotiated' && row.min_negotiated != null) {
    return { min: parseFloat(row.min_negotiated), max: parseFloat(row.max_negotiated ?? row.max_cash) };
  }
  if (priceType === 'gross' && row.min_gross != null) {
    return { min: parseFloat(row.min_gross), max: parseFloat(row.max_gross ?? row.max_cash) };
  }
  return { min: parseFloat(row.min_cash), max: parseFloat(row.max_cash) };
}

async function main() {
  console.log('===================================================');
  console.log('  HOSPARENT PRICE VERIFICATION v2 - per-price-type bounds');
  console.log('===================================================');
  console.log('');

  const boundsResult = await pool.query(`
    SELECT cpt_code, procedure_label, min_cash, max_cash,
           min_negotiated, max_negotiated, min_gross, max_gross
    FROM cpt_price_bounds ORDER BY cpt_code
  `);
  const bounds = boundsResult.rows;
  console.log(`Loaded ${bounds.length} CPT bounds.`);
  console.log('');

  let totalFail = 0;
  let totalPass = 0;
  const failures = [];

  for (const b of bounds) {
    const priceTypes = ['cash', 'gross', 'negotiated'];
    let cptHasFailure = false;

    for (const priceType of priceTypes) {
      const { min, max } = boundsFor(b, priceType);

      const r = await pool.query(`
        SELECT
          MIN(pr.price) as min_price,
          MAX(pr.price) as max_price,
          COUNT(*) FILTER (
            WHERE pr.is_suspicious IS NOT TRUE
            AND (pr.price < $3 OR pr.price > $4)
          ) as unflagged_bad_rows
        FROM prices pr
        JOIN procedures p ON p.id = pr.procedure_id
        WHERE p.cpt_code = $1 AND pr.price_type = $2
      `, [b.cpt_code, priceType, min, max]);

      const row = r.rows[0];
      const badCount = parseInt(row.unflagged_bad_rows);
      if (badCount > 0) {
        cptHasFailure = true;
        failures.push({
          cpt: b.cpt_code,
          label: b.procedure_label,
          price_type: priceType,
          bounds: `$${min}-$${max}`,
          actual_range: `$${row.min_price}-$${row.max_price}`,
          bad_row_count: badCount,
        });
      }
    }

    if (cptHasFailure) totalFail++; else totalPass++;
  }

  console.log('--- RESULTS ---');
  console.log('');
  console.log(`PASS: ${totalPass} / ${bounds.length}`);
  console.log(`FAIL: ${totalFail} / ${bounds.length}`);
  console.log('');

  if (failures.length > 0) {
    console.log('FAILING CPTs (unflagged out-of-bounds prices found):');
    console.log('');
    for (const f of failures) {
      console.log(`  CPT ${f.cpt} (${f.label}) - price_type=${f.price_type}`);
      console.log(`    bounds: ${f.bounds}  |  actual: ${f.actual_range}  |  bad rows: ${f.bad_row_count}`);
      const parts = f.bounds.replace(/\$/g, '').split('-');
      console.log(`    -> fix: UPDATE prices SET is_suspicious=true WHERE price_type='${f.price_type}'`);
      console.log(`           AND procedure_id IN (SELECT id FROM procedures WHERE cpt_code='${f.cpt}')`);
      console.log(`           AND (price < ${parts[0]} OR price > ${parts[1]});`);
      console.log('');
    }
  }

  console.log('--- DR. KERR TEST (colonoscopy leakage) ---');
  console.log('');
  const kerrCashTest = await pool.query(`
    SELECT p.cpt_code, p.standard_name, pr.price_type, pr.price, h.name as hospital
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE p.cpt_code IN ('45378','45380','45385')
    AND pr.is_suspicious IS NOT TRUE
    AND pr.price_type = 'cash'
    AND pr.price < 150
    ORDER BY pr.price ASC
  `);
  const kerrNegotiatedTest = await pool.query(`
    SELECT p.cpt_code, p.standard_name, pr.price_type, pr.price, h.name as hospital
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE p.cpt_code IN ('45378','45380','45385')
    AND pr.is_suspicious IS NOT TRUE
    AND pr.price_type = 'negotiated'
    AND pr.price < 100
    ORDER BY pr.price ASC
  `);
  const ctLeakage = await pool.query(`
    SELECT p.cpt_code, p.standard_name, pr.price_type, pr.price, h.name as hospital
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE p.cpt_code = '74263'
    AND p.standard_name ILIKE '%colonoscopy%'
    AND pr.is_suspicious IS NOT TRUE
  `);

  const kerrPass = kerrCashTest.rows.length === 0 && kerrNegotiatedTest.rows.length === 0 && ctLeakage.rows.length === 0;
  if (kerrPass) {
    console.log('PASS - no sub-$150 cash / sub-$100 negotiated colonoscopy prices, no CT colonography mislabeled as colonoscopy.');
    console.log('');
  } else {
    console.log('FAIL:');
    kerrCashTest.rows.forEach(r => console.log(`   ${r.hospital}: ${r.standard_name} (${r.cpt_code}) CASH = $${r.price}  <- real red flag`));
    kerrNegotiatedTest.rows.forEach(r => console.log(`   ${r.hospital}: ${r.standard_name} (${r.cpt_code}) negotiated = $${r.price}  <- below $100, check`));
    ctLeakage.rows.forEach(r => console.log(`   ${r.hospital}: mislabeled "${r.standard_name}" (${r.cpt_code}) ${r.price_type} = $${r.price}`));
    console.log('');
  }

  console.log('===================================================');
  const overallPass = totalFail === 0 && kerrPass;
  console.log(overallPass ? 'ALL CHECKS PASS - safe to demo.' : 'FAILURES FOUND - fix before demo.');
  console.log('===================================================');

  await pool.end();
  process.exit(overallPass ? 0 : 1);
}

main().catch(err => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
