// learn_reference.js — structured, sourced patient-protection content for the
// Learn tab: the laws and rights that benefit patients, each with a citation,
// effective date, plain-language summary, "how to use it," and REAL sources.
//
// This is separate from learn_content (free-form prose from Indy) because the
// Learn tab renders these as structured cards (law name / year / penalty /
// bullets / action / sources). Seeded by seed_learn_research.js from verified
// government + primary sources — nothing here is model-invented. Served read-only
// via GET /learn/reference.

const { pool } = require('./db');

async function ensureReferenceTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS learn_reference (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL,              -- 'law' | 'right' | 'tactic'
      slug TEXT UNIQUE NOT NULL,       -- stable id so re-seeding updates, not duplicates
      title TEXT NOT NULL,
      jurisdiction TEXT,               -- 'US federal' | 'Texas'
      effective_date TEXT,
      citation TEXT,
      penalty TEXT,
      summary TEXT,
      detail TEXT,
      bullets JSONB DEFAULT '[]'::jsonb,
      action TEXT,                     -- how a patient uses it to their advantage
      sources JSONB DEFAULT '[]'::jsonb,
      sort_order INT DEFAULT 100,
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
}

async function upsertReference(e) {
  await ensureReferenceTable();
  await pool.query(
    `INSERT INTO learn_reference
       (kind, slug, title, jurisdiction, effective_date, citation, penalty,
        summary, detail, bullets, action, sources, sort_order, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT (slug) DO UPDATE SET
       kind=EXCLUDED.kind, title=EXCLUDED.title, jurisdiction=EXCLUDED.jurisdiction,
       effective_date=EXCLUDED.effective_date, citation=EXCLUDED.citation,
       penalty=EXCLUDED.penalty, summary=EXCLUDED.summary, detail=EXCLUDED.detail,
       bullets=EXCLUDED.bullets, action=EXCLUDED.action, sources=EXCLUDED.sources,
       sort_order=EXCLUDED.sort_order, updated_at=NOW()`,
    [e.kind, e.slug, e.title, e.jurisdiction || null, e.effective_date || null,
     e.citation || null, e.penalty || null, e.summary || null, e.detail || null,
     JSON.stringify(e.bullets || []), e.action || null,
     JSON.stringify(e.sources || []), e.sort_order ?? 100]
  );
}

async function getReference(kind) {
  await ensureReferenceTable();
  const q = kind
    ? await pool.query(`SELECT * FROM learn_reference WHERE kind = $1 ORDER BY sort_order, title`, [kind])
    : await pool.query(`SELECT * FROM learn_reference ORDER BY sort_order, title`);
  return q.rows;
}

module.exports = { ensureReferenceTable, upsertReference, getReference };
