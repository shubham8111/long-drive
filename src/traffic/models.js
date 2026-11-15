// Procedural vehicle bodies for traffic.js. Original generic designs: no makes, badges or liveries.
// Model space: metres, +y up, forward = +Z, the vehicle's left is +X, origin on the ground at the centre.
// Every vertex carries: colour, aSurf = (metalness, roughness, lamp kind, paint flag) and aWheel = (is wheel, centre y, centre z).
// lamp kind: 1 headlamp, 2 tail lamp, 3 roof lamp.  paint flag 1 = tinted by the per-vehicle paint colour.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const M = {
  paint: [0.18, 0.42, 0, 1], glass: [0.55, 0.07, 0, 0], chrome: [1, 0.22, 0, 0], rubber: [0, 0.92, 0, 0], plastic: [0, 0.65, 0, 0],
  head: [0, 0.18, 1, 0], tail: [0, 0.3, 2, 0], roofLamp: [0, 0.3, 3, 0], fixed: [0.25, 0.45, 0, 0], rim: [0.5, 0.5, 0, 0],
};
const C = { glass: 0x0d1419, rubber: 0x101010, plastic: 0x16181a, white: 0xdad8d2, rim: 0x70747a, black: 0x0b0b0c, grey: 0x6f7378, head: 0xf3edd9, tail: 0x7c1212, amber: 0xffc860, chrome: 0xd8dade };

class VB {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.surf = []; this.wh = []; this.idx = []; this.n = 0; }
  add(geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}, color = 0xffffff, mat = M.paint, wheel = null) {
    const g = geo.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'YXZ')), new THREE.Vector3(...s)));
    const P = g.attributes.position, N = g.attributes.normal, c = new THREE.Color(color);
    for (let i = 0; i < P.count; i++) {
      this.pos.push(P.getX(i), P.getY(i), P.getZ(i)); this.nor.push(N.getX(i), N.getY(i), N.getZ(i));
      this.col.push(c.r, c.g, c.b); this.surf.push(mat[0], mat[1], mat[2], mat[3]);
      this.wh.push(wheel ? 1 : 0, wheel ? wheel[0] : 0, wheel ? wheel[1] : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(this.n + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(this.n + i);
    this.n += P.count;
    geo.dispose(); g.dispose();
    return this;
  }
  box(w, h, d, p, color, mat, r) { return this.add(new THREE.BoxGeometry(w, h, d), { p, r }, color, mat); }
  // flat-ish rounded box (superellipse section) lofted along z
  loft(stations, color, mat, o = {}) { return this.add(loftGeo(stations, o.seg || 14, o.e || 4), {}, color, mat); }
  cylX(r, w, p, color, mat, wheel, seg = 18) { const g = new THREE.CylinderGeometry(r, r, w, seg); g.rotateZ(Math.PI / 2); return this.add(g, { p }, color, mat, wheel); }
  limb(a, b, ra, rb, color, mat, seg = 6) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = A.clone().sub(B), len = d.length();
    const g = new THREE.CylinderGeometry(ra, rb, len, seg);
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), 'YXZ');
    return this.add(g, { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], r: [e.x, e.y, e.z] }, color, mat);
  }
  // wheel pair-side: tyre, rim, spokes; centre (x, r, z), outward = sign of x
  wheel(x, R, z, wid = 0.22) {
    const wh = [R, z], sg = Math.sign(x) || 1;
    this.cylX(R, wid, [x, R, z], C.rubber, M.rubber, wh, 20);
    this.cylX(R * 0.64, wid + 0.012, [x, R, z], C.rim, M.rim, wh, 16);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      this.add(new THREE.BoxGeometry(0.02, R * 0.5, R * 0.14), { p: [x + sg * (wid / 2 + 0.012), R + Math.cos(a) * R * 0.32, z + Math.sin(a) * R * 0.32], r: [-a, 0, 0] }, 0x2a2c2e, M.plastic, wh);
    }
    this.cylX(R * 0.17, wid + 0.03, [x, R, z], C.chrome, M.chrome, wh, 8);
  }
  arch(x, R, z) { // dark wheel-arch shadow on the body side so the wheel reads as sitting in a cut-out
    const sg = Math.sign(x) || 1;
    this.cylX(R * 1.16, 0.02, [sg * (Math.abs(x) - 0.04), R, z], 0x060606, M.plastic, null, 18);
  }
  done() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.surf, 4));
    g.setAttribute('aWheel', new THREE.Float32BufferAttribute(this.wh, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function loftGeo(st, seg, expo) {
  const pos = [], idx = [];
  const ring = (s, k) => {
    const a = (k / seg) * TAU, c = Math.cos(a), sn = Math.sin(a), e = 2 / (s.e || expo);
    return [s.w * Math.sign(c) * Math.pow(Math.abs(c), e), (s.y0 + s.y1) / 2 + ((s.y1 - s.y0) / 2) * Math.sign(sn) * Math.pow(Math.abs(sn), e), s.z];
  };
  for (const s of st) for (let k = 0; k < seg; k++) pos.push(...ring(s, k));
  for (let i = 0; i < st.length - 1; i++)
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k, b = i * seg + ((k + 1) % seg), c = (i + 1) * seg + k, d = (i + 1) * seg + ((k + 1) % seg);
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // build capped geometry in one go
  const P2 = [], N2 = [], I2 = [];
  const pa = g.attributes.position.array, na = g.attributes.normal.array;
  for (let i = 0; i < pa.length; i++) { P2.push(pa[i]); N2.push(na[i]); }
  for (let i = 0; i < idx.length; i++) I2.push(idx[i]);
  const addCap = (s, dir) => {
    const base = P2.length / 3, cy = (s.y0 + s.y1) / 2;
    P2.push(0, cy, s.z); N2.push(0, 0, dir);
    for (let k = 0; k < seg; k++) { const r = ring(s, k); P2.push(...r); N2.push(0, 0, dir); }
    for (let k = 0; k < seg; k++) { const a = base + 1 + k, b = base + 1 + ((k + 1) % seg); if (dir > 0) I2.push(base, a, b); else I2.push(base, b, a); }
  };
  addCap(st[0], -1); addCap(st[st.length - 1], 1);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N2, 3));
  out.setIndex(I2);
  g.dispose();
  return out;
}

/* ------------------------------------------------------------------------------------------ */
// Passenger cars. o: L, W (half width), H roof, gc ground clearance, R wheel radius, fz/rz axle z,
// dh deck (rear) height, hh hood height, belt, c0 / c1 cabin base rear / front z, rs / fs rear / front slope length
function car(o) {
  const b = new VB();
  const { L, W, H, gc, R, fz, rz, dh, hh, c0, c1, rs, fs } = o;
  const belt = o.belt ?? Math.max(dh, hh) + 0.02;
  const e = o.e || 4.5;
  // painted lower body
  b.loft([
    { z: -L / 2, w: W * 0.8, y0: gc + 0.14, y1: dh - 0.1 },
    { z: -L / 2 + 0.14, w: W * 0.95, y0: gc + 0.02, y1: dh - 0.01 },
    { z: -L / 2 + 0.6, w: W, y0: gc, y1: dh },
    { z: (c0 + c1) / 2, w: W, y0: gc, y1: belt },
    { z: L / 2 - 1.0, w: W, y0: gc, y1: hh + 0.03 },
    { z: L / 2 - 0.3, w: W * 0.95, y0: gc + 0.03, y1: hh - 0.05 },
    { z: L / 2, w: W * 0.8, y0: gc + 0.14, y1: hh - 0.16 },
  ], 0xffffff, M.paint, { e });
  if (!o.open) {
    // glass cabin and painted roof
    const w1 = W * 0.82, w2 = W * 0.78;
    b.loft([
      { z: c0, w: w1, y0: belt - 0.06, y1: belt + 0.04 },
      { z: c0 + rs, w: w2, y0: belt - 0.06, y1: H - 0.02 },
      { z: c1 - fs, w: w2, y0: belt - 0.06, y1: H - 0.02 },
      { z: c1, w: w1, y0: belt - 0.06, y1: belt + 0.05 },
    ], C.glass, M.glass, { e: 5 });
    b.loft([
      { z: c0 + rs * 0.85, w: w2 * 0.985, y0: H - 0.07, y1: H - 0.005 },
      { z: c0 + rs + 0.25, w: w2 * 1.0, y0: H - 0.07, y1: H + 0.02 },
      { z: c1 - fs - 0.2, w: w2 * 1.0, y0: H - 0.07, y1: H + 0.02 },
      { z: c1 - fs * 0.85, w: w2 * 0.985, y0: H - 0.07, y1: H - 0.005 },
    ], 0xffffff, M.paint, { e: 3 });
    // pillars
    for (const sx of [1, -1]) {
      b.limb([sx * w1 * 0.97, belt, c1 - 0.02], [sx * w2 * 0.99, H - 0.03, c1 - fs], 0.028, 0.026, 0xffffff, M.paint);
      b.limb([sx * w1 * 0.97, belt, c0 + 0.02], [sx * w2 * 0.99, H - 0.03, c0 + rs], 0.05, 0.04, 0xffffff, M.paint);
      b.limb([sx * w2 * 0.995, belt - 0.02, (c0 + c1) / 2 - 0.05], [sx * w2 * 0.995, H - 0.04, (c0 + c1) / 2 - 0.05], 0.03, 0.03, 0xffffff, M.paint);
      b.box(0.01, 0.07, 0.3, [sx * (W + 0.01), belt - 0.18, (c0 + c1) / 2 + 0.2], 0x1a1c1e, M.plastic); // door handle line
      b.box(0.16, 0.1, 0.07, [sx * (W + 0.05), belt + 0.03, c1 - 0.2], 0x1a1c1e, M.plastic); // mirror
    }
  } else {
    // open car: low windscreen, cowl, driver
    b.loft([{ z: c1 - 0.1, w: W * 0.8, y0: belt, y1: belt + 0.03 }, { z: c1 - 0.3, w: W * 0.78, y0: belt, y1: belt + 0.32 }], C.glass, M.glass, { e: 6 });
    b.add(new THREE.SphereGeometry(0.115, 10, 8), { p: [0, belt + 0.42, c0 + 0.9] }, 0xe9e4d8, M.fixed);
    b.add(new THREE.SphereGeometry(1, 10, 8), { p: [0, belt + 0.1, c0 + 0.85], s: [0.24, 0.24, 0.2] }, 0xd8d0be, M.fixed);
    for (const sx of [1, -1]) b.add(new THREE.SphereGeometry(1, 8, 6), { p: [sx * (W - 0.05), hh * 0.95, L / 2 - 0.9], s: [0.1, 0.1, 0.1] }, 0xffffff, M.paint);
    b.add(new THREE.CircleGeometry(0.2, 16), { p: [0, hh + 0.012, L / 2 - 1.2], r: [-Math.PI / 2, 0, 0] }, 0xf0eee6, M.fixed);
    for (const sx of [1, -1]) b.add(new THREE.CircleGeometry(0.17, 16), { p: [sx * (W + 0.006), belt - 0.15, (c0 + c1) / 2], r: [0, sx * Math.PI / 2, 0] }, 0xf0eee6, M.fixed);
  }
  // bumpers, grille
  b.box(W * 1.7, 0.16, 0.14, [0, gc + 0.2, L / 2 - 0.02], 0x141516, M.plastic);
  b.box(W * 1.7, 0.16, 0.14, [0, gc + 0.2, -L / 2 + 0.02], 0x141516, M.plastic);
  b.box(W * 0.7, 0.14, 0.04, [0, hh - 0.2, L / 2 - 0.1], 0x0e0f10, M.plastic);
  b.box(0.3, 0.1, 0.02, [0, dh - 0.3, -L / 2 + 0.03], 0xdcdcd4, M.fixed);
  // lamps
  const hy = hh - 0.18, ty = dh - 0.2;
  for (const sx of [1, -1]) {
    b.box(W * 0.3, 0.1, 0.05, [sx * W * 0.7, hy, L / 2 - 0.13], C.head, M.head, [0, 0, 0.3 * sx]);
    b.box(W * 0.3, 0.1, 0.05, [sx * W * 0.72, ty, -L / 2 + 0.1], C.tail, M.tail);
  }
  // wheels
  for (const sx of [1, -1]) { for (const z of [fz, rz]) { b.arch(sx * (W + 0.0), R, z); b.wheel(sx * (W - 0.02), R, z); } }
  b.box(W * 1.7, 0.05, L * 0.8, [0, gc + 0.04, 0], 0x070707, M.plastic); // underbody
  if (o.roofLamp) b.box(0.5, 0.17, 0.2, [0, H + 0.1, (c0 + c1) / 2 + 0.05], C.amber, M.roofLamp);
  return { geo: b.done(), L, W, R, hy, ty, hx: W * 0.7, frontZ: L / 2 + 0.05, rearZ: -L / 2 - 0.03 };
}

function pickup(o) {
  const b = new VB();
  const L = 5.3, W = 0.95, gc = 0.32, R = 0.39, fz = 1.7, rz = -1.55;
  b.loft([
    { z: -L / 2, w: W * 0.95, y0: gc + 0.1, y1: 0.98 }, { z: -L / 2 + 0.2, w: W, y0: gc, y1: 1.0 }, { z: -0.3, w: W, y0: gc, y1: 1.0 },
    { z: 0.4, w: W, y0: gc, y1: 1.12 }, { z: L / 2 - 1.1, w: W, y0: gc, y1: 1.1 }, { z: L / 2 - 0.3, w: W * 0.96, y0: gc + 0.05, y1: 1.0 }, { z: L / 2, w: W * 0.85, y0: gc + 0.16, y1: 0.9 },
  ], 0xffffff, M.paint, { e: 5 });
  // cab
  b.loft([
    { z: -0.35, w: W * 0.82, y0: 1.05, y1: 1.12 }, { z: -0.12, w: W * 0.79, y0: 1.05, y1: 1.72 }, { z: 0.6, w: W * 0.79, y0: 1.05, y1: 1.72 }, { z: 1.2, w: W * 0.82, y0: 1.05, y1: 1.15 },
  ], C.glass, M.glass, { e: 5 });
  b.loft([{ z: -0.1, w: W * 0.78, y0: 1.65, y1: 1.74 }, { z: 0.6, w: W * 0.78, y0: 1.65, y1: 1.76 }, { z: 0.85, w: W * 0.77, y0: 1.65, y1: 1.72 }], 0xffffff, M.paint, { e: 3 });
  for (const sx of [1, -1]) {
    b.limb([sx * W * 0.8, 1.1, 1.18], [sx * W * 0.78, 1.7, 0.78], 0.03, 0.028, 0xffffff, M.paint);
    b.limb([sx * W * 0.8, 1.1, -0.34], [sx * W * 0.78, 1.7, -0.1], 0.05, 0.04, 0xffffff, M.paint);
    b.box(0.16, 0.1, 0.07, [sx * (W + 0.05), 1.18, 1.1], 0x1a1c1e, M.plastic);
    // bed walls
    b.box(0.06, 0.5, 1.9, [sx * (W - 0.03), 1.18, -1.65], 0xffffff, M.paint);
    b.box(0.06, 0.06, 1.9, [sx * (W - 0.03), 1.45, -1.65], 0xffffff, M.paint);
    b.box(W * 0.3, 0.1, 0.05, [sx * W * 0.7, 0.92, L / 2 - 0.13], C.head, M.head);
    b.box(0.2, 0.18, 0.05, [sx * (W - 0.12), 1.0, -L / 2 + 0.03], C.tail, M.tail);
    for (const z of [fz, rz]) { b.arch(sx * W, R, z); b.wheel(sx * (W - 0.02), R, z, 0.26); }
  }
  b.box(W * 2 - 0.1, 0.05, 1.9, [0, 0.97, -1.65], 0x15171a, M.plastic); // bed floor
  b.box(W * 2 - 0.1, 0.5, 0.06, [0, 1.18, -0.7], 0xffffff, M.paint);
  b.box(W * 2 - 0.1, 0.5, 0.06, [0, 1.18, -L / 2 + 0.03], 0xffffff, M.paint);
  b.box(W * 1.7, 0.17, 0.14, [0, 0.5, L / 2 - 0.02], 0x141516, M.plastic);
  b.box(W * 1.9, 0.14, 0.14, [0, 0.5, -L / 2 + 0.02], 0x141516, M.chrome);
  b.box(W * 0.8, 0.16, 0.04, [0, 0.9, L / 2 - 0.1], 0x0e0f10, M.plastic);
  b.box(W * 1.7, 0.05, L * 0.8, [0, gc + 0.04, 0], 0x070707, M.plastic);
  return { geo: b.done(), L, W, R, hy: 0.92, ty: 1.0, hx: W * 0.7, frontZ: L / 2 + 0.05, rearZ: -L / 2 - 0.03 };
}

function box(o) { // camper van, box truck, bus, double-decker
  const b = new VB();
  const { L, W, H, gc, R } = o;
  const f = o.front; // z where the cab / windscreen starts
  if (o.kind === 'truck') {
    // cab
    b.loft([{ z: L / 2, w: W * 0.82, y0: gc + 0.1, y1: 1.2 }, { z: L / 2 - 0.1, w: W * 0.92, y0: gc, y1: 1.7 }, { z: L / 2 - 1.5, w: W * 0.92, y0: gc, y1: 2.45 }, { z: L / 2 - 2.0, w: W * 0.92, y0: gc, y1: 2.5 }], 0xffffff, M.paint, { e: 6 });
    b.loft([{ z: L / 2 - 0.12, w: W * 0.88, y0: 1.5, y1: 1.62 }, { z: L / 2 - 0.55, w: W * 0.9, y0: 1.5, y1: 2.35 }, { z: L / 2 - 1.2, w: W * 0.9, y0: 1.5, y1: 2.38 }], C.glass, M.glass, { e: 6 });
    // cargo box (fixed colour, plain)
    b.add(new THREE.BoxGeometry(W * 2.02, 2.2, L - 2.1), { p: [0, 2.3, -1.05 - (L - 7.4) / 2 * 0] }, 0xe6e4de, M.fixed);
    b.box(W * 1.9, 0.5, L - 2.1, [0, 1.0, -1.05], 0x2a2c2e, M.plastic);
    
  } else {
    const dd = o.kind === 'dd', bus = o.kind === 'bus', camper = o.kind === 'camper';
    // lower body painted, upper band fixed (white) for the two-tone bus
    b.loft([
      { z: -L / 2, w: W * 0.93, y0: gc + 0.1, y1: H - 0.05 }, { z: -L / 2 + 0.12, w: W, y0: gc, y1: H }, { z: L / 2 - 0.5, w: W, y0: gc, y1: H },
      { z: L / 2 - 0.12, w: W * 0.98, y0: gc + 0.05, y1: H - (camper ? 0.9 : 0.1) }, { z: L / 2, w: W * 0.92, y0: gc + 0.14, y1: H - (camper ? 1.05 : 0.2) },
    ], 0xffffff, M.paint, { e: dd || bus ? 9 : 6, seg: 16 });
    if (o.band) b.box(W * 2.003, o.band[1], L - 0.5, [0, o.band[0], -0.0], 0xeeece4, M.fixed);
    // window bands
    const rows = dd ? [[gc + 0.95, 0.9], [gc + 2.95, 0.9]] : bus ? [[gc + 1.35, 1.05]] : [[gc + 1.2, 0.8]];
    const nW = camper ? 3 : bus ? 7 : 7, span = camper ? 3.0 : L - 2.6;
    for (const sx of [1, -1]) for (const [y, h] of rows) {
      for (let i = 0; i < nW; i++) {
        const z = -L / 2 + 1.3 + (span * (i + 0.5)) / nW - (camper ? -0.2 : 0);
        b.box(0.03, h, (span / nW) * 0.86, [sx * (W + 0.002), y + h / 2, z], C.glass, M.glass);
      }
    }
    // windscreen
    const wy = dd ? [gc + 0.95, gc + 3.9] : camper ? [gc + 1.2, H - 0.3] : [gc + 0.95, gc + 2.3];
    b.box(W * 1.8, wy[1] - wy[0], 0.04, [0, (wy[0] + wy[1]) / 2, L / 2 + 0.003], C.glass, M.glass, [camper ? -0.45 : 0, 0, 0]);
    if (dd) b.box(W * 1.5, 0.3, 0.04, [0, gc + 3.9, L / 2 + 0.003], 0x100a05, M.plastic);
    if (!camper) { b.box(0.03, 2.0, 1.1, [W + 0.001, gc + 1.2, L / 2 - 1.5], 0x16181a, M.glass); } // door
    if (camper) { b.box(W * 2.003, 0.18, L - 1.2, [0, gc + 0.62, -0.3], 0xb7a68c, M.fixed); b.add(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2), { p: [0, H + 0.0, -0.7], s: [0.4, 0.14, 0.7] }, 0xefede6, M.fixed); }
    if (bus) b.box(W * 1.1, 0.3, 0.04, [0, gc + 2.6, L / 2 + 0.01], 0x0a0a0a, M.plastic);
  }
  const hz = L / 2 - 0.02;
  for (const sx of [1, -1]) {
    b.box(0.3, 0.14, 0.05, [sx * W * 0.72, o.kind === 'camper' ? 0.9 : 0.85, hz + 0.02], C.head, M.head);
    b.box(0.22, 0.4, 0.05, [sx * W * 0.8, 1.05, -L / 2 + 0.02], C.tail, M.tail);
    const zs = o.axles;
    for (const z of zs) { b.arch(sx * W, R, z); b.wheel(sx * (W - 0.03), R, z, 0.3); if (z < 0 && o.dual) b.wheel(sx * (W - 0.32), R, z, 0.3); }
  }
  b.box(W * 1.9, 0.22, 0.12, [0, 0.55, hz], 0x141516, M.plastic);
  b.box(W * 1.9, 0.22, 0.12, [0, 0.55, -L / 2], 0x141516, M.plastic);
  b.box(W * 1.9, 0.05, L * 0.9, [0, gc + 0.06, 0], 0x070707, M.plastic);
  return { geo: b.done(), L, W, R, hy: 0.88, ty: 1.2, hx: W * 0.72, frontZ: L / 2 + 0.03, rearZ: -L / 2 - 0.03 };
}

function bike() {
  const b = new VB();
  const R = 0.34;
  for (const z of [0.55, -0.55]) {
    b.cylX(R, 0.04, [0, R, z], C.rubber, M.rubber, [R, z], 18);
    b.cylX(R * 0.78, 0.045, [0, R, z], 0x8d9096, M.rim, [R, z], 14);
    for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; b.add(new THREE.BoxGeometry(0.03, R * 1.5, 0.01), { p: [0, R, z], r: [-a, 0, 0] }, 0x707478, M.rim, [R, z]); }
  }
  const frame = 0x2d4a63;
  b.limb([0, 0.34, 0.55], [0, 0.64, 0.38], 0.016, 0.016, frame, M.paint);
  b.limb([0, 0.64, 0.38], [0, 0.66, -0.3], 0.018, 0.018, frame, M.paint);
  b.limb([0, 0.66, -0.3], [0, 0.34, -0.55], 0.016, 0.016, frame, M.paint);
  b.limb([0, 0.66, -0.3], [0, 0.28, -0.05], 0.016, 0.016, frame, M.paint);
  b.limb([0, 0.28, -0.05], [0, 0.34, -0.55], 0.014, 0.014, frame, M.paint);
  b.limb([0, 0.64, 0.38], [0, 0.95, 0.4], 0.014, 0.014, frame, M.paint);
  b.box(0.42, 0.03, 0.03, [0, 0.97, 0.4], 0x202224, M.plastic);
  b.box(0.1, 0.03, 0.22, [0, 0.74, -0.34], 0x1a1a1a, M.plastic);
  b.box(0.04, 0.05, 0.03, [0, 0.62, -0.62], C.tail, M.tail);
  // rider: leaning forward, helmeted
  const cloth = 0xd2562b, skin = 0xd9a882;
  b.limb([0, 0.82, -0.36], [0, 1.28, 0.1], 0.1, 0.12, cloth, M.fixed, 8);
  b.add(new THREE.SphereGeometry(1, 10, 8), { p: [0, 1.4, 0.2], s: [0.12, 0.12, 0.14] }, 0xe8e4da, M.fixed);
  for (const sx of [1, -1]) {
    b.limb([sx * 0.13, 1.24, 0.08], [sx * 0.2, 0.98, 0.38], 0.04, 0.03, cloth, M.fixed);
    b.limb([sx * 0.11, 0.8, -0.34], [sx * 0.12, 0.52, 0.0], 0.075, 0.055, 0x24262b, M.fixed);
    b.limb([sx * 0.12, 0.52, 0.0], [sx * 0.12, 0.3, -0.05], 0.055, 0.04, 0x24262b, M.fixed);
  }
  return { geo: b.done(), L: 1.8, W: 0.3, R, hy: 0.78, ty: 0.62, hx: 0.0, frontZ: 1.0, rearZ: -0.7 };
}

/* ------------------------------------------------------------------------------------------ */
export const TYPES = {
  sedan: () => car({ L: 4.7, W: 0.9, H: 1.44, gc: 0.26, R: 0.32, fz: 1.45, rz: -1.4, dh: 0.98, hh: 0.93, c0: -1.4, c1: 0.95, rs: 0.75, fs: 0.95 }),
  hatch: () => car({ L: 3.9, W: 0.82, H: 1.5, gc: 0.25, R: 0.29, fz: 1.2, rz: -1.15, dh: 1.0, hh: 0.9, c0: -1.9, c1: 0.78, rs: 0.5, fs: 0.8 }),
  suv: () => car({ L: 4.75, W: 0.94, H: 1.78, gc: 0.38, R: 0.37, fz: 1.5, rz: -1.45, dh: 1.22, hh: 1.1, c0: -2.28, c1: 1.0, rs: 0.5, fs: 0.8, belt: 1.24 }),
  taxi: () => car({ L: 4.75, W: 0.9, H: 1.46, gc: 0.26, R: 0.32, fz: 1.45, rz: -1.4, dh: 0.98, hh: 0.93, c0: -1.4, c1: 0.95, rs: 0.75, fs: 0.95, roofLamp: true }),
  blackcab: () => car({ L: 4.5, W: 0.88, H: 1.8, gc: 0.28, R: 0.3, fz: 1.3, rz: -1.2, dh: 1.0, hh: 0.98, c0: -2.1, c1: 0.7, rs: 0.25, fs: 0.55, belt: 1.02, roofLamp: true, e: 5 }),
  sports: () => car({ L: 4.4, W: 0.93, H: 1.15, gc: 0.18, R: 0.32, fz: 1.35, rz: -1.35, dh: 0.82, hh: 0.72, c0: -1.15, c1: 0.3, rs: 0.7, fs: 0.85, belt: 0.85, e: 3.4 }),
  classic: () => car({ L: 4.3, W: 0.78, H: 1.1, gc: 0.28, R: 0.34, fz: 1.35, rz: -1.35, dh: 0.78, hh: 0.84, c0: -0.7, c1: 0.0, rs: 0.5, fs: 0.5, belt: 0.84, open: true, e: 3.4 }),
  pickup: () => pickup(),
  camper: () => box({ kind: 'camper', L: 5.6, W: 0.97, H: 2.75, gc: 0.4, R: 0.37, axles: [1.65, -1.5], front: 1 }),
  boxtruck: () => box({ kind: 'truck', L: 7.4, W: 1.1, H: 3.4, gc: 0.5, R: 0.5, axles: [2.2, -2.3], dual: true }),
  bus: () => box({ kind: 'bus', L: 11.6, W: 1.28, H: 3.1, gc: 0.38, R: 0.5, axles: [3.6, -3.1], band: [2.94, 0.32] }),
  doubledecker: () => box({ kind: 'dd', L: 10.4, W: 1.28, H: 4.3, gc: 0.36, R: 0.5, axles: [3.3, -3.0] }),
  bicycle: () => bike(),
};
