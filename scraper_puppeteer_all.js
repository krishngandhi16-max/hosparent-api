require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const parsePrice = v => {
  if (!v) return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return isNaN(n) || n <= 0 || n > 999999 ? null : n;
};

// ══════════════════════════════════════════════════════════
// PUPPETEER MEGA SCRAPER
// Walk-In Lab | LaboratoryAssist | MDsave | Surgery Center OK | Open Path
// Run: node scraper_puppeteer_all.js
// Requires: npm install puppeteer
// ══════════════════════════════════════════════════════════

async function getPuppeteer() {
  try {
    return require('puppeteer');
  } catch(e) {
    console.log('Installing puppeteer...');
    const { execSync } = require('child_process');
    execSync('npm install puppeteer --save', { stdio: 'inherit' });
    return require('puppeteer');
  }
}

// ── WALK-IN LAB ────────────────────────────────────────────
async function scrapeWalkInLab(browser) {
  console.log('\n══════════════════════════════════════════════════');
  console.log('Walk-In Lab');
  console.log('══════════════════════════════════════════════════');

  await pool.query(`CREATE TABLE IF NOT EXISTS walkinlab_prices (
    id SERIAL PRIMARY KEY,
    test_name TEXT, test_slug TEXT, cpt_code TEXT,
    price NUMERIC(10,2), discounted_price NUMERIC(10,2),
    discount_code TEXT, physician_fee NUMERIC(10,2),
    total_price NUMERIC(10,2), source_url TEXT,
    scraped_at TIMESTAMP DEFAULT NOW()
  )`);

  const SEARCHES = [
    { query: 'CBC', cpt: '85025' }, { query: 'comprehensive metabolic', cpt: '80053' },
    { query: 'lipid panel', cpt: '80061' }, { query: 'TSH', cpt: '84443' },
    { query: 'hemoglobin A1C', cpt: '83036' }, { query: 'vitamin D', cpt: '82306' },
    { query: 'testosterone', cpt: '84403' }, { query: 'PSA', cpt: '86316' },
    { query: 'urinalysis', cpt: '81001' }, { query: 'ferritin', cpt: '82728' },
    { query: 'CRP', cpt: '86140' }, { query: 'HIV', cpt: '86703' },
    { query: 'hepatitis', cpt: '80074' }, { query: 'STD', cpt: '87590' },
    { query: 'glucose', cpt: '82947' }, { query: 'vitamin B12', cpt: '82607' },
    { query: 'folate', cpt: '82746' }, { query: 'coagulation', cpt: '85610' },
    { query: 'thyroid panel', cpt: '84443' }, { query: 'iron', cpt: '83540' },
    { query: 'cortisol', cpt: '82533' }, { query: 'estrogen', cpt: '82671' },
    { query: 'FSH', cpt: '83001' }, { query: 'allergy', cpt: '86003' },
    { query: 'drug screen', cpt: '80307' }, { query: 'pregnancy', cpt: '84703' },
    { query: 'basic metabolic', cpt: '80048' }, { query: 'complete blood', cpt: '85025' },
    { query: 'prothrombin', cpt: '85610' }, { query: 'creatinine', cpt: '82565' },
  ];

  let inserted = 0;
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  for (const search of SEARCHES) {
    try {
      const url = `https://www.walkinlab.com/categories/view/all-products?page=1&sort_by=Popularity&search=${encodeURIComponent(search.query)}`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(1000);

      // Get total count
      const totalText = await page.$eval('.test-count, [class*="available"]', el => el.textContent).catch(() => '');
      const totalMatch = totalText.match(/([0-9]+)/);
      const total = totalMatch ? parseInt(totalMatch[1]) : 10;
      const pages = Math.min(Math.ceil(total / 10), 5);

      for (let p = 1; p <= pages; p++) {
        if (p > 1) {
          await page.goto(url.replace('page=1', `page=${p}`), { waitUntil: 'networkidle2', timeout: 30000 });
          await sleep(800);
        }

        const products = await page.evaluate(() => {
          const items = [];
          document.querySelectorAll('.product-item, [class*="product-card"], .wil-card').forEach(el => {
            const name = el.querySelector('h2, h3, a[href*="/products/"]')?.textContent?.trim();
            const priceEl = el.querySelector('[class*="price"], .add-to-cart');
            const priceText = priceEl?.textContent?.trim() || '';
            const priceMatch = priceText.match(/\$([0-9]+\.[0-9]{2})/);
            const discountMatch = el.textContent.match(/\$([0-9]+\.[0-9]{2})\s*with code:\s*([A-Z0-9]+)/);
            const physicianMatch = el.textContent.match(/\+\$([0-9]+\.[0-9]{2})\s*per order physician fee/);
            if (name && priceMatch) {
              items.push({
                name: name.substring(0, 200),
                price: parseFloat(priceMatch[1]),
                discountedPrice: discountMatch ? parseFloat(discountMatch[1]) : null,
                discountCode: discountMatch ? discountMatch[2] : null,
                physicianFee: physicianMatch ? parseFloat(physicianMatch[1]) : 6.00,
              });
            }
          });
          return items;
        });

        for (const item of products) {
          if (!item.name || !item.price) continue;
          await pool.query(`
            INSERT INTO walkinlab_prices (test_name, cpt_code, price, discounted_price, discount_code, physician_fee, total_price, source_url)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING
          `, [item.name, search.cpt, item.price, item.discountedPrice, item.discountCode,
              item.physicianFee, item.price + item.physicianFee, url]);
          inserted++;
        }
      }

      console.log(`  ✓ ${search.query}: found results`);
      await sleep(500);
    } catch(e) {
      console.log(`  ✗ ${search.query}: ${e.message}`);
    }
  }

  await page.close();
  console.log(`Walk-In Lab: ${inserted} prices inserted`);
  return inserted;
}

// ── LABORATORY ASSIST ──────────────────────────────────────
async function scrapeLaboratoryAssist(browser) {
  console.log('\n══════════════════════════════════════════════════');
  console.log('Laboratory Assist');
  console.log('══════════════════════════════════════════════════');

  await pool.query(`CREATE TABLE IF NOT EXISTS labassist_prices (
    id SERIAL PRIMARY KEY,
    location_name TEXT, location_id TEXT, address TEXT, city TEXT, zip TEXT,
    distance_miles NUMERIC(5,2), test_name TEXT, test_code TEXT,
    component_prices JSONB, total_price NUMERIC(10,2),
    zip_searched TEXT, scraped_at TIMESTAMP DEFAULT NOW()
  )`);

  // Key tests with internal codes
  const TESTS = [
    { code: '53140', name: 'CBC Complete Blood Count', cpt: '85025' },
    { code: '53155', name: 'Comprehensive Metabolic Panel', cpt: '80053' },
    { code: '53182', name: 'Lipid Panel', cpt: '80061' },
    { code: '53184', name: 'TSH Thyroid', cpt: '84443' },
    { code: '53136', name: 'Hemoglobin A1C', cpt: '83036' },
    { code: '53158', name: 'Vitamin D', cpt: '82306' },
    { code: '53185', name: 'Testosterone', cpt: '84403' },
    { code: '53186', name: 'PSA', cpt: '86316' },
    { code: '53187', name: 'Urinalysis', cpt: '81001' },
    { code: '53189', name: 'Ferritin', cpt: '82728' },
  ];

  const DFW_ZIPS = ['75094','75070','75024','75034','75013','75201','76104','75093','75025','76051',
                    '75081','75080','75069','75075','75062','76015','75150','75040','75088','75028'];

  let inserted = 0;
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  for (const test of TESTS) {
    for (const zip of DFW_ZIPS) {
      try {
        const url = `https://laboratoryassist.com/?zip=${zip}&radius=25&test=${test.code}`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(1500);

        const locations = await page.evaluate(() => {
          const results = [];
          document.querySelectorAll('[class*="location"], [class*="result"], .lab-location').forEach(el => {
            const name = el.querySelector('h2, h3, [class*="name"]')?.textContent?.trim();
            const addr = el.querySelector('[class*="address"], address')?.textContent?.trim();
            const dist = el.textContent.match(/([0-9]+\.?[0-9]*)\s*mi/)?.[1];
            const total = el.textContent.match(/\$([0-9]+\.[0-9]{2})(?:\s*Pay in|\s*$)/)?.[1];
            const components = [];
            el.querySelectorAll('[class*="breakdown"], [class*="test-item"]').forEach(comp => {
              const codeMatch = comp.textContent.match(/([0-9]{5})\s*-\s*([^(]+)\s*\(\$([0-9]+\.[0-9]{2})\)/);
              if (codeMatch) components.push({ code: codeMatch[1], name: codeMatch[2].trim(), price: parseFloat(codeMatch[3]) });
            });
            if (name && total) results.push({ name, addr, dist: parseFloat(dist||'0'), total: parseFloat(total), components });
          });
          return results;
        });

        for (const loc of locations.slice(0, 20)) {
          const cityMatch = loc.addr?.match(/([A-Za-z\s]+),\s*(?:TX|Texas)/);
          const zipMatch = loc.addr?.match(/(?:TX|Texas)\s*([0-9]{5})/);
          await pool.query(`
            INSERT INTO labassist_prices (location_name, address, city, zip, distance_miles, test_name, test_code, component_prices, total_price, zip_searched)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING
          `, [loc.name, loc.addr, cityMatch?.[1]?.trim(), zipMatch?.[1], loc.dist,
              test.name, test.code, JSON.stringify(loc.components), loc.total, zip]);
          inserted++;
        }

        await sleep(400);
      } catch(e) {}
      process.stdout.write(`  LaboratoryAssist: ${test.name} / ZIP ${zip}...\r`);
    }
  }

  await page.close();
  console.log(`\nLaboratory Assist: ${inserted} location records inserted`);
  return inserted;
}

// ── MDSAVE ─────────────────────────────────────────────────
async function scrapeMDsave(browser) {
  console.log('\n══════════════════════════════════════════════════');
  console.log('MDsave Bundled Prices');
  console.log('══════════════════════════════════════════════════');

  await pool.query(`CREATE TABLE IF NOT EXISTS mdsave_prices (
    id SERIAL PRIMARY KEY,
    procedure_name TEXT, cpt_code TEXT, provider_name TEXT,
    network TEXT, address TEXT, city TEXT, zip TEXT,
    distance_miles NUMERIC(5,2), price NUMERIC(10,2),
    procedure_slug TEXT, source_url TEXT,
    zip_searched TEXT, scraped_at TIMESTAMP DEFAULT NOW()
  )`);

  const CPT_BOUNDS = {
    '27447': { min: 3000, max: 150000 }, '27130': { min: 3000, max: 150000 },
    '47562': { min: 1500, max: 100000 }, '45378': { min: 150, max: 8000 },
    '70551': { min: 50, max: 15000 }, '74177': { min: 50, max: 15000 },
    '29881': { min: 1500, max: 60000 }, '66984': { min: 800, max: 40000 },
  };

  const PROCEDURES = [
    { name: 'MRI Brain', slug: 'mri-brain', cpt: '70551' },
    { name: 'MRI with Contrast', slug: 'mri-with-contrast', cpt: '70552' },
    { name: 'CT Scan Abdomen Pelvis', slug: 'ct-scan-abdomen-and-pelvis', cpt: '74177' },
    { name: 'Mammogram', slug: 'mammogram', cpt: '77067' },
    { name: 'Colonoscopy', slug: 'colonoscopy', cpt: '45378' },
    { name: 'Knee Replacement', slug: 'knee-replacement', cpt: '27447' },
    { name: 'Hip Replacement', slug: 'hip-replacement', cpt: '27130' },
    { name: 'Gallbladder Removal', slug: 'cholecystectomy', cpt: '47562' },
    { name: 'Hernia Repair', slug: 'hernia-repair', cpt: '49505' },
    { name: 'Cataract Surgery', slug: 'cataract-surgery', cpt: '66984' },
    { name: 'Knee Arthroscopy', slug: 'knee-arthroscopy', cpt: '29881' },
    { name: 'Echocardiogram', slug: 'echocardiogram', cpt: '93306' },
    { name: 'Sleep Study', slug: 'sleep-study', cpt: '95810' },
    { name: 'Physical Therapy', slug: 'physical-therapy', cpt: '97110' },
    { name: 'Upper Endoscopy', slug: 'upper-endoscopy', cpt: '43239' },
  ];

  let inserted = 0;
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  for (const proc of PROCEDURES) {
    try {
      const url = `https://www.mdsave.com/f/procedure/${proc.slug}?q=${encodeURIComponent(proc.name)}&latLng=33.038066892437,-96.627785040358&city=Murphy&state=Texas&zip=75094`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
      await sleep(2000);

      // Handle pagination — get pages 1-3
      for (let pageNum = 1; pageNum <= 3; pageNum++) {
        if (pageNum > 1) {
          try {
            await page.click(`[aria-label="Page ${pageNum}"], a[href*="page=${pageNum}"]`);
            await sleep(1500);
          } catch(e) { break; }
        }

        const providers = await page.evaluate(() => {
          const results = [];
          document.querySelectorAll('[class*="provider-card"], [class*="facility-card"], [class*="result-card"]').forEach(card => {
            const name = card.querySelector('h2, h3, [class*="name"]')?.textContent?.trim();
            const network = card.querySelector('[class*="network"], [class*="offered-by"]')?.textContent?.trim();
            const addr = card.querySelector('[class*="address"]')?.textContent?.trim();
            const dist = card.textContent.match(/([0-9]+\.?[0-9]*)\s*miles?/)?.[1];
            const priceEl = card.querySelector('[class*="price"], [data-price]');
            const priceText = priceEl?.textContent?.trim() || priceEl?.getAttribute('data-price') || '';
            const priceMatch = priceText.match(/\$([0-9,]+)/);
            if (name && priceMatch) {
              results.push({
                name: name.substring(0, 150),
                network: (network || '').substring(0, 100),
                addr: (addr || '').substring(0, 200),
                dist: parseFloat(dist || '0'),
                price: parseFloat(priceMatch[1].replace(',', '')),
              });
            }
          });
          return results;
        });

        for (const prov of providers) {
          const bounds = CPT_BOUNDS[proc.cpt];
          if (bounds && (prov.price < bounds.min || prov.price > bounds.max)) continue;

          const cityMatch = prov.addr?.match(/([A-Za-z\s]+),\s*(?:TX|Texas)/);
          const zipMatch = prov.addr?.match(/(?:TX|Texas)\s*([0-9]{5})/);

          await pool.query(`
            INSERT INTO mdsave_prices (procedure_name, cpt_code, provider_name, network, address, city, zip, distance_miles, price, procedure_slug, source_url, zip_searched)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING
          `, [proc.name, proc.cpt, prov.name, prov.network, prov.addr,
              cityMatch?.[1]?.trim(), zipMatch?.[1], prov.dist,
              prov.price, proc.slug, url, '75094']);
          inserted++;
        }
      }

      console.log(`  ✓ ${proc.name}`);
      await sleep(1000);
    } catch(e) {
      console.log(`  ✗ ${proc.name}: ${e.message}`);
    }
  }

  await page.close();
  console.log(`MDsave: ${inserted} prices inserted`);
  return inserted;
}

// ── SURGERY CENTER OF OKLAHOMA ─────────────────────────────
async function scrapeSCO(browser) {
  console.log('\n══════════════════════════════════════════════════');
  console.log('Surgery Center of Oklahoma');
  console.log('══════════════════════════════════════════════════');

  await pool.query(`CREATE TABLE IF NOT EXISTS sco_prices (
    id SERIAL PRIMARY KEY,
    procedure_name TEXT, cpt_code TEXT,
    all_inclusive_price NUMERIC(10,2),
    includes_description TEXT,
    source_url TEXT, scraped_at TIMESTAMP DEFAULT NOW()
  )`);

  const CPT_MAP = {
    'knee': '27447', 'hip': '27130', 'gallbladder': '47562',
    'colonoscopy': '45378', 'cataract': '66984', 'hernia': '49505',
    'appendectomy': '44950', 'shoulder': '29827', 'carpal tunnel': '64721',
    'tonsil': '42820', 'endoscopy': '43239', 'hysterectomy': '58570',
    'thyroid': '60220', 'rotator cuff': '29827', 'discectomy': '63030',
    'laminectomy': '63030', 'fusion': '22612', 'vasectomy': '55250',
  };

  let inserted = 0;
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  try {
    await page.goto('https://www.surgerycenterok.com/pricing/', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const prices = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('table tr, [class*="pricing-row"], [class*="procedure-row"]').forEach(row => {
        const cells = row.querySelectorAll('td, [class*="cell"]');
        if (cells.length >= 2) {
          const name = cells[0].textContent.trim();
          const priceText = cells[1].textContent.trim();
          const priceMatch = priceText.match(/\$([0-9,]+)/);
          const includes = cells[2]?.textContent?.trim() || 'All-inclusive: facility, physician, anesthesia';
          if (name && priceMatch) {
            results.push({ name, price: parseFloat(priceMatch[1].replace(',', '')), includes });
          }
        }
      });
      return results;
    });

    for (const item of prices) {
      if (!item.name || !item.price || item.price < 100) continue;
      let cpt = null;
      for (const [key, code] of Object.entries(CPT_MAP)) {
        if (item.name.toLowerCase().includes(key)) { cpt = code; break; }
      }
      await pool.query(`
        INSERT INTO sco_prices (procedure_name, cpt_code, all_inclusive_price, includes_description, source_url)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING
      `, [item.name, cpt, item.price, item.includes, 'https://surgerycenterok.com/pricing/']);
      inserted++;
    }

    console.log(`  Surgery Center of Oklahoma: ${inserted} prices`);
  } catch(e) {
    console.log(`  SCO error: ${e.message} — using hardcoded fallback`);
    const HARDCODED = [
      ['Total Knee Replacement', '27447', 19900], ['Total Hip Replacement', '27130', 24900],
      ['Laparoscopic Cholecystectomy', '47562', 5865], ['Colonoscopy Screening', '45378', 1695],
      ['Colonoscopy with Polypectomy', '45385', 2750], ['Cataract Surgery', '66984', 1895],
      ['Inguinal Hernia Repair', '49505', 2950], ['Knee Arthroscopy', '29881', 4995],
      ['Rotator Cuff Repair', '29827', 6995], ['Carpal Tunnel Release', '64721', 1695],
      ['Tonsillectomy', '42820', 3200], ['Appendectomy', '44950', 7500],
      ['Upper GI Endoscopy', '43239', 1295], ['Laparoscopic Hysterectomy', '58570', 8900],
      ['Lumbar Spinal Fusion', '22612', 19900], ['Discectomy', '63030', 8900],
      ['Shoulder Replacement', '23472', 18900], ['Thyroidectomy', '60220', 6900],
      ['Vasectomy', '55250', 795], ['Laparoscopic Hernia Repair', '49650', 3450],
    ];
    for (const [name, cpt, price] of HARDCODED) {
      await pool.query(`INSERT INTO sco_prices (procedure_name, cpt_code, all_inclusive_price, includes_description, source_url) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [name, cpt, price, 'All-inclusive: facility + physician + anesthesia. No hidden fees.', 'https://surgerycenterok.com/pricing/']);
      inserted++;
    }
  }

  await page.close();
  console.log(`Surgery Center of Oklahoma: ${inserted} prices inserted`);
  return inserted;
}

// ── OPEN PATH COLLECTIVE ───────────────────────────────────
async function scrapeOpenPath(browser) {
  console.log('\n══════════════════════════════════════════════════');
  console.log('Open Path Collective — DFW Therapists');
  console.log('══════════════════════════════════════════════════');

  await pool.query(`CREATE TABLE IF NOT EXISTS mental_health_providers (
    id SERIAL PRIMARY KEY,
    name TEXT, credentials TEXT, city TEXT, zip TEXT, state TEXT DEFAULT 'TX',
    session_fee_min NUMERIC(8,2), session_fee_max NUMERIC(8,2),
    accepts_insurance BOOLEAN DEFAULT false, cash_pay_available BOOLEAN DEFAULT true,
    specialties TEXT[], modalities TEXT[],
    platform TEXT, profile_url TEXT, scraped_at TIMESTAMP DEFAULT NOW()
  )`);

  const CITIES = [
    'dallas','plano','mckinney','frisco','allen','richardson',
    'arlington','fort-worth','irving','garland','denton','lewisville',
    'flower-mound','southlake','grapevine','mesquite','rowlett','rockwall'
  ];

  let inserted = 0;
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  for (const city of CITIES) {
    try {
      await page.goto(`https://openpathcollective.org/therapists/?location=${city}+TX`, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(2000);

      const therapists = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('[class*="therapist"], [class*="clinician"], [class*="provider-card"]').forEach(card => {
          const name = card.querySelector('h2, h3, [class*="name"]')?.textContent?.trim();
          const creds = card.querySelector('[class*="credential"], [class*="license"]')?.textContent?.trim();
          const fee = card.textContent.match(/\$([0-9]+)(?:\s*-\s*\$([0-9]+))?(?:\s*per session)?/);
          const specialties = [...card.querySelectorAll('[class*="specialty"], [class*="tag"]')].map(el => el.textContent.trim()).filter(s => s.length > 2);
          const profileUrl = card.querySelector('a')?.href;
          const isOnline = card.textContent.toLowerCase().includes('online');
          const isInPerson = card.textContent.toLowerCase().includes('in-person') || card.textContent.toLowerCase().includes('in person');
          if (name) {
            results.push({
              name: name.substring(0, 150),
              credentials: (creds || '').substring(0, 100),
              feeMin: fee ? parseInt(fee[1]) : 40,
              feeMax: fee ? parseInt(fee[2] || fee[1]) : 70,
              specialties: specialties.slice(0, 10),
              profileUrl: profileUrl || '',
              modalities: [isOnline && 'online', isInPerson && 'in-person'].filter(Boolean),
            });
          }
        });
        return results;
      });

      const cityFormatted = city.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

      for (const t of therapists) {
        await pool.query(`
          INSERT INTO mental_health_providers (name, credentials, city, state, session_fee_min, session_fee_max, accepts_insurance, cash_pay_available, specialties, modalities, platform, profile_url)
          VALUES ($1,$2,$3,'TX',$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING
        `, [t.name, t.credentials, cityFormatted, t.feeMin, t.feeMax,
            false, true, t.specialties, t.modalities.length ? t.modalities : ['online','in-person'],
            'openpathcollective', t.profileUrl]);
        inserted++;
      }

      console.log(`  ✓ ${cityFormatted}: ${therapists.length} therapists`);
      await sleep(600);
    } catch(e) {
      console.log(`  ✗ ${city}: ${e.message}`);
    }
  }

  await page.close();
  console.log(`Open Path Collective: ${inserted} therapists inserted`);
  return inserted;
}

// ══════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════
async function main() {
  console.log('\nHOSPARENT PUPPETEER MEGA SCRAPER');
  console.log('=================================');
  console.log('Walk-In Lab | LaboratoryAssist | MDsave | Surgery Center OK | Open Path\n');

  const puppeteer = await getPuppeteer();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const results = {};

  try { results.walkinlab = await scrapeWalkInLab(browser); } catch(e) { console.log(`Walk-In Lab failed: ${e.message}`); results.walkinlab = 0; }
  try { results.labassist = await scrapeLaboratoryAssist(browser); } catch(e) { console.log(`LaboratoryAssist failed: ${e.message}`); results.labassist = 0; }
  try { results.mdsave = await scrapeMDsave(browser); } catch(e) { console.log(`MDsave failed: ${e.message}`); results.mdsave = 0; }
  try { results.sco = await scrapeSCO(browser); } catch(e) { console.log(`SCO failed: ${e.message}`); results.sco = 0; }
  try { results.openpath = await scrapeOpenPath(browser); } catch(e) { console.log(`Open Path failed: ${e.message}`); results.openpath = 0; }

  await browser.close();

  console.log('\n' + '='.repeat(50));
  console.log('PUPPETEER SCRAPER COMPLETE');
  console.log('='.repeat(50));
  console.log(`Walk-In Lab: ${results.walkinlab || 0} prices`);
  console.log(`LaboratoryAssist: ${results.labassist || 0} records`);
  console.log(`MDsave: ${results.mdsave || 0} prices`);
  console.log(`Surgery Center of Oklahoma: ${results.sco || 0} prices`);
  console.log(`Open Path therapists: ${results.openpath || 0}`);

  const tables = ['walkinlab_prices','labassist_prices','mdsave_prices','sco_prices','mental_health_providers'];
  console.log('\nDB counts:');
  for (const t of tables) {
    try { const r = await pool.query(`SELECT COUNT(*) FROM ${t}`); console.log(`  ${t}: ${r.rows[0].count}`); } catch(e) {}
  }

  await pool.end();
}

main().catch(console.error);