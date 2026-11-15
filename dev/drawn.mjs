// What is actually drawn (after culling), per material kind: draw calls and triangles, for one frame.
// usage: node dev/drawn.mjs '<query>'
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: 960, height: 540 });
await p.goto('http://localhost:5173/' + process.argv[2]);
for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1000)); if (await p.evaluate(() => window.__status?.settled && window.__status.busy === 0 && window.__ld?.ui?.started).catch(() => false)) break; }
await new Promise((r) => setTimeout(r, 4000));
console.log(await p.evaluate(() => new Promise((res) => {
  const R = window.__ld.renderer, orig = R.renderBufferDirect.bind(R), tally = {}, f0 = window.__prof.frames;
  R.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const key = (material.customProgramCacheKey?.() || material.type).replace(/\s+/g, ' ').slice(0, 28) + ' ' + (object.name || object.type).slice(0, 18) + ' <' + (object.parent?.name || object.parent?.type || '') + (object.parent?.parent ? '<' + (object.parent.parent.name || object.parent.parent.type) : '');
    const t = (geometry.index ? (group ? group.count : geometry.index.count) : geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : (geometry.instanceCount ?? 1) === Infinity ? 1 : (geometry.instanceCount || 1));
    (tally[key] ||= [0, 0]); tally[key][0]++; tally[key][1] += t;
    return orig(camera, scene, geometry, material, object, group);
  };
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
    R.renderBufferDirect = orig;
    const rows = Object.entries(tally).sort((a, b) => b[1][1] - a[1][1]);
    const tot = rows.reduce((a, [, v]) => [a[0] + v[0], a[1] + v[1]], [0, 0]), fr = Math.max(1, window.__prof.frames - f0);
    res(rows.map(([k, v]) => `${String(v[0]).padStart(4)} ${String(Math.round(v[1])).padStart(7)}  ${k}`).join('\n') + `\n  per frame (${fr} drawn): ${Math.round(tot[0] / fr)} draws, ${Math.round(tot[1] / fr)} tris`);
  })));
})));
await b.close();
