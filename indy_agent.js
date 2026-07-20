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
const perplexity = require('./perplexity');
const AnthropicPkg = require('@anthropic-ai/sdk');
const Anthropic = AnthropicPkg.default || AnthropicPkg;

// Research backend: Perplexity (official API) when PERPLEXITY_API_KEY is set —
// purpose-built for cited web research and cheaper than Opus. Claude Opus +
// web_search is the fallback so nothing breaks without the key.
const MODEL = 'claude-opus-4-8'; // fallback research model; bounded to once-daily batches

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

// Perplexity-backed story research. Uses the Search API first — it returns REAL
// articles (title/url/snippet/date), so URLs can never be hallucinated. Falls
// back to a research() JSON call if the search endpoint errors.
async function findStoriesViaPerplexity(n) {
  try {
    const results = await perplexity.search(
      'health insurance claim denial OR surprise hospital bill OR hospital price gouging OR price transparency violation news',
      { maxResults: Math.max(n * 2, 8), maxTokensPerPage: 200 }
    );
    // Freshness gate: only DATED results from the last 60 days qualify. Stale or
    // undated articles never become posts — if nothing fresh, fall through to the
    // research() path below instead.
    const cutoff = Date.now() - 60 * 24 * 3600 * 1000;
    const fresh = results.filter((r) => r.url && r.title && r.date && new Date(r.date).getTime() >= cutoff);
    if (fresh.length) {
      return {
        stories: fresh.slice(0, n).map((r) => ({
          headline: r.title,
          summary: (r.snippet || '').slice(0, 400),
          source: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch (_) { return null; } })(),
          url: r.url,
        })),
      };
    }
  } catch (e) {
    console.error('[indy] perplexity search failed, falling back to research():', e.message);
  }
  const { text, citations } = await perplexity.research(
    `Find ${n} recent (last 30 days) US news stories about health-insurance or hospital-billing practices that hurt patients — claim denials, surprise bills, price gouging, transparency violations. Real, citable stories only.`,
    {
      system: `Return STRICT JSON only, no prose: {"stories":[{"headline":"...","summary":"1-2 sentences","source":"outlet name","url":"https://..."}]}. Only include stories you found via search with a real URL. Never invent a story or URL.`,
    }
  );
  let parsed;
  try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)[0]); } catch (_) { parsed = { stories: [] }; }
  const stories = (parsed.stories || []).map((s, i) => ({
    ...s,
    url: s.url || citations[i] || null,
  }));
  return { stories };
}

// Find N stories and store them as status='found'. De-dupes on headline so the same
// story isn't queued twice across days.
async function findStories(n = 5) {
  await ensureStoriesTable();
  const { stories } = perplexity.isConfigured()
    ? await findStoriesViaPerplexity(n)
    : await findInsuranceNews();
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
rule.

ACCURACY BAR (this content is shown to clinicians — it must hold up to checking):
- Every specific number (a dollar amount, percentage, deadline, date) must come from one
  of your cited sources. If you cannot verify a number, LEAVE IT OUT — an entry with no
  number is fine; an entry with a wrong number is not.
- State rules as they are written in the source, including who they apply to and when
  they do NOT apply. No generalizations beyond what the source says.
- If sources conflict or a rule is unsettled, say so rather than picking one.

Return JSON only:
{"body": "2-4 short paragraphs, plain English, actionable", "jurisdiction": "US federal | Texas | ...", "sources": ["url", ...]}`;

// Research one Learn topic. Perplexity when configured (search-grounded with
// citations built in), Claude Opus + web_search otherwise.
async function researchOneTopic(t) {
  const userPrompt = `Topic: ${t.title}\n${t.prompt}`;
  if (perplexity.isConfigured()) {
    const { text, citations } = await perplexity.research(userPrompt, { system: LEARN_SYSTEM });
    let parsed;
    try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)[0]); } catch (_) { parsed = { body: text, sources: [] }; }
    // Perplexity returns its search citations even when the JSON omits them.
    const sources = (parsed.sources && parsed.sources.length ? parsed.sources : citations) || [];
    return { body: parsed.body || text, jurisdiction: parsed.jurisdiction, sources };
  }
  const resp = await getClient().beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 1500,
    system: LEARN_SYSTEM,
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  let parsed;
  try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)[0]); } catch (_) { parsed = { body: text, sources: [] }; }
  return { body: parsed.body || text, jurisdiction: parsed.jurisdiction, sources: parsed.sources || [] };
}

// Research every Learn topic (or a subset) and upsert into learn_content.
async function researchLearnContent(topics = LEARN_TOPICS) {
  await ensureLearnTable();
  const done = [];
  for (const t of topics) {
    try {
      const r = await researchOneTopic(t);
      // Hard accuracy gate: an entry with no real sources never reaches the
      // public tab. Better a missing entry than an unverifiable one.
      if (!r.sources || !r.sources.length) {
        console.error(`[indy] SKIPPED "${t.title}" — research returned no sources, not publishing unverified content.`);
        continue;
      }
      await upsertLearnEntry({
        category: t.category,
        title: t.title,
        body: r.body,
        jurisdiction: r.jurisdiction || 'US federal',
        sources: r.sources,
      });
      done.push(t.title);
    } catch (e) {
      console.error(`[indy] learn research failed for "${t.title}":`, e.message);
    }
  }
  return done;
}

module.exports = { findStories, researchLearnContent, ensureStoriesTable, LEARN_TOPICS };
