import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural, deterministic scenery for Bryce Canyon (ponderosa pine plateau).
// buildAssets(renderer, shared) -> { pine:[3], shrub:[2], rock:[3], broadleaf:[3] }  (see header of task for Variant shape)

// ---------------------------------------------------------------- tree palette
// ?treepal=0|1|2|3  0 = original lime pines, 1 = deeper natural ponderosa (default), 2 = high-desert sage, 3 = golden hour
const PAL_ID = (() => { try { const v = +(new URLSearchParams(location.search).get('treepal') ?? 1); return v >= 0 && v <= 3 ? v : 1; } catch (e) { return 1; } })();
const PALS = [
  { pine: { lo: [78, 84, 30], hi: [150, 156, 58], ye: [40, 16, 10] }, bark: { plate: [0.50, 0.36, 0.27], furrow: [0.17, 0.12, 0.09] }, mul: [1, 1, 1], sat: 1 },
  { pine: { lo: [52, 66, 32], hi: [106, 126, 62], ye: [26, 10, 6] }, bark: { plate: [0.54, 0.34, 0.23], furrow: [0.16, 0.10, 0.07] }, mul: [1, 1, 1], sat: 0.95 },
  { pine: { lo: [60, 74, 50], hi: [120, 138, 94], ye: [12, 8, 6] }, bark: { plate: [0.52, 0.39, 0.30], furrow: [0.17, 0.13, 0.10] }, mul: [1.0, 1.03, 1.04], sat: 0.72 },
  { pine: { lo: [76, 78, 28], hi: [142, 142, 50], ye: [36, 12, 4] }, bark: { plate: [0.62, 0.37, 0.21], furrow: [0.18, 0.11, 0.07] }, mul: [1.1, 1.03, 0.82], sat: 1.05 },
];
const PAL = PALS[PAL_ID];
// tone an [r,g,b] 0-255 colour (designed for the default palette) by the active palette
function tone(c) {
  const m = PAL.mul, l = (c[0] + c[1] + c[2]) / 3;
  return c.map((v, i) => clamp((l + (v - l) * PAL.sat) * m[i], 0, 255));
}
const rgbS = (c, k = 1) => `rgb(${c[0] * k | 0},${c[1] * k | 0},${c[2] * k | 0})`;

// ---------------------------------------------------------------- utilities
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function makeNoise3(seed) {
  const r = mulberry32(seed), perm = new Uint8Array(512), val = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; val[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const h = (x, y, z) => val[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  const noise = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let fx = x - xi, fy = y - yi, fz = z - zi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const a = lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), fx), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), fx), fy);
    const b = lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), fx), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), fx), fy);
    return lerp(a, b, fz);
  };
  return (x, y, z, oct = 3) => {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.07; }
    return s / n;
  };
}

function triCount(geo) { return Math.round((geo.index ? geo.index.count : geo.attributes.position.count) / 3); }

// ---------------------------------------------------------------- geometry builder
class MB {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  get vc() { return this.p.length / 3; }
  vert(x, y, z, nx, ny, nz, u, v, r = 1, g = 1, b = 1) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(r, g, b);
  }
  tube(pts, rad, nr, o = {}) {
    const K = pts.length, base = this.vc;
    const T = [], N = [], B = [], L = [0];
    for (let k = 0; k < K; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(K - 1, k + 1)];
      T.push(b.clone().sub(a).normalize());
      if (k) L.push(L[k - 1] + pts[k].distanceTo(pts[k - 1]));
    }
    const ref = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    let n0 = new THREE.Vector3().crossVectors(T[0], ref).normalize();
    for (let k = 0; k < K; k++) {
      n0 = n0.clone().sub(T[k].clone().multiplyScalar(n0.dot(T[k]))).normalize();
      N.push(n0); B.push(new THREE.Vector3().crossVectors(T[k], n0));
    }
    const col = o.col || [1, 1, 1], uRep = o.uRep || 1, vS = o.vScale || 1;
    for (let k = 0; k < K; k++) {
      for (let j = 0; j <= nr; j++) {
        const a = (j / nr) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const dx = N[k].x * ca + B[k].x * sa, dy = N[k].y * ca + B[k].y * sa, dz = N[k].z * ca + B[k].z * sa;
        const jit = o.jit ? o.jit(a, L[k]) : 1;
        const r = rad[k] * jit;
        const sh = o.shade ? o.shade(k / (K - 1)) : 1;
        this.vert(pts[k].x + dx * r, pts[k].y + dy * r, pts[k].z + dz * r, dx, dy, dz, (j / nr) * uRep, L[k] / vS,
          col[0] * sh, col[1] * sh, col[2] * sh);
      }
    }
    for (let k = 0; k < K - 1; k++) for (let j = 0; j < nr; j++) {
      const a = base + k * (nr + 1) + j, b = a + 1, c = a + nr + 1, d = c + 1;
      this.i.push(a, c, b, b, c, d);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

// crossed pair of cards sprouting from P along `axis`; fn(x,y,z,v) -> [nx,ny,nz,r,g,b]
function addTuft(mb, P, axis, len, wid, tile, fn, twist = 0, cards = 3) {
  const ref = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const s1 = new THREE.Vector3().crossVectors(axis, ref).normalize();
  const s2 = new THREE.Vector3().crossVectors(axis, s1).normalize();
  const [u0, v0, u1, v1] = tile;
  for (let ci = 0; ci < cards; ci++) {
    const ang = twist + (ci * Math.PI) / cards;
    const s = s1.clone().multiplyScalar(Math.cos(ang)).addScaledVector(s2, Math.sin(ang));
    const b0 = P.clone().addScaledVector(axis, -len * 0.04);
    const corners = [
      [b0.clone().addScaledVector(s, -wid / 2), u0, v0, 0],
      [b0.clone().addScaledVector(s, wid / 2), u1, v0, 0],
      [b0.clone().addScaledVector(axis, len).addScaledVector(s, -wid / 2), u0, v1, 1],
      [b0.clone().addScaledVector(axis, len).addScaledVector(s, wid / 2), u1, v1, 1],
    ];
    const base = mb.vc;
    for (const [p, u, v, vv] of corners) {
      const r = fn(p.x, p.y, p.z, vv);
      mb.vert(p.x, p.y, p.z, r[0], r[1], r[2], u, v, r[3], r[4], r[5]);
    }
    mb.i.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
}

// ---------------------------------------------------------------- textures
function alphaTexture(canvas, bleed, maxAniso) {
  const W = canvas.width, H = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = H - 1 - y; // flip so v=1 is the top row
    for (let x = 0; x < W; x++) {
      const si = (sy * W + x) * 4, di = (y * W + x) * 4;
      const a = d[si + 3];
      if (a < 24) { out[di] = bleed[0]; out[di + 1] = bleed[1]; out[di + 2] = bleed[2]; out[di + 3] = 0; }
      else { out[di] = d[si]; out[di + 1] = d[si + 1]; out[di + 2] = d[si + 2]; out[di + 3] = Math.min(255, a * 1.45); }
    }
  }
  const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = maxAniso; t.needsUpdate = true;
  return t;
}

// 2x2 atlas of ponderosa needle tufts (bottlebrush, base at tile bottom centre)
function makeNeedleAtlas(maxAniso, o = {}) {
  const lo = o.lo || PAL.pine.lo, hi = o.hi || PAL.pine.hi, ye = o.ye || PAL.pine.ye, LS = o.ls || 1, NFm = o.nf || 1, LW = o.lw || 1;
  const T = 256, c = document.createElement('canvas');
  c.width = c.height = T * 2;
  const g = c.getContext('2d'), rnd = mulberry32(o.seed || 777);
  g.lineCap = 'round';
  for (let tile = 0; tile < 4; tile++) {
    const ox = (tile % 2) * T, oy = Math.floor(tile / 2) * T;
    const bx = ox + T / 2, by = oy + T - 14;
    // twig
    g.strokeStyle = 'rgb(86,62,40)'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(bx, oy + T - 4); g.lineTo(bx + (rnd() - 0.5) * 6, by - 50); g.stroke();
    const nF = Math.round((70 + tile * 4) * NFm);
    for (let f = 0; f < nF; f++) {
      const along = Math.pow(rnd(), 0.8);
      const sx = bx + (rnd() - 0.5) * 12, sy = by - along * 56;
      const wide = rnd() < 0.22; const th0 = (rnd() - 0.5) * 2 * (wide ? 1.25 : (0.28 + along * 0.4));
      const len = (wide ? 70 + rnd() * 80 : 95 + rnd() * 120) * (1 - 0.2 * Math.abs(th0)) * LS;
      const k = 0.82 + rnd() * 0.36, yel = rnd() * 0.5;
      for (let n = 0; n < 3; n++) {
        const th = th0 + (n - 1) * 0.07 + (rnd() - 0.5) * 0.05;
        const dx = Math.sin(th), dy = -Math.cos(th);
        const droop = len * 0.2 * Math.abs(Math.sin(th)) + len * 0.04;
        const ex = sx + dx * len, ey = sy + dy * len + droop;
        const grad = g.createLinearGradient(sx, sy, ex, ey);
        grad.addColorStop(0, `rgb(${lo[0] * k | 0},${lo[1] * k | 0},${lo[2] * k | 0})`);
        grad.addColorStop(1, `rgb(${(hi[0] + yel * ye[0]) * k | 0},${(hi[1] + yel * ye[1]) * k | 0},${(hi[2] + yel * ye[2]) * k | 0})`);
        g.strokeStyle = grad; g.lineWidth = (1.9 + rnd() * 0.9) * LW;
        g.beginPath(); g.moveTo(sx, sy);
        g.quadraticCurveTo(sx + dx * len * 0.55, sy + dy * len * 0.55 + droop * 0.1, ex, ey);
        g.stroke();
      }
    }
  }
  return alphaTexture(c, [(lo[0] + hi[0]) / 2 | 0, (lo[1] + hi[1]) / 2 | 0, (lo[2] + hi[2]) / 2 | 0], maxAniso);
}

// 2 tiles of leafy twigs, near-white so material colour tints them: 0 = sagebrush (narrow), 1 = manzanita (oval)
function makeLeafAtlas(maxAniso) {
  const T = 256, c = document.createElement('canvas');
  c.width = T * 2; c.height = T;
  const g = c.getContext('2d'), rnd = mulberry32(4242);
  for (let tile = 0; tile < 2; tile++) {
    const ox = tile * T, bx = ox + T / 2, by = T - 8;
    const twig = [];
    let x = bx, y = by, a = -Math.PI / 2 + (rnd() - 0.5) * 0.3;
    g.strokeStyle = 'rgb(170,160,150)'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 16; s++) { a += (rnd() - 0.5) * 0.25; x += Math.cos(a) * 13; y += Math.sin(a) * 13; twig.push([x, y, a]); g.lineTo(x, y); }
    g.stroke();
    const branches = [];
    for (const [tx, ty, ta] of twig) for (const side of [-1, 1]) {
      if (rnd() < 0.75) branches.push([tx, ty, ta + side * (0.7 + rnd() * 0.5), 20 + rnd() * 50]);
    }
    for (const [tx, ty, ba, bl] of branches) {
      g.strokeStyle = 'rgb(170,160,150)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + Math.cos(ba) * bl, ty + Math.sin(ba) * bl); g.stroke();
      const n = 3 + (rnd() * 3 | 0);
      for (let l = 0; l <= n; l++) {
        const t = l / n, px = tx + Math.cos(ba) * bl * t, py = ty + Math.sin(ba) * bl * t;
        const la = ba + (l % 2 ? 0.6 : -0.6) + (rnd() - 0.5) * 0.4;
        const L = tile === 0 ? 20 + rnd() * 12 : 15 + rnd() * 8, Wd = tile === 0 ? 4.5 : 8;
        const sh = 200 + rnd() * 55 | 0;
        g.fillStyle = `rgb(${sh},${sh},${sh - 6})`;
        g.save(); g.translate(px, py); g.rotate(la); g.beginPath();
        g.ellipse(L * 0.5, 0, L * 0.5, Wd * 0.5, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(120,120,110,0.5)'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(0, 0); g.lineTo(L, 0); g.stroke();
        g.restore();
      }
    }
  }
  return alphaTexture(c, [190, 190, 185], maxAniso);
}

// bark: warm orange-brown plates with dark furrows. Colour (sRGB) + normal map, tileable.
function makeBark(maxAniso, o = {}) {
  const W = 256, H = 512, cols = o.cols || 7, rows = o.rows || 7, stX = o.stretch || 1.55;
  const pl = o.plate || PAL.bark.plate, fu = o.furrow || PAL.bark.furrow;
  const rnd = mulberry32(o.seed || 31337);
  const cell = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cell.push([i + 0.15 + rnd() * 0.7, j + 0.15 + rnd() * 0.7, rnd(), rnd()]);
  const hm = new Float32Array(W * H), col = new Float32Array(W * H * 3);
  const rowOff = (j) => ((j % rows) + rows) % rows;
  const nz = makeNoise3(9);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = (x / W) * cols, fy = (y / H) * rows;
    // light warp so plates are irregular
    const wx = fx + (nz(fx * 0.9, fy * 0.9, 1) - 0.5) * 0.7, wy = fy + (nz(fx * 0.9, fy * 0.9, 5) - 0.5) * 0.7;
    const ci = Math.floor(wx), cj = Math.floor(wy);
    let d1 = 9, d2 = 9, id = 0, id2 = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = ci + di, jj = cj + dj;
      const cc = cell[rowOff(jj) * cols + (((ii % cols) + cols) % cols)];
      // plates are tall: stretch distance in x
      const px = ii - ((ii % cols) + cols) % cols + cc[0], py = jj - rowOff(jj) + cc[1];
      const dx = (wx - px) * stX, dy = (wy - py) * 0.8;
      const d = Math.hypot(dx, dy);
      if (d < d1) { d2 = d1; id2 = id; d1 = d; id = cc[2]; } else if (d < d2) { d2 = d; id2 = cc[2]; }
    }
    const edge = d2 - d1; // 0 at furrow
    const plate = sstep(0.0, 0.34, edge);
    const fine = nz(x * 0.2, y * 0.05, 3) * 0.6 + nz(x * 0.7, y * 0.2, 8) * 0.4;
    const h = plate * (0.7 + 0.3 * sstep(0.2, 0.5, edge)) * (0.85 + 0.15 * fine);
    hm[y * W + x] = h;
    const tone = 0.78 + id * 0.34 + (fine - 0.5) * 0.3;
    // plate colour: orange cinnamon, with darker brown furrows
    const r = lerp(fu[0], pl[0], plate) * tone, gg = lerp(fu[1], pl[1], plate) * tone, b = lerp(fu[2], pl[2], plate) * tone;
    col[(y * W + x) * 3] = r; col[(y * W + x) * 3 + 1] = gg; col[(y * W + x) * 3 + 2] = b;
  }
  const cc = document.createElement('canvas'), nc = document.createElement('canvas');
  cc.width = nc.width = W; cc.height = nc.height = H;
  const ci = cc.getContext('2d').createImageData(W, H), ni = nc.getContext('2d').createImageData(W, H);
  const sc = 3.2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, k = y * W + x;
    ci.data[o] = Math.min(255, col[k * 3] * 255); ci.data[o + 1] = Math.min(255, col[k * 3 + 1] * 255); ci.data[o + 2] = Math.min(255, col[k * 3 + 2] * 255); ci.data[o + 3] = 255;
    const xl = hm[y * W + ((x - 1 + W) % W)], xr = hm[y * W + ((x + 1) % W)];
    const yu = hm[((y - 1 + H) % H) * W + x], yd = hm[((y + 1) % H) * W + x];
    // canvas row 0 is the top (v = 1) so +v is "up" in the image
    let nx = (xl - xr) * sc, ny = (yd - yu) * sc, nzv = 1;
    const l = Math.hypot(nx, ny, nzv); nx /= l; ny /= l; nzv /= l;
    ni.data[o] = (nx * 0.5 + 0.5) * 255; ni.data[o + 1] = (ny * 0.5 + 0.5) * 255; ni.data[o + 2] = (nzv * 0.5 + 0.5) * 255; ni.data[o + 3] = 255;
  }
  cc.getContext('2d').putImageData(ci, 0, 0); nc.getContext('2d').putImageData(ni, 0, 0);
  const map = new THREE.CanvasTexture(cc), normalMap = new THREE.CanvasTexture(nc);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }
  return { map, normalMap };
}


// quaking aspen: 2x2 tiles of small round shimmering leaves on fine twigs (base at tile bottom centre)
function makeAspenAtlas(maxAniso) {
  const T = 256, c = document.createElement('canvas');
  c.width = c.height = T * 2;
  const g = c.getContext('2d'), rnd = mulberry32(909);
  g.lineCap = 'round';
  const lc = tone([80, 116, 50]), lc2 = tone([110, 144, 68]); // mid summer green, not lime
  for (let tile = 0; tile < 4; tile++) {
    const ox = (tile % 2) * T, oy = Math.floor(tile / 2) * T, bx = ox + T / 2, by = oy + T - 6;
    const leaves = [];
    const twig = (x, y, a, len, depth) => {
      g.strokeStyle = 'rgb(150,140,120)'; g.lineWidth = depth ? 1.6 : 3;
      g.beginPath(); g.moveTo(x, y);
      let px = x, py = y;
      for (let s = 0; s < 4; s++) { a += (rnd() - 0.5) * 0.35; px += Math.cos(a) * len / 4; py += Math.sin(a) * len / 4; g.lineTo(px, py); if (depth < 2 && rnd() < 0.7) leaves.push([px, py, a]); }
      g.stroke();
      leaves.push([px, py, a]);
      if (depth < 2) for (let k = 0; k < 3; k++) { const t = 0.4 + rnd() * 0.5; twig(x + (px - x) * t, y + (py - y) * t, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), len * (0.55 + rnd() * 0.25), depth + 1); }
    };
    twig(bx, by, -Math.PI / 2 + (rnd() - 0.5) * 0.3, 95, 0);
    for (const [lx, ly, la] of leaves) for (let n = 0; n < 2; n++) {
      const x = lx + (rnd() - 0.5) * 18, y = ly + (rnd() - 0.5) * 18, k = 0.82 + rnd() * 0.36, r = 11 + rnd() * 7;
      if (x < ox + r || x > ox + T - r || y < oy + r || y > oy + T - r) continue;
      const up = rnd() < 0.4;
      g.fillStyle = rgbS(up ? lc2 : lc, k);
      g.save(); g.translate(x, y); g.rotate(la + (rnd() - 0.5) * 2.5);
      g.beginPath(); g.ellipse(0, 0, r, r * (0.82 + rnd() * 0.15), 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(r * 0.8, -r * 0.35); g.lineTo(r * 1.35, 0); g.lineTo(r * 0.8, r * 0.35); g.fill();
      g.strokeStyle = 'rgba(190,210,140,0.5)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(-r * 0.7, 0); g.lineTo(r * 1.1, 0); g.stroke();
      g.restore();
    }
  }
  return alphaTexture(c, [96, 150, 52], maxAniso);
}

// Utah juniper: dense grey-green scale-leaf sprigs
function makeJuniperAtlas(maxAniso) {
  const T = 256, c = document.createElement('canvas');
  c.width = c.height = T * 2;
  const g = c.getContext('2d'), rnd = mulberry32(1313);
  g.lineCap = 'round';
  const A = tone([70, 92, 66]), B = tone([128, 148, 112]);
  for (let tile = 0; tile < 4; tile++) {
    const ox = (tile % 2) * T, oy = Math.floor(tile / 2) * T, bx = ox + T / 2, by = oy + T - 6;
    const shoot = (x, y, a, len, w, depth) => {
      let px = x, py = y;
      const k = 0.8 + rnd() * 0.4, mix = rnd();
      g.strokeStyle = rgbS([lerp(A[0], B[0], mix), lerp(A[1], B[1], mix), lerp(A[2], B[2], mix)], k);
      g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
      const n = 5;
      for (let s = 0; s < n; s++) { a += (rnd() - 0.5) * 0.3 - 0.02 * Math.cos(a); px += Math.cos(a) * len / n; py += Math.sin(a) * len / n; g.lineTo(px, py); }
      g.stroke();
      if (depth < 3) for (let q = 0; q < 5; q++) { const t = 0.25 + rnd() * 0.75; shoot(x + (px - x) * t, y + (py - y) * t, a + (rnd() < 0.5 ? -1 : 1) * (0.45 + rnd() * 0.6), len * (0.5 + rnd() * 0.25), w * 0.75, depth + 1); }
    };
    for (let k = 0; k < 4; k++) shoot(bx + (rnd() - 0.5) * 8, by, -Math.PI / 2 + (rnd() - 0.5) * 1.1, 100 + rnd() * 50, 5.5, 0);
    // a few dusty blue berries
    g.fillStyle = 'rgb(88,104,128)';
    for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(ox + 60 + rnd() * 136, oy + 40 + rnd() * 160, 3.5, 0, 6.3); g.fill(); }
  }
  return alphaTexture(c, [90, 112, 86], maxAniso);
}

// aspen bark: cream-white with dark eye scars and fine horizontal lenticels. Tileable. Flat normal map.
function makeAspenBark(maxAniso) {
  const W = 128, H = 256, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d'), rnd = mulberry32(2468);
  g.fillStyle = 'rgb(188,184,168)'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 700; i++) { const v = 150 + rnd() * 70 | 0; g.fillStyle = `rgba(${v},${v - 3},${v - 14},0.5)`; g.fillRect(rnd() * W, rnd() * H, 6 + rnd() * 26, 1 + rnd() * 2); }
  for (let i = 0; i < 26; i++) { // horizontal dark marks (eyes), drawn wrapped
    const x = rnd() * W, y = rnd() * H, w = 8 + rnd() * 16, h = 3 + rnd() * 5;
    for (const dx of [-W, 0, W]) {
      g.fillStyle = `rgba(36,32,28,${0.55 + rnd() * 0.4})`;
      g.beginPath(); g.ellipse(x + dx, y, w, h, 0, 0, 6.3); g.fill();
      g.fillStyle = 'rgba(190,186,170,0.9)'; g.beginPath(); g.ellipse(x + dx, y + h * 0.1, w * 0.45, h * 0.4, 0, 0, 6.3); g.fill();
    }
  }
  for (let i = 0; i < 10; i++) { const y = rnd() * H; g.fillStyle = 'rgba(60,55,50,0.35)'; g.fillRect(0, y, W, 1 + rnd() * 2); }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const nd = new Uint8Array([128, 128, 255, 255]);
  const normalMap = new THREE.DataTexture(nd, 1, 1, THREE.RGBAFormat); normalMap.needsUpdate = true;
  for (const t of [map]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  return { map, normalMap };
}

// ---------------------------------------------------------------- material patching
const GLSL_NOISE = /* glsl */`
float ldH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float ldN(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ldH(i), ldH(i + vec3(1,0,0)), f.x), mix(ldH(i + vec3(0,1,0)), ldH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ldH(i + vec3(0,0,1)), ldH(i + vec3(1,0,1)), f.x), mix(ldH(i + vec3(0,1,1)), ldH(i + vec3(1,1,1)), f.x), f.y), f.z); }
float ldF(vec3 p){ return ldN(p) * 0.6 + ldN(p * 2.13 + 3.1) * 0.3 + ldN(p * 4.37 + 7.7) * 0.1; }
`;

const ROCK_GLSL = /* glsl */`
vec3 ldLayer(float id){
  float h = fract(sin(id * 12.9898 + 4.1) * 43758.5453);
  vec3 cream  = vec3(0.80, 0.54, 0.30);
  vec3 orange = vec3(0.74, 0.27, 0.09);
  vec3 pink   = vec3(0.76, 0.33, 0.25);
  vec3 grey   = vec3(0.60, 0.42, 0.31);
  vec3 c = mix(cream, orange, smoothstep(0.0, 0.35, h));
  c = mix(c, pink, smoothstep(0.3, 0.6, h));
  c = mix(c, grey, smoothstep(0.6, 0.85, h) * 0.6);
  c = mix(c, cream, smoothstep(0.85, 1.0, h));
  return c;
}
vec3 ldRock(vec3 p){
  float w = ldN(p * vec3(1.3, 0.7, 1.3) + 7.0) * 0.6 + ldN(p * 4.0) * 0.12;
  float b = p.y * 3.4 + w * 1.7;
  float id = floor(b), fr = fract(b);
  vec3 c = mix(ldLayer(id), ldLayer(id + 1.0), smoothstep(0.55, 1.0, fr));
  c *= 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.09, fr));
  float grain = ldN(p * 22.0) * 0.5 + ldN(p * 57.0) * 0.5;
  c *= 0.82 + 0.3 * grain;
  float cr = abs(ldN(p * vec3(3.0, 1.2, 3.0) + 21.0) - 0.5);
  c *= 0.8 + 0.2 * smoothstep(0.0, 0.03, cr);
  float lich = smoothstep(0.62, 0.78, ldN(p * 3.3 + 11.0));
  c = mix(c, vec3(0.55, 0.48, 0.30), lich * 0.15);
  float soil = smoothstep(0.28, 0.0, p.y + (ldN(p * 6.0) - 0.5) * 0.2);
  c = mix(c, vec3(0.34, 0.15, 0.08), soil * 0.75);
  return c;
}
`;

export function patch(mat, shared, o) {
  if (o.lod || o.fade) { mat.alphaToCoverage = true; mat.transparent = false; }
  // o.fade: small scenery (rocks, shrubs) dissolves in over the last stretch of its draw range (uSmallDist)
  // instead of popping into view; shared.uSmallDist is set by main.js from Elements.smallRange
  if (o.fade && !shared.uSmallDist) shared.uSmallDist = { value: 200 };
  const key = ['ld', o.kind, o.lod || 'x', o.fade ? 'fd' : '', o.wind ? 'w' : '', o.flut ? 'f' : '', o.noFlip ? 'nf' : '', o.transl ? 't' : '', o.rock ? 'r' : '', o.imp ? 'i' : '', o.bake ? 'bake' : '', o.bump ? 'bp' : '', o.snowMode || 0].join('_');
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWet = shared.uWet;
    shader.uniforms.uSnow = shared.uSnow;
    shader.uniforms.uLodDist = shared.uLodDist;
    if (o.fade) shader.uniforms.uSmallDist = shared.uSmallDist;
    shader.uniforms.uWindH = { value: o.windH || 10 };
    shader.uniforms.uWindAmp = { value: o.windAmp ?? 1 };
    if (o.imp) shader.uniforms.uImp = { value: o.imp };

    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', `#include <common>
uniform float uTime; uniform float uLodDist; uniform float uWindH; uniform float uWindAmp;
varying vec3 vWN; varying vec3 vOP; ${o.imp ? 'varying vec2 vImpUv;' : ''} ${o.lod ? 'varying float vLodFade;' : ''} ${o.fade ? 'uniform float uSmallDist; varying float vFade;' : ''}`);
    vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 iOrg = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
vOP = position;
${o.imp ? 'vImpUv = uv;' : ''}
${o.wind ? `{
  float wph = iOrg.x * 0.31 + iOrg.z * 0.17;
  float hf = clamp(position.y / uWindH, 0.0, 1.0);
  float a = hf * hf * uWindAmp;
  float sw = uTime * 0.65 + wph;
  transformed.x += (sin(sw + position.y * 0.1) * 0.085 + sin(sw * 2.3 + position.x * 0.5) * 0.025) * a;
  transformed.z += (cos(sw * 0.8 + position.y * 0.08) * 0.065) * a;
  ${o.flut ? `transformed += vec3(sin(uTime * 1.7 + position.x * 2.1 + position.y * 1.3 + wph), sin(uTime * 1.4 + position.z * 2.3 + wph * 1.7) * 0.5, cos(uTime * 1.5 + position.y * 2.0 + position.z * 1.9)) * 0.03 * (0.25 + hf) * uWindAmp;` : ''}
}` : ''}`);
    if (o.fade) {
      vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
vFade = 1.0 - smoothstep(uSmallDist * 0.72, uSmallDist * 0.95, distance(iOrg, cameraPosition));
if (vFade <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
    }
    if (o.lod) {
      // 3D model and flat impostor swap over a 6 m band, blended, so trees never pop
      vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
{
  float iDist = distance(iOrg, cameraPosition);
  float lf = clamp((iDist - (uLodDist - 3.0)) / 6.0, 0.0, 1.0);
  // overlapped: the impostor is fully in before the model starts to go, so the tree is never see-through
  ${o.lod === 'near' ? 'vLodFade = min(1.0, 2.0 - 2.0 * lf); if (lf >= 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);' : 'vLodFade = min(1.0, 2.0 * lf); if (lf <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);'}
}`);
    }
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>
uniform float uTime; uniform float uWet; uniform float uSnow;
varying vec3 vWN; varying vec3 vOP; ${o.imp ? 'varying vec2 vImpUv; uniform sampler2D uImp;' : ''}
${GLSL_NOISE}
${o.rock ? ROCK_GLSL : ''}
${o.lod ? 'varying float vLodFade;' : ''}
${o.fade ? 'varying float vFade;' : ''}`);
    if (o.fade) fs = fs.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.a *= vFade;\nif (diffuseColor.a < 0.02) discard;');
    if (o.lod) {
      // the hand-over fades through multisample coverage (alpha-to-coverage): a fine, steady blend
      // instead of a screen-door pattern that crawls over the tree as you drive past
      if (!o.imp) fs = fs.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.a *= vLodFade;\nif (diffuseColor.a < 0.02) discard;');
    }
    if (o.imp) {
      fs = fs.replace('#include <map_fragment>', `
vec4 impT = texture2D(uImp, vImpUv);
${o.lod ? `if (impT.a < 0.24) discard;
diffuseColor.a = smoothstep(0.26, 0.58, impT.a) * vLodFade; // soft, steady edges through multisample coverage` : 'if (impT.a < 0.42) discard;'}
diffuseColor.rgb *= 0.96 * impT.rgb / max(impT.a, 0.001);`);
    }
    if (o.noFlip) {
      fs = fs.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
    }
    let afterColor = '';
    if (o.rock) afterColor += 'diffuseColor.rgb = ldRock(vOP) * vColor.rgb;\n';
    if (!o.bake) {
      afterColor += `
diffuseColor.rgb *= 1.0 - 0.30 * uWet;
if (uSnow > 0.002) { // the noise is costly: only pay for it when it is actually snowing
  float sn = ldF(vOP * 3.7 + 2.0);
  ${o.snowMode === 2 ? 'float sk = uSnow * 0.3 * smoothstep(0.3, 1.0, vWN.y + (sn - 0.5) * 0.6);' : o.snowMode === 1 ? 'float sk = uSnow * 0.7 * smoothstep(0.2, 0.9, vWN.y + (sn - 0.5) * 0.6);' : 'float sk = uSnow * smoothstep(0.25, 0.65, vWN.y + (sn - 0.5) * 0.55);'}
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), sk);
}`;
    }
    fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + afterColor);
    if (!o.bake) {
      fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, uWet);`);
    }
    if (o.bump) {
      fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float h = ldN(vOP * 11.0) * 0.6 + ldN(vOP * 26.0) * 0.4;
  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
  float dHx = dFdx(h), dHy = dFdy(h);
  vec3 R1 = cross(q1, normal), R2 = cross(normal, q0);
  float det = dot(q0, R1);
  vec3 grad = sign(det) * (dHx * R1 + dHy * R2);
  normal = normalize(abs(det) * normal - 0.012 * grad);
}`);
    }
    if (o.transl && !o.bake) {
      fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
{
  vec3 Lw = directionalLights[0].direction;
  vec3 Vv = normalize(vViewPosition);
  float bk = pow(clamp(dot(-Vv, Lw), 0.0, 1.0), 2.5);
  reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * bk * 0.30 * (0.35 + 0.65 * vColor.g);
}
#endif`);
    }
    if (o.bake) {
      fs = fs.replace('#include <opaque_fragment>', 'gl_FragColor = vec4(diffuseColor.rgb, 1.0);');
    }
    shader.fragmentShader = fs;
  };
  return mat;
}

// ---------------------------------------------------------------- pines
const PINE_SPECS = [
  { H: 12, R0: 0.21, c0: 0.26, N: 26, Lmax: 2.3, style: 'young', bark: [0.62, 0.52, 0.5], tufts: 12, size: 0.95, seed: 11 },
  { H: 18, R0: 0.33, c0: 0.36, N: 28, Lmax: 3.5, style: 'mature', bark: [0.88, 0.8, 0.76], tufts: 11, size: 1.05, seed: 23 },
  { H: 24, R0: 0.46, c0: 0.44, N: 26, Lmax: 5.0, style: 'old', bark: [1.05, 0.98, 0.9], tufts: 12.5, size: 1.15, seed: 47 },
  // 3 subalpine fir / Engelmann spruce: narrow dark spire, branches to near the ground
  { H: 17, R0: 0.2, c0: 0.04, N: 40, Lmax: 2.3, style: 'spire', bark: [1, 0.96, 0.92], tufts: 8, size: 1.15, seed: 61, tk: { bark: 'barkFir', fol: 'fir' }, gaps: 0, stubs: 0, tStart: 0.15, barkW: 0.9 },
  // 4 Douglas-fir / white fir: fuller cone, darker
  { H: 21, R0: 0.3, c0: 0.1, N: 32, Lmax: 3.4, style: 'cone', bark: [1, 0.96, 0.92], tufts: 9, size: 1.25, seed: 71, tk: { bark: 'barkDfir', fol: 'dfir' }, gaps: 0.06, stubs: 2, tStart: 0.25, barkW: 1.1 },
  // 5 quaking aspen: slim white trunk, round shimmering clumps
  { H: 12, R0: 0.12, c0: 0.4, N: 22, Lmax: 1.7, style: 'aspen', bark: [1, 1, 1], tufts: 7, size: 1.15, seed: 83, tk: { bark: 'barkAspen', fol: 'aspen' }, gaps: 0.08, stubs: 0, tStart: 0.3, barkW: 0.8, barkV: 3.2, el: [0.15, 0.95], windAmp: 1.8, cardN: 3 },
  // 6 Utah juniper: short multi-stem shaggy bush (own builder)
  { H: 4.6, R0: 0.2, juniper: true, bark: [1, 1, 1], size: 1.0, seed: 97, tk: { bark: 'barkJun', fol: 'jun' }, barkW: 0.7, barkV: 1.4 },
];

function buildPineGeometry(S) {
  const rnd = mulberry32(S.seed);
  const { H, R0, c0 } = S;
  const lx = (rnd() - 0.5) * 0.05 * H, lz = (rnd() - 0.5) * 0.05 * H, ph = rnd() * 6;
  const tp = (y) => {
    const t = y / H;
    return new THREE.Vector3(lx * t * t + Math.sin(y * 0.33 + ph) * 0.05 * (0.4 + t), y, lz * t * t + Math.cos(y * 0.29 + ph) * 0.05 * (0.4 + t));
  };
  const tr = (y) => Math.max(S.style === 'old' ? 0.07 : 0.02, R0 * Math.pow(Math.max(0, 1 - y / H), 0.85)) * (1 + 0.6 * Math.exp(-y / 0.75));

  const bark = new MB(), fol = new MB();
  // trunk
  {
    const K = 10, pts = [], rad = [];
    for (let k = 0; k < K; k++) { const y = H * Math.pow(k / (K - 1), 1.35); pts.push(tp(y)); rad.push(tr(y)); }
    const circ = Math.PI * 2 * R0;
    bark.tube(pts, rad, 8, {
      uRep: Math.max(1, Math.round(circ / (S.barkW || 1.25))), vScale: S.barkV || 2.4, col: S.bark,
      jit: (a, L) => 1 + 0.035 * Math.sin(a * 5 + L * 1.3) + 0.03 * Math.sin(a * 3 - L * 0.6 + 1) + 0.02 * Math.sin(a * 9 + L * 2.7),
      shade: (t) => lerp(0.8, 1, sstep(0.0, 0.5, t)),
    });
  }
  // crown ellipsoid for baked occlusion / bent normals
  const cyMid = lerp(c0 * H, H, 0.5), rx = S.Lmax * 0.95 + 0.8, ry = (H - c0 * H) * 0.55 + 0.6;
  const cc = tp(cyMid);
  const trng = mulberry32(S.seed * 7 + 1);
  const tuftFn = (tint) => (x, y, z, vv) => {
    const dx = x - cc.x, dy = y - cc.y, dz = z - cc.z;
    let nx = dx / (rx * rx), ny = dy / (ry * ry), nz = dz / (rx * rx);
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    ny += 0.18; const l2 = Math.hypot(nx, ny, nz); nx /= l2; ny /= l2; nz /= l2;
    const rho = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rx) ** 2);
    let ao = 0.44 + 0.56 * sstep(0.15, 1.0, rho);
    ao *= lerp(0.88, 1.0, sstep(-1, 0.6, dy / ry));
    ao *= lerp(0.7, 1.0, sstep(0.0, 0.8, vv));
    return [nx, ny, nz, ao * tint[0], ao * tint[1], ao * tint[2]];
  };
  const tile = (k) => { const u0 = (k % 2) * 0.5, v0 = 0.5 - Math.floor(k / 2) * 0.5; return [u0 + 0.004, v0 + 0.004, u0 + 0.496, v0 + 0.496]; };

  const bpts = [];
  const nB = S.N;
  const tuftBudget = Math.round(nB * S.tufts * 0.85); // (trimmed for GPU load: the crown reads the same)
  let tuftCount = 0;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < nB; i++) {
    const f = (i + rnd() * 0.7) / nB;
    const y = lerp(c0 * H, H * 0.965, f);
    const az = i * 2.39996 + rnd() * 0.7;
    let prof;
    if (S.style === 'spire') prof = 0.12 + 0.88 * Math.pow(1 - f, 0.9);
    else if (S.style === 'cone') prof = 0.1 + 0.9 * Math.pow(1 - f, 0.8) * (0.8 + 0.2 * sstep(0, 0.12, f));
    else if (S.style === 'aspen') prof = 0.3 + 0.7 * Math.sin(Math.PI * clamp(0.1 + f * 0.85, 0, 1));
    else if (S.style === 'young') prof = 0.25 + 0.75 * Math.pow(1 - f, 0.75);
    else if (S.style === 'mature') prof = (0.3 + 0.7 * sstep(0, 0.2, f)) * Math.pow(1 - f * 0.97, 0.55);
    else prof = (0.35 + 0.65 * sstep(0, 0.12, f)) * Math.pow(Math.max(0.0, 1 - Math.pow(f, 2.6)), 0.7);
    let L = S.Lmax * prof * (0.55 + 0.85 * rnd());
    if (S.style !== 'young' && rnd() < (S.gaps ?? 0.18)) L *= 0.45; // gaps / broken limbs
    L = Math.max(0.55, L);
    const el0 = lerp(S.el ? S.el[0] : -0.08, S.el ? S.el[1] : 0.75, f) + (rnd() - 0.4) * 0.3;
    const droop = (1 - f) * 0.4, rise = lerp(0.75, 0.25, f);
    const p0 = tp(y).add(new THREE.Vector3(Math.cos(az), 0, Math.sin(az)).multiplyScalar(tr(y) * 0.7));
    const pts = [p0]; const nS = 3;
    let az2 = az;
    for (let k = 0; k < nS; k++) {
      const t = k / nS;
      const e = el0 - droop * (1 - t) + rise * t * t * 1.5;
      az2 += (rnd() - 0.5) * 0.28;
      const d = new THREE.Vector3(Math.cos(az2) * Math.cos(e), Math.sin(e), Math.sin(az2) * Math.cos(e));
      pts.push(pts[k].clone().addScaledVector(d, L / nS));
    }
    const r0 = clamp(0.02 + 0.018 * L, 0.025, 0.09);
    bark.tube(pts, [r0, r0 * 0.6, r0 * 0.38, r0 * 0.2], 4, { uRep: 1, vScale: 0.55, col: [S.bark[0] * 0.82, S.bark[1] * 0.78, S.bark[2] * 0.78] });
    bpts.push({ pts, L, f });
  }
  // dead stubs on the bare lower trunk
  const nStub = S.stubs ?? (S.style === 'young' ? 2 : 5);
  for (let i = 0; i < nStub; i++) {
    const y = lerp(0.12 * H, c0 * H * 0.96, rnd()), az = rnd() * 6.28, l = 0.12 + rnd() * 0.22;
    const p0 = tp(y).add(new THREE.Vector3(Math.cos(az), 0, Math.sin(az)).multiplyScalar(tr(y) * 0.8));
    const p1 = p0.clone().add(new THREE.Vector3(Math.cos(az) * l, (rnd() - 0.2) * 0.12, Math.sin(az) * l));
    bark.tube([p0, p1], [0.05, 0.025], 4, { uRep: 1, vScale: 0.3, col: [0.6, 0.55, 0.52] });
  }
  // foliage tufts: distributed along branches, heavier near tips
  const weights = bpts.map((b) => b.L);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const evalPts = (pts, t) => {
    const s = t * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(s)), u = s - k;
    const p = pts[k].clone().lerp(pts[k + 1], u);
    const tg = pts[k + 1].clone().sub(pts[k]).normalize();
    return [p, tg];
  };
  for (let bi = 0; bi < bpts.length; bi++) {
    const b = bpts[bi];
    const n = Math.max(3, Math.round((tuftBudget * b.L) / wsum));
    for (let k = 0; k < n; k++) {
      const t = k === n - 1 ? 1.0 : lerp(S.tStart ?? 0.5, 1.0, Math.pow((k + trng() * 0.6) / n, 0.7));
      const [p, tg] = evalPts(b.pts, t);
      const out = new THREE.Vector3(p.x - cc.x, 0, p.z - cc.z).normalize();
      const ax = tg.clone().multiplyScalar(k === n - 1 ? 1.4 : 0.55)
        .add(new THREE.Vector3(trng() - 0.5, trng() - 0.4, trng() - 0.5).multiplyScalar(1.5))
        .addScaledVector(out, 0.25).addScaledVector(up, 0.12).normalize();
      const sz = S.size * (k === n - 1 ? 1.35 : 0.8 + trng() * 0.45) * (0.8 + 0.4 * t);
      const tint = [0.9 + trng() * 0.2, 0.92 + trng() * 0.16, 0.85 + trng() * 0.2];
      addTuft(fol, p, ax, sz, sz * 0.95, tile((trng() * 4) | 0), tuftFn(tint), trng() * 1.5, S.cardN || 3);
      tuftCount++;
    }
  }
  // leader / crown top tufts
  const topP = tp(H * 0.985);
  const nTop = S.style === 'old' ? 2 : 3;
  for (let k = 0; k < nTop; k++) {
    const ax = new THREE.Vector3((trng() - 0.5) * 0.7, 1, (trng() - 0.5) * 0.7).normalize();
    const sz = S.size * (S.style === 'old' ? 1.0 : 1.15);
    addTuft(fol, topP.clone().addScaledVector(up, -0.5 - k * 0.4), ax, sz, sz, tile((trng() * 4) | 0), tuftFn([1, 1, 0.95]), trng(), S.cardN || 3);
  }
  const bg = bark.build(), fg = fol.build();
  return { bark: bg, foliage: fg, H, topY: fg.boundingBox.max.y, rad: Math.max(fg.boundingBox.max.x, -fg.boundingBox.min.x, fg.boundingBox.max.z, -fg.boundingBox.min.z) };
}


// Utah juniper: 3-5 twisting stems from a common base, short branches, dense bushy foliage
function buildJuniperGeometry(S) {
  const rnd = mulberry32(S.seed), H = S.H;
  const bark = new MB(), fol = new MB();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const cc = V(0, H * 0.5, 0), rx = H * 0.55, ry = H * 0.58;
  const tuftFn = (tint) => (x, y, z, vv) => {
    const dx = x - cc.x, dy = y - cc.y, dz = z - cc.z;
    let nx = dx / (rx * rx), ny = dy / (ry * ry), nz = dz / (rx * rx);
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    ny += 0.2; const l2 = Math.hypot(nx, ny, nz); nx /= l2; ny /= l2; nz /= l2;
    const rho = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rx) ** 2);
    const ao = (0.5 + 0.5 * sstep(0.2, 1.0, rho)) * lerp(0.75, 1, sstep(0, 0.8, vv)) * lerp(0.8, 1, sstep(0, 0.4, y / H));
    return [nx, ny, nz, ao * tint[0], ao * tint[1], ao * tint[2]];
  };
  const tile = (k) => { const u0 = (k % 2) * 0.5, v0 = 0.5 - Math.floor(k / 2) * 0.5; return [u0 + 0.004, v0 + 0.004, u0 + 0.496, v0 + 0.496]; };
  const nStem = 4;
  const ends = [];
  for (let i = 0; i < nStem; i++) {
    const az = i * 2.4 + rnd() * 0.8, lean = 0.28 + rnd() * 0.3, h = H * (0.62 + 0.38 * rnd());
    const pts = [], rad = [];
    for (let k = 0; k < 6; k++) {
      const t = k / 5, y = h * t, off = Math.sin(t * 1.6) * lean * h * 0.55 + (k ? Math.sin(t * 7 + i) * 0.07 : 0);
      pts.push(V(Math.cos(az) * off + Math.sin(t * 6 + i * 2) * 0.05, y, Math.sin(az) * off + Math.cos(t * 5 + i) * 0.05));
      rad.push(Math.max(0.03, S.R0 * (1 - t * 0.85) * (i ? 0.7 : 1)) * (1 + 0.5 * Math.exp(-y / 0.4)));
    }
    bark.tube(pts, rad, 6, { uRep: Math.max(1, Math.round(Math.PI * 2 * S.R0 / S.barkW)), vScale: S.barkV, col: S.bark,
      jit: (a, L) => 1 + 0.08 * Math.sin(a * 3 + L * 2.1) + 0.05 * Math.sin(a * 7 - L * 3) });
    for (let b = 0; b < 7; b++) {
      const t = 0.3 + 0.7 * (b + rnd() * 0.6) / 7, k = Math.min(4, Math.floor(t * 5)), p0 = pts[k].clone().lerp(pts[k + 1], t * 5 - k);
      const ba = az + (rnd() - 0.5) * 3.2, L = (0.8 + rnd() * 0.9) * (1.2 - t * 0.5), el = 0.2 + rnd() * 0.7;
      const d = V(Math.cos(ba) * Math.cos(el), Math.sin(el), Math.sin(ba) * Math.cos(el));
      const p1 = p0.clone().addScaledVector(d, L * 0.5), p2 = p1.clone().addScaledVector(d, L * 0.5).add(V(0, 0.15, 0));
      bark.tube([p0, p1, p2], [0.05, 0.035, 0.02], 4, { uRep: 1, vScale: 0.5, col: [0.9, 0.9, 0.9] });
      ends.push(p1, p2);
    }
    ends.push(pts[5]);
  }
  const ex = [];
  for (const p of ends) for (let n = 0; n < 5; n++) ex.push(p);
  for (const p of ex) {
    const ax = V(rnd() - 0.5, rnd() * 0.8 - 0.1, rnd() - 0.5).addScaledVector(V(p.x - cc.x, 0, p.z - cc.z).normalize(), 0.5).normalize();
    const sz = S.size * (0.75 + rnd() * 0.45);
    addTuft(fol, p, ax, sz, sz, tile((rnd() * 4) | 0), tuftFn([0.9 + rnd() * 0.2, 0.92 + rnd() * 0.16, 0.9 + rnd() * 0.2]), rnd() * 1.5, 2);
  }
  const bg = bark.build(), fg = fol.build();
  return { bark: bg, foliage: fg, H, topY: fg.boundingBox.max.y, rad: Math.max(fg.boundingBox.max.x, -fg.boundingBox.min.x, fg.boundingBox.max.z, -fg.boundingBox.min.z) };
}

function pineMaterials(shared, tex, S, bake) {
  const tk = S.tk || {}, bt = tex[tk.bark || 'bark'];
  const barkM = new THREE.MeshStandardMaterial({ map: bt.map, normalMap: bt.normalMap, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.95, metalness: 0, vertexColors: true });
  const folM = new THREE.MeshStandardMaterial({ map: tex[tk.fol || 'needle'], alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.88, metalness: 0, alphaToCoverage: !bake });
  if (bake) { barkM.fog = false; folM.fog = false; folM.alphaToCoverage = false; }
  const lod = bake ? null : 'near';
  patch(barkM, shared, { kind: 'pbark', lod, bake, snowMode: 1 });
  patch(folM, shared, { kind: 'pfol', lod, wind: true, flut: true, windH: S.H, windAmp: S.windAmp, noFlip: true, transl: true, bake, snowMode: 1 });
  return [barkM, folM];
}

function bakeImpostor(renderer, shared, matFn, S, geo) {
  const fake = { uTime: { value: 0 }, uWet: { value: 0 }, uSnow: { value: 0 }, uLodDist: { value: 1e9 } };
  const mats = matFn(fake);
  const scene = new THREE.Scene();
  for (const [g, m] of [[geo.bark, mats[0]], [geo.foliage, mats[1]]]) {
    const im = new THREE.InstancedMesh(g, m, 1);
    im.setMatrixAt(0, new THREE.Matrix4());
    im.frustumCulled = false;
    scene.add(im);
  }
  const hw = Math.max(geo.H * 0.25, geo.rad + 0.3), top = Math.max(geo.H, geo.topY) + 0.2, bot = -0.05;
  const cam = new THREE.OrthographicCamera(-hw, hw, top, bot, 0.1, 200);
  const rt = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  rt.texture.anisotropy = 2;
  const prevRT = renderer.getRenderTarget(), prevAC = renderer.autoClear, prevCol = new THREE.Color(), prevA = renderer.getClearAlpha();
  renderer.getClearColor(prevCol);
  renderer.autoClear = false; renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(rt); renderer.clear();
  const views = [[new THREE.Vector3(0, 0, 60), new THREE.Vector4(0, 0, 256, 512)], [new THREE.Vector3(60, 0, 0), new THREE.Vector4(256, 0, 256, 512)]];
  for (const [off, vp] of views) {
    cam.position.set(off.x, 0, off.z); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    rt.viewport.copy(vp); rt.scissor.copy(vp); rt.scissorTest = true;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
  }
  rt.scissorTest = false;
  renderer.setRenderTarget(prevRT); renderer.autoClear = prevAC; renderer.setClearColor(prevCol, prevA);
  for (const m of mats) m.dispose();

  // crossed quads
  const g = new THREE.BufferGeometry(), hgt = top - bot;
  const P = [], N = [], U = [], I = [];
  const quad = (axisFn, u0, u1) => {
    const b = P.length / 3;
    for (const [s, y, u, v] of [[-1, bot, u0, 0], [1, bot, u1, 0], [-1, top, u0, 1], [1, top, u1, 1]]) {
      const p = axisFn(s * hw, y);
      P.push(p[0], p[1], p[2]);
      const out = new THREE.Vector3(p[0], 0, p[2]).normalize();
      const nn = new THREE.Vector3(s * (axisFn === qa ? 0.45 : 0), 0.85, s * (axisFn === qa ? 0 : -0.45));
      nn.normalize(); N.push(nn.x, nn.y, nn.z);
      U.push(u, v);
    }
    I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  };
  const qa = (x, y) => [x, y, 0], qb = (x, y) => [0, y, -x];
  quad(qa, 0, 0.5); quad(qb, 0.5, 1);
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  g.computeBoundingBox(); g.computeBoundingSphere();
  // distant trees cover a lot of screen: simple diffuse lighting is much cheaper than full PBR here
  const m = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, vertexColors: false });
  patch(m, shared, { kind: 'pfar', lod: 'far', wind: true, windH: S.H, noFlip: true, imp: rt.texture, snowMode: 2, transl: true, windAmp: 0.9 });
  return { geometry: g, material: m, tex: rt.texture, dims: { hw, bot, top } };
}

// ---------------------------------------------------------------- broadleaf (deciduous city / park trees)
// 2x2 atlas of leaf-cluster cards: 0 plane (lobed), 1 linden (small oval), 2 horse-chestnut (palmate), 3 honey-locust (tiny leaflets)
function makeBroadAtlas(maxAniso) {
  const T = 256, c = document.createElement('canvas');
  c.width = c.height = T * 2;
  const g = c.getContext('2d'), rnd = mulberry32(2026);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const col = (k, y) => `rgb(${(68 + y * 30) * k | 0},${(120 + y * 14) * k | 0},${(38 + y * 6) * k | 0})`;
  const ovate = (L, W, fill, vein) => {
    g.fillStyle = fill; g.beginPath(); g.moveTo(0, 0);
    g.bezierCurveTo(L * 0.2, -W * 0.7, L * 0.7, -W * 0.6, L, 0);
    g.bezierCurveTo(L * 0.7, W * 0.6, L * 0.2, W * 0.7, 0, 0); g.fill();
    if (vein) { g.strokeStyle = vein; g.lineWidth = 0.9; g.beginPath(); g.moveTo(0, 0); g.lineTo(L * 0.92, 0); g.stroke(); }
  };
  const lobed = (L, fill, vein) => {
    g.fillStyle = fill; g.beginPath(); g.moveTo(0, 0);
    const pts = [[0.35, -0.5], [0.55, -0.62], [0.58, -0.3], [1.0, 0], [0.58, 0.3], [0.55, 0.62], [0.35, 0.5]];
    for (const [a, b] of pts) g.lineTo(a * L, b * L * 0.8);
    g.closePath(); g.fill();
    g.strokeStyle = vein; g.lineWidth = 0.9; g.beginPath(); g.moveTo(0, 0); g.lineTo(L * 0.95, 0); g.stroke();
  };
  for (let tile = 0; tile < 4; tile++) {
    const ox = (tile % 2) * T, oy = Math.floor(tile / 2) * T, cx = ox + T / 2, cy = oy + T / 2;
    g.save(); g.beginPath(); g.rect(ox, oy, T, T); g.clip();
    const nSub = 6 + (rnd() * 3 | 0);
    for (let s = 0; s < nSub; s++) {
      const sa = (s / nSub) * 6.283 + rnd(), sr = 25 + rnd() * 55;
      const sx = cx + Math.cos(sa) * sr, sy = cy + Math.sin(sa) * sr * 0.9;
      // sub-twig toward centre
      g.strokeStyle = 'rgb(92,72,50)'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(cx + (rnd() - 0.5) * 16, cy + (rnd() - 0.5) * 16); g.lineTo(sx, sy); g.stroke();
      const nL = tile === 2 ? 2 + (rnd() * 2 | 0) : tile === 1 ? 7 : tile === 3 ? 3 : 5;
      for (let l = 0; l < nL; l++) {
        const out = Math.atan2(sy - cy, sx - cx) + (rnd() - 0.5) * 1.8;
        const px = sx + (rnd() - 0.5) * 22, py = sy + (rnd() - 0.5) * 22, k = 0.78 + rnd() * 0.4, y = rnd();
        g.save(); g.translate(px, py); g.rotate(out);
        if (tile === 0) lobed(44 + rnd() * 20, col(k, y), 'rgba(180,200,120,0.55)');
        else if (tile === 1) ovate(30 + rnd() * 12, 22 + rnd() * 6, col(k, y), 'rgba(170,200,120,0.5)');
        else if (tile === 2) {
          const nl = 5 + (rnd() * 2 | 0), LL = 58 + rnd() * 14;
          for (let q = 0; q < nl; q++) { g.save(); g.rotate(-1.1 + (q / (nl - 1)) * 2.2); ovate(LL * (1 - Math.abs(q - (nl - 1) / 2) * 0.09), 24, col(k * (0.92 + (q % 2) * 0.12), y), 'rgba(170,200,120,0.5)'); g.restore(); }
        } else {
          g.strokeStyle = 'rgb(110,100,60)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, 0); g.lineTo(62, 0); g.stroke();
          for (let q = 1; q < 8; q++) for (const sd of [-1, 1]) { g.save(); g.translate(q * 7.5, 0); g.rotate(sd * (1.1 + rnd() * 0.3)); ovate(15 + rnd() * 5, 7, col(k * (0.9 + rnd() * 0.2), y), null); g.restore(); }
        }
        g.restore();
      }
    }
    g.restore();
  }
  return alphaTexture(c, [60, 100, 36], maxAniso);
}

// smooth grey-brown bark, or patchy plane-tree bark (cream / olive patches)
function makeBroadBark(maxAniso, patchy) {
  const W = patchy ? 128 : 64, H = 256, nz = makeNoise3(patchy ? 5 : 6);
  const hm = new Float32Array(W * H), col = new Float32Array(W * H * 3);
  const TAU = Math.PI * 2;
  const smp = (x, y, fx, fy, off) => { // periodic in x and y
    const a = x / W * TAU, b = y / H * TAU, R = 1.6;
    return nz(Math.cos(a) * R * fx + off, Math.sin(a) * R * fx, Math.cos(b) * R * fy + 3, 2) * 0.5 + nz(Math.sin(b) * R * fy + 9, Math.cos(a) * R * fx * 0.6 + 4, Math.sin(a) * R * fx + off, 2) * 0.5;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    const fine = smp(x, y, 3.2, 0.9, 20), mid = smp(x, y, 1.1, 0.5, 40);
    let r, gg, b, h = 0.6 + (fine - 0.5) * 0.5;
    if (patchy) {
      const pn = smp(x, y, 1.5, 1.2, 70), cream = sstep(0.5, 0.56, pn), edge = Math.abs(pn - 0.53) < 0.012 ? 0.7 : 1;
      r = lerp(0.38, 0.74, cream); gg = lerp(0.36, 0.72, cream); b = lerp(0.28, 0.58, cream);
      const olive = sstep(0.36, 0.5, pn) * (1 - cream); r = lerp(r, 0.46, olive * 0.5); gg = lerp(gg, 0.50, olive * 0.5);
      const t = (0.85 + (fine - 0.5) * 0.4) * edge; r *= t; gg *= t; b *= t; h += cream * 0.15;
    } else {
      const t = 0.8 + (mid - 0.5) * 0.45 + (fine - 0.5) * 0.35;
      r = 0.50 * t; gg = 0.45 * t; b = 0.40 * t; h += (mid - 0.5) * 0.3;
    }
    hm[k] = h; col[k * 3] = r; col[k * 3 + 1] = gg; col[k * 3 + 2] = b;
  }
  const cc = document.createElement('canvas'), nc = document.createElement('canvas');
  cc.width = nc.width = W; cc.height = nc.height = H;
  const ci = cc.getContext('2d').createImageData(W, H), ni = nc.getContext('2d').createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, k = y * W + x;
    for (let q = 0; q < 3; q++) ci.data[o + q] = Math.min(255, col[k * 3 + q] * 255);
    ci.data[o + 3] = 255;
    let nx = (hm[y * W + ((x - 1 + W) % W)] - hm[y * W + ((x + 1) % W)]) * 2.2, ny = (hm[((y + 1) % H) * W + x] - hm[((y - 1 + H) % H) * W + x]) * 2.2;
    const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l;
    ni.data[o] = (nx * 0.5 + 0.5) * 255; ni.data[o + 1] = (ny * 0.5 + 0.5) * 255; ni.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; ni.data[o + 3] = 255;
  }
  cc.getContext('2d').putImageData(ci, 0, 0); nc.getContext('2d').putImageData(ni, 0, 0);
  const map = new THREE.CanvasTexture(cc), normalMap = new THREE.CanvasTexture(nc);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }
  return { map, normalMap };
}

const BROAD_SPECS = [
  // street tree: clear trunk, rounded-oval crown
  { H: 10, clear: 2.5, rx: 2.8, rzK: 1, R0: 0.15, nL: 5, nSub: 3, cards: 560, size: 1.6, seed: 101, tiles: [0, 3, 1], tint: [1.0, 1.02, 0.92], bark: 'smooth', barkCol: [0.95, 0.9, 0.86], trunkTop: 0.4, flare: 0.5 },
  // mature spreading park tree, patchy plane bark
  { H: 15, clear: 3.2, rx: 5.0, rzK: 1, R0: 0.34, nL: 7, nSub: 4, cards: 900, size: 2.0, seed: 202, tiles: [0, 2, 0], tint: [0.9, 1.0, 0.88], bark: 'plane', barkCol: [1.1, 1.08, 1.0], trunkTop: -0.05, flare: 0.6 },
  // tall narrower lime
  { H: 19, clear: 3.8, rx: 3.7, rzK: 0.95, R0: 0.24, nL: 7, nSub: 3, cards: 740, size: 1.8, seed: 303, tiles: [1, 1, 3], tint: [0.84, 1.0, 1.0], bark: 'smooth', barkCol: [0.85, 0.82, 0.8], trunkTop: 0.9, flare: 0.5 },
];

function buildBroadGeometry(S) {
  const rnd = mulberry32(S.seed), nzf = makeNoise3(S.seed + 5);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const { H } = S;
  const cy = (S.clear + H) / 2 - 0.05, ry = (H - S.clear) / 2, rx = S.rx, rz = S.rx * S.rzK;
  const lx = (rnd() - 0.5) * 0.04 * H, lz = (rnd() - 0.5) * 0.04 * H, ph = rnd() * 6;
  const tp = (y) => { const t = y / H; return V(lx * t * t + Math.sin(y * 0.5 + ph) * 0.035, y, lz * t * t + Math.cos(y * 0.43 + ph) * 0.035); };
  const yT = S.trunkTop > 0.8 ? H * 0.9 : cy + ry * S.trunkTop;
  const tr = (y) => S.R0 * (1 - 0.58 * clamp(y / yT, 0, 1)) * (1 + S.flare * Math.exp(-y / 0.55));
  const cc = tp(cy);
  const rhoRaw = (p) => Math.sqrt(((p.x - cc.x) / rx) ** 2 + ((p.y - cy) / ry) ** 2 + ((p.z - cc.z) / rz) ** 2);
  const rho = (p) => rhoRaw(p) / (1 + 0.4 * (nzf(p.x * 0.38, p.y * 0.38, p.z * 0.38, 2) - 0.5)); // lumpy outline
  const inside = (p, m) => { const r = rhoRaw(p); if (r > m) { p.x = cc.x + (p.x - cc.x) * m / r; p.y = cy + (p.y - cy) * m / r; p.z = cc.z + (p.z - cc.z) * m / r; } return p; };
  const bark = new MB(), fol = new MB();
  const bc = S.barkCol;
  // trunk
  {
    const K = 9, pts = [], rad = [];
    for (let k = 0; k < K; k++) { const y = yT * Math.pow(k / (K - 1), 1.15); pts.push(tp(y)); rad.push(tr(y)); }
    const circ = Math.PI * 2 * S.R0;
    bark.tube(pts, rad, 8, { uRep: Math.max(1, Math.round(circ / 1.0)), vScale: S.bark === 'plane' ? 2.6 : 2.0, col: bc,
      jit: (a, L) => 1 + 0.03 * Math.sin(a * 3 + L * 0.8 + ph) + 0.02 * Math.sin(a * 5 - L * 1.3) });
  }
  const bez = (a, c, b, t) => a.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(c, 2 * (1 - t) * t).addScaledVector(b, t * t);
  const subs = [];
  const up = V(0, 1, 0);
  // scaffold limbs
  for (let i = 0; i < S.nL; i++) {
    const f = (i + rnd() * 0.6) / S.nL;
    const y0 = lerp(S.clear * 0.92, Math.max(yT * 0.97, S.clear * 1.2), Math.pow(f, 0.8));
    const az = i * 2.39996 + rnd() * 0.8;
    const ty = cy + ry * lerp(-0.35, 0.82, Math.pow(f, 0.85)) + (rnd() - 0.5) * 0.8;
    const dy = (ty - cy) / ry, hr = Math.sqrt(Math.max(0.05, 1 - dy * dy));
    const R = (S.trunkTop > 0.8 ? 0.82 : 0.9) * hr * (0.8 + 0.25 * rnd());
    const E = V(cc.x + Math.cos(az) * rx * R, ty, cc.z + Math.sin(az) * rz * R);
    const p0 = tp(y0).add(V(Math.cos(az), 0, Math.sin(az)).multiplyScalar(tr(y0) * 0.6));
    const C = V(p0.x + (E.x - p0.x) * 0.3, p0.y + (E.y - p0.y) * 0.8 + 0.4, p0.z + (E.z - p0.z) * 0.3);
    const pts = [], nP = 5;
    for (let k = 0; k < nP; k++) { const q = bez(p0, C, E, k / (nP - 1)); if (k) { q.x += (rnd() - 0.5) * 0.2; q.z += (rnd() - 0.5) * 0.2; } pts.push(q); }
    const r0 = clamp(tr(y0) * 0.55, 0.03, 0.2);
    const rad = [r0, r0 * 0.78, r0 * 0.58, r0 * 0.4, r0 * 0.24];
    bark.tube(pts, rad, 4, { uRep: 1, vScale: 1.2, col: [bc[0] * 0.85, bc[1] * 0.82, bc[2] * 0.8] });
    const Ll = p0.distanceTo(E);
    // secondary branches
    for (let s = 0; s < S.nSub; s++) {
      const t = lerp(0.3, 0.88, (s + rnd() * 0.7) / S.nSub);
      const ks = t * (nP - 1), kk = Math.min(nP - 2, Math.floor(ks));
      const ps = pts[kk].clone().lerp(pts[kk + 1], ks - kk);
      const out = V(ps.x - cc.x, 0, ps.z - cc.z).normalize();
      const side = V(-out.z, 0, out.x).multiplyScalar((rnd() - 0.5) * 1.6);
      const len = Ll * lerp(0.28, 0.45, rnd()) * (1 - 0.3 * t);
      const tip = inside(ps.clone().addScaledVector(out, len * 0.7).add(side.multiplyScalar(len * 0.6)).addScaledVector(up, len * (0.1 + rnd() * 0.5)), 0.95);
      const cm = ps.clone().lerp(tip, 0.5).addScaledVector(up, len * 0.2);
      const sp = [ps, bez(ps, cm, tip, 0.4), bez(ps, cm, tip, 0.75), tip];
      const sr = r0 * lerp(0.7, 0.35, t) * 0.55;
      bark.tube(sp, [sr, sr * 0.7, sr * 0.45, sr * 0.2], 3, { uRep: 1, vScale: 0.8, col: [bc[0] * 0.78, bc[1] * 0.76, bc[2] * 0.74] });
      subs.push(sp);
    }
    subs.push(pts.slice(2)); // outer limb itself carries leaves
  }
  // foliage cards
  const trng = mulberry32(S.seed * 7 + 3);
  const tile = (k) => { const u0 = (k % 2) * 0.5, v0 = 0.5 - Math.floor(k / 2) * 0.5; return [u0 + 0.003, v0 + 0.003, u0 + 0.497, v0 + 0.497]; };
  const tint = S.tint;
  let nCards = 0;
  const card = (P, size) => {
    const dx = P.x - cc.x, dy = P.y - cy, dz = P.z - cc.z;
    let n = V(dx / (rx * rx), dy / (ry * ry), dz / (rz * rz)).normalize();
    n.y += 0.15; n.normalize();
    const rr = rho(P);
    // card normal: bent crown normal plus a lot of scatter so cards face every which way
    const cn = V(n.x + (trng() - 0.5) * 1.4, n.y + (trng() - 0.5) * 1.1, n.z + (trng() - 0.5) * 1.4).normalize();
    const ref = Math.abs(cn.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
    const t1 = new THREE.Vector3().crossVectors(cn, ref).normalize(), t2 = new THREE.Vector3().crossVectors(cn, t1);
    const roll = trng() * 6.283, ca = Math.cos(roll), sa = Math.sin(roll);
    const a = t1.clone().multiplyScalar(ca).addScaledVector(t2, sa), b = t1.clone().multiplyScalar(-sa).addScaledVector(t2, ca);
    const tl = tile(S.tiles[(trng() * S.tiles.length) | 0]);
    const jt = 0.92 + trng() * 0.2, tj = [tint[0] * jt * (0.95 + trng() * 0.1), tint[1] * jt, tint[2] * jt * (0.92 + trng() * 0.14)];
    const base = fol.vc, h = size / 2;
    for (const [sx, sy, u, v] of [[-1, -1, tl[0], tl[1]], [1, -1, tl[2], tl[1]], [-1, 1, tl[0], tl[3]], [1, 1, tl[2], tl[3]]]) {
      const x = P.x + (a.x * sx + b.x * sy) * h, y = P.y + (a.y * sx + b.y * sy) * h, z = P.z + (a.z * sx + b.z * sy) * h;
      const r2 = rho(V(x, y, z)), ddy = (y - cy) / ry;
      let ao = 0.42 + 0.58 * sstep(0.2, 1.0, (r2 + rr) * 0.5);
      ao *= lerp(0.66, 1.0, sstep(-1, 0.55, ddy));
      ao *= 1 + 0.3 * sstep(0.3, 1.0, ddy) * sstep(0.5, 1, r2);
      fol.vert(x, y, z, n.x, n.y, n.z, u, v, ao * tj[0], ao * tj[1], ao * tj[2]);
    }
    fol.i.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    nCards++;
  };
  // on branchlets (about 60 %), the rest as lumpy filler through the crown volume
  const nBr = Math.round(S.cards * 0.72);
  for (let i = 0; i < nBr; i++) {
    const sp = subs[i % subs.length];
    const t = lerp(0.35, 1, Math.pow(trng(), 0.6)), s = t * (sp.length - 1), k = Math.min(sp.length - 2, Math.floor(s));
    const P = sp[k].clone().lerp(sp[k + 1], s - k);
    P.x += (trng() - 0.5) * 0.9; P.y += (trng() - 0.5) * 0.7; P.z += (trng() - 0.5) * 0.9;
    card(inside(P, 1.02), S.size * (0.75 + trng() * 0.5));
  }
  let guard = 0;
  while (nCards < S.cards && guard++ < S.cards * 30) {
    const P = V(cc.x + (trng() * 2 - 1) * rx * 1.05, cy + (trng() * 2 - 1) * ry * 1.05, cc.z + (trng() * 2 - 1) * rz * 1.05);
    const r = rho(P);
    if (r > 1 || r < 0.5 || trng() > 0.15 + 0.85 * sstep(0.5, 0.95, r)) continue;
    if (nzf(P.x * 0.7 + 11, P.y * 0.7, P.z * 0.7, 2) < 0.46) continue; // clumps with holes
    card(P, S.size * (0.8 + trng() * 0.5));
  }
  const bg = bark.build(), fg = fol.build();
  return { bark: bg, foliage: fg, H, topY: Math.max(fg.boundingBox.max.y, H), rad: Math.max(fg.boundingBox.max.x, -fg.boundingBox.min.x, fg.boundingBox.max.z, -fg.boundingBox.min.z) };
}

function broadMaterials(shared, tex, S, bake) {
  const bt = tex.broadBark[S.bark];
  const barkM = new THREE.MeshStandardMaterial({ map: bt.map, normalMap: bt.normalMap, normalScale: new THREE.Vector2(1.0, 1.0), roughness: 0.93, metalness: 0, vertexColors: true });
  const folM = new THREE.MeshStandardMaterial({ map: tex.broad, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.82, metalness: 0, alphaToCoverage: !bake });
  if (bake) { barkM.fog = false; folM.fog = false; folM.alphaToCoverage = false; }
  const lod = bake ? null : 'near';
  // same shader options as the pines, so the programs are shared
  patch(barkM, shared, { kind: 'pbark', lod, bake, snowMode: 1 });
  patch(folM, shared, { kind: 'pfol', lod, wind: true, flut: true, windH: S.H, windAmp: 0.8, noFlip: true, transl: true, bake, snowMode: 1 });
  return [barkM, folM];
}

// ---------------------------------------------------------------- shrubs
const SHRUBS = [
  { name: 'sage', H: 1.0, seed: 301, stems: 12, leafTile: 0, tint: [0.74, 0.78, 0.58], twig: [0.45, 0.38, 0.32], size: 0.62, per: 11, rx: 0.78, ry: 0.5, glossy: false },
  { name: 'manzanita', H: 1.35, seed: 411, stems: 7, leafTile: 1, tint: [0.34, 0.46, 0.22], twig: [0.5, 0.17, 0.09], size: 0.45, per: 18, rx: 0.8, ry: 0.65, glossy: true },
];

function buildShrubGeometry(S) {
  const rnd = mulberry32(S.seed), wood = new MB(), fol = new MB();
  const cy = S.ry, ph = rnd() * 6;
  const fn = (tint) => (x, y, z, vv) => {
    const dx = x, dy = y - cy, dz = z;
    let nx = dx / (S.rx * S.rx), ny = dy / (S.ry * S.ry), nz = dz / (S.rx * S.rx);
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; ny += 0.2; const l2 = Math.hypot(nx, ny, nz); nx /= l2; ny /= l2; nz /= l2;
    const rho = Math.sqrt((dx / S.rx) ** 2 + (dy / S.ry) ** 2 + (dz / S.rx) ** 2);
    let ao = 0.35 + 0.65 * sstep(0.1, 1.0, rho);
    ao *= lerp(0.7, 1.0, sstep(0, 0.7, y / S.H));
    ao *= lerp(0.75, 1, vv);
    return [nx, ny, nz, ao * tint[0], ao * tint[1], ao * tint[2]];
  };
  const tile = S.leafTile === 0 ? [0.004, 0.004, 0.496, 0.996] : [0.504, 0.004, 0.996, 0.996];
  const stems = [];
  for (let i = 0; i < S.stems; i++) {
    const az = i * 2.4 + rnd() * 0.5, el = lerp(0.6, 1.25, rnd()), L = S.H * (0.55 + rnd() * 0.5);
    const pts = [new THREE.Vector3((rnd() - 0.5) * 0.1, 0, (rnd() - 0.5) * 0.1)];
    let a = az, e = el;
    for (let k = 0; k < 3; k++) {
      a += (rnd() - 0.5) * (S.glossy ? 0.9 : 0.4); e = clamp(e + (rnd() - 0.4) * (S.glossy ? 0.5 : 0.25), 0.25, 1.4);
      pts.push(pts[k].clone().add(new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).multiplyScalar(L / 3)));
    }
    const r0 = S.glossy ? 0.04 : 0.022;
    const sh = 0.85 + rnd() * 0.3;
    wood.tube(pts, [r0, r0 * 0.75, r0 * 0.5, r0 * 0.25], 5, { uRep: 1, vScale: 0.35, col: S.twig.map((c) => c * sh) });
    stems.push(pts);
  }
  const lrnd = mulberry32(S.seed + 5);
  const up = new THREE.Vector3(0, 1, 0);
  for (const pts of stems) {
    for (let k = 0; k < S.per; k++) {
      const t = lerp(0.35, 1, (k + lrnd() * 0.7) / S.per);
      const s = t * 3, kk = Math.min(2, Math.floor(s)), p = pts[kk].clone().lerp(pts[kk + 1], s - kk);
      const out = new THREE.Vector3(p.x, 0, p.z).normalize();
      const ax = out.clone().multiplyScalar(0.7).add(new THREE.Vector3(lrnd() - 0.5, lrnd() * 0.9 - 0.1, lrnd() - 0.5)).add(up.clone().multiplyScalar(0.5)).normalize();
      const sz = S.size * (0.8 + lrnd() * 0.5);
      const tn = [0.9 + lrnd() * 0.2, 0.9 + lrnd() * 0.2, 0.88 + lrnd() * 0.2].map((c, i) => c * S.tint[i]);
      addTuft(fol, p, ax, sz, sz * 0.9, tile, fn(tn), lrnd());
    }
  }
  return { wood: wood.build(), foliage: fol.build() };
}

function buildShrub(S, tex, shared) {
  const geo = buildShrubGeometry(S);
  const woodM = new THREE.MeshStandardMaterial({ map: S.glossy ? null : tex.bark.map, vertexColors: true, roughness: S.glossy ? 0.5 : 0.95 });
  const leafM = new THREE.MeshStandardMaterial({ map: tex.leaf, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: S.glossy ? 0.42 : 0.9, alphaToCoverage: true });
  patch(woodM, shared, { kind: 'swood' + (S.glossy ? 'g' : ''), snowMode: 1, fade: true });
  patch(leafM, shared, { kind: 'sleaf', fade: true, wind: true, flut: true, windH: S.H, windAmp: 0.4, noFlip: true, transl: true, snowMode: 1 });
  return { near: [{ geometry: geo.wood, material: woodM }, { geometry: geo.foliage, material: leafM }], far: null, height: S.H };
}

// ---------------------------------------------------------------- rocks
const ROCKS = [
  { seed: 601, ax: 0.78, ay: 0.5, az: 0.66, e: 2.7, lump: 0.2, ter: 0.05, k: 2.2, detail: 10, hoodoo: 0 },
  { seed: 612, ax: 1.5, ay: 0.68, az: 0.95, e: 3.6, lump: 0.14, ter: 0.11, k: 3.2, detail: 11, hoodoo: 0 },
  { seed: 623, ax: 0.52, ay: 1.12, az: 0.46, e: 2.5, lump: 0.1, ter: 0.07, k: 2.6, detail: 11, hoodoo: 1 },
];

function buildRock(S) {
  const nz = makeNoise3(S.seed);
  let g = new THREE.IcosahedronGeometry(1, S.detail);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const pw = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
  const ex = 2 / S.e;
  let minY = 1e9, maxY = -1e9;
  const tmp = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
    let x = pw(v.x, ex) * S.ax, y = pw(v.y, ex) * S.ay, z = pw(v.z, ex) * S.az;
    const lump = (nz(v.x * 1.4 + 3, v.y * 1.4, v.z * 1.4, 3) - 0.5) * 2 * S.lump + (nz(v.x * 3.6, v.y * 3.6 + 9, v.z * 3.6, 2) - 0.5) * 0.2 * S.lump;
    let m = 1 + lump;
    if (S.hoodoo) {
      const yn = (y / S.ay) * 0.5 + 0.5;
      m *= 1 + 0.2 * Math.sin(yn * 11 + nz(v.x * 2, v.y, v.z * 2) * 3) * 0.7 + 0.22 * sstep(0.62, 0.9, yn) - 0.18 * sstep(0.45, 0.6, yn) * (1 - sstep(0.6, 0.72, yn)) - 0.1 * (1 - yn);
    }
    // sedimentary ledges: sawtooth radial modulation by height
    const sv = y * S.k + nz(v.x * 1.7, v.y * 0.6, v.z * 1.7) * 1.4;
    const saw = sv - Math.floor(sv);
    m *= 1 + S.ter * (saw - 0.5) * 2 * (0.4 + 0.6 * Math.abs(v.y < 0 ? 0.5 : 1));
    x *= m; z *= m; y *= (1 + lump * 0.5);
    const floor = -S.ay * 0.38;
    if (y < floor) y = floor + (y - floor) * 0.12;
    tmp.push(x, y, z);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    const cav = nz(v.x * 6, v.y * 6, v.z * 6, 2);
    const c = 0.72 + 0.28 * cav;
    col[i * 3] = c; col[i * 3 + 1] = c; col[i * 3 + 2] = c * 0.99;
  }
  for (let i = 0; i < pos.count; i++) {
    const y = tmp[i * 3 + 1] - minY - 0.04;
    pos.setXYZ(i, tmp[i * 3], y, tmp[i * 3 + 2]);
    const ao = lerp(0.62, 1.0, sstep(0, 0.35, y / (maxY - minY)));
    col[i * 3] *= ao; col[i * 3 + 1] *= ao; col[i * 3 + 2] *= ao;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return { g, height: maxY - minY - 0.04 };
}

function buildRockVariant(S, shared) {
  const { g, height } = buildRock(S);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  patch(m, shared, { kind: 'rock', rock: true, bump: true, snowMode: 0, fade: true });
  return { near: [{ geometry: g, material: m }], far: null, height };
}

// ---------------------------------------------------------------- entry
export function buildAssets(renderer, shared) {
  const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const tex = { bark: makeBark(aniso), needle: makeNeedleAtlas(aniso), leaf: makeLeafAtlas(aniso) };
  tex.barkFir = makeBark(aniso, { seed: 555, cols: 9, rows: 8, plate: tone([92, 78, 70]).map((v) => v / 255), furrow: [0.14, 0.11, 0.10] });
  tex.barkDfir = makeBark(aniso, { seed: 666, cols: 6, rows: 5, plate: tone([100, 70, 52]).map((v) => v / 255), furrow: [0.11, 0.08, 0.06] });
  tex.barkJun = makeBark(aniso, { seed: 777, cols: 10, rows: 3, stretch: 2.8, plate: tone([112, 98, 86]).map((v) => v / 255), furrow: [0.16, 0.13, 0.11] });
  tex.barkAspen = makeAspenBark(aniso);
  tex.fir = makeNeedleAtlas(aniso, { seed: 4141, lo: tone([26, 52, 44]), hi: tone([62, 100, 86]), ye: [4, 6, 0], ls: 0.5, nf: 1.7, lw: 0.9 });
  tex.dfir = makeNeedleAtlas(aniso, { seed: 5252, lo: tone([30, 52, 28]), hi: tone([76, 112, 54]), ye: [14, 8, 2], ls: 0.62, nf: 1.5, lw: 1.0 });
  tex.aspen = makeAspenAtlas(aniso);
  tex.jun = makeJuniperAtlas(aniso);
  const pine = PINE_SPECS.map((S) => {
    const geo = S.juniper ? buildJuniperGeometry(S) : buildPineGeometry(S);
    const [bm, fm] = pineMaterials(shared, tex, S, false);
    const far = bakeImpostor(renderer, shared, (sh) => pineMaterials(sh, tex, S, true), S, geo);
    return {
      near: [{ geometry: geo.bark, material: bm }, { geometry: geo.foliage, material: fm }],
      far, height: S.H,
    };
  });
  const shrub = SHRUBS.map((S) => buildShrub(S, tex, shared));
  const rock = ROCKS.map((S) => buildRockVariant(S, shared));
  const tb = performance.now();
  tex.broad = makeBroadAtlas(aniso);
  tex.broadBark = { smooth: makeBroadBark(aniso, false), plane: makeBroadBark(aniso, true) };
  const broadleaf = BROAD_SPECS.map((S) => {
    const geo = buildBroadGeometry(S);
    const [bm, fm] = broadMaterials(shared, tex, S, false);
    const far = bakeImpostor(renderer, shared, (sh) => broadMaterials(sh, tex, S, true), S, geo);
    return { near: [{ geometry: geo.bark, material: bm }, { geometry: geo.foliage, material: fm }], far, height: S.H };
  });
  const out = { pine, shrub, rock, broadleaf, broadMs: performance.now() - tb };
  out.stats = () => ({
    broadleaf: broadleaf.map((v) => v.near.map((p) => triCount(p.geometry)).reduce((a, b) => a + b, 0)),
    pine: pine.map((v) => v.near.map((p) => triCount(p.geometry)).reduce((a, b) => a + b, 0)),
    shrub: shrub.map((v) => v.near.map((p) => triCount(p.geometry)).reduce((a, b) => a + b, 0)),
    rock: rock.map((v) => triCount(v.near[0].geometry)),
  });
  return out;
}
