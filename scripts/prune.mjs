// Keeps the map-tile cache (data/tiles) down to what the places can actually show while driving.
// Every place is a fixed route, so the tiles the game can ever ask for are known exactly
// (scripts/tileplan.mjs walks the game's own tile rule along each route). Everything else in the
// cache — imagery the tree baker read once, tiles of old routes, detail no screen can show — goes.
// Rebuilding a place (`npm run place <id>`) downloads again whatever its build reads.
//
// Kept tiles are also stored compact (WebP: see vite.config.js); --apply converts any older .jpg/.png.
//
// usage: npm run prune            report only (nothing is deleted)
//        npm run prune -- --apply delete the tiles no place needs and compact the rest
import fs from 'node:fs';
import path from 'node:path';
import { planPlay } from './tileplan.mjs';
import { compactTile } from '../vite.config.js';

const apply = process.argv.includes('--apply');
const ROOT = 'data/tiles';
const ids = JSON.parse(fs.readFileSync('public/routes/places.json', 'utf8')).places.map((p) => p.id);

const keep = new Set(), missing = [];
for (const id of ids) {
  const need = planPlay(JSON.parse(fs.readFileSync(`public/routes/${id}.json`, 'utf8')));
  let have = 0, n = 0;
  for (const [kind, set, ext] of [['elev', need.elev, 'png'], ['img', need.img, 'jpg']])
    for (const k of set) {
      const f = path.join(ROOT, kind, k); // (without extension: .webp, or an older .png/.jpg)
      keep.add(f); n++;
      if (fs.existsSync(`${f}.webp`) || fs.existsSync(`${f}.${ext}`)) have++; else missing.push(f);
    }
  console.log(`${id.padEnd(12)} needs ${String(n).padStart(6)} tiles (${have} cached)`);
}

const by = {}; // kind/z -> [keptFiles, keptBytes, dropFiles, dropBytes]
const drop = [], loose = []; // loose: kept tiles still in their original (larger) format
for (const kind of ['elev', 'img']) {
  const base = path.join(ROOT, kind);
  if (!fs.existsSync(base)) continue;
  for (const z of fs.readdirSync(base)) {
    const row = (by[`${kind} z${z}`] = [0, 0, 0, 0]);
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) { walk(f); continue; }
        const size = fs.statSync(f).size;
        if (keep.has(f.replace(/\.(webp|png|jpg|tmp)$/, '')) && !f.endsWith('.tmp')) { row[0]++; row[1] += size; if (!f.endsWith('.webp')) loose.push([kind, f, size]); }
        else { row[2]++; row[3] += size; drop.push(f); }
      }
    };
    walk(path.join(base, z));
  }
}
const mb = (b) => (b / 1e6).toFixed(0).padStart(5) + ' MB';
let K = 0, D = 0;
console.log('\n           keep              remove');
for (const [k, r] of Object.entries(by).sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))) {
  console.log(`${k.padEnd(9)} ${String(r[0]).padStart(6)} ${mb(r[1])}   ${String(r[2]).padStart(6)} ${mb(r[3])}`);
  K += r[1]; D += r[3];
}
console.log(`total     ${mb(K)} kept, ${mb(D)} removable${missing.length ? `; ${missing.length} needed tiles not cached yet (the game fetches them once)` : ''}`);

if (loose.length) console.log(`${loose.length} kept tiles (${mb(loose.reduce((a, l) => a + l[2], 0)).trim()}) are still JPEG/PNG: --apply stores them as WebP (about a third smaller)`);
if (!apply) { console.log('\n(report only: run `npm run prune -- --apply` to delete and compact)'); process.exit(0); }
for (const f of drop) fs.unlinkSync(f);
console.log(`\ndeleted ${drop.length} tiles (${mb(D).trim()})`);
// compact the rest, a few at a time
let done = 0, before = 0, after = 0, i = 0;
const worker = async () => {
  while (i < loose.length) {
    const [kind, f, size] = loose[i++];
    try {
      const out = await compactTile(kind, fs.readFileSync(f));
      const w = f.replace(/\.(png|jpg)$/, '.webp');
      fs.writeFileSync(w + '.tmp', out); fs.renameSync(w + '.tmp', w); fs.unlinkSync(f);
      before += size; after += out.length;
    } catch (e) { console.warn('  could not compact', f, e.message); }
    if (++done % 2000 === 0) console.log(`  compacted ${done}/${loose.length}`);
  }
};
await Promise.all(Array.from({ length: 6 }, worker));
if (loose.length) console.log(`compacted ${done} tiles: ${mb(before).trim()} -> ${mb(after).trim()}`);
// tidy empty folders
const tidy = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) tidy(path.join(dir, e.name)); if (dir !== ROOT && !fs.readdirSync(dir).length) fs.rmdirSync(dir); };
tidy(ROOT);
