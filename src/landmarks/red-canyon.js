// Red Canyon's two rock-arch tunnels on Utah SR-12 and Bryce's Natural Bridge.
// Each rock mass is an implicit surface (a thick fin, a rough arch bored through it, a few spires) polygonised
// with marching cubes, so the inner walls, the fin and the spires are one seamless, noisy skin. The skin is
// built lazily, the first time the terrain around a site is loaded, and its base is clipped to the terrain.
import * as THREE from 'three';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';
import { patch } from '../assets.js';

const MESH_Y = 40; // geometry is stored 40 m above its mesh origin so the rock shader's "soil" band stays out of view

// ---------------------------------------------------------------- noise
const hash3 = (x, y, z) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, iy, iz), b = hash3(ix + 1, iy, iz), c = hash3(ix, iy + 1, iz), d = hash3(ix + 1, iy + 1, iz);
  const e = hash3(ix, iy, iz + 1), f = hash3(ix + 1, iy, iz + 1), g = hash3(ix, iy + 1, iz + 1), h = hash3(ix + 1, iy + 1, iz + 1);
  const x0 = a + (b - a) * fx, x1 = c + (d - c) * fx, x2 = e + (f - e) * fx, x3 = g + (h - g) * fx;
  const y0 = x0 + (x1 - x0) * fy, y1 = x2 + (x3 - x2) * fy;
  return y0 + (y1 - y0) * fz;
}
const fbm = (x, y, z) => vnoise(x, y, z) * 0.6 + vnoise(x * 2.13 + 3.1, y * 2.13, z * 2.13) * 0.3 + vnoise(x * 4.4 + 7.7, y * 4.4, z * 4.4) * 0.1;
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- site descriptions
// Local frame: u across the opening (along the fin), w through it, y up from the opening's floor.
const SITES = [
  { id: 'A', kind: 'tunnel', lat: 37.740915, lon: -112.29938, s0: 9915, L: 10, Hu: 30, H: 30, vHalf: 5.9, vTop: 7.6, vR: 3.6, flare: 6, res: 1.25, seed: 11, tint: [0.95, 0.6, 0.5],
    spires: [[-12, -8, 13, 2.6], [-18.5, 6, 18, 3.2], [13, 8, 10, 2.3], [21, -7, 15, 2.9], [10, -13, 7, 2.0]], pines: 12 },
  { id: 'B', kind: 'tunnel', lat: 37.74044, lon: -112.29783, s0: 10065, L: 20, Hu: 34, H: 34, vHalf: 5.9, vTop: 7.7, vR: 3.6, flare: 5, res: 1.3, seed: 23, tint: [0.98, 0.58, 0.47],
    spires: [[-13, -12, 15, 2.8], [-20, 9, 20, 3.4], [14, 12, 11, 2.4], [22, -10, 17, 3.0], [11, -17, 8, 2.1], [-9, 16, 9, 2.0]], pines: 14 },
  { id: 'NB', kind: 'bridge', overlook: [37.53185, -112.26019], bearing: 112, dist: 150, L: 13, Hu: 27, H: 40, vHalf: 8, vTop: 25, vR: 8, flare: 4, res: 2.1, seed: 37, tint: [1.0, 0.78, 0.66],
    spires: [], pines: 10 },
];

// ---------------------------------------------------------------- material
function rockMaterial(shared) {
  const sh = { uTime: { value: 0 }, uWet: { value: 0 }, uSnow: { value: 0 }, uLodDist: { value: 1e9 }, ...(shared || {}) };
  const m = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0, vertexColors: true });
  patch(m, sh, { kind: 'rcarch', rock: true, bump: true, snowMode: 0 });
  const prev = m.onBeforeCompile;
  // stretch the rock palette bands a little (strata ~1 m thick rather than 0.3 m)
  m.onBeforeCompile = (shader, r) => {
    prev(shader, r);
    shader.vertexShader = shader.vertexShader.replace('vOP = position;', 'vOP = position * vec3(0.5, 0.17, 0.5);');
    // calmer banding: pull the palette towards its mean so the strata read as subtle bands, not stripes
    shader.fragmentShader = shader.fragmentShader.replace('diffuseColor.rgb = ldRock(vOP) * vColor.rgb;', 'diffuseColor.rgb = mix(vec3(0.62, 0.31, 0.17), ldRock(vOP), 0.5) * vColor.rgb;');
  };
  return m;
}

// ---------------------------------------------------------------- the implicit rock
// returns { dist(u, w, ly), vd(u, ly) (void distance), frame data } for a site resolved against the terrain
function makeField(S, th /* (u,w) -> terrain height in local y */) {
  const { Hu, H, L, vHalf, vTop, vR, flare, seed } = S;
  const so = seed * 13.7;
  const R = 3.0;
  const T0 = L + 3.0;
  const vy0 = (vTop - 200) / 2, vhh = (vTop + 200) / 2;
  const voidD = (u, ly) => {
    const qx = Math.abs(u) - (vHalf - vR), qy = Math.abs(ly - vy0) - (vhh - vR);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - vR;
  };
  const spires = S.spires.map(([u, w, h, r]) => ({ u, w, h, r, base: th(u, w) }));
  const dist = (u, w, ly, parts) => {
    const au = Math.abs(u), aw = Math.abs(w);
    const yy = Math.max(0, ly) / H;
    const T = Math.max(9.5, (T0 + Math.min(flare, Math.max(0, au - vHalf - 1) * 0.5)) * (1 - 0.2 * yy) + 2.2 * (vnoise(u * 0.11 + so, ly * 0.08, 5.0) - 0.5));
    const top = H * (1 - 0.5 * Math.pow(Math.min(1, au / Hu), 2)) + 7.0 * (fbm(u * 0.09 + so, 1.7, w * 0.09) - 0.5) + 3.0 * Math.abs(vnoise(u * 0.23, 2.0, so) - 0.5);
    const sdW = aw - T * 0.5;
    const sdU = au - Hu * (1 - 0.3 * yy) + 11.0 * (vnoise(u * 0.06 + so, ly * 0.1, w * 0.1) - 0.5);
    const sdY = ly - top;
    const qa = sdW + R, qb = sdU + R, qc = sdY + R;
    let d = Math.hypot(Math.max(qa, 0), Math.max(qb, 0), Math.max(qc, 0)) + Math.min(Math.max(qa, qb, qc), 0) - R;
    // surface roughness: big lumps, medium blocks, strata ledges
    d += (fbm(u * 0.13 + so, ly * 0.11, w * 0.13) - 0.5) * 5.0 + (vnoise(u * 0.5, ly * 0.45 + so, w * 0.5) - 0.5) * 2.4 + (0.5 - Math.abs(vnoise(u * 0.28 + 4, ly * 0.12 + so, w * 0.28) - 0.5)) * -3.2 + (vnoise(u * 1.3, ly * 1.0, w * 1.3 + so) - 0.5) * 0.8 + (vnoise(u * 0.62 + so, ly * 0.09, w * 0.62) - 0.5) * 1.3 + (vnoise(u * 0.18, ly * 1.1 + so, w * 0.18) - 0.5) * 0.9;
    // arch opening: the rock may only recede, never intrude
    const vd0 = voidD(u, ly);
    const bump = Math.min(1, Math.max(0, fbm(u * 0.35 + so, ly * 0.35, w * 0.35) * 1.6 - 0.2));
    const vd = vd0 - 1.4 * bump;
    let r = Math.max(d, -vd);
    for (const sp of spires) {
      const rr = sp.r * (1 - 0.5 * Math.min(1, Math.max(0, (ly - sp.base) / sp.h))) + 0.9 * (vnoise(u * 0.4 + so, ly * 0.2, w * 0.4) - 0.5);
      const radial = Math.hypot(u - sp.u, w - sp.w) - rr;
      const sd = Math.max(radial, ly - (sp.base + sp.h) + 1.5) + (vnoise(u * 0.9, ly * 0.5 + so, w * 0.9) - 0.5) * 0.7;
      r = Math.min(r, sd);
    }
    if (parts) { parts.vd = vd0; }
    return r;
  };
  return { dist, voidD };
}

// ---------------------------------------------------------------- polygonise
const CORN = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const EDGE = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

function buildSite(S, F, ctx) {
  // F = { x0, y0, z0, tx, tz, nx, nz, slope }
  const { x0, y0, z0, tx, tz, nx, nz, slope } = F;
  const toLocal = (x, z) => { const dx = x - x0, dz = z - z0; return [dx * nx + dz * nz, dx * tx + dz * tz]; };
  const hW = (u, w) => { const x = x0 + u * nx + w * tx, z = z0 + u * nz + w * tz; return ctx.terrain.heightAt(x, z) - y0 - slope * w; };
  // terrain grid over the footprint
  const Wh = (S.L + 1 + S.flare) / 2 + 16, Uh = S.Hu + 8;
  const G = 3, gu = Math.ceil((2 * Uh) / G) + 1, gw = Math.ceil((2 * Wh) / G) + 1;
  const tg = new Float32Array(gu * gw);
  let tmin = 1e9, tmax = -1e9;
  for (let j = 0; j < gw; j++) for (let i = 0; i < gu; i++) {
    let h = hW(-Uh + i * G, -Wh + j * G);
    if (!Number.isFinite(h)) h = 0;
    tg[j * gu + i] = h; tmin = Math.min(tmin, h); tmax = Math.max(tmax, h);
  }
  const th = (u, w) => {
    const fu = Math.min(gu - 1.001, Math.max(0, (u + Uh) / G)), fw = Math.min(gw - 1.001, Math.max(0, (w + Wh) / G));
    const i = Math.floor(fu), j = Math.floor(fw), a = fu - i, b = fw - j;
    const k = j * gu + i;
    return (tg[k] * (1 - a) + tg[k + 1] * a) * (1 - b) + (tg[k + gu] * (1 - a) + tg[k + gu + 1] * a) * b;
  };
  const field = makeField(S, th);
  const res = S.res;
  const ymin = tmin - 4, ymax = S.H + 9;
  const nxg = Math.ceil((2 * Uh) / res) + 1, nyg = Math.ceil((ymax - ymin) / res) + 1, nzg = Math.ceil((2 * Wh) / res) + 1;
  const val = new Float32Array(nxg * nyg * nzg);
  const idx = (i, j, k) => (k * nyg + j) * nxg + i;
  for (let k = 0; k < nzg; k++) {
    const w = -Wh + k * res;
    for (let i = 0; i < nxg; i++) {
      const u = -Uh + i * res, floor = th(u, w) - 6;
      for (let j = 0; j < nyg; j++) {
        const ly = ymin + j * res;
        let d = field.dist(u, w, ly);
        d = Math.max(d, floor - ly);
        // close the grid boundary so the surface is watertight
        if (i === 0 || j === nyg - 1 || k === 0 || i === nxg - 1 || k === nzg - 1) d = Math.max(d, 0.5);
        val[idx(i, j, k)] = d;
      }
    }
  }
  const grad = (i, j, k, out) => {
    const i0 = Math.max(0, i - 1), i1 = Math.min(nxg - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(nyg - 1, j + 1), k0 = Math.max(0, k - 1), k1 = Math.min(nzg - 1, k + 1);
    out[0] = val[idx(i1, j, k)] - val[idx(i0, j, k)]; out[1] = val[idx(i, j1, k)] - val[idx(i, j0, k)]; out[2] = val[idx(i, j, k1)] - val[idx(i, j, k0)];
  };

  const pos = [], nor = [], col = [];
  const cv = new Float32Array(8), cp = new Array(8), cg = [new Float32Array(3), new Float32Array(3)];
  const ev = new Array(12), en = new Array(12);
  const g0 = new Float32Array(3), g1 = new Float32Array(3);
  const tc = S.tint;
  const pushVertex = (lu, ly, lw, n) => {
    // local (u, ly, w) -> world-relative, with the pitch shear
    const wy = ly + slope * lw;
    const lx = lu * nx + lw * tx, lz = lu * nz + lw * tz;
    pos.push(lx, wy + MESH_Y, lz);
    // normal: rotate the same way, undo shear approximately
    let a = n[0], b = n[1] - slope * n[2], c = n[2];
    const nxw = a * nx + c * tx, nzw = a * nz + c * tz;
    const l = Math.hypot(nxw, b, nzw) || 1;
    nor.push(nxw / l, b / l, nzw / l);
    // colour: tint x weathering streaks (long vertical), darker inside the opening and low down
    const streak = vnoise(lu * 0.55 + 9, ly * 0.045, lw * 0.55);
    const fine = vnoise(lu * 2.2, ly * 0.3, lw * 2.2 + 5);
    let sh = 0.68 + 0.5 * streak + 0.14 * (fine - 0.5);
    const vd = field.voidD(lu, ly);
    const inside = Math.abs(lw) < (S.L + 4) / 2 + 2 ? Math.max(0, 1 - Math.max(0, vd) / 2.5) : 0;
    sh *= 1 - 0.28 * inside;
    sh *= 0.72 + 0.28 * Math.min(1, Math.max(0, (ly + 3) / 10));
    // paler capstone / ledge bands near the top
    const pale = Math.max(0, Math.min(1, (ly - S.H * 0.55) / (S.H * 0.45))) * 0.12;
    col.push(tc[0] * sh * (1 + pale), tc[1] * sh * (1 + pale * 1.5), tc[2] * sh * (1 + pale * 1.7));
  };
  const tmpN = [0, 0, 0];
  const pv = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], pn = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < nzg - 1; k++) for (let j = 0; j < nyg - 1; j++) for (let i = 0; i < nxg - 1; i++) {
    let ci = 0;
    for (let c = 0; c < 8; c++) { const o = CORN[c]; cv[c] = val[idx(i + o[0], j + o[1], k + o[2])]; if (cv[c] < 0) ci |= 1 << c; }
    const em = edgeTable[ci];
    if (em === 0) continue;
    for (let e = 0; e < 12; e++) {
      if (!(em & (1 << e))) continue;
      const [a, b] = EDGE[e], oa = CORN[a], ob = CORN[b];
      const va = cv[a], vb = cv[b], t = Math.abs(va - vb) < 1e-6 ? 0.5 : va / (va - vb);
      ev[e] = [-Uh + (i + oa[0] + (ob[0] - oa[0]) * t) * res, ymin + (j + oa[1] + (ob[1] - oa[1]) * t) * res, -Wh + (k + oa[2] + (ob[2] - oa[2]) * t) * res];
      grad(i + oa[0], j + oa[1], k + oa[2], g0); grad(i + ob[0], j + ob[1], k + ob[2], g1);
      const nn = [g0[0] + (g1[0] - g0[0]) * t, g0[1] + (g1[1] - g0[1]) * t, g0[2] + (g1[2] - g0[2]) * t];
      const l = Math.hypot(nn[0], nn[1], nn[2]) || 1;
      en[e] = [nn[0] / l, nn[1] / l, nn[2] / l];
    }
    const row = triTable.subarray ? triTable.subarray(ci * 16, ci * 16 + 16) : triTable.slice(ci * 16, ci * 16 + 16);
    for (let q = 0; row[q] !== -1 && q < 16; q += 3) {
      const e0 = row[q], e1 = row[q + 1], e2 = row[q + 2];
      const A = ev[e0], B = ev[e1], C = ev[e2];
      // drop triangles that sit entirely below the terrain (they are hidden anyway)
      if (A[1] < th(A[0], A[2]) - 3.5 && B[1] < th(B[0], B[2]) - 3.5 && C[1] < th(C[0], C[2]) - 3.5) continue;
      // floor skin: downward-facing triangles whose lowest corner is well under the terrain are never seen
      if (en[e0][1] < -0.45 && Math.min(A[1] - th(A[0], A[2]), B[1] - th(B[0], B[2]), C[1] - th(C[0], C[2])) < -3.5) continue;
      // wind to agree with the field gradient
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      const fnx = uy * vz - uz * vy, fny = uz * vx - ux * vz, fnz = ux * vy - uy * vx;
      const gn = en[e0];
      const flip = fnx * gn[0] + fny * gn[1] + fnz * gn[2] < 0;
      // (u, y, w) is right-handed with +w forward only up to a mirror: the world mapping has det of the opposite sign, so flip once more
      const order = flip ? [e0, e2, e1] : [e0, e1, e2];
      for (const e of order) pushVertex(ev[e][0], ev[e][1], ev[e][2], en[e]);
    }
  }
  // the (u, w) -> (x, z) map is a reflection (n = right of t), which reverses winding: swap every pair back
  const nv = pos.length / 3;
  for (let v = 0; v + 2 < nv; v += 3) {
    for (let c = 0; c < 3; c++) {
      const a = (v + 1) * 3 + c, b = (v + 2) * 3 + c;
      for (const arr of [pos, nor, col]) { const t = arr[a]; arr[a] = arr[b]; arr[b] = t; }
    }
  }
  void tmpN; void pv; void pn; void cg;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  // pines on top of the fin (and a few at its base)
  const R = rng(S.seed * 101 + 7);
  const pines = [];
  const topY = (u, w) => { for (let ly = S.H + 8; ly > 0; ly -= 0.5) { if (field.dist(u, w, ly) < 0) return ly; } return -1e9; };
  let tries = 0;
  while (pines.length < S.pines && tries++ < 400) {
    const u = (R() * 2 - 1) * S.Hu * 0.72, w = (R() * 2 - 1) * ((S.L + 1) / 2 - 1.5);
    if (S.kind === 'tunnel' && Math.abs(u) < S.vHalf + 1.5 && pines.length < S.pines - 3) { /* over the opening: rock roof, fine */ }
    const y = topY(u, w);
    if (y < S.H * 0.35) continue;
    // the top surface must be fairly flat there
    if (Math.abs(topY(u + 1.5, w) - y) > 1.8 || Math.abs(topY(u - 1.5, w) - y) > 1.8) continue;
    pines.push({ u, w, y: y - 0.3, h: 6 + R() * 7 });
  }
  return { geo, F, pines, toLocal, tmin };
}

// ---------------------------------------------------------------- pines (low-poly conifers, one buffer for all sites)
const PINE_TRIS = 14 + 3 * 14; // trunk 7 quads (14 tris) + 3 cone stacks of 7 sides, each 7 side + 7 base = 14
function pineInto(out, o, x, y, z, h, rnd) {
  const tone = 0.85 + rnd() * 0.3;
  const push = (px, py, pz, nx, ny, nz, c) => { out.p.push(px, py, pz); out.n.push(nx, ny, nz); out.c.push(c[0], c[1], c[2]); };
  const trunk = [0.28, 0.2, 0.15];
  const seg = 7, tr = 0.22 + h * 0.012;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const p = (a, b, yy) => [x + a * tr * (1 - yy / h * 0.6), y + yy, z + b * tr * (1 - yy / h * 0.6)];
    const A = p(c0, s0, 0), B = p(c1, s1, 0), C = p(c1, s1, h * 0.5), D = p(c0, s0, h * 0.5);
    for (const [P, Q] of [[A, 0], [B, 0]]) { void P; void Q; }
    const nm0 = [c0, 0, s0], nm1 = [c1, 0, s1];
    push(...A, ...nm0, trunk); push(...B, ...nm1, trunk); push(...C, ...nm1, trunk);
    push(...A, ...nm0, trunk); push(...C, ...nm1, trunk); push(...D, ...nm0, trunk);
  }
  for (let t = 0; t < 3; t++) {
    const y0 = y + h * (0.22 + t * 0.26), hh = h * (0.5 - t * 0.08), r = h * (0.30 - t * 0.075);
    const col = [0.045 * tone, (0.12 - t * 0.008) * tone, 0.05 * tone];
    const apex = [x, y0 + hh, z];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const P0 = [x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r], P1 = [x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r];
      const am = (a0 + a1) / 2, nn = [Math.cos(am) * hh, r, Math.sin(am) * hh], l = Math.hypot(...nn);
      const n = [nn[0] / l, nn[1] / l, nn[2] / l];
      push(...P1, ...n, col); push(...P0, ...n, col); push(...apex, ...n, col);
      push(...P0, 0, -1, 0, col); push(...P1, 0, -1, 0, col); push(x, y0 - 0.01, z, 0, -1, 0, col);
    }
  }
  void o;
}

// ---------------------------------------------------------------- landmark
export const RED_CANYON = {
  id: 'red-canyon-arches', kind: 'ambient', local: true, cooldown: 1,
  possible: (ctx) => ctx.place?.id === 'bryce' && !!ctx.world && !!ctx.geo && !!ctx.route && !!ctx.terrain?.heightAt,
  chance: () => 1,
  create(ctx) {
    const group = new THREE.Group(); group.name = 'redCanyonArches';
    ctx.world.add(group);
    const mat = rockMaterial(ctx.shared);
    const pineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const PINES_PER = 16, slotTris = PINES_PER * PINE_TRIS;
    const pinePos = new Float32Array(SITES.length * slotTris * 9), pineNor = new Float32Array(SITES.length * slotTris * 9), pineCol = new Float32Array(SITES.length * slotTris * 9);
    const pineGeo = new THREE.BufferGeometry();
    for (const [n, a] of [['position', pinePos], ['normal', pineNor], ['color', pineCol]]) pineGeo.setAttribute(n, new THREE.BufferAttribute(a, 3));
    const pineMesh = new THREE.Mesh(pineGeo, pineMat);
    pineMesh.frustumCulled = false; pineMesh.castShadow = true; pineMesh.receiveShadow = false;
    pineGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    let pineUsed = false;

    // resolve frames (position / orientation) once
    const frames = SITES.map((S) => {
      const P = {};
      if (S.kind === 'tunnel') {
        const x = ctx.geo.x(S.lon), z = ctx.geo.z(S.lat);
        let best = S.s0, bd = Infinity;
        for (let s = S.s0 - 300; s <= S.s0 + 300; s += 1) { ctx.route.sample(s, P); const d = (P.x - x) ** 2 + (P.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
        const a = {}, b = {}, m = {};
        ctx.route.sample(best - S.L / 2, a); ctx.route.sample(best + S.L / 2, b); ctx.route.sample(best, m);
        let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        return { S, x0: m.x, y0: m.y, z0: m.z, tx, tz, nx: -tz, nz: tx, slope: (b.y - a.y) / (S.L), s: best };
      }
      const ox = ctx.geo.x(S.overlook[1]), oz = ctx.geo.z(S.overlook[0]);
      const br = (S.bearing * Math.PI) / 180;
      const x0 = ox + Math.sin(br) * S.dist, z0 = oz - Math.cos(br) * S.dist;
      // the opening looks back at the overlook
      let tx = ox - x0, tz = oz - z0; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
      return { S, x0, z0, y0: NaN, tx, tz, nx: -tz, nz: tx, slope: 0, s: -1 };
    });
    const built = new Array(SITES.length).fill(false);
    const meshes = [];
    let clock = 0;

    const ready = (F) => {
      const hs = [[0, 0], [30, 0], [-30, 0], [0, 25], [0, -25]].map(([u, w]) => ctx.terrain.heightAt(F.x0 + u * F.nx + w * F.tx, F.z0 + u * F.nz + w * F.tz));
      return hs.every(Number.isFinite);
    };
    const tryBuild = (i) => {
      const F = frames[i], S = F.S;
      if (!ready(F)) return false;
      if (S.kind === 'bridge' && !F.picked) {
        // choose the spot (ESE of the overlook, 110-190 m out) the overlook sees best: clear line of sight to the arch base and top
        const ox = ctx.geo.x(S.overlook[1]), oz = ctx.geo.z(S.overlook[0]);
        const hy = (x, z) => ctx.terrain.heightAt(x, z);
        const eye = hy(ox, oz) + 2;
        let best = null;
        for (let b = 80; b <= 150; b += 5) for (let d = 110; d <= 190; d += 10) {
          const br = (b * Math.PI) / 180, x = ox + Math.sin(br) * d, z = oz - Math.cos(br) * d, g = hy(x, z);
          if (!Number.isFinite(g) || g > eye - 12) continue;
          let clear = 1e9;
          for (const tgt of [g + 3, g + 14]) for (let k = 1; k < 20; k++) {
            const t = k / 20, sx = ox + (x - ox) * t, sz = oz + (z - oz) * t, ray = eye + (tgt - eye) * t;
            clear = Math.min(clear, ray - hy(sx, sz));
          }
          const score = Math.min(clear, 4) * 10 - Math.abs(b - 112) * 0.15 - Math.abs(d - 150) * 0.05;
          if (!best || score > best.score) best = { score, x, z, clear, b, d };
        }
        if (best) {
          F.x0 = best.x; F.z0 = best.z; F.picked = best;
          let tx = ox - F.x0, tz = oz - F.z0; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
          F.tx = tx; F.tz = tz; F.nx = -tz; F.nz = tx;
        }
      }
      if (S.kind === 'bridge') {
        // arch floor sits on the slope; pitch follows the ground along the opening
        const h0 = ctx.terrain.heightAt(F.x0, F.z0);
        const hb = ctx.terrain.heightAt(F.x0 - F.tx * 6, F.z0 - F.tz * 6), hf = ctx.terrain.heightAt(F.x0 + F.tx * 6, F.z0 + F.tz * 6);
        F.y0 = h0 - 0.5; F.slope = (hf - hb) / 12;
      }
      const r = buildSite(S, F, ctx);
      const mesh = new THREE.InstancedMesh(r.geo, mat, 1);
      mesh.setMatrixAt(0, new THREE.Matrix4()); mesh.instanceMatrix.needsUpdate = true;
      mesh.position.set(F.x0, F.y0 - MESH_Y, F.z0);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = true; mesh.name = 'rcarch' + S.id;
      mesh.updateMatrixWorld(true);
      group.add(mesh); meshes.push(mesh);
      // pines into this site's slot
      const rnd = rng(S.seed * 31 + 5), out = { p: [], n: [], c: [] };
      for (const p of r.pines.slice(0, PINES_PER)) {
        const wx = F.x0 + p.u * F.nx + p.w * F.tx, wz = F.z0 + p.u * F.nz + p.w * F.tz, wy = F.y0 + p.y + F.slope * p.w;
        pineInto(out, null, wx, wy, wz, p.h, rnd);
      }
      const off = i * slotTris * 9;
      pinePos.set(out.p, off); pineNor.set(out.n, off); pineCol.set(out.c, off);
      for (const n of ['position', 'normal', 'color']) pineGeo.attributes[n].needsUpdate = true;
      if (!pineUsed) { group.add(pineMesh); pineUsed = true; }
      mesh.userData.tris = r.geo.attributes.position.count / 3;
      return true;
    };

    return {
      update(dt, c) {
        clock += dt;
        if (clock < 0.7) return true;
        clock = 0;
        const cam = c.camera?.position;
        if (!cam) return true;
        for (let i = 0; i < SITES.length; i++) {
          if (built[i]) continue;
          const F = frames[i];
          if (Math.hypot(cam.x - F.x0, cam.z - F.z0) > 1100) continue;
          if (tryBuild(i)) { built[i] = true; break; } // one per tick
        }
        return true;
      },
      dispose() {
        group.removeFromParent();
        for (const m of meshes) m.geometry.dispose();
        pineGeo.dispose(); pineMat.dispose(); mat.dispose();
      },
    };
  },
};
