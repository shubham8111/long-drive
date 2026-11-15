// Bakes hoodoo / pinnacle fields for a place (only 'bryce' has areas): node scripts/bake-hoodoos.mjs bryce [--target=N]
// Candidates = steep ground whose imagery is bare pale/orange/pink/red rock, away from the road; they are thinned
// into dense contour-following rows (stripe x cluster noise). Output public/world/<id>/hoodoos.bin: Float32 records
// [x, ground y, z, height, radius, rotY, variant, tone] (8 floats each); tone 0 = Bryce pink/cream, 1 = Red Canyon red.
// variant: 0 spire, 1 chunky column, 2 fin, 3 stump, 4 Thor's hammer. hoodoos.json = index (counts, bounds).
import fs from 'node:fs';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { getTile } from '../vite.config.js';
import { Geo, lon2tx, lat2ty, tx2lon, ty2lat } from '../src/geo.js';
import { Route } from '../src/route.js';

const routeId = process.argv[2] || 'bryce';
const TARGET = +((process.argv.find((a) => a.startsWith('--target=')) || '').slice(9)) || 20000;
// keep hoodoos out of the rock arches (src/landmarks/red-canyon.js SITES: tunnel A, tunnel B, Natural Bridge), local metres
const ARCH_CLEAR = [[-4354.6, -13460.3, 40], [-4217.2, -13407.0, 40], [-798.8, 9859.3, 45]];
const data = JSON.parse(fs.readFileSync(`public/routes/${routeId}.json`, 'utf8'));
const geo = new Geo(data.origin.lat, data.origin.lon);
const route = new Route(data);
const EZ = 15, IZ = 17, BAND = 1800, STEP = 5, ROAD_CLEAR = 25;
const WINDOWS = [{ s0: 7000, s1: 12000, red: 1, slope: 0.33 }, { s0: 29000, s1: Math.min(57700, route.length), red: 0, slope: 0.42 }];

// ---- which z17 tiles matter, and whether each belongs to the red area
const tiles = new Map(); // "ix,iy" -> red
const P = {};
for (const w of WINDOWS) {
  for (let s = w.s0; s <= w.s1; s += 90) {
    route.sample(s, P);
    const lon = geo.lon(P.x), lat = geo.lat(P.z);
    const tx0 = lon2tx(geo.lon(P.x - BAND - 130), IZ), tx1 = lon2tx(geo.lon(P.x + BAND + 130), IZ);
    const ty0 = lat2ty(geo.lat(P.z - BAND - 130), IZ), ty1 = lat2ty(geo.lat(P.z + BAND + 130), IZ);
    for (let iy = Math.floor(Math.min(ty0, ty1)); iy <= Math.floor(Math.max(ty0, ty1)); iy++)
      for (let ix = Math.floor(tx0); ix <= Math.floor(tx1); ix++) {
        const cx = geo.x(tx2lon(ix + 0.5, IZ)), cz = geo.z(ty2lat(iy + 0.5, IZ));
        if ((cx - P.x) ** 2 + (cz - P.z) ** 2 > (BAND + 120) ** 2) continue;
        const k = `${ix},${iy}`;
        if (!tiles.has(k) || w.red) tiles.set(k, { red: w.red, slope: w.slope });
      }
  }
}
console.log(`${tiles.size} imagery tiles to scan`);

const elevCache = new Map();
async function elevTile(x, y) {
  const k = `${x}/${y}`;
  if (!elevCache.has(k)) {
    const png = PNG.sync.read(await getTile('elev', EZ, x, y));
    const out = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) out[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
    if (elevCache.size > 24) elevCache.delete(elevCache.keys().next().value);
    elevCache.set(k, out);
  }
  return elevCache.get(k);
}
function bil(d, px, py) {
  px = Math.min(255, Math.max(0, px)); py = Math.min(255, Math.max(0, py));
  const x0 = px | 0, y0 = py | 0, x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1), ax = px - x0, ay = py - y0;
  return (d[y0 * 256 + x0] * (1 - ax) + d[y0 * 256 + x1] * ax) * (1 - ay) + (d[y1 * 256 + x0] * (1 - ax) + d[y1 * 256 + x1] * ax) * ay;
}
// smooth value noise
const hash = (x, y, s = 0) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y, s = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return (hash(x0, y0, s) * (1 - ux) + hash(x0 + 1, y0, s) * ux) * (1 - uy) + (hash(x0, y0 + 1, s) * (1 - ux) + hash(x0 + 1, y0 + 1, s) * ux) * uy;
}
let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const cands = []; // {x,y,z,red,score,rel}
const stat = { cells: 0, steep: 0, rock: 0, near: 0 };
let n = 0;
for (const [k, info] of tiles) {
  const [ix, iy] = k.split(',').map(Number);
  let img;
  try { img = jpeg.decode(await getTile('img', IZ, ix, iy), { useTArray: true, formatAsRGBA: true }); } catch { continue; }
  if (img.width !== 256) continue;
  const ex = ix >> 2, ey = iy >> 2, elev = await elevTile(ex, ey);
  const x0 = geo.x(tx2lon(ix, IZ)), x1 = geo.x(tx2lon(ix + 1, IZ)), z0 = geo.z(ty2lat(iy, IZ)), z1 = geo.z(ty2lat(iy + 1, IZ));
  const mpp = (geo.x(tx2lon(ex + 1, EZ)) - geo.x(tx2lon(ex, EZ))) / 256;
  const tileD = Math.max(0, route.nearestWide((x0 + x1) / 2, (z0 + z1) / 2, BAND + 200));
  const px = img.data, nStep = Math.floor((x1 - x0) / STEP);
  let emax = -1e9; for (let i = 0; i < 65536; i += 7) emax = Math.max(emax, elev[i]);
  for (let j = 0; j < nStep; j++) for (let i = 0; i < nStep; i++) {
    const u = (i + 0.2 + rnd() * 0.6) / nStep, v = (j + 0.2 + rnd() * 0.6) / nStep;
    const x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * v;
    const epx = (ix & 3) * 64 + u * 64 - 0.5, epy = (iy & 3) * 64 + v * 64 - 0.5;
    stat.cells++;
    const slope = Math.hypot(bil(elev, epx + 1.2, epy) - bil(elev, epx - 1.2, epy), bil(elev, epx, epy + 1.2) - bil(elev, epx, epy - 1.2)) / (2.4 * mpp);
    if (slope < info.slope) continue;
    stat.steep++;
    const cx = Math.min(253, Math.max(2, (u * 256) | 0)), cy = Math.min(253, Math.max(2, (v * 256) | 0));
    let r = 0, g = 0, b = 0;
    for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) { const q = ((cy + a) * 256 + cx + c) * 4; r += px[q]; g += px[q + 1]; b += px[q + 2]; }
    r /= 25; g /= 25; b /= 25;
    const lum = (r + g + b) / 3;
    // bare light/orange/pink/red rock: warm, not green canopy, not deep shadow
    if (!(r > g * 1.05 && g > b && r - b > 32 && lum > 92 && g > r * 0.55)) continue;
    stat.rock++;
    if (route.nearest(x, z, ROAD_CLEAR) >= 0) { stat.near++; continue; }
    if (ARCH_CLEAR.some(([ax, az, ar]) => (x - ax) ** 2 + (z - az) ** 2 < ar * ar)) continue;
    const y = bil(elev, epx, epy);
    // in the park hoodoos live below the rim: you look down on them from the road, they never stand on the plateau beside it
    let dr = 1e9;
    if (!info.red) { const dd = route.nearestWide(x, z, BAND + 200); if (dd >= 0) { dr = dd; if (y > route.nearY - 12) continue; } }
    cands.push({ d: tileD, dr, x, y, z, red: info.red, slope, lum, rel: Math.min(1, Math.max(0, (emax - y) / 160)), warm: (r - b) / 255 });
  }
  if (++n % 200 === 0) console.log(`  ${n}/${tiles.size} tiles, ${cands.length} candidates`);
}
console.log('stats', stat, 'candidates', cands.length);

// ---- thin into clustered rows
for (const c of cands) {
  const cluster = vnoise(c.x / 140, c.z / 140, 1) * 0.65 + vnoise(c.x / 45, c.z / 45, 2) * 0.35;
  const stripe = 0.5 + 0.5 * Math.sin(c.y * 0.55 + vnoise(c.x / 55, c.z / 55, 3) * 7);
  c.w = Math.max(0, cluster - 0.28) * (0.35 + 0.65 * stripe) * (0.5 + Math.min(1, c.slope)) * (1 - 0.6 * Math.min(1, Math.max(0, c.d) / 1800)) * (c.red ? 1 : 2); // Bryce's amphitheatres are packed far denser than Red Canyon
}
const sum = cands.reduce((a, c) => a + c.w, 0);
const pk = TARGET / Math.max(1e-6, sum);
const recs = [];
for (const c of cands) {
  if (rnd() > c.w * pk) continue;
  const rr = rnd(), tall = Math.pow(rnd(), 2.2);
  let h = 7 + (12 + 24 * c.rel) * Math.pow(tall, 0.8) + 4 * c.rel;
  let variant = rr < 0.36 ? 0 : rr < 0.58 ? 1 : rr < 0.76 ? 2 : rr < 0.9 ? 3 : 0;
  if (rnd() < 0.025 && c.rel > 0.15) { variant = 4; h = 28 + rnd() * 18; }
  if (variant === 3) h = 3 + h * 0.4;
  if (c.red) { h = 4 + (h - 4) * 0.7; }
  h = Math.min(46, h);
  if (!c.red && c.dr < 250) h = Math.min(h, 14 + c.dr * 0.08); // smaller near the road, so no giant lone spires right by the car
  const rad = (0.8 + h * 0.115) * (0.8 + 0.4 * rnd()) * (variant === 1 ? 1.25 : variant === 2 ? 1.0 : 1);
  recs.push(c.x, c.y, c.z, h, rad, rnd() * Math.PI * 2, variant, c.red ? 1 : 0);
}
const nRec = recs.length / 8;
const out = Buffer.from(Float32Array.from(recs).buffer);
fs.mkdirSync(`public/world/${routeId}`, { recursive: true });
fs.writeFileSync(`public/world/${routeId}/hoodoos.bin`, out);
const nRed = recs.filter((_, i) => i % 8 === 7 && recs[i] === 1).length;
fs.writeFileSync(`public/world/${routeId}/hoodoos.json`, JSON.stringify({ count: nRec, red: nRed, stride: 8, fields: ['x', 'y', 'z', 'height', 'radius', 'rotY', 'variant', 'tone'] }));
console.log(`wrote ${nRec} hoodoos (${nRed} red canyon, ${nRec - nRed} bryce), ${(out.length / 1024).toFixed(0)} KB`);
