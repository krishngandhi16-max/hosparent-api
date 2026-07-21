# UI change requests (paste into the Replit Agent)

The office drafts UI changes here because it cannot edit the Replit app
directly. Paste each block into the Replit Agent as one message. Delete a block
once applied.

**IMPORTANT — the API base must be `https://live.hosparent.com`** (not
`api.hosparent.com`, which has no tunnel route and 404s). Set `API_BASE` /
`VITE_API_BASE` = `https://live.hosparent.com` and redeploy, or the site shows
demo data.

---

## 1. Learn tab — bind every chart to the new pre-computed fields (fixes NaN×, blanks, and the misleading single "lowest price")

Paste this into the Replit Agent:

> The Learn tab is showing `NaN×`, blank cells, and "not published" for prices
> that actually exist, because it does arithmetic on the API's nested fields.
> The backend now returns flat, pre-computed, pre-formatted fields — bind
> directly to these and never compute prices in the frontend.
>
> **API base:** `https://live.hosparent.com`. Refetch `GET /learn/stats` and
> `GET /learn/price-breakdown?cpt=CODE`.
>
> **`/learn/stats` now returns:**
> ```
> {
>   "coverage": { "hospitals", "valid_prices", "procedures", "last_mrf_refresh", "drug_prices", "cash_bundles" },
>   "headline_stats": {
>     "hospitals_tracked_display": "47",
>     "total_prices_display": "48,499,158",
>     "max_spread_display": "37.3×", "max_spread_procedure": "Comprehensive metabolic panel",
>     "max_savings_display": "$38,406", "max_savings_procedure": "Knee arthroscopy (meniscectomy)"
>   },
>   "price_spread": [
>     { "cpt_code": "80053", "label": "Comprehensive metabolic panel",
>       "hospitals": 40,
>       "low": 10, "median": 348, "high": 392,
>       "spread_ratio": 37.3, "spread_ratio_label": "37.3×", "savings": 381,
>       "display": { "low": "$10", "median": "$348", "high": "$392", "savings": "$381", "spread": "37.3×",
>                    "cash_median": "$348", "negotiated_median": "$…", "list_median": "$…" },
>       "why": "The cheapest DFW hospital lists $10 cash for this; the most expensive lists $392 — 37.3× more …",
>       "cash": { "min", "median", "max", "hospitals", "price_rows" },
>       "negotiated": { … or null }, "gross": { … or null } }
>   ],
>   "explanations": { "why_prices_differ": "…", "why_cash_can_beat_insurance": "…", "who_this_helps": "…" },
>   "methodology": "…", "computed_at": "…"
> }
> ```
>
> Wire it up:
> 1. **Three top stats** (currently blank "—"): use `headline_stats` —
>    `hospitals_tracked_display` ("DFW hospitals tracked"),
>    `max_spread_display` + `max_spread_procedure` ("max price spread"),
>    `max_savings_display` + `max_savings_procedure` ("potential savings on a
>    single procedure"). Render the display strings verbatim — do not recompute.
> 2. **"Price spread across DFW hospitals" chart** (currently `NaN×`): map over
>    `price_spread`. For each row show `display.low` (green, cheapest),
>    `display.high` (red, most expensive), and `spread_ratio_label` for the "N×".
>    Never compute `high/low` yourself — use `spread_ratio_label`.
> 3. **Show low / median / high, not just lowest.** For every procedure render
>    all three: `display.low`, `display.median`, `display.high`. Label them
>    "cheapest / typical / most expensive". The median is the honest "typical"
>    number; the lowest is a floor most people won't get.
> 4. **The "why" line.** Under each spread row (or on hover) show that row's
>    `why` string. Add an intro paragraph from `explanations.why_prices_differ`
>    at the top of the spread section — this is the "it's the system, not you"
>    framing the page should lead with.
> 5. **"Common procedures & price ranges" table** (currently "--"): one row per
>    `price_spread` item — `cpt_code`, `label`, `display.low` (Low),
>    `display.spread` (Spread), `display.high` (High). Clicking a code runs a
>    live search for that CPT.
> 6. If `price_spread` is empty, show one honest empty state — but it won't be;
>    every row returned already has real data.
>
> **`/learn/price-breakdown?cpt=CODE` now returns** `typical` and
> `featured_hospital` — use these so Chart 1 and Chart 3 never show blanks:
> ```
> { "cpt_code", "procedure_name",
>   "typical": { "list", "negotiated", "cash", "cash_low", "medicare",
>                "display": { "list": "$5,548", "negotiated": "$876", "cash": "$2,774",
>                             "cash_low": "$414", "medicare": "$…" } },
>   "featured_hospital": { "hospital", "city", "list_price", "negotiated_median", "cash_price", "payer_contracts" },
>   "summary": { "cash", "negotiated", "gross" },
>   "by_hospital": [ … ], "medicare": {…}|null, "cash_bundles": [ … ],
>   "explanation": "…", "methodology": "…" }
> ```
> 7. **Chart 1 "One procedure, four prices"** and **Chart 3 "How a bill gets
>    calculated"**: use `typical.display` for the four bars — `list`,
>    `negotiated`, `cash`, `medicare`. These are DFW-wide medians across all
>    hospitals, so negotiated and list are always present (no more "not
>    published by ."). Show `procedure_name`. If you want to name a hospital,
>    use `featured_hospital.hospital` (it's chosen to have all price types) —
>    and only show a field for it that is non-null; otherwise fall back to
>    `typical`. Label Medicare "CMS benchmark, not a hospital price".
> 8. Never print a bare CPT/hospital placeholder like "(CPT ) at ,". If a value
>    is null, either use the `typical` fallback or omit that clause entirely.
>
> Keep the clean visuals and the existing sections (laws, six steps, FAQ). Keep
> the "Computed from … 45 CFR 180 · updated {computed_at}" caption. List every
> file you changed.

---

## 2. Search results — Kayak/Amazon cards, range not just "lowest"

(unchanged from before — apply after #1)

> Redesign search results from a spreadsheet table into ranked result cards like
> Kayak/Amazon, using the data `GET /search?q=...` already returns. Replace the
> single "lowest price" headline with a range: a summary band reading "as low as
> ${min} · typically ~${median} · up to ${max} across N hospitals" (median most
> prominent), plus a Medicare reference line. Each hospital is a card showing its
> cash price (headline, badged "cash / self-pay"), negotiated and list prices
> when present (badged; "not published" when null), CMS stars (`cms_rating`),
> Leapfrog grade, Google rating + review count, `payer_count` as "N insurance
> rates published", a "verified {mrf_last_updated}" line, and call/directions
> buttons. Only the single cheapest card gets a muted "lowest listed" tag. Sort
> bar: cash price / typical (median) / rating. Never present the lowest as "the
> price"; always pair it with the typical/median and source count. Match the
> existing design system. List every file you changed.
