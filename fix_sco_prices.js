// fix_sco_prices.js — rebuild sco_prices from SCO's live pricing page (ground truth,
// captured 2026-07-13) and flag the 5 CPTs whose gross rows fail /verify-all.
//
//   node fix_sco_prices.js           -> dry run: shows counts + what would change
//   node fix_sco_prices.js --apply   -> backup table, rebuild, flag, verify
//
// Why: the original scrapeSCO() in scraper_ultimate_mega.js used a keyword->CPT map
// ('knee' -> 27447, 'gallbladder' -> 47562) plus a hardcoded fallback list. That
// mis-tagged rows (e.g. "Bilateral Knee Arthroscopy" as a total knee replacement)
// and left stale prices (lap chole $5,865; SCO's real price is $6,836).
// DO NOT re-run scraper_ultimate_mega.js PART 7 — it will re-insert the bad rows.
//
// Rules honored: look before writing (schema introspection), count-before /
// apply / verify-after on every statement, nothing deleted without a same-DB backup.

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const APPLY = process.argv.includes('--apply');
const SRC = 'https://surgerycenterok.com/pricing/';
const NOTE = 'All-inclusive: facility + surgeon + anesthesia. No hidden fees.';
const IMPL = 'All-inclusive EXCEPT implants/hardware, billed separately at cost.';

// [name, price, cpt|null, confidence, note]  — prices verbatim from SCO pricing page 2026-07-13.
// cpt is null where the SCO line is a combo/variant with no single clean CPT.
const DATA = [
  // General / GI
  ['Laparoscopic Cholecystectomy (Gallbladder Removal)', 6836, '47562', 'high', NOTE],
  ['Gallbladder removal with liver biopsy', 7556, null, null, NOTE],
  ['Appendectomy (laparoscopic)', 7368, '44970', 'high', NOTE],
  ['Inguinal Hernia Repair', 3870, '49505', 'high', NOTE],
  ['Laparoscopic Hernia Repair, Unilateral', 6705, '49650', 'high', NOTE],
  ['Laparoscopic Hernia Repair, Bilateral', 8673, null, null, NOTE],
  ['Umbilical Hernia Repair', 3708, '49585', 'high', NOTE],
  ['Ventral Hernia Repair', 3720, '49560', 'medium', IMPL + ' Mesh not included.'],
  ['Incisional Hernia Repair', 5225, null, null, IMPL + ' Mesh not included.'],
  ['Epigastric Hernia Repair', 3720, '49570', 'medium', IMPL + ' Mesh not included.'],
  ['Femoral Hernia Repair', 3532, '49550', 'medium', IMPL + ' Mesh not included.'],
  ['Hiatal Hernia Surgery', 13707, '43281', 'medium', NOTE],
  ['Laparoscopic Nissen Fundoplication (Reflux Surgery)', 13707, '43280', 'high', NOTE],
  ['Hemorrhoidectomy', 4425, '46260', 'high', NOTE],
  ['Pilonidal Cyst Removal', 4600, '11771', 'medium', NOTE],
  ['Laparoscopic Gastric Bypass', 18750, '43644', 'high', NOTE],
  ['Laparoscopic Sleeve Gastrectomy', 16750, '43775', 'high', NOTE],
  ['Lap Band Removal', 6836, '43774', 'medium', NOTE],
  ['Breast Mass Excision', 3943, '19120', 'high', NOTE],
  ['Partial Mastectomy, Unilateral', 6367, '19301', 'high', NOTE],
  ['Mastectomy (unilateral)', 8791, '19303', 'high', NOTE],
  ['Thyroidectomy, Partial Lobectomy Unilateral', 7155, '60220', 'high', NOTE],
  ['Parathyroidectomy', 7155, '60500', 'high', NOTE],
  ['Bone Marrow Biopsy (includes pathology)', 6330, '38221', 'medium', NOTE],
  // Orthopedics
  ['Total Knee Arthroplasty (Knee Replacement)', 17679, '27447', 'high', IMPL],
  ['Total Hip Replacement', 17579, '27130', 'high', IMPL],
  ['Shoulder Arthroplasty (Total Shoulder)', 17479, '23472', 'high', IMPL],
  ['Ankle Replacement', 14940, '27702', 'medium', IMPL],
  ['Ankle Fusion (overnight stay included)', 9210, '27870', 'medium', IMPL],
  ['Knee Arthroscopy', 4458, '29870', 'medium', NOTE],
  ['Medial & Lateral Meniscectomy', 4458, '29880', 'high', NOTE],
  ['Anterior Cruciate Ligament Repair', 7931, '29888', 'high', NOTE],
  ['Posterior Cruciate Ligament Repair', 8171, '29889', 'medium', NOTE],
  ['Rotator Cuff Repair (Arthroscopic)', 9682, '29827', 'high', NOTE],
  ['Open Rotator Cuff Repair', 7159, '23412', 'high', NOTE],
  ['Subacromial Decompression', 6679, '29826', 'high', NOTE],
  ['Arthroscopic Labral Repair (shoulder)', 7172, '29807', 'high', IMPL],
  ['Arthroscopic Biceps Tenodesis', 9682, '29828', 'high', IMPL],
  ['Distal Clavicle Excision (arthroscopic)', 6679, '29824', 'high', NOTE],
  ['Carpal Tunnel Release', 3205, '64721', 'high', NOTE],
  ['Cubital Tunnel Release', 5247, '64718', 'high', NOTE],
  ['Trigger Finger', 3025, '26055', 'high', NOTE],
  ['Ganglion Excision (wrist)', 3205, '25111', 'medium', NOTE],
  ['Achilles Repair', 6561, '27650', 'high', NOTE],
  ['Bunionectomy', 4790, '28296', 'medium', NOTE],
  ['Hammertoe (1)', 2875, '28285', 'high', NOTE],
  ['Plantar Fasciotomy', 3586, '28060', 'medium', NOTE],
  ['Neuroma Excision (foot)', 3200, '28080', 'high', NOTE],
  ['Hardware Removal, Simple', 2926, '20680', 'medium', NOTE],
  ['Wrist Fusion', 9600, '25800', 'medium', IMPL + ' Hardware ~$3300 not included.'],
  // Spine
  ['Microdiscectomy', 12230, '63030', 'high', NOTE],
  ['Lumbar Laminectomy', 12230, '63047', 'medium', NOTE],
  ['Lumbar Fusion, 1 level', 38000, '22612', 'medium', IMPL],
  ['Lumbar Fusion, 2 levels', 49625, null, null, IMPL],
  ['Anterior Cervical Discectomy with Fusion, 1 level', 17384, '22551', 'high', IMPL],
  ['Anterior Cervical Discectomy with Fusion, 2 levels', 24452, null, null, IMPL],
  ['Cervical Artificial Disc Placement', 17384, '22856', 'medium', IMPL],
  ['Sacroiliac Joint Fusion', 7450, '27279', 'medium', IMPL],
  ['Lumbar Puncture', 1295, '62270', 'high', NOTE + ' Lab charges not included.'],
  // ENT
  ['Tonsillectomy', 3875, '42826', 'medium', NOTE],
  ['Tonsillectomy and Adenoidectomy', 4180, '42820', 'medium', NOTE],
  ['Adenoidectomy', 3710, '42830', 'medium', NOTE],
  ['Bilateral Myringotomy with Tubes', 1960, '69436', 'high', NOTE],
  ['Septoplasty', 4450, '30520', 'high', NOTE],
  ['Tympanoplasty', 5732, '69631', 'high', NOTE],
  ['Stapedectomy', 6610, '69660', 'medium', NOTE],
  ['Cochlear Implant', 10510, '69930', 'high', IMPL],
  ['Thyroglossal Duct Cyst Excision', 4490, '60280', 'high', NOTE],
  ['UPP (Uvulopalatopharyngoplasty)', 6337, '42145', 'high', NOTE],
  ['Parotidectomy, lateral lobe', 5857, '42415', 'high', NOTE],
  ['Tonsillectomy and Direct Laryngoscopy', 5200, null, null, NOTE], // <- the $5,200 that was wrongly shown as 47562
  // Eye
  ['Cataract Surgery (one side)', 4800, '66984', 'high', NOTE],
  ['Blepharoplasty (droopy eyelids)', 4775, '15823', 'medium', NOTE],
  ['Chalazion', 2164, '67800', 'medium', NOTE],
  // Gynecology
  ['Dilation and Curettage', 2200, '58120', 'high', NOTE],
  ['Hysteroscopy', 2900, '58555', 'high', NOTE],
  ['Hysteroscopy with Polyp Removal', 5180, '58558', 'high', NOTE],
  ['Hysteroscopy / Ablation', 4560, '58563', 'high', NOTE],
  ['Laparoscopy with Vaginal Hysterectomy', 9190, '58550', 'medium', NOTE],
  ['Ovarian Cystectomy', 5940, '58662', 'medium', NOTE],
  ['Cervical Conization (LEEP)', 3290, '57461', 'medium', NOTE],
  // Urology
  ['Circumcision', 2930, '54161', 'high', NOTE],
  ['Vasovasostomy', 9700, '55400', 'high', NOTE],
  ['Hydrocelectomy', 4165, '55040', 'high', NOTE],
  ['Orchiectomy', 4165, '54520', 'high', NOTE],
  ['Orchiopexy', 4165, '54640', 'medium', NOTE],
  ['Transurethral Resection, Prostate (TURP)', 4910, '52601', 'high', NOTE],
  ['Lithotripsy (one side)', 6130, '50590', 'high', NOTE],
  ['Cystoscopy for Stone / Stent Placement', 4715, '52332', 'medium', NOTE],
  ['Ultrasound-Guided Prostate Biopsy', 4085, '55700', 'high', NOTE],
  ['Testicular Biopsy', 2210, '54500', 'medium', NOTE],
  ['Urolift', 4120, '52441', 'medium', IMPL],
];

// CPTs whose gross rows failed the live /verify-all (2026-07-12 run)
const GROSS_FAIL_CPTS = ['74263', '77080', '93306', '93454', '93653'];

const q = (text, params) => pool.query(text, params);
const one = async (text, params) => (await q(text, params)).rows[0];

async function columns(table) {
  const r = await q(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]);
  return r.rows.map(x => x.column_name);
}

async function main() {
  console.log(`FIX SCO PRICES ${APPLY ? '(APPLY)' : '(dry run)'}`);
  console.log('='.repeat(60));

  // 1. Look before writing
  const scoCols = await columns('sco_prices');
  if (!scoCols.length) { console.error('sco_prices table not found — abort.'); process.exit(1); }
  console.log('sco_prices columns:', scoCols.join(', '));
  for (const need of ['procedure_name', 'cpt_code', 'all_inclusive_price']) {
    if (!scoCols.includes(need)) { console.error(`missing expected column ${need} — abort.`); process.exit(1); }
  }

  const before = Number((await one(`SELECT COUNT(*) AS n FROM sco_prices`)).n);
  const bad = await q(`SELECT procedure_name, all_inclusive_price FROM sco_prices WHERE cpt_code = '47562'`);
  console.log(`[count-before] sco_prices rows: ${before}`);
  console.log(`[count-before] rows currently tagged 47562:`);
  for (const r of bad.rows) console.log(`    $${r.all_inclusive_price}  ${r.procedure_name}`);
  console.log(`[plan] rebuild with ${DATA.length} curated rows (${DATA.filter(d => d[2]).length} CPT-mapped)`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing changed. Re-run with --apply.');
    await pool.end();
    return;
  }

  // 2. Backup (never lose data), then rebuild
  await q(`CREATE TABLE IF NOT EXISTS sco_prices_backup_20260713 AS TABLE sco_prices`);
  const bk = Number((await one(`SELECT COUNT(*) AS n FROM sco_prices_backup_20260713`)).n);
  console.log(`[backup] sco_prices_backup_20260713: ${bk} rows preserved`);

  await q(`ALTER TABLE sco_prices ADD COLUMN IF NOT EXISTS cpt_confidence TEXT`);
  await q(`ALTER TABLE sco_prices ADD COLUMN IF NOT EXISTS scraped_at DATE`);
  await q(`DELETE FROM sco_prices`);
  let ins = 0;
  for (const [name, price, cpt, conf, note] of DATA) {
    await q(`
      INSERT INTO sco_prices (procedure_name, cpt_code, all_inclusive_price,
                              includes_description, source_url, cpt_confidence, scraped_at)
      VALUES ($1,$2,$3,$4,$5,$6,'2026-07-13')`,
      [name, cpt, price, note, SRC, conf]);
    ins++;
  }

  // 3. Verify rebuild
  const after = Number((await one(`SELECT COUNT(*) AS n FROM sco_prices`)).n);
  const chole = await one(`SELECT all_inclusive_price AS p FROM sco_prices WHERE cpt_code = '47562'`);
  const knee = await one(`SELECT all_inclusive_price AS p FROM sco_prices WHERE cpt_code = '27447'`);
  const ghost = Number((await one(
    `SELECT COUNT(*) AS n FROM sco_prices WHERE cpt_code = '47562' AND all_inclusive_price <> 6836`)).n);
  console.log(`[verify] rows: ${after} (inserted ${ins})  47562=$${chole && chole.p}  27447=$${knee && knee.p}  wrong-47562-rows=${ghost}`);
  if (after !== ins || !chole || Number(chole.p) !== 6836 || ghost !== 0) {
    console.error('VERIFY FAILED — restore with: DELETE FROM sco_prices; INSERT INTO sco_prices SELECT * FROM sco_prices_backup_20260713;');
    process.exit(1);
  }

  // 4. Flag (never delete) unbounded gross rows on the 5 /verify-all failures
  const bCols = await columns('cpt_price_bounds');
  const lo = bCols.includes('min_gross') ? 'min_gross' : 'min_cash';
  const hi = bCols.includes('max_gross') ? 'max_gross' : 'max_cash';
  console.log(`[gross-flag] using bounds columns ${lo}/${hi}`);
  const cnt = Number((await one(`
    SELECT COUNT(*) AS n FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN cpt_price_bounds b ON b.cpt_code = p.cpt_code
    WHERE p.cpt_code = ANY($1) AND pr.price_type = 'gross'
      AND pr.is_suspicious IS NOT TRUE
      AND (pr.price < b.${lo} OR pr.price > b.${hi})`, [GROSS_FAIL_CPTS])).n);
  console.log(`[count-before] unflagged out-of-bounds gross rows on ${GROSS_FAIL_CPTS.join(',')}: ${cnt}`);
  if (cnt > 5000) {
    console.error('Unexpectedly large (>5000) — not flagging automatically. Investigate first.');
  } else if (cnt > 0) {
    const upd = await q(`
      UPDATE prices pr SET is_suspicious = TRUE,
        validation_reason = 'GROSS_OUT_OF_BOUNDS_20260713'
      FROM procedures p, cpt_price_bounds b
      WHERE p.id = pr.procedure_id AND b.cpt_code = p.cpt_code
        AND p.cpt_code = ANY($1) AND pr.price_type = 'gross'
        AND pr.is_suspicious IS NOT TRUE
        AND (pr.price < b.${lo} OR pr.price > b.${hi})`, [GROSS_FAIL_CPTS]);
    const left = Number((await one(`
      SELECT COUNT(*) AS n FROM prices pr
      JOIN procedures p ON p.id = pr.procedure_id
      JOIN cpt_price_bounds b ON b.cpt_code = p.cpt_code
      WHERE p.cpt_code = ANY($1) AND pr.price_type = 'gross'
        AND pr.is_suspicious IS NOT TRUE
        AND (pr.price < b.${lo} OR pr.price > b.${hi})`, [GROSS_FAIL_CPTS])).n);
    console.log(`[verify] flagged ${upd.rowCount}, remaining unflagged: ${left} (want 0)`);
  }

  console.log('\nDONE. Hit /cache-clear on the API, then /verify-all should pass 106/106.');
  await pool.end();
}

main().catch(e => { console.error('FAILED: ' + (e.stack || e.message)); process.exit(1); });
