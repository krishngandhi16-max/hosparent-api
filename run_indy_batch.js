#!/usr/bin/env node
// run_indy_batch.js — run Indy on a batch of ad drafts from Terry's vault + insurance
// news. Run this AFTER run_terry_batch.js has produced some notes. Drafts land in the
// ad_queue table with status='draft' — review them, then post manually (or via Buffer
// once that connector is wired up).
require('dotenv').config();
const { pool } = require('./db');
const { generateAdBatch } = require('./indy_agent');

const limit = Number(process.argv[2]) || 5;

(async () => {
  console.log(`\nIndy: drafting up to ${limit} ad(s)...\n`);
  const drafted = await generateAdBatch(limit);
  if (drafted.length === 0) {
    console.log('Nothing to draft from yet. Run run_terry_batch.js first, or check refresh_insurance_news.js has populated insurance_news.');
  }
  drafted.forEach((ad) => {
    console.log(`  [${ad.platform}] ${ad.headline}`);
    console.log(`    ${ad.body}`);
    console.log(`    CTA: ${ad.cta || '(none)'}  angle: ${ad.angle || '(none)'}\n`);
  });
  console.log(`Saved ${drafted.length} draft(s) to ad_queue (status='draft').\n`);
  process.exit(0);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); }).finally(() => pool.end());
