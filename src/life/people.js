// Pedestrians (+ marshal / photographer / spectator variants) and a dog: skinned procedural models.
// Model space: metres, +y up, forward = +Z, the figure's left is +X. Standing height ~1.76 m.
import * as THREE from 'three';
import { SkinBuilder, makeSkinned, rand, pick, chance, TAU } from './common.js';

const sin = Math.sin, cos = Math.cos;
export const PED_BONES = [
  { n: 'hips', p: -1, at: [0, 0.95, 0] },
  { n: 'chest', p: 0, at: [0, 1.12, 0] },
  { n: 'head', p: 1, at: [0, 1.5, 0] },
  { n: 'uArmL', p: 1, at: [0.2, 1.44, 0] },
  { n: 'lArmL', p: 3, at: [0.205, 1.17, 0] },
  { n: 'uArmR', p: 1, at: [-0.2, 1.44, 0] },
  { n: 'lArmR', p: 5, at: [-0.205, 1.17, 0] },
  { n: 'uLegL', p: 0, at: [0.09, 0.93, 0] },
  { n: 'lLegL', p: 7, at: [0.09, 0.5, 0] },
  { n: 'uLegR', p: 0, at: [-0.09, 0.93, 0] },
  { n: 'lLegR', p: 9, at: [-0.09, 0.5, 0] },
  { n: 'umb', p: 6, at: [-0.2, 0.9, 0.02] },
];

// the lead-walker's dog colours [coat, patch] and the circuit marshal's look (shared with life.js)
export const DOGS = [[0xc9a46a, 0xe8e0d0], [0x2a2420, 0xb89460], [0x7a5a3a, 0xe8e0d0], [0xe8e0d0, 0xb89460]];
export const MARSHAL_LOOK = { f: false, top: 0xe8650d, bottom: 0xe8650d, skin: 0xc98f66, hair: 0x2c2018, hairStyle: 'cap', shoe: 0x1a1816, coat: false, bag: 'none', sleeves: 'long', vest: 0xf2f2ee };

const SKINS = [0xf0c8a4, 0xe2b48c, 0xc98f66, 0xa56f48, 0x7d5033, 0x573522];
const HAIRS = [0x1c1612, 0x2c2018, 0x4a3426, 0x6d4c30, 0x9a7a4e, 0xb8b0a4, 0x8a8f94, 0x2a2a2c];
const TOPS = [0x2e3d57, 0x8a2f2f, 0x2f5d50, 0xc8b38a, 0x1f1f22, 0xd9d6cf, 0x6b5a8a, 0xb5651d, 0x4a6b8a, 0x3c3c3f, 0x7a8a6b, 0xcf8f9c];
const BOTTOMS = [0x23262c, 0x34415c, 0x4a3f33, 0x1a1a1a, 0x5c5f66, 0x6d5f4a, 0x2b3a33];
const SHOES = [0x1a1816, 0x3b2a20, 0xe2e0da, 0x2a2e3a];

const cache = new Map();
// opts: { f: female, top, bottom, skin, hair, hairStyle 'short'|'long'|'cap'|'none', coat: bool, bag: 'none'|'pack'|'hand', helmet }
export function randomLook(extra = {}) {
  const f = chance(0.5);
  return {
    f, top: pick(TOPS), bottom: pick(BOTTOMS), skin: pick(SKINS), hair: pick(HAIRS), shoe: pick(SHOES),
    hairStyle: f ? (chance(0.6) ? 'long' : 'short') : chance(0.2) ? 'cap' : chance(0.1) ? 'none' : 'short',
    coat: chance(0.35), skirt: f && chance(0.35), bag: pick(['none', 'none', 'pack', 'hand', 'hand']), sleeves: chance(0.6) ? 'long' : 'short',
    ...extra,
  };
}
export function pedGeometry(o) {
  const key = JSON.stringify(o);
  if (cache.has(key)) return cache.get(key);
  const b = new SkinBuilder();
  const { top, bottom, skin, hair, shoe } = o, shirt = o.coat ? top : top;
  const sleeve = o.sleeves === 'long' || o.coat ? top : skin;
  const wide = o.f ? 0.9 : 1.0;
  // torso, pelvis
  b.sphere(1, [0, 1.27, 0], top, 1, [0.17 * wide, 0.27, 0.105], [12, 8]);
  b.sphere(1, [0, 1.0, 0], o.coat ? top : bottom, 0, [0.155 * (o.f ? 1.06 : 1), 0.13, 0.105], [12, 8]);
  b.limb([0, 1.4, 0], [0, 1.1, 0], 0.15 * wide, 0.14, top, 1, 12);
  if (o.coat) b.limb([0, 1.02, 0], [0, 0.66, 0], 0.15, 0.2, top, 0, 12, true);
  if (o.skirt) b.limb([0, 1.0, 0], [0, 0.62, 0], 0.15, 0.22, bottom, 0, 12, true);
  // neck + head
  b.limb([0, 1.42, 0], [0, 1.54, 0.01], 0.05, 0.045, skin, 2, 8);
  b.sphere(1, [0, 1.66, 0.012], skin, 2, [0.088, 0.112, 0.1], [12, 10]);
  b.sphere(0.02, [0, 1.655, 0.108], skin, 2, [1, 1.2, 1], [6, 5]); // nose
  if (o.hairStyle !== 'none') b.sphere(1, [0, 1.685, -0.022], hair, 2, [0.096, 0.1, 0.108], [12, 10]);
  if (o.hairStyle === 'long') b.limb([0, 1.64, -0.085], [0, 1.36, -0.09], 0.075, 0.05, hair, 2, 8);
  if (o.hairStyle === 'cap') { b.sphere(1, [0, 1.71, 0.0], top ^ 0x303030, 2, [0.1, 0.07, 0.108], [12, 8]); b.box(0.12, 0.012, 0.09, [0, 1.69, 0.12], top ^ 0x303030, 2); }
  // arms
  for (const sx of [1, -1]) {
    const ub = sx > 0 ? 3 : 5, lb = sx > 0 ? 4 : 6;
    b.sphere(0.056, [sx * 0.2, 1.43, 0], top, ub, [1, 1, 1], [8, 6]);
    b.limb([sx * 0.2, 1.43, 0], [sx * 0.205, 1.17, 0], 0.05, 0.041, top, ub, 8);
    b.limb([sx * 0.205, 1.17, 0], [sx * 0.2, 0.93, 0], 0.041, 0.032, sleeve, lb, 8);
    b.sphere(0.034, [sx * 0.2, 0.89, 0.005], skin, lb, [1, 1.2, 0.8], [8, 6]);
  }
  // legs
  for (const sx of [1, -1]) {
    const ub = sx > 0 ? 7 : 9, lb = sx > 0 ? 8 : 10;
    b.limb([sx * 0.09, 0.97, 0], [sx * 0.09, 0.5, 0], 0.088, 0.062, bottom, ub, 9);
    b.sphere(0.063, [sx * 0.09, 0.5, 0], bottom, ub, [1, 1, 1], [8, 6]);
    b.limb([sx * 0.09, 0.5, 0], [sx * 0.09, 0.09, 0], 0.062, 0.042, bottom, lb, 8);
    b.box(0.095, 0.07, 0.27, [sx * 0.09, 0.04, 0.06], shoe, lb);
  }
  if (o.bag === 'pack') b.box(0.26, 0.34, 0.12, [0, 1.3, -0.16], o.top ^ 0x2a2a2a, 1);
  if (o.bag === 'hand') { b.box(0.05, 0.2, 0.28, [0.22, 0.78, 0.02], 0x6b4a2f, 4); b.limb([0.2, 0.9, 0.0], [0.22, 0.88, 0.0], 0.006, 0.006, 0x6b4a2f, 4, 4); }
  if (o.vest) {
    b.limb([0, 1.42, 0], [0, 1.08, 0], 0.172 * wide, 0.16, o.vest, 1, 12);
    b.limb([0, 1.02, 0], [0, 0.9, 0], 0.158, 0.158, o.vest, 0, 12);
  }
  // umbrella (bound to a bone that is scaled to nothing when it is dry)
  b.limb([-0.2, 0.84, 0.02], [-0.2, 1.92, 0.02], 0.007, 0.007, 0x222222, 11, 4);
  const um = o.umbrella || pick([0x1c2a44, 0x1a1a1a, 0x7a1f2b, 0x20463b]);
  b.add(new THREE.SphereGeometry(1, 14, 6, 0, TAU, 0, Math.PI / 2), { p: [-0.2, 1.84, 0.02], s: [0.55, 0.2, 0.55], c: um, bone: 11 });
  const g = b.build();
  cache.set(key, g);
  return g;
}

export function makePed(mat, look) {
  const r = makeSkinned(pedGeometry(look), mat, PED_BONES);
  r.mesh.userData.scaleBase = rand(0.93, 1.06) * (look.f ? 0.96 : 1);
  r.umbrella = false;
  return r;
}

// p: { ph, amp (0..1 walking), t, arms: 0 swing | 1 hang | 2 wave | 3 camera | 4 phone | 5 lap | 6 clap | 7 dogleash,
//      sit 0..1, lookY, umb 0/1 }
export function posePed(r, p) {
  const B = r.by, amp = p.amp, s = sin(p.ph), c = cos(p.ph);
  const A = 0.42 * amp;
  // legs
  const swL = A * s, swR = -A * s;
  const flex = (cc) => (0.12 + 1.0 * Math.max(0, cc)) * amp;
  B.uLegL.rotation.x = -swL; B.uLegR.rotation.x = -swR;
  B.lLegL.rotation.x = flex(cos(p.ph - 0.5)) * 0.85;
  B.lLegR.rotation.x = flex(-cos(p.ph - 0.5)) * 0.85;
  B.hips.position.y = 0.95 + (0.014 * (cos(2 * p.ph) - 1) - 0.004) * amp;
  B.hips.rotation.y = -0.07 * amp * s;
  B.chest.rotation.y = 0.1 * amp * s;
  B.chest.rotation.x = 0.04 * amp + 0.02 * sin(p.t * 1.3);
  B.chest.rotation.z = 0.015 * amp * s;
  B.head.rotation.y = p.lookY - B.chest.rotation.y;
  B.head.rotation.x = -0.02;
  // arms
  let aLx = 0.5 * amp * s, aRx = -0.5 * amp * s; // swing: x = -(forward swing)
  let eL = -(0.12 + 0.35 * amp * Math.max(0, -s)), eR = -(0.12 + 0.35 * amp * Math.max(0, s));
  let zL = 0.07, zR = -0.07, ezL = 0, ezR = 0;
  const m = p.arms;
  if (m === 1) { aLx = aRx = 0.03 * sin(p.t * 1.1); eL = eR = -0.1; }
  else if (m === 2) { // slow wave with the right arm
    aLx = 0.02; eL = -0.1;
    zR = -(2.35 + 0.1 * sin(p.t * 1.1)); aRx = -0.12; eR = 0; ezR = -(0.55 * sin(p.t * 3.3));
  } else if (m === 3) { // camera at the eye
    aLx = -1.25; eL = -1.55; aRx = -1.3; eR = -1.6; zL = 0.12; zR = -0.12;
    B.head.rotation.x = -0.05;
  } else if (m === 4) { aRx = -0.55; eR = -1.75; aLx = 0.03; eL = -0.12; B.head.rotation.x = 0.32; }
  else if (m === 5) { aLx = -0.45; eL = -1.0; aRx = -0.45; eR = -1.0; zL = 0.02; zR = -0.02; }
  else if (m === 6) { // applause
    const k = Math.max(0, sin(p.t * 7.5));
    aLx = -0.95; eL = -1.15 - 0.15 * k; aRx = -0.95; eR = -1.15 - 0.15 * k; zL = 0.18 - 0.14 * k; zR = -0.18 + 0.14 * k;
  } else if (m === 7) { aLx = 0.5 * amp * s; aRx = -0.3; eR = -0.5; zR = -0.18; }
  B.uArmL.rotation.x = aLx; B.uArmR.rotation.x = aRx;
  B.lArmL.rotation.x = eL; B.lArmR.rotation.x = eR;
  B.uArmL.rotation.z = zL; B.uArmR.rotation.z = zR; B.lArmL.rotation.z = ezL; B.lArmR.rotation.z = ezR;
  // umbrella in the right hand
  if (p.umb) {
    B.uArmR.rotation.x = -0.55; B.lArmR.rotation.x = -1.35; B.uArmR.rotation.z = -0.12; B.lArmR.rotation.z = 0;
    B.umb.scale.setScalar(1);
    B.umb.rotation.x = -(B.uArmR.rotation.x + B.lArmR.rotation.x);
  } else B.umb.scale.setScalar(0.0001);
  // sitting
  if (p.sit > 0) {
    const k = p.sit;
    B.hips.position.y = 0.95 - 0.38 * k;
    B.uLegL.rotation.x = B.uLegR.rotation.x = -1.5 * k + (1 - k) * B.uLegL.rotation.x;
    B.lLegL.rotation.x = B.lLegR.rotation.x = 1.5 * k + (1 - k) * B.lLegL.rotation.x;
    B.uLegL.rotation.z = 0.05 * k; B.uLegR.rotation.z = -0.05 * k;
    B.chest.rotation.x += 0.06 * k;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Dog (on a lead)                                                                             */
/* ------------------------------------------------------------------------------------------ */
const DOG_BONES = [
  { n: 'root', p: -1, at: [0, 0.47, -0.2] },
  { n: 'chest', p: 0, at: [0, 0.48, 0.12] },
  { n: 'head', p: 1, at: [0, 0.64, 0.3] },
  { n: 'earL', p: 2, at: [0.05, 0.72, 0.3] },
  { n: 'earR', p: 2, at: [-0.05, 0.72, 0.3] },
  { n: 'tail', p: 0, at: [0, 0.54, -0.4] },
  { n: 'fl', p: 1, at: [0.08, 0.44, 0.2] },
  { n: 'fr', p: 1, at: [-0.08, 0.44, 0.2] },
  { n: 'bl', p: 0, at: [0.08, 0.44, -0.3] },
  { n: 'br', p: 0, at: [-0.08, 0.44, -0.3] },
];
const dogCache = new Map();
export function makeDog(mat, coat, patch) {
  const key = coat + '_' + patch;
  if (!dogCache.has(key)) {
    const b = new SkinBuilder();
    const dark = 0x1c1714;
    b.sphere(1, [0, 0.5, 0.1], coat, 1, [0.12, 0.15, 0.2], [12, 8]);
    b.sphere(1, [0, 0.49, -0.2], coat, 0, [0.12, 0.14, 0.22], [12, 8]);
    b.sphere(1, [0, 0.5, -0.4], patch, 0, [0.1, 0.13, 0.1], [10, 8]);
    b.limb([0, 0.55, 0.22], [0, 0.66, 0.31], 0.08, 0.06, coat, 1, 8, true);
    b.sphere(1, [0, 0.66, 0.34], coat, 2, [0.07, 0.075, 0.09], [10, 8]);
    b.limb([0, 0.64, 0.38], [0, 0.6, 0.5], 0.045, 0.034, patch, 2, 8, true);
    b.sphere(0.022, [0, 0.605, 0.5], dark, 2, [1, 0.8, 0.9], [6, 5]);
    for (const sx of [1, -1]) {
      b.sphere(0.012, [sx * 0.045, 0.685, 0.4], 0x080605, 2, [1, 1, 1], [5, 4]);
      b.add(new THREE.SphereGeometry(1, 8, 6), { p: [sx * 0.07, 0.69, 0.3], r: [0.3, 0, sx * -0.5], s: [0.015, 0.07, 0.045], c: patch ^ 0x0a0a0a, bone: sx > 0 ? 3 : 4 });
      const fb = sx > 0 ? 6 : 7, bb = sx > 0 ? 8 : 9;
      b.limb([sx * 0.08, 0.45, 0.2], [sx * 0.075, 0.03, 0.22], 0.05, 0.03, coat, fb, 7);
      b.limb([sx * 0.085, 0.46, -0.3], [sx * 0.08, 0.03, -0.26], 0.06, 0.03, coat, bb, 7);
      b.box(0.045, 0.03, 0.07, [sx * 0.075, 0.015, 0.24], dark, fb);
      b.box(0.045, 0.03, 0.07, [sx * 0.08, 0.015, -0.24], dark, bb);
    }
    b.limb([0, 0.53, -0.42], [0, 0.68, -0.58], 0.03, 0.015, coat, 5, 6);
    // collar and lead (the walker holds the far end)
    b.limb([0, 0.625, 0.255], [0, 0.58, 0.255], 0.068, 0.072, 0x8a1f1f, 2, 8);
    b.limb([0.0, 0.6, 0.22], [-0.08, 0.7, -0.35], 0.007, 0.007, 0x8a1f1f, 1, 4);
    b.limb([-0.08, 0.7, -0.35], [-0.5, 0.86, -0.8], 0.007, 0.007, 0x8a1f1f, 1, 4);
    dogCache.set(key, b.build());
  }
  const r = makeSkinned(dogCache.get(key), mat, DOG_BONES);
  return r;
}
// p: { ph, amp, t, sniff 0..1 }
export function poseDog(r, p) {
  const B = r.by, amp = p.amp, s = sin(p.ph), A = 0.55 * amp;
  B.fl.rotation.x = -A * s; B.br.rotation.x = -A * s; B.fr.rotation.x = A * s; B.bl.rotation.x = A * s;
  B.root.position.y = 0.47 + 0.012 * amp * Math.abs(cos(p.ph));
  B.root.rotation.x = 0.03 * amp * cos(p.ph * 2);
  B.chest.rotation.y = 0.05 * amp * s;
  B.head.rotation.x = 0.15 * p.sniff + 0.04 * sin(p.t * 1.7);
  B.head.rotation.y = 0.15 * sin(p.t * 0.6) * (1 - p.sniff);
  B.tail.rotation.z = 0.5 * sin(p.t * 6) * 0.5;
  B.tail.rotation.x = -0.5;
  B.earL.rotation.x = B.earR.rotation.x = 0.1 * sin(p.ph * 2 + 1) * amp;
}
