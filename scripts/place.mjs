// One command to add or rebuild a place:  npm run place <id> [<id> ...]   |   npm run place all
// Reads places/<id>.json and produces everything the game needs, permanently:
//   1. the drivable route            -> public/routes/<id>.json
//   2. every map tile along it       -> data/tiles
//   3. scenery (trees, rocks, ...)   -> public/world/<id>/elements
//   4. buildings (cities, circuits)  -> public/world/<id>/buildings
//      street furniture (cities)     -> public/world/<id>/street
//   5. the list of places the game shows -> public/routes/places.json
// See places/README.md for the file format.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const all = fs.readdirSync('places').filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
const ids = args.includes('all') ? all : args;
const manifestOnly = flags.includes('--manifest'); // just rewrite places.json from what is built
if (!ids.length && !manifestOnly) { console.log(`usage: npm run place <id>|all   (or --manifest)\navailable: ${all.join(', ')}`); process.exit(1); }

const run = (script, ...a) => {
  const r = spawnSync(process.execPath, [script, ...a], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${script} ${a.join(' ')} failed`);
};
for (const id of manifestOnly ? [] : ids) {
  if (!fs.existsSync(`places/${id}.json`)) { console.log(`no such place: places/${id}.json`); process.exit(1); }
  console.log(`\n=== ${id} ===`);
  if (!flags.includes('--skip-route')) run('scripts/bake-route.mjs', id);
  const route = JSON.parse(fs.readFileSync(`public/routes/${id}.json`, 'utf8'));
  run('scripts/build-world.mjs', id, '--download-only');
  // buildings first: the scenery bake keeps trees off their footprints
  if (route.scenery?.buildings && fs.existsSync('scripts/bake-buildings.mjs')) try { run('scripts/bake-buildings.mjs', id); } catch (e) { console.log(`  buildings could not be fetched for ${id} (map server busy?) — re-run later; continuing without them`); }
  run('scripts/build-world.mjs', id, '--bake-only');
  if ((route.kind === 'city' || route.scenery?.ground === 'paved') && fs.existsSync('scripts/bake-roads.mjs')) { try { run('scripts/bake-roads.mjs', id); } catch (e) { console.log(`  side streets could not be fetched for ${id}; continuing without them`); } }
  // street furniture last: it avoids buildings and trees
  if (route.kind === 'city' || route.scenery?.ground === 'paved') { if (fs.existsSync('scripts/bake-street.mjs')) run('scripts/bake-street.mjs', id); }
}

const placeDef = (id) => { try { return JSON.parse(fs.readFileSync(`places/${id}.json`, 'utf8')); } catch { return {}; } };
// manifest: every place that has been built, in the order of the places folder (Bryce first)
const list = [];
for (const id of all) {
  const f = `public/routes/${id}.json`;
  if (!fs.existsSync(f)) continue;
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  // stops (km along the road) and loop: the endless drive cuts long roads into stretches at the stops
  list.push({ id, name: r.name, short: r.short, region: r.region, kind: r.kind, km: +((((r.pts.length / 3) - (r.loop ? 0 : 1)) * r.step) / 1000).toFixed(1),
    loop: !!r.loop, stops: (r.stops || []).map((x) => +(x.s / 1000).toFixed(2)) });
}
const order = { scenic: 0, city: 1, circuit: 2 };
list.sort((a, b) => order[a.kind] - order[b.kind]);
fs.writeFileSync('public/routes/places.json', JSON.stringify({ places: list }, null, 1));
console.log(`\nplaces available in the game: ${list.map((p) => p.id).join(', ')}`);
