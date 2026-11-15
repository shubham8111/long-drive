// Midtown landmarks: the Empire State Building's mooring mast and night floodlit crown, the Radio City
// Music Hall corner sign and marquee, and a generic Herald Square department-store frontage (no real logos).
// Geometry is merged per material and there are no THREE lights (each light recompiles every shader), so
// every landmark costs only a few draw calls. Coordinates are local metres (see common.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { at, AVENUE_DIR, STREET_DIR } from './common.js';

const TAU = Math.PI * 2;
const I = { x: 1, z: 0 };                 // unrotated
const NEG = (u) => ({ x: -u.x, z: -u.z });

// Canvas texture, registered in `own` for disposal. Returns null without a document (headless test), so the
// material just has no map there.
function canvasTex(w, h, draw, own) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  own.push(t);
  return t;
}

// Matrix that puts an object at p with its local +X along the horizontal unit vector u (local +Z = u turned 90 deg).
function placeM(p, u) {
  return new THREE.Matrix4().makeRotationY(Math.atan2(-u.z, u.x)).setPosition(p.x, p.y, p.z);
}
// Point = base lifted by dy, then moved along horizontal directions: pos(base, 23, [AVENUE_DIR, 1.6])
function pos(base, dy, ...moves) {
  const p = new THREE.Vector3(base.x, base.y + dy, base.z);
  for (const [d, k] of moves) { p.x += d.x * k; p.z += d.z * k; }
  return p;
}
// Merge [geometry, matrix] pairs into one geometry (the parts share one material, so one draw call).
function bake(parts) {
  const list = parts.map(([g, m]) => g.applyMatrix4(m));
  const out = mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  return out;
}
function mesh(geo, mat, p, u = I) {
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(p);
  m.rotation.y = Math.atan2(-u.z, u.x);
  return m;
}
// Landmark object in the contract shape (see common.js).
const mk = (id, create) => ({
  id, kind: 'ambient', local: true, cooldown: 1,
  possible: (ctx) => ctx.place?.id === 'manhattan' && !!ctx.world && !!ctx.geo,
  chance: () => 1,
  create,
});

// ---------------------------------------------------------------- Empire State Building
const EMPIRE = { lat: 40.748440, lon: -73.985664 };
// Night floodlight palettes: each entry is a list of horizontal colour bands (top to bottom), RGB 0..255.
const GLOW_PALETTES = [
  [[255, 214, 128]],                                // white-gold
  [[255, 255, 255]],                                // white
  [[205, 35, 45], [255, 255, 255], [35, 70, 190]],  // red, white, blue bands
  [[70, 255, 120]],                                 // green
  [[255, 120, 195]],                                // pink
  [[255, 140, 40]],                                 // orange
];

// Vertical gradient (brightest at the top, as uv.y = 1 is the top of every plane/cylinder here), tinted by bands.
function glowTex(bands, own) {
  return canvasTex(8, 256, (g, w, h) => {
    for (let y = 0; y < h; y++) {
      const t = y / (h - 1);                                    // 0 = top
      const [r, gg, b] = bands[Math.min(bands.length - 1, Math.floor(t * bands.length))];
      g.fillStyle = `rgba(${r},${gg},${b},${(1 - 0.75 * t).toFixed(3)})`;
      g.fillRect(0, y, w, 1);
    }
  }, own);
}

const EMPIRE_TOP = mk('empire-state-top', (ctx) => {
  const base = at(ctx, EMPIRE.lat, EMPIRE.lon);
  const own = [];
  const group = new THREE.Group();
  ctx.world.add(group);

  // Mooring mast and antenna, 381 m (roof) to 443 m (tip), heights above the ground.
  const metal = new THREE.MeshStandardMaterial({ color: 0xc9ced4, metalness: 0.7, roughness: 0.35 });
  const mastGeo = bake([
    [new THREE.CylinderGeometry(4, 4, 9, 16), placeM(pos(base, 385.5), I)],          // 381-390, r 4
    [new THREE.CylinderGeometry(1.2, 3, 30, 16), placeM(pos(base, 405), I)],          // 390-420, r 3 -> 1.2
    [new THREE.CylinderGeometry(0.15, 0.5, 23, 8), placeM(pos(base, 431.5), I)],      // 420-443, r 0.5 -> 0.15
  ]);
  own.push(mastGeo, metal);
  group.add(new THREE.Mesh(mastGeo, metal));

  // Red aircraft beacon at the tip: always on, pulsing about once a second (never fully off).
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
  const beaconGeo = new THREE.SphereGeometry(0.8, 10, 8);
  group.add(mesh(beaconGeo, beaconMat, pos(base, 443)));
  own.push(beaconMat, beaconGeo);

  // Night floodlit crown: four open-top/bottom walls around the 25 m shaft (320-381 m) plus an open
  // cylinder round the mast base. One merged geometry, drawn by two materials that crossfade palettes.
  const glowGeo = bake([
    [new THREE.PlaneGeometry(27, 61), placeM(pos(base, 350.5, [STREET_DIR, 13.5]), AVENUE_DIR)],
    [new THREE.PlaneGeometry(27, 61), placeM(pos(base, 350.5, [STREET_DIR, -13.5]), AVENUE_DIR)],
    [new THREE.PlaneGeometry(27, 61), placeM(pos(base, 350.5, [AVENUE_DIR, 13.5]), STREET_DIR)],
    [new THREE.PlaneGeometry(27, 61), placeM(pos(base, 350.5, [AVENUE_DIR, -13.5]), STREET_DIR)],
    [new THREE.CylinderGeometry(5.5, 5.5, 19, 24, 1, true), placeM(pos(base, 390.5), I)],
  ]);
  own.push(glowGeo);
  const sets = [0, 1].map(() => {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    own.push(mat);
    const m = new THREE.Mesh(glowGeo, mat);
    m.renderOrder = 2;
    group.add(m);
    return mat;
  });
  const texCache = [];
  const texFor = (i) => (texCache[i] ??= glowTex(GLOW_PALETTES[i], own));
  const setTex = (mat, i) => { mat.map = texFor(i); mat.needsUpdate = true; };

  // Palette state: `front` is the set showing the current palette (or fading out during a crossfade).
  let lastH = 0, dayN = 0, shown = 0, front = 0, fade = 1, t = 0;
  setTex(sets[0], 0);

  return {
    update(dt, c) {
      t += dt;
      const p = 0.5 + 0.5 * Math.sin(t * TAU);
      const k = 0.25 + 0.75 * p ** 4;
      beaconMat.color.setRGB(k, 0.04 * k, 0.04 * k);

      // A new "day" starts when the clock passes noon; the tint changes then (in daylight) and crossfades in.
      const h = c.hours ?? 0;
      if (lastH < 12 && h >= 12) dayN++;
      lastH = h;
      const want = dayN % GLOW_PALETTES.length;
      if (want !== shown) {
        if (fade < 1) { front = 1 - front; fade = 1; }   // settle a fade still running
        setTex(sets[1 - front], want);
        fade = 0; shown = want;
      }
      if (fade < 1) { fade = Math.min(1, fade + dt / 3); if (fade === 1) front = 1 - front; }

      // Opacity follows night, so the crown is invisible by day.
      const glow = (c.night ?? 0) * 0.55;
      const a = sets[front], b = sets[1 - front];
      if (fade >= 1) { a.opacity = glow; b.opacity = 0; }
      else { a.opacity = glow * (1 - fade); b.opacity = glow * fade; }
      return true;
    },
    dispose() {
      group.removeFromParent();
      own.forEach((x) => x.dispose());
    },
  };
});

// ---------------------------------------------------------------- Radio City Music Hall (6th Ave & W 50th St)
// Sign lettering stacked top to bottom on a dark red-brown face: white-hot red letters with a red halo.
function drawSignLetters(g, w, h) {
  g.fillStyle = '#3a0d0a';
  g.fillRect(0, 0, w, h);
  const rows = ['R', 'A', 'D', 'I', 'O', 'C', 'I', 'T', 'Y'];
  const step = h / 10.5;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 84px Helvetica, Arial, sans-serif';
  rows.forEach((ch, k) => {
    const y = step * 0.6 + k * step + (k >= 5 ? step * 0.6 : 0);   // gap between RADIO and CITY
    g.shadowColor = 'rgba(255, 30, 30, 1)';
    g.shadowBlur = 26;
    g.fillStyle = '#ff2d2d';
    g.fillText(ch, w / 2, y);
    g.shadowBlur = 8;
    g.fillStyle = '#ffd6d2';
    g.fillText(ch, w / 2, y);
  });
  g.shadowBlur = 0;
}
// Marquee strip at 40 px per metre: dim gold band, a row of white bulbs top and bottom, dark lettering.
function drawMarquee(g, w, h) {
  g.fillStyle = '#8a6a3c';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fffbe8';
  for (let x = 5; x < w; x += 14) {
    g.beginPath(); g.arc(x, 6, 3, 0, TAU); g.fill();
    g.beginPath(); g.arc(x, h - 6, 3, 0, TAU); g.fill();
  }
  g.font = 'bold 30px Helvetica, Arial, sans-serif';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const label = 'RADIO CITY MUSIC HALL   ';
  const lw = g.measureText(label).width;
  g.fillStyle = '#2a1608';
  for (let x = 0; x < w; x += lw) g.fillText(label, x, h / 2);
}

const RADIO_CITY = mk('radio-city', (ctx) => {
  const C = at(ctx, 40.75993, -73.97988);   // the corner
  const A = AVENUE_DIR, S = STREET_DIR;     // A: up 6th Ave (north); S: east, the facade normal on 6th Ave
  const own = [];
  const group = new THREE.Group();
  ctx.world.add(group);

  // Vertical sign on the corner: 3.2 m along 6th Ave, 1.2 m deep, 1 m off the facade, 10-36 m up.
  const signBody = new THREE.MeshStandardMaterial({ color: 0x2a0c0a, roughness: 0.8 });
  const signBoxGeo = new THREE.BoxGeometry(3.2, 26, 1.2);
  group.add(mesh(signBoxGeo, signBody, pos(C, 23, [A, 1.6], [S, 1.6]), A));
  own.push(signBody, signBoxGeo);

  // Both faces share one lettering texture; the back plane is turned round so its text reads correctly too.
  const letterTex = canvasTex(128, 1024, drawSignLetters, own);
  const signFace = new THREE.MeshStandardMaterial({
    map: letterTex, emissiveMap: letterTex, emissive: 0xffffff, emissiveIntensity: 0.35,
  });
  const faceGeo = bake([
    [new THREE.PlaneGeometry(3.2, 26), placeM(pos(C, 23, [A, 1.6], [S, 2.21]), A)],
    [new THREE.PlaneGeometry(3.2, 26), placeM(pos(C, 23, [A, 1.6], [S, 0.99]), NEG(A))],
  ]);
  group.add(new THREE.Mesh(faceGeo, signFace));
  own.push(signFace, faceGeo);

  // Marquee band, 1.8 m tall at 5-7 m: 40 m up 6th Ave and 25 m west along 50th St, 0.6 m off the facades.
  const avTex = canvasTex(40 * 40, 72, drawMarquee, own);
  const stTex = canvasTex(25 * 40, 72, drawMarquee, own);
  const bandMat = (tex) => new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: 0xffe2a0, emissiveIntensity: 0.25,
  });
  const avMat = bandMat(avTex), stMat = bandMat(stTex);
  const avGeo = new THREE.PlaneGeometry(40, 1.8), stGeo = new THREE.PlaneGeometry(25, 1.8);
  group.add(mesh(avGeo, avMat, pos(C, 6, [A, 20], [S, 0.6]), A));
  group.add(mesh(stGeo, stMat, pos(C, 6, [S, -12.5], [A, -0.6]), S));
  own.push(avMat, stMat, avGeo, stGeo);

  return {
    update(dt, c) {
      const n = c.night ?? 0;
      // Letters and bulbs glow at night and stay readable by day.
      signFace.emissiveIntensity = 0.35 + 1.4 * n;
      avMat.emissiveIntensity = stMat.emissiveIntensity = 0.25 + 1.2 * n;
      return true;
    },
    dispose() {
      group.removeFromParent();
      own.forEach((x) => x.dispose());
    },
  };
});

// ---------------------------------------------------------------- Herald Square frontage (W 34th St)
const HERALD = { w: { lat: 40.75062, lon: -73.98943 }, e: { lat: 40.74998, lon: -73.98802 } };

// Red awning cloth with a white valance along its outer (top-of-canvas) edge, scalloped below.
function drawAwning(g, w, h) {
  g.fillStyle = '#9b1419';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.12)';                       // cloth folds
  for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 16, h);
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, w, 10);
  for (let x = 0; x < w; x += 24) { g.beginPath(); g.arc(x + 12, 10, 12, 0, Math.PI); g.fill(); }
}
// Plain white-on-red sign text (generic wording, no store branding).
function drawHeraldSign(g, w, h) {
  g.fillStyle = '#b3121b';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff';
  g.font = 'bold 96px Helvetica, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('HERALD SQUARE', w / 2, h / 2 + 4);
}

const HERALD_SQUARE = mk('herald-square', (ctx) => {
  const W = at(ctx, HERALD.w.lat, HERALD.w.lon), E = at(ctx, HERALD.e.lat, HERALD.e.lon);
  // The frontage runs along U (~STREET_DIR) and faces N (-AVENUE_DIR, south-south-west). Exact right angles
  // keep the awning matrices orthonormal.
  const U = STREET_DIR, N = NEG(AVENUE_DIR);
  const mid = new THREE.Vector3((W.x + E.x) / 2, (W.y + E.y) / 2, (W.z + E.z) / 2);
  const L = (E.x - W.x) * U.x + (E.z - W.z) * U.z;      // frontage length along U (~138 m)
  // Point on the frontage at distance s from the middle, lifted dy above the ground there, out dist from the facade.
  const onFront = (s, dy, out) => pos({ x: mid.x, y: mid.y + ((E.y - W.y) * s) / L, z: mid.z }, dy, [U, s], [N, out]);
  const own = [];
  const group = new THREE.Group();
  ctx.world.add(group);

  // Ten awnings, each 10 m wide, spread evenly. Each slopes 1.5 m out and drops 1.6 m from 4.5 m height.
  const awnTex = canvasTex(512, 64, drawAwning, own);
  const awnMat = new THREE.MeshStandardMaterial({ map: awnTex, side: THREE.DoubleSide, roughness: 0.9 });
  const slope = new THREE.Vector3(N.x * 1.5, -1.6, N.z * 1.5);
  const slant = slope.length();
  const Y = slope.clone().normalize();
  const X = new THREE.Vector3(U.x, 0, U.z);
  const Z = new THREE.Vector3().crossVectors(X, Y);
  const awnParts = [], winParts = [];
  for (let i = 0; i < 10; i++) {
    const s = -L / 2 + ((i + 0.5) * L) / 10;
    const p = onFront(s, 3.7, 0.75);                    // awning centre
    const m = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(p.x, p.y, p.z);
    awnParts.push([new THREE.PlaneGeometry(10, slant), m]);
    // Display window under each awning: 8 m x 3.5 m, 1 m off the ground, 0.3 m proud of the facade.
    winParts.push([new THREE.BoxGeometry(8, 3.5, 0.3), placeM(onFront(s, 2.75, 0.15), U)]);
  }
  const awnGeo = bake(awnParts);
  group.add(new THREE.Mesh(awnGeo, awnMat));
  own.push(awnMat, awnGeo);

  const winMat = new THREE.MeshStandardMaterial({
    color: 0xfff0d6, emissive: 0xffd9a0, emissiveIntensity: 0.25, roughness: 0.3,
  });
  const winGeo = bake(winParts);
  group.add(new THREE.Mesh(winGeo, winMat));
  own.push(winMat, winGeo);

  // White-on-red sign at the Broadway end: 12 m x 2 m, centre 9 m up, 0.5 m off the facade.
  const signTex = canvasTex(1024, 171, drawHeraldSign, own);
  const signMat = new THREE.MeshStandardMaterial({
    map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0.25,
  });
  const signGeo = new THREE.PlaneGeometry(12, 2);
  group.add(mesh(signGeo, signMat, onFront(L / 2 - 6.5, 9, 0.5), U));
  own.push(signMat, signGeo);

  return {
    update(dt, c) {
      const n = c.night ?? 0;
      // Windows glow a little by day and strongly at night.
      winMat.emissiveIntensity = 0.25 + 1.6 * n;
      signMat.emissiveIntensity = 0.25 + 0.9 * n;
      return true;
    },
    dispose() {
      group.removeFromParent();
      own.forEach((x) => x.dispose());
    },
  };
});

export const MIDTOWN = [EMPIRE_TOP, RADIO_CITY, HERALD_SQUARE];
