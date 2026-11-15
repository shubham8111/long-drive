// Downloads CC0 Poly Haven models (1k glTF), then processes them into small .glb files in public/models.
// usage: node scripts/fetch-models.mjs [--process-only]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld, prune, dedup, textureCompress, transformMesh } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data', 'models-src');
const OUT = path.join(ROOT, 'public', 'models');
const UA = 'long-drive-game/1.0';

// out: file name; size: [width, height] target bounding box in metres (x/z max extent, y height)
const MODELS = [
  { id: 'boulder_01', out: 'rock0', kind: 'rock', tris: 2400, tex: 512, w: 1.5, h: 1.0 },
  { id: 'namaqualand_boulder_03', out: 'rock1', kind: 'rock', tris: 2400, tex: 512, w: 3.0, h: 1.4 },
  { id: 'namaqualand_boulder_04', out: 'rock2', kind: 'rock', tris: 2400, tex: 512, w: 1.6, h: 2.2 },
  { id: 'searsia_lucida', keep: 'searsia_lucida_d_LOD0', out: 'shrub0', kind: 'shrub', tris: 3400, tex: 512, w: 1.4, h: 1.0 },
  { id: 'othonna_cerarioides', keep: 'othonna_cerarioides_b', out: 'shrub1', kind: 'shrub', tris: 3400, tex: 512, w: 1.1, h: 1.35 },
];

async function download() {
  for (const m of MODELS) {
    const dir = path.join(SRC, m.id);
    if (fs.existsSync(path.join(dir, m.id + '.gltf'))) continue;
    console.log('fetching', m.id);
    const meta = await (await fetch(`https://api.polyhaven.com/files/${m.id}`, { headers: { 'User-Agent': UA } })).json();
    const g = meta.gltf['1k'].gltf;
    fs.mkdirSync(dir, { recursive: true });
    const get = async (url, rel) => {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(url + ' ' + r.status);
      const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
    };
    await get(g.url, m.id + '.gltf');
    for (const [rel, f] of Object.entries(g.include)) await get(f.url, rel);
  }
}

// area-weighted smooth vertex normals for an indexed primitive
function smoothNormals(doc, prim) {
  const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
  const n = new Float32Array(pos.getCount() * 3), a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (let i = 0; i < idx.getCount(); i += 3) {
    const [i0, i1, i2] = [idx.getScalar(i), idx.getScalar(i + 1), idx.getScalar(i + 2)];
    pos.getElement(i0, a); pos.getElement(i1, b); pos.getElement(i2, c);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const j of [i0, i1, i2]) { n[j * 3] += f[0]; n[j * 3 + 1] += f[1]; n[j * 3 + 2] += f[2]; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(n));
}

// flip triangles whose winding disagrees with the exported vertex normals
function fixWinding(prim) {
  const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), idx = prim.getIndices();
  if (!nor || !idx) return;
  const arr = idx.getArray(); const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], n = [0, 0, 0]; let flipped = 0;
  for (let i = 0; i < arr.length; i += 3) {
    pos.getElement(arr[i], a); pos.getElement(arr[i + 1], b); pos.getElement(arr[i + 2], c);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    let d = 0; for (const k of [0, 1, 2]) { nor.getElement(arr[i + k], n); d += f[0] * n[0] + f[1] * n[1] + f[2] * n[2]; }
    if (d < 0) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; flipped++; }
  }
  idx.setArray(arr);
  console.log('  winding fixed on', flipped, 'of', arr.length / 3);
}

// if most faces point towards the middle of the model, the winding is inside-out: flip it
function orientOutward(prim) {
  const pos = prim.getAttribute('POSITION'), idx = prim.getIndices(), arr = idx.getArray();
  const lo = pos.getMin([0, 0, 0]), hi = pos.getMax([0, 0, 0]), ctr = lo.map((v, i) => (v + hi[i]) / 2);
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0]; let score = 0;
  for (let i = 0; i < arr.length; i += 3) {
    pos.getElement(arr[i], a); pos.getElement(arr[i + 1], b); pos.getElement(arr[i + 2], c);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    score += f[0] * (a[0] - ctr[0]) + f[1] * (a[1] - ctr[1]) + f[2] * (a[2] - ctr[2]);
  }
  if (score < 0) { for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; } idx.setArray(arr); console.log('  flipped inside-out mesh'); }
}

async function processAll() {
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  fs.mkdirSync(OUT, { recursive: true });
  for (const m of MODELS) {
    const doc = await io.read(path.join(SRC, m.id, m.id + '.gltf'));
    const root = doc.getRoot();
    // flatten node transforms into the single mesh
    const scene = root.listScenes()[0];
    // some sources hold several growth stages side by side: keep just one
    if (m.keep) { const drop = []; scene.traverse((n) => { if (n.getMesh() && n.getName() !== m.keep) drop.push(n); }); drop.forEach((n) => n.dispose()); await doc.transform(prune()); }
    const nodes = []; scene.traverse((n) => { if (n.getMesh()) nodes.push(n); });
    console.log(m.id, 'nodes', nodes.length, 'meshes', root.listMeshes().length);
    // bake node world matrices into the vertices so every mesh lives in one space
    const mulPt = (M, v, w) => [0, 1, 2].map((r) => M[r] * v[0] + M[4 + r] * v[1] + M[8 + r] * v[2] + w * M[12 + r]);
    for (const n of nodes) {
      const M = n.getWorldMatrix();
      for (const p of n.getMesh().listPrimitives()) {
        const pos = p.getAttribute('POSITION'), nor = p.getAttribute('NORMAL'); const a = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, a); pos.setElement(i, mulPt(M, a, 1)); }
        if (nor) for (let i = 0; i < nor.getCount(); i++) { nor.getElement(i, a); const r = mulPt(M, a, 0); const l = Math.hypot(...r) || 1; nor.setElement(i, r.map((x) => x / l)); }
      }
    }
    scene.traverse((n) => { n.setTranslation([0, 0, 0]); n.setRotation([0, 0, 0, 1]); n.setScale([1, 1, 1]); });
    // vertex colours (baked AO) are unused and block welding
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) p.setAttribute('COLOR_0', null);
    if (m.kind === 'rock') for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) { fixWinding(p); p.setAttribute('NORMAL', null); } // flat-shaded exports block welding; rebuilt below
    await doc.transform(weld());
    const count = () => root.listMeshes().flatMap((x) => x.listPrimitives()).reduce((a, p) => a + (p.getIndices()?.getCount() ?? 0) / 3, 0);
    const before = count();
    // meshopt stops at its error limit, so tighten the budget stepwise until the triangle target is met
    for (let err = m.kind === 'rock' ? 0.02 : 0.05, i = 0; count() > m.tris * 1.02 && i < 8; err *= 2, i++) {
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.01, m.tris / count()), error: err, lockBorder: false }));
    }
    if (m.kind === 'rock') for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) smoothNormals(doc, p);
    const prims = root.listMeshes().flatMap((x) => x.listPrimitives());
    const rawBounds = () => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], a = [0, 0, 0]; for (const p of prims) { const pos = p.getAttribute('POSITION'); for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, a); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[k]); hi[k] = Math.max(hi[k], a[k]); } } } return { min: lo, max: hi }; };
    if (m.copies > 1) {
      // sprays are flat: add yaw-rotated copies around the centre so the shrub reads as a volume
      const b0 = rawBounds(), cx0 = (b0.min[0] + b0.max[0]) / 2, cz0 = (b0.min[2] + b0.max[2]) / 2;
      const mesh0 = root.listMeshes()[0];
      for (let c = 1; c < m.copies; c++) {
        const ang = (c * Math.PI) / m.copies, cs = Math.cos(ang), sn = Math.sin(ang);
        for (const p of prims) {
          const np = doc.createPrimitive().setMaterial(p.getMaterial()).setIndices(p.getIndices());
          for (const sem of p.listSemantics()) {
            const src = p.getAttribute(sem); const arr = Float32Array.from(src.getArray());
            if (sem === 'POSITION' || sem === 'NORMAL') {
              const off = sem === 'POSITION';
              for (let i = 0; i < arr.length; i += 3) { const x = arr[i] - (off ? cx0 : 0), z = arr[i + 2] - (off ? cz0 : 0); arr[i] = x * cs - z * sn + (off ? cx0 : 0); arr[i + 2] = x * sn + z * cs + (off ? cz0 : 0); }
            }
            np.setAttribute(sem, doc.createAccessor().setType(src.getType()).setArray(arr));
          }
          mesh0.addPrimitive(np);
        }
      }
    }
    const prims2 = root.listMeshes().flatMap((x) => x.listPrimitives()); prims.length = 0; prims.push(...prims2);
    // measure bounds (world space) and normalise: scale so size matches, base at y=0, centred on x/z
    const b = rawBounds();
    const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
    const wide = Math.max(sx, sz);
    // scale to the target width, height follows within [0.75, 1.6] x the width scale (keeps the texture from stretching much)
    const sxz = m.w / wide;
    const syy = Math.min(Math.max(m.h / sy, sxz * 0.75), sxz * 1.6);
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    // bake into vertex positions
    for (const p of prims) {
      const pos = p.getAttribute('POSITION'); const a = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, a); pos.setElement(i, [(a[0] - cx) * sxz, (a[1] - b.min[1]) * syy, (a[2] - cz) * sxz]); }
    }
    // drop node transforms (assumes identity after bake if source nodes were identity)
    // strip ARM / unused textures: keep base colour + normal only
    for (const mat of root.listMaterials()) { if (mat.getAlphaMode() === 'BLEND') mat.setAlphaMode('MASK').setAlphaCutoff(0.5); mat.setMetallicRoughnessTexture(null); mat.setOcclusionTexture(null); mat.setEmissiveTexture(null); }
    if (m.kind === 'rock') {
      // photoscan albedo is dark and off-hue: keep only normalised luminance, the game tints it Bryce-warm
      for (const mat of root.listMaterials()) {
        const t = mat.getBaseColorTexture(); if (!t) continue;
        const buf = await sharp(Buffer.from(t.getImage())).resize(m.tex, m.tex).greyscale().normalise({ lower: 3, upper: 97 }).linear(0.5, 75).png().toBuffer();
        t.setImage(new Uint8Array(buf)).setMimeType('image/png');
      }
    }
    await doc.transform(prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [m.tex, m.tex], quality: 82 }));
    const file = path.join(OUT, m.out + '.glb');
    await io.write(file, doc);
    const tc = root.listMeshes().flatMap((x) => x.listPrimitives()).reduce((a, p) => a + (p.getIndices()?.getCount() ?? 0) / 3, 0);
    console.log(`  ${m.id} -> ${m.out}.glb  ${before} -> ${tc} tris  ${(fs.statSync(file).size / 1024).toFixed(0)} KB  src bounds ${sx.toFixed(2)}x${sy.toFixed(2)}x${sz.toFixed(2)}`);
  }
  fs.writeFileSync(path.join(OUT, 'CREDITS.md'), `# Model credits

All models are CC0 (public domain) from Poly Haven, https://polyhaven.com. Simplified and re-textured to 512 px WebP by scripts/fetch-models.mjs.

${MODELS.map((m) => `- ${m.out}.glb: ${m.id}, https://polyhaven.com/a/${m.id}, CC0`).join('\n')}
`);
}

if (!process.argv.includes('--process-only')) await download();
await processAll();
