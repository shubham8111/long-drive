import puppeteer from 'puppeteer-core';
const b = await puppeteer.connect({ browserURL: 'http://localhost:9229', defaultViewport: null });
const p = (await b.pages()).find((x) => x.url().includes('appassets'));
for (const [label, play] of [['driving, video paused', false], ['driving, video playing', true]]) {
  await p.evaluate((play) => { const L = window.__ld; L.st.target = 13.9; L.set.timeFlows = true; window.__abOn = false; document.getElementById('hud').style.display = ''; for (const f of document.querySelectorAll('iframe')) f.style.visibility = ''; try { play ? L.radio._player?.playVideo?.() : L.radio._player?.pauseVideo?.(); } catch (e) {} }, play);
  await new Promise((r) => setTimeout(r, 6000));
  const r = await p.evaluate(() => new Promise((res) => { const P = window.__prof, P0 = { ...P }, t = performance.now(); setTimeout(() => { const fr = P.frames - P0.frames, per = {}; for (const k of ['sim', 'sky', 'terrain', 'life', 'render']) per[k] = +((P[k] - P0[k]) / fr).toFixed(1); res({ ms: +((performance.now() - t) / fr).toFixed(0), per, tris: window.__status.tris, calls: window.__status.calls, kmh: Math.round(window.__ld.st.speed * 3.6) }); }, 12000); }));
  console.log(label.padEnd(24), JSON.stringify(r));
}
b.disconnect();
