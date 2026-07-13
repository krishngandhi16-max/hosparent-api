# Hosparent Cleaning Pipeline

Re-runnable, non-destructive evaluation of every price row (48.6M) against
per-procedure evidence. Built to the project's hard rules:

1. **Never assume schema** — every stage introspects `information_schema` and
   aborts loudly if a table/column it needs is missing. Nothing assumes
   `prices.billing_code` exists (it doesn't; CPT is `prices.procedure_id →
   procedures.cpt_code`).
2. **Count → apply → verify** — every destructive step prints the exact row
   count it will hit, applies, then re-queries to prove it landed.
3. **Batched** — all UPDATEs on `prices` walk id ranges (500K default), never
   one unbounded statement.
4. **Flags, not deletes** — only `is_suspicious`, `validation_reason`
   (prefixed `AUDIT:`), `procedures.setting`, `procedures.mapping_confidence`
   are written. Nothing is deleted; every AUDIT flag is reversible and
   self-corrects on re-run.
5. **Don't hide real prices** — high prices whose names correctly match their
   CPT are NOT auto-flagged; they land in `audit_review_queue` for a human.

## Run order (from project root, where .env lives)

```bash
node pipeline/00_preflight.js            # read-only health report. ALWAYS first.
node pipeline/01_audit.js                # dry run: shows what would be flagged
node pipeline/01_audit.js --apply        # actually flag (batched + verified)
node pipeline/02_rebuild_summaries.js        # build *_new summary tables
node pipeline/02_rebuild_summaries.js --swap # swap them live (old kept as *_old)
# restart server.js
node pipeline/03_verify_live.js          # pre-demo gate: gallbladder/knee clean?
node pipeline/03_verify_live.js --base https://api.hosparent.com
```

Undoing the old blunt 20x pass from fix_all_leaks.js: run preflight, find the
exact `validation_reason` string it wrote (top-reasons list), then:

```bash
node pipeline/01_audit.js --apply --unflag-pattern "<that reason>%"
```

Rows matching the pattern that the smarter banded audit does NOT re-flag get
un-flagged; real garbage gets re-flagged with an `AUDIT:` reason.

## Why banded thresholds instead of flat 20x

Charge-to-Medicare multiples vary hugely by price magnitude: a $12 lab billed
at $400 gross (33x) is ordinary chargemaster behavior; a $1,165 knee
replacement professional fee billed at $44K (38x) is a DRG bundle leak. Flat
20x both over-flags small-dollar codes and needs name evidence for big ones:

| Medicare benchmark | flag above |
|---|---|
| ≤ $50 | 80x |
| ≤ $200 | 50x |
| ≤ $1,000 | 30x |
| > $1,000 | 20x |

…and only when the price also exceeds its own cohort's p75 × 4 AND the
procedure name does NOT match its CPT description (otherwise → review queue).

## Remote mode (DB bridge)

Every stage can also run from a machine that can't reach Postgres directly
(e.g. a remote Claude session), through `dbbridge.js` + a Cloudflare quick
tunnel running on the DB host:

```bash
BRIDGE_URL=https://<random>.trycloudflare.com BRIDGE_TOKEN=<token> node pipeline/00_preflight.js
```

On the DB host (PowerShell), start/restart the bridge with:

```powershell
cd C:\Users\krish\hosparent
Start-Process powershell -ArgumentList '-NoExit','-Command','cd C:\Users\krish\hosparent; node dbbridge.js'
Start-Process powershell -ArgumentList '-NoExit','-Command','cloudflared tunnel --url http://localhost:3999'
Get-Content .env | Select-String DBBRIDGE_TOKEN   # the token to hand to the remote side
```

The quick-tunnel URL CHANGES on every restart — send the new URL each time.
Closing both windows kills all remote access. The `node dbbridge.js` window
logs every query it executes.

## Outputs

- `pipeline/reports/*.json` — every run writes a timestamped report (gitignored).
- `audit_review_queue` (table) — cohorts needing a human call.
- `cpt_price_summary`, `payer_price_summary` — rebuilt per hospital×CPT(×payer),
  clean rows only, with `bundling_signal` ('lean' pro-fee feeds vs 'inclusive'
  facility-loaded feeds).
- `cpt_ui_catalog` — one row per CPT for the UI: display name, hospital count,
  best/median cash + negotiated, medicare rate, `bundle_key` +
  `bundle_components` linking related CPTs (knee episode, gallbladder episode,
  …). Merge `episode_rulebook.js` bundles here when it's committed.
