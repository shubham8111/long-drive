// In-page A/B: cycles through layer-hiding configs in one session and reports GPU-bound frame time for each.
// usage: node dev/ab.mjs "<query>" cfgA cfgB ...   (cfg = comma list of hidden layers, "-" = nothing hidden)
import puppeteer from 'puppeteer-core';
const q = process.argv[2] || 'graphics=low';
const cfgs = process.argv.slice(3); if (!cfgs.length) cfgs.push('-', 'trees', 'terrain', 'sky,clouds', 'road');
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: +(process.env.W || 1512), height: +(process.env.H || 982), deviceScaleFactor: +(process.env.DPR || 2) });
await p.goto(`http://localhost:5173/?auto=1&stop=${process.env.STOP || 2}&nocap=1&${q}`, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 60000) { const s = await p.evaluate(() => window.__status).catch(() => null); if (s && s.settled && s.busy < 2) break; await new Promise((r) => setTimeout(r, 200)); }
await new Promise((r) => setTimeout(r, 4000));
await p.evaluate(() => { window.__ld.st.target = 0; window.__ld.set.timeFlows = false; }); // stand still: same view for every config
await new Promise((r) => setTimeout(r, 4000));
const res = {};
for (let round = 0; round < 3; round++)
  for (const c of cfgs) {
    await p.evaluate((c) => { const h = window.__ld.hide; h.length = 0; const sh = window.__ld.sky.shared; window.__def ||= Object.fromEntries(Object.entries(sh).map(([k, u]) => [k, u.value])); for (const k in window.__def) sh[k].value = window.__def[k];
      if (c !== '-') for (const tok of c.split(',')) { const [k, v] = tok.split('='); if (v !== undefined) sh[k].value = +v; else h.push(k); } window.__hideOn = true; }, c);
    await new Promise((r) => setTimeout(r, 700));
    const ms = await p.evaluate(() => new Promise((res) => { let n = 0; const t = performance.now(); const f = () => { if (++n < 150) requestAnimationFrame(f); else res((performance.now() - t) / n); }; requestAnimationFrame(f); }));
    (res[c] ||= []).push(ms);
  }
for (const c of cfgs) console.log(c.padEnd(28), res[c].map((x) => x.toFixed(2)).join('  '), ' min', Math.min(...res[c]).toFixed(2));
console.log(JSON.stringify(await p.evaluate(() => window.__status)));
b.close().catch(() => {}); setTimeout(() => process.exit(0), 500);
