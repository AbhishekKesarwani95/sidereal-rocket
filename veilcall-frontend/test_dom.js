import puppeteer from 'puppeteer';
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('CONSOLE:', msg.text()));
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle0' });
  const html = await page.evaluate(() => document.querySelector('#root').innerHTML);
  console.log('ROOT HTML LENGTH:', html.length);
  await browser.close();
})();
