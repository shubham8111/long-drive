import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Fewer draw calls for a model built from many small parts: leaf meshes that share a parent and a
// material (and shadow flags / draw order) are baked into one mesh. Parts that move on their own are
// groups or meshes listed in `keep`, and are left alone (their children are merged among themselves).
// Every draw call costs the CPU ~10-15 µs in the browser, and a model is drawn twice a frame (picture
// and shadow), so a 180-part car is worth ~4 ms a frame on its own.
export function mergeStatic(root, keep = new Set()) {
  let before = 0, after = 0;
  const parents = [];
  root.traverse((o) => { if (o.children.length) parents.push(o); });
  for (const parent of parents) {
    const groups = new Map();
    for (const m of parent.children) {
      if (!m.isMesh || m.isSkinnedMesh || m.isInstancedMesh || keep.has(m) || m.children.length || Array.isArray(m.material) || !m.visible) continue;
      before++;
      const g = m.geometry, sig = Object.keys(g.attributes).filter((k) => k !== 'uv1' && k !== 'uv2').sort().join(',');
      const k = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}|${m.layers.mask}|${sig}`;
      (groups.get(k) || groups.set(k, []).get(k)).push(m);
    }
    for (const list of groups.values()) {
      if (list.length < 2) { after += list.length; continue; }
      const geos = list.map((m) => {
        m.updateMatrix();
        let g = m.geometry.clone();
        for (const n of Object.keys(g.attributes)) if (n === 'uv1' || n === 'uv2') g.deleteAttribute(n);
        if (!g.index) g = g.toNonIndexed().setIndex([...Array(g.attributes.position.count).keys()]);
        g.morphAttributes = {};
        g.clearGroups();
        return g.applyMatrix4(m.matrix);
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) { after += list.length; continue; }
      merged.computeBoundingSphere();
      const first = list[0], mm = new THREE.Mesh(merged, first.material);
      mm.castShadow = first.castShadow; mm.receiveShadow = first.receiveShadow; mm.renderOrder = first.renderOrder;
      mm.layers.mask = first.layers.mask; mm.frustumCulled = list.every((m) => m.frustumCulled);
      for (const m of list) parent.remove(m);
      parent.add(mm);
      after++;
    }
  }
  return { before, after };
}

// every Object3D a refs object points at (directly or in arrays), so mergeStatic leaves them alone
export function refsOf(refs) {
  const keep = new Set();
  for (const v of Object.values(refs)) for (const o of [].concat(v)) if (o?.isObject3D) keep.add(o);
  return keep;
}
