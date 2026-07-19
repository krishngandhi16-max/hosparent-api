# Run the whole office for ~$0/month — cheap/free LLM setup

Researched July 2026. The office no longer needs Anthropic credits: every agent
now runs on whichever free/cheap provider you configure in `.env`, with Claude
only as an optional fallback.

## TL;DR — do this (5 minutes, $0)

1. Go to **console.groq.com** → sign up (no credit card) → create an API key.
2. Add one line to `C:\Users\Krish\Hosparent\.env`:
   ```
   GROQ_API_KEY=gsk_your_key_here
   ```
3. Restart the server. Done — Hoser, the office, Terry, and the CPT audit all
   run on Groq's free tier automatically. `hoser_unflag.js` doesn't use ANY
   model anymore (it was one SQL statement being routed through a paid LLM —
   that's fixed).

You already have `PERPLEXITY_API_KEY`, which covers all web research (Indy's
stories, Learn content, and now the office's web_search tool too).

## What each provider actually costs (verified July 2026)

| Provider | Free tier | Paid price (per 1M tokens) | Good for |
|---|---|---|---|
| **Groq** ✅ recommended | Llama 3.3 70B: 1,000 req/day. Llama 3.1 8B: 14,400 req/day. No card. | very cheap if you ever upgrade | Office chat + bulk work, $0 |
| **Google Gemini** | Flash: 250–1,500 req/day free, no card | Flash-Lite: $0.10 in / $0.40 out | Backup free tier; huge context |
| **DeepSeek** | 5M free tokens for new accounts | V4 Flash: ~$0.14 in / $0.28 out | Cheapest real paid API |
| **OpenRouter** | 50 req/day free; 1,000/day after a one-time $10 credit | varies | One key → 28+ free models |
| **Kimi (Moonshot)** | **API has NO free tier** ($1 min). The free thing is their chat app, not the API. | K2.5: $0.60 in / $3.00 out | Not the cheap option you heard |
| **Ollama (local)** | 100% free forever, runs on your PC | — | Offline/bulk, needs a decent GPU |
| Anthropic (old setup) | none | Haiku $1 in / $5 out; Sonnet $3 / $15 | Fallback only now |

**About Kimi:** the "Kimi is free" thing you heard is their consumer chat app
(kimi.com). Their **API** — what your code would call — has no free tier at all
and is pricier than DeepSeek. So it's not the answer here; Groq free is.

`.env` config options (all optional beyond the one key):

```
GROQ_API_KEY=...        # or GEMINI_API_KEY / DEEPSEEK_API_KEY / OPENROUTER_API_KEY / MOONSHOT_API_KEY
LLM_PROVIDER=groq       # force a provider when multiple keys are set
LLM_MODEL=...           # override the smart-tier model
LLM_MODEL_BULK=...      # override the bulk-tier model
```

## What changed in the code

| File | Before | Now |
|---|---|---|
| `hoser_unflag.js` | Paid Claude to run one SQL statement (this is the step that failed with "credit balance too low") | Pure SQL. **$0, no API key needed at all.** `fix_whole_db.js` now completes end-to-end with zero credits. |
| `llm.js` (new) | — | One client for Groq/Gemini/DeepSeek/OpenRouter/Kimi/Ollama. Auto-detects from `.env`, retries politely on free-tier rate limits. |
| `db_agent.js` (Hoser / the office) | Claude Sonnet 5 only | Runs on the free provider with the same tools (SQL, diagnose, safe fixes, live-API check) + Perplexity web search. Claude only if no cheap key is set. |
| `audit_cpt_mapping.js` | 1 Haiku call **per pair** × 265K pairs = the 23-hour, credit-draining run | Batches of 20 per call (20× fewer calls), capped at 5,000 pairs/run (`--limit N`, `--limit 0` = no cap), **resumable** — reviewed pairs are saved and skipped on re-run, so you never pay for the same pair twice. |
| `terry_agent.js` | Haiku drafts posts | Free provider drafts posts; Haiku fallback. |
| Indy / research | Already on your Perplexity key | Unchanged (that was already the cheap path). |

## Monthly cost estimate for your actual workload

- Office chat (a few dozen questions/day): **$0** (Groq free tier: 1,000/day)
- Daily Indy research + Terry drafts: **$0** on Groq + pennies on Perplexity
- `fix_whole_db.js` (validate/unflag/verify): **$0** — no LLM in it anymore
- Full 265K-pair CPT audit, if you ever want to finish it: batched it's ~13K
  calls. On Groq 8B free (14.4K req/day) that's **$0 in about 1–2 days** of
  `node audit_cpt_mapping.js --llm --apply --limit 0`, resumable. On DeepSeek
  paid it's roughly **$5–10 one-time** if you want it done in an hour.

Total: **$0/month** for normal operation — well under your $30–40 budget, and
you only ever pay if you deliberately run the giant audit on a paid provider.

## Do you even need the big LLM audit?

Right now: **no.** The verify manifest passed **106/106 CPTs** after the SQL
steps — your searchable data is clean. The LLM audit's only job is fixing CPT
labels on long-tail supply items (`SUP-*` codes etc.) that mostly aren't in
your 106 bounded CPTs anyway. Run it later, capped, on the free tier — or not
at all.

Sources: [Groq free-tier limits](https://tokenmix.ai/blog/groq-free-tier-limits-2026) · [Groq rate-limit docs](https://console.groq.com/docs/rate-limits) · [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) · [DeepSeek pricing docs](https://api-docs.deepseek.com/quick_start/pricing/) · [Kimi API pricing](https://platform.kimi.ai/docs/pricing/chat) · [Kimi pricing overview](https://benchlm.ai/moonshot/api-pricing) · [OpenRouter free models](https://openrouter.ai/collections/free-models) · [OpenRouter rate limits](https://openrouter.ai/docs/api_reference/limits)
