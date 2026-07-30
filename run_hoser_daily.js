#!/usr/bin/env node
// run_hoser_daily.js — the once-a-day job. Point Windows Task Scheduler (or a Routine)
// at this. Hoser has Indy find stories + refresh Learn content, then texts you for
// approval. Posting only happens after you reply GO (handled by /sms/incoming).
require('dotenv').config();
const { pool } = require('./db');
const { dailyRun } = require('./hoser_coordinator');

(async () => {
  console.log('\n=== Hoser daily run ===\n');
  const r = await dailyRun();
  console.log(`Stories found: ${r.found.length}`);
  r.found.forEach((s) => console.log(`  - ${s.headline}`));
  console.log(`Learn topics refreshed: ${r.learnUpdated.length}`);
  console.log(`Texted you: ${r.texted ? 'yes' : `no (${r.sms_reason})`}`);
  if (!r.texted) console.log(`\nMessage that WOULD have been sent:\n${r.message}\n`);
  process.exit(0);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); }).finally(() => pool.end());
