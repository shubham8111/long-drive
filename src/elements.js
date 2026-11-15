import * as THREE from 'three';
import { lon2tx, lat2ty } from './geo.js';
import { MAX_Z } from './tiles.js';
import { BASE } from './paths.js';

// Draws the baked scenery (public/world/<route>/elements/*.bin): every tree, shrub and rock sits at
// the position the builder saved for it. Records are [kind*8+variant, x, y, z, scale, rotY].
const STRIDE = 6;
const FAR_CELL = 560; // far impostors are grouped in cells this size: big, as each cell is a draw call (impostors are only a few triangles each, so coarse culling costs little)
const NEAR_CELL = 48; // full 3D models are built per small cell around the camera
const NEAR_RANGE = 120;
const SMALL_RANGE = 210;
const SMALL = (code) => (code >> 3) === 1 || (code >> 3) === 2; // shrubs, rocks
// sink below the ground at the model origin, per kind (as the baker does): pine, shrub, rock, broadleaf
const SINK = [0.35, 0.08, 0.15, 0.35];
const KINDS = ['pine', 'shrub', 'rock', 'broadleaf'];

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// URL debug/tuning params:  ?treepal=0..3 (palette, see assets.js; 0 = original uniform tint)
//                           ?treevar=N   (testing: force every pine record to variant N: 0-2 ponderosa, 3 spruce, 4 Douglas-fir, 5 aspen, 6 juniper)
const QP = new URLSearchParams(location.search);
const TREEPAL = +(QP.get('treepal') ?? 1);
const TREEVAR = QP.has('treevar') ? +QP.get('treevar') & 7 : null;

function instanced(part, rec, list, tintAmount, pineTint) {
  const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
  const col = new Float32Array(list.length * 3);
  for (let n = 0; n < list.length; n++) {
    const o = list[n];
    p.set(rec[o + 1], rec[o + 2], rec[o + 3]);
    q.setFromAxisAngle(up, rec[o + 5]);
    s.setScalar(rec[o + 4]);
    im.setMatrixAt(n, m4.compose(p, q, s));
    if (pineTint && TREEPAL !== 0) {
      // hue-varied: some trees darker/bluer, some lighter/yellower; a few aspens turn gold
      const t = 0.82 + hash(o) * 0.36, hu = (hash(o + 7) - 0.5) * 2;
      let r = t * (1 + 0.075 * hu), g = t * (1 + 0.025 * hu), b = t * (1 - 0.11 * hu);
      if ((rec[o] & 7) === 5) { const gold = hash(o + 13) < 0.15 ? 0.6 + hash(o + 21) * 0.4 : hash(o + 13) * 0.25; r *= 1 + 0.38 * gold; g *= 1 + 0.12 * gold; b *= 1 - 0.55 * gold; }
      col[n * 3] = r; col[n * 3 + 1] = g; col[n * 3 + 2] = b;
      continue;
    }
    const t = 1 - tintAmount + hash(o) * tintAmount * 2, w = (hash(o + 7) - 0.5) * tintAmount;
    col[n * 3] = t + w; col[n * 3 + 1] = t; col[n * 3 + 2] = t - w;
    if (rec[o] >> 3 === 2 && (rec[o] & 7) >= 3) { col[n * 3] *= 1.22; col[n * 3 + 1] *= 0.7; col[n * 3 + 2] *= 0.52; } // Red Canyon: rust-red rock
  }
  im.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
  im.matrixAutoUpdate = false;
  im.computeBoundingSphere();
  return im;
}

export class Elements {
  constructor(scene, geo, assets, routeId, terrain = null) {
    this.terrain = terrain; // ground the near models on the terrain mesh actually drawn (null: baked heights)
    this.scene = scene;
    this.geo = geo;
    this.assets = assets;
    this.base = `${BASE}world/${routeId}/elements`;
    this.index = null;
    this.tiles = new Map(); // key -> { state, rec, far: [], cells: Map }
    this.near = new Map(); // "tileKey|cellKey" -> [InstancedMesh]
    this.clock = 0;
    this.nearRange = NEAR_RANGE;
    this.smallRange = SMALL_RANGE; // rocks and shrubs have no impostor: drawn in 3D this far, dissolving in near the edge
    this.visDist = Infinity;
    this.buildsPerTick = 3;
    this.thinStart = 450; this.thinSpan = 900; this.thinMin = 0.4;
    this.count = 0;
    fetch(`${this.base}/index.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { this.index = j; }).catch(() => {});
  }

  // record code (kind*8+variant) -> asset; kinds with no model yet fall back to pines
  variant(code) {
    const set = this.assets[KINDS[code >> 3]] || this.assets.pine;
    return set[(code & 7) % set.length];
  }

  async load(key, t) {
    try {
      const buf = await (await fetch(`${this.base}/${key}.bin`)).arrayBuffer();
      if (t.dead) return;
      const rec = (t.rec = new Float32Array(buf));
      const far = new Map();
      t.cells = new Map();
      if (TREEVAR !== null) for (let o = 0; o < rec.length; o += STRIDE) if (rec[o] >> 3 === 0) rec[o] = TREEVAR;
      for (let o = 0; o < rec.length; o += STRIDE) {
        const kind = rec[o] >> 3, variant = rec[o] & 7;
        const x = rec[o + 1], z = rec[o + 3];
        if (this.variant(rec[o])?.far) {
          const k = `${Math.floor(x / FAR_CELL)},${Math.floor(z / FAR_CELL)},${rec[o]}`;
          (far.get(k) || far.set(k, []).get(k)).push(o);
        }
        const ck = `${SMALL(rec[o]) ? 's' : ''}${Math.floor(x / NEAR_CELL)},${Math.floor(z / NEAR_CELL)}`;
        (t.cells.get(ck) || t.cells.set(ck, []).get(ck)).push(o);
      }
      for (const [k, list] of far) {
        // shuffled, so drawing only the first part of the list thins the stand evenly (see thin())
        for (let i = list.length - 1; i > 0; i--) { const j = (hash(i * 1.37 + list[i]) * (i + 1)) | 0; const tmp = list[i]; list[i] = list[j]; list[j] = tmp; }
        const im = instanced(this.variant(+k.split(',')[2]).far, rec, list, 0.14, (+k.split(',')[2]) >> 3 === 0);
        const [fx, fz] = k.split(',');
        im.userData.cx = (+fx + 0.5) * FAR_CELL; im.userData.cz = (+fz + 0.5) * FAR_CELL; im.userData.full = list.length;
        this.scene.add(im);
        t.far.push(im);
      }
      this.count += rec.length / STRIDE;
      t.state = 2;
    } catch (e) {
      t.state = 0;
    }
  }

  dropTile(key, t) {
    t.dead = true;
    for (const im of t.far) { this.scene.remove(im); im.dispose(); }
    for (const [k, list] of this.near) if (k.startsWith(key + '|')) { list.forEach((im) => { this.scene.remove(im); im.dispose(); }); this.near.delete(k); }
    if (t.rec) this.count -= t.rec.length / STRIDE;
    this.tiles.delete(key);
  }

  // Stand the models of one cell on the terrain mesh as drawn (the baked height comes from the raw elevation;
  // the drawn ground is a coarser grid and is pulled toward the road level next to the road, which left rocks
  // floating). Rocks on a slope sit on the lower side so no edge hangs in the air. Returns the coarsest terrain
  // zoom used (MAX_Z when grounded on the finest tiles; -1 when no terrain was loaded at all).
  ground(rec, list) {
    const T = this.terrain;
    if (!T?.heightAt) return MAX_Z;
    let zMin = MAX_Z;
    for (const o of list) {
      const x = rec[o + 1], z = rec[o + 3], kind = rec[o] >> 3;
      const g = T.heightAt(x, z);
      if (g == null || !Number.isFinite(g)) { zMin = -1; continue; }
      zMin = Math.min(zMin, T.lastZ);
      let y = g;
      if (kind === 1) { // shrubs: settle a little into the slope
        const r = Math.max(0.4, rec[o + 4] * 0.45);
        let lo = g;
        for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) { const h = T.heightAt(x + dx, z + dz); if (h != null) lo = Math.min(lo, h); }
        y = (g + lo) * 0.5 - (g - lo) * 0.15;
      } else if (kind === 2) { // rocks: down to the lowest ground under the footprint, then bedded in, so no edge ever shows daylight
        const r = rec[o + 4] * 0.6;
        let lo = g;
        for (let k = 0; k < 8; k++) { const h = T.heightAt(x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r); if (h != null) lo = Math.min(lo, h); }
        y = lo - 0.15 * rec[o + 4];
      }
      rec[o + 2] = y - SINK[kind];
    }
    return zMin;
  }

  buildNear(t, list) {
    const zq = this.ground(t.rec, list);
    const groups = new Map();
    for (const o of list) { const c = t.rec[o]; (groups.get(c) || groups.set(c, []).get(c)).push(o); }
    const out = [];
    for (const [code, l] of groups) {
      const kind = KINDS[code >> 3], variant = this.variant(code);
      if (!variant) continue;
      for (const part of variant.near) {
        const im = instanced(part, t.rec, l, kind === 'pine' || kind === 'broadleaf' ? 0.14 : 0.1, kind === 'pine');
        im.castShadow = false;
        this.scene.add(im);
        out.push(im);
      }
    }
    out.zq = zq;
    return out;
  }

  update(dt, cx, cz) {
    this.clock += dt;
    if (!this.index || this.clock < 0.1) return;
    this.clock = 0;
    const z = this.index.z;
    const tx = Math.floor(lon2tx(this.geo.lon(cx), z)), ty = Math.floor(lat2ty(this.geo.lat(cz), z));
    const want = new Set();
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${tx + dx}_${ty + dy}`;
        if (!this.index.tiles[key]) continue;
        want.add(key);
        let t = this.tiles.get(key);
        if (!t) this.tiles.set(key, (t = { state: 0, far: [], cells: null, rec: null }));
        if (t.state === 0) { t.state = 1; this.load(key, t); }
      }
    for (const [key, t] of this.tiles) if (!want.has(key) && t.state !== 1) this.dropTile(key, t);

    // far away, a thinner stand reads the same through the haze: draw fewer distant trees
    for (const t of this.tiles.values())
      for (const im of t.far) {
        const d = Math.hypot(im.userData.cx - cx, im.userData.cz - cz);
        const f = d < this.thinStart ? 1 : Math.max(this.thinMin, 1 - (d - this.thinStart) / this.thinSpan);
        im.count = Math.max(1, Math.ceil(im.userData.full * f));
        im.visible = d - FAR_CELL * 0.75 < this.visDist; // hidden by fog: don't draw at all
      }

    // full 3D models in the cells around the camera
    // Only cells that actually reach inside the 3D range are built (trees beyond it are drawn as impostors).
    // (trees within nearRange; rocks and shrubs, which have no impostor, within the longer smallRange)
    const keep = new Set();
    const todo = [];
    const cellD = (x, zc) => Math.hypot(Math.max(x * NEAR_CELL - cx, 0, cx - (x + 1) * NEAR_CELL), Math.max(zc * NEAR_CELL - cz, 0, cz - (zc + 1) * NEAR_CELL));
    for (const [pre, R] of [['', this.nearRange], ['s', this.smallRange]]) {
      const c0x = Math.floor((cx - R) / NEAR_CELL), c1x = Math.floor((cx + R) / NEAR_CELL);
      const c0z = Math.floor((cz - R) / NEAR_CELL), c1z = Math.floor((cz + R) / NEAR_CELL);
      for (const [key, t] of this.tiles) {
        if (t.state !== 2) continue;
        for (let x = c0x; x <= c1x; x++)
          for (let zc = c0z; zc <= c1z; zc++) {
            const d = cellD(x, zc);
            if (d > R) continue;
            const ck = `${pre}${x},${zc}`, list = t.cells.get(ck);
            if (!list) continue;
            const id = `${key}|${ck}`;
            keep.add(id);
            const have = this.near.get(id);
            // built before the finest terrain was in: rebuild (re-grounded) once it is
            if (have && have.zq < MAX_Z && this.clockQ > 1) {
              const g = this.terrain?.heightAt?.((x + 0.5) * NEAR_CELL, (zc + 0.5) * NEAR_CELL);
              if (g != null && this.terrain.lastZ > have.zq) { have.forEach((im) => { this.scene.remove(im); im.dispose(); }); this.near.delete(id); }
            }
            if (!this.near.has(id)) todo.push({ id, t, list, d: d * (pre ? 0.6 : 1) });
          }
      }
    }
    this.clockQ = this.clockQ > 1 ? 0 : (this.clockQ || 0) + 0.1;
    // nearest first, a couple per tick so building never causes a hitch
    todo.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(this.buildsPerTick, todo.length); i++) this.near.set(todo[i].id, this.buildNear(todo[i].t, todo[i].list));
    for (const [id, list] of this.near)
      if (!keep.has(id)) {
        const [, ck] = id.split('|');
        const small = ck[0] === 's';
        const [x, zc] = (small ? ck.slice(1) : ck).split(',').map(Number);
        if (cellD(x, zc) > (small ? this.smallRange : this.nearRange) + 30) { list.forEach((im) => { this.scene.remove(im); im.dispose(); }); this.near.delete(id); }
      }
  }
}
