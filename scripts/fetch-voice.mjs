// npm run voice: download the Kokoro model once, pre-render every static announcer line, write voice samples.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  MODEL_REPO, MODEL_NAME, MODEL_ROOT, MODEL_FILES, SAMPLES_DIR, VOICE, SPEED, DTYPE,
  modelInstalled, getSpeech, synthesize, encodeWav, ttsStats,
} from './tts.mjs';
import { STATIONS, IDENTS, QUOTES, splitSentences } from '../src/radio.js';

const HF = `https://huggingface.co/${MODEL_REPO}/resolve/main/`;

async function download(rel, required) {
  const dest = path.join(MODEL_ROOT, MODEL_NAME, rel);
  if (fs.existsSync(dest)) return;
  const r = await fetch(HF + rel);
  if (!r.ok) {
    if (!required) return;
    throw new Error(`download ${rel}: HTTP ${r.status}`);
  }
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const total = +r.headers.get('content-length') || 0;
  let got = 0, last = 0;
  const src = Readable.fromWeb(r.body);
  src.on('data', (c) => {
    got += c.length;
    if (total && Date.now() - last > 1000) {
      last = Date.now();
      process.stdout.write(`\r  ${rel}  ${(got / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB   `);
    }
  });
  await pipeline(src, fs.createWriteStream(dest + '.tmp'));
  await fs.promises.rename(dest + '.tmp', dest);
  process.stdout.write(`\r  ${rel}  done (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)          \n`);
}

console.log(`Voice: Kokoro-82M (${DTYPE}), voice ${VOICE}, speed ${SPEED}`);
if (!modelInstalled()) {
  console.log(`Downloading model from huggingface.co/${MODEL_REPO} into data/tts-model ...`);
  for (const [rel, required] of Object.entries(MODEL_FILES)) {
    if (rel.startsWith('onnx/') && !required) continue;
    await download(rel, required);
  }
} else {
  console.log('Model already installed.');
}

// ---- static announcer lines ----
const lines = new Set();
for (const t of IDENTS) lines.add(t);
for (const t of QUOTES) lines.add(t);
for (const st of STATIONS) lines.add(`This is ${st.name}, ${st.tagline}.`);
const sentences = [...new Set([...lines].flatMap(splitSentences))];
console.log(`Pre-rendering ${sentences.length} static sentences into data/tts ...`);
const t0 = Date.now();
let n = 0;
for (const s of sentences) {
  await getSpeech(s);
  n++;
  if (n % 10 === 0 || n === sentences.length) {
    const st = ttsStats();
    console.log(`  ${n}/${sentences.length}  (${Math.round((Date.now() - t0) / 1000)}s, ${st.synthSeconds ? (st.synthSeconds / st.audioSeconds).toFixed(2) : '-'} s compute per s audio)`);
  }
}

// ---- samples of candidate voices ----
const SAMPLE_TEXT =
  "You're tuned in to Long Drive Radio. It's half past four in the afternoon, with clear skies. The road does not hurry, and somehow everyone still arrives.";
const CANDIDATES = ['af_heart', 'af_nicole', 'af_bella', 'bf_emma'];
await fs.promises.mkdir(SAMPLES_DIR, { recursive: true });
console.log('Writing voice samples into data/tts-samples ...');
for (const v of CANDIDATES) {
  const wav = encodeWav(await synthesize(SAMPLE_TEXT, { voice: v }));
  const f = path.join(SAMPLES_DIR, `${v}.wav`);
  await fs.promises.writeFile(f, wav);
  console.log('  ' + path.relative(process.cwd(), f));
}
const st = ttsStats();
console.log(`Done. Model load ${(st.loadMs / 1000).toFixed(1)}s, RSS ${st.rssMB} MB.`);
console.log(`To change the voice, edit VOICE / SPEED at the top of scripts/tts.mjs and run npm run voice again.`);
process.exit(0);
