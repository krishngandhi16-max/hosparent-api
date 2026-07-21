# UI change requests (paste into the Replit Agent)

The office drafts UI changes here because it cannot edit the Replit app
directly. Paste each block below into the Replit Agent as one message, in
order. Delete a block once it has been applied.

---

## 1. URGENT — fix the blank/white screen on the Learn tab

Paste this into the Replit Agent:

> The Learn tab renders a blank white screen — a component is throwing during
> render and taking the whole app down. Fix it in two ways:
>
> 1. Add a React error boundary that wraps the page routes (a class component
>    with componentDidCatch / getDerivedStateFromError). When a child throws,
>    it shows a small "Something went wrong on this page. Reload." card with a
>    reload button — it must NEVER blank the entire app. This is the safety net
>    so a single bad value can never white-screen the site again.
>
> 2. Fix the actual crash: the Learn tab reads price data that can be null.
>    The backend endpoints (/learn/stats and /learn/price-breakdown) now always
>    return the keys `cash`, `negotiated`, and `gross`, but any of the three can
>    be `null` when that procedure has no price of that type. Anywhere the code
>    does something like `summary.negotiated.median` or `.toLocaleString()` /
>    `.toFixed()` on a price, guard it: use optional chaining
>    (`summary.negotiated?.median`), skip or render "not published" when the
>    value is null, and never call a number method on null/undefined. Also
>    check `has_data` on each price-breakdown / price_spread item and render an
>    empty state when it is false. Guard every `.map()` with `(arr ?? [])` and
>    handle a non-OK fetch response (show the error state, don't destructure
>    undefined).
>
> After the fix, load the Learn tab with a CPT that has partial data and
> confirm it renders instead of blanking. List every file you changed.

---

## 2. Search results — make it feel like Kayak/Amazon, and stop leading with a misleading "lowest price"

Paste this into the Replit Agent:

> Redesign the search results from a spreadsheet-style table into a ranked list
> of result cards, like Kayak or Amazon. Keep all existing data and API calls
> (`GET /search?q=...`) — this is a presentation change that surfaces MORE of
> the data we already return, not fewer.
>
> **The core problem to fix:** we currently headline a single "lowest price."
> That number is the single cheapest cash line item anywhere — a floor most
> patients will not actually get — so it is misleading. Replace it with a
> range anchored on a typical price.
>
> The `/search` response already includes, per hospital row: `hospital_name`,
> `city`, `cash_price` (lowest cash), `median_cash_price` (typical cash),
> `negotiated_price` (lowest negotiated), `median_negotiated_price`,
> `gross_price` (list price), `payer_count`, `medicare_facility_rate`,
> `medicare_non_facility_rate`, `leapfrog_grade`, `cms_rating` (1–5 stars),
> `google_rating`, `google_review_count`, `hospital_phone`, `full_address`,
> `google_maps_url`, `latitude`, `longitude`, `is_compliant`,
> `mrf_last_updated`, `procedure_variant_count`, `cpt_code`, `standard_name`.
>
> **At the top of results — a summary band (not a single number):**
> - "Cash price across N hospitals: as low as ${min} · typically ~${median} ·
>    up to ${max}". Compute min/median/max across the returned rows' cash
>    prices. The word "typically" uses the median, shown most prominently.
> - A one-line Medicare anchor when available: "Medicare pays about ${rate}
>    for this" so people have a reference point.
> - Small caption: "Lowest = the single cheapest listed cash price; you may not
>    qualify for it. Typical = the median across hospitals."
>
> **Each result as a card (sorted cheapest cash first), showing many metrics
> without clutter:**
> - Hospital name + city, and distance if we can compute it from lat/long vs
>   the user (optional; skip if no user location).
> - The price block: that hospital's cash price as the headline, with a price
>   type badge ("cash / self-pay"). Below it in smaller text: negotiated
>   (insurance) price and list price when present, each badged. If a value is
>   null, show "not published" rather than $0 or blank.
> - Trust/quality chips: CMS star rating (render as stars), Leapfrog safety
>   grade, Google rating + review count, and `payer_count` as "N insurance
>   rates published". A "prices verified {mrf_last_updated}" freshness line.
> - Actions: call button (hospital_phone), directions (google_maps_url).
> - The single cheapest card gets a subtle "lowest listed" tag — muted, not a
>   giant green banner — and only that card.
>
> **Sort/filter bar like Kayak:** sort by cash price, by typical (median)
> price, by CMS rating, by Google rating. A toggle to show list/negotiated
> prices. Keep it one row, calm, sentence case.
>
> **Integrity guardrails (do not break these):**
> - Never invent a number. If a field is null, say "not published".
> - Never present the lowest price as "the price" — always pair it with the
>   typical/median and the source count.
> - Keep the price-type badge on every price so cash, negotiated, and list are
>   never confused for each other.
> - Keep a source + freshness line on every card.
>
> Match the existing design system (fonts, teal primary, cards). Responsive:
> cards stack on mobile, the summary band never overflows. List every file you
> changed.

---

## 3. Learn tab charts must read /learn/stats and /learn/price-breakdown (no hardcoded numbers)

Paste this into the Replit Agent (if not already applied):

> Every number and chart on the Learn tab must come from the API, never
> hardcoded. Use `GET /learn/price-breakdown?cpt=CODE` for the interchangeable
> per-CPT chart and `GET /learn/stats` for overview stats. Response shapes:
>
> - price-breakdown: `{ cpt_code, procedure_name, has_data, summary: { cash,
>   negotiated, gross }, by_hospital: [{ hospital, city, list_price,
>   negotiated_median, negotiated_min, cash_price, payer_contracts }],
>   medicare: { asc_rate, hospital_opps_rate, source } | null, cash_bundles,
>   methodology, computed_at }`. Each `summary` key is either
>   `{ min, median, max, hospitals, price_rows }` or `null`.
> - stats: `{ coverage: { hospitals, valid_prices, procedures,
>   last_mrf_refresh, drug_prices, cash_bundles }, price_spread: [{ cpt_code,
>   label, has_data, cash, negotiated, gross }], methodology, computed_at }`.
>
> For the "one procedure, four prices at the same hospital" chart, use a single
> entry from `by_hospital` and show that hospital's real name — never mix
> prices from different hospitals as if they were one. Show the Medicare figure
> labeled as a CMS benchmark rate, not a hospital-published price. Under each
> chart, caption: "Computed from hospital machine-readable price files
> (45 CFR 180) · refreshed {computed_at date}". While loading show skeletons;
> on error show a retry button; never fall back to invented numbers. Delete
> every hardcoded price/percentage/statistic, including the old colonoscopy
> example (2500/1420/600/414). List every hardcoded number you removed.
