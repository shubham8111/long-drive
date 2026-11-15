// Records real gameplay into 720p videos, frame by frame (so every frame is perfectly even no matter
// how fast this machine renders), with the game's own synthesized sound replayed offline, the radio
// announcer's neural voice, and free-licensed music.
//
//   node dev/film.mjs                 record every clip in CLIPS below
//   node dev/film.mjs paris-dusk      record one clip (by name)
//   SECONDS=20 node dev/film.mjs ...  short test (clip cut to 20 s, song tail 6 s)
//
// Needs the dev server (npm run dev) with the announcer voice installed (npm run voice).
// Output: videos/<name>.mp4 plus videos/CREDITS.txt.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { splitSentences } from '../src/radio.js';

const BASE = 'http://localhost:5173';
const FPS = 30, W = 1280, H = 720, SS = 1.5; // rendered at 1.5x and scaled down: cleaner edges
const SR = 48000;
const MUSIC = 'data/film-music';
const OUT = 'videos';
const TMP = path.join(OUT, '.work');

// Free-licensed music: Kevin MacLeod (incompetech.com), Creative Commons Attribution 4.0.
const T = (title) => ({ title, artist: 'Kevin MacLeod', file: path.join(MUSIC, `${title}.mp3`) });

// place, time of day, weather, ride, camera and station vary clip to clip
const CLIPS = [
  { name: 'bryce-golden-hour', place: 'bryce', stop: 0, ride: 'car', cam: 'seat', cam2: 'chase', hours: 18.3, weather: 'clear', station: 'golden-hour', a: T('Carefree'), b: T('Wallpaper'), len: 160 },
  { name: 'bryce-horse-misty-morning', place: 'bryce', stop: 4, ride: 'horse', cam: 'chase', cam2: 'seat', hours: 6.7, weather: 'mist', station: 'still-water', a: T('At Rest'), b: T('Gymnopedie No 1'), len: 150 },
  { name: 'manhattan-rainy-night', place: 'manhattan', stop: 2, ride: 'car', cam: 'chase', cam2: 'seat', hours: 21.8, weather: 'rain', station: 'open-road', a: T('Night in Venice'), b: T('Smooth Lovin'), len: 150 },
  { name: 'paris-afternoon-clouds', place: 'paris', stop: 0, ride: 'car', cam: 'seat', cam2: 'chase', hours: 16.6, weather: 'clouds', station: 'golden-hour', a: T('Bossa Antigua'), b: T('Lobby Time'), len: 165 },
  { name: 'london-overcast-midday', place: 'london', stop: 1, ride: 'car', cam: 'chase', cam2: 'seat', hours: 12.4, weather: 'overcast', station: 'open-road', a: T('Inspired'), b: T('Easy Lemon'), len: 140 },
  { name: 'la-sunset-boulevard', place: 'la', stop: 1, ride: 'car', cam: 'seat', cam2: 'chase', hours: 18.9, weather: 'clear', station: 'golden-hour', a: T('Backed Vibes Clean'), b: T('Dreamer'), len: 170 },
  { name: 'monaco-night-lap', place: 'monaco', stop: 0, ride: 'car', cam: 'chase', cam2: 'seat', hours: 21.3, weather: 'clear', station: 'open-road', a: T('Dreamer'), b: T('Night in Venice'), len: 145 },
  { name: 'spa-snowy-morning', place: 'spa', stop: 0, ride: 'car', cam: 'chase', cam2: 'chase', hours: 8.2, weather: 'snow', station: 'still-water', a: T('Healing'), b: T('Inspired'), len: 155 },
  { name: 'silverstone-horse-in-the-rain', place: 'silverstone', stop: 0, ride: 'horse', cam: 'chase', cam2: 'seat', hours: 14.2, weather: 'rain', station: 'still-water', a: T('Easy Lemon'), b: T('Local Forecast - Elevator'), len: 150 },
  { name: 'bryce-starry-night', place: 'bryce', stop: 2, ride: 'car', cam: 'seat', cam2: 'chase', hours: 22.6, weather: 'clear', station: 'still-water', a: T('Gymnopedie No 1'), b: T('Healing'), len: 150 },
];
// README trailer: ~13 s each, joined by dev/trailer.mjs (s = metres along the route; the car covers
// ~180 m in the warm-up before filming starts)
const DR = T('Dreamer');
const TRAILER_CLIPS = [
  { name: 't01-bryce-red-canyon', place: 'bryce', s: 9585, dir: 1, ride: 'car', cam: 'seat', hours: 17.9, weather: 'clear' },
  { name: 't02-bryce-arch-tunnel', place: 'bryce', s: 9820, ride: 'car', cam: 'chase', hours: 18.1, weather: 'clear' },
  { name: 't03-bryce-hoodoo-rim', place: 'bryce', s: 45700, look: '37.54455,-112.24686,6,37.5400,-112.2300,-150', ride: 'car', cam: 'chase', hours: 9.5, weather: 'clear' },
  { name: 't04-bryce-horse-meadow', place: 'bryce', s: 25700, ride: 'horse', cam: 'chase', hours: 7.0, weather: 'mist' },
  { name: 't05-manhattan-night-rain', place: 'manhattan', s: 550, ride: 'car', cam: 'seat', hours: 21.6, weather: 'rain' },
  { name: 't06-la-sunset', place: 'la', stop: 1, ride: 'car', cam: 'seat', hours: 18.9, weather: 'clear' },
  { name: 't07-london-overcast', place: 'london', stop: 1, ride: 'car', cam: 'chase', hours: 12.4, weather: 'overcast' },
  { name: 't08-monaco-night', place: 'monaco', stop: 0, ride: 'car', cam: 'chase', hours: 21.3, weather: 'clear' },
  { name: 't09-spa-snow', place: 'spa', stop: 0, ride: 'car', cam: 'chase', hours: 8.2, weather: 'snow' },
  { name: 't10-bryce-starry-night', place: 'bryce', s: 38000, ride: 'car', cam: 'seat', hours: 22.6, weather: 'clear' },
].map((c) => ({ station: 'golden-hour', a: DR, b: DR, cam2: c.cam, len: 13, ...c }));
const STATION_NAME = { 'open-road': 'Open Road', 'golden-hour': 'Golden Hour', 'still-water': 'Still Water' };

const SHORT = process.env.SECONDS ? +process.env.SECONDS : 0;
// TRAILER=1: the short README trailer clips (TRAILER_CLIPS): game sound only (the music is laid over the
// whole edit afterwards by dev/trailer.mjs), no fades (the edit crossfades), output videos/trailer/<name>.mp4
const TRAILER = process.env.TRAILER === '1';
const only = process.argv[2];
fs.mkdirSync(TMP, { recursive: true });
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);

// ---------- audio helpers ----------
function decode(file, start = 0, dur = null, mono = false) {
  const args = ['-v', 'error', '-ss', String(Math.max(0, start)), ...(dur ? ['-t', String(dur)] : []), '-i', file, '-f', 'f32le', '-ac', mono ? '1' : '2', '-ar', String(SR), '-'];
  const buf = execFileSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
const duration = (file) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();

// rough tempo from the music itself (onset envelope autocorrelation), for the dashboard lights
function tempo(file) {
  const x = decode(file, 30, 40, true), hop = SR / 100, n = Math.floor(x.length / hop);
  const env = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let k = 0; k < hop; k++) { const v = x[i * hop + k]; e += v * v; }
    e = Math.sqrt(e / hop);
    env[i] = Math.max(0, e - prev); prev = e;
  }
  let best = 96, bv = -1;
  for (let bpm = 64; bpm <= 140; bpm++) {
    const lag = Math.round(6000 / bpm);
    let s = 0;
    for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
    s *= 1 + 0.15 * Math.exp(-(((bpm - 100) / 30) ** 2)); // gentle preference for walking-pace tempos
    if (s > bv) { bv = s; best = bpm; }
  }
  return best;
}

function rms(a, from = 0, to = a.length) {
  let s = 0, n = 0;
  for (let i = from; i < to; i++) { s += a[i] * a[i]; n++; }
  return Math.sqrt(s / Math.max(1, n));
}

function writeWav(file, f32, ch = 2) {
  const n = f32.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22); b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(f32[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, b);
}

async function ttsFile(sentence) {
  const r = await fetch(`${BASE}/tts?text=${encodeURIComponent(sentence)}`);
  if (!r.ok) throw new Error(`tts ${r.status} for "${sentence}" (is the voice installed? npm run voice)`);
  const f = path.join(TMP, `tts_${Buffer.from(sentence).toString('base64url').slice(0, 60)}_${sentence.length}.wav`);
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  return { file: f, dur: duration(f) };
}

// ---------- in-page virtual clock (installed before the game loads) ----------
const CLOCK = () => {
  let vt = performance.now();
  const realNow = performance.now.bind(performance);
  const q = [];
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__step = (ms) => { vt += ms; const cbs = q.splice(0); for (const cb of cbs) { try { cb(vt); } catch (e) { console.error(e); } } };
  window.__realNow = realNow;
};

async function record(clip) {
  const len = SHORT || clip.len;
  const tail = SHORT ? 6 : 13 + Math.round(Math.random() * 5); // 13–18 s of the previous song's ending
  const aDur = duration(clip.a.file), bDur = duration(clip.b.file);
  const bpmA = tempo(clip.a.file), bpmB = tempo(clip.b.file);
  log(`${clip.name}: ${len}s, ${clip.a.title} (${bpmA} bpm) -> announcer -> ${clip.b.title} (${bpmB} bpm)`);

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', `--window-size=${W},${H}`, '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: SS });
    page.on('pageerror', (e) => log('  page error:', String(e).slice(0, 200)));
    await page.evaluateOnNewDocument(CLOCK);
    // block Vite's live-reload client: an edit to the game while recording must not reload this page
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().includes('/@vite/client') ? r.respond({ status: 200, contentType: 'application/javascript', body: 'export function createHotContext(){return {accept(){},dispose(){},prune(){},invalidate(){},on(){},send(){}}}; export function updateStyle(){}; export function removeStyle(){}; export function injectQuery(u){return u}' }) : r.continue()));
    const q = new URLSearchParams({ place: clip.place, ...(clip.s != null ? { s: clip.s } : { stop: clip.stop }), ...(clip.dir ? { dir: clip.dir } : {}), ...(clip.look ? { look: clip.look } : {}), ride: clip.ride, cam: clip.cam, hours: clip.hours, weather: clip.weather, station: clip.station, graphics: 'high', nocap: '1', film: '1', tune: 'grain:0,dither:0' }); // per-frame noise is what makes video files huge
    await page.goto(`${BASE}/?${q}`, { waitUntil: 'domcontentloaded' });

    // 1. let the world stream in (virtual time follows real time here)
    const stepReal = async (ms) => { await page.evaluate((m) => window.__step(m), ms); await new Promise((r) => setTimeout(r, ms)); };
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      await stepReal(33);
      const s = await page.evaluate(() => window.__status || null).catch(() => null);
      if (s && s.settled && s.busy === 0 && Date.now() - t0 > 4000) break;
    }
    // 2. start the drive and get up to cruising speed before the camera rolls
    await page.evaluate((cl) => {
      const L = window.__ld;
      L.set.timeFlows = true; L.set.ambience = 0.6;
      const at = document.getElementById('attribution');
      if (at) at.textContent = at.textContent.replace('Music via YouTube', 'Music: Kevin MacLeod (incompetech.com), CC BY 4.0');
      window.__tempo = { playing: true, speaking: false, bpm: 96 };
      L.radio.tempo = () => window.__tempo;
      document.getElementById('begin').click();
      // log everything the game asks of its sound engine, to replay it offline afterwards
      const A = L.ambience;
      window.__alog = [];
      for (const m of ['update', 'step', 'radioStatic', 'duck', 'setVolume']) {
        const f = A[m].bind(A);
        A[m] = (...args) => { if (window.__rec0 != null) window.__alog.push([performance.now() - window.__rec0, m, JSON.parse(JSON.stringify(args))]); return f(...args); };
      }
      void cl;
    }, clip);
    for (let i = 0; i < 300; i++) { await page.evaluate(() => window.__step(1000 / 30)); if (i % 10 === 0) await new Promise((r) => setTimeout(r, 15)); }
    for (let i = 0; i < 60; i++) await stepReal(33); // and let anything new stream in

    // 3. the radio timeline
    const tl = [];
    const at = (t, fn, arg) => tl.push({ t, fn, arg });
    at(0, 'song', { title: clip.a.title, artist: clip.a.artist, bpm: bpmA, station: clip.station });
    if (!TRAILER) at(tail, 'break', null);
    // the announcer's lines come from the game's own script, with the real place, hour and weather
    const lines = TRAILER ? [] : await page.evaluate((b) => window.__ld.radio._script({ id: 'film', title: b.title, artist: b.artist }), clip.b);
    let t = tail + 0.75;
    const voice = [];
    for (const line of lines) {
      at(t, 'line', line);
      for (const s of splitSentences(line)) {
        const v = await ttsFile(s);
        voice.push({ t, ...v });
        t += v.dur + 0.26;
      }
      t += 0.35;
    }
    const bStart = t + 0.4;
    if (!TRAILER) at(bStart, 'song', { title: clip.b.title, artist: clip.b.artist, bpm: bpmB, station: clip.station, cam: clip.cam2 });
    if (bStart > len - 25) log(`  note: announcer runs long (${bStart.toFixed(1)} s)`);
    tl.sort((x, y) => x.t - y.t);

    // 4. capture, one exact frame at a time
    const frames = Math.round(len * FPS);
    const vidFile = path.join(TMP, `${clip.name}.video.mp4`);
    const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-vf', TRAILER ? `scale=${W}:${H}:flags=lanczos` : `scale=${W}:${H}:flags=lanczos,fade=t=in:st=0:d=1.2,fade=t=out:st=${(len - 2).toFixed(2)}:d=2`,
      '-c:v', 'libx265', '-preset', 'medium', '-crf', '27', '-tag:v', 'hvc1', '-x265-params', 'log-level=error', '-pix_fmt', 'yuv420p', '-r', String(FPS), vidFile], { stdio: ['pipe', 'inherit', 'inherit'] });
    const cdp = await page.createCDPSession();
    await page.evaluate(() => { window.__rec0 = performance.now(); const L = window.__ld; L.ambience.setVolume(L.set.ambience); });
    let k = 0;
    const started = Date.now();
    for (let f = 0; f < frames; f++) {
      const now = f / FPS;
      const due = [];
      while (k < tl.length && tl[k].t <= now) due.push(tl[k++]);
      await page.evaluate((due, sn) => {
        const L = window.__ld;
        for (const e of due) {
          if (e.fn === 'song') {
            L.ambience.duck(0);
            window.__tempo = { playing: true, speaking: false, bpm: e.arg.bpm };
            L.ui.setRadio({ stationId: e.arg.station, stationName: sn[e.arg.station], title: e.arg.title, artist: e.arg.artist, state: 'playing' });
            if (e.arg.cam && e.arg.cam !== L.set.cam) { L.ui.set('cam', e.arg.cam); L.set.cam = e.arg.cam; }
          } else if (e.fn === 'break') {
            window.__tempo = { playing: false, speaking: true, bpm: 96 };
            L.ui.setRadio({ state: 'announcer', line: 'On air' });
            L.ambience.radioStatic(2.4);
            L.ambience.duck(0.85);
          } else if (e.fn === 'line') {
            L.ui.setRadio({ state: 'announcer', line: e.arg });
          }
        }
        window.__step(1000 / 30);
      }, due, STATION_NAME);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
      if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % (FPS * 15) === 0 && f) {
        const el = (Date.now() - started) / 1000;
        log(`  ${Math.round(now)}s / ${len}s  (${(el / f * 1000).toFixed(0)} ms per frame, ~${Math.round(el / f * (frames - f) / 60)} min left)`);
      }
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));

    // 5. the game's own sound, replayed through an offline audio context with the exact timings
    log('  rendering game sound offline');
    const n = await page.evaluate(async (dur, sr) => {
      const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
      let now = 0;
      Object.defineProperty(ctx, 'currentTime', { get: () => now });
      Object.defineProperty(ctx, 'state', { get: () => 'running' });
      const A = new window.__ld.ambience.constructor();
      A._ctx = ctx; A._build();
      for (const [t, m, args] of window.__alog) { now = t / 1000; if (now > dur) break; A[m](...args); }
      now = 0;
      const buf = await ctx.startRendering();
      const L = buf.getChannelData(0), R = buf.getChannelData(1), out = new Float32Array(L.length * 2);
      for (let i = 0; i < L.length; i++) { out[i * 2] = L[i]; out[i * 2 + 1] = R[i]; }
      window.__amb = out;
      return out.length;
    }, len, SR);
    const amb = new Float32Array(n);
    for (let i = 0; i < n; i += 1 << 20) {
      const part = await page.evaluate((i, m) => Array.from(window.__amb.subarray(i, i + m)), i, 1 << 20);
      amb.set(part, i);
    }

    // 6. mix: song tail, announcer, next song, game sound
    log('  mixing');
    const total = Math.round(len * SR) * 2, mix = new Float32Array(total);
    const add = (src, atSec, gain) => { const o = Math.round(atSec * SR) * 2; for (let i = 0; i < src.length && o + i < total; i++) if (o + i >= 0) mix[o + i] += src[i] * gain; };
    const songA = decode(clip.a.file, aDur - tail, tail + 1);
    const songB = len - bStart > 0.2 ? decode(clip.b.file, 0, Math.min(bDur, len - bStart + 1)) : new Float32Array(2);
    const ga = 0.13 / Math.max(1e-4, rms(songA)), gb = songB.length > 2 ? 0.13 / Math.max(1e-4, rms(songB, 0, Math.min(songB.length, SR * 60))) : 0;
    if (!TRAILER) { add(songA, 0, Math.min(ga, 1.6)); add(songB, bStart, Math.min(gb, 1.6)); }
    for (const v of voice) { const d = decode(v.file); add(d, v.t, 1.35); }
    add(amb, 0, Math.min(14, 0.032 / Math.max(1e-5, rms(amb)))); // game sound sits under the music, as in play
    // gentle limiter + fades
    let peak = 0; for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(mix[i]));
    const lim = peak > 0.95 ? 0.95 / peak : 1;
    const fi = (TRAILER ? 0.05 : 1.2) * SR, fo = (TRAILER ? 0.05 : 2) * SR;
    for (let i = 0; i < total; i += 2) {
      const s = i / 2, g = lim * Math.min(1, s / fi) * Math.min(1, (len * SR - s) / fo);
      mix[i] *= g; mix[i + 1] *= g;
    }
    const wav = path.join(TMP, `${clip.name}.wav`);
    writeWav(wav, mix);
    const outFile = path.join(TRAILER ? path.join(OUT, 'trailer') : OUT, `${clip.name}.mp4`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', vidFile, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outFile]);
    log(`  done: ${outFile} (${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB, ${((Date.now() - started) / 60000).toFixed(1)} min)`);
    fs.rmSync(vidFile); fs.rmSync(wav);
    return { clip, lines };
  } finally {
    await browser.close().catch(() => {});
  }
}

const SRC = TRAILER ? TRAILER_CLIPS : CLIPS;
const list = only ? SRC.filter((c) => c.name === only || c.place === only) : SRC;
if (!list.length) { console.log('clips:', SRC.map((c) => c.name).join(', ')); process.exit(1); }
const credits = [];
for (const c of list) {
  try {
    const r = await record(c);
    credits.push(`${c.name}.mp4\n  ${c.a.title}, ${c.b.title} — Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0 (creativecommons.org/licenses/by/4.0/)\n  Announcer: ${r.lines.join(' | ')}\n`);
  } catch (e) {
    log(`FAILED ${c.name}:`, e.message);
  }
}
if (credits.length) {
  const head = 'Long Drive — gameplay clips\nMap data: imagery Esri, Maxar, Earthstar Geographics; terrain Mapzen/AWS Terrain Tiles; roads, buildings and street furniture © OpenStreetMap contributors.\nAnnouncer voice: Kokoro-82M (Apache-2.0), voice af_heart.\n\n';
  const f = path.join(OUT, 'CREDITS.txt');
  const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(head, '') : '';
  fs.writeFileSync(f, head + old + credits.join('\n'));
}
