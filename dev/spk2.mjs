import puppeteer from '/Users/stark/code/long_drive/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 810 });
await p.goto(`http://localhost:5173/?auto=1&place=${process.argv[2]||"manhattan"}&weather=clear&stop=2`, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 7000));
await p.evaluate(() => { const L = window.__ld; if (!location.search.includes("nowarm")) { const t0=performance.now(); L.life.warmup(L.renderer, L.camera); L.traffic.warmup(L.renderer, L.camera); console.log("warm", performance.now()-t0);} window.__sp = { life: [], traffic: [] };
  for (const k of ['life', 'traffic']) { const o = L[k], f = o.update.bind(o); o.update = (dt, c) => { const t = performance.now(); f(dt, c); const d = performance.now() - t; if (d > 2) window.__sp[k].push(+d.toFixed(1)); }; }
  window.__r = []; const R = L.renderer, rf = R.render.bind(R); R.render = (s, c) => { const t = performance.now(); rf(s, c); const d = performance.now() - t; if (d > 12) window.__r.push(+d.toFixed(0)); }; });
await new Promise((r) => setTimeout(r, 35000));
console.log(JSON.stringify(await p.evaluate(() => ({ sp: window.__sp, renderSpikes: window.__r.length, r: window.__r.slice(0, 40), progs: window.__ld.renderer.info.programs.length }))));
b.close().catch(() => {}); setTimeout(() => process.exit(0), 500);
