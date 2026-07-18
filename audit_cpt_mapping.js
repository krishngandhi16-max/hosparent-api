#!/usr/bin/env node
// audit_cpt_mapping.js — whole-database CPT mapping auditor + fixer.
//
// The colonoscopy bug (a "Colonoscopy with Biopsy" row tagged 45378 instead of 45380)
// is not unique — it can exist anywhere a scraped procedure description was mapped to
// the wrong CPT code. You can't eyeball tens of thousands of rows, so this does it for
// the whole DB in three safety tiers:
//
//   1. RULE tier (free, deterministic): a keyword→CPT table of unambiguous, well-known
//      mappings (biopsy during colonoscopy = 45380, etc.). High confidence.
//   2. LLM tier (--llm, cheap Haiku): for the remaining DISTINCT (name, code) pairs,
//      asks Haiku "does this code fit this description; if clearly not, what's correct?"
//      Biased hard toward leaving things alone — only flags clear mismatches.
//   3. REVIEW: everything the LLM is unsure about lands in cpt_recode_proposals for a
//      human, never auto-applied.
//
// Reversibility: the FIRST recode of any row copies its original code into
// procedures.cpt_code_original, so nothing is ever lost and any change can be reverted.
//
// Usage:
//   node audit_cpt_mapping.js                 # report only, changes nothing
//   node audit_cpt_mapping.js --llm           # + Haiku classification of distinct pairs
//   node audit_cpt_mapping.js --apply         # apply RULE-tier high-confidence fixes
//   node audit_cpt_mapping.js --llm --apply   # apply RULE + high-confidence LLM fixes
require('dotenv').config();
const { pool } = require('./db');

const APPLY = process.argv.includes('--apply');
const USE_LLM = process.argv.includes('--llm');

// Unambiguous, standard CPT rules. Each: if the description matches `pattern` AND the
// row is NOT already this code, it's very likely miscoded. Expand this table freely —
// every entry here is a rule you never have to pay an LLM to re-derive.
const RULES = [
  { pattern: /colonoscop.*(biopsy|with biopsy)/i,          cpt: '45380', label: 'colonoscopy w/ biopsy' },
  { pattern: /colonoscop.*(polyp|snare|polypectomy)/i,     cpt: '45385', label: 'colonoscopy w/ polyp removal (snare)' },
  { pattern: /colonoscop.*hot biopsy/i,                    cpt: '45384', label: 'colonoscopy w/ hot biopsy forceps' },
  { pattern: /colonoscop.*(screening|diagnostic)/i,        cpt: '45378', label: 'colonoscopy diagnostic/screening' },
  { pattern: /egd.*biopsy|upper endoscop.*biopsy/i,        cpt: '43239', label: 'EGD w/ biopsy' },
  { pattern: /upper endoscop.*(diagnostic)?$|^egd$/i,      cpt: '43235', label: 'EGD diagnostic' },
];

function ruleMatch(name) {
  const text = String(name || '');
  for (const r of RULES) if (r.pattern.test(text)) return r;
  return null;
}

async function ensureColumns() {
  try { await pool.query(`ALTER TABLE procedures ADD COLUMN IF NOT EXISTS cpt_code_original TEXT`); } catch (_) {}
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cpt_recode_proposals (
      id SERIAL PRIMARY KEY,
      standard_name TEXT,
      current_cpt TEXT,
      suggested_cpt TEXT,
      confidence NUMERIC,
      reason TEXT,
      source TEXT,               -- 'rule' | 'llm'
      status TEXT DEFAULT 'proposed',  -- proposed | applied | rejected
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

// One recode of every procedure row matching a distinct (name, current_cpt) pair.
async function applyRecode(standardName, currentCpt, suggestedCpt, confidence, reason, source) {
  const upd = await pool.query(
    `UPDATE procedures
       SET cpt_code = $1, cpt_code_original = COALESCE(cpt_code_original, cpt_code)
     WHERE standard_name = $2 AND cpt_code = $3`,
    [suggestedCpt, standardName, currentCpt]
  );
  await pool.query(
    `INSERT INTO cpt_recode_proposals (standard_name, current_cpt, suggested_cpt, confidence, reason, source, status)
     VALUES ($1,$2,$3,$4,$5,$6,'applied')`,
    [standardName, currentCpt, suggestedCpt, confidence, reason, source]
  );
  return upd.rowCount;
}

async function main() {
  await ensureColumns();
  console.log(`\n=== WHOLE-DB CPT MAPPING AUDIT ${APPLY ? '(APPLY MODE)' : '(report only)'} ===\n`);

  // Distinct (standard_name, cpt_code) pairs — far fewer than raw rows, so both the
  // report and any LLM pass operate on descriptions, not millions of price rows.
  const pairs = await pool.query(`
    SELECT p.standard_name, p.cpt_code,
      COUNT(DISTINCT p.id)::int AS procedure_rows,
      COUNT(DISTINCT pr.hospital_id)::int AS hospitals
    FROM procedures p
    LEFT JOIN prices pr ON pr.procedure_id = p.id
    WHERE p.standard_name IS NOT NULL AND p.cpt_code IS NOT NULL
    GROUP BY p.standard_name, p.cpt_code
    ORDER BY p.standard_name
  `);
  console.log(`Distinct (name, code) pairs to check: ${pairs.rows.length}\n`);

  // ---- Tier 1: rules ----
  let ruleHits = 0, ruleApplied = 0;
  const undecided = [];
  for (const row of pairs.rows) {
    const m = ruleMatch(row.standard_name);
    if (m && row.cpt_code !== m.cpt) {
      ruleHits++;
      console.log(`  RULE  "${row.standard_name}" tagged ${row.cpt_code} -> ${m.cpt} (${m.label})  [${row.procedure_rows} rows, ${row.hospitals} hospitals]`);
      if (APPLY) ruleApplied += await applyRecode(row.standard_name, row.cpt_code, m.cpt, 0.98, m.label, 'rule');
    } else if (!m) {
      undecided.push(row);
    }
  }
  console.log(`\nRule tier: ${ruleHits} mismatched pair(s)${APPLY ? `, ${ruleApplied} procedure rows recoded` : ''}.`);

  // ---- Tier 2: LLM (optional) ----
  if (USE_LLM) {
    const AnthropicPkg = require('@anthropic-ai/sdk');
    const Anthropic = AnthropicPkg.default || AnthropicPkg;
    const client = new Anthropic();
    console.log(`\nLLM tier: classifying ${undecided.length} remaining distinct pair(s) with Haiku...`);
    let llmFlags = 0, llmApplied = 0;

    for (const row of undecided) {
      let verdict;
      try {
        const resp = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          system: `You verify CPT codes against procedure descriptions. Be conservative:
only flag a change when the description CLEARLY indicates a different, standard CPT code.
When unsure, say the code is correct. Respond ONLY as JSON:
{"correct": true|false, "suggested_cpt": "12345"|null, "confidence": 0.0-1.0, "reason": "..."}`,
          messages: [{ role: 'user', content: `Description: "${row.standard_name}"\nCurrently tagged CPT: ${row.cpt_code}` }],
        });
        const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        verdict = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
      } catch (_) { continue; }

      if (verdict && verdict.correct === false && /^\d{5}$/.test(String(verdict.suggested_cpt))) {
        llmFlags++;
        const conf = Number(verdict.confidence) || 0;
        const highConf = conf >= 0.9;
        console.log(`  LLM   "${row.standard_name}" ${row.cpt_code} -> ${verdict.suggested_cpt}  conf=${conf}  ${verdict.reason}`);
        if (APPLY && highConf) {
          llmApplied += await applyRecode(row.standard_name, row.cpt_code, verdict.suggested_cpt, conf, verdict.reason, 'llm');
        } else {
          await pool.query(
            `INSERT INTO cpt_recode_proposals (standard_name, current_cpt, suggested_cpt, confidence, reason, source, status)
             VALUES ($1,$2,$3,$4,$5,'llm','proposed')`,
            [row.standard_name, row.cpt_code, verdict.suggested_cpt, conf, verdict.reason]
          );
        }
      }
    }
    console.log(`\nLLM tier: ${llmFlags} flagged${APPLY ? `, ${llmApplied} high-confidence rows recoded` : ''}, rest queued in cpt_recode_proposals for review.`);
  } else {
    console.log(`\n(Run again with --llm to classify the other ${undecided.length} distinct pairs with Haiku.)`);
  }

  console.log(`\nReview queued proposals:  SELECT * FROM cpt_recode_proposals WHERE status='proposed' ORDER BY confidence DESC;`);
  console.log(`Revert a bad recode:      UPDATE procedures SET cpt_code = cpt_code_original WHERE ...;\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => pool.end());
