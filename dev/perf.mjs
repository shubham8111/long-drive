// Load-time + smoothness probe. usage: node dev/perf.mjs [path] [driveSeconds]
import puppeteer from 'puppeteer-core';
const path = process.argv[2] || '/?auto=1&stop=2';
const driveS = +(process.argv[3] || 30);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,810', ...(process.env.UNCAP ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []), '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: +(process.env.W || 1440), height: +(process.env.H || 810), deviceScaleFactor: +(process.env.DPR || 1) });
await p.evaluateOnNewDocument(() => {
  window.__long = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration), (e.attribution?.[0]?.containerSrc || e.attribution?.[0]?.containerType || '').slice(0, 40)]); }).observe({ entryTypes: ['longtask'] });
  window.__ft = []; let last = 0;
  const tick = (t) => { if (last) window.__ft.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const t0 = Date.now();
await p.goto('http://localhost:' + (process.env.PORT || 5173) + path, { waitUntil: 'domcontentloaded' });
let settledAt = null, firstFrame = null;
while (Date.now() - t0 < 90000) {
  const s = await p.evaluate(() => window.__status ? { ...window.__status, now: Math.round(performance.now()) } : null).catch(() => null);
  if (s && firstFrame == null) firstFrame = s.now;
  if (s && s.settled && s.busy < 4) { settledAt = s.now; break; }
  await new Promise((r) => setTimeout(r, 150));
}
const load = await p.evaluate(() => ({ long: window.__long.slice(), marks: window.__marks || null }));
console.log('firstFrame(ms)', firstFrame, 'settled(ms)', settledAt);
console.log('long tasks during load [start,dur]:', JSON.stringify(load.long.filter((l) => l[1] > 80)), 'total', load.long.reduce((a, l) => a + l[1], 0));
if (load.marks) console.log('marks', JSON.stringify(load.marks));
if (driveS > 0) {
  if (process.argv[4]) await p.evaluate((v) => { const l = window.__ld; l.st.target = v; l.st.speed = v; }, +process.argv[4]);
  await p.evaluate(() => { window.__ft.length = 0; window.__long.length = 0; window.__t0 = performance.now(); if (window.__prof) for (const k in window.__prof) window.__prof[k] = 0; });
  await new Promise((r) => setTimeout(r, driveS * 1000));
  const r = await p.evaluate(() => {
    if (window.__prof) { const P = window.__prof; window.__r = +(P.render / P.frames).toFixed(2); }
    const f = window.__ft.slice().sort((a, b) => a - b), n = f.length, q = (x) => +f[Math.min(n - 1, Math.floor(n * x))].toFixed(1);
    return { renderMs: window.__r, frames: n, avg: +(f.reduce((a, x) => a + x, 0) / n).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over33: f.filter((x) => x > 33).length, over50: f.filter((x) => x > 50).length, long: window.__long.filter((l) => l[1] > 60).map((l) => [Math.round(l[0] - window.__t0), l[1], l[2]]), prof: window.__prof && Object.fromEntries(Object.entries(window.__prof).map(([k, v]) => [k, k === 'frames' || k === 'max' ? Math.round(v) : +(v / window.__prof.frames).toFixed(2)])), status: window.__status, kmh: window.__ld && Math.round(window.__ld.st.speed * 3.6), s: window.__ld && Math.round(window.__ld.st.s) };
  });
  console.log('drive', JSON.stringify(r));
}
b.close().catch(() => {}); setTimeout(() => process.exit(0), 500);
