import * as THREE from 'three';
import { clamp } from './geo.js';
import { createRoadTextures } from './ground.js';

const CELL = 64;
const key = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

export class Route {
  constructor(data) {
    this.data = data;
    this.pts = Float32Array.from(data.pts);
    this.n = this.pts.length / 3;
    this.step = data.step;
    this.loop = !!data.loop; // closed circuit: the last point joins the first
    this.length = (this.loop ? this.n : this.n - 1) * this.step;
    this.stops = data.stops;
    this.road = { half: 5, style: 'highway', lane: 1.75, ...(data.road || {}) };
    this.road.edge = this.road.half - (this.road.style === 'city' ? 3.6 : 1.65); // carriageway edge
    this.leftHand = !!data.leftHand;
    // Cities: elevation data there is full of building-sized bumps, so the ground for a few hundred
    // metres around the route is levelled to street height ("city floor"); see cityGround().
    this.paved = data.scenery?.ground === 'paved';
    this.field = new Map();
    this.grid = new Map();
    for (let i = 0; i < this.n; i++) {
      const k = key(Math.floor(this.pts[i * 3] / CELL), Math.floor(this.pts[i * 3 + 2] / CELL));
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(i);
    }
  }

  // position / tangent / slope at distance s along the route.
  // Catmull-Rom through the route points: position AND direction change continuously, so the ride
  // never jolts when it passes a point (a straight-line path turns in small steps every few metres).
  sample(s, out = {}) {
    const p = this.pts, n = this.n;
    let i, t, a, b, c, d;
    if (this.loop) {
      const f = (((s / this.step) % n) + n) % n;
      i = Math.floor(f); t = f - i;
      a = ((i - 1 + n) % n) * 3; b = i * 3; c = ((i + 1) % n) * 3; d = ((i + 2) % n) * 3;
    } else {
      const f = clamp(s / this.step, 0, n - 1.0001);
      i = Math.floor(f); t = f - i;
      a = Math.max(0, i - 1) * 3; b = i * 3; c = Math.min(n - 1, i + 1) * 3; d = Math.min(n - 1, i + 2) * 3;
    }
    const t2 = t * t, t3 = t2 * t;
    const w0 = -0.5 * t3 + t2 - 0.5 * t, w1 = 1.5 * t3 - 2.5 * t2 + 1, w2 = -1.5 * t3 + 2 * t2 + 0.5 * t, w3 = 0.5 * t3 - 0.5 * t2;
    const d0 = -1.5 * t2 + 2 * t - 0.5, d1 = 4.5 * t2 - 5 * t, d2 = -4.5 * t2 + 4 * t + 0.5, d3 = 1.5 * t2 - t;
    out.x = p[a] * w0 + p[b] * w1 + p[c] * w2 + p[d] * w3;
    out.y = p[a + 1] * w0 + p[b + 1] * w1 + p[c + 1] * w2 + p[d + 1] * w3;
    out.z = p[a + 2] * w0 + p[b + 2] * w1 + p[c + 2] * w2 + p[d + 2] * w3;
    const tx = p[a] * d0 + p[b] * d1 + p[c] * d2 + p[d] * d3;
    const ty = p[a + 1] * d0 + p[b + 1] * d1 + p[c + 1] * d2 + p[d + 1] * d3;
    const tz = p[a + 2] * d0 + p[b + 2] * d1 + p[c + 2] * d2 + p[d + 2] * d3;
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l;
    out.tz = tz / l;
    out.slope = ty / l;
    return out;
  }

  // does the road pass through (or near) this rectangle?
  touches(x0, z0, x1, z1, margin) {
    const cx0 = Math.floor((x0 - margin) / CELL), cx1 = Math.floor((x1 + margin) / CELL);
    const cz0 = Math.floor((z0 - margin) / CELL), cz1 = Math.floor((z1 + margin) / CELL);
    if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > 4000) return true;
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) if (this.grid.has(key(cx, cz))) return true;
    return false;
  }

  // nearest road point within maxR (<= CELL). Returns distance, writes road height to this.nearY
  nearest(x, z, maxR) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const p = this.pts;
    let best = maxR * maxR, found = false;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const a = this.grid.get(key(cx + dx, cz + dz));
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const i = a[k];
          if (i >= this.n - 1 && !this.loop) continue;
          const j = (i + 1) % this.n;
          const ax = p[i * 3], az = p[i * 3 + 2];
          const bx = p[j * 3] - ax, bz = p[j * 3 + 2] - az;
          const t = clamp(((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz || 1), 0, 1);
          const ex = ax + bx * t - x, ez = az + bz * t - z;
          const d2 = ex * ex + ez * ez;
          if (d2 < best) {
            best = d2;
            found = true;
            this.nearY = p[i * 3 + 1] + (p[j * 3 + 1] - p[i * 3 + 1]) * t;
          }
        }
      }
    return found ? Math.sqrt(best) : -1;
  }

  // like nearest() but for any radius (slower: scans more cells)
  nearestWide(x, z, maxR) {
    const R = Math.ceil(maxR / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), p = this.pts;
    let best = maxR * maxR, found = false;
    for (let dx = -R; dx <= R; dx++)
      for (let dz = -R; dz <= R; dz++) {
        const a = this.grid.get(key(cx + dx, cz + dz));
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const i = a[k] * 3, ex = p[i] - x, ez = p[i + 2] - z, d2 = ex * ex + ez * ez;
          if (d2 < best) { best = d2; found = true; this.nearY = p[i + 1]; }
        }
      }
    return found ? Math.sqrt(best) : -1;
  }

  // every 64 m cell within 260 m of the road (once per place, on first use)
  _nearCells() {
    const R = Math.ceil(260 / CELL) + 1, near = (this._near = new Set());
    for (const k of this.grid.keys()) {
      const cx = Math.floor(k / 65536) - 32768, cz = (k % 65536) - 32768;
      for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) near.add(key(cx + dx, cz + dz));
    }
  }

  // City floor: returns the ground height to use at (x, z) given the raw elevation h there.
  // Street height within ~40 m of the route, easing back to the raw data by ~260 m. Uses a cached
  // 16 m grid so terrain tiles, buildings and trees all agree and it costs almost nothing per call.
  cityGround(x, z, h) {
    const G = 16, gx = x / G, gz = z / G, i = Math.floor(gx), j = Math.floor(gz), ax = gx - i, az = gz - j;
    let Wt = 0, WY = 0;
    for (let b = 0; b < 4; b++) {
      const ni = i + (b & 1), nj = j + (b >> 1), k = key(ni, nj);
      let n = this.field.get(k);
      if (n === undefined) {
        // most of a coarse tile is far from any road: only search where the road can be within reach
        if (!this._near) this._nearCells();
        const d = this._near.has(key(Math.floor((ni * G) / CELL), Math.floor((nj * G) / CELL))) ? this.nearestWide(ni * G, nj * G, 260) : -1;
        const rIn = this.road.half + 30;
        const t = d < 0 ? 1 : clamp((d - rIn) / (260 - rIn), 0, 1);
        n = d < 0 ? null : { w: 1 - t * t * (3 - 2 * t), y: this.nearY - 0.1 };
        this.field.set(k, n);
      }
      if (!n) continue;
      const bw = (b & 1 ? ax : 1 - ax) * (b >> 1 ? az : 1 - az);
      Wt += n.w * bw; WY += n.w * n.y * bw;
    }
    return h * (1 - Wt) + WY;
  }

  // |curvature| (1/m) at every route point, measured over ~40 m; cached. Used to ease off into bends.
  get curv() {
    if (this._curv) return this._curv;
    const n = this.n, p = this.pts, W = 4, c = new Float32Array(n);
    const at = (k) => (this.loop ? ((k % n) + n) % n : Math.min(n - 1, Math.max(0, k))) * 3;
    for (let i = 0; i < n; i++) {
      const a = at(i - W), b = at(i), d = at(i + W);
      const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], vx = p[d] - p[b], vz = p[d + 2] - p[b + 2];
      const lu = Math.hypot(ux, uz) || 1, lv = Math.hypot(vx, vz) || 1;
      c[i] = Math.abs(Math.asin(clamp((ux * vz - uz * vx) / (lu * lv), -1, 1))) / ((lu + lv) / 2);
    }
    return (this._curv = c);
  }

  nearestStop(s) {
    let best = this.stops[0];
    for (const st of this.stops) if (Math.abs(st.s - s) < Math.abs(best.s - s)) best = st;
    return best;
  }
}

// ---------- visible road surface ----------
const CHUNK = 160; // points per chunk

export class Road {
  constructor(route, scene, renderer, shared) {
    this.route = route;
    this.scene = scene;
    this.shared = shared;
    this.chunks = new Map();
    this.half = route.road.half; // ribbon half-width incl. soft shoulders
    const T = createRoadTextures(Math.min(8, renderer.capabilities.getMaxAnisotropy()), this.half, route.road.style);
    const micro = T.micro;
    micro.repeat.set(this.half * 4, 40); // 0.5 m tile
    micro.wrapS = micro.wrapT = THREE.RepeatWrapping;
    this.mat = new THREE.MeshStandardMaterial({
      map: T.map,
      normalMap: micro,
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: 0.12,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    if (route.road.style === 'track' && route.loop) this.buildStartLine();
    this.mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWet = shared.uWet;
      sh.uniforms.uSnow = shared.uSnow;
      sh.uniforms.uMacro = { value: T.macro };
      sh.uniforms.uWeather = { value: T.weather };
      // lift the ribbon slightly with distance so coarse far terrain never swallows it
      sh.vertexShader = sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
         transformed.y += distance(wp0, cameraPosition) * 0.0035;`
      );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uWet; uniform float uSnow; uniform sampler2D uMacro; uniform sampler2D uWeather;
float rRough = 0.9; float rNS = 1.0; float rShoulder = 0.0; float rPud = 0.0;`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           {
             vec4 mc = texture2D(uMacro, vMapUv);
             vec4 wx = texture2D(uWeather, vec2(vMapUv.x, vMapUv.y * 0.4));
             vec4 mg = texture2D(normalMap, vNormalMapUv * 1.0);
             vec4 mg2 = texture2D(normalMap, vNormalMapUv * 1.31 + vec2(0.37, 0.61));
             float grain = mix(mg.a, mg2.a, 0.5) * 1.28;
             float across = abs(vMapUv.x - 0.5) * 10.0;
             rShoulder = mc.a;
             float paint = mc.b;
             float cr = wx.g * (1.0 - paint * 0.7);
             vec3 c = diffuseColor.rgb;
             c *= 0.62 + 0.76 * wx.r;
             c *= mix(1.0, grain, 0.75 * (1.0 - paint * 0.5));
             c *= 1.0 - 0.6 * cr;
             float pp = clamp(mc.g * 0.55 + (wx.b - 0.5) * 1.8 + 0.1, 0.0, 1.0);
             rPud = uWet * smoothstep(0.5, 0.72, pp) * (1.0 - rShoulder) * (1.0 - paint * 0.5);
             float wetK = uWet;
             c *= mix(1.0, 0.52, wetK);
             c *= 1.0 - 0.35 * rPud;
             rRough = mix(mc.r, 0.55, cr * 0.5);
             rRough = mix(rRough, mix(0.42, 0.26, mc.g), wetK * (1.0 - paint * 0.6));
             rRough = mix(rRough, 0.06, rPud);
             rRough = mix(rRough, 0.92, uSnow * 0.8);
             rNS = (1.0 - 0.88 * rPud) * (1.0 - 0.55 * uWet) * mix(1.0, 1.6, rShoulder);
             c = mix(c, vec3(0.86, 0.89, 0.93), uSnow * 0.8 * (1.0 - 0.55 * mc.g) * smoothstep(0.1, 0.5, across * 0.2 + 0.25));
             diffuseColor.rgb = c;
           }`
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rRough;')
        .replace(
          '#include <normal_fragment_maps>',
          `#if defined( USE_NORMALMAP_TANGENTSPACE )
             vec3 mN1 = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
             vec3 mN2 = texture2D(normalMap, vNormalMapUv * 1.31 + vec2(0.37, 0.61)).xyz * 2.0 - 1.0;
             vec3 mN3 = texture2D(normalMap, vNormalMapUv * 0.27 + vec2(0.11, 0.53)).xyz * 2.0 - 1.0;
             vec2 gxy = (mN1.xy + 0.8 * mN2.xy) * 0.85 + mN3.xy * 1.3 * rShoulder;
             normal = normalize(tbn * normalize(vec3(gxy * rNS * 1.15, 1.0)));
           #endif`
        );
    };
  }

  // ---- race circuits: red/white kerbs on the inside of every corner (and the outside of tight ones)
  kerbMaterial() {
    if (this._kerbMat) return this._kerbMat;
    const d = new Uint8Array([196, 30, 28, 255, 236, 234, 226, 255]);
    const t = new THREE.DataTexture(d, 1, 2, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    this._kerbMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.62, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    const shared = this.shared;
    this._kerbMat.onBeforeCompile = (sh) => {
      sh.uniforms.uWet = shared.uWet;
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 kwp = (modelMatrix * vec4(transformed, 1.0)).xyz;
        transformed.y += distance(kwp, cameraPosition) * 0.0036;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWet;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 0.86 - 0.3 * uWet;');
    };
    return this._kerbMat;
  }

  // signed curvature (1/m, + = turning right) at point i, measured over a ~30 m window
  curvature(i) {
    const r = this.route, p = r.pts, n = r.n, W = 3;
    const at = (k) => (r.loop ? ((k % n) + n) % n : Math.min(n - 1, Math.max(0, k))) * 3;
    const a = at(i - W), b = at(i), c = at(i + W);
    const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], vx = p[c] - p[b], vz = p[c + 2] - p[b + 2];
    const lu = Math.hypot(ux, uz) || 1, lv = Math.hypot(vx, vz) || 1;
    const cross = (ux * vz - uz * vx) / (lu * lv);
    return Math.asin(Math.max(-1, Math.min(1, cross))) / ((lu + lv) / 2);
  }

  buildKerbs(i0, cnt, ox, oy, oz) {
    const r = this.route, p = r.pts, n = r.n, E = r.road.edge;
    const at = (k) => (r.loop ? ((k % n) + n) % n : Math.min(n - 1, Math.max(0, k))) * 3;
    const pos = [], uv = [], nor = [], idx = [];
    for (const side of [-1, 1]) {
      let prev = -1;
      for (let k = 0; k < cnt; k++) {
        const i = i0 + k, c = at(i);
        const cur = this.curvature(i);
        // inside of the bend from ~300 m radius; outside too once it is tighter than ~90 m
        const inner = Math.sign(cur) === side ? Math.abs(cur) > 1 / 300 : Math.abs(cur) > 1 / 90;
        if (!inner) { prev = -1; continue; }
        const a = at(i - 1), b = at(i + 1);
        let tx = p[b] - p[a], tz = p[b + 2] - p[a + 2];
        const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const rx = -tz * side, rz = tx * side;
        const x = p[c] - ox, y = p[c + 1] - oy + 0.085, z = p[c + 2] - oz;
        const v0 = pos.length / 3;
        pos.push(x + rx * (E - 0.05), y, z + rz * (E - 0.05), x + rx * (E + 1.15), y + 0.035, z + rz * (E + 1.15));
        nor.push(0, 1, 0, 0, 1, 0);
        const vv = (i * r.step) / 4; // 2 m red, 2 m white
        uv.push(0, vv, 1, vv);
        if (prev >= 0) (side > 0 ? idx.push(prev, prev + 1, v0, prev + 1, v0 + 1, v0) : idx.push(prev, v0, prev + 1, prev + 1, v0, v0 + 1));
        prev = v0;
      }
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, this.kerbMaterial());
    m.renderOrder = 2;
    m.receiveShadow = true;
    return m;
  }

  // chequered start/finish line across the track at the first route point
  buildStartLine() {
    const r = this.route, P = r.sample(0, {}), E = r.road.edge;
    const S = 8, d = new Uint8Array(S * 2 * 4);
    for (let j = 0; j < 2; j++) for (let i = 0; i < S; i++) { const v = (i + j) % 2 ? 235 : 22, k = (j * S + i) * 4; d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255; }
    const t = new THREE.DataTexture(d, S, 2, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.wrapS = THREE.RepeatWrapping; t.repeat.set(Math.round((E * 2) / (0.6 * S)), 1); t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(E * 2, 1.2), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    m.rotation.order = 'YXZ';
    m.rotation.set(-Math.PI / 2, Math.atan2(-P.tx, -P.tz), 0);
    m.position.set(P.x, P.y + 0.09, P.z);
    m.renderOrder = 2;
    this.scene.add(m);
  }

  // PMREM sky texture (HDR) for puddle / wet-road reflections
  setEnvMap(tex) {
    if (this.mat.envMap === tex) return;
    this.mat.envMap = tex;
    this.mat.needsUpdate = true;
  }

  build(ci) {
    const r = this.route, p = r.pts, n = r.n, HALF = this.half;
    const i0 = ci * CHUNK, i1 = r.loop ? Math.min(n, i0 + CHUNK) : Math.min(n - 1, i0 + CHUNK);
    const cnt = i1 - i0 + 1;
    if (cnt < 2) return null;
    const pos = new Float32Array(cnt * 6), uv = new Float32Array(cnt * 4), nor = new Float32Array(cnt * 6);
    const ox = p[i0 * 3], oy = p[i0 * 3 + 1], oz = p[i0 * 3 + 2];
    const at = (k) => (r.loop ? ((k % n) + n) % n : Math.min(n - 1, Math.max(0, k))) * 3;
    for (let k = 0; k < cnt; k++) {
      const i = i0 + k, c = at(i);
      const a = at(i - 1), b = at(i + 1);
      let tx = p[b] - p[a], tz = p[b + 2] - p[a + 2];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      const rx = -tz, rz = tx; // right of travel
      const x = p[c] - ox, y = p[c + 1] - oy + 0.06, z = p[c + 2] - oz;
      pos.set([x - rx * HALF, y, z - rz * HALF, x + rx * HALF, y, z + rz * HALF], k * 6);
      nor.set([0, 1, 0, 0, 1, 0], k * 6);
      const v = (i * r.step) / 20;
      uv.set([0, v, 1, v], k * 4);
    }
    const idx = [];
    for (let k = 0; k < cnt - 1; k++) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, this.mat);
    m.position.set(ox, oy, oz);
    m.renderOrder = 1;
    m.receiveShadow = true;
    if (r.road.style === 'track') { const kb = this.buildKerbs(i0, cnt, ox, oy, oz); if (kb) m.add(kb); }
    this.scene.add(m);
    return m;
  }

  update(s) {
    // reflections only really show when wet
    this.mat.envMapIntensity = 0.08 + 0.2 * this.shared.uWet.value;
    const r = this.route;
    const count = r.loop ? Math.ceil(r.n / CHUNK) : Math.floor((r.n - 1) / CHUNK) + 1;
    const cur = Math.min(count - 1, Math.floor(s / r.step / CHUNK));
    const want = new Set();
    for (let d = -3; d <= 3; d++) {
      const c = r.loop ? (((cur + d) % count) + count) % count : cur + d;
      if (c >= 0 && c < count) want.add(c);
    }
    for (const c of want) if (!this.chunks.has(c)) this.chunks.set(c, this.build(c));
    for (const [c, m] of this.chunks) {
      let far = Math.abs(c - cur);
      if (r.loop) far = Math.min(far, count - far);
      if (far > 5) {
        if (m) { this.scene.remove(m); m.geometry.dispose(); for (const c of m.children) c.geometry.dispose(); }
        this.chunks.delete(c);
      }
    }
  }
}
