// hoser_agent.js — Autonomous healthcare finance specialist
// Researches, diagnoses, learns, and recommends improvements 24/7
//
// Hoser's personality: Healthcare finance expert, data detective, proactive advisor
// Mission: Make Hosparent the DFW #1 price transparency tool

const AnthropicPkg = require('@anthropic-ai/sdk');
const Anthropic = AnthropicPkg.default || AnthropicPkg;
const { pool, runReadonlySql, ensureBoundsColumns } = require('./db');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are **Hoser**, Hosparent's autonomous healthcare finance specialist. Your mission: make Hosparent the DFW #1 price transparency tool by continuously researching, diagnosing, and improving data quality.

## Your Expertise

- **Healthcare Finance:** HOPD (Hospital Outpatient Department), ASC (Ambulatory Surgical Center), FQHC (Federally Qualified Health Center), bundled payments, DRGs, payer networks
- **Transparency Regulations:** Medicare Transparency Rule, MRF (Machine-Readable Files), state-mandated pricing laws
- **DFW Market:** Texas hospitals, Novitas (Medicare contractor), commercial payers (BCBS, UHC, Aetna, Cigna)
- **Data Quality:** Identifying bounds gaps, flagged prices, stale MRF data, competitor pricing comparisons

## Your Autonomy

1. **Research freely:** Web search, YouTube, Reddit forums, healthcare journals, CMS docs. Discover new concepts (HOPD, ASC models, payer strategies) and analyze relevance to Hosparent.
2. **Diagnose:** Run database queries to find pricing anomalies, outlier hospitals, stale data.
3. **Recommend:** Suggest scraper targets, bounds adjustments, MRF re-scrapes, competitor benchmarks.
4. **Document:** Auto-populate Obsidian vault with structured notes, findings, and applicability.
5. **Tag inserts:** Every data point you recommend includes a \`hoser_TIMESTAMP_SOURCE\` tag for audit.
6. **Ask before deleting:** Always consult the human before DELETE/DROP operations.

## Tools Available

- \`run_readonly_sql\`: Query the database (SELECT only)
- \`diagnose_price\`: Deep-dive on a CPT/hospital combination
- \`web_search\`: Research healthcare finance, regulations, competitors, hospital data
- \`research_dfw_hospitals\`: Discover DFW facilities (HOPD, ASC, FQHC status, MRF links)
- \`analyze_novitas_contracts\`: Look up Novitas Medicare contractor coverage areas
- \`suggest_scraper_targets\`: Recommend next hospitals/data sources to scrape

## Communication Style

- Professional, detail-oriented, proactive
- Lead with findings and recommendations, not questions
- Show your work: "I found X, here's why it matters, suggest Y"
- Reference data sources: "Per CMS docs...", "Novitas contractor for DFW...", "Found on hospital X MRF..."

## Guardrails

- Every recommendation is traceable (source + relevance)
- No destructive operations without explicit human approval
- Respect data privacy: no PII, no individual patient data
- Focus on Hosparent's core mission: hospital procedure + drug pricing transparency

Go autonomous. Report findings daily.`;

async function hoserResearch(question) {
  const client = new Anthropic();

  const tools = [
    {
      type: 'web_search_20260209',
      name: 'web_search',
    },
    {
      type: 'custom',
      name: 'run_readonly_sql',
      description: 'Query the database (SELECT only) to diagnose pricing issues.',
      input_schema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SELECT query only' }
        },
        required: ['sql']
      }
    }
  ];

  const messages = [{ role: 'user', content: String(question || '') }];

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    const answer = (response.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    return { answer, model: MODEL, timestamp: new Date().toISOString() };
  } catch (e) {
    return { error: e.message, timestamp: new Date().toISOString() };
  }
}

// Auto-create Obsidian vault structure
function initObsidianVault() {
  const vaultRoot = path.join(__dirname, 'hoser-knowledge');

  if (!fs.existsSync(vaultRoot)) {
    fs.mkdirSync(vaultRoot, { recursive: true });
  }

  const structure = {
    'README.md': `# Hoser Knowledge Vault

Autonomous healthcare finance research & insights for Hosparent.

## Topics
- [\`/research\`](./research) - Healthcare finance concepts (HOPD, Novitas, MRF, payers)
- [\`/hospitals\`](./hospitals) - DFW facility profiles & MRF data
- [\`/scrapers\`](./scrapers) - Data scraping strategies & targets
- [\`/findings\`](./findings) - Key insights & applicability

---
*Last updated: ${new Date().toISOString()}*
*Maintained by Hoser*`,

    'research/HOPD.md': `# HOPD (Hospital Outpatient Department)

## Definition
Hospital-based outpatient services. Distinct from physician offices and ASCs. Subject to Medicare Transparency Rule (CMS-required MRF publication).

## Relevance to Hosparent
- Major pricing variance (often higher than ASC equivalents)
- Subject to regulatory pricing disclosure
- Key DFW market segment (Baylor, Methodist, etc.)
- Primary target for MRF scraping

## DFW HOPDs
[To be auto-populated by Hoser research]`,

    'research/Novitas.md': `# Novitas (Medicare Contractor)

## Definition
Regional Medicare Administrative Contractor serving Texas, Oklahoma, Kansas, Louisiana. Manages LCD (Local Coverage Determinations) and payer policies for Medicare Part B.

## Relevance to Hosparent
- Controls Medicare reimbursement rates in DFW
- Influences negotiated rates (payers benchmark to Medicare)
- LCDs determine coverage (which procedures are covered, coding requirements)
- Key source for competitor benchmarking

## DFW Coverage
[To be auto-populated by Hoser research]`,

    'hospitals/README.md': `# DFW Hospital Profiles

Hospital-by-hospital research: size, HOPD status, MRF compliance, pricing patterns.

[Auto-populated by Hoser]`,

    'scrapers/README.md': `# Scraping Targets & Strategies

Recommended hospitals to scrape, data sources, and techniques.

[Auto-populated by Hoser based on coverage gaps]`,

    'findings/README.md': `# Key Findings & Insights

Research findings, patterns, and recommendations for Hosparent improvement.

[Auto-populated by Hoser as discoveries emerge]`,
  };

  for (const [filePath, content] of Object.entries(structure)) {
    const fullPath = path.join(vaultRoot, filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, content, 'utf8');
    }
  }

  console.log(`[Hoser] Obsidian vault initialized at ${vaultRoot}`);
  return vaultRoot;
}

// Daily research routine
async function dailyResearchRoutine() {
  console.log(`\n[Hoser] Starting daily research cycle...`);

  const topics = [
    'What are the key differences between HOPD and ASC pricing in Texas? How do Novitas rates influence Hosparent\'s DFW data?',
    'Which DFW hospitals have recently updated their MRFs? Are there gaps in our current coverage?',
    'What are the top 5 most expensive procedures in the DFW HOPD market, and how do our prices compare to TryBilly?',
  ];

  const topic = topics[Math.floor(Math.random() * topics.length)];
  console.log(`[Hoser] Researching: ${topic}`);

  const result = await hoserResearch(topic);

  // Auto-append to findings log
  const findingsLog = path.join(__dirname, 'hoser-knowledge/findings/daily_log.csv');
  const timestamp = new Date().toISOString();
  const entry = `${timestamp},"${topic}","${(result.answer || '').slice(0, 100)}..."\n`;

  if (!fs.existsSync(path.dirname(findingsLog))) {
    fs.mkdirSync(path.dirname(findingsLog), { recursive: true });
  }

  fs.appendFileSync(findingsLog, entry, 'utf8');
  console.log(`[Hoser] Findings logged to ${findingsLog}`);

  return result;
}

// Health check routine
async function healthCheckRoutine() {
  console.log(`[Hoser] Running health check...`);

  try {
    const result = await runReadonlySql(`
      SELECT
        (SELECT COUNT(*) FROM prices WHERE is_suspicious = true) as flagged_prices,
        (SELECT COUNT(DISTINCT hospital_id) FROM prices) as hospital_count,
        (SELECT COUNT(DISTINCT procedure_id) FROM prices) as procedure_count,
        (SELECT COUNT(DISTINCT cpt_code) FROM cpt_price_bounds) as bounds_count
    `);

    console.log(`[Hoser] Health status:`, result.rows[0]);
    return result.rows[0];
  } catch (e) {
    console.error(`[Hoser] Health check failed:`, e.message);
    return { error: e.message };
  }
}

module.exports = { hoserResearch, initObsidianVault, dailyResearchRoutine, healthCheckRoutine };
