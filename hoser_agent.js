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

const MODEL = 'claude-opus-4-8';

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

// Daily research routine - smart about what to research
async function dailyResearchRoutine() {
  console.log(`\n[Hoser] Starting daily research cycle...`);

  try {
    // 1. Check database coverage first
    const coverage = await runReadonlySql(`
      SELECT
        COUNT(DISTINCT hospital_id) as hospitals,
        COUNT(DISTINCT procedure_id) as procedures,
        COUNT(*) as total_prices,
        COUNT(DISTINCT CASE WHEN is_suspicious = true THEN 1 END) as flagged
      FROM prices
    `, { timeoutMs: 60000 });

    const stats = coverage.rows[0];
    console.log(`[Hoser] DB coverage: ${stats.hospitals} hospitals, ${stats.procedures} procedures, ${stats.total_prices} prices (${stats.flagged} flagged)`);

    // 2. Check what we've already researched
    const findingsLog = path.join(__dirname, 'hoser-knowledge/findings/daily_log.csv');
    let recentResearch = [];
    if (fs.existsSync(findingsLog)) {
      const lines = fs.readFileSync(findingsLog, 'utf8').split('\n').slice(-10);
      recentResearch = lines.map(l => l.split(',"')[0]).filter(Boolean);
    }

    // 3. Dynamically choose research based on coverage gaps (EMPLOYER MODEL)
    const topics = [
      // Insurance loopholes & denial reasons
      'What are the top 5 insurance denial reasons in Texas? How can employees appeal denied claims?',

      // Worst-case pricing scenarios
      'For a standard colonoscopy, what are ALL hidden costs? (facility fees, anesthesia, pathology, coding)',

      // Real employee stories (#1 priority)
      'Find 3-5 Reddit/news stories of employees overcharged for procedures. Extract: procedure, hospital, charged vs fair price, what they learned',

      // DFW market intelligence
      'Which DFW hospitals are most expensive for common procedures? Which are cheapest? Include Baylor, Methodist, Texas Health, UT Southwestern, Medical City',

      // Regulatory compliance
      'What Texas laws require hospitals to give price quotes upfront? Are they being followed? What happens if they do not comply?',

      // Education for employees (plain language)
      'Explain in simple terms for employees: deductible, out-of-pocket max, in-network vs out-of-network, co-insurance, how insurance denials work',

      // Billing modifiers & how they affect costs
      'What are the most common billing code modifiers (26, TC, PC)? How do they affect the final price employees pay?',

      // Medicare Advantage vs Traditional
      'How does Medicare Advantage differ from traditional Medicare? Which is cheaper for common procedures in DFW?',

      // Employer cost-saving strategies
      'What strategies do large employers use to reduce healthcare costs? Which ones actually work and save money?',

      // Payer network analysis
      'Which insurance plans (BCBS, UHC, Aetna, Cigna) have the largest provider networks in DFW? Which have cheapest rates for common procedures?',
    ];

    // Pick a topic we haven't researched recently
    const topic = topics.find(t => !recentResearch.some(r => r.includes(t.substring(0, 50))))
      || topics[Math.floor(Math.random() * topics.length)];

    console.log(`[Hoser] Researching: ${topic.substring(0, 80)}...`);

    const result = await hoserResearch(topic);

    // Log with topic + answer
    if (!fs.existsSync(path.dirname(findingsLog))) {
      fs.mkdirSync(path.dirname(findingsLog), { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const answer = (result.answer || '').slice(0, 200).replace(/"/g, "'");
    const entry = `${timestamp},"${topic.substring(0, 100)}","${answer}..."\n`;
    fs.appendFileSync(findingsLog, entry, 'utf8');
    console.log(`[Hoser] Findings logged`);

    return result;
  } catch (e) {
    console.error(`[Hoser] Research cycle failed:`, e.message);
    return { error: e.message };
  }
}

// Health check routine
async function healthCheckRoutine() {
  console.log(`[Hoser] Running health check...`);

  try {
    const result = await runReadonlySql(`
      SELECT
        (SELECT COUNT(*) FROM prices WHERE is_suspicious = true) as flagged_prices,
        (SELECT COUNT(*) FROM prices) as total_prices,
        (SELECT COUNT(*) FROM cpt_price_bounds) as bounds_count
    `, { timeoutMs: 5000 });

    console.log(`[Hoser] Health status:`, result.rows[0]);
    return result.rows[0];
  } catch (e) {
    console.error(`[Hoser] Health check failed (non-blocking):`, e.message);
    return { error: e.message };
  }
}

module.exports = { hoserResearch, initObsidianVault, dailyResearchRoutine, healthCheckRoutine };



