// Rooftop and facade props for real buildings (Manhattan): water towers, bulkheads, fire escapes, awnings.
// Everything on a tile is merged into ONE vertex-coloured BufferGeometry -> a single draw call, shared material.
import * as THREE from 'three';

let MAT = null; // module singleton: callers dispose geometry only, never this
function material() {
  if (!MAT) MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.0, side: THREE.DoubleSide, flatShading: false });
  return MAT;
}

// small deterministic rng per building (mulberry32)
function rng(seed) {
  let a = (seed * 2654435761 + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _c = new THREE.Color();
const col = (hex, j = 0, r = Math.random) => { // hex with +-j brightness jitter
  _c.set(hex);
  const k = 1 + (r() - 0.5) * 2 * j;
  return [_c.r * k, _c.g * k, _c.b * k];
};

// ---- geometry accumulator -------------------------------------------------
class Acc {
  constructor() { this.p = []; this.n = []; this.c = []; }
  tri(a, b, c, col3) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) { this.n.push(nx, ny, nz); this.c.push(col3[0], col3[1], col3[2]); }
  }
  quad(a, b, c, d, col3) { this.tri(a, b, c, col3); this.tri(a, c, d, col3); }
  // oriented box: centre, three unit axes, half sizes
  obox(cx, cy, cz, ax, ay, az, hx, hy, hz, col3, skip = 0) { // skip: 1 = -y face, 2 = both x ends
    const P = (sx, sy, sz) => [
      cx + ax[0] * hx * sx + ay[0] * hy * sy + az[0] * hz * sz,
      cy + ax[1] * hx * sx + ay[1] * hy * sy + az[1] * hz * sz,
      cz + ax[2] * hx * sx + ay[2] * hy * sy + az[2] * hz * sz];
    const v = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
    this.quad(v[0], v[3], v[2], v[1], col3); this.quad(v[4], v[5], v[6], v[7], col3);
    if (!(skip & 2)) { this.quad(v[0], v[4], v[7], v[3], col3); this.quad(v[1], v[2], v[6], v[5], col3); }
    this.quad(v[3], v[7], v[6], v[2], col3);
    if (!(skip & 1)) this.quad(v[0], v[1], v[5], v[4], col3);
  }
  // axis-aligned-in-y box rotated about Y by ang
  box(cx, cy, cz, w, h, d, ang, col3, skip = 0) {
    const s = Math.sin(ang), c = Math.cos(ang);
    this.obox(cx, cy, cz, [c, 0, -s], [0, 1, 0], [s, 0, c], w / 2, h / 2, d / 2, col3, skip);
  }
  // thin beam between two points
  beam(a, b, t, col3) {
    let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const l = Math.hypot(dx, dy, dz) || 1e-3; dx /= l; dy /= l; dz /= l;
    // pick a helper not parallel to the beam
    const h = Math.abs(dy) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ux = dy * h[2] - dz * h[1], uy = dz * h[0] - dx * h[2], uz = dx * h[1] - dy * h[0];
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const wx = dy * uz - dz * uy, wy = dz * ux - dx * uz, wz = dx * uy - dy * ux;
    this.obox((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, [dx, dy, dz], [ux, uy, uz], [wx, wy, wz], l / 2, t / 2, t / 2, col3, 2); // no end caps: they sit inside joints
  }
  // frustum / cylinder with per-segment colour fn; open ends (caps omitted unless cap)
  cyl(cx, y0, cz, r0, r1, h, seg, colFn, cap) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const col3 = colFn(i);
      const A = [cx + c0 * r0, y0, cz + s0 * r0], B = [cx + c1 * r0, y0, cz + s1 * r0];
      const C = [cx + c1 * r1, y0 + h, cz + s1 * r1], D = [cx + c0 * r1, y0 + h, cz + s0 * r1];
      if (r1 < 1e-4) this.tri(A, C, B, col3); else this.quad(A, D, C, B, col3);
      if (cap) this.tri([cx, y0, cz], B, A, col3);
    }
  }
}

// ---- polygon helpers ------------------------------------------------------
function signedArea(ring) {
  let a = 0; const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += ring[j * 2] * ring[i * 2 + 1] - ring[i * 2] * ring[j * 2 + 1];
  return a / 2;
}
function inside(ring, x, z) {
  let c = false; const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2], zi = ring[i * 2 + 1], xj = ring[j * 2], zj = ring[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function edgeDist(ring, x, z) {
  let m = 1e9; const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[j * 2], az = ring[j * 2 + 1], bx = ring[i * 2], bz = ring[i * 2 + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-6;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    m = Math.min(m, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return m;
}

const has = (fam, ...keys) => keys.some((k) => fam.includes(k));

// ---- props ----------------------------------------------------------------
const WOOD = ['#6e5f4c', '#7a6a55', '#8a7a62', '#756650'];
const STEEL = '#2b2a28';

function waterTower(acc, x, y, z, r, R) {
  const rad = 2.6 + R() * 0.8, tankH = 4.5 + R() * 1.5, legH = 3 + R() * 2, roofH = 1.6 + R() * 0.6;
  const nLeg = 4, seg = 12; // cheap: 12 staves, 4 legs
  const steel = col(STEEL, 0.15, R), rot = R() * 6.28;
  const wood = col(WOOD[(R() * WOOD.length) | 0], 0.05, R);
  const ty = y + legH;
  // staves: per-segment brightness jitter gives the vertical plank stripes
  const sc = []; for (let i = 0; i < seg; i++) { const k = 0.82 + R() * 0.3; sc.push([wood[0] * k, wood[1] * k, wood[2] * k]); }
  acc.cyl(x, ty, z, rad, rad, tankH, seg, (i) => sc[i], true);
  // conical roof with a finial
  const roofCol = col('#5d5040', 0.1, R);
  acc.cyl(x, ty + tankH, z, rad + 0.15, 0, roofH, seg, () => roofCol);
  acc.box(x, ty + tankH + roofH + 0.25, z, 0.1, 0.6, 0.1, 0, steel);
  // hoops
  const nH = 2;
  for (let i = 0; i < nH; i++) acc.cyl(x, ty + tankH * ((i + 0.6) / (nH + 0.2)), z, rad + 0.07, rad + 0.07, 0.12, seg, () => steel);
  // legs + two bracing rings with X diagonals
  const lr = rad * 0.9, pts = [];
  for (let i = 0; i < nLeg; i++) { const a = rot + (i / nLeg) * 6.2832; pts.push([x + Math.cos(a) * lr, z + Math.sin(a) * lr]); }
  for (const p of pts) acc.beam([p[0], y, p[1]], [p[0], ty, p[1]], 0.22, steel);
  for (let i = 0; i < nLeg; i++) {
    const a = pts[i], b = pts[(i + 1) % nLeg];
    acc.beam([a[0], y, a[1]], [b[0], ty, b[1]], 0.08, steel); // one X per side
    acc.beam([b[0], y, b[1]], [a[0], ty, a[1]], 0.08, steel);
  }
  return rad + 0.3;
}

function bulkheads(acc, b, R, taken) {
  const { ring, top, H, area } = b, y = top;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
  const place = (w, d, margin) => {
    const half = Math.hypot(w, d) / 2 + margin;
    for (let t = 0; t < 14; t++) {
      const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
      if (!inside(ring, x, z) || edgeDist(ring, x, z) < half) continue;
      if (taken.some((q) => Math.hypot(q[0] - x, q[1] - z) < q[2] + half)) continue;
      taken.push([x, z, half]); return [x, z];
    }
    return null;
  };
  const grey = ['#8d8a84', '#7b766e', '#9a958b', '#6f6a63'];
  if (H > 120) {
    const w = (x1 - x0) * 0.4, d = (z1 - z0) * 0.4, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (inside(ring, cx, cz) && edgeDist(ring, cx, cz) > Math.min(w, d) / 2) {
      const h = 6 + R() * 5; acc.box(cx, y + h / 2, cz, Math.min(w, 30), h, Math.min(d, 30), 0, col('#7d7a75', 0.08, R));
      taken.push([cx, cz, Math.hypot(w, d) / 2]);
    }
  }
  const nB = area > 600 ? 1 + ((R() * 3) | 0) : 1 + ((R() * 2) | 0);
  for (let i = 0; i < nB; i++) {
    const w = 3 + R() * 2, d = 3 + R() * 3, h = 2.5 + R() * 1.5, p = place(w, d, 1);
    if (!p) continue;
    const ang = R() < 0.5 ? 0 : Math.PI / 2 * R() * 0;
    acc.box(p[0], y + h / 2, p[1], w, h, d, ang, col(grey[(R() * 4) | 0], 0.06, R), 1);
  }
  const nM = (R() * 3) | 0;
  for (let i = 0; i < nM; i++) { // low HVAC boxes
    const w = 1.5 + R() * 2, d = 1.2 + R() * 1.5, h = 1 + R(), p = place(w, d, 0.6);
    if (!p) continue;
    acc.box(p[0], y + h / 2, p[1], w, h, d, 0, col('#9ea3a6', 0.1, R), 1);
  }
}

function fireEscape(acc, ax, az, bx, bz, nx, nz, b, R) {
  const len = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len;
  const wFrac = 0.4 + R() * 0.2, w = len * wFrac, ctr = (0.3 + R() * 0.4) * len;
  const u0 = Math.max(0.3, ctr - w / 2), u1 = Math.min(len - 0.3, u0 + w);
  const yBot = b.gnd + 4.5, yTop = b.top - 1.5, FH = 3.2;
  const nP = Math.floor((yTop - yBot) / FH) + 1;
  if (nP < 2) return;
  const rust = R() < 0.35 ? col('#3a2a22', 0.2, R) : col('#1c1c1c', 0.25, R);
  const ang = Math.atan2(-tz, tx); // rotates local x onto t
  const P = (u, v, y) => [ax + tx * u + nx * v, y, az + tz * u + nz * v];
  const uc = (u0 + u1) / 2, pc = P(uc, 0.45, 0);
  for (let k = 0; k < nP; k++) {
    const y = yBot + k * FH;
    acc.box(pc[0], y, pc[2], u1 - u0, 0.08, 0.9, ang, rust); // grated platform as a slab
    acc.box(pc[0] + nx * 0.43, y + 0.95, pc[2] + nz * 0.43, u1 - u0, 0.05, 0.05, ang, rust, 1); // top rail only
    for (const u of [u0, u1]) { // posts only at platform ends
      const q = P(u, 0.88, y);
      acc.box(q[0], y + 0.5, q[2], 0.05, 1, 0.05, ang, rust, 1);
    }
    if (k < nP - 1) { // zig-zag stair run: one slanted slab, alternating sides
      const dir = k % 2 === 0;
      const ua = dir ? u0 + 0.5 : u1 - 0.5, ub = dir ? u1 - 0.5 : u0 + 0.5;
      const du = ub - ua, l = Math.hypot(du, FH), a = du / l, bb = FH / l;
      const m = P((ua + ub) / 2, 0.55, y + FH / 2);
      acc.obox(m[0], m[1], m[2], [tx * a, bb, tz * a], [-tx * bb, a, -tz * bb], [nx, 0, nz], l / 2, 0.04, 0.35, rust, 2);
    }
  }
}

const AWN = ['#1f4a35', '#5e1f26', '#1e2a44', '#141414', '#3b4a2a', '#6a3a1e'];
function awning(acc, ax, az, bx, bz, nx, nz, gnd, R) {
  const len = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len;
  const w = Math.min(len, 8), u0 = (len - w) / 2, u1 = u0 + w;
  const hi = gnd + 3.2 + R() * 0.8, depth = 1.2 + R() * 0.6, lo = hi - 0.7, drop = 0.35;
  const base = col(AWN[(R() * AWN.length) | 0], 0.06, R);
  const P = (u, v, y) => [ax + tx * u + nx * v, y, az + tz * u + nz * v];
  acc.quad(P(u0, 0.05, hi), P(u1, 0.05, hi), P(u1, depth, lo), P(u0, depth, lo), base); // slope
  acc.quad(P(u0, depth, lo), P(u1, depth, lo), P(u1, depth, lo - drop), P(u0, depth, lo - drop), base); // valance
  const side = [base[0] * 0.8, base[1] * 0.8, base[2] * 0.8];
  for (const u of [u0, u1]) acc.quad(P(u, 0.05, hi), P(u, depth, lo), P(u, depth, lo - drop), P(u, 0.05, lo - drop), side); // cheeks
}

const BUDGET = 30000; // hard per-tile triangle cap: past it, skip fire escapes then awnings (towers/bulkheads stay)

export function buildProps(list, opts) {
  if (!opts || opts.city !== 'manhattan' || !list || !list.length) return null;
  const acc = new Acc();
  for (const b of list) {
    const ring = b.ring;
    if (!ring || ring.length < 6 || !(b.H > 0)) continue;
    const R = rng(b.seed | 0), fam = b.fam || '';
    const brick = has(fam, 'brick', 'tenement', 'prewar');
    const oldish = brick || has(fam, 'limestone', 'deco', 'concrete');
    const flat = !(b.minH > 0);
    const taken = [];
    // 1. water tower
    if (flat && oldish && b.H >= 18 && b.H <= 110 && b.area >= 150 && R() < 0.45) {
      let cx = 0, cz = 0; const n = ring.length / 2;
      for (let i = 0; i < n; i++) { cx += ring[i * 2]; cz += ring[i * 2 + 1]; }
      cx /= n; cz /= n;
      const vi = (R() * n) | 0, vx = ring[vi * 2], vz = ring[vi * 2 + 1];
      for (let t = 0; t < 12; t++) {
        const f = 0.95 - t * 0.07, x = cx + (vx - cx) * f, z = cz + (vz - cz) * f;
        if (inside(ring, x, z) && edgeDist(ring, x, z) >= 4.2) { taken.push([x, z, waterTower(acc, x, b.top, z, 0, R)]); break; }
      }
    }
    // 2. bulkheads / mechanical
    if (flat && b.H >= 10 && b.area >= 80 && (b.H > 120 || R() < 0.9)) bulkheads(acc, b, R, taken);
    // edge loops
    const wantFE = brick && b.H >= 10 && b.H <= 40;
    const wantAw = (b.cls >= 1 && b.cls <= 3 || oldish) && b.H <= 60;
    if (!wantFE && !wantAw) continue;
    const sgn = signedArea(ring) >= 0 ? 1 : -1, n = ring.length / 2, edges = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = ring[j * 2], az = ring[j * 2 + 1], bx = ring[i * 2], bz = ring[i * 2 + 1];
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 5) continue;
      edges.push({ ax, az, bx, bz, l, nx: ((bz - az) / l) * sgn, nz: (-(bx - ax) / l) * sgn });
    }
    if (wantFE && flat && R() < 0.45 && acc.p.length / 9 < BUDGET) { // one edge: the longest 6-25 m one
      let e = null;
      for (const q of edges) if (q.l >= 6 && q.l <= 25 && (!e || q.l > e.l)) e = q;
      if (e) fireEscape(acc, e.ax, e.az, e.bx, e.bz, e.nx, e.nz, b, R);
    }
    if (wantAw) for (const e of edges) if (R() < 0.35 && acc.p.length / 9 < BUDGET) awning(acc, e.ax, e.az, e.bx, e.bz, e.nx, e.nz, b.gnd, R);
  }
  if (!acc.p.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(acc.c, 3));
  g.computeBoundingSphere(); g.computeBoundingBox();
  const mesh = new THREE.Mesh(g, material());
  mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = true; mesh.name = 'buildingPropsMesh';
  const grp = new THREE.Group(); grp.name = 'buildingProps'; grp.add(mesh);
  grp.userData.tris = acc.p.length / 9;
  return grp;
}
