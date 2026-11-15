import * as THREE from 'three';
import { lon2tx, lat2ty, tx2lon, ty2lat } from './geo.js';
import { buildProps } from './building-props.js';
import { BASE } from './paths.js';

// Real OpenStreetMap buildings (baked by scripts/bake-buildings.mjs) as extruded footprints with a
// procedural facade shader. One merged mesh per z15 tile; geometry is built in small time slices.
//
// Record layout (Float32): [seed, code, colour, base, minH, topH, nRings, (ringLen, x0, z0, x1, z1 ...)*]
const SINK = 1.5; // must match the baker
const LOAD_R = 1700; // metres: tiles whose rectangle is closer than this get loaded
const DROP_R = 2100;
const SLICE_MS = 2.5;

// ---------- material families ----------
// kind: 0 punched windows, 1 ribbon / curtain wall, 2 mansard + balconies, 3 industrial cladding
const F = (o) => ({ floor: 3.4, gf: 4.6, corn: 1.0, winW: 0.5, winH: 0.6, kind: 0, lit: 0.35, present: 1, course: 0, cstr: 0, speck: 0, bay: 3.2, roof: 0x5c5a58, trim: 0xd8d0be, glass: 0x28323c, ...o });
const FAMILIES = {
  limestone: F({ wall: 0xcfc3a8, trim: 0xe4dcc8, winW: 0.46, winH: 0.66, course: 0.6, cstr: 0.22, speck: 0.05, bay: 3.2, roof: 0x77716a }),
  portland: F({ wall: 0xc9c1ae, trim: 0xe6e0d0, winW: 0.44, winH: 0.68, floor: 3.6, gf: 5, corn: 1.3, course: 0.7, cstr: 0.2, speck: 0.05, bay: 3.4, roof: 0x6d6a66 }),
  brick: F({ wall: 0x8c4f3c, trim: 0xcfc4ae, winW: 0.42, winH: 0.62, course: 0.075, cstr: 0.12, speck: 0.28, bay: 3.0, roof: 0x5a5551 }),
  darkbrick: F({ wall: 0x5f4339, trim: 0xb8ac98, winW: 0.4, winH: 0.6, course: 0.075, cstr: 0.12, speck: 0.3, bay: 2.9, roof: 0x4d4a48 }),
  tanbrick: F({ wall: 0xa77d5a, trim: 0xd6cbb5, winW: 0.4, winH: 0.64, course: 0.075, cstr: 0.12, speck: 0.26, bay: 3.0, roof: 0x5a5551 }),
  glassDark: F({ wall: 0x2a343d, trim: 0x59636b, glass: 0x1a2733, kind: 1, winW: 0.9, winH: 0.66, floor: 4.0, gf: 5.5, corn: 1.6, bay: 1.5, lit: 0.42, roof: 0x55585a, present: 1 }),
  glassBlue: F({ wall: 0x3f5666, trim: 0x8a9aa3, glass: 0x35566b, kind: 1, winW: 0.9, winH: 0.7, floor: 4.0, gf: 5.5, corn: 1.6, bay: 1.5, lit: 0.4, roof: 0x5e6264, present: 1 }),
  glassGreen: F({ wall: 0x3a5650, trim: 0x8d9d98, glass: 0x2f5a58, kind: 1, winW: 0.9, winH: 0.66, floor: 3.9, gf: 5.2, corn: 1.5, bay: 1.5, lit: 0.4, roof: 0x5a5e5e, present: 1 }),
  concrete: F({ wall: 0x8e8c85, trim: 0xb2afa6, winW: 0.62, winH: 0.5, floor: 3.6, gf: 5, corn: 0.8, course: 2.4, cstr: 0.14, speck: 0.1, bay: 3.8, lit: 0.35, roof: 0x4f4e4c }),
  stucco: F({ wall: 0xcbbea4, trim: 0xe0d9c6, winW: 0.4, winH: 0.58, floor: 3.2, gf: 4.0, corn: 0.8, speck: 0.07, course: 0.5, cstr: 0.06, bay: 3.4, roof: 0x706c66 }),
  industrial: F({ wall: 0x9ca1a2, trim: 0x6c7274, kind: 3, winW: 0.8, winH: 0.22, floor: 5.5, gf: 5.5, corn: 0.5, present: 0.35, lit: 0.12, course: 1.2, cstr: 0.1, speck: 0.05, bay: 4.5, roof: 0x6a6c6c }),
  haussmann: F({ wall: 0xcdbf9c, trim: 0xded4b9, kind: 2, winW: 0.38, winH: 0.82, floor: 3.2, gf: 4.6, corn: 3.4, course: 0.62, cstr: 0.2, speck: 0.05, bay: 2.9, lit: 0.34, roof: 0x4c545c }),
  house: F({ wall: 0xcdc3ae, trim: 0xe2ddcf, winW: 0.34, winH: 0.5, floor: 2.8, gf: 3.0, corn: 0.5, lit: 0.3, speck: 0.08, bay: 3.4, roof: 0x7a5a4c }),
  civic: F({ wall: 0xb9a98c, trim: 0xd8cdb2, winW: 0.3, winH: 0.72, floor: 4.6, gf: 5.5, corn: 1.2, course: 0.55, cstr: 0.25, speck: 0.08, bay: 4.2, lit: 0.2, roof: 0x5e6460 }),
  grandstand: F({ wall: 0xb4b4b0, trim: 0x8a8a88, kind: 1, winW: 0.88, winH: 0.32, floor: 3.6, gf: 4.2, corn: 0.6, bay: 3.0, lit: 0.25, glass: 0x303a42, roof: 0x7e8284, course: 1.8, cstr: 0.1 }),
  stuccoPastel: F({ wall: 0xe0c7a4, trim: 0xf1e6d0, winW: 0.38, winH: 0.6, floor: 3.1, gf: 3.8, corn: 0.8, speck: 0.07, course: 0.5, cstr: 0.05, bay: 3.2, roof: 0x8a5f4a }),
  modernWhite: F({ wall: 0xcdcbc3, trim: 0xe4e2dc, winW: 0.6, winH: 0.55, floor: 3.4, gf: 4.0, corn: 0.8, speck: 0.04, bay: 3.6, roof: 0x6c6c6a }),
  // Manhattan types (appended so existing family ids stay put). The shader keys extra detail off these ids:
  // prewar = rusticated base + string courses + heavy bracketed cornice, tenement = brick with stone lintels,
  // deco = piers with dark spandrels, glassMid = aluminium mullions + spandrel bands, glassMirror = reflective glass.
  prewar: F({ wall: 0xd4c7a4, trim: 0xe8e0c8, winW: 0.44, winH: 0.66, floor: 3.5, gf: 5.2, corn: 1.8, course: 0.6, cstr: 0.2, speck: 0.06, bay: 3.2, roof: 0x77716a }),
  tenement: F({ wall: 0x7a4633, trim: 0xcfc3a8, winW: 0.4, winH: 0.62, floor: 3.0, gf: 3.8, corn: 1.5, course: 0.075, cstr: 0.14, speck: 0.32, bay: 2.8, lit: 0.4, roof: 0x4d4a48 }),
  tenement2: F({ wall: 0x8a5740, trim: 0xd2c7ae, winW: 0.4, winH: 0.62, floor: 3.0, gf: 3.8, corn: 1.5, course: 0.075, cstr: 0.14, speck: 0.3, bay: 3.0, lit: 0.4, roof: 0x4f4c4a }),
  deco: F({ wall: 0xa08868, trim: 0xc8b998, winW: 0.5, winH: 0.8, floor: 3.7, gf: 5.0, corn: 1.4, course: 0.075, cstr: 0.1, speck: 0.2, bay: 2.8, lit: 0.42, roof: 0x5e5a55 }),
  glassMid: F({ wall: 0x6f7e79, trim: 0xa9b2b0, glass: 0x3c5a58, kind: 1, winW: 0.9, winH: 0.56, floor: 3.9, gf: 5.2, corn: 1.2, bay: 1.4, lit: 0.5, roof: 0x5a5e5e }),
  glassMirror: F({ wall: 0x2c3a46, trim: 0x6a7780, glass: 0x20384c, kind: 1, winW: 0.94, winH: 0.78, floor: 4.0, gf: 5.8, corn: 1.4, bay: 1.8, lit: 0.52, roof: 0x55585a }),
};
const FNAMES = Object.keys(FAMILIES);
const FID = Object.fromEntries(FNAMES.map((n, i) => [n, i]));

// city personalities: weighted picks per height class. classes: tower (>=110), high (50-110), mid (20-50), low (<20)
const CITY = {
  manhattan: {
    tower: [['glassMirror', 3], ['glassMid', 2], ['prewar', 2], ['deco', 2], ['glassDark', 1], ['glassBlue', 1], ['limestone', 1], ['concrete', 1]],
    high: [['prewar', 3], ['tenement', 2], ['deco', 2], ['glassMid', 2], ['glassMirror', 1], ['brick', 1], ['limestone', 1], ['tanbrick', 1], ['concrete', 1]],
    mid: [['tenement', 3], ['tenement2', 3], ['prewar', 3], ['brick', 2], ['deco', 1], ['darkbrick', 1], ['glassMid', 1], ['limestone', 1], ['tanbrick', 1]],
    low: [['tenement', 4], ['tenement2', 3], ['brick', 2], ['darkbrick', 1], ['prewar', 1], ['tanbrick', 1], ['stucco', 1]],
    tint: 0.1,
  },
  paris: {
    tower: [['glassBlue', 2], ['concrete', 2], ['glassDark', 1]],
    high: [['concrete', 2], ['glassBlue', 1], ['limestone', 2]],
    mid: [['haussmann', 8], ['limestone', 2], ['stucco', 1]],
    low: [['haussmann', 6], ['limestone', 2], ['stucco', 2]],
    tint: 0.05,
  },
  london: {
    tower: [['glassBlue', 3], ['glassDark', 2], ['concrete', 1], ['glassGreen', 1]],
    high: [['concrete', 2], ['glassBlue', 2], ['portland', 2], ['brick', 1]],
    mid: [['brick', 4], ['portland', 3], ['tanbrick', 2], ['darkbrick', 1], ['stucco', 1]],
    low: [['brick', 5], ['tanbrick', 2], ['darkbrick', 1], ['stucco', 2], ['portland', 1]],
    tint: 0.1,
  },
  la: {
    tower: [['glassBlue', 3], ['glassDark', 2], ['glassGreen', 1], ['concrete', 1]],
    high: [['glassBlue', 2], ['concrete', 3], ['glassDark', 1]],
    mid: [['stucco', 4], ['concrete', 3], ['modernWhite', 2], ['glassBlue', 1], ['tanbrick', 1]],
    low: [['stucco', 6], ['modernWhite', 2], ['concrete', 2], ['brick', 1], ['tanbrick', 1]],
    tint: 0.12,
  },
  monaco: {
    tower: [['glassBlue', 2], ['modernWhite', 2], ['limestone', 2]],
    high: [['modernWhite', 3], ['stuccoPastel', 3], ['limestone', 2], ['glassBlue', 1]],
    mid: [['stuccoPastel', 5], ['limestone', 3], ['modernWhite', 2]],
    low: [['stuccoPastel', 5], ['limestone', 2], ['modernWhite', 2], ['house', 1]],
    tint: 0.1,
  },
  spa: {
    tower: [['concrete', 1]], high: [['concrete', 2], ['brick', 1]],
    mid: [['brick', 3], ['stucco', 2], ['concrete', 1]],
    low: [['house', 4], ['brick', 3], ['stucco', 2], ['tanbrick', 1]],
    tint: 0.1,
  },
  silverstone: {
    tower: [['concrete', 1]], high: [['concrete', 2]],
    mid: [['concrete', 3], ['brick', 2], ['modernWhite', 2]],
    low: [['house', 2], ['brick', 3], ['concrete', 2], ['modernWhite', 2]],
    tint: 0.1,
  },
};
const DEFAULT_CITY = CITY.london;

function hash32(n) { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
function pickWeighted(list, r) {
  let tot = 0;
  for (const e of list) tot += e[1];
  r *= tot;
  for (const e of list) { r -= e[1]; if (r <= 0) return e[0]; }
  return list[list.length - 1][0];
}

const sRGB = (hex) => new THREE.Color(hex);
const NFAM = FNAMES.length;

function makeFamUniform() {
  const arr = [];
  for (const n of FNAMES) {
    const f = FAMILIES[n];
    const w = sRGB(f.wall), t = sRGB(f.trim);
    if (f.kind !== 1) { w.multiplyScalar(0.8); t.multiplyScalar(0.85); }
    const g = sRGB(f.glass), r = sRGB(f.roof);
    arr.push(
      new THREE.Vector4(w.r, w.g, w.b, f.floor),
      new THREE.Vector4(g.r, g.g, g.b, f.winW),
      new THREE.Vector4(t.r, t.g, t.b, f.winH),
      new THREE.Vector4(f.kind, f.gf, f.corn, f.lit),
      new THREE.Vector4(r.r, r.g, r.b, f.present),
      new THREE.Vector4(f.course, f.cstr, f.speck, f.bay),
    );
  }
  return arr;
}
const FAMSTRIDE = 6;

// ---------- facade shader ----------
const VERT_DECL = /* glsl */ `
attribute vec2 aW;
attribute vec4 aInfo;
attribute vec3 aTint;
varying vec2 vW;
varying vec4 vInfo;
varying vec3 vTint;
varying float vRoof;
`;
const FRAG_DECL = /* glsl */ `
uniform vec4 uFam[${NFAM * FAMSTRIDE}];
uniform float uNight;
uniform float uWet;
uniform float uSnow;
uniform float uNY; // 1 for Manhattan: gates the grime / variety / shopfront / night additions
varying vec2 vW;
varying vec4 vInfo;
varying vec3 vTint;
varying float vRoof;
float bh21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// rain smear hanging from a window sill: dy = distance below the sill in floors, id picks column/length
float rainStreak(vec2 id, float seed, float pr, float fx, float dy, float x0, float x1, float wu) {
  float a = bh21(id * 1.9 + seed * 13.0 + 3.0);
  float b = bh21(id * 0.8 + seed * 5.0 + 9.0);
  float sx = mix(x0 + 0.02, x1 - 0.02, a);
  float len = 0.25 + 1.5 * b * b;
  float xm = 1.0 - clamp((abs(fx - sx) - 0.018) / (wu + 1e-4) + 0.5, 0.0, 1.0);
  float ym = step(0.0, dy) * (1.0 - smoothstep(0.0, len, dy));
  float on = step(0.45, b) * step(bh21(vec2(id.x + seed * 733.0, id.y)), pr);
  return xm * ym * on;
}
float cov(float x, float lo, float hi, float w) { w = max(w, 1e-4); return clamp((x - lo) / w + 0.5, 0.0, 1.0) * clamp((hi - x) / w + 0.5, 0.0, 1.0); }
`;
const FRAG_MAIN = /* glsl */ `
#include <map_fragment>
float gWin = 0.0;
vec3 gEmis = vec3(0.0);
{
  int fid = int(vInfo.y + 0.5);
  int fb = fid * ${FAMSTRIDE};
  bool fPre = fid == ${FID.prewar};
  bool fTen = fid == ${FID.tenement} || fid == ${FID.tenement2};
  bool fDeco = fid == ${FID.deco};
  bool fMid = fid == ${FID.glassMid};
  bool fMir = fid == ${FID.glassMirror};
  vec4 A = uFam[fb], B = uFam[fb + 1], C = uFam[fb + 2], D = uFam[fb + 3], E = uFam[fb + 4], G = uFam[fb + 5];
  float seed = vInfo.x, H = vInfo.z, fh = max(vInfo.w, 0.5);
  if (vRoof > 0.5) {
    vec2 c = vW / 6.0;
    float fw = max(fwidth(c.x), fwidth(c.y));
    float n = bh21(floor(c) + seed * 91.0);
    float n2 = bh21(floor(vW / 1.7) + seed * 17.0);
    float fade = 1.0 - smoothstep(0.25, 0.9, fw);
    vec3 col = E.rgb * vTint * (1.0 + ((n - 0.5) * 0.3 + (n2 - 0.5) * 0.1) * fade);
    col = mix(col, vec3(0.74, 0.78, 0.84), uSnow * 0.88);
    col *= 1.0 - 0.3 * uWet;
    diffuseColor.rgb = col;
  } else {
    float u = vW.x, v = vW.y;
    float kind = D.x, corn = D.z;
    float gf = min(D.y, max(H - corn, 0.5));
    float wu = fwidth(u) + 1e-5, wv = fwidth(v) + 1e-5;
    float pp = max(wu, wv / fh);
    float k = smoothstep(0.2, 0.55, pp);
    float vy = max(v - gf, 0.0);
    float fi = floor(vy / fh), fy = fract(vy / fh);
    float bi = floor(u), fx = fract(u);
    bool ground = v < gf;
    bool top = v > H - corn;
    float hw = bh21(vec2(bi + seed * 733.0, fi + (ground ? 57.0 : 0.0)));
    float hw2 = bh21(vec2(bi * 1.7 + seed * 311.0, fi * 3.1 + 5.0));
    float hw3 = bh21(vec2(bi * 0.37 + seed * 53.0, fi * 1.3 + 11.0));
    vec3 wall = A.rgb * vTint;
    // masonry coursing / speckle, fades out as courses shrink below a few pixels
    if (G.x > 0.0) {
      float cf = wv / G.x;
      float fc = 1.0 - smoothstep(0.1, 0.4, cf);
      float cl = smoothstep(0.0, 0.14 + cf, fract(v / G.x));
      wall *= 1.0 - (1.0 - cl) * G.y * fc;
      float sp = bh21(floor(vec2(u * G.w / (G.x * 2.6), v / G.x)) + seed * 50.0);
      wall *= 1.0 + (sp - 0.5) * G.z * 2.0 * fc;
    }
    float bandN = bh21(vec2(floor(v / 7.0) + seed * 19.0, 3.0));
    wall *= 1.0 + (bandN - 0.5) * 0.05;
    float kk = 1.0 - k;
    float mas = ((kind > 0.5 && kind < 1.5) ? 0.0 : 1.0) * uNY; // curtain walls neither soot nor streak
    // older masonry: per-bay / per-floor colour drift plus darker blotches, averaged out with distance
    float bayV = bh21(vec2(bi + seed * 211.0, 9.0));
    float flV = bh21(vec2(fi + seed * 97.0, 17.0 + (ground ? 5.0 : 0.0)));
    float blot = bh21(floor(vec2(u * 0.6, v / 4.5)) + seed * 41.0);
    wall *= 1.0 + ((bayV - 0.5) * 0.07 + (flV - 0.5) * 0.06) * mas * kk;
    wall *= 1.0 - 0.15 * mix(step(0.6, blot), 0.4, k) * mas;
    // pre-war limestone: rusticated grooves on the ground and first floor
    if (fPre) {
      float rb = wv / 0.9;
      float rf = 1.0 - smoothstep(0.1, 0.4, rb);
      wall *= 1.0 - 0.24 * (1.0 - smoothstep(0.0, 0.1 + rb, fract(v / 0.9))) * rf * (1.0 - step(gf + fh, v));
    }
    vec3 trim = C.rgb;
    vec3 glass = B.rgb;
    vec3 col = wall;
    float win = 0.0;       // window coverage (0..1) used for glass blending
    float litCell = 0.0;   // which window cells are lit
    float wy0 = 0.0, wy1 = 1.0, wyc = 0.5;
    float blind = 0.0, winDim = 1.0;
    vec3 blindCol = vec3(0.7);
    // ---------- window rectangle in cell fractions ----------
    float x0 = 0.5 - B.w * 0.5, x1 = 0.5 + B.w * 0.5;
    float h0 = (1.0 - C.w) * 0.5 - 0.04, h1 = h0 + C.w;
    float avgWin = B.w * C.w;
    if (!top && !ground) {
      float present = step(hw, E.w);
      float cx = cov(fx, x0, x1, wu);
      float cy = cov(fy, h0, h1, wv / fh);
      win = cx * cy * present;
      avgWin *= E.w;
      // frame, sill and lintel shadow (punched kinds)
      if (kind < 1.5 || kind > 2.5) {
        float fr = cov(fx, x0 - 0.04, x1 + 0.04, wu) * cov(fy, h0 - 0.03, h1 + 0.03, wv / fh) * present;
        col = mix(col, trim, clamp(fr - win, 0.0, 1.0) * (1.0 - k) * 0.85);
        float sill = cov(fx, x0 - 0.07, x1 + 0.07, wu) * cov(fy, h0 - 0.075, h0 - 0.02, wv / fh) * present;
        col = mix(col, trim * 1.06, sill * (1.0 - k));
        float lint = cov(fx, x0, x1, wu) * cov(fy, h1 + 0.03, h1 + 0.1, wv / fh) * present;
        col *= 1.0 - 0.28 * lint * (1.0 - k);
        // tenement: cream stone lintel over each window
        if (fTen) {
          float sl = cov(fx, x0 - 0.08, x1 + 0.08, wu) * cov(fy, h1 + 0.01, h1 + 0.1, wv / fh) * present;
          col = mix(col, trim, sl * 0.9 * kk);
        }
      } else if (kind > 0.5 && kind < 1.5) {
        // ribbon: spandrel band is the wall, mullions are the gaps; stringer line at floor edge
        float st = cov(fy, 0.0, 0.07, wv / fh);
        col = mix(col, trim, st * 0.6 * (1.0 - k));
      }
      if (kind > 1.5 && kind < 2.5) {
        // haussmann: tall windows, wrought-iron balcony at the second and the second-to-last floor
        float nF = max(floor((H - gf - corn) / fh + 0.5), 1.0);
        float bal = step(fi, 0.5) + step(abs(fi - (nF - 2.0)), 0.5) * step(2.5, nF);
        float rail = cov(fy, 0.04, 0.3, wv / fh) * cov(fx, x0 - 0.12, x1 + 0.12, wu);
        float railBars = mix(1.0, 0.45 + 0.55 * step(0.5, fract(u * 9.0)), 1.0 - smoothstep(0.03, 0.1, wu * 9.0));
        col = mix(col, vec3(0.025, 0.027, 0.03), clamp(bal, 0.0, 1.0) * rail * 0.82 * railBars * (1.0 - k) * present);
        float belt = cov(fy, 0.0, 0.05, wv / fh);
        col = mix(col, trim, belt * clamp(bal, 0.0, 1.0) * (1.0 - k) * 0.8);
      }
      // glazing bars
      if (kind < 0.5 || (kind > 1.5 && kind < 2.5)) {
        float bf = 1.0 - smoothstep(0.04, 0.1, pp);
        float bw = 0.022 / max(B.w, 0.2);
        float barx = 1.0 - clamp((abs(fx - 0.5) - 0.012) / wu + 0.5, 0.0, 1.0);
        float bary = 1.0 - clamp((abs(fy - (h0 + h1) * 0.5) - 0.012) / (wv / fh) + 0.5, 0.0, 1.0);
        float bary2 = 1.0 - clamp((abs(fy - mix(h0, h1, 0.8)) - 0.01) / (wv / fh) + 0.5, 0.0, 1.0);
        float bars = max(barx, max(bary, kind > 0.5 ? 0.0 : bary2)) * bf;
        win *= 1.0 - bars * 0.8;
      }
      wy0 = h0; wy1 = h1; wyc = clamp((fy - h0) / (h1 - h0), 0.0, 1.0);
      litCell = present;
      // pre-war string course every fourth floor line
      if (fPre) {
        float scf = step(mod(fi, 4.0), 0.5);
        col = mix(col, trim * 1.08, scf * cov(fy, 0.0, 0.09, wv / fh) * 0.85 * kk);
        col *= 1.0 - 0.18 * scf * cov(fy, 0.09, 0.14, wv / fh) * kk;
      }
      // art deco: continuous window strips, lighter piers between them, dark spandrels
      if (fDeco) {
        float pier = 1.0 - cov(fx, x0 - 0.06, x1 + 0.06, wu);
        col = mix(col, trim * 0.96, pier * 0.4 * kk);
        float spn = cov(fx, x0 - 0.04, x1 + 0.04, wu) * (1.0 - cov(fy, h0 - 0.02, h1 + 0.02, wv / fh));
        col *= 1.0 - 0.4 * spn * kk;
      }
      // mid-century: aluminium mullions and a visible spandrel band
      if (fMid) {
        float mu = (1.0 - cov(fx, x0, x1, wu)) * cov(fy, h0, h1, wv / fh);
        col = mix(col, trim * 0.85, mu * 0.75 * kk);
        float sp2 = 1.0 - cov(fy, h0 - 0.01, h1 + 0.01, wv / fh);
        col = mix(col, mix(wall, trim, 0.22), sp2 * 0.8 * kk);
      }
      // ---- per-window ageing and variety (stable hashes, faded by k) ----
      float hv1 = bh21(vec2(bi * 1.3 + seed * 17.0, fi * 2.7 + 31.0));
      float hv2 = bh21(vec2(bi * 0.7 + seed * 29.0, fi * 0.9 + 47.0));
      float hAC = bh21(vec2(bi * 3.1 + seed * 7.0, fi * 1.1 + 71.0));
      float isPun = kind < 0.5 ? 1.0 : 0.0;
      // blinds / curtains cover the top 20-70% of the pane
      float hasB = step(hv1, isPun > 0.5 ? 0.42 : 0.16);
      float bDepth = 0.2 + 0.5 * fract(hv1 * 91.7);
      blind = hasB * step(1.0 - bDepth, wyc) * present * uNY;
      vec3 bcA = mix(vec3(0.82, 0.78, 0.66), vec3(0.66, 0.7, 0.76), step(0.5, fract(hv2 * 53.1)));
      blindCol = mix(bcA, vec3(0.55, 0.3, 0.27), step(0.86, fract(hv2 * 31.7)));
      // a few panes read dark, a few catch the sky
      float dv = fract(hv2 * 13.7);
      winDim = mix(1.0, mix(1.0 - 0.45 * step(0.88, dv) + 0.7 * step(dv, 0.1), 1.0, k), uNY);
      // window air conditioners on punched-window masonry: grey box with a shadow line under it
      float acOn = isPun * step(hAC, 0.2) * present * kk * uNY;
      float acm = cov(fx, x0 + 0.04, x1 - 0.04, wu) * cov(fy, h0 + 0.02, h0 + (h1 - h0) * 0.4, wv / fh) * acOn;
      float acs = cov(fx, x0, x1, wu) * cov(fy, h0 - 0.06, h0 + 0.01, wv / fh) * acOn;
      win *= 1.0 - acm;
      col = mix(col, vec3(0.6, 0.62, 0.62) * (0.9 + 0.2 * hv2), acm);
      col *= 1.0 - 0.5 * acs * (1.0 - acm);
      // rain streaks below sills: this floor's sill and the one above it
      float stk = max(rainStreak(vec2(bi, fi), seed, E.w, fx, (h0 - 0.02) - fy, x0, x1, wu),
                      rainStreak(vec2(bi, fi + 1.0), seed, E.w, fx, (h0 + 0.98) - fy, x0, x1, wu) * step(v + fh, H - corn));
      col *= 1.0 - 0.2 * stk * mas * kk;
    } else if (ground) {
      // shopfront: pilasters, big glazing, fascia band; plinth below
      float gy = v / gf;
      float gx0 = kind > 0.5 && kind < 1.5 ? 0.04 : 0.07;
      float cx = cov(fx, gx0, 1.0 - gx0, wu);
      float cy = cov(gy, 0.12, 0.74, wv / gf);
      win = cx * cy;
      avgWin = (1.0 - 2.0 * gx0) * 0.62;
      if (kind > 2.5) { win *= step(hw, 0.3); avgWin *= 0.3; }
      float fascia = cov(gy, 0.78, 0.95, wv / gf) * cov(fx, 0.03, 0.97, wu);
      // NYC fascia palette per shop (a shop spans two bays); gold lettering as noise strips
      float shop = bh21(vec2(floor(bi * 0.5) + seed * 43.0, 77.0));
      vec3 fc = vec3(0.03, 0.03, 0.035);
      fc = mix(fc, vec3(0.04, 0.17, 0.09), step(0.16, shop));
      fc = mix(fc, vec3(0.3, 0.05, 0.09), step(0.34, shop));
      fc = mix(fc, vec3(0.05, 0.08, 0.22), step(0.52, shop));
      fc = mix(fc, vec3(0.4, 0.33, 0.24), step(0.68, shop));
      fc = mix(fc, vec3(0.02, 0.02, 0.025), step(0.82, shop));
      vec3 fcOld = mix(vec3(0.05, 0.05, 0.06), vec3(0.2, 0.06 + hw2 * 0.15, 0.04 + hw3 * 0.2), step(0.55, hw3)) * (kind > 2.5 ? 0.0 : 1.0);
      vec3 colOld = mix(col, fcOld * 0.8 + trim * 0.05, fascia * (1.0 - k) * step(kind, 2.5));
      col = mix(colOld, mix(col, fc * 0.85 + trim * 0.04, fascia * kk * step(kind, 2.5)), uNY);
      float lett = cov(gy, 0.82, 0.9, wv / gf) * cov(fx, 0.12, 0.88, wu) * step(0.45, bh21(vec2(floor(u * 16.0) + seed * 9.0, floor(shop * 9.0))));
      col = mix(col, vec3(0.72, 0.58, 0.22), lett * 0.65 * uNY * (1.0 - smoothstep(0.03, 0.1, pp)) * step(kind, 2.5));
      float plinth = 1.0 - smoothstep(0.35, 0.7, v);
      col = mix(col, trim * 0.55, plinth * 0.5);
      // mullions in the shop glass
      float mull = 1.0 - clamp((abs(fract(u * 2.0) - 0.5) - 0.012) / (wu * 2.0) + 0.5, 0.0, 1.0);
      win *= 1.0 - mull * 0.7 * (1.0 - smoothstep(0.05, 0.12, pp)) * step(kind, 1.5);
      // dark recessed doorway now and then
      float doorM = cov(fx, 0.22, 0.78, wu) * cov(gy, 0.0, 0.7, wv / gf) * step(hw2, 0.13) * step(kind, 2.5) * uNY;
      win *= 1.0 - doorM;
      col = mix(col, vec3(0.03, 0.026, 0.024), doorM * 0.92 * kk);
      wy0 = 0.12; wy1 = 0.74; wyc = clamp((gy - 0.12) / 0.62, 0.0, 1.0);
      litCell = 1.0;
      // Haussmann rustication / stone ground floor reads slightly darker
      col *= 0.96;
    } else {
      // roofline: cornice / mansard
      float tz = (v - (H - corn)) / max(corn, 0.01);
      if (kind > 1.5 && kind < 2.5) {
        vec3 zinc = vec3(0.075, 0.082, 0.095) * (0.85 + 0.3 * vTint.g);
        col = zinc;
        // dormers every other bay
        float dm = step(0.5, fract(bi * 0.5 + 0.25 + 0.5 * step(0.5, fract(seed * 7.0))));
        float dx = cov(fx, 0.3, 0.7, wu), dy = cov(tz, 0.2, 0.72, wv / max(corn, 0.01));
        float dorm = dx * dy * dm;
        float dfr = cov(fx, 0.25, 0.75, wu) * cov(tz, 0.15, 0.8, wv / max(corn, 0.01));
        col = mix(col, trim * 0.7, clamp(dfr - dorm, 0.0, 1.0) * (1.0 - k));
        win = dorm * dm;
        avgWin = 0.12;
        wyc = clamp((tz - 0.2) / 0.52, 0.0, 1.0);
        litCell = 1.0;
        // zinc seams
        col *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.1 + wu, abs(fract(u * 2.0) - 0.5) * 2.0 - 0.9 + 0.1)) * (1.0 - k);
        col = mix(col, trim * 0.9, (1.0 - smoothstep(0.0, 0.12, tz)) * 0.9);
      } else {
        col = mix(trim, wall, 0.22);
        col *= 0.92 + 0.08 * smoothstep(0.0, 1.0, tz);
        // coping line on top
        col = mix(col, trim * 1.05, smoothstep(0.82, 0.95, tz));
        if (fTen || fPre || fDeco) {
          // overhang shadow and brackets (three per bay), heaviest on tenements
          float brk = cov(fract(u * 3.0), 0.22, 0.78, wu * 3.0);
          float lowZ = 1.0 - smoothstep(0.3, 0.55, tz);
          col *= 0.8 + 0.2 * smoothstep(0.0, 0.3, tz);
          col *= 1.0 - 0.34 * (1.0 - brk) * lowZ * (fTen ? 1.0 : 0.6) * kk;
        }
      }
    }
    // shadow cast by the cornice onto the top floor
    if (!top) col *= 1.0 - 0.26 * (1.0 - smoothstep(0.0, 0.5 + wv, (H - corn) - v));
    // soot: heavy under the cornice and at street level, patchy per bay (patchiness fades with distance)
    float sn = mix(1.0, 0.55 + 0.9 * bh21(vec2(bi + seed * 17.0, 2.0)), kk);
    float sootT = 1.0 - smoothstep(0.0, clamp(H * 0.25, 2.0, 7.0), (H - corn) - v);
    float sootB = 1.0 - smoothstep(0.0, 5.0, v);
    col *= 1.0 - mas * sn * (0.26 * sootT + 0.22 * sootB);
    // grime at the foot and soft vertical dirt
    col *= mix(0.78, 1.0, smoothstep(0.0, 2.2, v));
    col *= 1.0 - 0.1 * bh21(vec2(floor(u * 0.5) + seed * 29.0, 1.0)) * smoothstep(0.0, 14.0, v) * (1.0 - k);
    // far away the pattern collapses to its average (no moire)
    float winAvg = avgWin * (ground ? 1.0 : 1.0);
    win = mix(win, winAvg, k);
    gWin = win;
    // glass colour: darker toward the sill, a bit lighter high up; slightly varied per window
    float gv = (0.75 + 0.5 * wyc) * (0.85 + 0.3 * hw2);
    vec3 gcol = glass * gv * winDim;
    // curtain walls: bluish sky reflection brighter toward the top of each panel and the tower, panel-to-panel variance
    float isGl = (kind > 0.5 && kind < 1.5 && !ground) ? 1.0 : 0.0;
    float refl = 0.55 * smoothstep(0.05, 1.0, clamp(v / max(H, 1.0), 0.0, 1.0)) + 0.45 * wyc;
    float pv = bh21(vec2(bi + seed * 61.0, fi + 3.0));
    float rAmt = (fMir ? 0.55 : (fMid ? 0.25 : 0.32)) * isGl * uNY;
    gcol = mix(gcol, vec3(0.62, 0.76, 0.95) * (0.3 + 0.55 * refl), rAmt * refl * (0.7 + 0.6 * pv));
    gcol *= 1.0 + (pv - 0.5) * (fMir ? 0.5 : 0.3) * isGl * kk * uNY;
    gcol = mix(gcol, blindCol, blind * kk);
    col = mix(col, gcol, win);
    col *= 1.0 - 0.22 * uWet;
    diffuseColor.rgb = col;
    // ---------- night: a stable random subset of windows lit ----------
    float litProb = ground ? mix(D.w * 1.7, min(0.85, D.w * 2.1), uNY) : D.w;
    float onset = hw2 * 0.8;
    float on = step(hw3, litProb) * litCell * smoothstep(onset, onset + 0.18, uNight);
    float warmT = kind > 0.5 && kind < 1.5 ? 0.3 : 0.82;
    float warm = step(hw, ground ? mix(warmT, 0.88, uNY) : warmT);
    vec3 lc = mix(vec3(0.72, 0.84, 1.0), mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.84, 0.58), hw2), warm);
    lc *= mix(vec3(1.0), blindCol * 1.5 + 0.2, blind * kk * 0.5);
    float lum = (0.55 + 0.75 * hw) * (0.65 + 0.7 * (1.0 - wyc)) * (ground ? mix(1.0, 1.35, uNY) : 1.0) * (1.0 - 0.3 * blind * kk);
    float onAvg = litProb * smoothstep(0.0, 0.9, uNight) * litCell;
    float onF = mix(on, onAvg * 0.7, k);
    gEmis = lc * lum * 0.8 * onF * win;
  }
}
`;

export class Buildings {
  constructor(scene, geo, routeData, shared, renderer) {
    this.scene = scene;
    this.geo = geo;
    this.id = routeData.id;
    this.shared = shared;
    this.city = CITY[routeData.id] || DEFAULT_CITY;
    this.base = `${BASE}world/${routeData.id}/buildings`;
    this.index = null;
    this.tiles = new Map(); // key -> { state, rec, mesh, job, rect }
    this.queue = [];
    this.clock = 1;
    this.lastCx = 0; this.lastCz = 0;
    this.stats = { tris: 0, calls: 0, worstSliceMs: 0, tileBuildMs: 0, builds: 0 };
    this._count = 0;

    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.0 });
    this.material.envMapIntensity = 0.9;
    const fam = makeFamUniform();
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.uFam = { value: fam };
      sh.uniforms.uNight = shared.uNight;
      sh.uniforms.uWet = shared.uWet;
      sh.uniforms.uSnow = shared.uSnow;
      sh.uniforms.uNY = { value: this.id === 'manhattan' ? 1 : 0 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_DECL)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vW = aW; vInfo = aInfo; vTint = aTint * 2.0; vRoof = normal.y > 0.5 ? 1.0 : 0.0;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
        .replace('#include <map_fragment>', FRAG_MAIN)
        // windows are glossy glass, the rest of the wall is rough; wet walls get a little sheen
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor * (1.0 - 0.35 * uWet), 0.1, gWin);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = gWin * 0.55;`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += gEmis;');
    };
    this.material.customProgramCacheKey = () => 'buildings-v1';

    fetch(`${this.base}/index.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.tiles && j.z) this.index = j; })
      .catch(() => {});
  }

  get count() { return this._count; }
  get triangles() { let n = 0; for (const t of this.tiles.values()) if (t.mesh) n += t.mesh.userData.tris; return n; }
  get drawCalls() { let n = 0; for (const t of this.tiles.values()) if (t.mesh) n++; return n; }

  setEnvMap(tex) {
    if (this.material.envMap === tex) return;
    this.material.envMap = tex;
    this.material.needsUpdate = true;
  }

  tileRect(key) {
    const [tx, ty] = key.split('_').map(Number), z = this.index.z, g = this.geo;
    return { x0: g.x(tx2lon(tx, z)), x1: g.x(tx2lon(tx + 1, z)), z0: g.z(ty2lat(ty, z)), z1: g.z(ty2lat(ty + 1, z)) };
  }

  async load(key, t) {
    try {
      const r = await fetch(`${this.base}/${key}.bin`);
      if (!r.ok) throw new Error('missing');
      const buf = await r.arrayBuffer();
      if (t.dead) return;
      t.rec = new Float32Array(buf);
      t.state = 2;
      this.queue.push(key);
    } catch (e) {
      t.state = t.dead ? 3 : 4; // 4 = failed, do not retry
    }
  }

  // pass 1: record offsets, counts, bounds
  prepare(t) {
    const f = t.rec, offs = [];
    let nv = 0, ni = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let o = 0; o < f.length;) {
      offs.push(o);
      const nr = f[o + 6];
      y0 = Math.min(y0, f[o + 3]); y1 = Math.max(y1, f[o + 3] + f[o + 5]);
      let p = o + 7, pts = 0, holes = 0;
      for (let r = 0; r < nr; r++) {
        const n = f[p];
        if (r > 0) holes++;
        for (let i = 0; i < n; i++) {
          const x = f[p + 1 + i * 2], z = f[p + 2 + i * 2];
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
        nv += n * 4; ni += n * 6; pts += n;
        p += 1 + n * 2;
      }
      nv += pts; ni += 3 * Math.max(pts + 2 * holes - 2, 1);
      o = p;
    }
    t.job = {
      offs, i: 0, nv, ni, v: 0, k: 0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2,
      pos: new Float32Array(nv * 3), nor: new Int8Array(nv * 3), aW: new Float32Array(nv * 2), aInfo: new Float32Array(nv * 4),
      tint: new Uint8Array(nv * 3), idx: new Uint32Array(ni),
      bounds: [x0, x1, z0, z1, y0, y1],
      props: [], // what buildProps needs per building (Manhattan: water towers, fire escapes, awnings...)
    };
  }

  pickFamily(cls, mat, H, area, r, rr) {
    const c = this.city;
    if (cls === 6) return 'grandstand';
    if (cls === 4) return 'industrial';
    const man = this.id === 'manhattan';
    if (cls === 5 && H > 8) return this.id === 'paris' || man ? (man ? 'prewar' : 'limestone') : 'civic';
    if (cls === 1 && H < 12) return this.id === 'manhattan' || this.id === 'london' ? pickWeighted(c.low, r) : 'house';
    if (mat === 2) return pickWeighted(c.tower, r);
    if (mat === 1) return pickWeighted(man ? [['tenement', 3], ['tenement2', 3], ['brick', 2], ['darkbrick', 1], ['deco', 1]] : [['brick', 3], ['darkbrick', 1], ['tanbrick', 1]], r);
    const klass = H >= 110 ? c.tower : H >= 50 ? c.high : H >= 20 ? c.mid : c.low;
    // small low sheds in a city read as plain boxes
    if (H < 7 && area < 120 && cls !== 3) return pickWeighted(man ? [['tenement', 2], ['brick', 2], ['concrete', 1]] : [['stucco', 2], ['brick', 2], ['concrete', 1]], r);
    return pickWeighted(klass, r);
  }

  // pass 2: slice of work. returns true when finished
  step(t, budgetMs) {
    const j = t.job, f = t.rec, t0 = performance.now();
    const { pos, nor, aW, aInfo, tint, idx } = j;
    const pts = [];
    while (j.i < j.offs.length) {
      const o = j.offs[j.i++];
      const seed = f[o] | 0, code = f[o + 1] | 0, colour = f[o + 2], base = f[o + 3], minH = f[o + 4], topH = f[o + 5], nr = f[o + 6];
      const cls = code & 15, mat = code >> 4;
      const y0 = base + minH, y1 = base + topH, H = topH - SINK, gnd = base + SINK;
      // outline rings
      const rings = [];
      let p = o + 7, area = 0;
      for (let r = 0; r < nr; r++) {
        const n = f[p];
        rings.push([p + 1, n]);
        if (r === 0) {
          for (let a = 0, b = n - 1; a < n; b = a++) area += f[p + 1 + b * 2] * f[p + 2 + a * 2] - f[p + 1 + a * 2] * f[p + 2 + b * 2];
        }
        p += 1 + n * 2;
      }
      area = Math.abs(area) / 2;
      const r1 = hash32(seed * 7 + 1), r2 = hash32(seed * 13 + 5), r3 = hash32(seed * 29 + 9), r4 = hash32(seed * 31 + 3);
      const fname = this.pickFamily(cls, mat, H, area, r1, r2);
      const fam = FAMILIES[fname], fid = FID[fname];
      if (this.id === 'manhattan') {
        const [rp, rn] = rings[0];
        j.props.push({ seed, fam: fname, cls, mat, H, gnd, top: y1, minH, area, ring: Float32Array.from(f.subarray(rp, rp + rn * 2)) });
      }
      // floors fit the height exactly
      const corn = fam.corn, gf = Math.min(fam.gf, Math.max(H - corn, 0.5));
      const nF = Math.max(Math.round((H - gf - corn) / fam.floor), 0);
      const fhEff = nF > 0 ? (H - gf - corn) / nF : fam.floor;
      const bay = fam.bay * (0.88 + 0.24 * r2);
      // tint: slight lightness/hue jitter, or the tagged colour
      let tr = 1, tg = 1, tb = 1;
      const tj = this.city.tint, lj = 1 - tj + r3 * tj * 2, hj = (r4 - 0.5) * tj * 0.8;
      tr = lj * (1 + hj); tg = lj; tb = lj * (1 - hj);
      if (fname === 'stuccoPastel') { const h = r4 * 4 | 0; const m = [[1.0, 0.92, 0.82], [1.06, 0.85, 0.72], [0.96, 1.0, 0.86], [1.0, 0.8, 0.78]][h]; tr *= m[0]; tg *= m[1]; tb *= m[2]; }
      else if ((fname === 'stucco' || fname === 'house' || fname === 'modernWhite') && r4 > 0.6) { const m = [[1.0, 0.95, 0.85], [0.93, 0.98, 1.0], [1.0, 0.9, 0.88]][(r1 * 3) | 0]; tr *= m[0]; tg *= m[1]; tb *= m[2]; }
      if (colour > 0 && fam.kind !== 1) {
        const c = colour - 1, cr = new THREE.Color().setRGB(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, THREE.SRGBColorSpace);
        const w = new THREE.Color(fam.wall);
        tr = Math.min(1.8, Math.max(0.3, cr.r / w.r)); tg = Math.min(1.8, Math.max(0.3, cr.g / w.g)); tb = Math.min(1.8, Math.max(0.3, cr.b / w.b));
      }
      if (this.id === 'manhattan' && fam.kind !== 1) {
        // OSM colour tags are often garish: pull them halfway back to the family colour, then age the building
        if (colour > 0) { tr = 1 + (tr - 1) * 0.5; tg = 1 + (tg - 1) * 0.5; tb = 1 + (tb - 1) * 0.5; tr *= lj; tg *= lj; tb *= lj; }
        const age = 0.86 + 0.14 * hash32(seed * 17 + 7), warm = (hash32(seed * 5 + 2) - 0.5) * 0.06;
        tr *= age * (1 + warm); tg *= age; tb *= age * (1 - warm);
      }
      const T8 = (x) => Math.max(0, Math.min(255, Math.round(x * 127)));
      const ti = [T8(tr), T8(tg), T8(tb)];
      const si = ((seed % 65521) / 65521) * 0.9 + 0.05;
      const cx = j.cx, cy = j.cy, cz = j.cz;

      // ---- walls ----
      let u = Math.floor(r3 * 40) * 3;
      for (let r = 0; r < nr; r++) {
        const [s0, n] = rings[r];
        let carry = u;
        for (let a = 0; a < n; a++) {
          const b = (a + 1) % n;
          const ax = f[s0 + a * 2], az = f[s0 + a * 2 + 1], bx = f[s0 + b * 2], bz = f[s0 + b * 2 + 1];
          const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
          if (L < 0.05) continue;
          const nx = dz / L, nz = -dx / L;
          let ua, ub;
          if (L < bay * 0.6) { ua = carry; ub = carry + L / bay; } else { ua = Math.ceil(carry); ub = ua + Math.max(1, Math.round(L / bay)); }
          carry = ub;
          const v = j.v;
          const vb = y0 - gnd, vt = H; // height above ground at bottom / top
          for (let q = 0; q < 4; q++) {
            const isB = q === 1 || q === 2, top = q >= 2;
            const vi = v + q;
            pos[vi * 3] = (isB ? bx : ax) - cx; pos[vi * 3 + 1] = (top ? y1 : y0) - cy; pos[vi * 3 + 2] = (isB ? bz : az) - cz;
            nor[vi * 3] = Math.round(nx * 127); nor[vi * 3 + 1] = 0; nor[vi * 3 + 2] = Math.round(nz * 127);
            aW[vi * 2] = isB ? ub : ua; aW[vi * 2 + 1] = top ? vt : vb;
            aInfo[vi * 4] = si; aInfo[vi * 4 + 1] = fid; aInfo[vi * 4 + 2] = H; aInfo[vi * 4 + 3] = fhEff;
            tint[vi * 3] = ti[0]; tint[vi * 3 + 1] = ti[1]; tint[vi * 3 + 2] = ti[2];
          }
          const k = j.k;
          idx[k] = v; idx[k + 1] = v + 3; idx[k + 2] = v + 2; idx[k + 3] = v; idx[k + 4] = v + 2; idx[k + 5] = v + 1;
          j.v += 4; j.k += 6;
        }
      }
      // ---- roof ----
      const vbase = j.v;
      let total = 0;
      for (const [s0, n] of rings) {
        for (let a = 0; a < n; a++) {
          const vi = j.v++;
          const x = f[s0 + a * 2], z = f[s0 + a * 2 + 1];
          pos[vi * 3] = x - cx; pos[vi * 3 + 1] = y1 - cy; pos[vi * 3 + 2] = z - cz;
          nor[vi * 3] = 0; nor[vi * 3 + 1] = 127; nor[vi * 3 + 2] = 0;
          aW[vi * 2] = x; aW[vi * 2 + 1] = z;
          aInfo[vi * 4] = si; aInfo[vi * 4 + 1] = fid; aInfo[vi * 4 + 2] = H; aInfo[vi * 4 + 3] = fhEff;
          tint[vi * 3] = ti[0]; tint[vi * 3 + 1] = ti[1]; tint[vi * 3 + 2] = ti[2];
          total++;
        }
      }
      const tri = (a, b, c) => {
        // keep the roof facing up
        const ax = pos[(vbase + a) * 3], az = pos[(vbase + a) * 3 + 2], bx = pos[(vbase + b) * 3], bz = pos[(vbase + b) * 3 + 2], cx2 = pos[(vbase + c) * 3], cz2 = pos[(vbase + c) * 3 + 2];
        const cr = (bz - az) * (cx2 - ax) - (bx - ax) * (cz2 - az);
        const k = j.k;
        if (cr >= 0) { idx[k] = vbase + a; idx[k + 1] = vbase + b; idx[k + 2] = vbase + c; } else { idx[k] = vbase + a; idx[k + 1] = vbase + c; idx[k + 2] = vbase + b; }
        j.k += 3;
      };
      if (nr === 1 && total === 3) tri(0, 1, 2);
      else if (nr === 1 && total === 4 && convex4(pos, vbase)) { tri(0, 1, 2); tri(0, 2, 3); }
      else {
        const contour = [], holes = [];
        for (let r = 0; r < nr; r++) {
          const [s0, n] = rings[r];
          const arr = [];
          for (let a = 0; a < n; a++) arr.push(new THREE.Vector2(f[s0 + a * 2], f[s0 + a * 2 + 1]));
          if (r === 0) contour.push(...arr); else holes.push(arr);
        }
        let faces = [];
        try { faces = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { faces = []; }
        for (const fc of faces) tri(fc[0], fc[1], fc[2]);
      }
      if (performance.now() - t0 > budgetMs) break;
    }
    const ms = performance.now() - t0;
    this.stats.worstSliceMs = Math.max(this.stats.worstSliceMs, ms);
    t.buildMs = (t.buildMs || 0) + ms;
    return j.i >= j.offs.length;
  }

  finish(t, key) {
    const j = t.job;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(j.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(j.nor, 3, true));
    g.setAttribute('aW', new THREE.BufferAttribute(j.aW, 2));
    g.setAttribute('aInfo', new THREE.BufferAttribute(j.aInfo, 4));
    g.setAttribute('aTint', new THREE.BufferAttribute(j.tint, 3, true));
    // unused index slots (failed triangulations) are degenerate zeros; trim to what was written
    g.setIndex(new THREE.BufferAttribute(j.k < j.idx.length ? j.idx.subarray(0, j.k) : j.idx, 1));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(j.bounds[0] - j.cx, j.bounds[4] - j.cy, j.bounds[2] - j.cz), new THREE.Vector3(j.bounds[1] - j.cx, j.bounds[5] - j.cy, j.bounds[3] - j.cz));
    g.boundingSphere = new THREE.Sphere();
    g.boundingBox.getBoundingSphere(g.boundingSphere);
    const m = new THREE.Mesh(g, this.material);
    m.position.set(j.cx, j.cy, j.cz);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.castShadow = false; m.receiveShadow = false;
    m.userData.tris = j.k / 3;
    this.scene.add(m);
    t.mesh = m;
    if (j.props.length) {
      try { t.props = buildProps(j.props, { city: this.id, shared: this.shared }); } catch (e) { console.warn('building props failed', e); }
      if (t.props) this.scene.add(t.props);
    }
    t.n = j.offs.length;
    this._count += t.n;
    this.stats.tileBuildMs = t.buildMs;
    this.stats.builds++;
    t.job = null; t.rec = null; t.state = 3;
  }

  dropTile(key, t) {
    t.dead = true;
    if (t.mesh) { this.scene.remove(t.mesh); t.mesh.geometry.dispose(); this._count -= t.n; }
    if (t.props) { this.scene.remove(t.props); t.props.traverse((o) => o.geometry?.dispose?.()); t.props = null; }
    this.queue = this.queue.filter((k) => k !== key);
    this.tiles.delete(key);
  }

  update(dt, cx, cz) {
    if (!this.index) return;
    this.clock += dt;
    // tile bookkeeping a few times a second
    if (this.clock > 0.25 || Math.hypot(cx - this.lastCx, cz - this.lastCz) > 40) {
      this.clock = 0; this.lastCx = cx; this.lastCz = cz;
      const z = this.index.z;
      const tx = Math.floor(lon2tx(this.geo.lon(cx), z)), ty = Math.floor(lat2ty(this.geo.lat(cz), z));
      const dist = (key) => {
        const r = (this.tileRect(key));
        return Math.hypot(Math.max(r.x0 - cx, 0, cx - r.x1), Math.max(r.z0 - cz, 0, cz - r.z1));
      };
      for (let dx = -2; dx <= 2; dx++)
        for (let dy = -2; dy <= 2; dy++) {
          const key = `${tx + dx}_${ty + dy}`;
          if (!this.index.tiles[key] || this.tiles.has(key)) continue;
          if (dist(key) > LOAD_R) continue;
          const t = { state: 1, rec: null, mesh: null, job: null, dead: false, d: 0 };
          this.tiles.set(key, t);
          this.load(key, t);
        }
      for (const [key, t] of this.tiles) if (t.state !== 1 && dist(key) > DROP_R) this.dropTile(key, t);
      // build nearest tile first
      this.queue.sort((a, b) => dist(a) - dist(b));
    }
    // one slice of geometry building per frame
    if (this.queue.length) {
      const key = this.queue[0], t = this.tiles.get(key);
      if (!t || t.dead) { this.queue.shift(); return; }
      if (!t.job) this.prepare(t);
      if (this.step(t, SLICE_MS)) { this.queue.shift(); this.finish(t, key); }
    }
  }
}

function convex4(pos, v) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = v + i, b = v + (i + 1) % 4, c = v + (i + 2) % 4;
    const cr = (pos[b * 3] - pos[a * 3]) * (pos[c * 3 + 2] - pos[b * 3 + 2]) - (pos[b * 3 + 2] - pos[a * 3 + 2]) * (pos[c * 3] - pos[b * 3]);
    if (cr === 0) return false;
    const sg = cr > 0 ? 1 : -1;
    if (s && sg !== s) return false;
    s = sg;
  }
  return true;
}
