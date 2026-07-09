const axios = require('axios');

async function findMRF() {
  try {
    console.log('Fetching BSW sitemap...');
    const res = await axios.get('https://www.bswhealth.com/sitemap.xml', { timeout: 15000 });
    const data = res.data;
    
    const lines = data.split('\n');
    const matches = lines.filter(line => 
      line.toLowerCase().includes('price') ||
      line.toLowerCase().includes('transparency') ||
      line.toLowerCase().includes('chargemaster') ||
      line.toLowerCase().includes('mrf') ||
      line.toLowerCase().includes('charges') ||
      line.toLowerCase().includes('cdm')
    );
    
    console.log('Matches found:');
    matches.forEach(m => console.log(m.trim()));
    
    if (matches.length === 0) {
      console.log('No direct matches - printing first 20 lines:');
      lines.slice(0, 20).forEach(l => console.log(l));
    }
  } catch (err) {
    console.log('Error:', err.message);
  }
}

findMRF();