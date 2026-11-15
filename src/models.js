// Authored (photoscanned, CC0 Poly Haven) rocks and shrubs. Replaces procedural variants in place;
// any variant whose file fails to load stays procedural.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patch } from './assets.js';

const BASE = import.meta.env?.BASE_URL ?? '/';

// Warm Bryce palette applied to the (grey/brown) photoscan luminance, banded by height.
const ROCK_TINT = /* glsl */`
{
  float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float w = ldN(vOP * vec3(1.1, 0.5, 1.1) + 5.0) * 0.35;
  float b = fract(vOP.y * 2.2 * ROCK_BAND + w);
  // Claron limestone/siltstone: pale buff, pinkish grey, light grey; strata are subtle, not orange
  vec3 buff = vec3(0.50, 0.38, 0.27), pink = vec3(0.47, 0.33, 0.26), grey = vec3(0.45, 0.39, 0.33);
  vec3 c = mix(buff, pink, smoothstep(0.15, 0.45, b));
  c = mix(c, grey, smoothstep(0.5, 0.8, b));
  c = mix(c, buff, smoothstep(0.85, 1.0, b));
  float lich = smoothstep(0.6, 0.78, ldN(vOP * 7.0 + 3.0));
  c = mix(c, vec3(0.42, 0.40, 0.28), lich * 0.25);
  c *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.12, abs(b - 0.5) * 2.0 - 0.8)) ;
  float soil = 1.0 - smoothstep(0.0, 0.12, vOP.y);
  c = mix(c, vec3(0.30, 0.22, 0.15), soil * 0.6);
  vec3 tex = diffuseColor.rgb * vec3(1.1, 1.0, 0.9);
  diffuseColor.rgb = mix(tex, c * lum * ROCK_GAIN, 0.9);
}`;

function rockMaterial(src, shared, idx, cfg) {
  const m = new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap, roughness: 0.92, metalness: 0, side: cfg.double ? THREE.DoubleSide : THREE.FrontSide });
  patch(m, shared, { kind: 'arock' + idx, snowMode: 0, fade: true });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev(shader, r);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\n' + ROCK_TINT.replace('ROCK_BAND', cfg.band.toFixed(2)).replace('ROCK_GAIN', cfg.gain.toFixed(2)));
  };
  return m;
}

function shrubMaterial(src, shared, idx, cfg) {
  const m = new THREE.MeshStandardMaterial({
    map: src.map, normalMap: src.normalMap, roughness: 0.9, metalness: 0,
    ...(src.cut ? { alphaTest: 0.5, alphaToCoverage: true } : {}), side: THREE.DoubleSide,
  });
  m.color.setRGB(cfg.tint[0], cfg.tint[1], cfg.tint[2]);
  patch(m, shared, { kind: 'ashrub' + idx, fade: true, wind: true, flut: true, windH: cfg.h, windAmp: 0.4, noFlip: true, transl: true, snowMode: 1 });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev(shader, r);
    // desaturate towards luminance: pale sage versus rich olive
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      `#include <map_fragment>\ndiffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), diffuseColor.rgb, ${cfg.sat.toFixed(2)});`);
  };
  return m;
}

const ROCKS = [
  { flat: 0.55, file: 'rock0.glb', band: 1.0, gain: 5.0 },
  { flat: 0.5, file: 'rock1.glb', band: 0.8, gain: 5.0 },
  { flat: 0.45, file: 'rock2.glb', band: 1.2, gain: 5.0 },
];
const SHRUBS = [
  { file: 'shrub0.glb', h: 1.0, tint: [1.6, 1.5, 1.2], sat: 0.45 },
  { file: 'shrub1.glb', h: 1.35, tint: [0.8, 0.85, 0.5], sat: 1.0 },
];

function tune(tex, aniso, srgb) {
  if (!tex) return null;
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Group the gltf's meshes by material and merge each group into one geometry (one draw call per material).
function extract(gltf) {
  const groups = new Map();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!groups.has(o.material)) groups.set(o.material, []);
    groups.get(o.material).push(g);
  });
  const parts = [];
  for (const [mat, geos] of groups) {
    const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!geometry) throw new Error('merge failed');
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    parts.push({ geometry, mat });
  }
  if (!parts.length) throw new Error('no mesh');
  return parts;
}

export async function loadAuthoredModels(assets, renderer, shared) {
  const loader = new GLTFLoader();
  const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const load = async (list, target, make) => {
    await Promise.all(list.map(async (cfg, i) => {
      try {
        const gltf = await loader.loadAsync(BASE + 'models/' + cfg.file);
        const near = extract(gltf).map(({ geometry, mat }, k) => {
          if (cfg.flat) { // low, layered ledge proportions, sunk so the base never shows
            geometry.applyMatrix4(new THREE.Matrix4().makeScale(1, cfg.flat, 1));
            geometry.translate(0, -0.1 * cfg.flat, 0);
            geometry.computeBoundingBox(); geometry.computeBoundingSphere();
          }
          const src = { map: tune(mat.map, aniso, true), normalMap: tune(mat.normalMap, aniso, false), cut: mat.alphaTest > 0 || mat.alphaMode === 'MASK' || mat.transparent };
          if (!src.map) throw new Error('no albedo');
          return { geometry, material: make(src, shared, i + '_' + k, cfg) };
        });
        const height = Math.max(...near.map((p) => p.geometry.boundingBox.max.y));
        target[i] = { authored: true, near, far: null, height };
      } catch (e) {
        console.error('authored model failed, keeping procedural:', cfg.file, e?.message || e);
      }
    }));
  };
  await Promise.all([load(ROCKS, assets.rock, rockMaterial), load(SHRUBS, assets.shrub, shrubMaterial)]);
  return assets;
}
