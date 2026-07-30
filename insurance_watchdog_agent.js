// insurance_watchdog_agent.js — the "Learn" sector agent (Opus).
//
// Two jobs, both wrapped in a hard-coded disclaimer that ships in the API response
// itself (not just the system prompt) so it can never be dropped by the model:
//   1) findInsuranceNews()            — surfaces recent, sourced stories about payer
//                                        denial practices, lawsuits, DOJ/state actions.
//                                        Meant to be run on a schedule (refresh_insurance_
//                                        news.js), never live per pageview — keeps Opus +
//                                        web_search cost off the hot path.
//   2) navigatePatientRights(situation) — given a patient's own description of what
//                                        happened (a denial, a surprise bill), researches
//                                        the relevant framework and lays out possible next
//                                        steps. Never a guaranteed outcome, never legal
//                                        representation.
//
// Model: Opus — this is reasoning-heavy, consequential material (get it wrong and a
// patient could miss an appeal deadline), unlike the straightforward DB lookups Hoser
// (db_agent.js) does on Haiku. Called on-demand (news: scheduled; rights: per user query),
// not in a loop, to keep cost bounded.

require('dotenv').config();
const AnthropicPkg = require('@anthropic-ai/sdk');
const Anthropic = AnthropicPkg.default || AnthropicPkg;
const perplexity = require('./perplexity');
const llm = require('./llm');

// Anthropic is the LAST resort — Perplexity (cheap, web-grounded) handles both
// jobs when PERPLEXITY_API_KEY is set. See CHEAP_SETUP.md.
const MODEL = 'claude-opus-4-8';

const DISCLAIMER = `\n\n---\n⚠️ **Not legal or medical advice.** This is general information only. Insurance law varies by state and plan type (employer ERISA plans, ACA marketplace, Medicare, and Medicaid all follow different rules), and outcomes depend on your specific facts. For your situation, talk to a licensed attorney, your state Department of Insurance, or a patient advocate. Hosparent is not a law firm and this is not legal representation.`;

const NEWS_SYSTEM_PROMPT = `You research and summarize recent, verifiable news about health
insurance company practices that affect patients: claim denials, prior-authorization abuse,
surprise billing, DOJ/state investigations, class-action lawsuits, regulatory fines.
Use web_search. Only report stories you can cite with a real source and date — never invent
a story. Return 5-8 stories as a JSON array and nothing else:
[{ "headline": "...", "summary": "...", "source": "...", "date": "...", "url": "..." }]`;

const RIGHTS_SYSTEM_PROMPT = `You help patients understand what options may exist after a
denied claim, a surprise bill, or a coverage dispute. The patient describes their situation
in their own words. Use web_search to ground your answer in the actual current rules (No
Surprises Act, ERISA claims-and-appeals process, ACA marketplace external review,
Medicare/Medicaid appeal rights, relevant CMS regulations, state Department of Insurance
complaint processes).

Rules:
- Identify which framework likely applies (employer plan vs. marketplace vs. Medicare vs.
  Medicaid) based on what the patient says; ask a clarifying question if it's genuinely
  unclear which applies.
- Lay out realistic next steps (internal appeal, external review, state DOI complaint, No
  Surprises Act independent dispute resolution, etc.) as options to look into — never a
  promised outcome.
- Never say "you will win" or "you are entitled to." Say "you may be able to" / "this
  process typically allows."
- Never provide anything that reads as legal representation or a guaranteed result.
- If the situation sounds like it needs a lawyer now (a lawsuit already filed against them,
  an urgent deadline, a very large bill), say so plainly and point them to an attorney or
  their state bar's referral service.`;

let _client;
function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic();
  }
  return _client;
}

async function findInsuranceNews() {
  // Perplexity path: real articles from the Search API (title/url/date are
  // never hallucinated), dated within the last 60 days only.
  if (perplexity.isConfigured()) {
    const results = await perplexity.search(
      'health insurance claim denial OR prior authorization abuse OR surprise billing lawsuit OR DOJ insurer investigation OR state insurance regulator fine',
      { maxResults: 10, maxTokensPerPage: 200 }
    );
    const cutoff = Date.now() - 60 * 24 * 3600 * 1000;
    const stories = results
      .filter((r) => r.url && r.title && r.date && new Date(r.date).getTime() >= cutoff)
      .slice(0, 8)
      .map((r) => ({
        headline: r.title,
        summary: (r.snippet || '').slice(0, 400),
        source: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch (_) { return null; } })(),
        date: r.date,
        url: r.url,
      }));
    return { stories, fetched_at: new Date().toISOString() };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('No research backend configured — add PERPLEXITY_API_KEY to .env (see CHEAP_SETUP.md)');
  }
  const client = getClient();
  const result = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 3072,
    system: NEWS_SYSTEM_PROMPT,
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    messages: [{ role: 'user', content: 'Find recent stories (last 30 days if possible) about health insurance company practices harming patients.' }],
  });
  const text = (result.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  let stories;
  try {
    const match = text.match(/\[[\s\S]*\]/);
    stories = match ? JSON.parse(match[0]) : [];
  } catch (_) {
    stories = [];
  }
  return { stories, fetched_at: new Date().toISOString() };
}

async function navigatePatientRights(situation) {
  // Perplexity path: sonar-pro is web-grounded with citations — right tool for
  // "which rules apply to my situation" and ~100x cheaper than Opus.
  if (perplexity.isConfigured()) {
    const { text } = await perplexity.research(String(situation || '').slice(0, 2000), {
      system: RIGHTS_SYSTEM_PROMPT,
      maxTokens: 1200,
    });
    return { answer: text + DISCLAIMER, model: 'perplexity/' + (process.env.PERPLEXITY_MODEL || 'sonar-pro') };
  }
  // Free-provider fallback (no web grounding, but the federal frameworks are
  // stable knowledge — still far better than a hard error for the public page).
  if (llm.isConfigured()) {
    const text = await llm.chatText(String(situation || '').slice(0, 2000), {
      system: RIGHTS_SYSTEM_PROMPT + '\nYou have no web access — answer from established federal/state frameworks only, and say rules may have changed.',
      maxTokens: 1200,
    });
    return { answer: text + DISCLAIMER, model: llm.describe() };
  }
  const client = getClient();
  const result = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 2048,
    system: RIGHTS_SYSTEM_PROMPT,
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    messages: [{ role: 'user', content: String(situation || '').slice(0, 2000) }],
  });
  const answer = (result.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return { answer: answer + DISCLAIMER, model: MODEL };
}

module.exports = { findInsuranceNews, navigatePatientRights, DISCLAIMER };
