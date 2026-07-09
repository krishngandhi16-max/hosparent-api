require('dotenv').config();
const { chromium } = require('playwright');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Only need one zip per major DFW area since results show all nearby centers
// Using representative zips to cover all of DFW without redundancy
const DFW_ZIPS = [
  '75071', // McKinney
  '75093', // Plano
  '75013', // Allen
  '75034', // Frisco
  '75080', // Richardson
  '75201', // Dallas downtown
  '75230', // North Dallas
  '75243', // Garland area
  '75040', // Garland
  '75150', // Mesquite
  '75104', // Cedar Hill
  '75050', // Grand Prairie
  '75061', // Irving
  '75038', // Irving
  '76051', // Grapevine
  '76021', // Bedford
  '76053', // Hurst
  '76010', // Arlington
  '76014', // Arlington south
  '76063', // Mansfield
  '76104', // Fort Worth downtown
  '76132', // Fort Worth south
  '76137', // Fort Worth north
  '76244', // Keller
  '76092', // Southlake
  '76210', // Denton
  '75057', // Lewisville
  '75028', // Flower Mound
  '75088', // Rowlett
  '75189', // Wylie
];

const STUDIES = ['MRI', 'CT', 'Ultrasound', 'Xray', 'Mammogram', 'PET', 'DEXA'];

// Track inserted data to avoid duplicates
const seenCenters = {};
const seenPrices = new Set();
let totalInserted = 0;
let totalCenters = 0;
let totalSearches = 0;

async function getOrCreateCenter(name, city, distance) {
  const key = name;
  if (seenCenters[key]) return seenCenters[key];

  const existing = await pool.query(
    'SELECT id FROM imaging_centers WHERE name = $1 LIMIT 1',
    [name]
  );
  if (existing.rows.length > 0) {
    seenCenters[key] = existing.rows[0].id;
    return existing.rows[0].id;
  }

  // Extract city from name if possible (e.g. "Diagnostic Imaging Center - Dallas")
  const nameParts = name.split(' - ');
  const extractedCity = nameParts.length > 1 ? nameParts[nameParts.length - 1].trim() : (city || '');

  const result = await pool.query(
    `INSERT INTO imaging_centers (name, city, state, source, source_url, acr_accredited, same_day, hsa_fsa_accepted)
     VALUES ($1, $2, 'TX', 'RadiologyAssist', 'https://radiologyassist.com', true, true, true)
     RETURNING id`,
    [name, extractedCity]
  );
  seenCenters[key] = result.rows[0].id;
  totalCenters++;
  return result.rows[0].id;
}

async function insertPrice(centerId, scanType, procedureName, price) {
  const key = centerId + '|' + procedureName;
  if (seenPrices.has(key)) return false;
  seenPrices.add(key);

  await pool.query(
    `INSERT INTO imaging_prices (imaging_center_id, scan_type, procedure_name, price, price_label)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [centerId, scanType, procedureName, price, '$' + price]
  );
  totalInserted++;
  return true;
}

async function triggerSelect(page, selectIndex, value) {
  await page.evaluate(function(args) {
    var selects = document.querySelectorAll('select');
    var sel = selects[args.idx];
    if (!sel) return;
    sel.value = args.val;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery) window.jQuery(sel).trigger('change');
  }, { idx: selectIndex, val: value });
}

async function getOptions(page, selectIndex) {
  return await page.evaluate(function(idx) {
    var selects = document.querySelectorAll('select');
    var sel = selects[idx];
    if (!sel) return [];
    return Array.from(sel.options)
      .filter(function(o) { return o.value && o.value !== '0' && o.value !== ''; })
      .map(function(o) { return { value: o.value, text: o.textContent.trim() }; });
  }, selectIndex);
}

async function extractResults(page, study, bodyPart, protocol) {
  const results = await page.evaluate(function() {
    const centers = [];
    const text = document.body.innerText;

    // Split by "Diagnostic Imaging Center" or similar center names
    const lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

    let currentCenter = null;
    let currentDistance = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect center name lines (e.g. "Diagnostic Imaging Center - Dallas")
      if (line.match(/^(?:Diagnostic Imaging|Open MRI|Alliance Radiology|Southwest Diagnostic|North Texas|Medical Imaging|Star Imaging|Advanced Imaging)/i)) {
        currentCenter = line;
        currentDistance = null;
        continue;
      }

      // Detect distance
      const distMatch = line.match(/\(([0-9\.]+)\s*mi\)/);
      if (distMatch && currentCenter) {
        currentDistance = distMatch[1];
        continue;
      }

      // Detect price lines like "MRI - Brain - Without Contrast ($272.44)"
      const priceMatch = line.match(/(.+?)\s*\(\$([0-9,\.]+)\)/);
      if (priceMatch && currentCenter) {
        const procedureName = priceMatch[1].trim();
        const price = parseFloat(priceMatch[2].replace(',', ''));
        if (price > 20 && price < 5000 && procedureName.length > 2) {
          centers.push({
            name: currentCenter,
            distance: currentDistance,
            procedureName: procedureName,
            price: price
          });
        }
      }
    }

    return centers;
  });

  return results;
}

async function runSearch(page, zip, study, bodyPart, protocol) {
  try {
    // Select study
    await triggerSelect(page, 0, study.value);
    await page.waitForTimeout(500);

    // Wait for body parts
    await page.waitForFunction(function(idx) {
      var sel = document.querySelectorAll('select')[idx];
      return sel && sel.options.length > 1;
    }, 1, { timeout: 3000 }).catch(function() {});

    // Select body part
    await triggerSelect(page, 1, bodyPart.value);
    await page.waitForTimeout(500);

    // Wait for protocols
    await page.waitForFunction(function(idx) {
      var sel = document.querySelectorAll('select')[idx];
      return sel && sel.options.length > 1;
    }, 2, { timeout: 3000 }).catch(function() {});

    // Select protocol if provided
    if (protocol) {
      await triggerSelect(page, 2, protocol.value);
      await page.waitForTimeout(300);
    }

    // Click the confirmed search button
    await page.click('#Button_Search_Submit_Simple');
    totalSearches++;

    // Wait for results page
    await page.waitForURL('**/ra-search-results/**', { timeout: 8000 }).catch(function() {});
    await page.waitForTimeout(2000);

    // Extract results
    const results = await extractResults(page, study.text, bodyPart.text, protocol ? protocol.text : '');

    // Go back to search page
    await page.goto('https://radiologyassist.com/locations/', {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await page.waitForTimeout(1000);

    return results;

  } catch (e) {
    // Navigate back on error
    await page.goto('https://radiologyassist.com/locations/', {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    }).catch(function() {});
    await page.waitForTimeout(1000);
    return [];
  }
}

async function processZip(page, zip) {
  let zipTotal = 0;

  try {
    await page.goto('https://radiologyassist.com/locations/', {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });
    await page.waitForTimeout(1500);

    // Enter zip
    await page.fill('#Input_Zipcode_Simple', zip);
    await page.waitForTimeout(1200);

    // Click autocomplete
    const suggestion = await page.$('.ui-autocomplete .ui-menu-item');
    if (suggestion) {
      await suggestion.click();
    } else {
      await page.keyboard.press('Tab');
    }
    await page.waitForTimeout(500);

    // Get all study options
    const studies = await getOptions(page, 0);
    const filteredStudies = studies.filter(function(s) { return STUDIES.includes(s.value); });

    for (const study of filteredStudies) {
      // Select study to populate body parts
      await triggerSelect(page, 0, study.value);
      await page.waitForTimeout(800);

      const bodyParts = await getOptions(page, 1);
      if (bodyParts.length === 0) continue;

      for (const bodyPart of bodyParts) {
        // Select study + body part to get protocols
        await triggerSelect(page, 0, study.value);
        await page.waitForTimeout(300);
        await triggerSelect(page, 1, bodyPart.value);
        await page.waitForTimeout(600);

        const protocols = await getOptions(page, 2);

        if (protocols.length === 0) {
          // Search without protocol
          const results = await runSearch(page, zip, study, bodyPart, null);

          for (const r of results) {
            const centerId = await getOrCreateCenter(r.name, '', r.distance);
            const inserted = await insertPrice(centerId, study.text, r.procedureName, r.price);
            if (inserted) zipTotal++;
          }

          // Re-enter zip after navigation
          await page.fill('#Input_Zipcode_Simple', zip);
          await page.waitForTimeout(800);
          const sug = await page.$('.ui-autocomplete .ui-menu-item');
          if (sug) { await sug.click(); await page.waitForTimeout(400); }

        } else {
          for (const protocol of protocols) {
            const results = await runSearch(page, zip, study, bodyPart, protocol);

            for (const r of results) {
              const centerId = await getOrCreateCenter(r.name, '', r.distance);
              const inserted = await insertPrice(centerId, study.text, r.procedureName, r.price);
              if (inserted) zipTotal++;
            }

            // Re-enter zip after each search
            await page.fill('#Input_Zipcode_Simple', zip);
            await page.waitForTimeout(800);
            const sug2 = await page.$('.ui-autocomplete .ui-menu-item');
            if (sug2) { await sug2.click(); await page.waitForTimeout(400); }
          }
        }
      }
    }

  } catch (e) {
    console.log('Error on zip ' + zip + ': ' + e.message.substring(0, 80));
  }

  return zipTotal;
}

async function main() {
  console.log('Hosparent — RadiologyAssist FULL Scraper');
  console.log('=========================================');
  console.log('Zip codes: ' + DFW_ZIPS.length);
  console.log('Studies: ' + STUDIES.length);
  console.log('This will run overnight — estimated 6-10 hours');
  console.log('');

  const browser = await chromium.launch({
    headless: false, // Run headless overnight
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  });

  const page = await context.newPage();

  // Block images/fonts/css to speed up
  await page.route('**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,eot,css}', function(route) {
    route.abort();
  });

  let grandTotal = 0;

  for (let i = 0; i < DFW_ZIPS.length; i++) {
    const zip = DFW_ZIPS[i];
    const zipCount = await processZip(page, zip);
    grandTotal += zipCount;

    const centerCount = Object.keys(seenCenters).length;
    console.log('Zip ' + zip + ' (' + (i + 1) + '/' + DFW_ZIPS.length + '): ' + zipCount + ' new prices | Total centers: ' + centerCount + ' | Total prices: ' + totalInserted + ' | Searches done: ' + totalSearches);

    // Random delay between zips to avoid rate limiting
    await new Promise(function(r) { setTimeout(r, 2000 + Math.random() * 3000); });
  }

  await browser.close();

  // Final DB summary
  const centerCount = await pool.query("SELECT COUNT(*) FROM imaging_centers WHERE source = 'RadiologyAssist'");
  const priceCount = await pool.query('SELECT COUNT(*) FROM imaging_prices');

  console.log('\n============================');
  console.log('FULL SCRAPE COMPLETE');
  console.log('============================');
  console.log('Total searches run: ' + totalSearches);
  console.log('New centers created: ' + totalCenters);
  console.log('New prices inserted: ' + totalInserted);
  console.log('Total RA centers in DB: ' + centerCount.rows[0].count);
  console.log('Total imaging prices in DB: ' + priceCount.rows[0].count);
  console.log('============================');

  await pool.end();
}

main().catch(console.error);