// vehicles.js - procedural vehicles + camera rigs for "Long Drive".
// Conventions: metres, +y up, forward = local -Z, right = +X. No external assets.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeStatic, refsOf } from './merge.js';
import { buildCar as buildClassicCar } from './car.js';

export const RIDES = {
  car:   { label: 'Open-top car', maxSpeed: 39, cruise: 19, accel: 2.6, brake: 3.5, lane: 1.75, eyeHeight: 1.12 },
  horse: { label: 'Horse',        maxSpeed: 13.5, cruise: 3.6, accel: 1.7, brake: 2.5, lane: 3.9,  eyeHeight: 2.35 },
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const wrapPI = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

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
function ellipsoid(parent, mat, sx, sy, sz, x, y, z, ws = 24, hs = 16) {
  const m = add(parent, new THREE.SphereGeometry(1, ws, hs), mat, x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}
// Cylinder of radius r between points a and b (build time only).
function rod(parent, mat, a, b, r, radial = 10) {
  const m = add(parent, new THREE.CylinderGeometry(r, r, 1, radial), mat);
  placeSegment(m, a, b, r);
  return m;
}
const _sd = new THREE.Vector3();
function placeSegment(m, a, b) {
  _sd.subVectors(b, a);
  const len = Math.max(1e-5, _sd.length());
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(Y_AXIS, _sd.multiplyScalar(1 / len));
  m.scale.y = len;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ------------------------------------------------------------------ */
/* CAR                                                                 */
/* ------------------------------------------------------------------ */
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

function buildWheel(side, mats) {
  const spin = new THREE.Group();
  const lathePts = [
    [0.22, -0.095], [0.26, -0.105], [0.30, -0.108], [0.325, -0.092], [0.338, -0.06], [0.34, -0.02],
    [0.34, 0.02], [0.338, 0.06], [0.325, 0.092], [0.30, 0.108], [0.26, 0.105], [0.22, 0.095],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tyreGeo = new THREE.LatheGeometry(lathePts, 40);
  tyreGeo.rotateZ(Math.PI / 2);
  add(spin, tyreGeo, mats.rubber);
  // inner rim barrel
  const barrel = new THREE.CylinderGeometry(0.22, 0.22, 0.19, 28, 1, true);
  barrel.rotateZ(Math.PI / 2);
  add(spin, barrel, mats.dark);
  // whitewall
  const ww = new THREE.RingGeometry(0.235, 0.295, 48);
  ww.rotateY(side * Math.PI / 2);
  add(spin, ww, mats.cream, side * 0.1085, 0, 0).castShadow = false;
  // chrome disc + hubcap
  const disc = new THREE.CylinderGeometry(0.215, 0.215, 0.02, 32);
  disc.rotateZ(Math.PI / 2);
  add(spin, disc, mats.chrome, side * 0.09, 0, 0);
  const dome = new THREE.SphereGeometry(0.095, 24, 10, 0, TAU, 0, Math.PI / 2);
  dome.rotateZ(-side * Math.PI / 2);
  add(spin, dome, mats.chrome, side * 0.098, 0, 0);
  // painted radial ribs + lug nuts so rotation reads
  const ribGeo = rbox(0.012, 0.09, 0.02, 0.005, 2);
  const nutGeo = new THREE.SphereGeometry(0.014, 8, 6);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const rib = add(spin, ribGeo, mats.paint, side * 0.103, Math.cos(a) * 0.155, Math.sin(a) * 0.155);
    rib.rotation.x = -a;
    if (i % 4 === 0) {
      const a2 = a + Math.PI / 8;
      add(spin, nutGeo, mats.chrome, side * 0.108, Math.cos(a2) * 0.075, Math.sin(a2) * 0.075);
    }
  }
  return spin;
}


const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

// Wheel-arch fender: one sculpted sheet (outer wall -> rolled shoulder -> top -> optional inner skirt).
// Built for the +X side; mirrored for -X. Top surface height comes from topFn(x, z).
function fenderGeo(side, { zMin, zMax, wz, xout, xin, top, innerBottom }) {
  const NZ = 44, R = 0.5, r = 0.05;
  const arch = (z) => {
    const d = (z - wz) / R;
    const a = 0.34 + 0.375 * Math.sqrt(Math.max(0, 1 - d * d));
    return Math.max(0.42, a);
  };
  const pos = [];
  let M = 0;
  for (let j = 0; j <= NZ; j++) {
    const z = zMin + (zMax - zMin) * (j / NZ);
    const yb = arch(z);
    const yTop = top(xout - r, z);
    const pts = [];
    const wallH = Math.max(0.01, yTop - r - yb);
    for (let k = 0; k <= 7; k++) { const u = k / 7; pts.push([xout - 0.018 * u * u, yb + wallH * u]); }
    for (let k = 1; k <= 5; k++) { const a = (k / 6) * Math.PI / 2; pts.push([xout - 0.018 - r + r * Math.cos(a), yTop - r + r * Math.sin(a)]); }
    const xs = xout - 0.018 - r;
    const NT = 10;
    for (let k = 1; k <= NT; k++) { const x = xs - (xs - xin) * (k / NT); pts.push([x, top(x, z)]); }
    if (innerBottom !== undefined) {
      const y0 = top(xin, z);
      for (let k = 1; k <= 4; k++) pts.push([xin - 0.012 * Math.sin((k / 4) * Math.PI / 2), y0 - (y0 - innerBottom) * (k / 4)]);
    }
    M = pts.length;
    for (const [x, y] of pts) pos.push(side * x, y, z);
  }
  const idx = [];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < M - 1; i++) {
    const a = j * M + i, b = a + 1, c = (j + 1) * M + i, d = c + 1;
    if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const frontTop = (x, z) => {
  const zf = clamp((-0.76 - z) / 1.4, 0, 1);
  let y = 0.87 - 0.15 * zf * (0.6 + 0.4 * zf);
  y += 0.045 * gauss(x, 0, 0.2) * (1 - 0.45 * zf);              // centre bulge
  y -= 0.014 * gauss(x, 0.34, 0.06);                            // crease beside the bulge
  y += 0.055 * gauss(x, 0.7, 0.15) * (0.35 + 0.65 * gauss(z, -1.38, 0.5)); // fender crown
  y -= 0.03 * smooth01(0.55, 0.9, x);                           // roll-off to the edge
  return y;
};
const rearTop = (x, z) => 0.895 + 0.05 * gauss(z, 1.4, 0.5) * gauss(x, 0.8, 0.22) - 0.03 * smooth01(0.8, 0.9, x) - 0.02 * smooth01(1.75, 2.15, z);

function buildCar(mats) {
  const group = new THREE.Group();      // pose (position / yaw / pitch)
  const body = new THREE.Group();       // sprung body
  group.add(body);
  const { paint, chrome, trim, pillar, tan, cream, dark, glass, rubber, ivory, dashMat, liner } = mats;
  const refs = { group, body, wheels: [], steerPivots: [] };

  // ---- underbody and structure
  add(body, rbox(1.62, 0.22, 4.2, 0.08), dark, 0, 0.27, 0);
  add(body, rbox(1.56, 0.42, 0.72, 0.18), paint, 0, 0.5, -1.95);              // nose
  add(body, rbox(1.82, 0.36, 0.2, 0.09), paint, 0, 0.55, -2.18);               // valance closing the fender ends
  for (const s of [-1, 1]) {
    for (const cfg of [
      { zMin: -2.15, zMax: -0.76, wz: -1.4, xout: 0.915, xin: 0, top: frontTop },
      { zMin: 0.85, zMax: 2.15, wz: 1.4, xout: 0.915, xin: 0.74, top: rearTop, innerBottom: 0.52 },
    ]) {
      const geo = fenderGeo(s, cfg);
      add(body, geo, paint);
      add(body, geo, liner);
    }
    add(body, rbox(0.1, 0.58, 1.65, 0.04), paint, s * 0.85, 0.6, 0.13);           // door flanks
    add(body, rbox(0.07, 0.04, 1.5, 0.015), tan, s * 0.85, 0.905, 0.3);          // door top roll
    add(body, rbox(0.03, 0.04, 1.8, 0.012), trim, s * 0.905, 0.34, 0);           // rocker trim
    add(body, rbox(0.014, 0.016, 2.55, 0.006), trim, s * 0.916, 0.84, 0.78);     // belt-line trim
    add(body, rbox(0.03, 0.36, 1.6, 0.015), tan, s * 0.785, 0.7, 0.3);           // door liner
    for (const z of [-0.5, 0.95]) add(body, rbox(0.008, 0.5, 0.008, 0.002, 1), dark, s * 0.9, 0.62, z);
    add(body, rbox(0.008, 0.008, 1.45, 0.002, 1), dark, s * 0.9, 0.38, 0.22);
    add(body, rbox(0.03, 0.025, 0.14, 0.01), trim, s * 0.912, 0.8, 0.8);
    add(body, rbox(0.012, 0.02, 0.6, 0.006), trim, s * 0.925, 0.7, -1.62);       // fender spear
  }
  add(body, rbox(1.7, 0.3, 1.0, 0.1), paint, 0, 0.74, 1.75);                    // deck
  add(body, rbox(1.8, 0.6, 0.42, 0.15), paint, 0, 0.6, 2.0);                    // tail panel
  add(body, rbox(1.5, 0.05, 2.5, 0.02), dark, 0, 0.33, 0.78);                   // floor
  add(body, rbox(1.3, 0.012, 2.3, 0.005, 1), tan, 0, 0.358, 0.78);              // floor trim
  add(body, rbox(0.22, 0.09, 1.4, 0.04), tan, 0, 0.4, 0.15);                    // tunnel

  // ---- seats
  const seat = (x, z, w = 0.56) => {
    add(body, rbox(w, 0.1, 0.5, 0.04), dark, x, 0.4, z);
    add(body, rbox(w, 0.14, 0.52, 0.06), tan, x, 0.48, z);
    const back = add(body, rbox(w, 0.52, 0.13, 0.06), tan, x, 0.8, z + 0.3);
    back.rotation.x = 0.2;
    for (const dy of [-0.08, 0.04, 0.16]) {
      const p = add(body, rbox(w - 0.06, 0.012, 0.01, 0.004, 1), cream, x, 0.8 + dy, z + 0.234 - dy * 0.2);
      p.rotation.x = 0.2;
    }
  };
  seat(-0.38, 0.4); seat(0.38, 0.4);
  seat(0, 1.4, 1.45);
  const bench = add(body, rbox(1.45, 0.5, 0.13, 0.06), tan, 0, 0.86, 1.74);
  bench.rotation.x = 0.16;

  // ---- dashboard: dark low-gloss cowl, profile extruded across the car
  {
    const prof = [[-0.76, 0.78], [-0.76, 0.87], [-0.62, 0.885], [-0.45, 0.865], [-0.37, 0.825], [-0.345, 0.75], [-0.40, 0.62], [-0.76, 0.62]];
    const sh = new THREE.Shape();
    prof.forEach(([z, y], i) => (i ? sh.lineTo(-z, y) : sh.moveTo(-z, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 4, curveSegments: 1 });
    g.rotateY(Math.PI / 2);
    g.translate(-0.8, 0, 0);
    add(body, g, dashMat);
    add(body, rbox(1.5, 0.012, 0.012, 0.004, 1), trim, 0, 0.805, -0.36);         // chrome lip line
    add(body, rbox(0.3, 0.09, 0.014, 0.01), dark, 0.38, 0.72, -0.37);             // glovebox
    add(body, rbox(0.26, 0.085, 0.014, 0.01), trim, 0.0, 0.72, -0.37);            // radio
    // radio dial: an amber lit scale, and a row of six little level lamps that move with the music
    refs.dialMat = new THREE.MeshStandardMaterial({ color: 0x2a1c0c, emissive: 0xffa040, emissiveIntensity: 0.15, roughness: 0.4 });
    refs.vu = [];
    // they sit in a small pod on top of the dash, in the driver's line of sight
    const pod = new THREE.Group();
    pod.position.set(-0.08, 0.905, -0.56); // just right of the gauges, where the driver can see it
    pod.rotation.x = -0.36; // leaned back to face the driver's eyes
    body.add(pod);
    add(pod, rbox(0.21, 0.058, 0.022, 0.008), dark, 0, 0, -0.012);
    add(pod, new THREE.PlaneGeometry(0.17, 0.016), refs.dialMat, 0, 0.012, 0.0005);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.MeshStandardMaterial({ color: 0x1a1208, emissive: i < 4 ? 0x7dff9a : i < 5 ? 0xffd060 : 0xff5a3c, emissiveIntensity: 0.02, roughness: 0.4 });
      add(pod, new THREE.PlaneGeometry(0.022, 0.012), m, -0.07 + i * 0.028, -0.01, 0.0005);
      refs.vu.push(m);
    }
  }
  // instrument binnacle (tilted toward the driver)
  const cluster = new THREE.Group();
  cluster.position.set(-0.38, 0.915, -0.575);
  cluster.rotation.x = -0.36;
  body.add(cluster);
  const gauge = makeInstrumentTexture();
  const gH = 0.4 * gauge.h / gauge.w;
  add(cluster, rbox(0.44, gH + 0.04, 0.05, 0.016, 3), dashMat, 0, 0, -0.03);
  add(cluster, rbox(0.43, gH + 0.028, 0.012, 0.01, 2), trim, 0, 0, -0.004);
  add(cluster, rbox(0.44, 0.02, 0.06, 0.008), dashMat, 0, gH / 2 + 0.028, 0.0);    // brim
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

  // ---- steering wheel (rim top below the horizon, fully in frame)
  const sw = new THREE.Group();
  sw.position.set(-0.38, 1.02, -0.42);
  sw.rotation.x = -0.5;
  body.add(sw);
  const spinWheel = new THREE.Group();
  sw.add(spinWheel);
  add(spinWheel, new THREE.TorusGeometry(0.165, 0.015, 14, 48), ivory);
  add(spinWheel, new THREE.TorusGeometry(0.13, 0.005, 8, 40), trim);          // horn ring
  const hub = new THREE.CylinderGeometry(0.036, 0.046, 0.05, 20);
  hub.rotateX(Math.PI / 2);
  add(spinWheel, hub, trim, 0, 0, -0.012);
  const cap = new THREE.CylinderGeometry(0.02, 0.02, 0.012, 20);
  cap.rotateX(Math.PI / 2);
  add(spinWheel, cap, mats.red, 0, 0, 0.02);
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const sp = add(spinWheel, rbox(0.14, 0.011, 0.01, 0.004, 2), dark, Math.cos(a) * 0.095, Math.sin(a) * 0.095, 0);
    sp.rotation.z = a;
  }
  refs.steerWheel = spinWheel;
  rod(body, dark, V(-0.38, 1.02, -0.44), V(-0.38, 0.72, -0.62), 0.02, 12);

  // ---- windshield: a low roadster screen. Its top edge sits below the driver's eye line (eye at
  // 1.36 m), so the view ahead is open sky and road, with no frame across it; same rake as before.
  const SH = 1.22; // top edge height
  const base = (x) => V(x, 0.92, -0.74), top = (x) => V(x, SH, -0.74 + (SH - 0.92) * 0.457);
  for (const s of [-1, 1]) {
    rod(body, trim, base(s * 0.81), top(s * 0.8), 0.0055, 8); // slim, bright posts
    add(body, rbox(0.06, 0.03, 0.07, 0.012), trim, s * 0.81, 0.925, -0.74);
  }
  for (const s of [-1, 1]) add(body, rbox(0.44, 0.46, 0.04, 0.012), paint, s * 0.7, 0.65, -0.745);   // cowl side closing the fender ends
  const gLen = (SH - 0.92) / Math.cos(0.43); // along the rake
  const glassMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, gLen), glass);
  glassMesh.position.set(0, (0.92 + SH) / 2, -0.74 + ((SH - 0.92) * 0.457) / 2);
  glassMesh.rotation.x = -0.43;
  glassMesh.renderOrder = 5;
  body.add(glassMesh);

  // ---- mirrors
  for (const s of [-1, 1]) {
    rod(body, trim, V(s * 0.84, 0.94, -0.7), V(s * 0.93, 1.0, -0.64), 0.008, 8);
    const head = ellipsoid(body, trim, 0.016, 0.036, 0.05, s * 0.945, 1.01, -0.62);
    head.rotation.y = -s * 0.25;
    const mf = add(body, new THREE.CircleGeometry(0.032, 20), mats.mirror, s * 0.945 - s * 0.0185, 1.01, -0.62);
    mf.scale.set(1, 1.1, 1);
    mf.rotation.y = -s * Math.PI / 2 + s * 0.3;
    mf.castShadow = false;
  }

  // ---- front end
  const grille = add(body, rbox(0.62, 0.3, 0.06, 0.025), chrome, 0, 0.5, -2.3);
  grille.castShadow = true;
  add(body, rbox(0.54, 0.22, 0.02, 0.01), dark, 0, 0.5, -2.335);
  for (let i = -4; i <= 4; i++) add(body, rbox(0.012, 0.22, 0.014, 0.004, 1), chrome, i * 0.06, 0.5, -2.342);
  const bump = (z, y) => {
    const g = new THREE.CapsuleGeometry(0.045, 1.55, 6, 14);
    g.rotateZ(Math.PI / 2);
    add(body, g, chrome, 0, y, z);
    for (const s of [-1, 1]) add(body, new THREE.CapsuleGeometry(0.03, 0.14, 4, 8), chrome, s * 0.45, y + 0.02, z + (z < 0 ? -0.04 : 0.04));
  };
  bump(-2.4, 0.36); bump(2.3, 0.38);

  const headMat = mats.headLens, tailMat = mats.tailLens;
  refs.headMat = headMat; refs.tailMat = tailMat;
  refs.spots = [];
  for (const s of [-1, 1]) {
    ellipsoid(body, chrome, 0.125, 0.125, 0.1, s * 0.64, 0.68, -2.22);
    ellipsoid(body, headMat, 0.095, 0.095, 0.06, s * 0.64, 0.68, -2.3);
    ellipsoid(body, chrome, 0.09, 0.065, 0.04, s * 0.68, 0.8, 2.2);
    ellipsoid(body, tailMat, 0.07, 0.048, 0.03, s * 0.68, 0.8, 2.225);
    const spot = new THREE.SpotLight(0xfff0d6, 0, 120, 0.46, 0.6, 2);
    spot.position.set(s * 0.64, 0.68, -2.32);
    spot.castShadow = false;
    const tgt = new THREE.Object3D();
    tgt.position.set(s * 0.5, -0.4, -30);
    body.add(tgt);
    spot.target = tgt;
    body.add(spot);
    refs.spots.push(spot);
  }
  add(body, rbox(0.34, 0.11, 0.012, 0.01), cream, 0, 0.5, 2.215);                // plate
  add(body, rbox(0.2, 0.03, 0.02, 0.01), trim, 0, 0.64, 2.215);

  // ---- wheels (not part of the sprung body)
  const wheelPos = [[-0.8, -1.4], [0.8, -1.4], [-0.8, 1.4], [0.8, 1.4]];
  wheelPos.forEach(([x, z], i) => {
    const steer = new THREE.Group();
    steer.position.set(x, 0.34, z);
    const spin = buildWheel(x < 0 ? -1 : 1, mats);
    steer.add(spin);
    group.add(steer);
    refs.wheels.push(spin);
    if (i < 2) refs.steerPivots.push(steer);
  });
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return refs;
}

/* ------------------------------------------------------------------ */
/* HORSE                                                               */
/* ------------------------------------------------------------------ */
// Hermite-interpolated keyframes: kf([[t, v], ...]) -> f(t)
function kf(keys) {
  return (t) => {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    const [tp, vp] = keys[Math.max(0, i - 1)], [tn, vn] = keys[Math.min(keys.length - 1, i + 2)];
    const h = t1 - t0, s = clamp((t - t0) / h, 0, 1);
    const m0 = (v1 - vp) / (t1 - tp) * h, m1 = (vn - v0) / (tn - t0) * h;
    const s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * m1;
  };
}
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Elliptical tube swept along P(t) (path lies in the YZ plane), radii rxF (side) / ryF (in-plane normal). Smooth shared normals.
function sweepGeo(P, rxF, ryF, nt, nr, cap0 = true, cap1 = true) {
  const pos = [];
  const X = V(1, 0, 0);
  const ring = [];
  for (let i = 0; i <= nt; i++) {
    const t = i / nt;
    const p = P(t);
    const T = P(Math.min(1, t + 0.01)).sub(P(Math.max(0, t - 0.01))).normalize();
    const N = V(0, -T.z, T.y).normalize();
    const rx = rxF(t), ry = ryF(t);
    for (let j = 0; j < nr; j++) {
      const a = (j / nr) * TAU;
      const c = Math.cos(a) * rx, s = Math.sin(a) * ry;
      pos.push(p.x + c, p.y + N.y * s, p.z + N.z * s);
    }
    ring.push(p);
  }
  const c0 = pos.length / 3; pos.push(ring[0].x, ring[0].y, ring[0].z);
  const c1 = c0 + 1; pos.push(ring[nt].x, ring[nt].y, ring[nt].z);
  const idx = [];
  for (let i = 0; i < nt; i++) for (let j = 0; j < nr; j++) {
    const a = i * nr + j, b = i * nr + (j + 1) % nr, c = (i + 1) * nr + j, d = (i + 1) * nr + (j + 1) % nr;
    idx.push(a, c, b, b, c, d);
  }
  if (cap0) for (let j = 0; j < nr; j++) idx.push(c0, j, (j + 1) % nr);
  if (cap1) for (let j = 0; j < nr; j++) idx.push(c1, nt * nr + (j + 1) % nr, nt * nr + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // make winding outward: test a middle ring vertex against its ring centre
  g.computeVertexNormals();
  const m = Math.floor(nt / 2) * nr, n = g.attributes.normal, pp = g.attributes.position;
  const ctr = ring[Math.floor(nt / 2)];
  const dot = (pp.getX(m) - ctr.x) * n.getX(m) + (pp.getY(m) - ctr.y) * n.getY(m) + (pp.getZ(m) - ctr.z) * n.getZ(m);
  if (dot < 0) {
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}
// A thin hair strip: hangs along -Y, bends from heading th0 to th1 (0 = straight down, +ve toward +X), width along Z, tapering to a point.
function hairCard(len, w, th0, th1, segs = 5) {
  const pos = [];
  let x = 0, y = 0;
  for (let k = 0; k <= segs; k++) {
    const f = k / segs;
    const wk = w * (1 - 0.85 * Math.pow(f, 1.6)) * 0.5;
    pos.push(x, y, -wk, x, y, wk);
    const th = lerp(th0, th1, f);
    x += Math.sin(th) * len / segs; y -= Math.cos(th) * len / segs;
  }
  const idx = [];
  for (let k = 0; k < segs; k++) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const _hm = new THREE.Matrix4(), _hq = new THREE.Quaternion(), _he = new THREE.Euler(), _hv = new THREE.Vector3(), _hs = new THREE.Vector3(1, 1, 1);
function placed(g, px, py, pz, rx, ry, rz) {
  _hm.compose(_hv.set(px, py, pz), _hq.setFromEuler(_he.set(rx, ry, rz, 'YXZ')), _hs);
  return g.applyMatrix4(_hm);
}

/* ---- lofting: smooth surfaces from cross-section stations ---- */
function hermite(a, b, ma, mb, s) {
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * a + (s3 - 2 * s2 + s) * ma + (-2 * s3 + 3 * s2) * b + (s3 - s2) * mb;
}
const HK = ['x', 'y', 'z', 'rx', 'top', 'bot'];
const LIN = ['k', 'tp', 'bp', 'cr', 'cg', 'cb'];
// Station: centre (x, y, z), half-width rx, half-depth top / bot measured along the in-plane normal N,
// superellipse exponent k, upper/lower half pinch (tp/bp) and a colour multiplier c.
function S(y, z, rx, top, bot, ex = {}) {
  const c = ex.c === undefined ? [1, 1, 1] : (typeof ex.c === 'number' ? [ex.c, ex.c, ex.c] : ex.c);
  return { x: ex.x || 0, y, z, rx, top, bot, k: ex.k || 2, tp: ex.tp ?? 1, bp: ex.bp ?? 1, cr: c[0], cg: c[1], cb: c[2] };
}
function densify(st, sub) {
  const n = st.length, out = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sub; j++) {
      const s = j / sub, o = {};
      for (const key of HK) {
        const v0 = st[i][key], v1 = st[i + 1][key];
        const vp = i > 0 ? st[i - 1][key] : v0 - (v1 - v0), vn = i + 2 < n ? st[i + 2][key] : v1 + (v1 - v0);
        const m0 = i > 0 ? (v1 - vp) * 0.5 : v1 - v0, m1 = i + 2 < n ? (vn - v0) * 0.5 : v1 - v0;
        o[key] = hermite(v0, v1, m0, m1, s);
      }
      for (const key of LIN) o[key] = lerp(st[i][key], st[i + 1][key], s);
      o.rx = Math.max(0.0004, o.rx); o.top = Math.max(0.0004, o.top); o.bot = Math.max(0.0004, o.bot);
      out.push(o);
    }
  }
  out.push({ ...st[n - 1] });
  return out;
}
function ringXY(s, a, sc) {
  const c = Math.cos(a), sn = Math.sin(a), e = 2 / s.k;
  const x = s.rx * Math.sign(c) * Math.pow(Math.abs(c), e);
  const up = sn >= 0;
  const v = (up ? s.top : s.bot) * Math.sign(sn) * Math.pow(Math.abs(sn), e);
  const pinch = 1 - (1 - (up ? s.tp : s.bp)) * Math.abs(sn);
  return [x * pinch * sc, v * sc];
}
function loft(stIn, nr = 20, o = {}) {
  const flip = o.flip !== false, sub = o.sub ?? 3;
  const D = densify(stIn, sub), n = D.length;
  const fr = [];
  for (let i = 0; i < n; i++) {
    const a = D[Math.max(0, i - 1)], b = D[Math.min(n - 1, i + 1)];
    const T = V(0, b.y - a.y, b.z - a.z).normalize();
    const N = flip ? V(0, -T.z, T.y) : V(0, T.z, -T.y);
    fr.push({ T, N, p: V(D[i].x, D[i].y, D[i].z) });
  }
  const pt = (i, a, sc = 1) => {
    const [dx, dn] = ringXY(D[i], a, sc);
    return fr[i].p.clone().add(V(dx, 0, 0)).addScaledVector(fr[i].N, dn);
  };
  const pos = [], col = [], idx = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < nr; j++) {
      const a = (j / nr) * TAU;
      const p = pt(i, a);
      if (o.deform) p.x += Math.sign(p.x) * o.deform(p.x, p.y, p.z);
      pos.push(p.x, p.y, p.z);
      let m = typeof o.shade === 'function' ? o.shade(p.x, p.y, p.z, i / (n - 1), a) : (o.shade ?? 1);
      if (typeof m === 'number') m = [m, m, m];
      col.push(D[i].cr * m[0], D[i].cg * m[1], D[i].cb * m[2]);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < nr; j++) {
    const a = i * nr + j, b = i * nr + (j + 1) % nr, c = (i + 1) * nr + j, d = (i + 1) * nr + (j + 1) % nr;
    idx.push(a, c, b, b, c, d);
  }
  const cap = (i, hard) => {
    const base = pos.length / 3, p = fr[i].p;
    const ring = [];
    for (let j = 0; j < nr; j++) {
      if (hard) { const q = pt(i, (j / nr) * TAU); pos.push(q.x, q.y, q.z); col.push(D[i].cr, D[i].cg, D[i].cb); ring.push(base + j); }
      else ring.push(i * nr + j);
    }
    const cI = pos.length / 3; pos.push(p.x, p.y, p.z); col.push(D[i].cr, D[i].cg, D[i].cb);
    return [ring, cI, i === 0];
  };
  const caps = [];
  if (o.cap0 !== false) caps.push(cap(0, o.hard0));
  if (o.cap1 !== false) caps.push(cap(n - 1, o.hard1));
  const g = new THREE.BufferGeometry();
  const build = (flipW) => {
    const id = idx.slice();
    for (const [ring, cI, first] of caps) for (let j = 0; j < nr; j++) {
      const a = ring[j], b = ring[(j + 1) % nr];
      if (first) id.push(cI, a, b); else id.push(cI, b, a);
    }
    if (flipW) for (let k = 0; k < id.length; k += 3) { const t = id[k + 1]; id[k + 1] = id[k + 2]; id[k + 2] = t; }
    g.setIndex(id);
  };
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  build(false);
  g.computeVertexNormals();
  {
    const m = Math.floor(n / 2) * nr, nn = g.attributes.normal, pp = g.attributes.position, c0 = fr[Math.floor(n / 2)].p;
    const dot = (pp.getX(m) - c0.x) * nn.getX(m) + (pp.getY(m) - c0.y) * nn.getY(m) + (pp.getZ(m) - c0.z) * nn.getZ(m);
    if (dot < 0) { build(true); g.computeVertexNormals(); }
  }
  const at = (tf) => { const f = clamp(tf, 0, 1) * (n - 1), i = Math.min(n - 2, Math.floor(f)); return [i, f - i]; };
  return {
    geo: g,
    surf(tf, a, sc = 1) { const [i, u] = at(tf); return pt(i, a, sc).lerp(pt(i + 1, a, sc), u); },
    frame(tf) {
      const [i, u] = at(tf), A = fr[i], B = fr[i + 1];
      return { p: A.p.clone().lerp(B.p, u), T: A.T.clone().lerp(B.T, u).normalize(), N: A.N.clone().lerp(B.N, u).normalize(),
        rx: lerp(D[i].rx, D[i + 1].rx, u), top: lerp(D[i].top, D[i + 1].top, u), bot: lerp(D[i].bot, D[i + 1].bot, u) };
    },
    atZ(z) { for (let i = 0; i < n - 1; i++) { const a = D[i].z, b = D[i + 1].z; if ((z - a) * (z - b) <= 0 && a !== b) return (i + (z - a) / (b - a)) / (n - 1); } return 1; },
  };
}
// torso-style station: absolute top / bottom heights
const TS = (z, yTop, yBot, hw, ex) => S((yTop + yBot) / 2, z, hw, (yTop - yBot) / 2, (yTop - yBot) / 2, ex);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---- hair: ribbons accumulated into one geometry (kept in small local groups) ---- */
class HairBuilder {
  constructor() { this.pos = []; this.col = []; this.idx = []; }
  // pts: array of [x,y,z]; w: base width; wd: [x,y,z] width direction; tone: brightness multiplier
  strand(pts, w, wd, tone = 1) {
    const n = pts.length, b = this.pos.length / 3;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1), wk = w * (1 - 0.92 * Math.pow(f, 1.5)) * 0.5, p = pts[k];
      this.pos.push(p[0] - wd[0] * wk, p[1] - wd[1] * wk, p[2] - wd[2] * wk, p[0] + wd[0] * wk, p[1] + wd[1] * wk, p[2] + wd[2] * wk);
      const t = tone * (0.9 + 0.1 * f);
      this.col.push(t, t, t, t, t, t);
    }
    for (let k = 0; k < n - 1; k++) { const a = b + k * 2; this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

const HOOF_H = 0.0785;
// one leg: hip group (swing pivot) -> [stifle] -> knee/hock -> fet (fetlock) -> hoof
function buildLeg(front, mats, rand) {
  const { coatV, hoofV, mane } = mats;
  const hip = new THREE.Group();
  const G = (parent, y, z = 0) => { const g = new THREE.Group(); g.position.set(0, y, z); parent.add(g); return g; };
  let stifle = null, parent = hip, cy, cz;
  const pa = front ? [0.107, 0.09] : [0.115, 0.08];     // pastern drop / forward run
  if (front) {
    // forearm: muscular at the top, tapering to the carpus
    add(hip, loft([
      S(0.14, 0.0, 0.096, 0.115, 0.115), S(0.0, 0.0, 0.104, 0.112, 0.115), S(-0.12, 0.005, 0.096, 0.095, 0.1),
      S(-0.26, 0.0, 0.076, 0.072, 0.077), S(-0.40, 0.0, 0.058, 0.055, 0.058, { c: 0.97 }), S(-0.51, 0.0, 0.051, 0.047, 0.048, { c: 0.93 }),
      S(-0.565, 0.0, 0.054, 0.047, 0.047, { c: 0.88 }),
    ], 18).geo, coatV);
  } else {
    // thigh (hip -> stifle, forward and down)
    add(hip, loft([
      S(0.14, 0.07, 0.09, 0.09, 0.11), S(0.02, 0.0, 0.125, 0.115, 0.165), S(-0.12, -0.07, 0.13, 0.115, 0.165),
      S(-0.22, -0.14, 0.115, 0.105, 0.145), S(-0.30, -0.20, 0.095, 0.09, 0.09),
    ], 20).geo, coatV);
    stifle = G(hip, -0.30, -0.20);
    parent = stifle;
    // gaskin: big muscle behind, tapering to the hock
    add(stifle, loft([
      S(0.06, -0.045, 0.098, 0.085, 0.095), S(-0.04, 0.035, 0.108, 0.08, 0.125), S(-0.15, 0.125, 0.092, 0.07, 0.112),
      S(-0.265, 0.21, 0.064, 0.056, 0.074, { c: 0.97 }), S(-0.355, 0.28, 0.05, 0.048, 0.052, { c: 0.9 }), S(-0.405, 0.33, 0.048, 0.046, 0.046, { c: 0.85 }),
    ], 16).geo, coatV);
  }
  const knee = G(parent, front ? -0.58 : -0.40, front ? 0 : 0.33);
  if (front) {
    add(knee, loft([
      S(0.045, 0, 0.03, 0.028, 0.028, { c: 0.8 }), S(0.02, 0, 0.056, 0.046, 0.046, { k: 2.5, c: 0.78 }), S(-0.03, 0.002, 0.06, 0.048, 0.05, { k: 2.6, c: 0.76 }),
      S(-0.08, 0, 0.047, 0.04, 0.044, { c: 0.82 }), S(-0.16, 0, 0.039, 0.038, 0.042, { c: 0.86 }), S(-0.26, 0, 0.04, 0.038, 0.048, { c: 0.88 }),
      S(-0.30, 0.003, 0.046, 0.044, 0.056, { c: 0.85 }), S(-0.335, 0.005, 0.028, 0.028, 0.04),
    ], 14).geo, coatV);
  } else {
    // hock: the point of the hock stands up and back
    add(knee, loft([
      S(0.095, 0.082, 0.024, 0.026, 0.026, { c: 0.74 }), S(0.05, 0.062, 0.04, 0.034, 0.036, { c: 0.74 }), S(0.0, 0.0, 0.052, 0.054, 0.05, { k: 2.5, c: 0.74 }),
      S(-0.06, 0.0, 0.045, 0.042, 0.046, { c: 0.8 }), S(-0.16, 0, 0.039, 0.038, 0.042, { c: 0.86 }), S(-0.26, 0, 0.04, 0.037, 0.047, { c: 0.88 }),
      S(-0.30, 0.003, 0.046, 0.043, 0.056, { c: 0.85 }), S(-0.335, 0.005, 0.028, 0.028, 0.04),
    ], 14).geo, coatV);
  }
  const fet = G(knee, -0.31);
  add(fet, loft([
    S(0.035, 0.03 * pa[1] / pa[0] * 0.36, 0.04, 0.04, 0.042, { c: 0.85 }), S(0.0, 0.0, 0.043, 0.039, 0.044, { c: 0.85 }),
    S(-pa[0] * 0.5, -pa[1] * 0.5, 0.036, 0.034, 0.036, { c: 0.8 }), S(-pa[0], -pa[1], 0.04, 0.036, 0.04, { c: 0.78 }),
    S(-pa[0] - 0.012, -pa[1] - 0.012 * pa[1] / pa[0], 0.044, 0.038, 0.04, { c: 0.78 }),
  ], 12, { sub: 2 }).geo, coatV);
  // feather behind the fetlock
  {
    const hb = new HairBuilder();
    for (let k = 0; k < 9; k++) {
      const x0 = (rand() - 0.5) * 0.05, len = 0.07 + 0.04 * rand();
      const pts = [];
      for (let q = 0; q <= 4; q++) { const f = q / 4; pts.push([x0 * (1 + 0.6 * f), 0.015 - len * f, 0.04 + 0.03 * f * (1 - 0.3 * f) + 0.015 * Math.sin(f * 3 + k)]); }
      hb.strand(pts, 0.018, [1, 0, 0], 0.85 + 0.15 * rand());
    }
    add(fet, hb.geo(), mane);
  }
  const hoof = G(fet, -pa[0], -pa[1]);
  const hs = front ? 1 : 0.9;
  add(hoof, loft([
    S(0.008, 0.0, 0.05 * hs, 0.05, 0.048, { c: [2.7, 2.6, 2.5] }), S(-0.012, -0.004, 0.056 * hs, 0.056, 0.05, { c: [2.2, 2.1, 2.0] }),
    S(-0.04, -0.013, 0.062 * hs, 0.068, 0.054, { c: 1.0 }), S(-0.075, -0.026, 0.068 * hs, 0.08, 0.058, { c: 0.9 }),
    S(-0.0775, -0.026, 0.068 * hs, 0.08, 0.058, { c: 0.8 }), S(-HOOF_H, -0.026, 0.068 * hs, 0.08, 0.058, { c: 0.8 }),
  ], 16, { sub: 2, hard1: true }).geo, hoofV);
  if (front) { cy = -(0.58 + 0.31 + pa[0]); cz = -pa[1]; }
  else { cy = -(0.30 + 0.40 + 0.31 + pa[0]); cz = -0.20 + 0.33 - pa[1]; }
  return { hip, stifle, knee, fet, hoof, front, cy, cz, hipY0: HOOF_H - cy };
}

function buildHorse(mats) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const { coat, coatDark, mane, hoof, leather, chrome, eye } = mats;
  const coatV = mats.coatV;
  const H = { root, body, legs: [], ears: [], mane: [], reinSegs: [], stirrups: [] };
  const rand = rng(7);
  const cz = (z) => (z < -0.3 ? z : -0.3 + (z + 0.3) * 0.9);   // barrel shortened ~10% so the body is closer to square
  const dapple = (x, y, z) => {
    const p = 0.5 + 0.5 * Math.sin(x * 41 + 2.0 * Math.sin(z * 9 + y * 5)) * Math.sin(y * 34 + z * 26) * Math.sin(z * 37 - y * 15 + x * 8);
    const broad = 0.5 + 0.5 * Math.sin(z * 4.1 + y * 3.3 + Math.sin(x * 6));
    return 1 - 0.07 * smooth(0.25, 0.75, p) - 0.035 * broad;   // soft grey dapples + broad tonal drift
  };
  const L = (parent, l, mat = coatV, x = 0, y = 0, z = 0) => add(parent, l.geo, mat, x, y, z);

  // ---- torso: lofted barrel (chest -> croup) + shoulder and haunch muscle masses
  {
    const torso = loft([
      TS(cz(-0.92), 1.26, 1.14, 0.03), TS(cz(-0.86), 1.35, 1.02, 0.12, { k: 2.2 }), TS(cz(-0.77), 1.45, 0.93, 0.19), TS(cz(-0.62), 1.55, 0.84, 0.235, { tp: 0.66 }),
      TS(cz(-0.46), 1.59, 0.80, 0.25, { tp: 0.56 }), TS(cz(-0.26), 1.55, 0.775, 0.255, { tp: 0.62 }), TS(cz(-0.03), 1.50, 0.77, 0.258, { tp: 0.74 }),
      TS(cz(0.20), 1.50, 0.83, 0.257, { tp: 0.8 }), TS(cz(0.40), 1.535, 0.93, 0.255, { tp: 0.85 }), TS(cz(0.58), 1.575, 0.99, 0.262, { tp: 0.88 }),
      TS(cz(0.74), 1.56, 1.03, 0.255, { tp: 0.88 }), TS(cz(0.87), 1.49, 1.08, 0.21), TS(cz(0.95), 1.40, 1.14, 0.13), TS(cz(1.0), 1.31, 1.2, 0.04),
    ], 36, { flip: false, sub: 4, deform: (x, y, z) => {
      const g = (cy, cz, sy, sz, am) => am * Math.exp(-(((y - cy) / sy) ** 2 + ((z - cz) / sz) ** 2));
      return g(1.24, -0.6, 0.2, 0.17, 0.035) + g(1.28, cz(0.64), 0.22, 0.2, 0.04) + g(1.42, 0.5, 0.12, 0.14, 0.01);
    }, shade: (x, y, z, tf, a) => { const d = dapple(x, y, z); return d * (0.84 + 0.16 * smooth(-0.9, 0.2, Math.sin(a))); } });
    L(body, torso);
  }

  // ---- legs
  const legDefs = [[-1, -0.52, true], [1, -0.52, true], [-1, cz(0.60), false], [1, cz(0.60), false]];
  for (const [s, z, front] of legDefs) {
    const leg = buildLeg(front, mats, rand);
    leg.hip.position.set(s * (front ? 0.15 : 0.17), leg.hipY0, z);
    body.add(leg.hip);
    H.legs.push(leg);
  }

  // ---- neck (pivot at withers): deep at the shoulder, tapering to the throat, with a crest
  const neck = new THREE.Group();
  neck.position.set(0, 1.45, -0.62);
  body.add(neck);
  H.neck = neck;
  const nd = V(0, 0.44, -0.72);
  const neckL = loft([
    S(-0.12, 0.14, 0.17, 0.22, 0.24, { tp: 0.8 }), S(0.04, -0.06, 0.165, 0.2, 0.23, { tp: 0.8 }), S(0.17, -0.22, 0.145, 0.185, 0.21, { tp: 0.76 }),
    S(0.28, -0.40, 0.115, 0.158, 0.172, { tp: 0.8 }), S(0.37, -0.56, 0.095, 0.132, 0.145, { tp: 0.85 }), S(0.44, -0.72, 0.082, 0.108, 0.125),
    S(0.46, -0.81, 0.07, 0.09, 0.1),
  ], 26, { sub: 3, shade: dapple });
  L(neck, neckL);

  // mane: fine overlapping strands falling to both sides of the crest
  {
    const NCH = 15;
    for (let c = 0; c < NCH; c++) {
      const tf = 0.02 + (c / (NCH - 1)) * 0.93;
      const fr = neckL.frame(tf);
      const crestP = neckL.surf(tf, Math.PI / 2, 0.99);
      const outer = new THREE.Group();
      outer.position.copy(crestP);
      outer.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(1, 0, 0), fr.N, fr.T.clone().negate()));
      neck.add(outer);
      const hb = new HairBuilder();
      const rEx = fr.rx * 0.9 + 0.012, rEy = fr.top;
      for (let k = 0; k < 96; k++) {
        const up = k >= 66, sd = up ? (k % 2 ? 1 : -1) : 1;   // the body of the mane falls to one side, a crest tuft stands up
        const L0 = (0.30 + 0.17 * rand()) * (1.12 - 0.3 * tf);
        const rxk = rEx * (1.04 + 0.1 * rand()), z0 = (rand() - 0.5) * 0.16, ph = rand() * 6;
        const pts = [];
        const SEG = 6, R = 0.55 * (rxk + rEy);
        for (let q = 0; q <= SEG; q++) {
          const f = q / SEG, d = f * L0;
          const a = Math.min(d / R, Math.PI * (up ? 0.38 : 0.5)), extra = Math.max(0, d - a * R);
          let x = sd * (rxk * Math.sin(a) + extra * 0.1 * f + 0.012 * f), y = -rEy * 1.04 * (1 - Math.cos(a)) - extra * 0.98;
          if (up) { y += 0.035 * Math.sin(Math.PI * Math.min(1, f * 1.4)); x *= 0.6; }
          x += sd * 0.022 * Math.sin(f * 5 + ph) * f;
          pts.push([x + (rand() - 0.5) * 0.002, y, z0 + 0.03 * Math.sin(f * 4.5 + ph * 1.7) * f]);
        }
        const wa = (rand() - 0.5) * 1.6;
        hb.strand(pts, 0.022 + 0.016 * rand(), [Math.sin(wa) * sd, 0, Math.cos(wa)], 0.72 + 0.3 * rand());
      }
      const piece = new THREE.Group();
      outer.add(piece);
      add(piece, hb.geo(), mane);
      piece.userData = { ph: c * 0.8 };
      H.mane.push(piece);
    }
  }

  // ---- head: carried ahead of and below the rider's eye
  const headGroup = new THREE.Group();
  headGroup.position.copy(nd);
  neck.add(headGroup);
  H.head = headGroup;
  const headInner = new THREE.Group();
  headInner.rotation.x = -0.82;
  headInner.scale.setScalar(1.14);
  headGroup.add(headInner);
  const EYE = [0.2, 0.3];                  // eye position: distance along the head, ring angle
  const headShade = (x, y, z) => {
    const mz = smooth(-0.44, -0.62, z), m = lerp(1, 0.5, mz);
    const ex = Math.abs(x) - 0.092, ey = y - 0.02, ez = z + EYE[0];
    const ed = Math.sqrt(ex * ex * 2 + ey * ey + ez * ez);
    const e = 1 - 0.5 * (1 - smooth(0.03, 0.062, ed));
    const jaw = 1 - 0.2 * smooth(-0.09, -0.19, y) * smooth(0.0, -0.1, z) * (1 - smooth(-0.3, -0.45, z));
    const v = m * e * jaw;
    return [v, v * 0.97, v * 0.98];
  };
  const headL = loft([
    TS(0.03, 0.085, -0.095, 0.05), TS(0.0, 0.1, -0.11, 0.075, { tp: 0.85, bp: 0.7, k: 2.4 }),
    ...[
      // d, yTop, yBottom, halfWidth, upper pinch, lower pinch, squareness
      [0.08, 0.108, -0.17, 0.104, 0.86, 0.6, 2.7], [0.16, 0.094, -0.2, 0.112, 0.84, 0.56, 2.9], [0.25, 0.074, -0.175, 0.094, 0.8, 0.58, 2.9],
      [0.35, 0.052, -0.135, 0.064, 0.72, 0.7, 3.0], [0.45, 0.032, -0.122, 0.057, 0.72, 0.78, 3.0], [0.53, 0.016, -0.115, 0.061, 0.8, 0.85, 2.8],
      [0.585, 0.006, -0.113, 0.072, 0.88, 0.9, 2.5], [0.625, 0.0, -0.108, 0.074, 0.9, 0.9, 2.4], [0.652, -0.012, -0.097, 0.06, 0.95, 0.95, 2.2],
      [0.667, -0.03, -0.082, 0.034, 1.0, 1.0, 2.0], [0.672, -0.042, -0.07, 0.012, 1.0, 1.0, 2.0],
    ].map(([d, yT, yB, hw, tp, bp, k]) => TS(-d, yT, yB, hw, { tp, bp, k })),
  ], 34, { flip: true, sub: 5, shade: headShade });
  // sculpting: cheek plate, jaw channel, throatlatch hollow, brow / temple, muzzle, lips, chin (x and y only, mirrored)
  const ge = (v, c, w) => Math.exp(-Math.pow(Math.abs(v - c) / w, 2.5));
  const dispXY = (x, y, z) => {
    const d = -z, ax = Math.abs(x);
    let dx = 0, dy = 0;
    dx += 0.034 * ge(y, -0.1, 0.075) * ge(d, 0.15, 0.085);                                 // masseter plate
    dx -= 0.02 * ge(y, -0.09, 0.07) * ge(d, 0.015, 0.035);                                 // throatlatch hollow
    dy += 0.03 * Math.exp(-Math.pow(ax / 0.045, 2)) * ge(d, 0.15, 0.1) * smooth(-0.12, -0.17, y);   // jaw channel
    dx += 0.007 * ge(y, 0.06, 0.025) * ge(d, 0.19, 0.045);                                 // brow ridge
    dx -= 0.007 * ge(y, 0.095, 0.03) * ge(d, 0.17, 0.05);                                  // temple hollow
    dx += 0.008 * ge(y, -0.02, 0.03) * ge(d, 0.6, 0.04);                                   // nostril flare
    dx -= 0.006 * ge(y, -0.1, 0.03) * ge(d, 0.585, 0.05);                                  // cheek-to-muzzle dip
    dx += 0.008 * ge(y, -0.04, 0.025) * ge(d, 0.36, 0.1);                                  // facial crest
    dy += 0.012 * Math.exp(-Math.pow(ax / 0.03, 2)) * ge(d, 0.6, 0.025) * smooth(-0.09, -0.11, y);   // chin groove
    dx += 0.006 * ge(y, -0.085, 0.02) * ge(d, 0.645, 0.025);                               // lower lip
    return [Math.sign(x || 1) * dx, dy];
  };
  {
    const P = headL.geo.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const [dx, dy] = dispXY(P.getX(i), P.getY(i), P.getZ(i));
      P.setX(i, P.getX(i) + dx); P.setY(i, P.getY(i) + dy);
    }
    headL.geo.computeVertexNormals();
  }
  L(headInner, headL);
  const hp = (d, a, sc = 1.0) => {
    const p = headL.surf(headL.atZ(-d), a, sc), [dx, dy] = dispXY(p.x, p.y, p.z);
    p.x += dx; p.y += dy; return p;
  };
  for (const s of [-1, 1]) {
    const a = s > 0 ? EYE[1] : Math.PI - EYE[1];
    const ep = hp(EYE[0], a, 1.0);
    // lid / brow and the eye itself, set on the side of the head
    const lid = ellipsoid(headInner, coatDark, 0.008, 0.03, 0.032, ep.x, ep.y, ep.z, 14, 10);
    lid.rotation.z = -s * 0.2;
    const ball = ellipsoid(headInner, eye, 0.013, 0.021, 0.023, ep.x + s * 0.004, ep.y, ep.z, 14, 12);
    ball.rotation.z = -s * 0.2;
    const bp = hp(EYE[0] + 0.005, s > 0 ? EYE[1] + 0.55 : Math.PI - EYE[1] - 0.55, 1.01);
    ellipsoid(headInner, coat, 0.012, 0.012, 0.04, bp.x, bp.y, bp.z, 10, 8).rotation.x = 0.0;
    // nostril
    const np = hp(0.626, s > 0 ? 0.62 : Math.PI - 0.62, 1.0);
    const nos = ellipsoid(headInner, mats.nostril, 0.008, 0.026, 0.017, np.x - s * 0.002, np.y + 0.002, np.z + 0.002, 10, 8);
    nos.rotation.z = s * 0.7; nos.rotation.x = 0.3;
    // mouth line
    const mp = [];
    for (const [d, a] of [[0.645, -1.05], [0.61, -0.8], [0.56, -0.62], [0.51, -0.5], [0.47, -0.45]]) mp.push(hp(d, s > 0 ? a : Math.PI - a, 1.012));
    add(headInner, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mp), 12, 0.0035, 5, false), mats.nostril);
  }
  // bridle
  const bitPos = (s) => hp(0.55, s > 0 ? -0.32 : Math.PI + 0.32, 1.1);
  for (const s of [-1, 1]) {
    const pts = [];
    for (const [d, a] of [[0.0, 0.9], [0.09, 0.25], [0.2, -0.1], [0.32, -0.3], [0.44, -0.33]]) pts.push(hp(d, s > 0 ? a : Math.PI - a, 1.045));
    pts.push(bitPos(s));
    add(headInner, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.0045, 5, false), leather);
    const ring = add(headInner, new THREE.TorusGeometry(0.014, 0.003, 6, 14), chrome, bitPos(s).x, bitPos(s).y, bitPos(s).z);
    ring.rotation.y = Math.PI / 2;
  }
  const loop = (d, a0, a1, sc, r, closed = false) => {
    const pts = [];
    for (let i = 0; i <= 14; i++) pts.push(hp(d, lerp(a0, a1, i / 14), sc));
    add(headInner, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), 20, r, 5, closed), leather);
  };
  loop(0.075, 0.1, Math.PI - 0.1, 1.045, 0.0045);                 // browband
  loop(-0.005, 0.7, Math.PI - 0.7, 1.05, 0.0045);                  // crownpiece behind the ears
  loop(0.33, 0, TAU, 1.04, 0.0045, true);                          // noseband
  const bitL = new THREE.Object3D(), bitR = new THREE.Object3D();
  bitL.position.copy(bitPos(-1)); bitR.position.copy(bitPos(1));
  headInner.add(bitL, bitR);
  H.bitL = bitL; H.bitR = bitR;
  // ears: alert, pointed, dark inside
  {
    const earOuter = loft([
      S(0.0, 0.0, 0.034, 0.02, 0.016), S(0.06, -0.006, 0.04, 0.018, 0.015), S(0.12, -0.018, 0.032, 0.015, 0.012), S(0.16, -0.034, 0.016, 0.011, 0.009), S(0.182, -0.048, 0.002, 0.003, 0.003),
    ], 12, { flip: true, shade: (x, y) => 1 - 0.1 * smooth(0.12, 0.19, y) });
    const earInner = loft([
      S(0.03, -0.012, 0.022, 0.004, 0.004), S(0.09, -0.018, 0.025, 0.004, 0.004), S(0.15, -0.03, 0.012, 0.003, 0.003), S(0.17, -0.042, 0.002, 0.002, 0.002),
    ], 10, { flip: true, shade: 0.62 });
    for (const s of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(s * 0.058, 0.082, 0.0);
      e.userData = { rx: 0.5, rz: -s * 0.12 };
      add(e, earOuter.geo, coatV);
      add(e, earInner.geo, mats.skin);
      e.rotation.set(e.userData.rx, 0, e.userData.rz);
      headInner.add(e);
      H.ears.push(e);
    }
  }
  // merge the small static head details (eyes, lids, nostrils, bridle) into one mesh per material
  {
    const by = new Map();
    for (const m of headInner.children.slice()) {
      if (!m.isMesh || m.geometry === headL.geo) continue;
      m.updateMatrix();
      const g = m.geometry.index ? m.geometry : m.geometry;
      const c = g.clone().applyMatrix4(m.matrix);
      for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') c.deleteAttribute(k);
      if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2));
      if (!by.has(m.material)) by.set(m.material, []);
      by.get(m.material).push(c);
      headInner.remove(m);
    }
    for (const [mat, gs] of by) add(headInner, mergeGeometries(gs), mat);
  }
  // forelock (hangs under gravity, so it is counter-rotated against the head pitch)
  {
    const fl = new THREE.Group();
    const fp = hp(0.02, Math.PI / 2, 1.0);
    fl.position.set(0, fp.y + 0.01, fp.z - 0.01);
    fl.rotation.x = 0.82 + 0.25;
    headInner.add(fl);
    const hb = new HairBuilder();
    for (let k = 0; k < 44; k++) {
      const x0 = (rand() - 0.5) * 0.12, len = 0.12 + 0.12 * rand(), ph = rand() * 6, pts = [];
      for (let q = 0; q <= 5; q++) { const f = q / 5; pts.push([x0 * (1 + 0.5 * f) + 0.02 * Math.sin(f * 4 + ph) * f, -len * f, -0.01 - 0.03 * Math.sin(f * 2.2) - 0.015 * f]); }
      hb.strand(pts, 0.02 + 0.014 * rand(), [0, 0, 1], 0.85 + 0.15 * rand());
    }
    add(fl, hb.geo(), mane);
  }

  // ---- tail: dock + two hanging bundles of fine strands
  const tail = new THREE.Group();
  tail.position.set(0, 1.49, cz(0.88));
  H.tailBase = -0.18;
  tail.rotation.x = H.tailBase;
  body.add(tail);
  add(tail, loft([S(0.03, -0.05, 0.05, 0.05, 0.05), S(-0.05, 0.0, 0.045, 0.045, 0.045), S(-0.14, 0.03, 0.034, 0.034, 0.034), S(-0.22, 0.05, 0.028, 0.028, 0.028)], 12, { flip: true }).geo, coatV);
  const tailBundle = (len, n, rad, spread) => {
    const hb = new HairBuilder();
    for (let k = 0; k < n; k++) {
      const ang = rand() * TAU, r0 = Math.sqrt(rand()) * rad, az = rand() * Math.PI, ph = rand() * 6, ln = len * (0.8 + 0.3 * rand());
      const pts = [];
      for (let q = 0; q <= 6; q++) {
        const f = q / 6, fl = 1 + spread * Math.sin(Math.min(1, f * 1.2) * 1.9);
        pts.push([Math.cos(ang) * r0 * fl + 0.03 * Math.sin(f * 4 + ph) * f, -ln * f, Math.sin(ang) * r0 * fl + 0.05 * f * f + 0.025 * Math.sin(f * 3.4 + ph * 1.3) * f]);
      }
      hb.strand(pts, 0.026 + 0.02 * rand(), [Math.cos(az), 0, Math.sin(az)], 0.8 + 0.22 * rand());
    }
    return hb.geo();
  };
  add(tail, tailBundle(0.6, 90, 0.04, 0.8), mane, 0, -0.07, 0.02);
  const t2g = new THREE.Group();
  t2g.position.set(0, -0.46, 0.04);
  tail.add(t2g);
  add(t2g, tailBundle(0.78, 100, 0.07, 0.5), mane);
  H.tail = tail; H.tail2 = t2g;

  void hoof;
  return H;
}

// Mane and tail hair: strands ripple and stream back with speed, more towards their free ends.
const HAIR_U = { uT: { value: 0 }, uSp: { value: 0 } };
function hairMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: 0xc9c4b9, roughness: 0.62, side: THREE.DoubleSide, vertexColors: true }); // silver-white mane and tail
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHT = U.uT; sh.uniforms.uHS = U.uSp;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uHT; uniform float uHS;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float w = clamp(length(position) * 2.2, 0.0, 1.5); w *= w;
          transformed.z += w * (0.045 * uHS + 0.022 * sin(uHT * 1.9 + position.x * 7.0 + position.y * 5.0));
          transformed.x += w * 0.032 * sin(uHT * 2.6 + position.y * 6.0 + position.z * 4.0) * (1.0 + 0.3 * uHS);
          transformed.y += w * (0.014 * uHS + 0.008 * sin(uHT * 3.1 + position.z * 9.0));
        }`);
  };
  return m;
}


/* ------------------------------------------------------------------ */
/* RideRig                                                             */
/* ------------------------------------------------------------------ */
const GAIT_OFFSETS = [
  [0.25, 0.75, 0.0, 0.5],    // walk  (LF RF LH RH) lateral sequence
  [0.0, 0.5, 0.5, 0.0],      // trot  diagonal pairs
  [0.3, 0.6, 0.0, 0.3],      // canter three-beat
];
const GAIT_BETA = [0.64, 0.5, 0.4];         // duty factor (fraction of the stride a foot is on the ground)
const GAIT_FLEX = [0.85, 1.0, 1.2];         // joint flexion in swing
const GAIT_BOB2 = [0.012, 0.026, 0.008];   // two bounces / stride
const GAIT_BOB1 = [0.0, 0.0, 0.04];        // one bounce / stride
const GAIT_NOD1 = [0.05, 0.012, 0.07];
const GAIT_NOD2 = [0.0, 0.012, 0.0];

export class RideRig {
  constructor(scene) {
    this.scene = scene;
    this.mode = 'walk';
    this.gaitPhase = 0;
    this.stepEvents = [];
    this._envMats = [];

    const env = (m, i = 1) => { m.envMapIntensity = i; this._envMats.push(m); return m; };
    const mats = {
      paint: env(new THREE.MeshPhysicalMaterial({ color: 0x09585a, metalness: 0.4, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.08 }), 0.22),
      chrome: env(new THREE.MeshStandardMaterial({ color: 0xd4d8dc, metalness: 1, roughness: 0.2 }), 0.36),
      trim: env(new THREE.MeshStandardMaterial({ color: 0xb4b8bc, metalness: 1, roughness: 0.34 }), 0.25),
      pillar: env(new THREE.MeshStandardMaterial({ color: 0x6e7276, metalness: 0.9, roughness: 0.4 }), 0.2),
      glass: env(new THREE.MeshPhysicalMaterial({ color: 0xbfd8d8, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, specularIntensity: 0.3 }), 0.12),
      dashMat: new THREE.MeshStandardMaterial({ color: 0x30261d, roughness: 0.68, metalness: 0.0 }),
      liner: new THREE.MeshStandardMaterial({ color: 0x100e0c, roughness: 0.9, side: THREE.BackSide }),
      mirror: env(new THREE.MeshStandardMaterial({ color: 0xa8b8c2, metalness: 1, roughness: 0.04, side: THREE.DoubleSide }), 0.5),
      tan: new THREE.MeshStandardMaterial({ color: 0xc4a074, roughness: 0.55, metalness: 0.0 }),
      cream: new THREE.MeshStandardMaterial({ color: 0xeee5cf, roughness: 0.6 }),
      ivory: new THREE.MeshStandardMaterial({ color: 0xe4d9bd, roughness: 0.38 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.75, side: THREE.DoubleSide }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.88 }),
      red: new THREE.MeshStandardMaterial({ color: 0x9a1a14, roughness: 0.4 }),
      headLens: new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xffe6b0, emissiveIntensity: 0.25, roughness: 0.1 }),
      tailLens: new THREE.MeshStandardMaterial({ color: 0x8a0d0d, emissive: 0xff1810, emissiveIntensity: 0.2, roughness: 0.2 }),
    };
    this._carMats = mats;
    const hm = {
      coat: new THREE.MeshPhysicalMaterial({ color: 0xe6e1d6, roughness: 0.6, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff) }), // white (grey) horse
      coatV: new THREE.MeshPhysicalMaterial({ color: 0xd4cfc4, roughness: 0.62, sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff), vertexColors: true }),
      hoofV: new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.5, vertexColors: true }),
      skin: new THREE.MeshStandardMaterial({ color: 0x6a5a58, roughness: 0.7 }),
      coatDark: new THREE.MeshPhysicalMaterial({ color: 0x8d8780, roughness: 0.66, sheen: 0.3, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xd8d4cc) }),
      mane: hairMaterial(HAIR_U),
      hoof: new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.5 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x5e3720, roughness: 0.55 }),
      blanket: new THREE.MeshStandardMaterial({ color: 0x9b3a31, roughness: 0.95 }),
      chrome: env(new THREE.MeshStandardMaterial({ color: 0xa0a4a8, metalness: 1, roughness: 0.3 }), 0.4),
      eye: env(new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 0.15, metalness: 0.2 }), 0.15),
      nostril: new THREE.MeshStandardMaterial({ color: 0x120a08, roughness: 0.8 }),
    };

    this.car = buildClassicCar(mats); this._envMats.push(...this.car.envMats);
    // ~180 small parts -> a few dozen meshes: the moving ones (wheels, steering, needle) stay separate
    this.carMerge = mergeStatic(this.car.group, refsOf(this.car));
    this.car.group.rotation.order = 'YXZ';
    this.car.group.visible = false;
    scene.add(this.car.group);

    this.horse = buildHorse(hm);
    this.horse.root.rotation.order = 'YXZ';
    this.horse.root.visible = false;
    scene.add(this.horse.root);

    // state
    this._pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, turnRate: 0 };
    this._env = { night: 0, lookYaw: 0, lookPitch: 0, camMode: 'seat' };
    this._time = 0;
    this._odo = 0;
    this._prevSpeed = 0;
    this._accel = 0;
    // car dynamics
    this._roll = 0; this._rollV = 0;
    this._pitchB = 0; this._pitchV = 0;
    this._heave = 0; this._heaveV = 0;
    this._steer = 0; this._steerWheel = 0; this._wheelSpin = 0;
    this._lightLevel = 0; this._brake = 0;
    // horse gait
    this._hairU = HAIR_U;
    this._music = 0;
    this._gait = 0; this._pTotal = 0; this._freq = 1;
    this._legAmp = 0; this._bob1 = 0; this._bob2 = 0; this._nod1 = 0; this._nod2 = 0;
    this._offs = GAIT_OFFSETS[0].slice();
    this._legU = [0, 0, 0, 0];
    this._lean = 0; this._beta = 0.62; this._bobYprev = 0;
    this._bobY = 0; this._swayX = 0; this._rock = 0;
    // walk
    this._wBob = 0; this._wSway = 0; this._wRoll = 0; this._wAmp = 0;
    this._stepIdx = 0;
    // chase camera
    this._chaseYaw = 0; this._chaseY = 0;
    // temps
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._q1 = new THREE.Quaternion(); this._q2 = new THREE.Quaternion();
    this._e1 = new THREE.Euler(0, 0, 0, 'YXZ');
    this._carEye = new THREE.Vector3(-0.38, 1.36, 0.55);
  }

  setMode(mode) {
    if (mode !== 'car' && mode !== 'horse') mode = 'car';
    this.mode = mode;
    // The car's group stays in the scene even on the horse, with only its visible parts hidden: its two
    // headlights (spot lights) then stay too, switched off. The number of lights in the scene never
    // changes, and that matters: a change makes the GPU recompile the shader of every lit object
    // (a stall of ~150 ms the first time you switch).
    this.car.group.visible = true;
    const car = mode === 'car';
    if (this._carShown !== car) { this._carShown = car; this.car.group.traverse((o) => { if (o.isMesh) o.visible = car; }); }
    if (!car) for (const sp of this.car.spots) sp.intensity = 0;
    this.horse.root.visible = mode === 'horse';
    this._chaseInit = false;
    this._prevSpeed = this._pose.speed;
  }

  setEnvMap(texture) {
    for (const m of this._envMats) { const had = !!m.envMap; m.envMap = texture || null; if (had !== !!texture) m.needsUpdate = true; }
  }

  update(dt, pose, env) {
    dt = clamp(dt || 0, 0, 0.1);
    const p = this._pose;
    p.x = pose.x || 0; p.y = pose.y || 0; p.z = pose.z || 0;
    p.yaw = pose.yaw || 0; p.pitch = pose.pitch || 0;
    p.speed = Math.max(0, pose.speed || 0); p.turnRate = pose.turnRate || 0;
    const e = this._env;
    if (env) {
      e.night = env.night || 0; e.lookYaw = env.lookYaw || 0; e.lookPitch = env.lookPitch || 0;
      e.camMode = env.camMode === 'chase' ? 'chase' : 'seat';
      e.beat = env.beat || 0; e.level = env.level || 0; e.music = !!env.music;
    }
    this._time += dt;
    if (dt > 0) {
      const a = (p.speed - this._prevSpeed) / dt;
      this._accel += (clamp(a, -8, 8) - this._accel) * damp(6, dt);
    }
    this._prevSpeed = p.speed;
    if (e.camMode !== 'chase' || this.mode === 'walk') {
      this._chaseYaw = p.yaw; this._chaseY = p.y;
    }
    if (this.mode === 'car') this._updateCar(dt);
    else if (this.mode === 'horse') this._updateHorse(dt);
    else this._updateWalk(dt);
  }

  /* ---------------- car ---------------- */
  _updateCar(dt) {
    const p = this._pose, c = this.car, e = this._env;
    c.group.position.set(p.x, p.y, p.z);
    c.group.rotation.set(p.pitch, p.yaw, 0);
    this._odo += p.speed * dt;
    const sp = p.speed;

    // sprung body: roll into turns, squat/dive, road texture
    const rollT = clamp(-p.turnRate * sp * 0.006, -0.04, 0.04);
    const pitchT = clamp(this._accel * 0.004, -0.03, 0.03);
    const road = Math.min(1, sp / 10);
    const heaveT = 0.0035 * road * (Math.sin(this._odo * 2.3) + 0.6 * Math.sin(this._odo * 5.1 + 1.0));
    const k = 55, cd = 2 * Math.sqrt(k) * 0.55;
    if (dt > 0) {
      this._rollV += (k * (rollT - this._roll) - cd * this._rollV) * dt; this._roll += this._rollV * dt;
      this._pitchV += (k * (pitchT - this._pitchB) - cd * this._pitchV) * dt; this._pitchB += this._pitchV * dt;
      this._heaveV += (k * (heaveT - this._heave) - cd * this._heaveV) * dt; this._heave += this._heaveV * dt;
    }
    const vib = Math.sin(this._time * 14.0) * 0.0004 * (0.5 + road);
    c.body.rotation.set(this._pitchB + this._heave * 0.3, 0, this._roll);
    c.body.position.set(0, this._heave + vib, 0);

    // steering + wheels
    const target = clamp(Math.atan2(2.8 * p.turnRate, Math.max(sp, 2.0)), -0.5, 0.5);
    this._steer += (target - this._steer) * damp(9, dt);
    for (const s of c.steerPivots) s.rotation.y = this._steer;
    const swT = clamp(p.turnRate * 5.0, -2.4, 2.4);
    this._steerWheel += (swT - this._steerWheel) * damp(8, dt);
    c.steerWheel.rotation.z = this._steerWheel;
    this._wheelSpin = (this._wheelSpin - sp * dt / 0.34) % TAU;
    for (const w of c.wheels) w.rotation.x = this._wheelSpin;
    const mph = clamp(sp * 2.237, 0, 125);
    c.needle.rotation.z = (135 - 270 * (mph / 120)) * Math.PI / 180;

    // lights
    const on = e.night > 0.5 ? 1 : 0;
    this._lightLevel += (on - this._lightLevel) * damp(2.5, dt);
    this._brake += ((this._accel < -1.2 ? 1 : 0) - this._brake) * damp(10, dt);
    const L = this._lightLevel;
    for (const s of c.spots) s.intensity = L * 1400;
    c.headMat.emissiveIntensity = 0.25 + L * 3.5;
    // music: the dial glows and breathes on the beat, the level lamps climb, the gauges pulse faintly
    const beat = e.beat || 0, lvl = e.level || 0;
    this._music += ((e.music ? 1 : 0) - this._music) * damp(3, dt);
    const M = this._music;
    c.gaugeMat.emissiveIntensity = 0.05 + L * 0.5 + M * beat * (0.05 + 0.22 * L);
    if (c.dialMat) {
      c.dialMat.emissiveIntensity = 0.12 + M * (0.5 + 1.1 * beat) * (0.55 + 0.45 * L);
      for (let i = 0; i < c.vu.length; i++) {
        const lit = clamp(lvl * 6.4 - i, 0, 1) * M;
        c.vu[i].emissiveIntensity += (0.02 + lit * (1.0 + 0.8 * L) - c.vu[i].emissiveIntensity) * damp(22, dt);
      }
    }
    c.tailMat.emissiveIntensity = 0.2 + L * 0.9 + this._brake * 2.2;
  }

  /* ---------------- horse ---------------- */
  _updateHorse(dt) {
    const p = this._pose, H = this.horse;
    H.root.position.set(p.x, p.y, p.z);
    const sp = p.speed;

    // gait selection with hysteresis
    let g = this._gait;
    if (g === 0 && sp > 2.7) g = sp > 6.3 ? 2 : 1;
    else if (g === 1 && sp < 2.3) g = 0;
    else if (g === 1 && sp > 6.3) g = 2;
    else if (g === 2 && sp < 5.7) g = sp < 2.3 ? 0 : 1;
    this._gait = g;

    // stride frequency from speed (stride length by gait), smoothed
    let stride;
    if (sp < 2.5) stride = 1.6 + 0.2 * sp;
    else if (sp < 6) stride = 2.1 + 0.35 * (sp - 2.5);
    else stride = 3.325 + 0.45 * (sp - 6);
    const fT = sp > 0.05 ? sp / stride : 0;
    this._freq += (fT - this._freq) * damp(2.2, dt);
    const moving = clamp((sp - 0.15) / 0.4, 0, 1);
    this._pTotal += this._freq * dt;
    this.gaitPhase = ((this._pTotal % 1) + 1) % 1;
    const ph = this._pTotal;

    // blend amplitudes
    const aT = Math.asin(clamp(0.9 * this._beta * sp / (2 * 1.12 * Math.max(this._freq, 0.3)), 0, 0.7)) * moving;
    const kA = damp(2.2, dt);
    this._legAmp += (aT - this._legAmp) * kA;
    this._bob1 += (GAIT_BOB1[g] * moving - this._bob1) * kA;
    this._bob2 += (GAIT_BOB2[g] * moving - this._bob2) * kA;
    this._nod1 += (GAIT_NOD1[g] * moving - this._nod1) * kA;
    this._nod2 += (GAIT_NOD2[g] * moving - this._nod2) * kA;
    const targetOffs = GAIT_OFFSETS[g];
    for (let i = 0; i < 4; i++) this._offs[i] += wrapPI((targetOffs[i] - this._offs[i]) * TAU) / TAU * damp(1.5, dt);

    // legs + footfalls: stance is a straight leg turning at constant rate (foot fixed on the ground),
    // swing returns it with joint flexion; the hoof is kept flat while loaded
    const A = this._legAmp, fa = Math.min(1, A / 0.35);
    const beta = this._beta += (GAIT_BETA[g] - this._beta) * damp(2.2, dt);
    const FL = GAIT_FLEX[g];
    for (let i = 0; i < 4; i++) {
      const leg = H.legs[i];
      const u = ph + this._offs[i];
      const q = ((u - 0.25) % 1 + 1) % 1;   // 0 = touchdown
      let th, lift = 0, w = 1;
      const s0 = 2 * A / beta;
      if (q < beta) th = A - s0 * q;
      else {
        const s = (q - beta) / (1 - beta), m = -s0 * (1 - beta);
        th = hermite(-A, A, m, m, s);
        lift = Math.pow(Math.sin(Math.PI * Math.pow(s, 0.85)), 0.8) * fa;
        w = s < 0.5 ? 1 - smooth(0.02, 0.22, s) : smooth(0.78, 1.0, s);
      }
      let sum = th;
      if (leg.front) {
        const kn = -1.25 * FL * lift, ft = -0.4 * lift;
        leg.hip.rotation.x = th + 0.08 * lift;
        leg.knee.rotation.x = kn; leg.fet.rotation.x = ft;
        sum += 0.08 * lift + kn + ft;
      } else {
        const st = -0.7 * FL * lift, hk = 1.25 * FL * lift, ft = -0.45 * lift;
        leg.hip.rotation.x = th;
        leg.stifle.rotation.x = st; leg.knee.rotation.x = hk; leg.fet.rotation.x = ft;
        sum += st + hk + ft;
      }
      leg.hoof.rotation.x = -sum * Math.max(w, 0.35);
      // keep the loaded foot on the ground as the straight leg tilts (the hip sits inside the body mass)
      const hy = HOOF_H - (leg.cy * Math.cos(th) - leg.cz * Math.sin(th));
      leg._w = w; leg._hy = hy;
      leg.hip.position.y = leg.hipY0 + w * (hy - leg.hipY0 - this._bobYprev);
      const n = Math.floor(u - 0.25);
      if (n !== this._legU[i]) {
        if (this._legU[i] !== 0 || this._pTotal > 1) { if (A > 0.12 && this.stepEvents.length < 16) this.stepEvents.push('hoof'); }
        this._legU[i] = n;
      }
    }

    // body motion
    const s1 = Math.sin(TAU * ph), s2 = Math.sin(2 * TAU * ph + 0.6);
    const bobY = this._bob1 * (0.5 - 0.5 * Math.cos(2 * TAU * ph)) * 0.8 + this._bob2 * s2 * 0.8; // smooth rise and fall, no sharp landing
    const rock = 0.32 * (this._bob1 * Math.cos(TAU * ph) * 1.6 + this._bob2 * Math.cos(2 * TAU * ph + 0.6) * 0.5);
    const sway = (A > 0.01 ? 0.012 : 0) * Math.sin(TAU * ph) * (g === 0 ? 1 : 0.4);
    this._lean += (clamp(-p.turnRate * sp * 0.005, -0.07, 0.07) - this._lean) * damp(2.5, dt);
    H.body.position.y = bobY;
    H.body.rotation.set(rock, 0, this._lean + sway);
    H.root.rotation.set(p.pitch, p.yaw, 0);
    this._bobYprev = bobY; this._bobY = bobY; this._swayX = sway * 1.5; this._rock = rock;

    // head, neck, mane, ears, tail
    const t = this._time;
    const breathe = Math.sin(t * 1.3) * 0.008;
    const nod = this._nod1 * Math.sin(TAU * ph + 1.2) + this._nod2 * Math.sin(2 * TAU * ph);
    H.neck.rotation.x = nod + breathe - rock * 0.5;
    H.head.rotation.x = nod * 0.6 - 0.02;
    H.head.rotation.y = Math.sin(t * 0.35) * 0.015;
    H.ears[0].rotation.x = H.ears[0].userData.rx + Math.sin(t * 0.9) * 0.05 + (this._pTotal > 0 ? Math.sin(TAU * ph) * 0.02 : 0);
    H.ears[1].rotation.x = H.ears[1].userData.rx + Math.sin(t * 0.7 + 1.1) * 0.05;
    H.ears[0].rotation.z = H.ears[0].userData.rz + Math.sin(t * 0.5) * 0.03;
    H.ears[1].rotation.z = H.ears[1].userData.rz + Math.sin(t * 0.6 + 0.4) * 0.03;
    // hair: each lock swings with a lag behind the body, and streams back with speed; the strands
    // themselves ripple in the vertex shader (see hair material)
    const flow = clamp(sp / 6, 0, 1.6);
    this._hairU.uT.value = t; this._hairU.uSp.value += (flow - this._hairU.uSp.value) * damp(1.5, dt);
    for (const m of H.mane) {
      const d = m.userData;
      m.rotation.z = 0.09 * Math.sin(t * 1.6 + d.ph) + 0.10 * (this._bob1 / 0.04) * Math.sin(TAU * ph - 0.9 + d.ph * 0.6) - 0.10 * flow;
      m.rotation.x = 0.07 * Math.sin(t * 1.2 + d.ph * 0.7) + rock * 2.2 - 0.16 * flow;
    }
    H.tail.rotation.x = H.tailBase + 0.10 * Math.sin(TAU * ph + 0.8) * (A / 0.5) + 0.05 * Math.sin(t * 1.1) - 0.22 * flow;
    H.tail.rotation.z = 0.12 * Math.sin(t * 0.8) + 0.09 * Math.sin(TAU * ph) * (A / 0.5);
    H.tail2.rotation.x = 0.26 * Math.sin(t * 1.5 + 1) + 0.28 * Math.sin(TAU * ph + 1.4) * (A / 0.5) - 0.2 * flow;
    H.tail2.rotation.z = 0.16 * Math.sin(t * 1.1 + 0.6) + 0.14 * Math.sin(TAU * ph - 0.7) * (A / 0.5);

    this._stepFromGait(dt);
  }

  _stepFromGait() { /* horse footfalls are pushed inside _updateHorse */ }

  /* ---------------- walk ---------------- */
  _updateWalk(dt) {
    const sp = this._pose.speed;
    const f = sp > 0.05 ? sp / 1.5 : 0;
    const prev = this._pTotal;
    this._pTotal += f * dt;
    this.gaitPhase = ((this._pTotal % 1) + 1) % 1;
    const sc = clamp(sp / 1.4, 0, 1.4);
    this._wAmp += (sc - this._wAmp) * damp(4, dt);
    const ph = this._pTotal;
    this._wBob = 0.016 * this._wAmp * Math.sin(2 * TAU * ph + 0.4);
    this._wSway = 0.012 * this._wAmp * Math.sin(TAU * ph);
    this._wRoll = 0.004 * this._wAmp * Math.sin(TAU * ph + 0.3);
    const a = Math.floor(prev * 2), b = Math.floor(this._pTotal * 2);
    if (b !== a && sp > 0.3 && this.stepEvents.length < 16) this.stepEvents.push('foot');
  }

  /* ---------------- camera ---------------- */
  applyCamera(camera, dt) {
    dt = clamp(dt || 0, 0, 0.1);
    camera.rotation.order = 'YXZ';
    const p = this._pose, e = this._env;
    const chase = e.camMode === 'chase' && this.mode !== 'walk';
    if (chase) {
      const rate = this.mode === 'car' ? 2.6 : 3.2;
      if (!this._chaseInit) { this._chaseYaw = p.yaw; this._chaseY = p.y; this._chaseInit = true; }
      this._chaseYaw += wrapPI(p.yaw - this._chaseYaw) * damp(rate, dt);
      this._chaseY += (p.y - this._chaseY) * damp(5, dt);
      const car = this.mode === 'car';
      const dist = car ? 7.0 : 5.4, hgt = car ? 2.4 : 3.2, lookH = car ? 1.2 : 1.7;
      const ph = clamp(e.lookPitch, -0.45, 0.6);
      const yaw = this._chaseYaw + e.lookYaw;
      const hd = dist * Math.cos(ph);
      const v = this._v1;
      v.set(p.x + Math.sin(yaw) * hd, 0, p.z + Math.cos(yaw) * hd);
      v.y = Math.max(this._chaseY + 0.6, this._chaseY + hgt - dist * Math.sin(ph));
      camera.position.copy(v);
      camera.lookAt(p.x, this._chaseY + lookH + (p.y - this._chaseY), p.z);
      return;
    }
    this._chaseInit = false;
    const ly = e.lookYaw, lp = e.lookPitch;
    this._q2.setFromEuler(this._e1.set(lp, ly, 0, 'YXZ'));
    if (this.mode === 'car') {
      const body = this.car.body;
      body.updateWorldMatrix(true, false);
      camera.position.copy(this._carEye).applyMatrix4(body.matrixWorld);
      body.getWorldQuaternion(this._q1);
      camera.quaternion.copy(this._q1).multiply(this._q2);
    } else if (this.mode === 'horse') {
      const root = this.horse.root;
      root.updateWorldMatrix(true, false);
      const v = this._v1;
      v.set(this._swayX * 0.5, RIDES.horse.eyeHeight + this._bobY * 0.45, 0.1);
      camera.position.copy(v).applyMatrix4(root.matrixWorld);
      this._e1.set(p.pitch + this._rock * 0.3, p.yaw, this._lean * 0.4, 'YXZ');
      this._q1.setFromEuler(this._e1);
      camera.quaternion.copy(this._q1).multiply(this._q2);
    } else {
      const v = this._v1;
      // sway is applied along the heading's right vector
      const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
      v.set(p.x + cy * this._wSway, p.y + 1.68 + this._wBob, p.z - sy * this._wSway);
      camera.position.copy(v);
      this._e1.set(p.pitch + this._wBob * 0.8, p.yaw, this._wRoll, 'YXZ');
      this._q1.setFromEuler(this._e1);
      camera.quaternion.copy(this._q1).multiply(this._q2);
    }
  }
}
