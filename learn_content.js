// learn_content.js — storage + serving for the FREE PUBLIC Learn tab on the Replit UI.
//
// Two consumer questions the Learn page answers:
//   - "How do I get a lower price?"  -> category = 'lower_price'
//   - "What rules do I fall under?"  -> category = 'your_rights'
// Indy (indy_agent.researchLearnContent) populates these entries, each grounded in real
// cited sources. The public GET /learn/content endpoint (server.js) serves them to the
// Replit page — no auth, this is the free awareness layer.

const { pool } = require('./db');

async function ensureLearnTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS learn_content (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL,        -- 'lower_price' | 'your_rights'
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      jurisdiction TEXT,            -- 'US federal' | 'Texas' | ...
      sources JSONB DEFAULT '[]'::jsonb,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (category, title)
    )
  `);
}

// Insert or update by (category, title) so re-running research refreshes rather than
// duplicates. Content changes are tracked by updated_at.
async function upsertLearnEntry({ category, title, body, jurisdiction, sources }) {
  await ensureLearnTable();
  await pool.query(
    `INSERT INTO learn_content (category, title, body, jurisdiction, sources, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (category, title)
     DO UPDATE SET body = EXCLUDED.body, jurisdiction = EXCLUDED.jurisdiction,
                   sources = EXCLUDED.sources, updated_at = NOW()`,
    [category, title, body, jurisdiction || null, JSON.stringify(sources || [])]
  );
}

async function getLearnContent(category) {
  await ensureLearnTable();
  const rows = category
    ? await pool.query(`SELECT category, title, body, jurisdiction, sources, updated_at FROM learn_content WHERE category = $1 ORDER BY title`, [category])
    : await pool.query(`SELECT category, title, body, jurisdiction, sources, updated_at FROM learn_content ORDER BY category, title`);
  return rows.rows;
}

module.exports = { ensureLearnTable, upsertLearnEntry, getLearnContent };
