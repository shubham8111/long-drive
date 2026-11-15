// Mesh count (≈ draw calls) by owner. usage: node dev/calls.mjs "<query>"
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 810 });
await p.goto(`http://localhost:5173/?auto=1&stop=2&${process.argv[2] || ''}`, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 60000) { const s = await p.evaluate(() => window.__status).catch(() => null); if (s && s.settled && s.busy < 2) break; await new Promise((r) => setTimeout(r, 300)); }
await new Promise((r) => setTimeout(r, 3000));
console.log(JSON.stringify(await p.evaluate(() => {
  const l = window.__ld, out = {};
  const count = (root, name) => { let m = 0, all = 0; root.traverse((o) => { all++; if (o.isMesh || o.isPoints || o.isLine) { let v = o, vis = true; while (v) { if (!v.visible) vis = false; v = v.parent; } if (vis) m++; } }); out[name] = [m, all]; };
  count(l.rig.car.group, 'car'); count(l.rig.horse.root, 'horse'); count(l.world.group, 'world');
  for (const c of l.world.group.children) { const k = c.isInstancedMesh ? 'inst:' + (c.material.customProgramCacheKey?.() || '').slice(0, 14) : (c.material?.customProgramCacheKey?.() || c.type).slice(0, 18); out['w.' + k] = (out['w.' + k] || 0) + (c.visible ? 1 : 0); }
  count(l.scene, 'scene');
  return out;
})));
b.close(); setTimeout(() => process.exit(0), 500);
