// CPU time per frame by stage (window.__prof), frame rate uncapped. usage: node dev/cpu.mjs "<query>"
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: 1512, height: 982, deviceScaleFactor: 2 });
await p.goto(`http://localhost:5173/?auto=1&stop=2&nocap=1&${process.argv[2] || ''}`, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 60000) { const s = await p.evaluate(() => window.__status).catch(() => null); if (s && s.settled && s.busy < 2) break; await new Promise((r) => setTimeout(r, 300)); }
await new Promise((r) => setTimeout(r, 5000));
await p.evaluate(() => { for (const k in window.__prof) window.__prof[k] = 0; window.__t = performance.now(); });
await new Promise((r) => setTimeout(r, 6000));
console.log(JSON.stringify(await p.evaluate(() => { const P = window.__prof, n = P.frames; const o = { frameMs: +((performance.now() - window.__t) / n).toFixed(2) }; for (const k in P) if (k !== 'frames' && k !== 'max') o[k] = +(P[k] / n).toFixed(2); o.calls = window.__status.calls; o.post = window.__ld.post.info; return o; })));
b.close(); setTimeout(() => process.exit(0), 500);
