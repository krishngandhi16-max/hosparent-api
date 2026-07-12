// pipeline/01a_backfill_ids.js — assign ids to prices rows that have none.
//
// Discovered 2026-07-12: 13.7M rows (28% of prices — the Methodist hospitals
// feed) have NULL id, and prices has no primary key. Any id-keyed UPDATE ever
// run has silently skipped those rows. This stage backfills unique ids so the
// audit (and everything else) can address every row.
//
//   node pipeline/01a_backfill_ids.js          -> dry run: counts only
//   node pipeline/01a_backfill_ids.js --apply  -> batched backfill + verify
//
// Method: new ids start 1M above the current MAX(id) (collision-proof), a
// partial index makes NULL-id lookup cheap, and updates run in 250K-row ctid
// batches so no statement locks a large slice of the table.

const { q, one, pool, verifyAfter, writeReport } = require('./db');

const APPLY = process.argv.includes('--apply');
const BATCH = 250000;

async function main() {
  console.log(`PIPELINE 01a — BACKFILL PRICE IDS ${APPLY ? '(APPLY)' : '(dry run)'}`);
  console.log('='.repeat(60));
  const report = { at: new Date().toISOString(), apply: APPLY };

  const before = Number((await one(`SELECT COUNT(*) AS n FROM prices WHERE id IS NULL`)).n);
  console.log(`  [count-before] rows with NULL id: ${before.toLocaleString()}`);
  report.null_ids_before = before;

  const pk = await q(`SELECT conname FROM pg_constraint WHERE conrelid = 'prices'::regclass AND contype = 'p'`);
  console.log(`  prices primary key: ${pk.rows.length ? pk.rows[0].conname : 'NONE (add one after the pitch — needs an exclusive lock)'}`);

  if (!before) {
    console.log('  Nothing to backfill.');
    await pool.end();
    return;
  }
  const mx = (await one(`SELECT COALESCE(MAX(id), 0)::bigint AS mx FROM prices`)).mx;
  const start = BigInt(mx) + 1000000n;
  console.log(`  max existing id: ${mx} -> new ids start at ${start}`);
  report.start_id = start.toString();

  if (!APPLY) {
    console.log('\nDRY RUN — nothing changed. Re-run with --apply.');
    await pool.end();
    return;
  }

  console.log('\n  building partial index on NULL ids (one-time, speeds every batch)...');
  await q(`CREATE INDEX IF NOT EXISTS idx_prices_null_id ON prices(id) WHERE id IS NULL`);
  await q(`CREATE SEQUENCE IF NOT EXISTS prices_id_backfill_seq START ${start}`);
  // if the sequence already existed from an interrupted run, never move it backwards
  await q(`SELECT setval('prices_id_backfill_seq',
           GREATEST((SELECT last_value FROM prices_id_backfill_seq), ${start}), false)`);

  let total = 0, batch = 0;
  for (;;) {
    const r = await q(`
      UPDATE prices SET id = nextval('prices_id_backfill_seq')
      WHERE ctid = ANY(ARRAY(SELECT ctid FROM prices WHERE id IS NULL LIMIT ${BATCH}))`);
    if (!r.rowCount) break;
    total += r.rowCount; batch++;
    console.log(`  batch ${batch}: ${r.rowCount.toLocaleString()} ids assigned (running total ${total.toLocaleString()})`);
  }
  report.assigned = total;
  console.log(`  assigned ${total.toLocaleString()} ids (expected ${before.toLocaleString()})`);

  await verifyAfter('rows still missing id', `SELECT COUNT(*) AS n FROM prices WHERE id IS NULL`);
  const dup = Number((await one(`
    SELECT COUNT(*) AS n FROM (
      SELECT id FROM prices WHERE id >= ${start} GROUP BY id HAVING COUNT(*) > 1
    ) d`)).n);
  console.log(`  [verify-after] duplicate new ids: ${dup} (want 0)`);
  report.duplicates = dup;

  await q(`DROP INDEX IF EXISTS idx_prices_null_id`);
  writeReport('backfill_ids', report);
  if (dup > 0 || total !== before) {
    console.error('BACKFILL MISMATCH — investigate before running the audit.');
    process.exit(1);
  }
  console.log('\nDONE. Every prices row now has a unique id. Next: node pipeline/01_audit.js');
  await pool.end();
}

main().catch(e => { console.error('\nBACKFILL FAILED: ' + (e.stack || e.message)); process.exit(1); });
