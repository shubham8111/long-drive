// Helpers shared by the place landmarks (src/landmarks/*.js).
//
// A landmark is an "ambient, local surprise" (see src/surprises.js): the scheduler creates it once the
// place is loaded and disposes it when the drive moves to another place. Contract:
//   export const MY_LANDMARK = {
//     id: 'unique-id', kind: 'ambient', local: true, cooldown: 1,
//     possible: (ctx) => ctx.place?.id === 'manhattan' && !!ctx.world && !!ctx.geo,
//     chance: () => 1,
//     create(ctx) { ...build a THREE.Group, ctx.world.add(group)...
//       return { update(dt, ctx) { ...; return true; },   // false would end it (never, for a landmark)
//                dispose() { group.removeFromParent(); dispose geometries/materials/textures } }; },
//   };
// ctx (refreshed every frame): geo (lat/lon <-> local metres), terrain (heightAt), route, world (the
// place's THREE.Group), camera, night (0 day .. 1 night), hours (0..24), w (weather: rain, snow, wet,
// cover 0..1), shared (shader uniforms: uNight, uWet, uSnow, uTime), renderer, speed, s, dir.
//
// Coordinates: metres, x = east, z = SOUTH (geo.z(lat) grows southwards), y = up. Real Manhattan
// streets run ~29 degrees clockwise from true north (see AVENUE_DIR).
import * as THREE from 'three';

// unit vector (x, z) pointing up an avenue (north-north-east), in local coordinates
export const AVENUE_DIR = (() => { const a = (29 * Math.PI) / 180; return { x: Math.sin(a), z: -Math.cos(a) }; })();
// unit vector (x, z) pointing along a cross street towards the East River (east-south-east)
export const STREET_DIR = { x: -AVENUE_DIR.z, z: AVENUE_DIR.x };

// local position of lat/lon on the ground (terrain height there, or the road's if the terrain is not loaded)
export function at(ctx, lat, lon, out = new THREE.Vector3()) {
  const x = ctx.geo.x(lon), z = ctx.geo.z(lat);
  let y = ctx.terrain?.heightAt ? ctx.terrain.heightAt(x, z) : NaN;
  if (!Number.isFinite(y)) { ctx.route?.nearestWide?.(x, z, 400); y = ctx.route?.nearY ?? 10; }
  return out.set(x, y, z);
}

// yaw (radians, for object.rotation.y) that turns an object's local -Z axis to face the direction (dx, dz)
export function yawFacing(dx, dz) { return Math.atan2(-dx, -dz); }

// route distance s (metres) of the point on the route closest to (x, z), scanning every `step` metres
export function nearestS(route, x, z, step = 4) {
  let best = 0, bd = Infinity; const P = {};
  for (let s = 0; s <= route.length; s += step) { route.sample(s, P); const d = (P.x - x) ** 2 + (P.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
  return best;
}

// Distance from the road centre line, at route position s, to the first building facade on one side
// (side +1 = right of the route's own direction, -1 = left), or null if no building tile is loaded there.
// Building tiles are meshes in ctx.world with userData.tris.
const _rc = new THREE.Raycaster(), _o = new THREE.Vector3(), _d = new THREE.Vector3();
export function facadeDistance(ctx, s, side, height = 6, maxR = 45) {
  const P = ctx.route.sample(s, {});
  const nx = -P.tz * side, nz = P.tx * side; // right-hand normal for side +1
  _o.set(P.x, P.y + height, P.z); _d.set(nx, 0, nz);
  _rc.set(_o, _d); _rc.far = maxR;
  const meshes = []; ctx.world.traverse((o) => { if (o.isMesh && o.userData?.tris) meshes.push(o); });
  const hit = _rc.intersectObjects(meshes, false)[0];
  return hit ? hit.distance : null;
}

// Hide the OpenStreetMap building blocks within radius r of (x, z) (when a landmark replaces them). Tiles
// stream in later, so call it again now and then (e.g. every 2 s from update); returns an undo function.
export function hideBuildingsNear(ctx, x, z, r) {
  const cut = [];
  ctx.world.traverse((m) => {
    if (!m.isMesh || !m.userData?.tris || !m.geometry.index) return;
    const g = m.geometry, pos = g.attributes.position, idx = g.index.array, R2 = r * r;
    const px = m.position.x, pz = m.position.z;
    const key = `_hid_${Math.round(x)}_${Math.round(z)}`;
    if (m.userData[key]) return;
    m.userData[key] = true;
    const saved = [];
    for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k];
      const dx = pos.getX(a) + px - x, dz = pos.getZ(a) + pz - z;
      if (dx * dx + dz * dz < R2) { saved.push(k, idx[k], idx[k + 1], idx[k + 2]); idx[k] = idx[k + 1] = idx[k + 2] = 0; }
    }
    if (saved.length) { g.index.needsUpdate = true; cut.push([m, g, saved, key]); }
  });
  return () => { for (const [m, g, saved, key] of cut) { const idx = g.index.array; for (let i = 0; i < saved.length; i += 4) { idx[saved[i]] = saved[i + 1]; idx[saved[i] + 1] = saved[i + 2]; idx[saved[i] + 2] = saved[i + 3]; } g.index.needsUpdate = true; delete m.userData[key]; } };
}
