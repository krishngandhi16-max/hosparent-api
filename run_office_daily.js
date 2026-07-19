#!/usr/bin/env node
// run_office_daily.js — THE self-running office. One scheduled command that does
// everything the office is supposed to do without you touching it:
//
//   DATA HEALTH (pure SQL, $0):
//     1. validation_system.js      flag out-of-bounds prices (per-type bounds)
//     2. hoser_unflag.js           recover good prices hidden by stale flags
//     3. verify_all_prices_v2.js   PASS/FAIL manifest for every CPT
//   DRUGS ($0 — official public API):
//     4. import_costplus.js        refresh the full Cost Plus catalog + J-codes
//   CONTENT & RESEARCH (free tier / Perplexity pennies):
//     5. seed_learn_content.js     keep the evidence-backed Learn base fresh
//     6. refresh_insurance_news.js insurance news feed for the Learn tab
//     7. run_hoser_daily.js        Indy finds stories + researches Learn topics,
//                                  Hoser texts you for approval
//
// Every step is independent: one failing never stops the rest. The summary at
// the end (and office_daily.log if you redirect) is your morning receipt.
//
// Make it self-running on the tunnel PC (run once in PowerShell as admin):
//   schtasks /Create /F /SC DAILY /ST 07:00 /TN "Hosparent Office" ^
//     /TR "cmd /c cd /d C:\Users\Krish\Hosparent && node run_office_daily.js >> office_daily.log 2>&1"
//
// Run manually any time: node run_office_daily.js
const { spawnSync } = require('child_process');
const fs = require('fs');

const STEPS = [
  ['1/7 validate prices (flag out-of-bounds)', 'validation_system.js'],
  ['2/7 recover in-bounds prices (unflag)', 'hoser_unflag.js'],
  ['3/7 verify manifest (per-CPT PASS/FAIL)', 'verify_all_prices_v2.js'],
  ['4/7 refresh Cost Plus drug catalog + J-codes', 'import_costplus.js'],
  ['5/7 refresh Learn base content', 'seed_learn_content.js'],
  ['6/7 refresh insurance news', 'refresh_insurance_news.js'],
  ['7/7 Indy research + Hoser approval text', 'run_hoser_daily.js'],
];

console.log(`\n🏢 HOSPARENT OFFICE DAILY RUN — ${new Date().toISOString()}`);
const results = [];
for (const [label, script] of STEPS) {
  if (!fs.existsSync(script)) {
    console.log(`\n▶ ${label} — SKIPPED (${script} not found)`);
    results.push({ label, ok: null });
    continue;
  }
  const t0 = Date.now();
  console.log(`\n${'─'.repeat(60)}\n▶ ${label}\n${'─'.repeat(60)}`);
  const r = spawnSync('node', [script], { stdio: 'inherit', timeout: 30 * 60 * 1000 });
  const ok = r.status === 0;
  results.push({ label, ok, secs: ((Date.now() - t0) / 1000).toFixed(0) });
  console.log(`${ok ? '✓' : '✗'} ${label} (${results.at(-1).secs}s)`);
}

console.log(`\n${'═'.repeat(60)}\n📋 OFFICE DAILY SUMMARY — ${new Date().toLocaleString()}\n${'═'.repeat(60)}`);
for (const r of results) {
  console.log(`  ${r.ok === null ? '–' : r.ok ? '✓' : '✗ FAILED'}  ${r.label}${r.secs ? ` (${r.secs}s)` : ''}`);
}
const failed = results.filter((r) => r.ok === false);
if (failed.length) console.log(`\n⚠ ${failed.length} step(s) failed — scroll up for details. The rest completed normally.`);
else console.log('\n✅ Office ran clean.');
process.exit(failed.length ? 1 : 0);
