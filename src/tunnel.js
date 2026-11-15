// Tunnel visuals for Long Drive: endless lit tube (procedural shader, no real lights), exit glow, and outside portals.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TUNNEL = { halfWidth: 5.6, height: 6.2, period: 14 };

const W = 5.6, H = 6.2, P = 14;
const LEN = 420;
const WALL_TOP = 3.4; // wall height where the arch begins
const ARCH_RY = H - WALL_TOP;
const LAMP_X = 2.2, LAMP_Y = 5.85, LAMP_HALF = 4.0;
const PORTAL_DEPTH = 46;

// ---------------------------------------------------------------------------------------------
// shaders
// ---------------------------------------------------------------------------------------------
const GLSL_COMMON = /* glsl */ `
#define PERIOD 14.0
#define LX 2.2
#define LY 5.85
#define LHALF 4.0
uniform float uExit;
uniform vec3 uExitCol;
uniform vec3 uLamp;
uniform vec3 uCove;
uniform vec3 uDay;
varying vec3 vP;
varying vec3 vCam;
varying float vKind;

float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x), mix(hash21(i+vec2(0.,1.)),hash21(i+vec2(1.,1.)),f.x), f.y);
}
// AA'd grid line: uv in cell units, w = half line width (cell units)
float gridLine(vec2 uv, float w){
  vec2 fw = fwidth(uv) + 1e-4;
  vec2 d = abs(fract(uv-0.5)-0.5);
  vec2 l = (1.-smoothstep(vec2(w), vec2(w)+fw, d)) * (2.*w/(2.*w+fw));
  return max(l.x,l.y);
}
float line1(float u, float w){
  float fw = fwidth(u) + 1e-4;
  float d = abs(fract(u-0.5)-0.5);
  return (1.-smoothstep(w, w+fw, d)) * (2.*w/(2.*w+fw));
}
// overhead light felt at p (fake inverse-square from the two lamp rows, two nearest lamps)
float lampLight(vec3 p){
  float s = p.z/PERIOD + 0.5;
  float f = s - floor(s+0.5);
  float dz1 = f*PERIOD;
  float dz2 = dz1 - (f>=0. ? 1. : -1.)*PERIOD;
  float acc = 0.;
  for(int i=0;i<2;i++){
    float dz = max(abs(i==0?dz1:dz2) - LHALF*0.7, 0.);
    float dy = p.y - LY;
    float a = p.x - LX, b = p.x + LX;
    acc += 1./(1.+(dz*dz + a*a + dy*dy)/6.) + 1./(1.+(dz*dz + b*b + dy*dy)/6.);
  }
  return acc;
}
float lampMask(vec3 q, float wx){
  float s = q.z/PERIOD + 0.5;
  float f = s - floor(s+0.5);
  float dz = abs(f)*PERIOD;
  float mz = 1.-smoothstep(LHALF-0.8, LHALF+1.6, dz);
  float ex = abs(q.x)-LX;
  return exp(-ex*ex/(wx*wx))*mz;
}
`;

const SHELL_VERT = /* glsl */ `
attribute float kind;
varying vec3 vP; varying vec3 vCam; varying float vKind;
void main(){
  vP = position; vKind = kind;
  vCam = (inverse(modelMatrix)*vec4(cameraPosition,1.)).xyz;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.);
}`;

const SHELL_FRAG = /* glsl */ `
${GLSL_COMMON}
void main(){
  vec3 p = vP;
  #ifndef PORTAL
    if (p.z < -uExit) discard;
  #endif
  float kind = floor(vKind+0.5);
  if (kind > 4.5) { gl_FragColor = vec4(0.,0.,0.,1.); return; }
  vec3 albedo = vec3(0.5);
  vec3 emis = vec3(0.);
  vec3 refl = vec3(0.);
  vec3 V = normalize(p - vCam);
  float dd = length(p - vCam);

  if (kind < 0.5) {
    // ---- road
    float n = vnoise(p.xz*vec2(2.2,0.8)) * 0.6 + vnoise(p.xz*vec2(9.,3.)) * 0.4;
    albedo = vec3(0.058,0.060,0.064) * (0.75 + 0.5*n);
    // worn lanes
    albedo *= 1. - 0.18*exp(-pow((abs(p.x)-1.9)/0.6,2.));
    float wx = fwidth(p.x)*0.8 + 0.008;
    float edge = 1.-smoothstep(0.07, 0.07+wx, abs(abs(p.x)-4.1));
    float wz = fwidth(p.z)*0.35 + 0.01;
    float m = mod(p.z, 14.);
    float dash = smoothstep(0., wz, m) * (1.-smoothstep(4., 4.+wz, m));
    float cl = (1.-smoothstep(0.07, 0.07+wx, abs(p.x))) * dash;
    float mark = max(edge, cl);
    albedo = mix(albedo, vec3(0.62,0.62,0.6), mark*0.92);
    // glossy reflection of lamps / exit
    vec3 R = vec3(V.x, abs(V.y), V.z);
    float fres = 0.05 + 0.9*pow(1.-R.y, 5.);
    float t = (LY - p.y)/max(R.y, 1e-3);
    vec3 q = p + R*t;
    float lm = lampMask(q, 1.0);
    refl += uLamp * lm * fres * 5.0;
    if (uExit < 1.0e5 && R.z < -1e-3) {
      float tz = (-uExit - p.z)/R.z;
      if (tz > 0.) {
        float xh = p.x + R.x*tz, yh = p.y + R.y*tz;
        float mm = (1.-smoothstep(2.0,7.0,abs(xh))) * (1.-smoothstep(1.5,9.0,yh));
        refl += uExitCol * mm * fres * 4.5;
      }
    }
    refl *= (1. - mark*0.7);
  } else if (kind < 1.5) {
    // ---- wall
    float y = p.y;
    float side = p.x > 0. ? 1. : -1.;
    vec2 tuv = vec2(p.z/0.6, y/0.3);
    float h = hash21(floor(tuv) + side*7.3);
    vec3 tile = vec3(0.74,0.76,0.74) * (0.95 + 0.08*h);
    tile = mix(tile, vec3(0.40,0.42,0.41), gridLine(tuv, 0.035)*0.75);
    // darker dado near the floor, a hint of grime
    tile *= 0.86 + 0.14*smoothstep(0.2, 1.2, y);
    vec3 conc = vec3(0.50,0.50,0.49) * (0.88 + 0.24*vnoise(p.zy*vec2(0.5,1.2)*2.));
    conc = mix(conc, conc*0.72, line1(p.z/3., 0.012));
    float tileMask = 1.-smoothstep(2.57, 2.61, y);
    albedo = mix(conc, tile, tileMask);
    // aluminium trim
    float trim = smoothstep(2.60,2.62,y) * (1.-smoothstep(2.71,2.73,y));
    albedo = mix(albedo, vec3(0.58,0.60,0.62), trim);
    // cable tray
    float tray = smoothstep(3.07,3.09,y) * (1.-smoothstep(3.30,3.32,y));
    float rung = 0.55 + 0.45*smoothstep(0.35,0.65, abs(fract(p.z/0.35)-0.5)*2.);
    albedo = mix(albedo, vec3(0.16,0.17,0.18)*rung, tray);
    // LED cove line + soft up-glow
    float cove = 1.-smoothstep(0.025, 0.06, abs(y-2.955));
    emis += uCove * (cove*3.2 + 0.5*exp(-abs(y-2.95)*3.5)*step(2.9,y));
    // amber guide markers every 7 m
    float mz = abs(mod(p.z, 7.)-3.5);
    float mk = (1.-smoothstep(0.07,0.1,mz)) * (1.-smoothstep(0.05,0.07,abs(y-0.5)));
    emis += vec3(1.,0.5,0.12) * mk * 2.6;
    // emergency signs + hose cabinet (every 98 m)
    float off = mod(p.z, 98.) - 49.;
    float sg = (1.-smoothstep(0.84,0.88,abs(off))) * smoothstep(1.78,1.80,y) * (1.-smoothstep(2.38,2.40,y));
    float door = (1.-smoothstep(0.24,0.27,abs(off))) * smoothstep(1.88,1.90,y) * (1.-smoothstep(2.28,2.30,y));
    vec3 sgn = mix(vec3(0.05,0.55,0.22), vec3(0.85,0.95,0.88), door);
    albedo = mix(albedo, vec3(0.02), sg);
    emis += sgn * sg * 1.6;
    float cab = (1.-smoothstep(0.38,0.4,abs(off))) * smoothstep(0.88,0.9,y) * (1.-smoothstep(1.58,1.6,y));
    albedo = mix(albedo, vec3(0.45,0.05,0.04), cab);
    // lamp reflections in the glossy tiles
    vec3 R = vec3(-V.x, V.y, V.z);
    float fres = 0.04 + 0.5*pow(1.-abs(V.x), 4.);
    if (R.y > 0.01) {
      vec3 q = p + R*((LY - p.y)/R.y);
      refl += uLamp * lampMask(q, 0.55) * fres * 1.6 * tileMask;
    }
  } else if (kind < 2.5) {
    // ---- ceiling
    vec3 c = vec3(0.54,0.54,0.52) * (0.9 + 0.2*vnoise(p.xz*0.8+3.));
    c = mix(c, c*0.7, line1(p.z/3.5, 0.012));
    float ang = atan(p.y-3.4, p.x);
    c = mix(c, c*0.78, line1(ang/0.3927, 0.01));
    albedo = c;
  } else {
    // ---- kerb / walkway
    albedo = vec3(0.46,0.46,0.45) * (0.88 + 0.24*vnoise(p.xz*vec2(3.,0.8)));
    albedo = mix(albedo, albedo*0.7, line1(p.z/2., 0.015));
  }

  float L = lampLight(p);
  vec3 light = vec3(0.10,0.11,0.12) + uLamp * 2.4 * L;
  light += uExitCol * 3.2 * exp(-max(p.z + uExit, 0.)/26.);
  #ifdef PORTAL
    light += uDay * exp(-(-p.z)/6.);
  #endif
  vec3 col = albedo * light + emis + refl;

  #ifdef PORTAL
    float zf = exp(-(-p.z)/20.) * (1.-smoothstep(24., 46., -p.z));
    col *= zf;
  #else
    col *= exp(-pow(dd/175., 2.));
  #endif
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const LAMP_VERT = /* glsl */ `
uniform float uExit;
varying vec3 vP; varying vec3 vCam; varying float vKind;
void main(){
  vec4 lp = instanceMatrix * vec4(position,1.);
  vP = lp.xyz; vKind = 0.;
  vCam = (inverse(modelMatrix)*vec4(cameraPosition,1.)).xyz;
  gl_Position = projectionMatrix*modelViewMatrix*lp;
  #ifndef PORTAL
    if (lp.z < -uExit) gl_Position = vec4(2.,2.,2.,1.);
  #endif
}`;

const LAMP_FRAG = /* glsl */ `
${GLSL_COMMON}
void main(){
  float dd = length(vP - vCam);
  vec3 col = uLamp * 6.5;
  #ifdef PORTAL
    col *= exp(-(-vP.z)/38.) * (1.-smoothstep(30., 46., -vP.z));
  #else
    col *= exp(-pow(dd/330., 2.));
  #endif
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const EXIT_VERT = /* glsl */ `
varying vec3 vP;
void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const EXIT_FRAG = /* glsl */ `
uniform vec3 uExitCol;
varying vec3 vP;
void main(){
  vec2 c = vec2(vP.x/5.6, (vP.y-3.2)/3.3);
  float r = length(c);
  vec3 base = mix(vec3(1.), uExitCol, 0.40 + 0.40*smoothstep(0., 1.1, r));
  vec3 col = base * mix(15., 7., smoothstep(0.05, 1.1, r));
  gl_FragColor = vec4(col, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------------------------
function archPoints(rx, ry, cy, n = 20) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI * (1 - i / n); // left -> right over the top
    pts.push([rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

function buildShell(z0, z1, cap) {
  // cross-section as segments with a "kind" (0 road, 1 wall, 2 ceiling, 3 kerb)
  const segs = [];
  const add = (a, b, k) => segs.push([a, b, k]);
  add([-4.7, 0], [4.7, 0], 0);
  add([4.7, 0], [4.7, 0.2], 3);
  add([4.7, 0.2], [W, 0.2], 3);
  add([W, 0.2], [W, WALL_TOP], 1);
  const arc = archPoints(W, ARCH_RY, WALL_TOP, 18).reverse(); // right -> left
  for (let i = 0; i < arc.length - 1; i++) add(arc[i], arc[i + 1], 2);
  add([-W, WALL_TOP], [-W, 0.2], 1);
  add([-W, 0.2], [-4.7, 0.2], 3);
  add([-4.7, 0.2], [-4.7, 0], 3);
  const pos = [], kind = [], idx = [];
  const push = (x, y, z, k) => { pos.push(x, y, z); kind.push(k); return pos.length / 3 - 1; };
  for (const [a, b, k] of segs) {
    const i0 = push(a[0], a[1], z0, k), i1 = push(b[0], b[1], z0, k);
    const i2 = push(b[0], b[1], z1, k), i3 = push(a[0], a[1], z1, k);
    idx.push(i0, i1, i2, i0, i2, i3);
  }
  if (cap) { // black end cap closing the tube
    const poly = [[-4.7, 0], [4.7, 0], [4.7, 0.2], [W, 0.2], [W, WALL_TOP], ...archPoints(W, ARCH_RY, WALL_TOP, 18).reverse().slice(1), [-W, 0.2], [-4.7, 0.2]];
    const base = pos.length / 3;
    for (const [x, y] of poly) push(x, y, z1, 5);
    const c = push(0, 2, z1, 5);
    for (let i = 0; i < poly.length; i++) idx.push(c, base + i, base + (i + 1) % poly.length);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('kind', new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, (z0 + z1) / 2), Math.abs(z0 - z1) / 2 + 10);
  return g;
}

function lampMatrices(kStart, kEnd) {
  const m = [];
  const o = new THREE.Object3D();
  for (let k = kStart; k <= kEnd; k++) {
    for (const s of [-1, 1]) {
      const dydx = -ARCH_RY * LAMP_X / (W * W * Math.sqrt(1 - (LAMP_X / W) ** 2));
      o.position.set(s * LAMP_X, LAMP_Y + 0.02, -(k + 0.5) * P);
      o.rotation.set(0, 0, Math.atan(dydx) * s * -1 * -1 * (s > 0 ? 1 : 1));
      // right side slopes down toward +x (negative slope), left mirrors
      o.rotation.z = s > 0 ? Math.atan(dydx) : -Math.atan(dydx);
      o.updateMatrix();
      m.push(o.matrix.clone());
    }
  }
  return m;
}

function noise2(x, y) {
  const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (h(ix, iy) * (1 - u) + h(ix + 1, iy) * u) * (1 - v) + (h(ix, iy + 1) * (1 - u) + h(ix + 1, iy + 1) * u) * v;
}
const fbm = (x, y) => noise2(x, y) * 0.55 + noise2(x * 2.1 + 5, y * 2.1 + 9) * 0.3 + noise2(x * 4.3 + 11, y * 4.3 + 3) * 0.15;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function concreteTexture(kind) {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  if (kind === 'stone') {
    g.fillStyle = '#b9b3a6'; g.fillRect(0, 0, S, S);
    const rows = 8, rh = S / rows;
    for (let r = 0; r < rows; r++) {
      const cols = r % 2 ? 3 : 4, cw = S / 4;
      for (let k = -1; k < cols + 1; k++) {
        const off = r % 2 ? cw / 2 : 0;
        const x = k * cw + off;
        const v = 168 + Math.random() * 34;
        g.fillStyle = `rgb(${v + 6},${v + 1},${v - 12})`;
        g.fillRect(x + 2, r * rh + 2, cw - 4, rh - 4);
      }
    }
  } else {
    g.fillStyle = '#9a9a96'; g.fillRect(0, 0, S, S);
    // vertical form-board streaks
    for (let x = 0; x < S; x += 16) {
      const v = 142 + Math.random() * 22;
      g.fillStyle = `rgb(${v},${v},${v - 4})`;
      g.fillRect(x, 0, 16, S);
      g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(x, 0, 1.5, S);
    }
  }
  const d = g.getImageData(0, 0, S, S);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n;
  }
  g.putImageData(d, 0, 0);
  // soft stains
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 20 + Math.random() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(60,55,45,0.10)'); gr.addColorStop(1, 'rgba(60,55,45,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// planar world-space UVs (metres * scale) chosen by face normal
function worldUV(geo, scale) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    let u, v;
    if (nx >= ny && nx >= nz) { u = p.getZ(i); v = p.getY(i); }
    else if (ny >= nz) { u = p.getX(i); v = p.getZ(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
function prep(geo, scale) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  worldUV(g, scale);
  g.deleteAttribute('uv'); // recompute to be safe below
  worldUV(g, scale);
  return g;
}
function boxGeo(w, h, d, cx, cy, cz) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
  return g;
}

// ---------------------------------------------------------------------------------------------
export class Tunnel {
  constructor(renderer) {
    this.renderer = renderer;
    this.exitDist = null;
    this._u = {
      uExit: { value: 1e9 },
      uExitCol: { value: new THREE.Color(1.0, 0.95, 0.85) },
      uLamp: { value: new THREE.Color(1.0, 0.88, 0.70) },
      uCove: { value: new THREE.Color(0.55, 0.78, 1.0) },
      uDay: { value: new THREE.Color(0.55, 0.58, 0.62) },
    };
    const mk = (vs, fs, defines) => new THREE.ShaderMaterial({
      uniforms: this._u, vertexShader: vs, fragmentShader: fs, defines, side: THREE.DoubleSide, fog: false,
    });
    this.shellMat = mk(SHELL_VERT, SHELL_FRAG, {});
    this.lampMat = mk(LAMP_VERT, LAMP_FRAG, {});
    this.portalShellMat = mk(SHELL_VERT, SHELL_FRAG, { PORTAL: 1 });
    this.portalLampMat = mk(LAMP_VERT, LAMP_FRAG, { PORTAL: 1 });
    this.exitMat = new THREE.ShaderMaterial({ uniforms: this._u, vertexShader: EXIT_VERT, fragmentShader: EXIT_FRAG, fog: false, side: THREE.DoubleSide });

    this.lampGeo = new THREE.BoxGeometry(0.4, 0.07, LAMP_HALF * 2); this.lampGeo.userData.shared = true;
    this.shellGeo = buildShell(10, -LEN, true);
    this.portalShellGeo = buildShell(0, -PORTAL_DEPTH, true); this.portalShellGeo.userData.shared = true;

    // exit plane (arch shaped)
    const sh = new THREE.Shape();
    const arc = archPoints(W + 0.3, ARCH_RY + 0.3, WALL_TOP, 20);
    sh.moveTo(-W - 0.3, 0); sh.lineTo(W + 0.3, 0);
    for (let i = arc.length - 1; i >= 0; i--) sh.lineTo(arc[i][0], arc[i][1]);
    sh.closePath();
    this.exitGeo = new THREE.ShapeGeometry(sh);

    const interior = (this.interior = new THREE.Group());
    interior.name = 'tunnel-interior';
    const shell = new THREE.Mesh(this.shellGeo, this.shellMat);
    const lamps = new THREE.InstancedMesh(this.lampGeo, this.lampMat, 2 * (LEN / P + 1));
    lampMatrices(-1, LEN / P - 1).forEach((m, i) => lamps.setMatrixAt(i, m));
    lamps.instanceMatrix.needsUpdate = true;
    this.exitMesh = new THREE.Mesh(this.exitGeo, this.exitMat);
    this.exitMesh.visible = false;
    for (const m of [shell, lamps, this.exitMesh]) { m.frustumCulled = false; interior.add(m); }
    shell.renderOrder = 0;

    this.concreteMat = new THREE.MeshStandardMaterial({ map: concreteTexture('concrete'), roughness: 0.93, side: THREE.DoubleSide });
    this.stoneMat = new THREE.MeshStandardMaterial({ map: concreteTexture('stone'), roughness: 0.9, side: THREE.DoubleSide });
    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: false });
  }

  setExit(dist) {
    this.exitDist = dist == null ? null : dist;
    this._u.uExit.value = dist == null ? 1e9 : dist;
    this.exitMesh.visible = dist != null;
    if (dist != null) this.exitMesh.position.z = -dist;
  }

  setExitColor(color) {
    this._u.uExitCol.value.copy(color);
  }

  lightAt(z) {
    const s = z / P + 0.5;
    const f = s - Math.round(s);
    const dz = Math.max(Math.abs(f) * P - LAMP_HALF * 0.8, 0);
    return 0.1 + 0.9 * Math.exp(-dz * dz / (2 * 2.2 * 2.2));
  }

  makePortal({ style = 'rock', halfWidth = 7 } = {}) {
    const city = style === 'city';
    const g = new THREE.Group();
    g.name = 'tunnel-portal-' + style;
    const FW = city ? 20 : 14, FH = city ? 11 : 9.5;
    const xw = halfWidth + 0.8, Lz = 16;
    const NW = W + 0.04, NRY = ARCH_RY + 0.04;
    const uvScale = city ? 0.25 : 0.2;
    const geos = [];

    // facade slab with an arched notch
    const slab = new THREE.Shape();
    const arc = archPoints(NW, NRY, WALL_TOP, 24);
    slab.moveTo(-FW, -1.5); slab.lineTo(-NW, -1.5);
    for (const [x, y] of arc) slab.lineTo(x, y);
    slab.lineTo(NW, -1.5); slab.lineTo(FW, -1.5); slab.lineTo(FW, FH); slab.lineTo(-FW, FH); slab.closePath();
    const slabG = new THREE.ExtrudeGeometry(slab, { depth: 1.8, bevelEnabled: false, curveSegments: 1 });
    slabG.translate(0, 0, -1.8);
    geos.push(prep(slabG, uvScale));

    // surround ring, proud of the facade
    const rr = new THREE.Shape();
    const outer = archPoints(NW + 0.9, NRY + 0.9, WALL_TOP, 24);
    rr.moveTo(-NW - 0.9, -1.5);
    for (const [x, y] of outer) rr.lineTo(x, y);
    rr.lineTo(NW + 0.9, -1.5); rr.lineTo(NW, -1.5);
    for (let i = arc.length - 1; i >= 0; i--) rr.lineTo(arc[i][0], arc[i][1]);
    rr.lineTo(-NW, -1.5); rr.closePath();
    geos.push(prep(new THREE.ExtrudeGeometry(rr, { depth: 0.5, bevelEnabled: false, curveSegments: 1 }), uvScale));

    // flared wing walls
    for (const s of [-1, 1]) {
      const wg = new THREE.BufferGeometry();
      const v = [s * FW, -1.5, 0, s * FW, FH, 0, s * xw, 0.9, Lz, s * xw, -1.5, Lz];
      wg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      wg.setIndex(s > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
      wg.computeVertexNormals();
      geos.push(prep(wg, uvScale));
    }

    let hill = null;
    if (city) {
      // cornice, parapet and the solid mass around the tube
      geos.push(prep(boxGeo(2 * FW + 1.4, 0.6, 2.8, 0, FH - 0.3, -0.2), uvScale));
      geos.push(prep(boxGeo(2 * FW + 0.4, 0.5, 1.4, 0, FH - 1.2, 0.35), uvScale)); // lower band
      geos.push(prep(boxGeo(2 * FW + 0.2, 1.0, 1.0, 0, FH + 0.5, -0.4), uvScale)); // parapet
      geos.push(prep(boxGeo(FW - W - 0.2, FH + 1.5, PORTAL_DEPTH, (FW + W + 0.2) / 2, (FH - 1.5) / 2, -PORTAL_DEPTH / 2 - 1.8), uvScale));
      geos.push(prep(boxGeo(FW - W - 0.2, FH + 1.5, PORTAL_DEPTH, -(FW + W + 0.2) / 2, (FH - 1.5) / 2, -PORTAL_DEPTH / 2 - 1.8), uvScale));
      geos.push(prep(boxGeo(2 * W + 0.4, FH - H - 0.3, PORTAL_DEPTH, 0, (FH + H + 0.3) / 2, -PORTAL_DEPTH / 2 - 1.8), uvScale));
    } else {
      hill = this._buildHill(FW, xw, Lz);
    }
    const body = new THREE.Mesh(mergeGeometries(geos, false), city ? this.stoneMat : this.concreteMat);
    geos.forEach((x) => x.dispose());
    g.add(body);
    if (hill) g.add(new THREE.Mesh(hill, this.rockMat));

    // dark but inviting interior behind the mouth
    const shell = new THREE.Mesh(this.portalShellGeo, this.portalShellMat);
    shell.frustumCulled = false;
    g.add(shell);
    const lamps = new THREE.InstancedMesh(this.lampGeo, this.portalLampMat, 6);
    lampMatrices(0, 2).forEach((m, i) => lamps.setMatrixAt(i, m));
    lamps.frustumCulled = false;
    g.add(lamps);
    return g;
  }

  _buildHill(FW, xw, Lz) {
    const XS = [];
    for (let x = -46; x <= 46.01; x += 2.5) XS.push(x);
    const ZS = [22, 19, 16, 13, 10, 7, 4.5, 2.5, 1, -0.1, -1.55, -3.5, -6];
    for (let z = -9; z >= -60; z -= 3) ZS.push(z);
    const nx = XS.length, nz = ZS.length;
    const height = (x, z) => {
      const r = Math.hypot(x / 42, (z + 18) / 40);
      const dome = 1 - sstep(0.28, 1.0, r);
      let h = -6 + 31 * dome;
      h += (fbm(x * 0.06, z * 0.06) - 0.5) * 12 * Math.min(1, dome * 2.5);
      h += (fbm(x * 0.22 + 20, z * 0.22) - 0.5) * 3 * Math.min(1, dome * 2.5);
      const ax = Math.abs(x);
      if (z > -0.5) {
        const cw = (FW - 0.4) + (xw - (FW - 0.4)) * Math.min(Math.max(z, 0) / Lz, 1);
        const mask = 1 - sstep(cw, cw + 3.5, ax);
        h = h + (-6 - h) * mask;
      } else if (z < -1.0) {
        const lim = 8.8 + 0.9 * Math.max(-1.55 - z, 0);
        const wgt = 1 - sstep(FW - 1, FW + 7, ax);
        h = Math.min(h, h + (lim - h) * wgt);
      }
      return h;
    };
    const pos = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3;
      pos[k] = XS[i]; pos[k + 1] = height(XS[i], ZS[j]); pos[k + 2] = ZS[j];
    }
    const idx = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      const hs = [pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1], pos[d * 3 + 1]];
      if (Math.max(...hs) < -5.5) continue;
      const xm = (XS[i] + XS[i + 1]) / 2, zm = (ZS[j] + ZS[j + 1]) / 2;
      if (Math.abs(xm) < 8 && zm > -1.65 && zm < 1.5) continue; // keep the mouth clear
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal, col = new Float32Array(nx * nz * 3);
    const soil = new THREE.Color(0.12, 0.085, 0.058), rock = new THREE.Color(0.19, 0.17, 0.15), grass = new THREE.Color(0.085, 0.125, 0.045);
    const c = new THREE.Color();
    for (let v = 0; v < nx * nz; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const steep = 1 - nrm.getY(v);
      const n = fbm(x * 0.3 + 4, z * 0.3 + 8);
      c.copy(soil).lerp(grass, sstep(0.35, 0.65, n) * (1 - sstep(0.15, 0.4, steep)) * (1 - sstep(10, 22, y)));
      c.lerp(rock, sstep(0.18, 0.5, steep + (n - 0.5) * 0.3));
      const band = 0.9 + 0.2 * Math.sin(y * 1.7 + n * 3);
      c.multiplyScalar(band);
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }

  dispose(group) {
    group.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
  }
}
