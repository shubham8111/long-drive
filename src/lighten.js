// Making a detailed model cheaper to draw: every part that never moves on its own is merged into one mesh
// per material (one draw call each instead of one per part). Plus the draw order for cut-out surfaces.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// a non-indexed geometry's triangles sorted into zones by their own bounds: zone -> geometry
const _zb = new THREE.Box3(), _zv = new THREE.Vector3();
function splitByZone(g, zoneOf) {
  const P = g.attributes.position, tri = new Map();
  for (let t = 0; t < P.count; t += 3) {
    _zb.makeEmpty();
    for (let k = 0; k < 3; k++) _zb.expandByPoint(_zv.fromBufferAttribute(P, t + k));
    const z = zoneOf(_zb);
    (tri.get(z) || tri.set(z, []).get(z)).push(t);
  }
  const out = new Map();
  for (const [zone, starts] of tri) {
    if (tri.size === 1) { out.set(zone, g); break; }
    const sub = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const w = attr.itemSize, dst = new Float32Array(starts.length * 3 * w);
      starts.forEach((t, k) => dst.set(attr.array.subarray(t * w, (t + 3) * w), k * 3 * w));
      sub.setAttribute(name, new THREE.BufferAttribute(dst, w));
    }
    out.set(zone, sub);
  }
  return out;
}

// root: the node the merged meshes are attached to (they move with it); keep: nodes that move on their
// own (their whole subtree is left alone); zoneOf (optional): triangles are split into zones by their bounds
// Returns how many meshes went in and came out, and the meshes made per zone.
export function mergeStatic(root, keep = [], zoneOf = null) {
  const keepSet = new Set(keep.filter(Boolean));
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const walk = (o) => {
    if (keepSet.has(o)) return;
    for (const c of [...o.children]) walk(c);
    if (o === root || !o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.visible) return;
    if (o.name.startsWith('merged')) return; // (already merged, e.g. by colour: its vertex colours must stay)
    const g = o.geometry;
    if (!g?.attributes?.position || g.morphAttributes?.position) return;
    const key = o.material.uuid + '|' + o.layers.mask;
    (byMat.get(key) || byMat.set(key, { mat: o.material, layers: o.layers.mask, list: [] }).get(key)).list.push(o);
  };
  walk(root);
  let before = 0, after = 0;
  const zones = {};
  for (const { mat, layers, list } of byMat.values()) {
    if (list.length < 2 && !zoneOf) continue;
    const geos = list.map((o) => {
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      g.groups = [];
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    for (const [zone, g] of zoneOf ? splitByZone(merged, zoneOf) : new Map([['', merged]])) {
      const m = new THREE.Mesh(mergeVertices(g, 1e-5), mat);
      if (g !== merged) g.dispose();
      m.layers.mask = layers;
      m.name = 'merged' + (zone ? '-' + zone : ''); m.frustumCulled = true;
      root.add(m);
      (zones[zone] ||= []).push(m);
      after++;
    }
    merged.dispose();
    for (const o of list) o.parent?.remove(o);
    before += list.length;
  }
  return { before, after, zones };
}

// draw order: cut-out surfaces (alpha-tested leaves, far tree cards) after everything solid, so the depth
// test has already thrown away what they would have covered
export function drawOrder(root) {
  root.traverse((o) => {
    const m = o.material;
    if (!m || Array.isArray(m) || o.renderOrder) return;
    const key = m.customProgramCacheKey?.() || '';
    if (m.alphaTest > 0 || key.includes('pfar')) o.renderOrder = 1;
  });
}
