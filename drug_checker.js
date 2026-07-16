// Add these requires at the top with your other requires
const axios = require('axios');
const cheerio = require('cheerio');

// ===== DRUG PRICING FUNCTIONS =====
async function scrapeGoodRxPrice(drugName) {
  try {
    const url = `https://www.goodrx.com/search?q=${encodeURIComponent(drugName)}`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 15000,
    });
    const $ = cheerio.load(data);
    const priceText = $('[data-test="price-tag"]').first().text().trim() || $('.text-success').first().text().trim();
    if (priceText && priceText.includes('$')) {
      const price = parseFloat(priceText.replace(/[^\d.]/g, ''));
      return { source: 'GoodRx', price, url };
    }
    return null;
  } catch (err) {
    console.error(`GoodRx scrape failed for "${drugName}": ${err.message}`);
    return null;
  }
}

async function scrapeCostPlusDrugsPrice(drugName) {
  try {
    const url = `https://www.costplusdrugs.com/search?q=${encodeURIComponent(drugName)}`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 15000,
    });
    const $ = cheerio.load(data);
    const priceText = $('[data-price]').first().attr('data-price') || $('.price').first().text().trim();
    if (priceText && priceText.includes('$')) {
      const price = parseFloat(priceText.replace(/[^\d.]/g, ''));
      return { source: 'CostPlus', price, url };
    }
    return null;
  } catch (err) {
    console.error(`Cost Plus scrape failed for "${drugName}": ${err.message}`);
    return null;
  }
}

async function ensureDrugPricingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drug_pricing_research (
      id SERIAL PRIMARY KEY,
      code_type VARCHAR(20),
      drug_code VARCHAR(50) NOT NULL,
      drug_name TEXT,
      unit_price_goodrx DECIMAL(10, 2),
      unit_price_costplus DECIMAL(10, 2),
      goodrx_url TEXT,
      costplus_url TEXT,
      data_date TIMESTAMP DEFAULT NOW(),
      notes TEXT,
      UNIQUE (drug_code)
    );
  `);
}

// ===== ROUTES =====
// Endpoint to trigger drug pricing research
app.post('/api/research-drug-prices', async (req, res) => {
  try {
    await ensureDrugPricingTable();
    console.log('Starting drug pricing research...');

    const result = await pool.query(`
      SELECT DISTINCT billing_code, description FROM mrf_prices
      WHERE billing_code ~ '^[JQ][0-9]{4}$' LIMIT 100;
    `);

    if (result.rows.length === 0) {
      return res.json({ message: 'No J-codes found in MRF data.' });
    }

    let researched = 0;
    let withGoodRx = 0;
    let withCostPlus = 0;

    for (const row of result.rows) {
      const { billing_code: code, description: desc } = row;
      const drugName = desc ? desc.split(',')[0].trim() : '';
      if (!drugName) continue;

      const goodRx = await scrapeGoodRxPrice(drugName);
      const costPlus = await scrapeCostPlusDrugsPrice(drugName);

      if (goodRx) withGoodRx++;
      if (costPlus) withCostPlus++;

      try {
        await pool.query(
          `INSERT INTO drug_pricing_research (code_type, drug_code, drug_name, unit_price_goodrx, unit_price_costplus, goodrx_url, costplus_url, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (drug_code) DO UPDATE SET unit_price_goodrx = EXCLUDED.unit_price_goodrx, unit_price_costplus = EXCLUDED.unit_price_costplus, data_date = NOW()`,
          ['J-code', code, drugName, goodRx?.price || null, costPlus?.price || null, goodRx?.url || null, costPlus?.url || null, desc]
        );
        researched++;
      } catch (err) {
        console.error(`Error inserting ${code}: ${err.message}`);
      }
    }

    res.json({
      message: 'Drug pricing research complete',
      total_researched: researched,
      with_goodrx: withGoodRx,
      with_costplus: withCostPlus,
    });
  } catch (err) {
    console.error('Drug pricing research error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get drug pricing data
app.get('/api/drug-prices', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT drug_code, drug_name, unit_price_goodrx, unit_price_costplus, data_date
      FROM drug_pricing_research
      WHERE unit_price_goodrx IS NOT NULL OR unit_price_costplus IS NOT NULL
      ORDER BY data_date DESC LIMIT 100;
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});