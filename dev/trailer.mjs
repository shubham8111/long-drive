// Joins the trailer clips (TRAILER=1 node dev/film.mjs) into the 2-minute README trailer:
// crossfades, a title card, a small place caption on each clip, one music track over the game's own sound.
//   node dev/trailer.mjs     -> docs/media/trailer.mp4, docs/media/trailer.gif and docs/media/shot-*.jpg
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const DIR = 'videos/trailer', OUT = 'docs/media', TMP = path.join(DIR, '.work');
const MUSIC = 'data/film-music/Dreamer.mp3'; // Kevin MacLeod, CC BY 4.0
const XF = 1.2; // crossfade seconds
const CLIPS = [
  ['t01-bryce-red-canyon', 'Red Canyon', 'Utah'],
  ['t02-bryce-arch-tunnel', 'The 1925 rock-arch tunnels', 'Utah'],
  ['t03-bryce-hoodoo-rim', 'Bryce Canyon', 'Utah'],
  ['t04-bryce-horse-meadow', 'Bryce Canyon City, at dawn', 'Utah'],
  ['t05-manhattan-night-rain', 'Times Square', 'New York'],
  ['t06-la-sunset', 'Sunset Boulevard', 'Los Angeles'],
  ['t07-london-overcast', 'Tower Bridge to Hyde Park', 'London'],
  ['t08-monaco-night', 'Circuit de Monaco', 'Monte Carlo'],
  ['t09-spa-snow', 'Spa-Francorchamps', 'Belgium'],
  ['t10-bryce-starry-night', 'A dark-sky night', 'Utah'],
];
const STILLS = [ // [clip, second, name]
  ['t01-bryce-red-canyon', 6.5, 'shot-red-canyon'], ['t02-bryce-arch-tunnel', 3.5, 'shot-arch'], ['t03-bryce-hoodoo-rim', 8, 'shot-hoodoos'],
  ['t05-manhattan-night-rain', 6, 'shot-manhattan-night'], ['t06-la-sunset', 5, 'shot-la-sunset'], ['t08-monaco-night', 6, 'shot-monaco-night'],
  ['t09-spa-snow', 6, 'shot-spa-snow'], ['t04-bryce-horse-meadow', 6, 'shot-horse'],
];
fs.mkdirSync(TMP, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString();

// 1. captions and title cards, drawn by Chrome as transparent PNGs (this ffmpeg has no drawtext)
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const css = `body{margin:0;width:1280px;height:720px;background:transparent;font-family:Georgia,'Times New Roman',serif;color:#f6efe2}
.cap{position:absolute;left:64px;top:56px;text-shadow:0 1px 3px rgba(0,0,0,.55),0 2px 18px rgba(0,0,0,.75)} .cap b{display:block;font-size:40px;font-weight:400;letter-spacing:.5px}
.cap i{display:block;margin-top:6px;font:500 15px -apple-system,Helvetica,sans-serif;letter-spacing:4px;text-transform:uppercase;color:#e9b872}
.title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-shadow:0 2px 24px rgba(0,0,0,.7)}
.title b{font-size:92px;font-weight:400} .title i{font-size:26px;margin-top:14px;font-style:italic;opacity:.92}
.title small{font:500 15px -apple-system,Helvetica,sans-serif;letter-spacing:4px;text-transform:uppercase;color:#e9b872;margin-top:26px}`;
async function png(file, html) {
  await page.setContent(`<style>${css}</style>${html}`);
  await page.screenshot({ path: file, omitBackground: true });
}
const caps = [];
for (const [name, t, sub] of CLIPS) { const f = path.join(TMP, `cap-${name}.png`); await png(f, `<div class="cap"><b>${t}</b><i>${sub}</i></div>`); caps.push(f); }
const title = path.join(TMP, 'title.png'), end = path.join(TMP, 'end.png');
await png(title, '<div class="title"><b>Long Drive</b><i>A calm, endless drive through real places</i><small>Built from open map data · runs in your browser</small></div>');
await png(end, '<div class="title"><b>Long Drive</b><i>No score. No destination. Just the road.</i><small>shubham8111.github.io/long-drive</small></div>');
await browser.close();

// 2. video: crossfaded clips with captions; audio: the clips' game sound crossfaded, music over it
const files = CLIPS.map(([n]) => path.join(DIR, `${n}.mp4`));
const lens = files.map(dur);
const inputs = [], fc = [];
files.forEach((f) => inputs.push('-i', f));
caps.forEach((f) => inputs.push('-loop', '1', '-i', f));
inputs.push('-loop', '1', '-i', title, '-loop', '1', '-i', end, '-i', MUSIC);
const N = files.length, iTitle = 2 * N, iEnd = 2 * N + 1, iMusic = 2 * N + 2;
let starts = [0];
for (let k = 1; k < N; k++) starts.push(starts[k - 1] + lens[k - 1] - XF);
const total = starts[N - 1] + lens[N - 1];
for (let k = 0; k < N; k++) {
  const capIn = k === 0 ? 4.2 : 1.0, capOut = k === N - 1 ? 5.0 : lens[k] - 2.2; // last clip: out before the end card // first clip: the title comes first
  fc.push(`[${k}:v]settb=AVTB,fps=30,format=yuv420p[v${k}]`);
  fc.push(`[${N + k}:v]format=rgba,trim=duration=${lens[k]},fade=t=in:st=${capIn}:d=0.8:alpha=1,fade=t=out:st=${capOut}:d=0.8:alpha=1[c${k}]`);
  fc.push(`[v${k}][c${k}]overlay=0:0:shortest=1[w${k}]`);
}
let last = 'w0';
for (let k = 1; k < N; k++) { fc.push(`[${last}][w${k}]xfade=transition=fade:duration=${XF}:offset=${(starts[k]).toFixed(3)}[x${k}]`); last = `x${k}`; }
fc.push(`[${iTitle}:v]format=rgba,trim=duration=4,fade=t=in:st=0.3:d=0.9:alpha=1,fade=t=out:st=3.1:d=0.9:alpha=1,setpts=PTS-STARTPTS[tt]`);
fc.push(`[${iEnd}:v]format=rgba,trim=duration=5,fade=t=in:st=0:d=1:alpha=1,setpts=PTS+${(total - 5.5).toFixed(3)}/TB[te]`);
fc.push(`[${last}][tt]overlay=0:0:eof_action=pass[y1]`, `[y1][te]overlay=0:0:eof_action=pass,fade=t=in:st=0:d=1,fade=t=out:st=${(total - 1.5).toFixed(3)}:d=1.5[vout]`);
let alast = '0:a';
for (let k = 1; k < N; k++) { fc.push(`[${alast}][${k}:a]acrossfade=d=${XF}:c1=tri:c2=tri[a${k}]`); alast = `a${k}`; }
fc.push(`[${alast}]volume=0.55[game]`, `[${iMusic}:a]atrim=0:${total.toFixed(3)},volume=0.9,afade=t=in:st=0:d=2,afade=t=out:st=${(total - 4).toFixed(3)}:d=4[mus]`);
fc.push(`[game][mus]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.9[aout]`);
const mp4 = path.join(OUT, 'trailer.mp4');
ff([...inputs, '-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(3),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', mp4]);
console.log(`trailer: ${mp4}, ${total.toFixed(1)} s, ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB`);

// 3. stills (from the clips, no captions) and a short looping GIF for the top of the README
for (const [clip, t, name] of STILLS) ff(['-ss', String(t), '-i', path.join(DIR, `${clip}.mp4`), '-frames:v', '1', '-q:v', '3', path.join(OUT, `${name}.jpg`)]);
const gifParts = [[0, 6], [1, 2], [2, 5], [4, 6], [5, 5], [7, 6]]; // [clip index, start second]; 2 s each
const gl = gifParts.map(([k, s], i) => `[${i}:v]trim=start=${s}:duration=2,setpts=PTS-STARTPTS,fps=10,scale=640:-2:flags=lanczos[g${i}]`);
const gin = gifParts.flatMap(([k]) => ['-i', files[k]]);
ff([...gin, '-filter_complex', `${gl.join(';')};${gifParts.map((_, i) => `[g${i}]`).join('')}concat=n=${gifParts.length}:v=1:a=0,split[s0][s1];[s0]palettegen=max_colors=160:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, path.join(OUT, 'trailer.gif')]);
console.log(`gif: ${(fs.statSync(path.join(OUT, 'trailer.gif')).size / 1e6).toFixed(1)} MB`);
