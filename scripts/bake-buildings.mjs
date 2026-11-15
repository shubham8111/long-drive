// Bakes real OpenStreetMap buildings along a route into per-z15-tile binaries.
//   node --max-old-space-size=6144 scripts/bake-buildings.mjs <placeId> [--offline]
// Raw Overpass responses are cached forever in data/osm/ (a re-run never re-downloads).
// Output: public/world/<id>/buildings/{<tx>_<ty>.bin, index.json, CREDITS.txt}
//
// Tile format (Float32 stream, one record after another):
//   [seed, code, colour, base, minH, topH, nRings,  ringLen, x0, z0, x1, z1, ...  (per ring)]
//   seed   0..16777215 (stable per building)         code   cls | mat << 4
//   colour 0 = none, else 1 + 0xRRGGBB (OSM building:colour)
//   base   ground height (m, already sunk ~1.5 m)    minH   wall bottom above base (m)
//   topH   roof height above base (m)                ring 0 = outer, others = holes. Local metres.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { getTile } from '../vite.config.js';
import { Geo, lon2tx, lat2ty } from '../src/geo.js';
import { Route } from '../src/route.js';

const placeId = process.argv[2];
if (!placeId) { console.error('usage: bake-buildings.mjs <placeId>'); process.exit(1); }
const offline = process.argv.includes('--offline');
const data = JSON.parse(fs.readFileSync(`public/routes/${placeId}.json`, 'utf8'));
if (!data.scenery?.buildings) { console.log(`${placeId}: scenery.buildings is off, nothing to do`); process.exit(0); }
const geo = new Geo(data.origin.lat, data.origin.lon);
const route = new Route(data);
const HALF = data.road?.half || 5;
const RADIUS = data.kind === 'circuit' ? 500 : 400;
const EZ = 15, SINK = 1.5;
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'long-drive-game/1.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. download (chunked polyline corridors, cached) ----------
const P = {};
const poly = [];
for (let s = 0; s <= route.length; s += 60) { route.sample(s, P); poly.push([geo.lat(P.z), geo.lon(P.x)]); }
if (route.loop) poly.push(poly[0]);
const CHUNK_PTS = 24; // ~1.4 km of road per query
const chunks = [];
for (let i = 0; i < poly.length - 1; i += CHUNK_PTS - 1) chunks.push(poly.slice(i, Math.min(poly.length, i + CHUNK_PTS)));
fs.mkdirSync('data/osm', { recursive: true });

function queryFor(pts) {
  const c = pts.map(([la, lo]) => `${la.toFixed(5)},${lo.toFixed(5)}`).join(',');
  const a = `(around:${RADIUS},${c})`;
  return `[out:json][timeout:120];(way["building"]${a};way["building:part"]${a};relation["building"]${a};relation["building:part"]${a};);out geom;`;
}
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };

// a corridor chunk that keeps failing (dense city centre = huge answer) is split in two and retried
async function fetchPts(pts, label) {
  const q = queryFor(pts);
  const file = `data/osm/${placeId}_${hash(q.replace(/timeout:\d+/, ''))}.json`;
  if (fs.existsSync(file)) return [file];
  if (offline) return [];
  let empties = 0;
  const nyc = /new york|manhattan/i.test(`${data.region} ${data.name}`); // (it has a fallback: give up on Overpass sooner)
  const maxAttempts = pts.length > 8 ? 2 : nyc ? 3 : 8;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ep = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const r = await fetch(ep, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(110000) });
      if (!r.ok) throw new Error(`${r.status}`);
      const text = await r.text();
      const j = JSON.parse(text);
      if (!Array.isArray(j.elements)) throw new Error('no elements');
      if (j.remark && /runtime error|timed out/i.test(j.remark)) throw new Error(j.remark);
      // an overloaded server sometimes answers with an empty list: only believe it when both servers agree, and in
      // a city never (there are always buildings within a few hundred metres of the road)
      if (j.elements.length === 0 && (data.kind === 'city' || ++empties < 2)) throw new Error('empty result, double-checking on the other server');
      fs.writeFileSync(file + '.tmp', text);
      fs.renameSync(file + '.tmp', file);
      console.log(`  ${label} (${pts.length} pts): ${j.elements.length} elements (${(text.length / 1e6).toFixed(1)} MB) via ${new URL(ep).host}`);
      await sleep(1500);
      return [file];
    } catch (e) {
      const wait = Math.min(60000, 4000 * 2 ** attempt);
      console.log(`  ${label} (${pts.length} pts): ${new URL(ep).host} failed (${e.message}), retry in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  if (pts.length > 8) {
    const mid = pts.length >> 1;
    console.log(`  ${label}: splitting into two smaller queries`);
    return [...(await fetchPts(pts.slice(0, mid + 1), label + 'a')), ...(await fetchPts(pts.slice(mid), label + 'b'))];
  }
  // New York: the city's own open building footprints (NYC Open Data) stand in when Overpass will not answer
  if (/new york|manhattan/i.test(`${data.region} ${data.name}`)) {
    const file2 = file.replace('.json', '.nyc.json');
    try { return [await fetchNYC(pts, file2, label)]; } catch (e) { console.log(`  ${label}: NYC Open Data failed too (${e.message})`); }
  }
  throw new Error(`${label} failed permanently`);
}

// NYC Open Data "Building Footprints" (data.cityofnewyork.us, dataset 5zhs-2jue): outline, roof height
// (feet) and construction year for every building in the city. Written in Overpass's shape so the rest
// of the bake reads it like OpenStreetMap; ids are kept apart (nyc...), duplicates are dropped later.
async function fetchNYC(pts, out, label) {
  if (fs.existsSync(out)) return out;
  let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
  for (const [la, lo] of pts) { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); }
  const dLa = RADIUS / 111000, dLo = RADIUS / (111000 * Math.cos((la0 * Math.PI) / 180));
  la0 -= dLa; la1 += dLa; lo0 -= dLo; lo1 += dLo;
  const poly = `POLYGON((${lo0} ${la0}, ${lo1} ${la0}, ${lo1} ${la1}, ${lo0} ${la1}, ${lo0} ${la0}))`;
  const elements = [];
  for (let off = 0; ; off += 5000) {
    const q = new URLSearchParams({ $select: 'the_geom,bin,height_roof,construction_year,name', $where: `intersects(the_geom, '${poly}')`, $limit: '5000', $offset: String(off), $order: 'bin' });
    const r = await fetch(`https://data.cityofnewyork.us/resource/5zhs-2jue.json?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`${r.status}`);
    const rows = await r.json();
    for (const row of rows) {
      const h = parseFloat(row.height_roof) * 0.3048;
      if (!(h > 2) || !row.the_geom?.coordinates) continue;
      row.the_geom.coordinates.forEach((polyc, k) => {
        const ring = polyc[0];
        if (!ring || ring.length < 4) return;
        const tags = { building: 'yes', height: h.toFixed(1), source: 'nyc' };
        if (row.name) tags.name = row.name;
        if (row.construction_year) tags.start_date = row.construction_year;
        elements.push({ type: 'way', id: `nyc${row.bin}_${k}`, tags, geometry: ring.map(([lon, lat]) => ({ lat, lon })) });
      });
    }
    if (rows.length < 5000) break;
  }
  if (!elements.length) throw new Error('no buildings');
  fs.writeFileSync(out, JSON.stringify({ elements }));
  console.log(`  ${label}: ${elements.length} buildings from NYC Open Data`);
  return out;
}

// ---------- geometry helpers ----------
const area2 = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a; }; // signed*2
function inPoly(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if ((r[i][1] > z) !== (r[j][1] > z) && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
}
function simplify(r) {
  let o = r.slice();
  if (o.length > 1 && Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]) < 0.01) o.pop();
  let ch = true;
  while (ch && o.length > 3) {
    ch = false;
    const n = [];
    for (let i = 0; i < o.length; i++) {
      const a = o[(i + o.length - 1) % o.length], b = o[i], c = o[(i + 1) % o.length];
      const d1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const cr = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / (Math.hypot(c[0] - a[0], c[1] - a[1]) || 1);
      if (n.length && (d1 < 0.3 || cr < 0.06) && o.length - (o.length - n.length - 1) > 3) { ch = true; continue; }
      n.push(b);
    }
    if (n.length >= 3) o = n; else break;
  }
  return o;
}
const toLocal = (g) => g.map((p) => [geo.x(p.lon), geo.z(p.lat)]);

// stitch member ways into closed rings
function assemble(ways) {
  const segs = ways.filter((w) => w.length > 1).map((w) => w.slice());
  const key = (p) => p.lat.toFixed(7) + ',' + p.lon.toFixed(7);
  const rings = [];
  while (segs.length) {
    let cur = segs.pop();
    let guard = 0;
    while (key(cur[0]) !== key(cur[cur.length - 1]) && guard++ < 5000) {
      const end = key(cur[cur.length - 1]);
      let found = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (key(s[0]) === end) { cur = cur.concat(s.slice(1)); segs.splice(i, 1); found = true; break; }
        if (key(s[s.length - 1]) === end) { cur = cur.concat(s.slice(0, -1).reverse()); segs.splice(i, 1); found = true; break; }
      }
      if (!found) break;
    }
    if (cur.length >= 4 && key(cur[0]) === key(cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

// ---------- tag parsing ----------
function parseLen(v) {
  if (v == null) return null;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(m|meters?|metres?|ft|feet|')?/i.exec(String(v).split(';')[0]);
  if (!m) return null;
  let x = parseFloat(m[1].replace(',', '.'));
  if (m[2] && /^(ft|feet|')$/i.test(m[2])) x *= 0.3048;
  return Number.isFinite(x) ? x : null;
}
const num = (v) => { const x = parseFloat(String(v ?? '').split(';')[0].replace(',', '.')); return Number.isFinite(x) ? x : null; };
const NAMED = { white: 0xf2f0e8, grey: 0x9a9a9a, gray: 0x9a9a9a, red: 0xa0453a, brown: 0x7a5a45, beige: 0xd8c8a8, yellow: 0xe0c878, black: 0x303030, cream: 0xeadfc2, orange: 0xc87a40, tan: 0xc8aa84, green: 0x6a8a62, blue: 0x6a84a8, pink: 0xd8a8a0, silver: 0xbcbcc0, darkgrey: 0x606060 };
function parseColour(v) {
  if (!v) return 0;
  const s = String(v).trim().toLowerCase();
  let m = /^#?([0-9a-f]{6})$/.exec(s);
  if (m) return 1 + parseInt(m[1], 16);
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return 1 + parseInt(m[1] + m[1] + m[2] + m[2] + m[3] + m[3], 16);
  return NAMED[s] ? 1 + NAMED[s] : 0;
}
const CLS = {
  house: 1, detached: 1, semidetached_house: 1, terrace: 1, bungalow: 1, cabin: 1, farm: 1, residential: 2, apartments: 2, dormitory: 2, houseboat: 1,
  commercial: 3, office: 3, retail: 3, supermarket: 3, hotel: 3, mixed_use: 3, kiosk: 3,
  industrial: 4, warehouse: 4, factory: 4, garage: 4, garages: 4, shed: 4, service: 4, carport: 4, roof: 4, hangar: 4, barn: 4, parking: 4, greenhouse: 4, storage_tank: 4, transformer_tower: 4,
  church: 5, cathedral: 5, chapel: 5, civic: 5, public: 5, government: 5, school: 5, university: 5, hospital: 5, museum: 5, train_station: 5, transportation: 5, kindergarten: 5, college: 5, mosque: 5, synagogue: 5, temple: 5, monastery: 5,
  grandstand: 6, stadium: 6, sports_hall: 6, sports_centre: 6, pavilion: 6,
};
const MAT = { brick: 1, glass: 2, concrete: 3, reinforced_concrete: 3, stone: 4, limestone: 4, sandstone: 4, granite: 4, marble: 4, plaster: 5, stucco: 5, render: 5, metal: 6, steel: 6, aluminium: 6, wood: 7, timber_framing: 7 };
const SMALL = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'cabin', 'farm', 'houseboat']);
const LOW = new Set(['garage', 'garages', 'shed', 'carport', 'roof', 'kiosk', 'greenhouse', 'hut', 'service', 'transformer_tower', 'storage_tank', 'parking', 'barn', 'pavilion']);
const rndOf = (seed, k = 0) => { let h = (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const CITY_DEFAULT = { manhattan: 26, paris: 20, london: 14, monaco: 22, la: 8, spa: 6, silverstone: 5 };

// ---------- 2. parse ----------
const files = [];
// older runs named their cache <id>_<chunk>_<hash of the 240 s query>.json
chunks.forEach((c, i) => {
  const q = queryFor(c);
  const legacy = `data/osm/${placeId}_${i}_${hash(q.replace('timeout:120', 'timeout:240'))}.json`;
  const now = `data/osm/${placeId}_${hash(q.replace(/timeout:\d+/, ''))}.json`;
  if (fs.existsSync(legacy) && !fs.existsSync(now)) fs.renameSync(legacy, now);
});
if (offline) {
  // offline: use every cached response of this place (the route may have been re-generated since; overlaps are de-duplicated)
  for (const f of fs.readdirSync('data/osm')) if (f.startsWith(placeId + '_') && f.endsWith('.json') && fs.statSync('data/osm/' + f).size > 400) files.push('data/osm/' + f);
} else for (let i = 0; i < chunks.length; i++) files.push(...(await fetchPts(chunks[i], `chunk ${i + 1}/${chunks.length}`)));
if (!files.length) { console.log('no data'); process.exit(0); }
const seen = new Set();
const blds = []; // { id, rings:[[x,z]...] outer first, tags, part, area, cx, cz }
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const e of j.elements) {
    const k = e.type[0] + e.id;
    if (seen.has(k)) continue;
    seen.add(k);
    const t = e.tags || {};
    const isPart = !t.building && !!t['building:part'];
    if (!t.building && !t['building:part']) continue;
    if (t.building === 'no' || t.location === 'underground' || t.tunnel === 'yes' || t.building === 'tunnel') continue;
    let rings = [];
    if (e.type === 'way') {
      if (!e.geometry || e.geometry.length < 4) continue;
      const g = e.geometry;
      if (Math.abs(g[0].lat - g[g.length - 1].lat) > 1e-9 || Math.abs(g[0].lon - g[g.length - 1].lon) > 1e-9) continue;
      rings = [toLocal(g)];
    } else if (e.type === 'relation') {
      if (t.type && t.type !== 'multipolygon' && t.type !== 'building') continue;
      const outer = (e.members || []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry);
      const inner = (e.members || []).filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => m.geometry);
      const outs = assemble(outer).map(toLocal).map(simplify), ins = assemble(inner).map(toLocal).map(simplify);
      for (const o of outs) {
        if (o.length < 3) continue;
        const holes = ins.filter((h) => h.length >= 3 && inPoly(h[0][0], h[0][1], o));
        blds.push(mk(e, t, [o, ...holes], isPart));
      }
      continue;
    }
    rings = rings.map(simplify);
    if (rings[0].length < 3) continue;
    blds.push(mk(e, t, rings, isPart));
  }
}
function mk(e, t, rings, part) {
  const o = rings[0];
  let a = area2(o);
  if (a < 0) { o.reverse(); a = -a; }
  for (let i = 1; i < rings.length; i++) if (area2(rings[i]) > 0) rings[i].reverse();
  let area = a / 2, cx = 0, cz = 0;
  for (const p of o) { cx += p[0]; cz += p[1]; }
  cx /= o.length; cz /= o.length;
  for (let i = 1; i < rings.length; i++) area -= Math.abs(area2(rings[i])) / 2;
  // (NYC Open Data ids are text: hashed to a number, which seeds each building's look)
  const num = typeof e.id === 'number' ? e.id : parseInt(hash(String(e.id)), 16) % 2000000000;
  return { id: e.type[0] + e.id, num, rings, tags: t, part, area, cx, cz };
}
// footprints from NYC Open Data that stand where OpenStreetMap already has a building (where the corridors
// of a fetched and a stand-in chunk overlap) are dropped
{
  const osm = blds.filter((b) => b.tags.source !== 'nyc' && !b.part), grid = new Map();
  for (const b of osm) { const k = gk0(b.cx, b.cz); (grid.get(k) || grid.set(k, []).get(k)).push(b); }
  const before = blds.length;
  for (let i = blds.length - 1; i >= 0; i--) {
    const b = blds[i];
    if (b.tags.source !== 'nyc') continue;
    let dup = false;
    for (let dx = -1; dx <= 1 && !dup; dx++) for (let dz = -1; dz <= 1 && !dup; dz++) for (const o of grid.get(gk0(b.cx, b.cz, dx, dz)) || []) if (inPoly(b.cx, b.cz, o.rings[0])) { dup = true; break; }
    if (dup) blds.splice(i, 1);
  }
  if (before !== blds.length) console.log(`  ${before - blds.length} NYC Open Data footprints already in OpenStreetMap: dropped`);
}
function gk0(x, z, dx = 0, dz = 0) { return (Math.floor(x / 64) + dx) * 100003 + Math.floor(z / 64) + dz; }
console.log(`${placeId}: ${blds.length} footprints parsed from ${files.length} responses`);

// ---------- 3. parts vs outlines ----------
const G = 64;
const gk = (x, z) => Math.floor(x / G) * 100003 + Math.floor(z / G);
const partGrid = new Map();
for (const b of blds) if (b.part) { const k = gk(b.cx, b.cz); (partGrid.get(k) || partGrid.set(k, []).get(k)).push(b); }
let hidden = 0;
for (const b of blds) {
  if (b.part) continue;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of b.rings[0]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  let sum = 0;
  const inside = [];
  for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++)
    for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++)
      for (const p of partGrid.get(gx * 100003 + gz) || []) if (inPoly(p.cx, p.cz, b.rings[0])) { sum += p.area; inside.push(p); }
  b.parts = inside;
  if (inside.length && sum >= 0.6 * b.area) { b.hide = true; hidden++; for (const p of inside) p.parent = p.parent || b; }
}

// ---------- 4. heights ----------
function tagged(b) {
  const t = b.tags;
  let h = parseLen(t.height) ?? parseLen(t['building:height']);
  if (h == null) {
    const lv = num(t['building:levels']);
    if (lv != null && lv > 0) h = lv * 3.3 + 1 + (num(t['roof:levels']) || 0) * 2.5;
  }
  let mh = parseLen(t.min_height);
  if (mh == null) { const ml = num(t['building:min_level']); if (ml != null) mh = ml * 3.3; }
  return { h, mh: mh ?? 0 };
}
const nbSum = new Map();
const NB = 160;
const nk = (x, z) => Math.floor(x / NB) * 100003 + Math.floor(z / NB);
for (const b of blds) {
  const th = tagged(b);
  b.h = th.h; b.mh = th.mh; b.tagged = th.h != null;
  if (b.tagged && !b.part && th.h > 3) { const k = nk(b.cx, b.cz); const s = nbSum.get(k) || { s: 0, n: 0 }; s.s += Math.log(th.h); s.n++; nbSum.set(k, s); }
}
function neighbourMean(x, z) {
  let s = 0, n = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const v = nbSum.get(nk(x + dx * NB, z + dz * NB)); if (v) { s += v.s; n += v.n; } }
  return n >= 3 ? Math.exp(s / n) : null;
}
const defH = CITY_DEFAULT[placeId] ?? 8;
function guessHeight(b) {
  const type = b.tags.building || 'yes';
  const r = rndOf(b.num, 1), r2 = rndOf(b.num, 2);
  const a = b.area;
  let nb = neighbourMean(b.cx, b.cz) ?? defH;
  if (SMALL.has(type)) return 5.5 + r * 3.5;
  if (LOW.has(type)) return type === 'storage_tank' ? 8 + r * 6 : 3 + r * 1.5;
  if (type === 'cathedral') return 24 + r * 10;
  if (type === 'church' || type === 'mosque' || type === 'temple' || type === 'synagogue') return 12 + r * 8;
  if (type === 'chapel') return 7 + r * 3;
  if (type === 'stadium') return 16 + r * 8;
  if (type === 'grandstand') return 9 + r * 4;
  if (type === 'sports_hall' || type === 'sports_centre') return 9 + r * 3;
  if (type === 'industrial' || type === 'warehouse' || type === 'factory' || type === 'hangar') return 7 + r * 5;
  if (type === 'retail' || type === 'supermarket') return a > 1500 ? 8 + r * 3 : 4.5 + r * 4;
  let h = nb * (0.65 + 0.7 * r);
  if (a < 50) h *= 0.55;
  else if (a < 120) h *= 0.8;
  else if (a > 1500) h *= 1.15;
  if (placeId === 'la' || placeId === 'spa' || placeId === 'silverstone') { if (a < 220) h = Math.min(h, 7 + r2 * 3); }
  if (type === 'apartments' || type === 'hotel' || type === 'office' || type === 'commercial') h = Math.max(h, 10 + r2 * 6) * (placeId === 'la' ? 0.7 : 1);
  return Math.min(Math.max(h, 3.3 * 2), Math.max(nb * 1.8 + 8, 12));
}
for (const b of blds) if (b.h == null && !b.part) b.h = guessHeight(b);
// parts: untagged inherit from the outline they sit in
for (const b of blds) if (b.part && b.h == null) b.h = b.parent?.h ?? tagged(b).h ?? guessHeight(b);
for (const b of blds) if (b.part && b.tags['building:part'] && b.parent?.mh != null && b.mh === 0 && !b.parent.hide) b.mh = 0;

// ---------- 5. elevation + road filter ----------
const elevCache = new Map();
async function elevTile(x, y) {
  const k = `${x}/${y}`;
  if (!elevCache.has(k)) {
    let out = null;
    try {
      const png = PNG.sync.read(await getTile('elev', EZ, x, y));
      out = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) out[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
    } catch (e) { out = null; }
    if (elevCache.size > 30) elevCache.delete(elevCache.keys().next().value);
    elevCache.set(k, out);
  }
  return elevCache.get(k);
}
function bil(d, px, py) {
  px = Math.min(255, Math.max(0, px)); py = Math.min(255, Math.max(0, py));
  const x0 = px | 0, y0 = py | 0, x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1), ax = px - x0, ay = py - y0;
  return (d[y0 * 256 + x0] * (1 - ax) + d[y0 * 256 + x1] * ax) * (1 - ay) + (d[y1 * 256 + x0] * (1 - ax) + d[y1 * 256 + x1] * ax) * ay;
}
async function groundAt(x, z) {
  const fx = lon2tx(geo.lon(x), EZ), fy = lat2ty(geo.lat(z), EZ);
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const el = await elevTile(tx, ty);
  let h = el ? bil(el, (fx - tx) * 256 - 0.5, (fy - ty) * 256 - 0.5) : 0;
  if (route.paved) h = route.cityGround(x, z, h); // cities: the levelled "city floor" (route.js), same as the terrain uses
  // terrain is flattened to the road height near the road (see terrain.js): same blend
  const d = route.nearest(x, z, 62);
  if (d >= 0) {
    const rIn = HALF + 0.6, rOut = 62, t = Math.min(1, Math.max(0, (d - rIn) / (rOut - rIn))), w = 1 - t * t * (3 - 2 * t);
    const hr = route.nearY - 0.1;
    // within ~24 m the terrain really is the road height; further out it follows the data. Take the lower of the two models
    const hb = h + (hr - h) * w;
    h = d < 24 ? hb : Math.min(h, hb);
  }
  return h;
}
function hitsRoad(b) {
  const lim = HALF - 1.0;
  const o = b.rings[0];
  for (let i = 0; i < o.length; i++) {
    const a = o[i], c = o[(i + 1) % o.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / 2));
    for (let k = 0; k < n; k++) {
      const x = a[0] + ((c[0] - a[0]) * k) / n, z = a[1] + ((c[1] - a[1]) * k) / n;
      const d = route.nearest(x, z, lim + 1);
      if (d >= 0 && d < lim) return true;
    }
  }
  // road passing through the footprint (arcades, tunnels, mapping errors)
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of o) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  for (let i = 0; i < route.n; i++) {
    const x = route.pts[i * 3], z = route.pts[i * 3 + 2];
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && inPoly(x, z, o)) return true;
  }
  return false;
}

// ---------- 6. write ----------
const outDir = `public/world/${placeId}/buildings`;
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const tiles = new Map();
const st = { kept: 0, tagged: 0, tiny: 0, road: 0, hidden, tallest: 0, tallestId: '', parts: 0 };
const z15 = (x, z) => `${Math.floor(lon2tx(geo.lon(x), EZ))}_${Math.floor(lat2ty(geo.lat(z), EZ))}`;
let done = 0;
for (const b of blds) {
  if (++done % 20000 === 0) console.log(`  processed ${done}/${blds.length}`);
  if (b.hide) continue;
  if (b.area < 12) { st.tiny++; continue; }
  if (hitsRoad(b)) { st.road++; continue; }
  // base: lowest ground under the footprint, sunk so slopes never show a gap
  let base = Infinity;
  const o = b.rings[0];
  const step = Math.max(1, Math.floor(o.length / 12));
  for (let i = 0; i < o.length; i += step) base = Math.min(base, await groundAt(o[i][0], o[i][1]));
  base = Math.min(base, await groundAt(b.cx, b.cz)) - SINK;
  const type = b.tags.building || (b.tags['building:part'] === 'yes' ? 'yes' : b.tags['building:part']) || 'yes';
  const cls = CLS[type] ?? 0;
  const mat = MAT[String(b.tags['building:material'] || b.tags['building:cladding'] || '').split(';')[0]] ?? 0;
  const mh = Math.max(0, b.mh || 0);
  const top = Math.max(b.h, mh + 2) + SINK;
  const colour = parseColour(b.tags['building:colour'] || b.tags.colour);
  const seed = (Number(BigInt(b.num) * 2654435761n % 16777216n)) | 0;
  const rec = [seed, cls | (mat << 4), colour, base, mh ? mh + SINK : 0, top, b.rings.length];
  for (const r of b.rings) { rec.push(r.length); for (const p of r) rec.push(p[0], p[1]); }
  const tk = z15(b.cx, b.cz);
  (tiles.get(tk) || tiles.set(tk, { rec: [], n: 0 }).get(tk));
  const T = tiles.get(tk);
  for (const v of rec) T.rec.push(v);
  T.n++;
  st.kept++;
  if (b.tagged) st.tagged++;
  if (b.part) st.parts++;
  if (b.h > st.tallest) { st.tallest = b.h; st.tallestId = b.id + ' ' + (b.tags.name || ''); }
}
let bytes = 0;
const index = {};
for (const [k, T] of tiles) {
  const arr = new Float32Array(T.rec);
  fs.writeFileSync(path.join(outDir, `${k}.bin`), Buffer.from(arr.buffer));
  index[k] = T.n;
  bytes += arr.byteLength;
}
fs.writeFileSync(`${outDir}/index.json`, JSON.stringify({ z: EZ, version: 1, tiles: index }));
fs.writeFileSync(`${outDir}/CREDITS.txt`, 'Buildings © OpenStreetMap contributors (ODbL, https://www.openstreetmap.org/copyright)\n');
console.log(`${placeId}: ${st.kept} buildings (${st.parts} parts), ${(100 * st.tagged / Math.max(1, st.kept)).toFixed(0)}% with height/levels tags; dropped: ${st.tiny} tiny, ${st.road} on the road, ${st.hidden} outlines replaced by parts`);
console.log(`  tallest ${st.tallest.toFixed(0)} m (${st.tallestId}); ${tiles.size} tiles, ${(bytes / 1e6).toFixed(2)} MB`);
