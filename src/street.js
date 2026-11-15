import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BASE } from './paths.js';

// Street furniture along city routes: lamps, signals, benches, bins, bollards, bus shelters, advertising, guard rails.
// Positions are baked by scripts/bake-street.mjs into /world/<id>/street/street.bin (8 floats per item:
// [type*16+variant, x, y, z, yaw, seed, aux, real]). Models are built here from primitives, one merged
// InstancedMesh per model, refilled with the items near the camera a few times a second (no per-frame CPU).
// Night: emissive lamp heads + a soft additive light pool on the ground + glow sprites, all driven by shared.uNight.
// Traffic lights cycle red/green/amber in the shader from shared.uTime and a per-junction phase.

const TYPES = ['lamp', 'bench', 'bin', 'signal', 'bollard', 'shelter', 'column', 'mupi', 'billboard', 'barrier', 'busstop', 'hydrant', 'newsbox', 'steam', 'subway'];
// instance capacity and draw distance per type (m)
const CAP = { lamp: 360, bench: 100, bin: 120, signal: 100, bollard: 240, shelter: 60, column: 50, mupi: 70, billboard: 40, barrier: 160, busstop: 50, hydrant: 160, newsbox: 120, steam: 20, subway: 30 };
const RANGE = { lamp: 150, bench: 80, bin: 70, signal: 190, bollard: 70, shelter: 150, column: 150, mupi: 130, billboard: 260, barrier: 110, busstop: 90, hydrant: 70, newsbox: 70, steam: 160, subway: 130 };
const GLOW_RANGE = 330, GLOW_CAP = 900, CELL = 64;

// ---------------------------------------------------------------- geometry builder
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function builder() {
  const parts = [];
  const add = (geo, col, em, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, urep = 1) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    _e.set(rx, ry, rz); _q.setFromEuler(_e);
    g.applyMatrix4(_m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)));
    if (urep !== 1) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * urep); }
    const n = g.attributes.position.count, c = new THREE.Color(col), cs = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cs[i * 3] = c.r; cs[i * 3 + 1] = c.g; cs[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cs, 3));
    g.setAttribute('aEm', new THREE.BufferAttribute(new Float32Array(n).fill(em), 1));
    parts.push(g);
  };
  const api = {
    add,
    box: (w, h, d, x, y, z, col, em = 0, ry = 0) => add(new THREE.BoxGeometry(w, h, d), col, em, x, y, z, 0, ry, 0),
    cyl: (rt, rb, h, x, y, z, col, seg = 8, em = 0, rx = 0, rz = 0) => add(new THREE.CylinderGeometry(rt, rb, h, seg), col, em, x, y, z, rx, 0, rz),
    sph: (r, x, y, z, col, em = 0, sy = 1, sx = 1, sz = 1) => add(new THREE.SphereGeometry(r, 10, 7), col, em, x, y, z, 0, 0, 0, sx, sy, sz),
    tor: (R, r, x, y, z, col, rx = Math.PI / 2) => add(new THREE.TorusGeometry(R, r, 5, 12), col, 0, x, y, z, rx),
    tube: (pts, r, col, seg = 10) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, 6), col, 0),
    lathe: (prof, x, y, z, col, seg = 10, em = 0) => add(new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(r, h)), seg), col, em, x, y, z),
    plane: (w, h, x, y, z, ry, col, em, urep = 1) => add(new THREE.PlaneGeometry(w, h), col, em, x, y, z, 0, ry, 0, 1, 1, 1, urep),
    done: () => { const g = mergeGeometries(parts, false); parts.forEach((p) => p.dispose()); g.computeBoundingSphere(); return g; },
  };
  return api;
}

// ---------------------------------------------------------------- models (local +z = toward the road, y up, origin on the ground)
const LENS = [0x4d0b08, 0x4d3305, 0x06391c];
function signalHead(b, x, y, z, dir, body, back) {
  b.box(0.3, 1.0, 0.32, x, y, z, body);
  b.box(0.03, 1.28, 0.54, x + dir * 0.15, y, z, back);
  for (let i = 0; i < 3; i++) {
    const ly = y + 0.33 - i * 0.33;
    b.cyl(0.115, 0.115, 0.03, x + dir * 0.17, ly, z, LENS[i], 12, 2 + i, 0, -dir * Math.PI / 2);
    b.box(0.22, 0.025, 0.27, x + dir * 0.27, ly + 0.14, z, body);
  }
}

const LAMPS = {
  manhattan(b) {
    const c = 0x2b302f;
    b.cyl(0.17, 0.2, 0.5, 0, 0.25, 0, c, 8);
    b.cyl(0.06, 0.12, 9, 0, 4.5, 0, c, 8);
    b.tube([[0, 8.5, 0], [0, 9.2, 0.35], [0, 9.45, 1.3], [0, 9.4, 2.2]], 0.05, c);
    b.sph(0.5, 0, 9.35, 2.6, c, 0, 0.26, 1, 0.55);
    b.box(0.36, 0.03, 0.78, 0, 9.2, 2.6, 0xfff2d8, 1);
    return { heads: [[0, 9.12, 2.6]], poolZ: 2.6 };
  },
  paris(b) {
    const c = 0x1f3b2d, gold = 0x8d7a3c;
    b.lathe([[0.3, 0], [0.28, 0.08], [0.2, 0.22], [0.17, 0.5], [0.12, 0.85], [0.1, 1.15]], 0, 0, 0, c, 10);
    b.cyl(0.075, 0.1, 5.5, 0, 3.85, 0, c, 8);
    for (const y of [1.2, 6.55]) b.cyl(0.13, 0.13, 0.07, 0, y, 0, gold, 8);
    b.tube([[0, 6.4, 0], [0, 6.8, 0.2], [0, 6.95, 0.9], [0, 6.75, 1.6]], 0.035, c);
    b.tor(0.17, 0.02, 0, 6.88, 0.35, gold, 0);
    b.cyl(0.06, 0.2, 0.1, 0, 6.6, 1.7, c, 8);
    b.cyl(0.19, 0.16, 0.42, 0, 6.34, 1.7, 0xfff0d0, 8, 1);
    b.cyl(0.02, 0.25, 0.22, 0, 6.66 + 0.16, 1.7, c, 8);
    b.cyl(0.14, 0.17, 0.4, 0, 6.8, 0, 0xfff0d0, 8, 1);
    b.cyl(0.02, 0.22, 0.2, 0, 7.1, 0, c, 8);
    b.sph(0.045, 0, 7.25, 0, gold);
    return { heads: [[0, 6.34, 1.7], [0, 6.8, 0]], poolZ: 1.7 };
  },
  london(b) {
    const c = 0x15171a, gold = 0x9b7d2b;
    b.lathe([[0.26, 0], [0.24, 0.1], [0.17, 0.3], [0.15, 0.9], [0.11, 1.4], [0.09, 1.55]], 0, 0, 0, c, 10);
    b.cyl(0.065, 0.09, 4.2, 0, 3.6, 0, c, 8);
    b.cyl(0.11, 0.11, 0.06, 0, 1.55, 0, gold, 8);
    b.box(0.05, 0.05, 0.9, 0, 4.55, 0.45, c);
    b.cyl(0.17, 0.12, 0.08, 0, 5.72, 0, c, 4, 0, 0, 0);
    b.cyl(0.24, 0.17, 0.46, 0, 5.98, 0, 0xfff0d0, 4, 1);
    b.cyl(0.04, 0.3, 0.22, 0, 6.32, 0, c, 4);
    b.sph(0.05, 0, 6.46, 0, gold);
    return { heads: [[0, 5.98, 0]], poolZ: 0.8 };
  },
  la(b) {
    const c = 0x9a9ea0;
    b.cyl(0.2, 0.2, 0.25, 0, 0.12, 0, 0x6a6e70, 8);
    b.cyl(0.07, 0.13, 10, 0, 5, 0, c, 8);
    b.tube([[0, 9.5, 0], [0, 10.0, 0.9], [0, 10.35, 2.0], [0, 10.55, 3.1]], 0.05, c);
    b.box(0.42, 0.14, 0.95, 0, 10.55, 3.3, 0x70757a);
    b.box(0.34, 0.03, 0.8, 0, 10.46, 3.3, 0xfff2e0, 1);
    return { heads: [[0, 10.4, 3.3]], poolZ: 3.1 };
  },
  monaco(b) {
    const c = 0x24282b, gold = 0xa58a3b;
    b.lathe([[0.22, 0], [0.2, 0.1], [0.14, 0.3], [0.1, 0.6], [0.08, 0.8]], 0, 0, 0, c, 10);
    b.cyl(0.055, 0.08, 4.4, 0, 3.0, 0, c, 8);
    b.tor(0.1, 0.018, 0, 1.0, 0, gold);
    b.tube([[0, 5.0, 0], [0, 5.5, 0.2], [0, 5.55, 0.8], [0, 5.2, 1.3]], 0.03, c);
    b.sph(0.25, 0, 4.95, 1.3, 0xfff1d6, 1);
    b.cyl(0.1, 0.1, 0.08, 0, 5.25, 1.3, c, 8);
    b.sph(0.2, 0, 5.4, 0, 0xfff1d6, 1);
    b.cyl(0.08, 0.08, 0.06, 0, 5.2, 0, c, 8);
    b.sph(0.045, 0, 5.68, 0, gold);
    return { heads: [[0, 4.95, 1.3], [0, 5.4, 0]], poolZ: 1.3 };
  },
};

const SIG = {
  manhattan: { pole: 0x383c3e, body: 0xd9a915, back: 0x1b1b1b, arm: 6.4, h: 6.0, heads: [3.9, 5.7] },
  la: { pole: 0x6f7476, body: 0x202122, back: 0xe2b400, arm: 7.2, h: 6.2, heads: [4.2, 6.4] },
  paris: { pole: 0x555a5d, body: 0x1d1e1f, back: 0xe9e9e4, arm: 0.9, h: 3.35, heads: [0.8] },
  london: { pole: 0x17191b, body: 0x141516, back: 0xf0f0ea, arm: 0.7, h: 3.2, heads: [0.6] },
};
SIG.monaco = SIG.paris;
function signalModel(city, dir) {
  const s = SIG[city], b = builder();
  const long = s.arm > 2;
  b.cyl(0.075, 0.1, s.h, 0, s.h / 2, 0, s.pole, 8);
  b.cyl(0.14, 0.14, 0.12, 0, 0.06, 0, s.pole, 8);
  if (long) {
    b.tube([[0, s.h - 0.25, 0], [0, s.h - 0.05, 0.6], [0, s.h, s.arm * 0.5], [0, s.h + 0.05, s.arm]], 0.045, s.pole, 12);
    const hy = s.h - 0.75;
    for (const z of s.heads) { b.box(0.05, 0.3, 0.05, 0, s.h + 0.02, z, s.pole); signalHead(b, 0, hy - 0.2, z, dir, s.body, s.back); }
    b.box(0.3, 0.45, 0.3, dir * 0.05, 2.7, 0.17, 0x2a2c2e); // pedestrian signal / push button pod
    return { geo: b.done(), head: [dir * 0.17, s.h - 0.95, s.heads[0]] };
  }
  b.tube([[0, s.h - 0.9, 0], [0, s.h - 0.1, 0.1], [0, s.h, s.arm * 0.5], [0, s.h - 0.05, s.arm]], 0.04, s.pole);
  signalHead(b, 0, s.h - 0.55, s.arm, dir, s.body, s.back);
  b.box(0.14, 0.2, 0.1, dir * 0.0, 1.1, 0.12, 0x2a2c2e);
  return { geo: b.done(), head: [dir * 0.17, s.h - 0.55, s.arm] };
}

const BENCH = {
  paris: { wood: 0x2c5a3a, frame: 0x1b3125, rest: 'slat' },
  manhattan: { wood: 0x7b5836, frame: 0x1f2326, rest: 'slat' },
  london: { wood: 0x6c4a2e, frame: 0x151618, rest: 'slat' },
  la: { wood: 0xb2a595, frame: 0x45494c, rest: 'slat' },
  monaco: { wood: 0xcfc9bb, frame: 0x2a2d30, rest: 'slat' },
};
function benchModel(city) {
  const s = BENCH[city], b = builder();
  for (const x of [-0.82, 0.82]) {
    b.box(0.06, 0.42, 0.5, x, 0.21, 0.0, s.frame);
    b.box(0.07, 0.07, 0.56, x, 0.46, 0.0, s.frame);
    b.box(0.06, 0.55, 0.06, x, 0.65, -0.23, s.frame, 0, 0);
    b.box(0.08, 0.05, 0.4, x, 0.67, 0.02, s.frame);
  }
  for (let i = 0; i < 4; i++) b.box(1.78, 0.035, 0.1, 0, 0.49, -0.2 + i * 0.13, s.wood);
  for (let i = 0; i < 3; i++) b.box(1.78, 0.1, 0.03, 0, 0.62 + i * 0.14, -0.27 - i * 0.02, s.wood);
  b.box(1.64, 0.04, 0.04, 0, 0.3, -0.12, s.frame);
  return b.done();
}

const BIN = {
  paris: { body: 0x2f6a49, lid: 0x1f4733, shape: 'bag' },
  manhattan: { body: 0x20382d, lid: 0x151f1a, shape: 'mesh' },
  london: { body: 0x17181a, lid: 0x101112, shape: 'dome' },
  la: { body: 0x696e71, lid: 0x3b3f41, shape: 'dome' },
  monaco: { body: 0x2a2d30, lid: 0x1b1d1f, shape: 'dome' },
};
function binModel(city) {
  const s = BIN[city], b = builder();
  if (s.shape === 'bag') {
    for (const x of [-0.22, 0.22]) b.cyl(0.015, 0.015, 0.9, x, 0.45, 0, 0x3a3d3f, 6);
    b.cyl(0.24, 0.18, 0.62, 0, 0.55, 0, s.body, 10);
    b.tor(0.24, 0.018, 0, 0.87, 0, 0x2a2d2e, Math.PI / 2);
    b.cyl(0.19, 0.19, 0.04, 0, 0.22, 0, 0x2a2d2e, 10);
  } else if (s.shape === 'mesh') {
    b.cyl(0.25, 0.2, 0.8, 0, 0.5, 0, s.body, 10);
    b.cyl(0.255, 0.255, 0.05, 0, 0.9, 0, s.lid, 10);
    b.cyl(0.21, 0.21, 0.05, 0, 0.12, 0, s.lid, 10);
    b.box(0.3, 0.12, 0.05, 0, 0.78, 0.24, 0x050606);
  } else {
    b.cyl(0.25, 0.22, 0.78, 0, 0.42, 0, s.body, 12);
    b.cyl(0.14, 0.26, 0.14, 0, 0.88, 0, s.lid, 12);
    b.sph(0.14, 0, 0.94, 0, s.lid, 0, 0.5);
    b.box(0.2, 0.09, 0.05, 0, 0.8, 0.26, 0x050606);
  }
  return b.done();
}

const BOLLARD = {
  paris: { body: 0x363a3c, band: 0xb8bcbe, h: 0.9, r: 0.075 },
  london: { body: 0x141516, band: 0xb08d2a, h: 0.95, r: 0.085 },
  manhattan: { body: 0x9aa0a3, band: 0x2b2e30, h: 0.85, r: 0.09 },
  la: { body: 0x85898b, band: 0xe0b020, h: 0.95, r: 0.1 },
  monaco: { body: 0x2c2f31, band: 0xb7bbbd, h: 0.9, r: 0.075 },
};
function bollardModel(city) {
  const s = BOLLARD[city], b = builder();
  b.cyl(s.r, s.r * 1.12, s.h, 0, s.h / 2, 0, s.body, 10);
  b.sph(s.r, 0, s.h, 0, s.body, 0, 0.55);
  b.cyl(s.r * 1.04, s.r * 1.04, 0.07, 0, s.h - 0.15, 0, s.band, 10);
  b.cyl(s.r * 1.3, s.r * 1.3, 0.04, 0, 0.02, 0, s.body, 10);
  return b.done();
}

const SHELTER = {
  paris: { frame: 0x2e3438, roof: 0x3b4247 },
  london: { frame: 0x272b30, roof: 0x34393e },
  manhattan: { frame: 0x2a2d30, roof: 0x3a3d40 },
  la: { frame: 0x4a4e51, roof: 0x5a5e61 },
  monaco: { frame: 0x2e3438, roof: 0x3b4247 },
};
function shelterModel(city) {
  const s = SHELTER[city], b = builder();
  const glass = 0x1d282d;
  b.box(3.5, 0.09, 1.55, 0, 2.55, 0, s.roof);
  b.box(3.46, 0.12, 0.05, 0, 2.47, 0.72, s.frame);
  for (const [x, z] of [[-1.55, -0.62], [1.55, -0.62], [-1.55, 0.62], [1.55, 0.62]]) b.box(0.07, 2.5, 0.07, x, 1.25, z, s.frame);
  b.box(3.1, 1.55, 0.02, 0, 1.38, -0.64, glass); // back glass
  b.box(0.02, 1.55, 1.2, -1.54, 1.38, 0, glass); // end glass
  b.box(3.1, 0.07, 0.07, 0, 0.55, -0.64, s.frame);
  b.box(3.1, 0.07, 0.07, 0, 2.2, -0.64, s.frame);
  b.box(1.9, 0.045, 0.42, -0.3, 0.52, -0.38, s.frame); // seat
  b.box(0.05, 0.5, 0.35, -1.2, 0.26, -0.38, s.frame);
  b.box(0.05, 0.5, 0.35, 0.6, 0.26, -0.38, s.frame);
  b.box(2.6, 0.06, 0.1, 0, 2.4, 0.5, 0xfff3dc, 7); // light strip under the roof
  // advertising panel on the +x end, facing along the road
  b.box(0.13, 1.82, 1.18, 1.82, 1.2, 0.0, s.frame);
  b.plane(1.1, 1.64, 1.89, 1.2, 0, Math.PI / 2, 0xffffff, 5);
  b.plane(1.1, 1.64, 1.75, 1.2, 0, -Math.PI / 2, 0xffffff, 5);
  return b.done();
}

function busStopModel() {
  const b = builder();
  b.cyl(0.04, 0.045, 3.0, 0, 1.5, 0, 0x6b7073, 8);
  b.cyl(0.12, 0.12, 0.05, 0, 0.03, 0, 0x4a4e50, 8);
  b.box(0.5, 0.42, 0.025, 0, 2.85, 0.03, 0x1d5a96);
  b.box(0.4, 0.06, 0.03, 0, 2.95, 0.035, 0xf0f2f4);
  b.box(0.4, 0.04, 0.03, 0, 2.78, 0.035, 0xf0f2f4);
  b.box(0.5, 0.42, 0.025, 0, 2.85, -0.03, 0x1d5a96);
  return b.done();
}

function mupiModel() {
  const b = builder();
  b.box(1.28, 1.94, 0.12, 0, 1.18, 0, 0x2b2e31);
  b.box(0.1, 0.3, 0.14, -0.5, 0.15, 0, 0x2b2e31);
  b.box(0.1, 0.3, 0.14, 0.5, 0.15, 0, 0x2b2e31);
  b.box(1.0, 0.07, 0.4, 0, 0.04, 0, 0x34383b);
  b.plane(1.14, 1.72, 0, 1.18, 0.065, 0, 0xffffff, 5);
  b.plane(1.14, 1.72, 0, 1.18, -0.065, Math.PI, 0xffffff, 5);
  return b.done();
}

function billboardModel() {
  const b = builder();
  const steel = 0x6d7275;
  b.cyl(0.24, 0.3, 6.4, 0, 3.2, 0, steel, 10);
  b.box(0.8, 0.15, 0.8, 0, 0.08, 0, 0x55595c);
  b.box(7.5, 0.22, 0.34, 0, 5.98, 0, steel);
  b.box(7.5, 0.22, 0.34, 0, 9.5, 0, steel);
  b.box(0.22, 3.7, 0.34, -3.75, 7.74, 0, steel);
  b.box(0.22, 3.7, 0.34, 3.75, 7.74, 0, steel);
  b.box(7.3, 3.4, 0.2, 0, 7.74, 0, 0x8a8f92);
  b.box(7.4, 0.08, 0.6, 0, 5.86, 0, 0x4a4e50); // catwalk
  b.plane(7.3, 3.4, 0, 7.74, 0.105, 0, 0xffffff, 6);
  b.plane(7.3, 3.4, 0, 7.74, -0.105, Math.PI, 0xffffff, 6);
  for (const x of [-3, -1.5, 0, 1.5, 3]) { b.box(0.06, 0.06, 0.6, x, 9.7, 0.3, 0x3a3d3f); b.box(0.2, 0.08, 0.14, x, 9.7, 0.62, 0x303335); }
  return b.done();
}

// ---- New York extras (only baked for manhattan)
function hydrantModel(cap) {
  const b = builder(), body = 0x9ea3a6;
  b.cyl(0.2, 0.22, 0.1, 0, 0.05, 0, 0x6f7477, 10);
  b.cyl(0.15, 0.17, 0.5, 0, 0.35, 0, body, 10);
  b.cyl(0.17, 0.15, 0.08, 0, 0.62, 0, body, 10);
  b.sph(0.15, 0, 0.66, 0, cap, 0, 0.8);
  b.sph(0.04, 0, 0.82, 0, cap);
  b.cyl(0.07, 0.07, 0.46, 0, 0.45, 0, body, 8, 0, 0, Math.PI / 2);
  for (const x of [-0.24, 0.24]) b.cyl(0.075, 0.075, 0.06, x, 0.45, 0, cap, 8, 0, 0, Math.PI / 2);
  b.cyl(0.08, 0.08, 0.07, 0, 0.45, 0.16, cap, 8, 0, Math.PI / 2);
  return b.done();
}
function newsboxModel(col) {
  const b = builder();
  b.box(0.1, 0.42, 0.1, 0, 0.21, -0.05, 0x3a3d40);
  b.box(0.42, 0.62, 0.36, 0, 0.73, 0, col);
  b.box(0.42, 0.1, 0.4, 0, 1.06, 0, 0x2a2d30);
  b.box(0.3, 0.26, 0.02, 0, 0.9, 0.19, 0x15181a); // window
  b.box(0.3, 0.14, 0.02, 0, 0.62, 0.19, 0xe8e8e0);
  return b.done();
}
function steamModel() {
  const b = builder();
  b.cyl(0.42, 0.45, 0.2, 0, 0.1, 0, 0x55595c, 12);
  const n = 6, h = 2.4 / n;
  for (let i = 0; i < n; i++) b.cyl(0.3 - i * 0.012, 0.3 - i * 0.012 + 0.01, h, 0, 0.2 + h * (i + 0.5), 0, i % 2 ? 0xf1f1ec : 0xe8661c, 12);
  b.cyl(0.33, 0.3, 0.1, 0, 2.55, 0, 0xe8661c, 12);
  b.cyl(0.2, 0.3, 0.12, 0, 2.66, 0, 0xf1f1ec, 12);
  return b.done();
}
// stair opening along local x, open at +x; two green globes on posts; local +z toward the road
function subwayModel() {
  const b = builder(), rail = 0x1d2a22, conc = 0x8a8e90;
  b.box(3.5, 0.04, 0.12, 0, 0.02, 1.0, conc); b.box(3.5, 0.04, 0.12, 0, 0.02, -1.0, conc);
  b.box(0.12, 0.04, 2.0, -1.7, 0.02, 0, conc);
  b.box(3.3, 0.03, 1.8, 0.05, 0.03, 0, 0x050607); // dark stairwell
  for (let i = 0; i < 7; i++) b.box(0.05, 0.035, 1.76, 0.2 + i * 0.4, 0.045, 0, 0x2c2f31); // tread edges
  for (const z of [-0.95, 0.95]) {
    b.box(3.3, 0.05, 0.05, 0, 1.0, z, rail); b.box(3.3, 0.04, 0.04, 0, 0.55, z, rail);
    for (let x = -1.6; x <= 1.7; x += 0.55) b.box(0.04, 1.0, 0.04, x, 0.5, z, rail);
  }
  b.box(0.05, 1.0, 1.9, -1.65, 0.5, 0, rail); b.box(0.05, 0.05, 1.9, -1.65, 1.0, 0, rail);
  for (const z of [-0.95, 0.95]) {
    b.cyl(0.045, 0.06, 2.7, 1.65, 1.35, z, rail, 8);
    b.sph(0.2, 1.65, 2.9, z, 0x2fd06a, 8); // globe
    b.cyl(0.07, 0.07, 0.08, 1.65, 2.72, z, rail, 8);
  }
  b.box(0.08, 0.34, 0.5, 1.65, 2.4, 0, 0x17402a); // sign plate between the posts
  b.box(0.1, 0.05, 1.9, 1.65, 2.62, 0, rail);
  b.plane(0.46, 0.28, 1.7, 2.4, 0, Math.PI / 2, 0xe8efe8, 0);
  return b.done();
}

function barrierModel() {
  const b = builder();
  const steel = 0xb0b4b6;
  b.box(3.15, 0.3, 0.04, 0, 0.62, 0, steel);
  b.box(3.15, 0.1, 0.07, 0, 0.62, 0.0, 0x9a9ea0);
  for (const x of [-1.5, 0, 1.5]) b.box(0.1, 0.8, 0.1, x, 0.4, -0.07, 0x7a7e80);
  return b.done();
}

// ---------------------------------------------------------------- fictional poster atlases (original artwork only)
const SERIF = 'Georgia, "Times New Roman", serif', SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
function grad(g, x0, y0, x1, y1, stops) { const l = g.createLinearGradient(x0, y0, x1, y1); stops.forEach((c, i) => l.addColorStop(i / (stops.length - 1), c)); g.fillStyle = l; }
function txt(g, s, x, y, px, col, weight = '700', fam = SANS, sp = 0) { g.font = `${weight} ${px}px ${fam}`; g.letterSpacing = `${sp}px`; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y); }
function poly(g, pts, col) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fillStyle = col; g.fill(); }
function disc(g, x, y, r, col) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); }
function mountains(g, w, base, col, amp, seed) { const pts = [[0, base + 60]]; for (let x = 0; x <= w; x += w / 8) pts.push([x, base - amp * (0.5 + 0.5 * Math.sin(x * 0.045 + seed) * Math.cos(x * 0.021 + seed * 2))]); pts.push([w, base + 60]); poly(g, pts, col); }
function waves(g, w, y0, h, col, n, amp, ph) { g.strokeStyle = col; g.lineWidth = 2.2; for (let k = 0; k < n; k++) { g.beginPath(); for (let x = 0; x <= w; x += 4) { const y = y0 + k * (h / n) + Math.sin(x * 0.045 + ph + k) * amp; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); } }

const PORTRAIT = [
  (g, w, h) => { grad(g, 0, 0, 0, h, ['#f4c58c', '#e98a6b', '#44788c']); g.fillRect(0, 0, w, h); disc(g, 128, 190, 66, '#fff0c8'); mountains(g, w, 250, '#315f75', 70, 1); mountains(g, w, 290, '#1f4559', 60, 3); mountains(g, w, 335, '#12303f', 40, 5); txt(g, 'MERIDIAN AIR', 128, 52, 31, '#fff6e2', '700', SERIF, 3); txt(g, 'the long way round', 128, 358, 22, '#fff6e2', 'italic 400', SERIF); },
  (g, w, h) => { g.fillStyle = '#f2e6d0'; g.fillRect(0, 0, w, h); disc(g, 128, 190, 92, '#e3d0ae'); poly(g, [[78, 150], [178, 150], [168, 232], [88, 232]], '#5a3a26'); g.strokeStyle = '#5a3a26'; g.lineWidth = 12; g.beginPath(); g.arc(182, 188, 22, -1.2, 1.3); g.stroke(); g.strokeStyle = '#b9a47f'; g.lineWidth = 5; for (const x of [105, 128, 151]) { g.beginPath(); g.moveTo(x, 130); g.bezierCurveTo(x - 14, 110, x + 14, 95, x, 70); g.stroke(); } txt(g, 'KETTLE & BEAN', 128, 295, 28, '#4a2f1e', '700', SERIF, 1); txt(g, 'Slow-roasted.', 128, 328, 22, '#7a5a3f', 'italic 400', SERIF); txt(g, 'Slowly enjoyed.', 128, 354, 22, '#7a5a3f', 'italic 400', SERIF); },
  (g, w, h) => { grad(g, 0, 0, 0, h, ['#0d1b3e', '#1b3a7a', '#0d1b3e']); g.fillRect(0, 0, w, h); for (let i = 0; i < 6; i++) { g.strokeStyle = `rgba(240,190,80,${0.9 - i * 0.14})`; g.lineWidth = 3; g.beginPath(); g.arc(128, 170, 30 + i * 17, 0, Math.PI * 2); g.stroke(); } disc(g, 128, 170, 18, '#f0be50'); txt(g, 'BLUE HOUR', 128, 52, 38, '#f6e3b0', '700', SERIF, 2); txt(g, 'JAZZ NIGHT', 128, 300, 26, '#f0be50', '700', SANS, 4); txt(g, 'Fridays  ·  9 pm', 128, 335, 20, '#d7e3ff', '400', SANS, 1); txt(g, 'The Low Room', 128, 360, 18, '#9fb4e6', 'italic 400', SERIF); },
  (g, w, h) => { g.fillStyle = '#efe9dc'; g.fillRect(0, 0, w, h); disc(g, 90, 130, 60, '#d9462f'); poly(g, [[110, 70], [225, 70], [225, 185], [110, 185]], '#1f4f8f'); poly(g, [[60, 170], [150, 260], [60, 260]], '#f2b72e'); g.fillStyle = '#1b1b1b'; g.fillRect(165, 195, 60, 8); g.fillRect(165, 212, 60, 8); g.fillRect(165, 229, 60, 8); txt(g, 'FORM & COLOUR', 128, 298, 25, '#1b1b1b', '700', SANS, 2); txt(g, 'An exhibition of', 128, 331, 17, '#444', '400', SANS); txt(g, 'modern abstraction', 128, 352, 17, '#444', '400', SANS); },
  (g, w, h) => { grad(g, 0, 0, w, h, ['#0b3a45', '#0d6b6f']); g.fillRect(0, 0, w, h); waves(g, w, 95, 140, 'rgba(255,230,160,0.85)', 7, 14, 0.5); disc(g, 128, 170, 22, '#ffe9a8'); txt(g, 'LONG DRIVE', 128, 50, 34, '#ffefc4', '700', SANS, 3); txt(g, 'RADIO', 128, 84, 22, '#ffefc4', '400', SANS, 8); txt(g, '99.9', 128, 290, 68, '#ffd66b', '700', SANS); txt(g, 'Music for the open road', 128, 345, 19, '#d8f2ee', 'italic 400', SERIF); },
  (g, w, h) => { g.fillStyle = '#24493a'; g.fillRect(0, 0, w, h); const cols = ['#e8d9b0', '#c1583c', '#e0a93a', '#4f7ea8', '#efe7cf']; let y = 235; cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(58 + (i % 2) * 12, y - 28, 140 - (i % 3) * 14, 28); y -= 28; }); disc(g, 200, 70, 24, '#f0d58a'); txt(g, 'MARLOW & FINCH', 128, 275, 24, '#f3ead2', '700', SERIF, 1); txt(g, 'Booksellers', 128, 305, 20, '#d9c98f', 'italic 400', SERIF); txt(g, 'Read slowly.', 128, 345, 24, '#f3ead2', '400', SERIF); },
  (g, w, h) => { grad(g, 0, 0, 0, h, ['#e7f1f5', '#9cc7d8', '#256a8e']); g.fillRect(0, 0, w, h); poly(g, [[60, 190], [196, 190], [176, 222], [80, 222]], '#1a2d3d'); g.fillStyle = '#f4f4f0'; g.fillRect(100, 150, 56, 40); g.fillStyle = '#c64a36'; g.fillRect(118, 128, 20, 22); waves(g, w, 225, 100, 'rgba(255,255,255,0.8)', 6, 6, 1); txt(g, 'HARBOR LINE', 128, 55, 31, '#12384f', '700', SANS, 3); txt(g, 'FERRIES', 128, 88, 20, '#12384f', '400', SANS, 7); txt(g, 'Sail the sound.', 128, 350, 22, '#f4fafc', 'italic 400', SERIF); },
  (g, w, h) => { g.fillStyle = '#f6efd8'; g.fillRect(0, 0, w, h); [['#e8742a', 70, 140, 46], ['#7aa83a', 150, 120, 40], ['#d83f4a', 190, 190, 44], ['#f3c13a', 100, 215, 42], ['#5f9a3d', 160, 255, 34]].forEach(([c, x, y, r]) => { disc(g, x, y, r, c); disc(g, x - r * 0.3, y - r * 0.3, r * 0.22, 'rgba(255,255,255,0.35)'); }); txt(g, 'GREENLEAF', 128, 46, 33, '#3d6a2a', '700', SERIF, 2); txt(g, 'MARKET', 128, 300, 30, '#3d6a2a', '700', SANS, 5); txt(g, 'Fresh every morning', 128, 345, 20, '#8a5a2a', 'italic 400', SERIF); },
];
const WIDE = [
  (g, w, h) => { grad(g, 0, 0, w, 0, ['#0b3a45', '#0d6b6f', '#e9a64a']); g.fillRect(0, 0, w, h); waves(g, w, 30, 180, 'rgba(255,235,180,0.55)', 9, 12, 0.3); disc(g, 420, 120, 54, 'rgba(255,214,107,0.9)'); txt(g, 'LONG DRIVE RADIO 99.9', 232, 100, 44, '#fff3cf', '700', SANS, 2); txt(g, 'Music for the open road', 232, 160, 28, '#d8f2ee', 'italic 400', SERIF); },
  (g, w, h) => { grad(g, 0, 0, 0, h, ['#3b7fa8', '#bfe0ee', '#f6e4c4']); g.fillRect(0, 0, w, h); poly(g, [[60, 150], [250, 130], [330, 138], [250, 160]], '#f7f7f4'); poly(g, [[180, 142], [230, 100], [250, 104], [225, 144]], '#e7e7e2'); poly(g, [[320, 138], [340, 118], [350, 120], [345, 140]], '#c9c9c4'); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, 170); g.lineTo(65, 152); g.stroke(); txt(g, 'MERIDIAN AIR', 400, 70, 40, '#12384f', '700', SERIF, 3); txt(g, 'The long way round.', 380, 205, 28, '#12384f', 'italic 400', SERIF); },
  (g, w, h) => { g.fillStyle = '#f2e6d0'; g.fillRect(0, 0, w, h); disc(g, 400, 120, 80, '#e3d0ae'); poly(g, [[352, 92], [448, 92], [438, 160], [362, 160]], '#5a3a26'); g.strokeStyle = '#5a3a26'; g.lineWidth = 10; g.beginPath(); g.arc(452, 122, 18, -1.2, 1.3); g.stroke(); txt(g, 'KETTLE & BEAN', 150, 80, 40, '#4a2f1e', '700', SERIF, 1); txt(g, 'Good morning, slowly.', 150, 135, 27, '#7a5a3f', 'italic 400', SERIF); txt(g, 'Slow-roasted coffee', 150, 185, 20, '#9a7a5a', '400', SANS, 3); },
  (g, w, h) => { grad(g, 0, 0, 0, h, ['#ff9a4a', '#e8456a', '#4a2a6a']); g.fillRect(0, 0, w, h); disc(g, 140, 160, 76, '#ffd86b'); g.fillStyle = '#4a2a6a'; for (let i = 0; i < 6; i++) g.fillRect(50, 130 + i * 17, 180, 5 + i * 1.6); txt(g, 'SOLSTICE', 372, 85, 52, '#fff3d6', '700', SANS, 5); txt(g, 'music festival  ·  21 June', 372, 140, 22, '#ffe2c0', '400', SANS, 2); txt(g, 'three days under open sky', 372, 185, 20, '#ffd1a8', 'italic 400', SERIF); },
  (g, w, h) => { grad(g, 0, 0, 0, h, ['#e7f1f5', '#8fc0d6', '#1f6285']); g.fillRect(0, 0, w, h); poly(g, [[250, 150], [400, 150], [380, 180], [270, 180]], '#14293a'); g.fillStyle = '#f4f4f0'; g.fillRect(290, 112, 70, 38); g.fillStyle = '#c64a36'; g.fillRect(316, 90, 22, 22); waves(g, w, 182, 56, 'rgba(255,255,255,0.8)', 5, 5, 2); txt(g, 'HARBOR LINE FERRIES', 135, 70, 32, '#0f3550', '700', SANS, 2); txt(g, 'Sail the sound.', 135, 125, 28, '#0f3550', 'italic 400', SERIF); },
  (g, w, h) => { grad(g, 0, 0, w, h, ['#ffe45c', '#ffc42e']); g.fillRect(0, 0, w, h); for (const [x, y, r] of [[390, 90, 62], [455, 175, 44], [330, 175, 34]]) { disc(g, x, y, r, '#fff4a8'); disc(g, x, y, r * 0.82, '#ffe04a'); g.strokeStyle = '#fff4a8'; g.lineWidth = 3; for (let a = 0; a < 6; a++) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a * 1.047) * r * 0.8, y + Math.sin(a * 1.047) * r * 0.8); g.stroke(); } } txt(g, 'LEMON SOL', 140, 85, 46, '#7a4a00', '700', SANS, 3); txt(g, 'Bright as noon.', 140, 145, 28, '#8a5a10', 'italic 400', SERIF); },
  (g, w, h) => { grad(g, 0, 0, w, 0, ['#0f3b34', '#1c6a5a']); g.fillRect(0, 0, w, h); for (let i = 0; i < 5; i++) { g.strokeStyle = '#d9c27a'; g.lineWidth = 3; g.beginPath(); g.moveTo(380 + i * 22, 210); g.bezierCurveTo(380 + i * 22, 130, 400 + i * 22, 90, 430 + i * 10, 40); g.stroke(); } txt(g, 'THE PALM COURT', 170, 85, 38, '#f1e2b0', '700', SERIF, 3); txt(g, 'HOTEL', 170, 125, 20, '#d9c27a', '400', SANS, 10); txt(g, 'Stay a little longer.', 170, 180, 26, '#e8f2ee', 'italic 400', SERIF); },
  (g, w, h) => { grad(g, 0, 0, 0, h, ['#dfe8ee', '#b9c7d1']); g.fillRect(0, 0, w, h); g.fillStyle = '#9fb0bc'; g.fillRect(0, 175, w, 70); poly(g, [[270, 175], [300, 130], [360, 118], [430, 128], [470, 168], [480, 178], [270, 178]], '#2c8f73'); poly(g, [[310, 135], [350, 124], [420, 132], [440, 158], [300, 158]], '#bfe6f0'); disc(g, 322, 180, 20, '#1d1f21'); disc(g, 322, 180, 9, '#9aa4ab'); disc(g, 440, 180, 20, '#1d1f21'); disc(g, 440, 180, 9, '#9aa4ab'); txt(g, 'AERO ELECTRIC', 130, 80, 34, '#14323a', '700', SANS, 3); txt(g, 'Quiet miles.', 130, 135, 30, '#2c8f73', 'italic 400', SERIF); },
];
function makeAtlas(kind, renderer) {
  const portrait = kind === 'p';
  const cw = portrait ? 256 : 512, ch = portrait ? 384 : 240, cols = portrait ? 4 : 2, rows = portrait ? 2 : 4;
  const cv = document.createElement('canvas');
  cv.width = cw * cols; cv.height = ch * rows;
  const g = cv.getContext('2d');
  (portrait ? PORTRAIT : WIDE).forEach((fn, i) => {
    g.save(); g.translate((i % cols) * cw, Math.floor(i / cols) * ch); g.beginPath(); g.rect(0, 0, cw, ch); g.clip();
    try { fn(g, cw, ch); } catch (e) { g.fillStyle = '#556'; g.fillRect(0, 0, cw, ch); }
    g.restore();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  return { tex: t, grid: new THREE.Vector2(cols, rows) };
}

// ---------------------------------------------------------------- materials
const FRAG_DECL = `
uniform float uNight, uTime, uWet; uniform sampler2D uPoster; uniform vec2 uGrid; uniform vec3 uLamp;
varying float vEm; varying vec2 vUvP; varying vec2 vInfo;
float sigState(float ph) { float t = mod(uTime + ph * 80.0, 80.0); return t < 36.0 ? 2.0 : (t < 40.0 ? 1.0 : 0.0); }
`;
const FRAG_COLOR = `
vec3 emitC = vec3(0.0);
float nite = smoothstep(0.12, 0.6, uNight);
float pidx = mod(floor(vInfo.x + 0.5) + floor(min(vUvP.x, 99.0)), uGrid.x * uGrid.y);
vec2 pcell = vec2(mod(pidx, uGrid.x), floor(pidx / uGrid.x));
vec2 pf = clamp(fract(vUvP), 0.004, 0.996);
vec2 pauv = vec2((pcell.x + pf.x) / uGrid.x, 1.0 - (pcell.y + 1.0 - pf.y) / uGrid.y);
vec2 pk = vec2(1.0 / uGrid.x, -1.0 / uGrid.y);
vec3 pc = textureGrad(uPoster, pauv, dFdx(vUvP) * pk, dFdy(vUvP) * pk).rgb;
if (vEm > 4.5 && vEm < 6.5) { diffuseColor.rgb = pc; emitC += pc * (0.12 + 1.05 * nite); }
else if (vEm > 0.5 && vEm < 1.5) { emitC += uLamp * (0.04 + 4.5 * nite); }
else if (vEm > 1.5 && vEm < 4.5) {
  float st = sigState(vInfo.y);
  float want = vEm < 2.5 ? 0.0 : (vEm < 3.5 ? 1.0 : 2.0);
  vec3 lc = want < 0.5 ? vec3(1.0, 0.07, 0.03) : (want < 1.5 ? vec3(1.0, 0.5, 0.04) : vec3(0.08, 1.0, 0.33));
  emitC += lc * (abs(st - want) < 0.5 ? 2.4 + 2.2 * nite : 0.015);
}
else if (vEm > 7.5) { emitC += vec3(0.1, 1.0, 0.35) * (0.5 + 3.0 * nite); } // subway globes
else if (vEm > 6.5) { emitC += vec3(1.0, 0.92, 0.8) * 1.4 * nite; }
`;
function furnitureMaterial(shared, atlas, light, rough, metal) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uNight: shared.uNight, uTime: shared.uTime, uWet: shared.uWet, uPoster: { value: atlas?.tex || null }, uGrid: { value: atlas?.grid || new THREE.Vector2(1, 1) }, uLamp: { value: light } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEm; attribute vec2 aInfo; varying float vEm; varying vec2 vUvP; varying vec2 vInfo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEm = aEm; vInfo = aInfo; vUvP = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, uWet);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += emitC;');
  };
  return m;
}

const GLOW_VERT = `
attribute vec3 aOff; attribute vec4 aCol; attribute vec2 aMode;
uniform float uNight, uTime;
varying vec3 vCol; varying vec2 vUv; varying float vDist;
void main() {
  float nite = smoothstep(0.12, 0.6, uNight);
  vec3 lp = aOff; vec3 col = aCol.rgb; float vis = nite;
  if (aMode.x > 0.5) {
    float t = mod(uTime + aMode.y * 80.0, 80.0);
    float st = t < 36.0 ? 2.0 : (t < 40.0 ? 1.0 : 0.0);
    lp.y += st < 0.5 ? 0.33 : (st < 1.5 ? 0.0 : -0.33);
    col = st < 0.5 ? vec3(1.0, 0.1, 0.05) : (st < 1.5 ? vec3(1.0, 0.55, 0.08) : vec3(0.1, 1.0, 0.4));
    vis = 0.4 + 0.6 * nite;
  }
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(lp, 1.0);
  float dist = length(mv.xyz);
  // fade out well before the edge of the range they are gathered from, so none ever pops in or out
  vis *= 1.0 - smoothstep(${GLOW_RANGE - 110}.0, ${GLOW_RANGE - 25}.0, dist);
  // never smaller than about a pixel and a half: a sub-pixel light twinkles as it crosses pixels
  mv.xy += position.xy * max(aCol.a * (1.0 + dist * 0.0045), dist * 0.0032);
  mv.z += 0.3;
  vDist = dist; vCol = col * vis; vUv = position.xy * 2.0;
  gl_Position = vis < 0.01 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
}`;
const GLOW_FRAG = `
uniform float uFog; varying vec3 vCol; varying vec2 vUv; varying float vDist;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float a = pow(1.0 - r2, 2.0) * 0.55 + exp(-r2 * 14.0) * 0.9;
  float f = exp(-uFog * uFog * vDist * vDist);
  gl_FragColor = vec4(vCol * a * f, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const POOL_VERT = `
varying vec2 vUv; varying float vDist;
void main() {
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vDist = length(mv.xyz); vUv = position.xz / 8.0;
  gl_Position = projectionMatrix * mv;
}`;
const POOL_FRAG = `
uniform float uNight, uFog; uniform vec3 uColor; varying vec2 vUv; varying float vDist;
void main() {
  float nite = smoothstep(0.12, 0.6, uNight);
  float r = length(vUv);
  if (r > 1.0) discard;
  float a = pow(1.0 - r, 2.2) * nite * exp(-uFog * uFog * vDist * vDist) * (1.0 - smoothstep(${RANGE.lamp - 50}.0, ${RANGE.lamp - 15}.0, vDist)); // its lamp is only drawn within RANGE.lamp
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const LIGHT = { manhattan: [1.0, 0.8, 0.55], paris: [1.0, 0.7, 0.38], london: [1.0, 0.68, 0.32], la: [1.0, 0.74, 0.42], monaco: [1.0, 0.78, 0.5] };

// ---------------------------------------------------------------- the class
export class StreetFurniture {
  constructor(scene, geo, routeData, shared, renderer) {
    this.scene = scene; this.shared = shared; this.renderer = renderer;
    this.city = SIG[routeData.id] ? routeData.id : 'paris';
    this.id = routeData.id;
    this.base = `${BASE}world/${routeData.id}/street`;
    this.items = null; this.n = 0; this.cells = new Map();
    this.meshes = []; // { mesh, info, type, variant, n }
    this.glow = null; this.pool = null;
    this.clock = 1; this.lx = 1e9; this.lz = 1e9;
    this.visible = 0; this.drawCalls = 0;
    this.u = { uFog: { value: 0 } };
    this.fogRef = scene.fog;
    fetch(`${this.base}/index.json`).then((r) => (r.ok ? r.json() : null)).then((j) => (j ? this.load(j).catch((e) => console.warn('street furniture failed:', e)) : null)).catch(() => {});
  }

  get count() { return this.n; }

  async load(index) {
    const buf = await (await fetch(`${this.base}/street.bin`)).arrayBuffer();
    this.items = new Float32Array(buf);
    this.n = this.items.length / 8;
    const present = new Set();
    for (let i = 0; i < this.n; i++) {
      const o = i * 8, x = this.items[o + 1], z = this.items[o + 3];
      const k = Math.floor(x / CELL) * 65536 + Math.floor(z / CELL);
      (this.cells.get(k) || this.cells.set(k, []).get(k)).push(i);
      present.add(this.items[o] | 0);
    }
    this.build(present);
    this.lx = 1e9;
  }

  build(present) {
    const city = this.city, light = new THREE.Vector3(...LIGHT[city]);
    const needP = present, has = (t) => [...needP].some((c) => c >> 4 === TYPES.indexOf(t));
    const portrait = makeAtlas('p', this.renderer), wide = makeAtlas('w', this.renderer);
    const mat = (atlas, r = 0.5, m = 0.3) => furnitureMaterial(this.shared, atlas, light, r, m);
    const mk = (type, variant, geo, material) => {
      const cap = CAP[type];
      const mesh = new THREE.InstancedMesh(geo, material, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.count = 0;
      const info = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aInfo', info);
      this.scene.add(mesh);
      this.meshes[TYPES.indexOf(type) * 16 + variant] = { mesh, info, type, variant, n: 0, cap };
      return mesh;
    };
    this.heads = {}; // type*16+variant -> [[x,y,z]...] glow positions in local space
    if (has('lamp')) {
      const b = builder(); const def = LAMPS[city](b);
      const lamp = mk('lamp', 0, b.done(), mat(null, 0.45, 0.4));
      this.heads[0] = def.heads;
      // soft light pool on the ground, sharing the lamp instance matrices
      const pg = new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2).translate(0, 0.045, def.poolZ);
      const pm = new THREE.ShaderMaterial({ vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, uniforms: { uNight: this.shared.uNight, uFog: this.u.uFog, uColor: { value: light.clone().multiplyScalar(0.42) } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      this.pool = new THREE.InstancedMesh(pg, pm, CAP.lamp);
      this.pool.instanceMatrix = lamp.instanceMatrix;
      this.pool.frustumCulled = false; this.pool.renderOrder = 3; this.pool.count = 0; this.pool.visible = false;
      this.scene.add(this.pool);
    }
    if (has('signal')) for (const variant of [0, 1]) {
      const { geo, head } = signalModel(city, variant ? -1 : 1);
      mk('signal', variant, geo, mat(null, 0.5, 0.35));
      this.heads[T('signal') * 16 + variant] = [head];
    }
    if (has('bench')) mk('bench', 0, benchModel(city), mat(null, 0.7, 0.1));
    if (has('bin')) mk('bin', 0, binModel(city), mat(null, 0.6, 0.25));
    if (has('bollard')) mk('bollard', 0, bollardModel(city), mat(null, 0.45, 0.45));
    if (has('shelter')) mk('shelter', 0, shelterModel(city), mat(portrait, 0.4, 0.4));
    if (has('busstop')) mk('busstop', 0, busStopModel(), mat(null, 0.5, 0.4));
    if (has('column')) mk('column', 0, columnFull(city), mat(portrait, 0.5, 0.3));
    if (has('mupi')) mk('mupi', 0, mupiModel(), mat(portrait, 0.45, 0.35));
    if (has('billboard')) mk('billboard', 0, billboardModel(), mat(wide, 0.5, 0.3));
    if (has('hydrant')) for (const v of [0, 1]) mk('hydrant', v, hydrantModel(v ? 0x1c1d1f : 0xb3231c), mat(null, 0.5, 0.45));
    if (has('newsbox')) [0x1f5fa8, 0xc2312b, 0xe3b92a, 0x2f8f4e].forEach((c, v) => mk('newsbox', v, newsboxModel(c), mat(null, 0.5, 0.4)));
    if (has('steam')) mk('steam', 0, steamModel(), mat(null, 0.6, 0.2));
    if (has('subway')) { mk('subway', 0, subwayModel(), mat(null, 0.55, 0.35)); this.heads[T('subway') * 16] = [[1.65, 2.9, -0.95], [1.65, 2.9, 0.95]]; }
    if (has('barrier')) mk('barrier', 0, barrierModel(), mat(null, 0.5, 0.6));
    // glow sprites (lamp heads at night, lit signal lenses)
    const gg = new THREE.PlaneGeometry(1, 1);
    this.gOff = new THREE.InstancedBufferAttribute(new Float32Array(GLOW_CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.gCol = new THREE.InstancedBufferAttribute(new Float32Array(GLOW_CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.gMode = new THREE.InstancedBufferAttribute(new Float32Array(GLOW_CAP * 2), 2).setUsage(THREE.DynamicDrawUsage);
    gg.setAttribute('aOff', this.gOff); gg.setAttribute('aCol', this.gCol); gg.setAttribute('aMode', this.gMode);
    const gm = new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uNight: this.shared.uNight, uTime: this.shared.uTime, uFog: this.u.uFog }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glow = new THREE.InstancedMesh(gg, gm, GLOW_CAP);
    this.glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glow.frustumCulled = false; this.glow.renderOrder = 4; this.glow.count = 0;
    this.scene.add(this.glow);
    this.lightCol = light;
  }

  setEnvMap(tex) {
    for (const e of this.meshes) if (e && e.mesh.material.envMap !== tex) { e.mesh.material.envMap = tex; e.mesh.material.envMapIntensity = 0.5; e.mesh.material.needsUpdate = true; }
  }

  // writes the instance matrix of one item (rotation about Y only)
  static mat(arr, i, x, y, z, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw), o = i * 16;
    arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -s; arr[o + 3] = 0;
    arr[o + 4] = 0; arr[o + 5] = 1; arr[o + 6] = 0; arr[o + 7] = 0;
    arr[o + 8] = s; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }

  update(dt, cx, cz) {
    if (!this.glow) return;
    this.clock += dt;
    if (this.clock < 0.25) return;
    this.clock = 0;
    const night = this.shared.uNight.value;
    if (this.fogRef !== this.scene.fog) this.fogRef = this.scene.fog;
    this.u.uFog.value = this.fogRef ? this.fogRef.density : 0;
    if (this.pool) this.pool.visible = night > 0.04;
    if (Math.hypot(cx - this.lx, cz - this.lz) < 8) return;
    this.lx = cx; this.lz = cz;
    const it = this.items, R = GLOW_RANGE;
    for (const e of this.meshes) if (e) e.n = 0;
    let g = 0;
    const gm = this.glow.instanceMatrix.array, go = this.gOff.array, gc = this.gCol.array, gmo = this.gMode.array;
    const c0x = Math.floor((cx - R) / CELL), c1x = Math.floor((cx + R) / CELL), c0z = Math.floor((cz - R) / CELL), c1z = Math.floor((cz + R) / CELL);
    for (let a = c0x; a <= c1x; a++)
      for (let b = c0z; b <= c1z; b++) {
        const list = this.cells.get(a * 65536 + b);
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const o = list[k] * 8, code = it[o] | 0, type = code >> 4;
          const dx = it[o + 1] - cx, dz = it[o + 3] - cz, d2 = dx * dx + dz * dz;
          if (d2 > R * R) continue;
          const tn = TYPES[type], e = this.meshes[code];
          if (e && d2 < RANGE[tn] * RANGE[tn] && e.n < e.cap) {
            StreetFurniture.mat(e.mesh.instanceMatrix.array, e.n, it[o + 1], it[o + 2], it[o + 3], it[o + 4]);
            e.info.array[e.n * 2] = it[o + 6]; e.info.array[e.n * 2 + 1] = it[o + 6];
            e.n++;
          }
          const hs = this.heads[code];
          if (hs && g < GLOW_CAP - 2) {
            for (const h of hs) {
              StreetFurniture.mat(gm, g, it[o + 1], it[o + 2], it[o + 3], it[o + 4]);
              go[g * 3] = h[0]; go[g * 3 + 1] = h[1]; go[g * 3 + 2] = h[2];
              if (tn === 'subway') { gc[g * 4] = 0.15; gc[g * 4 + 1] = 1.0; gc[g * 4 + 2] = 0.4; gc[g * 4 + 3] = 0.9; gmo[g * 2] = 0; gmo[g * 2 + 1] = 0; }
              else if (tn === 'lamp') { gc[g * 4] = this.lightCol.x; gc[g * 4 + 1] = this.lightCol.y; gc[g * 4 + 2] = this.lightCol.z; gc[g * 4 + 3] = 1.1; gmo[g * 2] = 0; gmo[g * 2 + 1] = 0; }
              else { gc[g * 4] = 1; gc[g * 4 + 1] = 1; gc[g * 4 + 2] = 1; gc[g * 4 + 3] = 0.55; gmo[g * 2] = 1; gmo[g * 2 + 1] = it[o + 6]; }
              g++;
            }
          }
        }
      }
    let vis = 0, calls = 0;
    for (const e of this.meshes) {
      if (!e) continue;
      e.mesh.count = e.n; e.mesh.instanceMatrix.needsUpdate = true; e.info.needsUpdate = true;
      e.mesh.visible = e.n > 0; vis += e.n; if (e.n) calls++;
    }
    if (this.pool) { const l = this.meshes[0]; this.pool.count = l.n; if (l.n) calls++; }
    this.glow.count = g; this.glow.instanceMatrix.needsUpdate = true;
    this.gOff.needsUpdate = this.gCol.needsUpdate = this.gMode.needsUpdate = true;
    this.glow.visible = g > 0; if (g) calls++;
    this.visible = vis; this.glowCount = g; this.drawCalls = calls;
  }

  dispose() {
    for (const e of this.meshes) if (e) { this.scene.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); e.mesh.dispose(); }
    for (const m of [this.glow, this.pool]) if (m) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.meshes = []; this.glow = this.pool = null;
  }
}

const T = (n) => TYPES.indexOf(n);

// Morris-style advertising column (poster band wraps the cylinder; five different posters around it)
function columnFull(city) {
  const b = builder();
  const c = city === 'paris' ? 0x1c4a37 : 0x2c3033, trim = 0x8a7a3c;
  b.cyl(0.9, 0.96, 0.12, 0, 0.06, 0, c, 20);
  b.cyl(0.78, 0.86, 0.5, 0, 0.37, 0, c, 20);
  b.cyl(0.86, 0.86, 0.06, 0, 0.64, 0, trim, 20);
  b.cyl(0.8, 0.8, 1.72, 0, 1.52, 0, 0x30363a, 20);
  b.add(new THREE.CylinderGeometry(0.805, 0.805, 1.66, 20, 1, true), 0xffffff, 5, 0, 1.52, 0, 0, 0, 0, 1, 1, 1, 5);
  b.cyl(0.86, 0.86, 0.06, 0, 2.4, 0, c, 20);
  b.lathe([[0.86, 0], [0.82, 0.12], [0.64, 0.3], [0.32, 0.5], [0.12, 0.62], [0.0, 0.66]], 0, 2.43, 0, c, 20);
  b.cyl(0.04, 0.04, 0.35, 0, 3.25, 0, c, 6);
  b.sph(0.08, 0, 3.45, 0, trim);
  return b.done();
}
