require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const AdmZip = require('adm-zip');

async function main() {
  const url = 'https://www.methodisthealthsystem.org/sites/default/files/Price%20Transparency/750800661_MethodistCharltonMedicalCenter_standardcharges.zip';
  
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  fs.writeFileSync('tmp_check.zip', Buffer.from(res.data));
  
  const zip = new AdmZip('tmp_check.zip');
  const entry = zip.getEntries()[0];
  const content = entry.getData().toString('utf8');
  
  // Show first 3 rows
  const lines = content.split('\n').slice(0, 3);
  lines.forEach((line, i) => console.log(`Row ${i}:`, line.substring(0, 500)));
  
  fs.unlinkSync('tmp_check.zip');
}

main().catch(console.error);