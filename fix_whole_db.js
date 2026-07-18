#!/usr/bin/env node
// fix_whole_db.js — the ONE COMMAND that audits and fixes the entire database in bulk.
//
// This is the answer to "I need to check everything in bulk": it chains every fixer
// in the right order so the whole DB gets the same treatment the Baylor colonoscopy
// bug got, across ALL CPT codes and price types.
//
//   Step 1  audit_cpt_mapping.js --llm --apply   Find + fix procedures mapped to the
//                                                wrong CPT code, DB-wide. Rule tier is
//                                                deterministic; LLM tier (Haiku) covers
//                                                the rest. Every recode stores
//                                                cpt_code_original → fully reversible.
//   Step 2  validation_system.js                 Re-flag every price that's out of its
//                                                per-type bounds (cash vs cash bounds,
//                                                negotiated vs negotiated, gross vs
//                                                gross). Flags only — never deletes.
//   Step 3  hoser_unflag.js                      Un-hide every price that's actually
//                                                WITHIN its per-type bounds (recovers
//                                                good prices hidden by stale flags).
//   Step 4  verify_all_prices_v2.js              Final pass/fail manifest, every CPT,
//                                                every price type. This is the receipt.
//
// Usage:
//   node fix_whole_db.js                # full run (audit+apply, validate, unflag, verify)
//   node fix_whole_db.js --report-only  # look, don't touch: audit report + verify only
//   node fix_whole_db.js --skip-llm     # rule-tier CPT fixes only (no Haiku calls)
//
// Everything is reversible: recodes keep cpt_code_original; flags are booleans.
// Nothing is ever deleted.

const { spawnSync } = require('child_process');

const REPORT_ONLY = process.argv.includes('--report-only');
const SKIP_LLM = process.argv.includes('--skip-llm');

function run(label, script, args = []) {
  const t0 = Date.now();
  console.log(`\n${'═'.repeat(60)}\n▶ ${label}\n   node ${script} ${args.join(' ')}\n${'═'.repeat(60)}`);
  const r = spawnSync('node', [script, ...args], { stdio: 'inherit' });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = r.status === 0;
  console.log(`${ok ? '✓' : '✗'} ${label} — ${ok ? 'done' : `EXIT ${r.status}`} in ${secs}s`);
  return { label, ok, secs };
}

(async () => {
  console.log('\n🏥 HOSPARENT WHOLE-DB BULK FIX' + (REPORT_ONLY ? ' (REPORT ONLY — no changes)' : ''));
  const results = [];

  // Step 1 — CPT mapping audit (the Baylor-colonoscopy class of bug, DB-wide)
  const auditArgs = [];
  if (!SKIP_LLM) auditArgs.push('--llm');
  if (!REPORT_ONLY) auditArgs.push('--apply');
  results.push(run('Step 1/4 — CPT mapping audit' + (REPORT_ONLY ? ' (report)' : ' + fix'), 'audit_cpt_mapping.js', auditArgs));

  if (!REPORT_ONLY) {
    // Step 2 — re-validate every price against its per-type bounds
    results.push(run('Step 2/4 — re-run price validation (flag bad prices)', 'validation_system.js'));

    // Step 3 — recover good prices hidden by stale flags
    results.push(run('Step 3/4 — unflag prices within per-type bounds', 'hoser_unflag.js'));
  } else {
    console.log('\n(report-only: skipping validation + unflag steps)');
  }

  // Step 4 — the receipt: every CPT, every price type, PASS/FAIL
  results.push(run('Step 4/4 — verify all prices (final manifest)', 'verify_all_prices_v2.js'));

  console.log(`\n${'═'.repeat(60)}\n📋 BULK FIX SUMMARY\n${'═'.repeat(60)}`);
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗ FAILED'}  ${r.label} (${r.secs}s)`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log(`\n⚠ ${failed.length} step(s) failed — scroll up for that step's output, fix, and re-run.`);
    process.exit(1);
  }
  console.log('\n✅ All steps completed. The verify manifest above is the receipt.');
  console.log('   Restart the server (or GET /cache-clear) so the API serves the fixed data.');
})();
