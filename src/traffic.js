// traffic.js - a little other traffic on the same route geometry, for "Long Drive".
// Vehicles are placed with route.sample(s) plus a lateral offset, so they follow every curve and hill.
// Scenic: now and then an oncoming car / pickup / camper, rarely something slower ahead (which speeds up
// or pulls onto the shoulder as you close), cyclists on the shoulder. City: light same-direction flow in the
// other lanes. Circuit: almost nothing, rarely one lapping car.  One instanced mesh per vehicle type (shared
// material), one extra additive mesh for headlight halos / ground glow: no real lights.
import * as THREE from 'three';
import { bus } from './events.js';
import { TYPES } from './traffic/models.js';
import { clamp, lerp, rand, pick, chance, weighted, smooth, farFade } from './life/common.js';

const sin = Math.sin, cos = Math.cos;
const P = {};
const MAXCARS = 9;

const PAINT = {
  sedan: [0xb9bdc2, 0x27384f, 0x7c2323, 0xdcdad4, 0x1d1d20, 0x48665a, 0x8b7b5c, 0x3b4a5c],
  hatch: [0xd8d6cf, 0x9a2d2d, 0x2e5d86, 0xe2c15a, 0x4f7a56, 0xb8bcc0, 0x20262e, 0xc9622c],
  suv: [0x202328, 0xb7bbc0, 0xe4e2dc, 0x3a4a3a, 0x5a2020, 0x2c3c52, 0x8a8478],
  pickup: [0xb3261e, 0xd9d6ce, 0x23303f, 0x6b6e72, 0x2e4a34, 0xc9a23a],
  camper: [0xf0eee6, 0xe6dcc4, 0xc9d6dc],
  taxi: [0xf0b81a],
  blackcab: [0x121214],
  sports: [0xc4361f, 0x2548a0, 0xe8e6e0, 0x1a1a1c, 0xd9a21b, 0x2f7a50],
  classic: [0x2e5a3c, 0xb43224, 0xe8dcc0, 0x233a63],
  boxtruck: [0xdad8d2],
  bus: [0x2c6b46],
  doubledecker: [0xb3221b],
  bicycle: [0x2d4a63],
};
const LEN = { sedan: 4.7, hatch: 3.9, suv: 4.8, pickup: 5.3, camper: 5.6, taxi: 4.8, blackcab: 4.5, sports: 4.4, classic: 4.3, boxtruck: 7.4, bus: 11.6, doubledecker: 10.4, bicycle: 1.8 };
const HW = { sedan: 0.95, hatch: 0.88, suv: 1.0, pickup: 1.0, camper: 1.0, taxi: 0.95, blackcab: 0.93, sports: 0.97, classic: 0.85, boxtruck: 1.15, bus: 1.32, doubledecker: 1.32, bicycle: 0.3 };

const CITY_MIX = {
  manhattan: [['taxi', 5], ['boxtruck', 1.4], ['sedan', 1.6], ['suv', 1], ['bus', 0.6]],
  london: [['blackcab', 3.5], ['doubledecker', 2.2], ['hatch', 2.2], ['sedan', 1]],
  paris: [['hatch', 5], ['bus', 1.1], ['sedan', 1.4], ['suv', 0.6]],
  la: [['sedan', 3], ['suv', 3], ['pickup', 2], ['hatch', 1]],
};

/* ------------------------------------------------------------------------------------------ */
const VERT_DECL = 'attribute vec4 aSurf;\nattribute vec3 aWheel;\nattribute vec4 iVeh;\nattribute vec3 iPaint;\nvarying vec4 vSurf;\nvarying vec3 vVeh;';
const FRAG_DECL = 'varying vec4 vSurf;\nvarying vec3 vVeh;';
function vehicleMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3, envMapIntensity: 0.8 });
  const extra = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float wa = iVeh.x; float wc = cos(wa), ws = sin(wa);
        if (aWheel.x > 0.5) objectNormal.yz = vec2(wc * objectNormal.y - ws * objectNormal.z, ws * objectNormal.y + wc * objectNormal.z);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aWheel.x > 0.5) { vec2 q = transformed.yz - aWheel.yz; transformed.yz = aWheel.yz + vec2(wc * q.x - ws * q.y, ws * q.x + wc * q.y); }`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vColor.rgb = mix(vColor.rgb, vColor.rgb * iPaint, aSurf.w); vSurf = aSurf; vVeh = iVeh.yzw;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = vSurf.y;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = vSurf.x;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float lk = vSurf.z; vec3 em = vec3(0.0);
          if (lk > 0.5 && lk < 1.5) em = vec3(1.0, 0.93, 0.78) * (0.18 + 4.0 * vVeh.x);
          else if (lk > 1.5 && lk < 2.5) em = vec3(1.0, 0.07, 0.03) * (0.12 + 0.5 * vVeh.x + 2.6 * vVeh.y);
          else if (lk > 2.5) em = vec3(1.0, 0.78, 0.3) * (0.3 + 1.2 * vVeh.x);
          totalEmissiveRadiance += em; }`);
  };
  extra.key = 'veh';
  farFade(m, 330, 410, extra);
  return m;
}

// additive halos + ground pool for headlights, one mesh for all vehicles
function fxMesh(scene, cap) {
  const pos = [], info = [], idx = [];
  const quad = (kind, side) => {
    const b = pos.length / 3;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(x, y, 0); info.push(kind, side); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  // ground pool: a fan of strips (z 0..1 forward, x -1..1)
  {
    const b = pos.length / 3, N = 6;
    for (let i = 0; i <= N; i++) for (const x of [-1, 1]) { pos.push(x, i / N, 0); info.push(0, 0); }
    for (let i = 0; i < N; i++) { const a = b + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  quad(1, 1); quad(1, -1); quad(2, 1); quad(2, -1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 2));
  g.setIndex(idx);
  const iV = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
  const iD = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iV', iV); g.setAttribute('iDim', iD);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFog: { value: 0.001 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec2 aInfo; attribute vec2 iV; attribute vec4 iDim; uniform float uFog;
      varying vec2 vUv; varying float vI; varying vec3 vCol; varying float vKind;
      void main() {
        mat4 M = modelMatrix * instanceMatrix;
        vec3 fwd = normalize((M * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
        float kind = aInfo.x, sd = aInfo.y; vKind = kind;
        float d; vec4 gp;
        if (kind < 0.5) {
          float z = position.y;
          vec3 loc = vec3(position.x * mix(1.0, 4.2, z), 0.06, iDim.z + 0.4 + z * 26.0);
          vec4 wp = M * vec4(loc, 1.0); d = length(cameraPosition - wp.xyz);
          gp = projectionMatrix * viewMatrix * wp; vUv = vec2(position.x, z); vI = iV.x * 0.5; vCol = vec3(1.0, 0.9, 0.68);
        } else {
          vec3 c = kind < 1.5 ? vec3(sd * iDim.x, iDim.y, iDim.z) : vec3(sd * iDim.x * 0.95, iDim.y + 0.05, iDim.w);
          vec4 wp = M * vec4(c, 1.0); vec3 tc = cameraPosition - wp.xyz; d = length(tc); tc /= d;
          float face = clamp(dot(kind < 1.5 ? fwd : -fwd, tc), 0.0, 1.0);
          float vis = pow(face, 1.6);
          vec4 mv = viewMatrix * wp; float sz = (kind < 1.5 ? 0.55 : 0.32) + d * (kind < 1.5 ? 0.0065 : 0.004);
          mv.xy += position.xy * sz; mv.z += 0.3; gp = projectionMatrix * mv;
          vUv = position.xy; vI = (kind < 1.5 ? iV.x * 1.0 : 0.3 * iV.x + 0.9 * iV.y) * vis; vCol = kind < 1.5 ? vec3(1.0, 0.94, 0.8) : vec3(1.0, 0.1, 0.04);
        }
        vI *= exp(-d * d * uFog * uFog) * (1.0 - smoothstep(380.0, 450.0, d));
        gl_Position = gp;
      }`,
    fragmentShader: `varying vec2 vUv; varying float vI; varying vec3 vCol; varying float vKind;
      void main() {
        float a;
        if (vKind < 0.5) { a = (1.0 - vUv.y) * (1.0 - vUv.y) * (1.0 - vUv.x * vUv.x); a *= smoothstep(0.0, 0.08, vUv.y); }
        else { float r = length(vUv); a = exp(-r * r * 6.0) + 0.22 * exp(-r * r * 1.6); }
        gl_FragColor = vec4(vCol * a * vI * (vKind < 0.5 ? 0.6 : 2.6), 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(g, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.count = 0; mesh.visible = false;
  scene.add(mesh);
  return { mesh, iV, iD, mat };
}

/* ------------------------------------------------------------------------------------------ */
export class Traffic {
  constructor(scene, route, routeData, shared) {
    this.scene = scene; this.route = route; this.data = routeData; this.shared = shared || {};
    this.kind = routeData.kind || (route.road.style === 'city' ? 'city' : route.road.style === 'track' ? 'circuit' : 'scenic');
    this.id = routeData.id;
    this.side = route.leftHand ? -1 : 1;
    this.mat = vehicleMaterial();
    this.types = {};
    this.cars = [];
    this.fx = fxMesh(scene, MAXCARS);
    this.t = 0;
    this.tOncoming = rand(12, 30);
    this.tSame = rand(120, 240);
    this.tBike = rand(60, 150);
    this.tFlow = rand(1, 3);
    this.tLap = rand(80, 160);
    this.lamp = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._col = new THREE.Color(); this.camDir = new THREE.Vector3();
    this.stats = { spawned: 0 };
    this.fixLaneSeed = 0;
    this.preQ = this.kind === 'scenic' ? ['sedan', 'suv', 'pickup', 'hatch', 'camper', 'bicycle']
      : this.kind === 'city' ? (CITY_MIX[this.id] || CITY_MIX.la).filter((m) => m[1] > 0).map((m) => m[0])
      : [this.id === 'monaco' ? 'sports' : 'classic'];
  }

  prebuildStep() { if (!this.preQ.length) return false; this.type(this.preQ.shift()); return true; }
  // Optional: call once at startup. Builds every vehicle type for this place and compiles the shaders.
  warmup(renderer, camera) {
    while (this.prebuildStep());
    const shown = [];
    for (const id in this.types) { const T = this.types[id]; T.mesh.visible = true; T.mesh.count = 1; shown.push(T); }
    this.fx.mesh.visible = true; this.fx.mesh.count = 1;
    try { renderer.compile(this.scene, camera); } catch (e) { /* ignore */ }
    for (const T of shown) { T.mesh.visible = false; T.mesh.count = 0; }
    this.fx.mesh.visible = false; this.fx.mesh.count = 0;
  }

  setEnvMap(tex) { this.mat.envMap = tex || null; this.mat.needsUpdate = true; }

  type(id) {
    let T = this.types[id];
    if (T) return T;
    const built = TYPES[id]();
    const cap = id === 'bus' || id === 'doubledecker' ? 3 : 6;
    const iVeh = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const iPaint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    built.geo.setAttribute('iVeh', iVeh); built.geo.setAttribute('iPaint', iPaint);
    const mesh = new THREE.InstancedMesh(built.geo, this.mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false;
    mesh.castShadow = false; mesh.receiveShadow = false;
    this.scene.add(mesh);
    T = this.types[id] = { id, mesh, iVeh, iPaint, cap, n: 0, built };
    return T;
  }

  /* ------------------------------------------------------------------ helpers */
  rel(s) {
    const c = this.c; let d = (s - c.s) * c.dir;
    if (this.route.loop) { const L = this.route.length; d = ((d + L / 2) % L + L) % L - L / 2; }
    return d;
  }
  valid(s) { return this.route.loop || (s > 10 && s < this.route.length - 10); }
  count(kind) { let n = 0; for (const c of this.cars) if (c.kind === kind) n++; return n; }
  playerLat() { return this.c.dir * this.c.lat; } // the player's lateral offset in the route's own right-hand frame

  make(tid, kind, s, d, lat, v, o = {}) {
    if (this.cars.length >= MAXCARS) return null;
    const T = this.type(tid);
    let n = 0; for (const c of this.cars) if (c.tid === tid) n++;
    if (n >= T.cap) return null;
    const pal = PAINT[tid];
    const car = {
      tid, kind, s, d, lat, latT: lat, v, vT: v, ph: rand(0, 6), brake: 0, paint: new THREE.Color(o.paint ?? pick(pal)),
      hw: HW[tid], len: LEN[tid], R: T.built.R, acc: 0, notable: o.notable || null, sent: false, seenT: 0, y: 0, pitch: 0, lane: lat,
      pullOver: false, shoulder: o.shoulder, t: 0, slow: o.slow || false, laneOff: o.laneOff,
    };
    this.cars.push(car);
    this.stats.spawned++;
    return car;
  }

  /* ------------------------------------------------------------------ update */
  update(dt, c) {
    if (!c || !c.started) return;
    dt = Math.min(dt, 0.1);
    this.c = c; this.t += dt;
    this.prebuildStep();
    c.camera.getWorldDirection(this.camDir);
    const bad = c.weather.rain > 0.25 || c.weather.snow > 0.2;
    this.lamp = Math.max(smooth(0.28, 0.6, c.night), clamp(c.weather.rain * 2 - 0.3, 0, 1), clamp((c.weather.fog || 0) * 1.5 - 0.5, 0, 1));
    this.schedule(dt, c, bad);
    this.step(dt, c);
    this.draw(dt, c);
  }

  schedule(dt, c, bad) {
    const night = c.night, moving = c.speed > 0.8 ? 1 : 0.5;
    if (this.kind === 'scenic') {
      const k = dt * moving;
      this.tOncoming -= k; this.tSame -= k; this.tBike -= k;
      if (this.tOncoming <= 0) {
        this.tOncoming = rand(26, 68) * (1 + night * 1.2) * (bad ? 1.4 : 1);
        if (this.count('oncoming') < 3 && this.spawnOncoming(c)) { /* ok */ }
      }
      if (this.tSame <= 0) { this.tSame = rand(170, 320) * (1 + night); if (night < 0.7 && !bad) this.spawnSlowAhead(c); }
      if (this.tBike <= 0) { this.tBike = rand(110, 230); if (night < 0.25 && !bad && this.count('bike') < 1) this.spawnBike(c); }
    } else if (this.kind === 'city') {
      this.tFlow -= dt;
      if (this.tFlow <= 0) {
        this.tFlow = rand(1.5, 4.2);
        const base = { manhattan: 6, london: 5.5, paris: 4.5, la: 5 }[this.id] ?? 4.5;
        const target = Math.round(base * (1 - 0.72 * smooth(0.3, 0.9, night)) * (bad ? 0.8 : 1) * rand(0.7, 1.15));
        if (this.count('flow') < Math.min(target, 7)) this.spawnFlow(c);
      }
    } else {
      this.tLap -= dt * moving;
      if (this.tLap <= 0) { this.tLap = rand(160, 320); if (night < 0.8 && this.count('lap') < 1) this.spawnLapper(c); }
    }
  }

  /* ---- scenic ---- */
  spawnOncoming(c) {
    const night = c.night;
    const tid = weighted([['sedan', 3.4], ['suv', 2.2], ['pickup', 2.2], ['hatch', 1.2], ['camper', night < 0.5 ? 1.1 : 0.3]]);
    const rel = rand(420, 470), s = c.s + c.dir * rel;
    if (!this.valid(s)) return false;
    const d = -c.dir, lane = this.route.road.lane || 1.75;
    for (const o of this.cars) if (o.kind === 'oncoming' && Math.abs(this.rel(o.s) - rel) < 70) return false;
    const car = this.make(tid, 'oncoming', s, d, d * this.side * lane, rand(15, 24));
    if (!car) return false;
    if (tid === 'camper') car.notable = { what: 'camper van', label: 'a camper van heading the other way' };
    else if (tid === 'pickup' && chance(0.2)) car.notable = { what: 'pickup', label: pick(['a pickup truck coming the other way', 'a dusty pickup heading the other way']) };
    return true;
  }
  spawnSlowAhead(c) {
    const tid = pick(['sedan', 'pickup', 'camper', 'suv']);
    const rel = rand(300, 360), s = c.s + c.dir * rel;
    if (!this.valid(s)) return false;
    const lane = this.route.road.lane || 1.75;
    const v = clamp(c.speed * rand(0.55, 0.75), 8, 15);
    const car = this.make(tid, 'same', s, c.dir, c.dir * this.side * lane, v, { slow: true });
    if (!car) return false;
    if (tid === 'camper') car.notable = { what: 'camper van', label: 'a camper van up ahead, in no hurry' };
    return true;
  }
  spawnBike(c) {
    const rel = rand(280, 340), s = c.s + c.dir * rel;
    if (!this.valid(s)) return false;
    const edge = this.route.road.edge;
    const car = this.make('bicycle', 'bike', s, c.dir, c.dir * this.side * (edge + 0.7), rand(4.5, 7), { notable: { what: 'cyclist', label: pick(['a cyclist on the shoulder', 'a cyclist grinding up the road']) } });
    return !!car;
  }

  /* ---- city ---- */
  spawnFlow(c) {
    const mix = CITY_MIX[this.id] || CITY_MIX.la;
    const tid = weighted(mix);
    const rd = this.route.road, lane = rd.lane || 1.85, w = lane * 2;
    const offs = [lane, lane + w, -lane, -(lane + w)].filter((o) => Math.abs(o - c.lat) > 3.1 && Math.abs(o) < rd.edge - 0.4);
    if (!offs.length) return false;
    const off = pick(offs);
    const behind = chance(0.45);
    const rel = behind ? -rand(230, 300) : rand(340, 420);
    const s = c.s + c.dir * rel;
    if (!this.valid(s)) return false;
    for (const o of this.cars) if (o.kind === 'flow' && Math.abs(o.laneOff - off) < 1 && Math.abs(this.rel(o.s) - rel) < 60) return false;
    const base = Math.max(c.speed, 9);
    const v = behind ? clamp(base * rand(1.06, 1.3) + 1, 8, 29) : clamp(base * rand(0.7, 1.12), 6, 25);
    const car = this.make(tid, 'flow', s, c.dir, c.dir * off, v, { laneOff: off });
    if (!car) return false;
    car.v = car.vT = v;
    if (tid === 'doubledecker') car.notable = { what: 'double-decker', label: 'a red double-decker' };
    else if (tid === 'bus' && this.id === 'paris') car.notable = { what: 'bus', label: 'a green and white bus' };
    else if (tid === 'boxtruck') car.notable = { what: 'box truck', label: 'a box truck' };
    return true;
  }

  /* ---- circuit ---- */
  spawnLapper(c) {
    const tid = this.id === 'monaco' ? 'sports' : 'classic';
    const ahead = chance(0.55);
    const rel = ahead ? rand(260, 340) : -rand(230, 280);
    const s = c.s + c.dir * rel;
    const sgn = this.playerLat() >= 0 ? -1 : 1;
    const lat = sgn * rand(2.6, 3.8);
    const v = ahead ? clamp(c.speed * 1.08 + 2, 14, 38) : clamp(c.speed + rand(7, 11), 20, 45);
    const car = this.make(tid, 'lap', s, c.dir, lat, v, { notable: { what: tid === 'sports' ? 'sports car' : 'racing car', label: tid === 'sports' ? 'a sports car lapping the circuit' : 'an old racing car out on a lap of the circuit' } });
    return !!car;
  }

  /* ---------------------------------------------------------------- motion */
  step(dt, c) {
    const cars = this.cars, rd = this.route.road;
    const PL = this.playerLat();
    for (let i = cars.length - 1; i >= 0; i--) {
      const k = cars[i];
      k.t += dt;
      const rel = this.rel(k.s);
      const same = k.d === c.dir;
      // ---- speed policy
      if (k.kind === 'same' || k.kind === 'bike') {
        const inLane = Math.abs(k.lat - PL) < 3.2 && k.kind === 'same';
        if (k.kind === 'same' && rel > 0 && rel < 100) {
          const want = Math.min(c.speed + 1.6, 30);
          k.vT = Math.max(k.vT, want * smooth(100, 40, rel) + k.vT * (1 - smooth(100, 40, rel)));
          // cannot keep ahead of the player: pull onto the shoulder and let them by
          if (c.speed > k.v + 1.0 && rel < 80) k.pullOver = true;
        }
        if (k.pullOver) k.latT = k.d * this.side * (rd.edge + 0.55);
        // once passed, keep well clear behind the player
        if (k.kind === 'same' && rel < 0 && rel > -60) k.vT = Math.min(k.vT, Math.max(c.speed * 0.9, 6));
        if (k.kind === 'same' && rel < 0 && rel > -22 && k.v > c.speed - 1.5) k.vT = Math.min(k.vT, Math.max(c.speed - 2.5, 0));
        if (k.kind === 'bike' && inLane) { /* never */ }
      }
      if (k.kind === 'flow') {
        // follow the vehicle ahead in the same lane
        for (const o of cars) {
          if (o === k || o.kind !== 'flow' || Math.abs(o.laneOff - k.laneOff) > 1) continue;
          const g = (o.s - k.s) * k.d - (o.len + k.len) / 2;
          if (g > 0 && g < 16 + k.v * 0.9 && o.v < k.v + 0.5) k.vT = Math.min(k.vT, o.v - (g < 7 ? 1.5 : 0));
        }
        // sidestep a little if the player wanders into the neighbouring lane
        if (same && Math.abs(rel) < 32) {
          const gap = k.lane - PL, need = 3.0;
          if (Math.abs(gap) < need) k.latT = k.lane + Math.sign(gap || 1) * Math.min(1.25, need - Math.abs(gap));
          else k.latT = k.lane;
          const lim = rd.edge - k.hw - 0.1; k.latT = clamp(k.latT, -lim, lim);
        }
        if (k.vT === k.v && chance(dt * 0.1)) k.vT = clamp(k.v * rand(0.93, 1.07), 6, 29);
      }
      if (k.kind === 'lap') {
        // wide of the player's line, never closer than 2.4 m laterally while alongside
        if (Math.abs(rel) < 40 && Math.abs(k.lat - PL) < 2.6) k.latT = PL + Math.sign(k.lat - PL || 1) * 2.8;
      }
      // brake / accel
      const a = k.vT > k.v ? 2.6 : 4.5;
      const dv = clamp(k.vT - k.v, -a * dt, a * dt);
      k.v += dv;
      k.acc = lerp(k.acc, dv / Math.max(dt, 1e-3), Math.min(1, dt * 6));
      k.brake = k.acc < -1.2 ? 1 : lerp(k.brake, 0, Math.min(1, dt * 8));
      k.lat += clamp(k.latT - k.lat, -1.3 * dt, 1.3 * dt);
      k.s += k.d * k.v * dt;
      k.ph += k.v * dt / k.R;
      // ---- removal
      const r = this.rel(k.s);
      let dead = false;
      if (!this.route.loop && (k.s < 5 || k.s > this.route.length - 5)) dead = true;
      if (r > 520 || r < -330) dead = true;
      if (k.kind === 'oncoming' && r < -120) dead = true;
      if (k.kind === 'bike' && r < -130) dead = true;
      if (k.kind === 'lap' && r < -150) dead = true;
      if (dead) { cars.splice(i, 1); continue; }
      // ---- notable sighting
      if (k.notable && !k.sent) {
        if (r > -10 && r < 150) {
          this.route.sample(k.s, P);
          const x = P.x - P.tz * k.lat - c.pose.x, z = P.z + P.tx * k.lat - c.pose.z, dl = Math.hypot(x, z) || 1;
          if ((x * this.camDir.x + z * this.camDir.z) / dl > 0.62) k.seenT += dt;
        }
        if (k.seenT > 0.9) { k.sent = true; bus.emit('traffic', { what: k.notable.what, label: k.notable.label }); }
      }
    }
  }

  /* ---------------------------------------------------------------- render */
  draw(dt, c) {
    for (const id in this.types) this.types[id].n = 0;
    const fx = this.fx, fxm = fx.mesh;
    let nf = 0;
    const lamp = this.lamp;
    const fog = this.scene.fog ? this.scene.fog.density : 0.0008;
    for (const k of this.cars) {
      this.route.sample(k.s, P);
      const x = P.x - P.tz * k.lat, z = P.z + P.tx * k.lat, y = P.y + 0.06;
      const yaw = Math.atan2(P.tx * k.d, P.tz * k.d);
      const pitch = -Math.atan(P.slope * k.d);
      const T = this.types[k.tid];
      const i = T.n++;
      this._e.set(pitch, yaw, 0, 'YXZ'); this._q.setFromEuler(this._e);
      T.mesh.setMatrixAt(i, this._m.compose(this._p.set(x, y, z), this._q, this._s));
      const va = T.iVeh.array, pa = T.iPaint.array;
      va[i * 4] = k.ph; va[i * 4 + 1] = lamp; va[i * 4 + 2] = k.brake; va[i * 4 + 3] = 0;
      pa[i * 3] = k.paint.r; pa[i * 3 + 1] = k.paint.g; pa[i * 3 + 2] = k.paint.b;
      if (nf < fx.iV.count) {
        const b = T.built;
        fxm.setMatrixAt(nf, this._m);
        fx.iV.array[nf * 2] = k.tid === 'bicycle' ? 0 : lamp; fx.iV.array[nf * 2 + 1] = k.brake * (k.tid === 'bicycle' ? 0 : 1);
        const d = fx.iD.array; d[nf * 4] = b.hx; d[nf * 4 + 1] = b.hy; d[nf * 4 + 2] = b.frontZ; d[nf * 4 + 3] = b.rearZ;
        nf++;
      }
    }
    for (const id in this.types) {
      const T = this.types[id];
      T.mesh.count = T.n; T.mesh.visible = T.n > 0;
      if (T.n > 0) { T.mesh.instanceMatrix.needsUpdate = true; T.iVeh.needsUpdate = true; T.iPaint.needsUpdate = true; }
    }
    fxm.count = nf; fxm.visible = nf > 0 && (lamp > 0.02 || this.cars.some((k) => k.brake > 0.05));
    if (nf > 0) { fxm.instanceMatrix.needsUpdate = true; fx.iV.needsUpdate = fx.iD.needsUpdate = true; }
    fx.mat.uniforms.uFog.value = fog;
  }
}
