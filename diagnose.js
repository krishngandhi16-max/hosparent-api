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
  console.log(\n=== DIAGNOSTICS FOR CPT  @  ===\n);

  const hosp = await pool.query(
    SELECT id, name, city, is_compliant, mrf_last_updated FROM hospitals WHERE name ILIKE  LIMIT 1,
    [%%]
  );
  
  if (hosp.rows.length === 0) {
    console.log('❌ Hospital not found. Similar names:');
    const all = await pool.query(
      SELECT DISTINCT name FROM hospitals WHERE name ILIKE  ORDER BY name LIMIT 10,
      [%%]
    );
    console.log(all.rows.map(r => r.name).join('\n'));
    await pool.end();
    return;
  }

  const hospId = hosp.rows[0].id;
  console.log(✓ Hospital:  ());
  console.log(  Compliant: , MRF Updated: \n);

  const proc = await pool.query(
    SELECT id, display_name, cpt_code, setting, is_searchable FROM procedures WHERE cpt_code =  LIMIT 1,
    [cpt]
  );
  
  if (proc.rows.length === 0) {
    console.log(❌ CPT  not found in procedures table);
    await pool.end();
    return;
  }

  console.log(✓ Procedure: );
  console.log(  Setting: , Searchable: \n);
  const procId = proc.rows[0].id;

  const all = await pool.query(
    SELECT price, price_type, payer_name, is_suspicious FROM prices 
     WHERE procedure_id =  AND hospital_id =  ORDER BY price ASC,
    [procId, hospId]
  );

  console.log(Total prices in DB: );
  if (all.rows.length === 0) {
    console.log('⚠️  NO PRICES for this hospital + procedure combo.\n');
    const any = await pool.query(
      SELECT COUNT(*) as cnt FROM prices WHERE procedure_id = , [procId]
    );
    console.log(Procedure has  prices across ALL hospitals);
  } else {
    const clean = all.rows.filter(r => !r.is_suspicious);
    const flagged = all.rows.filter(r => r.is_suspicious);
    console.log(Clean (not flagged): );
    if (clean.length > 0) {
      const prices = clean.map(r => r.price);
      console.log(  Min: 
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
  console.log(\\n=== DIAGNOSTICS FOR CPT \${cpt} @ \${hospitalName} ===\n\);

  // Find hospital ID
  const hosp = await pool.query(
    \SELECT id, name, city, is_compliant, mrf_last_updated FROM hospitals WHERE name ILIKE \$1 LIMIT 1\,
    [\%\${hospitalName}%\]
  );
  
  if (hosp.rows.length === 0) {
    console.log('❌ Hospital not found. Try:');
    const all = await pool.query(\SELECT DISTINCT name FROM hospitals WHERE name ILIKE \$1 ORDER BY name\, [\%${hospitalName.split(' ')[0]}%\]);
    console.log(all.rows.map(r => r.name));
    await pool.end();
    return;
  }

  const hospId = hosp.rows[0].id;
  console.log(\✓ Hospital: \${hosp.rows[0].name} (\${hosp.rows[0].city}) - Compliant: \${hosp.rows[0].is_compliant} - MRF Updated: \${hosp.rows[0].mrf_last_updated}\n\);

  // Find procedure
  const proc = await pool.query(
    \SELECT id, display_name, standard_name, cpt_code, setting, is_searchable FROM procedures WHERE cpt_code = \$1 LIMIT 1\,
    [cpt]
  );
  
  if (proc.rows.length === 0) {
    console.log(\❌ CPT \${cpt} not found\);
    await pool.end();
    return;
  }

  console.log(\✓ Procedure: \${proc.rows[0].display_name} (Setting: \${proc.rows[0].setting}, Searchable: \${proc.rows[0].is_searchable})\n\);
  const procId = proc.rows[0].id;

  // Get ALL prices for this combo (raw, no filters)
  const all = await pool.query(
    \SELECT price, price_type, payer_name, is_suspicious, hospital_id FROM prices 
     WHERE procedure_id = \$1 AND hospital_id = \$2 ORDER BY price ASC\,
    [procId, hospId]
  );

  console.log(\Total raw prices in DB: \${all.rows.length}\);
  if (all.rows.length === 0) {
    console.log('⚠️  NO PRICES AT ALL for this hospital + procedure combo.\n');
    console.log('Checking if procedure exists at ANY hospital...');
    const any = await pool.query(
      \SELECT COUNT(*) as cnt FROM prices WHERE procedure_id = \$1\, [procId]
    );
    console.log(\  → Procedure has \${any.rows[0].cnt} prices across all hospitals\n\);
  } else {
    console.log('Price breakdown:');
    const clean = all.rows.filter(r => !r.is_suspicious);
    const flagged = all.rows.filter(r => r.is_suspicious);
    console.log(\  Clean (not flagged): \${clean.length}\);
    if (clean.length > 0) {
      console.log(\    Min: \$\${Math.min(...clean.map(r => r.price))}, Max: \$\${Math.max(...clean.map(r => r.price))}\);
    }
    console.log(\  Flagged (is_suspicious=true): \${flagged.length}\);
    if (flagged.length > 0) {
      console.log(\    Prices: \${flagged.map(r => r.price).join(', ')}\);
    }
    console.log('');
    console.log('Sample prices:');
    all.rows.slice(0, 5).forEach(r => {
      console.log(\  \$\${r.price} - \${r.price_type} - \${r.payer_name || 'N/A'} - Flagged: \${r.is_suspicious}\);
    });
  }

  // Check bounds
  const bounds = await pool.query(
    \SELECT min_cash, max_cash, min_negotiated, max_negotiated, min_gross, max_gross 
     FROM cpt_price_bounds WHERE cpt_code = \$1\, [cpt]
  );

  console.log(\\nBounds set: \${bounds.rows.length > 0 ? 'YES' : 'NO'}\);
  if (bounds.rows.length > 0) {
    const b = bounds.rows[0];
    console.log(\  Cash: \$\${b.min_cash}–\$\${b.max_cash}\);
    console.log(\  Negotiated: \${b.min_negotiated ? \`\$\${b.min_negotiated}–\$\${b.max_negotiated}\ : 'Not set'}\);
    console.log(\  Gross: \${b.min_gross ? \`\$\${b.min_gross}–\$\${b.max_gross}\ : 'Not set'}\);
  }

  await pool.end();
}

// REPLACE THESE WITH KRISH'S VALUES
diagnose('45378', 'Baylor').catch(e => console.error(e));
{Math.min(...prices)}, Max: 
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
  console.log(\\n=== DIAGNOSTICS FOR CPT \${cpt} @ \${hospitalName} ===\n\);

  // Find hospital ID
  const hosp = await pool.query(
    \SELECT id, name, city, is_compliant, mrf_last_updated FROM hospitals WHERE name ILIKE \$1 LIMIT 1\,
    [\%\${hospitalName}%\]
  );
  
  if (hosp.rows.length === 0) {
    console.log('❌ Hospital not found. Try:');
    const all = await pool.query(\SELECT DISTINCT name FROM hospitals WHERE name ILIKE \$1 ORDER BY name\, [\%${hospitalName.split(' ')[0]}%\]);
    console.log(all.rows.map(r => r.name));
    await pool.end();
    return;
  }

  const hospId = hosp.rows[0].id;
  console.log(\✓ Hospital: \${hosp.rows[0].name} (\${hosp.rows[0].city}) - Compliant: \${hosp.rows[0].is_compliant} - MRF Updated: \${hosp.rows[0].mrf_last_updated}\n\);

  // Find procedure
  const proc = await pool.query(
    \SELECT id, display_name, standard_name, cpt_code, setting, is_searchable FROM procedures WHERE cpt_code = \$1 LIMIT 1\,
    [cpt]
  );
  
  if (proc.rows.length === 0) {
    console.log(\❌ CPT \${cpt} not found\);
    await pool.end();
    return;
  }

  console.log(\✓ Procedure: \${proc.rows[0].display_name} (Setting: \${proc.rows[0].setting}, Searchable: \${proc.rows[0].is_searchable})\n\);
  const procId = proc.rows[0].id;

  // Get ALL prices for this combo (raw, no filters)
  const all = await pool.query(
    \SELECT price, price_type, payer_name, is_suspicious, hospital_id FROM prices 
     WHERE procedure_id = \$1 AND hospital_id = \$2 ORDER BY price ASC\,
    [procId, hospId]
  );

  console.log(\Total raw prices in DB: \${all.rows.length}\);
  if (all.rows.length === 0) {
    console.log('⚠️  NO PRICES AT ALL for this hospital + procedure combo.\n');
    console.log('Checking if procedure exists at ANY hospital...');
    const any = await pool.query(
      \SELECT COUNT(*) as cnt FROM prices WHERE procedure_id = \$1\, [procId]
    );
    console.log(\  → Procedure has \${any.rows[0].cnt} prices across all hospitals\n\);
  } else {
    console.log('Price breakdown:');
    const clean = all.rows.filter(r => !r.is_suspicious);
    const flagged = all.rows.filter(r => r.is_suspicious);
    console.log(\  Clean (not flagged): \${clean.length}\);
    if (clean.length > 0) {
      console.log(\    Min: \$\${Math.min(...clean.map(r => r.price))}, Max: \$\${Math.max(...clean.map(r => r.price))}\);
    }
    console.log(\  Flagged (is_suspicious=true): \${flagged.length}\);
    if (flagged.length > 0) {
      console.log(\    Prices: \${flagged.map(r => r.price).join(', ')}\);
    }
    console.log('');
    console.log('Sample prices:');
    all.rows.slice(0, 5).forEach(r => {
      console.log(\  \$\${r.price} - \${r.price_type} - \${r.payer_name || 'N/A'} - Flagged: \${r.is_suspicious}\);
    });
  }

  // Check bounds
  const bounds = await pool.query(
    \SELECT min_cash, max_cash, min_negotiated, max_negotiated, min_gross, max_gross 
     FROM cpt_price_bounds WHERE cpt_code = \$1\, [cpt]
  );

  console.log(\\nBounds set: \${bounds.rows.length > 0 ? 'YES' : 'NO'}\);
  if (bounds.rows.length > 0) {
    const b = bounds.rows[0];
    console.log(\  Cash: \$\${b.min_cash}–\$\${b.max_cash}\);
    console.log(\  Negotiated: \${b.min_negotiated ? \`\$\${b.min_negotiated}–\$\${b.max_negotiated}\ : 'Not set'}\);
    console.log(\  Gross: \${b.min_gross ? \`\$\${b.min_gross}–\$\${b.max_gross}\ : 'Not set'}\);
  }

  await pool.end();
}

// REPLACE THESE WITH KRISH'S VALUES
diagnose('45378', 'Baylor').catch(e => console.error(e));
{Math.max(...prices)});
    }
    console.log(Flagged (is_suspicious=true): );
    console.log('\nFirst 5 prices:');
    all.rows.slice(0, 5).forEach(r => {
      console.log(  
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
  console.log(\\n=== DIAGNOSTICS FOR CPT \${cpt} @ \${hospitalName} ===\n\);

  // Find hospital ID
  const hosp = await pool.query(
    \SELECT id, name, city, is_compliant, mrf_last_updated FROM hospitals WHERE name ILIKE \$1 LIMIT 1\,
    [\%\${hospitalName}%\]
  );
  
  if (hosp.rows.length === 0) {
    console.log('❌ Hospital not found. Try:');
    const all = await pool.query(\SELECT DISTINCT name FROM hospitals WHERE name ILIKE \$1 ORDER BY name\, [\%${hospitalName.split(' ')[0]}%\]);
    console.log(all.rows.map(r => r.name));
    await pool.end();
    return;
  }

  const hospId = hosp.rows[0].id;
  console.log(\✓ Hospital: \${hosp.rows[0].name} (\${hosp.rows[0].city}) - Compliant: \${hosp.rows[0].is_compliant} - MRF Updated: \${hosp.rows[0].mrf_last_updated}\n\);

  // Find procedure
  const proc = await pool.query(
    \SELECT id, display_name, standard_name, cpt_code, setting, is_searchable FROM procedures WHERE cpt_code = \$1 LIMIT 1\,
    [cpt]
  );
  
  if (proc.rows.length === 0) {
    console.log(\❌ CPT \${cpt} not found\);
    await pool.end();
    return;
  }

  console.log(\✓ Procedure: \${proc.rows[0].display_name} (Setting: \${proc.rows[0].setting}, Searchable: \${proc.rows[0].is_searchable})\n\);
  const procId = proc.rows[0].id;

  // Get ALL prices for this combo (raw, no filters)
  const all = await pool.query(
    \SELECT price, price_type, payer_name, is_suspicious, hospital_id FROM prices 
     WHERE procedure_id = \$1 AND hospital_id = \$2 ORDER BY price ASC\,
    [procId, hospId]
  );

  console.log(\Total raw prices in DB: \${all.rows.length}\);
  if (all.rows.length === 0) {
    console.log('⚠️  NO PRICES AT ALL for this hospital + procedure combo.\n');
    console.log('Checking if procedure exists at ANY hospital...');
    const any = await pool.query(
      \SELECT COUNT(*) as cnt FROM prices WHERE procedure_id = \$1\, [procId]
    );
    console.log(\  → Procedure has \${any.rows[0].cnt} prices across all hospitals\n\);
  } else {
    console.log('Price breakdown:');
    const clean = all.rows.filter(r => !r.is_suspicious);
    const flagged = all.rows.filter(r => r.is_suspicious);
    console.log(\  Clean (not flagged): \${clean.length}\);
    if (clean.length > 0) {
      console.log(\    Min: \$\${Math.min(...clean.map(r => r.price))}, Max: \$\${Math.max(...clean.map(r => r.price))}\);
    }
    console.log(\  Flagged (is_suspicious=true): \${flagged.length}\);
    if (flagged.length > 0) {
      console.log(\    Prices: \${flagged.map(r => r.price).join(', ')}\);
    }
    console.log('');
    console.log('Sample prices:');
    all.rows.slice(0, 5).forEach(r => {
      console.log(\  \$\${r.price} - \${r.price_type} - \${r.payer_name || 'N/A'} - Flagged: \${r.is_suspicious}\);
    });
  }

  // Check bounds
  const bounds = await pool.query(
    \SELECT min_cash, max_cash, min_negotiated, max_negotiated, min_gross, max_gross 
     FROM cpt_price_bounds WHERE cpt_code = \$1\, [cpt]
  );

  console.log(\\nBounds set: \${bounds.rows.length > 0 ? 'YES' : 'NO'}\);
  if (bounds.rows.length > 0) {
    const b = bounds.rows[0];
    console.log(\  Cash: \$\${b.min_cash}–\$\${b.max_cash}\);
    console.log(\  Negotiated: \${b.min_negotiated ? \`\$\${b.min_negotiated}–\$\${b.max_negotiated}\ : 'Not set'}\);
    console.log(\  Gross: \${b.min_gross ? \`\$\${b.min_gross}–\$\${b.max_gross}\ : 'Not set'}\);
  }

  await pool.end();
}

// REPLACE THESE WITH KRISH'S VALUES
diagnose('45378', 'Baylor').catch(e => console.error(e));
{r.price} -  -  - Flagged: );
    });
  }

  const bounds = await pool.query(
    SELECT min_cash, max_cash FROM cpt_price_bounds WHERE cpt_code = , [cpt]
  );

  console.log(\nBounds set: );
  if (bounds.rows.length > 0) {
    const b = bounds.rows[0];
    console.log(  Cash: 
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
  console.log(\\n=== DIAGNOSTICS FOR CPT \${cpt} @ \${hospitalName} ===\n\);

  // Find hospital ID
  const hosp = await pool.query(
    \SELECT id, name, city, is_compliant, mrf_last_updated FROM hospitals WHERE name ILIKE \$1 LIMIT 1\,
    [\%\${hospitalName}%\]
  );
  
  if (hosp.rows.length === 0) {
    console.log('❌ Hospital not found. Try:');
    const all = await pool.query(\SELECT DISTINCT name FROM hospitals WHERE name ILIKE \$1 ORDER BY name\, [\%${hospitalName.split(' ')[0]}%\]);
    console.log(all.rows.map(r => r.name));
    await pool.end();
    return;
  }

  const hospId = hosp.rows[0].id;
  console.log(\✓ Hospital: \${hosp.rows[0].name} (\${hosp.rows[0].city}) - Compliant: \${hosp.rows[0].is_compliant} - MRF Updated: \${hosp.rows[0].mrf_last_updated}\n\);

  // Find procedure
  const proc = await pool.query(
    \SELECT id, display_name, standard_name, cpt_code, setting, is_searchable FROM procedures WHERE cpt_code = \$1 LIMIT 1\,
    [cpt]
  );
  
  if (proc.rows.length === 0) {
    console.log(\❌ CPT \${cpt} not found\);
    await pool.end();
    return;
  }

  console.log(\✓ Procedure: \${proc.rows[0].display_name} (Setting: \${proc.rows[0].setting}, Searchable: \${proc.rows[0].is_searchable})\n\);
  const procId = proc.rows[0].id;

  // Get ALL prices for this combo (raw, no filters)
  const all = await pool.query(
    \SELECT price, price_type, payer_name, is_suspicious, hospital_id FROM prices 
     WHERE procedure_id = \$1 AND hospital_id = \$2 ORDER BY price ASC\,
    [procId, hospId]
  );

  console.log(\Total raw prices in DB: \${all.rows.length}\);
  if (all.rows.length === 0) {
    console.log('⚠️  NO PRICES AT ALL for this hospital + procedure combo.\n');
    console.log('Checking if procedure exists at ANY hospital...');
    const any = await pool.query(
      \SELECT COUNT(*) as cnt FROM prices WHERE procedure_id = \$1\, [procId]
    );
    console.log(\  → Procedure has \${any.rows[0].cnt} prices across all hospitals\n\);
  } else {
    console.log('Price breakdown:');
    const clean = all.rows.filter(r => !r.is_suspicious);
    const flagged = all.rows.filter(r => r.is_suspicious);
    console.log(\  Clean (not flagged): \${clean.length}\);
    if (clean.length > 0) {
      console.log(\    Min: \$\${Math.min(...clean.map(r => r.price))}, Max: \$\${Math.max(...clean.map(r => r.price))}\);
    }
    console.log(\  Flagged (is_suspicious=true): \${flagged.length}\);
    if (flagged.length > 0) {
      console.log(\    Prices: \${flagged.map(r => r.price).join(', ')}\);
    }
    console.log('');
    console.log('Sample prices:');
    all.rows.slice(0, 5).forEach(r => {
      console.log(\  \$\${r.price} - \${r.price_type} - \${r.payer_name || 'N/A'} - Flagged: \${r.is_suspicious}\);
    });
  }

  // Check bounds
  const bounds = await pool.query(
    \SELECT min_cash, max_cash, min_negotiated, max_negotiated, min_gross, max_gross 
     FROM cpt_price_bounds WHERE cpt_code = \$1\, [cpt]
  );

  console.log(\\nBounds set: \${bounds.rows.length > 0 ? 'YES' : 'NO'}\);
  if (bounds.rows.length > 0) {
    const b = bounds.rows[0];
    console.log(\  Cash: \$\${b.min_cash}–\$\${b.max_cash}\);
    console.log(\  Negotiated: \${b.min_negotiated ? \`\$\${b.min_negotiated}–\$\${b.max_negotiated}\ : 'Not set'}\);
    console.log(\  Gross: \${b.min_gross ? \`\$\${b.min_gross}–\$\${b.max_gross}\ : 'Not set'}\);
  }

  await pool.end();
}

// REPLACE THESE WITH KRISH'S VALUES
diagnose('45378', 'Baylor').catch(e => console.error(e));
{b.min_cash}–
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
  console.log(\\n=== DIAGNOSTICS FOR CPT \${cpt} @ \${hospitalName} ===\n\);

  // Find hospital ID
  const hosp = await pool.query(
    \SELECT id, name, city, is_compliant, mrf_last_updated FROM hospitals WHERE name ILIKE \$1 LIMIT 1\,
    [\%\${hospitalName}%\]
  );
  
  if (hosp.rows.length === 0) {
    console.log('❌ Hospital not found. Try:');
    const all = await pool.query(\SELECT DISTINCT name FROM hospitals WHERE name ILIKE \$1 ORDER BY name\, [\%${hospitalName.split(' ')[0]}%\]);
    console.log(all.rows.map(r => r.name));
    await pool.end();
    return;
  }

  const hospId = hosp.rows[0].id;
  console.log(\✓ Hospital: \${hosp.rows[0].name} (\${hosp.rows[0].city}) - Compliant: \${hosp.rows[0].is_compliant} - MRF Updated: \${hosp.rows[0].mrf_last_updated}\n\);

  // Find procedure
  const proc = await pool.query(
    \SELECT id, display_name, standard_name, cpt_code, setting, is_searchable FROM procedures WHERE cpt_code = \$1 LIMIT 1\,
    [cpt]
  );
  
  if (proc.rows.length === 0) {
    console.log(\❌ CPT \${cpt} not found\);
    await pool.end();
    return;
  }

  console.log(\✓ Procedure: \${proc.rows[0].display_name} (Setting: \${proc.rows[0].setting}, Searchable: \${proc.rows[0].is_searchable})\n\);
  const procId = proc.rows[0].id;

  // Get ALL prices for this combo (raw, no filters)
  const all = await pool.query(
    \SELECT price, price_type, payer_name, is_suspicious, hospital_id FROM prices 
     WHERE procedure_id = \$1 AND hospital_id = \$2 ORDER BY price ASC\,
    [procId, hospId]
  );

  console.log(\Total raw prices in DB: \${all.rows.length}\);
  if (all.rows.length === 0) {
    console.log('⚠️  NO PRICES AT ALL for this hospital + procedure combo.\n');
    console.log('Checking if procedure exists at ANY hospital...');
    const any = await pool.query(
      \SELECT COUNT(*) as cnt FROM prices WHERE procedure_id = \$1\, [procId]
    );
    console.log(\  → Procedure has \${any.rows[0].cnt} prices across all hospitals\n\);
  } else {
    console.log('Price breakdown:');
    const clean = all.rows.filter(r => !r.is_suspicious);
    const flagged = all.rows.filter(r => r.is_suspicious);
    console.log(\  Clean (not flagged): \${clean.length}\);
    if (clean.length > 0) {
      console.log(\    Min: \$\${Math.min(...clean.map(r => r.price))}, Max: \$\${Math.max(...clean.map(r => r.price))}\);
    }
    console.log(\  Flagged (is_suspicious=true): \${flagged.length}\);
    if (flagged.length > 0) {
      console.log(\    Prices: \${flagged.map(r => r.price).join(', ')}\);
    }
    console.log('');
    console.log('Sample prices:');
    all.rows.slice(0, 5).forEach(r => {
      console.log(\  \$\${r.price} - \${r.price_type} - \${r.payer_name || 'N/A'} - Flagged: \${r.is_suspicious}\);
    });
  }

  // Check bounds
  const bounds = await pool.query(
    \SELECT min_cash, max_cash, min_negotiated, max_negotiated, min_gross, max_gross 
     FROM cpt_price_bounds WHERE cpt_code = \$1\, [cpt]
  );

  console.log(\\nBounds set: \${bounds.rows.length > 0 ? 'YES' : 'NO'}\);
  if (bounds.rows.length > 0) {
    const b = bounds.rows[0];
    console.log(\  Cash: \$\${b.min_cash}–\$\${b.max_cash}\);
    console.log(\  Negotiated: \${b.min_negotiated ? \`\$\${b.min_negotiated}–\$\${b.max_negotiated}\ : 'Not set'}\);
    console.log(\  Gross: \${b.min_gross ? \`\$\${b.min_gross}–\$\${b.max_gross}\ : 'Not set'}\);
  }

  await pool.end();
}

// REPLACE THESE WITH KRISH'S VALUES
diagnose('45378', 'Baylor').catch(e => console.error(e));
{b.max_cash});
  }

  await pool.end();
}

diagnose('45378', 'Baylor').catch(e => console.error(e));
