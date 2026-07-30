# 🤖 Hoser — Autonomous Healthcare Finance Specialist

**Mission:** Make Hosparent the #1 DFW price transparency tool by continuously researching, diagnosing, and improving data quality.

---

## What Hoser Does

### 1. **Research**
- Discovers healthcare finance concepts autonomously (HOPD, ASC, Novitas, MRF regulations)
- Researches DFW hospitals, payer networks, competitor pricing
- Takes organized notes in Obsidian vault
- Tracks findings in `research_log.csv`

### 2. **Monitor**
- **Every 5 min:** Health checks (API endpoints, error rates, data freshness)
- **Every 12 hours:** Deep research on healthcare finance topics
- **Weekly:** Audit MRF compliance, flag stale hospitals, identify gaps

### 3. **Diagnose**
- Queries the database to find pricing anomalies, outliers, flagged prices
- Compares our prices to TryBilly, Turquoise, and other benchmarks
- Identifies bounds that are too tight or too loose

### 4. **Recommend**
- Suggests scraper targets (hospitals with missing data)
- Proposes bounds adjustments
- Recommends MRF re-scrapes for stale hospitals
- Flags data quality issues

### 5. **Document**
- Auto-populates Obsidian vault with structured notes
- Creates findings logs
- Tags all data with \`hoser_TIMESTAMP_SOURCE\` for audit trail

---

## Using Hoser

### Ask a Question

```bash
curl -X POST http://localhost:3001/hoser \
  -H "Content-Type: application/json" \
  -d '{"question":"What are the biggest pricing gaps between our data and TryBilly for DFW HOPDs?"}'
```

Response:
```json
{
  "answer": "Based on my research of DFW HOPDs...",
  "timestamp": "2026-07-16T14:23:45Z"
}
```

### View Research Findings

1. Open Obsidian app
2. Open vault: `C:\Users\Krish\Hosparent\hoser-knowledge`
3. Browse:
   - `/research` — Healthcare finance concepts
   - `/hospitals` — DFW facility profiles
   - `/scrapers` — Data scraping strategies
   - `/findings` — Key insights

### Check Hoser's Daily Work

```bash
# View health status
curl http://localhost:3001/health

# View research log
tail -20 hoser-knowledge/findings/daily_log.csv
```

---

## Data Insertion & Audit Trail

Every record Hoser recommends is tagged for audit:

```sql
-- Query what Hoser has added
SELECT price, payer_name, inserted_by, hoser_recommendation 
FROM prices 
WHERE inserted_by LIKE 'hoser_%'
LIMIT 10;

-- Delete only with explicit approval
-- UPDATE prices SET is_deleted = true WHERE id = XXX;
-- (Hoser will ask for approval first)
```

---

## Safety Guardrails

- ✅ **Read-only by default** — Hoser queries, researches, recommends
- ⚠️ **Consult before deleting** — No DELETE/DROP without human approval
- 🔐 **All inserts tagged** — Audit trail for every Hoser recommendation
- 🚫 **No PII** — Research focuses on procedures, pricing, and hospital operations

---

## System Prompt

See `hoser_agent.js:SYSTEM_PROMPT` for Hoser's full instructions, expertise areas, and communication style.

---

## Architecture

- **`hoser_agent.js`** — Main agent logic (research, diagnosis, recommendations)
- **`hoser_monitor.js`** — 24/7 monitoring loop (health checks, daily research)
- **`/hoser` endpoint** — API to ask Hoser questions directly
- **Obsidian vault** (`hoser-knowledge/`) — Structured knowledge base (Git-tracked)
- **`inserted_by` column** (prices table) — Audit trail for Hoser inserts

---

## Next Steps

1. **Hoser starts researching immediately** — monitoring runs 24/7
2. **Check findings daily** — view daily research logs in Obsidian vault
3. **Ask Hoser directly** — POST to `/hoser` with your questions
4. **Review recommendations** — Hoser tags all data suggestions with source
5. **Approve inserts** — When Hoser finds good data, you approve (he asks first)

---

*Hoser is autonomous. Let him research, discover, and improve Hosparent continuously.*
