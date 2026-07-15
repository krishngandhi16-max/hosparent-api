// agent_cli.js — ask the agent a question from the terminal.
//
//   node agent_cli.js "why aren't the drug codes showing up when I search an NDC?"
//   node agent_cli.js "why is TryBilly's colonoscopy price at Baylor different from ours?"
//
// Requires ANTHROPIC_API_KEY and the DB env vars (DB_HOST, DB_NAME, DB_USER, ...).
const { runAgent } = require('./db_agent');

async function main() {
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) {
    console.log('Usage: node agent_cli.js "<your question>"');
    process.exit(1);
  }
  console.log(`\nQ: ${question}\n`);
  const { answer, actions_taken } = await runAgent(question);
  console.log(`A: ${answer}\n`);
  if (actions_taken.length) {
    console.log('Actions applied:');
    for (const a of actions_taken) console.log(`  - ${a.name} @ ${a.at}: ${JSON.stringify(a.result)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
