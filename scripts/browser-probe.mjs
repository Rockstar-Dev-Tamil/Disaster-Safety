import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[PAGEERROR] ${e.message}\n${(e.stack||'').split('\n').slice(0,6).join('\n')}`));
page.on('requestfailed', r => logs.push(`[REQFAIL] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', r => { if (r.status() >= 400) logs.push(`[HTTP ${r.status()}] ${r.url()}`); });
const target = process.argv[2] || 'http://localhost:5180/';
await page.goto(target, { waitUntil: 'networkidle2', timeout: 90000 }).catch(e => logs.push('[GOTO] '+e.message));
await new Promise(r => setTimeout(r, process.argv[3] ? Number(process.argv[3]) : 4000));
const info = await page.evaluate(() => ({
  rootChildren: document.getElementById('root')?.children.length ?? -1,
  bodyBg: getComputedStyle(document.body).backgroundColor,
  text: (document.body.innerText || '').slice(0, 300),
}));
console.log('--- CONSOLE ---');
console.log(logs.join('\n') || '(none)');
console.log('--- DOM ---');
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: process.argv[4] || 'shot.png' });
await browser.close();
