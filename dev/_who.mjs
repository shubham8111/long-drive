import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: 960, height: 540 });
await p.goto('http://localhost:5173' + process.argv[2]);
for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1000)); if (await p.evaluate(() => window.__status?.settled && window.__status.busy === 0).catch(() => false)) break; }
await new Promise((r) => setTimeout(r, 3000));
console.log(await p.evaluate(() => {
  const L = window.__ld, cam = L.camera, fr = new (L.camera.constructor.prototype.constructor === undefined ? Object : Object)();
  const out = {}; const seen = new Set();
  L.renderer.info.autoReset = true;
  // count drawn objects by owner: walk up to a named ancestor or the module class
  L.scene.traverseVisible((o) => {
    if (!(o.isMesh || o.isInstancedMesh || o.isPoints || o.isLine)) return;
    let a = o, path = [];
    while (a && path.length < 4) { path.push(a.name || a.type); a = a.parent; }
    const key = (o.material?.customProgramCacheKey?.().slice(0, 18) || '') + ' ' + (o.material?.name || o.material?.type || '?') + ' <' + path.slice(1, 3).join('<') + '>' + (o.layers.mask !== 1 ? ' L' + o.layers.mask : '');
    const t = o.geometry?.index ? o.geometry.index.count / 3 : (o.geometry?.attributes?.position?.count || 0) / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    out[key] = out[key] || [0, 0]; out[key][0]++; out[key][1] += Math.round(t * n);
  });
  return Object.entries(out).sort((a, b) => b[1][0] - a[1][0]).slice(0, 20).map(([k, v]) => `${String(v[0]).padStart(4)} ${String(v[1]).padStart(7)}  ${k}`).join('\n');
}));
await b.close();
