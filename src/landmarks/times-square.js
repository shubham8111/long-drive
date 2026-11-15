// Times Square: 7th Avenue between W 47th and W 42nd covered in LED screens, One Times Square's screen
// stack, and a night colour spill on the street.
// Budget: 2 draw calls (all screens in one mesh, the spill in another), well under 20k triangles.
// Screens share ONE canvas atlas; the shader picks/crossfades the ads, so update() does no per-panel work.
import * as THREE from 'three';
import { at, nearestS, facadeDistance, AVENUE_DIR, STREET_DIR, yawFacing } from './common.js';

const SA = { lat: 40.7591, lon: -73.9849 }; // W 47th & 7th Ave
const SB = { lat: 40.7559, lon: -73.9871 }; // W 42nd & 7th Ave
const ONE_TS = { lat: 40.75636, lon: -73.98653 };
const DEF_FACADE = 17, PROBE_EVERY = 0.12, PROBE_FOR = 60;

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- atlas
// 2048x2048: 20 landscape ads 512x256 (ids 0-19, 4 cols), 8 portrait ads 256x512 (ids 20-27, y 1280),
// 4 ticker strips 2048x64 (ids 28-31, y 1792). The shader's cell table must match this layout.
const N_LAND = 20, N_PORT = 8, TICK0 = 28, N_TICK = 4;
const ADS = [
  // [bg1, bg2, text, accent, word, slogan, deco]
  ['#e0102a', '#ff8a1a', '#fff', '#ffe14a', 'NOVA COLA', 'Taste the lift.', 'circles'],
  ['#2a0a6e', '#13c7c0', '#fff', '#ff5fd0', 'AURORA PHONE', 'See the night differently', 'rays'],
  ['#0a4fd8', '#5fe3ff', '#fff', '#ffe14a', 'SKYLINE AIR', 'Fly the city', 'waves'],
  ['#05050a', '#1a1a3a', '#fff', '#00e0ff', 'LUMEN TV', 'Colour, turned up.', 'bars'],
  ['#7ee000', '#00a050', '#06210f', '#ffffff', 'ZEPHYR RUNNERS', 'Run the wind', 'stripes'],
  ['#0a1a4a', '#143a8a', '#ffd34a', '#ffffff', 'ORBIT BANK', 'Money, in motion', 'circles'],
  ['#4a0610', '#b01020', '#ffd34a', '#fff', 'THE LANTERN KEEPER', 'now on Broadway', 'rays'],
  ['#d010a0', '#5a14d8', '#fff', '#00f0ff', 'PIXEL STREAM', 'Watch everything', 'grid'],
  ['#f2ecd8', '#cfe3b0', '#1f4a24', '#e07a30', 'MAPLE & MOSS', 'Good things grow', 'circles'],
  ['#00b8f0', '#e8fbff', '#04304a', '#ff3a6a', 'HALO SODA', 'Zero doubt.', 'circles'],
  ['#050505', '#2a2010', '#e8c060', '#ffffff', 'ATLAS WATCHES', 'Time well kept', 'rays'],
  ['#ffd800', '#ff9a00', '#10204a', '#ffffff', 'BRIGHTSIDE INSURANCE', 'Cover the sunny side', 'rays'],
  ['#101010', '#303000', '#ffe600', '#ffffff', 'FLUX ENERGY', 'Charge on.', 'stripes'],
  ['#1a3a8a', '#e0304a', '#fff', '#ffd34a', 'NEW YORK', 'greetings from the city', 'skyline'],
  ['#ff2a8a', '#ffb400', '#fff', '#2a50ff', '', '', 'art'],
  ['#00c8a0', '#2a30d8', '#fff', '#ff8a30', '', '', 'waves'],
  ['#ff7a00', '#c01800', '#fff', '#ffe14a', 'CITY CRUNCH', 'Snack louder', 'stripes'],
  ['#2a0a0a', '#c03000', '#ffe9b0', '#ffb000', 'EMBER GRILL', 'Fire. Flavour.', 'rays'],
  ['#101830', '#00d0a0', '#fff', '#ffffff', 'VOLT RIDE', 'Tap. Ride. Done.', 'bars'],
  ['#ff8ab0', '#ffe0a0', '#5a1040', '#ffffff', 'BLOOM FLORIST', 'Say it with petals', 'circles'],
  // portrait set
  ['#e0102a', '#ff8a1a', '#fff', '#ffe14a', 'NOVA COLA', 'Taste the lift.', 'circles'],
  ['#2a0a6e', '#13c7c0', '#fff', '#ff5fd0', 'AURORA PHONE', 'See the night', 'rays'],
  ['#101010', '#303000', '#ffe600', '#ffffff', 'FLUX ENERGY', 'Charge on.', 'stripes'],
  ['#00b8f0', '#e8fbff', '#04304a', '#ff3a6a', 'HALO SODA', 'Zero doubt.', 'circles'],
  ['#0a1a4a', '#143a8a', '#ffd34a', '#ffffff', 'ORBIT BANK', 'Money, in motion', 'circles'],
  ['#4a0610', '#b01020', '#ffd34a', '#fff', 'LANTERN KEEPER', 'on Broadway', 'rays'],
  ['#d010a0', '#5a14d8', '#fff', '#00f0ff', 'PIXEL STREAM', 'Watch everything', 'grid'],
  ['#ff2a8a', '#2a50ff', '#fff', '#ffe14a', '', '', 'art'],
];
const TICKERS = [
  ['#ffe14a', 'MARKETS RALLY AS TECH LEADS  +++  RAIN CLEARS BY EVENING  +++  SUBWAY SERVICE NORMAL  +++  '],
  ['#ffffff', 'BROADWAY OPENING NIGHT SELLS OUT  +++  CITY MARATHON REGISTRATION OPENS  +++  '],
  ['#ffe14a', 'TEMPERATURE 64F  +++  STOCKS UP 1.2 PERCENT  +++  FERRY SERVICE RESUMES  +++  '],
  ['#ffffff', 'WELCOME TO TIMES SQUARE  +++  THE CROSSROADS OF THE WORLD  +++  '],
];

function fitFont(g, text, font, maxW, maxSize) {
  g.font = `${font.replace('#', '100')}`;
  const w = g.measureText(text).width || 1;
  return Math.max(8, Math.min(maxSize, (100 * maxW) / w));
}

function drawAd(g, x, y, w, h, d, portrait, seed) {
  const r = rng(seed);
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y);
  const grad = g.createLinearGradient(0, 0, portrait ? w : w * 0.6, h);
  grad.addColorStop(0, d[0]); grad.addColorStop(1, d[1]);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const S = Math.max(w, h);
  g.globalAlpha = 0.35; g.fillStyle = d[3]; g.strokeStyle = d[3];
  switch (d[6]) {
    case 'circles': for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(r() * w, r() * h, S * (0.08 + r() * 0.25), 0, 7); g.fill(); } break;
    case 'rays': for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; g.beginPath(); g.moveTo(w / 2, h / 2); g.arc(w / 2, h / 2, S, a, a + 0.14); g.fill(); } break;
    case 'waves': g.lineWidth = S * 0.04; for (let i = 0; i < 6; i++) { g.beginPath(); for (let k = 0; k <= 20; k++) { const px = (k / 20) * w, py = h * (0.15 + i * 0.15) + Math.sin(k * 0.7 + i) * h * 0.06; k ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); } break;
    case 'bars': for (let i = 0; i < 8; i++) { g.fillStyle = `hsl(${i * 45},90%,55%)`; if (portrait) g.fillRect(0, (i / 8) * h, w * 0.12, h / 8); else g.fillRect((i / 8) * w, h * 0.88, w / 8, h * 0.12); } break;
    case 'stripes': g.lineWidth = S * 0.06; for (let i = -6; i < 14; i++) { g.beginPath(); g.moveTo(i * S * 0.14, h); g.lineTo(i * S * 0.14 + h * 0.8, 0); g.stroke(); } break;
    case 'grid': g.lineWidth = 2; for (let i = 0; i < 16; i++) { g.beginPath(); g.moveTo((i / 16) * w, 0); g.lineTo((i / 16) * w, h); g.moveTo(0, (i / 16) * h); g.lineTo(w, (i / 16) * h); g.stroke(); } break;
    case 'skyline': g.fillStyle = '#0a1030'; g.globalAlpha = 0.8; for (let i = 0; i < 16; i++) { const bw = w / 16, bh = h * (0.15 + r() * 0.35); g.fillRect(i * bw, h - bh, bw - 2, bh); } break;
    case 'art': for (let i = 0; i < 9; i++) { g.globalAlpha = 0.7; g.fillStyle = `hsl(${r() * 360},90%,${50 + r() * 15}%)`; g.beginPath(); g.ellipse(r() * w, r() * h, S * (0.1 + r() * 0.3), S * (0.05 + r() * 0.2), r() * 3, 0, 7); g.fill(); } break;
  }
  g.globalAlpha = 1;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = S * 0.02; g.shadowOffsetY = S * 0.01;
  const FONT = 'bold #px "Arial Black", Impact, Arial, sans-serif';
  if (d[4]) {
    const lines = portrait ? d[4].split(' ') : [d[4]];
    const lh = portrait ? h * 0.14 : h * 0.4, y0 = h * (portrait ? 0.34 : 0.4) - ((lines.length - 1) * lh) / 2;
    lines.forEach((ln, i) => {
      const fs = fitFont(g, ln, FONT, w * 0.84, lh);
      g.font = FONT.replace('#', fs); g.fillStyle = d[2]; g.fillText(ln, w / 2, y0 + i * lh * 1.05);
    });
    if (d[5]) {
      const fs = fitFont(g, d[5], 'italic bold #px Arial, sans-serif', w * 0.8, h * (portrait ? 0.06 : 0.11));
      g.font = `italic bold ${fs}px Arial, sans-serif`; g.fillStyle = d[3]; g.fillText(d[5], w / 2, h * (portrait ? 0.7 : 0.76));
    }
  }
  g.shadowBlur = 0; g.shadowOffsetY = 0;
  // dark bezel so mip blending between cells stays black
  g.strokeStyle = '#000'; g.lineWidth = 8; g.strokeRect(0, 0, w, h);
  g.restore();
}

function drawTicker(g, y, color, text) {
  g.fillStyle = '#000'; g.fillRect(0, y, 2048, 64);
  g.font = 'bold 40px "Courier New", monospace'; g.textBaseline = 'middle'; g.textAlign = 'left';
  let s = text; while (g.measureText(s).width > 2020 && s.length > 4) s = s.slice(0, -1);
  g.fillStyle = color; g.fillText(s, 6, y + 34);
}

function buildAtlas() {
  if (typeof document === 'undefined') {
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
  }
  const cv = document.createElement('canvas'); cv.width = cv.height = 2048;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 2048, 2048);
  for (let i = 0; i < N_LAND; i++) drawAd(g, (i % 4) * 512, Math.floor(i / 4) * 256, 512, 256, ADS[i], false, 100 + i);
  for (let j = 0; j < N_PORT; j++) drawAd(g, j * 256, 1280, 256, 512, ADS[N_LAND + j], true, 200 + j);
  for (let k = 0; k < N_TICK; k++) drawTicker(g, 1792 + k * 64, TICKERS[k][0], TICKERS[k][1]);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- screen material (MeshBasic patched)
const SCREEN_VS_DECL = `
attribute vec2 aUV; attribute vec4 aAd; attribute vec4 aPar; attribute vec2 aSize;
varying vec2 vUv2; varying vec4 vAd; varying vec4 vPar; varying vec2 vSize;`;
const SCREEN_FS_DECL = `
uniform float uTime; uniform float uBright;
varying vec2 vUv2; varying vec4 vAd; varying vec4 vPar; varying vec2 vSize;`;
const SCREEN_FS_FUNCS = `
// atlas cell table (see buildAtlas): rect = x, y (canvas top-down), w, h as fractions of 2048
vec3 adSample(float id, vec2 p, vec2 dx, vec2 dy, float asp) {
  id = floor(id + 0.5);
  vec4 r;
  if (id < 19.5) { r = vec4(mod(id, 4.0) * 0.25, floor(id / 4.0) * 0.125, 0.25, 0.125); }
  else if (id < 27.5) { r = vec4((id - 20.0) * 0.125, 0.625, 0.125, 0.25); }
  else { r = vec4(0.0, (1792.0 + (id - 28.0) * 64.0) / 2048.0, 1.0, 0.03125); }
  float ca = r.z / r.w; // atlas is square so fraction ratio == pixel ratio
  vec2 s = vec2(1.0), uc;
  if (id > 27.5) { // ticker: show a window of the strip (no stretching) that scrolls
    float w = asp / ca; s = vec2(w, 1.0);
    uc = vec2(fract(p.x * w + uTime * 0.05 + vPar.x * 0.37), p.y);
  } else { // cover crop, centred
    if (asp > ca) s.y = ca / asp; else s.x = asp / ca;
    uc = 0.5 + (p - 0.5) * s;
  }
  vec2 a = vec2(r.x + uc.x * r.z, 1.0 - r.y - r.w + uc.y * r.w);
  vec2 gx = vec2(dx.x * s.x * r.z, dx.y * s.y * r.w), gy = vec2(dy.x * s.x * r.z, dy.y * s.y * r.w);
  return textureGrad(map, a, gx, gy).rgb;
}
vec3 adPick(float i) { float id = i < 0.5 ? vAd.x : (i < 1.5 ? vAd.y : vAd.z); return vec3(id); }`;
const SCREEN_FS_MAIN = `
{
  vec2 dx = dFdx(vUv2), dy = dFdy(vUv2);
  float asp = vSize.x / vSize.y;
  float per = max(1.0, vPar.y);
  float t = uTime + vPar.x;
  float slot = floor(t / per), f = smoothstep(0.88, 1.0, fract(t / per));
  float n = floor(vAd.w + 0.5);
  float id0 = adPick(mod(slot, n)).x, id1 = adPick(mod(slot + 1.0, n)).x;
  vec3 col;
  if (vPar.z > 0.5 && n > 1.5) { // slide: next ad drops in from the top
    float y = vUv2.y;
    if (y > 1.0 - f) col = adSample(id1, vec2(vUv2.x, y - (1.0 - f)), dx, dy, asp);
    else col = adSample(id0, vec2(vUv2.x, y + f), dx, dy, asp);
  } else {
    col = adSample(id0, vUv2, dx, dy, asp);
    if (f > 0.001) col = mix(col, adSample(id1, vUv2, dx, dy, asp), f);
  }
  // LED dots only up close: fade by derivative so distant screens never moire
  vec2 g = vUv2 * vSize / 0.14;
  float fw = max(fwidth(g.x), fwidth(g.y));
  float vis = 1.0 - smoothstep(0.25, 0.6, fw);
  float dotm = smoothstep(0.55, 0.3, length(fract(g) - 0.5));
  col *= mix(1.0, 0.4 + 0.85 * dotm, vis * 0.85);
  diffuseColor.rgb = col * uBright * vPar.w;
}`;

// ---------------------------------------------------------------- panel layout
function makeLayout(ctx, lo, hi) {
  const r = rng(4711), cols = [], panels = [];
  const block = (hi - 60 - lo) / 5; // 5 blocks between 47th and 42nd (lo/hi include the 30 m extension)
  const gaps = []; // cross-street openings along the avenue
  for (let k = 0; k <= 5; k++) { const sc = lo + 30 + k * block; gaps.push({ a: sc - 9, b: sc + 9, k }); }
  const pickAds = (land) => {
    const pool = []; const n = 2 + (r() < 0.5 ? 1 : 0);
    while (pool.length < n) { const id = land ? Math.floor(r() * N_LAND) : N_LAND + Math.floor(r() * N_PORT); if (!pool.includes(id)) pool.push(id); }
    return pool;
  };
  const add = (p) => { p.i = panels.length; panels.push(p); p.col.panels.push(p); return p; };
  const mkAds = (p, w, h) => {
    const asp = w / h, land = asp >= 0.9, ids = pickAds(land);
    p.size = [w, h]; p.ads = [ids[0], ids[1], ids[2] ?? ids[0], ids.length];
    p.par = [r() * 40, 6 + r() * 6, r() < 0.35 ? 1 : 0, 0.92 + r() * 0.16];
    return p;
  };
  const mkTicker = (p, w, h) => { p.size = [w, h]; p.ads = [TICK0 + Math.floor(r() * N_TICK), 0, 0, 1]; p.par = [r() * 40, 8, 0, 1]; return p; };
  for (const side of [1, -1]) {
    let s = lo + r() * 3;
    while (s < hi - 3) {
      const gap = gaps.find((q) => s < q.b && s + 4 > q.a);
      if (gap) { s = gap.b; continue; }
      const roll = r(), w = roll < 0.35 ? 6 + r() * 2 : roll < 0.65 ? 9 + r() * 4 : 18 + r() * 4;
      let end = s + w;
      for (const q of gaps) if (q.a > s && q.a < end) end = q.a - 0.4;
      if (end - s < 4) { s = end + 0.4; continue; }
      const col = { side, s0: s, s1: end, mid: (s + end) / 2, dist: DEF_FACADE, found: false, panels: [] };
      cols.push(col);
      const width = end - s;
      let y = 4 + r() * 2.5; const top = 28 + r() * 34;
      if (r() < 0.3 && width >= 12) { add(mkTicker({ col, type: 'face', s0: s, s1: end, y0: y, y1: y + 1.4 }, width, 1.4)); y += 1.8; }
      while (y + 3.5 < top) {
        let h = width > 15 ? 8 + r() * 4 : width < 9 ? 10 + r() * 8 : 6 + r() * 4;
        if (r() < 0.15) h = 3 + r() * 1.5;
        h = Math.min(h, top - y); if (h < 3.5) break;
        add(mkAds({ col, type: 'face', s0: s, s1: end, y0: y, y1: y + h }, width, h));
        y += h + 0.4;
      }
      s = end + 0.4 + r() * 0.6;
    }
    // a few screens wrapping round the corners at cross streets (on the cross street's facade)
    for (const q of gaps) {
      for (const sgn of [-1, 1]) {
        if (r() < 0.4) continue;
        const sc = sgn < 0 ? q.a : q.b;
        const col = cols.filter((c) => c.side === side).sort((a, b) => Math.abs(a.mid - sc) - Math.abs(b.mid - sc))[0];
        if (!col) continue;
        let y = 5 + r() * 2; const top = 22 + r() * 22, wd = 10 + r() * 4;
        while (y + 4 < top) {
          const h = Math.min(7 + r() * 5, top - y); if (h < 4) break;
          add(mkAds({ col, type: 'wrap', sc: sc - sgn * 0.3, tdir: -sgn, t0: 1, t1: 1 + wd, y0: y, y1: y + h }, wd, h));
          y += h + 0.4;
        }
      }
    }
  }
  return { cols, panels, gaps };
}

// ---------------------------------------------------------------- landmark
export const TIMES_SQUARE = {
  id: 'times-square', kind: 'ambient', local: true, cooldown: 1,
  possible: (ctx) => ctx.place?.id === 'manhattan' && !!ctx.world && !!ctx.geo && !!ctx.route,
  chance: () => 1,
  create(ctx) {
    const route = ctx.route, RL = route.length;
    const clampS = (s) => Math.min(RL, Math.max(0, s));
    const sA = nearestS(route, ctx.geo.x(SA.lon), ctx.geo.z(SA.lat)), sB = nearestS(route, ctx.geo.x(SB.lon), ctx.geo.z(SB.lat));
    const lo = clampS(Math.min(sA, sB) - 30), hi = clampS(Math.max(sA, sB) + 30);
    const group = new THREE.Group(); group.name = 'times-square';
    const { cols, panels } = makeLayout(ctx, lo, hi);

    // ---- One Times Square: fixed screen stack on its north face (toward south-bound traffic)
    const ots = at(ctx, ONE_TS.lat, ONE_TS.lon, new THREE.Vector3());
    const tcx = ots.x + AVENUE_DIR.x * 9, tcz = ots.z + AVENUE_DIR.z * 9; // north face of the tower
    const rr = rng(99);
    for (let y = 8, i = 0; y < 78; i++) {
      const h = i % 3 === 2 ? 5 + rr() * 2 : 9 + rr() * 4, w = i % 3 === 2 ? 28 : 24 + rr() * 5;
      const p = { type: 'fixed', col: { panels: [] }, y0: y, y1: y + h, w };
      const asp = w / h, ids = []; while (ids.length < 3) { const id = Math.floor(rr() * N_LAND); if (!ids.includes(id)) ids.push(id); }
      p.size = [w, h]; p.ads = [ids[0], ids[1], ids[2], 3]; p.par = [rr() * 30, 6 + rr() * 6, rr() < 0.5 ? 1 : 0, 1.1]; p.asp = asp;
      p.pts = [-1, 1, 1, -1].map((sx, k) => {
        const yy = k < 2 ? y : y + h;
        return [tcx + STREET_DIR.x * sx * w / 2 + AVENUE_DIR.x * 0.4, ots.y + yy, tcz + STREET_DIR.z * sx * w / 2 + AVENUE_DIR.z * 0.4];
      });
      p.i = panels.length; panels.push(p); y += h + 0.5;
      if (i === 3) { // the news "zipper" band
        const tp = { type: 'fixed', col: { panels: [] }, size: [30, 1.5], ads: [TICK0 + 1, 0, 0, 1], par: [3, 8, 0, 1], i: panels.length };
        tp.pts = [-1, 1, 1, -1].map((sx, k) => [tcx + STREET_DIR.x * sx * 15 + AVENUE_DIR.x * 0.4, ots.y + y + (k < 2 ? 0 : 1.5), tcz + STREET_DIR.z * sx * 15 + AVENUE_DIR.z * 0.4]);
        panels.push(tp); y += 2;
      }
    }

    // ---- screens: one geometry, one material
    const NP = panels.length;
    const pos = new Float32Array(NP * 12), uvA = new Float32Array(NP * 8), ad = new Float32Array(NP * 16), par = new Float32Array(NP * 16), sz = new Float32Array(NP * 8);
    const idx = new Uint16Array(NP * 6);
    panels.forEach((p, i) => {
      for (let v = 0; v < 4; v++) {
        uvA.set([[0, 0], [1, 0], [1, 1], [0, 1]][v], i * 8 + v * 2);
        ad.set(p.ads.length === 4 ? p.ads : [p.ads[0], p.ads[0], p.ads[0], 1], i * 16 + v * 4);
        par.set(p.par, i * 16 + v * 4); sz.set(p.size, i * 8 + v * 2);
      }
      const b = i * 4; idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    });
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(pos, 3); posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uvA, 2));
    geo.setAttribute('aUV', new THREE.BufferAttribute(uvA, 2));
    geo.setAttribute('aAd', new THREE.BufferAttribute(ad, 4));
    geo.setAttribute('aPar', new THREE.BufferAttribute(par, 4));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));

    const P0 = {}, P1 = {};
    const writePanel = (p) => {
      const o = p.i * 12;
      const side = p.col.side ?? 1, d = (p.col.dist ?? 0) - 0.35;
      if (p.type === 'fixed') { for (let v = 0; v < 4; v++) pos.set(p.pts[v], o + v * 3); }
      else if (p.type === 'face') {
        route.sample(clampS(p.s0), P0); route.sample(clampS(p.s1), P1);
        const ax = P0.x - P0.tz * side * d, az = P0.z + P0.tx * side * d, bx = P1.x - P1.tz * side * d, bz = P1.z + P1.tx * side * d;
        pos.set([ax, P0.y + p.y0, az, bx, P1.y + p.y0, bz, bx, P1.y + p.y1, bz, ax, P0.y + p.y1, az], o);
      } else { // wrap: runs away from the road along the cross street's facade
        route.sample(clampS(p.sc), P0);
        const nx = -P0.tz * side, nz = P0.tx * side, a = d + p.t0, b = d + p.t1;
        pos.set([P0.x + nx * a, P0.y + p.y0, P0.z + nz * a, P0.x + nx * b, P0.y + p.y0, P0.z + nz * b,
          P0.x + nx * b, P0.y + p.y1, P0.z + nz * b, P0.x + nx * a, P0.y + p.y1, P0.z + nz * a], o);
      }
      // the front must face the viewer (the road, or the cross street for corner wraps) so the ads read the
      // right way round; the backs are not drawn. Flip the quad left-right when it faces the wrong way.
      // (One Times Square's stack faces north, up the avenue toward the oncoming traffic)
      const wx = p.type === 'fixed' ? AVENUE_DIR.x : p.type === 'face' ? P0.tz * side : P0.tx * -(p.tdir || 1);
      const wz = p.type === 'fixed' ? AVENUE_DIR.z : p.type === 'face' ? -P0.tx * side : P0.tz * -(p.tdir || 1);
      const ex = pos[o + 3] - pos[o], ez = pos[o + 5] - pos[o + 2]; // bottom edge; the up edge is +y
      const fx = -ez, fz = ex; // (bottom edge) x (up) = the quad's facing in the ground plane
      if (fx * wx + fz * wz < 0) {
        for (const [i, j] of [[0, 1], [3, 2]]) for (let c = 0; c < 3; c++) { const t = pos[o + i * 3 + c]; pos[o + i * 3 + c] = pos[o + j * 3 + c]; pos[o + j * 3 + c] = t; }
      }
    };
    panels.forEach(writePanel);
    geo.computeBoundingSphere();
    geo.boundingSphere.radius = Math.max(geo.boundingSphere.radius, 600); // positions move later: never cull wrongly

    const atlas = buildAtlas();
    const uTime = { value: 0 }, uBright = { value: 0.95 };
    const mat = new THREE.MeshBasicMaterial({ map: atlas, fog: true, side: THREE.FrontSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime; sh.uniforms.uBright = uBright;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${SCREEN_VS_DECL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvUv2 = aUV; vAd = aAd; vPar = aPar; vSize = aSize;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${SCREEN_FS_DECL}`)
        .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n${SCREEN_FS_FUNCS}`)
        .replace('#include <map_fragment>', SCREEN_FS_MAIN);
    };
    const screens = new THREE.Mesh(geo, mat); screens.frustumCulled = false; screens.renderOrder = 1;
    group.add(screens);

    // ---- night colour spill on the street (additive quads, no lights)
    const SQ = []; const L = 58, W = 46; let nq = 0;
    const sp = [], su = [], ss = [], si = [];
    for (let s = lo + 20; s < hi; s += 48, nq++) {
      const sa = clampS(s - L / 2), sb = clampS(s + L / 2);
      route.sample(sa, P0); route.sample(sb, P1);
      const base = sp.length / 3;
      for (const [P, e] of [[P0, -1], [P1, -1], [P1, 1], [P0, 1]]) sp.push(P.x - P.tz * e * W / 2, P.y + 0.05, P.z + P.tx * e * W / 2);
      su.push(0, 0, 1, 0, 1, 1, 0, 1); ss.push(nq + 1, nq + 1, nq + 1, nq + 1); si.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
    sg.setAttribute('aSeed', new THREE.Float32BufferAttribute(ss, 1));
    sg.setIndex(si);
    const uOp = { value: 0 }, sTime = { value: 0 }, sFog = { value: 0.0003 };
    const spillMat = new THREE.ShaderMaterial({
      uniforms: { uOp, uTime: sTime, uFogDen: sFog },
      vertexShader: `attribute float aSeed; varying vec2 vUv; varying float vSeed; varying float vD;
        void main(){ vUv = uv; vSeed = aSeed; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uOp, uTime, uFogDen; varying vec2 vUv; varying float vSeed; varying float vD;
        float h(float n){ return fract(sin(n * 91.345) * 47453.5453); }
        vec3 pal(float k){ k = floor(k * 6.0);
          return k < 1.0 ? vec3(1.0,0.1,0.15) : k < 2.0 ? vec3(0.1,0.4,1.0) : k < 3.0 ? vec3(1.0,0.2,0.8) : k < 4.0 ? vec3(0.1,0.9,1.0) : k < 5.0 ? vec3(1.0,0.6,0.1) : vec3(0.3,1.0,0.4); }
        void main(){
          vec3 c = vec3(0.0);
          for (int i = 0; i < 5; i++) {
            float fi = float(i) + vSeed * 7.0;
            vec2 p = vec2(h(fi * 1.7), h(fi * 3.1)); float r = 0.16 + 0.2 * h(fi * 5.3);
            float d = length((vUv - p) * vec2(1.0, 0.8)) / r;
            c += pal(h(fi * 9.7)) * exp(-d * d * 2.0) * (0.75 + 0.25 * sin(uTime * (0.4 + h(fi)) + fi));
          }
          float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
          float fogK = exp(-pow(vD * uFogDen, 2.0));
          gl_FragColor = vec4(c * smoothstep(0.0, 0.25, e) * uOp * fogK, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const spill = new THREE.Mesh(sg, spillMat); spill.frustumCulled = false; spill.renderOrder = 2; spill.visible = false;
    group.add(spill);


    ctx.world.add(group);

    // ---- state
    let time = 0, probeT = 0, elapsed = 0, probeI = 0, fogRead = 0;
    const faceCols = cols; // probe order
    const dirty = new Set();
    return {
      update(dt, c) {
        time += dt; elapsed += dt;
        const night = c.night ?? 0;
        uTime.value = time; sTime.value = time;
        uBright.value = 0.92 + 0.6 * sm(0.1, 0.8, night); // readable by day, glowing at night
        uOp.value = 0.85 * sm(0.1, 0.8, night);
        spill.visible = uOp.value > 0.01;
        if (c.fog?.density != null && (fogRead -= dt) < 0) { fogRead = 1; sFog.value = c.fog.density; }
        // buildings stream in later: re-probe facade distances for a minute, one column per tick
        if (elapsed < PROBE_FOR && faceCols.length && (probeT += dt) > PROBE_EVERY) {
          probeT = 0;
          const col = faceCols[probeI++ % faceCols.length];
          const d = facadeDistance(c, clampS(col.mid), col.side);
          if (d != null) {
            const nd = Math.min(30, Math.max(9, d));
            if (!col.found || Math.abs(nd - col.dist) > 0.2) { col.dist = nd; col.found = true; dirty.add(col); }
          }
          if (dirty.size) { for (const q of dirty) for (const p of q.panels) writePanel(p); dirty.clear(); posAttr.needsUpdate = true; }
        }
        group.visible = !c.inTunnel;
        return true;
      },
      dispose() {
        group.removeFromParent();
        geo.dispose(); mat.dispose(); atlas.dispose(); sg.dispose(); spillMat.dispose();
      },
    };
  },
};
