// Out-and-back check: starts a one-way road ~150 m before an end, drives through the U-turn and reports the
// path (largest per-frame jump, heading change), the direction flip, the lane after, and frame gaps.
// usage: node dev/uturn-test.mjs [place=paris] [outDir]   (screenshots: <outDir>/uturn-<n>.png)
import puppeteer from 'puppeteer-core';
const place = process.argv[2] || 'paris', out = process.argv[3] || '/tmp';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 });
const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
await p.goto(`http://localhost:5173/?auto=1&wxlock=1&hours=12&weather=clear&place=${place}&life=0`, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 90000) { const s = await p.evaluate(() => window.__status).catch(() => null); if (s?.settled && s.busy < 2) break; await new Promise((r) => setTimeout(r, 300)); }
const end = process.env.END === '0' ? 0 : 1;
await p.evaluate((end) => { const L = window.__ld; L.set.interleave = false; L.st.uturn = null; L.st.dir = end ? 1 : -1; L.st.s = end ? L.route.length - 160 : 160; L.st.speed = 8; }, end);
await p.evaluate(() => { window.__trk = []; const f = () => { const L = window.__ld, st = L.st, c = L.camera.position; window.__trk.push([performance.now(), c.x, c.z, st.yaw, st.dir, !!st.uturn, st.lat, st.speed, st.s, st.uturn ? +st.uturn.phi.toFixed(2) : -1]); if (window.__trk.length < 4000) requestAnimationFrame(f); }; requestAnimationFrame(f); });
let shots = 0;
for (let i = 0; i < 70; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const u = await p.evaluate(() => window.__ld.st.uturn?.phi ?? null);
  if (u != null && shots < 3 && u > shots * 1.0 + 0.4) await p.screenshot({ path: `${out}/uturn-${shots++}.png` });
  const done = await p.evaluate(() => { const t = window.__trk; return t.some((r) => r[5]) && !t[t.length - 1][5] && t[t.length - 1][7] > 6; });
  if (done) break;
}
const r = await p.evaluate(() => {
  const t = window.__trk; let maxJump = 0, maxYaw = 0, maxGap = 0, flips = 0, inTurn = 0;
  for (let i = 1; i < t.length; i++) {
    const dt = (t[i][0] - t[i - 1][0]) / 1000; maxGap = Math.max(maxGap, dt * 1000);
    const d = Math.hypot(t[i][1] - t[i - 1][1], t[i][2] - t[i - 1][2]); maxJump = Math.max(maxJump, d - t[i][7] * dt);
    maxYaw = Math.max(maxYaw, Math.abs(Math.atan2(Math.sin(t[i][3] - t[i - 1][3]), Math.cos(t[i][3] - t[i - 1][3]))) / Math.max(dt, 1e-3));
    if (t[i][4] !== t[i - 1][4]) flips++;
    if (t[i][5]) inTurn += dt;
  }
  const rates = []; for (let i = 1; i < t.length; i++) { const dt = (t[i][0] - t[i - 1][0]) / 1000; const w = Math.abs(Math.atan2(Math.sin(t[i][3] - t[i - 1][3]), Math.cos(t[i][3] - t[i - 1][3]))) / Math.max(dt, 1e-3) * 57.3; if (w > 60) rates.push([i, Math.round(w), t[i][9], t[i][5], +t[i][7].toFixed(1)]); }
  const a = t[0], z = t[t.length - 1];
  return { frames: t.length, dirStart: a[4], dirEnd: z[4], flips, turnSeconds: +inTurn.toFixed(1), latStart: +a[6].toFixed(2), latEnd: +z[6].toFixed(2), speedEnd: +z[7].toFixed(1),
    extraJumpM: +maxJump.toFixed(2), maxYawRateDegS: Math.round(maxYaw * 57.3), maxFrameGapMs: Math.round(maxGap), sEnd: Math.round(z[8]), length: Math.round(window.__ld.route.length), fastYaw: rates.slice(0, 30) };
});
console.log(JSON.stringify(r), errs.length ? '\nERRORS ' + errs.join('\n') : '');
b.close().catch(() => {}); setTimeout(() => process.exit(0), 500);
