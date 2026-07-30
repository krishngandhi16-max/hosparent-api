#!/usr/bin/env node
// run_safe_fixes.js — execute whitelisted safe fixes locally
// This runs the unflagging and other safe operations against the real database
//
// Usage: node run_safe_fixes.js [--unflag] [--revalidate] [--clear-flags] [--all]
// Example: node run_safe_fixes.js --all
require('dotenv').config();
const { pool } = require('./db');
const { runAgent } = require('./db_agent');

const args = process.argv.slice(2);
const opts = {
  unflag: args.includes('--unflag') || args.includes('--all'),
  revalidate: args.includes('--revalidate') || args.includes('--all'),
  clearFlags: args.includes('--clear-flags') || args.includes('--all'),
  all: args.includes('--all'),
};

async function main() {
  try {
    console.log('\n=== Running Whitelisted Safe Fixes ===\n');

    // Option 1: Re-run validation
    if (opts.revalidate) {
      console.log('📋 Re-running validation...');
      const result = await runAgent('please run rerun_validation', { research: false });
      console.log('Result:', result);
      console.log();
    }

    // Option 2: Clear stale flags
    if (opts.clearFlags) {
      console.log('🧹 Clearing stale flags (prices now inside bounds)...');
      const result = await runAgent('please run clear_stale_flags', { research: false });
      console.log('Result:', result);
      console.log();
    }

    // Option 3: Unflag prices that are within bounds
    if (opts.unflag) {
      console.log('✅ Unflagging prices that are within their per-type bounds...');
      const result = await runAgent(`
        please run unflag_prices_with_validation to intelligently unflag all flagged prices
        that are actually within their cpt_price_bounds window. This fixes the issue where
        valid prices are hidden because they were flagged by an older bounds validation.
      `, { research: false });
      console.log('Result:', result);
      console.log();
    }

    // If no options specified, show usage
    if (!opts.unflag && !opts.revalidate && !opts.clearFlags) {
      console.log('Usage: node run_safe_fixes.js [options]');
      console.log('Options:');
      console.log('  --unflag           Unflag prices within bounds');
      console.log('  --revalidate       Re-run validation');
      console.log('  --clear-flags      Clear stale flags');
      console.log('  --all              Run all fixes in sequence');
      console.log('\nExample: node run_safe_fixes.js --all');
      process.exit(0);
    }

    console.log('✅ All fixes completed successfully!');
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}

main().finally(() => pool.end());
