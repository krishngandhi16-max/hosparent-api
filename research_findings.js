// research_findings.js — where Tracy (the healthcare-finance agent) files the
// sourced research he gathers: CMS/KFF/GAO reports, negotiated-rate observations,
// Medicare payment benchmarks, policy analyses, academic studies.
//
// Same grounding rule as court_decisions.js: every row REQUIRES a real source_url,
// and upsertFinding refuses anything without one. Tracy interprets the numbers with
// a finance lens (the `detail` field), but the underlying facts must be sourced —
// nothing model-invented. Isolated table; writing here never touches price data.
// Served read-only via GET /learn/research.

const { pool } = require('./db');

function slugify(s, extra) {
  const base = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
  const tag = String(extra || '').match(/\d{4}/)?.[0] || '';
  return tag ? `${base}-${tag}` : base;
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS research_findings (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      topic TEXT,                          -- 'negotiated-rates'|'medicare-payment'|'policy'|'benchmark'|'study'|...
      title TEXT NOT NULL,
      summary TEXT,                        -- the finding, plainly
      detail TEXT,                         -- Tracy's healthcare-finance interpretation
      key_figures JSONB DEFAULT '[]'::jsonb, -- e.g. [{"label":"median negotiated","value":"$876"}]
      publisher TEXT,                      -- CMS, KFF, GAO, a journal, etc.
      published_date TEXT,
      source_title TEXT,
      source_url TEXT NOT NULL,            -- REQUIRED — the fetched proof
      tags JSONB DEFAULT '[]'::jsonb,
      verified BOOLEAN DEFAULT FALSE,
      added_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
}

async function upsertFinding(f = {}) {
  await ensureTable();
  const url = String(f.source_url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { saved: false, title: f.title || '(untitled)', reason: 'missing/invalid source_url — refused (facts must be sourced)' };
  }
  if (!f.title || String(f.title).trim().length < 3) {
    return { saved: false, title: f.title || '(untitled)', reason: 'missing title' };
  }
  const slug = slugify(f.title, f.published_date);
  await pool.query(
    `INSERT INTO research_findings
       (slug, topic, title, summary, detail, key_figures, publisher, published_date,
        source_title, source_url, tags, verified, added_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT (slug) DO UPDATE SET
       topic=EXCLUDED.topic, title=EXCLUDED.title, summary=EXCLUDED.summary,
       detail=EXCLUDED.detail, key_figures=EXCLUDED.key_figures, publisher=EXCLUDED.publisher,
       published_date=EXCLUDED.published_date, source_title=EXCLUDED.source_title,
       source_url=EXCLUDED.source_url, tags=EXCLUDED.tags, verified=EXCLUDED.verified,
       added_by=EXCLUDED.added_by, updated_at=NOW()`,
    [slug, f.topic || null, String(f.title).trim(), f.summary || null, f.detail || null,
     JSON.stringify(Array.isArray(f.key_figures) ? f.key_figures : []), f.publisher || null,
     f.published_date || null, f.source_title || null, url,
     JSON.stringify(Array.isArray(f.tags) ? f.tags : []), f.verified === true, f.added_by || 'tracy']
  );
  return { saved: true, slug, title: String(f.title).trim() };
}

async function getFindings(topic) {
  await ensureTable();
  const q = topic
    ? await pool.query(`SELECT * FROM research_findings WHERE topic = $1 ORDER BY updated_at DESC, id DESC`, [topic])
    : await pool.query(`SELECT * FROM research_findings ORDER BY updated_at DESC, id DESC`);
  return q.rows;
}

module.exports = { ensureTable, upsertFinding, getFindings, slugify };
