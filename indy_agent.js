// indy_agent.js — "Indy," the RESEARCH agent.
//
// Indy finds things. Two jobs:
//   1) findStories(n)        — surfaces recent, sourced stories about insurance/billing
//                              practices that hurt patients (reuses the Watchdog news
//                              research). These become social posts (Terry posts them).
//   2) researchLearnContent()— finds the concrete, sourced material the free public Learn
//                              tab is built from: ways to get a lower price, and which
//                              rules/laws a patient falls under (No Surprises Act, ERISA
//                              appeals, hospital financial-assistance / 501(r), state
//                              price-transparency law, etc.). Stored in learn_content.
//
// Indy only researches and stores. It never posts (that's Terry) and never texts you
// (that's Hoser). Runs on-demand / once a day via the Hoser coordinator, not in a loop —
// keeps Opus + web_search spend bounded.

require('dotenv').config();
const { pool } = require('./db');
const { findInsuranceNews } = require('./insurance_watchdog_agent');
const { upsertLearnEntry, ensureLearnTable } = require('./learn_content');
const AnthropicPkg = require('@anthropic-ai/sdk');
const Anthropic = AnthropicPkg.default || AnthropicPkg;

const MODEL = 'claude-opus-4-8'; // research quality matters; bounded to once-daily batches

let _client;
function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic();
  }
  return _client;
}

async function ensureStoriesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stories (
      id SERIAL PRIMARY KEY,
      headline TEXT NOT NULL,
      summary TEXT,
      source TEXT,
      url TEXT,
      angle TEXT,
      status TEXT DEFAULT 'found',   -- found | approved | posted | rejected
      created_at TIMESTAMP DEFAULT NOW(),
      posted_at TIMESTAMP
    )
  `);
}

// Find N stories and store them as status='found'. De-dupes on headline so the same
// story isn't queued twice across days.
async function findStories(n = 5) {
  await ensureStoriesTable();
  const { stories } = await findInsuranceNews();
  const saved = [];
  for (const s of (stories || []).slice(0, n)) {
    if (!s.headline) continue;
    const exists = await pool.query(`SELECT 1 FROM stories WHERE headline = $1 LIMIT 1`, [s.headline]);
    if (exists.rows.length) continue;
    const r = await pool.query(
      `INSERT INTO stories (headline, summary, source, url, angle, status)
       VALUES ($1,$2,$3,$4,$5,'found') RETURNING id`,
      [s.headline, s.summary || null, s.source || null, s.url || null, 'insurance-practice']
    );
    saved.push({ id: r.rows[0].id, headline: s.headline, source: s.source, url: s.url });
  }
  return saved;
}

// Topics the Learn tab is organized around. Each becomes one grounded, sourced entry.
const LEARN_TOPICS = [
  { category: 'lower_price', title: 'Ask for the cash / self-pay price',
    prompt: 'How patients get a lower price by asking for the cash or self-pay rate instead of running it through insurance, when this beats using insurance, and how to ask. Cite real sources.' },
  { category: 'lower_price', title: 'Choose an ASC or imaging center over a hospital',
    prompt: 'How choosing an ambulatory surgery center or independent imaging center over a hospital outpatient department lowers the price for the same procedure (facility fees). Cite sources.' },
  { category: 'lower_price', title: 'Get an itemized bill and challenge errors',
    prompt: 'How requesting an itemized hospital bill and disputing errors/duplicate charges lowers what a patient pays, with the concrete steps. Cite sources.' },
  { category: 'lower_price', title: 'Hospital financial assistance (charity care / 501(r))',
    prompt: 'How nonprofit hospital financial-assistance policies (IRS 501(r)) can eliminate or reduce a bill, who qualifies, and how to apply. Cite the IRS 501(r) rule and hospital policy requirements.' },
  { category: 'your_rights', title: 'The No Surprises Act',
    prompt: 'What the federal No Surprises Act protects a patient from (surprise out-of-network / balance billing), when it applies and when it does NOT, and how to invoke it. Cite CMS/official sources.' },
  { category: 'your_rights', title: 'Appealing a denied claim (internal + external review)',
    prompt: 'A patient\'s right to appeal a denied insurance claim: internal appeal then external review, deadlines, and how the process differs for employer (ERISA) vs marketplace plans. Cite official sources.' },
  { category: 'your_rights', title: 'Hospital price transparency rule',
    prompt: 'The federal Hospital Price Transparency rule that requires hospitals to publish machine-readable prices and a consumer shoppable list, and how a patient uses it. Cite CMS sources.' },
];

const LEARN_SYSTEM = `You research consumer healthcare-cost topics and produce ONE concise,
plain-English entry a patient can act on. Use web_search and cite only real, current
sources (CMS.gov, IRS, state agencies, reputable journalism). Never invent a source or a
rule. Return JSON only:
{"body": "2-4 short paragraphs, plain English, actionable", "jurisdiction": "US federal | Texas | ...", "sources": ["url", ...]}`;

// Research every Learn topic (or a subset) and upsert into learn_content.
async function researchLearnContent(topics = LEARN_TOPICS) {
  await ensureLearnTable();
  const client = getClient();
  const done = [];
  for (const t of topics) {
    try {
      const resp = await client.beta.messages.toolRunner({
        model: MODEL,
        max_tokens: 1500,
        system: LEARN_SYSTEM,
        tools: [{ type: 'web_search_20260209', name: 'web_search' }],
        messages: [{ role: 'user', content: `Topic: ${t.title}\n${t.prompt}` }],
      });
      const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      let parsed;
      try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)[0]); } catch (_) { parsed = { body: text, sources: [] }; }
      await upsertLearnEntry({
        category: t.category,
        title: t.title,
        body: parsed.body || text,
        jurisdiction: parsed.jurisdiction || 'US federal',
        sources: parsed.sources || [],
      });
      done.push(t.title);
    } catch (e) {
      console.error(`[indy] learn research failed for "${t.title}":`, e.message);
    }
  }
  return done;
}

module.exports = { findStories, researchLearnContent, ensureStoriesTable, LEARN_TOPICS };
