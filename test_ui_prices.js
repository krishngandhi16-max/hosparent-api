const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:Lego1234@localhost:5432/hosparent"
});

const TEST_CPT_CODES = ['93000', '36415', '45378'];

async function verifyUiPrices() {
  console.log("?? Launching High-Performance API Data Cross-Examination...");

  for (let cpt of TEST_CPT_CODES) {
    console.log(`\n?? Auditing CPT Code: ${cpt}`);

    // --- Part A: Pull baseline truth directly from your cleaned database ---
    const dbQuery = `
      SELECT p.price, p.payer_name 
      FROM prices p
      JOIN procedures pr ON p.procedure_id = pr.id
      WHERE pr.cpt_code = $1 AND p.is_suspicious IS NOT TRUE
      ORDER BY p.price ASC LIMIT 1;
    `;
    const dbResult = await pool.query(dbQuery, [cpt]);
    
    if (dbResult.rows.length === 0) {
      console.log(`?? No active clean prices found in DB for CPT ${cpt}.`);
      continue;
    }

    const dbPrice = parseFloat(dbResult.rows[0].price);
    console.log(`?? DB Truth -> Lowest Clean Price: $${dbPrice}`);

    // --- Part B: Native Network Fetch Lookup ---
    try {
      const response = await fetch(`http://localhost:3001/search?q=${cpt}`);
      const data = await response.json();
      
      // Target your verified root array property wrapper: "value"
      const records = data.value || [];
      
      if (records.length === 0) {
        console.log(`? FAIL: API endpoint returned 0 rows natively for CPT ${cpt}`);
        continue;
      }

      // Read your exact custom pricing keys: cash_price or gross_price
      const priceArray = records
        .map(r => parseFloat(r.cash_price || r.gross_price || 0))
        .filter(p => p > 0)
        .sort((a, b) => a - b);

      if (priceArray.length === 0) {
        console.log(`? FAIL: All returned hospital records contain zero/null pricing text keys.`);
        continue;
      }

      const apiPrice = priceArray[0];
      const lowestHospital = records.find(r => parseFloat(r.cash_price || r.gross_price || 0) === apiPrice);
      console.log(`??? API Endpoint -> Serving Lowest Active Price: $${apiPrice} (${lowestHospital?.hospital_name || 'Unknown'})`);

      // --- Part C: Cross-examine match state ---
      // Check if your API controller has been patched to block the 895k suspicious rows we isolated
      if (Math.abs(dbPrice - apiPrice) < 0.05) {
        console.log(`? MATCH: Your Express API endpoint matches your sanitized database perfectly!`);
      } else {
        console.log(`?? DATA SYNC ERROR: API is serving $${apiPrice} but database expected $${dbPrice}!`);
        console.log(`?? Check: Ensure your server.js /search route explicitly filters out 'is_suspicious = true' items.`);
      }

    } catch (e) {
      console.log(`? FAIL: Direct connection to Express server failed: ${e.message}`);
    }
  }

  await pool.end();
  console.log("\n?? API Integrity Cycle Concluded.");
}

verifyUiPrices().catch(console.error);
