// Mule deer and jackrabbit: procedural skinned models + pose functions.
// Model space: metres, +y up, forward = +Z (left = +X).
import * as THREE from 'three';
import { SkinBuilder, makeSkinned, TAU } from './common.js';

const S = (b) => b; // readability

/* ------------------------------------------------------------------------------------------ */
/* Mule deer                                                                                   */
/* ------------------------------------------------------------------------------------------ */
const DEER_BONES = [
  { n: 'root', p: -1, at: [0, 0.85, -0.4] },
  { n: 'chest', p: 0, at: [0, 0.85, 0.3] },
  { n: 'neck', p: 1, at: [0, 0.96, 0.5] },
  { n: 'head', p: 2, at: [0, 1.34, 0.78] },
  { n: 'earL', p: 3, at: [0.07, 1.42, 0.84] },
  { n: 'earR', p: 3, at: [-0.07, 1.42, 0.84] },
  { n: 'tail', p: 0, at: [0, 0.93, -0.66] },
  { n: 'flU', p: 1, at: [0.13, 0.78, 0.4] },
  { n: 'flL', p: 7, at: [0.12, 0.44, 0.42] },
  { n: 'frU', p: 1, at: [-0.13, 0.78, 0.4] },
  { n: 'frL', p: 9, at: [-0.12, 0.44, 0.42] },
  { n: 'blU', p: 0, at: [0.14, 0.8, -0.5] },
  { n: 'blL', p: 11, at: [0.13, 0.42, -0.62] },
  { n: 'brU', p: 0, at: [-0.14, 0.8, -0.5] },
  { n: 'brL', p: 13, at: [-0.13, 0.42, -0.62] },
];

const geoCache = {};
export function deerGeometry(buck) {
  const key = buck ? 'buck' : 'doe';
  if (geoCache[key]) return geoCache[key];
  const b = new SkinBuilder();
  const coat = 0x84694d, coatD = 0x6f5640, neckC = 0x7d6a58, belly = 0xcfc2aa, rump = 0xe4dac6, leg = 0x77603f, hoof = 0x1d1916, nose = 0x15110f, earIn = 0xb09a82;
  b.sphere(1, [0, 0.85, 0.24], coat, 1, [0.2, 0.26, 0.34], [14, 10]);
  b.sphere(1, [0, 0.81, -0.1], coat, 0, [0.19, 0.24, 0.36], [14, 10]);
  b.sphere(1, [0, 0.85, -0.45], coat, 0, [0.19, 0.26, 0.27], [14, 10]);
  b.sphere(1, [0, 0.68, -0.02], belly, 0, [0.15, 0.12, 0.4], [12, 8]);
  b.sphere(1, [0, 0.86, -0.7], rump, 0, [0.12, 0.15, 0.08], [10, 8]);
  // neck, head
  b.limb([0, 0.96, 0.48], [0, 1.36, 0.8], 0.125, 0.07, neckC, 2, 10, true);
  b.sphere(1, [0, 1.35, 0.92], neckC, 3, [0.07, 0.085, 0.14], [12, 8]);
  b.limb([0, 1.34, 0.96], [0, 1.27, 1.14], 0.058, 0.04, 0x8a7662, 3, 8, true);
  b.sphere(0.04, [0, 1.265, 1.15], nose, 3, [1, 0.8, 0.9], [8, 6]);
  for (const sx of [1, -1]) {
    b.sphere(0.014, [sx * 0.062, 1.395, 0.97], 0x0b0908, 3, [1, 1, 1], [6, 4]); // eye
    // big mule ears
    b.add(new THREE.SphereGeometry(1, 8, 6), { p: [sx * 0.15, 1.5, 0.82], r: [0.0, 0, sx * -0.75], s: [0.022, 0.11, 0.06], c: coatD, bone: sx > 0 ? 4 : 5 });
    b.add(new THREE.SphereGeometry(1, 8, 6), { p: [sx * 0.147, 1.5, 0.826], r: [0.0, 0, sx * -0.75], s: [0.012, 0.095, 0.05], c: earIn, bone: sx > 0 ? 4 : 5 });
  }
  if (buck) {
    for (const sx of [1, -1]) {
      const A = [sx * 0.05, 1.45, 0.85], B = [sx * 0.15, 1.7, 0.82], C = [sx * 0.2, 1.9, 0.86], D = [sx * 0.1, 1.95, 0.9];
      b.limb(A, B, 0.018, 0.013, 0xcdbd9c, 3, 6);
      b.limb(B, C, 0.013, 0.008, 0xcdbd9c, 3, 6);
      b.limb(B, [sx * 0.08, 1.82, 0.95], 0.011, 0.006, 0xcdbd9c, 3, 6);
      b.limb(C, D, 0.008, 0.005, 0xcdbd9c, 3, 6);
      b.limb([sx * 0.17, 1.78, 0.83], [sx * 0.28, 1.86, 0.78], 0.01, 0.005, 0xcdbd9c, 3, 6);
    }
  }
  // tail
  b.limb([0, 0.95, -0.66], [0, 0.72, -0.7], 0.035, 0.022, 0xe9e1cf, 6, 6);
  b.sphere(0.024, [0, 0.71, -0.7], 0x1a1613, 6, [1, 1.2, 1], [6, 5]);
  // legs
  for (const sx of [1, -1]) {
    const [fu, fl, bu, bl] = sx > 0 ? [7, 8, 11, 12] : [9, 10, 13, 14];
    b.limb([sx * 0.13, 0.8, 0.4], [sx * 0.12, 0.44, 0.42], 0.09, 0.05, coat, fu, 8);
    b.sphere(0.052, [sx * 0.12, 0.44, 0.42], leg, fu, [1, 1, 1], [8, 6]);
    b.limb([sx * 0.12, 0.44, 0.42], [sx * 0.11, 0.06, 0.4], 0.045, 0.028, leg, fl, 7);
    b.limb([sx * 0.11, 0.07, 0.4], [sx * 0.11, 0.0, 0.43], 0.03, 0.032, hoof, fl, 6);
    b.limb([sx * 0.14, 0.82, -0.5], [sx * 0.13, 0.42, -0.62], 0.115, 0.05, coat, bu, 8);
    b.sphere(0.055, [sx * 0.13, 0.42, -0.62], leg, bu, [1, 1, 1], [8, 6]);
    b.limb([sx * 0.13, 0.42, -0.62], [sx * 0.11, 0.06, -0.55], 0.046, 0.028, leg, bl, 7);
    b.limb([sx * 0.11, 0.07, -0.55], [sx * 0.11, 0.0, -0.52], 0.03, 0.032, hoof, bl, 6);
  }
  return (geoCache[key] = b.build());
}

export function makeDeer(mat, buck) {
  const r = makeSkinned(deerGeometry(buck), mat, DEER_BONES);
  r.h = 1.0;
  return r;
}

const sin = Math.sin, cos = Math.cos;
// p: { walk 0..1, ph (gait radians), stot 0..1, sp (stot phase 0..1), graze 0..1, alert 0..1, t, flick 0..1, lookY }
export function poseDeer(r, p) {
  const B = r.by, w = p.walk, st = p.stot;
  const a = 0.42 * w, s0 = sin(p.ph), s1 = sin(p.ph + Math.PI);
  // swing: positive = forward
  let fl = a * s0, fr = a * s1, bl = a * s1, br = a * s0;
  let fFlex = (q) => Math.max(0, sin(q + 0.8)) * 0.85 * w, bFlex = (q) => Math.max(0, sin(q + 0.8)) * 0.7 * w;
  let kFL = fFlex(p.ph), kFR = fFlex(p.ph + Math.PI), kBL = bFlex(p.ph + Math.PI), kBR = bFlex(p.ph);
  let dy = 0.02 * w * Math.abs(sin(p.ph)), pitch = 0, chestP = 0;
  if (st > 0) {
    const t = p.sp, air = sin(Math.PI * t); // 0 at contact, 1 at apex
    const push = Math.max(0, 1 - t * 4) , land = Math.max(0, (t - 0.8) * 5);
    dy = dy * (1 - st) + st * (0.62 * air);
    pitch = st * (0.22 * cos(Math.PI * t) * -1 + 0.04);
    const tuckF = air * 0.9, tuckB = air * 0.7;
    fl = fl * (1 - st) + st * (0.5 * air - 0.35 * push);
    fr = fl; // stotting: both pairs together
    bl = bl * (1 - st) + st * (-0.45 * air + 0.5 * push);
    br = bl;
    kFL = kFL * (1 - st) + st * (tuckF + 0.25 * land);
    kFR = kFL;
    kBL = kBL * (1 - st) + st * (tuckB);
    kBR = kBL;
  }
  B.root.position.y = 0.85 + dy;
  B.root.rotation.x = pitch + 0.03 * sin(p.ph * 2) * w;
  B.root.rotation.y = 0.04 * s0 * w;
  const g = p.graze;
  B.chest.rotation.x = chestP + 0.22 * g - 0.03 * sin(p.ph * 2) * w;
  B.flU.rotation.x = -fl + 0.28 * g; B.frU.rotation.x = -fr + 0.28 * g;
  B.blU.rotation.x = -bl; B.brU.rotation.x = -br;
  B.flL.rotation.x = kFL - 0.45 * g; B.frL.rotation.x = kFR - 0.45 * g;
  B.blL.rotation.x = kBL; B.brL.rotation.x = kBR;
  // head and neck: alert (up), relaxed, grazing (down); neck stretches forward when running
  const chew = sin(p.t * 9) * 0.04 * g;
  const nx = -0.12 * p.alert + 1.42 * g - 0.25 * st * 0 + 0.1 * sin(p.t * 0.7);
  B.neck.rotation.x = nx * (g > 0 ? 1 : 1) + 0.08 * sin(p.ph * 2) * w * (1 - g);
  B.neck.rotation.y = p.lookY * (1 - g * 0.6);
  B.head.rotation.x = 0.42 * g + chew - 0.06 * p.alert + (st > 0 ? 0.16 * st : 0);
  B.head.rotation.y = p.lookY * 0.4;
  // ears: independent swivels, flatten when running
  const e1 = sin(p.t * 1.3) * 0.12 + (p.flick > 0 ? sin(p.flick * 30) * 0.4 * p.flick : 0);
  B.earL.rotation.z = 0.15 + e1 + 0.15 * p.alert; B.earR.rotation.z = -0.15 - sin(p.t * 1.1 + 2) * 0.12 - 0.15 * p.alert;
  B.earL.rotation.x = B.earR.rotation.x = -0.5 * st - 0.2 * g + 0.25 * p.alert;
  B.tail.rotation.x = 0.2 * sin(p.t * 3) * (1 - st) * (p.flick > 0 ? 1 : 0.25) - 0.6 * st;
}

/* ------------------------------------------------------------------------------------------ */
/* Black-tailed jackrabbit                                                                     */
/* ------------------------------------------------------------------------------------------ */
const HARE_BONES = [
  { n: 'root', p: -1, at: [0, 0.2, -0.12] },
  { n: 'chest', p: 0, at: [0, 0.22, 0.08] },
  { n: 'head', p: 1, at: [0, 0.29, 0.2] },
  { n: 'earL', p: 2, at: [0.03, 0.34, 0.2] },
  { n: 'earR', p: 2, at: [-0.03, 0.34, 0.2] },
  { n: 'fore', p: 1, at: [0, 0.16, 0.14] },
  { n: 'hind', p: 0, at: [0, 0.2, -0.18] },
  { n: 'tail', p: 0, at: [0, 0.22, -0.3] },
];
let hareGeo = null;
export function makeHare(mat) {
  if (!hareGeo) {
    const b = new SkinBuilder();
    const fur = 0x9a8460, furD = 0x6f5d44, belly = 0xd8cdb6, tip = 0x241d17;
    b.sphere(1, [0, 0.22, 0.06], fur, 1, [0.075, 0.09, 0.15], [10, 8]);
    b.sphere(1, [0, 0.21, -0.12], fur, 0, [0.09, 0.105, 0.16], [10, 8]);
    b.sphere(1, [0, 0.17, -0.02], belly, 0, [0.06, 0.05, 0.2], [8, 6]);
    b.limb([0, 0.25, 0.14], [0, 0.31, 0.22], 0.06, 0.045, fur, 2, 8, true);
    b.sphere(1, [0, 0.32, 0.26], fur, 2, [0.05, 0.055, 0.085], [10, 8]);
    b.sphere(0.022, [0, 0.31, 0.34], 0x1a1410, 2, [1, 0.8, 1], [6, 5]);
    for (const sx of [1, -1]) {
      b.sphere(0.011, [sx * 0.04, 0.34, 0.27], 0x0a0705, 2, [1, 1, 1], [6, 4]);
      b.add(new THREE.SphereGeometry(1, 8, 6), { p: [sx * 0.04, 0.46, 0.2], r: [-0.15, 0, sx * -0.12], s: [0.018, 0.13, 0.04], c: furD, bone: sx > 0 ? 3 : 4 });
      b.add(new THREE.SphereGeometry(1, 8, 6), { p: [sx * 0.04, 0.5, 0.195], r: [-0.15, 0, sx * -0.12], s: [0.012, 0.06, 0.03], c: tip, bone: sx > 0 ? 3 : 4 });
      b.limb([sx * 0.04, 0.17, 0.14], [sx * 0.035, 0.02, 0.2], 0.026, 0.014, fur, 5, 6);
      b.limb([sx * 0.07, 0.22, -0.2], [sx * 0.07, 0.07, -0.12], 0.05, 0.03, fur, 6, 6);
      b.limb([sx * 0.07, 0.07, -0.14], [sx * 0.065, 0.015, 0.0], 0.024, 0.014, furD, 6, 6);
    }
    b.limb([0, 0.25, -0.26], [0, 0.26, -0.37], 0.03, 0.02, tip, 7, 6);
    hareGeo = b.build();
  }
  const r = makeSkinned(hareGeo, mat, HARE_BONES);
  r.h = 0.45;
  return r;
}
// p: { run 0..1, sp 0..1 (bound phase), sit 0..1, t }
export function poseHare(r, p) {
  const B = r.by, run = p.run, t = p.sp, air = sin(Math.PI * t);
  B.root.position.y = 0.2 + run * 0.38 * air;
  B.root.rotation.x = run * (0.34 * cos(Math.PI * t) * -1) - 0.12 * (1 - run) * p.sit;
  B.chest.rotation.x = run * 0.1 * sin(TAU * t);
  // hind legs reach forward in the air, then drive back; forelegs reach out front
  B.hind.rotation.x = run * (-1.1 * (air - 0.35) * 1.2) + 0.7 * p.sit;
  B.fore.rotation.x = run * (-0.9 * cos(TAU * t)) * 0.9 - 0.2 * p.sit;
  B.head.rotation.x = run * (-0.1) + 0.04 * sin(p.t * 5) * (1 - run) + (0.0);
  B.earL.rotation.x = B.earR.rotation.x = -run * 0.9 + 0.1 * sin(p.t * 1.7);
  B.earL.rotation.z = 0.12 + (1 - run) * 0.12 * sin(p.t * 0.9) ; B.earR.rotation.z = -0.12 - (1 - run) * 0.1 * sin(p.t * 1.2 + 1);
  B.tail.rotation.x = -0.3 * run;
}
