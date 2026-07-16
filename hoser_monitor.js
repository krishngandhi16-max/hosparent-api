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

// Run first health check + research immediately on startup
(async () => {
  console.log(`[Hoser] Initializing...`);
  await healthCheckRoutine();
  await dailyResearchRoutine();
  console.log(`[Hoser] Ready. Monitoring 24/7.`);
})();

// Export for manual triggers
module.exports = { hoserResearch, healthCheckRoutine, dailyResearchRoutine };
