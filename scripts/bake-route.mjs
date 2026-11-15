// Bakes a drivable route from a place definition (places/<id>.json):
//   real road geometry (OpenStreetMap via OSRM, or a GeoJSON line such as a race circuit)
//   + smoothed real elevation  ->  public/routes/<id>.json
// Usage: node scripts/bake-route.mjs <id> [<id> ...]      (normally run through `npm run place <id>`)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import * as THREE from 'three';
import { getTile } from '../vite.config.js';

const R = 6378137, D2R = Math.PI / 180, STEP = 5;
const UA = { 'User-Agent': 'long-drive-game/1.0' };

// what each kind of place looks and drives like; a place file can override any of these under "road"/"scenery"
export const KIND_DEFAULTS = {
  scenic: { road: { half: 5.0, style: 'highway', lane: 1.75 }, scenery: { trees: 'pine', shrubs: true, rocks: true, ground: 'wild', buildings: false } },
  city: { road: { half: 11.0, style: 'city', lane: 1.85 }, scenery: { trees: 'broadleaf', shrubs: false, rocks: false, ground: 'paved', buildings: true } },
  circuit: { road: { half: 8.0, style: 'track', lane: 0 }, scenery: { trees: 'broadleaf', shrubs: false, rocks: false, ground: 'wild', buildings: true } },
};

export function loadPlace(id) {
  const def = JSON.parse(fs.readFileSync(`places/${id}.json`, 'utf8'));
  const k = KIND_DEFAULTS[def.kind || 'scenic'];
  if (!k) throw new Error(`places/${id}.json: unknown kind "${def.kind}"`);
  def.kind = def.kind || 'scenic';
  def.road = { ...k.road, ...(def.road || {}) };
  def.scenery = { ...k.scenery, ...(def.scenery || {}) };
  return def;
}

// small permanent cache for things fetched from the internet (routes, circuit lines)
async function cachedJson(url) {
  const file = path.join('data/sources', crypto.createHash('sha1').update(url).digest('hex') + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  const j = await r.json();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(j));
  return j;
}

const elevCache = new Map();
async function elevTile(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (!elevCache.has(k)) {
    const png = PNG.sync.read(await getTile('elev', z, x, y));
    const out = new Float32Array(256 * 256);
    for (let i = 0; i < 65536; i++) out[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
    elevCache.set(k, out);
  }
  return elevCache.get(k);
}
async function elevAt(lat, lon) {
  const z = 15, n = 2 ** z;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.asinh(Math.tan(lat * D2R)) / Math.PI) / 2) * n;
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const d = await elevTile(z, tx, ty);
  const px = Math.min(255, Math.max(0, (fx - tx) * 256 - 0.5)), py = Math.min(255, Math.max(0, (fy - ty) * 256 - 0.5));
  const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1), ax = px - x0, ay = py - y0;
  return (d[y0 * 256 + x0] * (1 - ax) + d[y0 * 256 + x1] * ax) * (1 - ay) + (d[y1 * 256 + x0] * (1 - ax) + d[y1 * 256 + x1] * ax) * ay;
}

async function lineCoords(def) {
  const src = def.source;
  if (src.type === 'osrm') {
    const url = `https://router.project-osrm.org/route/v1/driving/${src.points.map((c) => c.join(',')).join(';')}?overview=full&geometries=geojson&continue_straight=true`;
    const res = await cachedJson(url);
    if (!res.routes?.[0]) throw new Error(`no route found for ${def.id}`);
    return res.routes[0].geometry.coordinates;
  }
  if (src.type === 'geojson') {
    const j = src.url ? await cachedJson(src.url) : JSON.parse(fs.readFileSync(src.file, 'utf8'));
    const g = (j.features ? j.features[0].geometry : j.geometry || j);
    const c = g.type === 'MultiLineString' ? g.coordinates.flat() : g.type === 'Polygon' ? g.coordinates[0] : g.coordinates;
    return src.reverse ? c.slice().reverse() : c;
  }
  if (src.type === 'line') return src.points; // hand-drawn [lon, lat] list
  throw new Error(`unknown source type ${src.type}`);
}

export async function bakeRoute(id) {
  const def = loadPlace(id);
  const coords = await lineCoords(def);
  let origin = def.origin;
  if (!origin) {
    let la = 0, lo = 0;
    for (const [lon, lat] of coords) { la += lat; lo += lon; }
    origin = { lat: +(la / coords.length).toFixed(4), lon: +(lo / coords.length).toFixed(4) };
  }
  const cos0 = Math.cos(origin.lat * D2R);
  const toLocal = (lat, lon) => [(lon - origin.lon) * D2R * R * cos0, -(lat - origin.lat) * D2R * R];
  const toGeo = (x, z) => [origin.lat - z / (D2R * R), origin.lon + x / (D2R * R * cos0)];

  const raw = [];
  for (const [lon, lat] of coords) {
    const [x, z] = toLocal(lat, lon);
    const last = raw[raw.length - 1];
    if (!last || Math.hypot(x - last.x, z - last.z) > 4) raw.push(new THREE.Vector3(x, 0, z));
  }
  const loop = !!def.loop;
  if (loop && raw[0].distanceTo(raw[raw.length - 1]) < 4) raw.pop();
  let reversals = 0;
  for (let i = 2; i < raw.length; i++) {
    const a = raw[i - 1].clone().sub(raw[i - 2]).normalize(), b = raw[i].clone().sub(raw[i - 1]).normalize();
    if (a.dot(b) < -0.5) { reversals++; console.log(`  WARNING sharp reversal near ${toGeo(raw[i - 1].x, raw[i - 1].z).map((v) => v.toFixed(5)).join(', ')} (a waypoint probably snapped to a side road)`); }
  }
  const curve = new THREE.CatmullRomCurve3(raw, loop, 'centripetal');
  curve.arcLengthDivisions = raw.length * 24;
  const len = curve.getLength();
  const n = Math.round(len / STEP);
  const sp = curve.getSpacedPoints(n);
  if (loop) sp.pop(); // last point equals the first on a closed curve

  let h = [];
  for (const p of sp) { const [lat, lon] = toGeo(p.x, p.z); h.push(await elevAt(lat, lon)); }
  // smooth the road profile (roads are graded; raw elevation data is bumpy)
  const N = h.length, idx = (k) => (loop ? ((k % N) + N) % N : Math.min(N - 1, Math.max(0, k)));
  for (let pass = 0; pass < 3; pass++) {
    const o = new Array(N), W = def.kind === 'scenic' ? 7 : 10;
    for (let i = 0; i < N; i++) { let s = 0; for (let j = -W; j <= W; j++) s += h[idx(i + j)]; o[i] = s / (2 * W + 1); }
    h = o;
  }
  const pts = [];
  sp.forEach((p, i) => pts.push(+p.x.toFixed(2), +h[i].toFixed(2), +p.z.toFixed(2)));
  const step = len / n;

  // Where the road passes a lat/lon. A road can pass near the same spot twice (a city loop down one avenue
  // and back up the next): listed in driving order, each one takes the first close pass after the one
  // before (within 80 m of the very closest), so Herald Square lands on 34th St, not on 6th Ave later.
  let after = 0;
  const passAt = (lat, lon, name) => {
    const [x, z] = toLocal(lat, lon);
    const ds = sp.map((p) => Math.hypot(p.x - x, p.z - z));
    let best = 0, bd = Infinity, fwd = -1, fd = Infinity;
    ds.forEach((d, i) => { if (d < bd) { bd = d; best = i; } });
    // the first stretch after the previous one that comes within 80 m of the closest pass: its nearest point
    for (let i = after; i < ds.length; i++) {
      if (ds[i] > bd + 80) { if (fwd >= 0) break; continue; }
      if (ds[i] < fd) { fd = ds[i]; fwd = i; }
    }
    if (fwd >= 0) best = fwd;
    else if (name) console.log(`  note: "${name}" is out of driving order`);
    if (name && Math.min(bd, fd) > 150) console.log(`  note: stop "${name}" is ${Math.round(Math.min(bd, fd))} m from the road`);
    after = best;
    return best;
  };
  const stops = (def.stops?.length ? def.stops : [{ name: def.name, at: 'start' }]).map((s) => {
    if (s.at === 'start') return { name: s.name, s: loop ? 0 : Math.min(60, len * 0.02) };
    if (s.at === 'end') return { name: s.name, s: Math.max(0, len - Math.min(2500, len * 0.1)) };
    return { name: s.name, s: +(passAt(s.lat, s.lon, s.name) * step).toFixed(1) };
  }).sort((a, b) => a.s - b.s);
  after = 0;

  // short true facts the announcer tells as you pass (lat/lon near the road, or "frac" 0..1 of the way along)
  const facts = (def.facts || []).map((f) => {
    const texts = f.texts || [f.text]; // several true things about one landmark: one is picked each time
    if (f.frac != null) return { s: +(f.frac * len).toFixed(1), texts };
    return { s: +(passAt(f.lat, f.lon) * step).toFixed(1), texts };
  }).sort((a, b) => a.s - b.s);

  const out = { id: def.id, name: def.name, region: def.region || '', short: def.short || def.name, blurb: def.blurb || '', kind: def.kind, loop, leftHand: !!def.leftHand, road: def.road, scenery: def.scenery, origin, step, pts, stops, facts };
  fs.mkdirSync('public/routes', { recursive: true });
  fs.writeFileSync(`public/routes/${def.id}.json`, JSON.stringify(out));
  const hs = h.slice().sort((a, b) => a - b);
  console.log(`${def.id}: ${(len / 1000).toFixed(1)} km${loop ? ' loop' : ''}, ${sp.length} points, elevation ${Math.round(hs[0])}–${Math.round(hs[N - 1])} m, ${reversals} reversals`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const id of process.argv.slice(2)) await bakeRoute(id);
}
