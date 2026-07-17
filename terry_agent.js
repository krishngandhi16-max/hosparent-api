// terry_agent.js — "Terry," the research agent behind the Learn tab.
//
// Job: catalog the genuine complexity/confusion baked into US healthcare billing —
// place-of-service codes, prior-authorization denials, facility fees, balance billing,
// EOB-vs-bill confusion, chargemaster vs. negotiated rates, claim denial tactics — and
// write each one up as a plain-English Obsidian note. This is the "why Hosparent exists"
// awareness layer: before someone pays for price transparency, they need to understand
// the problem it solves. Indy (indy_agent.js) later turns these notes into ad angles.
//
// Runs as a scheduled BATCH (run_terry_batch.js), not a continuous loop — a handful of
// topics per run keeps this off the cost hot path, same reasoning as
// refresh_insurance_news.js. Each note gets YAML frontmatter + [[wikilinks]] to related
// notes so the vault is genuinely Obsidian-browsable, not just a folder of text files.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AnthropicPkg = require('@anthropic-ai/sdk');
const Anthropic = AnthropicPkg.default || AnthropicPkg;

const MODEL = 'claude-opus-4-8'; // needs real web research quality; batched to control cost
const VAULT_DIR = process.env.TERRY_VAULT_DIR || path.join(__dirname, 'obsidian_vault');

const SYSTEM_PROMPT = `You are Terry, a researcher documenting how US healthcare billing
and insurance actually work — specifically the parts that confuse or disadvantage
patients. Use web_search to ground every claim in a real, citable source (CMS.gov,
academic/journalism sources, state Department of Insurance pages, etc.) — never invent a
fact or statistic.

For the given topic, write a single Obsidian note:
1. A YAML frontmatter block: title, tags (kebab-case, e.g. billing-complexity, pos-codes),
   researched_at (today's date), sources (list of URLs actually used).
2. Plain-English body a non-expert patient can follow: what it is, why it exists, how it's
   used against patients in practice (with a concrete example if you find one), and what a
   patient can actually do about it.
3. A "## Related" section at the end listing 2-4 [[Other Topic Title]] wikilinks to
   plausible related notes (facility fees, balance billing, prior authorization, EOB
   confusion, chargemaster pricing, network adequacy, claim appeals, surprise billing,
   upcoding, etc.) even if that note doesn't exist yet — Obsidian resolves them once it does.

Output ONLY the markdown note, starting with the frontmatter block. No commentary outside it.`;

let _client;
function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic();
  }
  return _client;
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function researchTopic(topic) {
  const client = getClient();
  const result = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 3072,
    system: SYSTEM_PROMPT,
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    messages: [{ role: 'user', content: `Research and write the note for: ${topic}` }],
  });
  const note = (result.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
  const filePath = path.join(VAULT_DIR, `${slugify(topic)}.md`);
  fs.writeFileSync(filePath, note, 'utf8');
  return { topic, filePath, chars: note.length };
}

function alreadyResearched(topic) {
  const filePath = path.join(VAULT_DIR, `${slugify(topic)}.md`);
  return fs.existsSync(filePath);
}

// Seed topics — real patterns patients run into, not exhaustive. POS codes are the
// concrete example that kicked this off: the same visit gets billed completely
// differently depending on a two-digit code (11 = office, 22 = on-campus hospital
// outpatient, 23 = ER) that the patient never sees and didn't choose.
const SEED_TOPICS = [
  'Place of Service (POS) codes and why the same visit bills differently by facility type',
  'Facility fees: why an on-campus hospital outpatient visit costs more than the identical office visit',
  'Prior authorization denials and how insurers use them to delay or avoid paying claims',
  'Balance billing and the gaps the No Surprises Act does not close',
  'Chargemaster prices vs. negotiated rates vs. cash price: why one hospital has four different prices for the same CPT code',
  'How to read an Explanation of Benefits (EOB) and why it is not a bill',
  'Claim denial codes and the internal-appeal process most patients never use',
  'Network adequacy: how "in-network" directories list doctors who are not actually taking new patients',
  'Upcoding and billing modifiers: how a routine visit becomes a higher-paying code',
  'ERISA vs. ACA marketplace vs. Medicare: why patient rights after a denial depend on plan type',
];

async function runBatch(topics = SEED_TOPICS, { skipExisting = true, limit = 3 } = {}) {
  const todo = topics.filter((t) => !skipExisting || !alreadyResearched(t)).slice(0, limit);
  const results = [];
  for (const topic of todo) {
    try {
      results.push(await researchTopic(topic));
    } catch (e) {
      results.push({ topic, error: e.message });
    }
  }
  return results;
}

module.exports = { researchTopic, runBatch, alreadyResearched, SEED_TOPICS, VAULT_DIR };
