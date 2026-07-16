// H-Dog v2 - Hosparent Chief of Staff (pulls live prices from localhost:3001)
require('dotenv').config();
const readline = require('readline');
const { Anthropic } = require('@anthropic-ai/sdk');

const client = new Anthropic();
const API = 'http://localhost:3001';
const history = [];

const SYSTEM = `You are H-Dog, Healthcare Price Transparency Chief of Staff for Hosparent, a DFW hospital pricing platform (48.6M prices, 46 hospitals).

When the user mentions a 5-digit CPT code, live data from the Hosparent database is attached to their message as [LIVE DB DATA] and [EPISODE BUNDLE] blocks. Use ONLY that data for prices - real hospital names, cash prices, Medicare rates. Never invent prices; if no live data is attached, say so and ask for the CPT code.

Your jobs:
1. Find and explain hospital markups (compare cash/gross price vs medicare rate).
2. Draft punchy 3-sentence pitches for self-insured employers (e.g. Angela Guillory at Oncor Electric).
3. Draft 60-second UGC video scripts from the same price gaps.

End every draft with: "Review before sending - nothing goes out without your approval."`;

async function liveData(text) {
  const codes = [...new Set(text.match(/\b\d{5}\b/g) || [])].slice(0, 2);
  let out = '';
  for (const code of codes) {
    try {
      const r = await fetch(API + '/search?q=' + code);
      if (r.ok) {
        const raw = await r.json();
        const rows = (Array.isArray(raw) ? raw : raw.value || []).slice(0, 12).map(h => ({
          hospital: h.hospital_name, city: h.city, cash: h.cash_price,
          gross: h.gross_price, medicare: h.medicare_facility_rate,
          payers: h.payer_count, procedure: h.standard_name
        }));
        if (rows.length) out += '\n\n[LIVE DB DATA CPT ' + code + ']\n' + JSON.stringify(rows);
      }
      const e = await fetch(API + '/episode/' + code);
      if (e.ok) out += '\n\n[EPISODE BUNDLE CPT ' + code + ']\n' + JSON.stringify(await e.json());
    } catch {
      out += '\n\n[Could not reach localhost:3001 for CPT ' + code + ' - is node server.js running?]';
    }
  }
  return out;
}

async function chat(input) {
  const extra = await liveData(input);
  history.push({ role: 'user', content: input + extra });
  const resp = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    system: SYSTEM,
    messages: history,
  });
  history.push({ role: 'assistant', content: resp.content });
  return resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function prompt() {
  rl.question('\nYou: ', async (input) => {
    if (input.trim().toLowerCase() === 'exit') { console.log('\nH-Dog signing off.'); rl.close(); return; }
    if (!input.trim()) return prompt();
    try {
      const answer = await chat(input);
      console.log('\nH-Dog:\n' + answer);
    } catch (err) {
      console.error('\nError: ' + err.message);
    }
    prompt();
  });
}

console.log('\nH-DOG v2 - Hosparent Chief of Staff');
console.log('Live DB: http://localhost:3001 (keep node server.js running in the other window)');
console.log('Type a question with a CPT code, e.g. "Analyze 47562 markups and draft a pitch for Angela at Oncor". Type exit to quit.\n');
prompt();
