// perplexity.js — OFFICIAL Perplexity API client for research.
//
// Why not github.com/helallao/perplexity-ai: that project reverse-engineers the
// Perplexity web app using account cookies. It violates Perplexity's ToS, breaks
// whenever their frontend changes, and can get the account banned — not something
// to run a business pipeline on. The official API uses the same Sonar online
// models, is stable, and is cheap at our volume (once-daily research batches).
//
// Setup: put PERPLEXITY_API_KEY in .env (get one at perplexity.ai → Settings → API).
// Optional: PERPLEXITY_MODEL (default 'sonar-pro'; 'sonar' is the cheaper tier).
//
// When the key is missing, isConfigured() is false and callers fall back to the
// existing Claude + web_search path — nothing breaks without it.

require('dotenv').config();

const API_URL = 'https://api.perplexity.ai/chat/completions';
const DEFAULT_MODEL = process.env.PERPLEXITY_MODEL || 'sonar-pro';

function isConfigured() {
  return Boolean(process.env.PERPLEXITY_API_KEY);
}

/**
 * Ask Perplexity a research question. Sonar models search the web on every call
 * and return citations, so answers are grounded in current sources by default.
 * @param {string} prompt        the research question
 * @param {object} [opts]
 * @param {string} [opts.system] system prompt (tone/format instructions)
 * @param {string} [opts.model]  override model
 * @param {number} [opts.maxTokens]
 * @returns {Promise<{text: string, citations: string[], model: string}>}
 */
async function research(prompt, opts = {}) {
  if (!isConfigured()) throw new Error('PERPLEXITY_API_KEY is not set');

  const messages = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: String(prompt) });

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model || DEFAULT_MODEL,
      max_tokens: opts.maxTokens || 1500,
      messages,
    }),
    signal: AbortSignal.timeout(90000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Perplexity API ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';

  // Citations come back top-level as `citations` (array of URL strings) or, in
  // newer responses, `search_results` (array of {title, url}). Handle both.
  let citations = [];
  if (Array.isArray(data.citations)) citations = data.citations.filter(Boolean);
  else if (Array.isArray(data.search_results)) {
    citations = data.search_results.map((r) => r && r.url).filter(Boolean);
  }

  return { text, citations, model: data.model || opts.model || DEFAULT_MODEL };
}

module.exports = { isConfigured, research, DEFAULT_MODEL };
