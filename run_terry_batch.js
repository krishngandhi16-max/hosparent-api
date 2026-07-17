#!/usr/bin/env node
// run_terry_batch.js — run Terry on a batch of research topics. Run this on a schedule
// (Windows Task Scheduler, or later a Routine) — each run researches up to 3 new topics
// by default, so cost stays bounded no matter how often you run it.
require('dotenv').config();
const { runBatch, VAULT_DIR } = require('./terry_agent');

const limit = Number(process.argv[2]) || 3;

(async () => {
  console.log(`\nTerry: researching up to ${limit} new topic(s)...\n`);
  const results = await runBatch(undefined, { limit });
  if (results.length === 0) {
    console.log('All seed topics already researched. Add more topics to SEED_TOPICS in terry_agent.js.');
  }
  results.forEach((r) => {
    if (r.error) console.log(`  FAILED: ${r.topic} — ${r.error}`);
    else console.log(`  wrote ${r.filePath} (${r.chars} chars)`);
  });
  console.log(`\nVault: ${VAULT_DIR}\n`);
  process.exit(0);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
