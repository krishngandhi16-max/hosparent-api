const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://radiologyassist.com/locations/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Log every button on the page
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, input[type="submit"], a.btn, .btn'))
      .map(b => ({
        tag: b.tagName,
        type: b.type || '',
        text: b.textContent.trim().substring(0, 50),
        className: b.className.substring(0, 80),
        id: b.id,
        html: b.outerHTML.substring(0, 150)
      }));
  });

  console.log('ALL BUTTONS/SUBMITS:');
  buttons.forEach((b, i) => console.log(i, JSON.stringify(b)));

  await browser.close();
})();