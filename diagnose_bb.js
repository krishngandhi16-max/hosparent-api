const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function diagnose(cpt, hospitalName) {
  console.log(`\n=== DIAGNOSTICS FOR CPT ${cpt} @ ${hospitalName} ===\n`);

  const hosp = await pool.query(
    `SELECT id, name, city, is_compliant, mrf_last_updated FROM hospitals WHERE name ILIKE $1 LIMIT 1`,
    [`%${hospitalName}%`]
  );
  
  if (hosp.rows.length === 0) {
    console.log('❌ Hospital not found. Similar names:');
    const all = await pool.query(
      `SELECT DISTINCT name FROM hospitals WHERE name ILIKE $1 ORDER BY name LIMIT 10`,
      [`%${hospitalName.split(' ')[0]}%`]
    );
    console.log(all.rows.map(r => r.name).join('\n'));
    await pool.end();
    return;
  }

  const hospId = hosp.rows[0].id;
  console.log(`✓ Hospital: ${hosp.rows[0].name} (${hosp.rows[0].city})`);
  console.log(`  Compliant: ${hosp.rows[0].is_compliant}, MRF Updated: ${hosp.rows[0].mrf_last_updated}\n`);

  const proc = await pool.query(
    `SELECT id, display_name, cpt_code, setting, is_searchable FROM procedures WHERE cpt_code = $1 LIMIT 1`,
    [cpt]
  );
  
  if (proc.rows.length === 0) {
    console.log(`❌ CPT ${cpt} not found in procedures table`);
    await pool.end();
    return;
  }

  console.log(`✓ Procedure: ${proc.rows[0].display_name}`);
  console.log(`  Setting: ${proc.rows[0].setting}, Searchable: ${proc.rows[0].is_searchable}\n`);
  const procId = proc.rows[0].id;

  const all = await pool.query(
    `SELECT price, price_type, payer_name, is_suspicious FROM prices 
     WHERE procedure_id = $1 AND hospital_id = $2 ORDER BY price ASC`,
    [procId, hospId]
  );

  console.log(`Total prices in DB: ${all.rows.length}`);
  if (all.rows.length === 0) {
    console.log('⚠️  NO PRICES for this hospital + procedure combo.\n');
    const any = await pool.query(
      `SELECT COUNT(*) as cnt FROM prices WHERE procedure_id = $1`, [procId]
    );
    console.log(`Procedure has ${any.rows[0].cnt} prices across ALL hospitals`);
  } else {
    const clean = all.rows.filter(r => !r.is_suspicious);
    const flagged = all.rows.filter(r => r.is_suspicious);
    console.log(`Clean (not flagged): ${clean.length}`);
    if (clean.length > 0) {
      const prices = clean.map(r => r.price);
      console.log(`  Min: $${Math.min(...prices)}, Max: $${Math.max(...prices)}`);
    }
    console.log(`Flagged (is_suspicious=true): ${flagged.length}`);
    console.log('\nFirst 5 prices:');
    all.rows.slice(0, 5).forEach(r => {
      console.log(`  $${r.price} - ${r.price_type} - ${r.payer_name || 'N/A'} - Flagged: ${r.is_suspicious}`);
    });
  }

  const bounds = await pool.query(
    `SELECT min_cash, max_cash FROM cpt_price_bounds WHERE cpt_code = $1`, [cpt]
  );

  console.log(`\nBounds set: ${bounds.rows.length > 0 ? 'YES' : 'NO'}`);
  if (bounds.rows.length > 0) {
    const b = bounds.rows[0];
    console.log(`  Cash: $${b.min_cash}–$${b.max_cash}`);
  }

  await pool.end();
}

diagnose('45378', 'Baylor').catch(e => console.error(e));