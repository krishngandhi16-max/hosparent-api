// llm.js — ONE client for cheap/free LLM providers, so nothing in Hosparent is
// hard-wired to a paid Anthropic key.
//
// Every provider here speaks the same OpenAI-compatible /chat/completions API,
// so switching is one env var — no code changes anywhere else:
//
//   provider    key env             free tier (verified Jul 2026)
//   ─────────   ─────────────────   ──────────────────────────────────────────
//   groq        GROQ_API_KEY        llama-3.3-70b: 1K req/day free, no card.
//                                   llama-3.1-8b: 14.4K req/day free.
//   gemini      GEMINI_API_KEY      Flash: ~250-1500 req/day free, no card.
//                                   Flash-Lite paid is $0.10/M in, $0.40/M out.
//   deepseek    DEEPSEEK_API_KEY    5M free tokens for new accounts, then
//                                   ~$0.14/M in, $0.28/M out (V4 Flash).
//   openrouter  OPENROUTER_API_KEY  50 free req/day (1K/day after a one-time
//                                   $10 credit purchase). Many :free models.
//   kimi        MOONSHOT_API_KEY    No API free tier ($1 min). K2.5 $0.60/$3.00.
//   ollama      (none)              100% free, runs on your own PC. Install
//                                   from ollama.com, `ollama pull llama3.1:8b`.
//
// Setup: set ONE of the key envs above in .env — the provider is auto-detected.
// Optional overrides: LLM_PROVIDER, LLM_MODEL, LLM_MODEL_BULK, LLM_BASE_URL.
//
// When no provider is configured, isConfigured() is false and callers fall back
// to the Anthropic path — nothing breaks, it just costs money again.

require('dotenv').config();

const PROVIDERS = {
  groq: {
    base: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    model: 'llama-3.3-70b-versatile', // smart tier: office chat, diagnosis
    bulk: 'llama-3.1-8b-instant',     // bulk tier: classification, drafting
  },
  gemini: {
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    model: 'gemini-2.5-flash',
    bulk: 'gemini-2.5-flash-lite',
  },
  deepseek: {
    base: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    model: 'deepseek-chat',
    bulk: 'deepseek-chat',
  },
  openrouter: {
    base: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    // OpenRouter's auto-router picks a free model that supports what the
    // request needs (tool calling, JSON) and survives free-model rotation.
    model: 'openrouter/free',
    bulk: 'openrouter/free',
  },
  kimi: {
    base: 'https://api.moonshot.ai/v1',
    keyEnv: 'MOONSHOT_API_KEY',
    model: 'kimi-k2.5',
    bulk: 'kimi-k2.5',
  },
  ollama: {
    base: 'http://localhost:11434/v1',
    keyEnv: null, // local — no key
    model: 'llama3.1:8b',
    bulk: 'llama3.1:8b',
  },
};

const AUTO_ORDER = ['groq', 'gemini', 'deepseek', 'openrouter', 'kimi'];

function resolve() {
  let name = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  if (!name) {
    name = AUTO_ORDER.find((p) => process.env[PROVIDERS[p].keyEnv]) || '';
  }
  if (!name || !PROVIDERS[name]) return null;
  const p = PROVIDERS[name];
  const key = process.env.LLM_API_KEY || (p.keyEnv ? process.env[p.keyEnv] : 'ollama');
  if (!key) return null;
  return {
    provider: name,
    base: process.env.LLM_BASE_URL || p.base,
    key,
    model: process.env.LLM_MODEL || p.model,
    bulkModel: process.env.LLM_MODEL_BULK || p.bulk,
  };
}

function isConfigured() {
  return resolve() !== null;
}

function describe() {
  const c = resolve();
  return c ? `${c.provider}/${c.model}` : '(not configured)';
}

// Raw chat-completions call with retry on 429/5xx (free tiers rate-limit; we
// wait and retry instead of dying, so long jobs survive on $0 plans).
async function chat(messages, opts = {}) {
  const c = resolve();
  if (!c) throw new Error('No LLM provider configured. Set GROQ_API_KEY (or GEMINI_API_KEY / DEEPSEEK_API_KEY / OPENROUTER_API_KEY) in .env — see CHEAP_SETUP.md');

  const body = {
    model: opts.model || (opts.bulk ? c.bulkModel : c.model),
    max_tokens: opts.maxTokens || 1024,
    messages: opts.system ? [{ role: 'system', content: opts.system }, ...messages] : messages,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.tools) { body.tools = opts.tools; body.tool_choice = opts.toolChoice || 'auto'; }

  const maxTries = opts.maxTries || 5;
  for (let attempt = 1; ; attempt++) {
    const resp = await fetch(`${c.base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs || 120000),
    });
    if (resp.ok) {
      const data = await resp.json();
      const msg = data.choices?.[0]?.message || {};
      return { text: msg.content || '', toolCalls: msg.tool_calls || [], raw: data, model: data.model || body.model };
    }
    const errBody = await resp.text().catch(() => '');
    const retryable = resp.status === 429 || resp.status >= 500;
    if (!retryable || attempt >= maxTries) {
      throw new Error(`${c.provider} API ${resp.status}: ${errBody.slice(0, 300)}`);
    }
    // Respect Retry-After when present; otherwise exponential backoff 5s→80s.
    const ra = Number(resp.headers.get('retry-after'));
    const waitMs = (Number.isFinite(ra) && ra > 0 ? ra : 5 * 2 ** (attempt - 1)) * 1000;
    console.log(`  [llm] ${c.provider} ${resp.status} — retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${maxTries})`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

// One-shot prompt → plain text.
async function chatText(prompt, opts = {}) {
  const { text } = await chat([{ role: 'user', content: String(prompt) }], opts);
  return text;
}

// One-shot prompt → parsed JSON object (extracts the first {...} or [...] block).
async function chatJSON(prompt, opts = {}) {
  const text = await chatText(prompt, opts);
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  if (!m) throw new Error(`model returned no JSON: ${text.slice(0, 200)}`);
  return JSON.parse(m[0]);
}

/**
 * Agentic tool loop over OpenAI-style function calling — the cheap-provider
 * replacement for Anthropic's toolRunner. Tools are plain objects:
 *   { name, description, input_schema, run: async (args) => string }
 * Loops until the model answers in text or maxRounds is hit.
 */
async function runToolLoop({ system, messages, tools, model, maxRounds = 12, maxTokens = 4096 }) {
  const openaiTools = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const convo = [...messages];

  for (let round = 1; round <= maxRounds; round++) {
    const { text, toolCalls, raw } = await chat(convo, { system, tools: openaiTools, model, maxTokens });
    if (!toolCalls.length) return { text, rounds: round };

    convo.push(raw.choices[0].message);
    for (const call of toolCalls) {
      const tool = byName[call.function?.name];
      let result;
      try {
        const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        result = tool ? await tool.run(args) : `ERROR: unknown tool "${call.function?.name}"`;
      } catch (e) {
        result = `ERROR: ${e.message}`;
      }
      convo.push({
        role: 'tool',
        tool_call_id: call.id,
        content: String(result ?? '').slice(0, 24000),
      });
    }
  }
  return { text: '(stopped: too many tool rounds — try a more specific question)', rounds: maxRounds };
}

module.exports = { isConfigured, describe, resolve, chat, chatText, chatJSON, runToolLoop };
