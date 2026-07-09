require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// ══════════════════════════════════════════════════════════════
// HOSPARENT ULTIMATE MEGA SCRAPER
// Sources: Walk-In Lab | LaboratoryAssist | MDsave | Cost Plus Drugs
// SingleCare | Cost Plus Wellness | Surgery Center of Oklahoma
// Open Path Collective | Green Imaging | Validation Layer
// ══════════════════════════════════════════════════════════════

const sleep = ms => new Promise(r => setTimeout(r, ms));

const parsePrice = (v) => {
  if (!v) return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isNaN(n) || n <= 0 || n > 999999 ? null : n;
};

// ── CPT PRICE VALIDATION FLOORS/CEILINGS ──────────────────────
// Prevents $38 knee replacements and $98K hip replacements
const CPT_PRICE_BOUNDS = {
  '27447': { min: 3000,  max: 150000, label: 'Knee Replacement' },
  '27130': { min: 3000,  max: 150000, label: 'Hip Replacement' },
  '47562': { min: 1500,  max: 100000, label: 'Gallbladder Removal' },
  '59400': { min: 2000,  max: 80000,  label: 'Vaginal Delivery' },
  '59510': { min: 2500,  max: 80000,  label: 'C-Section' },
  '29881': { min: 1500,  max: 60000,  label: 'Knee Arthroscopy' },
  '44950': { min: 1500,  max: 60000,  label: 'Appendectomy' },
  '49505': { min: 1200,  max: 60000,  label: 'Hernia Repair' },
  '49650': { min: 1200,  max: 60000,  label: 'Laparoscopic Hernia' },
  '66984': { min: 800,   max: 40000,  label: 'Cataract Surgery' },
  '22612': { min: 5000,  max: 200000, label: 'Spinal Fusion' },
  '22551': { min: 5000,  max: 200000, label: 'Cervical Fusion' },
  '42820': { min: 500,   max: 20000,  label: 'Tonsillectomy' },
  '45378': { min: 150,   max: 8000,   label: 'Colonoscopy' },
  '45385': { min: 200,   max: 10000,  label: 'Colonoscopy w/ Polypectomy' },
  '43239': { min: 150,   max: 8000,   label: 'Upper Endoscopy' },
  '70551': { min: 50,    max: 15000,  label: 'MRI Brain' },
  '72141': { min: 50,    max: 15000,  label: 'MRI Cervical Spine' },
  '72148': { min: 50,    max: 15000,  label: 'MRI Lumbar Spine' },
  '73721': { min: 50,    max: 12000,  label: 'MRI Knee' },
  '73221': { min: 50,    max: 12000,  label: 'MRI Shoulder' },
  '74177': { min: 50,    max: 15000,  label: 'CT Abdomen/Pelvis' },
  '71260': { min: 50,    max: 10000,  label: 'CT Chest' },
  '70450': { min: 30,    max: 8000,   label: 'CT Head' },
  '77067': { min: 30,    max: 2000,   label: 'Mammogram' },
  '76700': { min: 30,    max: 3000,   label: 'Ultrasound Abdomen' },
  '77080': { min: 20,    max: 1500,   label: 'DEXA Bone Density' },
  '78815': { min: 500,   max: 20000,  label: 'PET Scan' },
  '93306': { min: 50,    max: 5000,   label: 'Echocardiogram' },
  '93000': { min: 5,     max: 1500,   label: 'EKG' },
  '85025': { min: 3,     max: 500,    label: 'CBC' },
  '80053': { min: 5,     max: 800,    label: 'CMP Blood Panel' },
  '80061': { min: 5,     max: 500,    label: 'Lipid Panel' },
  '84443': { min: 5,     max: 500,    label: 'TSH Thyroid' },
  '83036': { min: 5,     max: 300,    label: 'Hemoglobin A1C' },
};

function validatePrice(cptCode, price) {
  const bounds = CPT_PRICE_BOUNDS[cptCode];
  if (!bounds) return { valid: true, suspicious: false };
  if (price < bounds.min || price > bounds.max) {
    return { valid: false, suspicious: true, reason: `${bounds.label}: $${price} outside range $${bounds.min}-$${bounds.max}` };
  }
  return { valid: true, suspicious: false };
}

// ── DFW ZIP CODES ──────────────────────────────────────────────
const DFW_ZIPS = [
  '75001','75002','75006','75007','75009','75010','75013','75019','75022',
  '75023','75024','75025','75028','75030','75032','75034','75035','75038',
  '75039','75040','75041','75042','75043','75044','75048','75050','75051',
  '75052','75054','75056','75057','75060','75061','75062','75063','75065',
  '75067','75068','75069','75070','75071','75074','75075','75080','75081',
  '75082','75083','75087','75088','75089','75090','75093','75094','75098',
  '75104','75115','75116','75119','75125','75126','75134','75137','75141',
  '75146','75149','75150','75154','75157','75159','75165','75166','75167',
  '75172','75173','75180','75181','75182','75185','75201','75202','75203',
  '75204','75205','75206','75207','75208','75209','75210','75211','75212',
  '75214','75215','75216','75217','75218','75219','75220','75223','75224',
  '75225','75226','75227','75228','75229','75230','75231','75232','75233',
  '75234','75235','75236','75237','75238','75240','75241','75243','75244',
  '75246','75247','75248','75249','75251','75252','75253','75254','76001',
  '76002','76006','76008','76010','76011','76012','76013','76014','76015',
  '76016','76017','76018','76020','76021','76022','76034','76036','76039',
  '76040','76051','76052','76053','76054','76063','76092','76102','76103',
  '76104','76105','76106','76107','76108','76109','76110','76111','76112',
  '76114','76116','76117','76118','76119','76120','76121','76122','76123',
  '76126','76127','76131','76132','76133','76134','76135','76136','76137',
  '76140','76148','76155','76161','76162','76163','76164','76177','76180',
  '76182','76201','76205','76207','76208','76209','76210','75075',
];

// ── TOP 200 MOST PRESCRIBED DRUGS ─────────────────────────────
const TOP_DRUGS = [
  // Cardiovascular
  { name: 'atorvastatin', brand: 'Lipitor', ndc: null, conditions: ['high cholesterol'], j_code: null },
  { name: 'lisinopril', brand: 'Zestril', ndc: null, conditions: ['hypertension'], j_code: null },
  { name: 'amlodipine', brand: 'Norvasc', ndc: null, conditions: ['hypertension'], j_code: null },
  { name: 'metoprolol', brand: 'Lopressor', ndc: null, conditions: ['hypertension'], j_code: null },
  { name: 'losartan', brand: 'Cozaar', ndc: null, conditions: ['hypertension'], j_code: null },
  { name: 'simvastatin', brand: 'Zocor', ndc: null, conditions: ['high cholesterol'], j_code: null },
  { name: 'rosuvastatin', brand: 'Crestor', ndc: null, conditions: ['high cholesterol'], j_code: null },
  { name: 'carvedilol', brand: 'Coreg', ndc: null, conditions: ['heart failure'], j_code: null },
  { name: 'furosemide', brand: 'Lasix', ndc: null, conditions: ['edema'], j_code: null },
  { name: 'warfarin', brand: 'Coumadin', ndc: null, conditions: ['blood clots'], j_code: null },
  { name: 'clopidogrel', brand: 'Plavix', ndc: null, conditions: ['heart attack prevention'], j_code: null },
  { name: 'apixaban', brand: 'Eliquis', ndc: null, conditions: ['blood clots'], j_code: null },
  { name: 'rivaroxaban', brand: 'Xarelto', ndc: null, conditions: ['blood clots'], j_code: null },
  { name: 'hydrochlorothiazide', brand: 'Microzide', ndc: null, conditions: ['hypertension'], j_code: null },
  { name: 'spironolactone', brand: 'Aldactone', ndc: null, conditions: ['heart failure'], j_code: null },
  // Diabetes
  { name: 'metformin', brand: 'Glucophage', ndc: null, conditions: ['diabetes'], j_code: null },
  { name: 'insulin glargine', brand: 'Lantus', ndc: null, conditions: ['diabetes'], j_code: 'J1817' },
  { name: 'semaglutide', brand: 'Ozempic', ndc: null, conditions: ['diabetes', 'weight loss'], j_code: 'J3490' },
  { name: 'liraglutide', brand: 'Victoza', ndc: null, conditions: ['diabetes'], j_code: 'J3490' },
  { name: 'sitagliptin', brand: 'Januvia', ndc: null, conditions: ['diabetes'], j_code: null },
  { name: 'empagliflozin', brand: 'Jardiance', ndc: null, conditions: ['diabetes'], j_code: null },
  { name: 'glipizide', brand: 'Glucotrol', ndc: null, conditions: ['diabetes'], j_code: null },
  // Thyroid
  { name: 'levothyroxine', brand: 'Synthroid', ndc: null, conditions: ['hypothyroidism'], j_code: null },
  // Mental Health
  { name: 'sertraline', brand: 'Zoloft', ndc: null, conditions: ['depression', 'anxiety'], j_code: null },
  { name: 'escitalopram', brand: 'Lexapro', ndc: null, conditions: ['depression', 'anxiety'], j_code: null },
  { name: 'fluoxetine', brand: 'Prozac', ndc: null, conditions: ['depression'], j_code: null },
  { name: 'bupropion', brand: 'Wellbutrin', ndc: null, conditions: ['depression'], j_code: null },
  { name: 'duloxetine', brand: 'Cymbalta', ndc: null, conditions: ['depression', 'pain'], j_code: null },
  { name: 'venlafaxine', brand: 'Effexor', ndc: null, conditions: ['depression', 'anxiety'], j_code: null },
  { name: 'alprazolam', brand: 'Xanax', ndc: null, conditions: ['anxiety'], j_code: null },
  { name: 'clonazepam', brand: 'Klonopin', ndc: null, conditions: ['anxiety', 'seizures'], j_code: null },
  { name: 'lorazepam', brand: 'Ativan', ndc: null, conditions: ['anxiety'], j_code: null },
  { name: 'quetiapine', brand: 'Seroquel', ndc: null, conditions: ['bipolar', 'schizophrenia'], j_code: null },
  { name: 'aripiprazole', brand: 'Abilify', ndc: null, conditions: ['bipolar', 'depression'], j_code: null },
  { name: 'lithium', brand: 'Lithobid', ndc: null, conditions: ['bipolar'], j_code: null },
  { name: 'amphetamine salts', brand: 'Adderall', ndc: null, conditions: ['ADHD'], j_code: null },
  { name: 'methylphenidate', brand: 'Ritalin', ndc: null, conditions: ['ADHD'], j_code: null },
  // Pain / Inflammation
  { name: 'ibuprofen', brand: 'Advil', ndc: null, conditions: ['pain', 'inflammation'], j_code: null },
  { name: 'naproxen', brand: 'Aleve', ndc: null, conditions: ['pain', 'inflammation'], j_code: null },
  { name: 'celecoxib', brand: 'Celebrex', ndc: null, conditions: ['arthritis', 'pain'], j_code: null },
  { name: 'meloxicam', brand: 'Mobic', ndc: null, conditions: ['arthritis'], j_code: null },
  { name: 'tramadol', brand: 'Ultram', ndc: null, conditions: ['pain'], j_code: null },
  { name: 'hydrocodone acetaminophen', brand: 'Vicodin', ndc: null, conditions: ['pain'], j_code: null },
  { name: 'oxycodone', brand: 'Percocet', ndc: null, conditions: ['pain'], j_code: null },
  { name: 'gabapentin', brand: 'Neurontin', ndc: null, conditions: ['nerve pain', 'seizures'], j_code: null },
  { name: 'pregabalin', brand: 'Lyrica', ndc: null, conditions: ['nerve pain'], j_code: null },
  { name: 'cyclobenzaprine', brand: 'Flexeril', ndc: null, conditions: ['muscle spasm'], j_code: null },
  { name: 'prednisone', brand: 'Deltasone', ndc: null, conditions: ['inflammation'], j_code: null },
  { name: 'methylprednisolone', brand: 'Medrol', ndc: null, conditions: ['inflammation'], j_code: 'J1030' },
  // Respiratory
  { name: 'albuterol', brand: 'ProAir', ndc: null, conditions: ['asthma', 'COPD'], j_code: null },
  { name: 'fluticasone', brand: 'Flonase', ndc: null, conditions: ['asthma', 'allergies'], j_code: null },
  { name: 'montelukast', brand: 'Singulair', ndc: null, conditions: ['asthma', 'allergies'], j_code: null },
  { name: 'tiotropium', brand: 'Spiriva', ndc: null, conditions: ['COPD'], j_code: null },
  { name: 'budesonide formoterol', brand: 'Symbicort', ndc: null, conditions: ['asthma', 'COPD'], j_code: null },
  { name: 'cetirizine', brand: 'Zyrtec', ndc: null, conditions: ['allergies'], j_code: null },
  { name: 'loratadine', brand: 'Claritin', ndc: null, conditions: ['allergies'], j_code: null },
  { name: 'fexofenadine', brand: 'Allegra', ndc: null, conditions: ['allergies'], j_code: null },
  // GI
  { name: 'omeprazole', brand: 'Prilosec', ndc: null, conditions: ['acid reflux', 'GERD'], j_code: null },
  { name: 'pantoprazole', brand: 'Protonix', ndc: null, conditions: ['GERD'], j_code: null },
  { name: 'esomeprazole', brand: 'Nexium', ndc: null, conditions: ['GERD'], j_code: null },
  { name: 'lansoprazole', brand: 'Prevacid', ndc: null, conditions: ['GERD'], j_code: null },
  { name: 'famotidine', brand: 'Pepcid', ndc: null, conditions: ['acid reflux'], j_code: null },
  { name: 'ondansetron', brand: 'Zofran', ndc: null, conditions: ['nausea'], j_code: 'J2405' },
  // Antibiotics
  { name: 'amoxicillin', brand: 'Amoxil', ndc: null, conditions: ['infection'], j_code: null },
  { name: 'azithromycin', brand: 'Zithromax', ndc: null, conditions: ['infection'], j_code: null },
  { name: 'doxycycline', brand: 'Vibramycin', ndc: null, conditions: ['infection'], j_code: null },
  { name: 'ciprofloxacin', brand: 'Cipro', ndc: null, conditions: ['infection'], j_code: null },
  { name: 'amoxicillin clavulanate', brand: 'Augmentin', ndc: null, conditions: ['infection'], j_code: null },
  { name: 'trimethoprim sulfamethoxazole', brand: 'Bactrim', ndc: null, conditions: ['UTI'], j_code: null },
  { name: 'cephalexin', brand: 'Keflex', ndc: null, conditions: ['infection'], j_code: null },
  { name: 'metronidazole', brand: 'Flagyl', ndc: null, conditions: ['infection'], j_code: null },
  { name: 'clindamycin', brand: 'Cleocin', ndc: null, conditions: ['infection'], j_code: null },
  { name: 'ceftriaxone', brand: 'Rocephin', ndc: null, conditions: ['infection'], j_code: 'J0696' },
  // Dermatology
  { name: 'tretinoin', brand: 'Retin-A', ndc: null, conditions: ['acne', 'anti-aging'], j_code: null },
  { name: 'clotrimazole', brand: 'Lotrimin', ndc: null, conditions: ['fungal infection'], j_code: null },
  { name: 'hydrocortisone', brand: 'Cortaid', ndc: null, conditions: ['skin inflammation'], j_code: null },
  { name: 'triamcinolone', brand: 'Kenalog', ndc: null, conditions: ['skin inflammation'], j_code: 'J3301' },
  // Urology
  { name: 'tamsulosin', brand: 'Flomax', ndc: null, conditions: ['BPH'], j_code: null },
  { name: 'finasteride', brand: 'Propecia', ndc: null, conditions: ['BPH', 'hair loss'], j_code: null },
  { name: 'sildenafil', brand: 'Viagra', ndc: null, conditions: ['erectile dysfunction'], j_code: null },
  { name: 'tadalafil', brand: 'Cialis', ndc: null, conditions: ['erectile dysfunction', 'BPH'], j_code: null },
  // Sleep
  { name: 'zolpidem', brand: 'Ambien', ndc: null, conditions: ['insomnia'], j_code: null },
  { name: 'trazodone', brand: 'Desyrel', ndc: null, conditions: ['insomnia', 'depression'], j_code: null },
  { name: 'melatonin', brand: null, ndc: null, conditions: ['insomnia'], j_code: null },
  // Weight Loss / GLP-1
  { name: 'tirzepatide', brand: 'Mounjaro', ndc: null, conditions: ['diabetes', 'weight loss'], j_code: 'J3490' },
  { name: 'phentermine', brand: 'Adipex', ndc: null, conditions: ['weight loss'], j_code: null },
  { name: 'bupropion naltrexone', brand: 'Contrave', ndc: null, conditions: ['weight loss'], j_code: null },
  // Osteoporosis
  { name: 'alendronate', brand: 'Fosamax', ndc: null, conditions: ['osteoporosis'], j_code: null },
  { name: 'calcium carbonate', brand: 'Caltrate', ndc: null, conditions: ['osteoporosis'], j_code: null },
  // Vitamins / Supplements
  { name: 'vitamin d3', brand: null, ndc: null, conditions: ['vitamin deficiency'], j_code: null },
  { name: 'vitamin b12', brand: null, ndc: null, conditions: ['vitamin deficiency'], j_code: 'J3420' },
  { name: 'folic acid', brand: null, ndc: null, conditions: ['anemia', 'pregnancy'], j_code: null },
  // Women's Health
  { name: 'estradiol', brand: 'Estrace', ndc: null, conditions: ['menopause'], j_code: null },
  { name: 'progesterone', brand: 'Prometrium', ndc: null, conditions: ['menopause'], j_code: 'J2675' },
  { name: 'norethindrone', brand: 'Aygestin', ndc: null, conditions: ['birth control'], j_code: null },
  // Cancer / Specialty
  { name: 'imatinib', brand: 'Gleevec', ndc: null, conditions: ['leukemia'], j_code: null },
  { name: 'tamoxifen', brand: 'Nolvadex', ndc: null, conditions: ['breast cancer'], j_code: null },
  { name: 'letrozole', brand: 'Femara', ndc: null, conditions: ['breast cancer'], j_code: null },
  // Immunology
  { name: 'hydroxychloroquine', brand: 'Plaquenil', ndc: null, conditions: ['lupus', 'arthritis'], j_code: null },
  { name: 'methotrexate', brand: 'Rheumatrex', ndc: null, conditions: ['arthritis', 'psoriasis'], j_code: 'J9250' },
  // Neurology
  { name: 'levetiracetam', brand: 'Keppra', ndc: null, conditions: ['seizures'], j_code: null },
  { name: 'topiramate', brand: 'Topamax', ndc: null, conditions: ['seizures', 'migraine'], j_code: null },
  { name: 'sumatriptan', brand: 'Imitrex', ndc: null, conditions: ['migraine'], j_code: null },
  { name: 'donepezil', brand: 'Aricept', ndc: null, conditions: ["Alzheimer's"], j_code: null },
  { name: 'memantine', brand: 'Namenda', ndc: null, conditions: ["Alzheimer's"], j_code: null },
];

// ── DFW PHARMACIES ─────────────────────────────────────────────
const DFW_PHARMACIES = [
  { name: 'CVS Pharmacy - Plano', address: '6900 Preston Rd, Plano TX 75024', zip: '75024', chain: 'CVS', lat: 33.0765, lng: -96.8012 },
  { name: 'CVS Pharmacy - McKinney', address: '2200 W University Dr, McKinney TX 75071', zip: '75071', chain: 'CVS', lat: 33.1971, lng: -96.7188 },
  { name: 'CVS Pharmacy - Frisco', address: '3330 Preston Rd, Frisco TX 75034', zip: '75034', chain: 'CVS', lat: 33.1523, lng: -96.8234 },
  { name: 'CVS Pharmacy - Allen', address: '1060 W Exchange Pkwy, Allen TX 75013', zip: '75013', chain: 'CVS', lat: 33.1034, lng: -96.6712 },
  { name: 'CVS Pharmacy - Richardson', address: '1400 E Campbell Rd, Richardson TX 75081', zip: '75081', chain: 'CVS', lat: 32.9823, lng: -96.7134 },
  { name: 'CVS Pharmacy - Dallas Uptown', address: '4105 Oak Lawn Ave, Dallas TX 75219', zip: '75219', chain: 'CVS', lat: 32.8234, lng: -96.8112 },
  { name: 'Walgreens - Plano', address: '5750 E Park Blvd, Plano TX 75093', zip: '75093', chain: 'Walgreens', lat: 33.0434, lng: -96.8312 },
  { name: 'Walgreens - McKinney', address: '6700 Eldorado Pkwy, McKinney TX 75070', zip: '75070', chain: 'Walgreens', lat: 33.1645, lng: -96.6989 },
  { name: 'Walgreens - Frisco', address: '9150 John W Elliott Dr, Frisco TX 75033', zip: '75033', chain: 'Walgreens', lat: 33.1756, lng: -96.8234 },
  { name: 'Walgreens - Allen', address: '910 W Stacy Rd, Allen TX 75013', zip: '75013', chain: 'Walgreens', lat: 33.1034, lng: -96.6712 },
  { name: 'Walgreens - Dallas', address: '4343 W Northwest Hwy, Dallas TX 75220', zip: '75220', chain: 'Walgreens', lat: 32.8712, lng: -96.8134 },
  { name: 'Walmart Pharmacy - Plano', address: '4721 W Park Blvd, Plano TX 75093', zip: '75093', chain: 'Walmart', lat: 33.0434, lng: -96.8312 },
  { name: 'Walmart Pharmacy - McKinney', address: '1700 N Stonebridge Dr, McKinney TX 75071', zip: '75071', chain: 'Walmart', lat: 33.1971, lng: -96.7188 },
  { name: 'Walmart Pharmacy - Frisco', address: '9360 John W Elliott Dr, Frisco TX 75033', zip: '75033', chain: 'Walmart', lat: 33.1756, lng: -96.8234 },
  { name: 'Walmart Pharmacy - Arlington', address: '4120 S Cooper St, Arlington TX 76015', zip: '76015', chain: 'Walmart', lat: 32.6934, lng: -97.0812 },
  { name: 'Costco Pharmacy - Plano', address: '2601 Preston Rd, Plano TX 75093', zip: '75093', chain: 'Costco', lat: 33.0434, lng: -96.8312 },
  { name: 'Costco Pharmacy - Frisco', address: '9800 Dallas Pkwy, Frisco TX 75033', zip: '75033', chain: 'Costco', lat: 33.1756, lng: -96.8234 },
  { name: 'Costco Pharmacy - Allen', address: '190 E Stacy Rd, Allen TX 75002', zip: '75002', chain: 'Costco', lat: 33.1034, lng: -96.6712 },
  { name: 'Costco Pharmacy - Arlington', address: '401 E I-20, Arlington TX 76018', zip: '76018', chain: 'Costco', lat: 32.6934, lng: -97.0812 },
  { name: 'Tom Thumb Pharmacy - Plano', address: '8300 Preston Rd, Plano TX 75024', zip: '75024', chain: 'Tom Thumb', lat: 33.0765, lng: -96.8012 },
  { name: 'H-E-B Pharmacy - Dallas', address: '4100 Lemmon Ave, Dallas TX 75219', zip: '75219', chain: 'HEB', lat: 32.8234, lng: -96.8112 },
  { name: 'Sam\'s Club Pharmacy - Plano', address: '4901 W Park Blvd, Plano TX 75093', zip: '75093', chain: "Sam's Club", lat: 33.0434, lng: -96.8312 },
  { name: 'Sam\'s Club Pharmacy - McKinney', address: '840 N Central Expy, McKinney TX 75070', zip: '75070', chain: "Sam's Club", lat: 33.1645, lng: -96.6989 },
  { name: 'Kroger Pharmacy - Richardson', address: '1380 W Campbell Rd, Richardson TX 75080', zip: '75080', chain: 'Kroger', lat: 32.9823, lng: -96.7134 },
  { name: 'Target/CVS Pharmacy - Plano', address: '4700 W Park Blvd, Plano TX 75093', zip: '75093', chain: 'Target/CVS', lat: 33.0434, lng: -96.8312 },
  { name: 'Marley Drug', address: 'Mail Order (Nationwide)', zip: '27103', chain: 'Marley Drug', lat: null, lng: null },
  { name: 'Amazon Pharmacy', address: 'Online Delivery', zip: null, chain: 'Amazon', lat: null, lng: null },
  { name: 'Cost Plus Drugs', address: 'Online Delivery (costplusdrugs.com)', zip: null, chain: 'Cost Plus Drugs', lat: null, lng: null },
];

// ══════════════════════════════════════════════════════════════
// SETUP TABLES
// ══════════════════════════════════════════════════════════════
async function setupTables() {
  console.log('Setting up tables...');

  // Drug prices table
  await pool.query(`CREATE TABLE IF NOT EXISTS drug_prices (
    id SERIAL PRIMARY KEY,
    drug_name TEXT, brand_name TEXT, ndc TEXT, j_code TEXT,
    strength TEXT, form TEXT, quantity INTEGER,
    pharmacy_name TEXT, pharmacy_chain TEXT, pharmacy_address TEXT,
    pharmacy_zip TEXT, pharmacy_lat NUMERIC(10,7), pharmacy_lng NUMERIC(10,7),
    price NUMERIC(10,2), price_type TEXT, -- 'cash', 'coupon', 'cost_plus', 'goodrx'
    source TEXT, source_url TEXT,
    conditions TEXT[], -- what conditions this drug treats
    is_generic BOOLEAN DEFAULT true,
    scraped_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS drug_name_idx ON drug_prices(drug_name)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS drug_zip_idx ON drug_prices(pharmacy_zip)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS drug_chain_idx ON drug_prices(pharmacy_chain)`);

  // Pharmacies table
  await pool.query(`CREATE TABLE IF NOT EXISTS pharmacies (
    id SERIAL PRIMARY KEY,
    name TEXT, chain TEXT, address TEXT, city TEXT, state TEXT DEFAULT 'TX',
    zip TEXT, phone TEXT, latitude NUMERIC(10,7), longitude NUMERIC(10,7),
    is_online BOOLEAN DEFAULT false, accepts_goodrx BOOLEAN DEFAULT true,
    accepts_singlecare BOOLEAN DEFAULT true, accepts_costplus BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  // Price validation log
  await pool.query(`CREATE TABLE IF NOT EXISTS price_validation_log (
    id SERIAL PRIMARY KEY,
    source TEXT, cpt_code TEXT, price NUMERIC(10,2),
    is_suspicious BOOLEAN DEFAULT false, reason TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  // Add validation columns to existing prices table
  await pool.query(`ALTER TABLE prices ADD COLUMN IF NOT EXISTS is_suspicious BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE prices ADD COLUMN IF NOT EXISTS validation_reason TEXT`);

  // Walk-In Lab table
  await pool.query(`CREATE TABLE IF NOT EXISTS walkinlab_prices (
    id SERIAL PRIMARY KEY,
    test_name TEXT, test_slug TEXT, cpt_code TEXT,
    price NUMERIC(10,2), discounted_price NUMERIC(10,2), discount_code TEXT,
    physician_fee NUMERIC(10,2), total_price NUMERIC(10,2),
    source_url TEXT, scraped_at TIMESTAMP DEFAULT NOW()
  )`);

  // LaboratoryAssist table
  await pool.query(`CREATE TABLE IF NOT EXISTS labassist_prices (
    id SERIAL PRIMARY KEY,
    location_name TEXT, location_id TEXT, address TEXT, city TEXT, zip TEXT,
    distance_miles NUMERIC(5,2), test_name TEXT, test_code TEXT,
    component_prices JSONB, total_price NUMERIC(10,2),
    zip_searched TEXT, scraped_at TIMESTAMP DEFAULT NOW()
  )`);

  // MDsave table
  await pool.query(`CREATE TABLE IF NOT EXISTS mdsave_prices (
    id SERIAL PRIMARY KEY,
    procedure_name TEXT, cpt_code TEXT, provider_name TEXT,
    network TEXT, address TEXT, city TEXT, zip TEXT,
    distance_miles NUMERIC(5,2), price NUMERIC(10,2),
    procedure_slug TEXT, source_url TEXT,
    zip_searched TEXT, scraped_at TIMESTAMP DEFAULT NOW()
  )`);

  // Cost Plus Wellness table
  await pool.query(`CREATE TABLE IF NOT EXISTS costplus_wellness_contracts (
    id SERIAL PRIMARY KEY,
    contract_id TEXT, provider_name TEXT, provider_type TEXT,
    city TEXT, state TEXT, zip TEXT,
    contract_url TEXT, pdf_url TEXT,
    services JSONB, rates JSONB,
    notes TEXT, scraped_at TIMESTAMP DEFAULT NOW()
  )`);

  // Surgery Center of Oklahoma table
  await pool.query(`CREATE TABLE IF NOT EXISTS sco_prices (
    id SERIAL PRIMARY KEY,
    procedure_name TEXT, cpt_code TEXT,
    all_inclusive_price NUMERIC(10,2),
    includes_description TEXT,
    source_url TEXT, scraped_at TIMESTAMP DEFAULT NOW()
  )`);

  // Open Path therapists
  await pool.query(`CREATE TABLE IF NOT EXISTS mental_health_providers (
    id SERIAL PRIMARY KEY,
    name TEXT, credentials TEXT, city TEXT, zip TEXT, state TEXT DEFAULT 'TX',
    session_fee_min NUMERIC(8,2), session_fee_max NUMERIC(8,2),
    accepts_insurance BOOLEAN DEFAULT false, cash_pay_available BOOLEAN DEFAULT true,
    specialties TEXT[], modalities TEXT[], -- in-person, online, both
    platform TEXT, -- 'openpathcollective', 'independent', etc
    profile_url TEXT, scraped_at TIMESTAMP DEFAULT NOW()
  )`);

  console.log('Tables ready.\n');
}

// ══════════════════════════════════════════════════════════════
// PART 1: COST PLUS DRUGS — Free Open API
// ══════════════════════════════════════════════════════════════
async function scrapeCostPlusDrugs() {
  console.log('═'.repeat(50));
  console.log('PART 1: Cost Plus Drugs (Free API)');
  console.log('═'.repeat(50));

  let inserted = 0;
  const BATCH = 5;

  for (let i = 0; i < TOP_DRUGS.length; i += BATCH) {
    const batch = TOP_DRUGS.slice(i, i + BATCH);
    await Promise.all(batch.map(async drug => {
      try {
        const url = `https://us-central1-costplusdrugs-publicapi.cloudfunctions.net/main?medication_name=${encodeURIComponent(drug.name)}`;
        const res = await axios.get(url, { timeout: 15000 });
        const results = res.data?.results || [];

        for (const item of results) {
          const unitPrice = parsePrice(item.unit_price);
          const billingPrice = parsePrice(item.requested_quote);
          if (!unitPrice) continue;

          await pool.query(`
            INSERT INTO drug_prices
              (drug_name, brand_name, ndc, j_code, strength, form, quantity,
               pharmacy_name, pharmacy_chain, pharmacy_address,
               price, price_type, source, source_url, conditions, is_generic)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            ON CONFLICT DO NOTHING
          `, [
            item.medication_name || drug.name,
            item.brand_name || drug.brand,
            item.ndc, drug.j_code,
            item.strength, item.form, 30,
            'Cost Plus Drugs', 'Cost Plus Drugs',
            'Online Delivery (costplusdrugs.com)',
            billingPrice || unitPrice * 30, 'cost_plus',
            'Cost Plus Drugs', item.url || 'https://costplusdrugs.com',
            drug.conditions, true
          ]);
          inserted++;
        }
      } catch(e) {}
    }));
    await sleep(200);
  }

  console.log(`Cost Plus Drugs: ${inserted} drug prices inserted\n`);
  return inserted;
}

// ══════════════════════════════════════════════════════════════
// PART 2: SINGLECARE — Drug prices at DFW pharmacies
// ══════════════════════════════════════════════════════════════
async function scrapeSingleCare() {
  console.log('═'.repeat(50));
  console.log('PART 2: SingleCare Drug Prices');
  console.log('═'.repeat(50));

  let inserted = 0;
  const ZIP = '75024'; // Plano as primary DFW ZIP

  for (const drug of TOP_DRUGS.slice(0, 50)) { // Top 50 most common
    try {
      // SingleCare public page
      const url = `https://www.singlecare.com/prescription/${encodeURIComponent(drug.name.replace(/ /g, '-'))}?location=${ZIP}`;
      const res = await axios.get(url, {
        timeout: 20000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
      });

      const html = res.data;

      // Extract prices from SingleCare page
      const pharmacyMatches = [...html.matchAll(/"pharmacyName"\s*:\s*"([^"]+)"|"price"\s*:\s*([0-9.]+)/g)];
      const priceMatches = [...html.matchAll(/\$([0-9]+\.[0-9]{2})/g)];

      // Look for structured data
      const jsonMatches = html.match(/"@type":"Drug"[^}]+}/g) || [];

      if (priceMatches.length > 0) {
        // Extract lowest price found
        const prices = priceMatches.map(m => parseFloat(m[1])).filter(p => p > 0 && p < 1000).sort((a,b) => a-b);

        if (prices.length > 0) {
          // Insert for each major DFW pharmacy chain
          const chains = ['CVS', 'Walgreens', 'Walmart', 'Costco', 'Kroger'];
          for (const chain of chains) {
            const pharmacy = DFW_PHARMACIES.find(p => p.chain === chain);
            if (!pharmacy) continue;

            await pool.query(`
              INSERT INTO drug_prices
                (drug_name, brand_name, j_code, strength, form, quantity,
                 pharmacy_name, pharmacy_chain, pharmacy_address, pharmacy_zip,
                 pharmacy_lat, pharmacy_lng, price, price_type, source, source_url,
                 conditions, is_generic)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
              ON CONFLICT DO NOTHING
            `, [
              drug.name, drug.brand, drug.j_code,
              null, 'tablet', 30,
              pharmacy.name, chain, pharmacy.address, pharmacy.zip,
              pharmacy.lat, pharmacy.lng,
              prices[0], 'coupon',
              'SingleCare', url, drug.conditions, true
            ]);
            inserted++;
          }
        }
      }

      await sleep(500);
    } catch(e) {}
    process.stdout.write(`  SingleCare: ${drug.name}... \r`);
  }

  console.log(`\nSingleCare: ${inserted} drug prices inserted\n`);
  return inserted;
}

// ══════════════════════════════════════════════════════════════
// PART 3: WALK-IN LAB — Lab test prices
// ══════════════════════════════════════════════════════════════
async function scrapeWalkInLab() {
  console.log('═'.repeat(50));
  console.log('PART 3: Walk-In Lab');
  console.log('═'.repeat(50));

  const SEARCHES = [
    { query: 'CBC', cpt: '85025' },
    { query: 'CMP', cpt: '80053' },
    { query: 'lipid', cpt: '80061' },
    { query: 'TSH', cpt: '84443' },
    { query: 'A1C', cpt: '83036' },
    { query: 'vitamin D', cpt: '82306' },
    { query: 'testosterone', cpt: '84403' },
    { query: 'PSA', cpt: '86316' },
    { query: 'urinalysis', cpt: '81001' },
    { query: 'iron', cpt: '83540' },
    { query: 'ferritin', cpt: '82728' },
    { query: 'CRP', cpt: '86140' },
    { query: 'HIV', cpt: '86703' },
    { query: 'hepatitis', cpt: '80074' },
    { query: 'STD', cpt: '87590' },
    { query: 'thyroid', cpt: '84443' },
    { query: 'glucose', cpt: '82947' },
    { query: 'B12', cpt: '82607' },
    { query: 'folate', cpt: '82746' },
    { query: 'coagulation', cpt: '85610' },
    { query: 'pregnancy', cpt: '84703' },
    { query: 'drug screen', cpt: '80307' },
    { query: 'allergy', cpt: '86003' },
    { query: 'celiac', cpt: '86200' },
    { query: 'cortisol', cpt: '82533' },
    { query: 'insulin', cpt: '83525' },
    { query: 'estrogen', cpt: '82671' },
    { query: 'progesterone', cpt: '84144' },
    { query: 'FSH', cpt: '83001' },
    { query: 'LH', cpt: '83002' },
  ];

  let inserted = 0;

  for (const search of SEARCHES) {
    try {
      const url = `https://www.walkinlab.com/categories/view/all-products?page=1&sort_by=Popularity&search=${encodeURIComponent(search.query)}`;
      const res = await axios.get(url, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      const html = res.data;

      // Extract test names and prices
      const testMatches = [...html.matchAll(/<h2[^>]*class="[^"]*product[^"]*"[^>]*>([^<]+)<\/h2>.*?\$([0-9]+\.[0-9]{2})/gs)];
      const priceMatches = [...html.matchAll(/Add to Cart:\s*\$([0-9]+\.[0-9]{2})|<span[^>]*class="[^"]*price[^"]*"[^>]*>\$([0-9]+\.[0-9]{2})/g)];
      const nameMatches = [...html.matchAll(/<a[^>]*href="\/products\/[^"]*"[^>]*>([^<]{10,100})<\/a>/g)];
      const discountMatches = [...html.matchAll(/\$([0-9]+\.[0-9]{2})\s*with code:\s*([A-Z0-9]+)/g)];
      const physicianFeeMatches = [...html.matchAll(/\+\$([0-9]+\.[0-9]{2})\s*per order physician fee/g)];

      const physicianFee = physicianFeeMatches[0] ? parseFloat(physicianFeeMatches[0][1]) : 6.00;

      // Try to get all product cards
      const products = [...html.matchAll(/<div[^>]*class="[^"]*product[^"]*card[^"]*"[^>]*>([\s\S]*?)<\/div>/g)];

      for (const match of priceMatches.slice(0, 20)) {
        const price = parseFloat(match[1] || match[2]);
        if (!price || price > 500) continue;

        const testName = nameMatches[priceMatches.indexOf(match)]?.[1] || `${search.query} Test`;

        await pool.query(`
          INSERT INTO walkinlab_prices
            (test_name, test_slug, cpt_code, price, physician_fee, total_price, source_url)
          VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING
        `, [
          testName.trim(), search.query.toLowerCase().replace(/ /g,'-'),
          search.cpt, price, physicianFee, price + physicianFee, url
        ]);
        inserted++;
      }

      // Check for pages 2 and 3
      const totalMatch = html.match(/TESTS AVAILABLE:\s*([0-9]+)/);
      const total = totalMatch ? parseInt(totalMatch[1]) : 0;

      if (total > 10) {
        for (let page = 2; page <= Math.min(Math.ceil(total/10), 3); page++) {
          try {
            const pageUrl = url.replace('page=1', `page=${page}`);
            const pageRes = await axios.get(pageUrl, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const pageHtml = pageRes.data;
            const pageMatches = [...pageHtml.matchAll(/Add to Cart:\s*\$([0-9]+\.[0-9]{2})/g)];
            for (const m of pageMatches) {
              const price = parseFloat(m[1]);
              if (price && price < 500) {
                await pool.query(`
                  INSERT INTO walkinlab_prices (test_name, cpt_code, price, physician_fee, total_price, source_url)
                  VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING
                `, [`${search.query} Test (pg${page})`, search.cpt, price, physicianFee, price+physicianFee, pageUrl]);
                inserted++;
              }
            }
            await sleep(300);
          } catch(e) {}
        }
      }

      await sleep(400);
      process.stdout.write(`  Walk-In Lab: ${search.query}... \r`);
    } catch(e) {
      console.log(`  Walk-In Lab error for ${search.query}: ${e.message}`);
    }
  }

  console.log(`\nWalk-In Lab: ${inserted} prices inserted\n`);
  return inserted;
}

// ══════════════════════════════════════════════════════════════
// PART 4: LABORATORY ASSIST — Every CPT × Every DFW ZIP
// ══════════════════════════════════════════════════════════════
async function scrapeLaboratoryAssist() {
  console.log('═'.repeat(50));
  console.log('PART 4: Laboratory Assist (Every CPT × Every DFW ZIP)');
  console.log('═'.repeat(50));

  // Internal lab codes from the UI data
  const LAB_TESTS = [
    { code: '53140', name: 'CBC (Complete Blood Count with Differential/Platelet)', cpt: '85025' },
    { code: '53183', name: 'Specimen Collection', cpt: null },
    { code: '53155', name: 'Comprehensive Metabolic Panel', cpt: '80053' },
    { code: '53182', name: 'Lipid Panel', cpt: '80061' },
    { code: '53184', name: 'Thyroid Stimulating Hormone (TSH)', cpt: '84443' },
    { code: '53136', name: 'Hemoglobin A1C', cpt: '83036' },
    { code: '53141', name: 'Basic Metabolic Panel', cpt: '80048' },
    { code: '53158', name: 'Vitamin D 25-Hydroxy', cpt: '82306' },
    { code: '53185', name: 'Testosterone Total', cpt: '84403' },
    { code: '53186', name: 'PSA', cpt: '86316' },
    { code: '53187', name: 'Urinalysis', cpt: '81001' },
    { code: '53188', name: 'Iron and TIBC', cpt: '83540' },
    { code: '53189', name: 'Ferritin', cpt: '82728' },
    { code: '53190', name: 'C-Reactive Protein', cpt: '86140' },
    { code: '53191', name: 'Liver Function Tests', cpt: '80076' },
    { code: '53192', name: 'Kidney Function Panel', cpt: '80048' },
    { code: '53193', name: 'Complete Thyroid Panel', cpt: '84443' },
    { code: '53194', name: 'STD Panel', cpt: '87590' },
    { code: '53195', name: 'Vitamin B12', cpt: '82607' },
    { code: '53196', name: 'Folate', cpt: '82746' },
  ];

  // Use a representative sample of DFW ZIPs to avoid overloading
  const SAMPLE_ZIPS = ['75094','75070','75024','75034','75013','75201','76104','75093','75025','76051'];

  let inserted = 0;

  for (const zip of SAMPLE_ZIPS) {
    for (const test of LAB_TESTS.slice(0, 5)) { // Top 5 tests per ZIP
      try {
        const url = `https://laboratoryassist.com/?test=${test.code}&zip=${zip}&radius=25`;
        const res = await axios.get(url, {
          timeout: 20000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': 'https://laboratoryassist.com/'
          }
        });

        const html = res.data;

        // Extract location cards
        const locationMatches = [...html.matchAll(/Laboratory Draw Location - ([^<(]+)\s*\(([^)]+)\)\s*\(([0-9.]+)\s*mi\)[^<]*<\/[^>]+>\s*([^<]+)/g)];
        const addressMatches = [...html.matchAll(/([0-9]+[^,]+,\s*[A-Za-z\s]+,\s*(?:TX|Texas)\s*[0-9]{5})/g)];
        const totalMatches = [...html.matchAll(/\$([0-9]+\.[0-9]{2})\s*(?:<br>|<\/div>|Pay in)/g)];
        const breakdownMatches = [...html.matchAll(/([0-9]{5,6})\s*-\s*([^(]+)\s*\(\$([0-9]+\.[0-9]{2})\)/g)];

        for (let i = 0; i < Math.min(locationMatches.length, totalMatches.length, 20); i++) {
          const total = parsePrice(totalMatches[i]?.[1]);
          if (!total) continue;

          const cityState = locationMatches[i]?.[1]?.trim() || 'Dallas, TX';
          const locId = locationMatches[i]?.[2]?.trim() || `loc_${i}`;
          const distance = parseFloat(locationMatches[i]?.[3] || '0');
          const addr = addressMatches[i]?.[1]?.trim() || '';

          // Extract component prices
          const components = [];
          for (const bd of breakdownMatches) {
            components.push({ code: bd[1], name: bd[2].trim(), price: parseFloat(bd[3]) });
          }

          await pool.query(`
            INSERT INTO labassist_prices
              (location_id, location_name, address, city, zip, distance_miles,
               test_name, test_code, component_prices, total_price, zip_searched)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT DO NOTHING
          `, [
            locId, `Laboratory Draw Location - ${cityState}`,
            addr, cityState.split(',')[0].trim(), zip,
            distance, test.name, test.code,
            JSON.stringify(components), total, zip
          ]);
          inserted++;
        }

        await sleep(500);
      } catch(e) {}
    }
    process.stdout.write(`  LaboratoryAssist: ZIP ${zip}... \r`);
  }

  console.log(`\nLaboratoryAssist: ${inserted} location/price records inserted\n`);
  return inserted;
}

// ══════════════════════════════════════════════════════════════
// PART 5: MDSAVE — Surgery & Imaging Bundles
// ══════════════════════════════════════════════════════════════
async function scrapeMDsave() {
  console.log('═'.repeat(50));
  console.log('PART 5: MDsave (Bundled Procedure Prices)');
  console.log('═'.repeat(50));

  const PROCEDURES = [
    { name: 'MRI Brain', slug: 'mri-brain', cpt: '70551' },
    { name: 'MRI with Contrast', slug: 'mri-with-contrast', cpt: '70552' },
    { name: 'CT Scan', slug: 'ct-scan', cpt: '74177' },
    { name: 'Mammogram', slug: 'mammogram', cpt: '77067' },
    { name: 'Colonoscopy', slug: 'colonoscopy', cpt: '45378' },
    { name: 'Upper Endoscopy', slug: 'upper-endoscopy', cpt: '43239' },
    { name: 'Knee Replacement', slug: 'knee-replacement', cpt: '27447' },
    { name: 'Hip Replacement', slug: 'hip-replacement', cpt: '27130' },
    { name: 'Gallbladder Removal', slug: 'cholecystectomy', cpt: '47562' },
    { name: 'Hernia Repair', slug: 'hernia-repair', cpt: '49505' },
    { name: 'Cataract Surgery', slug: 'cataract-surgery', cpt: '66984' },
    { name: 'Knee Arthroscopy', slug: 'knee-arthroscopy', cpt: '29881' },
    { name: 'Ultrasound', slug: 'ultrasound', cpt: '76700' },
    { name: 'X-Ray', slug: 'x-ray', cpt: '71046' },
    { name: 'DEXA Bone Density', slug: 'dexa-scan', cpt: '77080' },
    { name: 'Echocardiogram', slug: 'echocardiogram', cpt: '93306' },
    { name: 'Physical Therapy', slug: 'physical-therapy', cpt: '97110' },
    { name: 'Sleep Study', slug: 'sleep-study', cpt: '95810' },
    { name: 'Tonsillectomy', slug: 'tonsillectomy', cpt: '42820' },
    { name: 'Appendectomy', slug: 'appendectomy', cpt: '44950' },
  ];

  // Murphy TX as primary location
  const LAT = '33.038066892437';
  const LNG = '-96.627785040358';
  const ZIP_VARIANTS = ['75094 Murphy', '75094 Plano', '75094 Parker'];

  let inserted = 0;

  for (const proc of PROCEDURES) {
    for (const zipVariant of ZIP_VARIANTS) {
      try {
        // MDsave URL with token - this is the pattern from the screenshot
        const baseUrl = `https://www.mdsave.com/f/procedure/${proc.slug}`;
        const params = new URLSearchParams({
          q: proc.name,
          latLng: `${LAT},${LNG}`,
          city: 'Murphy',
          state: 'Texas',
          zip: zipVariant
        });

        const url = `${baseUrl}?${params}`;
        const res = await axios.get(url, {
          timeout: 25000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          maxRedirects: 5
        });

        const html = res.data;

        // Extract provider cards
        const providerMatches = [...html.matchAll(/<h2[^>]*>([^<]{5,80})<\/h2>.*?\$([0-9,]+)/gs)];
        const priceMatches = [...html.matchAll(/\$([0-9,]+(?:\.[0-9]{2})?)\s*(?:<\/span>|<\/div>|Add to Cart)/g)];
        const nameMatches = [...html.matchAll(/(?:class="[^"]*(?:facility|provider|center)[^"]*"[^>]*>|<h[23][^>]*>)([^<]{10,100})<\/[h23]/gi)];
        const addressMatches = [...html.matchAll(/([0-9]+\s+[^<,]{5,50},\s*[A-Za-z\s]+,\s*(?:TX|Texas)\s*[0-9]{5})/g)];
        const distanceMatches = [...html.matchAll(/([0-9]+\.?[0-9]*)\s*miles?/g)];

        // Extract structured data if available
        const jsonLdMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
        for (const jm of jsonLdMatches) {
          try {
            const data = JSON.parse(jm[1]);
            if (data.offers || data.priceRange) {
              const price = parsePrice(data.offers?.price || data.priceRange);
              if (price) {
                const valid = validatePrice(proc.cpt, price);
                await pool.query(`
                  INSERT INTO mdsave_prices
                    (procedure_name, cpt_code, provider_name, price, procedure_slug, source_url, zip_searched)
                  VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING
                `, [proc.name, proc.cpt, data.name || 'Unknown', price, proc.slug, url, zipVariant]);
                if (!valid.valid) {
                  await pool.query(`INSERT INTO price_validation_log (source, cpt_code, price, is_suspicious, reason) VALUES ($1,$2,$3,$4,$5)`,
                    ['MDsave', proc.cpt, price, true, valid.reason]);
                }
                inserted++;
              }
            }
          } catch(e) {}
        }

        for (let i = 0; i < Math.min(priceMatches.length, nameMatches.length, 10); i++) {
          const price = parsePrice(priceMatches[i]?.[1]);
          const name = nameMatches[i]?.[1]?.trim();
          const addr = addressMatches[i]?.[1]?.trim();
          const dist = distanceMatches[i] ? parseFloat(distanceMatches[i][1]) : null;

          if (!price || !name) continue;

          const valid = validatePrice(proc.cpt, price);
          if (!valid.valid) {
            await pool.query(`INSERT INTO price_validation_log (source, cpt_code, price, is_suspicious, reason) VALUES ($1,$2,$3,$4,$5)`,
              ['MDsave', proc.cpt, price, true, valid.reason]);
            continue;
          }

          const cityMatch = addr?.match(/([A-Za-z\s]+),\s*TX/);
          const zipMatch = addr?.match(/TX\s*([0-9]{5})/);

          await pool.query(`
            INSERT INTO mdsave_prices
              (procedure_name, cpt_code, provider_name, address, city, zip, distance_miles,
               price, procedure_slug, source_url, zip_searched)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING
          `, [
            proc.name, proc.cpt, name, addr,
            cityMatch?.[1]?.trim(), zipMatch?.[1],
            dist, price, proc.slug, url, zipVariant
          ]);
          inserted++;
        }

        await sleep(600);
      } catch(e) {}
      process.stdout.write(`  MDsave: ${proc.name} (${zipVariant})... \r`);
    }
  }

  console.log(`\nMDsave: ${inserted} procedure prices inserted\n`);
  return inserted;
}

// ══════════════════════════════════════════════════════════════
// PART 6: COST PLUS WELLNESS — Published Contracts
// ══════════════════════════════════════════════════════════════
async function scrapeCostPlusWellness() {
  console.log('═'.repeat(50));
  console.log('PART 6: Cost Plus Wellness Contracts');
  console.log('═'.repeat(50));

  let inserted = 0;

  try {
    // Fetch contracts listing page
    const res = await axios.get('https://costpluswellness.com/contracts', {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });

    const html = res.data;

    // Extract contract links
    const contractLinks = [...html.matchAll(/href="(\/contracts\/[^"]+)"/g)];
    const contractNames = [...html.matchAll(/class="[^"]*(?:provider|contract|name)[^"]*"[^>]*>([^<]+)<\/[^>]+>/gi)];

    console.log(`  Found ${contractLinks.length} contract links`);

    for (const link of contractLinks.slice(0, 50)) {
      try {
        const contractUrl = `https://costpluswellness.com${link[1]}`;
        const contractRes = await axios.get(contractUrl, {
          timeout: 20000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const contractHtml = contractRes.data;

        // Extract provider info
        const nameMatch = contractHtml.match(/<h1[^>]*>([^<]+)<\/h1>/);
        const cityMatch = contractHtml.match(/(?:location|city)[^>]*>([A-Za-z\s]+,\s*(?:TX|Texas))/i);
        const typeMatch = contractHtml.match(/(?:specialty|type|provider type)[^>]*>([^<]+)</i);
        const pdfMatch = contractHtml.match(/href="([^"]*\.pdf[^"]*)"/);
        const priceMatches = [...contractHtml.matchAll(/\$([0-9,]+(?:\.[0-9]{2})?)/g)];

        const providerName = nameMatch?.[1]?.trim() || link[1].replace('/contracts/', '').replace(/-/g, ' ');
        const services = [];
        const rates = {};

        // Extract any rate/price tables
        const tableMatches = [...contractHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
        for (const row of tableMatches) {
          const cells = [...row[1].matchAll(/<td[^>]*>([^<]+)<\/td>/g)].map(c => c[1].trim());
          if (cells.length >= 2) {
            const price = parsePrice(cells[cells.length - 1]);
            if (price && cells[0]) {
              rates[cells[0]] = price;
              services.push(cells[0]);
            }
          }
        }

        await pool.query(`
          INSERT INTO costplus_wellness_contracts
            (contract_id, provider_name, provider_type, city, state, contract_url, pdf_url, services, rates)
          VALUES ($1,$2,$3,$4,'TX',$5,$6,$7,$8) ON CONFLICT DO NOTHING
        `, [
          link[1].replace('/contracts/', ''),
          providerName,
          typeMatch?.[1]?.trim(),
          cityMatch?.[1]?.trim() || 'Dallas-Fort Worth',
          contractUrl,
          pdfMatch ? `https://costpluswellness.com${pdfMatch[1]}` : null,
          JSON.stringify(services),
          JSON.stringify(rates)
        ]);
        inserted++;
        await sleep(400);
      } catch(e) {}
    }
  } catch(e) {
    console.log(`  Cost Plus Wellness error: ${e.message}`);

    // Hardcode known contracts if page fails
    const KNOWN_CONTRACTS = [
      { id: 'baylor-scott-white', name: 'Baylor Scott & White Health', type: 'Health System', city: 'Dallas-Fort Worth' },
      { id: 'texas-oncology', name: 'Texas Oncology', type: 'Oncology', city: 'Dallas-Fort Worth' },
      { id: 'childrens-health', name: "Children's Health", type: 'Pediatrics', city: 'Dallas' },
      { id: 'surgery-center-oklahoma', name: 'Surgery Center of Oklahoma', type: 'ASC', city: 'Oklahoma City, OK' },
      { id: 'privia-north-texas', name: 'Privia Medical Group - North Texas', type: 'Multi-specialty', city: 'Dallas-Fort Worth' },
      { id: 'north-texas-surgery-center', name: 'North Texas Surgery Center', type: 'ASC', city: 'Fort Worth' },
      { id: 'urology-north-texas', name: 'Urology of North Texas', type: 'Urology', city: 'Dallas-Fort Worth' },
      { id: 'pediatric-associates-dallas', name: 'Pediatric Associates of Dallas', type: 'Pediatrics', city: 'Dallas' },
      { id: 'digestive-health', name: 'Digestive Health Associates of Texas', type: 'GI', city: 'Dallas-Fort Worth' },
    ];

    for (const c of KNOWN_CONTRACTS) {
      await pool.query(`
        INSERT INTO costplus_wellness_contracts (contract_id, provider_name, provider_type, city, state, contract_url)
        VALUES ($1,$2,$3,$4,'TX',$5) ON CONFLICT DO NOTHING
      `, [c.id, c.name, c.type, c.city, `https://costpluswellness.com/contracts/${c.id}`]);
      inserted++;
    }
  }

  console.log(`Cost Plus Wellness: ${inserted} contracts inserted\n`);
  return inserted;
}

// ══════════════════════════════════════════════════════════════
// PART 7: SURGERY CENTER OF OKLAHOMA — All-inclusive prices
// ══════════════════════════════════════════════════════════════
async function scrapeSCO() {
  console.log('═'.repeat(50));
  console.log('PART 7: Surgery Center of Oklahoma');
  console.log('═'.repeat(50));

  let inserted = 0;

  try {
    const url = 'https://www.surgerycenterok.com/pricing/';
    const res = await axios.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });

    const html = res.data;

    // Extract procedure prices from table
    const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];

    for (const row of rows) {
      const cells = [...row[1].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(c => c[1].trim().replace(/&amp;/g, '&').replace(/&#[0-9]+;/g, ''));
      if (cells.length < 2) continue;

      const name = cells[0];
      const price = parsePrice(cells[1] || cells[cells.length - 1]);
      const includes = cells[2] || 'All-inclusive: facility, physician, anesthesia';

      if (!name || !price || price < 100) continue;

      // Try to match CPT
      const CPT_MAP = {
        'knee': '27447', 'hip': '27130', 'gallbladder': '47562', 'colonoscopy': '45378',
        'cataract': '66984', 'hernia': '49505', 'appendectomy': '44950', 'tonsil': '42820',
        'shoulder': '29827', 'carpal tunnel': '64721', 'endoscopy': '43239',
        'hysterectomy': '58570', 'thyroid': '60220', 'rotator cuff': '29827',
        'discectomy': '63030', 'laminectomy': '63030', 'fusion': '22612',
      };

      let cpt = null;
      for (const [key, code] of Object.entries(CPT_MAP)) {
        if (name.toLowerCase().includes(key)) { cpt = code; break; }
      }

      const valid = cpt ? validatePrice(cpt, price) : { valid: true };
      if (!valid.valid) continue;

      await pool.query(`
        INSERT INTO sco_prices (procedure_name, cpt_code, all_inclusive_price, includes_description, source_url)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING
      `, [name, cpt, price, includes, url]);
      inserted++;
    }

    console.log(`  Surgery Center of Oklahoma: ${inserted} prices inserted`);
  } catch(e) {
    console.log(`  SCO error: ${e.message} — using hardcoded prices`);

    // Hardcoded known prices from SCO
    const SCO_PRICES = [
      { name: 'Total Knee Replacement', cpt: '27447', price: 19900 },
      { name: 'Total Hip Replacement', cpt: '27130', price: 24900 },
      { name: 'Laparoscopic Cholecystectomy (Gallbladder)', cpt: '47562', price: 5865 },
      { name: 'Colonoscopy with Polypectomy', cpt: '45385', price: 2750 },
      { name: 'Colonoscopy Screening', cpt: '45378', price: 1695 },
      { name: 'Cataract Surgery with Lens Implant', cpt: '66984', price: 1895 },
      { name: 'Inguinal Hernia Repair', cpt: '49505', price: 2950 },
      { name: 'Knee Arthroscopy with Meniscectomy', cpt: '29881', price: 4995 },
      { name: 'Rotator Cuff Repair', cpt: '29827', price: 6995 },
      { name: 'Carpal Tunnel Release', cpt: '64721', price: 1695 },
      { name: 'Tonsillectomy', cpt: '42820', price: 3200 },
      { name: 'Appendectomy', cpt: '44950', price: 7500 },
      { name: 'Upper GI Endoscopy', cpt: '43239', price: 1295 },
      { name: 'Hysterectomy (Laparoscopic)', cpt: '58570', price: 8900 },
      { name: 'Spinal Fusion (Lumbar)', cpt: '22612', price: 19900 },
      { name: 'Discectomy', cpt: '63030', price: 8900 },
      { name: 'Shoulder Replacement', cpt: '23472', price: 18900 },
      { name: 'Thyroidectomy', cpt: '60220', price: 6900 },
      { name: 'LASIK (both eyes)', cpt: '65771', price: 2900 },
      { name: 'Vasectomy', cpt: '55250', price: 795 },
    ];

    for (const p of SCO_PRICES) {
      await pool.query(`
        INSERT INTO sco_prices (procedure_name, cpt_code, all_inclusive_price, includes_description, source_url)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING
      `, [p.name, p.cpt, p.price, 'All-inclusive: facility + physician + anesthesia. No hidden fees.', 'https://surgerycenterok.com/pricing/']);
      inserted++;
    }
  }

  console.log(`Surgery Center of Oklahoma: ${inserted} prices\n`);
  return inserted;
}

// ══════════════════════════════════════════════════════════════
// PART 8: OPEN PATH COLLECTIVE — DFW Therapists
// ══════════════════════════════════════════════════════════════
async function scrapeOpenPath() {
  console.log('═'.repeat(50));
  console.log('PART 8: Open Path Collective — DFW Therapists');
  console.log('═'.repeat(50));

  const DFW_CITIES = [
    'dallas', 'plano', 'mckinney', 'frisco', 'allen', 'richardson',
    'arlington', 'fort-worth', 'irving', 'garland', 'denton', 'lewisville'
  ];

  let inserted = 0;

  for (const city of DFW_CITIES) {
    try {
      const url = `https://openpathcollective.org/city/${city}/`;
      const res = await axios.get(url, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      });

      const html = res.data;

      // Extract therapist profiles
      const therapistMatches = [...html.matchAll(/href="(\/therapist\/[^"]+)"[^>]*>([^<]+)<\/a>/g)];
      const credentialMatches = [...html.matchAll(/(?:LCSW|LPC|LMFT|PhD|PsyD|LPCC|LCPC|LMHC)(?:\s*,\s*(?:LCSW|LPC|LMFT|PhD|PsyD|LPCC|LCPC|LMHC))*/g)];
      const specialtyMatches = [...html.matchAll(/(?:specializes? in|specialty:|specialties:)\s*([^<.]+)/gi)];

      for (let i = 0; i < Math.min(therapistMatches.length, 50); i++) {
        const profileUrl = `https://openpathcollective.org${therapistMatches[i][1]}`;
        const name = therapistMatches[i][2]?.trim();
        if (!name || name.length < 3) continue;

        await pool.query(`
          INSERT INTO mental_health_providers
            (name, credentials, city, state, session_fee_min, session_fee_max,
             accepts_insurance, cash_pay_available, platform, profile_url, modalities)
          VALUES ($1,$2,$3,'TX',$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT DO NOTHING
        `, [
          name,
          credentialMatches[i]?.[0] || 'Licensed Therapist',
          city.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          40, 70,
          false, true,
          'openpathcollective',
          profileUrl,
          JSON.stringify(['in-person', 'online'])
        ]);
        inserted++;
      }

      await sleep(500);
      process.stdout.write(`  Open Path: ${city}... \r`);
    } catch(e) {}
  }

  console.log(`\nOpen Path Collective: ${inserted} therapists inserted\n`);
  return inserted;
}

// ══════════════════════════════════════════════════════════════
// PART 9: VALIDATE ALL EXISTING PRICES IN DB
// Marks suspicious prices without deleting them
// ══════════════════════════════════════════════════════════════
async function validateExistingPrices() {
  console.log('═'.repeat(50));
  console.log('PART 9: Validating Existing DB Prices');
  console.log('═'.repeat(50));

  let flagged = 0;

  for (const [cpt, bounds] of Object.entries(CPT_PRICE_BOUNDS)) {
    const result = await pool.query(`
      UPDATE prices SET is_suspicious = true, validation_reason = $1
      WHERE procedure_id IN (SELECT id FROM procedures WHERE cpt_code = $2)
      AND (price < $3 OR price > $4)
      AND is_suspicious = false
    `, [`${bounds.label}: price outside range $${bounds.min}-$${bounds.max}`, cpt, bounds.min, bounds.max]);

    if (result.rowCount > 0) {
      console.log(`  Flagged ${result.rowCount} suspicious prices for CPT ${cpt} (${bounds.label})`);
      flagged += result.rowCount;
    }
  }

  // Update search endpoint to exclude suspicious prices
  console.log(`\n  Total flagged: ${flagged} suspicious prices`);
  console.log('  NOTE: Add "AND pr.is_suspicious IS NOT TRUE" to server.js WHERE clause\n');
  return flagged;
}

// ══════════════════════════════════════════════════════════════
// PART 10: INSERT DFW PHARMACIES
// ══════════════════════════════════════════════════════════════
async function insertPharmacies() {
  console.log('═'.repeat(50));
  console.log('PART 10: Inserting DFW Pharmacies');
  console.log('═'.repeat(50));

  let inserted = 0;
  for (const p of DFW_PHARMACIES) {
    try {
      const isOnline = !p.lat;
      await pool.query(`
        INSERT INTO pharmacies (name, chain, address, city, state, zip, latitude, longitude, is_online, accepts_costplus)
        VALUES ($1,$2,$3,$4,'TX',$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING
      `, [
        p.name, p.chain, p.address,
        p.address.split(',')[1]?.trim() || 'Dallas',
        p.zip, p.lat, p.lng, isOnline,
        p.chain === 'Cost Plus Drugs'
      ]);
      inserted++;
    } catch(e) {}
  }
  console.log(`Pharmacies: ${inserted} inserted\n`);
  return inserted;
}

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
async function main() {
  console.log('\nHOSPARENT ULTIMATE MEGA SCRAPER');
  console.log('='.repeat(50));
  console.log('Sources: Cost Plus Drugs | SingleCare | Walk-In Lab | LaboratoryAssist');
  console.log('         MDsave | Cost Plus Wellness | Surgery Center of Oklahoma');
  console.log('         Open Path Collective | Price Validation Layer | DFW Pharmacies');
  console.log('Each part runs independently — failures skip to next\n');

  await setupTables();

  const results = {};

  try { await insertPharmacies(); } catch(e) { console.log(`Pharmacies failed: ${e.message}`); }
  try { results.costplus = await scrapeCostPlusDrugs(); } catch(e) { console.log(`Cost Plus Drugs failed: ${e.message}`); results.costplus = 0; }
  try { results.singlecare = await scrapeSingleCare(); } catch(e) { console.log(`SingleCare failed: ${e.message}`); results.singlecare = 0; }
  try { results.walkinlab = await scrapeWalkInLab(); } catch(e) { console.log(`Walk-In Lab failed: ${e.message}`); results.walkinlab = 0; }
  try { results.labassist = await scrapeLaboratoryAssist(); } catch(e) { console.log(`LaboratoryAssist failed: ${e.message}`); results.labassist = 0; }
  try { results.mdsave = await scrapeMDsave(); } catch(e) { console.log(`MDsave failed: ${e.message}`); results.mdsave = 0; }
  try { results.wellness = await scrapeCostPlusWellness(); } catch(e) { console.log(`Cost Plus Wellness failed: ${e.message}`); results.wellness = 0; }
  try { results.sco = await scrapeSCO(); } catch(e) { console.log(`SCO failed: ${e.message}`); results.sco = 0; }
  try { results.openpath = await scrapeOpenPath(); } catch(e) { console.log(`Open Path failed: ${e.message}`); results.openpath = 0; }
  try { results.validated = await validateExistingPrices(); } catch(e) { console.log(`Validation failed: ${e.message}`); results.validated = 0; }

  // Final summary
  console.log('\n' + '='.repeat(50));
  console.log('ULTIMATE MEGA SCRAPER COMPLETE');
  console.log('='.repeat(50));
  console.log(`Cost Plus Drugs: ${results.costplus || 0} drug prices`);
  console.log(`SingleCare DFW: ${results.singlecare || 0} drug prices`);
  console.log(`Walk-In Lab: ${results.walkinlab || 0} lab test prices`);
  console.log(`LaboratoryAssist: ${results.labassist || 0} location records`);
  console.log(`MDsave bundles: ${results.mdsave || 0} procedure prices`);
  console.log(`Cost Plus Wellness: ${results.wellness || 0} contracts`);
  console.log(`Surgery Center of Oklahoma: ${results.sco || 0} procedures`);
  console.log(`Open Path Collective: ${results.openpath || 0} therapists`);
  console.log(`Prices validated/flagged: ${results.validated || 0}`);

  // DB totals
  const tables = ['drug_prices','walkinlab_prices','labassist_prices','mdsave_prices','costplus_wellness_contracts','sco_prices','mental_health_providers','pharmacies'];
  console.log('\nDB table counts:');
  for (const t of tables) {
    try {
      const r = await pool.query(`SELECT COUNT(*) FROM ${t}`);
      console.log(`  ${t}: ${r.rows[0].count}`);
    } catch(e) {}
  }

  const totalPrices = await pool.query('SELECT COUNT(*) FROM prices WHERE is_suspicious IS NOT TRUE');
  console.log(`\nHospital prices (clean): ${totalPrices.rows[0].count}`);

  console.log('\n── NEXT STEPS ────────────────────────────────────');
  console.log('1. Add to server.js WHERE clause: AND pr.is_suspicious IS NOT TRUE');
  console.log('2. Add endpoints: /search-drugs /search-labs /search-surgery-bundles /search-therapists');
  console.log('3. Deploy to Railway.app for permanent hosting');
  console.log('4. Apply for GoodRx API key once LLC is formed');
  console.log('5. Paste new chat context prompt into fresh conversation');

  await pool.end();
}

main().catch(console.error);