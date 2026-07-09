require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// ══════════════════════════════════════════════════════════════
// verify_all_prices.js
//
// Purpose: catch the "$35 knee replacement" class of bug BEFORE a demo,
// by checking the database directly — not through the API, not relying
// on is_suspicious already being set correctly. This is the ground truth
// check: for every CPT with bounds defined, is there ANY row, of ANY
// price_type, that is out of bounds AND not flagged?
//
// Run this:
//   - After every scrape
//   - After every validation_system.js run
//   - Before every demo, no exceptions
//
// Exit code is 1 if anything fails, so it can be wired into a CI/pre-demo
// checklist script later if you want.
// ══════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  HOSPARENT PRICE VERIFICATION — full DB sweep');
  console.log('═══════════════════════════════════════════════════\n');

  const boundsResult = await pool.query(
    'SELECT cpt_code, procedure_label, min_cash, max_cash FROM cpt_price_bounds ORDER BY cpt_code'
  );
  const bounds = boundsResult.rows;
  console.log(`Loaded ${bounds.length} CPT bounds.\n`);

  let totalFail = 0;
  let totalPass = 0;
  const failures = [];

  for (const b of bounds) {
    const min = parseFloat(b.min_cash);
    const max = parseFloat(b.max_cash);

    // Check EVERY price_type, not just cash. This is the exact gap that
    // let bad gross/negotiated prices through in v3.1.
    const r = await pool.query(`
      SELECT
        pr.price_type,
        MIN(pr.price) as min_price,
        MAX(pr.price) as max_price,
        COUNT(*) as total_rows,
        COUNT(*) FILTER (WHERE pr.is_suspicious IS TRUE) as flagged_rows,
        COUNT(*) FILTER (
          WHERE pr.is_suspicious IS NOT TRUE
          AND (pr.price < $2 OR pr.price > $3)
        ) as unflagged_bad_rows
      FROM prices pr
      JOIN procedures p ON p.id = pr.procedure_id
      WHERE p.cpt_code = $1
      GROUP BY pr.price_type
    `, [b.cpt_code, min, max]);

    let cptHasFailure = false;
    for (const row of r.rows) {
      const badCount = parseInt(row.unflagged_bad_rows);
      if (badCount > 0) {
        cptHasFailure = true;
        failures.push({
          cpt: b.cpt_code,
          label: b.procedure_label,
          price_type: row.price_type,
          bounds: `$${min}–$${max}`,
          actual_range: `$${row.min_price}–$${row.max_price}`,
          bad_row_count: badCount,
        });
      }
    }

    if (cptHasFailure) {
      totalFail++;
    } else {
      totalPass++;
    }
  }

  console.log('─── RESULTS ───\n');
  console.log(`PASS: ${totalPass} / ${bounds.length}`);
  console.log(`FAIL: ${totalFail} / ${bounds.length}\n`);

  if (failures.length > 0) {
    console.log('⚠️  FAILING CPTs (unflagged out-of-bounds prices found):\n');
    for (const f of failures) {
      console.log(`  CPT ${f.cpt} (${f.label}) — price_type=${f.price_type}`);
      console.log(`    bounds: ${f.bounds}  |  actual: ${f.actual_range}  |  bad rows: ${f.bad_row_count}`);
      console.log(`    → fix: UPDATE prices SET is_suspicious=true WHERE price_type='${f.price_type}'`);
      console.log(`           AND procedure_id IN (SELECT id FROM procedures WHERE cpt_code='${f.cpt}')`);
      console.log(`           AND (price < ${f.bounds.split('–')[0].replace('$','')} OR price > ${f.bounds.split('–')[1].replace('$','')});\n`);
    }
  }

  // Dr. Kerr regression test — the specific failure mode that started this.
  // Colonoscopy (45378/45380/45385) must never show a price under $150,
  // and CT colonography (74263) must never appear labeled as a colonoscopy.
  console.log('─── DR. KERR TEST (colonoscopy leakage) ───\n');
  const kerrTest = await pool.query(`
    SELECT p.cpt_code, p.standard_name, pr.price_type, pr.price, h.name as hospital
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE p.cpt_code IN ('45378','45380','45385')
    AND pr.is_suspicious IS NOT TRUE
    AND pr.price < 150
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

  if (kerrTest.rows.length === 0 && ctLeakage.rows.length === 0) {
    console.log('✅ PASS — no sub-$150 colonoscopy prices, no CT colonography mislabeled as colonoscopy.\n');
  } else {
    console.log('❌ FAIL:');
    kerrTest.rows.forEach(r => console.log(`   ${r.hospital}: ${r.standard_name} (${r.cpt_code}) ${r.price_type} = $${r.price}`));
    ctLeakage.rows.forEach(r => console.log(`   ${r.hospital}: mislabeled "${r.standard_name}" (${r.cpt_code}) ${r.price_type} = $${r.price}`));
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════');
  const overallPass = totalFail === 0 && kerrTest.rows.length === 0 && ctLeakage.rows.length === 0;
  console.log(overallPass ? '✅ ALL CHECKS PASS — safe to demo.' : '❌ FAILURES FOUND — fix before demo.');
  console.log('═══════════════════════════════════════════════════');

  await pool.end();
  process.exit(overallPass ? 0 : 1);
}

main().catch(err => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});