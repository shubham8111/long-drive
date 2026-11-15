// life.js - occasional wildlife, passers-by and trackside people for "Long Drive".
// Rare, calm and different every drive: a scheduler decides when something notable happens (every ~40-90 s
// of driving), spawns it well ahead of the player (beyond the dither-fade distance, so nothing pops in),
// lets it live its little moment and removes it once it is well behind.
import * as THREE from 'three';
import { bus } from './events.js';
import { clamp, lerp, rand, pick, chance, weighted, TAU, wrapPI, smooth, farFade, StaticMap } from './life/common.js';
import { makeDeer, poseDeer, makeHare, poseHare, deerGeometry } from './life/animals.js';
import { makePed, posePed, randomLook, makeDog, poseDog, DOGS, MARSHAL_LOOK } from './life/people.js';
import { Birds } from './life/birds.js';

const sin = Math.sin, cos = Math.cos;
const P = {};          // scratch route sample
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/* ------------------------------------------------------------------------------------------ */
/* eyeshine: instanced glow quads                                                              */
/* ------------------------------------------------------------------------------------------ */
class Eyes {
  constructor(scene, cap = 12) {
    const g = new THREE.PlaneGeometry(1, 1);
    this.aI = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aI', this.aI);
    this.u = { uFog: { value: 0 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aI; varying float vI; varying vec2 vUv; uniform float uFog; void main(){
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.,0.,0.,1.); float d = -mv.z;
        float sz = max(0.05, d * 0.0032);
        vUv = position.xy * 2.0; vI = aI * exp(-d * d * uFog * uFog);
        mv.xy += position.xy * sz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vI; varying vec2 vUv; void main(){ float r = length(vUv); float a = exp(-r*r*5.0) + 0.25*exp(-r*r*1.2);
        gl_FragColor = vec4(vec3(0.78, 1.0, 0.55) * a * vI * 3.2, 1.0); }`,
    });
    this.mesh = new THREE.InstancedMesh(g, m, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; this.mesh.visible = false; this.mesh.count = 0;
    this.cap = cap; this.n = 0; this.m4 = new THREE.Matrix4();
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  pair(x, y, z, sx, sz, I) {
    if (this.n + 2 > this.cap || I <= 0.01) return;
    for (const k of [-1, 1]) {
      this.m4.makeTranslation(x + sx * k, y, z + sz * k);
      this.mesh.setMatrixAt(this.n, this.m4); this.aI.array[this.n] = I; this.n++;
    }
  }
  end(fog) {
    this.mesh.count = this.n; this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = this.aI.needsUpdate = this.n > 0;
    this.u.uFog.value = fog;
  }
}

/* ------------------------------------------------------------------------------------------ */
export class Life {
  constructor(scene, route, routeData, terrain, shared) {
    this.scene = scene; this.route = route; this.data = routeData; this.terrain = terrain; this.shared = shared || {};
    this.kind = routeData.kind || (route.road.style === 'city' ? 'city' : route.road.style === 'track' ? 'circuit' : 'scenic');
    this.map = new StaticMap(routeData);
    const nightU = this.shared.uNight || { value: 0 };
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    const extra = (sh) => {
      sh.uniforms.uNight = nightU;
      sh.fragmentShader = sh.fragmentShader.replace('uniform vec3 diffuse;', 'uniform vec3 diffuse;\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * uNight * 0.09;');
    };
    extra.key = 'n';
    farFade(this.mat, 230, 300, extra);
    this.birds = new Birds(scene, (x, z) => this.groundAt(x, z), this.shared);
    this.eyes = new Eyes(scene);
    this.things = [];
    this.looks = [];
    this.rigPool = new Map();
    this.buildQueue();
    this.c = null;
    this.t = 0;
    this.tNotable = rand(14, 30);
    this.tAmbient = rand(4, 12);
    this.tPed = rand(2, 6);
    this.pending = null; this.pendingT = 0; this.retry = 0;
    this.px = 0; this.pz = 0; this.ex = 1e9; this.ez = 1e9; this._bc = { px: 0, pz: 0, speed: 0 };
    this.fence = null;
    this.camDir = new THREE.Vector3();
    this.stats = { spawned: 0, notable: 0 };
    this.side = route.leftHand ? -1 : 1;
  }

  /* ---- pooling / prebuilding: nothing is built at spawn time ---- */
  getRig(key, make) {
    const a = this.rigPool.get(key); return a && a.length ? a.pop() : make();
  }
  release(key, rig) {
    if (!rig) return;
    let a = this.rigPool.get(key); if (!a) this.rigPool.set(key, (a = [])); a.push(rig);
  }
  // one chunk of prebuilding per call (cheap); returns false when everything is built
  prebuildStep() {
    const q = this.preQ;
    if (!q.length) return false;
    q.shift()();
    return true;
  }
  buildQueue() {
    const q = this.preQ = [];
    const keep = (key, make) => q.push(() => this.release(key, make()));
    q.push(() => deerG());
    if (this.kind === 'scenic') { keep('doe', () => makeDeer(this.mat, false)); keep('buck', () => makeDeer(this.mat, true)); keep('hare', () => makeHare(this.mat)); keep('doe', () => makeDeer(this.mat, false)); }
    if (this.kind === 'city') {
      for (let i = 0; i < 12; i++) q.push(() => { const l = randomLook(); this.looks.push(l); const k = 'ped' + JSON.stringify(l); this.release(k, makePed(this.mat, l)); if (i < 4) this.release(k, makePed(this.mat, l)); });
      for (const d of DOGS) keep('dog' + d[0] + d[1], () => makeDog(this.mat, d[0], d[1]));
    }
    if (this.kind === 'circuit') {
      for (let i = 0; i < 6; i++) q.push(() => { const l = randomLook(); this.looks.push(l); const k = 'ped' + JSON.stringify(l); this.release(k, makePed(this.mat, l)); });
      q.push(() => { const k = 'ped' + JSON.stringify(MARSHAL_LOOK); this.release(k, makePed(this.mat, MARSHAL_LOOK)); });
    }
  }
  // Optional: call once at startup (loading screen). Builds everything and compiles the shaders.
  warmup(renderer, camera) {
    while (this.prebuildStep());
    const added = [];
    const show = (rig) => { rig.mesh.position.set(0, -500, 0); rig.mesh.visible = true; this.scene.add(rig.mesh); added.push(rig.mesh); };
    for (const a of this.rigPool.values()) if (a.length) show(a[0]);
    this.birds.mesh.visible = true; this.birds.mesh.count = 1; this.eyes.mesh.visible = true; this.eyes.mesh.count = 1;
    try { renderer.compile(this.scene, camera); } catch (e) { /* ignore */ }
    for (const m of added) this.scene.remove(m);
    this.birds.mesh.visible = false; this.birds.mesh.count = 0; this.eyes.mesh.visible = false; this.eyes.mesh.count = 0;
    this.warmed = true;
  }

  /* ------------------------------------------------------------- helpers ---- */
  groundAt(x, z) {
    const r = this.route, d = r.nearest(x, z, 40);
    if (d >= 0 && d <= r.road.half + 0.3) return r.nearY + 0.06;
    const h = this.terrain.heightAt(x, z);
    if (h !== null && h !== undefined) return h;
    return d >= 0 ? r.nearY + 0.06 : null;
  }
  inRange(s) { return this.route.loop || (s > 20 && s < this.route.length - 20); }
  rel(s) { // metres ahead of the player along the direction of travel (negative = behind)
    const c = this.c; let d = (s - c.s) * c.dir;
    if (this.route.loop) { const L = this.route.length; d = ((d + L / 2) % L + L) % L - L / 2; }
    return d;
  }
  at(s, r, out) {
    this.route.sample(s, P);
    out.x = P.x - P.tz * r; out.z = P.z + P.tx * r; out.ry = P.y; out.tx = P.tx; out.tz = P.tz; out.slope = P.slope;
    return out;
  }
  sideOf(r) { return r * this.c.dir > 0 ? 'right' : 'left'; }
  walkSurface() { return this.kind === 'city'; }
  // is this world point on screen (and close enough to matter)?
  onScreen(x, y, z, maxD = 230) {
    const cam = this.c.camera; _v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    const d = -_v.z;
    if (d < 6 || d > maxD) return false;
    const e = cam.projectionMatrix.elements;
    return Math.abs(_v.x * e[0] / d) < 0.9 && Math.abs(_v.y * e[5] / d) < 0.9;
  }
  look() { // a bounded pool of looks keeps the number of distinct geometries small
    if (this.looks.length < 12) this.looks.push(randomLook());
    return pick(this.looks);
  }
  add(th) { this.things.push(th); this.scene.add(th.obj); this.stats.spawned++; return th; }
  remove(i) {
    const th = this.things[i];
    this.scene.remove(th.obj);
    th.dispose?.();
    this.things.splice(i, 1);
  }
  count(type) { let n = 0; for (const t of this.things) if (t.type === type) n++; return n; }
  sight(th, what, label, side) { th.sight = { what, label, side }; th.seenT = 0; th.seenNeed = 1.4; th.sent = false; }

  /* -------------------------------------------------------------- update ---- */
  update(dt, ctx) {
    if (!ctx || !ctx.started) return;
    dt = Math.min(dt, 0.1);
    this.c = ctx; this.t += dt;
    this.px = ctx.pose.x; this.pz = ctx.pose.z;
    ctx.camera.getWorldDirection(this.camDir);
    if (Math.abs(this.px - this.ex) + Math.abs(this.pz - this.ez) > 25) {
      this.ex = this.px; this.ez = this.pz;
      this.map.ensure(this.px, this.pz);
      if (this.kind !== 'city') this.map.ensure(this.px + this.camDir.x * 150, this.pz + this.camDir.z * 150);
    }
    if (this.prebuildStep()) { /* one prebuild item per frame */ } else this.map.pump(0.25);
    this.schedule(dt, ctx);
    this.eyes.begin();
    for (let i = this.things.length - 1; i >= 0; i--) {
      const th = this.things[i];
      if (th.update(dt, ctx) === false) { this.remove(i); continue; }
      if (th.eye) this.eyes.pair(th.eye[0], th.eye[1], th.eye[2], th.eye[3], th.eye[4], th.eye[5]);
      if (th.sight && !th.sent) {
        const o = th.obj.position;
        if (this.onScreen(o.x, o.y + 0.8, o.z, th.sightRange || 200)) th.seenT += dt;
        if (th.seenT > th.seenNeed) { th.sent = true; bus.emit('sighting', th.sight); }
      }
    }
    this._bc.px = this.px; this._bc.pz = this.pz; this._bc.speed = ctx.speed; this._bc.cam = ctx.camera;
    this.birds.update(dt, this._bc, this.t);
    for (const b of this.birds.list) {
      if (b.sight && !b.sent && b.state !== 'ground') {
        if (this.onScreen(b.x, b.y, b.z, 220)) b.seenT = (b.seenT || 0) + dt;
        if ((b.seenT || 0) > 1.8) { b.sent = true; bus.emit('sighting', b.sight); }
      }
    }
    this.eyes.end(ctx.weather.fog ? 0.002 + ctx.weather.fog * 0.004 : 0.0012);
  }

  schedule(dt, c) {
    const bad = c.weather.rain > 0.2 || c.weather.snow > 0.2;
    const k = (c.speed > 1 ? 1 : 0.3) * (bad ? 0.5 : 1);
    this.tNotable -= dt * k;
    if (this.tNotable <= 0 && !this.pending) { this.pending = this.pickNotable(c); this.pendingT = 0; this.retry = 0; if (!this.pending) this.tNotable = rand(10, 20); }
    if (this.pending) {
      this.pendingT += dt; this.retry -= dt;
      if (this.retry <= 0) {
        this.retry = 0.5;
        if (this.spawnNotable(this.pending, c)) { this.pending = null; this.tNotable = rand(40, 90); this.stats.notable++; }
        else if (this.pendingT > 22) { this.pending = null; this.tNotable = rand(6, 14); }
      }
    }
    // ambient
    this.tAmbient -= dt * k;
    if (this.tAmbient <= 0) {
      this.tAmbient = rand(22, 55);
      if (this.kind === 'scenic' && c.night < 0.4 && !bad && this.birds.count < 30) this.spawnSongbirds(c);
      else if (this.kind === 'city' && c.night < 0.8 && !bad && this.count('flockMark') < 1 && chance(0.7)) this.spawnPigeons(c);
    }
    if (this.kind === 'city') {
      this.tPed -= dt;
      if (this.tPed <= 0) {
        this.tPed = rand(2.5, 6);
        const target = Math.round((c.night > 0.75 ? 0.6 : 3.4) * (bad ? 0.7 : 1) * rand(0.6, 1.4));
        if (this.count('ped') < Math.min(5, target) && c.speed > 0.5 || (this.count('ped') < 1 && chance(0.3))) this.spawnPed(c, {});
      }
    }
  }

  pickNotable(c) {
    const n = smooth(0.3, 0.75, c.night), d = 1 - n, bad = c.weather.rain > 0.2 || c.weather.snow > 0.2;
    const sky = !bad && c.weather.cover < 0.75 && n < 0.5;
    if (this.kind === 'scenic') {
      return weighted([
        ['deerStand', 34 * d + 10 * n], ['deerCross', c.speed < 26 ? 12 * d : 0], ['hare', 13 * d + 5 * n],
        ['hawk', sky ? 17 * d : 0], ['raven', sky ? 9 * d : 0], ['deerEyes', 42 * n], ['owl', bad ? 0 : 26 * n],
      ]);
    }
    if (this.kind === 'city') {
      return weighted([['dogwalker', 30 * (0.2 + 0.8 * d)], ['bench', 24 * (0.2 + 0.8 * d)], ['pigeons', bad ? 0 : 20 * d]]);
    }
    return weighted([['marshal', 40 * (0.3 + 0.7 * d)], ['spectators', 30 * (0.3 + 0.7 * d)], ['infield', bad ? 0 : 18 * d]]);
  }

  spawnNotable(what, c) {
    switch (what) {
      case 'deerStand': return this.spawnDeer(c, 'stand');
      case 'deerCross': return this.spawnDeer(c, 'cross');
      case 'deerEyes': return this.spawnDeer(c, 'eyes');
      case 'hare': return this.spawnHare(c);
      case 'hawk': return this.spawnSoarer(c, 'hawk');
      case 'raven': return this.spawnSoarer(c, 'raven');
      case 'owl': return this.spawnOwl(c);
      case 'dogwalker': return this.spawnPed(c, { dog: true, notable: true });
      case 'bench': return this.spawnBench(c);
      case 'pigeons': return this.spawnPigeons(c, true);
      case 'marshal': return this.spawnMarshal(c);
      case 'spectators': return this.spawnSpectators(c);
      case 'infield': return this.spawnInfield(c);
    }
    return false;
  }

  /* ------------------------------------------------------- site selection ---- */
  // a spot beside the road ahead, clear of trees, with ground, on the level and in line of sight
  findVerge(c, o) {
    const half = this.route.road.half;
    let best = null, bestScore = -1e9;
    const tmp = {};
    for (let k = 0; k < 5; k++) {
      const ds = rand(o.ds0, o.ds1), s = c.s + c.dir * ds;
      if (!this.inRange(s)) continue;
      const side = o.side || (chance(0.5) ? 1 : -1), r = side * (half + rand(o.r0, o.r1));
      this.at(s, r, tmp);
      const h = this.terrain.heightAt(tmp.x, tmp.z);
      if (h === null || h === undefined || Math.abs(h - tmp.ry) > (o.dy ?? 3.5)) continue;
      const hx = this.terrain.heightAt(tmp.x + 2.5, tmp.z), hz = this.terrain.heightAt(tmp.x, tmp.z + 2.5);
      if (hx === null || hz === null || Math.abs(hx - h) > 1.2 || Math.abs(hz - h) > 1.2) continue;
      if (!this.map.ready(tmp.x, tmp.z)) continue;
      const cl = this.map.clearance(tmp.x, tmp.z, 14, [0, 1]);
      if (cl < (o.minClear ?? 2.2)) continue;
      if (!this.lineOfSight(c, tmp.x, h + 0.9, tmp.z)) continue;
      // prefer the edge of the trees: some cover close by, but not on top of it
      const score = o.edge ? -Math.abs(cl - 5) : cl;
      if (score > bestScore) { bestScore = score; best = { s, r, side, x: tmp.x, z: tmp.z, y: h, cl }; }
    }
    return best;
  }
  lineOfSight(c, x, y, z) {
    const ey = c.pose.y + 1.2;
    for (let i = 1; i <= 6; i++) {
      const f = i / 7, px = lerp(c.pose.x, x, f), pz = lerp(c.pose.z, z, f);
      const h = this.terrain.heightAt(px, pz);
      if (h !== null && h !== undefined && h > lerp(ey, y, f) - 0.15) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------ scenic ---- */
  spawnDeer(c, role) {
    const half = this.route.road.half;
    const cross = role === 'cross';
    if (cross && c.speed > 26) return false;
    const site = this.findVerge(c, { ds0: 190, ds1: 235, r0: cross ? 2.8 : 3, r1: cross ? 3.6 : 13, edge: !cross, minClear: cross ? 1.6 : 2.2 });
    if (!site) return false;
    if (cross) { // the far verge must be walkable too
      const o = {}; this.at(site.s, -site.side * (half + 6), o);
      const h = this.terrain.heightAt(o.x, o.z);
      if (h === null || Math.abs(h - o.ry) > 3 || this.map.clearance(o.x, o.z, 3, [0, 1]) < 1.4) return false;
    }
    const grp = { alert: false, flee: false, t: 0, role };
    const n = role === 'eyes' ? 1 : role === 'cross' ? (chance(0.3) ? 2 : 1) : 1 + (chance(0.45) ? 1 : 0) + (chance(0.2) ? 1 : 0);
    const buck = chance(0.3);
    for (let i = 0; i < n; i++) {
      const ds = i === 0 ? 0 : rand(1.5, 3.5) * (chance(0.5) ? 1 : -1), dr = i === 0 ? 0 : site.side * rand(0.5, 3.0);
      const d = new Deer(this, { s: site.s + ds * c.dir, r: site.r + dr, grp, buck: i === 0 && buck, fawn: i > 0 && chance(0.3), role, side: site.side });
      this.add(d);
      if (i === 0) {
        if (role === 'cross') this.sight(d, 'deer', 'a mule deer crossing the road ahead', this.sideOf(site.r));
        else if (role === 'eyes') this.sight(d, 'deer', 'a pair of eyes shining at the edge of the trees', this.sideOf(site.r));
        else this.sight(d, 'deer', pick(['a mule deer at the edge of the trees', 'a mule deer grazing by the roadside']), this.sideOf(site.r));
      }
    }
    return true;
  }

  spawnHare(c) {
    const half = this.route.road.half;
    const site = this.findVerge(c, { ds0: 150, ds1: 210, r0: 0.8, r1: 2.2, minClear: 1.0 });
    if (!site) return false;
    const o = {}; this.at(site.s, -site.side * (half + 6), o);
    const h = this.terrain.heightAt(o.x, o.z);
    if (h === null || Math.abs(h - o.ry) > 3) return false;
    const th = this.add(new Hare(this, site));
    this.sight(th, 'jackrabbit', 'a jackrabbit dashing across the road', this.sideOf(site.r));
    return true;
  }

  spawnSoarer(c, kind) {
    const s = c.s + c.dir * rand(100, 170);
    if (!this.inRange(s)) return false;
    const lat = rand(-45, 45), o = {}; this.at(s, lat, o);
    const gy = this.groundAt(o.x, o.z);
    if (gy === null) return false;
    const n = kind === 'raven' && chance(0.4) ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const b = this.birds.add(kind, o.x + rand(-6, 6), gy + 60, o.z + rand(-6, 6), 'soar', { cruise: kind === 'hawk' ? rand(8, 10) : rand(9, 11), flutter: kind === 'raven' ? 0.7 : 0.2, ttl: rand(50, 80), alt: rand(42, 80) });
      if (!b) return false;
      b.cx = o.x + rand(-8, 8); b.cz = o.z + rand(-8, 8); b.R = rand(32, 55); b.theta = rand(0, TAU); b.dir = chance(0.5) ? 1 : -1;
      b.drift = [rand(-1.5, 1.5), rand(-1.5, 1.5)]; b.y = gy + b.alt; b.gy = gy; b.tag = 'soar'; b.x = b.cx + cos(b.theta) * b.R; b.z = b.cz + sin(b.theta) * b.R;
      if (i === 0) b.sight = kind === 'hawk' ? { what: 'hawk', label: 'a red-tailed hawk circling high over the trees', side: 'ahead' } : { what: 'raven', label: pick(['a raven soaring over the forest', 'a pair of ravens riding the air above the trees']), side: 'ahead' };
    }
    return true;
  }

  spawnOwl(c) {
    const half = this.route.road.half, side = chance(0.5) ? 1 : -1;
    const ds = clamp(c.speed * 5.5 + 25, 60, 190);
    const s = c.s + c.dir * ds;
    if (!this.inRange(s)) return false;
    const o = {}; this.at(s, side * (half + 14), o);
    const gy = this.groundAt(o.x, o.z), gr = this.groundAt(o.x - P.tz * 0, o.z);
    if (gy === null) return false;
    const b = this.birds.add('owl', o.x, gy + 5, o.z, 'fly', { cruise: 7.5, ttl: 12, alt: 5 });
    if (!b) return false;
    b.glide = 'always'; b.gliding = true; b.alt = 4.2;
    const dx = P.tz * side, dz = -P.tx * side; // towards the other side: -side * R
    b.yaw = b.heading = Math.atan2(dx, dz) + rand(-0.15, 0.15) + (c.dir > 0 ? 0.0 : 0);
    b.tone = 1.0; b.tag = 'owl';
    b.sight = { what: 'owl', label: 'an owl gliding silently across the road', side: this.sideOf(side * 1) };
    return true;
  }

  spawnSongbirds(c) {
    const half = this.route.road.half, side = chance(0.5) ? 1 : -1;
    const s = c.s + c.dir * rand(110, 170);
    if (!this.inRange(s)) return false;
    const n = 3 + ((Math.random() * 4) | 0), o = {};
    const flock = {};
    this.at(s, side * (half + rand(0.6, 3)), o);
    for (let i = 0; i < n; i++) {
      const x = o.x + rand(-3, 3) - P.tz * rand(-1, 1), z = o.z + rand(-3, 3);
      const g = this.terrain.heightAt(x, z);
      if (g === null || g === undefined) continue;
      const b = this.birds.add('songbird', x, g, z, 'ground', { trigger: 15, flock });
      if (!b) break;
      b.maxH = 6; b.cruise = 8; b.flock = flock; b.tag = 'song'; b.alt = 5; b.ttl = 40;
      b.wanderYaw = Math.atan2(-P.tz * side * -1, P.tx * -side);
    }
    return true;
  }

  /* -------------------------------------------------------------- city ---- */
  footR(c, o = {}) { // a lateral offset on a footpath
    const r = this.route.road;
    const a = r.edge + 1.3, b = r.half - 1.3;
    return (o.side || (chance(0.5) ? 1 : -1)) * rand(a, Math.max(a + 0.1, b));
  }

  spawnPed(c, o) {
    const ds = rand(205, 255), s = c.s + c.dir * ds;
    if (!this.inRange(s)) return false;
    for (const t of this.things) if (t.type === 'ped' && Math.abs(this.rel(t.s) - ds) < 25) return false;
    const r = this.footR(c), t = {};
    this.at(s, r, t);
    if (this.map.clearance(t.x, t.z, 2, [0, 1, 2, 3]) < 0.5) return false;
    const v = (chance(0.5) ? 1 : -1) * rand(1.05, 1.55);
    const ped = new Ped(this, { s, r, v, look: this.look(), dog: o.dog, notable: o.notable });
    this.add(ped);
    if (o.dog) {
      this.add(ped.dogThing);
      this.sight(ped, 'dog walker', `${ped.look.f ? 'a woman' : 'a man'} walking a dog along the ${this.data.id === 'london' ? 'pavement' : 'sidewalk'}`, this.sideOf(r));
      ped.seenNeed = 1.2;
    }
    return true;
  }

  spawnBench(c) {
    const rd = this.route.road, benches = this.map.benches;
    if (!benches.length) return false;
    const cand = [];
    for (const b of benches) {
      const dx = b.x - this.px, dz = b.z - this.pz;
      if (dx * dx + dz * dz > 270 * 270) continue;
      const n = this.route.nearest(b.x, b.z, 30);
      if (n < 0) continue;
      const sNear = this.route.nearestS ? this.route.nearestS(b.x, b.z) : null;
      // distance along travel: project on the player's heading
      const ahead = dx * this.camDirFlat().x + dz * this.camDirFlat().z;
      if (ahead < 140 || ahead > 260 || n < rd.edge || n > rd.half) continue;
      if (!this.onTravelSide(b.x, b.z, c)) continue;
      if (this.things.some((t) => t.bench === b)) continue;
      cand.push(b);
    }
    if (!cand.length) return false;
    const b = pick(cand);
    const th = this.add(new Ped(this, { bench: b, look: this.look(), notable: true }));
    this.sight(th, 'person', `${th.look.f ? 'a woman' : 'a man'} sitting on a bench by the road`, 'ahead');
    return true;
  }
  camDirFlat() { const l = Math.hypot(this.camDir.x, this.camDir.z) || 1; this._cdf = this._cdf || {}; this._cdf.x = this.camDir.x / l; this._cdf.z = this.camDir.z / l; return this._cdf; }
  onTravelSide() { return true; }

  spawnPigeons(c, notable) {
    const s = c.s + c.dir * rand(165, 220);
    if (!this.inRange(s)) return false;
    const r = this.footR(c), o = {}; this.at(s, r, o);
    if (this.map.clearance(o.x, o.z, 3, [0, 1, 2, 3]) < 0.8) return false;
    const gy = o.ry + 0.06, n = 5 + ((Math.random() * 5) | 0), flock = {};
    const R = rand(11, 18);
    const mark = { type: 'flockMark', obj: new THREE.Object3D(), s, update: () => this.rel(s) > -70 || this.birds.list.some((b) => b.tag === 'pig' && b.state === 'ground') ? true : false };
    mark.update = () => { const ok = this.rel(s) > -90; if (!ok) this.birds.clear('pig'); return ok; };
    this.add(mark);
    for (let i = 0; i < n; i++) {
      const la = rand(-0.6, 0.6), al = rand(-2.5, 2.5);
      const x = o.x + la * -P.tz + al * P.tx, z = o.z + la * P.tx + al * P.tz;
      const b = this.birds.add('pigeon', x, gy, z, 'ground', { trigger: 14, flock });
      if (!b) break;
      b.gy = gy; b.cx = o.x; b.cz = o.z; b.wheel = R; b.maxH = rand(8, 12); b.cruise = rand(6.5, 8); b.tag = 'pig'; b.flutter = 2; b.ttl = 120; b.flock = flock;
      b.gT = 1e9; // footpath height is known, no lookups
      if (i === 0 && notable) b.sight = { what: 'pigeons', label: `pigeons scattering from the ${this.data.id === 'london' ? 'pavement' : 'sidewalk'}`, side: this.sideOf(r) };
    }
    return true;
  }

  /* ----------------------------------------------------------- circuit ---- */
  findCorner(c) {
    const step = 12;
    let best = null;
    for (let ds = 150; ds < 270; ds += step) {
      const s = c.s + c.dir * ds;
      if (!this.inRange(s)) continue;
      const a = {}, b = {};
      this.at(s - 20, 0, a); this.at(s + 30, 0, b);
      const cr = a.tx * b.tz - a.tz * b.tx, dt = a.tx * b.tx + a.tz * b.tz, ang = Math.atan2(cr, dt); // + : turns toward +R? (cross>0 => rotates clockwise seen from above)
      const sc = Math.abs(ang);
      if (!best || sc > best.sc) best = { s, ang, sc };
    }
    return best;
  }

  spawnMarshal(c) {
    const half = this.route.road.half, corner = this.findCorner(c);
    if (!corner) return false;
    // cross > 0 means the path swings towards -R (see at(): R = (-tz, tx)); the outside of the bend is the +R side
    const side = corner.sc > 0.12 ? (corner.ang > 0 ? -1 : 1) : (chance(0.5) ? 1 : -1);
    const r = side * (half + 1.7);
    const o = {}; this.at(corner.s, r, o);
    const h = this.terrain.heightAt(o.x, o.z);
    if (h === null || h === undefined) return false;
    const th = this.add(new Static(this, { s: corner.s, r, role: 'marshal', look: MARSHAL_LOOK }));
    this.sight(th, 'marshal', 'a marshal in orange at the corner, giving a wave', this.sideOf(r));
    th.seenNeed = 1.6;
    if (chance(0.45)) this.add(new Static(this, { s: corner.s + c.dir * rand(8, 14), r: side * (half + 2.2), role: 'photographer', look: this.look() }));
    return true;
  }

  spawnSpectators(c) {
    const half = this.route.road.half, ds = rand(170, 230), s = c.s + c.dir * ds;
    if (!this.inRange(s)) return false;
    const side = chance(0.5) ? 1 : -1, o = {};
    this.at(s, side * (half + 3.2), o);
    if (this.terrain.heightAt(o.x, o.z) == null) return false;
    const n = 2 + (chance(0.5) ? 1 : 0), ths = [];
    for (let i = 0; i < n; i++) ths.push(this.add(new Static(this, { s: s + c.dir * (i * 1.3 - 1.3 + rand(-0.3, 0.3)), r: side * (half + 3.3 + rand(0, 0.6)), role: 'spectator', look: this.look() })));
    this.addFence(s, side * (half + 2.4), n);
    this.sight(ths[0], 'spectators', 'a few spectators at the fence', this.sideOf(side));
    if (chance(0.5)) this.add(new Static(this, { s: s + c.dir * 6, r: side * (half + 2.9), role: 'photographer', look: this.look() }));
    return true;
  }

  addFence(s, r, n) {
    const c = this.c, segs = 3;
    const th = { type: 'fence', obj: new THREE.Group(), s, update: () => this.rel(s) > -70 || false, dispose() { for (const m of this.obj.children) { m.geometry.dispose(); } } };
    if (!this.fenceGeo) {
      const parts = [];
      const post = new THREE.BoxGeometry(0.06, 1.15, 0.06), rail = new THREE.BoxGeometry(0.05, 0.05, 4.0), mesh = new THREE.BoxGeometry(0.02, 0.9, 4.0);
      this.fenceMat = new THREE.MeshStandardMaterial({ color: 0x8e9498, roughness: 0.55, metalness: 0.7 });
      farFade(this.fenceMat, 230, 300);
      this.fenceBuild = () => {
        const g = [];
        const add = (geo, x, y, z) => { const q = geo.clone(); q.translate(x, y, z); g.push(q); };
        for (const z of [-2, 2]) add(post, 0, 0.575, z);
        add(rail, 0, 1.12, 0); add(rail, 0, 0.12, 0);
        add(mesh, 0, 0.62, 0);
        return g;
      };
      this.fenceGeo = true;
    }
    const geos = this.fenceBuild();
    const merged = geos.map((g) => g); // small: one mesh per panel, shares the material (three panels at most)
    for (let i = 0; i < segs; i++) {
      const sOff = s + this.c.dir * (i - 1) * 4.0, o = {}; this.at(sOff, r, o);
      const m = new THREE.Mesh(mergeSimple(geos), this.fenceMat);
      m.position.set(o.x, o.ry + 0.0, o.z); m.rotation.y = Math.atan2(o.tx, o.tz);
      const h = this.terrain.heightAt(o.x, o.z); if (h != null) m.position.y = h;
      th.obj.add(m);
    }
    this.add(th);
  }

  spawnInfield(c) {
    const s = c.s + c.dir * rand(110, 160);
    if (!this.inRange(s)) return false;
    const lat = (chance(0.5) ? 1 : -1) * rand(45, 80), o = {}; this.at(s, lat, o);
    const gy = this.groundAt(o.x, o.z);
    if (gy === null) return false;
    const kind = pick(['gull', 'gull', 'swift']), n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const b = this.birds.add(kind, o.x, gy + 25, o.z, 'soar', { cruise: kind === 'swift' ? rand(11, 14) : rand(8, 10), flutter: 0.9, ttl: rand(40, 70), alt: rand(14, 34) });
      if (!b) break;
      b.cx = o.x + rand(-10, 10); b.cz = o.z + rand(-10, 10); b.R = rand(25, 60); b.theta = rand(0, TAU); b.dir = i % 2 ? 1 : -1; b.drift = [rand(-1, 1), rand(-1, 1)];
      b.y = gy + b.alt; b.gy = gy; b.tag = 'infield';
    }
    return true;
  }
}

function deerG() { deerGeometry(false); deerGeometry(true); }
function mergeSimple(geos) {
  // tiny merge of non-indexed copies (box geometries are indexed: expand)
  const pos = [], nor = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...ng.attributes.position.array); nor.push(...ng.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

/* ============================================================================================ */
/* creatures                                                                                    */
/* ============================================================================================ */
const _o = {};
function setYawFromHd(L, th, hd) { // world yaw for heading hd relative to the road (0 = +s)
  const dx = cos(hd) * _o.tx - sin(hd) * _o.tz, dz = cos(hd) * _o.tz + sin(hd) * _o.tx;
  return Math.atan2(dx, dz);
}

class Deer {
  constructor(L, o) {
    this.L = L; this.type = 'deer'; this.role = o.role; this.grp = o.grp; this.side = o.side;
    this.key = o.buck ? 'buck' : 'doe'; this.mk = () => makeDeer(L.mat, o.buck); this.rig = L.getRig(this.key, this.mk);
    this.obj = this.rig.mesh;
    this.sc = o.fawn ? 0.62 : o.buck ? 1.06 : rand(0.94, 1.0);
    this.obj.scale.setScalar(this.sc);
    this.s = o.s; this.r = o.r;
    this.half = L.route.road.half; this.edge = L.route.road.edge;
    this.hd = o.role === 'cross' || true ? (this.r > 0 ? -Math.PI / 2 : Math.PI / 2) + rand(-0.6, 0.6) : 0; // facing the road
    this.hdT = this.hd; this.v = 0; this.vT = 0;
    this.state = o.role === 'cross' ? 'wait' : o.role === 'eyes' ? 'look' : 'graze';
    this.stT = o.role === 'cross' ? 0 : rand(2, 5);
    this.p = { walk: 0, ph: rand(0, TAU), stot: 0, sp: 0, graze: this.state === 'graze' ? 1 : 0, alert: this.state === 'look' ? 1 : 0, t: rand(0, 50), flick: 0, lookY: 0 };
    this.y = 0; this.yInit = false;
    this.lookTimer = rand(4, 9); this.up = 0; this.stepT = rand(2, 5);
    this.fleeLeft = 0; this.fled = false;
    this.fleeing = false;
    this.start = this.r;
    this.dead = false;
  }
  dispose() { this.L.release(this.key, this.rig); }

  update(dt, c) {
    const L = this.L, p = this.p, g = this.grp;
    p.t += dt;
    const ds = L.rel(this.s);
    L.at(this.s, this.r, _o);
    const x0 = _o.x, z0 = _o.z;
    const dx = c.pose.x - x0, dz = c.pose.z - z0, dist = Math.hypot(dx, dz);
    // direction to the player relative to the road heading
    const toP = Math.atan2(dx, dz);
    // --- state machine
    this.stT -= dt;
    const aheadDist = ds, onRoad = Math.abs(this.r) < this.edge + 0.8;
    switch (this.state) {
      case 'graze': {
        this.vT = 0; p.alert = lerp(p.alert, 0, dt * 3);
        // lift the head now and then; take a few slow steps
        this.lookTimer -= dt;
        const lifting = this.lookTimer < 0 && this.lookTimer > -rand(1.2, 2.4);
        if (this.lookTimer <= -2.4) this.lookTimer = rand(4, 9);
        this.up = lerp(this.up, lifting ? 1 : 0, dt * 4);
        if (lifting && chance(dt * 2)) p.flick = 1;
        this.stepT -= dt;
        if (this.stepT < 0 && !lifting) { this.vT = 0.55; if (this.stepT < -rand(1.5, 3.5)) { this.stepT = rand(4, 8); this.hdT += rand(-0.6, 0.6); } }
        p.graze = lerp(p.graze, 1 - this.up, dt * 3);
        if (dist < 85 && this.role !== 'cross') { this.enter('look'); g.alert = true; }
        if (g.alert && this.state === 'graze' && chance(dt * 1.5)) this.enter('look');
        if (g.flee) this.enter('flee');
        break;
      }
      case 'look': {
        this.vT = 0; p.graze = lerp(p.graze, 0, dt * 4); p.alert = lerp(p.alert, 1, dt * 5);
        // turn the head (and then the body) towards the car
        const rel = wrapPI(toP - setYawFromHd(L, this, this.hd));
        p.lookY = lerp(p.lookY, clamp(rel, -0.9, 0.9), dt * 3);
        if (Math.abs(rel) > 0.9) { this.hd -= clamp(rel, -1, 1) * dt * 1.2; this.hdT = this.hd; }
        const approaching = ds > -4;
        const spooked = dist < (this.role === 'eyes' ? 38 : 36 + c.speed * 0.5) && c.speed > 2 && approaching;
        if (spooked && !this.fled && this.role !== 'eyes' && (g.fleeDecision ??= chance(0.6))) { g.flee = true; }
        if (spooked && this.role === 'eyes' && !this.fled) { this.fled = true; this.enter('leave'); }
        if (g.flee) this.enter('flee');
        if (ds < -12 && this.stT < 0) this.enter('graze');
        if (dist > 90 && this.stT < 0 && this.role !== 'eyes') this.enter('graze');
        break;
      }
      case 'leave': // walk calmly away from the road
        this.hdT = this.r > 0 ? 0.4 : -0.4; this.hdT = (this.r > 0 ? 1 : -1) * (Math.PI / 2 - 0.3);
        this.vT = 1.1; p.alert = lerp(p.alert, 0.5, dt * 2); p.graze = lerp(p.graze, 0, dt * 3);
        if (Math.abs(this.r) > this.half + 14 && this.stT < 0) this.enter('look');
        break;
      case 'flee': {
        this.fleeing = true;
        this.hdT = (this.r > 0 ? 1 : -1) * (Math.PI / 2) + (this.fleeBias ??= rand(-0.5, 0.5)) + (c.dir > 0 ? 0 : 0);
        this.vT = 7.2; p.stot = lerp(p.stot, 1, dt * 8); p.graze = lerp(p.graze, 0, dt * 6); p.alert = lerp(p.alert, 0.6, dt * 3);
        if (Math.abs(this.r) > this.half + (this.fleeMax ??= rand(20, 34))) { this.state = 'look'; this.stT = rand(3, 5); this.fled = true; g.flee = false; g.fleeDecision = false; this.fleeing = false; this.vT = 0; this.fleeBias = undefined; }
        break;
      }
      case 'wait': { // a crossing candidate: stand at the edge of the road, watching
        this.vT = 0; p.graze = lerp(p.graze, 0, dt * 4); p.alert = lerp(p.alert, 1, dt * 4);
        const tc = ((this.half + 3) * 2) / 4.4, need = c.speed * (tc + 4) + 30;
        const hdRoad = this.r > 0 ? -Math.PI / 2 : Math.PI / 2;
        this.hdT = hdRoad; this.hd = lerp(this.hd, this.hdT, dt * 2);
        if (ds < 0 || ds < need - 40) { this.role = 'stand'; this.enter('look'); break; } // too late: just watch the car go by
        if (ds <= need + 10 && ds < 215 && this.stT < 0) { this.enter('cross'); }
        break;
      }
      case 'cross': {
        const dirTo = this.start > 0 ? -1 : 1;
        this.hdT = dirTo * Math.PI / 2; this.hd = this.hdT;
        const far = this.start > 0 ? this.r < -(this.half + 5) : this.r > this.half + 5;
        // make sure the road is clear in time: hurry if the car is getting close
        const clear = Math.abs(this.r) > this.edge + 1.2;
        this.vT = ds > 0 && ds < 110 && !clear ? 8 : 4.4;
        p.stot = lerp(p.stot, this.vT > 6 ? 1 : 0, dt * 5);
        p.graze = lerp(p.graze, 0, dt * 6);
        p.alert = lerp(p.alert, 0.3, dt * 3);
        // abort if the player is much closer than planned and the deer has not reached the road yet
        if (!onRoad && ds > 0 && ds < c.speed * 1.5 + 30 && Math.abs(this.r - this.start) < 3) { this.state = 'look'; this.role = 'stand'; this.stT = 5; this.vT = 0; }
        if (far) { this.state = 'leave'; this.stT = 2; this.role = 'stand'; this.start = this.r; }
        break;
      }
    }
    // body heading and speed
    this.hd += clamp(wrapPI(this.hdT - this.hd), -3 * dt, 3 * dt);
    const slew = this.state === 'flee' || this.state === 'cross' ? 14 : 3;
    this.v += clamp(this.vT - this.v, -slew * dt, slew * dt);
    // trees in the way: swing round them
    if (this.v > 0.2) {
      const ah = 1.8 + this.v * 0.25;
      const yw = setYawFromHd(L, this, this.hd);
      const cl = L.map.clearance(x0 + sin(yw) * ah, z0 + cos(yw) * ah, 3, [0, 1]);
      if (cl < 0.5 && this.state !== 'cross') {
        const cl2 = L.map.clearance(x0 + sin(yw + 0.7) * ah, z0 + cos(yw + 0.7) * ah, 3, [0, 1]);
        this.hdT = this.hd + (cl2 > cl ? 0.5 : -0.5) * 1;
        this.v = Math.min(this.v, 0.8);
      }
    }
    // gait
    const gait = this.state === 'flee' || (this.state === 'cross' && p.stot > 0.5);
    if (gait) {
      p.sp += dt * (this.v / 6.5); if (p.sp >= 1) p.sp -= 1;
      p.walk = lerp(p.walk, 0.4, dt * 8);
    } else {
      p.stot = lerp(p.stot, 0, dt * 6);
      const w = clamp(this.v / 2.2, 0, 1.4);
      p.walk = lerp(p.walk, w, dt * 5);
      p.ph += dt * Math.PI * 2 * (this.v / (this.v > 2 ? 2.0 : 1.25)) ;
    }
    p.flick = Math.max(0, p.flick - dt * 1.5);
    // integrate (in road coordinates)
    this.s += c.dir * 0 + (cos(this.hd) * this.v * dt) * 1; // s increases with +s direction
    this.r += sin(this.hd) * this.v * dt;
    // place
    L.at(this.s, this.r, _o);
    let y = L.terrain.heightAt(_o.x, _o.z);
    if (y === null || y === undefined) y = this.yInit ? this.y : _o.ry;
    this.y = this.yInit ? lerp(this.y, y, Math.min(1, dt * 10)) : y; this.yInit = true;
    this.obj.position.set(_o.x, this.y, _o.z);
    const yaw = setYawFromHd(L, this, this.hd);
    this.obj.rotation.y = yaw;
    poseDeer(this.rig, p);
    // eyeshine at night: head up, facing us, near the line of the headlights
    this.eye = null;
    if (c.night > 0.4) {
      const hx = _o.x + sin(yaw) * 0.95 * this.sc, hz = _o.z + cos(yaw) * 0.95 * this.sc, hy = this.y + (1.1 + 0.3 * (1 - p.graze)) * this.sc;
      const tx = c.pose.x - hx, tz = c.pose.z - hz, td = Math.hypot(tx, tz) || 1;
      const face = clamp((sin(yaw) * tx + cos(yaw) * tz) / td, 0, 1);
      const axis = clamp((L.camDir.x * -tx + L.camDir.z * -tz) / td, 0, 1); // how much the eye lies on the view axis
      const I = smooth(0.4, 0.7, c.night) * smooth(0.25, 0.7, face) * smooth(0.55, 0.9, axis) * (1 - p.graze) * smooth(110, 70, td) * (((p.t % 6) < 0.18) ? 0 : 1);
      if (I > 0.01) this.eye = [hx, hy, hz, cos(yaw) * 0.06 * this.sc, -sin(yaw) * 0.06 * this.sc, I];
    }
    // gone?
    return ds > -70 && ds < 420;
  }
  enter(s) { if (this.state === s) return; this.state = s; this.stT = rand(1.2, 3); if (s === 'look') this.stT = rand(2.5, 4.5); }
}

class Hare {
  constructor(L, site) {
    this.L = L; this.type = 'hare';
    this.key = 'hare'; this.mk = () => makeHare(L.mat); this.rig = L.getRig('hare', this.mk); this.obj = this.rig.mesh; this.obj.scale.setScalar(1.05);
    this.s = site.s; this.r = site.r; this.start = site.r; this.half = L.route.road.half; this.edge = L.route.road.edge;
    this.hd = this.r > 0 ? -Math.PI / 2 : Math.PI / 2; this.state = 'sit'; this.v = 0; this.sp = 0; this.run = 0; this.t = rand(0, 20);
    this.sit = 1; this.drift = rand(-0.35, 0.35); this.y = site.y; this.stT = rand(1, 3);
    this.p = { run: 0, sp: 0, sit: 1, t: 0 };
  }
  dispose() { this.L.release('hare', this.rig); }
  update(dt, c) {
    const L = this.L, p = this.p;
    p.t += dt;
    const ds = L.rel(this.s);
    const need = c.speed * 4.0 + 45;
    if (this.state === 'sit') {
      if (ds < 0) { this.state = 'run'; this.hdT = this.start > 0 ? -Math.PI / 2 : Math.PI / 2; this.hdT += (this.start > 0 ? 1 : -1) * 0.6; }
      else if (ds < need && ds < 150) { this.state = 'run'; this.dashT = 0; }
    }
    if (this.state === 'run') {
      this.dashT = (this.dashT || 0) + dt;
      const dirTo = this.start > 0 ? -1 : 1;
      this.hd = dirTo * (Math.PI / 2 - this.drift * dirTo * 0.6);
      this.v = Math.min(12, this.v + 40 * dt);
      p.run = lerp(p.run, 1, dt * 10); p.sit = lerp(p.sit, 0, dt * 8);
      p.sp += dt * (this.v / 2.4); if (p.sp >= 1) p.sp -= 1;
      // slow right down again once well across
      if (Math.abs(this.r) > this.half + 14 && Math.sign(this.r) !== Math.sign(this.start)) { this.state = 'stop'; }
    } else if (this.state === 'stop') {
      this.v = Math.max(0, this.v - 14 * dt); p.run = lerp(p.run, 0, dt * 5); p.sit = lerp(p.sit, 1, dt * 3);
      if (this.v <= 0.2) p.sp = 0;
      else { p.sp += dt * this.v / 2.4; if (p.sp >= 1) p.sp -= 1; }
    } else { p.sit = 1; p.run = lerp(p.run, 0, dt * 5); }
    this.s += cos(this.hd) * this.v * dt; this.r += sin(this.hd) * this.v * dt;
    L.at(this.s, this.r, _o);
    let y = L.terrain.heightAt(_o.x, _o.z);
    if (y == null) y = this.y;
    this.y = y;
    this.obj.position.set(_o.x, y, _o.z);
    this.obj.rotation.y = setYawFromHd(L, this, this.hd);
    poseHare(this.rig, p);
    return ds > -70 && ds < 420;
  }
}

/* ---- people ---------------------------------------------------------------------------- */
class Ped {
  constructor(L, o) {
    this.L = L; this.type = 'ped'; this.look = o.look;
    this.key = 'ped' + JSON.stringify(o.look); this.mk = () => makePed(L.mat, o.look); this.rig = L.getRig(this.key, this.mk, o.look); this.obj = this.rig.mesh;
    this.base = this.obj.userData.scaleBase; this.obj.scale.setScalar(this.base);
    this.bench = o.bench || null;
    this.p = { ph: rand(0, TAU), amp: 0, t: rand(0, 30), arms: 0, sit: 0, lookY: 0, umb: 0 };
    this.mode = 'walk'; this.pauseT = rand(6, 14); this.lat = 0;
    const rain = L.c ? Math.max(L.c.weather.rain, L.c.weather.snow * 0.8) : 0;
    this.umb = rain > 0.15 && chance(0.75);
    this.p.umb = this.umb ? 1 : 0;
    this.dog = null;
    if (this.bench) {
      this.mode = 'sit'; this.p.sit = 1; this.p.amp = 0; this.p.arms = chance(0.5) ? 5 : 4;
      const b = this.bench; this.fixed = { x: b.x - sin(b.yaw) * 0.08, z: b.z - cos(b.yaw) * 0.08, y: b.y, yaw: b.yaw };
      this.s = L.route.nearest ? 0 : 0;
      this.s = L.c.s + L.c.dir * ((b.x - L.px) * L.camDirFlat().x + (b.z - L.pz) * L.camDirFlat().z);
      this.fixedPos = true;
      this.obj.position.set(this.fixed.x, this.fixed.y, this.fixed.z);
      this.obj.rotation.y = b.yaw;
      this.relS = null;
    } else {
      this.s = o.s; this.r = o.r; this.v = o.v; this.dirSign = Math.sign(o.v);
      this.p.arms = 0; this.p.amp = 1;
      if (o.dog) {
        this.p.arms = 7;
        const dc = pick(DOGS); this.dogKey = 'dog' + dc[0] + dc[1]; this.dog = dc;
        this.dogThing = new DogThing(L, this);
      }
    }
    this.fadeIn = 0;
  }
  dispose() { this.L.release(this.key, this.rig); }
  update(dt, c) {
    const L = this.L, p = this.p;
    p.t += dt;
    if (this.fixedPos) {
      // seated: watches the world go by, keeps the head turned to the car
      const tx = c.pose.x - this.fixed.x, tz = c.pose.z - this.fixed.z;
      const rel = wrapPI(Math.atan2(tx, tz) - this.fixed.yaw);
      p.lookY = lerp(p.lookY, Math.abs(rel) < 1.6 ? clamp(rel, -0.8, 0.8) : 0, dt * 2);
      posePed(this.rig, p);
      const dd = (this.fixed.x - c.pose.x) * L.camDirFlat().x + (this.fixed.z - c.pose.z) * L.camDirFlat().z;
      return dd > -70 && dd < 400;
    }
    const ds = L.rel(this.s);
    if (this.mode === 'pause') {
      p.amp = lerp(p.amp, 0, dt * 4); this.pauseT -= dt;
      p.arms = 4; if (this.pauseT < 0) { this.mode = 'walk'; this.pauseT = rand(8, 18); p.arms = this.dog ? 7 : 0; }
    } else {
      p.amp = lerp(p.amp, 1, dt * 3);
      this.pauseT -= dt;
      if (this.pauseT < 0 && !this.dog && ds > 60 && chance(0.5)) { this.mode = 'pause'; this.pauseT = rand(6, 11); }
      else if (this.pauseT < 0) this.pauseT = rand(6, 12);
    }
    const sp = this.mode === 'pause' ? 0 : this.v * p.amp;
    this.s += sp * dt;
    p.ph += dt * Math.abs(sp) * 4.4;
    // keep clear of lamps, bins, bollards and trunks on the footpath
    L.at(this.s, this.r, _o);
    const fx = this.dirSign * _o.tx * 0.9, fz = this.dirSign * _o.tz * 0.9;
    this.ck = (this.ck || 0) - dt;
    let cl = 1;
    if (this.ck <= 0) { this.ck = 0.15; cl = L.map.clearance(_o.x + fx, _o.z + fz, 1.6, [0, 1, 2, 3]); }
    if (cl < 0.32) {
      const rd = L.route.road, side = Math.sign(this.r);
      const inward = -side * 0.7, outward = side * 0.7;
      const a = L.at(this.s, this.r + inward, {}), b = L.at(this.s, this.r + outward, {});
      const ca = L.map.clearance(a.x + fx, a.z + fz, 1.6, [0, 1, 2, 3]), cb = L.map.clearance(b.x + fx, b.z + fz, 1.6, [0, 1, 2, 3]);
      this.rT = ca > cb ? this.r + inward : this.r + outward;
    }
    if (this.rT !== undefined) {
      const rd = L.route.road, lo = rd.edge + 1.1, hi = rd.half - 1.1, side = Math.sign(this.r);
      const t = side * clamp(Math.abs(this.rT), lo, hi);
      this.r += clamp(t - this.r, -0.9 * dt, 0.9 * dt);
      if (Math.abs(t - this.r) < 0.02) this.rT = undefined;
    }
    L.at(this.s, this.r, _o);
    this.obj.position.set(_o.x, _o.ry + 0.065, _o.z);
    const hdw = this.dirSign > 0 ? 0 : Math.PI;
    let yaw = setYawFromHd(L, this, hdw);
    // watch the car as it passes
    const tx = c.pose.x - _o.x, tz = c.pose.z - _o.z, rel = wrapPI(Math.atan2(tx, tz) - yaw);
    const near = Math.hypot(tx, tz) < 25;
    p.lookY = lerp(p.lookY, near && Math.abs(rel) < 2.2 ? clamp(rel, -1.0, 1.0) : 0, dt * 2);
    if (this.mode === 'pause') yaw += clamp(rel, -0.7, 0.7) * 0.5;
    this.obj.rotation.y = yaw;
    posePed(this.rig, p);
    return ds > -60 && ds < 420;
  }
}
class DogThing {
  constructor(L, owner) {
    this.L = L; this.type = 'dog'; this.owner = owner; this.key = owner.dogKey; this.mk = () => makeDog(L.mat, owner.dog[0], owner.dog[1]); this.rig = L.getRig(this.key, this.mk); this.obj = this.rig.mesh;
    this.p = { ph: rand(0, TAU), amp: 1, t: rand(0, 20), sniff: 0 };
    this.sniffT = rand(3, 7);
  }
  dispose() { this.L.release(this.owner.dogKey, this.rig); }
  update(dt, c) {
    const o = this.owner, p = this.p; p.t += dt;
    if (!this.L.things.includes(o)) return false;
    const op = o.obj.position, yaw = o.obj.rotation.y, a = o.p.amp;
    p.amp = a; p.ph += dt * Math.abs(o.v) * 4.4 * 1.5 * a;
    this.sniffT -= dt; if (this.sniffT < 0) { p.sniff = 1; if (this.sniffT < -1.5) { this.sniffT = rand(4, 9); p.sniff = 0; } }
    // the dog trots ahead of and a little to the side of its owner (the owner's right)
    const fx = sin(yaw), fz = cos(yaw), rx = -fz, rz = fx;
    this.obj.position.set(op.x + fx * 0.85 - rx * 0.62, op.y, op.z + fz * 0.85 - rz * 0.62);
    this.obj.rotation.y = yaw + 0.05 * sin(p.t * 0.8);
    this.obj.scale.setScalar(o.base);
    poseDog(this.rig, p);
    return true;
  }
}

class Static {
  constructor(L, o) {
    this.L = L; this.type = 'static'; this.role = o.role; this.look = o.look;
    this.key = 'ped' + JSON.stringify(o.look); this.mk = () => makePed(L.mat, o.look); this.rig = L.getRig(this.key, this.mk, o.look); this.obj = this.rig.mesh; this.obj.scale.setScalar(this.rig.mesh.userData.scaleBase);
    this.s = o.s; this.r = o.r;
    this.p = { ph: 0, amp: 0, t: rand(0, 40), arms: 1, sit: 0, lookY: 0, umb: 0 };
    this.yawBase = 0; this.bodyYaw = null;
    L.at(this.s, this.r, _o);
    const h = L.terrain.heightAt(_o.x, _o.z);
    this.y = h == null ? _o.ry : h;
    this.yawToRoad = Math.atan2(-Math.sign(this.r) * -_o.tz * -1, 0); // set below
    const R = { x: -_o.tz, z: _o.tx }, sgn = -Math.sign(this.r);
    this.yawToRoad = Math.atan2(R.x * sgn, R.z * sgn);
    this.obj.position.set(_o.x, this.y, _o.z);
    this.yaw = this.yawToRoad;
    this.obj.rotation.y = this.yaw;
    this.clap = 0;
    this.rain = L.c && (L.c.weather.rain > 0.2);
    this.sightRange = 160;
  }
  dispose() { this.L.release(this.key, this.rig); }
  update(dt, c) {
    const L = this.L, p = this.p; p.t += dt;
    const ds = L.rel(this.s);
    const x = this.obj.position.x, z = this.obj.position.z;
    const tx = c.pose.x - x, tz = c.pose.z - z, dist = Math.hypot(tx, tz);
    const toP = Math.atan2(tx, tz), rel = wrapPI(toP - this.yawToRoad);
    const watching = ds > -25 && dist < 110;
    // body follows the car within limits, head the rest of the way
    const bodyT = watching ? clamp(rel, -1.0, 1.0) * 0.8 : 0;
    this.yaw = this.yawToRoad + lerp(this.yaw - this.yawToRoad, bodyT, Math.min(1, dt * 1.6));
    p.lookY = lerp(p.lookY, watching ? clamp(rel - bodyT, -0.9, 0.9) : 0, Math.min(1, dt * 3));
    if (this.role === 'marshal') {
      p.arms = ds > -14 && dist < 85 ? 2 : 1;
    } else if (this.role === 'spectator') {
      p.arms = ds > -20 && dist < 55 ? 6 : (L.things.indexOf(this) % 2 ? 4 : 1);
    } else p.arms = ds > -15 && dist < 90 ? 3 : 1;
    posePed(this.rig, p);
    this.obj.rotation.y = this.yaw;
    return ds > -70 && ds < 420;
  }
}
