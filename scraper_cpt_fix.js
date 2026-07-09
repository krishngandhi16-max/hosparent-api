require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Name-to-CPT mapping for common BSW procedures
const CPT_MAP = [
  { pattern: /gallbladder.*lapar|cholecystectomy.*lapar|lapar.*cholecystectomy/i, cpt: '47562' },
  { pattern: /cholecystectomy/i, cpt: '47562' },
  { pattern: /gallbladder.*open|open.*cholecystectomy/i, cpt: '47600' },
  { pattern: /calculi.*bili|bili.*calculi|gallbladder.*calculi/i, cpt: '47480' },
  { pattern: /mri.*brain|brain.*mri/i, cpt: '70551' },
  { pattern: /mri.*brain.*contrast|brain.*mri.*contrast/i, cpt: '70553' },
  { pattern: /ct.*abd.*pelvis|abdomen.*pelvis.*ct/i, cpt: '74177' },
  { pattern: /ct.*abdomen|abdomen.*ct/i, cpt: '74176' },
  { pattern: /total.*knee.*arthroplasty|knee.*arthroplasty.*total/i, cpt: '27447' },
  { pattern: /knee.*arthroplasty|arthroplasty.*knee/i, cpt: '27447' },
  { pattern: /total.*hip.*arthroplasty|hip.*arthroplasty.*total/i, cpt: '27130' },
  { pattern: /hip.*arthroplasty|arthroplasty.*hip/i, cpt: '27130' },
  { pattern: /colonoscopy.*biopsy|biopsy.*colonoscopy/i, cpt: '45380' },
  { pattern: /colonoscopy.*polypectomy/i, cpt: '45385' },
  { pattern: /colonoscopy/i, cpt: '45378' },
  { pattern: /appendectomy.*lapar|lapar.*appendectomy/i, cpt: '44950' },
  { pattern: /appendectomy/i, cpt: '44950' },
  { pattern: /cardiac.*cath|cath.*cardiac|coronary.*angiography/i, cpt: '93454' },
  { pattern: /echocardiogram|echo.*cardiogram/i, cpt: '93306' },
  { pattern: /ekg|electrocardiogram|ecg/i, cpt: '93000' },
  { pattern: /mammogram|mammography/i, cpt: '77067' },
  { pattern: /chest.*xray|xray.*chest|chest.*x-ray/i, cpt: '71046' },
  { pattern: /knee.*xray|xray.*knee/i, cpt: '73564' },
  { pattern: /hip.*xray|xray.*hip/i, cpt: '73502' },
  { pattern: /ultrasound.*abdomen|abdomen.*ultrasound/i, cpt: '76700' },
  { pattern: /physical.*therapy|therapy.*physical/i, cpt: '97110' },
  { pattern: /office.*visit.*new|new.*patient.*visit/i, cpt: '99203' },
  { pattern: /office.*visit.*established|established.*patient/i, cpt: '99213' },
  { pattern: /hernia.*inguinal.*lapar/i, cpt: '49650' },
  { pattern: /hernia.*inguinal/i, cpt: '49505' },
  { pattern: /hernia.*ventral/i, cpt: '49560' },
  { pattern: /spinal.*fusion.*lumbar|lumbar.*fusion/i, cpt: '22612' },
  { pattern: /cataract.*surgery|lens.*removal/i, cpt: '66984' },
  { pattern: /tonsillectomy/i, cpt: '42820' },
  { pattern: /c-section|cesarean/i, cpt: '59510' },
  { pattern: /vaginal.*delivery|normal.*delivery/i, cpt: '59400' },
  { pattern: /endoscopy.*upper|upper.*endoscopy|egd/i, cpt: '43239' },
  { pattern: /paracentesis/i, cpt: '49082' },
  { pattern: /dialysis.*hemo|hemodialysis/i, cpt: '90935' },
  { pattern: /blood.*panel|metabolic.*panel|comprehensive.*metabolic/i, cpt: '80053' },
  { pattern: /lipid.*panel/i, cpt: '80061' },
  { pattern: /cbc|complete.*blood.*count/i, cpt: '85025' },
  { pattern: /thyroid.*tsh|tsh/i, cpt: '84443' },
];

async function main() {
  console.log('BSW CPT Code Translation Fix');
  console.log('================================');

  // Get all BSW procedures with non-standard CPT codes
  const procedures = await pool.query(`
    SELECT DISTINCT p.id, p.standard_name, p.cpt_code
    FROM procedures p
    JOIN prices pr ON pr.procedure_id = p.id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE h.name ILIKE '%baylor%'
    AND (p.cpt_code IS NULL OR p.cpt_code NOT SIMILAR TO '[0-9]{5}')
    AND p.standard_name IS NOT NULL
    LIMIT 50000
  `);

  console.log(`Found ${procedures.rows.length} BSW procedures to translate`);

  let matched = 0;
  let updated = 0;

  for (const proc of procedures.rows) {
    const name = proc.standard_name || '';

    for (const mapping of CPT_MAP) {
      if (mapping.pattern.test(name)) {
        matched++;

        // Check if medicare rate exists for this CPT
        const medicare = await pool.query(
          'SELECT facility_rate, non_facility_rate FROM medicare_rates WHERE cpt_code = $1 AND modifier IS NULL LIMIT 1',
          [mapping.cpt]
        );

        const facilityRate = medicare.rows[0]?.facility_rate || null;
        const nonFacilityRate = medicare.rows[0]?.non_facility_rate || null;

        // Update procedure with real CPT and Medicare rate
        await pool.query(`
          UPDATE procedures
          SET cpt_code = $1,
              medicare_facility_rate = $2,
              medicare_non_facility_rate = $3
          WHERE id = $4
        `, [mapping.cpt, facilityRate, nonFacilityRate, proc.id]);

        updated++;
        break;
      }
    }
  }

  console.log(`Matched: ${matched} procedures`);
  console.log(`Updated: ${updated} procedures with real CPT codes and Medicare rates`);

  // Verify gallbladder fix
  const check = await pool.query(`
    SELECT p.standard_name, p.cpt_code, p.medicare_facility_rate
    FROM procedures p
    JOIN prices pr ON pr.procedure_id = p.id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE h.name ILIKE '%baylor%plano%'
    AND p.standard_name ILIKE '%gallbladder%'
    AND pr.price_type = 'cash'
    LIMIT 5
  `);

  console.log('\nGallbladder verification:');
  for (const r of check.rows) {
    console.log(`  ${r.standard_name} | CPT: ${r.cpt_code} | Medicare: $${r.medicare_facility_rate}`);
  }

  await pool.end();
}

main().catch(console.error);