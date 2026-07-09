const html = require('fs').readFileSync('ra_page.html', 'utf8');
console.log('File size:', html.length, 'chars');

// Find input fields
const inputs = html.match(/<input[^>]+>/gi) || [];
console.log('\nINPUT FIELDS:');
inputs.slice(0, 10).forEach(i => console.log(i));

// Find any price patterns
const prices = html.match(/\$[0-9]+[^<]{0,20}/g) || [];
console.log('\nPRICES FOUND:', prices.slice(0, 10));

// Find form elements
const forms = html.match(/<form[^>]+>/gi) || [];
console.log('\nFORMS:', forms);

// Find button elements
const buttons = html.match(/<button[^>]+>[^<]+<\/button>/gi) || [];
console.log('\nBUTTONS:');
buttons.slice(0, 10).forEach(b => console.log(b));

// Print first 3000 chars to see structure
console.log('\nFIRST 3000 CHARS:');
console.log(html.substring(0, 3000));