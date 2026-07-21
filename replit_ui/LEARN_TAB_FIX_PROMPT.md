# Learn tab fix — paste this whole block into the Replit Agent

Copy everything between the lines into the Replit Agent as one message.

---

The Learn tab is showing `NaN×`, blank cells ("-- to --"), empty top stats
("—"), and placeholder text like "(CPT ) at , Denton". The cause is the same in
every case: the charts are doing arithmetic on the API's nested fields and
reading fields that don't exist. The backend already returns flat, pre-computed,
pre-formatted values — bind directly to them and NEVER compute a price, ratio,
or percentage in the frontend.

API base URL: `https://live.hosparent.com` (confirm this is what the app fetches
from; if it's pointing at `hosparent.com` or `api.hosparent.com`, change it to
`live.hosparent.com`).

## Fix 1 — the three top stats (currently "—")

Fetch `GET /learn/stats`. Use the `headline_stats` object. Render these display
strings verbatim (do not recompute):

- "DFW hospitals tracked in real time" → `headline_stats.hospitals_tracked_display` (currently **"47"**)
- "max price spread across DFW hospitals" → `headline_stats.max_spread_display` (currently **"44.6×"**), and you may add `headline_stats.max_spread_procedure` ("CT head (no contrast)")
- "potential savings on a single procedure" → `headline_stats.max_savings_display` (currently **"$32,655"**), optionally with `headline_stats.max_savings_procedure` ("Vaginal delivery (routine)")

## Fix 2 — Chart 2 "Price spread across DFW hospitals" (currently 17× "NaN×")

Map over `stats.price_spread` (an array, currently **15 items**). For EACH item
use the pre-formatted `display` object — do not compute `high/low` yourself:

- cheapest (green): `item.display.low`
- most expensive (red): `item.display.high`
- the multiple: `item.spread_ratio_label` (already a string like "44.6×")
- label: `item.label`

The array is already sorted most-dramatic-first. Real values it returns right now:

| label | low | high | multiple |
|---|---|---|---|
| CT head (no contrast) | $95 | $4,246 | 44.6× |
| Comprehensive metabolic panel | $10 | $392 | 37.3× |
| CT abdomen & pelvis (with contrast) | $204 | $6,166 | 30.2× |
| MRI knee / leg joint (no contrast) | $153 | $3,825 | 25× |
| CBC blood test | $11 | $243 | 21.6× |
| EKG (electrocardiogram) | $29 | $579 | 20.3× |
| MRI brain (no contrast) | $161 | $3,055 | 18.9× |
| Upper GI endoscopy with biopsy | $422 | $7,311 | 17.3× |
| Colonoscopy (diagnostic) | $414 | $6,169 | 14.9× |

If `spread_ratio_label` is ever null, hide that row — never print "NaN×".

## Fix 3 — show low / MEDIAN / high (not just lowest), with the "why"

For every procedure, show all three numbers, labeled: `display.low` = "cheapest",
`display.median` = "typical", `display.high` = "most expensive". The median is
the honest everyday number; the lowest is a floor most people won't get.

Add the narrative that frames this as a system problem, not the patient's fault.
`stats.explanations` returns three ready strings — put `explanations.why_prices_differ`
as an intro paragraph at the top of the spread section, and show each item's
`item.why` sentence under its row (or on hover).

## Fix 4 — Chart 1 "One procedure, four different prices" (currently blank CPT/hospital, "not published")

Fetch `GET /learn/price-breakdown?cpt=CODE` (default 45378). It now returns two
new objects — USE THESE so nothing is blank:

- `featured_hospital` — a real named hospital chosen because it has all price
  types. Currently for 45378: `{ "hospital": "Baylor Scott & White Medical Center - Frisco", "city": "Frisco", "list_price": 931.82, "negotiated_median": 556.9, "cash_price": 413.86, "payer_contracts": 657 }`
- `typical` — DFW-wide medians, always populated. Currently for 45378:
  `typical.display = { "list": "$5,548", "negotiated": "$876", "cash": "$2,774", "cash_low": "$414", "medicare": null }`

Rules for Chart 1:
- Title: use `procedure_name` and `cpt_code` — e.g. "Colonoscopy (CPT 45378) at
  Baylor Scott & White Frisco". NEVER render "(CPT ) at ," with blanks. If a
  value is missing, drop that clause.
- The four bars: prefer `featured_hospital` (list_price, negotiated_median,
  cash_price) so it's one real hospital. For any bar that is null on the featured
  hospital, fall back to the matching `typical` value. Format with commas.
- Medicare bar: use `typical.display.medicare`; if it is null (as for 45378),
  show "CMS benchmark: not available for this code" — do not print "not available
  for CPT ." with a blank code.
- The "cash is X% lower than list" line: compute from the two values you're
  actually displaying, only when both are present and list > 0; otherwise omit
  the sentence. (For Baylor Frisco: $414 vs $932 = 56% lower.)

## Fix 5 — Chart 3 "How a bill gets calculated" (currently "Not published")

Same `price-breakdown` data. Use `typical.display` for the four steps so
negotiated is never "Not published" when it exists:
- Chargemaster / list → `typical.display.list` ($5,548)
- Negotiated → `typical.display.negotiated` ($876)  ← this fixes "Not published"
- Cash → `typical.display.cash` ($2,774) or `typical.display.cash_low` ($414)
- Medicare → `typical.display.medicare`, else "not available for this code"

Show `procedure_name`; if you name a hospital use `featured_hospital.hospital`.

## Fix 6 — "Common procedures & price ranges" table (currently all "--")

One row per `stats.price_spread` item: `cpt_code`, `label`, `display.low` (Low),
`display.spread` (Spread), `display.high` (High). Clicking the code runs a live
search for that CPT. There are 15 real rows — none should be "--".

## Fix 7 — the interchangeable CPT picker

When the user picks a different procedure, refetch
`/learn/price-breakdown?cpt=NEWCODE` and repopulate Charts 1 and 3. If the
response has `validated: false`, show a small caption using its `validated_note`
("not yet bounds-validated") — but still show the numbers.

## Guardrails
- Never do price math in the frontend — every number has a `display` string.
- Never render a template with an empty slot (blank CPT, blank hospital, "$NaN",
  "-- to --"). If a value is null, use the `typical` fallback or omit that piece.
- Keep the clean visuals and all existing sections (the 3 laws, 6 steps, FAQ).
- Keep the "Computed from … 45 CFR 180 · updated {computed_at}" caption.

When done, list every file you changed and confirm no chart still shows NaN or a
blank cell.

## Fix 8 — the "Your rights / laws" section (make it DB-driven and expand it)

There is now a real, sourced dataset of patient-protection laws. Replace any
hardcoded law cards with data from `GET /learn/reference`. It returns:

```
{ "reference": [
  { "kind": "law",                       // "law" | "right"
    "title": "Hospital Price Transparency Rule",
    "jurisdiction": "US federal",        // or "Texas"
    "effective_date": "January 1, 2021",
    "citation": "45 CFR 180",
    "penalty": "Civil monetary penalties up to roughly $2M ...",  // may be null
    "summary": "Every hospital in the U.S. must publicly post ...",
    "detail": "This is the rule Hosparent is built on ...",
    "bullets": ["...", "...", "..."],
    "action": "Before you schedule anything non-emergency, look up ...",
    "sources": [ { "title": "CMS — Hospital Price Transparency", "url": "https://..." } ]
  }, ... ] }
```

There are currently **9 entries** (7 federal laws/rights + 2 Texas laws). Render
them as a card list in the "Your rights" / "laws" area:

- Card header: `title`, with small pills for `jurisdiction` and `effective_date`.
- `summary` as the lead sentence (bold/larger).
- `bullets` as a checklist.
- A highlighted "How to use it" block from `action` — this is the point of the
  whole section: turning each law into something the patient can DO.
- `citation` and `penalty` in small secondary text (skip penalty if null).
- A "Sources" row: render each `sources[].title` as a link to `sources[].url`,
  opening in a new tab. Every card must show its sources — that's what makes this
  credible to a clinician.

Add a filter/toggle for "Federal" vs "Texas" using `jurisdiction`, and optionally
group `kind: "law"` vs `kind: "right"`. Keep the existing clean card styling.

These are real, government-sourced facts — render them exactly as returned, do not
paraphrase the numbers or dates. When done, confirm the section lists all 9 entries
with working source links.
