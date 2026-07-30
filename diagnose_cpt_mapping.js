// diagnose_cpt_mapping.js — surfaces procedures rows whose standard_name/display_name
// suggests a DIFFERENT CPT code than the one they're actually tagged with (e.g. a row
// named "Colonoscopy with Biopsy" tagged cpt_code=45378, when biopsy during colonoscopy
// is properly billed as 45380). This is a read-only report — it changes nothing.
//
// Usage: node diagnose_cpt_mapping.js 45378,45380,45385
require('dotenv').config();
const { pool } = require('./db');

// Standard, unambiguous CPT text patterns that should NOT appear under a code other
// than the one listed — these are well-established codes, not a lookup call.
const EXPECTED_CODE_FOR_PATTERN = [
  [/biopsy/i, '45380'],
  [/polyp.*(removal|snare)|snare/i, '45385'],
  [/hot biopsy forceps/i, '45384'],
  [/foreign body/i, '44390'],
];

async function main() {
  const cptCodes = (process.argv[2] || '45378,45380,45385').split(',').map((s) => s.trim());
  console.log(`\n=== CPT mapping check: ${cptCodes.join(', ')} ===\n`);

  const rows = await pool.query(`
    SELECT p.id AS procedure_id, p.cpt_code, p.standard_name, p.display_name,
      COUNT(DISTINCT pr.hospital_id)::int AS hospital_count,
      MIN(pr.price) FILTER (WHERE pr.price_type = 'cash')::numeric AS min_cash,
      MAX(pr.price) FILTER (WHERE pr.price_type = 'cash')::numeric AS max_cash
    FROM procedures p
    LEFT JOIN prices pr ON pr.procedure_id = p.id
    WHERE p.cpt_code = ANY($1::text[])
    GROUP BY p.id, p.cpt_code, p.standard_name, p.display_name
    ORDER BY p.cpt_code, p.id
  `, [cptCodes]);

  console.log(`${rows.rows.length} distinct procedure rows share these CPT codes:\n`);

  let suspects = 0;
  for (const r of rows.rows) {
    const text = `${r.standard_name || ''} ${r.display_name || ''}`;
    let flag = '';
    for (const [pattern, expectedCode] of EXPECTED_CODE_FOR_PATTERN) {
      if (pattern.test(text) && r.cpt_code !== expectedCode) {
        flag = `  <-- MISMATCH: name suggests CPT ${expectedCode}, but tagged ${r.cpt_code}`;
        suspects++;
        break;
      }
    }
    console.log(
      `  procedure_id=${r.procedure_id}  cpt=${r.cpt_code}  hospitals=${r.hospital_count}  ` +
      `cash=$${r.min_cash || '?'}-$${r.max_cash || '?'}  "${r.standard_name || '(null)'}" / "${r.display_name || '(null)'}"${flag}`
    );
  }

  console.log(`\n${suspects} likely miscoded row(s) found.`);
  if (suspects > 0) {
    console.log('These are proposals, not applied — review the list above, then tell Hoser');
    console.log('to run the recode_procedure_cpt safe-fix on the specific procedure_id(s) you approve.');
  }
  console.log();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => pool.end());
