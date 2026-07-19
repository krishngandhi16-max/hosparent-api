#!/usr/bin/env node
// hoser_unflag.js — recover good prices hidden by stale flags. PURE SQL, $0.
//
// This used to ask the LLM agent to run the unflag, which cost API credits to
// do something that is literally one SQL statement. Now it runs the exact same
// whitelisted safe-fix logic (db_agent SAFE_FIXES.unflag_prices_with_validation)
// directly against Postgres — no model, no API key, no cost.
//
// What it unflags: prices currently marked is_suspicious that are actually
// WITHIN their per-type bounds (cash vs cash window, negotiated vs negotiated,
// gross vs gross), plus sane prices ($5–$500K) on CPTs that have no bounds row.
// Reversible: `node validation_system.js` re-flags anything out of bounds.
//
// Usage:
//   node hoser_unflag.js            # full recovery (includes flags with no
//                                   #   validation_reason — the 653K legacy flags)
//   node hoser_unflag.js --strict   # only rows flagged by bounds validation
//                                   #   (validation_reason IS NOT NULL)
require('dotenv').config();
const { pool } = require('./db');
const { SAFE_FIXES } = require('./db_agent');

const STRICT = process.argv.includes('--strict');

(async () => {
  try {
    const before = await pool.query(
      `SELECT COUNT(*)::bigint AS n FROM prices WHERE is_suspicious IS TRUE`
    );
    console.log(`Flagged prices before: ${Number(before.rows[0].n).toLocaleString()}`);
    console.log(`Unflagging prices within their per-type bounds (${STRICT ? 'strict: bounds-flagged rows only' : 'full recovery incl. legacy flags'})...`);

    const result = await SAFE_FIXES.unflag_prices_with_validation({ include_all: !STRICT });

    const after = await pool.query(
      `SELECT COUNT(*)::bigint AS n FROM prices WHERE is_suspicious IS TRUE`
    );
    console.log(`\nRecovered (unflagged): ${Number(result.unflagged_rows).toLocaleString()} prices`);
    console.log(`Flagged prices after:  ${Number(after.rows[0].n).toLocaleString()} (these are genuinely out of bounds — correctly hidden)`);
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
