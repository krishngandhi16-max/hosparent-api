#!/usr/bin/env node
// refresh_insurance_news.js — run this on a schedule (e.g. once a day) to populate
// the insurance_news table the Learn tab reads from. Deliberately NOT called from a
// live request — it burns one Opus + web_search call, so it stays off the per-pageview
// cost path. Run manually for now; wire to Windows Task Scheduler or a Routine once
// you're happy with the story quality.
require('dotenv').config();
const { pool } = require('./db');
const { findInsuranceNews } = require('./insurance_watchdog_agent');
const { ensureNewsTable } = require('./learn');

(async () => {
  try {
    console.log('Fetching insurance news (Perplexity when configured; see CHEAP_SETUP.md)...');
    const { stories } = await findInsuranceNews();
    console.log(`Found ${stories.length} stories`);

    await ensureNewsTable();

    let saved = 0;
    for (const s of stories) {
      if (!s.headline) continue;
      await pool.query(
        `INSERT INTO insurance_news (headline, summary, source, story_date, url) VALUES ($1,$2,$3,$4,$5)`,
        [s.headline, s.summary || null, s.source || null, s.date || null, s.url || null]
      );
      saved += 1;
    }
    console.log(`Saved ${saved} stories to insurance_news table`);
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})().finally(() => pool.end());
