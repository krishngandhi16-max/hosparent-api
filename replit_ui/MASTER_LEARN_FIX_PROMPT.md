# MASTER fix prompt — paste this whole block into the Replit Agent

Copy everything between the lines into the Replit Agent as one message. It fixes
the search results header (median never shown), plus every NaN / blank / "—" on
the Learn tab.

---

You are fixing the Hosparent web app. Two symptoms to kill everywhere:
1. On the **search results** page, the header shows only the LOWEST price ("$414")
   and a raw high, but never the MEDIAN — so a colonoscopy reads as "$414" when the
   typical DFW price is ~$1,818.
2. On the **Learn** tab, charts show `NaN×`, blank cells ("-- to --"), empty top
   stats ("—"), and placeholders like "(CPT ) at , Denton".

Root cause is the same in every case: the frontend does arithmetic on nested API
fields and reads fields that don't exist. The backend now returns flat,
pre-computed, pre-formatted `display` strings — **bind directly to them and NEVER
compute a price, ratio, or percentage in the frontend.**

API base URL: `https://live.hosparent.com` (confirm the app fetches from this; if
it points at `hosparent.com` or `api.hosparent.com`, change it to `live.hosparent.com`).

## Fix 0 — search results header must show LOW / MEDIAN / HIGH (currently only "$414")

There is a NEW endpoint: `GET /search-summary?q=QUERY` (same `q` you send to
`/search`). Call it alongside `/search` and bind the header to its pre-formatted
`display` object. It returns:

```
{
  "query": "colonoscopy",
  "cpt_code": "45378",
  "procedure_name": "Colonoscopy (diagnostic)",
  "hospital_count": 30,
  "cash": { "low": 414, "median": 1818, "high": 2774, "negotiated_median": 876 },
  "spread_ratio": 6.7,
  "display": {
    "low": "$414",
    "median": "$1,818",
    "high": "$2,774",
    "negotiated_median": "$876",
    "spread_ratio": "6.7×",
    "range": "$414–$2,774 (typical $1,818)"
  },
  "note": "Median is the honest everyday price; the lowest is a floor..."
}
```

Header rules:
- Replace the "from $414 to $2,774" line with THREE labeled numbers:
  **Lowest** `display.low` · **Typical (median)** `display.median` · **Highest** `display.high`.
  Make **Typical/median** the visually dominant one — that's the honest number.
- Keep the "Price spread: `display.spread_ratio` difference" using `spread_ratio`
  (already a string like "6.7×"). Never compute high/low yourself.
- You may use `display.range` verbatim as a one-line summary.
- Add the `note` as small helper text so users understand the lowest is a floor.
- If `display.median` is null (rare), fall back to showing low/high only — never
  print "NaN" or a blank.
- The big single "$414" number at the top of results: change it to the **median**
  (`display.median`), or show all three. Do not lead with the floor price alone.

## Fix 1 — Learn tab: the three top stats (currently "—")

Fetch `GET /learn/stats`. Use `headline_stats`. Render verbatim (do not recompute):
- "DFW hospitals tracked in real time" → `headline_stats.hospitals_tracked_display`
- "max price spread across DFW hospitals" → `headline_stats.max_spread_display`
  (+ optional `headline_stats.max_spread_procedure`)
- "potential savings on a single procedure" → `headline_stats.max_savings_display`
  (+ optional `headline_stats.max_savings_procedure`)

## Fix 2 — Learn tab Chart 2 "Price spread across DFW hospitals" (currently "NaN×")

Map over `stats.price_spread` (array, ~15 items). For EACH item use the pre-formatted
`display` object — do not compute `high/low`:
- cheapest (green): `item.display.low`
- most expensive (red): `item.display.high`
- the multiple: `item.spread_ratio_label` (already a string like "44.6×")
- label: `item.label`

Already sorted most-dramatic-first. If `spread_ratio_label` is ever null, hide that
row — never print "NaN×".

## Fix 3 — show low / MEDIAN / high (not just lowest), with the "why"

For every procedure show all three, labeled: `display.low` = "cheapest",
`display.median` = "typical", `display.high` = "most expensive". Put
`stats.explanations.why_prices_differ` as an intro paragraph at the top of the
spread section, and show each item's `item.why` sentence under its row (or on hover).

## Fix 4 — Learn tab Chart 1 "One procedure, four different prices" (blank CPT/hospital)

Fetch `GET /learn/price-breakdown?cpt=CODE` (default 45378). It returns:
- `featured_hospital` — a real named hospital with all price types, e.g.
  `{ "hospital": "Baylor Scott & White Medical Center - Frisco", "city": "Frisco",
     "list_price": 931.82, "negotiated_median": 556.9, "cash_price": 413.86,
     "payer_contracts": 657 }`
- `typical` — DFW-wide medians, always populated, e.g.
  `typical.display = { "list": "$5,548", "negotiated": "$876", "cash": "$2,774",
     "cash_low": "$414", "medicare": null }`

Rules:
- Title: use `procedure_name` and `cpt_code` — NEVER render "(CPT ) at ," with blanks;
  drop any clause whose value is missing.
- Four bars: prefer `featured_hospital` (list_price, negotiated_median, cash_price);
  for any null bar, fall back to the matching `typical` value. Format with commas.
- Medicare bar: `typical.display.medicare`; if null show "CMS benchmark: not available
  for this code" — never "not available for CPT ." with a blank code.
- "cash is X% lower than list": compute only from the two values you're actually
  displaying, only when both present and list > 0; else omit the sentence.

## Fix 5 — Learn tab Chart 3 "How a bill gets calculated" (currently "Not published")

Same `price-breakdown`. Use `typical.display` for the four steps:
- Chargemaster / list → `typical.display.list`
- Negotiated → `typical.display.negotiated`  ← fixes "Not published"
- Cash → `typical.display.cash` or `typical.display.cash_low`
- Medicare → `typical.display.medicare`, else "not available for this code"

Show `procedure_name`; if you name a hospital use `featured_hospital.hospital`.

## Fix 6 — Learn tab "Common procedures & price ranges" table (currently "--")

One row per `stats.price_spread` item: `cpt_code`, `label`, `display.low` (Low),
`display.spread` (Spread), `display.high` (High). Clicking the code runs a live
search for that CPT. ~15 real rows — none should be "--".

## Fix 7 — the interchangeable CPT picker

When the user picks a different procedure, refetch `/learn/price-breakdown?cpt=NEWCODE`
and repopulate Charts 1 and 3. If the response has `validated: false`, show a small
caption using its `validated_note` — but still show the numbers.

## Fix 8 — the "Your rights / laws" section (make it DB-driven and expand it)

Replace any hardcoded law cards with `GET /learn/reference`. It returns:

```
{ "reference": [
  { "kind": "law",                     // "law" | "right"
    "title": "Hospital Price Transparency Rule",
    "jurisdiction": "US federal",      // or "Texas"
    "effective_date": "January 1, 2021",
    "citation": "45 CFR 180",
    "penalty": "Civil monetary penalties up to roughly $2M ...",  // may be null
    "summary": "Every hospital in the U.S. must publicly post ...",
    "detail": "...",
    "bullets": ["...", "..."],
    "action": "Before you schedule anything non-emergency, look up ...",
    "sources": [ { "title": "CMS — Hospital Price Transparency", "url": "https://..." } ]
  }, ... ] }
```

9 entries (7 federal + 2 Texas). Render as cards:
- Header: `title`, with small pills for `jurisdiction` and `effective_date`.
- `summary` as the bold lead sentence.
- `bullets` as a checklist.
- A highlighted "How to use it" block from `action`.
- `citation` and `penalty` in small secondary text (skip penalty if null).
- A "Sources" row: each `sources[].title` as a link to `sources[].url` (new tab).
  Every card must show its sources.
- Add a Federal/Texas filter using `jurisdiction`.

Render numbers/dates exactly as returned — do not paraphrase.

## Guardrails
- Never do price math in the frontend — every number has a `display` string.
- Never render a template with an empty slot (blank CPT, blank hospital, "$NaN",
  "-- to --"). If a value is null, use the `typical`/`display` fallback or omit it.
- Keep the clean visuals and all existing sections.
- Keep the "Computed from … 45 CFR 180 · updated {computed_at}" caption.

When done, list every file you changed and confirm: (a) the search header shows
lowest/median/highest with the median dominant, and (b) no Learn chart shows NaN or
a blank cell, and (c) the rights section lists all 9 entries with working links.
