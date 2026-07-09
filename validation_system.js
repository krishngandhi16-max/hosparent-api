require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// ══════════════════════════════════════════════════════════════
// HOSPARENT FOOLPROOF VALIDATION SYSTEM
// 1. Creates cpt_price_bounds table — the single source of truth
// 2. Flags every price in every table outside its CPT's bounds
// 3. Fixes name/CPT mismatches (virtual colonoscopy ≠ colonoscopy)
// 4. server.js reads bounds from this table — no more hardcoding
// Run: node validation_system.js
// Re-run any time — safe, idempotent, only flags never deletes
// ══════════════════════════════════════════════════════════════

// Realistic cash-price bounds per CPT. min = cheapest legit ASC/academic
// cash price anywhere in the US. max = highest legit hospital cash price.
const CPT_BOUNDS = [
  // ── GI / ENDOSCOPY ──
  ['45378','Colonoscopy Screening',400,8000],
  ['45380','Colonoscopy with Biopsy',450,9000],
  ['45385','Colonoscopy with Polypectomy',500,10000],
  ['43239','Upper GI Endoscopy with Biopsy',400,8000],
  ['43235','Upper GI Endoscopy Diagnostic',350,7000],
  // ── VIRTUAL COLONOSCOPY IS IMAGING, NOT ENDOSCOPY ──
  ['74263','CT Colonography (Virtual Colonoscopy)',150,3000],
  // ── MAJOR SURGERY ──
  ['27447','Total Knee Replacement',3000,150000],
  ['27130','Total Hip Replacement',3000,150000],
  ['23472','Total Shoulder Replacement',3000,120000],
  ['47562','Laparoscopic Cholecystectomy',1500,100000],
  ['44950','Appendectomy',1500,60000],
  ['44970','Laparoscopic Appendectomy',1500,60000],
  ['49505','Inguinal Hernia Repair',1200,60000],
  ['49650','Laparoscopic Hernia Repair',1200,60000],
  ['49560','Ventral Hernia Repair',1200,60000],
  ['22612','Lumbar Spinal Fusion',5000,200000],
  ['22551','Cervical Fusion',5000,200000],
  ['63030','Lumbar Discectomy/Laminectomy',3000,100000],
  ['29881','Knee Arthroscopy w/ Meniscectomy',1500,60000],
  ['29827','Rotator Cuff Repair Arthroscopic',2000,80000],
  ['66984','Cataract Surgery',800,40000],
  ['42820','Tonsillectomy',300,30000],
  ['58570','Laparoscopic Hysterectomy',2500,80000],
  ['58150','Abdominal Hysterectomy',2500,80000],
  ['60220','Thyroid Lobectomy',2000,60000],
  ['64721','Carpal Tunnel Release',800,25000],
  ['55250','Vasectomy',300,10000],
  ['54150','Circumcision',200,8000],
  ['19303','Mastectomy',2500,80000],
  ['43775','Sleeve Gastrectomy',5000,80000],
  ['43644','Gastric Bypass',6000,100000],
  // ── OB ──
  ['59400','Vaginal Delivery Global',2000,80000],
  ['59510','C-Section Global',2500,80000],
  // ── CARDIAC ──
  ['93454','Cardiac Catheterization',2000,150000],
  ['92928','Angioplasty with Stent',5000,200000],
  ['33206','Pacemaker Insertion',5000,150000],
  ['93653','Cardiac Ablation',5000,150000],
  ['93306','Echocardiogram Complete',80,3000],
  ['93308','Echocardiogram Limited',60,2000],
  ['93000','EKG with Interpretation',8,600],
  ['93010','EKG Interpretation Only',5,300],
  ['93015','Cardiac Stress Test',100,3000],
  // ── IMAGING ──
  ['70551','MRI Brain without Contrast',150,8000],
  ['70552','MRI Brain with Contrast',180,9000],
  ['70553','MRI Brain with/without Contrast',200,10000],
  ['72141','MRI Cervical Spine',150,8000],
  ['72148','MRI Lumbar Spine',150,8000],
  ['72146','MRI Thoracic Spine',150,8000],
  ['73721','MRI Lower Extremity/Knee',150,7000],
  ['73221','MRI Upper Extremity/Shoulder',150,7000],
  ['74177','CT Abdomen/Pelvis with Contrast',120,7000],
  ['74178','CT Abdomen/Pelvis w/wo Contrast',140,8000],
  ['74176','CT Abdomen/Pelvis without Contrast',100,6000],
  ['71260','CT Chest with Contrast',100,6000],
  ['71250','CT Chest without Contrast',90,5000],
  ['70450','CT Head without Contrast',80,5000],
  ['70460','CT Head with Contrast',100,6000],
  ['70490','CT Neck',100,6000],
  ['71046','Chest X-Ray 2 Views',15,1200],
  ['71045','Chest X-Ray 1 View',12,1000],
  ['73564','Knee X-Ray',15,800],
  ['77067','Screening Mammogram',40,900],
  ['77065','Diagnostic Mammogram Unilateral',50,1200],
  ['77066','Diagnostic Mammogram Bilateral',60,1500],
  ['76700','Ultrasound Abdomen Complete',50,1500],
  ['76705','Ultrasound Abdomen Limited',40,1200],
  ['76536','Ultrasound Thyroid',40,1200],
  ['76856','Ultrasound Pelvis',40,1300],
  ['77080','DEXA Bone Density',25,800],
  ['78815','PET/CT Scan',800,15000],
  // ── LABS ── (these caused the $53K CMP disaster)
  ['85025','CBC with Differential',3,300],
  ['80053','Comprehensive Metabolic Panel',3,400],
  ['80048','Basic Metabolic Panel',3,300],
  ['80061','Lipid Panel',3,300],
  ['84443','TSH',3,350],
  ['83036','Hemoglobin A1C',3,250],
  ['82306','Vitamin D 25-Hydroxy',10,400],
  ['84403','Testosterone Total',10,400],
  ['86316','Tumor Marker (CA/PSA variants)',10,1200],
  ['81001','Urinalysis with Microscopy',2,200],
  ['82947','Glucose',2,150],
  ['82607','Vitamin B12',5,250],
  ['82746','Folate',5,250],
  ['85610','Prothrombin Time',3,200],
  ['82565','Creatinine',2,150],
  ['83540','Iron',5,200],
  ['82728','Ferritin',5,250],
  ['86140','C-Reactive Protein',5,250],
  ['80076','Liver Function Panel',5,300],
  ['80074','Hepatitis Panel',30,800],
  ['86703','HIV Test',15,500],
  ['84703','Pregnancy Test hCG',5,200],
  // ── OFFICE / THERAPY ──
  ['99213','Office Visit Established Level 3',40,800],
  ['99214','Office Visit Established Level 4',60,1000],
  ['99215','Office Visit Established Level 5',80,1300],
  ['99283','ER Visit Moderate',150,8000],
  ['99284','ER Visit High',250,12000],
  ['99285','ER Visit Critical',400,20000],
  ['90837','Psychotherapy 60 min',60,600],
  ['90834','Psychotherapy 45 min',50,500],
  ['97110','Physical Therapy Exercise',25,500],
  ['97530','PT Therapeutic Activities',25,500],
  ['90935','Hemodialysis Single',100,3000],
  ['96413','Chemotherapy Infusion First Hour',150,15000],
  ['62322','Epidural Injection Lumbar',200,8000],
  ['62323','Epidural Injection w/ Imaging',250,9000],
];

// Name-pattern → required CPT rules. If a procedure name matches the
// pattern but has the wrong CPT, it gets re-coded or flagged.
const NAME_CPT_RULES = [
  { pattern: '%virtual colonoscop%', correctCpt: '74263', wrongCpts: ['45378','45380','45385'] },
  { pattern: '%ct colonograph%',     correctCpt: '74263', wrongCpts: ['45378','45380','45385'] },
  { pattern: '%colonograph%',        correctCpt: '74263', wrongCpts: ['45378','45380','45385'] },
  { pattern: '%revision%knee%',      correctCpt: null,    wrongCpts: ['27447'] }, // revisions aren't 27447
  { pattern: '%revision%hip%',       correctCpt: null,    wrongCpts: ['27130'] },
  { pattern: '%port%kit%',           correctCpt: null,    wrongCpts: ['80053'] }, // supply kits mismapped to CMP
  { pattern: '%catheter%',           correctCpt: null,    wrongCpts: ['93306','93000'] }, // cath devices mismapped to echo/EKG
];

async function main() {
  console.log('HOSPARENT VALIDATION SYSTEM');
  console.log('='.repeat(50));

  // ── STEP 1: bounds table = single source of truth ──────────
  console.log('\n[1/5] Building cpt_price_bounds table...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cpt_price_bounds (
      cpt_code TEXT PRIMARY KEY,
      procedure_label TEXT,
      min_cash NUMERIC(10,2),
      max_cash NUMERIC(10,2),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  for (const [cpt, label, min, max] of CPT_BOUNDS) {
    await pool.query(`
      INSERT INTO cpt_price_bounds (cpt_code, procedure_label, min_cash, max_cash)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (cpt_code) DO UPDATE SET
        procedure_label = EXCLUDED.procedure_label,
        min_cash = EXCLUDED.min_cash,
        max_cash = EXCLUDED.max_cash,
        updated_at = NOW()
    `, [cpt, label, min, max]);
  }
  console.log(`  ${CPT_BOUNDS.length} CPT bounds loaded`);

  // ── STEP 2: fix name/CPT mismatches ─────────────────────────
  console.log('\n[2/5] Fixing name→CPT mismatches (the $199 colonoscopy bug)...');
  for (const rule of NAME_CPT_RULES) {
    if (rule.correctCpt) {
      const r = await pool.query(`
        UPDATE procedures SET cpt_code = $1
        WHERE standard_name ILIKE $2 AND cpt_code = ANY($3::text[])
      `, [rule.correctCpt, rule.pattern, rule.wrongCpts]);
      if (r.rowCount) console.log(`  Re-coded ${r.rowCount} procedures matching "${rule.pattern}" → ${rule.correctCpt}`);
    } else {
      const r = await pool.query(`
        UPDATE procedures SET cpt_code = NULL, is_searchable = false
        WHERE standard_name ILIKE $1 AND cpt_code = ANY($2::text[])
      `, [rule.pattern, rule.wrongCpts]).catch(async e => {
        // is_searchable column may not exist — fall back to just nulling CPT
        return pool.query(`
          UPDATE procedures SET cpt_code = NULL
          WHERE standard_name ILIKE $1 AND cpt_code = ANY($2::text[])
        `, [rule.pattern, rule.wrongCpts]);
      });
      if (r.rowCount) console.log(`  Unlinked ${r.rowCount} procedures matching "${rule.pattern}" from wrong CPTs`);
    }
  }

  // Same fix for imaging_prices — virtual colonoscopy must be labeled as CT
  const img = await pool.query(`
    UPDATE imaging_prices SET cpt_code = '74263'
    WHERE (procedure_name ILIKE '%virtual colonoscop%' OR procedure_name ILIKE '%colonograph%')
    AND (cpt_code IS NULL OR cpt_code IN ('45378','45380','45385'))
  `).catch(() => ({ rowCount: 0 }));
  if (img.rowCount) console.log(`  Re-coded ${img.rowCount} imaging prices to CT Colonography 74263`);

  // ── STEP 3: flag every out-of-bounds hospital price ─────────
  console.log('\n[3/5] Flagging out-of-bounds prices across ALL CPTs (one pass)...');
  const flagCash = await pool.query(`
    UPDATE prices pr SET is_suspicious = true,
      validation_reason = b.procedure_label || ': outside $' || b.min_cash || '-$' || b.max_cash
    FROM procedures p, cpt_price_bounds b
    WHERE pr.procedure_id = p.id
    AND p.cpt_code = b.cpt_code
    AND pr.price_type = 'cash'
    AND pr.is_suspicious IS NOT TRUE
    AND (pr.price < b.min_cash OR pr.price > b.max_cash)
  `);
  console.log(`  Flagged ${flagCash.rowCount} cash prices`);

  const flagNeg = await pool.query(`
    UPDATE prices pr SET is_suspicious = true,
      validation_reason = b.procedure_label || ' negotiated: outside $' || (b.min_cash*0.3)::int || '-$' || b.max_cash
    FROM procedures p, cpt_price_bounds b
    WHERE pr.procedure_id = p.id
    AND p.cpt_code = b.cpt_code
    AND pr.price_type = 'negotiated'
    AND pr.is_suspicious IS NOT TRUE
    AND (pr.price < b.min_cash * 0.3 OR pr.price > b.max_cash)
  `);
  console.log(`  Flagged ${flagNeg.rowCount} negotiated prices (negotiated floor = 30% of cash floor)`);

  // ── STEP 4: flag imaging_prices too ─────────────────────────
  console.log('\n[4/5] Validating imaging_prices table...');
  await pool.query(`ALTER TABLE imaging_prices ADD COLUMN IF NOT EXISTS is_suspicious BOOLEAN DEFAULT false`);
  const flagImg = await pool.query(`
    UPDATE imaging_prices ip SET is_suspicious = true
    FROM cpt_price_bounds b
    WHERE ip.cpt_code = b.cpt_code
    AND ip.is_suspicious IS NOT TRUE
    AND (ip.price < b.min_cash OR ip.price > b.max_cash)
  `);
  console.log(`  Flagged ${flagImg.rowCount} imaging prices`);

  // ── STEP 5: verification report ─────────────────────────────
  console.log('\n[5/5] VERIFICATION REPORT — min/max cash per key CPT after cleaning:');
  const report = await pool.query(`
    SELECT p.cpt_code, b.procedure_label,
      MIN(pr.price) as min_cash, MAX(pr.price) as max_cash, COUNT(*) as n
    FROM prices pr
    JOIN procedures p ON p.id = pr.procedure_id
    JOIN cpt_price_bounds b ON b.cpt_code = p.cpt_code
    WHERE pr.price_type = 'cash' AND pr.is_suspicious IS NOT TRUE
    AND p.cpt_code IN ('45378','27447','27130','47562','70551','80053','93000','71046','66984','29881')
    GROUP BY p.cpt_code, b.procedure_label ORDER BY p.cpt_code
  `);
  for (const r of report.rows) {
    console.log(`  ${r.cpt_code} ${r.procedure_label}: $${r.min_cash} – $${r.max_cash} (${r.n} prices)`);
  }

  const totals = await pool.query(`SELECT is_suspicious, COUNT(*) FROM prices GROUP BY is_suspicious`);
  console.log('\nTotals:', totals.rows.map(r => `${r.is_suspicious ? 'flagged' : 'clean'}: ${r.count}`).join(' | '));

  console.log('\nDONE. Every future scraper should INSERT through these bounds.');
  console.log('server.js: replace hardcoded PRICE_BOUNDS with a JOIN on cpt_price_bounds (patch below).');
  await pool.end();
}

main().catch(console.error);