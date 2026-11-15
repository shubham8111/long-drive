// In-page benchmark of the graphics modes: one browser session, frame rate uncapped, so each number is
// how long the GPU needs for a frame in that mode (lower is better). Same parked view for every mode.
// usage: node dev/modes.mjs [query] [mode ...]     e.g. node dev/modes.mjs "place=paris&hours=21" 480 720 1080
import puppeteer from 'puppeteer-core';
const q = process.argv[2] || '';
const modes = process.argv.slice(3); if (!modes.length) modes.push('480', '720', '1080');
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: +(process.env.W || 1512), height: +(process.env.H || 982), deviceScaleFactor: +(process.env.DPR || 2) });
await p.goto(`http://localhost:5173/?auto=1&stop=${process.env.STOP || 2}&nocap=1&${q}`, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 60000) { const s = await p.evaluate(() => window.__status).catch(() => null); if (s && s.settled && s.busy < 2) break; await new Promise((r) => setTimeout(r, 200)); }
await new Promise((r) => setTimeout(r, 4000));
await p.evaluate(() => { window.__ld.st.target = 0; window.__ld.set.timeFlows = false; });
await new Promise((r) => setTimeout(r, 4000));
const res = {};
for (let round = 0; round < 3; round++)
  for (const m of modes) {
    await p.evaluate((m) => { const l = window.__ld; l.set.graphics = m; l.ui.onChange('graphics', m); }, m);
    await new Promise((r) => setTimeout(r, 1200));
    const ms = await p.evaluate(() => new Promise((res) => { let n = 0; const t = performance.now(); const f = () => { if (++n < 150) requestAnimationFrame(f); else res((performance.now() - t) / n); }; requestAnimationFrame(f); }));
    (res[m] ||= []).push(ms);
  }
for (const m of modes) console.log(m.padEnd(10), res[m].map((x) => x.toFixed(2)).join('  '), ' min', Math.min(...res[m]).toFixed(2), 'ms');
console.log(JSON.stringify(await p.evaluate(() => ({ ...window.__status, post: window.__ld.post?.info }))));
b.close().catch(() => {}); setTimeout(() => process.exit(0), 500);
