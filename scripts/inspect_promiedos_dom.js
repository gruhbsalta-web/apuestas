const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.promiedos.com.ar/league/primera-nacional/ebj', { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  const title = await page.title();
  console.log('title:', title);

  const anchors = await page.$$eval('a', els => els.map(el => ({
    href: el.href,
    text: el.textContent.replace(/\s+/g, ' ').trim(),
    cls: el.className,
    outer: el.outerHTML.slice(0,300)
  })));
  console.log('total anchors', anchors.length);
  anchors.filter(a => /game|partido|fixture|league|league|primera|nacional/i.test(a.href + ' ' + a.text)).slice(0,50).forEach((a, i) => {
    console.log('ANCHOR', i, a.href, JSON.stringify(a.text).slice(0,80), a.cls);
  });

  const divs = await page.$$eval('div', els => els.map(el => ({
    text: el.textContent.replace(/\s+/g, ' ').trim(),
    cls: el.className,
    outer: el.outerHTML.slice(0,300)
  })));
  console.log('total divs', divs.length);
  divs.filter(d => /\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(d.text)).slice(0,40).forEach((d, i) => {
    console.log('DIV', i, JSON.stringify(d.text).slice(0,200), d.cls);
  });

  const rows = await page.$$eval('div[class]', els => els.filter(el => /\d{1,2}:\d{2}/.test(el.textContent)).map(el => ({
    text: el.textContent.replace(/\s+/g, ' ').trim(),
    cls: el.className,
    outer: el.outerHTML.slice(0,300)
  })));
  console.log('time-div rows', rows.length);
  rows.slice(0,30).forEach((r, i) => console.log('ROW', i, JSON.stringify(r.text).slice(0,200), r.cls));

  await browser.close();
})();
