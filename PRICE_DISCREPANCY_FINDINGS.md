# Baylor / Procedure Price Discrepancy vs TryBilly — Findings & Plan

## ✅ Update — fixes applied (v3.3)

The candidates below have now been fixed in code:

1. **Cross-price-type bounds (candidate A)** — `PRICE_IS_VALID_SQL` in `server.js`
   now judges each price_type against its **own** window (negotiated → min/max_negotiated,
   gross → min/max_gross), COALESCE-falling back to cash. Mirrored in `db_agent.js`
   and the `/test-cpt` + `/verify-all` diagnostics.
2. **Sticky flags (candidate D)** — `validation_system.js` now populates the per-type
   bound columns, flags each price_type against its own window (gross is flagged for
   the first time), and **reconciles** — un-flagging bounds-flagged prices that now
   fall back in range. The agent's `clear_stale_flags` does the same on demand.
3. **`/search-drugs` code search (candidate E, drug arm)** — now matches `ndc`/`j_code`.
4. **MIN-vs-median (candidate C)** — `/search` now also returns `negotiated_price`,
   `median_cash_price`, and `median_negotiated_price`, so the UI can show a typical
   price comparable to a competitor's median instead of only the MIN floor.

**To activate on the live DB:** run `node validation_system.js` (creates/populates the
columns + reconciles flags), then confirm one Baylor/TryBilly example. Candidate B
(specific bounds too tight) remains a per-CPT data tweak in `cpt_price_bounds`.

---



_Status: root-cause **candidates** identified from code review. Live DB confirmation
pending (the diagnostic session runs in a cloud container with no DB access —
run `diagnose_price.js` locally to confirm which candidate applies to a given example)._

## How Hosparent decides what price to show

1. **`cpt_price_bounds`** is the single source of truth (`validation_system.js`).
   Each CPT has `min_cash` / `max_cash`. A later migration
   (`add_negotiated_bounds.sql`) added `min_negotiated/max_negotiated/min_gross/max_gross`.
2. `validation_system.js` sets `is_suspicious = true` on any price outside bounds
   (it **flags, never deletes**).
3. `server.js` re-checks bounds **live** on every read via `PRICE_IS_VALID_SQL`:
   ```sql
   (pr.is_suspicious IS NOT TRUE)
   AND NOT EXISTS (SELECT 1 FROM cpt_price_bounds b
     WHERE b.cpt_code = p.cpt_code
     AND (pr.price < b.min_cash OR pr.price > b.max_cash))
   ```
4. `/search` returns **`MIN(cash_price)`** among prices that pass that filter (plus a
   payer count and gross), ordered cheapest first.

## Root-cause candidates (ranked)

### A. Negotiated & gross prices are judged against the **cash** window ⭐ most likely
`PRICE_IS_VALID_SQL` compares `pr.price` to `min_cash`/`max_cash` **for every
`price_type`**. The dedicated `min_negotiated/max_negotiated/min_gross/max_gross`
columns exist but `server.js` never reads them. Consequences:
- A valid **negotiated** rate below the cash floor (e.g. an insurer-negotiated
  colonoscopy at $280 when `min_cash`=400) is hidden.
- A valid **gross** charge above the cash ceiling (colonoscopy gross $10–12k when
  `max_cash`=8000; `max_gross` was set to $12,000) is hidden.
- `validation_system.js` uses a *third* rule at flag-time (negotiated floor =
  `min_cash*0.3`), so flagging and live-filtering disagree.
- **Result vs TryBilly:** Hosparent shows fewer / higher-floored prices than
  TryBilly, which surfaces negotiated rates directly.

### B. Cash bounds too tight
`min_cash` floors are conservative (colonoscopy 45378 = **$400**). Real ASC /
cash-pay screening colonoscopies exist below that and get clipped. Same at the
top for high-acuity facilities.

### C. Different statistic, not a bug
Hosparent shows the **minimum valid cash** price; TryBilly commonly shows a
negotiated median or a specific payer rate. A numeric gap here is expected and is
a presentation choice, not missing/bad data. The diagnostic distinguishes this
from A/B.

### D. Sticky `is_suspicious` flags
If bounds were tightened after a scrape, `validation_system.js` set
`is_suspicious=true` and never clears it — a price stays hidden even after bounds
are later loosened. Re-running validation does **not** un-flag (the flag update is
`is_suspicious IS NOT TRUE` guarded, one-directional).

### E. Missing data / CPT re-code
No MRF scrape for that hospital+CPT (`diagnose_price.js` reports this explicitly),
or the procedure was re-coded (virtual colonoscopy → 74263) / unlinked
(`cpt_code = NULL`, `is_searchable=false`) so it no longer matches the search.

## How to confirm on a real example
```
node diagnose_price.js 45378 "Baylor"
```
Read the `>>> WHAT THE API SHOWS` block vs the raw per-type breakdown:
- API shows nothing, raw has flagged rows → **D** (or B if the flag reason cites bounds).
- API shows nothing, raw rows are clean but outside cash window → **A** (if
  negotiated/gross) or **B** (if cash).
- API shows a price but it differs from TryBilly → **C** (confirm TryBilly's number
  is a different price_type/statistic).
- Raw count is 0 → **E**.

## Fix plan (top 5 procedures)
1. **Confirm** each of the top 5 (colonoscopy 45378, +4 TBD) with `diagnose_price.js`
   against its TryBilly example. Record which candidate (A–E) applies.
2. **Fix A (highest leverage):** make `PRICE_IS_VALID_SQL` bounds-check per
   `price_type` — use `min_negotiated/max_negotiated` for negotiated,
   `min_gross/max_gross` for gross, `min_cash/max_cash` for cash — with a
   `COALESCE` fallback to the cash window when a type-specific bound is null.
   Mirror the same per-type logic in `validation_system.js` so flag-time and
   read-time agree. _This is an API-wide behavior change — do it once, retest every
   endpoint via `/verify-all`._
3. **Fix B:** widen the specific `min_cash`/`max_cash` rows the diagnostic proves
   too tight (data-only change in `cpt_price_bounds` + `validation_system.js`).
4. **Fix D:** after loosening bounds, re-clear stale flags:
   `UPDATE prices SET is_suspicious=false, validation_reason=NULL` for rows now
   inside the corrected window, then re-run `validation_system.js`.
5. **Fix E:** queue an MRF re-scrape for the affected hospital (scraper_*.js).
6. **Retest** each against TryBilly; repeat for the next procedure.
