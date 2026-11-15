// usage: node dev/life-test.mjs <name>   (scenarios below).  One headless Chrome, short runs.
// Drives Life/Traffic exactly as main.js will: from a requestAnimationFrame loop using window.__ld.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const name = process.argv[2] || 'smoke';
const OUT = '/Users/stark/.claude/jobs/0027ad89/tmp/life/';
fs.mkdirSync(OUT, { recursive: true });
const S = {
  smoke: { url: '/?place=bryce&stop=2&hours=16.5&auto=1', wait: 25000, run: 40000 },
};
const sc = JSON.parse(process.env.SC || 'null') || S[name] || S.smoke;
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 810 });
const logs = [];
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning' || t.startsWith('[T]')) logs.push(m.type() + ': ' + t.slice(0, 400)); });
p.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 600)));
await p.goto('http://localhost:5173' + sc.url, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < sc.wait) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await p.evaluate(() => (window.__ld ? window.__status : null) || null);
  if (s && s.settled && s.busy === 0) break;
}
// install the modules
const info = await p.evaluate(async (opts) => {
  const L = window.__ld;
  const mods = {};
  if (opts.life !== false) mods.life = await import('/src/life.js');
  if (opts.traffic !== false) { try { mods.traffic = await import('/src/traffic.js'); } catch (e) { console.error('traffic import failed ' + e); } }
  const data = L.route.data;
  const life = mods.life ? new mods.life.Life(L.scene, L.route, data, L.terrain, L.sky.shared) : null;
  const traffic = mods.traffic ? new mods.traffic.Traffic(L.scene, L.route, data, L.sky.shared) : null;
  window.__life = life; window.__traffic = traffic;
  const ctxBase = { weather: L.sky.w };
  const P = {};
  let last = performance.now();
  window.__frames = { n: 0, ms: 0, max: 0 };
  window.__free = false;
  window.__sim = 1;
  window.__sl = { sum: 0, n: 0 };
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const st = L.st;
    L.route.sample(st.s, P);
    const fx = P.tx * st.dir, fz = P.tz * st.dir;
    const pose = { x: P.x - fz * st.lat, y: P.y + 0.06, z: P.z + fx * st.lat, yaw: st.yaw, pitch: st.pitch, speed: st.speed };
    const ctx = { pose, s: st.s, dir: st.dir, lat: st.lat, camera: L.camera, night: L.sky.night, hours: st.hours, weather: L.sky.w, speed: st.speed, started: L.ui.started };
    window.__ctx = ctx;
    const t = performance.now();
    for (let k = 0; k < window.__sim; k++) { life?.update(dt, ctx); traffic?.update(dt, ctx); }
    const el = performance.now() - t;
    window.__sl.sum += el; window.__sl.n++;
    if (L.sky.envTexture && traffic && traffic._env !== L.sky.envTexture) { traffic._env = L.sky.envTexture; traffic.setEnvMap(L.sky.envTexture); }
    if (window.__free) { /* free camera is set by the test */ }
  }
  requestAnimationFrame(loop);
  window.__freeze = () => { L.rig.applyCamera = () => {}; L.st.target = 0; L.st.speed = 0; };
  window.__focus = (obj, dist, az, h, lookH = 0.8) => { const q = obj.position || obj; L.camera.position.set(q.x + Math.sin(az) * dist, q.y + h, q.z + Math.cos(az) * dist); L.camera.lookAt(q.x, q.y + lookH, q.z); L.camera.updateMatrixWorld(); };
  window.__try = async (fn, n = 40) => { for (let i = 0; i < n; i++) { if (fn()) return true; await new Promise((r) => setTimeout(r, 500)); } return false; };
  window.__calls = () => ({ calls: L.renderer.info.render.calls, tris: L.renderer.info.render.triangles });
  return { kind: data.kind, id: data.id };
}, sc.mods || {});
console.log('installed', JSON.stringify(info));
if (sc.steps) {
  for (const step of sc.steps) {
    if (step.wait) await new Promise((r) => setTimeout(r, step.wait));
    if (step.eval) { const r = await p.evaluate(new Function('return (async () => {' + step.eval + '})()')); if (r !== undefined) console.log('[eval]', JSON.stringify(r).slice(0, 1500)); }
    if (step.shot) { await p.screenshot({ path: OUT + step.shot }); console.log('shot', step.shot); }
  }
}
console.log(await p.evaluate(() => JSON.stringify({ n: window.__sl?.n, avgMs: window.__sl && +(window.__sl.sum / Math.max(1, window.__sl.n)).toFixed(3), things: window.__life?.things.length, birds: window.__life?.birds.count, tr: window.__traffic?.cars?.length, ...window.__calls() })));
console.log([...new Set(logs)].slice(0, 20).join('\n'));
b.close().catch(() => {});
setTimeout(() => process.exit(0), 800);
