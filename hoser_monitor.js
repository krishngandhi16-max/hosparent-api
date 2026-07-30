// hoser_monitor.js — Hoser's 24/7 monitoring loop
// Runs health checks, daily research, diagnostics, and audits autonomously

const { hoserResearch, initObsidianVault, dailyResearchRoutine, healthCheckRoutine } = require('./hoser_agent');
const fs = require('fs');
const path = require('path');

// Initialize Obsidian vault on startup
initObsidianVault();

console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║  🤖 HOSER: Autonomous Healthcare Finance Specialist           ║
║                                                                ║
║  Mission: Make Hosparent the #1 DFW price transparency tool   ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);

// Health check every 5 minutes
setInterval(async () => {
  try {
    await healthCheckRoutine();
  } catch (e) {
    console.error(`[Hoser] Health check error:`, e.message);
  }
}, 5 * 60 * 1000);

// Daily research at 06:00 AM and 6:00 PM
setInterval(async () => {
  try {
    const result = await dailyResearchRoutine();
    if (result.answer) {
      console.log(`[Hoser] Research complete:\n${result.answer.slice(0, 500)}...`);
    }
  } catch (e) {
    console.error(`[Hoser] Research error:`, e.message);
  }
}, 12 * 60 * 60 * 1000); // Every 12 hours

// Skip the boot-time research if Hoser already researched in the last 12 hours.
// Every server restart used to fire a full tool-loop research cycle, which
// collided with /agent calls on Groq's 12K tokens/minute free tier (429 storm).
function researchedRecently() {
  try {
    const log = path.join(__dirname, 'hoser-knowledge/findings/daily_log.csv');
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
    const lastAt = new Date(lines[lines.length - 1].split(',')[0]).getTime();
    return Number.isFinite(lastAt) && Date.now() - lastAt < 12 * 3600 * 1000;
  } catch (_) {
    return false;
  }
}

// Run first health check (+ research only if due) on startup
(async () => {
  console.log(`[Hoser] Initializing...`);
  await healthCheckRoutine();
  if (researchedRecently()) {
    console.log(`[Hoser] Last research was <12h ago — skipping boot research (next cycle is scheduled).`);
  } else {
    await dailyResearchRoutine();
  }
  console.log(`[Hoser] Ready. Monitoring 24/7.`);
})();

// Export for manual triggers
module.exports = { hoserResearch, healthCheckRoutine, dailyResearchRoutine };
