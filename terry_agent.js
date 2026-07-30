// terry_agent.js — "Terry," the POSTING agent.
//
// Terry takes stories Indy found (and you approved) and publishes them. Two steps:
//   1) draftPost(story)  — Haiku writes the actual social copy from the story.
//   2) postApproved()    — for every story you approved, ensure a draft exists, then
//                          publish it via Buffer, and mark the story posted.
//
// IMPORTANT — Buffer is NOT connected to this session. postToBuffer() is a stub that
// throws until you authorize a Buffer connector. Until then, Terry produces the finished
// post text and stores it (status stays 'approved', not 'posted'), so nothing silently
// fails and nothing gets posted without a real integration. Same for Higgsfield video —
// generateVideo() is a stub for when that connector exists.

require('dotenv').config();
const { pool } = require('./db');
const llm = require('./llm');
const AnthropicPkg = require('@anthropic-ai/sdk');
const Anthropic = AnthropicPkg.default || AnthropicPkg;

// Copywriting from given material — the free/cheap provider (llm.js) does this
// for $0 when configured; Anthropic Haiku is only the fallback.
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM = `You write short social posts (Twitter/X + LinkedIn) for Hosparent, a
healthcare price-transparency product. Angle: healthcare billing is confusing by design,
insurance often costs more than shopping cash, and Hosparent shows real prices so patients
compare before they get billed. Pre-registration hook: free for early sign-ups, normally
$4.99/mo. Direct, a little indignant at the status quo, never medical advice, never a
guaranteed personal dollar figure. Given a story, return JSON only:
{"platform":"twitter"|"linkedin","text":"the full post, <=280 chars for twitter","cta":"..."}`;

let _client;
function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic();
  }
  return _client;
}

async function ensurePostQueue() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_queue (
      id SERIAL PRIMARY KEY,
      story_id INT,
      platform TEXT,
      text TEXT NOT NULL,
      cta TEXT,
      status TEXT DEFAULT 'drafted',  -- drafted | posted | failed
      created_at TIMESTAMP DEFAULT NOW(),
      posted_at TIMESTAMP
    )
  `);
}

async function draftPost(story) {
  const material = `${story.headline}\n\n${story.summary || ''}\n\nSource: ${story.source || story.url || ''}`;
  let post;
  if (llm.isConfigured()) {
    try { post = await llm.chatJSON(material, { system: SYSTEM, bulk: true, maxTokens: 400 }); }
    catch (_) { return null; }
  } else {
    const client = getClient();
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: material }],
    });
    const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    try { post = JSON.parse(text.match(/\{[\s\S]*\}/)[0]); } catch (_) { return null; }
  }
  if (!post || !post.text) return null;

  await ensurePostQueue();
  const r = await pool.query(
    `INSERT INTO post_queue (story_id, platform, text, cta, status)
     VALUES ($1,$2,$3,$4,'drafted') RETURNING id`,
    [story.id || null, post.platform || 'twitter', post.text, post.cta || null]
  );
  return { id: r.rows[0].id, ...post };
}

// Stub — wire to the real Buffer MCP tool once that connector is authorized in this
// session. Until then this throws so postApproved() leaves the item 'drafted', not
// falsely 'posted'.
async function postToBuffer(_post) {
  throw new Error('Buffer is not connected to this session yet — authorize a Buffer connector, then wire postToBuffer().');
}

// Stub — Higgsfield video generation, for when that connector exists.
async function generateVideo(_story) {
  throw new Error('Higgsfield is not connected to this session yet — authorize it, then wire generateVideo().');
}

// For every approved story: draft a post (if not already), try to publish. Returns a
// summary. With Buffer unconnected, drafts are produced and stored, publish is skipped.
async function postApproved() {
  await ensurePostQueue();
  const approved = await pool.query(`SELECT id, headline, summary, source, url FROM stories WHERE status = 'approved' ORDER BY created_at`);
  const results = [];
  for (const story of approved.rows) {
    let draft = await pool.query(`SELECT id, platform, text, cta FROM post_queue WHERE story_id = $1 ORDER BY created_at DESC LIMIT 1`, [story.id]);
    let d = draft.rows[0];
    if (!d) d = await draftPost(story);
    if (!d) { results.push({ story_id: story.id, ok: false, reason: 'draft failed' }); continue; }

    try {
      await postToBuffer(d);
      await pool.query(`UPDATE post_queue SET status='posted', posted_at=NOW() WHERE id=$1`, [d.id]);
      await pool.query(`UPDATE stories SET status='posted', posted_at=NOW() WHERE id=$1`, [story.id]);
      results.push({ story_id: story.id, ok: true, posted: true, text: d.text });
    } catch (e) {
      // Expected until Buffer is connected — keep the finished draft, don't mark posted.
      results.push({ story_id: story.id, ok: true, posted: false, reason: e.message, draft: d.text });
    }
  }
  return results;
}

module.exports = { draftPost, postApproved, postToBuffer, generateVideo, ensurePostQueue };
