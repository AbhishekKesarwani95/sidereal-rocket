import puppeteer from 'puppeteer';
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('response', res => {
    if(!res.ok()) console.log('REQ FAIL: ' + res.status() + ' ' + res.url());
  });
  page.on('requestfailed', req => {
    console.log('REQ BLOCKED: ' + req.url() + ' - ' + req.failure().errorText);
  });
  page.on('pageerror', err => console.log('PAGE ERROR: ' + err.toString()));
  page.on('console', msg => console.log('CONSOLE:', msg.text()));
  await page.goto('http://localhost:5175', {waitUntil: 'networkidle0'});
  await browser.close();
})();
