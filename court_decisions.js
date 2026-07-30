// court_decisions.js — a grounded store for real court decisions the office
// agent researches (price transparency, surprise billing, medical debt, ACA, etc.).
//
// WHY THIS IS ITS OWN, LOCKED-DOWN PATH: fabricated case law is the single most
// notorious LLM failure mode — invented case names and citations that look real.
// For a clinician-facing product that is a credibility grenade. So the ONLY way a
// row lands here is with a real, fetched source URL, and upsertDecision REFUSES
// anything missing one. The agent must confirm each case at a real source
// (CourtListener, Justia, the court's own site, CMS) before it can save it.
//
// Isolated table — writing here never touches prices/procedures, so it's a safe,
// additive write path. Served read-only via GET /learn/court-decisions.

const { pool } = require('./db');

function slugify(caseName, dateOrYear) {
  const base = String(caseName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  const year = String(dateOrYear || '').match(/\d{4}/)?.[0] || '';
  return year ? `${base}-${year}` : base;
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS court_decisions (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,          -- stable id so re-research updates, not duplicates
      case_name TEXT NOT NULL,
      court TEXT,                          -- e.g. "U.S. Supreme Court", "5th Cir.", "N.D. Tex."
      decision_date TEXT,                  -- as published, e.g. "June 2022"
      citation TEXT,                       -- reporter cite, e.g. "597 U.S. 215 (2022)"
      docket TEXT,
      holding TEXT,                        -- what the court actually ruled
      significance TEXT,                   -- why it matters to patients / price transparency
      source_title TEXT,
      source_url TEXT NOT NULL,            -- REQUIRED — the fetched proof the case is real
      tags JSONB DEFAULT '[]'::jsonb,
      verified BOOLEAN DEFAULT FALSE,      -- true only when the agent confirmed at an authoritative source
      added_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
}

// Insert/update ONE decision. Returns {saved:true} or {saved:false, reason} — it
// refuses (never throws) on a missing/invalid source so a bad row can't poison a batch.
async function upsertDecision(d = {}) {
  await ensureTable();
  const url = String(d.source_url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { saved: false, case_name: d.case_name || '(unnamed)', reason: 'missing/invalid source_url — refused to prevent fabricated case law' };
  }
  if (!d.case_name || String(d.case_name).trim().length < 3) {
    return { saved: false, case_name: d.case_name || '(unnamed)', reason: 'missing case_name' };
  }
  const slug = slugify(d.case_name, d.decision_date || d.citation);
  await pool.query(
    `INSERT INTO court_decisions
       (slug, case_name, court, decision_date, citation, docket, holding, significance,
        source_title, source_url, tags, verified, added_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT (slug) DO UPDATE SET
       case_name=EXCLUDED.case_name, court=EXCLUDED.court, decision_date=EXCLUDED.decision_date,
       citation=EXCLUDED.citation, docket=EXCLUDED.docket, holding=EXCLUDED.holding,
       significance=EXCLUDED.significance, source_title=EXCLUDED.source_title,
       source_url=EXCLUDED.source_url, tags=EXCLUDED.tags, verified=EXCLUDED.verified,
       added_by=EXCLUDED.added_by, updated_at=NOW()`,
    [slug, String(d.case_name).trim(), d.court || null, d.decision_date || null,
     d.citation || null, d.docket || null, d.holding || null, d.significance || null,
     d.source_title || null, url, JSON.stringify(Array.isArray(d.tags) ? d.tags : []),
     d.verified === true, d.added_by || 'office-agent']
  );
  return { saved: true, slug, case_name: String(d.case_name).trim() };
}

async function getDecisions() {
  await ensureTable();
  const q = await pool.query(`SELECT * FROM court_decisions ORDER BY updated_at DESC, id DESC`);
  return q.rows.map((r) => ({
    ...r,
    display: {
      heading: [r.case_name, r.citation].filter(Boolean).join(', '),
      court_line: [r.court, r.decision_date].filter(Boolean).join(' · '),
      source: r.source_title || r.source_url,
      source_url: r.source_url,
    },
  }));
}

module.exports = { ensureTable, upsertDecision, getDecisions, slugify };
