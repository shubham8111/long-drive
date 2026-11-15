// Bakes the real street network around a city route (cross streets, parallel streets) from OpenStreetMap.
//   node scripts/bake-roads.mjs <placeId> [--offline]
// Raw Overpass responses (ways only, `out geom`, ~220 m corridor, one query per ~3 km of route) are cached forever
// in data/osm/roads_<place>_*.json. Output: public/world/<id>/roads/{roads.bin, index.json, CREDITS.txt}
//
// roads.bin: one Float32 stream, records grouped per 288 m cell (index.json: cells["i_j"] = [floatOffset, floatCount]):
//   piece : [1, cls, halfWidth, footpath, flags, n, (x, y, z) * n]
//           cls 0 trunk/motorway, 1 primary, 2 secondary, 3 tertiary, 4 residential/unclassified, 5 living_street, 6 service, 7 pedestrian
//           flags: 1 one-way (flow follows vertex order), 2 bridge, 4 start is a junction, 8 end is a junction, (flags >> 4) & 3 = layer tie-break 0..2
//   disc  : [2, x, y, z, radius]                      filled junction area (plain asphalt)
//   decal : [3, x, y, z, tx, tz, lateral, halfWidth, length, kind]   kind 0 zebra, 1 stop line; (tx,tz) = street direction
//           pointing away from the main road, lateral = offset along the right-hand normal of (tx,tz)
// index.json also lists `junctions`: cross streets meeting the route [{x, z, s, side (+1 right of travel), hw, cls, angle}].
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { getTile } from '../vite.config.js';
import { Geo, lon2tx, lat2ty } from '../src/geo.js';
import { Route } from '../src/route.js';

const placeId = process.argv[2];
if (!placeId) { console.error('usage: bake-roads.mjs <placeId> [--offline]'); process.exit(1); }
const offline = process.argv.includes('--offline');
const data = JSON.parse(fs.readFileSync(`public/routes/${placeId}.json`, 'utf8'));
const geo = new Geo(data.origin.lat, data.origin.lon);
const route = new Route(data);
const H = route.road.half;
const outDir = `public/world/${placeId}/roads`;
const UA = 'long-drive-game/1.0';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const CORRIDOR = 220, KEEP = 245, STEP = 3, CELL = 288, EZ = 15;

// ---------- dense route centreline for nearest queries ----------
const DS = 2;
const N = Math.floor(route.length / DS) + 1;
const SX = new Float32Array(N), SZ = new Float32Array(N), TX = new Float32Array(N), TZ = new Float32Array(N);
{ const P = {}; for (let i = 0; i < N; i++) { route.sample(Math.min(route.length - 0.01, i * DS), P); SX[i] = P.x; SZ[i] = P.z; TX[i] = P.tx; TZ[i] = P.tz; } }
const RC = 32, rkey = (a, b) => a * 73856093 ^ b * 19349663;
const sgrid = new Map();
for (let i = 0; i < N; i++) { const k = rkey(Math.floor(SX[i] / RC), Math.floor(SZ[i] / RC)); (sgrid.get(k) || sgrid.set(k, []).get(k)).push(i); }
function nearestRoute(x, z, maxR) {
  let best = maxR * maxR, bi = -1;
  const r = Math.ceil(maxR / RC), cx = Math.floor(x / RC), cz = Math.floor(z / RC);
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
    const l = sgrid.get(rkey(cx + a, cz + b));
    if (l) for (const i of l) { const d2 = (SX[i] - x) ** 2 + (SZ[i] - z) ** 2; if (d2 < best) { best = d2; bi = i; } }
  }
  return bi < 0 ? null : { d: Math.sqrt(best), s: bi * DS, tx: TX[bi], tz: TZ[bi], x: SX[bi], z: SZ[bi] };
}

// ---------- elevation (same model the terrain and buildings use) ----------
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
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
async function groundAt(x, z) {
  const fx = lon2tx(geo.lon(x), EZ), fy = lat2ty(geo.lat(z), EZ);
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const el = await elevTile(tx, ty);
  let h = el ? bil(el, (fx - tx) * 256 - 0.5, (fy - ty) * 256 - 0.5) : 0;
  if (route.paved) h = route.cityGround(x, z, h);
  const rIn = H + 0.6, rOut = Math.min(62, rIn * 2.2 + 5); // as terrain.js flattens near the road
  const d = route.nearest(x, z, rOut);
  if (d >= 0) h += (route.nearY - 0.1 - h) * (1 - smooth(rIn, rOut, d));
  return h;
}

// ---------- widths ----------
const CLS = { motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 3, unclassified: 4, residential: 4, living_street: 5, service: 6, pedestrian: 7 };
const CITY = {
  manhattan: { w: [18, 16, 13, 10.5, 10.5, 6, 4, 6], fp: [3.5, 4, 4, 3.6, 3.6, 2, 0, 0] },
  paris: { w: [16, 14, 10, 8, 7, 5, 3.5, 6], fp: [3, 3.5, 3, 3, 2.8, 1.5, 0, 0] },
  london: { w: [16, 13, 10, 8.5, 7, 5, 3.5, 6], fp: [2.5, 3, 2.6, 2.5, 2.4, 1.5, 0, 0] },
  monaco: { w: [16, 12, 9, 7.5, 6.5, 5, 3.5, 6], fp: [2.5, 3, 2.5, 2.2, 2, 1.5, 0, 0] },
  la: { w: [20, 16, 13, 10.5, 9, 6, 4.5, 6], fp: [0, 3, 3, 2.5, 2.5, 1.5, 0, 0] },
};
const WTAB = CITY[placeId] || CITY.paris;
const num = (v) => { if (v == null) return NaN; const m = /^\s*(\d+(?:\.\d+)?)/.exec(String(v)); return m ? +m[1] * (/ft|'/.test(String(v)) ? 0.3048 : 1) : NaN; };
function widthOf(t, cls, oneway) {
  let w = num(t.width);
  if (!(w >= 2.5 && w <= 45)) {
    const ln = num(t.lanes);
    if (ln >= 1) {
      w = (oneway ? ln : Math.max(2, ln)) * 3.2;
      for (const k of ['parking:lane:both', 'parking:lane:left', 'parking:lane:right', 'parking:both', 'parking:left', 'parking:right'])
        if (t[k] && !/^(no|no_parking|no_stopping|separate|none)$/.test(t[k])) w += k.endsWith('both') ? 4 : 2;
      w = Math.min(34, Math.max(cls >= 6 ? 3 : 5, w));
      if (cls >= 3 && cls <= 4) w = Math.max(w, WTAB.w[cls] * 0.8);
    } else w = WTAB.w[cls];
  }
  return w;
}

// ---------- Overpass ----------
const dense = [];
for (let s = 0; s < route.length; s += 15) { const P = {}; route.sample(s, P); dense.push([P.x, P.z]); }
{ const P = {}; route.sample(route.length - 0.01, P); dense.push([P.x, P.z]); }
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
const simp = simplifyPoly(dense, 5);
const chunks = [];
for (let i = 0; i < simp.length - 1;) {
  let j = i + 1, len = 0;
  while (j < simp.length - 1 && j - i < 90 && len + Math.hypot(simp[j][0] - simp[j - 1][0], simp[j][1] - simp[j - 1][1]) <= 3000) { len += Math.hypot(simp[j][0] - simp[j - 1][0], simp[j][1] - simp[j - 1][1]); j++; }
  chunks.push(simp.slice(i, j + 1)); i = j;
}
const HW = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian)(_link)?$';
const queryFor = (pts) => `[out:json][timeout:120];way["highway"~"${HW}"](around:${CORRIDOR},${pts.map(([x, z]) => `${geo.lat(z).toFixed(5)},${geo.lon(x).toFixed(5)}`).join(',')});out geom;`;
fs.mkdirSync('data/osm', { recursive: true });
const osmFiles = [];
let failed = 0;
console.log(`${placeId}: route ${(route.length / 1000).toFixed(1)} km, ${chunks.length} queries`);
// one cached query; null when every attempt failed
async function fetchChunk(pts, label, attempts) {
  const q = queryFor(pts);
  const file = `data/osm/roads_${placeId}_${hashStr(q).toString(16)}.json`;
  if (fs.existsSync(file)) return [file];
  if (offline) return null;
  let empties = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ep = ENDPOINTS[(attempt + label.length) % ENDPOINTS.length];
    try {
      const r = await fetch(ep, { method: 'POST', headers: { 'User-Agent': UA, 'Accept': '*/*', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(130000) });
      if (!r.ok) throw new Error(String(r.status));
      const text = await r.text();
      const j = JSON.parse(text);
      if (!Array.isArray(j.elements)) throw new Error('no elements');
      if (j.remark && /runtime error|timed out/i.test(j.remark)) throw new Error(j.remark);
      if (j.elements.length === 0 && ++empties < 2) throw new Error('empty result, double-checking');
      fs.writeFileSync(file + '.tmp', text); fs.renameSync(file + '.tmp', file);
      console.log(`  query ${label}: ${j.elements.length} ways via ${new URL(ep).host}`);
      await sleep(5000);
      return [file];
    } catch (e) {
      const wait = Math.min(180000, 20000 * 2 ** attempt);
      console.log(`  query ${label}: ${new URL(ep).host} failed (${e.message}), retry in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  // a big query that keeps failing: try it as two halves (smaller queries are much kinder to Overpass)
  if (pts.length >= 6) {
    const m = pts.length >> 1;
    const a = await fetchChunk(pts.slice(0, m + 1), label + 'a', 4);
    const b = a && (await fetchChunk(pts.slice(m), label + 'b', 4));
    return a && b ? [...a, ...b] : null;
  }
  return null;
}
for (let ci = 0; ci < chunks.length; ci++) {
  const r = await fetchChunk(chunks[ci], `${ci + 1}/${chunks.length}`, 5);
  if (r) osmFiles.push(...r); else { failed++; console.log(`  query ${ci + 1} gave up`); }
}
if (failed && !process.argv.includes('--partial')) { console.log(`${placeId}: ${failed}/${chunks.length} queries failed; nothing written`); process.exit(2); }

// ---------- ways ----------
const ways = new Map();
for (const f of osmFiles) for (const e of JSON.parse(fs.readFileSync(f, 'utf8')).elements) if (e.type === 'way' && e.geometry && !ways.has(e.id)) ways.set(e.id, e);
const nodeDeg = new Map(); // osm node id -> degree (way ends count 1, interior occurrences 2)
const usable = [];
for (const w of ways.values()) {
  const t = w.tags || {}, m = /^(.*?)(_link)?$/.exec(t.highway || '');
  if (!m || !(m[1] in CLS)) continue;
  const cls = CLS[m[1]];
  w.nodes.forEach((id, i) => nodeDeg.set(id, (nodeDeg.get(id) || 0) + (i === 0 || i === w.nodes.length - 1 ? 1 : 2)));
  if (t.area === 'yes' || (t.tunnel && t.tunnel !== 'no') || t.covered === 'yes' || +t.layer < 0 || /^(private|no)$/.test(t.access || '')) continue;
  if (cls === 6 && /^(driveway|parking_aisle|drive-through|emergency_access)$/.test(t.service || '')) continue;
  if (w.nodes.length < 2) continue;
  usable.push(w);
}

const nodeInfo = new Map(); // junction discs
const pieces = [];
const decals = [];
const junctions = [];
let clippedWays = 0, wayLen = 0;
for (const w of usable) {
  const t = w.tags, hwy = /^(.*?)(_link)?$/.exec(t.highway)[1], cls = CLS[hwy];
  let oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1' || t.junction === 'roundabout' || t.oneway === 'true';
  let pts = w.geometry.map((g, i) => ({ x: geo.x(g.lon), z: geo.z(g.lat), id: w.nodes[i] }));
  if (t.oneway === '-1') pts.reverse();
  // quick reject: no vertex within reach
  let any = false;
  for (const p of pts) if (nearestRoute(p.x, p.z, KEEP + 60)) { any = true; break; }
  if (!any) continue;
  // densify to STEP
  const D = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(l / STEP));
    for (let k = 1; k < n; k++) D.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n, id: 0 });
    D.push(b);
  }
  // classify samples
  const rm = new Uint8Array(D.length); // 1 = too far, 2 = parallel to / on the main road
  const dd = new Float32Array(D.length), cs = new Float32Array(D.length);
  for (let i = 0; i < D.length; i++) {
    const a = D[Math.max(0, i - 1)], b = D[Math.min(D.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nr = nearestRoute(D[i].x, D[i].z, KEEP + 5);
    dd[i] = nr ? nr.d : 999; D[i].s = nr ? nr.s : -1;
    cs[i] = nr ? Math.abs(tx * nr.tx + tz * nr.tz) : 0;
    D[i].tx = tx; D[i].tz = tz;
    if (!nr || nr.d > KEEP) rm[i] = 1;
    else if (nr.d < H + 2 && cs[i] > 0.8) rm[i] = 2;
  }
  // runs
  for (let i = 0; i < D.length;) {
    if (rm[i]) { i++; continue; }
    let j = i;
    while (j + 1 < D.length && !rm[j + 1]) j++;
    const seg = D.slice(i, j + 1);
    const dl = dd.slice(i, j + 1), cl = cs.slice(i, j + 1);
    const startJ = i === 0 ? (nodeDeg.get(D[0].id) >= 3) : rm[i - 1] === 2;
    const endJ = j === D.length - 1 ? (nodeDeg.get(D[D.length - 1].id) >= 3) : rm[j + 1] === 2;
    // split at interior junction nodes so every piece ends where streets meet (markings fade there)
    const cuts = [0];
    for (let k = 1; k < seg.length - 1; k++) if (seg[k].id && nodeDeg.get(seg[k].id) >= 3) cuts.push(k);
    cuts.push(seg.length - 1);
    for (let ci = 0; ci + 1 < cuts.length; ci++) {
      const sub = seg.slice(cuts[ci], cuts[ci + 1] + 1), sdl = dl.slice(cuts[ci], cuts[ci + 1] + 1), scl = cl.slice(cuts[ci], cuts[ci + 1] + 1);
      const sJ = ci === 0 ? startJ : true, eJ = ci + 2 === cuts.length ? endJ : true;
      let len = 0;
      for (let k = 1; k < sub.length; k++) len += Math.hypot(sub[k].x - sub[k - 1].x, sub[k].z - sub[k - 1].z);
      const minLen = cls === 6 ? 40 : 4;
      if (sub.length < 2 || len < minLen) continue;
      const hw = widthOf(t, cls, oneway) / 2, fp = WTAB.fp[cls];
      pieces.push({ cls, hw, fp, flags: (oneway ? 1 : 0) | (t.bridge && t.bridge !== 'no' ? 2 : 0) | (sJ ? 4 : 0) | (eJ ? 8 : 0) | ((w.id % 3) << 4), pts: sub, dl: sdl, cl: scl, name: t.name || '', way: w.id });
      wayLen += len;
      for (const [p, k] of [[sub[0], 0], [sub[sub.length - 1], sub.length - 1]]) {
        if (!p.id || nodeDeg.get(p.id) < 3) continue;
        const ni = nodeInfo.get(p.id) || nodeInfo.set(p.id, { x: p.x, z: p.z, r: 0, d: sdl[k], w: 0 }).get(p.id);
        ni.r = Math.max(ni.r, hw + (fp > 0 ? 1.2 : 0.6)); ni.w++;
      }
    }
    i = j + 1;
  }
  clippedWays++;
}
console.log(`${placeId}: ${ways.size} ways downloaded, ${pieces.length} pieces, ${(wayLen / 1000).toFixed(1)} km kept`);

// ---------- junctions with the route + crosswalk decals ----------
const ZT = H + 3.4;
for (const pc of pieces) {
  if (pc.cls >= 6 && pc.cls !== 6) continue;
  const q = pc.pts;
  for (let k = 1; k < q.length; k++) {
    const a = pc.dl[k - 1], b = pc.dl[k];
    if (!((a < ZT && b >= ZT) || (a >= ZT && b < ZT))) continue;
    // must really come from the main road: the street reaches within the ribbon nearby
    let near = false;
    for (let m = Math.max(0, k - 8); m <= Math.min(q.length - 1, k + 8); m++) if (pc.dl[m] < H - 1) near = true;
    if (!near || pc.cl[k] > 0.6) continue;
    const outward = b >= ZT ? 1 : -1;
    const f = (ZT - a) / (b - a || 1);
    const x = q[k - 1].x + (q[k].x - q[k - 1].x) * f, z = q[k - 1].z + (q[k].z - q[k - 1].z) * f;
    let tx = (q[k].x - q[k - 1].x) * outward, tz = (q[k].z - q[k - 1].z) * outward;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nr = nearestRoute(x, z, 60);
    if (!nr) continue;
    const side = (-nr.tz) * (x - nr.x) + nr.tx * (z - nr.z) >= 0 ? 1 : -1;
    if (junctions.some((j) => Math.abs(j.s - nr.s) < 9 && j.side === side)) continue;
    junctions.push({ x: +x.toFixed(2), z: +z.toFixed(2), s: +nr.s.toFixed(1), side, hw: +pc.hw.toFixed(2), cls: pc.cls, angle: +(Math.acos(Math.min(1, pc.cl[k])) * 57.3).toFixed(0) });
    decals.push({ x, z, tx, tz, hw: pc.hw, cls: pc.cls, oneway: pc.flags & 1, outward, kind: 0, fp: pc.fp });
  }
}
// ---------- heights, simplification, cell cutting ----------
const records = new Map(); // cell key -> float array
const cellOf = (x, z) => `${Math.floor(x / CELL)}_${Math.floor(z / CELL)}`;
const push = (key, arr) => { let c = records.get(key); if (!c) records.set(key, (c = [])); for (const v of arr) c.push(v); };
let nVerts = 0, nPieces = 0;
const yCache = new Map();
async function gy(x, z) { return +(await groundAt(x, z)).toFixed(3); }
for (const pc of pieces) {
  const q = pc.pts;
  for (const p of q) p.y = await gy(p.x, p.z);
  // drop vertices that add nothing (straight and flat) - keep junction nodes and cap segments at 40 m
  const keep = [q[0]];
  for (let k = 1; k < q.length - 1; k++) {
    const a = keep[keep.length - 1], p = q[k], c = q[k + 1];
    const L = Math.hypot(c.x - a.x, c.z - a.z) || 1, off = Math.abs((c.x - a.x) * (a.z - p.z) - (a.x - p.x) * (c.z - a.z)) / L;
    const f = Math.hypot(p.x - a.x, p.z - a.z) / L, yi = a.y + (c.y - a.y) * f;
    if (p.id || off > 0.06 || Math.abs(yi - p.y) > 0.04 || L > 40) keep.push(p);
  }
  keep.push(q[q.length - 1]);
  pc.pts = keep;
  // cut at cell boundaries (mid-segment, so tangents match on both sides)
  let cur = [keep[0]], startF = pc.flags & 4;
  const flush = (endFlag) => {
    if (cur.length >= 2) {
      const arr = [1, pc.cls, +pc.hw.toFixed(2), pc.fp, (pc.flags & 0x33) | startF | endFlag, cur.length];
      for (const p of cur) arr.push(+p.x.toFixed(2), p.y, +p.z.toFixed(2));
      push(cellOf((cur[0].x + cur[cur.length - 1].x) / 2, (cur[0].z + cur[cur.length - 1].z) / 2), arr);
      nVerts += cur.length; nPieces++;
    }
  };
  for (let k = 1; k < keep.length; k++) {
    let a = keep[k - 1];
    const b = keep[k];
    // find cell-line crossings between a and b
    const ts = [];
    for (const ax of ['x', 'z']) {
      const c0 = Math.floor(a[ax] / CELL), c1 = Math.floor(b[ax] / CELL);
      if (c0 !== c1) for (let c = Math.min(c0, c1) + 1; c <= Math.max(c0, c1); c++) ts.push((c * CELL - a[ax]) / (b[ax] - a[ax]));
    }
    ts.sort((u, v) => u - v);
    for (const f of ts) {
      if (f <= 0.001 || f >= 0.999) continue;
      const m = { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: +(a.y + (b.y - a.y) * f).toFixed(3) };
      cur.push(m); flush(0); cur = [m]; startF = 0;
    }
    cur.push(b);
  }
  flush(pc.flags & 8);
}
// discs
let nDiscs = 0;
for (const ni of nodeInfo.values()) {
  if (ni.d < H + 0.5) continue; // under the main ribbon
  const y = await gy(ni.x, ni.z);
  push(cellOf(ni.x, ni.z), [2, +ni.x.toFixed(2), y, +ni.z.toFixed(2), +Math.min(ni.r, 14).toFixed(2)]);
  nDiscs++;
}
// decals: crosswalk (zebra) just outside the main ribbon, plus a stop line one lane further out on the approach side
let nDecals = 0;
for (const d of decals) {
  const y = await gy(d.x, d.z);
  const wz = Math.max(2, d.hw * 2 - 0.8);
  push(cellOf(d.x, d.z), [3, +d.x.toFixed(2), y, +d.z.toFixed(2), +d.tx.toFixed(3), +d.tz.toFixed(3), 0, +(wz / 2).toFixed(2), 3.2, 0]);
  nDecals++;
  if (d.cls <= 4) {
    // approach lane: traffic travelling toward the main road (direction -t) keeps right (or left in left-hand places)
    const dirx = -d.tx, dirz = -d.tz;
    let lat = d.oneway ? 0 : d.hw * 0.5;
    const rx = -dirz, rz = dirx; // right of travel
    const sgn = route.leftHand ? -1 : 1;
    // lateral offset is measured along the right-hand normal of (tx,tz) = -(right normal of travel)
    const latOut = d.oneway ? 0 : -sgn * lat;
    const hwid = d.oneway ? d.hw - 0.4 : d.hw * 0.5 - 0.3;
    const px = d.x + d.tx * 3.4, pz = d.z + d.tz * 3.4;
    const yy = await gy(px, pz);
    push(cellOf(px, pz), [3, +px.toFixed(2), yy, +pz.toFixed(2), +d.tx.toFixed(3), +d.tz.toFixed(3), +latOut.toFixed(2), +hwid.toFixed(2), 0.45, 1]);
    nDecals++;
  }
}

// ---------- write ----------
fs.mkdirSync(outDir, { recursive: true });
let total = 0;
for (const c of records.values()) total += c.length;
const bin = new Float32Array(total);
const cells = {};
let off = 0;
for (const [k, c] of records) { bin.set(c, off); cells[k] = [off, c.length]; off += c.length; }
fs.writeFileSync(`${outDir}/roads.bin`, Buffer.from(bin.buffer));
fs.writeFileSync(`${outDir}/index.json`, JSON.stringify({ version: 1, cell: CELL, place: placeId, credit: 'Streets © OpenStreetMap contributors', cells, junctions }));
fs.writeFileSync(`${outDir}/CREDITS.txt`, 'Streets © OpenStreetMap contributors (ODbL), via Overpass API.\n');
console.log(`${placeId}: wrote ${nPieces} pieces (${nVerts} verts, ${(wayLen / 1000).toFixed(1)} km), ${nDiscs} junction discs, ${nDecals} decals, ${junctions.length} junctions with the route, ${(bin.byteLength / 1024).toFixed(0)} KB, ${Object.keys(cells).length} cells`);
process.exit(0);
