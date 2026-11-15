import * as THREE from 'three';
import { createGroundTextures } from './ground.js';
import { lon2tx, lat2ty, tx2lon, ty2lat, smoothstep } from './geo.js';

const N_FULL = 64; // quads per tile side
import { MIN_Z, MAX_Z, ELEV_MAX_Z, SPLIT, PLAN_LINES, VIEW_RANGE, wantSplit } from './tiles.js'; // the tile rule, shared with the build scripts
import { tileUrl } from './paths.js';
const MAX_ACTIVE = 10;

async function loadBitmap(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

class ElevStore {
  constructor() {
    this.cache = new Map();
    this.max = 220; // entries kept before old ones (unused for a minute) are let go
    this.canvas = new OffscreenCanvas(256, 256);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }
  get(z, x, y) {
    const k = `${z}/${x}/${y}`;
    let e = this.cache.get(k);
    if (!e) {
      e = { used: 0, data: null };
      e.promise = loadBitmap(tileUrl('elev', z, x, y)).then((bmp) => {
        this.ctx.drawImage(bmp, 0, 0);
        bmp.close();
        const px = this.ctx.getImageData(0, 0, 256, 256).data;
        const out = new Float32Array(65536);
        for (let i = 0; i < 65536; i++) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        e.data = out;
        return out;
      });
      e.promise.catch(() => this.cache.delete(k));
      this.cache.set(k, e);
    }
    e.used = performance.now();
    return e.promise;
  }
  prune() {
    if (this.cache.size < this.max) return;
    const now = performance.now(), idle = this.max < 150 ? 15000 : 60000;
    for (const [k, e] of this.cache) if (now - e.used > idle) this.cache.delete(k);
  }
}

function bilinear(d, px, py) {
  px = Math.min(255, Math.max(0, px));
  py = Math.min(255, Math.max(0, py));
  const x0 = px | 0, y0 = py | 0;
  const x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1);
  const ax = px - x0, ay = py - y0;
  return (
    (d[y0 * 256 + x0] * (1 - ax) + d[y0 * 256 + x1] * ax) * (1 - ay) +
    (d[y1 * 256 + x0] * (1 - ax) + d[y1 * 256 + x1] * ax) * ay
  );
}

class Tile {
  constructor(z, x, y, geo) {
    this.z = z; this.x = x; this.y = y;
    this.x0 = geo.x(tx2lon(x, z));
    this.x1 = geo.x(tx2lon(x + 1, z));
    this.z0 = geo.z(ty2lat(y, z)); // north edge
    this.z1 = geo.z(ty2lat(y + 1, z)); // south edge
    this.size = this.x1 - this.x0;
    this.children = null;
    this.state = 0; // 0 idle, 1 loading, 2 ready
    this.mesh = null;
    this.used = 0;
    this.retryAt = 0;
  }
  dist(cx, cz) {
    const dx = Math.max(this.x0 - cx, 0, cx - this.x1);
    const dz = Math.max(this.z0 - cz, 0, cz - this.z1);
    return Math.hypot(dx, dz);
  }
}

export class Terrain {
  constructor(scene, geo, route, renderer, shared) {
    this.scene = scene;
    this.geo = geo;
    this.route = route;
    this.shared = shared;
    this.elev = new ElevStore();
    this.roots = new Map();
    this.pending = new Set();
    this.active = 0;
    this.shown = new Set();
    // 4x anisotropic filtering: 16x costs several times more per pixel at the grazing angles a road view is full of
    this.maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    this.readyCount = 0;
    this.onTileReady = null; // (tile, imageCanvas) hook, used for vegetation
    this.onTileGone = null;
    this.lastPrune = 0;
    this.renderer = renderer;
    this.uploadQ = []; // finished tiles wait here: their textures go to the GPU a couple per frame, never in a burst
    this.uploadsPerFrame = 8;
    this.visDist = Infinity; // nothing further than the fog lets you see is drawn at all
    this.split = SPLIT; // lower = fewer, coarser tiles in the middle distance (less GPU memory)
    this.n = N_FULL; // quads per tile side: fine relief on the laptop
    this.texSize = 512; // ground imagery texture per tile, px
    this.lines = PLAN_LINES; // picture height of the graphics mode: sharper imagery only where it can show

    // shared detail noise so the ground stays crisp right next to you
    const S = 256, d = new Uint8Array(S * S);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < d.length; i++) d[i] = 90 + rnd() * 165;
    const noise = new THREE.DataTexture(d, S, S, THREE.RedFormat);
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
    noise.minFilter = THREE.LinearMipmapLinearFilter;
    noise.magFilter = THREE.LinearFilter;
    noise.generateMipmaps = true;
    noise.needsUpdate = true;
    this.uNoise = { value: noise };
    const gt = createGroundTextures(this.maxAniso);
    this.uGAlb = { value: gt.albedo };
    this.uGNor = { value: gt.normal };
    this.uGMean = { value: gt.mean };
  }

  material(map) {
    const m = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
    const shared = this.shared, uNoise = this.uNoise, uGAlb = this.uGAlb, uGNor = this.uGNor, uGMean = this.uGMean;
    const dbg = new URLSearchParams(location.search).get('gdbg');
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNoise = uNoise;
      sh.uniforms.uGAlb = uGAlb;
      sh.uniforms.uGNor = uGNor;
      sh.uniforms.uGMean = uGMean;
      sh.uniforms.uWet = shared.uWet;
      sh.uniforms.uSnow = shared.uSnow;
      sh.uniforms.uGD = shared.uGroundDist;
      sh.uniforms.uPaved = shared.uPaved;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying float vNy; attribute float aSkirt; varying float vSkirt;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vNy = normal.y; vSkirt = aSkirt;`
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vWPos; varying float vNy; varying float vSkirt; uniform sampler2D uNoise; uniform float uWet; uniform float uSnow; uniform float uGD; uniform float uPaved;
uniform highp sampler2DArray uGAlb; uniform highp sampler2DArray uGNor; uniform vec3 uGMean[3];
float gRough = 1.0; vec2 gN = vec2(0.0); float gSnow = 0.0;
const float GSC[3] = float[3](0.40, 0.34, 0.31);
const float GTINT[3] = float[3](0.80, 0.30, 0.50);
// one detail layer: returns ground colour, accumulates normal + roughness
vec3 gLayer(int L, float w, vec2 wxz, vec2 gx, vec2 gy, float mixk, float lowLum, vec3 low, inout vec2 nrm, inout float rgh) {
  float s = GSC[L];
  vec2 p1 = wxz * s, p2 = mat2(0.8, 0.6, -0.6, 0.8) * wxz * s * 0.77 + 0.31;
  mat2 R = mat2(0.8, 0.6, -0.6, 0.8);
  vec2 g1x = gx * s, g1y = gy * s, g2x = R * gx * s * 0.77, g2y = R * gy * s * 0.77;
  vec4 a1 = textureGrad(uGAlb, vec3(p1, float(L)), g1x, g1y);
  vec4 a2 = textureGrad(uGAlb, vec3(p2, float(L)), g2x, g2y);
  vec4 n1 = textureGrad(uGNor, vec3(p1, float(L)), g1x, g1y);
  vec4 n2 = textureGrad(uGNor, vec3(p2, float(L)), g2x, g2y);
  vec3 a = mix(a1.rgb, a2.rgb, mixk);
  vec2 n = mix(n1.xy, n2.xy, mixk) * 2.0 - 1.0;
  n = vec2(n.x, n.y) ;
  vec2 n2d = (n2.xy * 2.0 - 1.0);
  n = mix(n1.xy * 2.0 - 1.0, n2d * R, mixk); // second sample is rotated: rotate its slope vector back
  vec3 mean = uGMean[L];
  float ml = dot(mean, vec3(0.2126, 0.7152, 0.0722));
  vec3 base = mix(mean * clamp(lowLum / ml, 0.25, 3.0), low, GTINT[L]);
  vec3 ratio = a / mean;
  float rl = dot(ratio, vec3(0.2126, 0.7152, 0.0722));
  nrm += n * w;
  rgh += mix(n1.a, n2.a, mixk) * w;
  return base * mix(vec3(rl), ratio, 0.7) * w;
}`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           float dcam = distance(vWPos, cameraPosition);
           float n1 = texture2D(uNoise, vWPos.xz * 0.9).r;
           float n2 = texture2D(uNoise, vWPos.xz * 0.11 + 0.37).r;
           float n3 = texture2D(uNoise, vWPos.xz * 0.013).r;
           if (uPaved > 0.5) {
             // cities: aerial photos of streets are full of leaning facades, shadows and parked cars, so
             // everything that is not greenery becomes clean paving; parks and trees keep their photo
             vec3 ph = diffuseColor.rgb;
             float plum = dot(ph, vec3(0.2126, 0.7152, 0.0722));
             float green = smoothstep(0.004, 0.03, ph.g - 0.5 * (ph.r + ph.b)) * smoothstep(0.5, 0.25, plum);
             float slab = 0.9 + 0.2 * step(0.5, fract(vWPos.x * 0.07 + n3)) * 0.3 + (n2 - 0.6) * 0.25;
             vec3 pave = vec3(0.155, 0.152, 0.148) * slab * (0.75 + 0.5 * clamp(plum * 2.5, 0.0, 1.0));
             diffuseColor.rgb = mix(pave, ph, green);
           }
           float gfade = 1.0 - smoothstep(uGD * 0.35, max(uGD, 0.01), dcam); // uGD: how far the close-up ground detail reaches
           vec3 sat = diffuseColor.rgb;
           float farK = 1.0 - smoothstep(8.0, 110.0, dcam);
           sat *= mix(1.0, (n1 * 0.55 + n2 * 0.75) * 1.02, farK * 0.5);
           if (gfade > 0.002) {
             vec3 low = textureLod(map, vMapUv, 3.0).rgb;
             float lum = dot(low, vec3(0.2126, 0.7152, 0.0722));
             float warm = (low.r - low.b) / (low.r + low.b + 0.02);
             float green = low.g - 0.5 * (low.r + low.b);
             float wF = smoothstep(0.07, 0.03, lum) + smoothstep(0.0, 0.015, green) * smoothstep(0.10, 0.05, lum);
             float wS = smoothstep(0.18, 0.34, lum) * smoothstep(0.08, 0.20, warm);
             wS += smoothstep(0.80, 0.55, vNy) * 0.5;
             float wG = 0.15 + smoothstep(0.03, 0.10, lum) * smoothstep(0.30, 0.18, lum);
             wF = clamp(wF, 0.0, 1.0);
             vec3 wt = vec3(wS, wF, wG); wt = wt * wt;
             wt /= (wt.x + wt.y + wt.z);
             vec2 gx = dFdx(vWPos.xz), gy = dFdy(vWPos.xz);
             float mk = smoothstep(0.3, 0.7, texture2D(uNoise, vWPos.xz * 0.045 + 0.11).r * 0.5 + texture2D(uNoise, vWPos.xz * 0.19).r * 0.5);
             vec3 col = vec3(0.0); vec2 nrm = vec2(0.0); float rgh = 0.0;
             if (wt.x > 0.03) col += gLayer(0, wt.x, vWPos.xz, gx, gy, mk, lum, low, nrm, rgh);
             if (wt.y > 0.03) col += gLayer(1, wt.y, vWPos.xz, gx, gy, mk, lum, low, nrm, rgh);
             if (wt.z > 0.03) col += gLayer(2, wt.z, vWPos.xz, gx, gy, mk, lum, low, nrm, rgh);
             float tot = max(wt.x * step(0.03, wt.x) + wt.y * step(0.03, wt.y) + wt.z * step(0.03, wt.z), 0.001);
             col /= tot; nrm /= tot; rgh /= tot;
             vec3 hf = mix(vec3(1.0), clamp(sat / max(low, 0.01), 0.6, 1.6), 0.45);
             col *= hf * (0.85 + 0.3 * n2);
             diffuseColor.rgb = mix(sat, col, gfade);
             float nf = 1.0 - smoothstep(uGD * 0.2, max(uGD * 0.82, 0.01), dcam);
             gN = nrm * nf * 0.9;
             gRough = mix(1.0, rgh, gfade);
             ${dbg ? 'diffuseColor.rgb = wt;' : ''}
           }
           diffuseColor.rgb *= mix(1.0, 0.6, uWet);
           float snowMask = smoothstep(0.55, 0.9, vNy + (n2 - 0.6) * 0.25) * smoothstep(0.15, 0.75, uSnow + (n3 - 0.6) * 0.5 * (1.0 - uSnow) * step(0.01, uSnow));
           snowMask *= min(1.0, uSnow * 1.5);
           gSnow = snowMask;
           vec3 snowCol = vec3(0.90, 0.93, 0.97) * (0.94 + 0.1 * n1);
           diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, snowMask);`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
           roughnessFactor = mix(gRough, 0.9, gSnow);
           roughnessFactor = mix(roughnessFactor, 0.55 + 0.3 * gSnow, uWet * 0.7);`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
           {
             vec3 wN = inverseTransformDirection(normal, viewMatrix);
             wN = normalize(wN + vec3(gN.x, 0.0, gN.y) * (1.0 - 0.85 * gSnow) * (1.0 - 0.35 * uWet));
             normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
           }`
        );
    };
    m.customProgramCacheKey = () => 'terrain';
    return m;
  }

  request(t) {
    if (t.state === 0 && performance.now() >= t.retryAt) this.pending.add(t);
  }

  async load(t) {
    t.state = 1;
    this.active++;
    try {
      const ze = Math.min(t.z, ELEV_MAX_Z), sh = t.z - ze;
      const iz = t.z + 1;
      const [elev, ...imgs] = await Promise.all([
        this.elev.get(ze, t.x >> sh, t.y >> sh),
        loadBitmap(tileUrl('img', iz, t.x * 2, t.y * 2)),
        loadBitmap(tileUrl('img', iz, t.x * 2 + 1, t.y * 2)),
        loadBitmap(tileUrl('img', iz, t.x * 2, t.y * 2 + 1)),
        loadBitmap(tileUrl('img', iz, t.x * 2 + 1, t.y * 2 + 1)),
      ]);
      if (t.dead) return;
      const canvas = document.createElement('canvas');
      const S = this.texSize, h = S / 2;
      canvas.width = canvas.height = S;
      const g = canvas.getContext('2d');
      imgs.forEach((b, i) => { g.drawImage(b, (i & 1) * h, (i >> 1) * h, h, h); b.close(); });
      const tex = new THREE.CanvasTexture(canvas);
      // free the CPU copy once the GPU has it (halves RAM use for terrain imagery)
      if (!this.onTileReady) tex.onUpdate = () => { tex.onUpdate = null; canvas.width = canvas.height = 1; };
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.maxAniso;
      this.finishTile(t, elev, sh, tex);
      if (this.onTileReady) this.onTileReady(t, g);
    } catch (e) {
      t.state = 0;
      t.retryAt = performance.now() + 4000;
    } finally {
      this.active--;
    }
  }

  finishTile(t, elev, sh, tex) {
    t.mesh = new THREE.Mesh(this.buildGeometry(t, elev, sh), this.material(tex));
    t.mesh.position.set((t.x0 + t.x1) / 2, 0, (t.z0 + t.z1) / 2);
    t.mesh.matrixAutoUpdate = false;
    t.mesh.updateMatrix();
    t.mesh.visible = false;
    t.mesh.receiveShadow = true;
    this.scene.add(t.mesh);
    t.tex = tex;
    this.uploadQ.push(t); // becomes "ready" in update(), once its texture is on the GPU
  }

  buildGeometry(t, elev, sh) {
    const geo = this.geo, route = this.route;
    const N = (t.n = this.n);
    const V = N + 1, R = N + 3; // R: grid including skirt ring
    const H = new Float32Array(V * V), X = new Float32Array(V), Z = new Float32Array(V);
    const lonW = tx2lon(t.x, t.z), lonE = tx2lon(t.x + 1, t.z);
    const cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
    const scale = 1 / (1 << sh), ex = t.x >> sh, ey = t.y >> sh;
    for (let i = 0; i < V; i++) {
      X[i] = geo.x(lonW + ((lonE - lonW) * i) / N);
      Z[i] = geo.z(ty2lat(t.y + i / N, t.z));
    }
    const step = t.size / N;
    const flatten = t.z >= 13 && route.touches(t.x0, t.z0, t.x1, t.z1, 40);
    const floor = route.paved && t.z >= 12 && route.touches(t.x0, t.z0, t.x1, t.z1, 270);
    const rIn = Math.max(route.road.half + 0.6, step * 0.8), rOut = Math.min(62, rIn * 2.2 + 5);
    for (let j = 0; j < V; j++) {
      const py = ((t.y + j / N) * scale - ey) * 256 - 0.5;
      for (let i = 0; i < V; i++) {
        const px = ((t.x + i / N) * scale - ex) * 256 - 0.5;
        let h = bilinear(elev, px, py);
        if (floor) h = route.cityGround(X[i], Z[j], h);
        if (flatten) {
          const d = route.nearest(X[i], Z[j], rOut);
          if (d >= 0) h += (route.nearY - 0.1 - h) * (1 - smoothstep(rIn, rOut, d));
        }
        H[j * V + i] = h;
      }
    }
    const pos = new Float32Array(R * R * 3), nor = new Float32Array(R * R * 3), uv = new Float32Array(R * R * 2), sk = new Float32Array(R * R);
    const skirt = Math.max(4, t.size * 0.06);
    const dz = Math.abs(t.z1 - t.z0) / N;
    for (let j = 0; j < R; j++) {
      const jj = Math.min(N, Math.max(0, j - 1));
      for (let i = 0; i < R; i++) {
        const ii = Math.min(N, Math.max(0, i - 1));
        const edge = i === 0 || j === 0 || i === R - 1 || j === R - 1;
        const k = j * R + i;
        pos[k * 3] = X[ii] - cx;
        pos[k * 3 + 1] = H[jj * V + ii] - (edge ? skirt : 0);
        sk[k] = edge ? 1 : 0;
        pos[k * 3 + 2] = Z[jj] - cz;
        const hl = H[jj * V + Math.max(0, ii - 1)], hr = H[jj * V + Math.min(N, ii + 1)];
        const hu = H[Math.max(0, jj - 1) * V + ii], hd = H[Math.min(N, jj + 1) * V + ii];
        const sx = (ii === 0 || ii === N ? 1 : 2) * step, sz = (jj === 0 || jj === N ? 1 : 2) * dz;
        let nx = -(hr - hl) / sx, nz = -(hd - hu) / sz;
        const l = Math.hypot(nx, 1, nz);
        nor[k * 3] = nx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = nz / l;
        uv[k * 2] = ii / N;
        uv[k * 2 + 1] = 1 - jj / N;
      }
    }
    const idx = new Uint16Array((R - 1) * (R - 1) * 6);
    let q = 0;
    for (let j = 0; j < R - 1; j++)
      for (let i = 0; i < R - 1; i++) {
        const a = j * R + i, b = a + 1, c = a + R, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aSkirt', new THREE.BufferAttribute(sk, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    t.heights = t.z >= 16 ? H : null;
    return g;
  }

  dispose(t) {
    t.dead = true;
    this.pending.delete(t);
    if (t.mesh) {
      if (this.onTileGone) this.onTileGone(t);
      this.scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.map.dispose();
      t.mesh.material.dispose();
      t.mesh = null;
      if (t.state === 2) this.readyCount--;
    }
    this.shown.delete(t);
    if (t.children) t.children.forEach((c) => this.dispose(c));
    t.children = null;
  }

  visit(t, cx, cz, now, show) {
    t.used = now;
    const want = wantSplit(t.z, t.size, t.dist(cx, cz), Math.min(this.split, SPLIT), this.geo.lat0, Math.min(this.lines, PLAN_LINES));
    if (want) {
      if (!t.children) {
        const z = t.z + 1, x = t.x * 2, y = t.y * 2;
        t.children = [
          new Tile(z, x, y, this.geo), new Tile(z, x + 1, y, this.geo),
          new Tile(z, x, y + 1, this.geo), new Tile(z, x + 1, y + 1, this.geo),
        ];
      }
      let ready = true;
      for (const c of t.children) if (c.state !== 2) ready = false;
      if (ready) {
        for (const c of t.children) this.visit(c, cx, cz, now, show);
        return;
      }
      if (t.state === 2) for (const c of t.children) { c.used = now; this.request(c); }
    }
    if (t.state === 2) show.add(t);
    else this.request(t);
  }

  prune(t, now) {
    if (!t.children) return;
    let recent = false;
    for (const c of t.children) if (now - c.used < 12000) recent = true;
    if (!recent) {
      t.children.forEach((c) => this.dispose(c));
      t.children = null;
    } else t.children.forEach((c) => this.prune(c, now));
  }

  update(cx, cz) {
    const now = performance.now();
    const lon = this.geo.lon(cx), lat = this.geo.lat(cz);
    const rx = Math.floor(lon2tx(lon, MIN_Z)), ry = Math.floor(lat2ty(lat, MIN_Z));
    // texture uploads, spread over frames (a burst of them is what makes streaming stutter)
    for (let k = 0; k < this.uploadsPerFrame && this.uploadQ.length; ) {
      const t = this.uploadQ.shift();
      if (t.dead || !t.mesh) continue;
      try { this.renderer.initTexture(t.tex); } catch (e) { /* uploads at first draw instead */ }
      t.state = 2;
      this.readyCount++;
      k++;
    }
    const show = new Set();
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) {
        const k = `${rx + dx}/${ry + dy}`;
        let t = this.roots.get(k);
        if (!t) {
          t = new Tile(MIN_Z, rx + dx, ry + dy, this.geo);
          if (t.dist(cx, cz) > VIEW_RANGE) continue; // beyond the haze of the clearest day
          this.roots.set(k, t);
        } else if (t.dist(cx, cz) > VIEW_RANGE * 1.1) continue; // (a little slack, so a root at the edge doesn't flicker in and out)
        this.visit(t, cx, cz, now, show);
      }
    for (const t of this.shown) if (!show.has(t) && t.mesh) t.mesh.visible = false;
    const vis = this.visDist;
    for (const t of show) t.mesh.visible = vis === Infinity || t.dist(cx, cz) < vis;
    this.shown = show;

    // start loads: coarse first, then nearest
    if (this.pending.size && this.active < MAX_ACTIVE) {
      const list = [...this.pending].filter((t) => !t.dead && t.state === 0);
      list.sort((a, b) => a.z - b.z || a.dist(cx, cz) - b.dist(cx, cz));
      this.pending.clear();
      for (const t of list) {
        if (this.active < MAX_ACTIVE && now - t.used < 2000) this.load(t);
        else if (now - t.used < 2000) this.pending.add(t);
      }
    }

    if (now - this.lastPrune > 4000) {
      this.lastPrune = now;
      for (const [k, t] of this.roots) {
        if (now - t.used > 30000) { this.dispose(t); this.roots.delete(k); }
        else this.prune(t, now);
      }
      this.elev.prune();
    }
  }

  // Ground height at a world position, from the finest loaded tile there (null if nothing detailed is
  // loaded yet). Used to stand animals, people and props on the land away from the road.
  heightAt(x, z) {
    let best = null;
    for (const t of this.shown) {
      if (!t.heights || x < t.x0 || x > t.x1 || z < t.z0 || z > t.z1) continue;
      if (!best || t.z > best.z) best = t;
    }
    if (!best) return null;
    this.lastZ = best.z; // zoom of the tile the answer came from (callers can re-ask once a finer one is in)
    const N = best.n, V = N + 1, H = best.heights;
    const fx = Math.min(N - 1e-4, Math.max(0, ((x - best.x0) / (best.x1 - best.x0)) * N));
    const fz = Math.min(N - 1e-4, Math.max(0, ((z - best.z0) / (best.z1 - best.z0)) * N));
    const i = fx | 0, j = fz | 0, ax = fx - i, az = fz - j;
    return (H[j * V + i] * (1 - ax) + H[j * V + i + 1] * ax) * (1 - az) + (H[(j + 1) * V + i] * (1 - ax) + H[(j + 1) * V + i + 1] * ax) * az;
  }

  // true once the finest tiles under the camera are in
  settled(cx, cz) {
    for (const t of this.shown) if (t.z === MAX_Z && t.dist(cx, cz) === 0) return true;
    return false;
  }
  get busy() { return this.active + this.pending.size + this.uploadQ.length; }
}
