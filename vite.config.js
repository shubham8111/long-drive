import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { ttsPlugin } from './scripts/tts.mjs';

// Map data is downloaded once and kept on disk in data/tiles (permanent).
// The game only ever asks this local server for tiles: /tiles/elev/z/x/y.png and /tiles/img/z/x/y.jpg
// (the names keep their old extensions; the bytes may be WebP, with the matching Content-Type)
const CACHE_DIR = path.resolve('data/tiles');
const UPSTREAM = {
  elev: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  img: (z, x, y) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
};
const TYPES = { elev: 'image/png', img: 'image/jpeg' };
// Tiles are kept compact on disk: imagery as WebP (quality 75: about two-thirds the size of the
// original JPEGs; the soft look hides the difference) and elevation as lossless WebP (every height
// exactly preserved, a quarter smaller). Older caches may still hold .png/.jpg files; both are read.
const ORIG_EXT = { elev: 'png', img: 'jpg' };
export const tileFile = (kind, z, x, y, ext) => path.join(CACHE_DIR, kind, String(z), String(x), `${y}.${ext}`);
let sharpMod = null;
const sharp = async () => (sharpMod ||= (await import('sharp')).default);
export async function compactTile(kind, buf) {
  const s = (await sharp())(buf);
  return kind === 'elev' ? s.webp({ lossless: true, effort: 5 }).toBuffer() : s.webp({ quality: 75, effort: 4 }).toBuffer();
}

// what is cached for this tile, as it is on disk (null if nothing yet)
async function readCached(kind, z, x, y) {
  for (const [ext, type] of [['webp', 'image/webp'], [ORIG_EXT[kind], TYPES[kind]]]) {
    try { return { buf: await fs.promises.readFile(tileFile(kind, z, x, y, ext)), type }; } catch {}
  }
  return null;
}

// fetch once from the open tile servers and keep it (compact) for good
async function fetchTile(kind, z, x, y) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(UPSTREAM[kind](z, x, y));
      if (!r.ok) throw new Error(`upstream ${r.status}`);
      const orig = Buffer.from(await r.arrayBuffer());
      const buf = await compactTile(kind, orig);
      const file = tileFile(kind, z, x, y, 'webp');
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file + '.tmp', buf);
      await fs.promises.rename(file + '.tmp', file);
      return { buf, type: 'image/webp', orig };
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// for the game: whatever is on disk (browsers decode WebP)
async function serveTile(kind, z, x, y) {
  return (await readCached(kind, z, x, y)) || (await fetchTile(kind, z, x, y));
}

// for the build scripts, which decode tiles themselves: always PNG (elevation) / JPEG (imagery) bytes
export async function getTile(kind, z, x, y) {
  const c = await readCached(kind, z, x, y);
  if (c && c.type !== 'image/webp') return c.buf;
  if (!c) return (await fetchTile(kind, z, x, y)).orig;
  const s = (await sharp())(c.buf);
  return kind === 'elev' ? s.png({ compressionLevel: 1 }).toBuffer() : s.jpeg({ quality: 95 }).toBuffer();
}

function tileCache() {
  const handler = async (req, res, next) => {
    // Baked places are served straight from disk: Vite only lists the public folder at start-up
    // (we deliberately don't watch it), so a place built while the server runs would otherwise 404.
    const w = /^\/(world|routes|music)\/([\w\-./]+?\.(json|bin|webp|png|ogg|flac))(\?.*)?$/.exec(req.url || '');
    if (w && !w[2].includes('..')) {
      try {
        const buf = await fs.promises.readFile(path.join('public', w[1], w[2]));
        res.setHeader('Content-Type', { json: 'application/json', webp: 'image/webp', png: 'image/png', ogg: 'audio/ogg', flac: 'audio/flac' }[w[3]] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        return res.end(buf);
      } catch { res.statusCode = 404; return res.end('not found'); }
    }
    const m = /^\/tiles\/(elev|img)\/(\d+)\/(\d+)\/(\d+)\.(png|jpg)/.exec(req.url || '');
    if (!m) return next();
    try {
      const { buf, type } = await serveTile(m[1], +m[2], +m[3], +m[4]);
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(buf);
    } catch (e) {
      res.statusCode = 502;
      res.end(String(e));
    }
  };
  return {
    name: 'tile-cache',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [tileCache(), ttsPlugin()],
  // never watch the map cache or baked world: tens of thousands of files that only burn CPU when watched
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/data/**', '**/public/world/**', '**/public/routes/**', '**/.cache/**'] } },
  preview: { port: 5174, strictPort: true },
  build: { target: 'esnext', chunkSizeWarningLimit: 2000, rollupOptions: { input: { main: 'index.html', demo: 'demo.html' } } },
});
