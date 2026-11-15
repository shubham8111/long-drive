// Lists the active landmarks (ambient local surprises) and where their objects are, for the current place.
// usage: node dev/landmarks-check.mjs [place=manhattan] [stop=4]
import puppeteer from 'puppeteer-core';
const place = process.argv[2] || 'manhattan', stop = process.argv[3] || '4';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 });
const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 300))); p.on('console', (m) => { if (/error|failed|warn/i.test(m.text()) && !/404/.test(m.text())) errs.push(m.text().slice(0, 300)); });
await p.goto(`http://localhost:5173/?auto=1&place=${place}&stop=${stop}&hours=13&weather=clear&wxlock=1&life=0`, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 60000) { const s = await p.evaluate(() => window.__status).catch(() => null); if (s?.settled && s.busy < 2) break; await new Promise((r) => setTimeout(r, 300)); }
await new Promise((r) => setTimeout(r, 3000));
console.log(await p.evaluate(() => {
  const L = window.__ld, out = [];
  out.push('active: ' + L.surprises.active.map((a) => a.def.id).join(', '));
  const geo = { lat: (z) => z, };
  for (const g of L.world.group.children) if (g.isGroup || g.type === 'Group') { const bb = new (L.camera.position.constructor)(); g.getWorldPosition(bb); if (g.children.length) out.push(`group ${g.name || '?'} kids=${g.children.length} at (${bb.x.toFixed(0)}, ${bb.y.toFixed(0)}, ${bb.z.toFixed(0)})`); }
  const V = L.camera.position.constructor;
  for (const g of L.world.group.children) if (['times-square', 'washington-square'].includes(g.name) || (g.isGroup && !g.name)) g.traverse((o) => { if (o.isMesh || o.isPoints) { const v = new V(); o.getWorldPosition(v); o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox; out.push(`  ${g.name || '?'}/${o.type} at (${v.x.toFixed(0)}, ${v.y.toFixed(0)}, ${v.z.toFixed(0)}) size ${(bb.max.x - bb.min.x).toFixed(0)}x${(bb.max.y - bb.min.y).toFixed(0)}x${(bb.max.z - bb.min.z).toFixed(0)} visible=${o.visible}`); } });
  const g = window.__ld.surprises.active[0] && null;
  out.push(`car at (${L.camera.position.x.toFixed(0)}, ${L.camera.position.z.toFixed(0)})`);
  return out.join('\n');
}));
console.log(errs.slice(0, 10).join('\n') || 'no errors');
b.close().catch(() => {}); setTimeout(() => process.exit(0), 500);
