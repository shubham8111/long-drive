// Interleave check: with ?tripfast=N a tunnel is due every N metres. Reports each arrival (place, point, way)
// and, with interleave off, that no tunnel comes. usage: node dev/tunnel-trip-test.mjs [place] [on|off] [arrivals=2]
import puppeteer from 'puppeteer-core';
const place = process.argv[2] || 'monaco', mode = process.argv[3] || 'on', want = +(process.argv[4] || 2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 });
const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
await p.goto(`http://localhost:5173/?auto=1&wxlock=1&hours=12&weather=clear&place=${place}&tripfast=600`, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 90000) { const s = await p.evaluate(() => window.__status).catch(() => null); if (s?.settled && s.busy < 2) break; await new Promise((r) => setTimeout(r, 300)); }
const at = () => p.evaluate(() => { const L = window.__ld; return { place: L.world.data.id, s: Math.round(L.st.s), dir: L.st.dir, len: Math.round(L.route.length), loop: !!L.route.loop, phase: L.trip.phase, dist: Math.round(L.trip.dist) }; });
await p.evaluate((on) => { window.__ld.set.interleave = on; }, mode === 'on');
console.log('start', JSON.stringify(await at()));
let last = await at(), arrivals = 0;
const tEnd = Date.now() + (mode === 'on' ? 300000 : 120000);
while (Date.now() < tEnd && arrivals < want) {
  await new Promise((r) => setTimeout(r, 1000));
  const now = await at();
  if (now.phase !== last.phase) console.log(`  ${last.phase} -> ${now.phase} (driven ${now.dist} m)`);
  if (now.place !== last.place) { arrivals++; console.log('arrived', JSON.stringify(now)); }
  if (last.phase === 'exit' && now.phase === 'drive') { await new Promise((r) => setTimeout(r, 4000)); const a = await at(); console.log(`  4 s on the road: s ${now.s} -> ${a.s} (dir ${a.dir}), ${a.place}`); }
  last = now;
}
if (mode === 'off') console.log('after 2 min, interleave off:', JSON.stringify(last));
console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no page errors');
b.close().catch(() => {}); setTimeout(() => process.exit(0), 500);
