// usage: node dev/roads-test.mjs <out.png> "<url-path>" [waitMs] [noroads]
// Loads the game, wires CityRoads exactly as main.js will, screenshots, prints stats.
import puppeteer from 'puppeteer-core';
const [out, path, wait = '30000', mode = ''] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 810 });
const logs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('ROADS')) logs.push(m.type() + ': ' + m.text().slice(0, 400)); });
p.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 400)));
await p.goto('http://localhost:5173' + path, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < +wait) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await p.evaluate(() => window.__status || null);
  if (s && s.settled && s.busy === 0) break;
}
if (process.env.FREEZE) await p.evaluate(() => { const l = window.__ld; l.st.target = 0; l.st.speed = 0; });
if (mode !== 'noroads') {
  await p.evaluate(async () => {
    const { CityRoads } = await import('/src/roads.js');
    const { Geo } = await import('/src/geo.js');
    const L = window.__ld;
    const geo = new Geo(L.route.data.origin.lat, L.route.data.origin.lon);
    const r = new CityRoads(L.scene, geo, L.route.data, L.route, L.sky.shared, L.renderer);
    window.__roads = r;
    let last = performance.now();
    const tick = () => { const n = performance.now(); r.update((n - last) / 1000, L.camera.position.x, L.camera.position.z); last = n; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await new Promise((r) => setTimeout(r, 6000));
}
await new Promise((r) => setTimeout(r, 1500));
console.log(JSON.stringify(await p.evaluate(() => window.__status || null)));
console.log(JSON.stringify(await p.evaluate(() => { const r = window.__roads; return r ? { count: r.count, cells: r.cells.size, tris: r.tris, drawCalls: r.drawCalls, lastBuildMs: r.lastBuildMs, maxBuildMs: r.maxBuildMs, inView: (() => { const L = window.__ld, cam = L.camera; cam.updateMatrixWorld(); const M = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).elements; let n = 0, t = 0; for (const m of r.cells.values()) { if (!m) continue; const bs = m.geometry.boundingSphere, cx = bs.center.x + m.position.x, cy = bs.center.y, cz = bs.center.z + m.position.z; const w = M[3] * cx + M[7] * cy + M[11] * cz + M[15], x = M[0] * cx + M[4] * cy + M[8] * cz + M[12], y = M[1] * cx + M[5] * cy + M[9] * cz + M[13]; const rr = bs.radius * 1.5; if (w + rr > 0 && Math.abs(x) < w + rr * 2 && Math.abs(y) < w + rr * 2) { n++; t += m.geometry.userData.tris; } } return { n, t }; })() } : null; })));
await p.screenshot({ path: out });
console.log([...new Set(logs)].slice(0, 12).join('\n'));
b.close().catch(() => {});
setTimeout(() => process.exit(0), 800);
