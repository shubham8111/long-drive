// Bryce roadside details: NPS-style brown signs, park entrance sign + station, cattle guard, overlook pullouts with
// rail fences and benches, snow poles / delineators, ranch fences and the old-west storefronts of Bryce Canyon City.
// Everything is built lazily in 250 m route chunks (when the terrain there is loaded) and merged into 3 meshes:
// the opaque set (one sign atlas + vertex colours), a ground-decal set (polygonOffset) and a window-glow set.
import * as THREE from 'three';

const CHUNK = 250;
const SIDE_MIN = 6.5; // nothing closer than this to the road centre (except the booth canopy)

// ------------------------------------------------------------------ small utils
const hash = (n) => { let h = (Math.imul(n | 0, 374761393) + 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const _c = new THREE.Color();
const C = (hex) => { _c.setHex(hex); return [_c.r, _c.g, _c.b]; };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const WOOD = C(0x6a4a30), DARKWOOD = C(0x3a2616), GREYWOOD = C(0x8a8478), CREAM = C(0xe9dcb8), STONE = C(0x7a6b58), WHITE = [1, 1, 1];
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ sign atlas
const SERIF = 'Georgia, "Times New Roman", serif';
const SIGNS = [];
const nps = (key, l1, l2) => SIGNS.push({ key, w: 640, h: 320, draw: (g, w, h) => npsPanel(g, w, h, l1, l2) });
function fit(g, text, font, maxW, size) { do { g.font = `${font.replace('#', size)}`; size -= 2; } while (g.measureText(text).width > maxW && size > 10); }
function npsPanel(g, w, h, l1, l2) {
  g.fillStyle = '#4b2f1b'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#e8d9ae'; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28);
  g.fillStyle = '#e8d9ae'; g.textAlign = 'center'; g.textBaseline = 'middle';
  fit(g, l1, `bold #px ${SERIF}`, w - 80, 74); g.fillText(l1, w / 2, l2 ? h * 0.42 : h / 2);
  if (l2) { fit(g, l2, `#px ${SERIF}`, w - 100, 40); g.fillText(l2, w / 2, h * 0.74); }
}
nps('farview', 'FARVIEW POINT', 'SCENIC OVERLOOK'); nps('piracy', 'PIRACY POINT', 'SCENIC OVERLOOK');
nps('natbridge', 'NATURAL BRIDGE', 'SCENIC OVERLOOK'); nps('agua', 'AGUA CANYON', 'SCENIC OVERLOOK');
nps('ponderosa', 'PONDEROSA CANYON', 'SCENIC OVERLOOK'); nps('blackbirch', 'BLACK BIRCH CANYON', 'SCENIC OVERLOOK');
nps('rainbow', 'RAINBOW POINT', 'ELEVATION 9,115 FT');
const MILES = [[36500], [41500], [52000]];
for (const [s] of MILES) { const mi = Math.round((57700 - s) / 1609); SIGNS.push({ key: 'mi' + s, w: 512, h: 256, draw: (g, w, h) => npsPanel(g, w, h, 'RAINBOW POINT', mi + ' MILES') }); }
SIGNS.push({ key: 'dirs', w: 640, h: 480, draw: (g, w, h) => {
  g.fillStyle = '#4b2f1b'; g.fillRect(0, 0, w, h); g.strokeStyle = '#e8d9ae'; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28);
  g.fillStyle = '#e8d9ae'; g.textAlign = 'left'; g.textBaseline = 'middle';
  ['Inspiration Point', 'Sunset Point', 'Bryce Point'].forEach((t, i) => {
    const y = 90 + i * 150; fit(g, t, `bold #px ${SERIF}`, w - 190, 64); g.fillText(t, 44, y);
    g.fillRect(w - 130, y - 7, 70, 14); g.beginPath(); g.moveTo(w - 66, y - 30); g.lineTo(w - 26, y); g.lineTo(w - 66, y + 30); g.fill();
  });
} });
SIGNS.push({ key: 'entrance', w: 1536, h: 512, draw: (g, w, h) => {
  g.fillStyle = '#54351e'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(${20 + (i * 7) % 30},${10 + (i * 5) % 20},5,0.10)`; g.fillRect(0, (i * 37) % h, w, 2 + (i % 3)); }
  g.strokeStyle = '#d9c692'; g.lineWidth = 8; g.strokeRect(24, 24, w - 48, h - 48);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [t, y, sz] of [['BRYCE CANYON', h * 0.34, 150], ['NATIONAL PARK', h * 0.7, 120]]) {
    fit(g, t, `bold #px ${SERIF}`, w - 140, sz); g.fillStyle = '#1e1008'; g.fillText(t, w / 2 + 5, y + 5); g.fillStyle = '#ead9a8'; g.fillText(t, w / 2, y);
  }
} });
const shop = (key, l1, l2, bg, fg) => SIGNS.push({ key, w: 640, h: 160, draw: (g, w, h) => {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${0.03 + (i % 3) * 0.02})`; g.fillRect(0, (i * 29) % h, w, 1 + (i % 2)); }
  g.strokeStyle = fg; g.globalAlpha = 0.8; g.lineWidth = 4; g.strokeRect(8, 8, w - 16, h - 16); g.globalAlpha = 1;
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  fit(g, l1, `bold #px ${SERIF}`, w - 56, l2 ? 60 : 72); g.fillText(l1, w / 2, l2 ? h * 0.38 : h / 2);
  if (l2) { fit(g, l2, `italic #px ${SERIF}`, w - 70, 32); g.fillText(l2, w / 2, h * 0.76); }
} });
shop('hoodoo', 'HOODOO LODGE', 'Rooms · Cabins · Dining', '#25402f', '#ecdfb6');
shop('mercantile', 'Red Rock Mercantile', 'Dry Goods & Provisions', '#7b2e22', '#f0e2bd');
shop('ebenezer', "Ebenezer's Trading Post", 'Curios · Boots · Jerky', '#e6d6a8', '#4a1f14');
shop('pinyon', 'Pinyon Pine Café', 'Pie · Coffee · Breakfast', '#2f4a63', '#f1e7c8');
shop('sagebrush', 'SAGEBRUSH FUEL & FEED', null, '#d9cfae', '#3a2a18');
shop('saloon', 'Dusty Boot Saloon', 'Cold Drinks · Live Fiddle', '#3b2a22', '#e3b95f');
shop('outfit', 'Bristlecone Outfitters', 'Rides · Guides · Gear', '#5a6b3a', '#f2ead0');
shop('motel', "Prospector's Rest Motel", 'Vacancy', '#6b4a2a', '#f0e0b0');
shop('grill', 'Hitching Post Grill', 'Steaks & Biscuits', '#8a3a24', '#f6e8c4');
shop('hardware', 'Tin Cup Hardware', 'Nails · Rope · Lanterns', '#c9b98a', '#2f3a2a');
shop('inn', 'Cedar Mesa Inn', 'Fireside Rooms', '#4a3550', '#efe2c0');

function makeAtlas() {
  const W = 4096, H = 1536, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const rect = {}; let x = 16, y = 0, rowH = 0;
  for (const S of SIGNS) {
    if (x + S.w + 8 > W) { x = 0; y += rowH + 8; rowH = 0; }
    if (y === 0 && x < 16) x = 16;
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, S.w, S.h); g.clip(); S.draw(g, S.w, S.h); g.restore();
    rect[S.key] = [(x + 2) / W, 1 - (y + S.h - 2) / H, (x + S.w - 2) / W, 1 - (y + 2) / H];
    x += S.w + 8; rowH = Math.max(rowH, S.h);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, rect, solid: [8 / W, 1 - 8 / H] };
}

// ------------------------------------------------------------------ geometry builder
const FACES = [
  [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
  [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
  [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
  [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
  [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
];
// face indices: 0 +z, 1 -z, 2 +x, 3 -x, 4 +y, 5 -y
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _n = new THREE.Vector3(), _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const UP = V(0, 1, 0);
const mkset = () => ({ p: [], n: [], c: [], u: [] });

class Builder {
  constructor(atlas, seed) { this.atlas = atlas; this.r = rng(seed); this.main = mkset(); this.decal = mkset(); this.glow = mkset(); }
  vert(set, p, n, c, uv) { set.p.push(p.x, p.y, p.z); set.n.push(n.x, n.y, n.z); set.c.push(c[0], c[1], c[2]); if (set === this.main) set.u.push(uv[0], uv[1]); }
  boxM(set, M, sx, sy, sz, col, o = {}) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2, k = o.j === 0 ? 1 : 1 + (this.r() - 0.5) * (o.j ?? 0.14);
    const base = [col[0] * k, col[1] * k, col[2] * k], sol = this.atlas.solid;
    for (let f = 0; f < 6; f++) {
      if (f === 5 && !o.bot) continue;
      const [nn, cs] = FACES[f]; _n.set(nn[0], nn[1], nn[2]).transformDirection(M);
      const isF = o.face === f && o.uv, c = isF ? (o.fc || WHITE) : base;
      const uvs = isF ? [[o.uv[0], o.uv[1]], [o.uv[2], o.uv[1]], [o.uv[2], o.uv[3]], [o.uv[0], o.uv[3]]] : [sol, sol, sol, sol];
      const P = cs.map((q) => V(q[0] * hx, q[1] * hy, q[2] * hz).applyMatrix4(M));
      for (const i of [0, 1, 2, 0, 2, 3]) this.vert(set, P[i], _n, c, uvs[i]);
    }
  }
  // box in frame F (local coords: x along road, y up, z right of the road), optional local rotation
  box(F, set, cx, cy, cz, sx, sy, sz, col, o = {}) {
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'); _m.makeRotationFromEuler(_e); _m.setPosition(cx, cy, cz); _m.premultiply(F);
    this.boxM(set, _m.clone(), sx, sy, sz, col, o);
  }
  // slab between two local points; width is horizontal-perpendicular, thick is the other
  beam(F, set, p0, p1, thick, width, col, o = {}) {
    _bx.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]); const len = _bx.length(); if (len < 1e-4) return; _bx.divideScalar(len);
    _bz.crossVectors(_bx, UP); if (_bz.lengthSq() < 1e-6) return; _bz.normalize(); _by.crossVectors(_bz, _bx);
    const M = new THREE.Matrix4().makeBasis(_bx.clone(), _by.clone(), _bz.clone()); M.setPosition((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
    if (F) M.premultiply(F);
    this.boxM(set, M, len + (o.ext || 0), thick, width, col, o);
  }
  tri(F, set, a, b, c, col) {
    const A = V(...a).applyMatrix4(F), Bv = V(...b).applyMatrix4(F), Cv = V(...c).applyMatrix4(F);
    const n = new THREE.Vector3().crossVectors(Bv.clone().sub(A), Cv.clone().sub(A)).normalize(), sol = this.atlas.solid;
    this.vert(set, A, n, col, sol); this.vert(set, Bv, n, col, sol); this.vert(set, Cv, n, col, sol);
    const m = n.clone().negate();
    this.vert(set, A, m, col, sol); this.vert(set, Cv, m, col, sol); this.vert(set, Bv, m, col, sol);
  }
  quad(set, p0, p1, p2, p3, col) { // up-facing ground quad (p0..p3 counter-clockwise seen from above is not required)
    const sol = this.atlas.solid;
    const up = V(0, 1, 0);
    const a = V(...p0), b = V(...p1), c = V(...p2), d = V(...p3);
    const cr = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)); const flip = cr.y < 0;
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]; const P = [a, b, c, d];
    for (const i of order) this.vert(set, P[i], up, col, sol);
  }
}

// ------------------------------------------------------------------ environment helpers
function makeEnv(ctx) {
  const env = { ctx, route: ctx.route };
  env.H = (x, z, fb) => { const h = ctx.terrain.heightAt(x, z); return Number.isFinite(h) ? h : fb; };
  env.pt = (s) => { const P = ctx.route.sample(s, {}); const l = Math.hypot(P.tx, P.tz) || 1; P.tx /= l; P.tz /= l; return P; };
  // frame at route position s, lateral offset lat (+ right); y from terrain unless ground === false
  env.frame = (s, lat, ground = true) => {
    const P = env.pt(s), nx = -P.tz, nz = P.tx, x = P.x + nx * lat, z = P.z + nz * lat;
    const y = ground ? env.H(x, z, P.y) : P.y;
    const M = new THREE.Matrix4().makeBasis(V(P.tx, 0, P.tz), V(0, 1, 0), V(nx, 0, nz)); M.setPosition(x, y, z);
    return M;
  };
  env.wp = (F, a, b) => { const e = F.elements; return [e[12] + e[0] * a + e[8] * b, e[14] + e[2] * a + e[10] * b]; };
  // local y of the ground at local (a, b) in frame F
  env.gl = (F, a, b, fb) => { const [x, z] = env.wp(F, a, b); return env.H(x, z, F.elements[13] + (fb ?? 0)) - F.elements[13]; };
  return env;
}

// ground decal over local rectangle [a0,a1] x [b0,b1] following the terrain
function decal(B, env, F, a0, a1, b0, b1, col, step = 3, lift = 0.05, noise = 0.06) {
  const na = Math.max(1, Math.round((a1 - a0) / step)), nb = Math.max(1, Math.round((b1 - b0) / step));
  const e = F.elements, y0 = e[13], fb = y0;
  const g = [];
  for (let j = 0; j <= nb; j++) for (let i = 0; i <= na; i++) {
    const a = a0 + ((a1 - a0) * i) / na, b = b0 + ((b1 - b0) * j) / nb, [x, z] = env.wp(F, a, b);
    g.push([x, env.H(x, z, fb) + lift, z]);
  }
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) {
    const k = 1 + (B.r() - 0.5) * noise * 2;
    B.quad(B.decal, g[j * (na + 1) + i], g[j * (na + 1) + i + 1], g[(j + 1) * (na + 1) + i + 1], g[(j + 1) * (na + 1) + i], mul(col, k));
  }
}
// post standing on the ground at local (a, b), top at local y
function postG(B, env, F, a, b, top, t, col, o = {}) {
  const gy = env.gl(F, a, b) - 0.35, h = top - gy;
  if (h > 0.05) B.box(F, B.main, a, gy + h / 2, b, t, h, t, col, o);
}

// ------------------------------------------------------------------ feature builders
const DK_BROWN = C(0x3a2616);
function npsSignAt(B, env, s, lat, key, w, h, dirFace, yaw = 0) {
  const F = env.frame(s, lat), uv = B.atlas.rect[key];
  const bottom = 1.15;
  for (const sg of [-1, 1]) postG(B, env, F, 0, sg * (w / 2 - 0.22), bottom + h + 0.15, 0.15, DK_BROWN, { j: 0.2 });
  B.box(F, B.main, 0, bottom + h / 2, 0, 0.07, h, w, C(0x4b2f1b), { face: dirFace, uv, ry: yaw, j: 0.05 });
}
function pullout(B, env, d) {
  const F = env.frame(d.s, 0, false); // at road height; patch built relative to terrain
  const Fg = env.frame(d.s, -10);
  // asphalt-ish parking patch + sign pair + fence + benches on the canyon (left, -b) side
  decal(B, env, Fg, -15, 15, -6.4, 5.4, C(0x9c8f7c), 2.5, 0.07, 0.07); // packed buff gravel, like the real pullouts
  decal(B, env, Fg, -15, 15, -6.4, -5.8, C(0x8a7e6c), 2.5, 0.09, 0.05);
  const rim = -10 - 6.8; // local b relative to Fg? use Fg frame: lateral -10 + b
  const fb = 6.2; void fb; void rim; void F;
  const bF = -6.4; // fence at local b = -6.4 from Fg => lateral -16.4
  const n = 10, a0 = -13, a1 = 13, tops = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n, gy = env.gl(Fg, a, bF) ;
    postG(B, env, Fg, a, bF, gy + 1.1, 0.15, GREYWOOD, { j: 0.18 }); tops.push([a, gy]);
  }
  for (let i = 0; i < n; i++) for (const hh of [1.0, 0.55]) {
    B.beam(Fg, B.main, [tops[i][0], tops[i][1] + hh, bF], [tops[i + 1][0], tops[i + 1][1] + hh, bF], 0.1, 0.08, mul(GREYWOOD, 0.95), { ext: 0.15, j: 0.2 });
  }
  for (const a of [-5.5, 4.5]) { // benches facing the canyon
    const gy = env.gl(Fg, a, -4.4);
    B.box(Fg, B.main, a, gy + 0.46, -4.4, 1.8, 0.07, 0.5, WOOD);
    B.box(Fg, B.main, a, gy + 0.8, -4.17, 1.8, 0.4, 0.06, WOOD);
    for (const sg of [-1, 1]) B.box(Fg, B.main, a + sg * 0.8, gy + 0.23, -4.4, 0.08, 0.46, 0.45, C(0x2a2a2a));
  }
}

function overlookSigns(B, env, d) {
  // outbound drivers (increasing s) read the sign on the right shoulder facing back (-x face); inbound read the left one (+x face)
  npsSignAt(B, env, d.s - 70, 7.6, d.key, 1.8, 0.9, 3, 0.05);
  npsSignAt(B, env, d.s + 70, -7.6, d.key, 1.8, 0.9, 2, 0.05);
  pullout(B, env, d);
}

function entranceSign(B, env) {
  const F = env.frame(29700, 12.5), uv = B.atlas.rect.entrance;
  const ry = -0.3; // turn the face towards the road
  const base = (a, w, h, d) => { for (let k = 0; k < 4; k++) { const hh = h / 4, n = Math.max(1, Math.round(w / 0.9)); let x = a - w / 2; for (let i = 0; i < n; i++) { const sw = (w / n) * (0.9 + B.r() * 0.2); B.box(F, B.main, x + sw / 2 + (k % 2) * 0.1, hh * (k + 0.5), 0, sw, hh * 0.98, d, mul(STONE, 0.75 + B.r() * 0.5), { j: 0 }); x += w / n; } } };
  const gy = env.gl(F, 0, 0);
  B.box(F, B.main, 0, gy - 0.6, 0, 1.0, 2, 4.8, mul(STONE, 0.7)); // foundation reaching down
  void base;
  for (let k = 0; k < 4; k++) { const n = 6; let z = -2.3; for (let i = 0; i < n; i++) { const sw = (4.6 / n) * (0.88 + B.r() * 0.24); B.box(F, B.main, 0, gy + 0.2 * (k + 0.5), z + sw / 2 + (k % 2) * 0.1, 0.85, 0.2, sw, mul(STONE, 0.8 + B.r() * 0.45), { j: 0 }); z += 4.6 / n; } }
  for (const sg of [-1, 1]) B.box(F, B.main, 0, gy + 0.9, sg * 2.3, 0.6, 1.8, 0.55, mul(STONE, 0.9)); // stone piers
  B.box(F, B.main, 0, gy + 1.5, 0, 0.3, 1.25, 3.9, C(0x54351e), { face: 3, uv, ry, fc: WHITE, j: 0.04 });
  B.box(F, B.main, 0.0, gy + 0.9, 0, 0.4, 0.12, 4.0, DARKWOOD, { ry }); // sill timber under the board
  // a couple of low rocks / shrubs at the sides
  for (const z of [-3.2, 3.4]) B.box(F, B.main, 0.2, gy + 0.2, z, 0.9, 0.5, 0.8, mul(STONE, 0.7), { ry: 0.5, rz: 0.1 });
}

function cattleGuard(B, env) {
  const s0 = 29895, s1 = 29899.5, hw = 4.3, rows = 2;
  const P0 = env.pt(s0), P1 = env.pt(s1);
  const q = (P, lat, dy) => [P.x - P.tz * lat, P.y + dy, P.z + P.tx * lat];
  B.quad(B.decal, q(P0, -hw, 0.05), q(P0, hw, 0.05), q(P1, hw, 0.05), q(P1, -hw, 0.05), [0.05, 0.05, 0.05]); // flush with the road: it must not read as a ramp
  void rows;
  const nb = 7;
  for (let i = 0; i < nb; i++) {
    const s = s0 + 0.3 + ((s1 - s0 - 0.6) * i) / (nb - 1), P = env.pt(s), F = env.frame(s, 0, false);
    F.elements[13] = P.y;
    B.box(F, B.main, 0, 0.065, 0, 0.12, 0.04, hw * 2, C(0xa4a8aa), { j: 0.1 });
  }
  for (const sg of [-1, 1]) { // low concrete curbs at the ends
    const F = env.frame((s0 + s1) / 2, sg * (hw + 0.4), false); F.elements[13] = env.pt((s0 + s1) / 2).y;
    B.box(F, B.main, 0, 0.1, 0, 5, 0.2, 0.5, C(0x9a978f));
  }
}

function entranceStation(B, env) {
  const s = 30455, F = env.frame(s, 9.0), uv = B.atlas.rect.hoodoo; void uv;
  const gy = env.gl(F, 0, 0), fy = gy + 0.25;
  B.box(F, B.main, 0, fy - 0.9, 0, 5.2, 1.8, 3.4, mul(STONE, 0.8)); // base slab
  B.box(F, B.main, 0, fy + 0.04, 0, 5.0, 0.12, 3.2, C(0x8d8a82));
  // booth: timber body with a window on the road side (-z)
  for (let k = 0; k < 6; k++) B.box(F, B.main, 0.3, fy + 0.2 + 0.4 * (k + 0.5), 0.6, 2.3 + (k % 2) * 0.04, 0.4, 1.9 + (k % 2) * 0.04, mul(C(0x7a5233), 0.95 + (k % 2) * 0.06), { j: 0.05 });
  B.box(F, B.glow, 0.3, fy + 1.45, -0.37, 1.7, 0.85, 0.04, WHITE);
  B.box(F, B.main, 0.3, fy + 1.45, -0.36, 1.9, 1.0, 0.05, DARKWOOD, { j: 0 });
  B.box(F, B.main, 0.3, fy + 2.7, 0.6, 2.7, 0.18, 2.4, C(0x3c2a1c), { j: 0 });
  // canopy: long timber roof across the lane side, supported on two posts and the booth
  const top = fy + 3.9;
  B.beam(F, B.main, [-3.6, top - 0.1, -3.0], [-3.6, top + 0.05, 2.6], 0.1, 0.1, DARKWOOD); // dummy (keeps ridge visible)
  B.beam(F, B.main, [0, top, -3.1], [0, top + 0.3, 0.2], 0.16, 7.8, C(0x5d4d3c), { bot: true, j: 0.04 });
  B.beam(F, B.main, [0, top + 0.3, 0.2], [0, top, 3.6], 0.16, 7.8, C(0x5d4d3c), { bot: true, j: 0.04 });
  B.box(F, B.main, 0, top - 0.25, -3.0, 8.0, 0.4, 0.14, C(0x4b2f1b), { face: 1, j: 0 }); // fascia
  for (const a of [-3.2, 3.8]) { const gyp = env.gl(F, a, -2.0); B.box(F, B.main, a, (top + gyp) / 2 - 0.2, -2.0, 0.34, top - gyp, 0.34, mul(STONE, 0.85), { j: 0.12 }); }
  B.box(F, B.glow, 0, top - 0.1, -1.2, 5, 0.04, 0.3, WHITE);
  // bollards along the shoulder edge
  for (let i = -4; i <= 4; i++) { if (Math.abs(i) < 1) continue; const a = i * 1.6, F2 = env.frame(s + a, 7.0); const g2 = env.gl(F2, 0, 0); B.box(F2, B.main, 0, g2 + 0.45, 0, 0.2, 0.9, 0.2, C(0x5a3d26), { j: 0.15 }); B.box(F2, B.main, 0, g2 + 0.92, 0, 0.21, 0.06, 0.21, C(0xd8d0bc)); }
  // small info board
  const F3 = env.frame(s + 12, 7.8), g3 = env.gl(F3, 0, 0);
  for (const sg of [-1, 1]) B.box(F3, B.main, 0, g3 + 0.7, sg * 0.8, 0.12, 1.4, 0.12, DARKWOOD);
  B.box(F3, B.main, 0, g3 + 1.5, 0, 0.1, 0.8, 1.9, C(0x4b2f1b), { face: 3, uv: B.atlas.rect.piracy ? B.atlas.rect.farview : null, j: 0, ry: 0.0 });
}

function directionSign(B, env) { npsSignAt(B, env, 33190, 8.0, 'dirs', 1.9, 1.4, 3, 0.1); }
function mileSigns(B, env, s) { npsSignAt(B, env, s, 7.8, 'mi' + s, 1.3, 0.65, 3, 0.05); }

// ---- linear features
function snowPoles(B, env, c0, c1) {
  for (let n = Math.ceil(c0 / 200); n * 200 < c1; n++) {
    for (const side of [-1, 1]) {
      const s = n * 200 + (hash(n * 3 + side) - 0.5) * 40 + (side > 0 ? 70 : 0);
      if (s < c0 || s >= c1 || s < 30000 || s > 57600) continue;
      const lat = side * (7.1 + hash(n * 7 + side) * 0.5), F = env.frame(s, lat), g = env.gl(F, 0, 0);
      if (Math.abs(F.elements[13] + g - env.pt(s).y) > 2.5) continue;
      B.box(F, B.main, 0, g + 1.05, 0, 0.1, 2.5, 0.1, C(0x2f2b26), { j: 0.1 });
      B.box(F, B.main, 0, g + 2.0, 0, 0.105, 0.6, 0.105, C(0xe0651a), { j: 0.08 });
      B.box(F, B.main, 0, g + 1.7, side > 0 ? -0.04 : 0.04, 0.02, 0.2, 0.05, C(0xe8e4cc), { j: 0 });
    }
  }
}
function delineators(B, env, c0, c1) {
  for (let n = Math.ceil(c0 / 300); n * 300 < c1; n++) for (const side of [-1, 1]) {
    const s = n * 300 + (side > 0 ? 0 : 130) + (hash(n * 5 + side + 9) - 0.5) * 30;
    if (s < Math.max(c0, 900) || s >= c1 || s > 57600) continue;
    const F = env.frame(s, side * 6.9), g = env.gl(F, 0, 0);
    B.box(F, B.main, 0, g + 0.55, 0, 0.07, 1.2, 0.07, C(0xd8d4c8), { j: 0.08 });
    B.box(F, B.main, side > 0 ? -0.04 : 0.04, g + 1.0, 0, 0.02, 0.2, 0.12, side > 0 ? C(0xf2f2e8) : C(0xe0a010), { j: 0 });
  }
}
const FENCE_ZONES = [[0, 7000], [24000, 29500]];
function ranchFences(B, env, c0, c1) {
  const step = 4;
  let prev = null;
  for (let s = Math.ceil(c0 / step) * step; s < c1 + step; s += step) {
    const zone = FENCE_ZONES.some(([a, b]) => s >= a && s <= b);
    const grp = Math.floor(s / 1400), blk = Math.floor(s / 350);
    const on = zone && hash(blk * 11 + 3) > 0.28 && !(s > 25400 && s < 27600);
    if (!on) { prev = null; continue; }
    const side = hash(grp * 17 + 5) > 0.5 ? 1 : -1, lat = side * (12 + hash(grp * 13 + 7) * 8), split = hash(grp * 19) > 0.55;
    const F = env.frame(s, lat), P = env.pt(s);
    const g = env.gl(F, 0, 0, 0), dy = F.elements[13] + g - P.y;
    if (Math.abs(dy) > 5 || !Number.isFinite(F.elements[13])) { prev = null; continue; }
    const top = F.elements[13] + g + (split ? 1.15 : 1.1);
    const wx = F.elements[12], wz = F.elements[14];
    B.boxM(B.main, new THREE.Matrix4().setPosition(wx, F.elements[13] + g + (split ? 0.55 : 0.5), wz), split ? 0.16 : 0.1, split ? 1.3 : 1.2, split ? 0.16 : 0.1, split ? C(0x7b6448) : C(0x6a5238), { j: 0.2 });
    if (prev) {
      const hs = split ? [0.5, 1.0] : [0.45, 0.75, 1.05];
      for (const hh of hs) {
        const y0 = prev.y + hh, y1 = F.elements[13] + g + hh;
        const a = [prev.x, y0, prev.z], b2 = [wx, y1, wz];
        B.beam(null, B.main, a, b2, split ? 0.1 : 0.025, split ? 0.1 : 0.025, split ? C(0x86705a) : C(0x55524e), { j: 0.12 });
      }
    }
    prev = { x: wx, z: wz, y: F.elements[13] + g };
    void top;
  }
}

// ---- Bryce Canyon City
const TOWN = [
  { s: 25600, side: 1, setback: 24, kind: 'lodge', w: 34, D: 11, key: 'hoodoo', wall: 0x6b4a2e, roof: 0x3b3a36 },
  { s: 25790, side: -1, setback: 17, kind: 'front', w: 13, D: 10, key: 'mercantile', wall: 0x8a5a3a },
  { s: 25960, side: 1, setback: 16, kind: 'front', w: 12, D: 9, key: 'ebenezer', wall: 0x7a6a50 },
  { s: 26090, side: -1, setback: 18, kind: 'front', w: 10, D: 9, key: 'pinyon', wall: 0x6a7a80 },
  { s: 26230, side: 1, setback: 15, kind: 'gas', w: 14, D: 9, key: 'sagebrush', wall: 0x9a8a68 },
  { s: 26360, side: -1, setback: 17, kind: 'front', w: 14, D: 11, key: 'saloon', wall: 0x5a3a2a },
  { s: 26520, side: 1, setback: 16, kind: 'front', w: 11, D: 9, key: 'outfit', wall: 0x7c6a45 },
  { s: 26680, side: -1, setback: 22, kind: 'lodge', w: 30, D: 9, key: 'motel', wall: 0x7a5a3a, roof: 0x4a3f36 },
  { s: 26900, side: 1, setback: 17, kind: 'front', w: 12, D: 9, key: 'grill', wall: 0x8a4a34 },
  { s: 27050, side: -1, setback: 16, kind: 'front', w: 10, D: 8, key: 'hardware', wall: 0x6b6a5a },
  { s: 27250, side: 1, setback: 24, kind: 'lodge', w: 28, D: 10, key: 'inn', wall: 0x6a4630, roof: 0x44403a },
];
const LANTERN = C(0xffd9a0);
function townBuilding(B, env, d) {
  const side = d.side, F = env.frame(d.s, side * d.setback, false), e = F.elements, uv = B.atlas.rect[d.key];
  const w = d.w, D = d.D, fb = env.pt(d.s).y;
  let lo = 1e9;
  for (const a of [-w / 2, 0, w / 2]) for (const dd of [-3.2, 0, D]) { const [x, z] = env.wp(F, a, side * dd); lo = Math.min(lo, env.H(x, z, fb)); }
  const fy = lo + 0.55; e[13] = fy;
  const front = side > 0 ? 1 : 0; // face index that looks at the road
  const bx = (a, y, dd, sa, sy, sd, col, o = {}) => { if (o.front) o.face = front; B.box(F, o.set || B.main, a, y, side * dd, sa, sy, sd, col, o); };
  const wall = mul(C(d.wall), 1.3), H = d.kind === 'lodge' ? 3.5 : 4.0;
  const trim = mul(wall, 0.55), dark = C(0x2a1c12);
  bx(0, -1.1, D / 2, w + 0.2, 2.4, D + 0.2, mul(STONE, 0.65));
  // porch / boardwalk platform
  const pd = d.kind === 'gas' ? 0 : 2.6;
  if (pd) bx(0, -1.0, -pd / 2, w + 0.6, 2.2, pd + 0.1, mul(WOOD, 0.8));
  if (pd) bx(0, 0.07, -pd / 2 - 0.02, w + 0.6, 0.12, pd + 0.2, mul(WOOD, 1.05), { j: 0.2 });
  const strips = Math.ceil(H / 0.42);
  for (let k = 0; k < strips; k++) bx(0, (k + 0.5) * (H / strips) + 0.1, D / 2, w + (k % 2) * 0.06, H / strips, D + (k % 2) * 0.06, mul(wall, 0.96 + (k % 2) * 0.08), { j: 0.03 });
  // windows + door
  const nwin = d.kind === 'lodge' ? Math.floor(w / 4) : 2;
  const wins = [];
  if (d.kind === 'lodge') for (let i = 0; i < nwin; i++) wins.push(-w / 2 + (w / nwin) * (i + 0.5));
  else wins.push(-w * 0.28, w * 0.28);
  for (const a of wins) {
    if (Math.abs(a) < 1.3 && d.kind !== 'lodge') continue;
    const ww = d.kind === 'lodge' ? 1.3 : 1.7;
    bx(a, 1.85, -0.04, ww + 0.3, 1.35, 0.1, trim, { j: 0 });
    bx(a, 1.85, -0.1, ww, 1.1, 0.04, WHITE, { set: B.glow });
  }
  if (d.kind !== 'gas') {
    bx(d.kind === 'lodge' ? w * 0.12 : 0, 1.2, -0.06, 1.1, 2.1, 0.1, dark, { j: 0.1 });
    bx(d.kind === 'lodge' ? w * 0.12 : 0, 2.35, -0.06, 1.3, 0.16, 0.14, trim);
  }
  // roof
  if (d.kind === 'front' || d.kind === 'gas') {
    bx(0, H + 0.25, D / 2, w + 0.5, 0.2, D + 0.6, C(0x3a3631), { rx: side * 0.07, j: 0.05, bot: true });
    const sw = Math.min(w * 0.82, 6.8), sh = sw / 4;
    bx(0, H + 0.2 + 0.1, 0, w + 0.1, sh + 0.5, 0.22, mul(wall, 1.05), { j: 0.02 }); // false front
    bx(0, H + 0.1 + sh / 2 + 0.3, -0.14, sw, sh, 0.1, WHITE, { front: true, uv, fc: WHITE, j: 0 });
    bx(0, H + 0.1 + sh / 2 + 0.3, -0.08, sw + 0.2, sh + 0.15, 0.08, dark, { j: 0 });
    bx(w * 0.25, H + 1.1, D * 0.7, 0.8, 1.8, 0.8, mul(STONE, 0.75)); // chimney
  } else {
    const rise = 2.3, ov = 0.8, col = C(d.roof || 0x3b3a36);
    const hy = H + rise;
    B.beam(F, B.main, [0, hy, side * D / 2], [0, H - 0.3, -side * ov], 0.2, w + 1.4, col, { bot: true, j: 0.06 });
    B.beam(F, B.main, [0, hy, side * D / 2], [0, H - 0.3, side * (D + ov)], 0.2, w + 1.4, mul(col, 0.95), { bot: true, j: 0.06 });
    for (const a of [-w / 2 - 0.02, w / 2 + 0.02]) B.tri(F, B.main, [a, H, 0], [a, H, side * D], [a, hy - 0.05, side * D / 2], mul(wall, 0.9));
    bx(w * 0.3, H + 1.8, D * 0.75, 1.0, 3.2, 1.0, mul(STONE, 0.75));
    // painted sign board on posts in the yard
    for (const sg of [-1, 1]) bx(-w * 0.15 + sg * 1.7, 1.2, -pd - 4.2, 0.14, 2.4, 0.14, DARKWOOD);
    bx(-w * 0.15, 2.1, -pd - 4.2, 3.4, 0.9, 0.1, WHITE, { front: true, uv, fc: WHITE, j: 0 });
    bx(-w * 0.15, 2.1, -pd - 4.15, 3.6, 1.0, 0.08, dark, { j: 0 });
  }
  // porch roof + posts + lanterns
  if (d.kind !== 'gas') {
    const pe = pd;
    const px = [-w / 2 + 0.3, -w / 6, w / 6, w / 2 - 0.3];
    B.beam(F, B.main, [0, H - 0.2, -side * 0.05], [0, 2.75, -side * (pe + 0.3)], 0.12, w + 0.9, C(0x4a3828), { bot: true, j: 0.05 });
    for (const a of px) { bx(a, 1.4, -pe + 0.2, 0.15, 2.7, 0.15, WOOD, { j: 0.15 }); bx(a, 1.65, -pe + 0.2, 0.16, 0.16, 0.16, LANTERN, { set: B.glow, front: false }); }
    bx(0, 0.35, -pd - 0.1, 0.08, 0.08, 0.08, WOOD); // (tiny trim, keeps the box count honest)
    // hitching rail between boardwalk and road
    for (const a of [-w * 0.28, w * 0.28]) {
      const ya = (aa) => env.gl(F, aa, -side * (pd + 1.4));
      for (const sa of [-1.4, 1.4]) { const g = ya(a + sa); bx(a + sa, g + 0.5, -(pd + 1.4), 0.14, 1.1, 0.14, mul(WOOD, 0.8), { j: 0.15 }); }
      bx(a, ya(a) + 0.95, -(pd + 1.4), 3.2, 0.1, 0.1, mul(WOOD, 0.85));
    }
  } else gasStation(B, env, d, F, bx, uv, fy);
  // gravel apron between road and boardwalk
  decal(B, env, F, -w / 2 - 1.5, w / 2 + 1.5, -side * (d.setback - 6.0) - 0, -side * 0, C(0x8a7a62), 3, 0.05, 0.08);
}
function gasStation(B, env, d, F, bx, uv, fy) {
  const side = d.side;
  const ch = 4.6, cd = 6.5; // canopy depth from the front toward the road
  bx(0, ch, -cd / 2 - 1, d.w - 1, 0.5, cd, C(0xd8d2bf), { bot: true, j: 0.03 });
  bx(0, ch + 0.05, -cd - 1.1, d.w - 1, 0.8, 0.2, WHITE, { front: true, uv, fc: WHITE, j: 0 }); // fascia sign (cropped by aspect)
  for (const a of [-d.w / 2 + 1.5, d.w / 2 - 1.5]) for (const dd of [-2.2, -cd]) {
    const g = env.gl(F, a, -side * (dd)) ; bx(a, (ch + g) / 2 - 0.1, dd, 0.4, ch - g, 0.4, C(0xcfc9b6), { j: 0.03 });
  }
  bx(0, ch - 0.3, -cd / 2 - 1, d.w - 2, 0.04, cd - 1.5, WHITE, { set: B.glow });
  for (const a of [-d.w * 0.2, d.w * 0.2]) { const g = env.gl(F, a, -side * 3.8); bx(a, g + 0.1, -3.8, 0.8, 0.2, 3.4, C(0x85827a)); for (const sg of [-1, 1]) bx(a, g + 0.95, -3.8 + sg * 0.8, 0.5, 1.5, 0.35, C(0x7d3b2c), { j: 0.05 }); }
  void fy;
}

// ------------------------------------------------------------------ feature table
const OVERLOOKS = [
  { s: 45420, key: 'piracy' }, { s: 45705, key: 'farview' }, { s: 48705, key: 'natbridge' }, { s: 50990, key: 'agua' },
  { s: 52620, key: 'ponderosa' }, { s: 54065, key: 'blackbirch' }, { s: 57560, key: 'rainbow' },
];
const POINTS = [
  ...OVERLOOKS.map((d) => ({ s: d.s, build: (B, env) => overlookSigns(B, env, d) })),
  { s: 29700, build: entranceSign }, { s: 29897, build: cattleGuard }, { s: 30455, build: entranceStation },
  { s: 33190, build: directionSign },
  ...MILES.map(([s]) => ({ s, build: (B, env) => mileSigns(B, env, s) })),
  ...TOWN.map((d) => ({ s: d.s, build: (B, env) => townBuilding(B, env, d) })),
];
const LINEAR = [snowPoles, delineators, ranchFences];

// ------------------------------------------------------------------ landmark
const SETS = ['main', 'decal', 'glow'];
function toGeo(arrs, withUV) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arrs.p), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(arrs.n), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(arrs.c), 3));
  if (withUV) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(arrs.u), 2));
  return g;
}

export const BRYCE_ROADSIDE = {
  id: 'bryce-roadside', kind: 'ambient', local: true, cooldown: 1,
  possible: (ctx) => ctx.place?.id === 'bryce' && !!ctx.world && !!ctx.geo && !!ctx.route && !!ctx.terrain?.heightAt,
  chance: () => 1,
  create(ctx) {
    const group = new THREE.Group(); group.name = 'bryceRoadside';
    ctx.world.add(group);
    const atlas = makeAtlas(), env = makeEnv(ctx);
    const mats = {
      main: new THREE.MeshStandardMaterial({ map: atlas.tex, vertexColors: true, roughness: 0.88, metalness: 0 }),
      decal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      glow: new THREE.MeshStandardMaterial({ color: 0x232a30, roughness: 0.25, metalness: 0.1, emissive: new THREE.Color(0xffb866), emissiveIntensity: 0 }),
    };
    const meshes = {};
    const chunks = new Map(); // index -> { data: {main,decal,glow} arrays }
    const maxChunk = Math.floor(ctx.route.length / CHUNK);
    const byChunk = new Map();
    for (const f of POINTS) { const k = Math.floor(f.s / CHUNK); if (!byChunk.has(k)) byChunk.set(k, []); byChunk.get(k).push(f); }
    const centre = (k) => { const P = ctx.route.sample(k * CHUNK + CHUNK / 2, {}); return P; };
    const ready = (k) => {
      for (let s = k * CHUNK; s <= (k + 1) * CHUNK + 1; s += 50) {
        const P = ctx.route.sample(Math.min(s, ctx.route.length), {});
        for (const l of [0, 20, -20]) { const h = ctx.terrain.heightAt(P.x - P.tz * l, P.z + P.tx * l); if (!Number.isFinite(h)) return false; }
      }
      return true;
    };
    const buildChunk = (k) => {
      const B = new Builder(atlas, 1000 + k);
      for (const f of byChunk.get(k) || []) f.build(B, env);
      for (const fn of LINEAR) fn(B, env, k * CHUNK, (k + 1) * CHUNK);
      return { main: B.main, decal: B.decal, glow: B.glow };
    };
    let dirty = false, clock = 0, stats = { tris: 0 };
    const rebuild = () => {
      for (const n of SETS) {
        const all = { p: [], n: [], c: [], u: [] };
        for (const ch of chunks.values()) for (const key of ['p', 'n', 'c', 'u']) { const a = ch[n][key]; for (let i = 0; i < a.length; i++) all[key].push(a[i]); }
        if (meshes[n]) { meshes[n].geometry.dispose(); meshes[n].removeFromParent(); meshes[n] = null; }
        if (!all.p.length) continue;
        const m = new THREE.Mesh(toGeo(all, n === 'main'), mats[n]);
        m.frustumCulled = false; m.castShadow = n === 'main'; m.receiveShadow = true; m.name = 'bryceRoadside_' + n;
        group.add(m); meshes[n] = m;
        if (n === 'main') stats.tris = all.p.length / 9;
      }
      BRYCE_ROADSIDE.stats = { tris: stats.tris, chunks: chunks.size, keys: [...chunks.keys()].join(','), draws: Object.values(meshes).filter(Boolean).length };
      dirty = false;
    };
    let night = 0;
    return {
      update(dt, c) {
        night += ((c.night ?? 0) - night) * Math.min(1, dt * 2);
        mats.glow.emissiveIntensity = 1.6 * night;
        clock += dt;
        if (clock < 0.4) return true;
        clock = 0;
        const s = Number.isFinite(c.s) ? c.s : 0, cam = c.camera?.position;
        const want = (k) => {
          const c0 = k * CHUNK, c1 = c0 + CHUNK, ds = Math.max(0, c0 - s, s - c1);
          if (ds < 600) return 2;
          if (cam) { const P = centre(k); if (Math.hypot(cam.x - P.x, cam.z - P.z) < 600) return 2; if (Math.hypot(cam.x - P.x, cam.z - P.z) < 800) return 1; }
          return ds < 800 ? 1 : 0;
        };
        for (const k of [...chunks.keys()]) if (want(k) === 0) { chunks.delete(k); dirty = true; }
        const k0 = Math.max(0, Math.floor((s - 700) / CHUNK)), k1 = Math.min(maxChunk, Math.floor((s + 700) / CHUNK));
        const ks = new Set(); for (let k = k0; k <= k1; k++) ks.add(k);
        if (cam) { const kc = Math.floor(nearestS(ctx.route, cam.x, cam.z) / CHUNK); for (let k = kc - 3; k <= kc + 3; k++) if (k >= 0 && k <= maxChunk) ks.add(k); }
        for (const k of ks) {
          if (chunks.has(k) || want(k) < 2) continue;
          if (!ready(k)) continue;
          try { chunks.set(k, buildChunk(k)); } catch (e) { console.warn('bryce-roadside chunk', k, e); chunks.set(k, { main: mkset(), decal: mkset(), glow: mkset() }); }
          dirty = true; break; // one per tick
        }
        if (dirty) rebuild();
        return true;
      },
      dispose() {
        for (const n of SETS) if (meshes[n]) { meshes[n].geometry.dispose(); }
        group.removeFromParent();
        for (const m of Object.values(mats)) m.dispose();
        atlas.tex.dispose();
        chunks.clear();
      },
    };
  },
};

// coarse nearest route distance to a point (used only to pick chunks around an inspection camera)
let _nsCache = null;
function nearestS(route, x, z) {
  if (!_nsCache || _nsCache.route !== route) {
    const pts = []; const P = {};
    for (let s = 0; s <= route.length; s += 40) { route.sample(s, P); pts.push([s, P.x, P.z]); }
    _nsCache = { route, pts };
  }
  let best = 0, bd = Infinity;
  for (const [s, px, pz] of _nsCache.pts) { const d = (px - x) ** 2 + (pz - z) ** 2; if (d < bd) { bd = d; best = s; } }
  return best;
}
