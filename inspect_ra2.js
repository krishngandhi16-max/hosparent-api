const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  await page.goto('https://radiologyassist.com/locations/');
  await page.waitForTimeout(3000);
  
  // Fill zip code
  await page.fill('#Input_Zipcode_Simple', '75071');
  await page.waitForTimeout(1000);
  
  // Select MRI from the study dropdown
  await page.click('.select2-search__field');
  await page.fill('.select2-search__field', 'MRI');
  await page.waitForTimeout(2000);
  
  // Take screenshot to see what happened
  await page.screenshot({ path: 'ra_search.png', fullPage: true });
  
  // Save HTML after search
  const html = await page.content();
  require('fs').writeFileSync('ra_search.html', html);
  
  console.log('Screenshot saved: ra_search.png');
  console.log('HTML saved: ra_search.html');
  
  // Look for results
  const resultsHtml = html.substring(html.indexOf('ra-display-search-form'), html.indexOf('ra-display-search-form') + 5000);
  console.log('\nFORM AREA:\n', resultsHtml.substring(0, 2000));
  
  await page.waitForTimeout(3000);
  await browser.close();
})();