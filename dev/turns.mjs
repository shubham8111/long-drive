// Cornering smoothness: how abruptly the view's turn rate changes, frame to frame, along a drive.
// Compares the game's heading with the old filter (1st-order follow of the raw road direction).
// usage: node dev/turns.mjs "<query>" [seconds]
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 });
await p.goto(`http://localhost:5173/?auto=1&${process.argv[2] || 'place=monaco&stop=0'}`, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 60000) { const s = await p.evaluate(() => window.__status).catch(() => null); if (s && s.settled && s.busy < 2) break; await new Promise((r) => setTimeout(r, 300)); }
const r = await p.evaluate((secs) => new Promise((res) => {
  const l = window.__ld, st = l.st, P = {}; let old = null, prevNew = st.yaw, prevOld = null, rn = 0, ro = 0, jn = [], jo = [], last = performance.now();
  const ang = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const end = performance.now() + secs * 1000;
  const f = () => {
    const now = performance.now();
    if (now >= end) { last = -1; }
    // the game's own step: distance moved / speed (frames where it did not step are skipped)
    const ds = Math.abs(st.s - (f.s ?? st.s)); f.s = st.s;
    if (last !== -1 && (ds < 1e-4 || st.speed < 1)) { requestAnimationFrame(f); return; }
    const dt = Math.max(1e-3, ds / Math.max(st.speed, 1));
    l.route.sample(st.s, P); const raw = Math.atan2(-P.tx * st.dir, -P.tz * st.dir);
    if (old === null) { old = raw; prevOld = raw; }
    old += ang(raw, old) * (1 - Math.exp(-6 * dt));
    const rateN = ang(st.yaw, prevNew) / dt, rateO = ang(old, prevOld) / dt; prevNew = st.yaw; prevOld = old;
    jn.push(Math.abs(rateN - rn) / dt); jo.push(Math.abs(rateO - ro) / dt); rn = rateN; ro = rateO;
    if (last !== -1) requestAnimationFrame(f); else {
      const q = (a, x) => { a = a.slice(5).sort((m, n) => m - n); return +a[Math.floor(a.length * x)].toFixed(2); };
      res({ frames: jn.length, newJerk: { p50: q(jn, 0.5), p99: q(jn, 0.99), max: q(jn, 0.9999) }, oldJerk: { p50: q(jo, 0.5), p99: q(jo, 0.99), max: q(jo, 0.9999) }, metres: Math.round(st.s) });
    }
  };
  requestAnimationFrame(f);
}), +(process.argv[3] || 25));
console.log('turn-rate change (rad/s²; lower = smoother):', JSON.stringify(r));
b.close(); setTimeout(() => process.exit(0), 500);
