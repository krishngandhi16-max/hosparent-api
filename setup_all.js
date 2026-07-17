#!/usr/bin/env node
// setup_all.js - One-command setup for entire system
require('dotenv').config();
const { pool } = require('./db');

async function setup() {
  try {
    console.log('\n🚀 HOSPARENT FULL SYSTEM SETUP\n');

    // 1. Create pre-reg tables
    console.log('📋 Creating pre-registration tables...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prereg_emails (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        city TEXT NOT NULL,
        state TEXT NOT NULL,
        registered_at TIMESTAMP DEFAULT NOW(),
        opted_in BOOLEAN DEFAULT TRUE
      );
      CREATE INDEX IF NOT EXISTS idx_prereg_city_state ON prereg_emails(city, state);
    `);
    console.log('   ✓ prereg_emails table ready');

    // 2. Create email logs table
    console.log('📧 Creating email tracking tables...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id SERIAL PRIMARY KEY,
        city TEXT NOT NULL,
        cpt_code TEXT NOT NULL,
        recipient_count INT DEFAULT 0,
        email_subject TEXT,
        sent_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_email_logs_city_cpt ON email_logs(city, cpt_code);
    `);
    console.log('   ✓ email_logs table ready');

    // 2b. Create Learn tab / Terry / Indy tables
    console.log('Creating Learn tab, insurance news, and ad queue tables...');
    const { ensureNewsTable } = require('./learn');
    const { ensureAdQueueTable } = require('./indy_agent');
    await ensureNewsTable();
    await ensureAdQueueTable();
    console.log('   OK insurance_news + ad_queue tables ready');

    // 3. Ensure bounds columns exist
    console.log('💰 Ensuring price bounds columns...');
    await pool.query(`
      ALTER TABLE cpt_price_bounds
        ADD COLUMN IF NOT EXISTS min_negotiated NUMERIC,
        ADD COLUMN IF NOT EXISTS max_negotiated NUMERIC,
        ADD COLUMN IF NOT EXISTS min_gross NUMERIC,
        ADD COLUMN IF NOT EXISTS max_gross NUMERIC
    `);
    console.log('   ✓ Bounds columns ready');

    // 4. Check database health
    console.log('🏥 Checking database health...');
    const hospitals = await pool.query(`SELECT COUNT(*)::int AS n FROM hospitals`);
    const prices = await pool.query(`SELECT COUNT(*)::int AS n FROM prices`);
    const procedures = await pool.query(`SELECT COUNT(*)::int AS n FROM procedures`);
    console.log(`   ✓ Hospitals: ${hospitals.rows[0].n}`);
    console.log(`   ✓ Prices: ${prices.rows[0].n}`);
    console.log(`   ✓ Procedures: ${procedures.rows[0].n}`);

    // 5. Count flagged prices
    console.log('🚩 Checking flagged prices...');
    const flagged = await pool.query(`SELECT COUNT(*)::int AS n FROM prices WHERE is_suspicious IS TRUE`);
    console.log(`   Flagged: ${flagged.rows[0].n} (ready to unflag with Hoser)\n`);

    console.log('✅ SETUP COMPLETE!\n');
    console.log('Next steps:');
    console.log('  1. Ask Hoser to unflag prices:');
    console.log('     node -e "const {runAgent}=require(\'./db_agent\');runAgent(\'unflag all prices within bounds\').then(r=>{console.log(r.answer);process.exit(0);})"');
    console.log('\n  2. Test pre-reg coordinator:');
    console.log('     node prereg_agent.js "Check Dallas for new pricing"');
    console.log('\n  3. Add test pre-reg email:');
    console.log('     node -e "const {pool}=require(\'./db\');pool.query(\'INSERT INTO prereg_emails (email,city,state) VALUES ($1,$2,$3)\',["test@gmail.com","Dallas","TX"]).then(()=>{console.log("Email added");pool.end();})"');

    process.exit(0);
  } catch (e) {
    console.error('❌ Setup failed:', e.message);
    process.exit(1);
  }
}

setup().finally(() => pool.end());
