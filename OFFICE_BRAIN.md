# OFFICE BRAIN — institutional knowledge for Hosparent's agents

This file is loaded into the office agent's system prompt on every question.
It is the distilled knowledge from debugging and building Hosparent so the
agent reasons like the engineer who fixed it, not like a cold start.
Keep entries short, factual, and actionable. Update it when something new is
learned — this file IS the office's memory.

## The company in one paragraph

Hosparent is a US hospital price-transparency product (DFW-focused) backed by
Postgres: ~46 hospitals, ~48.6M prices, ~266K procedures, ~106 CPT codes with
curated bounds, plus retail drug prices. Public API runs on the tunnel PC
(server.js, port 3001, exposed as live.hosparent.com via Cloudflare tunnel);
the consumer UI is a separate Replit React app ("Zip Reality") that calls the
live API. Krish (the owner) is cost-sensitive: the office runs on free-tier
LLM providers (Groq) + Perplexity for web research; Anthropic is a paid
fallback only.

## Pricing model — the core domain logic

- Hospitals publish machine-readable files (45 CFR 180) with gross charges,
  discounted cash prices, and per-payer negotiated rates. That's our data.
- cpt_price_bounds is the source of truth for realistic per-CPT price windows.
  It has PER-TYPE columns: min/max_cash, min/max_negotiated, min/max_gross.
- prices.is_suspicious=true HIDES a price from the API. validation_reason
  records why. Flags are the only "deletion" — nothing is ever deleted.
- THE classic bug (Baylor colonoscopy): checking every price_type against the
  CASH window hides valid negotiated/gross prices. Always validate each type
  against its OWN window (COALESCE to cash window when per-type is null).
- /search returns MIN(valid cash) — a FLOOR, not a median. Competitors
  (TryBilly) usually show median negotiated. A gap between us and them is
  usually a different statistic, not bad data. Second cause: stale flags
  hiding mid-range prices (fixed by unflag recovery).
- Names containing 'hchg' are excluded; valid prices are > $5 and < $500,000.

## The repair pipeline (all pure SQL, $0, reversible)

- validation_system.js — re-flag out-of-bounds prices per-type. Idempotent.
- hoser_unflag.js — recover flagged prices that are within their per-type
  bounds (in July 2026 this recovered 504,226 of 653,278 flagged prices;
  ~149K remain flagged as genuinely out of bounds).
- verify_all_prices_v2.js — PASS/FAIL manifest per CPT per type. 106/106 PASS
  as of the last full run. This is the receipt; run it after any data change.
- fix_whole_db.js — chains audit → validate → unflag → verify.
- audit_cpt_mapping.js — finds procedures tagged with the wrong CPT. Rule tier
  is free; --llm tier is BATCHED (20 pairs/call), CAPPED (--limit, default
  5000/run) and RESUMABLE (cpt_audit_reviewed table). NEVER classify 265K
  pairs one-call-per-pair — that once ran 23 hours and drained the credit
  balance. Recodes preserve cpt_code_original → always revertible.
- After data fixes: restart server or GET /cache-clear so the API serves it.

## Drugs

- Retail data comes from the OFFICIAL Cost Plus Drugs public API
  (import_costplus.js, ~2,371 meds with NDC + real prices). Never scrape
  their HTML — it's a React app, scraping returns nothing.
- Retail sources publish drug NAMES + NDC, never J-codes. J-codes (J1815 =
  insulin per 5 units) are hospital/insurer billing codes for injectables.
  fix_drug_codes.js maps common J-codes to drug-name patterns and backfills
  drug_prices.j_code — injectable forms only, never pen needles or creams.
- Cost Plus does NOT sell insulin (only pen needles) — many injectables have
  no retail seller at all. /search-drugs falls back to hospital price-file
  rows (procedures/prices + mrf_prices) for J/Q-code queries, so a code
  search returns hospital prices instead of a blank page.
- /search-drugs matches drug_name, brand_name, ndc, AND j_code.

## The agent office

- db_agent.js (Hoser, the brain) answers questions with tools: get_schema,
  run_readonly_sql (SELECT-only, guarded), diagnose_price, check_live_api,
  apply_safe_fix (whitelist: rerun_validation, clear_stale_flags,
  unflag_prices_with_validation, add_drug_prices, recode_procedure_cpt),
  plus web_search via Perplexity.
- Model routing: llm.js auto-detects a free/cheap provider (Groq → Gemini →
  DeepSeek → OpenRouter → Kimi). Groq free tier: 1,000 req/day on Llama 3.3
  70B, 14,400/day on 8B. Anthropic (Sonnet 5 / Opus) is fallback only.
- Indy (indy_agent.js) researches stories + Learn content via Perplexity
  (60-day freshness gate on stories — never post stale news). Terry
  (terry_agent.js) drafts social posts. Both run in run_hoser_daily.js.
- run_office_daily.js is the self-running office: validate → unflag → verify
  → drug refresh → Learn refresh → news → Indy research + approval text.
  Scheduled via Windows Task Scheduler at 7am on the tunnel PC.
- Learn tab content lives in learn_content (categories lower_price /
  your_rights), seeded by seed_learn_content.js with cited .gov sources,
  expanded by Indy daily. Served free at /learn/*.

## Diagnosis playbook

1. "Price looks wrong / different from competitor X" → diagnose_price(cpt,
   hospital): compare raw prices per type vs what the live filter shows.
   Usual causes: floor-vs-median statistic, stale flags, per-type bounds bug,
   wrong CPT mapping (check cpt_recode_proposals).
2. "Data missing on the site but present in DB" → check_live_api on the same
   endpoint. 404 or old shape = tunnel PC running old code → git pull +
   restart. Correct data = Replit UI problem.
3. "Drug code returns nothing" → check drug_prices for the code, then the
   hospital fallback (procedures.cpt_code / mrf_prices.billing_code). If the
   drug has no retail seller, hospital rows are the answer, not a bug.
4. Bulk anything → use the batched, capped, resumable pattern. Never
   one-LLM-call-per-row.
5. After ANY fix: run verify_all_prices_v2.js and quote the PASS count.

## Cost rules (Krish's standing orders)

- Free first: Groq free tier for reasoning, Perplexity (pennies) for web
  research, pure SQL for anything SQL can do. Paid Claude only when
  explicitly asked or when no cheap key is configured.
- Never start an unbounded LLM loop over database rows.
- Anything that changes data must be reversible and end with the verify
  manifest as the receipt.

## Mission & roadmap (owner context)

Krish is a solo founder, pre-LLC, building Hosparent into the #1 DFW price
transparency tool and then expanding. Priorities in order: (1) trustworthy
DFW data (procedures + drugs), (2) clean consumer UI, (3) more colonoscopy
data, (4) cash-price surgery centers (targets below), (5) LLC formation →
unlocks the GoodRx API partnership for multi-pharmacy drug prices, (6) Texas-
wide, then national. Free interim for national drug reference pricing: CMS
NADAC public dataset (data.medicaid.gov) — no partnership needed.

## Cash-price scrape targets (researched Jul 2026 — real, verified sites)

DFW area:
- Texas Institute for Surgery (Dallas, on Texas Health Presbyterian campus)
  — standard pricing list: texasinstituteforsurgery.com/standard-pricing/
- NTTC Surgery Center (Mesquite) — flat-rate cash bundle list:
  nttcsurgerycenter.com/pricelist/flat-rate/  (knee replacement ~$20K vs
  $30-45K hospital — great comparison content)
- North Central Surgical Center Hospital (Dallas) — MRF + pricing page.
Texas (non-DFW):
- Texas Medical Management / Texas Free Market Surgery — bundled prices
  across 6 Texas cities, full list + downloadable price sheet:
  texasmedicalmanagement.com/surgery-price-bundles-facilities-full-list/
- Lonestar Surgery Center (Houston), NW Surgery (Houston, direct-pay).
Oklahoma:
- Surgery Center of Oklahoma (already imported as sco_prices — refresh it)
- Oklahoma Surgical Hospital (Tulsa) — price transparency page.
Cross-check directories: AAPS cash-friendly surgery list (aapsonline.org),
MediCostCalc cash-price aggregator, MDsave (already integrated).
Pattern for each: small scraper → bundle name, CPT when given, all-inclusive
price, source URL → sco_prices-style table with source attribution. Bundles
are ALL-INCLUSIVE (surgeon+anesthesia+facility) — label them as such so they
aren't compared 1:1 against facility-only hospital rates.

## Money & budget playbook (the office IS the budgeter)

When Krish asks ANY money question, answer with: current burn → options
ranked by ROI → one concrete recommendation. Current burn: LLM $0 (Groq
free), Perplexity ~$1-3/mo, Replit hosting ~$20-25/mo, domain ~$1/mo,
tunnel-PC electricity. Total well under $30/mo.

Windfall ranking (e.g. "I found $10K — where does it go?"):
1. Texas LLC + basics (~$300-800) — unlocks GoodRx and payer partnerships,
   liability protection. Highest unlock per dollar.
2. Database hardware: RAM + NVMe for the tunnel PC or a used server
   (~$600-1,500) — carries Texas-wide data.
3. Data expansion: scraper time for the targets above + Texas MRFs.
4. Cloud budget reserve ($100-300/mo Postgres) — only when the PC maxes out.
5. Marketing LAST — product before promotion.

US expansion estimate (honest math): ~6,100 US hospitals publish MRFs.
Current: 46 hospitals ≈ 48.6M rows (~1M rows/hospital). Texas (~600
hospitals) ≈ 600M rows ≈ 0.5-1TB — one beefy Postgres box, ~1-2 months of
automated MRF ingestion. Full US ≈ 6B+ rows ≈ 5-10TB — needs table
partitioning + real hardware (~$3-5K server or $200-500/mo cloud), realistic
solo timeline with office automation: top metros ~6 months, full US 9-15
months. A $10K budget comfortably covers Texas and starts national.

## Office ↔ Replit (who owns the UI)

The UI (Zip Reality) lives in Replit and the office cannot log into it —
Replit's connector needs an interactive browser OAuth, which a headless agent
doesn't have. The bridge: when a fix belongs in the UI, use the
draft_ui_change_request tool — it writes a complete, ready-to-paste prompt to
replit_ui/CHANGE_REQUESTS.md, styled to match replit_ui/REDESIGN_BRIEF.md.
Krish pastes it into the Replit Agent (or Claude applies it via connector in
chat). Rule of thumb: data/API problems are fixed HERE; look/layout/wording
problems are drafted as change requests for Replit.
