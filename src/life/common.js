// Shared helpers for the life system: random utilities, a tiny skinned-model builder, a distance
// dither fade (so things never pop into view) and a lazy map of nearby trees / street furniture.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Geo, lon2tx, lat2ty } from '../geo.js';
import { BASE } from '../paths.js';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const pick = (a) => a[(Math.random() * a.length) | 0];
export const chance = (p) => Math.random() < p;
export const TAU = Math.PI * 2;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function weighted(list) {
  let t = 0;
  for (const [, w] of list) t += w;
  if (t <= 0) return null;
  let r = Math.random() * t;
  for (const [v, w] of list) if ((r -= w) <= 0) return v;
  return list[list.length - 1][0];
}
export const wrapPI = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
export const angLerp = (a, b, t) => a + wrapPI(b - a) * t;

// ---------------------------------------------------------------------------------------------
// Dither the model out beyond `from` metres (fully gone at `to`): spawning at the edge of the
// draw distance is then invisible, and things "arrive" out of the haze.
const FADE_GLSL = (from, to) => `
  { float fd = length(vViewPosition);
    float fp = 1.0 - smoothstep(${from.toFixed(1)}, ${to.toFixed(1)}, fd);
    float fn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (fn > fp) discard; }`;
export function farFade(mat, from, to, extra) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FADE_GLSL(from, to));
    if (extra) extra(sh);
  };
  mat.customProgramCacheKey = () => `lf${from}_${to}_${extra ? extra.key || 'x' : ''}`;
  return mat;
}

// ---------------------------------------------------------------------------------------------
// Skinned model builder: parts are primitive geometries, each rigidly bound to one bone.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);
export class SkinBuilder {
  constructor() { this.parts = []; }
  add(geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], c = 0xffffff, bone = 0 } = {}) {
    const g = geo.clone();
    g.deleteAttribute('uv');
    _e.set(r[0], r[1], r[2], 'YXZ');
    _m.compose(_v.set(p[0], p[1], p[2]), _q.setFromEuler(_e), _s.set(s[0], s[1], s[2]));
    g.applyMatrix4(_m);
    const n = g.attributes.position.count;
    _c.set(c);
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; si[i * 4] = bone; sw[i * 4] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.parts.push(g);
    geo.dispose();
    return this;
  }
  sphere(rad, p, c, bone, s = [1, 1, 1], seg = [10, 8]) { return this.add(new THREE.SphereGeometry(rad, seg[0], seg[1]), { p, s, c, bone }); }
  box(w, h, d, p, c, bone, r) { return this.add(new THREE.BoxGeometry(w, h, d), { p, c, bone, r }); }
  // tapered cylinder from a (radius ra) to b (radius rb)
  limb(a, b, ra, rb, c, bone, seg = 8, cap = false) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = A.clone().sub(B), len = d.length();
    const g = new THREE.CylinderGeometry(ra, rb, len, seg, 1, !cap);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, d.normalize());
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    return this.add(g, { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], r: [e.x, e.y, e.z], c, bone });
  }
  build() {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }
}

// bone spec: [{ n: 'name', p: parentIndex (-1 root), at: [x, y, z] rest position in model space }]
export function makeSkinned(geo, mat, spec) {
  const bones = spec.map((b) => { const o = new THREE.Bone(); o.name = b.n; return o; });
  const inv = [];
  spec.forEach((b, i) => {
    if (b.p >= 0) { bones[b.p].add(bones[i]); const pa = spec[b.p].at; bones[i].position.set(b.at[0] - pa[0], b.at[1] - pa[1], b.at[2] - pa[2]); }
    else bones[i].position.set(b.at[0], b.at[1], b.at[2]);
    inv.push(new THREE.Matrix4().makeTranslation(-b.at[0], -b.at[1], -b.at[2]));
  });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones, inv), new THREE.Matrix4());
  mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = false;
  const by = {};
  spec.forEach((b, i) => { by[b.n] = bones[i]; });
  return { mesh, bones, by };
}

// ---------------------------------------------------------------------------------------------
// Where are the trees / benches / lamps?  Loaded lazily from the same baked files the scenery uses.
const CELL = 16;
export class StaticMap {
  constructor(routeData, onLoad) {
    this.id = routeData.id;
    this.geo = new Geo(routeData.origin.lat, routeData.origin.lon);
    this.tiles = new Map(); // key -> 'loading' | 'none' | true
    this.cells = new Map(); // "cx,cz" -> [x, z, r, kind] flat (trees 0 / rocks 1 / furniture 2) with kind 3 = bench
    this.benches = [];
    this.jobs = [];
    this.index = null;
    this.z = 15;
    fetch(`${BASE}world/${this.id}/elements/index.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { this.index = j; if (j) this.z = j.z; }).catch(() => {});
    fetch(`${BASE}world/${this.id}/street/street.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => {
      if (!b) return;
      this.jobs.push({ a: new Float32Array(b), o: 0, stride: 8, street: true });
    }).catch(() => {});
  }
  // process queued tile data in small slices so no frame pays for a whole tile
  pump(ms) {
    const t0 = performance.now();
    while (this.jobs.length && performance.now() - t0 < ms) {
      const j = this.jobs[0], a = j.a, end = Math.min(a.length, j.o + 600 * j.stride);
      for (let o = j.o; o + j.stride <= end; o += j.stride) {
        if (j.street) {
          const type = (a[o] | 0) >> 4;
          const rad = type === 1 ? 1.0 : type === 5 || type === 10 ? 2.0 : type === 6 ? 0.9 : 0.45;
          this.put(a[o + 1], a[o + 3], rad, type === 1 ? 3 : 2);
          if (type === 1) this.benches.push({ x: a[o + 1], y: a[o + 2], z: a[o + 3], yaw: a[o + 4] });
        } else {
          const kind = a[o] >> 3;
          if (kind === 1) continue;
          this.put(a[o + 1], a[o + 3], kind === 2 ? 0.5 + a[o + 4] * 0.5 : 0.35 + a[o + 4] * 0.05, kind === 2 ? 1 : 0);
        }
      }
      j.o = end;
      if (end >= a.length) { this.jobs.shift(); if (j.key) this.tiles.set(j.key, true); }
    }
  }
  put(x, z, r, kind) {
    const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    let l = this.cells.get(k);
    if (!l) this.cells.set(k, (l = []));
    l.push(x, z, r, kind);
  }
  // make sure the tiles around (x, z) are being fetched
  ensure(x, z) {
    if (!this.index) return;
    const tx = Math.floor(lon2tx(this.geo.lon(x), this.z)), ty = Math.floor(lat2ty(this.geo.lat(z), this.z));
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${tx + dx}_${ty + dy}`;
        if (!this.index.tiles[key] || this.tiles.has(key)) continue;
        this.tiles.set(key, 'loading');
        fetch(`${BASE}world/${this.id}/elements/${key}.bin`).then((r) => r.arrayBuffer()).then((buf) => {
          this.jobs.push({ a: new Float32Array(buf), o: 0, stride: 6, key });
        }).catch(() => this.tiles.set(key, 'none'));
      }
  }
  // distance from (x,z) to the nearest obstacle edge within `reach` metres (reach if none), optionally by kind set
  clearance(x, z, reach = 10, kinds = null) {
    let best = reach;
    const c0x = Math.floor((x - reach) / CELL), c1x = Math.floor((x + reach) / CELL), c0z = Math.floor((z - reach) / CELL), c1z = Math.floor((z + reach) / CELL);
    for (let a = c0x; a <= c1x; a++)
      for (let b = c0z; b <= c1z; b++) {
        const l = this.cells.get(`${a},${b}`);
        if (!l) continue;
        for (let i = 0; i < l.length; i += 4) {
          if (kinds && !kinds.includes(l[i + 3])) continue;
          const d = Math.hypot(l[i] - x, l[i + 1] - z) - l[i + 2];
          if (d < best) best = d;
        }
      }
    return best;
  }
  // true when the area is known (tiles near x,z loaded or not available)
  ready(x, z) {
    if (!this.index) return false;
    const tx = Math.floor(lon2tx(this.geo.lon(x), this.z)), ty = Math.floor(lat2ty(this.geo.lat(z), this.z));
    const t = this.tiles.get(`${tx}_${ty}`);
    return t === true || t === 'none' || !this.index.tiles[`${tx}_${ty}`];
  }
}
