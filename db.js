// Shared Postgres pools for the API and the DB agent.
//
// - `pool`         : app credentials, read/write. Used by the existing API
//                    endpoints and by whitelisted safe fixes only.
// - `readonlyPool` : uses a restricted role (DB_READONLY_USER) when configured,
//                    otherwise falls back to the app credentials. Either way,
//                    `runReadonlySql` wraps every query in a READ ONLY transaction
//                    with a statement timeout, so writes are impossible through it.
require('dotenv').config();
const { Pool } = require('pg');

const base = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  max: 20,
  idleTimeoutMillis: 30000,
};

const pool = new Pool({
  ...base,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const readonlyPool = new Pool({
  ...base,
  user: process.env.DB_READONLY_USER || process.env.DB_USER,
  password: process.env.DB_READONLY_PASSWORD || process.env.DB_PASSWORD,
});

// Execute a single already-validated SELECT under a READ ONLY transaction.
// Belt-and-suspenders: even if the connected role can write, `SET TRANSACTION
// READ ONLY` makes Postgres reject any write, and `statement_timeout` caps runtime.
async function runReadonlySql(sql, { rowLimit = 200, timeoutMs = 5000 } = {}) {
  const client = await readonlyPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs) || 5000}`);
    const res = await client.query(sql);
    await client.query('ROLLBACK');
    const rows = res.rows || [];
    return {
      row_count: rows.length,
      truncated: rows.length > rowLimit,
      rows: rows.slice(0, rowLimit),
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

// Idempotently ensure the per-price-type bound columns exist on cpt_price_bounds.
// Safe to call repeatedly (memoized). Lets read-time filters reference
// min_negotiated/max_negotiated/min_gross/max_gross with a COALESCE fallback to
// the cash window, so a DB that hasn't populated them behaves exactly as before.
let _ensured = null;
function ensureBoundsColumns() {
  if (!_ensured) {
    _ensured = pool.query(`
      ALTER TABLE cpt_price_bounds
        ADD COLUMN IF NOT EXISTS min_negotiated NUMERIC,
        ADD COLUMN IF NOT EXISTS max_negotiated NUMERIC,
        ADD COLUMN IF NOT EXISTS min_gross NUMERIC,
        ADD COLUMN IF NOT EXISTS max_gross NUMERIC
    `).then(() => true).catch((e) => { _ensured = null; throw e; });
  }
  return _ensured;
}

module.exports = { pool, readonlyPool, runReadonlySql, ensureBoundsColumns };
