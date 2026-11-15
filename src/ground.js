import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural, seeded, tileable PBR detail textures for ground and road.
// ---------------------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const wrap = (i, n) => ((i % n) + n) % n;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// periodic value noise: x in [0,px), y in [0,py)
export function vnoise(x, y, px, py, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const x0 = wrap(xi, px), x1 = (x0 + 1) % px, y0 = wrap(yi, py), y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(u, v, fx, fy, oct, s, gain = 0.5) {
  let sum = 0, amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const mx = fx << o, my = fy << o;
    sum += amp * vnoise(u * mx, v * my, mx, my, s + o * 17);
    tot += amp;
    amp *= gain;
  }
  return sum / tot;
}
const WL = { f1: 0, f2: 0, id: 0 };
function worley(u, v, n, s, ny = n) {
  const x = u * n, y = v * ny;
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const wx = wrap(cx, n), wy = wrap(cy, ny);
      const px = cx + hash2(wx, wy, s), py = cy + hash2(wx, wy, s + 101);
      const d = Math.sqrt((px - x) * (px - x) + (py - y) * (py - y));
      if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, s + 202); } else if (d < f2) f2 = d;
    }
  WL.f1 = f1; WL.f2 = f2; WL.id = id;
}
const s2l = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

// height field -> tangent-ish normal + alpha channel. returns Uint8Array RGBA
function normalFromHeight(h, S, k, rough) {
  const out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    const ym = wrap(y - 1, S) * S, yp = wrap(y + 1, S) * S, y0 = y * S;
    for (let x = 0; x < S; x++) {
      const xm = wrap(x - 1, S), xp = wrap(x + 1, S);
      let nx = (h[y0 + xm] - h[y0 + xp]) * k, ny = (h[ym + x] - h[yp + x]) * k;
      const il = 1 / Math.hypot(nx, ny, 1);
      const i = (y0 + x) * 4;
      out[i] = (nx * il * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * il * 0.5 + 0.5) * 255;
      out[i + 2] = (il * 0.5 + 0.5) * 255;
      out[i + 3] = clamp01(rough(h[y0 + x], x, y)) * 255;
    }
  }
  return out;
}

function mkCanvas(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return c;
}

// low-res periodic fbm field with bilinear lookup (cheap stand-in for per-pixel fbm)
class Field {
  constructor(fx, fy, oct, seed, cw, ch) {
    this.cw = cw; this.ch = ch;
    this.d = new Float32Array(cw * ch);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) this.d[j * cw + i] = fbm(i / cw, j / ch, fx, fy, oct, seed);
  }
  at(u, v) {
    const { cw, ch, d } = this;
    const x = u * cw, y = v * ch, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const x0 = wrap(xi, cw), x1 = (x0 + 1) % cw, y0 = wrap(yi, ch) * cw, y1 = ((wrap(yi, ch) + 1) % ch) * cw;
    return (d[y0 + x0] * (1 - fx) + d[y0 + x1] * fx) * (1 - fy) + (d[y1 + x0] * (1 - fx) + d[y1 + x1] * fx) * fy;
  }
}
// ---------- (1) Bryce soil: pale orange-pink gravelly limestone dirt ----------
function genSoil(S) {
  const h = new Float32Array(S * S), col = new Float32Array(S * S * 3);
  const stone = [[228, 200, 178], [214, 166, 144], [206, 196, 186], [180, 122, 100], [236, 218, 194], [196, 150, 126]];
  const fLow = new Field(3, 3, 5, 1, 128, 128), fMid = new Field(14, 14, 3, 2, 256, 256);
  const layers = [[9, 3, 0.38, 0.40, 0.5], [22, 5, 0.6, 0.38, 0.34], [52, 9, 0.8, 0.36, 0.2]];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const low = fLow.at(u, v);
      const mid = fMid.at(u, v);
      let hh = 0.12 * low + 0.05 * mid;
      hh += 0.05 * vnoise(u * 160, v * 160, 160, 160, 7);
      let r = 190 + (low - 0.5) * 50 + (mid - 0.5) * 24, g = 130 + (low - 0.5) * 40 + (mid - 0.5) * 18, b = 104 + (low - 0.5) * 30 + (mid - 0.5) * 14;
      let top = hh;
      for (const [n, sd, pres, rad, hb] of layers) {
        worley(u, v, n, sd);
        const id = WL.id;
        if (id < 1 - pres) continue;
        const rr = rad * (0.55 + 0.45 * ((id * 13.7) % 1));
        let d = WL.f1 / rr;
        d *= 1 + 0.35 * (vnoise(u * 64, v * 64, 64, 64, sd) - 0.5);
        if (d >= 1) continue;
        const dome = Math.pow(Math.sqrt(1 - d * d), 0.8);
        const hs = hh * 0.4 + (hb * (0.55 + 0.45 * ((id * 7.3) % 1))) * dome + 0.02;
        if (hs > top) {
          top = hs;
          const sc = stone[Math.floor(((id * 97.1) % 1) * stone.length)];
          const tone = 0.64 + 0.26 * ((id * 31.7) % 1) + (mid - 0.5) * 0.15;
          const e = sstep(0.0, 0.5, dome);
          r = r + (sc[0] * tone - r) * e; g = g + (sc[1] * tone - g) * e; b = b + (sc[2] * tone - b) * e;
        }
      }
      h[i] = top;
      const ao = 0.55 + 0.45 * clamp01(top * 1.6);
      col[i * 3] = r * ao; col[i * 3 + 1] = g * ao; col[i * 3 + 2] = b * ao;
    }
  return { h, col, nk: 5.5, rough: (hv) => 0.97 - 0.12 * clamp01(hv * 1.6) };
}

// ---------- (2) forest floor: pine needle duff ----------
function strokeWrap(S, len, x, y, fn) {
  for (let oy = -1; oy <= 1; oy++) {
    if (oy < 0 && y > len) continue;
    if (oy > 0 && y < S - len) continue;
    for (let ox = -1; ox <= 1; ox++) {
      if (ox < 0 && x > len) continue;
      if (ox > 0 && x < S - len) continue;
      fn(ox * S, oy * S);
    }
  }
}
function pickCol(R, pal) {
  const p = pal[Math.floor(R() * pal.length)];
  const k = 0.85 + R() * 0.3;
  return `rgb(${(p[0] * k) | 0},${(p[1] * k) | 0},${(p[2] * k) | 0})`;
}
function twoCanvas(S, baseFn) {
  const cc = mkCanvas(S), hc = mkCanvas(S);
  const c = cc.getContext('2d', { willReadFrequently: true }), hx = hc.getContext('2d', { willReadFrequently: true });
  const ci = c.createImageData(S, S), hi = hx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4, b = baseFn(x / S, y / S);
      ci.data[o] = b[0]; ci.data[o + 1] = b[1]; ci.data[o + 2] = b[2]; ci.data[o + 3] = 255;
      const hv = b[3] * 255;
      hi.data[o] = hi.data[o + 1] = hi.data[o + 2] = hv; hi.data[o + 3] = 255;
    }
  c.putImageData(ci, 0, 0);
  hx.putImageData(hi, 0, 0);
  return { c, hx };
}
function fromCanvases(S, c, hx, aoPow = 1.6) {
  const cd = c.getImageData(0, 0, S, S).data, hd = hx.getImageData(0, 0, S, S).data;
  const h = new Float32Array(S * S), col = new Float32Array(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    h[i] = hd[i * 4] / 255;
    const ao = 0.5 + 0.5 * clamp01(h[i] * aoPow);
    col[i * 3] = cd[i * 4] * ao; col[i * 3 + 1] = cd[i * 4 + 1] * ao; col[i * 3 + 2] = cd[i * 4 + 2] * ao;
  }
  return { h, col };
}

function genForest(S) {
  const R = rng(4242);
  const fN = new Field(4, 4, 5, 3, 128, 128), fM = new Field(24, 24, 3, 4, 256, 256);
  const { c, hx } = twoCanvas(S, (u, v) => {
    const n = fN.at(u, v), m = fM.at(u, v);
    const k = 0.7 + n * 0.6 + (m - 0.5) * 0.3;
    return [58 * k, 44 * k, 32 * k, 0.1 + 0.12 * n];
  });
  c.lineCap = hx.lineCap = 'round';
  const seg = (x1, y1, x2, y2, w, col, hv, qx, qy) => {
    const len = Math.hypot(x2 - x1, y2 - y1) + 6;
    strokeWrap(S, len, x1, y1, (ox, oy) => {
      c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(x1 + ox, y1 + oy);
      if (qx !== undefined) c.quadraticCurveTo(qx + ox, qy + oy, x2 + ox, y2 + oy); else c.lineTo(x2 + ox, y2 + oy);
      c.stroke();
      const g = (hv * 255) | 0;
      hx.strokeStyle = `rgb(${g},${g},${g})`; hx.lineWidth = w; hx.beginPath(); hx.moveTo(x1 + ox, y1 + oy);
      if (qx !== undefined) hx.quadraticCurveTo(qx + ox, qy + oy, x2 + ox, y2 + oy); else hx.lineTo(x2 + ox, y2 + oy);
      hx.stroke();
    });
  };
  const needle = [[128, 84, 46], [156, 108, 62], [98, 66, 40], [170, 138, 92], [112, 100, 88], [140, 96, 52], [84, 60, 38], [190, 150, 96]];
  // two passes: older, darker underlayer then fresh needles
  for (let pass = 0; pass < 2; pass++) {
    const cnt = pass ? 7500 : 8500;
    for (let i = 0; i < cnt; i++) {
      const x = R() * S, y = R() * S, a = R() * Math.PI * 2, l = 13 + R() * 11, w = 1 + R() * 0.7;
      const col = pass ? pickCol(R, needle) : pickCol(R, [[84, 62, 40], [102, 76, 50], [74, 62, 50]]);
      const hv = pass ? 0.45 + R() * 0.45 : 0.25 + R() * 0.3;
      const dx = Math.cos(a) * l, dy = Math.sin(a) * l, bend = (R() - 0.5) * 4;
      seg(x, y, x + dx, y + dy, w, col, hv, x + dx / 2 - dy * bend * 0.05, y + dy / 2 + dx * bend * 0.05);
      if (R() < 0.6) { // pine needles grow in pairs
        const o = 1.6;
        seg(x - dy * 0.1 * o, y + dx * 0.1 * o, x + dx - dy * 0.1 * o, y + dy + dx * 0.1 * o, w, col, hv * 0.9);
      }
    }
  }
  // twigs
  const twig = [[88, 72, 58], [124, 112, 98], [70, 56, 46], [104, 84, 66]];
  for (let i = 0; i < 70; i++) {
    const x = R() * S, y = R() * S, a = R() * Math.PI * 2, l = 40 + R() * 110, w = 2.2 + R() * 2.2;
    const col = pickCol(R, twig), dx = Math.cos(a) * l, dy = Math.sin(a) * l;
    const bend = (R() - 0.5) * 0.25;
    seg(x, y, x + dx, y + dy, w, col, 0.85 + R() * 0.1, x + dx / 2 - dy * bend, y + dy / 2 + dx * bend);
    if (R() < 0.6) { // side stub
      const t = 0.3 + R() * 0.5, a2 = a + (R() < 0.5 ? 0.7 : -0.7), l2 = l * 0.3;
      const sx = x + dx * t, sy = y + dy * t;
      seg(sx, sy, sx + Math.cos(a2) * l2, sy + Math.sin(a2) * l2, w * 0.55, col, 0.8);
    }
  }
  // pine cones
  for (let i = 0; i < 9; i++) {
    const x = R() * S, y = R() * S, rot = R() * Math.PI, rx = 20 + R() * 9, ry = 12 + R() * 4;
    strokeWrap(S, 40, x, y, (ox, oy) => {
      for (const [ctx, isH] of [[c, 0], [hx, 1]]) {
        ctx.save(); ctx.translate(x + ox, y + oy); ctx.rotate(rot);
        const gr = ctx.createRadialGradient(0, 0, 1, 0, 0, rx);
        if (isH) { gr.addColorStop(0, 'rgb(250,250,250)'); gr.addColorStop(1, 'rgb(150,150,150)'); } else { gr.addColorStop(0, 'rgb(122,86,58)'); gr.addColorStop(1, 'rgb(70,48,34)'); }
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 1.4;
        for (let k = -rx + 4; k < rx - 2; k += 4.5) {
          ctx.strokeStyle = isH ? 'rgb(90,90,90)' : 'rgb(48,32,24)';
          ctx.beginPath(); ctx.ellipse(k, 0, 3.5, ry * (1 - Math.abs(k) / (rx * 1.15)), 0, -1.4, 1.4); ctx.stroke();
        }
        ctx.restore();
      }
    });
  }
  const f = fromCanvases(S, c, hx, 1.5);
  return { ...f, nk: 4.0, rough: () => 0.98 };
}

// ---------- (3) dry grass / low scrub ----------
function genGrass(S) {
  const R = rng(777);
  const fN = new Field(4, 4, 5, 9, 128, 128), fM = new Field(30, 30, 3, 10, 256, 256);
  const { c, hx } = twoCanvas(S, (u, v) => {
    const n = fN.at(u, v), m = fM.at(u, v);
    const k = 0.75 + n * 0.5 + (m - 0.5) * 0.35;
    return [150 * k, 118 * k, 78 * k, 0.1 + 0.08 * m];
  });
  c.lineCap = hx.lineCap = 'round';
  const blade = (x, y, a, l, w, c0, c1, bend) => {
    const pts = [];
    const dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx;
    for (let t = 0; t <= 1.001; t += 0.25) pts.push([x + dx * l * t + px * bend * t * t * l, y + dy * l * t + py * bend * t * t * l]);
    strokeWrap(S, l + 6, x, y, (ox, oy) => {
      for (let k = 0; k < 4; k++) {
        const t = k / 4, ww = w * (1 - t * 0.75);
        const cr = c0[0] + (c1[0] - c0[0]) * t, cg = c0[1] + (c1[1] - c0[1]) * t, cb = c0[2] + (c1[2] - c0[2]) * t;
        c.strokeStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`; c.lineWidth = ww;
        c.beginPath(); c.moveTo(pts[k][0] + ox, pts[k][1] + oy); c.lineTo(pts[k + 1][0] + ox, pts[k + 1][1] + oy); c.stroke();
        const g = ((0.3 + 0.7 * (t + 0.25)) * 255) | 0;
        hx.strokeStyle = `rgb(${g},${g},${g})`; hx.lineWidth = ww;
        hx.beginPath(); hx.moveTo(pts[k][0] + ox, pts[k][1] + oy); hx.lineTo(pts[k + 1][0] + ox, pts[k + 1][1] + oy); hx.stroke();
      }
    });
  };
  const tips = [[205, 184, 122], [222, 205, 150], [140, 132, 70], [118, 124, 64], [168, 136, 82], [190, 170, 108], [232, 220, 170]];
  const bases = [[88, 76, 44], [70, 66, 36], [100, 84, 50]];
  const mk = () => {
    const tp = tips[Math.floor(R() * tips.length)], k = 0.88 + R() * 0.22;
    const bs = bases[Math.floor(R() * bases.length)];
    return [[bs[0], bs[1], bs[2]], [tp[0] * k, tp[1] * k, tp[2] * k]];
  };
  // scattered fine stems
  for (let i = 0; i < 3200; i++) {
    const [c0, c1] = mk();
    blade(R() * S, R() * S, R() * Math.PI * 2, 10 + R() * 22, 1.1 + R(), c0, c1, (R() - 0.5) * 0.8);
  }
  // tufts
  for (let i = 0; i < 70; i++) {
    const tx = R() * S, ty = R() * S, rad = 22 + R() * 30;
    const nb = 34 + (R() * 30) | 0;
    strokeWrap(S, rad + 20, tx, ty, (ox, oy) => {
      const g = c.createRadialGradient(tx + ox, ty + oy, 0, tx + ox, ty + oy, rad * 0.55);
      g.addColorStop(0, 'rgba(40,32,20,0.75)'); g.addColorStop(1, 'rgba(40,32,20,0)');
      c.fillStyle = g; c.beginPath(); c.arc(tx + ox, ty + oy, rad * 0.55, 0, 7); c.fill();
    });
    for (let k = 0; k < nb; k++) {
      const [c0, c1] = mk();
      const a = R() * Math.PI * 2, l = rad * (0.5 + R() * 0.8);
      blade(tx + Math.cos(a) * 2, ty + Math.sin(a) * 2, a, l, 1.5 + R() * 1.4, c0, c1, (R() - 0.5) * 1.3);
    }
  }
  const f = fromCanvases(S, c, hx, 1.4);
  return { ...f, nk: 3.4, rough: (hv) => 0.95 - 0.1 * hv };
}

// Generated textures are the same for every place (ground) or for every road of a kind, so each is made
// once and shared; userData.shared tells the endless drive not to free them when it leaves a place.
const groundCache = new Map(), roadCache = new Map(), roadRaw = new Map();
const markShared = (o) => { for (const v of Object.values(o)) if (v?.isTexture) v.userData.shared = true; return o; };
export function createGroundTextures(maxAniso = 8, S = 512) {
  const key = maxAniso + '|' + S;
  if (!groundCache.has(key)) groundCache.set(key, markShared(makeGroundTextures(maxAniso, S)));
  return groundCache.get(key);
}
function makeGroundTextures(maxAniso, S) {
  const g0 = genSoil(S), g1 = genForest(S), g2 = genGrass(S);
  const gens = [g0, g1, g2];
  const alb = new Uint8Array(S * S * 4 * 3), nor = new Uint8Array(S * S * 4 * 3);
  const mean = [];
  gens.forEach((g, L) => {
    const n = normalFromHeight(g.h, S, g.nk, g.rough);
    nor.set(n, L * S * S * 4);
    let mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < S * S; i++) {
      const r = Math.min(255, g.col[i * 3]), gg = Math.min(255, g.col[i * 3 + 1]), b = Math.min(255, g.col[i * 3 + 2]);
      const o = L * S * S * 4 + i * 4;
      alb[o] = r; alb[o + 1] = gg; alb[o + 2] = b; alb[o + 3] = 255;
      mr += s2l(Math.round(r)); mg += s2l(Math.round(gg)); mb += s2l(Math.round(b));
    }
    mean.push(new THREE.Vector3(mr / (S * S), mg / (S * S), mb / (S * S)));
  });
  const mk = (data, srgb) => {
    const t = new THREE.DataArrayTexture(data, S, S, 3);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = maxAniso;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: mk(alb, true), normal: mk(nor, false), mean };
}


// ---------------------------------------------------------------------------
// Road textures
// ---------------------------------------------------------------------------
const gauss = (x, s) => Math.exp(-(x * x) / (s * s));

function dataTex(data, w, h, { srgb = false, wrapS = THREE.ClampToEdgeWrapping, aniso = 8 } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = wrapS; t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// 1-D periodic noise table along v (high-frequency wobble)
function table1d(n, f, oct, seed) {
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = fbm(0.5, i / n, 1, f, oct, seed);
  return t;
}

// albedo+alpha and packed (rough, track, paint, gravel) over 10 m x 20 m
// style: 'highway' (two-way, double yellow centre, gravel shoulders), 'city' (multi-lane, dashed white
// lane lines, concrete kerb strip) or 'track' (race circuit: solid white edges, clean run-off).
function genRoadMacro(HALF, style = 'highway') {
  const W = 512, H = 1024, ppm = W / (HALF * 2);
  const map = new Uint8Array(W * H * 4), mac = new Uint8Array(W * H * 4);
  const E = HALF - (style === 'city' ? 3.6 : 1.65); // edge of the carriageway (cities: a 3.6 m pavement each side)
  // lines: [offset, width, yellow?, dashed?]
  let lines, tracks, oils, shoulder;
  if (style === 'city') {
    const lw = (E * 2) / 4;
    lines = [[-lw, 0.12, 0, 1], [0, 0.12, 0, 1], [lw, 0.12, 0, 1]];
    tracks = [lw / 2 - 0.85, lw / 2 + 0.85, lw * 1.5 - 0.85, lw * 1.5 + 0.85];
    oils = [lw / 2, lw * 1.5];
    shoulder = [150, 147, 140, 0.25];
  } else if (style === 'track') {
    lines = [[-E, 0.2, 0, 0], [E, 0.2, 0, 0]];
    tracks = [0.6, 2.2];
    oils = [];
    shoulder = [88, 92, 84, 0.3];
  } else {
    lines = [[-E, 0.12, 0, 0], [E, 0.12, 0, 0], [-0.13, 0.1, 1, 0], [0.13, 0.1, 1, 0]];
    tracks = [0.9, 2.5];
    oils = [1.7];
    shoulder = [128, 110, 92, 0.8];
  }
  const fT = new Field(3, 6, 4, 11, 128, 256), fBr = new Field(2, 10, 3, 31, 64, 256), fOil = new Field(2, 16, 3, 51, 64, 256);
  const fDust = new Field(2, 12, 2, 61, 64, 256), fGe = new Field(2, 30, 3, 91, 128, 512), fWear = new Field(24, 48, 2, 81, 256, 512);
  const fGt = new Field(4, 8, 3, 7, 64, 128);
  const wobT = table1d(H, 90, 3, 71);
  for (let y = 0; y < H; y++) {
    const v = y / H, wob = (wobT[y] - 0.5) * 0.03;
    for (let x = 0; x < W; x++) {
      const u = x / W, m = (x + 0.5) / ppm - HALF, am = Math.abs(m), i = (y * W + x) * 4;
      const px = hash2(x, y, 3);
      let val = 60 + (fT.at(u, v) - 0.5) * 18 + (px - 0.5) * 9;
      const broken = 0.55 + 0.45 * fBr.at(u, v);
      let P = 0;
      for (const t of tracks) P += gauss(am - t, 0.26);
      P = Math.min(1, P * broken * (1 - sstep(E - 0.25, E + 0.05, am)));
      val += 8 * P;
      let oil = 0;
      for (const t of oils) oil += gauss(am - t, 0.13);
      oil *= sstep(0.5, 0.78, fOil.at(u, v));
      val -= 11 * oil;
      let r = val, g = val + 0.5, b = val + 3.5;
      const dust = gauss(am - (E - 0.25), 0.35) * 0.5 * fDust.at(u, v);
      r += dust * 14; g += dust * 12; b += dust * 9;
      // paint
      const wear = sstep(0.5, 0.8, fWear.at(u, v));
      let pc = 0, yel = 0;
      for (const [c, w, isY, dashed] of lines) {
        const d = Math.abs(m + wob * (c < 0 ? 1 : -1) - c);
        let k = sstep(w / 2 + 0.014, w / 2 - 0.014, d);
        if (dashed && (v * 2) % 1 > 0.3) k = 0; // 3 m dash every 10 m
        if (k > pc) { pc = k; yel = isY; }
      }
      const chip = sstep(0.7, 0.9, hash2(x >> 1, y >> 1, 91));
      pc *= (1 - 0.65 * wear) * (1 - 0.5 * chip);
      const pn = 0.86 + 0.14 * px;
      const pr = yel ? 226 : 228, pg = yel ? 172 : 226, pb = yel ? 30 : 214;
      r += (pr * pn - r) * pc * 0.92; g += (pg * pn - g) * pc * 0.92; b += (pb * pn - b) * pc * 0.92;
      // gravel shoulder
      const gr = sstep(E + 0.2, E + 0.6, am + (fGe.at(u, v) - 0.5) * 0.5 * shoulder[3]);
      let a = 255;
      if (am > E + 0.15) {
        const gk = (1 - shoulder[3] * 0.5 + shoulder[3] * hash2(x, y, 9)) * (0.85 + 0.3 * fGt.at(u, v));
        r += (shoulder[0] * gk - r) * gr; g += (shoulder[1] * gk - g) * gr; b += (shoulder[2] * gk - b) * gr;
        if (style === 'city') {
          // kerb stone, then paving slabs with joints
          const kerb = sstep(E + 0.12, E + 0.2, am) * (1 - sstep(E + 0.42, E + 0.5, am));
          const jx = Math.abs((((am - E - 0.5) / 1.2) % 1) - 0.5) * 1.2, jy = Math.abs((((v * 16) % 1)) - 0.5) * 1.25;
          const joint = am > E + 0.5 ? 1 - sstep(0.012, 0.035, Math.min(jx, jy)) : 0;
          const tone = 1 + 0.16 * kerb - 0.28 * joint + (fT.at(u, v) - 0.5) * 0.12;
          r = shoulder[0] * tone * gk; g = shoulder[1] * tone * gk; b = shoulder[2] * tone * gk;
          if (am < E + 0.12) { r *= 0.55; g *= 0.55; b *= 0.57; } // gutter
        }
        const t = style === 'city' ? Math.pow(Math.max(0, (am - (HALF - 0.5)) / 0.5), 0.5) * 0.93 : Math.max(0, (am - (E + 0.2)) / (HALF - (E + 0.2)));
        a = 255 * Math.max(0, 1 - t * t * 1.15) * (0.75 + 0.25 * hash2(x, y, 13));
      }
      map[i] = r; map[i + 1] = g; map[i + 2] = b; map[i + 3] = a;
      const rough = (0.86 - 0.16 * P) * (1 - pc) + 0.6 * pc;
      mac[i] = (rough * (1 - gr) + (style === 'city' ? 0.8 : 0.97) * gr) * 255;
      mac[i + 1] = P * 255;
      mac[i + 2] = pc * 255;
      mac[i + 3] = gr * 255 * (style === 'highway' ? 1 : 0.08); // loose-gravel bumpiness only on rural shoulders
    }
  }
  return { map, mac, W, H };
}

// weathering over 10 m x 50 m (shader samples v*0.4): R tone, G cracks/seams, B puddle potential
function genRoadWeather(HALF) {
  const W = 512, H = 1024, LEN = 50, ppm = W / (HALF * 2);
  const R = rng(2024);
  const out = new Uint8Array(W * H * 4);
  const rects = [];
  for (let i = 0; i < 9; i++) rects.push({ x: -3.3 + R() * 6, w: 1.4 + R() * 2.2, v: R() * LEN, l: 1.5 + R() * 5.5, d: (R() < 0.6 ? -1 : 1) * (0.05 + R() * 0.09) });
  const seams = [];
  for (let i = 0; i < 4; i++) seams.push(4 + (i + R() * 0.6) * (LEN / 4));
  const lon = [];
  for (let i = 0; i < 5; i++) {
    const s = 40 + ((R() * 90) | 0);
    lon.push({ x: (R() < 0.5 ? -1 : 1) * (0.4 + R() * 2.8), wx: table1d(H, 5, 3, s), live: table1d(H, 6, 2, s + 1) });
  }
  const fTone = new Field(3, 12, 4, 101, 128, 256), fZone = new Field(2, 10, 3, 151, 64, 128), fPud = new Field(2, 8, 4, 131, 64, 128);
  const seamWob = new Float32Array(W);
  for (let x = 0; x < W; x++) seamWob[x] = (vnoise((x / W) * 7, 0, 7, 1, 3) - 0.5) * 0.08;
  for (let y = 0; y < H; y++) {
    const v = y / H, vm = v * LEN;
    for (let x = 0; x < W; x++) {
      const u = x / W, m = (x + 0.5) / ppm - HALF, i = (y * W + x) * 4;
      let tone = 0.5 + (fTone.at(u, v) - 0.5) * 0.4;
      let crack = 0;
      for (const p of rects) {
        let dv = ((vm - p.v) % LEN + LEN) % LEN;
        if (dv > LEN / 2) dv -= LEN;
        const dx = Math.abs(m - p.x) - p.w / 2, dl = Math.abs(dv - p.l / 2) - p.l / 2;
        const dd = Math.max(dx, dl);
        if (dd < 0) tone += p.d;
        else if (dd < 0.03) crack = Math.max(crack, 0.4 * (1 - dd / 0.03) * (0.4 + 0.6 * hash2(x >> 1, y >> 1, 5)));
      }
      for (const s of seams) {
        const d = Math.abs(vm - s - seamWob[x]);
        if (d < 0.03) crack = Math.max(crack, 0.9 * sstep(0.03, 0.012, d));
      }
      for (const L of lon) {
        const d = Math.abs(m - (L.x + (L.wx[y] - 0.5) * 0.6));
        if (d < 0.02) crack = Math.max(crack, sstep(0.5, 0.58, L.live[y]) * sstep(0.02, 0.006, d) * 0.85);
      }
      const zone = sstep(0.64, 0.8, fZone.at(u, v));
      if (zone > 0.01) {
        worley(u, v, 22, 17, 110);
        crack = Math.max(crack, (1 - sstep(0.0, 0.085, WL.f2 - WL.f1)) * zone * 0.8);
      }
      out[i] = clamp01(tone) * 255;
      out[i + 1] = clamp01(crack) * 255;
      out[i + 2] = fPud.at(u, v) * 255;
      out[i + 3] = 255;
    }
  }
  return { data: out, W, H };
}

// tiling aggregate (0.5 m tile): RGB normal, A = grain brightness
function genRoadMicro(S = 256) {
  const h = new Float32Array(S * S), tone = new Float32Array(S * S);
  const layers = [[22, 21, 0.5, 0.7], [58, 23, 0.55, 0.5]];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      let top = 0.09 * vnoise(u * 128, v * 128, 128, 128, 3) + 0.05 * vnoise(u * 24, v * 24, 24, 24, 4), tn = 0.9;
      for (const [n, sd, rad, hb] of layers) {
        worley(u, v, n, sd);
        const rr = rad * (0.6 + 0.4 * ((WL.id * 11.3) % 1));
        const d = WL.f1 / rr;
        if (d >= 1) continue;
        const hs = hb * (0.5 + 0.5 * ((WL.id * 5.7) % 1)) * Math.pow(1 - d * d, 0.55) + 0.02;
        if (hs > top) { top = hs; tn = 0.7 + 0.6 * ((WL.id * 37.3) % 1); }
      }
      h[i] = top;
      tone[i] = tn * (0.75 + 0.25 * clamp01(top * 2));
    }
  const out = normalFromHeight(h, S, 5, () => 1);
  for (let i = 0; i < S * S; i++) out[i * 4 + 3] = clamp01(tone[i] * 0.78) * 255;
  return out;
}

// the raw pixels of a road's textures: pure arithmetic, so it can also run on a worker thread
export function genRoadRaw(HALF, style) {
  return { mc: genRoadMacro(HALF, style), wx: genRoadWeather(HALF), mi: genRoadMicro(256) };
}
// Make a road's textures on a worker thread, so building a new place never stalls the drive.
let texWorker = null;
export function prepareRoadTextures(HALF = 5, style = 'highway') {
  const k = HALF + '|' + style;
  if (roadRaw.has(k) || [...roadCache.keys()].some((x) => x.endsWith('|' + k))) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      texWorker ??= new Worker(new URL('./texgen.worker.js', import.meta.url), { type: 'module' });
      const id = Math.random();
      const on = (e) => { if (e.data.id !== id) return; texWorker.removeEventListener('message', on); roadRaw.set(k, e.data.raw); resolve(); };
      texWorker.addEventListener('message', on);
      texWorker.postMessage({ id, HALF, style });
    } catch (e) { resolve(); } // no worker: made on the spot instead
  });
}
export function createRoadTextures(maxAniso = 8, HALF = 5, style = 'highway') {
  const key = maxAniso + '|' + HALF + '|' + style;
  if (roadCache.has(key)) return roadCache.get(key);
  const raw = roadRaw.get(HALF + '|' + style) || genRoadRaw(HALF, style);
  roadRaw.delete(HALF + '|' + style);
  const { mc, wx, mi } = raw;
  const map = dataTex(mc.map, mc.W, mc.H, { srgb: true, aniso: maxAniso });
  const macro = dataTex(mc.mac, mc.W, mc.H, { aniso: maxAniso });
  const weather = dataTex(wx.data, wx.W, wx.H, { aniso: maxAniso });
  const micro = dataTex(mi, 256, 256, { wrapS: THREE.RepeatWrapping, aniso: maxAniso });
  const out = markShared({ map, macro, weather, micro });
  roadCache.set(key, out);
  return out;
}

// debug helpers for texture previews (dev only)
export function __previewGround() {
  const S = 512, t = createGroundTextures(1, S);
  const a = t.albedo.image.data, n = t.normal.image.data, L = S * S * 4;
  const layers = [];
  for (let i = 0; i < 3; i++) layers.push({ data: a.slice(i * L, (i + 1) * L) });
  for (let i = 0; i < 3; i++) { const d = n.slice(i * L, (i + 1) * L); for (let k = 3; k < L; k += 4) d[k] = 255; layers.push({ data: d }); }
  return { S, layers, cols: 3, rows: 2 };
}
export function __previewRoad() {
  const t0 = performance.now();
  const r = createRoadTextures(1, 5);
  console.log('road ms', performance.now() - t0);
  const f = (t, w, h) => { const d = new Uint8Array(t.image.data); for (let k = 3; k < d.length; k += 4) d[k] = 255; return { data: d, w, h }; };
  return { S: 512, layers: [f(r.map, 512, 1024), f(r.macro, 512, 1024), f(r.weather, 512, 1024), f(r.micro, 256, 256)], cols: 4, rows: 2 };
}
