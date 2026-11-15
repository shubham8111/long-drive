// What is on screen, by material kind: triangles and meshes. usage: node dev/stats.mjs '<url path>'
import puppeteer from 'puppeteer-core';
const path = process.argv[2];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 810 });
const logs = []; p.on('pageerror', (e) => logs.push(String(e).slice(0, 300)));
await p.goto('http://localhost:5173' + path, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) { await new Promise((r) => setTimeout(r, 800)); const s = await p.evaluate(() => window.__status || null); if (s && s.settled && s.busy === 0) break; }
await new Promise((r) => setTimeout(r, 2500));
console.log(JSON.stringify(await p.evaluate(() => {
  const l = window.__ld, by = {};
  l.scene.traverse((o) => { if (!o.isMesh || !o.visible) return; let v = o; while (v) { if (!v.visible) return; v = v.parent; }
    const g = o.geometry, tri = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    const k = (o.material?.customProgramCacheKey?.() || o.material?.type || '?').slice(0, 24); by[k] = by[k] || [0, 0]; by[k][0] += tri; by[k][1]++; });
  return { status: window.__status, post: l.post.info, assets: l.assets.stats(), by: Object.fromEntries(Object.entries(by).sort((a, b) => b[1][0] - a[1][0]).slice(0, 14).map(([k, v]) => [k, [Math.round(v[0] / 1000) + 'k', v[1]]])) };
})));
console.log(logs.join('\n'));
b.close(); setTimeout(() => process.exit(0), 500);
