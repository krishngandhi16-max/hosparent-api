#!/usr/bin/env node
// hoser_unflag.js - Ask Hoser to unflag prices
require('dotenv').config();
const { runAgent } = require('./db_agent');

(async () => {
  try {
    console.log('Asking Hoser to unflag prices within bounds...\n');
    const result = await runAgent('unflag all prices that are within their per-type bounds using unflag_prices_with_validation and show me recovery stats');

    console.log('=== HOSER RESPONSE ===\n');
    console.log(result.answer);

    if (result.actions_taken && result.actions_taken.length > 0) {
      console.log('\nActions taken:');
      result.actions_taken.forEach(a => {
        console.log('  - ' + a.name + ': ' + JSON.stringify(a.result));
      });
    }

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
