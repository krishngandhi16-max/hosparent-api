# UI change requests (paste into the Replit Agent)

The office drafts UI changes here because it cannot edit the Replit app
directly. Each request below is written to be pasted into the Replit Agent as
one message. Delete a request once it has been applied.

---

## 1. Learn tab: charts must read /learn/stats — no hardcoded numbers

Paste this into the Replit Agent:

> The Learn tab now shows charts and statistics. Rewire every chart and every
> displayed number so it comes from the API, never from hardcoded values:
>
> 1. Fetch `GET /learn/stats` from the backend (same base URL as the other
>    API calls). The response shape is:
>
>    ```json
>    {
>      "coverage": { "hospitals": 44, "valid_prices": 0, "procedures": 0,
>                    "last_mrf_refresh": "2026-07-20", "drug_prices": 0,
>                    "cash_bundles": 0 },
>      "price_spread": [
>        { "cpt_code": "45378", "label": "Colonoscopy (diagnostic)",
>          "cash":       { "min": 0, "median": 0, "max": 0, "hospitals": 0, "price_rows": 0 },
>          "negotiated": { "min": 0, "median": 0, "max": 0, "hospitals": 0, "price_rows": 0 },
>          "gross":      { "min": 0, "median": 0, "max": 0, "hospitals": 0, "price_rows": 0 } }
>      ],
>      "methodology": "…", "computed_at": "…"
>    }
>    ```
>
>    A price type key may be absent for some procedures — handle that.
>
> 2. Price-spread charts: use `price_spread` (min/median/max per price type).
>    Good default: a horizontal range bar per procedure showing cash min→max
>    with a median marker.
>
> 3. Coverage stats ("44 hospitals", "48M prices", etc.): use `coverage`.
>    Never type these numbers into the code — they change with every refresh.
>
> 4. Under every chart, render the caption: "Computed from hospital
>    machine-readable price files (45 CFR 180) in our database · refreshed
>    {coverage.last_mrf_refresh}". Use the `methodology` string in a tooltip
>    or footnote.
>
> 5. Delete any number, percentage, or statistic on the Learn tab that does
>    not come from `/learn/stats`, `/learn/content`, or `/learn/insurance-news`.
>    If a chart's data has no API source, remove the chart rather than keep a
>    made-up one.
>
> When done, list every file you changed and every hardcoded number you
> removed.
