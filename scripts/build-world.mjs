// Builds the permanent world for a route:
//   1. downloads every map tile the game will ever ask for along the route  -> data/tiles
//      (plus the imagery the tree baker reads; `npm run prune` later drops what play doesn't need)
//   2. bakes scenery elements (trees, shrubs, rocks) at their real positions -> public/world/<route>/elements
// Usage: node scripts/build-world.mjs [routeId] [--download-only | --bake-only]
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { getTile } from '../vite.config.js';
import { Geo, lon2tx, lat2ty, tx2lon, ty2lat } from '../src/geo.js';
import { Route } from '../src/route.js';
import { planPlay } from './tileplan.mjs';

const routeId = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'bryce';
const only = process.argv.find((a) => a.startsWith('--')) || '';
const data = JSON.parse(fs.readFileSync(`public/routes/${routeId}.json`, 'utf8'));
const geo = new Geo(data.origin.lat, data.origin.lon);
const route = new Route(data);

const SCN = { trees: 'pine', shrubs: true, rocks: true, ...(data.scenery || {}) };
const HALF = data.road?.half || 5;
// metres either side of the road that get baked elements (street canyons hide everything further away)
const BAKE_RADIUS = SCN.radius || (data.kind === 'city' ? 320 : data.kind === 'circuit' ? 700 : 1100);
const TREE_KIND = SCN.trees === 'broadleaf' ? 3 : 0;
const EDGE = HALF - (data.road?.style === 'city' ? 3.6 : 1.65);
// street trees (city): near the road only a fraction survive and they are smaller, except inside listed parks
//   scenery.streetTrees = keep fraction; scenery.parks = [{lat, lon, r}] circles or [{north: lat}] half-planes
const STREET_KEEP = SCN.streetTrees ?? 1;
const PARKS = (SCN.parks || []).map((p) => (p.north != null ? { zMax: geo.z(p.north) } : { x: geo.x(p.lon), z: geo.z(p.lat), r: p.r || 150 }));
const inPark = (x, z) => PARKS.some((p) => (p.zMax != null ? z < p.zMax : (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r));
const TREE_GRID = TREE_KIND === 3 ? 9.0 : 6.4; // metres between candidate trees (broad crowns need room)

// building footprints (if this place has baked buildings): no trees inside them
const footprints = new Map(); // 32 m cell -> [ring]
{
  const bdir = `public/world/${routeId}/buildings`;
  if (fs.existsSync(`${bdir}/index.json`)) {
    let nb = 0;
    for (const f of fs.readdirSync(bdir).filter((f) => f.endsWith('.bin'))) {
      const buf = fs.readFileSync(path.join(bdir, f));
      const a = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      let i = 0;
      while (i < a.length) {
        const nRings = a[i + 6]; i += 7;
        for (let r = 0; r < nRings; r++) {
          const len = a[i++], ring = a.subarray(i, i + len * 2); i += len * 2;
          if (r > 0) continue;
          let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
          for (let k = 0; k < len; k++) { x0 = Math.min(x0, ring[k * 2]); x1 = Math.max(x1, ring[k * 2]); z0 = Math.min(z0, ring[k * 2 + 1]); z1 = Math.max(z1, ring[k * 2 + 1]); }
          for (let cx = Math.floor((x0 - 2) / 32); cx <= Math.floor((x1 + 2) / 32); cx++)
            for (let cz = Math.floor((z0 - 2) / 32); cz <= Math.floor((z1 + 2) / 32); cz++) {
              const k = `${cx},${cz}`; (footprints.get(k) || footprints.set(k, []).get(k)).push(ring);
            }
          nb++;
        }
      }
    }
    console.log(`  ${nb} building footprints loaded: trees are kept off them`);
  }
}
function inBuilding(x, z) {
  const list = footprints.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`);
  if (!list) return false;
  for (const ring of list) {
    let inside = false;
    for (let i = 0, n = ring.length / 2, j = n - 1; i < n; j = i++) {
      const xi = ring[i * 2], zi = ring[i * 2 + 1], xj = ring[j * 2], zj = ring[j * 2 + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
// does this imagery pixel look like tree canopy? conifers are dark; broadleaf street/park trees are brighter
const canopy = TREE_KIND === 3
  ? (r, g, b, lum) => g >= r * 1.03 && g > b * 1.1 && lum < 135 && lum > 22
  : (r, g, b, lum) => g >= r * 0.98 && lum < 105 && g > b * 1.04;
const EZ = 15; // element files are per z15 tile

// ---------- 1. which tiles does the game need? ----------
// (the game's own tile rule walked along the route: scripts/tileplan.mjs, src/tiles.js)
const need = planPlay(data);
const P = {};

// element tiles + the z17 imagery the baker reads
const etiles = new Set();
for (let s = 0; s <= route.length; s += 100) {
  route.sample(s, P);
  for (let a = 0; a < 8; a++) {
    const x = P.x + Math.cos((a * Math.PI) / 4) * BAKE_RADIUS, z = P.z + Math.sin((a * Math.PI) / 4) * BAKE_RADIUS;
    etiles.add(`${Math.floor(lon2tx(geo.lon(x), EZ))}/${Math.floor(lat2ty(geo.lat(z), EZ))}`);
  }
}
for (const k of etiles) {
  const [x, y] = k.split('/').map(Number);
  need.elev.add(`${EZ}/${x}/${y}`);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) need.img.add(`17/${x * 4 + i}/${y * 4 + j}`);
}

async function download() {
  const jobs = [...[...need.elev].map((k) => ['elev', k]), ...[...need.img].map((k) => ['img', k])];
  console.log(`route ${routeId}: ${need.elev.size} elevation + ${need.img.size} imagery tiles needed`);
  let done = 0, failed = 0, i = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (i < jobs.length) {
      const [kind, k] = jobs[i++];
      const [z, x, y] = k.split('/').map(Number);
      try { await getTile(kind, z, x, y); } catch { failed++; }
      if (++done % 1000 === 0) console.log(`  ${done}/${jobs.length} (${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  };
  await Promise.all(Array.from({ length: 24 }, worker));
  console.log(`download complete: ${done} tiles, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

// ---------- 2. bake elements ----------
const elevCache = new Map();
async function elevTile(x, y) {
  const k = `${x}/${y}`;
  if (!elevCache.has(k)) {
    const png = PNG.sync.read(await getTile('elev', EZ, x, y));
    const out = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) out[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
    if (elevCache.size > 40) elevCache.delete(elevCache.keys().next().value);
    elevCache.set(k, out);
  }
  return elevCache.get(k);
}
function bil(d, px, py) {
  px = Math.min(255, Math.max(0, px)); py = Math.min(255, Math.max(0, py));
  const x0 = px | 0, y0 = py | 0, x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1), ax = px - x0, ay = py - y0;
  return (d[y0 * 256 + x0] * (1 - ax) + d[y0 * 256 + x1] * ax) * (1 - ay) + (d[y1 * 256 + x0] * (1 - ax) + d[y1 * 256 + x1] * ax) * ay;
}

// ---------- ecology (optional: places/<id>.json -> scenery.ecology / vistas / rimGlimpse; see places/README.md) ----------
// Species by elevation, noisy open parkland, varying road setback, Red Canyon sparseness, overlook view wedges.
let PCFG = {};
try { PCFG = JSON.parse(fs.readFileSync(`places/${routeId}.json`, 'utf8')).scenery || {}; } catch {}
const ECO = PCFG.ecology ? { bands: [2250, 2500, 2650], elevJitter: 45, clear: [8, 25], ...PCFG.ecology } : null;
const VISTAS = ECO ? (PCFG.vistas || []).map((v) => ({ x: geo.x(v.lon), z: geo.z(v.lat), r: v.r || 70, ext: v.ext || 150 })) : [];
const GLIMPSE = ECO && PCFG.rimGlimpse ? { rim: 150, drop: 20, reach: 90, keep: 0.35, ...PCFG.rimGlimpse } : null;
const ecoCount = {};
const hash2 = (ix, iz, sd) => { let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(sd, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (((h ^ (h >>> 16)) >>> 0) % 100000) / 100000; };
const sst = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const vnoise = (x, z, sc, sd) => {
  const fx = x / sc, fz = z / sc, ix = Math.floor(fx), iz = Math.floor(fz), ax = fx - ix, az = fz - iz;
  const sx = ax * ax * (3 - 2 * ax), sz = az * az * (3 - 2 * az);
  return (hash2(ix, iz, sd) * (1 - sx) + hash2(ix + 1, iz, sd) * sx) * (1 - sz) + (hash2(ix, iz + 1, sd) * (1 - sx) + hash2(ix + 1, iz + 1, sd) * sx) * sz;
};
// road samples every 8 m with a 100 m grid: nearest road point (distance, route s, side) for any position
const RSTEP = 8, RCELL = 100, rd = { s: [], x: [], z: [], tx: [], tz: [], y: [], rim: [], grid: new Map() };
let elevAtFn = null;
if (ECO) {
  const q = {};
  for (let s = 0, i = 0; s <= route.length; s += RSTEP, i++) {
    route.sample(s, q);
    rd.s.push(s); rd.x.push(q.x); rd.z.push(q.z); rd.tx.push(q.tx); rd.tz.push(q.tz); rd.y.push(q.y); rd.rim.push(0);
    const k = `${Math.floor(q.x / RCELL)},${Math.floor(q.z / RCELL)}`;
    (rd.grid.get(k) || rd.grid.set(k, []).get(k)).push(i);
  }
}
function roadAt(x, z, R = 100) {
  const cx = Math.floor(x / RCELL), cz = Math.floor(z / RCELL);
  let best = R * R, bi = -1;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const a = rd.grid.get(`${cx + dx},${cz + dz}`);
    if (!a) continue;
    for (let k = 0; k < a.length; k++) { const i = a[k], ex = rd.x[i] - x, ez = rd.z[i] - z, d2 = ex * ex + ez * ez; if (d2 < best) { best = d2; bi = i; } }
  }
  return bi < 0 ? null : { i: bi, d: Math.sqrt(best), s: rd.s[bi], side: Math.sign(rd.tx[bi] * (z - rd.z[bi]) - rd.tz[bi] * (x - rd.x[bi])) || 1 };
}
async function ecoPrepass() {
  const at = async (x, z) => {
    const fx = lon2tx(geo.lon(x), EZ), fy = lat2ty(geo.lat(z), EZ);
    const d = await elevTile(Math.floor(fx), Math.floor(fy));
    return bil(d, (fx - Math.floor(fx)) * 256 - 0.5, (fy - Math.floor(fy)) * 256 - 0.5);
  };
  let lo = 1e9, hi = -1e9; const prof = [];
  for (let s = 0; s <= route.length; s += 100) { const y = rd.y[Math.min(rd.y.length - 1, Math.round(s / RSTEP))]; lo = Math.min(lo, y); hi = Math.max(hi, y); if (s % 4000 === 0) prof.push(`${s / 1000}km:${y.toFixed(0)}m`); }
  console.log(`  ecology: road elevation ${lo.toFixed(0)}..${hi.toFixed(0)} m  [${prof.join(' ')}]`);
  // overlook view wedges point toward the steepest drop within ~300 m
  for (const v of VISTAS) {
    const e0 = await at(v.x, v.z); let bestA = 0, bestD = -1e9;
    for (let a = 30; a <= 150; a += 10) { // canyon is on the east side
      let m = 0, c = 0;
      for (const da of [-20, 0, 20]) for (const rr of [120, 200, 300]) { const t = ((a + da) * Math.PI) / 180; m += await at(v.x + Math.sin(t) * rr, v.z - Math.cos(t) * rr); c++; }
      if (e0 - m / c > bestD) { bestD = e0 - m / c; bestA = a; }
    }
    const t = (bestA * Math.PI) / 180; v.dx = Math.sin(t); v.dz = -Math.cos(t);
    console.log(`  vista ${geo.lat(v.z).toFixed(4)},${geo.lon(v.x).toFixed(4)}: ${e0.toFixed(0)} m, drop ${bestD.toFixed(0)} m toward bearing ${bestA}`);
  }
  // south-half glimpses: which road samples have the rim (a big drop) within `rim` m, and on which side
  if (GLIMPSE) {
    let n = 0;
    for (let i = 0; i < rd.s.length; i++) {
      if (rd.s[i] < GLIMPSE.s[0] || rd.s[i] > GLIMPSE.s[1] || i % 3) continue;
      for (const sd of [1, -1]) {
        const ux = -rd.tz[i] * sd, uz = rd.tx[i] * sd; // unit vector to that side (roadAt's side = sign(tx*dz - tz*dx))
        if (ux < 0.2) continue; // canyon side = east
        if ((await at(rd.x[i] + ux * GLIMPSE.rim, rd.z[i] + uz * GLIMPSE.rim)) < rd.y[i] - GLIMPSE.drop) {
          for (let k = Math.max(0, i - 1); k <= Math.min(rd.s.length - 1, i + 1); k++) rd.rim[k] = sd;
          n++;
        }
      }
    }
    console.log(`  ecology: ${n} rim-side road samples (of ${Math.round((GLIMPSE.s[1] - GLIMPSE.s[0]) / (RSTEP * 3))}) get glimpse thinning`);
  }
}
// 0 = clear (view wedge core) .. 1 = untouched
function vistaKeep(x, z) {
  let k = 1;
  for (const v of VISTAS) {
    const ex = x - v.x, ez = z - v.z, a = ex * v.dx + ez * v.dz, l = ex * -v.dz + ez * v.dx;
    if (a < -45 || a > v.ext + 40) continue;
    const w = v.r + 0.15 * Math.max(a, 0);
    const kk = Math.max(sst(w * 0.55, w, Math.abs(l)), sst(v.ext * 0.8, v.ext + 40, a), sst(-25, -45, a) );
    k = Math.min(k, Math.max(0.04, kk));
  }
  return k;
}
// one candidate tree -> [code, scale] or null. `keep` is the existing uniform roll that decides survival.
function ecoTree(p, keep, vr, sc, lum) {
  const road = roadAt(p.x, p.z);
  const s = road ? road.s : -1, d = road ? road.d : 99;
  // zone parameters from the route position
  let dens = 1, clear = ECO.clear, lowJ = 0;
  const inS = (r) => s >= r[0] && s <= r[1];
  const rc = ECO.redCanyon;
  const red = rc && inS(rc.s);
  if (red) { dens = rc.density ?? 0.3; clear = rc.clear || [20, 45]; }
  for (const o of ECO.openSections || []) if (inS(o.s)) dens *= o.density ?? 0.8;
  for (const c of ECO.keepClear || []) if (road && Math.abs(s - c.s) < c.r && d < (c.lateral || 70)) return null;
  // road setback varies along the road and per side (mowed shoulder, meadow edge), the odd tree closer
  if (road) {
    const sd = road.side > 0 ? 11 : 12;
    const cl = clear[0] + (clear[1] - clear[0]) * vnoise(s, 0, 150, sd) * (0.5 + 0.5 * vnoise(s, 7, 40, sd + 5));
    if (d < HALF + 5.5) return null;
    if (d < cl && !(keep < 0.03)) return null;
    if (road.i >= 0 && GLIMPSE && rd.rim[road.i] === road.side && d < GLIMPSE.reach && vr > GLIMPSE.keep) return null; // window onto the drop
  }
  const vk = VISTAS.length ? vistaKeep(p.x, p.z) : 1;
  if (vk < 1 && keep * 1.28 > vk * 1.0) return null;
  // elevation with a noisy offset so zone boundaries are ragged, not contour lines
  const [b0, b1, b2] = ECO.bands;
  const ee = p.y + (vnoise(p.x, p.z, 260, 3) - 0.5) * 2 * ECO.elevJitter + (vnoise(p.x, p.z, 45, 4) - 0.5) * 30;
  const stand = vnoise(p.x, p.z, 130, 1);            // open glade (low) .. dense stand (high)
  const young = vnoise(p.x, p.z, 70, 2);             // young groups
  const grove = vnoise(p.x, p.z, 110, 6);            // aspen clones
  // density by zone: juniper woodland open, ponderosa parkland open + glades, mixed forest denser, spruce-fir closed
  const dPark = 0.18 + 0.82 * sst(0.3, 0.7, stand);
  const dZone = 0.55 * (1 - sst(b0 - 60, b0 + 60, ee)) + dPark * 0.62 * sst(b0 - 60, b0 + 60, ee) * (1 - sst(b1 - 20, b1 + 120, ee))
    + (0.45 + 0.4 * sst(0.25, 0.6, stand)) * sst(b1 - 20, b1 + 120, ee) * (1 - sst(b2, b2 + 80, ee)) + (0.7 + 0.3 * stand) * sst(b2, b2 + 80, ee);
  if (keep > 0.78 * dens * Math.min(1, dZone * 1.15)) return null;
  // species weights
  const wJ = red ? 0.5 : 1 - sst(b0 - 20, b0 + 150, ee);
  const wA = sst(b0 + 120, b1 + 60, ee) * (grove > 0.6 ? sst(0.6, 0.72, grove) * 3 : 0);
  const wF4 = sst(b1 - 20, b2 - 20, ee) * 0.7;
  const wF3 = sst(b1 + 110, b2 + 110, ee) * 1.5;
  const wP = (red ? 0.8 : 0.35 + 0.65 * sst(b0 - 80, b0 + 100, ee)) * (1 - 0.8 * sst(b2, b2 + 130, ee));
  const wS = wJ * (red ? 1 : 1) + wA + wF4 + wF3 + wP;
  let t = vr * wS, code, scale;
  const j = sc;
  if ((t -= wJ) < 0) { code = 6; scale = 0.75 + j * 0.6; }
  else if ((t -= wA) < 0) { code = 5; scale = 0.8 + j * 0.5; }
  else if ((t -= wF4) < 0) { code = 4; scale = 0.8 + j * 0.55; }
  else if ((t -= wF3) < 0) { code = 3; scale = 0.8 + j * 0.6; }
  else {
    // ponderosa: young groups, mostly mature, a few big old trees
    const r2 = (vr * 7919) % 1;
    if (young > 0.66 && r2 < 0.7) { code = 0; scale = 0.7 + j * 0.45; }
    else if (r2 > 0.93) { code = 2; scale = 1.1 + j * 0.35; }
    else if (r2 < 0.12) { code = 0; scale = 0.75 + j * 0.45; }
    else { code = r2 < 0.65 ? 1 : 2; scale = 0.78 + j * 0.5; }
  }
  if (lum < 70 && code < 3) scale *= 1.08;
  ecoCount[code] = (ecoCount[code] || 0) + 1;
  return [code, scale];
}

// The game draws the ground pulled toward the road level next to the road (src/terrain.js buildGeometry, finest
// tiles: rIn = max(half + 0.6, step * 0.8), rOut = min(62, rIn * 2.2 + 5)); bake the same, or things float there.
const FLAT_STEP = 3.8; // metres between terrain vertices on the finest (z17) tiles at these latitudes, roughly
const FLAT_IN = Math.max(HALF + 0.6, FLAT_STEP * 0.8), FLAT_OUT = Math.min(62, FLAT_IN * 2.2 + 5);
function drawnGround(x, z, h) {
  const d = route.nearest(x, z, FLAT_OUT);
  if (d < 0) return h;
  const t = Math.min(1, Math.max(0, (d - FLAT_IN) / (FLAT_OUT - FLAT_IN)));
  return h + (route.nearY - 0.1 - h) * (1 - t * t * (3 - 2 * t));
}

// coarse "near the road" mask
const CELL = 128, nearMask = new Set();
for (let s = 0; s <= route.length; s += 60) {
  route.sample(s, P);
  const r = Math.ceil(BAKE_RADIUS / CELL);
  const cx = Math.floor(P.x / CELL), cz = Math.floor(P.z / CELL);
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (dx * dx + dz * dz <= r * r) nearMask.add(`${cx + dx},${cz + dz}`);
}

async function bakeTile(tx, ty) {
  const elev = await elevTile(tx, ty);
  let seed = (((tx * 73856093) ^ (ty * 19349663)) >>> 0) % 2147483646 + 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = [];
  const tileM = geo.x(tx2lon(tx + 1, EZ)) - geo.x(tx2lon(tx, EZ));
  const mpp = tileM / 256; // metres per elevation pixel
  for (let sj = 0; sj < 4; sj++)
    for (let si = 0; si < 4; si++) {
      const ix = tx * 4 + si, iy = ty * 4 + sj;
      const x0 = geo.x(tx2lon(ix, 17)), x1 = geo.x(tx2lon(ix + 1, 17));
      if (!nearMask.has(`${Math.floor(((x0 + x1) / 2) / CELL)},${Math.floor(geo.z(ty2lat(iy + 0.5, 17)) / CELL)}`)) {
        // quick reject using the sub-tile centre; borders are handled per element below
      }
      let img;
      try { img = jpeg.decode(await getTile('img', 17, ix, iy), { useTArray: true, formatAsRGBA: true }); } catch { continue; }
      if (img.width !== 256) continue;
      const px = img.data;
      const sample = (u, v) => {
        // 3x3 average around the pixel
        const cx = Math.min(254, Math.max(1, (u * 256) | 0)), cy = Math.min(254, Math.max(1, (v * 256) | 0));
        let r = 0, g = 0, b = 0;
        for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const k = ((cy + a) * 256 + cx + c) * 4; r += px[k]; g += px[k + 1]; b += px[k + 2]; }
        return [r / 9, g / 9, b / 9];
      };
      const place = (u, v) => {
        const x = x0 + (x1 - x0) * u, z = geo.z(ty2lat(iy + v, 17));
        const epx = (si + u) * 64 - 0.5, epy = (sj + v) * 64 - 0.5;
        return { x, z, y: drawnGround(x, z, route.paved ? route.cityGround(x, z, bil(elev, epx, epy)) : bil(elev, epx, epy)), slope: Math.hypot(bil(elev, epx + 1, epy) - bil(elev, epx - 1, epy), bil(elev, epx, epy + 1) - bil(elev, epx, epy - 1)) / (2 * mpp) };
      };
      const size = x1 - x0;
      // --- trees: jittered grid, kept where the imagery shows canopy ---
      const n = Math.floor(size / TREE_GRID);
      // tree crowns are rough (lit tops, dark gaps); lawns and fields are smooth: measure local contrast
      const rough = (u, v) => {
        const cx = Math.min(252, Math.max(3, (u * 256) | 0)), cy = Math.min(252, Math.max(3, (v * 256) | 0));
        let a = 0, a2 = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const k = ((cy + dy) * 256 + cx + dx) * 4, l = (px[k] + px[k + 1] + px[k + 2]) / 3; a += l; a2 += l * l; }
        return Math.sqrt(Math.max(0, a2 / 49 - (a / 49) ** 2));
      };
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const u = (i + rnd()) / n, v = (j + rnd()) / n, keep = rnd(), vr = rnd(), sc = rnd(), rot = rnd();
          const [r, g, b] = sample(u, v);
          const lum = (r + g + b) / 3;
          if (!SCN.trees || !canopy(r, g, b, lum) || (!ECO && keep > 0.78)) continue;
          if (TREE_KIND === 3 && rough(u, v) < 8) continue; // grass, not trees
          const p = place(u, v);
          if (!nearMask.has(`${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`)) continue;
          if (ECO) { const t = ecoTree(p, keep, vr, sc, lum); if (t) out.push(t[0], p.x, p.y - 0.35, p.z, t[1], rot * 6.2832); continue; }
          if (route.nearest(p.x, p.z, data.kind === 'circuit' ? HALF + 9 : TREE_KIND === 3 ? EDGE + 1.2 : HALF + 5.5) >= 0) continue;
          if (inBuilding(p.x, p.z)) continue;
          // avenue frontage: few, small trees (reuses the keep roll so the random stream is unchanged)
          let shrink = 1;
          if (STREET_KEEP < 1 && route.nearest(p.x, p.z, HALF + 9) >= 0 && !inPark(p.x, p.z)) { if (keep > 0.78 * STREET_KEEP) continue; shrink = 0.7; }
          const variant = vr < 0.3 ? 0 : vr < 0.75 ? 1 : 2;
          // darker canopy = denser/older stand = slightly bigger trees
          out.push(TREE_KIND * 8 + variant, p.x, p.y - 0.35, p.z, (0.72 + sc * 0.55) * (lum < 70 ? 1.1 : 1) * shrink, rot * 6.2832);
        }
      // --- shrubs and rocks: only close to the road, on open ground ---
      // (rock variants 3-5 = the same models in Red Canyon: elements.js tints them rust red)
      const m = SCN.shrubs || SCN.rocks ? Math.floor(size / 3.2) : 0;
      for (let j = 0; j < m; j++)
        for (let i = 0; i < m; i++) {
          const u = (i + rnd()) / m, v = (j + rnd()) / m, a = rnd(), b2 = rnd(), sc = rnd(), rot = rnd();
          const x = x0 + (x1 - x0) * u, z = geo.z(ty2lat(iy + v, 17));
          const d = route.nearest(x, z, 62);
          if (d < HALF + 2) continue;
          const [r, g, b] = sample(u, v);
          const lum = (r + g + b) / 3;
          if (canopy(r, g, b, lum)) continue; // under canopy
          const p = place(u, v);
          const fade = 1 - (d - 7) / 55; // denser near the road where you can see them
          const greenish = g > b * 1.1 && lum < 150;
          if (SCN.shrubs && a < (greenish ? 0.14 : 0.035) * (0.4 + 0.6 * fade)) out.push(1 * 8 + (b2 < 0.55 ? 0 : 1), p.x, p.y - 0.08, p.z, 0.7 + sc * 0.8, rot * 6.2832);
          else if (SCN.rocks && a > 1 - (p.slope > 0.4 ? 0.09 : 0.006)) { if (ECO && 0.5 + sc * sc * 1.6 > 1 && VISTAS.length && vistaKeep(x, z) < 0.6) continue; const rcS = ECO?.redCanyon && roadAt(p.x, p.z); out.push(2 * 8 + ((b2 * 3) | 0) + (rcS && rcS.s >= ECO.redCanyon.s[0] && rcS.s <= ECO.redCanyon.s[1] ? 3 : 0), p.x, p.y - 0.15, p.z, 0.5 + sc * sc * 1.6, rot * 6.2832); }
        }
    }
  return new Float32Array(out);
}

async function bake() {
  const dir = `public/world/${routeId}/elements`;
  fs.mkdirSync(dir, { recursive: true });
  const index = {};
  const counts = [0, 0, 0, 0];
  let n = 0;
  if (ECO) await ecoPrepass();
  for (const k of etiles) {
    const [tx, ty] = k.split('/').map(Number);
    const arr = await bakeTile(tx, ty);
    for (let i = 0; i < arr.length; i += 6) counts[arr[i] >> 3]++;
    if (arr.length) {
      fs.writeFileSync(path.join(dir, `${tx}_${ty}.bin`), Buffer.from(arr.buffer));
      index[`${tx}_${ty}`] = arr.length / 6;
    }
    if (++n % 20 === 0) console.log(`  baked ${n}/${etiles.size} tiles`);
  }
  fs.writeFileSync(`public/world/${routeId}/elements/index.json`, JSON.stringify({ z: EZ, stride: 6, kinds: ['pine', 'shrub', 'rock', 'broadleaf'], tiles: index }));
  if (ECO) console.log(`  tree variants (kind 0): ${Object.entries(ecoCount).sort().map(([k, v]) => `${k}:${v}`).join('  ')}`);
  console.log(`bake complete: ${counts[0] + counts[3]} trees, ${counts[1]} shrubs, ${counts[2]} rocks in ${Object.keys(index).length} tiles`);
}

if (only !== '--bake-only') await download();
if (only !== '--download-only') await bake();
