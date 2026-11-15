// usage: node dev/tunnel-shot.mjs <name> <query>   e.g. inside "view=inside"
import puppeteer from 'puppeteer-core';
const [name, query] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
const logs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 600)); });
p.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 600)));
await p.goto('http://localhost:5173/dev/tunnel.html?' + query, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 3500));
console.log(JSON.stringify(await p.evaluate(() => window.__info)));
await p.screenshot({ path: `/Users/stark/.claude/jobs/0027ad89/tmp/tunnel/${name}.png` });
console.log([...new Set(logs)].slice(0, 8).join('\n'));
await b.close().catch(() => {});
setTimeout(() => process.exit(0), 500);
