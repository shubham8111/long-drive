// Bakes street furniture (lamps, signals, benches, bins, bollards, shelters, advertising, barriers) along a city route.
//   node scripts/bake-street.mjs <placeId> [--offline]
// Real positions come from OpenStreetMap (Overpass, cached forever in data/osm/street_<place>_*.json), snapped to the
// footpath; sparse stretches are filled procedurally (deterministic, seeded by the place id).
// Output: public/world/<id>/street/{street.bin, index.json, CREDITS.txt}
//
// street.bin: Float32 stream, 8 floats per item:
//   [type*16 + variant, x, y, z, yaw, seed (0..1), aux, real (1 = from OSM, 0 = procedural)]
//   yaw: rotation about +Y so that the model's local +z (its "front") points along (sin yaw, cos yaw) in (x, z)
//   aux: poster index (ad types), signal phase 0..1 (signals), else 0
import fs from 'node:fs';
import { Geo } from '../src/geo.js';
import { Route } from '../src/route.js';

const placeId = process.argv[2];
if (!placeId) { console.error('usage: bake-street.mjs <placeId> [--offline]'); process.exit(1); }
const offline = process.argv.includes('--offline');
const data = JSON.parse(fs.readFileSync(`public/routes/${placeId}.json`, 'utf8'));
const geo = new Geo(data.origin.lat, data.origin.lon);
const route = new Route(data);
const E = route.road.edge, H = route.road.half;
const outDir = `public/world/${placeId}/street`;
const UA = 'long-drive-game/1.0';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const mulberry = (a) => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rnd = mulberry(hashStr('street:' + placeId));

export const TYPES = ['lamp', 'bench', 'bin', 'signal', 'bollard', 'shelter', 'column', 'mupi', 'billboard', 'barrier', 'busstop', 'hydrant', 'newsbox', 'steam', 'subway'];
const T = Object.fromEntries(TYPES.map((n, i) => [n, i]));

// ---------- per-city procedural rules (spacing in metres along the route; 0 = none) ----------
const CITY = {
  manhattan: { lamp: 34, bench: 280, bin: 85, bollard: 420, shelter: 520, column: 0, mupi: 230, billboard: 0, barrier: 0, kerbLamp: 0.55, hydrant: 70, newsbox: 170, steam: 1300, subway: 320 },
  paris:     { lamp: 25, bench: 130, bin: 105, bollard: 230, shelter: 430, column: 380, mupi: 520, billboard: 0, barrier: 0, kerbLamp: 0.6 },
  london:    { lamp: 30, bench: 230, bin: 130, bollard: 300, shelter: 400, column: 0, mupi: 560, billboard: 0, barrier: 0, kerbLamp: 0.55 },
  la:        { lamp: 42, bench: 650, bin: 300, bollard: 0, shelter: 800, column: 0, mupi: 0, billboard: 260, barrier: 0, kerbLamp: 0.6 },
  monaco:    { lamp: 36, bench: 420, bin: 300, bollard: 0, shelter: 0, column: 0, mupi: 520, billboard: 0, barrier: 0.45, kerbLamp: 1.25 },
};
const C = CITY[placeId] || CITY.paris;
// footprints (half-length, radius) used for the overlap test
const RAD = { lamp: 0.45, bench: 1.0, bin: 0.4, signal: 0.6, bollard: 0.22, shelter: 1.7, column: 0.9, mupi: 0.8, billboard: 0.7, barrier: 1.6, busstop: 0.35, hydrant: 0.3, newsbox: 0.3, steam: 0.4, subway: 1.8 };

// ---------- dense centreline ----------
const DS = 1.5;
const N = Math.floor(route.length / DS) + 1;
const SX = new Float32Array(N), SZ = new Float32Array(N), SY = new Float32Array(N), TX = new Float32Array(N), TZ = new Float32Array(N);
{ const P = {}; for (let i = 0; i < N; i++) { route.sample(Math.min(route.length, i * DS), P); SX[i] = P.x; SZ[i] = P.z; SY[i] = P.y; TX[i] = P.tx; TZ[i] = P.tz; } }
const CELL = 24, cellKey = (cx, cz) => cx * 73856093 ^ cz * 19349663;
const sgrid = new Map();
for (let i = 0; i < N; i++) { const k = cellKey(Math.floor(SX[i] / CELL), Math.floor(SZ[i] / CELL)); (sgrid.get(k) || sgrid.set(k, []).get(k)).push(i); }
// nearest point on the centreline: { d, off (signed, + = right of travel), s, x, z, y, tx, tz }
function nearestRoute(x, z, maxR) {
  let best = maxR * maxR, bi = -1;
  const r = Math.ceil(maxR / CELL);
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
    const l = sgrid.get(cellKey(cx + a, cz + b));
    if (l) for (const i of l) { const d2 = (SX[i] - x) ** 2 + (SZ[i] - z) ** 2; if (d2 < best) { best = d2; bi = i; } }
  }
  if (bi < 0) return null;
  // refine on the two adjacent segments
  let res = null, bd = Infinity;
  for (const j of [bi - 1, bi]) {
    const j2 = j + 1;
    if (j < 0 || j2 >= N) continue;
    const ax = SX[j], az = SZ[j], bx = SX[j2] - ax, bz = SZ[j2] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz || 1)));
    const fx = ax + bx * t, fz = az + bz * t, d = Math.hypot(x - fx, z - fz);
    if (d < bd) {
      bd = d;
      const tl = Math.hypot(bx, bz) || 1, tx = bx / tl, tz = bz / tl;
      res = { d, off: tx * (z - fz) - tz * (x - fx), s: (j + t) * DS, x: fx, z: fz, y: SY[j] + (SY[j2] - SY[j]) * t, tx, tz };
    }
  }
  return res;
}
const P0 = {};
const at = (s) => { route.sample(((s % route.length) + route.length) % route.length, P0); return { x: P0.x, y: P0.y, z: P0.z, tx: P0.tx, tz: P0.tz }; };

// ---------- buildings & trees (avoid) ----------
const bGrid = new Map(), BC = 32;
let nBld = 0;
try {
  const idx = JSON.parse(fs.readFileSync(`public/world/${placeId}/buildings/index.json`, 'utf8'));
  for (const k of Object.keys(idx.tiles)) {
    const f = new Float32Array(new Uint8Array(fs.readFileSync(`public/world/${placeId}/buildings/${k}.bin`)).buffer);
    for (let o = 0; o < f.length;) {
      const nr = f[o + 6]; o += 7;
      let outer = null;
      for (let r = 0; r < nr; r++) { const len = f[o]; o++; if (r === 0) outer = Array.from(f.subarray(o, o + len * 2)); o += len * 2; }
      if (!outer) continue;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let i = 0; i < outer.length; i += 2) { x0 = Math.min(x0, outer[i]); x1 = Math.max(x1, outer[i]); z0 = Math.min(z0, outer[i + 1]); z1 = Math.max(z1, outer[i + 1]); }
      const b = { ring: outer, x0, x1, z0, z1 };
      nBld++;
      for (let cx = Math.floor(x0 / BC); cx <= Math.floor(x1 / BC); cx++) for (let cz = Math.floor(z0 / BC); cz <= Math.floor(z1 / BC); cz++) (bGrid.get(cellKey(cx, cz)) || bGrid.set(cellKey(cx, cz), []).get(cellKey(cx, cz))).push(b);
    }
  }
} catch (e) { /* no buildings baked for this place (yet) */ }
function inBuilding(x, z) {
  const l = bGrid.get(cellKey(Math.floor(x / BC), Math.floor(z / BC)));
  if (!l) return false;
  for (const b of l) {
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    const r = b.ring; let c = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
    if (c) return true;
  }
  return false;
}
const tGrid = new Map(), TC = 8;
let nTrees = 0;
try {
  const dir = `public/world/${placeId}/elements`;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.bin')) continue;
    const a = new Float32Array(new Uint8Array(fs.readFileSync(`${dir}/${f}`)).buffer);
    for (let o = 0; o < a.length; o += 6) { nTrees++; const k = cellKey(Math.floor(a[o + 1] / TC), Math.floor(a[o + 3] / TC)); (tGrid.get(k) || tGrid.set(k, []).get(k)).push(a[o + 1], a[o + 3]); }
  }
} catch (e) { /* no trees */ }
function treeNear(x, z, r) {
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const l = tGrid.get(cellKey(Math.floor(x / TC) + a, Math.floor(z / TC) + b));
    if (l) for (let i = 0; i < l.length; i += 2) if ((l[i] - x) ** 2 + (l[i + 1] - z) ** 2 < r * r) return true;
  }
  return false;
}

// ---------- item store ----------
const items = []; // { type, variant, x, y, z, yaw, seed, aux, real, off, side }
const igrid = new Map(), IC = 16;
const stats = Object.fromEntries(TYPES.map((n) => [n, { real: 0, proc: 0, dropped: {} }]));
const drop = (type, why) => { const d = stats[TYPES[type]].dropped; d[why] = (d[why] || 0) + 1; return false; };
function overlaps(type, x, z) {
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const l = igrid.get(cellKey(Math.floor(x / IC) + a, Math.floor(z / IC) + b));
    if (l) for (const it of l) if ((it.x - x) ** 2 + (it.z - z) ** 2 < (RAD[TYPES[it.type]] + RAD[TYPES[type]]) ** 2) return true;
  }
  return false;
}
function nearSame(type, x, z, r, side) {
  const R = Math.ceil(r / IC);
  for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
    const l = igrid.get(cellKey(Math.floor(x / IC) + a, Math.floor(z / IC) + b));
    if (l) for (const it of l) if (it.type === type && (side === 0 || it.side === side) && (it.x - x) ** 2 + (it.z - z) ** 2 < r * r) return true;
  }
  return false;
}
// footprint corner offsets (local x along the item's length, z toward the road) used for the building test
const FOOT = { shelter: [[-1.5, -0.7], [1.5, -0.7], [-1.5, 0.7], [1.5, 0.7]], billboard: [[-3.2, 0], [3.2, 0]], bench: [[-0.9, -0.3], [0.9, 0.3]], mupi: [[0, -0.7], [0, 0.7]], subway: [[-1.7, -1], [1.7, -1], [-1.7, 1], [1.7, 1]] };
// try to add one item. pos: centreline anchor s/side/off. Returns the item or null.
function add(type, variant, x, z, y, yaw, o) {
  const t = T[type];
  const nr = nearestRoute(x, z, 30);
  if (!nr) return drop(t, 'far') || null;
  if (nr.d < E + 0.12) return drop(t, 'carriageway') || null;
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const pts = [[0, 0], ...(FOOT[type] || [])];
  for (const [lx, lz] of pts) {
    const wx = x + lx * cy + lz * sy, wz = z - lx * sy + lz * cy;
    if (inBuilding(wx, wz)) return drop(t, 'building') || null;
    if (type !== 'barrier' && !(type === 'billboard' && (lx !== 0 || lz !== 0))) { const n2 = nearestRoute(wx, wz, 30); if (n2 && n2.d < E + 0.05) return drop(t, 'carriageway') || null; }
  }
  if (!o.real && ['lamp', 'bench', 'bin', 'shelter', 'column', 'mupi', 'billboard', 'signal', 'subway', 'hydrant', 'newsbox', 'steam'].includes(type) && treeNear(x, z, type === 'lamp' || type === 'bin' || type === 'hydrant' ? 1.3 : type === 'shelter' ? 2.2 : type === 'subway' ? 2.4 : 1.6)) return drop(t, 'tree') || null;
  if (overlaps(t, x, z)) return drop(t, 'overlap') || null;
  const it = { type: t, variant, x, y, z, yaw, seed: o.seed ?? rnd(), aux: o.aux ?? 0, real: o.real ? 1 : 0, side: o.side || 0 };
  items.push(it);
  const k = cellKey(Math.floor(x / IC), Math.floor(z / IC));
  (igrid.get(k) || igrid.set(k, []).get(k)).push(it);
  stats[type][o.real ? 'real' : 'proc']++;
  return it;
}
// place by route position: s along the route, side (+1 right / -1 left of travel), off = lateral offset from the centreline
function placeAt(type, variant, s, side, off, o = {}) {
  const c = at(s);
  const nx = -c.tz * side, nz = c.tx * side; // outward normal for this side
  const x = c.x + nx * off, z = c.z + nz * off;
  const face = o.face || { x: -nx, z: -nz }; // default: front toward the road
  const yaw = Math.atan2(face.x, face.z);
  return add(type, variant, x, z, c.y + 0.1, yaw, { ...o, side });
}

// ---------- 1. OpenStreetMap ----------
function simplifyPoly(pts, tol) {
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let md = 0, mi = -1;
    const [ax, az] = pts[a], [bx, bz] = pts[b], l = Math.hypot(bx - ax, bz - az) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (az - pts[i][1]) - (ax - pts[i][0]) * (bz - az)) / l; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const dense = [];
for (let s = 0; s < route.length; s += 15) { const c = at(s); dense.push([c.x, c.z]); }
{ const c = at(route.length - 0.01); dense.push([c.x, c.z]); }
const simp = simplifyPoly(dense, 4);
const chunks = [];
const MAXLEN = placeId === 'la' ? 3000 : Infinity; // long straight routes: keep each Overpass query small
for (let i = 0; i < simp.length - 1;) {
  let j = i + 1, len = 0;
  while (j < simp.length - 1 && j - i < 110 && len + Math.hypot(simp[j][0] - simp[j - 1][0], simp[j][1] - simp[j - 1][1]) <= MAXLEN) { len += Math.hypot(simp[j][0] - simp[j - 1][0], simp[j][1] - simp[j - 1][1]); j++; }
  chunks.push(simp.slice(i, j + 1)); i = j;
}
function queryFor(pts) {
  const a = `(around:45,${pts.map(([x, z]) => `${geo.lat(z).toFixed(5)},${geo.lon(x).toFixed(5)}`).join(',')})`;
  return `[out:json][timeout:90];(nwr["highway"~"^(street_lamp|traffic_signals|bus_stop)$"]${a};nwr["amenity"~"^(bench|waste_basket|shelter)$"]${a};nwr["barrier"="bollard"]${a};nwr["advertising"]${a};nwr["public_transport"="platform"]["shelter"="yes"]${a};);out center tags;`;
}
fs.mkdirSync('data/osm', { recursive: true });
const osmFiles = [];
let osmFailed = false;
for (let ci = 0; ci < chunks.length; ci++) {
  const q = queryFor(chunks[ci]);
  const file = `data/osm/street_${placeId}_${hashStr(q).toString(16)}.json`;
  if (fs.existsSync(file)) { osmFiles.push(file); continue; }
  if (offline) { osmFailed = true; continue; }
  let ok = false, empties = 0;
  for (let attempt = 0; attempt < 6 && !ok; attempt++) {
    const ep = ENDPOINTS[(attempt + ci) % ENDPOINTS.length];
    try {
      const r = await fetch(ep, { method: 'POST', headers: { 'User-Agent': UA, 'Accept': '*/*', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(100000) });
      if (!r.ok) throw new Error(String(r.status));
      const text = await r.text();
      const j = JSON.parse(text);
      if (!Array.isArray(j.elements)) throw new Error('no elements');
      if (j.remark && /runtime error|timed out/i.test(j.remark)) throw new Error(j.remark);
      // an overloaded server sometimes answers with an empty list: only believe it when two servers agree
      if (j.elements.length === 0 && ++empties < 2) throw new Error('empty result, double-checking on another server');
      fs.writeFileSync(file + '.tmp', text); fs.renameSync(file + '.tmp', file);
      console.log(`  chunk ${ci + 1}/${chunks.length}: ${j.elements.length} elements via ${new URL(ep).host}`);
      osmFiles.push(file); ok = true;
      await sleep(4000);
    } catch (e) {
      const wait = Math.min(120000, 15000 * 2 ** attempt);
      console.log(`  chunk ${ci + 1}/${chunks.length}: ${new URL(ep).host} failed (${e.message}), retry in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  if (!ok) osmFailed = true;
}

const seenIds = new Set();
const osm = { lamp: [], signal: [], bench: [], bin: [], bollard: [], shelter: [], busstop: [], column: [], mupi: [], billboard: [] };
let rawCount = 0;
for (const f of osmFiles) {
  for (const e of JSON.parse(fs.readFileSync(f, 'utf8')).elements) {
    const id = e.type[0] + e.id;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const t = e.tags || {};
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat == null) continue;
    rawCount++;
    const p = { x: geo.x(lon), z: geo.z(lat), t, id };
    if (t.highway === 'street_lamp') osm.lamp.push(p);
    else if (t.highway === 'traffic_signals') osm.signal.push(p);
    else if (t.amenity === 'bench') osm.bench.push(p);
    else if (t.amenity === 'waste_basket') osm.bin.push(p);
    else if (t.barrier === 'bollard') osm.bollard.push(p);
    else if (t.highway === 'bus_stop') osm.busstop.push(p);
    else if (t.amenity === 'shelter' || t.public_transport === 'platform') { if (t.amenity !== 'shelter' || /bus|public_transport|^$/.test(t.shelter_type || '') || t.bus === 'yes') osm.shelter.push(p); }
    else if (t.advertising) {
      const a = t.advertising;
      if (a === 'column') osm.column.push(p);
      else if (a === 'billboard') osm.billboard.push(p);
      else osm.mupi.push(p);
    }
  }
}
const rawByType = Object.fromEntries(Object.entries(osm).map(([k, v]) => [k, v.length]));

// snap helper for real points: returns { s, side, off } or null
function snap(p, type) {
  const nr = nearestRoute(p.x, p.z, H + 14);
  if (!nr) return null;
  let side = nr.off >= 0 ? 1 : -1;
  const a = Math.abs(nr.off);
  if (a < E - 0.3 && !['lamp', 'signal', 'busstop'].includes(type)) return null; // mapped in the roadway
  if (a < 0.8) side = rnd() < 0.5 ? 1 : -1;
  return { s: nr.s, side, a };
}
const clampOff = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// -- signals: cluster nodes into junctions, then hang four heads around each --
const junctions = [];
for (const p of osm.signal) {
  const sn = snap(p, 'signal');
  if (!sn) { drop(T.signal, 'far'); continue; }
  const j = junctions.find((q) => Math.abs(q.s - sn.s) < 28 || (route.loop && Math.abs(q.s - sn.s) > route.length - 28));
  if (j) { j.n++; j.s = (j.s * (j.n - 1) + sn.s) / j.n; } else junctions.push({ s: sn.s, n: 1 });
}
const sigHeads = (s, i) => {
  const phase = rnd();
  for (const [ds, faceDriver] of [[9, true], [-9, false]]) {
    for (const side of [1, -1]) {
      const c = at(s + ds), nx = -c.tz * side, nz = c.tx * side;
      const f = faceDriver ? { x: -c.tx, z: -c.tz } : { x: c.tx, z: c.tz };
      // local +x in world = (cos yaw, -sin yaw) with yaw toward the road (-n)
      const yaw = Math.atan2(-nx, -nz), xax = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      const variant = f.x * xax.x + f.z * xax.z > 0 ? 0 : 1;
      const placed = placeAt('signal', variant, s + ds, side, E + 0.6, { real: true, aux: phase });
      if (!placed) { /* a second try a little further along */ placeAt('signal', variant, s + ds + (faceDriver ? 2.5 : -2.5), side, E + 0.6, { real: true, aux: phase }); }
    }
  }
};
junctions.forEach((j, i) => sigHeads(j.s, i));

// -- lamps --
for (const p of osm.lamp) {
  const sn = snap(p, 'lamp');
  if (!sn) { drop(T.lamp, 'far'); continue; }
  const c = at(sn.s), nxs = -c.tz * sn.side, nzs = c.tx * sn.side;
  const x = p.x, z = p.z;
  if (nearSame(T.lamp, x, z, 4, sn.side)) { drop(T.lamp, 'duplicate'); continue; }
  const lateral = clampOff(sn.a, E + C.kerbLamp - 0.1, E + C.kerbLamp + 0.9);
  placeAt('lamp', 0, sn.s, sn.side, lateral, { real: true });
}
// -- benches / bins / bollards: keep the mapped position along the route, put them inside the footpath --
for (const [type, lo, hi, def] of [['bench', 1.3, 2.4, 2.0], ['bin', 0.7, 1.9, 1.2], ['bollard', 0.3, 0.9, 0.5]]) {
  for (const p of osm[type]) {
    const sn = snap(p, type);
    if (!sn) { drop(T[type], 'far'); continue; }
    if (sn.a > H + 3) { drop(T[type], 'far'); continue; }
    const inPath = sn.a >= E - 0.2 && sn.a <= H + 0.5;
    placeAt(type, 0, sn.s, sn.side, E + clampOff(inPath ? sn.a - E : def, lo, hi), { real: true });
  }
}
// -- bus stops: shelter if mapped as sheltered, otherwise a pole --
const shelterMapped = (p) => p.t.highway === 'bus_stop' ? p.t.shelter === 'yes' : true; // plain bus_stop nodes are poles unless tagged shelter=yes
for (const p of [...osm.shelter, ...osm.busstop]) {
  const sn = snap(p, 'busstop');
  if (!sn) { drop(T.shelter, 'far'); continue; }
  const sheltered = shelterMapped(p);
  if (nearSame(T.shelter, p.x, p.z, 12, 0) || nearSame(T.busstop, p.x, p.z, 8, 0)) { drop(T.shelter, 'duplicate'); continue; }
  if (sheltered) placeAt('shelter', 0, sn.s, sn.side, H - 1.05, { real: true, aux: Math.floor(rnd() * 8) });
  else placeAt('busstop', 0, sn.s, sn.side, E + 0.7, { real: true });
}
// -- advertising --
for (const [type, off] of [['column', 1.9], ['mupi', 1.8], ['billboard', H - 0.9]]) {
  for (const p of osm[type]) {
    const sn = snap(p, type);
    if (!sn) { drop(T[type], 'far'); continue; }
    if (type !== 'billboard' && sn.a > H + 3) { drop(T[type], 'far'); continue; }
    const aux = Math.floor(rnd() * 8);
    if (type === 'mupi') {
      const c = at(sn.s), face = { x: -c.tx, z: -c.tz }; // panel faces the arriving driver, perpendicular to the kerb
      placeAt('mupi', 0, sn.s, sn.side, E + 1.8, { real: true, aux, face });
    } else if (type === 'billboard') {
      const c = at(sn.s), nx = -c.tz * sn.side, nz = c.tx * sn.side, k = Math.tan(0.44);
      const f = { x: -c.tx - nx * k, z: -c.tz - nz * k };
      placeAt('billboard', 0, sn.s, sn.side, H - 0.9, { real: true, aux, face: f });
    } else placeAt('column', 0, sn.s, sn.side, E + off, { real: true, aux });
  }
}

// ---------- 2. procedural fill ----------
const jitter = (sp) => sp * (0.78 + 0.44 * rnd());
const L = route.length;
// New York extras. Subway stairs first (they need the most room): real stations on the loop, then one every ~320 m.
// Placed a corner's width (~12 m) either side of the cross street, alternating sides, never in the road or a building.
if (C.subway) {
  const STATIONS = [[40.7553, -73.9869], [40.7506, -73.9910], [40.7497, -73.9877], [40.7428, -73.9928], [40.7378, -73.9965], [40.7545, -73.9840], [40.7583, -73.9816], [40.7646, -73.9774], [40.7413, -73.9892]];
  let flip = 1;
  const stair = (s, tries) => {
    flip = -flip;
    for (const side of [flip, -flip]) for (const sh of tries) for (const off of [1.9, 2.1, 1.7]) if (placeAt('subway', 0, s + sh, side, E + off)) return true;
    return false;
  };
  for (const [lat, lon] of STATIONS) {
    const nr = nearestRoute(geo.x(lon), geo.z(lat), 70);
    if (nr) stair(nr.s, [12, -12, 16, -16, 8, -8, 22, -22]);
  }
  for (let s = jitter(C.subway) * 0.5; s < L; s += jitter(C.subway)) {
    const c = at(s);
    if (nearSame(T.subway, c.x, c.z, 200, 0)) continue;
    stair(s, [0, 6, -6, 12, -12, 20, -20, 30, -30]);
  }
}
// hydrants (both kerbs), newspaper boxes in clusters of 2-4, Con Ed steam stacks
if (C.hydrant) for (const side of [1, -1]) for (let s = jitter(C.hydrant) * (side > 0 ? 0.4 : 0.9); s < L; s += jitter(C.hydrant)) {
  const v = rnd() < 0.65 ? 0 : 1;
  for (const sh of [0, 2, -2, 4, -4, 7]) if (placeAt('hydrant', v, s + sh, side, E + 0.5)) break;
}
if (C.newsbox) for (let s = jitter(C.newsbox) * 0.5; s < L; s += jitter(C.newsbox)) {
  const side = rnd() < 0.5 ? 1 : -1, n = 2 + Math.floor(rnd() * 3);
  for (const sh of [0, 6, -6, 12, -12]) {
    if (!placeAt('newsbox', Math.floor(rnd() * 4), s + sh, side, E + 0.55)) continue;
    for (let k = 1; k < n; k++) placeAt('newsbox', Math.floor(rnd() * 4), s + sh + k * 0.75, side, E + 0.55);
    break;
  }
}
if (C.steam) for (let s = jitter(C.steam) * 0.6; s < L; s += jitter(C.steam)) {
  const side = rnd() < 0.5 ? 1 : -1;
  for (const sh of [0, 5, -5, 10, -10, 18]) if (placeAt('steam', 0, s + sh, side, E + 0.9)) break;
}

// lamps, both sides, staggered; skipped where a lamp (real or earlier) is already within 70 % of the spacing
if (C.lamp) {
  for (const side of [1, -1]) {
    for (let s = side > 0 ? C.lamp * 0.3 : C.lamp * 0.8; s < L; s += jitter(C.lamp)) {
      const c = at(s), nx = -c.tz * side, nz = c.tx * side;
      let ok = false;
      for (const sh of [0, 1.5, -1.5, 3, -3]) {
        const cc = at(s + sh), x = cc.x - cc.tz * side * (E + C.kerbLamp), z = cc.z + cc.tx * side * (E + C.kerbLamp);
        if (nearSame(T.lamp, x, z, C.lamp * 0.7, side)) { ok = true; break; } // already served
        if (placeAt('lamp', 0, s + sh, side, E + C.kerbLamp)) { ok = true; break; }
      }
    }
  }
}
// signals: never invented. Bollards at junctions (real signal junctions), plus occasional groups of three.
if (C.bollard) {
  if (placeId === 'paris' || placeId === 'london') for (const j of junctions) if (rnd() < 0.6) { const side = rnd() < 0.5 ? 1 : -1; for (let k = 0; k < 3; k++) placeAt('bollard', 0, j.s + 12 + k * 1.7, side, E + 0.45); }
  for (let s = jitter(C.bollard); s < L; s += jitter(C.bollard)) {
    const side = rnd() < 0.5 ? 1 : -1, n = 3 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) placeAt('bollard', 0, s + k * 1.8, side, E + 0.45);
  }
}
// benches with a bin beside them
if (C.bench) for (let s = jitter(C.bench) * 0.6; s < L; s += jitter(C.bench)) {
  const side = rnd() < 0.5 ? 1 : -1;
  if (nearSame(T.bench, at(s).x, at(s).z, 60, 0)) continue;
  for (const sh of [0, 2.5, -2.5, 5]) {
    if (placeAt('bench', 0, s + sh, side, E + 2.0)) { if (rnd() < 0.75) placeAt('bin', 0, s + sh + 2.1, side, E + 1.15); break; }
  }
}
if (C.bin) for (let s = jitter(C.bin) * 0.5; s < L; s += jitter(C.bin)) {
  const side = rnd() < 0.5 ? 1 : -1;
  for (const sh of [0, 3, -3]) if (placeAt('bin', 0, s + sh, side, E + 1.15)) break;
}
// bus shelters
if (C.shelter) for (let s = jitter(C.shelter) * 0.7; s < L; s += jitter(C.shelter)) {
  const side = rnd() < 0.7 ? 1 : -1;
  if (nearSame(T.shelter, at(s).x, at(s).z, 150, 0)) continue;
  for (const sh of [0, 6, -6, 12, -12]) if (placeAt('shelter', 0, s + sh, side, H - 1.05, { aux: Math.floor(rnd() * 8) })) break;
}
// advertising
for (const [type, sp, off] of [['column', C.column, E + 1.9], ['mupi', C.mupi, E + 1.8], ['billboard', C.billboard, H - 0.9]]) {
  if (!sp) continue;
  for (let s = jitter(sp) * 0.5; s < L; s += jitter(sp)) {
    const side = type === 'billboard' ? (rnd() < 0.8 ? 1 : -1) : rnd() < 0.5 ? 1 : -1;
    if (nearSame(T[type], at(s).x, at(s).z, sp * 0.6, 0)) continue;
    for (const sh of [0, 8, -8, 16, -16, 24, -24]) {
      const ss = s + sh, c = at(ss), nx = -c.tz * side, nz = c.tx * side;
      const aux = Math.floor(rnd() * 8);
      let face;
      if (type === 'mupi') face = { x: -c.tx, z: -c.tz };
      else if (type === 'billboard') { const k = Math.tan(0.44); face = { x: -c.tx - nx * k, z: -c.tz - nz * k }; }
      if (placeAt(type, 0, ss, side, off, { aux, face })) break;
    }
  }
}
// street-circuit guard rails: runs of 4 m panels beside the track
if (C.barrier) {
  for (const side of [1, -1]) {
    let s = rnd() * 60;
    while (s < L) {
      const run = 25 + rnd() * 90;
      if (rnd() < C.barrier) for (let t = 0; t < run && s + t < L; t += 3.1) placeAt('barrier', 0, s + t + 1.5, side, E + 0.5);
      s += run + 15 + rnd() * 40;
    }
  }
}

// ---------- 3. write ----------
fs.mkdirSync(outDir, { recursive: true });
const arr = new Float32Array(items.length * 8);
items.sort((a, b) => a.type - b.type || a.x - b.x);
items.forEach((it, i) => arr.set([it.type * 16 + it.variant, it.x, it.y, it.z, it.yaw, it.seed, it.aux, it.real], i * 8));
fs.writeFileSync(`${outDir}/street.bin`, Buffer.from(arr.buffer));
const summary = Object.fromEntries(TYPES.map((n) => [n, { real: stats[n].real, procedural: stats[n].proc }]));
fs.writeFileSync(`${outDir}/index.json`, JSON.stringify({ version: 1, stride: 8, types: TYPES, count: items.length, city: placeId, osm: !osmFailed, counts: summary, credits: 'Street furniture positions © OpenStreetMap contributors' }));
fs.writeFileSync(`${outDir}/CREDITS.txt`, 'Street furniture positions © OpenStreetMap contributors (ODbL, https://www.openstreetmap.org/copyright)\n');

console.log(`\n${placeId}: ${items.length} items (OSM ${osmFailed ? 'INCOMPLETE/UNREACHABLE for some chunks' : 'complete'}; ${rawCount} raw OSM elements; ${nBld} building footprints and ${nTrees} trees checked)`);
console.log(`  raw OSM per class: ${JSON.stringify(rawByType)}; signal junctions: ${junctions.length}`);
for (const n of TYPES) {
  const s = stats[n];
  if (s.real || s.proc || Object.keys(s.dropped).length) console.log(`  ${n.padEnd(9)} real ${String(s.real).padStart(5)}   procedural ${String(s.proc).padStart(5)}   dropped ${JSON.stringify(s.dropped)}`);
}
