// which objects make the renderer compile a new shader program after the drive starts
import puppeteer from 'puppeteer-core';
const q = process.argv[2] || 'place=spa&stop=0&hours=13&weather=clear', secs = +(process.argv[3] || 120);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 });
const logs = []; p.on('console', (m) => { const t = m.text(); if (/error|failed/i.test(t) && !/404/.test(t)) logs.push(m.type() + ': ' + t.slice(0, 200)); }); p.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 300)));
await p.goto(`http://localhost:5173/?auto=1&wxlock=1&${q}`, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 90000) { const s = await p.evaluate(() => window.__status).catch(() => null); if (s?.settled && s.busy < 2) break; await new Promise((r) => setTimeout(r, 300)); }
await p.evaluate(() => {
  const L = window.__ld, O3 = Object.getPrototypeOf(Object.getPrototypeOf(L.scene)), progs = L.renderer.info.programs;
  window.__comp = []; let n = 0;
  O3.onBeforeRender = function () { n = progs.length; };
  O3.onAfterRender = function (r, s, c, g, m) {
    if (progs.length > n) { const path = []; for (let o = this; o; o = o.parent) path.push((o.name || o.type) + (o.userData?.kind ? ':' + o.userData.kind : '')); const P = r.getProgram ? '' : ''; const prg = r.properties?.get?.(m)?.currentProgram; window.__comp.push(((performance.now() / 1000).toFixed(1)) + 's  ' + (this.isInstancedMesh ? 'inst ic=' + !!this.instanceColor + ' ' : '') + 'wg=' + (()=>{ for (let o = this; o; o = o.parent) if (o === window.__ld.world.group) return 'cur'; return 'other'; })() + ' geo=' + this.geometry?.type + ' attrs=' + Object.keys(this.geometry?.attributes || {}).join('/') + ' col=' + m.color?.getHexString?.() + ' map=' + (m.map?.image?.src || m.map?.name || !!m.map) + ' mn=' + (m.name || '') + ' on=' + (this.name || '') + ' pn=' + (this.parent?.name || '') + ' arr=' + Array.isArray(this.material) + ' '  + m.type + ' ' + String(m.customProgramCacheKey?.() || '').slice(0, 40).replace(/\s+/g, ' ') + ' ' + (m.name || '') + ' [' + (window.__ld.surprises?.active || []).map((a) => a.def.id).join(',') + ']' + '  <-  ' + path.slice(0, 5).join(' < ')); }
    if (progs.length > n) { const np = progs[progs.length - 1], ka = np.cacheKey.split(','); let best = null, bd = 1e9;
      for (const q of progs) { if (q === np) continue; const kb = q.cacheKey.split(','); if (kb.length !== ka.length) continue; let d = 0; for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) d++; if (d < bd) { bd = d; best = kb; } }
      if (best) { const diffs = []; for (let i = 0; i < ka.length; i++) if (ka[i] !== best[i]) diffs.push(i + ':' + String(best[i]).slice(0, 30) + '->' + String(ka[i]).slice(0, 30)); window.__comp.push('      nearest differs at ' + diffs.join(' | ')); } else window.__comp.push('      no same-length program'); }
    n = progs.length;
  };
});
await new Promise((r) => setTimeout(r, secs * 1000));
console.log((await p.evaluate(() => window.__comp)).join('\n') || 'no compiles'); console.log([...new Set(logs)].join('\n'));
b.close().catch(() => {}); setTimeout(() => process.exit(0), 500);
