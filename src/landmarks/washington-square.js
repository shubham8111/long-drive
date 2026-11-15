// Washington Square Park: the marble arch across Fifth Avenue (with two statue groups and floodlights),
// the round fountain and the Garibaldi statue. Everything is procedural and merged to one mesh per material.
// Each build* function returns geometry in its own local frame (metres, y up) so it can be tested alone.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { at, yawFacing, hideBuildingsNear, AVENUE_DIR } from './common.js';

const ARCH = { lat: 40.73122, lon: -73.997088 }; // (where OpenStreetMap has it: its block there is hidden and replaced)
const FOUNTAIN = { lat: 40.73082, lon: -73.99742 };
const GARIBALDI = { lat: 40.73095, lon: -73.99667 };

const MARBLE_COLOR = 0xe8e4da;
const NIGHT_EMISSIVE = new THREE.Color(0x3a3428);

// ---- geometry helpers: each returns a BufferGeometry already positioned ----
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (rt, rb, h, x, y, z, seg = 14) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z);
const sph = (r, x, y, z) => new THREE.SphereGeometry(r, 16, 12).translate(x, y, z);
// all inputs share position/normal/uv; indexed ones are expanded so the attribute layouts match
const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);

// Stylised standing figure, origin at its feet, facing +Z. H is its height (4.2 m is the central figure).
// gesture: 'war' (sword arm raised), 'peace' (arm forward with a branch), otherwise both arms down.
function figure(H, gesture) {
  const k = H / 4.2, p = [];
  p.push(cyl(0.4 * k, 0.58 * k, 2.2 * k, 0, 1.1 * k, 0));    // cloak / legs, tapered
  p.push(box(0.72 * k, 1.2 * k, 0.5 * k, 0, 2.8 * k, 0));    // torso
  p.push(cyl(0.14 * k, 0.14 * k, 0.35 * k, 0, 3.58 * k, 0));  // neck
  p.push(sph(0.25 * k, 0, 3.95 * k, 0));                     // head, top at H
  const arm = (x, y, rz, rx = 0) => {
    const g = cyl(0.12 * k, 0.11 * k, 1.1 * k, 0, 0, 0);
    return g.rotateX(rx).rotateZ(rz).translate(x * k, y * k, 0);
  };
  p.push(arm(0.5, 2.85, 0.12));
  if (gesture === 'war') p.push(arm(-0.56, 2.95, 0.9));
  else if (gesture === 'peace') p.push(arm(-0.5, 2.85, -0.15, 0.9));
  else p.push(arm(-0.5, 2.85, -0.12));
  return p;
}

// Raised frame around a flush area: reads as a shallow recessed panel. Sits on a pier face (zFace, sign ±1).
function panel(px, y0, y1, zFace, sign) {
  const w = 3.2, t = 0.2, d = 0.14, h = y1 - y0;
  const zc = zFace + (sign * d) / 2, yc = (y0 + y1) / 2;
  return [
    box(w, t, d, px, y0, zc), box(w, t, d, px, y1, zc),
    box(t, h, d, px - (w - t) / 2, yc, zc), box(t, h, d, px + (w - t) / 2, yc, zc),
  ];
}

// The arch in local coords: x = across Fifth Avenue (width), y = up, z = along the passage (depth).
export function buildArch() {
  const R = 4.55, SPRING = 9.75, HALF_W = 9.45, PIER_IN = 4.55, H = 23.5, D = 3.9, PIER_X = 7.0;

  // Front silhouette (piers + arch opening + attic) as one outline, extruded through the depth.
  // The curved edge of the opening extruded along z is the half-cylinder vault.
  const s = new THREE.Shape();
  s.moveTo(-HALF_W, 0); s.lineTo(-PIER_IN, 0); s.lineTo(-PIER_IN, SPRING);
  for (let i = 1; i <= 40; i++) {
    const a = Math.PI - (Math.PI * i) / 40;
    s.lineTo(R * Math.cos(a), SPRING + R * Math.sin(a));
  }
  s.lineTo(PIER_IN, 0); s.lineTo(HALF_W, 0); s.lineTo(HALF_W, H); s.lineTo(-HALF_W, H); s.closePath();
  const parts = [new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false }).translate(0, 0, -D / 2)];

  // Mouldings: plinth, frieze band with projecting cornice, attic line, top cornice
  parts.push(box(19.5, 1.2, 4.5, 0, 0.6, 0));        // plinth 0-1.2 m, 0.3 m proud
  parts.push(box(19.0, 0.25, 4.3, 0, 15.975, 0));    // band under the entablature
  parts.push(box(18.9, 1.6, 4.2, 0, 16.8, 0));       // frieze 16.0-17.6
  parts.push(box(19.5, 0.6, 4.5, 0, 17.9, 0));       // projecting cornice 17.6-18.2
  parts.push(box(19.0, 0.25, 4.3, 0, 21.4, 0));      // attic moulding
  parts.push(box(19.5, 0.6, 4.5, 0, 23.2, 0));       // top cornice 22.9-23.5

  // Shallow recessed panels on each pier (north = +z, south = -z faces)
  for (const px of [-PIER_X, PIER_X]) {
    parts.push(...panel(px, 8.0, 9.4, D / 2, 1), ...panel(px, 8.0, 9.4, -D / 2, -1), ...panel(px, 2.0, 6.5, -D / 2, -1));
  }

  // Statue groups on the north face: pedestal 3.5 x 1.2 x 2.4 on the plinth, central figure 4.2 m,
  // two flanking figures 3.3 m. War is on the east pier (local -x), Peace on the west (local +x).
  for (const [px, kind] of [[-PIER_X, 'war'], [PIER_X, 'peace']]) {
    parts.push(box(3.5, 2.4, 1.2, px, 2.4, 2.4));    // pedestal, z 1.8-3.0, y 1.2-3.6
    parts.push(...figure(4.2, kind).map((g) => g.translate(px, 3.6, 2.4)));
    parts.push(...figure(3.3, null).map((g) => g.translate(px - 1.2, 3.6, 2.2)));
    parts.push(...figure(3.3, null).map((g) => g.translate(px + 1.2, 3.6, 2.2)));
  }

  // Floodlight pools in front of the piers (merged; one additive mesh)
  const pool = (x) => new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2).translate(x, 0.12, 4.5);

  return { marble: merge(parts), uplight: merge([pool(-PIER_X), pool(PIER_X)]) };
}

// Round granite basin (20 m across, 0.6 m rim) and its water disc (0.3 m below the rim) and jet column.
export function buildFountain() {
  const R = 10, LIP = 0.6, WATER_Y = 0.3;
  const s = new THREE.Shape();
  s.absarc(0, 0, R, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, R - LIP, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const rim = new THREE.ExtrudeGeometry(s, { depth: LIP, bevelEnabled: false, curveSegments: 64 }).rotateX(-Math.PI / 2);
  const water = new THREE.CircleGeometry(R - LIP, 64).rotateX(-Math.PI / 2).translate(0, WATER_Y, 0);
  const jet = new THREE.CylinderGeometry(0.4, 0.4, 4, 16, 1, true).translate(0, WATER_Y + 2, 0);
  return { rim, water, jet };
}

// Garibaldi: granite pedestal 1.6 m square, 2.2 m tall with a moulded top; bronze figure 2.8 m, drawing a sword.
// The figure's front is local -Z (the caller turns it with yawFacing).
export function buildGaribaldi() {
  const pedestal = merge([
    box(1.8, 0.3, 1.8, 0, 0.15, 0),     // plinth 0-0.3
    box(1.6, 1.7, 1.6, 0, 1.15, 0),     // die 0.3-2.0
    box(1.7, 0.1, 1.7, 0, 2.05, 0),     // moulding 2.0-2.1
    box(1.8, 0.1, 1.8, 0, 2.15, 0),     // cap 2.1-2.2
  ]);

  const f = [];
  f.push(cyl(0.22, 0.34, 1.2, 0, 0.6, 0));           // legs / cape
  f.push(box(0.52, 0.85, 0.34, 0, 1.8, 0));          // torso
  f.push(cyl(0.09, 0.09, 0.3, 0, 2.35, 0));          // neck
  f.push(sph(0.18, 0, 2.62, 0));                     // head, top at 2.8
  // rotate at the origin, then move into place (translating first would swing the part around the origin)
  f.push(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 14).rotateZ(-0.1).translate(0.34, 1.85, 0)); // lowered arm
  // sword arm: shoulder at (-0.3, 2.1), raised out to the side, blade continuing along the arm
  const th = 0.9, dx = -Math.sin(th), dy = Math.cos(th), sx = -0.3, sy = 2.1;
  f.push(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 14).rotateZ(th).translate(sx + dx * 0.3, sy + dy * 0.3, 0));
  f.push(new THREE.BoxGeometry(0.03, 0.85, 0.015).rotateZ(th).translate(sx + dx * 1.025, sy + dy * 1.025, 0));
  const bronze = merge(f).translate(0, 2.2, 0); // stands on the pedestal top

  return { pedestal, bronze };
}

function glowTexture() {
  const N = 32, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(((x + 0.5) / N) * 2 - 1, ((y + 0.5) / N) * 2 - 1);
    const i = (y * N + x) * 4, a = Math.max(0, 1 - d) ** 2;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = a * 255;
  }
  return new THREE.DataTexture(data, N, N); // RGBA, unsigned byte by default
}

export const WASHINGTON_SQUARE = {
  id: 'washington-square', kind: 'ambient', local: true, cooldown: 1,
  possible: (ctx) => ctx.place?.id === 'manhattan' && !!ctx.world && !!ctx.geo,
  chance: () => 1,
  create(ctx) {
    const root = new THREE.Group();
    root.name = 'washington-square';
    const meshes = [], mats = new Set(), undo = [];
    const mk = (geo, mat, parent, cast = false) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      parent.add(m); meshes.push(m); mats.add(mat);
      return m;
    };

    // Arch: local +z points up Fifth Avenue (AVENUE_DIR), so the north face is +z
    const arch = new THREE.Group();
    arch.position.copy(at(ctx, ARCH.lat, ARCH.lon));
    arch.rotation.y = Math.atan2(AVENUE_DIR.x, AVENUE_DIR.z);
    root.add(arch);
    const A = buildArch();
    const marbleMat = new THREE.MeshStandardMaterial({ color: MARBLE_COLOR, roughness: 0.75, metalness: 0 });
    mk(A.marble, marbleMat, arch, true);
    const glow = glowTexture();
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffd7a0, map: glow, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    mk(A.uplight, glowMat, arch, false);

    // Fountain
    const fountain = new THREE.Group();
    fountain.position.copy(at(ctx, FOUNTAIN.lat, FOUNTAIN.lon));
    root.add(fountain);
    const F = buildFountain();
    const granite = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.6, metalness: 0 });
    mk(F.rim, granite, fountain);
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x2c3a44, roughness: 0.1, metalness: 0 });
    mk(F.water, waterMat, fountain);
    const jetMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const jet = mk(F.jet, jetMat, fountain);

    // Garibaldi: faces west (yawFacing turns local -z to (-1, 0))
    const garibaldi = new THREE.Group();
    garibaldi.position.copy(at(ctx, GARIBALDI.lat, GARIBALDI.lon));
    garibaldi.rotation.y = yawFacing(-1, 0);
    root.add(garibaldi);
    const G = buildGaribaldi();
    mk(G.pedestal, granite, garibaldi, true);
    const bronzeMat = new THREE.MeshStandardMaterial({ color: 0x4a4434, metalness: 0.6, roughness: 0.5 });
    mk(G.bronze, bronzeMat, garibaldi, true);

    ctx.world.add(root);

    // OSM building blocks around the arch: cut them now, and again as tiles stream in
    const ax = ctx.geo.x(ARCH.lon), az = ctx.geo.z(ARCH.lat);
    undo.push(hideBuildingsNear(ctx, ax, az, 16));
    let t = 0, acc = 0;

    return {
      update(dt, c) {
        t += dt;
        const night = c.night ?? 0;
        // floodlit marble at night
        marbleMat.emissive.copy(NIGHT_EMISSIVE).multiplyScalar(night * 0.6);
        glowMat.opacity = 0.85 * night;
        // water freezes under snow: the jet is hidden, otherwise it gently pulses
        jet.visible = !((c.w?.snow ?? 0) > 0.5);
        const pulse = 1 + 0.06 * Math.sin(t * 2.2);
        jet.scale.set(pulse, 1, pulse);
        jetMat.opacity = 0.3 + 0.06 * Math.sin(t * 3.1);
        acc += dt;
        if (acc >= 2) { acc = 0; undo.push(hideBuildingsNear(c, ax, az, 16)); }
        return true;
      },
      dispose() {
        root.removeFromParent();
        for (const u of undo) u();
        for (const m of meshes) m.geometry.dispose();
        for (const mat of mats) mat.dispose();
        glow.dispose();
      },
    };
  },
};
