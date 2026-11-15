// With ?look=..., reports the camera, and what a ray from the camera toward a lat/lon target hits first.
// usage: node dev/look-probe.mjs "<query with look=...>" targetLat targetLon targetHeightAboveGround
import puppeteer from 'puppeteer-core';
const [q, tla, tlo, th] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 });
await p.goto(`http://localhost:5173/?auto=1&wxlock=1&life=0&${q}`, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 60000) { const s = await p.evaluate(() => window.__status).catch(() => null); if (s?.settled && s.busy < 2) break; await new Promise((r) => setTimeout(r, 300)); }
await new Promise((r) => setTimeout(r, 2500));
console.log(await p.evaluate((tla, tlo, th) => {
  const L = window.__ld, T = L.THREE, cam = L.camera, geo = L.geo;
  const tx = geo.x(+tlo), tz = geo.z(+tla), ty = (L.terrain.heightAt(tx, tz) || 10) + +th;
  const dir = new T.Vector3(tx - cam.position.x, ty - cam.position.y, tz - cam.position.z), dist = dir.length(); dir.normalize();
  const rc = new T.Raycaster(cam.position.clone(), dir, 0.5, dist + 50); rc.camera = cam;
  const hits = rc.intersectObjects(L.scene.children, true).filter((h) => h.object.visible).slice(0, 6);
  const fwd = new T.Vector3(); cam.getWorldDirection(fwd);
  const out = [`camera (${cam.position.x.toFixed(1)}, ${cam.position.y.toFixed(1)}, ${cam.position.z.toFixed(1)}) facing (${fwd.x.toFixed(2)}, ${fwd.y.toFixed(2)}, ${fwd.z.toFixed(2)})`, `target (${tx.toFixed(1)}, ${ty.toFixed(1)}, ${tz.toFixed(1)}) at ${dist.toFixed(0)} m, dir (${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}, ${dir.z.toFixed(2)})`];
  for (const h of hits) { let n = h.object, path = []; while (n && path.length < 4) { path.push(n.name || n.type); n = n.parent; } out.push(`  hit at ${h.distance.toFixed(1)} m: ${path.join(' < ')} key=${h.object.material?.customProgramCacheKey?.() || ''} tris=${h.object.userData?.tris || ''}`); }
  return out.join('\n');
}, tla, tlo, th));
b.close().catch(() => {}); setTimeout(() => process.exit(0), 500);
