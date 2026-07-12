// pipeline/db.js — shared connection + safety helpers for the cleaning pipeline.
//
// Reads .env from the project root (no dotenv dependency — trivial parser,
// tolerant of the blank first line the current .env has).
//
// Exposes the three primitives every destructive step MUST use:
//   countBefore(sql, params)          -> rule 2a: show exactly what will be hit
//   applyInBatches(opts)              -> rule 3: never one unbounded UPDATE
//   verifyAfter(sql, params, expect)  -> rule 2c: prove it did what was intended

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const out = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

const env = loadEnv();

const pool = new Pool({
  host: process.env.DB_HOST || env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || env.DB_NAME || 'hosparent',
  user: process.env.DB_USER || env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || env.DB_PASSWORD,
  max: 4,
  // long statement timeout: cohort stats over 48.6M rows are slow but bounded
  statement_timeout: 30 * 60 * 1000,
});

async function q(sql, params) {
  return pool.query(sql, params);
}

async function one(sql, params) {
  const r = await pool.query(sql, params);
  return r.rows[0];
}

// ── schema introspection (HARD RULE 1: never assume, always look) ──────────
async function tableColumns(table) {
  const r = await q(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table]
  );
  return r.rows;
}

async function tableExists(table) {
  const r = await one(
    `SELECT to_regclass('public.' || quote_ident($1)) IS NOT NULL AS ok`, [table]
  );
  return r.ok;
}

async function hasColumn(table, col) {
  const cols = await tableColumns(table);
  return cols.some(c => c.column_name === col);
}

// Assert a table has every column in `required`; die loudly if not.
// This is what stops "assumed prices.billing_code exists" class of bugs.
async function assertSchema(table, required) {
  if (!(await tableExists(table))) {
    throw new Error(`PREFLIGHT FAIL: table "${table}" does not exist. Aborting — nothing was changed.`);
  }
  const cols = (await tableColumns(table)).map(c => c.column_name);
  const missing = required.filter(c => !cols.includes(c));
  if (missing.length) {
    throw new Error(
      `PREFLIGHT FAIL: table "${table}" is missing column(s) [${missing.join(', ')}]. ` +
      `Actual columns: [${cols.join(', ')}]. Aborting — nothing was changed.`
    );
  }
  return cols;
}

// Fast estimated rowcount (pg_class) for 48.6M-row tables; exact for small ones.
async function approxCount(table) {
  const r = await one(
    `SELECT reltuples::bigint AS n FROM pg_class WHERE oid = ('public.' || quote_ident($1))::regclass`,
    [table]
  );
  return Number(r.n);
}

// ── rule 2 + 3 helpers ──────────────────────────────────────────────────────
async function countBefore(label, sql, params) {
  const r = await one(sql, params);
  const n = Number(r.n);
  console.log(`  [count-before] ${label}: ${n.toLocaleString()} rows will be affected`);
  return n;
}

// Batched UPDATE driver. Candidate rows must be materialized in a work table
// keyed by price id (bigint). We walk id ranges so no single statement locks
// a huge slice of the 48.6M-row prices table.
//
// opts: { label, workTable, idColumn, applySqlFn(lo, hi) -> {sql, params}, batchSize }
async function applyInBatches({ label, workTable, idColumn = 'price_id', applySqlFn, batchSize = 500000 }) {
  const bounds = await one(`SELECT MIN(${idColumn}) AS lo, MAX(${idColumn}) AS hi, COUNT(*) AS n FROM ${workTable}`);
  const total = Number(bounds.n);
  if (!total) {
    console.log(`  [apply] ${label}: 0 candidate rows, nothing to do`);
    return 0;
  }
  let applied = 0;
  let lo = Number(bounds.lo);
  const hi = Number(bounds.hi);
  while (lo <= hi) {
    const hiBatch = lo + batchSize - 1;
    const { sql, params } = applySqlFn(lo, hiBatch);
    const r = await q(sql, params);
    applied += r.rowCount;
    if (r.rowCount > 0) {
      console.log(`  [apply] ${label}: ids ${lo.toLocaleString()}..${hiBatch.toLocaleString()} -> ${r.rowCount.toLocaleString()} rows (running total ${applied.toLocaleString()})`);
    }
    lo = hiBatch + 1;
  }
  return applied;
}

async function verifyAfter(label, sql, params, expectZero = true) {
  const r = await one(sql, params);
  const n = Number(r.n);
  const ok = expectZero ? n === 0 : n > 0;
  console.log(`  [verify-after] ${label}: ${n.toLocaleString()} ${expectZero ? 'remaining (want 0)' : 'present'} -> ${ok ? 'OK' : 'MISMATCH'}`);
  return { n, ok };
}

function reportPath(name) {
  const dir = path.join(__dirname, 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(dir, `${name}_${ts}.json`);
}

function writeReport(name, obj) {
  const p = reportPath(name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  console.log(`\nReport written: ${p}`);
  return p;
}

module.exports = {
  pool, q, one,
  tableColumns, tableExists, hasColumn, assertSchema, approxCount,
  countBefore, applyInBatches, verifyAfter,
  writeReport,
};
