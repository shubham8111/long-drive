// usage: node dev/shot.mjs <out.png> <url-path> [waitMs]
import puppeteer from 'puppeteer-core';
const [out, path, wait = '25000'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 810 });
const logs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
p.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 400)));
await p.goto((process.env.HOST || 'http://localhost:5173') + path, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < +wait) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await p.evaluate(() => window.__status || null);
  if (s && s.settled && s.busy === 0) break;
}
await new Promise((r) => setTimeout(r, 1500));
console.log(JSON.stringify(await p.evaluate(() => window.__status || null)), ((Date.now() - t0) / 1000).toFixed(1) + 's');
await p.screenshot({ path: out });
console.log([...new Set(logs)].slice(0, 12).join('\n'));
b.close().catch(() => {});
setTimeout(() => process.exit(0), 800);
