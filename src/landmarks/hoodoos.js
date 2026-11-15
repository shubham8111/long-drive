// Hoodoo fields: the banded orange / pink / cream spires and fins below the Bryce rim, and the redder
// pinnacles of Red Canyon. Positions are baked (scripts/bake-hoodoos.mjs -> public/world/bryce/hoodoos.bin,
// 8 floats each: x, ground y, z, height, radius, rotY, variant, tone). Rendering: one InstancedMesh per
// 640 m chunk; the body shape (5 variants: spire, chunky column, fin, stump, Thor's hammer) is displaced in
// the vertex shader from a plain stacked-ring tube, so a chunk is ONE draw call whatever it contains.
// Chunks within 2.5 km are built lazily; each switches between 3 mesh detail levels by distance.
import * as THREE from 'three';
import { patch } from '../assets.js';

const BASE = import.meta.env?.BASE_URL ?? '/';
const CHUNK = 640, RANGE = 2400;
// ring heights (t: -0.14.. -0 is the talus apron, 0..1 the body) and sides per detail level
const LODS = [
  { sides: 10, t: [-0.14, -0.06, 0, 0.08, 0.17, 0.27, 0.38, 0.5, 0.62, 0.74, 0.8, 0.85, 0.9, 0.94, 0.97, 1] },
  { sides: 6, t: [-0.14, 0, 0.2, 0.45, 0.7, 0.84, 0.93, 1] },
  { sides: 5, t: [-0.14, 0, 0.4, 0.8, 0.93, 1] },
];
const LOD_DIST = [230, 900]; // chunk-edge distance where detail drops

// A tube of unit radius: position.xz is the unit direction, position.y the ring height t. The vertex shader
// turns that into the hoodoo.
function lodArrays(l) {
  const S = l.sides, R = l.t.length, pos = [], nor = [], idx = [];
  for (let r = 0; r < R; r++)
    for (let i = 0; i < S; i++) {
      const a = (i / S) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), up = l.t[r] < 0 ? 0.6 : 0.1;
      pos.push(c, l.t[r], s); const n = Math.hypot(c, up, s); nor.push(c / n, up / n, s / n);
    }
  for (let r = 0; r < R - 1; r++)
    for (let i = 0; i < S; i++) {
      const a = r * S + i, b = r * S + (i + 1) % S, c = (r + 1) * S + i, d = (r + 1) * S + (i + 1) % S;
      idx.push(a, c, b, b, c, d);
    }
  const top = pos.length / 3; pos.push(0, 1, 0); nor.push(0, 1, 0);
  for (let i = 0; i < S; i++) idx.push((R - 1) * S + (i + 1) % S, (R - 1) * S + i, top);
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint16Array(idx) };
}

const VERT_DISP = /* glsl */`
{
  float hv = aHV.x, sd = aHV.y;
  float t = position.y, tc = clamp(t, 0.0, 1.0);
  vec2 dir = position.xz;
  float ang = atan(dir.y, dir.x);
  float rr = 1.0, sx = 1.0, sz = 1.0;
  float capr = 1.0 + 0.3 * smoothstep(0.86, 0.9, tc) * (1.0 - smoothstep(0.95, 1.0, tc));
  if (hv < 0.5) { // slender spire: stacked bulges, narrow top, cap rock
    rr = mix(1.0, 0.3, pow(tc, 0.65)) * (1.0 + 0.2 * sin(tc * 14.0 + sd * 40.0)) * capr;
  } else if (hv < 1.5) { // chunky column
    rr = mix(1.0, 0.7, tc) * (1.0 + 0.14 * sin(tc * 8.0 + sd * 40.0)) * (1.0 + 0.12 * (capr - 1.0));
  } else if (hv < 2.5) { // fin: a long thin wall
    rr = mix(1.0, 0.62, pow(tc, 0.8)) * (1.0 + 0.12 * sin(tc * 10.0 + sd * 40.0)); sx = 3.0; sz = 0.5;
  } else if (hv < 3.5) { // broken stump
    rr = mix(1.0, 0.82, tc) * (1.0 + 0.1 * sin(tc * 6.0 + sd * 40.0));
  } else { // Thor's hammer: thin neck, heavy block on top
    rr = mix(0.4 + 0.2 * pow(1.0 - tc, 3.0), 1.0, smoothstep(0.77, 0.84, tc)) * (1.0 - 0.25 * smoothstep(0.96, 1.0, tc));
  }
  if (t < 0.0) { // talus apron
    float r0 = hv < 0.5 ? 1.0 : hv < 1.5 ? 1.0 : hv < 2.5 ? 1.0 : 1.0;
    rr = r0 * (1.0 + (-t) * 11.0);
  }
  rr *= 1.0 + 0.1 * sin(ang * 3.0 + sd * 31.0 + tc * 6.0) + 0.06 * sin(ang * 5.0 + tc * 11.0 + sd * 17.0);
  transformed = vec3(dir.x * rr * sx, t, dir.y * rr * sz);
  if (hv > 2.5 && hv < 3.5 && t > 0.99) transformed.y -= 0.1 * (0.5 + 0.5 * sin(ang * 2.0 + sd * 9.0)) + 0.05 * dir.x;
  vHt = length(instanceMatrix[1].xyz);
  vTop = tc;
}`;

const FRAG_COLOR = /* glsl */`
{
  float yw = vOP.y * vHt;                       // metres above the hoodoo's base
  vec3 q = vec3(vOP.x * 2.0, yw * 0.3, vOP.z * 2.0) + vec3(vHt * 0.37);
  float w = ldN(q * 0.9) * 0.6 + ldN(q * 2.7 + 3.0) * 0.25;
  float red = clamp(1.0 - vColor.g / max(vColor.r, 0.001), 0.0, 1.0) * 2.6; // 0 Bryce .. 1 Red Canyon
  float b = yw * 0.5 + w * 2.2 + vHt * 0.13;
  float id = floor(b), fr = fract(b);
  float hsh = fract(sin(id * 12.9898 + vHt * 0.7) * 43758.5453);
  float k = clamp(hsh * 0.62 + (1.0 - vTop) * 0.26 + red * 0.4, 0.0, 1.0);
  vec3 cream = vec3(0.72, 0.52, 0.36), salmon = vec3(0.64, 0.31, 0.21), orange = vec3(0.54, 0.21, 0.08), rust = vec3(0.34, 0.09, 0.04);
  vec3 c = mix(cream, salmon, smoothstep(0.18, 0.4, k));
  c = mix(c, orange, smoothstep(0.45, 0.68, k));
  c = mix(c, rust, smoothstep(0.78, 1.0, k));
  c *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, 0.1, fr));         // dark seam under each band
  c *= 0.78 + 0.4 * (ldN(q * 7.0) * 0.5 + ldN(q * 19.0) * 0.5); // weathering
  float cap = smoothstep(0.93, 0.955, vTop);                   // darker, harder cap rock
  c = mix(c, vec3(0.20, 0.11, 0.07) * (0.8 + 0.4 * w), cap * 0.55);
  float talus = smoothstep(0.045, -0.01, vTop) + (1.0 - smoothstep(-0.01, 0.0, vOP.y)) ;
  c = mix(c, vec3(0.48, 0.30, 0.2) * (0.8 + 0.5 * ldN(q * 11.0)), clamp(talus, 0.0, 1.0) * 0.8);
  diffuseColor.rgb = c;
}`;

function makeMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
  patch(m, shared, { kind: 'hoodoo', snowMode: 0 });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev(shader, r);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aHV; varying float vHt; varying float vTop;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_DISP);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHt; varying float vTop;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + FRAG_COLOR);
  };
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = () => key() + '_hd1';
  return m;
}

export const HOODOOS = {
  id: 'hoodoos', kind: 'ambient', local: true, cooldown: 1,
  possible: (ctx) => ctx.place?.id === 'bryce' && !!ctx.world && !!ctx.geo && !!ctx.camera,
  chance: () => 1,
  create(ctx) {
    const group = new THREE.Group(); group.name = 'hoodoos';
    ctx.world.add(group);
    const material = makeMaterial(ctx.shared);
    const lods = LODS.map(lodArrays);
    const chunks = new Map(); // key -> { mesh, lod, cx, cz, n, data, sphere }
    let recs = null, dead = false, lastX = 1e9, lastZ = 1e9, t0 = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Vector3(0, 1, 0), v3 = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();

    fetch(`${BASE}world/${ctx.place.id}/hoodoos.bin`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((buf) => {
      if (!buf || dead) return;
      const a = new Float32Array(buf), by = new Map();
      for (let i = 0; i < a.length; i += 8) {
        const k = `${Math.floor(a[i] / CHUNK)},${Math.floor(a[i + 2] / CHUNK)}`;
        let l = by.get(k); if (!l) by.set(k, (l = [])); l.push(i);
      }
      let sd = 7; const rn = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      for (const l of by.values()) for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rn() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } // random order, so a prefix is a fair thinning
      recs = { a, by };
      lastX = 1e9;
    }).catch(() => {});

    const geometryFor = (c, lod) => {
      const L = lods[lod], g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(L.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(L.nor, 3));
      g.setIndex(new THREE.BufferAttribute(L.idx, 1));
      g.setAttribute('aHV', new THREE.InstancedBufferAttribute(c.hv, 2));
      return g;
    };

    function buildChunk(key, idxs) {
      const a = recs.a, n = idxs.length, hv = new Float32Array(n * 2);
      const mesh = new THREE.InstancedMesh(new THREE.BufferGeometry(), material, n);
      for (let j = 0; j < n; j++) {
        const i = idxs[j], h = a[i + 3], r = a[i + 4], rot = a[i + 5], red = a[i + 7];
        const y = a[i + 1]; // baked from the same elevation tiles as the terrain (heightAt throws for unloaded tiles)
        q.setFromAxisAngle(e, rot);
        m4.compose(v3.set(a[i], y - 0.06 * h, a[i + 2]), q, sc.set(r, h, r));
        mesh.setMatrixAt(j, m4);
        const br = 0.85 + 0.3 * ((Math.sin(a[i] * 12.9 + a[i + 2] * 78.2) * 43758.5) % 1 + 1) % 1;
        mesh.setColorAt(j, red > 0.5 ? col.setRGB(br, br * 0.62, br * 0.5) : col.setRGB(br, br, br));
        hv[j * 2] = a[i + 6]; hv[j * 2 + 1] = rot / (Math.PI * 2);
      }
      mesh.instanceMatrix.needsUpdate = true;
      const [cx, cz] = key.split(',').map(Number);
      const c = { mesh, n, lod: -1, cx, cz, hv, sphere: new THREE.Sphere(new THREE.Vector3((cx + 0.5) * CHUNK, 0, (cz + 0.5) * CHUNK), CHUNK * 0.72 + 12) };
      // vertical extent of the chunk's ground, for a tighter cull sphere
      let y0 = 1e9, y1 = -1e9; for (const i of idxs) { y0 = Math.min(y0, a[i + 1]); y1 = Math.max(y1, a[i + 1] + a[i + 3]); }
      c.sphere.center.y = (y0 + y1) / 2; c.sphere.radius = Math.hypot(CHUNK * 0.72, (y1 - y0) / 2) + 14;
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
      group.add(mesh);
      chunks.set(key, c);
    }

    function stream(cam) {
      const cx0 = Math.floor((cam.x - RANGE) / CHUNK), cx1 = Math.floor((cam.x + RANGE) / CHUNK);
      const cz0 = Math.floor((cam.z - RANGE) / CHUNK), cz1 = Math.floor((cam.z + RANGE) / CHUNK);
      let built = 0;
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        const k = `${cx},${cz}`, idxs = recs.by.get(k);
        if (!idxs || chunks.has(k) || built >= 2) continue; // at most 2 chunk builds per pass
        const dx = Math.max(0, Math.abs((cx + 0.5) * CHUNK - cam.x) - CHUNK / 2), dz = Math.max(0, Math.abs((cz + 0.5) * CHUNK - cam.z) - CHUNK / 2);
        if (dx * dx + dz * dz > RANGE * RANGE) continue;
        buildChunk(k, idxs); built++;
      }
      if (built >= 2) lastX = 1e9; // more to build next frame
      for (const [k, c] of chunks) {
        const dx = Math.max(0, Math.abs((c.cx + 0.5) * CHUNK - cam.x) - CHUNK / 2), dz = Math.max(0, Math.abs((c.cz + 0.5) * CHUNK - cam.z) - CHUNK / 2);
        if (dx * dx + dz * dz > (RANGE + 300) ** 2) { group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh.dispose(); chunks.delete(k); }
      }
    }

    return {
      update(dt, c2) {
        if (dead || !recs) return true;
        const cam = (c2?.camera || ctx.camera).position;
        if ((cam.x - lastX) ** 2 + (cam.z - lastZ) ** 2 > 50 * 50) { lastX = cam.x; lastZ = cam.z; stream(cam); }
        const camera = c2?.camera || ctx.camera;
        camera.updateMatrixWorld();
        pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(pv);
        for (const c of chunks.values()) {
          const d = Math.hypot(c.sphere.center.x - cam.x, c.sphere.center.z - cam.z) - CHUNK * 0.5;
          c.mesh.visible = (d < RANGE) && frustum.intersectsSphere(c.sphere);
          if (!c.mesh.visible) continue;
          const lod = d < LOD_DIST[0] - (c.lod === 0 ? -60 : 0) ? 0 : d < LOD_DIST[1] - (c.lod === 1 ? -120 : 0) ? 1 : 2;
          // distant crowds read the same in haze with fewer spires
          c.mesh.count = Math.max(1, Math.ceil(c.n * (d < 1000 ? 1 : d < 1500 ? 0.7 : 0.45)));
          if (lod !== c.lod) { const old = c.mesh.geometry; c.mesh.geometry = geometryFor(c, lod); old.dispose(); c.lod = lod; }
        }
        return true;
      },
      dispose() {
        dead = true;
        for (const c of chunks.values()) { c.mesh.geometry.dispose(); c.mesh.dispose(); }
        chunks.clear(); group.removeFromParent(); material.dispose();
      },
    };
  },
};
