require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// ══════════════════════════════════════════════════════════════
// MASTER CPT MAPPING — every procedure a patient might search
// Maps common name patterns → standard 5-digit CPT code
// ══════════════════════════════════════════════════════════════
const CPT_MAPPINGS = [
  // ── MRI ──────────────────────────────────────────────────
  { pattern: /mri.*brain|brain.*mri/i, cpt: '70551', name: 'MRI Brain without Contrast' },
  { pattern: /mri.*brain.*contrast|brain.*mri.*w.*dye/i, cpt: '70553', name: 'MRI Brain with and without Contrast' },
  { pattern: /mri.*brain.*w.*dye|brain.*w.*dye.*mri/i, cpt: '70552', name: 'MRI Brain with Contrast' },
  { pattern: /mri.*spine.*cervical|cervical.*spine.*mri|neck.*mri|mri.*neck/i, cpt: '72141', name: 'MRI Cervical Spine without Contrast' },
  { pattern: /mri.*spine.*lumbar|lumbar.*spine.*mri|lower.*back.*mri|mri.*lower.*back/i, cpt: '72148', name: 'MRI Lumbar Spine without Contrast' },
  { pattern: /mri.*spine.*thoracic|thoracic.*spine.*mri/i, cpt: '72146', name: 'MRI Thoracic Spine without Contrast' },
  { pattern: /mri.*knee|knee.*mri/i, cpt: '73721', name: 'MRI Knee without Contrast' },
  { pattern: /mri.*shoulder|shoulder.*mri/i, cpt: '73221', name: 'MRI Shoulder without Contrast' },
  { pattern: /mri.*hip|hip.*mri/i, cpt: '73721', name: 'MRI Hip without Contrast' },
  { pattern: /mri.*wrist|wrist.*mri/i, cpt: '73221', name: 'MRI Wrist without Contrast' },
  { pattern: /mri.*ankle|ankle.*mri/i, cpt: '73721', name: 'MRI Ankle without Contrast' },
  { pattern: /mri.*foot|foot.*mri/i, cpt: '73721', name: 'MRI Foot without Contrast' },
  { pattern: /mri.*hand|hand.*mri/i, cpt: '73221', name: 'MRI Hand without Contrast' },
  { pattern: /mri.*pelvis|pelvis.*mri/i, cpt: '72197', name: 'MRI Pelvis without Contrast' },
  { pattern: /mri.*abdomen|abdomen.*mri/i, cpt: '74183', name: 'MRI Abdomen without Contrast' },
  { pattern: /mri.*chest|chest.*mri/i, cpt: '71550', name: 'MRI Chest without Contrast' },
  { pattern: /mri.*cardiac|cardiac.*mri|heart.*mri|mri.*heart/i, cpt: '75561', name: 'MRI Heart without Contrast' },
  { pattern: /mri.*orbit|orbit.*mri|mri.*eye|eye.*mri/i, cpt: '70553', name: 'MRI Orbit without Contrast' },
  { pattern: /mri.*prostate|prostate.*mri/i, cpt: '72197', name: 'MRI Prostate without Contrast' },
  { pattern: /mri.*liver|liver.*mri/i, cpt: '74183', name: 'MRI Liver without Contrast' },
  { pattern: /mri.*breast|breast.*mri/i, cpt: '77048', name: 'MRI Breast without Contrast' },
  { pattern: /functional.*mri|mri.*functional/i, cpt: '70555', name: 'MRI Brain Functional' },

  // ── CT ────────────────────────────────────────────────────
  { pattern: /ct.*abdomen.*pelvis.*contrast|ct.*abd.*pelvis.*w\/c/i, cpt: '74177', name: 'CT Abdomen and Pelvis with Contrast' },
  { pattern: /ct.*abdomen.*pelvis|ct.*abd.*pelvis/i, cpt: '74178', name: 'CT Abdomen and Pelvis without Contrast' },
  { pattern: /ct.*abdomen.*contrast|ct.*abd.*w.*contrast/i, cpt: '74160', name: 'CT Abdomen with Contrast' },
  { pattern: /ct.*abdomen|ct.*abd/i, cpt: '74150', name: 'CT Abdomen without Contrast' },
  { pattern: /ct.*pelvis.*contrast/i, cpt: '72193', name: 'CT Pelvis with Contrast' },
  { pattern: /ct.*pelvis/i, cpt: '72192', name: 'CT Pelvis without Contrast' },
  { pattern: /ct.*chest.*contrast|ct.*thorax.*contrast/i, cpt: '71260', name: 'CT Chest with Contrast' },
  { pattern: /ct.*chest|ct.*thorax|chest.*ct/i, cpt: '71250', name: 'CT Chest without Contrast' },
  { pattern: /ct.*head.*contrast|ct.*brain.*contrast/i, cpt: '70460', name: 'CT Head with Contrast' },
  { pattern: /ct.*head|ct.*brain|brain.*ct/i, cpt: '70450', name: 'CT Head without Contrast' },
  { pattern: /ct.*neck|neck.*ct/i, cpt: '70490', name: 'CT Neck without Contrast' },
  { pattern: /ct.*spine.*cervical|cervical.*ct/i, cpt: '72125', name: 'CT Cervical Spine without Contrast' },
  { pattern: /ct.*spine.*lumbar|lumbar.*ct/i, cpt: '72131', name: 'CT Lumbar Spine without Contrast' },
  { pattern: /ct.*angiography.*coronary|coronary.*cta|cardiac.*cta/i, cpt: '75574', name: 'CT Coronary Angiography' },
  { pattern: /ct.*angiography.*chest|cta.*chest/i, cpt: '71275', name: 'CT Angiography Chest' },
  { pattern: /ct.*angiography|cta/i, cpt: '73706', name: 'CT Angiography' },
  { pattern: /ct.*colonoscopy|virtual.*colonoscopy/i, cpt: '74263', name: 'CT Colonoscopy' },
  { pattern: /ct.*sinuses|sinus.*ct/i, cpt: '70486', name: 'CT Sinuses' },
  { pattern: /ct.*orbit|orbit.*ct/i, cpt: '70480', name: 'CT Orbit' },

  // ── X-RAY ─────────────────────────────────────────────────
  { pattern: /x.?ray.*chest|chest.*x.?ray|xray.*chest|chest.*xray/i, cpt: '71046', name: 'X-Ray Chest 2 Views' },
  { pattern: /x.?ray.*knee|knee.*x.?ray|xray.*knee/i, cpt: '73564', name: 'X-Ray Knee 3 Views' },
  { pattern: /x.?ray.*hip|hip.*x.?ray/i, cpt: '73502', name: 'X-Ray Hip with Pelvis' },
  { pattern: /x.?ray.*shoulder|shoulder.*x.?ray/i, cpt: '73030', name: 'X-Ray Shoulder' },
  { pattern: /x.?ray.*spine.*lumbar|lumbar.*x.?ray/i, cpt: '72100', name: 'X-Ray Lumbar Spine' },
  { pattern: /x.?ray.*spine.*cervical|cervical.*x.?ray/i, cpt: '72040', name: 'X-Ray Cervical Spine' },
  { pattern: /x.?ray.*abdomen|abdomen.*x.?ray/i, cpt: '74018', name: 'X-Ray Abdomen' },
  { pattern: /x.?ray.*hand|hand.*x.?ray/i, cpt: '73130', name: 'X-Ray Hand' },
  { pattern: /x.?ray.*wrist|wrist.*x.?ray/i, cpt: '73100', name: 'X-Ray Wrist' },
  { pattern: /x.?ray.*ankle|ankle.*x.?ray/i, cpt: '73610', name: 'X-Ray Ankle' },
  { pattern: /x.?ray.*foot|foot.*x.?ray/i, cpt: '73630', name: 'X-Ray Foot' },
  { pattern: /x.?ray.*elbow|elbow.*x.?ray/i, cpt: '73070', name: 'X-Ray Elbow' },

  // ── ULTRASOUND ────────────────────────────────────────────
  { pattern: /ultrasound.*abdomen|abdomen.*ultrasound|us.*abdomen/i, cpt: '76700', name: 'Ultrasound Abdomen Complete' },
  { pattern: /ultrasound.*pelvis|pelvis.*ultrasound/i, cpt: '76856', name: 'Ultrasound Pelvis' },
  { pattern: /ultrasound.*thyroid|thyroid.*ultrasound/i, cpt: '76536', name: 'Ultrasound Thyroid' },
  { pattern: /ultrasound.*breast|breast.*ultrasound/i, cpt: '76641', name: 'Ultrasound Breast' },
  { pattern: /ultrasound.*carotid|carotid.*ultrasound/i, cpt: '93880', name: 'Ultrasound Carotid Duplex' },
  { pattern: /ultrasound.*kidney|kidney.*ultrasound|renal.*ultrasound/i, cpt: '76770', name: 'Ultrasound Kidneys' },
  { pattern: /ultrasound.*scrotal|scrotal.*ultrasound/i, cpt: '76870', name: 'Ultrasound Scrotum' },
  { pattern: /ultrasound.*obstetric|obstetric.*ultrasound|pregnancy.*ultrasound/i, cpt: '76805', name: 'Ultrasound Obstetric' },
  { pattern: /echo.*cardiogram|echocardiogram|cardiac.*echo/i, cpt: '93306', name: 'Echocardiogram with Doppler' },

  // ── MAMMOGRAM ─────────────────────────────────────────────
  { pattern: /mammogram.*diagnostic|diagnostic.*mammogram/i, cpt: '77065', name: 'Mammogram Diagnostic' },
  { pattern: /mammogram.*screening|screening.*mammogram/i, cpt: '77067', name: 'Mammogram Screening' },
  { pattern: /mammogram|mammography/i, cpt: '77067', name: 'Mammogram' },
  { pattern: /tomosynthesis|3d.*mammogram/i, cpt: '77063', name: 'Mammogram 3D Tomosynthesis' },

  // ── BONE DENSITY ──────────────────────────────────────────
  { pattern: /dexa|bone.*density|bone.*mineral.*density/i, cpt: '77080', name: 'DEXA Bone Density Scan' },

  // ── COLONOSCOPY / GI ──────────────────────────────────────
  { pattern: /colonoscopy.*polypectomy|polypectomy.*colonoscopy/i, cpt: '45385', name: 'Colonoscopy with Polypectomy' },
  { pattern: /colonoscopy.*biopsy|biopsy.*colonoscopy/i, cpt: '45380', name: 'Colonoscopy with Biopsy' },
  { pattern: /colonoscopy.*screening|screening.*colonoscopy/i, cpt: '45378', name: 'Colonoscopy Screening' },
  { pattern: /colonoscopy/i, cpt: '45378', name: 'Diagnostic Colonoscopy' },
  { pattern: /upper.*endoscopy|endoscopy.*upper|egd|esophagogastroduodenoscopy/i, cpt: '43239', name: 'Upper GI Endoscopy with Biopsy' },
  { pattern: /sigmoidoscopy/i, cpt: '45330', name: 'Sigmoidoscopy' },
  { pattern: /capsule.*endoscopy/i, cpt: '91110', name: 'Capsule Endoscopy' },

  // ── SURGERY ───────────────────────────────────────────────
  { pattern: /gallbladder.*removal|cholecystectomy.*lapar|lapar.*cholecystectomy/i, cpt: '47562', name: 'Laparoscopic Cholecystectomy' },
  { pattern: /cholecystectomy/i, cpt: '47562', name: 'Cholecystectomy' },
  { pattern: /appendectomy|appendix.*removal|remove.*appendix/i, cpt: '44950', name: 'Appendectomy' },
  { pattern: /knee.*replacement|total.*knee|knee.*arthroplasty/i, cpt: '27447', name: 'Total Knee Replacement' },
  { pattern: /hip.*replacement|total.*hip|hip.*arthroplasty/i, cpt: '27130', name: 'Total Hip Replacement' },
  { pattern: /shoulder.*replacement|total.*shoulder/i, cpt: '23472', name: 'Total Shoulder Replacement' },
  { pattern: /hernia.*inguinal.*lapar|lapar.*inguinal/i, cpt: '49650', name: 'Laparoscopic Inguinal Hernia Repair' },
  { pattern: /hernia.*inguinal/i, cpt: '49505', name: 'Inguinal Hernia Repair' },
  { pattern: /hernia.*ventral|hernia.*abdominal/i, cpt: '49560', name: 'Ventral Hernia Repair' },
  { pattern: /hernia.*umbilical/i, cpt: '49585', name: 'Umbilical Hernia Repair' },
  { pattern: /cataract|lens.*implant/i, cpt: '66984', name: 'Cataract Surgery with Lens Implant' },
  { pattern: /tonsillectomy/i, cpt: '42820', name: 'Tonsillectomy' },
  { pattern: /adenoidectomy/i, cpt: '42830', name: 'Adenoidectomy' },
  { pattern: /thyroidectomy.*total/i, cpt: '60240', name: 'Total Thyroidectomy' },
  { pattern: /thyroidectomy/i, cpt: '60220', name: 'Thyroidectomy' },
  { pattern: /hysterectomy.*lapar/i, cpt: '58570', name: 'Laparoscopic Hysterectomy' },
  { pattern: /hysterectomy/i, cpt: '58150', name: 'Hysterectomy' },
  { pattern: /mastectomy.*total/i, cpt: '19303', name: 'Total Mastectomy' },
  { pattern: /mastectomy/i, cpt: '19301', name: 'Partial Mastectomy' },
  { pattern: /knee.*arthroscopy|arthroscopy.*knee/i, cpt: '29881', name: 'Knee Arthroscopy with Meniscectomy' },
  { pattern: /shoulder.*arthroscopy|arthroscopy.*shoulder/i, cpt: '29827', name: 'Shoulder Arthroscopy with Rotator Cuff Repair' },
  { pattern: /rotator.*cuff/i, cpt: '29827', name: 'Rotator Cuff Repair' },
  { pattern: /spinal.*fusion.*lumbar|lumbar.*fusion/i, cpt: '22612', name: 'Lumbar Spinal Fusion' },
  { pattern: /spinal.*fusion.*cervical|cervical.*fusion/i, cpt: '22551', name: 'Cervical Spinal Fusion' },
  { pattern: /laminectomy/i, cpt: '63030', name: 'Laminectomy' },
  { pattern: /discectomy/i, cpt: '63030', name: 'Discectomy' },
  { pattern: /carpal.*tunnel/i, cpt: '64721', name: 'Carpal Tunnel Release' },
  { pattern: /prostatectomy|prostate.*removal/i, cpt: '55866', name: 'Laparoscopic Prostatectomy' },
  { pattern: /kidney.*stone|lithotripsy/i, cpt: '50590', name: 'Kidney Stone Lithotripsy' },
  { pattern: /bariatric|gastric.*bypass|gastric.*sleeve/i, cpt: '43644', name: 'Bariatric Surgery' },
  { pattern: /hip.*fracture.*repair/i, cpt: '27244', name: 'Hip Fracture Repair' },

  // ── CARDIOLOGY ────────────────────────────────────────────
  { pattern: /ekg|electrocardiogram|ecg|12.*lead/i, cpt: '93000', name: 'EKG 12 Lead' },
  { pattern: /stress.*test|cardiac.*stress|exercise.*stress/i, cpt: '93015', name: 'Cardiac Stress Test' },
  { pattern: /nuclear.*stress|stress.*nuclear/i, cpt: '78452', name: 'Nuclear Stress Test' },
  { pattern: /holter.*monitor/i, cpt: '93224', name: 'Holter Monitor 24 Hour' },
  { pattern: /cardiac.*catheterization|heart.*catheterization|cath.*lab/i, cpt: '93454', name: 'Cardiac Catheterization' },
  { pattern: /angioplasty|stent.*coronary|coronary.*stent/i, cpt: '92928', name: 'Coronary Angioplasty with Stent' },
  { pattern: /pacemaker.*implant/i, cpt: '33206', name: 'Pacemaker Implant' },
  { pattern: /defibrillator.*implant|icd.*implant/i, cpt: '33249', name: 'Defibrillator Implant' },
  { pattern: /ablation.*cardiac|cardiac.*ablation|afib.*ablation/i, cpt: '93653', name: 'Cardiac Ablation' },

  // ── OB/GYN ────────────────────────────────────────────────
  { pattern: /cesarean|c.?section/i, cpt: '59510', name: 'Cesarean Delivery with Postpartum Care' },
  { pattern: /vaginal.*delivery|normal.*delivery|labor.*delivery/i, cpt: '59400', name: 'Vaginal Delivery with Postpartum Care' },
  { pattern: /colposcopy/i, cpt: '57454', name: 'Colposcopy with Biopsy' },
  { pattern: /pap.*smear|pap.*test/i, cpt: '88141', name: 'Pap Smear' },
  { pattern: /iud.*insertion/i, cpt: '58300', name: 'IUD Insertion' },
  { pattern: /tubal.*ligation/i, cpt: '58671', name: 'Tubal Ligation' },
  { pattern: /dilation.*curettage|d.*&.*c/i, cpt: '58120', name: 'Dilation and Curettage' },

  // ── UROLOGY ───────────────────────────────────────────────
  { pattern: /cystoscopy/i, cpt: '52000', name: 'Cystoscopy' },
  { pattern: /vasectomy/i, cpt: '55250', name: 'Vasectomy' },
  { pattern: /circumcision/i, cpt: '54150', name: 'Circumcision' },
  { pattern: /kidney.*transplant|renal.*transplant/i, cpt: '50360', name: 'Kidney Transplant' },
  { pattern: /dialysis.*hemo|hemodialysis/i, cpt: '90935', name: 'Hemodialysis' },

  // ── DERMATOLOGY ───────────────────────────────────────────
  { pattern: /mole.*removal|skin.*lesion.*removal/i, cpt: '11400', name: 'Skin Lesion Removal' },
  { pattern: /biopsy.*skin|skin.*biopsy/i, cpt: '11100', name: 'Skin Biopsy' },
  { pattern: /mohs.*surgery/i, cpt: '17311', name: 'Mohs Surgery' },

  // ── OFFICE VISITS ─────────────────────────────────────────
  { pattern: /office.*visit.*new|new.*patient.*visit/i, cpt: '99203', name: 'Office Visit New Patient Moderate' },
  { pattern: /office.*visit.*established|established.*patient|office.*visit/i, cpt: '99213', name: 'Office Visit Established Patient' },
  { pattern: /annual.*physical|physical.*exam|wellness.*visit/i, cpt: '99395', name: 'Annual Physical Exam' },
  { pattern: /urgent.*care.*visit/i, cpt: '99213', name: 'Urgent Care Visit' },
  { pattern: /telehealth.*visit|virtual.*visit/i, cpt: '99213', name: 'Telehealth Visit' },
  { pattern: /emergency.*room.*visit|er.*visit|emergency.*department/i, cpt: '99283', name: 'Emergency Room Visit Moderate' },
  { pattern: /consultation.*specialist/i, cpt: '99243', name: 'Specialist Consultation' },

  // ── LABS ──────────────────────────────────────────────────
  { pattern: /comprehensive.*metabolic|metabolic.*panel.*comp|cmp/i, cpt: '80053', name: 'Comprehensive Metabolic Panel' },
  { pattern: /basic.*metabolic|bmp/i, cpt: '80048', name: 'Basic Metabolic Panel' },
  { pattern: /lipid.*panel|cholesterol.*panel/i, cpt: '80061', name: 'Lipid Panel' },
  { pattern: /cbc|complete.*blood.*count/i, cpt: '85025', name: 'Complete Blood Count' },
  { pattern: /thyroid.*tsh|tsh.*test|thyroid.*stimulating/i, cpt: '84443', name: 'TSH Thyroid Test' },
  { pattern: /hemoglobin.*a1c|hba1c|a1c.*test/i, cpt: '83036', name: 'Hemoglobin A1C' },
  { pattern: /blood.*glucose|glucose.*test/i, cpt: '82947', name: 'Blood Glucose' },
  { pattern: /psa.*test|prostate.*specific/i, cpt: '86316', name: 'PSA Test Prostate' },
  { pattern: /vitamin.*d.*test/i, cpt: '82306', name: 'Vitamin D Test' },
  { pattern: /iron.*test|ferritin/i, cpt: '83540', name: 'Iron Panel' },
  { pattern: /coagulation|inr.*test|prothrombin/i, cpt: '85610', name: 'Coagulation Test INR' },
  { pattern: /urinalysis/i, cpt: '81001', name: 'Urinalysis' },
  { pattern: /urine.*culture/i, cpt: '87086', name: 'Urine Culture' },
  { pattern: /blood.*culture/i, cpt: '87040', name: 'Blood Culture' },
  { pattern: /strep.*test|streptococcus/i, cpt: '87880', name: 'Strep Test' },
  { pattern: /flu.*test|influenza.*test/i, cpt: '87804', name: 'Flu Test' },
  { pattern: /covid.*test/i, cpt: '87635', name: 'COVID-19 Test' },
  { pattern: /hiv.*test/i, cpt: '86703', name: 'HIV Test' },
  { pattern: /hepatitis.*panel|hepatitis.*test/i, cpt: '80074', name: 'Hepatitis Panel' },
  { pattern: /drug.*screen|urine.*drug/i, cpt: '80307', name: 'Drug Screen' },
  { pattern: /genetic.*test|dna.*test/i, cpt: '81401', name: 'Genetic Test' },

  // ── PHYSICAL THERAPY ──────────────────────────────────────
  { pattern: /physical.*therapy|pt.*session/i, cpt: '97110', name: 'Physical Therapy Exercise' },
  { pattern: /occupational.*therapy/i, cpt: '97530', name: 'Occupational Therapy' },
  { pattern: /speech.*therapy/i, cpt: '92507', name: 'Speech Therapy' },

  // ── PAIN MANAGEMENT ───────────────────────────────────────
  { pattern: /epidural.*injection|epidural.*steroid/i, cpt: '62322', name: 'Epidural Steroid Injection' },
  { pattern: /cortisone.*injection|corticosteroid.*injection/i, cpt: '20610', name: 'Joint Cortisone Injection' },
  { pattern: /nerve.*block/i, cpt: '64450', name: 'Nerve Block Injection' },
  { pattern: /trigger.*point.*injection/i, cpt: '20552', name: 'Trigger Point Injection' },

  // ── PSYCHIATRY ────────────────────────────────────────────
  { pattern: /psychiatric.*evaluation|mental.*health.*eval/i, cpt: '90792', name: 'Psychiatric Evaluation' },
  { pattern: /psychotherapy.*60|therapy.*60.*min/i, cpt: '90837', name: 'Psychotherapy 60 Minutes' },
  { pattern: /psychotherapy.*45|therapy.*45.*min/i, cpt: '90834', name: 'Psychotherapy 45 Minutes' },

  // ── PREVENTIVE ────────────────────────────────────────────
  { pattern: /vaccine.*flu|flu.*shot|influenza.*vaccine/i, cpt: '90686', name: 'Flu Vaccine' },
  { pattern: /vaccine.*covid|covid.*vaccine/i, cpt: '91300', name: 'COVID-19 Vaccine' },
  { pattern: /vaccine.*pneumonia|pneumonia.*vaccine/i, cpt: '90670', name: 'Pneumonia Vaccine' },
  { pattern: /colonoscopy.*screening|colon.*cancer.*screening/i, cpt: '45378', name: 'Colon Cancer Screening Colonoscopy' },

  // ── DIALYSIS / KIDNEY ─────────────────────────────────────
  { pattern: /paracentesis.*abdominal|abdominal.*paracentesis/i, cpt: '49082', name: 'Abdominal Paracentesis' },

  // ── INFUSION ──────────────────────────────────────────────
  { pattern: /infusion.*chemotherapy|chemo.*infusion/i, cpt: '96413', name: 'Chemotherapy Infusion' },
  { pattern: /infusion.*iv|iv.*infusion/i, cpt: '96365', name: 'IV Infusion' },

  // ── SLEEP ─────────────────────────────────────────────────
  { pattern: /sleep.*study|polysomnography/i, cpt: '95810', name: 'Sleep Study Polysomnography' },

  // ── OPHTHALMOLOGY ─────────────────────────────────────────
  { pattern: /eye.*exam|ophthalmology.*exam/i, cpt: '92004', name: 'Eye Exam Comprehensive' },
  { pattern: /glaucoma.*surgery/i, cpt: '66170', name: 'Glaucoma Surgery' },

  // ── DENTAL (hospital-based) ───────────────────────────────
  { pattern: /tooth.*extraction|dental.*extraction/i, cpt: '41899', name: 'Tooth Extraction' },
];

// ── PROCEDURE CATEGORIES for UI filtering ─────────────────────
const PROCEDURE_CATEGORIES = {
  '70551': 'imaging', '70552': 'imaging', '70553': 'imaging', '70555': 'imaging',
  '72141': 'imaging', '72146': 'imaging', '72148': 'imaging', '72156': 'imaging',
  '73221': 'imaging', '73721': 'imaging', '72197': 'imaging', '74183': 'imaging',
  '71550': 'imaging', '75561': 'imaging', '77048': 'imaging', '76700': 'imaging',
  '76856': 'imaging', '76536': 'imaging', '76641': 'imaging', '93880': 'imaging',
  '76770': 'imaging', '76870': 'imaging', '76805': 'imaging', '74177': 'imaging',
  '74178': 'imaging', '74160': 'imaging', '74150': 'imaging', '72193': 'imaging',
  '72192': 'imaging', '71260': 'imaging', '71250': 'imaging', '70460': 'imaging',
  '70450': 'imaging', '70490': 'imaging', '72125': 'imaging', '72131': 'imaging',
  '75574': 'imaging', '71275': 'imaging', '73706': 'imaging', '74263': 'imaging',
  '70486': 'imaging', '70480': 'imaging', '71046': 'imaging', '73564': 'imaging',
  '73502': 'imaging', '73030': 'imaging', '72100': 'imaging', '72040': 'imaging',
  '74018': 'imaging', '73130': 'imaging', '73100': 'imaging', '73610': 'imaging',
  '73630': 'imaging', '73070': 'imaging', '77067': 'imaging', '77065': 'imaging',
  '77063': 'imaging', '77080': 'imaging', '93306': 'imaging', '78452': 'imaging',
  '47562': 'surgery', '44950': 'surgery', '27447': 'surgery', '27130': 'surgery',
  '23472': 'surgery', '49650': 'surgery', '49505': 'surgery', '49560': 'surgery',
  '49585': 'surgery', '66984': 'surgery', '42820': 'surgery', '42830': 'surgery',
  '60240': 'surgery', '60220': 'surgery', '58570': 'surgery', '58150': 'surgery',
  '19303': 'surgery', '19301': 'surgery', '29881': 'surgery', '29827': 'surgery',
  '22612': 'surgery', '22551': 'surgery', '63030': 'surgery', '64721': 'surgery',
  '55866': 'surgery', '50590': 'surgery', '43644': 'surgery', '27244': 'surgery',
  '58671': 'surgery', '58120': 'surgery', '11400': 'surgery', '11100': 'surgery',
  '17311': 'surgery', '54150': 'surgery', '55250': 'surgery', '50360': 'surgery',
  '45378': 'colonoscopy', '45380': 'colonoscopy', '45385': 'colonoscopy',
  '45330': 'colonoscopy', '43239': 'colonoscopy', '91110': 'colonoscopy',
  '93000': 'cardiology', '93015': 'cardiology', '93224': 'cardiology',
  '93454': 'cardiology', '92928': 'cardiology', '33206': 'cardiology',
  '33249': 'cardiology', '93653': 'cardiology', '93306': 'cardiology',
  '59510': 'obgyn', '59400': 'obgyn', '57454': 'obgyn', '88141': 'obgyn',
  '58300': 'obgyn', '52000': 'urology', '90935': 'urology',
  '80053': 'lab', '80048': 'lab', '80061': 'lab', '85025': 'lab',
  '84443': 'lab', '83036': 'lab', '82947': 'lab', '86316': 'lab',
  '82306': 'lab', '83540': 'lab', '85610': 'lab', '81001': 'lab',
  '87086': 'lab', '87040': 'lab', '87880': 'lab', '87804': 'lab',
  '87635': 'lab', '86703': 'lab', '80074': 'lab', '80307': 'lab',
  '81401': 'lab',
  '97110': 'therapy', '97530': 'therapy', '92507': 'therapy',
  '99203': 'office', '99213': 'office', '99395': 'office', '99283': 'office',
  '99243': 'office', '90792': 'office', '90837': 'office', '90834': 'office',
  '62322': 'pain', '20610': 'pain', '64450': 'pain', '20552': 'pain',
  '90686': 'preventive', '91300': 'preventive', '90670': 'preventive',
  '96413': 'infusion', '96365': 'infusion',
  '95810': 'sleep',
  '92004': 'ophthalmology', '66170': 'ophthalmology',
  '49082': 'procedure',
};

async function main() {
  console.log('Hosparent Master CPT Mapper');
  console.log('============================');
  console.log(`Total CPT mappings: ${CPT_MAPPINGS.length}`);
  console.log('');

  // Step 1: Add category column to procedures
  await pool.query(`ALTER TABLE procedures ADD COLUMN IF NOT EXISTS procedure_category TEXT`);
  await pool.query(`ALTER TABLE procedures ADD COLUMN IF NOT EXISTS display_name TEXT`);
  await pool.query(`ALTER TABLE procedures ADD COLUMN IF NOT EXISTS is_searchable BOOLEAN DEFAULT false`);
  console.log('Columns added.');

  // Step 2: Mark all standard 5-digit CPT procedures as searchable
  const standardCpt = await pool.query(`
    UPDATE procedures 
    SET is_searchable = true
    WHERE cpt_code SIMILAR TO '[0-9]{5}'
    AND standard_name NOT ILIKE '%hchg%'
    AND standard_name NOT ILIKE '%supply%'
    AND standard_name NOT ILIKE '% mg %'
    AND standard_name NOT ILIKE '% ml %'
    AND standard_name NOT ILIKE '%tablet%'
    AND standard_name NOT ILIKE '%capsule%'
    AND standard_name NOT ILIKE '%vial%'
    AND standard_name NOT ILIKE '%catheter%'
    AND standard_name NOT ILIKE '%guidewire%'
    AND standard_name NOT ILIKE '%kit%'
  `);
  console.log(`Marked ${standardCpt.rowCount} procedures as searchable`);

  // Step 3: Apply CPT mappings to fix BSW and non-standard codes
  let mapped = 0;
  const procedures = await pool.query(`
    SELECT id, standard_name, cpt_code
    FROM procedures
    WHERE (cpt_code IS NULL OR cpt_code NOT SIMILAR TO '[0-9]{5}')
    AND standard_name IS NOT NULL
    AND standard_name NOT ILIKE '%hchg%'
  `);

  console.log(`\nApplying CPT mappings to ${procedures.rows.length} non-standard procedures...`);

  for (const proc of procedures.rows) {
    const name = proc.standard_name || '';
    for (const mapping of CPT_MAPPINGS) {
      if (mapping.pattern.test(name)) {
        const medicare = await pool.query(
          `SELECT facility_rate, non_facility_rate FROM medicare_rates WHERE cpt_code = $1 AND modifier IS NULL LIMIT 1`,
          [mapping.cpt]
        );
        await pool.query(`
          UPDATE procedures SET
            cpt_code = $1,
            display_name = $2,
            procedure_category = $3,
            is_searchable = true,
            medicare_facility_rate = $4,
            medicare_non_facility_rate = $5
          WHERE id = $6
        `, [
          mapping.cpt,
          mapping.name,
          PROCEDURE_CATEGORIES[mapping.cpt] || 'procedure',
          medicare.rows[0]?.facility_rate || null,
          medicare.rows[0]?.non_facility_rate || null,
          proc.id
        ]);
        mapped++;
        break;
      }
    }
  }
  console.log(`Mapped ${mapped} non-standard procedures to real CPT codes`);

  // Step 4: Apply categories to all searchable procedures
  let categorized = 0;
  for (const [cpt, category] of Object.entries(PROCEDURE_CATEGORIES)) {
    const r = await pool.query(`
      UPDATE procedures SET procedure_category = $1
      WHERE cpt_code = $2 AND procedure_category IS NULL
    `, [category, cpt]);
    categorized += r.rowCount;
  }
  console.log(`Categorized ${categorized} procedures`);

  // Step 5: Set display names for well-known CPT codes
  for (const mapping of CPT_MAPPINGS) {
    await pool.query(`
      UPDATE procedures SET display_name = $1
      WHERE cpt_code = $2 AND display_name IS NULL
      AND standard_name ILIKE $3
    `, [mapping.name, mapping.cpt, `%${mapping.name.split(' ')[0]}%`]);
  }

  // Step 6: Mark medications, supplies, equipment as NOT searchable
  const cleanup = await pool.query(`
    UPDATE procedures SET is_searchable = false
    WHERE (
      standard_name ~* '\\d+\\s*(mg|ml|mcg|units?|gram|g\\s|tab|cap|vial|ampul|bottle|pack|each)'
      OR standard_name ILIKE '%tablet%'
      OR standard_name ILIKE '%capsule%'
      OR standard_name ILIKE '%injection solution%'
      OR standard_name ILIKE '%oral solution%'
      OR standard_name ILIKE '%oral powder%'
      OR standard_name ILIKE '%intravenous solution%'
      OR standard_name ILIKE '%implant%catheter%'
      OR standard_name ILIKE '%guidewire%'
      OR standard_name ILIKE '%suture%'
      OR standard_name ILIKE '%dressing%'
      OR standard_name ILIKE '%glove%'
      OR standard_name ILIKE '%syringe%'
      OR cpt_code LIKE 'RX-%'
      OR cpt_code LIKE 'PX-%'
      OR cpt_code = '0250'
    )
    AND standard_name NOT ILIKE '%colonoscopy%'
    AND standard_name NOT ILIKE '%endoscopy%'
    AND standard_name NOT ILIKE '%surgery%'
  `);
  console.log(`Marked ${cleanup.rowCount} medications/supplies as not searchable`);

  // Step 7: Final stats
  const stats = await pool.query(`
    SELECT 
      is_searchable,
      COUNT(*) as count,
      COUNT(CASE WHEN cpt_code SIMILAR TO '[0-9]{5}' THEN 1 END) as with_cpt,
      COUNT(CASE WHEN medicare_facility_rate IS NOT NULL THEN 1 END) as with_medicare
    FROM procedures
    GROUP BY is_searchable
  `);

  console.log('\n============================');
  console.log('FINAL DATABASE STATS');
  console.log('============================');
  for (const row of stats.rows) {
    console.log(`${row.is_searchable ? 'SEARCHABLE' : 'NOT SEARCHABLE'}: ${row.count} procedures | CPT: ${row.with_cpt} | Medicare: ${row.with_medicare}`);
  }

  // Step 8: Show top searchable procedures by hospital coverage
  const top = await pool.query(`
    SELECT 
      COALESCE(p.display_name, p.standard_name) as name,
      p.cpt_code,
      p.procedure_category,
      p.medicare_facility_rate,
      COUNT(DISTINCT h.id) as hospitals,
      MIN(pr.price) FILTER (WHERE pr.price_type='cash') as min_cash,
      MAX(pr.price) FILTER (WHERE pr.price_type='cash') as max_cash
    FROM procedures p
    JOIN prices pr ON pr.procedure_id = p.id
    JOIN hospitals h ON h.id = pr.hospital_id
    WHERE p.is_searchable = true
    AND pr.price > 5 AND pr.price < 200000
    GROUP BY p.id, p.display_name, p.standard_name, p.cpt_code, p.procedure_category, p.medicare_facility_rate
    HAVING COUNT(DISTINCT h.id) >= 5
    ORDER BY COUNT(DISTINCT h.id) DESC, max_cash DESC
    LIMIT 50
  `);

  console.log('\nTOP 50 SEARCHABLE PROCEDURES:');
  console.log('=============================');
  for (const r of top.rows) {
    const variation = r.max_cash && r.min_cash ? (r.max_cash/r.min_cash).toFixed(0)+'x' : 'N/A';
    console.log(`  [${r.procedure_category || '?'}] "${r.name}" | CPT:${r.cpt_code} | ${r.hospitals} hospitals | $${Math.round(r.min_cash||0)}-$${Math.round(r.max_cash||0)} (${variation}) | Medicare:${r.medicare_facility_rate ? '$'+Math.round(r.medicare_facility_rate) : 'N/A'}`);
  }

  await pool.end();
  console.log('\nDone. Restart server.js to apply changes.');
}

main().catch(console.error);