require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const IMAGING_CPTS = ['70551','70552','70553','72141','72148','73721','73221','74177','74178','71260','70450','77067','76700','77080','93306','78815'];

async function main() {
  console.log('CMS Provider Utilization — DFW Imaging Centers');
  
  await pool.query(`CREATE TABLE IF NOT EXISTS cms_utilization (
    id SERIAL PRIMARY KEY,
    npi TEXT, provider_name TEXT, city TEXT, state TEXT, zip TEXT,
    hcpcs_code TEXT, hcpcs_description TEXT,
    service_count INTEGER,
    medicare_allowed_amount NUMERIC(10,2),
    medicare_payment_amount NUMERIC(10,2),
    year INTEGER DEFAULT 2022,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS cms_npi_idx ON cms_utilization(npi)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS cms_hcpcs_idx ON cms_utilization(hcpcs_code)`);

  let totalInserted = 0;

  for (const cpt of IMAGING_CPTS) {
    console.log(`\nFetching data for CPT ${cpt}...`);
    
    const url = `https://data.cms.gov/data-api/v1/dataset/9767cb68-8ea9-4f0b-8179-9668dea8fd6f/data?filter[HCPCS_Cd]=${cpt}&filter[Rndrng_Prvdr_State_Abrvtn]=TX&size=1000&offset=0`;

    try {
      const res = await axios.get(url, { timeout: 30000 });
      const results = res.data?.data || res.data?.results || res.data || [];
      
      if (!Array.isArray(results)) {
        console.log(`  Unexpected response format:`, JSON.stringify(res.data).substring(0, 200));
        continue;
      }
      
      console.log(`  Got ${results.length} TX providers for CPT ${cpt}`);

      for (const r of results) {
        const zip = (r.Rndrng_Prvdr_Zip5 || '').substring(0, 5);
        const dfw = ['750','751','752','753','754','760','761','762','763','764','765','766','767','768','769'];
        if (!dfw.some(p => zip.startsWith(p))) continue;

        const npi = r.Rndrng_NPI;
        const name = r.Rndrng_Prvdr_Last_Org_Name;
        const city = r.Rndrng_Prvdr_City || '';
        const state = r.Rndrng_Prvdr_State_Abrvtn || 'TX';
        const hcpcs = r.HCPCS_Cd;
        const desc = r.HCPCS_Desc || '';
        const svcCount = parseInt(r.Tot_Srvcs || 0);
        const allowed = parseFloat(r.Avg_Mdcr_Alowd_Amt || 0);
        const payment = parseFloat(r.Avg_Mdcr_Pymt_Amt || 0);

        if (!npi || !hcpcs) continue;

        try {
          await pool.query(`
            INSERT INTO cms_utilization (npi, provider_name, city, state, zip, hcpcs_code, hcpcs_description, service_count, medicare_allowed_amount, medicare_payment_amount)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING
          `, [npi, name, city, state, zip, hcpcs, desc, svcCount, allowed, payment]);
          totalInserted++;
        } catch(e) {}
      }

      await new Promise(r => setTimeout(r, 300));
    } catch(e) {
      console.log(`  ✗ ${e.message}`);
    }
  }

  console.log(`\nTotal inserted: ${totalInserted} utilization records`);

  const count = await pool.query('SELECT COUNT(*) FROM cms_utilization');
  console.log(`Total in cms_utilization table: ${count.rows[0].count}`);

  const top = await pool.query(`
    SELECT provider_name, city, zip, hcpcs_code, service_count, medicare_payment_amount
    FROM cms_utilization
    WHERE hcpcs_code = '70551'
    ORDER BY service_count DESC LIMIT 20
  `);

  if (top.rows.length > 0) {
    console.log('\nTop DFW MRI Brain providers by Medicare volume:');
    for (const r of top.rows) {
      console.log(`  ${r.provider_name} | ${r.city} ${r.zip} | ${r.service_count} cases | Medicare paid avg $${r.medicare_payment_amount}`);
    }
  } else {
    console.log('\nNo MRI Brain results yet — API may have returned 0 results');
  }

  await pool.end();
}

main().catch(console.error);