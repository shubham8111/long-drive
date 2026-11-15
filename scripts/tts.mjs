// Local neural text-to-speech for the radio announcer.
// Kokoro-82M (Apache-2.0) via kokoro-js / onnxruntime-node, running on CPU inside this Node process.
// Exposes GET /tts?text=... (WAV, cached forever in data/tts) from the Vite dev and preview servers.
// If the model has not been installed (npm run voice) the endpoint answers 503 and the game falls back
// to the browser's speechSynthesis.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ---- the one voice -------------------------------------------------------
export const VOICE = 'af_heart'; // calmest, warmest English voice (Kokoro grade A)
export const SPEED = 0.9; // slightly slower than default: late-night radio pace
export const DTYPE = 'q8'; // 8-bit quantised weights (92 MB); 'fp32' (326 MB) is the other option
export const MODEL_REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const MODEL_NAME = 'Kokoro-82M-v1.0-ONNX'; // folder name under data/tts-model
export const SAMPLE_RATE = 24000;

const ROOT = process.cwd();
export const MODEL_ROOT = path.resolve(ROOT, 'data/tts-model');
export const CACHE_DIR = path.resolve(ROOT, 'data/tts');
export const SAMPLES_DIR = path.resolve(ROOT, 'data/tts-samples');
export const MODEL_FILES = {
  'config.json': true,
  'tokenizer.json': true,
  'tokenizer_config.json': true,
  'generation_config.json': false, // optional
  'onnx/model_quantized.onnx': DTYPE === 'q8',
  'onnx/model.onnx': DTYPE === 'fp32',
};
const MODEL_ONNX = DTYPE === 'fp32' ? 'onnx/model.onnx' : 'onnx/model_quantized.onnx';

export function modelInstalled() {
  const dir = path.join(MODEL_ROOT, MODEL_NAME);
  return ['config.json', 'tokenizer.json', 'tokenizer_config.json', MODEL_ONNX].every((f) =>
    fs.existsSync(path.join(dir, f)),
  );
}

// ---- text normalisation --------------------------------------------------
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
function num59(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
}

export function normaliseForSpeech(text) {
  let t = String(text || '');
  t = t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  // clock times: "4:31 pm" -> "four thirty-one P M", "4:00 pm" -> "four P M", "9:05" -> "nine oh five"
  t = t.replace(/\b(\d{1,2}):(\d{2})\s*([ap])\.?m\.?(?![a-z])/gi, (_, h, m, ap) => {
    const hh = +h, mm = +m;
    const min = mm === 0 ? '' : mm < 10 ? ` oh ${num59(mm)}` : ` ${num59(mm)}`;
    return `${num59(hh)}${min} ${ap.toUpperCase()} M`;
  });
  t = t.replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => {
    const hh = +h, mm = +m;
    if (hh > 23 || mm > 59) return _;
    return `${num59(hh)}${mm === 0 ? " o'clock" : mm < 10 ? ` oh ${num59(mm)}` : ` ${num59(mm)}`}`;
  });
  t = t.replace(/\b(\d{1,2})\s*([ap])\.?m\.?(?![a-z])/gi, (_, h, ap) => `${num59(+h)} ${ap.toUpperCase()} M`);
  // units
  t = t.replace(/(\d)\s*°\s*C\b/g, '$1 degrees Celsius').replace(/(\d)\s*°\s*F\b/g, '$1 degrees Fahrenheit').replace(/°/g, ' degrees ');
  t = t.replace(/(\d)\s*km\/h\b/gi, '$1 kilometers per hour').replace(/\bkm\/h\b/gi, 'kilometers per hour');
  t = t.replace(/(\d)\s*mph\b/gi, '$1 miles per hour');
  t = t.replace(/(\d)\s*km\b/gi, '$1 kilometers').replace(/\bkm\b/gi, 'kilometers');
  t = t.replace(/(\d)\s*mi\b/g, '$1 miles').replace(/(\d)\s*m\b/g, '$1 meters');
  t = t.replace(/\bSt\.(?=\s+[A-Z])/g, 'Saint').replace(/\bMt\.(?=\s+[A-Z])/g, 'Mount').replace(/\bFt\.(?=\s+[A-Z])/g, 'Fort');
  t = t.replace(/\bvs\.?\s/gi, 'versus ').replace(/&/g, ' and ');
  t = t.replace(/\bFM\b/g, 'F M').replace(/\bAM\b/g, 'A M');
  return t.replace(/\s+/g, ' ').trim();
}

// ---- audio helpers -------------------------------------------------------
function processAudio(f32) {
  const n = f32.length;
  const thr = 0.004;
  let a = 0;
  while (a < n && Math.abs(f32[a]) < thr) a++;
  let b = n - 1;
  while (b > a && Math.abs(f32[b]) < thr) b--;
  const lead = Math.round(SAMPLE_RATE * 0.05);
  const tail = Math.round(SAMPLE_RATE * 0.12);
  const start = Math.max(0, a - lead);
  const end = Math.min(n, b + 1 + tail);
  const out = Float32Array.from(f32.subarray(start, end));
  // loudness: even RMS across sentences, never clip
  let sum = 0, peak = 0;
  for (let i = 0; i < out.length; i++) {
    sum += out[i] * out[i];
    const v = Math.abs(out[i]);
    if (v > peak) peak = v;
  }
  const rms = Math.sqrt(sum / Math.max(1, out.length)) || 1e-6;
  const gain = Math.min(0.1 / rms, 0.89 / (peak || 1e-6), 3);
  const fin = Math.round(SAMPLE_RATE * 0.012);
  const fout = Math.round(SAMPLE_RATE * 0.06);
  for (let i = 0; i < out.length; i++) {
    let g = gain;
    if (i < fin) g *= i / fin;
    const r = out.length - 1 - i;
    if (r < fout) g *= r / fout;
    out[i] *= g;
  }
  return out;
}

export function encodeWav(f32, rate = SAMPLE_RATE) {
  const buf = Buffer.alloc(44 + f32.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + f32.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(f32.length * 2, 40);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.max(-1, Math.min(1, f32[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

// ---- model (lazy, kept in memory, one synthesis at a time) ---------------
let ttsPromise = null;
let loadMs = 0;
async function getModel() {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const t0 = Date.now();
      const { KokoroTTS } = await import('kokoro-js');
      const { env } = await import('@huggingface/transformers');
      env.allowRemoteModels = false; // never touch the network at run time
      env.allowLocalModels = true;
      env.localModelPath = MODEL_ROOT + path.sep;
      const tts = await KokoroTTS.from_pretrained(MODEL_NAME, { dtype: DTYPE, device: 'cpu' });
      loadMs = Date.now() - t0;
      return tts;
    })();
    ttsPromise.catch(() => {
      ttsPromise = null; // allow a retry later
    });
  }
  return ttsPromise;
}

let chain = Promise.resolve();
const inflight = new Map();
const stats = { synthSeconds: 0, audioSeconds: 0, count: 0 };
export const ttsStats = () => ({ ...stats, loadMs, rssMB: Math.round(process.memoryUsage().rss / 1048576) });

/** Raw synthesis (serialised). Returns Float32Array samples at 24 kHz, post-processed. */
export function synthesize(text, { voice = VOICE, speed = SPEED } = {}) {
  const run = chain.then(async () => {
    const tts = await getModel();
    const t0 = performance.now();
    const audio = await tts.generate(normaliseForSpeech(text), { voice, speed });
    const out = processAudio(audio.audio);
    stats.synthSeconds += (performance.now() - t0) / 1000;
    stats.audioSeconds += out.length / SAMPLE_RATE;
    stats.count++;
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

export const cacheKey = (text) =>
  crypto.createHash('sha1').update(`${VOICE}|${SPEED}|${text}`).digest('hex').slice(0, 24);
export const cachePath = (text) => path.join(CACHE_DIR, `${cacheKey(text)}.wav`);

/** WAV buffer for a sentence, from the disk cache or freshly synthesised (then cached). */
export async function getSpeech(text) {
  const file = cachePath(text);
  try {
    return await fs.promises.readFile(file);
  } catch {}
  let p = inflight.get(file);
  if (!p) {
    p = (async () => {
      const wav = encodeWav(await synthesize(text));
      await fs.promises.mkdir(CACHE_DIR, { recursive: true });
      await fs.promises.writeFile(file + '.tmp', wav);
      await fs.promises.rename(file + '.tmp', file);
      return wav;
    })().finally(() => inflight.delete(file));
    inflight.set(file, p);
  }
  return p;
}

// ---- Vite plugin ---------------------------------------------------------
let lastLoadFail = 0;
export function ttsPlugin() {
  const handler = async (req, res, next) => {
    if (!req.url || !req.url.startsWith('/tts')) return next();
    let u;
    try {
      u = new URL(req.url, 'http://localhost');
    } catch {
      return next();
    }
    if (u.pathname !== '/tts') return next();
    const fail = (code, msg) => {
      res.statusCode = code;
      res.setHeader('Cache-Control', 'no-store');
      res.end(msg);
    };
    const text = (u.searchParams.get('text') || '').trim();
    if (!text || text.length > 400) return fail(400, 'bad text');
    try {
      if (!modelInstalled()) return fail(503, 'voice model not installed (npm run voice)');
      // cached sentences are served even if the model cannot load; only synthesis needs the model
      const cached = await fs.promises.readFile(cachePath(text)).catch(() => null);
      if (!cached && Date.now() - lastLoadFail < 30000) return fail(503, 'voice model unavailable');
      let wav = cached;
      if (!wav) {
        try {
          wav = await getSpeech(text);
        } catch (e) {
          lastLoadFail = Date.now();
          console.warn('[tts] synthesis failed:', e && e.message);
          return fail(503, 'synthesis failed');
        }
      }
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', wav.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(wav);
    } catch (e) {
      fail(500, String(e));
    }
  };
  return {
    name: 'local-tts',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
