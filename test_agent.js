// test_agent.js — offline tests that need no DB and no API key.
// Exercises the security-critical SQL guard and the safe-fix whitelist shape.
//   node test_agent.js
const assert = require('assert');
const { assertReadOnlySelect } = require('./sql_guard');
const { SAFE_FIXES } = require('./db_agent');

let pass = 0;
function ok(name, fn) {
  try { fn(); console.log(`  ok  - ${name}`); pass++; }
  catch (e) { console.error(`  FAIL - ${name}: ${e.message}`); process.exitCode = 1; }
}
function rejects(sql) {
  assert.throws(() => assertReadOnlySelect(sql), `expected "${sql}" to be rejected`);
}
function allows(sql) {
  assert.doesNotThrow(() => assertReadOnlySelect(sql), `expected "${sql}" to be allowed`);
}

console.log('SQL guard:');
ok('allows a plain SELECT', () => allows('SELECT 1'));
ok('allows WITH (CTE)', () => allows('WITH x AS (SELECT 1) SELECT * FROM x'));
ok('allows a trailing semicolon', () => allows('SELECT price FROM prices;'));
ok('allows columns like updated_at / created_at (no false positive)',
  () => allows('SELECT mrf_last_updated, created_at FROM hospitals'));
ok('rejects UPDATE', () => rejects("UPDATE prices SET price = 0"));
ok('rejects DELETE', () => rejects('DELETE FROM prices'));
ok('rejects DROP', () => rejects('DROP TABLE prices'));
ok('rejects a second statement', () => rejects('SELECT 1; DROP TABLE prices'));
ok('rejects a write hidden after SELECT', () => rejects('SELECT 1; UPDATE prices SET price=0'));
ok('rejects empty', () => rejects('   '));
ok('rejects a non-SELECT start', () => rejects('EXPLAIN ANALYZE SELECT 1'));

console.log('\nSafe-fix whitelist:');
ok('exposes exactly the two vetted fixes', () => {
  assert.deepStrictEqual(Object.keys(SAFE_FIXES).sort(), ['clear_stale_flags', 'rerun_validation']);
});
ok('every fix is a function', () => {
  for (const [k, v] of Object.entries(SAFE_FIXES)) assert.strictEqual(typeof v, 'function', `${k} not a function`);
});

console.log(`\n${pass} checks passed${process.exitCode ? ' (with failures above)' : ''}.`);
