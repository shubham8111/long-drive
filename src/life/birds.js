// All birds (hawk, raven, owl, pigeons, small songbirds, gulls) share ONE instanced mesh: the wing
// flap is done in the vertex shader from a per-instance (flap, fold) attribute.
import * as THREE from 'three';
import { farFade, rand, pick, clamp, lerp, TAU, wrapPI, angLerp } from './common.js';

const MAXB = 80;
const sin = Math.sin, cos = Math.cos;

// species: scale = [wing span, height, body length] relative to the unit bird (span 1.0 m, body 0.46 m)
export const SPECIES = {
  hawk: { sc: [1.28, 1.2, 1.15], col: [0.62, 0.48, 0.36], flapHz: 3.2 },
  raven: { sc: [0.98, 1.0, 1.15], col: [0.1, 0.1, 0.12], flapHz: 4.2 },
  owl: { sc: [1.0, 1.25, 0.85], col: [0.8, 0.7, 0.55], flapHz: 3.4 },
  pigeon: { sc: [0.64, 0.8, 0.72], col: [0.55, 0.57, 0.64], flapHz: 7 },
  songbird: { sc: [0.24, 0.3, 0.34], col: [0.5, 0.45, 0.38], flapHz: 14 },
  gull: { sc: [1.15, 0.95, 0.9], col: [0.92, 0.93, 0.95], flapHz: 3 },
  swift: { sc: [0.34, 0.35, 0.5], col: [0.18, 0.18, 0.2], flapHz: 9 },
};

function birdGeometry() {
  const pos = [], nor = [], col = [], wing = [], idx = [];
  const push = (p, n, c, w) => { pos.push(...p); nor.push(...n); col.push(c, c, c); wing.push(w); return pos.length / 3 - 1; };
  const addGeo = (g, c, tf) => {
    g.deleteAttribute('uv');
    if (tf) g.applyMatrix4(tf);
    const base = pos.length / 3, P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) push([P.getX(i), P.getY(i), P.getZ(i)], [N.getX(i), N.getY(i), N.getZ(i)], c, 0);
    const ix = g.index;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
  };
  const M = new THREE.Matrix4();
  // body, head, beak
  addGeo(new THREE.SphereGeometry(1, 10, 8), 0.78, M.compose(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), new THREE.Vector3(0.085, 0.08, 0.23)));
  addGeo(new THREE.SphereGeometry(1, 8, 6), 0.7, M.compose(new THREE.Vector3(0, 0.035, 0.235), new THREE.Quaternion(), new THREE.Vector3(0.05, 0.05, 0.055)));
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  addGeo(new THREE.ConeGeometry(0.018, 0.06, 5), 0.3, M.compose(new THREE.Vector3(0, 0.03, 0.315), q, new THREE.Vector3(1, 1, 1)));
  // tail: a flat fan
  {
    const a = push([-0.035, 0, -0.17], [0, 1, 0], 0.7, 0), b = push([0.035, 0, -0.17], [0, 1, 0], 0.7, 0);
    const c = push([0.09, 0, -0.42], [0, 1, 0], 0.62, 0), d = push([-0.09, 0, -0.42], [0, 1, 0], 0.62, 0);
    idx.push(a, c, b, a, d, c);
  }
  // wings: tapered strips, 6 segments along the span
  for (const sg of [1, -1]) {
    const SEG = 6, rows = [];
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG, x = 0.06 + u * 0.44;
      const lead = 0.085 - 0.07 * u - 0.05 * u * u, trail = -0.17 + 0.07 * u + 0.1 * u * u * 0.6;
      const y = 0.01 + 0.0 * u;
      rows.push([push([sg * x, y, lead], [0, 1, 0], 0.88 - 0.1 * u, sg * u || 0.0001 * sg), push([sg * x, y, trail], [0, 1, 0], 0.8 - 0.1 * u, sg * u || 0.0001 * sg)]);
    }
    for (let i = 0; i < SEG; i++) {
      const [a, b] = rows[i], [c, d] = rows[i + 1];
      if (sg > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  g.setIndex(idx);
  return g;
}

const BIRD_DECL = 'attribute float aWing;\nattribute vec2 iAnim;';
const BIRD_NORMAL = `
  float bwU = abs(aWing); float bwS = aWing < 0.0 ? -1.0 : 1.0;
  float bAng = (iAnim.x * (0.55 + 0.9 * bwU) - iAnim.y * 0.7) * step(0.0005, bwU);
  if (bwU > 0.0005) { float ny = objectNormal.y < 0.0 ? -1.0 : 1.0; objectNormal = vec3(-bwS * sin(bAng) * ny, cos(bAng) * ny, 0.0); }`;
const BIRD_POS = `
  if (bwU > 0.0005) {
    float br = max(abs(transformed.x) - 0.06, 0.0) * (1.0 - 0.8 * iAnim.y);
    transformed.x = bwS * (0.06 + br * cos(bAng));
    transformed.y += br * sin(bAng);
    transformed.z += iAnim.y * -0.05 * bwU;
  }`;

export class Birds {
  constructor(scene, groundAt, shared) {
    this.groundAt = groundAt;
    this.geo = birdGeometry();
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iAnim', this.anim);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
    farFade(mat, 230, 300, (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + BIRD_DECL)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + BIRD_NORMAL)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + BIRD_POS);
    });
    mat.customProgramCacheKey = () => 'birds';
    this.mesh = new THREE.InstancedMesh(this.geo, mat, MAXB);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.list = [];
    this.t = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  get count() { return this.list.length; }

  // opts per state: see update(). Returns the bird, or null when full.
  add(kind, x, y, z, state, o = {}) {
    if (this.list.length >= MAXB) return null;
    const sp = SPECIES[kind];
    const k = rand(0.92, 1.08);
    const b = {
      kind, sp, k, x, y, z, yaw: rand(0, TAU), pitch: 0, roll: 0, state, t: 0, ttl: o.ttl ?? 60, ph: rand(0, TAU), flapAmt: 0, glideT: rand(0.5, 2),
      speed: o.cruise ?? 9, vy: 0, gy: y, gT: 0, alt: o.alt ?? 0, dir: Math.random() < 0.5 ? 1 : -1, theta: 0, R: 40, cx: x, cz: z,
      tone: rand(0.88, 1.1), hx: 0, hz: 0, peck: rand(0, 5), trigger: o.trigger ?? 22, drift: [0, 0], tag: o.tag || null, flock: o.flock || null,
      ax: 0, fa: 0, fm: 1, fb: 0, fold: 0, dead: false, wanderYaw: rand(0, TAU), cruise: o.cruise ?? 9, flutter: o.flutter ?? 1,
    };
    Object.assign(b, o.set || {});
    this.list.push(b);
    return b;
  }

  clear(tag) { for (const b of this.list) if (!tag || b.tag === tag) b.dead = true; }

  update(dt, ctx, now) {
    const L = this.list, px = ctx.px, pz = ctx.pz;
    this.t += dt;
    for (let i = L.length - 1; i >= 0; i--) {
      const b = L[i];
      if (this.step(b, dt, ctx)) { L.splice(i, 1); continue; }
      b.ph += dt * TAU * b.sp.flapHz * (b.state === 'soar' ? 0.8 : 1);
    }
    // write instances
    const mesh = this.mesh, col = mesh.instanceColor.array, an = this.anim.array;
    for (let i = 0; i < L.length; i++) {
      const b = L[i], sc = b.sp.sc;
      let x = b.x, y = b.y, z = b.z, yaw = b.yaw, pitch = b.pitch, roll = b.roll, ax = b.ax;
      this._e.set(pitch, yaw, roll, 'YXZ');
      this._q.setFromEuler(this._e);
      this._p.set(x, y, z);
      this._s.set(sc[0] * b.k, sc[1] * b.k, sc[2] * b.k);
      mesh.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
      col[i * 3] = b.sp.col[0] * b.tone; col[i * 3 + 1] = b.sp.col[1] * b.tone; col[i * 3 + 2] = b.sp.col[2] * b.tone;
      an[i * 2] = ax; an[i * 2 + 1] = b.fold;
    }
    mesh.count = L.length;
    mesh.visible = L.length > 0;
    mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = this.anim.needsUpdate = L.length > 0;
  }

  // one simulation step of one bird; returns true when it should be removed
  step(b, dt, ctx) {
    const px = ctx.px, pz = ctx.pz;
    b.t += dt; b.ttl -= dt;
    if (b.ttl <= 0 || b.dead) return true;
    const dx0 = b.x - px, dz0 = b.z - pz, d2 = dx0 * dx0 + dz0 * dz0;
    if (d2 > 420 * 420 && b.state !== 'ground') return true;
    // ground height reference (a few times a second)
    b.gT -= dt;
    if (b.gT <= 0) { b.gT = 0.25 + Math.random() * 0.2; const g = this.groundAt(b.x, b.z); if (g !== null && g !== undefined) b.gy = g; }
    switch (b.state) {
      case 'ground': this.ground(b, dt, ctx, d2); break;
      case 'launch': this.launch(b, dt); break;
      case 'fly': this.fly(b, dt); break;
      case 'soar': this.soar(b, dt); break;
    }
    return false;
  }

  ground(b, dt, ctx, d2) {
    b.fold = 1; b.ax = 0; b.fa = 0; b.fm = 1; b.fb = 0;
    b.y = b.gy + 0.06 * b.sp.sc[1] * 0.0 + (b.kind === 'pigeon' ? 0.085 : b.kind === 'songbird' ? 0.05 : 0.1);
    // peck / walk a little
    b.peck += dt;
    const cyc = b.peck % 3.2;
    b.pitch = cyc < 0.5 ? 0.9 * sin((cyc / 0.5) * Math.PI) * (b.kind === 'pigeon' ? 0.7 : 1) : 0.1 * sin(b.t * 2.1);
    if (b.kind === 'pigeon' && cyc > 0.6 && cyc < 2.4) {
      b.wanderYaw += (Math.random() - 0.5) * dt * 3;
      const v = 0.22;
      b.x += sin(b.wanderYaw) * v * dt; b.z += cos(b.wanderYaw) * v * dt;
      b.yaw = angLerp(b.yaw, b.wanderYaw, 0.1);
      b.pitch = 0.12 * sin(b.t * 9);
    }
    // flush when the player closes in
    const dist = Math.sqrt(d2), trig = b.trigger + ctx.speed * 1.1;
    if (dist < trig || (b.flock && b.flock.go)) {
      if (b.flock) b.flock.go = true;
      b.state = 'launch'; b.t = 0;
      const away = Math.atan2(b.x - ctx.px, b.z - ctx.pz) + (Math.random() - 0.5) * 1.2;
      b.yaw = away; b.speed = b.kind === 'pigeon' ? 6 : 5.5; b.vy = rand(2.5, 4.2); b.delay = b.flock ? Math.random() * 0.35 : 0;
    }
  }

  launch(b, dt) {
    b.fold = Math.max(0, b.fold - dt * 6); b.ax = 0.2 + 0.95 * sin(b.ph * 1.2); b.fa = 0.95; b.fm = 1.2; b.fb = 0.2;
    if (b.delay > 0) { b.delay -= dt; b.fold = 1; b.ax = 0; b.fa = 0; b.fb = 0; return; }
    b.x += sin(b.yaw) * b.speed * dt; b.z += cos(b.yaw) * b.speed * dt; b.y += b.vy * dt;
    b.vy = Math.max(1.2, b.vy - 0.8 * dt);
    b.pitch = -0.5; b.roll = 0;
    b.speed = lerp(b.speed, b.cruise, 0.4 * dt);
    if (b.y - b.gy > (b.maxH || 9) || b.t > 3) {
      if (b.wheel) { b.state = 'soar'; b.R = b.wheel; b.alt = rand(7, 13); b.dir = Math.random() < 0.5 ? 1 : -1; b.theta = Math.atan2(-b.dir * sin(b.yaw), b.dir * cos(b.yaw)); b.cx = b.x - cos(b.theta) * b.R; b.cz = b.z - sin(b.theta) * b.R; b.speed = b.cruise; b.ttl = Math.min(b.ttl, rand(8, 13)); b.leave = true; }
      else b.state = 'fly';
    }
  }

  fly(b, dt) {
    b.fold = 0;
    // flap in bouts, glide between
    b.glideT -= dt;
    if (b.glideT <= 0) { b.gliding = !b.gliding; b.glideT = b.gliding ? rand(0.6, 1.6) : rand(1.2, 3.2); if (b.sp.flapHz > 9) b.gliding = false; }
    if (b.glide === 'always') b.gliding = true;
    const target = b.gliding ? 0 : 1;
    b.flapAmt += (target - b.flapAmt) * Math.min(1, dt * 5);
    b.ax = b.flapAmt * 0.95 * sin(b.ph) + (1 - b.flapAmt) * 0.08; b.fa = b.flapAmt * 0.95; b.fm = 1; b.fb = (1 - b.flapAmt) * 0.08;
    b.wanderYaw += (Math.random() - 0.5) * dt * 1.2;
    const dY = wrapPI((b.heading ?? b.yaw) - b.yaw);
    b.yaw += clamp(dY, -0.5 * dt * 2, 0.5 * dt * 2);
    b.yaw += (Math.sin(b.t * 0.7 + b.ph) * 0.08) * dt;
    b.speed += (b.cruise - b.speed) * Math.min(1, dt);
    b.x += sin(b.yaw) * b.speed * dt; b.z += cos(b.yaw) * b.speed * dt;
    // altitude above ground: gently seek the desired height
    const want = b.gy + (b.alt || 12);
    const ey = want - b.y;
    b.vy += (clamp(ey * 0.3, -2, 2.5) - b.vy) * Math.min(1, dt * 1.5);
    b.vy += b.gliding ? -0.2 * dt : 0;
    b.y += b.vy * dt;
    b.pitch = -clamp(b.vy / Math.max(b.speed, 1), -0.5, 0.5);
    b.roll = lerp(b.roll, -clamp(dY * 0.5, -0.5, 0.5), Math.min(1, dt * 3));
  }

  soar(b, dt) {
    b.fold = 0;
    const w = (b.speed || b.cruise) / b.R * b.dir;
    b.theta += w * dt;
    b.cx += (b.drift[0]) * dt; b.cz += (b.drift[1]) * dt;
    const nx = b.cx + cos(b.theta) * b.R, nz = b.cz + sin(b.theta) * b.R;
    const mx = nx - b.x, mz = nz - b.z;
    if (b.t > 0.001 && dt > 0) { const yw = Math.atan2(mx, mz); b.yaw = b.t < 0.2 ? yw : angLerp(b.yaw, yw, Math.min(1, dt * 6)); }
    b.x = nx; b.z = nz;
    const wantY = b.gy + b.alt + sin(b.t * 0.3 + b.ph) * 2.0;
    b.y += clamp(wantY - b.y, -2 * dt, 2 * dt) + (b.y < wantY - 6 ? 3 * dt : 0);
    b.pitch = 0.05 + (b.flapAmt > 0.5 ? -0.05 : 0);
    const bank = Math.atan((b.speed || b.cruise) * Math.abs(w) / 9.8);
    b.roll = lerp(b.roll, -b.dir * bank, Math.min(1, dt * 2));
    // soaring raptors glide with an occasional beat; wheeling pigeons / gulls beat steadily
    b.glideT -= dt;
    if (b.glideT <= 0) { b.gliding = b.flutter >= 1.5 ? false : b.flutter < 0.5 ? Math.random() < 0.85 : !b.gliding; b.glideT = b.gliding ? rand(3, 8) : rand(0.8, 1.6); }
    const tgt = b.gliding ? 0 : 1;
    b.flapAmt += (tgt - b.flapAmt) * Math.min(1, dt * 4);
    b.fb = (1 - b.flapAmt) * (b.kind === 'hawk' ? 0.16 : 0.1); b.fa = b.flapAmt * 0.8; b.fm = 1;
    b.ax = b.fa * sin(b.ph) + b.fb;
    if (b.leave && b.ttl < 1.5) { b.state = 'fly'; b.heading = b.yaw + (Math.random() - 0.5); b.cruise = 9; b.alt = 18; b.ttl = 12; b.speed = b.speed || 8; }
  }
}
