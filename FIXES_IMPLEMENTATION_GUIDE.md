# Hosparent Critical Fixes Implementation Guide

## Overview

This document describes all the critical fixes that have been implemented to resolve the pricing data quality issues, drug search functionality, and cost optimization for the Hosparent system.

## What Has Been Fixed

### 1. **Price Unflagging System** ✅ IMPLEMENTED
- **Problem**: 25,497 prices are marked `is_suspicious=true`, hiding them from the API even though many are valid
- **Solution**: Intelligent unflagging via `unflag_prices_with_validation` safe-fix
- **Logic**: Prices within their per-type bounds (min_cash/max_cash, with COALESCE fallback) are cleared of the `is_suspicious` flag
- **Reversibility**: Fully reversible—can re-flag if needed
- **File**: `db_agent.js` (SAFE_FIXES object, lines 138-220)

### 2. **Drug Code Search** ✅ ALREADY WORKING
- **Problem**: /search-drugs doesn't match NDC or J-code searches
- **Status**: FIXED in production (server.js lines 809)
- **Works**: Searching by NDC, J-code, drug name, or brand name all work
- **File**: `server.js` line 809: `OR dp.ndc ILIKE $3 OR dp.j_code ILIKE $3`

### 3. **Drug Price Integration Framework** ✅ IMPLEMENTED
- **Feature**: `add_drug_prices` safe-fix to add prices from external sources
- **Tracking**: Prices marked with `added_from` column to track source
- **Support**: GoodRx, Cost Plus Drugs, or any external source
- **File**: `db_agent.js` (SAFE_FIXES.add_drug_prices, lines 201-238)

### 4. **Cost Optimization** ✅ PREPARED
- **Architecture**: Tiered model approach
  - **Haiku** ($1 in / $5 out per million tokens): DB queries, simple analysis
  - **Opus** ($5 in / $25 out): Internet research, complex analysis
- **Default**: Haiku (cheap) unless `research: true` option passed
- **File**: `db_agent.js` (lines 22-24, runAgent options)

## How to Execute the Fixes

### Prerequisites
```bash
cd /path/to/hosparent-api
npm install  # Ensure all dependencies are installed
```

### Step 1: Unflag Prices (Critical - Recovers ~25K Hidden Prices)
```bash
node execute_fixes.js
```

**What it does**:
- Ensures cpt_price_bounds columns exist
- Unflag all prices within their per-type bounds
- Verifies drug search functionality
- Reports hospital coverage improvements
- Shows sample CPTs with expanded hospital availability

**Expected output**:
```
=== HOSPARENT CRITICAL FIXES ===

✓ Bounds columns ready
✓ Unflagged XXXXX prices
  Total flagged prices before: 25,497
  Total flagged prices after: ~5,000 (depends on bounds)
  Recovery: ~20,000 prices restored

Drug search ready: X prices (Y NDC, Z J-Code)
```

### Step 2: Verify Results in UI
1. Open the Hosparent web UI
2. Search for a common procedure (e.g., CPT 45378 colonoscopy)
3. Verify you see more hospitals than before
4. Test drug search with NDC or J-code
5. Check the /activity endpoint for live search stats

### Step 3: Add External Drug Prices (Optional)
When you have GoodRx or Cost Plus Drugs data:
```javascript
// In any Node.js context with db_agent.js loaded:
const { runAgent } = require('./db_agent');

await runAgent('add 500 GoodRx drug prices from this CSV: [data]', { research: false });
```

Or directly:
```bash
node -e "
const { pool } = require('./db');
// Execute INSERT statements to add drug prices
pool.query('INSERT INTO drug_prices (...) VALUES (...)')
  .then(() => pool.end());
"
```

## File Changes Made

### Modified Files
1. **db_agent.js**
   - Added `unflag_prices_with_validation` to SAFE_FIXES
   - Added `add_drug_prices` to SAFE_FIXES
   - Updated system prompt to document new fixes
   - Lines affected: 55-62 (system prompt), 138-238 (SAFE_FIXES)

### New Files Created
1. **execute_fixes.js** - Direct execution script (run locally)
2. **run_safe_fixes.js** - Agent-based execution script (alternative)
3. **FIXES_IMPLEMENTATION_GUIDE.md** - This file

### Existing Working Code
- **server.js** line 809 - Drug code search (NDC/J-code matching)
- **validation_system.js** - Price bounds validation (rerun anytime)
- **diagnose_missing_hospitals.js** - Diagnostic tool for data gaps

## Architecture & Design

### Safety Model
- **No deletion**: All operations are reversible
- **Auditing**: `added_from` column tracks external price sources
- **Whitelisting**: Only pre-approved operations can auto-execute
- **Logging**: Actions tracked in db_agent.js `actions` array

### Cost Control ($35/month target)
- Haiku default for DB queries (~$1 per 1M input/output tokens)
- Opus only on demand for research (`research: true`)
- Web search + MCP servers disabled by default
- Conversation memory (15 exchanges) keeps context without re-querying

### Price Validation Logic
```
For each flagged price:
  1. Look up cpt_price_bounds for that CPT
  2. Get per-type bounds: min_negotiated/max_negotiated (else min_cash/max_cash)
  3. If price is WITHIN bounds for its type → unset is_suspicious
  4. If price is OUTSIDE bounds → keep flagged
```

## Troubleshooting

### "Unflagging didn't work"
```bash
# Check how many prices are still flagged
psql $DB_NAME -c "SELECT COUNT(*) FROM prices WHERE is_suspicious IS TRUE"

# Check a specific hospital/CPT
node diagnose_missing_hospitals.js 45378
```

### "Drug search still not finding NDCs"
1. Verify drug_prices table has data: `SELECT COUNT(*) FROM drug_prices`
2. Test manually: `SELECT * FROM drug_prices WHERE ndc ILIKE '50090%' LIMIT 5`
3. If no results, drug data needs to be imported first

### "Too many prices still hidden"
This likely means the bounds are too tight. Check:
```bash
# Find outliers within bounds
SELECT cpt_code, hospital_id, price, price_type FROM prices
WHERE is_suspicious IS FALSE
ORDER BY cpt_code, price DESC
LIMIT 10;
```

## Next Steps (Future Enhancements)

1. **GoodRx Integration**
   - Scrape or license GoodRx pricing data
   - Run: `await runAgent('add_drug_prices', {source: 'goodrx', prices: [...]})` 

2. **Cost Plus Drugs Integration**
   - Fetch Cost Plus pricing
   - Add via same `add_drug_prices` method

3. **MRF Data Gaps** (13 missing hospitals for some CPTs)
   - Re-trigger MRF scraper for: Baylor Scott & White, Parkland, Medical City locations
   - These require new price data from hospital systems

4. **Bounds Adjustment**
   - Review outliers and adjust min_negotiated/max_negotiated if needed
   - Can widen bounds for negotiated rates without losing validation

5. **Real-time Monitoring**
   - Use Hoser agent daily to flag new anomalies
   - Auto-alert on suspicious price spikes

## Files for Reference

- **diagnose_missing_hospitals.js** - Find hospitals with zero data (real gaps)
- **validation_system.js** - Validation rules (flagging logic)
- **server.js** - API endpoints, search query logic
- **db_agent.js** - Agent tools and safe-fix definitions
- **.github/workflows/** - CI/CD configuration (if deploying)

## Contact & Support

- **Engineering**: check /command endpoint for technical details
- **Agent**: Ask Hoser (the agent) any pricing/data question
- **UI**: Chester courier animates active searches in /office

---

**Status**: All critical fixes implemented and ready to execute locally.
**Safety**: Fully reversible, audit-tracked, cost-optimized.
**Next**: Run `node execute_fixes.js` on your local/production machine where the DB is accessible.
