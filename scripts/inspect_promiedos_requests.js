const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const urls = new Set();
  page.on('request', request => {
    const url = request.url();
    if (/api|graph|data|game|fixture|match|competition|league|season|schedule/i.test(url)) {
      urls.add(url);
    }
  });
  page.on('response', response => {
    const url = response.url();
    if (/api|json|graph|data|game|fixture|match|competition|league|season|schedule/i.test(url)) {
      urls.add(url);
    }
  });

  await page.goto('https://www.promiedos.com.ar/league/primera-nacional/ebj', { waitUntil: 'networkidle' });
  await page.waitForTimeout(8000);

  console.log('captured urls:', [...urls].slice(0, 120).join('\n'));
  console.log('count', urls.size);
  await browser.close();
})();
