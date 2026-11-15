// car.js - a procedural 1960s American pony-car convertible (top down) for "Long Drive".
// Shapes only: long bonnet, short deck, wide grille mouth, round lamps, three-bar tail lamps, chrome bumpers.
// Conventions: metres, +y up, forward = local -Z, right = +X, origin on the ground between the wheels.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function rbox(w, h, d, r, seg = 2) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.max(0.002, Math.min(r, Math.min(w, h, d) / 2 - 0.001)));
}
function ellipsoid(parent, mat, sx, sy, sz, x, y, z, ws = 20, hs = 14) {
  const m = add(parent, new THREE.SphereGeometry(1, ws, hs), mat, x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}
const _sd = new THREE.Vector3();
function rod(parent, mat, a, b, r, radial = 10) {
  const m = add(parent, new THREE.CylinderGeometry(r, r, 1, radial), mat);
  _sd.subVectors(b, a);
  const len = Math.max(1e-5, _sd.length());
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(Y_AXIS, _sd.multiplyScalar(1 / len));
  m.scale.y = len;
  return m;
}
function tube(parent, mat, pts, r, seg = 40, radial = 6, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
  return add(parent, new THREE.TubeGeometry(curve, seg, r, radial, closed), mat);
}

/* ---------------- instrument cluster texture ---------------- */
function makeInstrumentTexture() {
  const W = 640, H = 200;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#14130f'; g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,0.07)'); grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const cream = '#e9e0c6';
  const dial = (cx, cy, r, ticks, labelStep, labelMax, label) => {
    g.strokeStyle = '#b9b19a'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
    g.strokeStyle = cream; g.fillStyle = cream; g.lineWidth = 2;
    g.font = `${Math.round(r * 0.19)}px Georgia, serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i <= ticks; i++) {
      const f = i / ticks, a = (135 - 270 * f) * Math.PI / 180;
      const dx = -Math.sin(a), dy = -Math.cos(a);
      const major = i % (ticks / (labelMax / labelStep)) === 0;
      const r0 = r * (major ? 0.78 : 0.86), r1 = r * 0.94;
      g.lineWidth = major ? 3 : 1.5;
      g.beginPath(); g.moveTo(cx + dx * r0, cy + dy * r0); g.lineTo(cx + dx * r1, cy + dy * r1); g.stroke();
      if (major) g.fillText(String(Math.round(f * labelMax)), cx + dx * r * 0.62, cy + dy * r * 0.62);
    }
    g.font = `${Math.round(r * 0.16)}px Georgia, serif`;
    g.fillText(label, cx, cy + r * 0.42);
  };
  dial(170, 100, 88, 24, 20, 120, 'MPH');
  dial(380, 100, 56, 8, 1, 8, 'x1000');
  dial(515, 100, 56, 8, 2, 8, 'FUEL');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, w: W, h: H };
}

/* ---------------- wheel: wire wheel, chrome rim, whitewall ---------------- */
const WHEEL_R = 0.34, WHEEL_X = 0.72, WHEEL_Z = 1.375;
function buildWheel(side, mats) {
  const spin = new THREE.Group();
  const hw = 0.1;
  const pts = [
    [0.225, -0.09], [0.26, -0.098], [0.30, -0.1], [0.325, -0.085], [0.337, -0.055], [0.34, -0.02],
    [0.34, 0.02], [0.337, 0.055], [0.325, 0.085], [0.30, 0.1], [0.26, 0.098], [0.225, 0.09],
  ].map(([r, y]) => new THREE.Vector2(r, y * hw / 0.1));
  const tyre = new THREE.LatheGeometry(pts, 44);
  tyre.rotateZ(Math.PI / 2);
  add(spin, tyre, mats.rubber);
  const barrel = new THREE.CylinderGeometry(0.222, 0.222, 0.18, 28, 1, true);
  barrel.rotateZ(Math.PI / 2);
  add(spin, barrel, mats.dark);
  // whitewall band on the outer sidewall
  const ww = new THREE.RingGeometry(0.245, 0.30, 48);
  ww.rotateY(side * Math.PI / 2);
  add(spin, ww, mats.cream, side * (hw + 0.0035), 0, 0).castShadow = false;
  // chrome rim lip
  const lip = new THREE.TorusGeometry(0.222, 0.011, 8, 44);
  lip.rotateY(Math.PI / 2);
  add(spin, lip, mats.chrome, side * 0.085, 0, 0);
  // wire spokes (crossed), hub and spinner
  const N = 20;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU, b = a + (i % 2 ? 0.55 : -0.55);
    const hubA = V(side * (i % 2 ? 0.045 : 0.025), Math.cos(b) * 0.05, Math.sin(b) * 0.05);
    const rim = V(side * 0.005, Math.cos(a) * 0.215, Math.sin(a) * 0.215);
    rod(spin, mats.trim, hubA, rim, 0.0028, 4);
  }
  const hub = new THREE.CylinderGeometry(0.058, 0.058, 0.05, 20);
  hub.rotateZ(Math.PI / 2);
  add(spin, hub, mats.chrome, side * 0.04, 0, 0);
  const dome = new THREE.SphereGeometry(0.052, 20, 10, 0, TAU, 0, Math.PI / 2);
  dome.rotateZ(-side * Math.PI / 2);
  add(spin, dome, mats.chrome, side * 0.062, 0, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    const wing = add(spin, rbox(0.012, 0.012, 0.075, 0.004, 1), mats.chrome, side * 0.1, Math.sin(a) * 0.0, Math.cos(a) * 0.0);
    wing.rotation.x = a;
    wing.position.x = side * 0.1;
  }
  return spin;
}

/* ---------------- body shape ---------------- */
const Z_FRONT = -2.19, Z_REAR = 2.28, Z_COWL = -0.67, Z_SEAT_WALL = 1.53;
const BELT = 0.925, FLOOR = 0.4;
const widthAt = (z) => {
  const tf = clamp((-1.45 - z) / 0.74, 0, 1), tr = clamp((z - 1.55) / 0.73, 0, 1);
  return 0.862 - 0.075 * tf * tf - 0.05 * tr * tr + 0.008 * (gauss(z, -WHEEL_Z, 0.4) + gauss(z, WHEEL_Z, 0.4));
};
// shoulder line: a gentle fender peak that runs the length of the car, a soft hip swell over the rear wheel
const shoulderAt = (z) => {
  if (z < -0.7) {
    const s = clamp((-0.7 - z) / 1.5, 0, 1);
    return BELT - 0.01 - 0.07 * Math.pow(s, 1.3) + 0.014 * gauss(z, -WHEEL_Z, 0.45);
  }
  if (z < 0.5) return BELT;
  return BELT - 0.006 + 0.034 * gauss(z, 1.5, 0.62) - 0.03 * smooth01(1.9, 2.28, z);
};
const centreAt = (z) => z < -0.7 ? shoulderAt(z) + 0.02 - 0.006 * smooth01(-1.2, -2.2, z) : shoulderAt(z) + 0.012 - 0.04 * gauss(z, 1.55, 0.5);
const archAt = (z) => {
  let a = 0;
  for (const wz of [-WHEEL_Z, WHEEL_Z]) {
    const dz = Math.abs(z - wz);
    if (dz < 0.4) a = Math.max(a, 0.34 + Math.sqrt(0.16 - dz * dz));
  }
  return a;
};
const baseBottom = (z) => 0.26 + 0.1 * smooth01(-1.85, -2.22, z) + 0.12 * smooth01(1.9, 2.26, z);

// right-half profile (bottom centre -> top centre) for a station: smooth splines through control points,
// with a large shoulder radius, tumblehome and a tucked-under sill. Hood/deck and open-cockpit variants share
// the flank and are blended by c.
const NC = 16, NH = 9;
const spl = (pts, n) => new THREE.CatmullRomCurve3(pts.map(([x, y]) => V(x, y, 0)), false, 'centripetal').getPoints(n - 1).map((p) => [p.x, p.y]);
function profile(z) {
  const w = widthAt(z), yb = baseBottom(z), ys = shoulderAt(z), yt = centreAt(z), a = archAt(z);
  const dy = yt - ys;
  const y3 = Math.max(yb, a), y4 = Math.max(yb + 0.035, a), y5 = Math.max(yb + 0.11, a > 0 ? a + 0.012 : 0);
  const tum = 0.2;                                   // flank tumblehome strength
  const out = [[0, yb], [0.5 * w, yb], [0.68 * w, yb]];
  const flank = spl([
    [0.8 * w, y3], [0.92 * w, y4], [0.962 * w, y5], [0.995 * w, y5 + (ys - y5) * 0.3], [w, ys - 0.30],
    [(1 - 0.03 * tum) * w, ys - 0.17], [(1 - 0.11 * tum) * w, ys - 0.08], [0.945 * w, ys - 0.03], [0.9 * w, ys - 0.004], [0.85 * w, ys],
  ], NC);
  const hood = spl([[0.85 * w, ys], [0.62 * w, ys + dy * 0.55], [0.34 * w, ys + dy * 0.9], [0.12 * w, yt], [0, yt]], NH + 1).slice(1);
  const k = 1 - 0.2 * smooth01(0.95, 1.12, z);
  const cock = spl([[0.85 * w, ys], [0.805 * w, ys - 0.003], [0.78 * w * k, ys - 0.04], [0.775 * w * k, ys - 0.14], [0.775 * w * k, 0.5], [0.72 * w * k, 0.42], [0.4 * w, FLOOR], [0, FLOOR]], NH + 1).slice(1);
  const c = smooth01(Z_COWL - 0.05, Z_COWL + 0.03, z) * (1 - smooth01(Z_SEAT_WALL - 0.03, Z_SEAT_WALL + 0.04, z));
  const tail = hood.map((p, i) => [lerp(p[0], cock[i][0], c), lerp(p[1], cock[i][1], c)]);
  return out.concat(flank, tail);
}
// x of the outer flank at height y (for trim that must sit on the surface)
function sx(z, y) {
  const p = profile(z).slice(3, 3 + NC);
  for (let i = 0; i < p.length - 1; i++) {
    if (p[i + 1][1] > p[i][1] + 1e-6 && y >= p[i][1] && y <= p[i + 1][1]) return lerp(p[i][0], p[i + 1][0], (y - p[i][1]) / (p[i + 1][1] - p[i][1]));
  }
  return p[p.length - 1][0];
}

function bodyGeo() {
  const zs = [];
  const ends = (z0, dir) => [0, 0.003, 0.01, 0.02, 0.035, 0.055, 0.08, 0.1, 0.12].map((d) => z0 + dir * d);
  zs.push(...ends(Z_FRONT, 1));
  for (let z = -2.12; z < 2.2; z += 0.03) zs.push(z);
  for (let z = Z_COWL - 0.06; z < Z_COWL + 0.05; z += 0.012) zs.push(z);
  for (let z = Z_SEAT_WALL - 0.04; z < Z_SEAT_WALL + 0.05; z += 0.012) zs.push(z);
  zs.push(...ends(Z_REAR, -1));
  const sorted = [...new Set(zs.map((z) => +z.toFixed(4)))].sort((a, b) => a - b);
  const pos = [];
  let nRing = 0;
  const cy = 0.58;
  const stationRings = [];
  for (const z of sorted) {
    let f = 1;
    const rnd = (d, L, fmin) => 1 - (1 - fmin) * (1 - Math.sqrt(Math.max(0, 1 - (1 - d / L) ** 2)));
    if (z < Z_FRONT + 0.12) f = rnd(z - Z_FRONT, 0.12, 0.9);
    if (z > Z_REAR - 0.1) f = rnd(Z_REAR - z, 0.1, 0.92);
    const p = profile(z);
    const ring = [];
    for (let i = 0; i < p.length; i++) ring.push([p[i][0], p[i][1]]);
    for (let i = p.length - 2; i >= 1; i--) ring.push([-p[i][0], p[i][1]]);
    nRing = ring.length;
    for (const [x, y] of ring) pos.push(x * f, cy + (y - cy) * f, z);
    stationRings.push(ring.map(([x, y]) => [x * f, cy + (y - cy) * f]));
  }
  const idx = [];
  const NS = sorted.length;
  for (let j = 0; j < NS - 1; j++) for (let i = 0; i < nRing; i++) {
    const i2 = (i + 1) % nRing;
    const a = j * nRing + i, b = j * nRing + i2, c = (j + 1) * nRing + i, d = (j + 1) * nRing + i2;
    idx.push(a, c, b, b, c, d);
  }
  // end caps (own vertices for flat normals)
  const capPos = [], capIdx = [];
  const cap = (j, nz) => {
    const base = pos.length / 3 + capPos.length / 3;
    let cx = 0, cyy = 0;
    for (let i = 0; i < nRing; i++) { cx += pos[(j * nRing + i) * 3]; cyy += pos[(j * nRing + i) * 3 + 1]; }
    capPos.push(cx / nRing, cyy / nRing, pos[(j * nRing) * 3 + 2]);
    for (let i = 0; i < nRing; i++) capPos.push(pos[(j * nRing + i) * 3], pos[(j * nRing + i) * 3 + 1], pos[(j * nRing + i) * 3 + 2]);
    for (let i = 0; i < nRing; i++) {
      const a = base + 1 + i, b = base + 1 + (i + 1) % nRing;
      if (nz < 0) capIdx.push(base, b, a); else capIdx.push(base, a, b);
    }
  };
  const nBody = pos.length / 3;
  cap(0, -1); cap(NS - 1, 1);
  const all = pos.concat(capPos);
  const capIdxFixed = capIdx;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));
  g.setIndex(idx.concat(capIdxFixed));
  g.computeVertexNormals();
  // check outward orientation on the right flank at the middle station; flip if inverted
  const mid = Math.floor(NS / 2);
  const nrm = g.attributes.normal;
  if (nrm.getX(mid * nRing + 11) < 0) {
    const ix = g.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.computeVertexNormals();
  }
  // caps: verify the first cap's normal points forward/backward
  const fixCap = (startIdx, nz) => {
    const ix = g.index.array, P = g.attributes.position;
    const a = ix[startIdx], b = ix[startIdx + 1], c = ix[startIdx + 2];
    const e1 = V(P.getX(b) - P.getX(a), P.getY(b) - P.getY(a), P.getZ(b) - P.getZ(a));
    const e2 = V(P.getX(c) - P.getX(a), P.getY(c) - P.getY(a), P.getZ(c) - P.getZ(a));
    const n = e1.cross(e2);
    return n.z * nz > 0;
  };
  const ix = g.index.array;
  const frontStart = idx.length, rearStart = idx.length + nRing * 3;
  if (!fixCap(frontStart, -1)) for (let i = frontStart; i < rearStart; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  if (!fixCap(rearStart, 1)) for (let i = rearStart; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  g.computeVertexNormals();
  return g;
}

/* ---------------- the car ---------------- */
export function buildCar(mats) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const { chrome, trim, glass, dashMat, cream, ivory, dark, red } = mats;
  // deep red lacquer: non-metallic base and a softer clear coat, so bright sky doesn't wash the bonnet out to grey
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x7a0b13, metalness: 0.0, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.14, envMapIntensity: 0.16 });
  const refs = { group, body, wheels: [], steerPivots: [], envMats: [paint] };

  // ---- shell
  add(body, bodyGeo(), paint);
  // arch liners and lips
  for (const s of [-1, 1]) for (const wz of [-WHEEL_Z, WHEEL_Z]) {
    const liner = new THREE.CylinderGeometry(0.405, 0.405, 0.24, 28, 1, true, 0, Math.PI);
    liner.rotateZ(Math.PI / 2);
    add(body, liner, dark, s * 0.745, 0.34, wz);
    const lp = [];
    for (let i = 0; i <= 24; i++) {
      const th = (i / 24) * Math.PI, z = wz + Math.cos(th) * 0.4, y = 0.34 + Math.sin(th) * 0.4 + 0.012;
      lp.push(V(s * (sx(z, y) + 0.002), y, z));
    }
    tube(body, paint, lp, 0.013, 30, 6);
  }
  add(body, rbox(1.4, 0.04, 3.9, 0.02), dark, 0, 0.22, -0.1);        // under-tray so you never see sky through the car
  add(body, rbox(1.3, 0.012, 1.7, 0.005, 1), dashMat, 0, 0.412, 0.72); // carpet
  add(body, rbox(0.2, 0.1, 1.3, 0.04), dashMat, 0, 0.46, 0.1);         // tunnel

  // ---- side detailing
  const wAt = widthAt;
  for (const s of [-1, 1]) {
    // door cut lines
    for (const z of [-0.6, 0.5]) add(body, rbox(0.006, 0.5, 0.006, 0.002, 1), dark, s * (sx(z, 0.65) + 0.001), 0.65, z);
    add(body, rbox(0.006, 0.006, 1.1, 0.002, 1), dark, s * (sx(0, 0.40) + 0.001), 0.40, -0.05);
    // chrome rocker trim, door handle
    add(body, rbox(0.014, 0.03, 1.7, 0.01), chrome, s * (sx(0, 0.37) + 0.004), 0.37, 0);
    add(body, rbox(0.016, 0.024, 0.11, 0.01), chrome, s * (sx(0.3, 0.8) + 0.006), 0.8, 0.3);
    // slim chrome line along the lip of the cockpit
    const lipPts = [];
    for (let z = -0.62; z <= 1.52; z += 0.07) lipPts.push(V(s * widthAt(z) * 0.835, shoulderAt(z) + 0.003, z));
    tube(body, chrome, lipPts, 0.0065, 50, 5);
    // fender spear, front
    const sp = [];
    for (let z = -1.9; z <= -0.72; z += 0.1) sp.push(V(s * (sx(z, shoulderAt(z) - 0.1) + 0.002), shoulderAt(z) - 0.1, z));
    tube(body, trim, sp, 0.006, 20, 5);
    // C-shaped side sculpt on the rear quarter, with the scoop inside
    const cPts = [
      [1.5, 0.82], [1.15, 0.84], [0.8, 0.82], [0.58, 0.77], [0.5, 0.67], [0.54, 0.56], [0.68, 0.5], [0.95, 0.5], [1.12, 0.52],
    ].map(([z, y]) => V(s * (sx(z, y) + 0.004), y, z));
    tube(body, chrome, cPts, 0.0075, 50, 6);
    add(body, rbox(0.01, 0.12, 0.3, 0.004, 1), dark, s * (sx(0.78, 0.63) + 0.003), 0.63, 0.78);
    for (let i = 0; i < 3; i++) add(body, rbox(0.012, 0.008, 0.28, 0.003, 1), chrome, s * (sx(0.78, 0.59 + i * 0.035) + 0.006), 0.59 + i * 0.035, 0.78);
  }

  // ---- seats: front buckets, rear bench
  const seatMat = cream, pipe = red;
  const bucket = (x, z, w) => {
    add(body, rbox(w, 0.13, 0.5, 0.05), seatMat, x, 0.5, z);
    const back = add(body, rbox(w, 0.54, 0.12, 0.05), seatMat, x, 0.8, z + 0.3);
    back.rotation.x = 0.2;
    for (const dy of [-0.15, -0.02, 0.11, 0.24]) {
      const p = add(body, rbox(w - 0.04, 0.008, 0.012, 0.003, 1), pipe, x, 0.8 + dy, z + 0.236 - dy * 0.2);
      p.rotation.x = 0.2;
    }
    add(body, rbox(w + 0.03, 0.04, 0.12, 0.02), red, x, 0.505, z - 0.18 + 0.02).visible = true;
  };
  bucket(-0.38, 0.4, 0.55); bucket(0.38, 0.4, 0.55);
  add(body, rbox(1.02, 0.12, 0.45, 0.05), seatMat, 0, 0.5, 1.18);
  const rb = add(body, rbox(1.02, 0.42, 0.1, 0.04), seatMat, 0, 0.78, 1.46);
  rb.rotation.x = 0.12;
  for (const dy of [-0.08, 0.06, 0.2]) add(body, rbox(0.98, 0.008, 0.012, 0.003, 1), pipe, 0, 0.78 + dy, 1.405);

  // ---- door panels
  for (const s of [-1, 1]) {
    const x = s * (wAt(0) * 0.78 - 0.012);
    add(body, rbox(0.02, 0.4, 1.2, 0.01), seatMat, x, 0.66, 0.0);
    add(body, rbox(0.02, 0.1, 1.2, 0.01), red, x - s * 0.002, 0.43, 0.0);
    add(body, rbox(0.05, 0.04, 0.4, 0.02), chrome, x - s * 0.02, 0.74, 0.22);       // armrest bar
    add(body, rbox(0.05, 0.05, 0.4, 0.02), seatMat, x - s * 0.02, 0.7, 0.22);
  }
  // gear lever
  rod(body, chrome, V(0, 0.5, 0.18), V(0, 0.66, 0.12), 0.007, 8);
  ellipsoid(body, dark, 0.018, 0.018, 0.018, 0, 0.67, 0.115);

  // ---- dashboard
  {
    const prof = [[-0.76, 0.78], [-0.76, 0.87], [-0.62, 0.885], [-0.45, 0.865], [-0.37, 0.825], [-0.345, 0.75], [-0.40, 0.62], [-0.76, 0.62]];
    const sh = new THREE.Shape();
    prof.forEach(([z, y], i) => (i ? sh.lineTo(-z, y) : sh.moveTo(-z, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1.3, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 4, curveSegments: 1 });
    g.rotateY(Math.PI / 2);
    g.translate(-0.65, 0, 0);
    add(body, g, dashMat);
    add(body, rbox(1.36, 0.012, 0.012, 0.004, 1), chrome, 0, 0.805, -0.36);
    add(body, rbox(0.3, 0.09, 0.014, 0.01), dark, 0.36, 0.72, -0.37);
    add(body, rbox(0.26, 0.085, 0.014, 0.01), chrome, 0.0, 0.72, -0.37);
    refs.dialMat = new THREE.MeshStandardMaterial({ color: 0x2a1c0c, emissive: 0xffa040, emissiveIntensity: 0.15, roughness: 0.4 });
    refs.vu = [];
    const pod = new THREE.Group();
    pod.position.set(-0.08, 0.905, -0.56);
    pod.rotation.x = -0.36;
    body.add(pod);
    add(pod, rbox(0.21, 0.058, 0.022, 0.008), dark, 0, 0, -0.012);
    add(pod, new THREE.PlaneGeometry(0.17, 0.016), refs.dialMat, 0, 0.012, 0.0005);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.MeshStandardMaterial({ color: 0x1a1208, emissive: i < 4 ? 0x7dff9a : i < 5 ? 0xffd060 : 0xff5a3c, emissiveIntensity: 0.02, roughness: 0.4 });
      add(pod, new THREE.PlaneGeometry(0.022, 0.012), m, -0.07 + i * 0.028, -0.01, 0.0005);
      refs.vu.push(m);
    }
  }
  const cluster = new THREE.Group();
  cluster.position.set(-0.38, 0.915, -0.575);
  cluster.rotation.x = -0.36;
  body.add(cluster);
  const gauge = makeInstrumentTexture();
  const gH = 0.4 * gauge.h / gauge.w;
  add(cluster, rbox(0.44, gH + 0.04, 0.05, 0.016, 3), dashMat, 0, 0, -0.03);
  add(cluster, rbox(0.43, gH + 0.028, 0.012, 0.01, 2), chrome, 0, 0, -0.004);
  add(cluster, rbox(0.44, 0.02, 0.06, 0.008), dashMat, 0, gH / 2 + 0.028, 0.0);
  const gaugeMat = new THREE.MeshStandardMaterial({ map: gauge.tex, roughness: 0.4, metalness: 0.0, emissive: 0xffffff, emissiveMap: gauge.tex, emissiveIntensity: 0.05 });
  refs.gaugeMat = gaugeMat;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.4, gH), gaugeMat);
  face.position.set(0, 0, 0.004);
  cluster.add(face);
  const needlePivot = new THREE.Group();
  const needle = new THREE.Mesh(rbox(0.003, 0.04, 0.002, 0.001, 1), new THREE.MeshStandardMaterial({ color: 0xd83a1c, roughness: 0.4 }));
  needle.position.y = 0.016;
  needlePivot.add(needle);
  needlePivot.position.set((170 / gauge.w - 0.5) * 0.4, (0.5 - 100 / gauge.h) * gH, 0.003);
  face.add(needlePivot);
  refs.needle = needlePivot;

  // ---- steering wheel: thin rim, half-ring horn bar, three spokes
  const sw = new THREE.Group();
  sw.position.set(-0.38, 1.02, -0.42);
  sw.rotation.x = -0.5;
  body.add(sw);
  const spinWheel = new THREE.Group();
  sw.add(spinWheel);
  add(spinWheel, new THREE.TorusGeometry(0.17, 0.011, 12, 52), ivory);
  add(spinWheel, new THREE.TorusGeometry(0.12, 0.0045, 6, 36, Math.PI), chrome).rotation.z = Math.PI;
  const hub = new THREE.CylinderGeometry(0.034, 0.044, 0.05, 20);
  hub.rotateX(Math.PI / 2);
  add(spinWheel, hub, chrome, 0, 0, -0.012);
  const capG = new THREE.CylinderGeometry(0.02, 0.02, 0.012, 20);
  capG.rotateX(Math.PI / 2);
  add(spinWheel, capG, red, 0, 0, 0.02);
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const sp = add(spinWheel, rbox(0.14, 0.009, 0.008, 0.003, 2), chrome, Math.cos(a) * 0.095, Math.sin(a) * 0.095, 0);
    sp.rotation.z = a;
  }
  refs.steerWheel = spinWheel;
  rod(body, dark, V(-0.38, 1.02, -0.44), V(-0.38, 0.72, -0.62), 0.02, 12);

  // ---- windshield: a low screen, top edge 1.22 m (driver's eye 1.36 m); slim chrome frame
  const SH = 1.22, BASEY = 0.915, BASEZ = -0.7, RAKE = 0.459;
  const baseP = (x) => V(x, BASEY, BASEZ), topP = (x) => V(x, SH, BASEZ + (SH - BASEY) * RAKE);
  for (const s of [-1, 1]) {
    rod(body, chrome, baseP(s * 0.82), topP(s * 0.81), 0.0065, 8);
    add(body, rbox(0.05, 0.026, 0.06, 0.01), chrome, s * 0.82, BASEY + 0.005, BASEZ + 0.005);
  }
  rod(body, chrome, topP(-0.81), topP(0.81), 0.006, 8);
  rod(body, chrome, baseP(-0.82), baseP(0.82), 0.007, 8);
  const gLen = (SH - BASEY) / Math.cos(0.43);
  const glassMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.62, gLen), glass);
  glassMesh.position.set(0, (BASEY + SH) / 2, BASEZ + ((SH - BASEY) * RAKE) / 2);
  glassMesh.rotation.x = -0.43;
  glassMesh.renderOrder = 5;
  body.add(glassMesh);

  // ---- mirrors
  for (const s of [-1, 1]) {
    rod(body, trim, V(s * 0.84, 0.94, -0.62), V(s * 0.93, 1.0, -0.58), 0.008, 8);
    const head = ellipsoid(body, trim, 0.016, 0.036, 0.05, s * 0.945, 1.01, -0.56);
    head.rotation.y = -s * 0.25;
    const mf = add(body, new THREE.CircleGeometry(0.032, 20), mats.mirror, s * 0.945 - s * 0.0185, 1.01, -0.56);
    mf.scale.set(1, 1.1, 1);
    mf.rotation.y = -s * Math.PI / 2 + s * 0.3;
    mf.castShadow = false;
  }

  // ---- front end: wide grille mouth with chrome surround, plain chrome ring in the middle
  const zf = Z_FRONT - 0.006;
  add(body, rbox(0.86, 0.25, 0.03, 0.1, 4), dark, 0, 0.56, zf);
  const rr = [];
  { const hw = 0.445, hh = 0.135, r = 0.1;
    for (let q = 0; q < 4; q++) for (let i = 0; i <= 6; i++) {
      const a = (q + i / 6) * Math.PI / 2, cx = (q === 0 || q === 3) ? hw - r : -(hw - r), cyy = (q < 2) ? hh - r : -(hh - r);
      rr.push(V(cx + Math.cos(a) * r, 0.56 + cyy + Math.sin(a) * r, zf - 0.016));
    }
    const keep = rr.filter((p, k) => k % 7 !== 0 || true);
    tube(body, chrome, keep.filter((p, k) => !(k > 0 && p.distanceTo(keep[k - 1]) < 1e-4)), 0.011, 80, 6, true); }
  add(body, rbox(0.8, 0.016, 0.016, 0.006), chrome, 0, 0.56, zf - 0.016);                     // centre bar
  const ring = new THREE.TorusGeometry(0.07, 0.01, 8, 28);
  add(body, ring, chrome, 0, 0.56, zf - 0.024);
  const bump = (z, y, dir, halfW, r = 0.032) => {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const x = -halfW + (2 * halfW * i) / 14;
      const t = smooth01(0.5, 0.88, Math.abs(x));
      pts.push(V(x, y, z + dir * 0.26 * t * t));
    }
    tube(body, chrome, pts, r, 50, 8);
    for (const s of [-1, 1]) {
      const g = new THREE.CapsuleGeometry(0.026, 0.1, 4, 8);
      add(body, g, chrome, s * 0.5, y + 0.02, z + dir * 0.04);
    }
  };
  bump(Z_FRONT - 0.09, 0.33, 1, 0.86);
  bump(Z_REAR + 0.09, 0.38, -1, 0.86, 0.024);

  const headMat = mats.headLens, tailMat = mats.tailLens;
  refs.headMat = headMat; refs.tailMat = tailMat;
  refs.spots = [];
  for (const s of [-1, 1]) {
    const hx = s * 0.6, hy = 0.64;
    const bez = new THREE.TorusGeometry(0.098, 0.014, 8, 28);
    add(body, bez, chrome, hx, hy, Z_FRONT - 0.002);
    add(body, new THREE.CylinderGeometry(0.098, 0.098, 0.02, 24).rotateX(Math.PI / 2), dark, hx, hy, Z_FRONT + 0.005);
    ellipsoid(body, headMat, 0.088, 0.088, 0.035, hx, hy, Z_FRONT - 0.008);
    const spot = new THREE.SpotLight(0xfff0d6, 0, 120, 0.46, 0.6, 2);
    spot.position.set(hx, hy, Z_FRONT - 0.1);
    spot.castShadow = false;
    const tgt = new THREE.Object3D();
    tgt.position.set(s * 0.5, -0.4, -30);
    body.add(tgt);
    spot.target = tgt;
    body.add(spot);
    refs.spots.push(spot);
    // parking lamp
    add(body, rbox(0.05, 0.03, 0.02, 0.01), chrome, s * 0.8, 0.47, Z_FRONT + 0.0);

    // tail: three vertical lamps per side in a chrome housing
    const zr = Z_REAR + 0.004;
    add(body, rbox(0.28, 0.2, 0.025, 0.04, 3), chrome, s * 0.575, 0.68, zr);
    for (let i = 0; i < 3; i++) add(body, rbox(0.06, 0.16, 0.02, 0.012), tailMat, s * (0.495 + i * 0.082), 0.68, zr + 0.012);
    // exhaust tip
    const ex = new THREE.CylinderGeometry(0.03, 0.03, 0.14, 12, 1, true);
    ex.rotateX(Math.PI / 2);
    add(body, ex, chrome, s * 0.45, 0.3, Z_REAR + 0.06);
  }
  add(body, rbox(0.9, 0.014, 0.016, 0.005), chrome, 0, 0.775, Z_REAR + 0.004);
  add(body, rbox(0.5, 0.15, 0.006, 0.01), dark, 0, 0.6, Z_REAR - 0.004);
  // plain plate blank + trim bar + fuel cap, rear
  add(body, rbox(0.34, 0.11, 0.012, 0.01), cream, 0, 0.5, Z_REAR + 0.003);
  add(body, rbox(0.4, 0.016, 0.02, 0.008), chrome, 0, 0.58, Z_REAR + 0.003);
  add(body, rbox(0.4, 0.016, 0.02, 0.008), chrome, 0, 0.42, Z_REAR + 0.003);
  add(body, new THREE.CylinderGeometry(0.05, 0.05, 0.016, 20).rotateX(Math.PI / 2), chrome, 0, 0.7, Z_REAR + 0.004);

  // ---- wheels (not part of the sprung body)
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
    const steer = new THREE.Group();
    steer.position.set(sx * WHEEL_X, WHEEL_R, sz * WHEEL_Z);
    const spin = buildWheel(sx, mats);
    steer.add(spin);
    group.add(steer);
    refs.wheels.push(spin);
    if (sz < 0) refs.steerPivots.push(steer);
  });
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return refs;
}
