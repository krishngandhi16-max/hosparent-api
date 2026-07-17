#!/usr/bin/env node
// prereg_agent.js - Pre-registration coordinator
// Monitors new pricing data and emails users when their location has updates
require('dotenv').config();
const { pool } = require('./db');
const AnthropicPkg = require('@anthropic-ai/sdk');
const Anthropic = AnthropicPkg.default || AnthropicPkg;
const { betaTool } = require('@anthropic-ai/sdk/helpers/beta/json-schema');

const MODEL_CHEAP = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are Hosparent's Pre-Registration Coordinator. Your job:
1. Monitor when new pricing data arrives for regions where people pre-registered
2. Identify which CPTs (procedures) are newly available
3. Compose friendly emails encouraging them to explore pricing
4. Track what's been emailed (no duplicates)
5. Report coverage expansion progress

Be smart: if 100 people pre-registered for Dallas and Colonoscopies just got prices,
tell them "100 Dallasite found pricing for colonoscopies!"

HIPAA-safe: never mention individual patient records, only aggregate procedure availability.`;

async function buildTools() {
  return [
    betaTool({
      name: 'get_prereg_emails',
      description: 'Get emails by city/state that pre-registered',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          state: { type: 'string' },
        },
        required: ['city', 'state'],
        additionalProperties: false,
      },
      run: async ({ city, state }) => {
        const r = await pool.query(
          `SELECT email, registered_at FROM prereg_emails WHERE city ILIKE $1 AND state ILIKE $2 AND opted_in = true ORDER BY registered_at DESC`,
          [city, state]
        );
        return JSON.stringify({ count: r.rows.length, sample: r.rows.slice(0, 5) });
      },
    }),

    betaTool({
      name: 'get_new_cpts_for_city',
      description: 'Find CPTs with new pricing data for a city in last N days',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          days: { type: 'number', description: 'Last N days (default 7)' },
        },
        required: ['city'],
        additionalProperties: false,
      },
      run: async ({ city, days = 7 }) => {
        const r = await pool.query(`
          SELECT DISTINCT p.cpt_code, p.standard_name, COUNT(DISTINCT pr.hospital_id)::int AS hospitals,
            MIN(pr.price)::int AS min_price, MAX(pr.price)::int AS max_price
          FROM procedures p
          JOIN prices pr ON pr.procedure_id = p.id
          JOIN hospitals h ON h.id = pr.hospital_id
          WHERE h.city ILIKE $1
            AND pr.is_suspicious IS NOT TRUE
            AND pr.price > 5 AND pr.price < 500000
          GROUP BY p.id, p.cpt_code, p.standard_name
          ORDER BY hospitals DESC LIMIT 20
        `, [city]);
        return JSON.stringify({ new_cpts: r.rows, total: r.rows.length });
      },
    }),

    betaTool({
      name: 'was_already_emailed',
      description: 'Check if this city+cpt combo was already emailed',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          cpt_code: { type: 'string' },
        },
        required: ['city', 'cpt_code'],
        additionalProperties: false,
      },
      run: async ({ city, cpt_code }) => {
        const r = await pool.query(
          `SELECT sent_at FROM email_logs WHERE city ILIKE $1 AND cpt_code = $2 ORDER BY sent_at DESC LIMIT 1`,
          [city, cpt_code]
        );
        return JSON.stringify({ already_sent: r.rows.length > 0, last_sent: r.rows[0]?.sent_at || null });
      },
    }),

    betaTool({
      name: 'log_email_sent',
      description: 'Log that an email was sent (prevents duplicates)',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          cpt_code: { type: 'string' },
          recipient_count: { type: 'number' },
          email_subject: { type: 'string' },
        },
        required: ['city', 'cpt_code', 'recipient_count', 'email_subject'],
        additionalProperties: false,
      },
      run: async ({ city, cpt_code, recipient_count, email_subject }) => {
        await pool.query(
          `INSERT INTO email_logs (city, cpt_code, recipient_count, email_subject, sent_at) VALUES ($1, $2, $3, $4, NOW())`,
          [city, cpt_code, recipient_count, email_subject]
        );
        return JSON.stringify({ logged: true, city, cpt_code, recipients: recipient_count });
      },
    }),
  ];
}

async function runCoordinator(task) {
  const client = new Anthropic();
  const tools = await buildTools();

  const result = await client.beta.messages.toolRunner({
    model: MODEL_CHEAP,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools,
    messages: [{ role: 'user', content: task }],
  });

  return (result.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

if (require.main === module) {
  const task = process.argv[2] || 'Check Dallas for new pricing and report opportunities';
  runCoordinator(task).then(answer => {
    console.log('\n🎯 PRE-REG COORDINATOR\n');
    console.log(answer);
    process.exit(0);
  }).catch(e => {
    console.error('❌ Error:', e.message);
    process.exit(1);
  });
}

module.exports = { runCoordinator };
