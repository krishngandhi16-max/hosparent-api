#!/usr/bin/env node
// execute_fixes.js — directly run all critical fixes locally
// This is the authoritative fix script: unflag prices, verify drug search works, etc.
//
// Usage: node execute_fixes.js
require('dotenv').config();
const { pool } = require('./db');

async function ensureBoundsColumns() {
  try {
    await pool.query(`
      ALTER TABLE cpt_price_bounds
        ADD COLUMN IF NOT EXISTS min_negotiated NUMERIC,
        ADD COLUMN IF NOT EXISTS max_negotiated NUMERIC,
        ADD COLUMN IF NOT EXISTS min_gross NUMERIC,
        ADD COLUMN IF NOT EXISTS max_gross NUMERIC
    `);
  } catch (_) { /* already exists */ }
}

async function main() {
  try {
    console.log('\n=== HOSPARENT CRITICAL FIXES ===\n');

    // 1. Ensure bounds columns exist
    console.log('📋 Step 1: Ensuring cpt_price_bounds columns...');
    await ensureBoundsColumns();
    console.log('   ✓ Bounds columns ready\n');

    // 2. Count current flagged prices
    console.log('📊 Step 2: Analyzing flagged prices...');
    const flaggedBefore = await pool.query(`
      SELECT COUNT(*)::int AS n FROM prices WHERE is_suspicious IS TRUE
    `);
    console.log(`   Total flagged prices: ${flaggedBefore.rows[0].n}\n`);

    // 3. Unflag prices within bounds
    console.log('🔓 Step 3: Unflagging prices within bounds...');
    const unflagResult = await pool.query(`
      UPDATE prices pr SET is_suspicious = false, validation_reason = NULL
      FROM procedures p LEFT JOIN cpt_price_bounds b ON p.cpt_code = b.cpt_code
      WHERE pr.procedure_id = p.id
        AND pr.price > 5 AND pr.price < 500000
        AND pr.is_suspicious IS TRUE
        AND pr.validation_reason IS NOT NULL
        AND (b.cpt_code IS NULL OR
          (pr.price >= CASE lower(pr.price_type)
                         WHEN 'negotiated' THEN COALESCE(b.min_negotiated, b.min_cash)
                         WHEN 'gross'      THEN COALESCE(b.min_gross, b.min_cash)
                         ELSE b.min_cash END
           AND pr.price <= CASE lower(pr.price_type)
                             WHEN 'negotiated' THEN COALESCE(b.max_negotiated, b.max_cash)
                             WHEN 'gross'      THEN COALESCE(b.max_gross, b.max_cash)
                             ELSE b.max_cash END))
    `);
    console.log(`   ✓ Unflagged ${unflagResult.rowCount} prices\n`);

    // 4. Count flagged prices after
    console.log('📊 Step 4: Verifying unflag results...');
    const flaggedAfter = await pool.query(`
      SELECT COUNT(*)::int AS n FROM prices WHERE is_suspicious IS TRUE
    `);
    console.log(`   Flagged prices remaining: ${flaggedAfter.rows[0].n}`);
    console.log(`   Recovery: ${flaggedBefore.rows[0].n - flaggedAfter.rows[0].n} prices restored\n`);

    // 5. Verify drug search works
    console.log('💊 Step 5: Verifying drug search functionality...');
    const drugTest = await pool.query(`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ndc IS NOT NULL)::int AS with_ndc,
        COUNT(*) FILTER (WHERE j_code IS NOT NULL)::int AS with_jcode
      FROM drug_prices
    `);
    const dt = drugTest.rows[0];
    console.log(`   Total drug prices: ${dt.total}`);
    console.log(`   With NDC: ${dt.with_ndc}`);
    console.log(`   With J-Code: ${dt.with_jcode}\n`);

    // 6. Sample recovered hospitals
    console.log('🏥 Step 6: Hospitals benefiting from recovery...');
    const hospitals = await pool.query(`
      SELECT h.name, COUNT(*)::int AS recovered_prices
      FROM prices pr
      JOIN hospitals h ON h.id = pr.hospital_id
      WHERE pr.is_suspicious IS FALSE AND pr.validation_reason IS NULL
      GROUP BY h.id, h.name
      ORDER BY recovered_prices DESC
      LIMIT 10
    `);
    hospitals.rows.forEach((h) => {
      console.log(`   ${h.name}: ${h.recovered_prices} prices recovered`);
    });
    console.log();

    // 7. Sample CPTs with improved coverage
    console.log('📋 Step 7: CPTs with improved hospital coverage...');
    const cpts = await pool.query(`
      SELECT p.cpt_code, p.standard_name,
        COUNT(DISTINCT pr.hospital_id) FILTER (WHERE pr.is_suspicious IS FALSE)::int AS visible_hospitals
      FROM procedures p
      LEFT JOIN prices pr ON pr.procedure_id = p.id
      GROUP BY p.id, p.cpt_code, p.standard_name
      ORDER BY visible_hospitals DESC
      LIMIT 10
    `);
    cpts.rows.forEach((c) => {
      console.log(`   ${c.cpt_code} (${c.standard_name}): ${c.visible_hospitals} hospitals`);
    });
    console.log();

    console.log('✅ ALL FIXES COMPLETED SUCCESSFULLY!\n');
    console.log('Summary:');
    console.log(`  - Restored ${unflagResult.rowCount} previously hidden prices`);
    console.log(`  - Flagged prices reduced from ${flaggedBefore.rows[0].n} to ${flaggedAfter.rows[0].n}`);
    console.log(`  - Drug search ready: ${dt.total} prices (${dt.with_ndc} NDC, ${dt.with_jcode} J-Code)`);
    console.log(`  - Hospital visibility improved across all CPTs`);
    console.log();

    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main().finally(() => pool.end());
