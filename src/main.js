import * as THREE from 'three';
import { Geo, clamp, damp, lerp, smoothstep } from './geo.js';
import { Route, Road } from './route.js';
import { Terrain } from './terrain.js';
import { SkySystem, WEATHER } from './sky.js';
import { Elements } from './elements.js';
import { buildAssets } from './assets.js';
import { loadAuthoredModels } from './models.js';
import { Buildings } from './buildings.js';
import { StreetFurniture } from './street.js';
import { Life } from './life.js';
import { CityRoads } from './roads.js';
import { Traffic } from './traffic.js';
import { RIDES, RideRig } from './vehicles.js';
import { Ambience } from './audio.js';
import { Radio, STATIONS } from './radio.js';
import { UI, STORE_KEY } from './ui.js';
import { Post, RIDE_LAYER } from './post.js';
import { bus } from './events.js';
import { Tunnel, TUNNEL } from './tunnel.js';
import { prepareRoadTextures } from './ground.js';
import { Surprises } from './surprises.js';
import { SKY_SURPRISES } from './surprises/sky.js';
import { LOCAL_SURPRISES } from './surprises/local.js';
import { CINE_SURPRISES } from './surprises/cine.js';
import { MANHATTAN_LANDMARKS } from './landmarks/manhattan.js';
import { BRYCE_LANDMARKS } from './landmarks/bryce.js';
import { mergeStatic, drawOrder } from './lighten.js';
import { asset } from './paths.js';

const params = new URLSearchParams(location.search);
// Graphics modes. The landscape is drawn at a fixed number of lines (480, 720 or 1080, never more than
// the screen has) and scaled up through the soft look; the car or horse is always drawn at the
// screen's full resolution in its own pass, so what is closest to you stays crisp in every mode.
// Each mode also sets how far full-detail trees are drawn, terrain tile density, how far the close-up
// ground detail reaches, and the anti-aliasing of the landscape (msaa samples).
const QUALITY = {
  // the full look: 720 lines, multisampled HDR, sun shadows, bloom and the soft look
  laptop: { lines: 720, lod: 50, shadows: true, shadowMap: 2048, split: 1.1, ground: 70, msaa: 4, scale: 1 },
};
// settings saved by earlier versions (480 / 720 / 1080 lines, the TV mode and older names): all the laptop's full look now
const LEGACY_GFX = { 480: 'laptop', 720: 'laptop', 1080: 'laptop', tv: 'laptop', tv720: 'laptop', low: 'laptop', balanced: 'laptop', high: 'laptop' };
// ---------- demo: an attract loop (/?demo=1), e.g. for a TV the laptop casts to ----------
// One continuous drive, about five minutes a pass, looping for ever: five chapters, each a place at a
// chosen hour and weather, joined by the endless drive's tunnels. On arrival the announcer names the
// place, tells one good fact and introduces a hand-picked song (YouTube). Nothing needs a click; any key
// or tap is ignored (it is always the demo), except F for full screen; a first key turns the sound on if
// the browser held it back. Seat view throughout, with a slow cinematic shot in every chapter.
// (Unattended, start Chrome with --autoplay-policy=no-user-gesture-required so the music plays without a click.)
const DEMO_TRACKS = {
  roads: { id: '1vrEljMfXYo', title: 'Take Me Home, Country Roads', artist: 'John Denver' },
  horse: { id: 'zSAJ0l4OBHM', title: 'A Horse with No Name', artist: 'America' },
  yellow: { id: 'yKNxeF4KMsY', title: 'Yellow', artist: 'Coldplay' },
  riptide: { id: 'uJ_1HMAGb4k', title: 'Riptide', artist: 'Vance Joy' },
  rainbow: { id: 'V1bFr2SWP1I', title: 'Somewhere Over the Rainbow', artist: 'Israel Kamakawiwoʻole' },
  freefallin: { id: '1lWJXDG2i0A', title: "Free Fallin'", artist: 'Tom Petty' },
  africa: { id: 'FTQbiNvZqaY', title: 'Africa', artist: 'Toto' },
  dreams: { id: 'mrZRURcb1cM', title: 'Dreams', artist: 'Fleetwood Mac' },
};
// from: metres along the road where the chapter begins (so the landmark comes up within the minute)
const CHAPTERS = [
  { place: 'bryce', from: 33190, ride: 'horse', cam: 'seat', cine: true, hours: 18.0, weather: 'clear', song: 'horse', title: 'Bryce Canyon at golden hour',
    fact: 'Bryce has the largest concentration of hoodoos anywhere on Earth.' },
  { place: 'monaco', from: 0, ride: 'car', cam: 'seat', cine: true, hours: 13.0, weather: 'clear', song: 'riptide', title: 'Monaco at midday',
    fact: 'In 2024 Charles Leclerc, who grew up here, won his home race. He was the first driver from Monaco to win it since 1931.' },
  { place: 'paris', from: 8300, ride: 'car', cam: 'seat', cine: true, hours: 21.8, weather: 'clear', song: 'rainbow', title: 'Paris at night', // the tower sparkles on the hour
    fact: 'Every medal at the Paris 2024 Olympics carried a small piece of original iron from the Eiffel Tower.' },
  { place: 'london', from: 3500, ride: 'car', cam: 'seat', cine: true, hours: 21.85, weather: 'rain', song: 'yellow', title: 'London in the rain', // Big Ben strikes ten
    fact: 'The great clock is fine-tuned with old pennies. Each penny added to the pendulum makes it gain two fifths of a second a day.' },
  { place: 'manhattan', from: 5179, ride: 'car', cam: 'seat', cine: true, hours: 22.6, weather: 'snow', song: 'dreams', title: 'Manhattan in the snow',
    fact: 'The Empire State Building is struck by lightning around twenty-five times a year. It was built to take it.' },
];
const CHAPTER_SECONDS = params.has('chapterfast') ? +params.get('chapterfast') || 25 : 44; // from arrival to the tunnel: ~1 min a chapter with the tunnel, ~5 min a pass
let demoOn = params.has('demo');
const DEMO_SPEED = { car: 100 / 3.6, horse: 40 / 3.6 }; // m/s: the car at 100 km/h, the horse at 40 (bends still ease them)
const demo = { i: clamp(+(params.get('demochapter') || 0), 0, CHAPTERS.length - 1), soundLocked: false }; // (?demochapter=N: start there, for testing)
if (demoOn) document.body.classList.add('demo');

// Which place? ?place=<id> wins, then the one used last time, then the first in the list.
const manifest = await fetch(asset('routes/places.json')).then((r) => r.json()).catch(() => ({ places: [{ id: 'bryce', name: 'Bryce Canyon Scenic Drive' }] }));
let lastPlace = null;
try { lastPlace = (JSON.parse(localStorage.getItem(STORE_KEY)) || {}).place; } catch (e) { /* ignore */ }
const placeId = [demoOn ? CHAPTERS[demo.i].place : null, params.get('place'), lastPlace].find((id) => manifest.places.some((p) => p.id === id)) || manifest.places[0].id;
const firstData = await (await fetch(asset(`routes/${placeId}.json`))).json();
// The current place's world. An endless drive swaps these for the next place's inside a tunnel.
let world, data, geo, route, terrain, road, elements, buildings, street, roads, life, traffic, facts;
let side = 1, roadEdge = 0, envTex = null, lastS = null, qualityReady = false;

// ---------- renderer ----------
const canvas = document.getElementById('view');
const usePost = params.get('post') !== '0';
// The canvas itself only ever receives the finished picture (one full-screen pass), so it needs no
// depth buffer and no multisampling of its own: that is all done in the post-processing targets.
// Reversed depth (?rz=1) is not on: some of the sky/terrain shaders assume the normal depth range
// (with it, the landscape disappears behind the sky). Depth precision comes from the float depth
// buffer and the landscape pass's farther near plane instead (post.js).
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !usePost && params.get('aa') !== '0', depth: !usePost, powerPreference: 'high-performance', reversedDepthBuffer: params.get('rz') === '1' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.15, 400000);
camera.rotation.order = 'YXZ';
const marks = (window.__marks = {});
let mt = performance.now();
const mark = (k) => { const n = performance.now(); marks[k] = Math.round(n - mt); mt = n; };
mark('boot');
const post = new Post(renderer, scene, camera);
mark('post');
const sky = new SkySystem(scene, renderer, firstData.origin.lat);
mark('sky');
const assets = buildAssets(renderer, sky.shared);
// swap in the photoscanned CC0 rocks and shrubs; anything that fails to load stays procedural
await loadAuthoredModels(assets, renderer, sky.shared).catch((e) => console.warn('authored models unavailable', e));
mark('assets');
// occasional wildlife, passers-by and other traffic (off with ?life=0)
const lifeOn = params.get('life') !== '0';

// Everything that belongs to one place lives in its own group, so a whole place can be put away and
// the next one brought in. `between` is awaited after each part: the endless drive uses it to build the
// next place a little each frame while the car is in the tunnel.
async function buildWorld(d, between = null) {
  const w = { data: d, group: new THREE.Group(), times: {} };
  w.group.fog = sky.fog; // street lamps and traffic read the fog from their parent
  let t = performance.now();
  const step = async (k) => { w.times[k] = Math.round(performance.now() - t); if (between) await between(); t = performance.now(); };
  w.geo = new Geo(d.origin.lat, d.origin.lon);
  w.route = new Route(d); await step('route');
  w.terrain = new Terrain(w.group, w.geo, w.route, renderer, sky.shared); await step('terrain');
  if (between) await prepareRoadTextures(w.route.road.half, w.route.road.style); // made on a worker thread
  w.road = new Road(w.route, w.group, renderer, sky.shared); await step('road');
  w.elements = new Elements(w.group, w.geo, assets, d.id, w.terrain); await step('elements');
  w.buildings = new Buildings(w.group, w.geo, d, sky.shared, renderer); await step('buildings'); // inert where a place has none
  w.street = new StreetFurniture(w.group, w.geo, d, sky.shared, renderer); await step('street');
  w.roads = new CityRoads(w.group, w.geo, d, w.route, sky.shared, renderer); await step('roads'); // the real side streets (cities)
  w.life = lifeOn ? new Life(w.group, w.route, d, w.terrain, sky.shared) : null; await step('life');
  w.traffic = lifeOn ? new Traffic(w.group, w.route, d, sky.shared) : null; await step('traffic');
  w.facts = (d.facts || []).map((f) => ({ ...f, done: false }));
  return w;
}
// make a built world the current one
function useWorld(w) {
  world = w;
  ({ data, geo, route, terrain, road, elements, buildings, street, roads, life, traffic, facts } = w);
  sky.lat = data.origin.lat;
  sky.shared.uPaved.value = data.scenery?.ground === 'paved' ? 1 : 0;
  side = route.leftHand ? -1 : 1;
  roadEdge = route.road.edge;
  applyWorldQuality();
  envTex = null; // hand the sky reflections to the new place's materials
  lastS = null;
}
useWorld(await buildWorld(firstData));
scene.add(world.group);
mark('world');
// build life's models and compile their shaders now, behind the loading screen, not on first sight
try { life?.warmup?.(renderer, camera); traffic?.warmup?.(renderer, camera); } catch (e) { console.warn('life warm-up failed', e); }
const lifeCtx = { pose: null, s: 0, dir: 1, lat: 0, camera, night: 0, hours: 12, weather: null, speed: 0, started: false };
const rig = new RideRig(scene);
const _tmpV = new THREE.Vector3();
let sweepT = 0;
// The car and horse live on their own layer so they can be drawn at full resolution in their own pass
// (see post.js); the lights that reach them are on both layers, and the sun's shadow camera sees both
// so the ride still casts its shadow on the road.
for (const g of [rig.car.group, rig.horse.root]) g.traverse((o) => { if (o.isLight) o.layers.enable(RIDE_LAYER); else o.layers.set(RIDE_LAYER); });
for (const l of [sky.sun, sky.hemi]) l.layers.enable(RIDE_LAYER);
sky.sun.shadow.camera.layers.enable(RIDE_LAYER);
const SHADOW_ONLY = 3; // (parts of the ride the camera can't see from the seat: shadows only)
sky.sun.shadow.camera.layers.enable(SHADOW_ONLY);
camera.layers.enable(RIDE_LAYER);
mark('rig');
const ambience = new Ambience();

// ---------- UI ----------
const ui = new UI({
  places: manifest.places,
  place: placeId,
  route: [data.name, data.region].filter(Boolean).join(' · '),
  stops: route.stops,
  rides: RIDES,
  weather: { any: { label: 'Any' }, ...WEATHER }, // only where the drive begins: it drifts on from there
  stations: STATIONS.filter((s) => s.id !== 'mine' || s.tracks.length),
  settings: { stop: 0, ride: 'car', weather: 'any', hours: 16.5, timeFlows: true, station: 'open-road', cam: 'seat', ambience: 0.6, music: 0.7, graphics: 'laptop', interleave: true, windDown: 0, quiet: false },
});
const set = ui.settings;
for (const k of ['ride', 'weather', 'cam', 'station', 'graphics']) if (params.has(k)) set[k] = params.get(k);
for (const k of ['stop', 'hours']) if (params.has(k)) set[k] = +params.get(k);
if (set.place !== placeId && !demoOn) { set.place = placeId; if (!params.has('stop')) set.stop = 0; ui._save(); }
if (data.blurb && document.getElementById('start-sub')) document.getElementById('start-sub').textContent = data.blurb;
document.title = `Long Drive · ${data.short || data.name}`;
if (!RIDES[set.ride]) set.ride = 'car';
if (set.weather === 'drift' || !WEATHER[set.weather]) set.weather = 'any';
// The drive runs on by itself: time always passes and the weather always drifts (?wxlock=1 holds it
// still, for testing). What the start screen sets is only how it begins.
set.timeFlows = true;
if (params.has('winddown')) set.windDown = +params.get('winddown'); // testing: e.g. ?winddown=3 (minutes)
if (params.has('quiet')) set.quiet = params.get('quiet') === '1';
set.graphics = LEGACY_GFX[set.graphics] || String(set.graphics);
if (!QUALITY[set.graphics]) set.graphics = 'laptop';
ui._refreshAll();
set.stop = clamp(set.stop | 0, 0, route.stops.length - 1); // (the drawer's "jump to" list)

// Every place is a loop: circuits are driven in their racing direction; a one-way road is driven out and
// back (see UTURN), either way along it. A drive begins anywhere on the loop (?stop=N: at that stop, for
// testing), kept clear of the turning points.
function randomStart(r) {
  if (r.loop) return { s: Math.random() * r.length, dir: 1 };
  const m = Math.min(600, r.length * 0.2);
  return { s: m + Math.random() * Math.max(1, r.length - 2 * m), dir: Math.random() < 0.5 ? 1 : -1 };
}
const start0 = params.has('stop') ? { s: route.stops[set.stop].s, dir: 1 } : randomStart(route);
const st = {
  s: start0.s,
  dir: start0.dir,
  speed: 0,
  target: 0,
  resume: 0,
  lat: 0,
  latVel: 0,
  yaw: 0,
  pitch: 0,
  turnRate: 0,
  lookYaw: 0,
  lookPitch: 0,
  lastLook: -1e9,
  hours: set.hours,
  turning: false,
  yawVel: 0, pitchVel: 0,
};

if (params.has('s')) st.s = +params.get('s'); // test hook: start this many metres along the route
if (params.has('dir')) st.dir = +params.get('dir') < 0 ? -1 : 1; // test hook: -1 drives the route backwards (e.g. Bryce northbound: the canyon on the right)
// ---------- time that flows unevenly ----------
// Game minutes per real minute, by sun elevation: it lingers through dawn, golden hour, sunset and
// blue hour (9) and hurries through midday (72) and deep night (58). A day takes about 48 real minutes,
// roughly 60% of it in the beautiful light.
function clockRate(e) {
  const pretty = smoothstep(22, 12, e) * smoothstep(-16, -9, e);
  return lerp(lerp(72, 58, smoothstep(-9, -16, e)), 9, pretty);
}

// ---------- weather that drifts on its own ("Ever-changing") ----------
// A slow random walk between neighbouring kinds of weather: clouds build, a shower passes, mist at
// dawn. Each spell lasts a few minutes and rolls in gradually.
// "Any": a fair start, mostly fine weather
const startWeather = (w) => {
  if (WEATHER[w]) return w;
  const odds = [['clear', 4], ['clouds', 4], ['overcast', 1.5], ['rain', 1], ['mist', 0.6]];
  let r = Math.random() * odds.reduce((t, o) => t + o[1], 0);
  for (const [id, n] of odds) if ((r -= n) <= 0) return id;
  return 'clear';
};
const wx = { id: startWeather(set.weather), picked: !!WEATHER[set.weather], left: 60 + Math.random() * 120, drifting: false };
const WX_NEXT = {
  clear: [['clouds', 5], ['clear', 2], ['mist', 0.6]],
  clouds: [['clear', 3], ['overcast', 3], ['rain', 1]],
  overcast: [['clouds', 3], ['rain', 3], ['mist', 1], ['snow', 0.5]],
  rain: [['overcast', 3], ['clouds', 3]],
  mist: [['clear', 3], ['clouds', 2]],
  snow: [['overcast', 3], ['clouds', 1]],
};
const WX_SAY = {
  clear: 'The sky has opened right up out there.', clouds: 'A few clouds are drifting in now.', overcast: 'It has gone grey and quiet overhead.',
  rain: 'There is a little rain coming down now. Take it easy.', mist: 'Some mist is settling over the road.', snow: 'And would you look at that. Snow.',
};
function driftWeather(dt) {
  if (params.get('wxlock') === '1' || demoOn) { wx.drifting = false; sky.wxRate = 1; return; } // (the demo sets each chapter's weather)
  if (!wx.drifting) { wx.drifting = true; sky.wxRate = 1; wx.left = wx.picked ? 600 + Math.random() * 300 : 90 + Math.random() * 150; if (params.has('wxfast')) wx.left = 6; return; }
  if (!ui.started) return;
  wx.left -= dt;
  if (wx.left > 0) return;
  let opts = WX_NEXT[wx.id].slice();
  const dawn = st.hours > 4.5 && st.hours < 8.5;
  opts = opts.map(([id, w]) => [id, id === 'mist' ? w * (dawn ? 5 : 0.4) : id === 'snow' ? w * (data.origin.lat > 45 || data.id === 'bryce' ? 1 : 0) : w]);
  // cosy over dreary: gentle rain at night, mist at dawn, little flat grey by day (and during a
  // wind-down, mostly clear or softly raining nights)
  const nightNow = st.hours >= 20.5 || st.hours < 4.5;
  opts = opts.map(([id, w]) => [id, w * (nightNow ? { rain: 1.7, overcast: 0.6, mist: 1.2 }[id] ?? 1 : { overcast: 0.5 }[id] ?? 1)]);
  if (calm.wind) opts = opts.map(([id, w]) => [id, w * ({ clear: 1.5, rain: 1.4, overcast: 0.4, snow: 0.6 }[id] ?? 1)]);
  // around sunrise and sunset favour scattered cloud (it makes the colourful skies) over grey and rain
  if (Math.abs(sky.elevDeg) < 14) opts = opts.map(([id, w]) => [id, w * ({ clouds: 2.2, overcast: 0.45, rain: 0.45, snow: 0.5 }[id] ?? 1)]);
  let r = Math.random() * opts.reduce((a, o) => a + o[1], 0), next = opts[0][0];
  for (const [id, w] of opts) { if ((r -= w) <= 0) { next = id; break; } }
  sky.wxRate = 0.07; // rolls in over about a minute
  wx.left = params.has('wxfast') ? 8 : (next === 'rain' || next === 'snow' || next === 'mist' ? 150 : 210) + Math.random() * 240;
  if (next !== wx.id) { wx.id = next; bus.emit('weather', { to: next, label: WX_SAY[next] }); }
}

// ---------- things worth a mention on the radio ----------
bus.on('weather', (e) => radio.note(e.label));
bus.on('sighting', (e) => radio.note(pick([`Did you catch that back there? ${cap(e.label)}.`, `Somebody just told me they saw ${e.label}. Lucky them.`, `${cap(e.label)}, a moment ago. That is what the slow road is for.`])));
bus.on('traffic', (e) => { if (Math.random() < 0.4) radio.note(pick([`${cap(e.label)} went by just now. Everybody is going somewhere.`, `You are not the only one out tonight. ${cap(e.label)} just passed.`])); });
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// short true facts about the place, spoken over the music as you pass (at most one every few minutes).
// A landmark can have several: a random one each time, never the one told there last time (remembered
// across sessions).
function factText(f) {
  const texts = f.texts || [f.text];
  if (texts.length < 2) return texts[0];
  const key = `${data.id}@${Math.round(f.s)}`;
  let last = {};
  try { last = JSON.parse(localStorage.getItem('longdrive.factLast') || '{}'); } catch (e) { last = {}; }
  const prev = last[key];
  let i;
  if (prev == null || prev >= texts.length) i = Math.floor(Math.random() * texts.length);
  else { i = Math.floor(Math.random() * (texts.length - 1)); if (i >= prev) i++; } // any but the one heard last time
  last[key] = i;
  try { localStorage.setItem('longdrive.factLast', JSON.stringify(last)); } catch (e) { /* ignore */ }
  return texts[i];
}
let factGap = 15;
function tellFacts(dt) {
  factGap -= dt;
  const prev = lastS; lastS = st.s;
  if (demoOn) return; // the demo's announcer tells one chosen fact per chapter
  if (prev == null || !ui.started || factGap > 0 || st.speed < 1) return;
  const lo = Math.min(prev, st.s), hi = Math.max(prev, st.s);
  if (hi - lo > 200) return; // jumped or wrapped a lap
  for (const f of facts) {
    if (f.done || f.s < lo - 1 || f.s > hi + 1) continue;
    f.done = true;
    factGap = params.has('factfast') ? 0.5 : 150; // (?factfast=1: testing)
    radio.interject([factText(f)]).then((ok) => { if (!ok) { f.done = false; factGap = 20; } });
    if (facts.every((x) => x.done)) setTimeout(() => facts.forEach((x) => (x.done = false)), 600000); // long drives hear them again much later
    break;
  }
}

// test overrides, e.g. ?lines=900&msaa=2&lod=60&shadows=0
for (const q of Object.values(QUALITY)) {
  if (params.has('lines')) q.lines = +params.get('lines');
  if (params.has('msaa')) q.msaa = +params.get('msaa');
  if (params.has('lod')) q.lod = +params.get('lod');
  if (params.has('shadows')) q.shadows = params.get('shadows') === '1';
}
const noCap = params.has('nocap');
const orbit = params.has('orbit') ? params.get('orbit').split(',').map(Number) : null;
// inspection camera (?look=lat,lon,height,lat2,lon2,height2): fixed at the first point, looking at the second (heights above ground)
const look = params.has('look') ? params.get('look').split(',').map(Number) : null;
const hide = (params.get('hide') || '').split(',').filter(Boolean); // perf testing: ?hide=sky,clouds,terrain,trees,road,rig
function applyHide() {
  const h = (k) => hide.includes(k);
  sky.sky.visible = !h('sky');
  sky.clouds.visible = !h('clouds');
  scene.traverse((o) => {
    if (o.isInstancedMesh) o.visible = !h('trees');
    else if (o.isMesh && h('terrain') && o.material?.customProgramCacheKey?.() === 'terrain') o.visible = false;
  });
  for (const m of road.chunks.values()) if (m) m.visible = !h('road');
}
// ---------- steady pacing ----------
// Smooth beats fast. Three things keep every frame even:
//  1. Motion advances by the same step every frame (the display's own refresh interval), not by a
//     jittery measured time, so the road, trees and camera glide instead of micro-stuttering.
//  2. The landscape is drawn at the chosen mode's resolution and scaled up through the soft look,
//     which hides it; if frames start arriving late, that resolution is lowered a little further.
//     The car or horse is never lowered: it is drawn at full screen resolution in its own pass.
//  3. If that is not enough, the game drops to a steady half rate (30 on a 60 Hz screen) rather
//     than wobbling between rates. It never see-saws: it only creeps back up after a long calm spell.
const pace = { vs: 16.7, gaps: [], tick: 0, lastRaf: 0, div: 1, scale: 1, n: -120, miss: 0, calm: 0 };
const usesPost = () => usePost;
const quality = () => QUALITY[set.graphics] || QUALITY.laptop;
// device pixels per CSS pixel for the screen itself (the car/horse and the final picture) and for the landscape
// the ride and the final picture: the screen's resolution, but never more than 1080 lines (Retina
// resolution costs a lot of GPU for detail nobody notices from a sofa or a laptop's distance)
const FULL_LINES = +(params.get('fulllines') || 1080);
const fullRatio = () => Math.min(window.devicePixelRatio || 1, FULL_LINES / Math.max(1, window.innerHeight));
const worldRatio = () => Math.min(fullRatio(), quality().lines / Math.max(1, window.innerHeight)) * pace.scale;
function governor(real, ideal, dt) {
  if (!ui.started || terrain.busy > 6 || document.hidden || st.turning) { pace.n = Math.min(pace.n, 0); pace.miss = 0; return; }
  pace.calm += dt;
  if (++pace.n <= 0) return;
  if (real > ideal * 1.45) pace.miss++;
  if (pace.n < 240) return;
  const late = pace.miss / pace.n;
  pace.n = 0; pace.miss = 0;
  const top = quality().scale;
  if (late > 0.06) {
    if (pace.scale > 0.72) { pace.scale = Math.max(0.7, pace.scale - 0.1); applyScale(); }
    else if (pace.div < 2) pace.div = 2;
    pace.calm = 0;
  } else if (late < 0.01 && pace.calm > 150 && pace.scale < top) {
    pace.scale = Math.min(top, pace.scale + 0.07); applyScale(); pace.calm = 90;
  }
}
function applyScale() {
  pace.n = -90; // don't judge the frames spent re-allocating
  if (usesPost()) post.setSize(window.innerWidth, window.innerHeight, worldRatio(), fullRatio(), quality().msaa);
  else resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const q = quality();
  if (pace.preset !== set.graphics) { pace.preset = set.graphics; pace.scale = q.scale; pace.div = q.div || 1; }
  // the car's static parts merged by material (the same materials, so the same look: ~46 draws -> ~20), in
  // zones, so what the seat can't see is skipped (see SHADOW_ONLY)
  if (!rig.merged) {
    rig.merged = true;
    const c = rig.car, zoneOf = (b) => (b.min.z > 0.85 ? 'rear' : b.max.z < -0.8 && b.max.y < 0.78 ? 'low' : '');
    const a = mergeStatic(c.body, [c.needle, c.steerWheel], zoneOf);
    for (const w of c.wheels) mergeStatic(w);
    rig.outsideOnly = a.zones.low || [];
  }
  renderer.setPixelRatio(usesPost() ? fullRatio() : worldRatio());
  renderer.setSize(w, h, false);
  renderer.shadowMap.enabled = q.shadows;
  sky.sun.castShadow = q.shadows;
  if (sky.sun.shadow.mapSize.x !== q.shadowMap) { sky.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap); sky.sun.shadow.map?.dispose(); sky.sun.shadow.map = null; }
  sky.shared.uLodDist.value = q.lod;
  applyWorldQuality();
  if (usesPost()) post.setSize(w, h, worldRatio(), fullRatio(), q.msaa);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
function applyWorldQuality(w = world) {
  if (!w || !qualityReady) return;
  const q = quality();
  if (w === world) sky.shared.uGroundDist.value = w.data.scenery?.ground === 'paved' ? 0 : q.ground;
  w.terrain.split = q.split; w.terrain.lines = q.lines;
  w.elements.nearRange = q.lod + 14;
  sky.shared.uSmallDist = sky.shared.uSmallDist || { value: 0 };
  sky.shared.uSmallDist.value = w.elements.smallRange; // rocks and shrubs dissolve in at the edge of their range
}
window.addEventListener('resize', resize);
qualityReady = true;
resize();

const radio = new Radio({
  mount: document.getElementById('radio-mount'),
  ambience,
  getContext: () => ({
    hours: st.hours,
    weatherSay: pick(WEATHER[wx.id].say),
    place: route.nearestStop(st.s).name,
    region: data.region,
    short: data.short || data.name,
    ride: set.ride,
  }),
});
radio.onChange = (info) => {
  ui.setRadio(info);
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Where each ride keeps to on this road: in the travel lane, the horse as much as the car (it used to
// keep to the verge). On left-hand-traffic roads (London) everything mirrors.
const laneFor = () => side * route.road.lane;
function setRide(mode) {
  rig.setMode(mode);
  st.lat = laneFor(mode);
  st.target = Math.min(st.target, RIDES[mode].maxSpeed);
  if (ui.started && st.target > 0) st.target = RIDES[mode].cruise;
}
setRide(set.ride);

async function jumpTo(s, flip) {
  if (st.turning) return;
  st.turning = true;
  await ui.fade(true, flip ? 'Turning around' : '');
  st.uturn = null;
  if (flip) st.dir *= -1;
  else { st.s = s; st.dir = 1; }
  st.speed = 0;
  st.lookYaw = 0;
  snapPose();
  await new Promise((r) => setTimeout(r, 900));
  await ui.fade(false);
  st.turning = false;
}

ui.onChange = (key, value) => {
  if (key === 'ride') setRide(value);
  else if (key === 'hours') st.hours = value;
  else if (key === 'windDown') { if (ui.started) startWindDown(value); }
  else if (key === 'quiet') radio.setQuiet(!!value);
  else if (key === 'interleave') { trip.order = []; trip.nextAt = trip.dist + tunnelGap(); } // on: the next tunnel in 4-5 km; off: none
  else if (key === 'weather') { wx.id = startWeather(value); wx.picked = !!WEATHER[value]; wx.drifting = false; sky.wxRate = 1; } // the start screen's preview
  else if (key === 'stop') { st.s = route.stops[value].s; st.dir = 1; snapPose(); }
  else if (key === 'jump') jumpTo(route.stops[value].s, false);
  else if (key === 'station') radio.setStation(value);
  else if (key === 'ambience') ambience.setVolume(value);
  else if (key === 'music') radio.setVolume(value);
  else if (key === 'graphics') resize();
  else if (key === 'surprise') surprise();
  else if (key === 'place') {
    // a different place is a different world: remember the choice and reload into it
    set.place = value; set.stop = 0; ui._save();
    const q = new URLSearchParams(location.search);
    q.set('place', value); q.delete('stop');
    location.search = q.toString();
  }
};
ui.onRadio = (action, value) => {
  if (action === 'toggle') radio.toggle();
  else if (action === 'next') radio.next();
  else if (action === 'custom') {
    const n = radio.setCustom(value);
    ui.toast(n ? `My Station: ${n} added` : 'No YouTube links found');
    if (n) radio.setStation('mine');
  }
};
// ?film=1: recording mode (dev/film.mjs drives the radio card, music and timing itself)
const film = params.has('film');
if (film) document.body.classList.add('film');
ui.onStart = () => {
  ambience.resume();
  ambience.setVolume(set.ambience);
  radio.setVolume(set.music);
  radio.setStation(set.station);
  st.target = RIDES[set.ride].cruise;
  if (demoOn) demoArrive(true); // (sets the demo's own speed)
  else if (!film) radio.start();
  radio.setQuiet(!!set.quiet && !demoOn); // (the demo always has its announcer)
  if (set.windDown > 0 && !demoOn) startWindDown(set.windDown);
};

// "Surprise me": a random place, starting point, ride, hour and weather.
function surprise() {
  const pl = pick(manifest.places);
  const hoursPick = pick([6.2, 7.5, 9, 11, 14, 16.5, 17.8, 18.6, 19.4, 21, 23.5, 16.5, 18.2]);
  Object.assign(set, { ride: Math.random() < 0.7 ? 'car' : 'horse', weather: Math.random() < 0.6 ? 'any' : pick(Object.keys(WEATHER)), hours: hoursPick, timeFlows: true, station: pick(STATIONS.filter((x) => x.id !== 'mine')).id });
  if (pl.id === placeId) {
    const r0 = randomStart(route);
    st.uturn = null; st.s = r0.s; st.dir = r0.dir; st.hours = set.hours;
    setRide(set.ride); radio.setStation(set.station); snapPose();
    ui._save(); ui._refreshAll();
    ui.toast('Somewhere new');
  } else {
    set.place = pl.id; // (a random starting point after the reload, as always)
    ui._save();
    const q = new URLSearchParams(); q.set('place', pl.id);
    location.search = q.toString();
  }
}
document.getElementById('surprise')?.addEventListener('click', (e) => { e.currentTarget.blur(); surprise(); });

// ---------- the endless drive: one place after another, through a tunnel ----------
// With "Interleave places" on, every 4-5 km a tunnel appears ahead and leads to a random point in another
// place; with it off there are no tunnels and the drive keeps going round the place it began in. While the camera is
// inside, only the tunnel and the car are drawn, so there is time to spare: the next place is built a
// little each frame, its landscape streamed in, its shaders compiled and its textures and meshes sent
// to the GPU a few at a time. Then the car is moved, unseen, into an identical tunnel that ends at the
// next place's road, and drives out into the light.
const endless = !film && params.get('endless') !== '0';
// metres of road between tunnels (?tripfast=N: N metres, for testing)
const tunnelGap = () => (params.has('tripfast') ? +params.get('tripfast') || 600 : 4000 + Math.random() * 1000);
const TUNNEL_MIN = 3;     // seconds inside, at the least
const tunnel = new Tunnel(renderer);
tunnel.interior.visible = false;
scene.add(tunnel.interior);
const trip = {
  phase: 'drive',  // drive → approach (portal ahead) → inside → exit (next place's tunnel) → drive
  time: 0, dist: 0, // in this place
  axis: null,       // { x, y, z, fx, fz }: the tunnel's straight line; u is distance along it
  sAxis: 0,         // route position where the car leaves the road for the tunnel line
  mouthU: 0,        // the entrance mouth, along the line
  exitU: null,      // the exit mouth (once the next place is ready)
  u: 0, inT: 0,     // car along the line; seconds inside
  camIn: false,     // camera inside the tube: the outside world is not drawn
  portal: null, next: null, order: [], trash: [], flash: 0,
  nextAt: 0,        // trip.dist at which the next tunnel is due
};
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const kindOf = (id) => manifest.places.find((p) => p.id === id)?.kind;
// the next place: a shuffled round of all the others, never the same place twice running, and a change of
// scene where possible (a city after the countryside, a circuit after a city)
function nextLeg() {
  if (demoOn) { const ch = CHAPTERS[(demo.i + 1) % CHAPTERS.length]; return { id: ch.place, key: `demo:${ch.place}`, from: ch.from, chapter: (demo.i + 1) % CHAPTERS.length }; }
  if (manifest.places.length < 2) return null;
  const others = () => shuffle(manifest.places.filter((p) => p.id !== data.id).map((p) => ({ id: p.id, key: p.id })));
  if (!trip.order.length) trip.order = others();
  let i = trip.order.findIndex((l) => l.id !== data.id && kindOf(l.id) !== data.kind);
  if (i < 0) i = trip.order.findIndex((l) => l.id !== data.id);
  if (i < 0) { trip.order = others(); i = 0; }
  return trip.order.splice(i, 1)[0] || null;
}
const wrapS = (ds) => (route.loop ? ds - Math.round(ds / route.length) * route.length : ds);
function startApproach() {
  const ahead = toTurn();
  if (ahead < 140 || st.uturn) return; // too close to a turning point: after it
  const leg = nextLeg();
  if (!leg) return;
  const id = leg.id;
  // the tunnel mouth appears a little way ahead: about 20 s away (the demo: about 9 s), never more than 420 m
  const lead = clamp(Math.max(st.speed, 3) * (demoOn ? 9 : 20), 50, 420);
  let sA = st.s + st.dir * Math.min(lead, ahead - 30);
  if (route.loop) sA = ((sA % route.length) + route.length) % route.length;
  const P2 = route.sample(sA, {});
  const fx = P2.tx * st.dir, fz = P2.tz * st.dir;
  trip.axis = { x: P2.x, y: P2.y, z: P2.z, fx, fz };
  trip.sAxis = sA; trip.mouthU = 0; trip.exitU = null;
  trip.portal = tunnel.makePortal({ style: data.kind === 'city' ? 'city' : 'rock', halfWidth: route.road.half });
  trip.portal.position.set(P2.x, P2.y, P2.z);
  trip.portal.rotation.y = Math.atan2(-fx, -fz);
  world.group.add(trip.portal);
  trip.phase = 'approach';
  const next = (trip.next = { id, leg, data: null, world: null, stage: 'fetch', t: 0, warm: null });
  fetch(asset(`routes/${id}.json`)).then((r) => r.json()).then((d) => { next.data = d; }).catch((e) => { console.warn('next place failed', e); next.stage = 'failed'; });
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
// everything an old place owned on the GPU, except what all places share (trees, rocks, the tunnel)
let sharedGPU = null;
function collectShared() {
  sharedGPU = new Set();
  const seen = new Set();
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || seen.has(o) || depth > 5) return;
    seen.add(o);
    if (o.isBufferGeometry || o.isTexture || o.isMaterial) { sharedGPU.add(o); if (!o.isMaterial) return; }
    for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v, depth + 1);
  };
  walk(assets, 0);
}
function retireWorld(w) {
  if (!sharedGPU) collectShared();
  const pg = trip.portal_old; // the tunnel's own materials are shared: the portal is put away by the tunnel
  if (pg) { pg.parent?.remove(pg); trip.trash.push(() => tunnel.dispose(pg)); trip.portal_old = null; }
  scene.remove(w.group);
  const items = new Set();
  w.group.traverse((o) => {
    if (o.geometry && !sharedGPU.has(o.geometry) && !o.geometry.userData?.shared) items.add(o.geometry);
    if (o.isInstancedMesh) items.add({ dispose: () => o.dispose() });
    for (const m of [].concat(o.material || [])) {
      if (sharedGPU.has(m)) continue;
      const own = (t) => t?.isTexture && !sharedGPU.has(t) && !t.userData?.shared;
      for (const v of Object.values(m)) if (own(v)) items.add(v);
      for (const u of Object.values(m.uniforms || {})) if (own(u?.value)) items.add(u.value);
    }
  });
  for (const it of items) trip.trash.push(() => it.dispose());
}
// warm-up renders: a few of the next place's meshes at a time into a tiny target, so their buffers and
// textures reach the GPU now instead of all at once when the car comes out
const WARM = 7;
const warmCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 4000);
warmCam.layers.set(WARM);
const warmRT = new THREE.WebGLRenderTarget(64, 36);
// Shader warm-ups compile into an off-screen target like the one the game really draws into (post): a
// shader compiled for the screen is a different program (tone mapping, sRGB output) and is never reused.
function compileForPost(fn) {
  const c0 = renderer.compile;
  renderer.compile = function (s, c, t) {
    const prev = this.getRenderTarget();
    if (usesPost()) this.setRenderTarget(warmRT);
    try { return c0.call(this, s, c, t); } finally { this.setRenderTarget(prev); }
  };
  try { return fn(); } finally { renderer.compile = c0; }
}
let warmBatch = 4;
function warmStep(next) {
  const q = next.warm;
  if (!q.length) return true;
  const t0 = performance.now(), batch = q.splice(0, warmBatch);
  scene.traverse((o) => { if (o.isLight) o.layers.enable(WARM); });
  scene.add(next.world.group);
  const was = batch.map((o) => { const f = o.frustumCulled; o.frustumCulled = false; o.layers.enable(WARM); return f; });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(warmRT);
  renderer.render(scene, warmCam);
  renderer.setRenderTarget(prev);
  batch.forEach((o, i) => { o.frustumCulled = was[i]; o.layers.disable(WARM); });
  scene.remove(next.world.group);
  const ms = performance.now() - t0;
  warmBatch = clamp(Math.round(warmBatch * (ms < 2 ? 1.4 : ms > 5 ? 0.5 : 1)) || 1, 1, 40);
  return !q.length;
}
// one of each animal, person and vehicle made visible (out of sight below ground) so their shaders
// are compiled and their buffers uploaded before they are first met
function showLife(w) {
  const undo = [], L = w.life, T = w.traffic;
  const on = (m) => { m.visible = true; m.count = 1; undo.push(() => { m.visible = false; m.count = 0; }); };
  if (L) {
    for (const a of L.rigPool.values()) if (a.length) { const m = a[0].mesh; m.position.set(0, -500, 0); m.visible = true; L.scene.add(m); undo.push(() => L.scene.remove(m)); }
    on(L.birds.mesh); on(L.eyes.mesh);
    L.warmed = true;
  }
  if (T) { for (const id in T.types) on(T.types[id].mesh); on(T.fx.mesh); }
  return () => undo.forEach((f) => f());
}
// per-frame work on the next place while the car is in the tunnel
let nextStart = null;
async function prepareNext(dt) {
  const n = trip.next;
  if (!n || n.busy) return;
  if (n.stage === 'fetch' && n.data && trip.camIn) {
    n.stage = 'build'; n.busy = true;
    n.world = await buildWorld(n.data, nextFrame);
    console.log('next place built', n.id, JSON.stringify(n.world.times));
    applyWorldQuality(n.world);
    // anywhere on the next place's loop, either way (the demo: where its chapter begins)
    const r2 = n.world.route, r0 = randomStart(r2);
    n.s0 = r0.s; n.dir = r0.dir;
    if (n.leg?.from != null) { n.s0 = clamp(n.leg.from, 0, r2.length - 200); n.dir = 1; }
    n.P0 = r2.sample(n.s0, {});
    n.P0.tx *= n.dir; n.P0.tz *= n.dir; // (heading the way the car will drive)
    n.stage = 'prebuild'; n.t = 0; n.busy = false;
  } else if (n.stage === 'prebuild') {
    // animals, people and vehicles: one model a frame
    const a = n.world.life?.prebuildStep() || false, b = n.world.traffic?.prebuildStep() || false;
    streamWorld(n.world, dt, n.P0.x, n.P0.z, n.P0.tx, n.P0.tz, 40, n.s0);
    n.t += dt;
    if (!a && !b) n.stage = 'stream';
  } else if (n.stage === 'stream') {
    n.t += dt;
    const w = n.world, P0 = n.P0, hx = P0.tx, hz = P0.tz;
    w.terrain.uploadsPerFrame = 1; // one texture a frame: the GPU never has to catch up
    streamWorld(w, dt, P0.x, P0.z, hx, hz, 40, n.s0);
    if (n.t > 2 && w.terrain.settled(P0.x, P0.z) && w.terrain.busy < 2) {
      n.stage = 'compile'; n.busy = true;
      n.unshow = showLife(w);
      try { await renderer.compileAsync(w.group, camera, scene); } catch (e) { console.warn('compileAsync failed', e); }
      n.warm = [];
      w.group.traverseVisible((o) => { if (o.isMesh || o.isPoints || o.isLine) n.warm.push(o); });
      warmBatch = 2; // start small for every place: a batch size learnt on a light place can stall a heavy one
      n.stage = 'warm'; n.busy = false;
    }
  } else if (n.stage === 'warm') {
    streamWorld(n.world, dt, n.P0.x, n.P0.z, n.P0.tx, n.P0.tz, 40, n.s0);
    if (warmStep(n)) { n.unshow?.(); n.stage = 'ready'; }
  }
}
// move the car, unseen, from this tunnel into the next place's tunnel
function handOver() {
  const n = trip.next, old = world;
  const D = 50; // metres of tunnel still to drive after the switch
  const P0 = n.P0, f = { x: P0.tx, z: P0.tz };
  const E = trip.u + D;
  trip.axis = { x: P0.x - f.x * E, y: P0.y, z: P0.z - f.z * E, fx: f.x, fz: f.z };
  trip.exitU = E;
  trip.portal_old = trip.portal; trip.portal = null;
  retireWorld(old);
  surprises.placeChanged();
  useWorld(n.world);
  world.group.visible = false;
  scene.add(world.group);
  st.s = n.s0; st.dir = n.dir; st.uturn = null;
  trip.phase = 'exit';
  trip.next = null;
  const [ty] = targetYawPitch();
  st.yaw = ty; rig._chaseInit = false;
  // a portal at the exit too, for anyone looking back
  const g = tunnel.makePortal({ style: data.kind === 'city' ? 'city' : 'rock', halfWidth: route.road.half });
  g.position.set(P0.x, P0.y, P0.z); g.rotation.y = Math.atan2(f.x, f.z);
  world.group.add(g); trip.portal = g;
  ui.setPlace?.({ place: data.id, stops: route.stops });
  // (the start screen keeps the place the user chose: the drive moving on does not change it)
  document.title = `Long Drive · ${data.short || data.name}`;
}
function tripTick(dt) {
  // the old place's GPU memory is let go of a little at a time
  for (let k = 0; k < 40 && trip.trash.length; k++) { try { trip.trash.shift()(); } catch (e) { /* ignore */ } }
  if (!endless || !ui.started) return;
  if (trip.phase === 'drive') {
    trip.time += dt; trip.dist += st.speed * dt;
    if (!trip.nextAt) trip.nextAt = trip.dist + tunnelGap();
    if (demoOn && trip.time > demo.cineAt) { demo.cineAt = Infinity; const def = CINE_SURPRISES.find((d) => d.id === 'cine'); if (def && !surprises.running(def)) surprises.start(def, surpriseCtx); }
    const due = demoOn ? trip.time > CHAPTER_SECONDS : set.interleave && trip.dist >= trip.nextAt;
    if (due && !st.turning && !st.uturn && toTurn() > 700) startApproach(); // (just before a turning point: after it)
  } else if (trip.phase === 'approach') {
    if (st.turning) { // a jump or turn-around: drop this tunnel, another comes later
      trip.portal?.parent?.remove(trip.portal); tunnel.dispose(trip.portal); trip.portal = null;
      trip.next = null; trip.phase = 'drive'; trip.nextAt = trip.dist + 300; trip.time = Math.min(trip.time, CHAPTER_SECONDS - 20); return;
    }
    if (wrapS(st.s - trip.sAxis) * st.dir >= 0) {
      trip.phase = 'inside'; trip.u = Math.abs(wrapS(st.s - trip.sAxis)); trip.inT = 0;
      if (demoOn && trip.next?.leg?.chapter != null) demoEnterTunnel(trip.next.leg.chapter);
    }
  } else if (trip.phase === 'inside') {
    trip.inT += dt;
    prepareNext(dt);
    if (trip.next?.stage === 'ready' && trip.inT > TUNNEL_MIN && trip.camIn) handOver();
    if (trip.next?.stage === 'failed') trip.next = null; // keep driving; the tunnel is endless until something works
  } else if (trip.phase === 'exit') {
    if (trip.u >= trip.exitU) { // out on the new road
      st.s += st.dir * (trip.u - trip.exitU);
      st.s = route.loop ? ((st.s % route.length) + route.length) % route.length : clamp(st.s, 0, route.length);
      trip.phase = 'drive'; trip.time = 0; trip.dist = 0; trip.nextAt = tunnelGap(); trip.laneEase = 8;
      if (demoOn) demoArrive(false);
      else {
        radio.interject([`And here we are. ${data.name}${data.region && !data.name.includes(data.region) ? ', ' + data.region : ''}.`]).catch(() => {});
        ui.toast(data.short || data.name);
      }
    }
  }
}
// where the camera is relative to the tube: hide the world inside, bring it back at the exit
function tunnelView(dt) {
  const a = trip.axis;
  let inside = false, uc = 0;
  if (a && (trip.phase === 'inside' || trip.phase === 'exit')) {
    uc = (camera.position.x - a.x) * a.fx + (camera.position.z - a.z) * a.fz;
    inside = uc > trip.mouthU + 0.3 && (trip.exitU == null || uc < trip.exitU - 0.2);
  }
  if (inside !== trip.camIn) {
    trip.camIn = inside;
    world.group.visible = !inside;
    tunnel.interior.visible = inside;
    sky.sky.visible = sky.clouds.visible = !inside;
    if (!inside && trip.phase === 'exit') trip.flash = 1; // daylight: the eyes take a moment
  }
  if (inside) {
    for (const o of [sky.stars, sky.moon, sky.rain, sky.snow]) o.visible = false;
    // moved along in whole 98 m steps (7 lamp periods), where every lamp, line and sign repeats exactly
    const P = TUNNEL.period, k = 7 * Math.max(0, Math.floor((uc - 30) / (7 * P)));
    const ox = a.x + a.fx * k * P, oz = a.z + a.fz * k * P;
    tunnel.interior.position.set(ox, a.y, oz);
    tunnel.interior.rotation.y = Math.atan2(-a.fx, -a.fz);
    tunnel.setExit(trip.exitU == null ? null : trip.exitU - k * P);
    tunnel.setExitColor(sky.fog.color.clone().multiplyScalar(1.6).addScalar(0.15 * (1 - sky.night)));
    // tunnel light on the car: warm, pulsing gently as each lamp passes overhead
    const l = tunnel.lightAt(-(trip.u - k * P));
    sky.sun.intensity = 0;
    sky.hemi.intensity = 0.55 + 1.1 * l;
    sky.hemi.color.setRGB(1, 0.84, 0.64);
    sky.hemi.groundColor.setRGB(0.32, 0.27, 0.22);
  }
  tunnel._u?.uDay?.value.setRGB(0.55, 0.58, 0.62).multiplyScalar(0.12 + 0.88 * (1 - sky.night)); // daylight spilling into the portals
  trip.flash = Math.max(0, trip.flash - dt / 1.8);
  renderer.toneMappingExposure = 0.5 * (1 + 0.9 * trip.flash * trip.flash) * calm.dim;
}

// ---------- surprises (see surprises.js) ----------
const surprises = new Surprises([...SKY_SURPRISES, ...LOCAL_SURPRISES, ...CINE_SURPRISES, ...MANHATTAN_LANDMARKS, ...BRYCE_LANDMARKS], {
  gap: params.has('surprisefast') ? [15, 25] : [120, 240],
  force: params.get('surprise'),
});
surprises.onSight = (def, label) => bus.emit('sighting', { what: def.id, label });
// what a surprise can see of the game; one object, refreshed every frame
const surpriseCtx = {
  started: false, inTunnel: false, dt: 0, hours: 12, prevHours: 12, night: 0, elevDeg: 45,
  sunDir: sky.sunDir, moonDir: sky.moonDir, weatherId: 'clear', w: sky.w,
  camera, pose: null, s: 0, dir: 1, speed: 0, place: null, route: null, geo: null, terrain: null,
  scene, world: null, fog: sky.fog, horizon: sky.skyHorizon, renderer, shared: sky.shared,
  audio: { ctx: null, out: null }, st: null,
};
function updateSurprises(dt) {
  const c = surpriseCtx;
  c.prevHours = c.hours;
  Object.assign(c, {
    started: ui.started, inTunnel: trip.camIn || trip.phase === 'inside' || trip.phase === 'exit', dt,
    hours: st.hours, night: sky.night, elevDeg: sky.elevDeg, weatherId: wx.id, w: sky.w,
    pose, s: st.s, dir: st.dir, speed: st.speed, place: data, route, geo, terrain, world: world.group, st,
  });
  c.audio.ctx = ambience.context; c.audio.out = ambience._g?.master || null;
  surprises.update(dt, c);
}


// ---------- input ----------
const keys = new Set();
const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range';
window.addEventListener('keydown', (e) => {
  if (typing(e) || e.metaKey || e.ctrlKey) return;
  if (demoOn) return; // the demo ignores every key but F (full screen, handled below)
  keys.add(e.code);
  if (!ui.started || e.repeat) return;
  if (e.code === 'Space') { e.preventDefault(); toggleGo(); }
  else if (e.code === 'KeyC') toggleCam();
  else if (e.code === 'KeyR') jumpTo(0, true);
  else if (e.code === 'KeyN') radio.next();
  else if (e.code === 'KeyM') radio.toggle();
  else if (e.code === 'Digit1') { ui.set('ride', 'car'); set.ride = 'car'; setRide('car'); }
  else if (e.code === 'Digit2') { ui.set('ride', 'horse'); set.ride = 'horse'; setRide('horse'); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

// ---------- full screen (F, or the button) ----------
const fsBtn = document.getElementById('fs-btn');
const toggleFullscreen = () => {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' })?.catch?.(() => ui.toast('Full screen is not available here'));
};
const syncFs = () => { if (fsBtn) fsBtn.textContent = document.fullscreenElement || document.webkitFullscreenElement ? 'Exit full screen' : 'Full screen'; };
document.addEventListener('fullscreenchange', syncFs);
document.addEventListener('webkitfullscreenchange', syncFs);
fsBtn?.addEventListener('click', () => { toggleFullscreen(); fsBtn.blur(); });
window.addEventListener('keydown', (e) => { if (e.code === 'KeyF' && !typing(e) && !e.repeat && !e.metaKey && !e.ctrlKey) toggleFullscreen(); });

// ---------- game controller ----------
// Left stick or D-pad steers and sets speed, A = stop/go (or Begin), B = turn around, X = next song,
// Y = view, bumpers = change ride, Start = music on/off. Enter on the keyboard acts like A.
const pad = { steer: 0, throttle: 0, prev: [] };
const toggleGo = () => {
  if (!ui.started) { document.getElementById('begin')?.click(); return; }
  if (st.target > 0.05) { st.resume = st.target; st.target = 0; }
  else st.target = st.resume || RIDES[set.ride].cruise;
};
const toggleCam = () => {
  const cam = set.cam === 'seat' ? 'chase' : 'seat';
  ui.set('cam', cam);
  set.cam = cam;
  ui.toast(cam === 'seat' ? 'Seat view' : 'Chase view');
};
const cycleRide = (d) => {
  const ids = Object.keys(RIDES), next = ids[(ids.indexOf(set.ride) + d + ids.length) % ids.length];
  ui.set('ride', next); set.ride = next; setRide(next);
  ui.toast(RIDES[next].label);
};
function pollPad() {
  pad.steer = 0; pad.throttle = 0;
  if (demoOn) return;
  const gp = [...(navigator.getGamepads?.() || [])].find((g) => g && g.connected);
  if (!gp) return;
  const b = (i) => !!gp.buttons[i]?.pressed, v = (i) => gp.buttons[i]?.value || 0;
  const dead = (x) => (Math.abs(x) < 0.18 ? 0 : x);
  pad.steer = clamp(dead(gp.axes[0] || 0) + (b(15) ? 1 : 0) - (b(14) ? 1 : 0), -1, 1);
  pad.throttle = clamp(v(7) - v(6) - dead(gp.axes[1] || 0) + (b(12) ? 1 : 0) - (b(13) ? 1 : 0), -1, 1);
  const hit = (i) => b(i) && !pad.prev[i];
  if (hit(0)) toggleGo();
  if (ui.started) {
    if (hit(1)) jumpTo(0, true);
    if (hit(2)) radio.next();
    if (hit(3)) toggleCam();
    if (hit(4)) cycleRide(-1);
    if (hit(5)) cycleRide(1);
    if (hit(9)) radio.toggle();
    // right stick looks around
    const lx = dead(gp.axes[2] || 0), ly = dead(gp.axes[3] || 0);
    if (lx || ly) {
      st.lookYaw -= lx * 0.03;
      st.lookPitch = clamp(st.lookPitch - ly * 0.02, -0.9, 1.1);
      st.lastLook = performance.now();
    }
  }
  pad.prev = gp.buttons.map((x) => x.pressed);
}
window.addEventListener('keydown', (e) => { if (e.code === 'Enter' && !typing(e) && !e.repeat && !ui.drawerOpen && document.activeElement?.tagName !== 'BUTTON') toggleGo(); });

window.addEventListener('blur', () => keys.clear());
let drag = null;
canvas.addEventListener('pointerdown', (e) => { if (demoOn) return; drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  st.lookYaw -= (e.clientX - drag.x) * 0.0035;
  st.lookPitch = clamp(st.lookPitch - (e.clientY - drag.y) * 0.003, -0.9, 1.1);
  drag.x = e.clientX; drag.y = e.clientY;
  st.lastLook = performance.now();
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---------- simulation ----------
const P = {}, PT = {};
const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, turnRate: 0 };
const env = { night: 0, lookYaw: 0, lookPitch: 0, camMode: 'seat', beat: 0, level: 0, music: false };
const music = { phase: 0, bpm: 0 };
const camVel = new THREE.Vector3(), lastCam = new THREE.Vector3();
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ---------- out and back: a one-way road driven as a loop ----------
// Near either end of the road the car slows and swings round in one smooth half-ellipse (reaching UTURN.reach
// metres on) onto the other side of the same road, then drives back. st.lat is measured from the direction
// of travel, so after the turn the same lane offset is the lane going the other way.
const UTURN = { reach: 9, margin: 4, speed: { car: 4.5, horse: 2.6 } };
const turnS = (dir) => (dir > 0 ? route.length - UTURN.reach - UTURN.margin : UTURN.reach + UTURN.margin);
const toTurn = () => (route.loop ? Infinity : (turnS(st.dir) - st.s) * st.dir); // metres to the next turning point
function beginUTurn() {
  const sT = turnS(st.dir), C = route.sample(sT, {});
  st.s = sT; st.latVel = 0;
  st.uturn = { phi: 0, x: C.x, y: C.y, z: C.z, fx: C.tx * st.dir, fz: C.tz * st.dir, a: UTURN.reach, latS: st.lat, latE: laneFor(set.ride) };
}
// position and heading on the half-ellipse at angle phi (0: entering, PI: leaving the other way)
function uturnAt(u, out) {
  const c = Math.cos(u.phi), sn = Math.sin(u.phi);
  const lat = (u.latS * (1 + c)) / 2 - (u.latE * (1 - c)) / 2, dLat = (-sn * (u.latS + u.latE)) / 2;
  out.x = u.x + u.fx * u.a * sn - u.fz * lat;
  out.z = u.z + u.fz * u.a * sn + u.fx * lat;
  out.tx = u.fx * u.a * c - u.fz * dLat;
  out.tz = u.fz * u.a * c + u.fx * dLat;
  return out;
}
const UT = {};
function advanceUTurn(dt) {
  const u = st.uturn;
  uturnAt(u, UT);
  u.phi += (st.speed * dt) / Math.max(Math.hypot(UT.tx, UT.tz), 0.8);
  if (u.phi >= Math.PI) { st.dir *= -1; st.lat = u.latE; st.uturn = null; } // round: back on the road the other way
}

function targetYawPitch() {
  if (st.uturn) {
    uturnAt(st.uturn, UT);
    pose.x = UT.x; pose.z = UT.z; pose.y = st.uturn.y + 0.06;
    return [Math.atan2(-UT.tx, -UT.tz), 0];
  }
  if (trip.phase === 'inside' || trip.phase === 'exit') {
    const a = trip.axis;
    pose.x = a.x + a.fx * trip.u - a.fz * st.lat;
    pose.z = a.z + a.fz * trip.u + a.fx * st.lat;
    pose.y = a.y + 0.06;
    return [Math.atan2(-a.fx, -a.fz) - Math.atan(st.latVel / Math.max(st.speed, 4)), 0];
  }
  route.sample(st.s, P);
  // Heading from the road's direction averaged over ~16 m (a little more ahead than behind), not
  // its direction at this exact point: map data has sharp kinks at junction nodes, and following
  // them exactly makes the view (and, through the lane offset, the car's position) jerk at each one.
  let ax = 0, az = 0, sl = 0, wsum = 0;
  for (let k = -2; k <= 3; k++) {
    route.sample(st.s + st.dir * k * 3, PT);
    const w = 4 - Math.abs(k - 0.5);
    ax += PT.tx * w; az += PT.tz * w; sl += PT.slope * w; wsum += w;
  }
  const al = Math.hypot(ax, az) || 1;
  P.slope = sl / wsum;
  const fx = (ax / al) * st.dir, fz = (az / al) * st.dir;
  pose.x = P.x - fz * st.lat;
  pose.z = P.z + fx * st.lat;
  pose.y = P.y + 0.06;
  return [Math.atan2(-fx, -fz) - Math.atan(st.latVel / Math.max(st.speed, 4)), Math.atan(P.slope * st.dir)];
}
function snapPose() {
  st.latVel = 0;
  [st.yaw, st.pitch] = targetYawPitch();
  st.turnRate = 0; st.yawVel = 0; st.pitchVel = 0;
  snap = 3;
}
let snap = 3;

function simulate(dt) {
  const now0 = performance.now();
  const ride = RIDES[set.ride];
  const active = ui.started && !st.turning && !ui.drawerOpen && !demoOn; // (the demo drives itself)
  if (active) {
    const up = keys.has('KeyW') || keys.has('ArrowUp'), down = keys.has('KeyS') || keys.has('ArrowDown');
    const thr = clamp((up ? 1 : 0) - (down ? 1 : 0) + pad.throttle, -1, 1);
    if (thr > 0) st.target = Math.min(ride.maxSpeed, st.target + (ride.maxSpeed / 7) * thr * dt);
    if (thr < 0) st.target = Math.max(0, st.target + (ride.maxSpeed / 4) * thr * dt);
    const steer = clamp((keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + pad.steer, -1, 1);
    st.latVel = damp(st.latVel, steer * Math.min(1.6, 0.5 + st.speed * 0.12), 3, dt);
  } else st.latVel = damp(st.latVel, 0, 3, dt);
  if (st.uturn) st.latVel = 0; // (the turn steers itself)
  const tubeLine = trip.phase === 'inside' || trip.phase === 'exit';
  if (tubeLine) { // keep to the lane in the tunnel
    const lane = side * (TUNNEL.halfWidth * 0.34);
    if (!active || Math.abs(st.latVel) < 0.05) st.lat = damp(st.lat, lane, 0.8, dt);
    st.lat = clamp(st.lat + st.latVel * dt, -(TUNNEL.halfWidth - 1.3), TUNNEL.halfWidth - 1.3);
  } else {
    if (trip.laneEase > 0) { trip.laneEase -= dt; if (Math.abs(st.latVel) < 0.05) st.lat = damp(st.lat, laneFor(set.ride), 0.7, dt); } // back into this road's lane
    st.lat = clamp(st.lat + st.latVel * dt, -(roadEdge + 0.9), roadEdge + 0.9); // may wander onto the verge, never off the ribbon
  }

  // ease toward the cruise speed, slowing gracefully to turning pace before the end of the road
  const ahead = tubeLine ? 1e9 : toTurn(), vTurn = UTURN.speed[set.ride] || 3;
  let want = ui.started ? st.target : 0;
  want = Math.min(want, windSpeed(ride.cruise)); // winding down: an easier pace (it never stops)
  want = Math.min(want, Math.sqrt(vTurn * vTurn + Math.max(0, ahead) * 2 * ride.brake * 0.5));
  if (st.uturn) want = Math.min(want, vTurn);
  // Ease off into bends and stretch out on the straights, like a driver who is in no hurry: look far
  // enough ahead to brake gently, and take each bend at a speed that keeps the sideways pull mild.
  let bend = false;
  if (want > 0.5 && !tubeLine && !st.uturn) {
    const curv = route.curv, n = route.n, soft = ride === RIDES.car ? 1.5 : 1.0, aLat = ride === RIDES.car ? 2.3 : 1.4;
    const look = (st.speed * st.speed) / (2 * soft) + 30;
    let lim = Infinity;
    for (let d = 0; d <= look; d += route.step) {
      let i = Math.round((st.s + st.dir * d) / route.step);
      i = route.loop ? ((i % n) + n) % n : clamp(i, 0, n - 1);
      const k = curv[i];
      if (k < 2e-4) continue;
      const v = Math.sqrt(aLat / k + 2 * soft * d);
      if (v < lim) lim = v;
    }
    lim = Math.max(lim, ride === RIDES.car ? 4.5 : 2.2);
    if (lim > want * 1.5 && st.target >= ride.cruise * 0.9 && !demoOn) want = Math.min(ride.maxSpeed, want * 1.18); // open road ahead
    if (lim < want) { want = lim; bend = true; }
  }
  const rate = want > st.speed ? ride.accel * 0.8 : bend ? Math.min(ride.brake, 1.9) : ride.brake;
  st.speed += clamp(want - st.speed, -rate * dt, rate * dt);
  if (tubeLine) trip.u += st.speed * dt;
  else if (st.uturn) advanceUTurn(dt);
  else st.s = st.s + st.dir * st.speed * dt;
  st.s = route.loop ? ((st.s % route.length) + route.length) % route.length : clamp(st.s, 0, route.length);
  if (!st.uturn && !tubeLine && !route.loop && toTurn() <= 0 && !st.turning) beginUTurn();

  const [ty, tp] = targetYawPitch();
  const prevYaw = st.yaw;
  if (snap > 0) { st.yaw = ty; st.pitch = tp; st.yawVel = st.pitchVel = 0; snap--; }
  else {
    // critically damped springs: the turn rate itself eases in and out, so entering and leaving a
    // bend is a smooth swing rather than a series of small jerks
    const wy = 4.5, wp = 3.5;
    st.yawVel += (wy * wy * angDiff(ty, st.yaw) - 2 * wy * st.yawVel) * dt;
    st.yaw += st.yawVel * dt;
    st.pitchVel += (wp * wp * (tp - st.pitch) - 2 * wp * st.pitchVel) * dt;
    st.pitch += st.pitchVel * dt;
  }
  st.turnRate = damp(st.turnRate, angDiff(st.yaw, prevYaw) / Math.max(dt, 1e-3), 5, dt);

  // free look drifts back to the road ahead once you let go
  if (!drag && performance.now() - st.lastLook > 5000 && st.speed > 0.5) {
    st.lookYaw = damp(st.lookYaw, 0, 0.5, dt);
    st.lookPitch = damp(st.lookPitch, 0, 0.5, dt);
  }
  if (set.timeFlows && ui.started) st.hours = (st.hours + (dt / 3600) * windClock(clockRate(sky.elevDeg))) % 24;

  pose.yaw = st.yaw; pose.pitch = st.pitch; pose.speed = st.speed; pose.turnRate = st.turnRate;
  // the beat of what is on the radio (tempo from a table, see radio.js): a soft pulse for the dash lights
  const tp0 = radio.tempo();
  if (tp0.playing) music.phase += (dt * tp0.bpm) / 60;
  const ph = music.phase % 1;
  env.music = tp0.playing || tp0.speaking;
  env.beat = tp0.playing ? Math.pow(0.5 + 0.5 * Math.cos(ph * 6.2832), 3) : tp0.speaking ? 0.35 + 0.25 * Math.sin(now0 * 0.011) * Math.sin(now0 * 0.0037) : 0;
  env.level = tp0.playing ? clamp(0.3 + 0.45 * env.beat + 0.2 * Math.sin(music.phase * 1.57 + 1) + 0.1 * Math.sin(now0 * 0.021), 0, 1) : tp0.speaking ? clamp(0.25 + env.beat * 0.6, 0, 1) : 0;
  if (tp0.bpm !== music.bpm) { music.bpm = tp0.bpm; document.documentElement.style.setProperty('--beat-s', (60 / tp0.bpm).toFixed(3) + 's'); }
  env.night = trip.camIn ? Math.max(sky.night, 0.85) : sky.night; env.lookYaw = st.lookYaw; env.lookPitch = st.lookPitch; env.camMode = set.cam;
}

function streamWorld(w, dt, x, z, hx, hz, lead, s) {
  w.terrain.update(x + hx * lead, z + hz * lead);
  w.road.update(s);
  if (envTex) w.road.setEnvMap(envTex);
  w.elements.update(dt, x + hx * lead * 0.4, z + hz * lead * 0.4);
  w.buildings.update(dt, x, z);
  w.street.update(dt, x, z);
  w.roads.update(dt, x, z);
}

// ---------- calm: wind-down, quiet mode, a gentler night ----------
// Wind down: over the chosen time the car eases to a slower pace, the clock steers into the night, the
// music fades away a little at a time and the picture dims, while the wind, the rain and the crickets
// stay. Then it carries on like that: the car never stops, night holds (it never goes on into dawn),
// and the radio stays off until the wind-down is switched off again.
const calm = { wind: null, dim: 1, radioOff: false };
const ease01 = (a, b, v) => smoothstep(a, b, v);
function startWindDown(min) {
  calm.wind = min > 0 ? { t: 0, dur: min * 60 } : null;
  if (!calm.wind && calm.radioOff) { calm.radioOff = false; try { radio.toggle(); } catch (e) { /* ignore */ } } // switched off: the music comes back
}
const windP = () => (calm.wind ? Math.min(1, calm.wind.t / calm.wind.dur) : 0);
const isNight = (h) => h >= 21.5 || h < 3.5;
// game seconds per real second while winding down: into the night soon enough, then hold it there
function windClock(rate) {
  const w = calm.wind; if (!w) return rate;
  const h = st.hours, R = w.dur - w.t;
  if (R <= 0) return isNight(h) ? (h >= 21.5 || h < 2.5 ? Math.min(rate, 4) : 0) : rate; // settled: a slow night that never ends
  if (isNight(h)) return Math.min(rate, (((3.5 - h + 24) % 24) * 3600 / Math.max(60, R)) * 0.6);
  const toNight = ((21.5 - h + 24) % 24) * 3600; // late evening by three-quarters of the way
  return Math.max(rate, toNight / Math.max(30, R - w.dur * 0.25));
}
// the highest speed allowed while winding down (m/s): a gentle ease down to about two-thirds of cruise
const windSpeed = (cruise) => (calm.wind ? cruise * (1 - 0.35 * ease01(0, 0.8, windP())) : Infinity);
// late at night the radio is a little quieter, whether or not a wind-down is running
function nightLevel() {
  const h = st.hours;
  const late = h >= 12 ? ease01(22.5, 23.5, h) : 1 - ease01(4.5, 5.5, h);
  return 1 - 0.22 * late;
}
function calmTick(dt) {
  const w = calm.wind;
  let music = 1;
  if (w && ui.started) {
    w.t += dt;
    const p = windP();
    music = (1 - 0.45 * ease01(0, 0.7, p)) * (1 - ease01(0.7, 0.97, p)); // softer, then gone by the end
    if (p >= 1 && !calm.radioOff && radio.tempo().playing) { calm.radioOff = true; try { radio.toggle(); } catch (e) { /* ignore */ } } // nothing left to hear: stop streaming
  }
  const dimTo = w ? 1 - 0.3 * ease01(0.5, 1, windP()) : 1;
  calm.dim += (dimTo - calm.dim) * Math.min(1, dt * 0.5);
  radio.setLevel(nightLevel() * music);
  surpriseCtx.calm = !!set.quiet || !!w;
}

// ---------- the demo's director ----------
const titleEl = document.getElementById('demo-title');
function demoCaption(text, ms = 6000) {
  if (!titleEl) return;
  titleEl.querySelector('.t').textContent = text;
  titleEl.classList.add('show');
  clearTimeout(demoCaption.t); demoCaption.t = setTimeout(() => titleEl.classList.remove('show'), ms);
}
// a chapter's hour, weather, ride and camera (set while the car is unseen in the tunnel, or at the start)
function demoApply(i) {
  const ch = CHAPTERS[i];
  demo.i = i;
  st.hours = ch.hours;
  wx.id = ch.weather; sky.wxRate = 1;
  if (set.ride !== ch.ride) { set.ride = ch.ride; setRide(ch.ride); }
  st.target = DEMO_SPEED[ch.ride];
  demo.cineAt = ch.cine ? 16 + Math.random() * 6 : Infinity; // seconds after arrival
  if (set.cam !== ch.cam) { set.cam = ch.cam; ui.set('cam', ch.cam); }
}
function demoLines(i) { const ch = CHAPTERS[i]; return [`And here we are. ${ch.title}.`, ch.fact]; }
function demoEnterTunnel(i) {
  radio.fadeTo(0, 2500); // the song bows out in the dark
  demoApply(i);
  radio.warmLines?.(demoLines(i)); // have the voice ready for the arrival
}
// out in the light: the announcer names the place, tells its fact and brings in the song
function demoArrive(first) {
  const ch = CHAPTERS[demo.i];
  if (first) demoApply(demo.i);
  st.target = DEMO_SPEED[set.ride];
  radio.demo(DEMO_TRACKS[ch.song], demoLines(demo.i));
  demoCaption(ch.title);
}
// attract loop: begins on its own once the landscape has loaded
if (demoOn) {
  const auto = setInterval(() => {
    if (ui.started) { clearInterval(auto); return; }
    if (terrain.settled(pose.x, pose.z) && terrain.busy < 3) { clearInterval(auto); document.getElementById('begin')?.click(); setTimeout(() => document.getElementById('demo-card')?.classList.add('gone'), 600); }
  }, 300);
  st.s = clamp(CHAPTERS[demo.i].from, 0, route.length - 50); snapPose();
  setTimeout(() => { // browsers may block sound until someone presses something: then the first key only turns it on
    const blocked = ambience.context?.state !== 'running' || radio.tempo().playing === false && radio._state === 'paused';
    if (blocked && demoOn) { demo.soundLocked = true; demoCaption('Press any key for sound', 12000); }
  }, 14000);
}
// a key or tap only ever turns the sound on (if the browser held it back): the demo never stops
function demoUnlockSound() {
  if (!demoOn || !ui.started || !demo.soundLocked) return;
  demo.soundLocked = false;
  ambience.resume();
  if (radio._state === 'paused' || radio._state === 'error') radio.toggle();
  titleEl?.classList.remove('show');
}
for (const ev of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(ev, demoUnlockSound, { capture: true, passive: true });
let last = performance.now(), hudClock = 0;
const prof = (window.__prof = { sim: 0, sky: 0, terrain: 0, elements: 0, life: 0, render: 0, frames: 0, max: 0 });
let pt = 0;
const lap = (k) => { const n = performance.now(); prof[k] += n - pt; pt = n; };
function frame(now) {
  requestAnimationFrame(frame);
  // learn the display's refresh interval from the gaps between callbacks
  const gap = now - pace.lastRaf; pace.lastRaf = now;
  if (gap > 3 && gap < 45) {
    const g = pace.gaps; g.push(gap); if (g.length > 90) g.shift();
    if (pace.tick % 30 === 0 && g.length > 20) { const o = g.slice().sort((x, y) => x - y); pace.vs = o[(o.length * 0.3) | 0]; }
  }
  // never faster than ~60 a second (120 Hz screens draw every other refresh), and half that when the
  // governor says so
  const stride = Math.max(1, Math.round(16.2 / pace.vs)) * pace.div;
  if (!noCap && ++pace.tick % stride !== 0) return;
  const real = now - last, ideal = stride * pace.vs;
  last = now;
  // on-time frames all advance by exactly the same step; only a real stall uses measured time
  const dt = Math.min(0.066, (noCap || real > ideal * 1.45 || real < ideal * 0.55 ? real : ideal) / 1000);
  if (!noCap) governor(real, ideal, dt);
  pt = performance.now(); const f0 = pt;
  pollPad();
  simulate(dt);
  rig.update(dt, pose, env);
  rig.applyCamera(camera, dt);
  if (ui.started && !orbit) surprises.camera(camera, dt, surpriseCtx);
  // from the seat the wheels and the car's low front can't be seen: they move to a layer only the sun's shadow
  // camera draws, so they still cast their shadows but cost nothing in the picture
  if (rig.merged && set.ride === 'car') {
    const out = camera.position.distanceToSquared(rig.car.group.getWorldPosition(_tmpV)) > 9;
    if (out !== rig.outView) { rig.outView = out; for (const o of [...rig.car.wheels, ...(rig.outsideOnly || [])]) o.traverse((m) => { if (m.isMesh) m.layers.set(out ? RIDE_LAYER : SHADOW_ONLY); }); }
  }
  if (!ui.started) {
    // title screen: a slow look around from above the road
    const a = now * 0.00003 + 0.4;
    camera.position.set(pose.x + Math.cos(a) * 26, pose.y + 9, pose.z + Math.sin(a) * 26);
    camera.lookAt(pose.x - Math.cos(a) * 300, pose.y + 10, pose.z - Math.sin(a) * 300);
  }
  if (look && ui.started) {
    const gy = (x, z) => { const h = terrain.heightAt?.(x, z); return Number.isFinite(h) ? h : pose.y; };
    const x0 = geo.x(look[1]), z0 = geo.z(look[0]), x1 = geo.x(look[4]), z1 = geo.z(look[3]);
    camera.position.set(x0, gy(x0, z0) + look[2], z0);
    camera.lookAt(x1, gy(x1, z1) + look[5], z1);
  } else if (orbit && ui.started) {
    // inspection camera (?orbit=angleDeg,distance,height): looks at the ride from the side
    const a = st.yaw + (orbit[0] * Math.PI) / 180;
    camera.position.set(pose.x + Math.sin(a) * orbit[1], pose.y + orbit[2], pose.z + Math.cos(a) * orbit[1]);
    camera.lookAt(pose.x, pose.y + (orbit[3] ?? 1.1), pose.z);
  }
  camVel.copy(camera.position).sub(lastCam).divideScalar(Math.max(dt, 1e-3));
  if (camVel.length() > 80) camVel.set(0, 0, 0);
  lastCam.copy(camera.position);

  lap('sim');
  driftWeather(dt);
  sky.update(dt, camera, st.hours, wx.id, camVel);
  lap('sky');
  if (sky.envTexture !== envTex) { rig.setEnvMap((envTex = sky.envTexture)); buildings.setEnvMap(envTex); street.setEnvMap?.(envTex); traffic?.setEnvMap(envTex); }
  if ((sweepT += 1) % 15 === 0) drawOrder(world.group); // (solid first, then cut-outs)
  // --- classic tricks to stay light and smooth ---
  // fog culling: whatever the weather hides is not drawn at all (mist cuts the world to ~1.5 km)
  const vis = 2.3 / Math.max(sky.fog.density, 1e-7);
  terrain.visDist = vis > 40000 ? Infinity : vis;
  elements.visDist = vis;
  // speed LOD: the faster you go the less full-detail scenery is needed (motion hides it)
  const fastK = clamp((st.speed - 14) / 22, 0, 1);
  sky.shared.uLodDist.value = quality().lod * (1 - 0.3 * fastK);
  // look-ahead streaming: load the landscape for where you are about to be, so it is ready on arrival
  const lead = Math.min(st.speed * 1.6, 60), hx = -Math.sin(st.yaw), hz = -Math.cos(st.yaw);
  terrain.uploadsPerFrame = ui.started ? 2 : 8;
  // in the tunnel the current place is out of sight: no need to keep it streaming
  if (!trip.camIn) streamWorld(world, dt, camera.position.x, camera.position.z, hx, hz, lead, st.s);
  lap('terrain');
  tellFacts(dt);
  if (hide.length || window.__hideOn) { window.__hideOn = true; applyHide(); }
  tripTick(dt);
  tunnelView(dt);
  updateSurprises(dt);
  if (lifeOn && !trip.camIn) {
    Object.assign(lifeCtx, { pose, s: st.s, dir: st.dir, lat: st.lat, night: sky.night, hours: st.hours, weather: sky.w, speed: st.speed, started: ui.started });
    life.update(dt, lifeCtx);
    traffic.update(dt, lifeCtx);
  }
  lap('life');
  lap('elements');
  if (rig.stepEvents) { for (const k of rig.stepEvents) ambience.step(k); rig.stepEvents.length = 0; }
  ambience.update(dt, {
    mode: set.ride, speed: st.speed, rain: trip.camIn ? 0 : sky.w.rain, snow: trip.camIn ? 0 : sky.w.snow, night: sky.night, paused: !ui.started,
    // the place and the hour pick the soundscape: birds at dawn, crickets at night, the city's low hum
    hours: st.hours, kind: data.kind, paved: data.scenery?.ground === 'paved', wind: clamp((sky.w.turb ?? 3) / 8, 0, 1), fog: wx.id === 'mist' ? 1 : 0, inTunnel: !!trip.camIn,
  });

  hudClock += dt;
  if (hudClock > 0.1) {
    hudClock = 0;
    ui.setHud({ kmh: st.speed * 3.6, place: route.nearestStop(st.s).name, km: st.s / 1000, totalKm: route.length / 1000, hours: st.hours });
    if (!ui.started) ui.setLoading(terrain.settled(pose.x, pose.z) && terrain.busy < 4 ? 1 : Math.min(0.96, terrain.readyCount / 130), 'Preparing the landscape…');
  }
  // (the clock is shown in the HUD; the start screen's time stays what the user chose)
  // the ride gets its own sharp pass when the camera is with it (seat or chase); from farther away
  // (title screen, cinematic shots) it is drawn with the landscape so trees can hide it
  const rideNear = (rig.mode === 'car' || rig.horse.root.visible) && Math.hypot(camera.position.x - pose.x, camera.position.y - pose.y, camera.position.z - pose.z) < 12;
  calmTick(dt);
  if (usePost) post.render(dt, { speed: st.speed, night: sky.night, wet: sky.w.wet, ride: rideNear });
  else renderer.render(scene, camera);
  lap('render'); prof.frames++; prof.max = Math.max(prof.max, performance.now() - f0);
  window.__status = { settled: terrain.settled(camera.position.x, camera.position.z), busy: terrain.busy, ready: terrain.readyCount, tris: usePost ? post.info.tris : renderer.info.render.triangles, calls: usePost ? post.info.calls : renderer.info.render.calls, gpu: post.info.gpu, dt, ms: +(stride * pace.vs).toFixed(1), scale: pace.scale, div: pace.div, near: elements.near.size, elements: elements.count };
}
snapPose();
// Compile every shader now, behind the title screen, so nothing stalls the first time it rains, snows
// or a new kind of object comes into view.
function warmShaders() {
  road.update(st.s);
  const was = [sky.rain.visible, sky.snow.visible, sky.stars.visible, sky.moon.visible];
  sky.rain.visible = sky.snow.visible = sky.stars.visible = sky.moon.visible = true;
  // the tunnel too: both kinds of portal, and the inside with its bright exit
  const warmPortals = endless ? [tunnel.makePortal({ style: 'rock', halfWidth: 6 }), tunnel.makePortal({ style: 'city', halfWidth: 11 })] : [];
  for (const g of warmPortals) scene.add(g);
  tunnel.interior.visible = true; tunnel.setExit(200);
  renderer.compile(scene, camera);
  for (const g of warmPortals) { scene.remove(g); tunnel.dispose(g); }
  tunnel.interior.visible = false; tunnel.setExit(null);
  [sky.rain.visible, sky.snow.visible, sky.stars.visible, sky.moon.visible] = was;
  // both rides, drawn once off-screen: shaders, buffers and textures of the one not in use are ready
  // too, so switching to the horse (key 2, or the demo) never stalls
  const rides = [rig.car.group, rig.horse.root], vis = rides.map((g) => g.visible), meshes = [];
  rides.forEach((g) => { g.visible = true; g.traverse((o) => { if (o.isMesh) { meshes.push([o, o.frustumCulled]); o.frustumCulled = false; o.layers.enable(WARM); } }); });
  scene.traverse((o) => { if (o.isLight) o.layers.enable(WARM); });
  renderer.compile(scene, camera);
  const prevRT = renderer.getRenderTarget(); renderer.setRenderTarget(warmRT); renderer.render(scene, warmCam); renderer.setRenderTarget(prevRT);
  meshes.forEach(([o, fc]) => { o.frustumCulled = fc; o.layers.disable(WARM); });
  rides.forEach((g, i) => { g.visible = vis[i]; });
}
try { compileForPost(warmShaders); } catch (e) { console.warn('shader warm-up skipped', e); }
requestAnimationFrame(frame);

if (params.has('auto')) setTimeout(() => document.getElementById('begin')?.click(), 300);
window.__ld = { THREE, get geo() { return geo; }, ambience, get life() { return life; }, get traffic() { return traffic; }, st, set, get terrain() { return terrain; }, sky, get route() { return route; }, rig, camera, renderer, scene, ui, radio, hide, get elements() { return elements; }, prof, post, assets, wx, get facts() { return facts; }, bus, trip, get world() { return world; }, surprises, demoApply, demoEnterTunnel };
