require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const KNOWN_CENTERS = [
  { name: 'Touchstone Imaging Allen', address: '1105 Central Expy N Ste 100, Allen, TX 75013', phone: '(972) 727-7246', city: 'Allen', zip: '75013', lat: 33.1034, lng: -96.6723, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Arlington', address: '811 W Randol Mill Rd, Arlington, TX 76012', phone: '(817) 275-7777', city: 'Arlington', zip: '76012', lat: 32.7312, lng: -97.1156, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Bedford', address: '2100 W Euless Blvd Ste 110, Bedford, TX 76021', phone: '(817) 571-4848', city: 'Bedford', zip: '76021', lat: 32.8445, lng: -97.1434, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Carrollton', address: '4343 N Josey Ln, Carrollton, TX 75010', phone: '(972) 939-7777', city: 'Carrollton', zip: '75010', lat: 32.9812, lng: -96.8934, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Dallas', address: '7777 Forest Ln Ste A-103, Dallas, TX 75230', phone: '(972) 566-7770', city: 'Dallas', zip: '75230', lat: 32.9198, lng: -96.7845, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Denton', address: '2801 S Interstate 35 E Ste 200, Denton, TX 76210', phone: '(940) 484-3300', city: 'Denton', zip: '76210', lat: 33.1623, lng: -97.1134, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Flower Mound', address: '3800 Stonecrest Blvd Ste 100, Flower Mound, TX 75022', phone: '(972) 221-2727', city: 'Flower Mound', zip: '75022', lat: 33.0145, lng: -97.0823, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Fort Worth', address: '6100 Harris Pkwy Ste 200, Fort Worth, TX 76132', phone: '(817) 346-7777', city: 'Fort Worth', zip: '76132', lat: 32.6634, lng: -97.3923, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Frisco', address: '5757 Warren Pkwy Ste 180, Frisco, TX 75034', phone: '(972) 335-1111', city: 'Frisco', zip: '75034', lat: 33.1523, lng: -96.8234, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Garland', address: '3301 W Walnut St Ste 100, Garland, TX 75042', phone: '(972) 272-7700', city: 'Garland', zip: '75042', lat: 32.9134, lng: -96.6812, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Grand Prairie', address: '2780 W Pioneer Pkwy Ste 118, Grand Prairie, TX 75051', phone: '(972) 264-7777', city: 'Grand Prairie', zip: '75051', lat: 32.7512, lng: -97.0134, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Grapevine', address: '1600 W College St Ste 100, Grapevine, TX 76051', phone: '(817) 421-7777', city: 'Grapevine', zip: '76051', lat: 32.9312, lng: -97.0834, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Irving', address: '1901 N MacArthur Blvd Ste 100, Irving, TX 75061', phone: '(972) 252-3350', city: 'Irving', zip: '75061', lat: 32.8523, lng: -96.9934, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Lewisville', address: '755 W Main St Ste 100, Lewisville, TX 75057', phone: '(972) 436-6767', city: 'Lewisville', zip: '75057', lat: 33.0412, lng: -96.9923, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging McKinney', address: '4500 Medical Center Dr Ste 200, McKinney, TX 75069', phone: '(972) 542-7777', city: 'McKinney', zip: '75069', lat: 33.1823, lng: -96.6845, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Mesquite', address: '3700 I-30 Ste 115, Mesquite, TX 75150', phone: '(972) 686-7777', city: 'Mesquite', zip: '75150', lat: 32.7934, lng: -96.5923, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Plano', address: '6200 W Parker Rd Ste 278, Plano, TX 75093', phone: '(972) 599-7777', city: 'Plano', zip: '75093', lat: 33.0434, lng: -96.8312, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Richardson', address: '2301 N Central Expy Ste 150, Richardson, TX 75080', phone: '(972) 234-6363', city: 'Richardson', zip: '75080', lat: 32.9823, lng: -96.7134, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Rockwall', address: '985 Ralph Hall Pkwy Ste 106, Rockwall, TX 75032', phone: '(972) 722-7777', city: 'Rockwall', zip: '75032', lat: 32.9312, lng: -96.4534, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Touchstone Imaging Rowlett', address: '8501 Lakeview Pkwy Ste 100, Rowlett, TX 75088', phone: '(972) 475-7777', city: 'Rowlett', zip: '75088', lat: 32.9045, lng: -96.5623, network: 'Touchstone', acr: true, insurance: true, note: 'Call for self-pay pricing — ACR accredited' },
  { name: 'Southwest Diagnostic Imaging Dallas', address: '7777 Forest Ln Ste C-612, Dallas, TX 75230', phone: '(972) 566-5588', city: 'Dallas', zip: '75230', lat: 32.9189, lng: -96.7834, network: 'Southwest Diagnostic', acr: true, insurance: true, note: 'Call for self-pay pricing' },
  { name: 'Alliance Radiology Dallas', address: '3600 Junius St Ste 500, Dallas, TX 75246', phone: '(214) 820-2500', city: 'Dallas', zip: '75246', lat: 32.7845, lng: -96.7756, network: 'Alliance Radiology', acr: true, insurance: true, note: 'Call for self-pay pricing' },
];

const RA_PRICES = [
  { type: 'MRI', name: 'MRI Brain without Contrast', price: 272, cpt: '70551' },
  { type: 'MRI', name: 'MRI Brain with and without Contrast', price: 385, cpt: '70553' },
  { type: 'MRI', name: 'MRI Cervical Spine without Contrast', price: 285, cpt: '72141' },
  { type: 'MRI', name: 'MRI Lumbar Spine without Contrast', price: 285, cpt: '72148' },
  { type: 'MRI', name: 'MRI Knee without Contrast', price: 272, cpt: '73721' },
  { type: 'MRI', name: 'MRI Shoulder without Contrast', price: 272, cpt: '73221' },
  { type: 'MRI', name: 'MRI Hip without Contrast', price: 285, cpt: '73721' },
  { type: 'MRI', name: 'MRI Abdomen without Contrast', price: 350, cpt: '74183' },
  { type: 'MRI', name: 'MRI Pelvis without Contrast', price: 350, cpt: '72197' },
  { type: 'MRI', name: 'MRI Breast', price: 595, cpt: '77048' },
  { type: 'CT', name: 'CT Abdomen and Pelvis with Contrast', price: 199, cpt: '74177' },
  { type: 'CT', name: 'CT Abdomen and Pelvis without Contrast', price: 175, cpt: '74178' },
  { type: 'CT', name: 'CT Chest with Contrast', price: 175, cpt: '71260' },
  { type: 'CT', name: 'CT Head without Contrast', price: 149, cpt: '70450' },
  { type: 'CT', name: 'CT Neck without Contrast', price: 175, cpt: '70490' },
  { type: 'CT', name: 'CT Lumbar Spine', price: 175, cpt: '72131' },
  { type: 'Ultrasound', name: 'Ultrasound Abdomen Complete', price: 125, cpt: '76700' },
  { type: 'Ultrasound', name: 'Ultrasound Pelvis', price: 125, cpt: '76856' },
  { type: 'Ultrasound', name: 'Ultrasound Thyroid', price: 125, cpt: '76536' },
  { type: 'Mammogram', name: 'Mammogram Screening', price: 99, cpt: '77067' },
  { type: 'Mammogram', name: 'Mammogram Diagnostic', price: 149, cpt: '77065' },
  { type: 'X-Ray', name: 'X-Ray Chest 2 Views', price: 45, cpt: '71046' },
  { type: 'X-Ray', name: 'X-Ray Knee', price: 45, cpt: '73564' },
  { type: 'DEXA', name: 'DEXA Bone Density Scan', price: 95, cpt: '77080' },
];

async function main() {
  console.log('Hosparent Imaging Center Scraper');
  console.log('==================================');

  // Add columns
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS network TEXT`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7)`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7)`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS zip TEXT`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS full_address TEXT`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS self_pay_note TEXT`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS google_maps_url TEXT`);
  await pool.query(`ALTER TABLE imaging_centers ADD COLUMN IF NOT EXISTS accepts_insurance BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE imaging_prices ADD COLUMN IF NOT EXISTS cpt_code TEXT`);
  console.log('Columns ready.');

  // Insert known centers
  let inserted = 0;
  for (const c of KNOWN_CENTERS) {
    try {
      await pool.query(`
        INSERT INTO imaging_centers (name, city, state, address, phone, network, latitude, longitude, zip, full_address, self_pay_note, google_maps_url, accepts_insurance, acr_accredited)
        VALUES ($1,$2,'TX',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT DO NOTHING
      `, [c.name, c.city, c.address, c.phone, c.network, c.lat, c.lng, c.zip,
          c.address, c.note, `https://maps.google.com/?q=${encodeURIComponent(c.name + ' ' + c.city + ' TX')}`,
          c.insurance, c.acr]);
      inserted++;
      console.log(`  ✓ ${c.name}`);
    } catch(e) { console.log(`  ✗ ${c.name}: ${e.message}`); }
  }
  console.log(`Inserted ${inserted} imaging centers`);

  // Update RadiologyAssist prices with CPT codes and expanded list
  const ra = await pool.query(`SELECT id, name FROM imaging_centers WHERE name ILIKE '%radiology%assist%'`);
  let priceInserted = 0;
  for (const center of ra.rows) {
    for (const p of RA_PRICES) {
      try {
        await pool.query(`
          INSERT INTO imaging_prices (imaging_center_id, scan_type, procedure_name, price, cpt_code)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING
        `, [center.id, p.type, p.name, p.price, p.cpt]);
        priceInserted++;
      } catch(e) {}
    }
  }
  console.log(`Inserted ${priceInserted} RadiologyAssist prices`);

  // NPI registry lookup
  console.log('\nQuerying NPI registry for additional DFW imaging centers...');
  try {
    const url = 'https://npiregistry.cms.hhs.gov/api/?version=2.1&taxonomy_code=261QR0200X&state=TX&city=Dallas&limit=50&enumeration_type=NPI-2';
    const res = await axios.get(url, { timeout: 15000 });
    if (res.data?.results) {
      let npiInserted = 0;
      for (const p of res.data.results) {
        const addr = p.addresses?.[0];
        const name = p.basic?.organization_name;
        if (!name || !addr || /hospital|medical center/i.test(name)) continue;
        try {
          await pool.query(`
            INSERT INTO imaging_centers (name, city, state, address, phone, network, accepts_insurance, self_pay_note)
            VALUES ($1,$2,'TX',$3,$4,'Radiology',true,'Call for self-pay pricing') ON CONFLICT DO NOTHING
          `, [name, addr.city, `${addr.address_1}, ${addr.city}, TX ${addr.postal_code?.substring(0,5)}`,
              addr.telephone_number || '']);
          npiInserted++;
        } catch(e) {}
      }
      console.log(`Inserted ${npiInserted} centers from NPI registry`);
    }
  } catch(e) {
    console.log(`NPI API: ${e.message}`);
  }

  // Final stats
  const c = await pool.query('SELECT COUNT(*) FROM imaging_centers');
  const p = await pool.query('SELECT COUNT(*) FROM imaging_prices');
  console.log(`\nImaging centers: ${c.rows[0].count}`);
  console.log(`Imaging prices: ${p.rows[0].count}`);

  const top = await pool.query(`
    SELECT ic.name, ic.city, ic.network, ic.self_pay_note, COUNT(ip.id) as prices
    FROM imaging_centers ic LEFT JOIN imaging_prices ip ON ip.imaging_center_id=ic.id
    GROUP BY ic.id ORDER BY prices DESC, ic.name LIMIT 15
  `);
  console.log('\nTop centers:');
  for (const r of top.rows) {
    console.log(`  ${r.name} | ${r.city} | ${r.prices} prices | ${r.self_pay_note || ''}`);
  }

  await pool.end();
}

main().catch(console.error);