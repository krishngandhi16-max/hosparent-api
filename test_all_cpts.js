// ══════════════════════════════════════════════════════════════
// HOSPARENT AUTOMATED TEST SUITE
// Tests every CPT with bounds + every drug + every endpoint.
// Run WHILE server.js is running: node test_all_cpts.js
// Zero manual clicking. Prints PASS/FAIL table.
// ══════════════════════════════════════════════════════════════
const BASE = 'http://localhost:3001';

const SEARCH_TERMS = [
  ['colonoscopy','45378'], ['knee replacement','27447'], ['hip replacement','27130'],
  ['gallbladder','47562'], ['mri brain','70551'], ['ct abdomen','74177'],
  ['mammogram','77067'], ['ekg','93000'], ['cbc','85025'], ['blood panel','80053'],
  ['lipid panel','80061'], ['chest xray','71046'], ['cataract','66984'],
  ['hernia','49505'], ['appendectomy','44950'], ['knee arthroscopy','29881'],
  ['echocardiogram','93306'], ['tonsillectomy','42820'], ['spinal fusion','22612'],
  ['vaginal delivery','59400'], ['c-section','59510'], ['upper endoscopy','43239'],
  ['dexa','77080'], ['pet scan','78815'], ['ultrasound abdomen','76700'],
  ['a1c','83036'], ['tsh','84443'], ['carpal tunnel','64721'],
];

const DRUGS = ['atorvastatin','lisinopril','metformin','sertraline','levothyroxine',
  'amlodipine','omeprazole','gabapentin','semaglutide','lipitor','ozempic','zoloft'];

async function get(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function main() {
  let pass = 0, fail = 0;
  const failures = [];

  console.log('HOSPARENT TEST SUITE');
  console.log('='.repeat(60));

  // 1. Health + bounds loaded
  try {
    const h = await get('/health');
    if (h.bounds_loaded > 50) { console.log(`✓ health: ${h.bounds_loaded} bounds loaded`); pass++; }
    else throw new Error(`only ${h.bounds_loaded} bounds`);
  } catch(e) { console.log(`✗ health: ${e.message}`); fail++; failures.push('health'); }

  // 2. Every CPT with bounds — verify via /test-cpt
  console.log('\n[CPT bounds verification]');
  const bounds = await get('/bounds');
  for (const cpt of Object.keys(bounds)) {
    try {
      const t = await get(`/test-cpt/${cpt}`);
      if (t.status === 'PASS') { pass++; }
      else { fail++; failures.push(`${cpt} ${t.label}: min=${t.stats.min_cash} max=${t.stats.max_cash} bounds=${t.bounds.min}-${t.bounds.max}`); }
    } catch(e) { fail++; failures.push(`${cpt}: ${e.message}`); }
  }
  console.log(`  ${Object.keys(bounds).length} CPTs checked`);

  // 3. Search endpoint — every term returns results, all in bounds
  console.log('\n[Search endpoint]');
  for (const [term, cpt] of SEARCH_TERMS) {
    try {
      const results = await get(`/search?q=${encodeURIComponent(term)}`);
      if (!Array.isArray(results)) throw new Error('not an array');
      if (results.length === 0) throw new Error('0 results');
      const b = bounds[cpt];
      const bad = b ? results.filter(r => r.cash_price !== null && (parseFloat(r.cash_price) < b.min || parseFloat(r.cash_price) > b.max)) : [];
      if (bad.length > 0) throw new Error(`${bad.length} out-of-bounds: ${bad[0].hospital_name} $${bad[0].cash_price}`);
      const nullCash = results.filter(r => r.cash_price === null).length;
      console.log(`  ✓ ${term}: ${results.length} hospitals, min $${results.find(r=>r.cash_price)?.cash_price ?? 'n/a'}, ${nullCash} negotiated-only`);
      pass++;
    } catch(e) { console.log(`  ✗ ${term}: ${e.message}`); fail++; failures.push(`search:${term} ${e.message}`); }
  }

  // 4. Drugs
  console.log('\n[Drug search]');
  for (const drug of DRUGS) {
    try {
      const results = await get(`/search-drugs?q=${encodeURIComponent(drug)}`);
      if (!Array.isArray(results)) throw new Error('not an array');
      if (results.length === 0) throw new Error('0 results');
      console.log(`  ✓ ${drug}: ${results.length} prices, cheapest $${results[0].price} at ${results[0].pharmacy_chain}`);
      pass++;
    } catch(e) { console.log(`  ✗ ${drug}: ${e.message}`); fail++; failures.push(`drug:${drug} ${e.message}`); }
  }

  // 5. Category separation — colonoscopy search must not return CT colonography as 45378
  console.log('\n[Category separation — the Dr. Kerr test]');
  try {
    const results = await get('/search?q=colonoscopy');
    const virtual = results.filter(r => (r.standard_name||'').toLowerCase().includes('virtual') || (r.standard_name||'').toLowerCase().includes('colonograph'));
    const under400 = results.filter(r => r.cash_price !== null && parseFloat(r.cash_price) < 400);
    if (virtual.length > 0) throw new Error(`virtual colonoscopy leaked into results`);
    if (under400.length > 0) throw new Error(`price under $400 visible: ${under400[0].hospital_name} $${under400[0].cash_price}`);
    console.log(`  ✓ colonoscopy clean: min price $${results.find(r=>r.cash_price)?.cash_price}, no virtual/CT leakage`);
    pass++;
  } catch(e) { console.log(`  ✗ COLONOSCOPY: ${e.message}`); fail++; failures.push(`CRITICAL colonoscopy: ${e.message}`); }

  // 6. Other endpoints respond
  console.log('\n[Endpoint smoke tests]');
  for (const ep of ['/hospitals','/payers','/pharmacies','/contracts','/search-imaging?q=mri','/search-radiology?q=mri','/episode/45378','/search-surgery-bundles?q=knee']) {
    try { await get(ep); console.log(`  ✓ ${ep}`); pass++; }
    catch(e) { console.log(`  ✗ ${ep}: ${e.message}`); fail++; failures.push(ep); }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED — safe to demo.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });