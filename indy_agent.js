// indy_agent.js — "Indy," the marketing agent.
//
// Job: turn Terry's research notes + the Insurance Watchdog news feed + real savings
// numbers from our own DB into ready-to-post ad copy. Writes drafts to the ad_queue
// table with status='draft' — a human (or Buffer, once connected) approves and posts.
//
// IMPORTANT — what this does NOT do yet:
//   - Does not post to Buffer. No Buffer MCP connector is attached to this session.
//     Once you connect it (claude.ai connector settings, or `claude mcp add` for a
//     non-claude.ai server), wire postToBuffer() below to the real tool call.
//   - Does not generate images/video via Higgsfield. Same story — not connected. Once
//     it is, generateCreative() is the place to call it, keyed off each draft's `angle`.
// Until then, Indy produces text ad drafts you can post manually, and the queue is
// ready to plug a real integration into the moment you have one.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
const AnthropicPkg = require('@anthropic-ai/sdk');
const Anthropic = AnthropicPkg.default || AnthropicPkg;

const MODEL = 'claude-haiku-4-5-20251001'; // copy generation from already-researched material — cheap tier is fine
const VAULT_DIR = process.env.TERRY_VAULT_DIR || path.join(__dirname, 'obsidian_vault');

const SYSTEM_PROMPT = `You write short-form social ad copy (Twitter/X and LinkedIn) for
Hosparent, a healthcare price-transparency product. The pitch: healthcare billing is
confusing by design, insurance often costs more than shopping cash-pay for the same
procedure, and Hosparent shows real prices across hospitals, surgery centers, and imaging
centers so patients can compare before they get billed.

Pre-registration hook: free for early sign-ups, normally $4.99/month.

Voice: direct, a little indignant about the status quo, never medical-advice-y, never
guarantees a specific dollar savings for the reader personally — only cites real aggregate
numbers you're given.

For each input (a research note, a news story, or a savings stat), produce ONE ad as JSON:
{ "platform": "twitter"|"linkedin", "headline": "...", "body": "...", "cta": "...", "angle": "..." }
angle is a short label like "pos-code-confusion" or "insurance-denial-story" or "cash-savings-proof".
Output ONLY the JSON object.`;

let _client;
function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic();
  }
  return _client;
}

async function ensureAdQueueTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_queue (
      id SERIAL PRIMARY KEY,
      platform TEXT NOT NULL,
      headline TEXT NOT NULL,
      body TEXT NOT NULL,
      cta TEXT,
      angle TEXT,
      source_material TEXT,
      status TEXT DEFAULT 'draft',
      created_at TIMESTAMP DEFAULT NOW(),
      posted_at TIMESTAMP
    )
  `);
}

async function draftAd(sourceText, sourceLabel) {
  const client = getClient();
  const result = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: sourceText.slice(0, 4000) }],
  });
  const text = (result.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  let ad;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    ad = match ? JSON.parse(match[0]) : null;
  } catch (_) {
    ad = null;
  }
  if (!ad) return null;

  await ensureAdQueueTable();
  await pool.query(
    `INSERT INTO ad_queue (platform, headline, body, cta, angle, source_material, status)
     VALUES ($1,$2,$3,$4,$5,$6,'draft')`,
    [ad.platform || 'twitter', ad.headline, ad.body, ad.cta || null, ad.angle || null, sourceLabel]
  );
  return ad;
}

// Pull material from Terry's vault + the DB and draft a batch of ads. Capped by `limit`
// since each draft is one Haiku call — cheap, but still real spend at scale.
async function generateAdBatch(limit = 5) {
  const drafted = [];

  // Source 1: Terry's research notes (problem-awareness angle)
  let noteFiles = [];
  try {
    noteFiles = fs.readdirSync(VAULT_DIR).filter((f) => f.endsWith('.md'));
  } catch (_) { /* vault doesn't exist yet — run terry_agent first */ }

  for (const file of noteFiles.slice(0, limit)) {
    const content = fs.readFileSync(path.join(VAULT_DIR, file), 'utf8');
    const ad = await draftAd(content, `terry:${file}`);
    if (ad) drafted.push(ad);
    if (drafted.length >= limit) return drafted;
  }

  // Source 2: recent insurance news (outrage/awareness angle)
  if (drafted.length < limit) {
    const news = await pool.query(
      `SELECT headline, summary, source, url FROM insurance_news ORDER BY fetched_at DESC LIMIT $1`,
      [limit - drafted.length]
    ).catch(() => ({ rows: [] }));
    for (const story of news.rows) {
      const ad = await draftAd(`${story.headline}\n\n${story.summary || ''}\n\nSource: ${story.source || story.url || ''}`, `watchdog-news:${story.headline}`);
      if (ad) drafted.push(ad);
      if (drafted.length >= limit) break;
    }
  }

  return drafted;
}

async function getDraftQueue(limit = 20) {
  await ensureAdQueueTable();
  const r = await pool.query(
    `SELECT id, platform, headline, body, cta, angle, source_material, status, created_at
     FROM ad_queue WHERE status = 'draft' ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return r.rows;
}

// Stub — wire this to the real Buffer MCP tool once it's connected to this session
// (claude.ai connector settings, or `claude mcp add buffer ...`). Marks the row posted
// so getDraftQueue() won't return it again.
async function postToBuffer(_adId) {
  throw new Error('Buffer MCP is not connected to this session yet — connect it, then wire this function to the real tool call.');
}

module.exports = { generateAdBatch, getDraftQueue, draftAd, postToBuffer, ensureAdQueueTable };
