import * as THREE from 'three';
import { BASE } from './paths.js';

// The real street network around a city route (cross streets, parallel streets), baked by scripts/bake-roads.mjs
// into /world/<id>/roads/{index.json, roads.bin}. Everything is ground-level asphalt + footpath ribbons:
// one merged mesh (one draw call) per 192 m cell, built at load a cell at a time. Heights are baked from the same
// levelled "city floor" the terrain uses; layers (footpath < junction disc < streets by class < crosswalk paint) are
// separated by small y offsets that grow with camera distance (as the main road does), so nothing z-fights and the
// main road ribbon (offset a little more) always wins where they overlap. Inert when a place has no baked roads.

const LOAD_R = 330, DROP_R = 430, CHECK_EVERY = 0.4;

// attribute layout per vertex: position(3), aU lateral metres(1), aI (hw, cls, layer, mode + 16 * oneway)(4), aE (along metres, junction distance)(2)
// modes: 0 footpath, 1 street, 2 junction disc, 3 zebra, 4 stop line
const STRIDE = 10;

class Builder {
  constructor() { this.v = []; this.i = []; this.n = 0; }
  vert(x, y, z, u, hw, cls, lay, mode, s, jd) { this.v.push(x, y, z, u, hw, cls, lay, mode, s, jd); return this.n++; }
  quad(a, b, c, d) { this.i.push(a, b, c, b, d, c); }
}

function buildCell(f, o, len, ox, oz) {
  const B = new Builder();
  const end = o + len;
  let pieces = 0;
  while (o < end) {
    const type = f[o];
    if (type === 1) {
      const cls = f[o + 1], hw = f[o + 2], fp = f[o + 3], flags = f[o + 4] | 0, n = f[o + 5] | 0;
      const p = o + 6;
      o = p + n * 3;
      if (n < 2) continue;
      pieces++;
      const oneway = flags & 1 ? 16 : 0, startJ = flags & 4, endJ = flags & 8, tie = (flags >> 4) & 3;
      const lay = cls >= 7 ? 2 : 2 + 0.5 * (6 - cls) + tie * 0.12 + 0.5; // bigger classes sit above smaller ones
      // directions, cumulative length
      const L = new Float32Array(n);
      const dx = new Float32Array(n - 1), dz = new Float32Array(n - 1);
      for (let k = 0; k < n - 1; k++) {
        const a = p + k * 3, b = a + 3;
        let ddx = f[b] - f[a], ddz = f[b + 2] - f[a + 2];
        const l = Math.hypot(ddx, ddz) || 1e-4;
        dx[k] = ddx / l; dz[k] = ddz / l; L[k + 1] = L[k] + l;
      }
      const total = L[n - 1];
      const pedestrian = cls >= 7;
      const mode = pedestrian ? 0 : 1;
      const cross = fp > 0 && !pedestrian ? [-hw - fp, -hw, -hw, hw, hw, hw + fp] : pedestrian ? [-hw, hw] : [-hw, hw];
      const kinds = fp > 0 && !pedestrian ? [0, 0, 1, 1, 0, 0] : pedestrian ? [0, 0] : [1, 1];
      const base = B.n;
      const W = cross.length;
      for (let k = 0; k < n; k++) {
        let nx, nz;
        const a = k > 0 ? k - 1 : 0, b = k < n - 1 ? k : n - 2;
        // right normals of the adjoining segments
        const n0x = -dz[a], n0z = dx[a], n1x = -dz[b], n1z = dx[b];
        nx = n0x + n1x; nz = n0z + n1z;
        const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
        const sc = Math.min(2.2, 1 / Math.max(0.45, nx * n0x + nz * n0z));
        const x = f[p + k * 3] - ox, y = f[p + k * 3 + 1], z = f[p + k * 3 + 2] - oz;
        const jd = Math.min(startJ ? L[k] : 999, endJ ? total - L[k] : 999);
        for (let c = 0; c < W; c++) {
          const u = cross[c], m = u * sc;
          // footpath rows carry mode 0, street rows mode 1 (+ one-way flag)
          B.vert(x + nx * m, y, z + nz * m, u, hw, cls, kinds[c] ? lay : 0, kinds[c] ? mode + oneway : 0, L[k], jd);
        }
      }
      for (let k = 0; k < n - 1; k++) {
        const r0 = base + k * W, r1 = r0 + W;
        for (let q = 0; q < W; q += 2) {
          // pedestrian / bare ribbons are 2 wide; footpath ribbons use quads (0,1) (2,3) (4,5)
          B.quad(r0 + q, r0 + q + 1, r1 + q, r1 + q + 1);
        }
      }
    } else if (type === 2) {
      const x = f[o + 1] - ox, y = f[o + 2], z = f[o + 3] - oz, r = f[o + 4];
      o += 5;
      const c = B.vert(x, y, z, 0, r, 99, 1, 2, 0, 999);
      const S = 14;
      for (let k = 0; k < S; k++) { const a = (k / S) * Math.PI * 2; B.vert(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, r, 99, 1, 2, 0, 999); }
      for (let k = 0; k < S; k++) B.i.push(c, c + 1 + ((k + 1) % S), c + 1 + k);
    } else if (type === 3) {
      const x = f[o + 1] - ox, y = f[o + 2], z = f[o + 3] - oz, tx = f[o + 4], tz = f[o + 5], lat = f[o + 6], hw = f[o + 7], ln = f[o + 8], kind = f[o + 9];
      o += 10;
      const rx = -tz, rz = tx; // right normal of the outward direction
      const mode = kind === 0 ? 3 : 4, lay = 7.0;
      const cx = x + rx * lat, cz = z + rz * lat;
      const a = B.vert(cx - rx * hw - tx * ln * 0.5, y, cz - rz * hw - tz * ln * 0.5, -hw, hw, 4, lay, mode, 0, 999);
      const b = B.vert(cx + rx * hw - tx * ln * 0.5, y, cz + rz * hw - tz * ln * 0.5, hw, hw, 4, lay, mode, 0, 999);
      const c = B.vert(cx - rx * hw + tx * ln * 0.5, y, cz - rz * hw + tz * ln * 0.5, -hw, hw, 4, lay, mode, ln, 999);
      const d = B.vert(cx + rx * hw + tx * ln * 0.5, y, cz + rz * hw + tz * ln * 0.5, hw, hw, 4, lay, mode, ln, 999);
      B.i.push(a, b, c, b, d, c);
    } else break;
  }
  if (!B.i.length) return null;
  const g = new THREE.BufferGeometry();
  const buf = new THREE.InterleavedBuffer(new Float32Array(B.v), STRIDE);
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(buf, 3, 0));
  g.setAttribute('aU', new THREE.InterleavedBufferAttribute(buf, 1, 3));
  g.setAttribute('aI', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  g.setAttribute('aE', new THREE.InterleavedBufferAttribute(buf, 2, 8));
  g.setIndex(new THREE.BufferAttribute(B.n > 65535 ? new Uint32Array(B.i) : new Uint16Array(B.i), 1));
  g.boundingSphere = null;
  g.computeBoundingSphere();
  g.userData.tris = B.i.length / 3;
  g.userData.pieces = pieces;
  return g;
}

function noiseTexture() {
  const S = 128, d = new Uint8Array(S * S * 4);
  let a = 1234567;
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // smooth-ish low frequency value noise in each channel (tileable) so the grain has no hard repeats
  const chan = [];
  for (let c = 0; c < 4; c++) {
    const g = 8 + c * 4, grid = new Float32Array(g * g);
    for (let i = 0; i < g * g; i++) grid[i] = rnd();
    const out = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const fx = (x / S) * g, fy = (y / S) * g, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const sx = ax * ax * (3 - 2 * ax), sy = ay * ay * (3 - 2 * ay);
      const v = (xx, yy) => grid[(yy % g) * g + (xx % g)];
      out[y * S + x] = (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
    }
    chan.push(out);
  }
  for (let i = 0; i < S * S; i++) {
    // channel 0 doubles as per-texel white noise for footpath slab tones (sampled at texel centres)
    d[i * 4] = chan[0][i] * 255 * 0.5 + rnd() * 255 * 0.5;
    d[i * 4 + 1] = chan[1][i] * 255; d[i * 4 + 2] = chan[2][i] * 255; d[i * 4 + 3] = chan[3][i] * 255;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export class CityRoads {
  constructor(scene, geo, routeData, route, shared, renderer) {
    this.scene = scene; this.shared = shared; this.route = route;
    this.base = `${BASE}world/${routeData.id}/roads`;
    this.us = routeData.id === 'manhattan' || routeData.id === 'la' ? 1 : 0;
    this.index = null; this.bin = null;
    this.cells = new Map(); // key -> Mesh | null
    this.cs = 192;
    this.clock = 1; this.lastX = 1e9; this.lastZ = 1e9;
    this.visibleCells = 0; this.tris = 0; this.drawCalls = 0; this.lastBuildMs = 0; this.maxBuildMs = 0;
    this.mat = null;
    fetch(`${this.base}/index.json`).then((r) => (r.ok ? r.json() : null)).then(async (j) => {
      if (!j || !j.cells) return;
      const r = await fetch(`${this.base}/roads.bin`);
      if (!r.ok) return;
      this.bin = new Float32Array(await r.arrayBuffer());
      this.cs = j.cell || 192;
      this.index = j;
      this.junctions = j.junctions || [];
      this.makeMaterial(renderer);
      this.clock = 1;
    }).catch(() => {});
  }

  get count() { let n = 0; for (const m of this.cells.values()) if (m) n += m.geometry.userData.pieces; return n; }

  makeMaterial(renderer) {
    const shared = this.shared, us = this.us;
    const nz = noiseTexture();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, envMapIntensity: 0.1 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWet = shared.uWet; sh.uniforms.uSnow = shared.uSnow;
      sh.uniforms.uNz = { value: nz }; sh.uniforms.uYellow = { value: us };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float aU; attribute vec4 aI; attribute vec2 aE;
varying float vU; varying vec4 vI; varying vec2 vE; varying vec3 vWp;`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 rwp = (modelMatrix * vec4(transformed, 1.0)).xyz;
transformed.y += 0.085 + 0.006 * aI.z + distance(rwp, cameraPosition) * (0.0016 + 0.00022 * aI.z);
vWp = rwp; vU = aU; vI = aI; vE = aE;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uWet; uniform float uSnow; uniform sampler2D uNz; uniform float uYellow;
varying float vU; varying vec4 vI; varying vec2 vE; varying vec3 vWp;
float rRough = 0.9;
vec3 footLook(vec3 n1, vec3 n2, vec3 n3) {
  vec2 g = vWp.xz / 1.25; vec2 cell = floor(g);
  float slab = texture2D(uNz, (cell + 0.5) / 128.0).r;
  vec2 f = abs(fract(g) - 0.5);
  float w = fwidth(g.x) + fwidth(g.y);
  float j = smoothstep(0.462, 0.488, max(f.x, f.y)) * (1.0 - smoothstep(0.12, 0.45, w));
  vec3 c = vec3(0.30, 0.29, 0.275) * (0.84 + 0.3 * slab) * (0.9 + 0.2 * n3.g) * (0.86 + 0.28 * n2.b);
  return c * (1.0 - 0.32 * j);
}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  float mode = mod(vI.w, 16.0); bool ow = vI.w > 15.5;
  float hw = vI.x, cls = vI.y, u = vU, au = abs(vU);
  vec2 q = vWp.xz;
  vec3 n1 = texture2D(uNz, q * 0.17).rgb, n2 = texture2D(uNz, q * 0.031 + 0.37).rgb, n3 = texture2D(uNz, q * 1.3).rgb;
  vec3 col; float rough = 0.9; float paint = 0.0;
  if (mode < 0.5) { col = footLook(n1, n2, n3); rough = 0.84; }
  else {
    col = vec3(0.0455) * (0.7 + 0.55 * n2.r + 0.4 * (n1.g - 0.5)) * (0.84 + 0.32 * n3.b);
    col *= mix(1.0, 0.8, smoothstep(0.7, 0.78, n2.g)) * (1.0 - 0.25 * smoothstep(0.82, 0.9, n1.b));
    float jf = smoothstep(hw + 1.0, hw + 4.5, vE.y);
    if (mode < 1.5) {
      // gutter + kerb stone along the edges (streets with footpaths only: they are the ones with vI.y < 5.5)
      float e = smoothstep(hw - 0.55, hw - 0.12, au);
      col *= 1.0 - 0.28 * e * jf;
      float kerb = smoothstep(hw - 0.2, hw - 0.14, au);
      col = mix(col, vec3(0.21, 0.205, 0.195) * (0.85 + 0.3 * n3.g), kerb * jf * step(cls, 5.5));
      if (cls < 3.5) {
        float nl = max(1.0, floor(2.0 * hw / 3.0 + 0.5));
        if (!ow) nl = max(2.0, 2.0 * ceil(nl * 0.5));
        float lw = 2.0 * hw / nl, x = (u + hw) / lw, k = floor(x + 0.5), fx = abs(x - k) * lw;
        float inner = step(0.5, k) * step(k, nl - 0.5);
        float dash = step(fract(vE.x / 9.0), 0.34);
        float wd = fwidth(u) + 0.02;
        float lane = smoothstep(0.07 + wd, 0.05, fx) * inner * dash;
        if (!ow) {
          float cen = step(abs(k - nl * 0.5), 0.1);
          lane *= 1.0 - cen;
          float dbl = smoothstep(0.06 + wd, 0.04, abs(au - 0.15)) * step(0.5, uYellow);
          float sgl = smoothstep(0.07 + wd, 0.05, au) * (1.0 - step(0.5, uYellow)) * mix(1.0, dash, step(2.5, cls));
          lane += (dbl + sgl) * cen * inner;
          paint = lane * jf;
          vec3 pc = mix(vec3(0.77, 0.755, 0.68), vec3(0.76, 0.42, 0.015), step(0.5, uYellow) * cen);
          paint *= 0.9 * (0.62 + 0.38 * n1.r) * (1.0 - 0.45 * smoothstep(0.72, 0.9, n3.r));
          col = mix(col, pc, paint);
        } else {
          paint = lane * jf * 0.9 * (0.62 + 0.38 * n1.r) * (1.0 - 0.45 * smoothstep(0.72, 0.9, n3.r));
          col = mix(col, vec3(0.77, 0.755, 0.68), paint);
        }
      }
    } else if (mode > 2.5) {
      float p = mode < 3.5 ? step(fract(u / 0.9 + 0.5), 0.5) : 1.0;
      float edge = smoothstep(hw, hw - 0.1, au);
      paint = p * edge * 0.9 * (0.65 + 0.35 * n1.r) * (1.0 - 0.4 * smoothstep(0.7, 0.9, n3.r));
      col = mix(col, vec3(0.77, 0.755, 0.68), paint);
    }
    rough = mix(0.9, 0.6, paint);
  }
  col *= mix(1.0, 0.52, uWet);
  rough = mix(rough, mix(0.42, 0.24, 0.5), uWet * (1.0 - paint * 0.6) * step(0.5, mode));
  col = mix(col, vec3(0.86, 0.89, 0.93), uSnow * 0.8);
  rRough = mix(rough, 0.92, uSnow * 0.8);
  diffuseColor.rgb = col;
}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rRough;');
    };
    this.mat = mat;
  }

  static dispose(m) { m.geometry.dispose(); }

  update(dt, cx, cz) {
    if (!this.index || !this.mat) return;
    this.mat.envMapIntensity = 0.06 + 0.2 * this.shared.uWet.value;
    this.clock += dt;
    if (this.clock < CHECK_EVERY && Math.hypot(cx - this.lastX, cz - this.lastZ) < 20) return;
    this.clock = 0; this.lastX = cx; this.lastZ = cz;
    const cs = this.cs, cells = this.index.cells;
    // drop far cells
    for (const [k, m] of this.cells) {
      const [i, j] = k.split('_').map(Number);
      const dx = Math.max(i * cs - cx, 0, cx - (i + 1) * cs), dz = Math.max(j * cs - cz, 0, cz - (j + 1) * cs);
      if (Math.hypot(dx, dz) > DROP_R) { if (m) { this.scene.remove(m); m.geometry.dispose(); } this.cells.delete(k); }
    }
    // build the nearest missing cell (one per check keeps frames cheap)
    let best = null, bd = 1e9;
    const i0 = Math.floor((cx - LOAD_R) / cs), i1 = Math.floor((cx + LOAD_R) / cs), j0 = Math.floor((cz - LOAD_R) / cs), j1 = Math.floor((cz + LOAD_R) / cs);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = `${i}_${j}`;
      if (this.cells.has(k)) continue;
      const dx = Math.max(i * cs - cx, 0, cx - (i + 1) * cs), dz = Math.max(j * cs - cz, 0, cz - (j + 1) * cs), d = Math.hypot(dx, dz);
      if (d > LOAD_R) continue;
      if (!cells[k]) { this.cells.set(k, null); continue; }
      if (d < bd) { bd = d; best = [k, i, j]; }
    }
    if (best) {
      const [k, i, j] = best, [off, len] = cells[k];
      const t0 = performance.now();
      const g = buildCell(this.bin, off, len, i * cs, j * cs);
      let m = null;
      if (g) {
        m = new THREE.Mesh(g, this.mat);
        m.position.set(i * cs, 0, j * cs);
        m.receiveShadow = true;
        m.renderOrder = 0;
        m.frustumCulled = true;
        this.scene.add(m);
      }
      this.cells.set(k, m);
      this.lastBuildMs = performance.now() - t0;
      this.maxBuildMs = Math.max(this.maxBuildMs, this.lastBuildMs);
      this.clock = CHECK_EVERY; // keep going next frame until everything near is built
    }
    let tris = 0, calls = 0;
    for (const m of this.cells.values()) if (m) { tris += m.geometry.userData.tris; calls++; }
    this.tris = tris; this.drawCalls = calls;
  }
}
