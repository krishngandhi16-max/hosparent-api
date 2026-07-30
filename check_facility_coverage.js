#!/usr/bin/env node
// check_facility_coverage.js — how much data do we ACTUALLY have per facility type?
// Run this before deciding what new scraping to do — the schema already has tables
// for ASCs, imaging centers, labs, colonoscopy centers, EMS, and mental health
// providers. This tells you which are populated vs. empty shells.
require('dotenv').config();
const { pool } = require('./db');

const CHECKS = [
  ['hospitals', 'hospitals (MRF)'],
  ['prices', '  -> hospital prices'],
  ['asc_centers', 'ASCs (surgery centers)'],
  ['asc_prices', '  -> ASC prices'],
  ['imaging_centers', 'imaging/radiology centers'],
  ['imaging_prices', '  -> imaging prices'],
  ['colonoscopy_centers', 'colonoscopy centers'],
  ['colonoscopy_prices', '  -> colonoscopy prices'],
  ['labs', 'labs'],
  ['lab_prices', '  -> lab prices'],
  ['walkinlab_prices', 'walk-in lab prices'],
  ['ems_providers', 'EMS providers'],
  ['mental_health_providers', 'mental health / therapists'],
  ['drug_prices', 'drug prices'],
];

async function main() {
  console.log('\n=== FACILITY-TYPE DATA COVERAGE ===\n');
  for (const [table, label] of CHECKS) {
    try {
      const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      const n = r.rows[0].n;
      const flag = n === 0 ? '  <- EMPTY, table exists but no data' : '';
      console.log(`  ${label.padEnd(32)} ${String(n).padStart(8)}${flag}`);
    } catch (e) {
      console.log(`  ${label.padEnd(32)} table missing (${e.message.split('\n')[0]})`);
    }
  }
  console.log();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => pool.end());
