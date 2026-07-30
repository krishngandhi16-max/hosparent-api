#!/usr/bin/env node
// fix_drug_codes.js — make drug-CODE search (J-codes, NDC) actually return data.
//
// Why J1815 (insulin) and friends return nothing:
//   1. Retail sources (Cost Plus, GoodRx) publish drug NAMES + NDC — never J-codes.
//      J-codes are HCPCS billing codes hospitals/insurers use for injectables. So
//      no scrape will ever fill drug_prices.j_code by itself.
//   2. Some drugs (most insulins!) aren't sold by Cost Plus at all, so there is no
//      retail row to find — the data has to come from hospital price files instead.
//
// What this script does (idempotent, reversible — only fills NULL j_code):
//   1. Seeds drug_code_map: common J-code -> drug-name pattern mappings.
//   2. Backfills drug_prices.j_code for INJECTABLE-form retail rows that match.
//   3. Reports coverage: which J-codes now have retail rows, and how many J-codes
//      exist in the hospital-side tables (procedures/mrf_prices) that /search-drugs
//      falls back to for codes with no retail seller.
//
// Run: node fix_drug_codes.js
require('dotenv').config();
const { pool } = require('./db');

// Curated common J-codes → name patterns. Only applied to injectable-looking
// forms (vial/pen/syringe/injector), never to tablets/creams, and never to
// accessories like pen NEEDLES — so a J-code search stays trustworthy.
const JCODE_MAP = [
  ['J1815', ['%insulin glargine%', '%insulin lispro%', '%insulin aspart%', '%insulin human%', '%lantus%', '%humalog%', '%novolog%', '%basaglar%', '%semglee%', '%levemir%', '%tresiba%'], 'insulin injection, per 5 units'],
  ['J1817', ['%insulin pump%'], 'insulin for pump, per 50 units'],
  ['J3420', ['%cyanocobalamin%', '%vitamin b-12 inj%', '%vitamin b12 inj%'], 'vitamin B12 injection'],
  ['J1071', ['%testosterone cypionate%'], 'testosterone cypionate 1 mg'],
  ['J3121', ['%testosterone enanthate%'], 'testosterone enanthate 1 mg'],
  ['J1050', ['%medroxyprogesterone%', '%depo-provera%'], 'medroxyprogesterone acetate 1 mg'],
  ['J1885', ['%ketorolac%'], 'ketorolac tromethamine 15 mg'],
  ['J2405', ['%ondansetron%'], 'ondansetron HCl injection 1 mg'],
  ['J0696', ['%ceftriaxone%'], 'ceftriaxone sodium 250 mg'],
  ['J0690', ['%cefazolin%'], 'cefazolin sodium 500 mg'],
  ['J1644', ['%heparin%'], 'heparin sodium 1000 units'],
  ['J1650', ['%enoxaparin%', '%lovenox%'], 'enoxaparin sodium 10 mg'],
  ['J2001', ['%lidocaine%'], 'lidocaine HCl injection 10 mg'],
  ['J1100', ['%dexamethasone sodium%'], 'dexamethasone sodium phosphate 1 mg'],
  ['J1030', ['%methylprednisolone%'], 'methylprednisolone acetate 40 mg'],
  ['J3301', ['%triamcinolone acetonide inj%', '%kenalog%'], 'triamcinolone acetonide 10 mg'],
  ['J0702', ['%betamethasone%'], 'betamethasone acet & sod phosph 3 mg'],
  ['J2550', ['%promethazine%'], 'promethazine HCl injection 50 mg'],
  ['J1200', ['%diphenhydramine%'], 'diphenhydramine HCl injection 50 mg'],
  ['J0171', ['%epinephrine%', '%epipen%'], 'adrenalin/epinephrine 0.1 mg'],
  ['J0585', ['%onabotulinumtoxin%', '%botox%'], 'onabotulinumtoxinA 1 unit'],
  ['J1745', ['%infliximab%', '%remicade%'], 'infliximab 10 mg'],
  ['J0135', ['%adalimumab%', '%humira%', '%yusimry%'], 'adalimumab 20 mg'],
  ['J2357', ['%omalizumab%', '%xolair%'], 'omalizumab 5 mg'],
  ['J1756', ['%iron sucrose%', '%venofer%'], 'iron sucrose 1 mg'],
  ['J1439', ['%ferric carboxymaltose%', '%injectafer%'], 'ferric carboxymaltose 1 mg'],
  ['J9312', ['%rituximab%', '%rituxan%'], 'rituximab 10 mg'],
  ['J0878', ['%daptomycin%'], 'daptomycin 1 mg'],
  ['J2704', ['%propofol%'], 'propofol 10 mg'],
  ['J2469', ['%palonosetron%'], 'palonosetron HCl 25 mcg'],
];

// Only injectable-looking retail forms qualify for a J-code tag.
const INJECTABLE_FORM = `(
  dp.form ILIKE '%vial%' OR dp.form ILIKE '%syringe%' OR dp.form ILIKE '%injector%' OR
  dp.form ILIKE '%injection%' OR dp.form ILIKE '%pen%' OR dp.form ILIKE '%ampule%'
) AND dp.form NOT ILIKE '%needle%' AND dp.drug_name NOT ILIKE '%needle%'`;

async function ensureMapTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drug_code_map (
      j_code TEXT NOT NULL,
      name_pattern TEXT NOT NULL,
      code_label TEXT,
      PRIMARY KEY (j_code, name_pattern)
    )`);
  for (const [code, patterns, label] of JCODE_MAP) {
    for (const p of patterns) {
      await pool.query(
        `INSERT INTO drug_code_map (j_code, name_pattern, code_label) VALUES ($1,$2,$3)
         ON CONFLICT (j_code, name_pattern) DO UPDATE SET code_label = EXCLUDED.code_label`,
        [code, p, label]
      );
    }
  }
}

async function backfillJCodes() {
  await ensureMapTable();
  const r = await pool.query(`
    UPDATE drug_prices dp SET j_code = m.j_code
    FROM drug_code_map m
    WHERE dp.j_code IS NULL
      AND (dp.drug_name ILIKE m.name_pattern OR dp.brand_name ILIKE m.name_pattern)
      AND ${INJECTABLE_FORM}
  `);
  return r.rowCount;
}

async function report() {
  const retail = await pool.query(`
    SELECT j_code, COUNT(*)::int AS rows, MIN(price) AS cheapest
    FROM drug_prices WHERE j_code IS NOT NULL GROUP BY j_code ORDER BY j_code`);
  console.log(`\nRetail rows tagged with a J-code: ${retail.rows.length} distinct code(s)`);
  for (const r of retail.rows) console.log(`  ${r.j_code}: ${r.rows} row(s), cheapest $${r.cheapest}`);

  // Hospital-side J-code coverage — this is where codes like J1815 live when no
  // retail pharmacy sells the drug. /search-drugs falls back to these.
  const hospProc = await pool.query(
    `SELECT COUNT(DISTINCT p.cpt_code)::int AS codes, COUNT(pr.id)::int AS price_rows
     FROM procedures p JOIN prices pr ON pr.procedure_id = p.id
     WHERE p.cpt_code ~ '^[JQ][0-9]{4}$'`
  ).catch(() => null);
  if (hospProc && hospProc.rows[0].codes > 0) {
    console.log(`\nHospital-side: ${hospProc.rows[0].codes} distinct J/Q-codes with ${hospProc.rows[0].price_rows} price rows (procedures+prices).`);
  } else {
    console.log(`\nHospital-side: no J/Q-codes found in procedures — J-code searches rely on retail tags + mrf_prices.`);
  }
  const mrf = await pool.query(
    `SELECT COUNT(DISTINCT billing_code)::int AS codes FROM mrf_prices WHERE billing_code ~ '^[JQ][0-9]{4}$'`
  ).catch(() => null);
  if (mrf) console.log(`mrf_prices: ${mrf.rows[0].codes} distinct J/Q-codes available for fallback.`);
}

async function main() {
  console.log('=== DRUG CODE FIX (J-code mapping + backfill) ===');
  const n = await backfillJCodes();
  console.log(`Backfilled j_code on ${n} retail drug price row(s).`);
  await report();
  console.log('\nDone. Test: curl "http://localhost:3001/search-drugs?q=J1815"');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { backfillJCodes, ensureMapTable };
