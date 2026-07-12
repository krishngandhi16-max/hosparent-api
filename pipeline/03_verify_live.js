// pipeline/03_verify_live.js — end-to-end verification against the RUNNING API.
// This is the pre-demo gate (step 5): gallbladder + knee must return clean
// outpatient prices with no inpatient/DRG leaks.
//
//   node pipeline/03_verify_live.js                          -> checks http://localhost:3001
//   node pipeline/03_verify_live.js --base https://api.hosparent.com
//
// Exits nonzero on any FAIL so it can gate a demo checklist.

const BASE = (() => {
  const i = process.argv.indexOf('--base');
  return i > -1 ? process.argv[i + 1].replace(/\/$/, '') : 'http://localhost:3001';
})();

const DRG_NAME = /(with mcc|w\/mcc|w mcc|without cc|w\/o cc|with cc|w cc|w\/o mcc|\bdrg\b|>96 (hours|hrs)|o\.?r\.? procedure|septicemia|procedures with|diagnoses)/i;

const CHECKS = [
  { cpt: '47562', q: 'gallbladder', label: 'Laparoscopic Cholecystectomy', minCash: 1000, maxCash: 100000, medicareMax: 40 },
  { cpt: '27447', q: 'knee replacement', label: 'Total Knee Replacement', minCash: 3000, maxCash: 150000, medicareMax: 60 },
  { cpt: '45378', q: 'colonoscopy', label: 'Colonoscopy', minCash: 200, maxCash: 12000, medicareMax: 60 },
  { cpt: '70551', q: 'mri brain', label: 'MRI Brain', minCash: 100, maxCash: 10000, medicareMax: 60 },
];

async function get(path) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log(`PIPELINE 03 — LIVE VERIFY against ${BASE}`);
  console.log('='.repeat(60));
  let failures = 0;
  const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
  const pass = (msg) => console.log(`  ok    ${msg}`);

  const health = await get('/health');
  console.log(`/health: version ${health.version}, ${health.bounds_loaded} bounds loaded\n`);

  for (const c of CHECKS) {
    console.log(`── ${c.cpt} ${c.label} ──`);
    const rows = await get(`/search?q=${encodeURIComponent(c.q)}`);
    if (!rows.length) { fail(`/search?q=${c.q} returned 0 hospitals`); continue; }
    pass(`${rows.length} hospitals returned`);

    let leaks = 0, badCash = 0, badRatio = 0;
    for (const r of rows) {
      const name = `${r.standard_name || ''}`;
      if (DRG_NAME.test(name)) { leaks++; fail(`DRG-style name leaked: "${name}" @ ${r.hospital_name}`); }
      if (r.setting && r.setting === 'inpatient') { leaks++; fail(`inpatient row leaked @ ${r.hospital_name}`); }
      const cash = r.cash_price ? parseFloat(r.cash_price) : null;
      if (cash !== null && (cash < c.minCash || cash > c.maxCash)) {
        badCash++; fail(`cash $${cash} outside sane [$${c.minCash}, $${c.maxCash}] @ ${r.hospital_name}`);
      }
      const med = r.medicare_facility_rate ? parseFloat(r.medicare_facility_rate) : null;
      if (cash !== null && med > 0 && cash > med * c.medicareMax) {
        badRatio++; fail(`cash $${cash} is ${(cash / med).toFixed(0)}x medicare $${med} @ ${r.hospital_name}`);
      }
      if (r.cpt_code && r.cpt_code !== c.cpt && !rows.some(x => x.cpt_code === c.cpt)) {
        fail(`wrong CPT mapping: got ${r.cpt_code}, expected ${c.cpt} reachable`);
      }
    }
    if (!leaks) pass('no DRG/inpatient leaks in names or settings');
    if (!badCash && !badRatio) pass('all cash prices within sane range and medicare ratio');

    // per-type flag state
    try {
      const t = await get(`/test-cpt/${c.cpt}`);
      for (const [pt, s] of Object.entries(t.by_price_type || {})) {
        if (s.unflagged_out_of_bounds > 0) fail(`${c.cpt} ${pt}: ${s.unflagged_out_of_bounds} unflagged out-of-bounds rows`);
        else pass(`${c.cpt} ${pt}: clean=${s.clean_count} flagged=${s.flagged_count}, 0 unflagged out-of-bounds`);
        if (s.clean_count === 0) fail(`${c.cpt} ${pt}: ZERO clean rows — over-flagged, nothing to show users`);
      }
    } catch (e) { console.log(`  (no /test-cpt for ${c.cpt}: ${e.message})`); }
    console.log('');
  }

  console.log('='.repeat(60));
  if (failures) {
    console.log(`RESULT: ${failures} FAILURES — do not demo until these are resolved.`);
    process.exit(1);
  }
  console.log('RESULT: ALL CHECKS PASSED — demo-safe.');
}

main().catch(e => { console.error('VERIFY CRASHED: ' + e.message); process.exit(1); });
