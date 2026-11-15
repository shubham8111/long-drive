import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp, smoothstep, damp } from './geo.js';

const D2R = Math.PI / 180;

export const WEATHER = {
  clear:    { label: 'Clear',         cover: 0.12, fog: 0.000032, sun: 1.0,  rain: 0, snow: 0, wet: 0, turb: 2.0, say: ['clear skies and a long view', 'not a cloud worth mentioning', 'clear and wide open'] },
  clouds:   { label: 'Drifting clouds', cover: 0.5,  fog: 0.000042, sun: 0.85, rain: 0, snow: 0, wet: 0, turb: 3.0, say: ['a few slow clouds drifting through', 'soft clouds and easy light'] },
  overcast: { label: 'Overcast',      cover: 0.95, fog: 0.00005,  sun: 0.22, rain: 0, snow: 0, wet: 0, turb: 6.0, say: ['a quiet grey blanket overhead', 'soft, even light under the clouds'] },
  mist:     { label: 'Morning mist',  cover: 0.75, fog: 0.0016,   sun: 0.45, rain: 0, snow: 0, wet: 0.25, turb: 8.0, say: ['mist hanging low over the road', 'a soft mist wrapping everything up'] },
  rain:     { label: 'Gentle rain',   cover: 1.0,  fog: 0.00028,  sun: 0.14, rain: 1, snow: 0, wet: 1, turb: 8.0, say: ['a gentle rain coming down', 'steady rain on the road, the good kind'] },
  snow:     { label: 'Snowfall',      cover: 1.0,  fog: 0.00045,  sun: 0.3,  rain: 0, snow: 1, wet: 0, turb: 6.0, say: ['snow falling slow and quiet', 'big soft snowflakes drifting down'] },
};


// ---- Sky grade keyframes (sun elevation in degrees) -------------------------------------------------------
// amt: how much of the physical sky is replaced by the art-directed gradient (0 = natural). zen/hor: zenith and
// horizon colours (sRGB hex). glow/ga: colour + strength of the glow around the sun's azimuth. belt/ba: the pink
// "Belt of Venus" band opposite the sun. st: stars + milky way visibility. gain: overall brightness.
// Tweak freely: values between keys are interpolated smoothly.
const GRADE_KEYS = [
  { e: -22, amt: 1,    gain: 1.0, zen: '#030818', hor: '#0c1a50', glow: '#1a2a6a', ga: 0.0,  belt: '#2a2a70', ba: 0.0,  st: 1 },
  { e: -16, amt: 1,    gain: 1.0, zen: '#050d2c', hor: '#112060', glow: '#2a3a8a', ga: 0.10, belt: '#3a3a90', ba: 0.05, st: 1 },
  { e: -10, amt: 1,    gain: 1.1, zen: '#0c1a48', hor: '#2e407c', glow: '#b06ea8', ga: 0.45, belt: '#6a48a8', ba: 0.25, st: 0.55 },
  { e: -5,  amt: 1,    gain: 1.2, zen: '#233570', hor: '#9a6c9c', glow: '#ff7f86', ga: 0.9,  belt: '#9a66b8', ba: 0.4,  st: 0.1 },
  { e: -1,  amt: 1,    gain: 1.3, zen: '#4a5c9a', hor: '#e8988a', glow: '#ff9250', ga: 1.3,  belt: '#b080c0', ba: 0.4,  st: 0 },
  { e: 3,   amt: 1,    gain: 1.3, zen: '#5a7cc4', hor: '#ffb888', glow: '#ffa84a', ga: 1.3,  belt: '#c0a0c8', ba: 0.25, st: 0 },
  { e: 8,   amt: 0.95, gain: 1.2, zen: '#6296d4', hor: '#ffd49c', glow: '#ffbe66', ga: 1.0,  belt: '#c8b8d0', ba: 0.1,  st: 0 },
  { e: 14,  amt: 0.55, gain: 1.1, zen: '#6aa0e0', hor: '#f0e2cc', glow: '#ffd696', ga: 0.55, belt: '#c8c8d8', ba: 0,    st: 0 },
  { e: 22,  amt: 0,    gain: 1.0, zen: '#6aa0e0', hor: '#e8ecf0', glow: '#ffe0b0', ga: 0.2,  belt: '#c8c8d8', ba: 0,    st: 0 },
].map((k) => ({ ...k, zen: new THREE.Color(k.zen), hor: new THREE.Color(k.hor), glow: new THREE.Color(k.glow), belt: new THREE.Color(k.belt) }));

const GRADE_GLSL = /* glsl */ `
uniform float uAmt, uGain, uGlowAmt, uBeltAmt, uStarVis;
uniform vec3 uZen, uHor, uGlow, uBelt;
vec3 skyGrade(vec3 texColor, vec3 sundisc, vec3 d, vec3 sdir) {
  float h = max(d.y, 0.0);
  vec3 grad = mix(uZen, uHor, pow(1.0 - min(h, 1.0), 2.6));
  float cs = dot(d, sdir);
  vec2 dh = normalize(d.xz + 1e-5), sh = normalize(sdir.xz + 1e-5);
  float az = clamp(dot(dh, sh) * 0.5 + 0.5, 0.0, 1.0);
  float low = exp(-h * 4.5);
  float glow = pow(az, 3.0) * low * 0.65 + pow(max(cs, 0.0), 7.0) * exp(-h * 1.2) * 1.3 + pow(max(cs, 0.0), 2.0) * 0.18 * low;
  float belt = pow(1.0 - az, 2.5) * smoothstep(0.0, 0.04, h) * exp(-h * 6.0);
  vec3 tgt = (grad + uGlow * uGlowAmt * glow + uBelt * uBeltAmt * belt * 0.6) * uGain;
  // faint milky way band
  vec3 mwn = normalize(vec3(0.35, 0.55, 0.45));
  float mb = dot(d, mwn);
  vec3 up = normalize(cross(mwn, vec3(0.0, 1.0, 0.0)));
  float ang = atan(dot(d, cross(mwn, up)), dot(d, up));
  float mod1 = 0.55 + 0.45 * sin(ang * 3.0 + 1.3) * sin(ang * 7.0 + 0.4 + sin(ang * 2.0) * 2.0);
  float band = exp(-mb * mb / 0.012) * mod1 + exp(-mb * mb / 0.08) * 0.25;
  tgt += vec3(0.020, 0.024, 0.044) * band * uStarVis * smoothstep(0.0, 0.15, d.y);
  vec3 base = texColor - sundisc;
  return mix(base, tgt, uAmt) + sundisc;
}`;

function patchSky(mat, U) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main()', GRADE_GLSL + '\nvoid main()')
      .replace('gl_FragColor = vec4( texColor, 1.0 );',
        `vec3 gc = skyGrade( texColor, sundiscColor, direction, normalize( vSunDirection ) );
         gc += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.0008;
         gl_FragColor = vec4( gc, 1.0 );`);
  };
  mat.customProgramCacheKey = () => 'skygrade1';
}

const STAR_VS = /* glsl */ `
attribute vec4 aStar; // size px, brightness, phase, temperature
uniform float uPR, uTime, uVis;
varying vec3 vCol;
varying float vA;
void main() {
  float b = aStar.y;
  float thr = (1.0 - b) * 0.75; // bright stars come out first
  float vis = smoothstep(thr, thr + 0.25, uVis);
  float tw = 1.0 + 0.14 * step(0.55, b) * sin(uTime * (0.9 + aStar.z) + aStar.z * 40.0);
  vA = vis * tw * (0.45 + 0.9 * b);
  vCol = mix(vec3(1.0, 0.82, 0.66), vec3(0.72, 0.84, 1.0), aStar.w);
  gl_PointSize = aStar.x * uPR * (0.6 + 0.4 * vis);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const STAR_FS = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float f = exp(-r * r * 3.2) * smoothstep(1.0, 0.7, r);
  gl_FragColor = vec4(vCol * f * vA * 2.3, 1.0);
  #include <colorspace_fragment>
}`;

const CLOUD_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const CLOUD_FS = /* glsl */ `
varying vec3 vDir;
uniform float uTime, uCover;
uniform vec3 uLit, uDark, uFog, uGlow, uSunDir;
uniform float uTw;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  if (d.y < -0.01) discard;
  vec2 uv = d.xz / (max(d.y, 0.0) + 0.07) * 0.5 + uTime * vec2(0.006, 0.0025);
  float n = fbm(uv);
  float th = 1.0 - uCover * 1.12;
  float dens = smoothstep(th, th + 0.32, n * 1.15);
  if (dens < 0.004) discard; // clear sky: skip the second noise stack
  float inner = smoothstep(0.25, 0.95, fbm(uv * 2.6 + 4.7) * (0.4 + dens));
  vec3 col = mix(uLit, uDark, inner * (0.55 + 0.45 * uCover));
  // twilight: undersides catch the sun's colour, brightest toward the sun, lavender shade on the far side
  float sd = max(dot(d, uSunDir), 0.0);
  float sunSide = pow(sd, 1.5) * 0.8 + 0.2 * pow(sd, 0.5);
  float under = (1.0 - inner * 0.65) * (0.35 + 0.65 * exp(-d.y * 3.0));
  col = mix(col, col * vec3(0.8, 0.74, 1.0), uTw * (1.0 - sunSide) * 0.6);
  col += uGlow * uTw * sunSide * under * 1.4;
  float hz = smoothstep(0.0, 0.2, d.y);
  col = mix(uFog, col, hz);
  float a = dens * mix(smoothstep(0.45, 0.95, uCover), 1.0, hz);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const PRECIP_VS = /* glsl */ `
attribute float aEnd;
uniform vec3 uCam, uStreak, uDrift;
uniform float uTime, uSize, uSway;
varying float vFade;
void main() {
  vec3 box = vec3(40.0, 26.0, 40.0);
  vec3 p = position * box + uDrift * uTime;
  p.x += sin(uTime * 0.9 + position.y * 40.0) * uSway;
  p.z += cos(uTime * 0.7 + position.x * 40.0) * uSway;
  p = mod(p - uCam, box) - box * 0.5;
  p += aEnd * uStreak;
  vec4 mv = viewMatrix * vec4(p + uCam, 1.0);
  vFade = smoothstep(20.0, 12.0, length(p)) * smoothstep(0.3, 1.5, -mv.z);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize / max(0.3, -mv.z), 1.0, 14.0);
}`;
const RAIN_FS = /* glsl */ `
uniform float uAlpha; uniform vec3 uColor; varying float vFade;
void main() { gl_FragColor = vec4(uColor, uAlpha * vFade); }`;
const SNOW_FS = /* glsl */ `
uniform float uAlpha; uniform vec3 uColor; varying float vFade;
void main() {
  float r = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(uColor, uAlpha * vFade * smoothstep(0.5, 0.15, r));
}`;

export class SkySystem {
  constructor(scene, renderer, lat) {
    this.scene = scene;
    this.renderer = renderer;
    this.lat = lat;
    this.shared = { uWet: { value: 0 }, uSnow: { value: 0 }, uTime: { value: 0 }, uLodDist: { value: 72 }, uGroundDist: { value: 85 }, uPaved: { value: 0 }, uNight: { value: 0 } };
    this.w = { ...WEATHER.clear };
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.night = 0;
    this.wxRate = 1;
    this.elevDeg = 45;
    this.t = 0;

    this.gradeU = {
      uAmt: { value: 0 }, uGain: { value: 1 }, uGlowAmt: { value: 0 }, uBeltAmt: { value: 0 }, uStarVis: { value: 0 },
      uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uBelt: { value: new THREE.Color() },
    };
    this.grade = { glow: this.gradeU.uGlow.value, ga: 0 };
    this.sky = new Sky();
    patchSky(this.sky.material, this.gradeU);
    this.sky.scale.setScalar(190000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = 50; // after the landscape, so hidden sky pixels are rejected by the depth test
    scene.add(this.sky);

    // tiny offscreen copy of the sky: used to match fog to the horizon and to light car paint
    this.probeScene = new THREE.Scene();
    this.probeSky = new Sky();
    patchSky(this.probeSky.material, this.gradeU);
    this.probeSky.scale.setScalar(1000);
    this.probeScene.add(this.probeSky);
    this.probeCam = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    this.probeRT = new THREE.WebGLRenderTarget(16, 4, { type: THREE.FloatType });
    this.probeBuf = new Float32Array(16 * 4 * 4);
    this.horizonTarget = new THREE.Color();
    this.horizonSet = false;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTexture = null;
    this.skyHorizon = new THREE.Color(0.6, 0.7, 0.85);
    this.lastProbe = -1e9;
    this.probeKey = '';

    this.fog = new THREE.FogExp2(0xaabbcc, 0.00001);
    scene.fog = this.fog;

    this.sun = new THREE.DirectionalLight(0xffffff, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 220;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x8a6a50, 2);
    scene.add(this.hemi);

    // stars: custom soft points, ~6000, with a denser milky-way band
    const NS = 6000, sp = new Float32Array(NS * 3), sa = new Float32Array(NS * 4);
    const mwn = new THREE.Vector3(0.35, 0.55, 0.45).normalize();
    const mwu = new THREE.Vector3().crossVectors(mwn, new THREE.Vector3(0, 1, 0)).normalize(), mwv = new THREE.Vector3().crossVectors(mwn, mwu);
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    const dir = new THREE.Vector3();
    for (let i = 0; i < NS; i++) {
      const inBand = i < 1800;
      for (;;) {
        if (inBand) {
          const a = Math.random() * Math.PI * 2, off = gauss() * 0.16;
          dir.copy(mwu).multiplyScalar(Math.cos(a)).addScaledVector(mwv, Math.sin(a)).multiplyScalar(Math.sqrt(1 - off * off)).addScaledVector(mwn, off);
        } else {
          const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
          dir.set(r * Math.cos(a), u, r * Math.sin(a));
        }
        if (dir.y > -0.05) break;
      }
      sp.set([dir.x * 150000, Math.max(dir.y, 0.002) * 150000, dir.z * 150000], i * 3);
      const m = Math.pow(Math.random(), 2.2); // magnitude: most are faint
      let size, br;
      if (i % 15 === 0) { size = 3 + Math.random() * 2; br = 0.85 + Math.random() * 0.15; } // a few hundred bright ones
      else { size = 1.5 + m * 1.0 + Math.random() * 0.2; br = 0.15 + m * 0.65; }
      sa.set([size, br, Math.random(), Math.random()], i * 4);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aStar', new THREE.BufferAttribute(sa, 4));
    this.starU = { uPR: { value: Math.min(window.devicePixelRatio || 1, 2) }, uTime: { value: 0 }, uVis: { value: 0 } };
    this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({
      vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: this.starU,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.stars.material.opacity = 0; // kept for callers that read it; visibility is driven through uVis
    this.stars.frustumCulled = false;

    // the moon: a soft-lit disc with a halo, low enough to be in view while driving; it is also the
    // direction night-time light comes from
    this.moonDir = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
    {
      const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d');
      const halo = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
      halo.addColorStop(0, 'rgba(190,205,255,0.55)'); halo.addColorStop(0.35, 'rgba(150,170,235,0.14)'); halo.addColorStop(1, 'rgba(120,140,220,0)');
      g.fillStyle = halo; g.fillRect(0, 0, S, S);
      g.save(); g.beginPath(); g.arc(S / 2, S / 2, S * 0.16, 0, Math.PI * 2); g.clip();
      const disc = g.createRadialGradient(S * 0.46, S * 0.45, 2, S / 2, S / 2, S * 0.17);
      disc.addColorStop(0, '#fffdf2'); disc.addColorStop(1, '#d9dcea');
      g.fillStyle = disc; g.fillRect(0, 0, S, S);
      let sd = 5; const rn = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 14; i++) { // maria: soft grey patches
        const a = rn() * 6.28, r = rn() * S * 0.12, rad = S * (0.015 + rn() * 0.04);
        const m = g.createRadialGradient(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 0, S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, rad);
        m.addColorStop(0, 'rgba(120,128,150,0.42)'); m.addColorStop(1, 'rgba(120,128,150,0)');
        g.fillStyle = m; g.fillRect(0, 0, S, S);
      }
      g.restore();
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false, opacity: 0 }));
      this.moon.scale.setScalar(26000);
      this.moon.renderOrder = -9;
      this.moon.frustumCulled = false;
      scene.add(this.moon);
    }
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    // cloud layer
    this.cloudU = {
      uTime: { value: 0 }, uCover: { value: 0.1 },
      uLit: { value: new THREE.Color(1, 1, 1) }, uDark: { value: new THREE.Color(0.5, 0.5, 0.55) }, uFog: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uTw: { value: 0 },
    };
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(170000, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.52),
      new THREE.ShaderMaterial({ vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, uniforms: this.cloudU, side: THREE.BackSide, transparent: true, depthWrite: false })
    );
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -8;
    scene.add(this.clouds);

    // rain + snow
    const mk = (count, lines) => {
      const per = lines ? 2 : 1;
      const pos = new Float32Array(count * per * 3), end = new Float32Array(count * per);
      for (let i = 0; i < count; i++) {
        const x = Math.random(), y = Math.random(), z = Math.random();
        for (let k = 0; k < per; k++) { pos.set([x, y, z], (i * per + k) * 3); end[i * per + k] = k; }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
      return g;
    };
    const pu = () => ({
      uCam: { value: new THREE.Vector3() }, uStreak: { value: new THREE.Vector3() }, uDrift: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uSize: { value: 0 }, uSway: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(0.8, 0.85, 0.9) },
    });
    this.rainU = pu();
    this.rain = new THREE.LineSegments(mk(7000, true), new THREE.ShaderMaterial({ vertexShader: PRECIP_VS, fragmentShader: RAIN_FS, uniforms: this.rainU, transparent: true, depthWrite: false }));
    this.snowU = pu();
    this.snow = new THREE.Points(mk(9000, false), new THREE.ShaderMaterial({ vertexShader: PRECIP_VS, fragmentShader: SNOW_FS, uniforms: this.snowU, transparent: true, depthWrite: false }));
    for (const o of [this.rain, this.snow]) { o.frustumCulled = false; o.renderOrder = 20; o.visible = false; scene.add(o); }
  }

  computeSun(hours) {
    const phi = this.lat * D2R, dec = 16 * D2R, H = (hours - 12) * 15 * D2R;
    const sinE = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
    const e = Math.asin(sinE);
    let A = Math.acos(clamp((Math.sin(dec) - sinE * Math.sin(phi)) / (Math.cos(e) * Math.cos(phi)), -1, 1));
    if (H > 0) A = Math.PI * 2 - A;
    this.elevDeg = e / D2R;
    this.sunDir.set(Math.sin(A) * Math.cos(e), Math.sin(e), -Math.cos(A) * Math.cos(e));
  }

  // interpolate GRADE_KEYS at sun elevation e into the shader uniforms
  updateGrade(e, cover) {
    const K = GRADE_KEYS, U = this.gradeU;
    let i = 0;
    while (i < K.length - 2 && e > K[i + 1].e) i++;
    const a = K[i], b = K[i + 1];
    let t = clamp((e - a.e) / (b.e - a.e), 0, 1); t = t * t * (3 - 2 * t);
    U.uAmt.value = lerp(a.amt, b.amt, t);
    U.uGain.value = lerp(a.gain, b.gain, t);
    U.uGlowAmt.value = lerp(a.ga, b.ga, t);
    U.uBeltAmt.value = lerp(a.ba, b.ba, t);
    U.uStarVis.value = lerp(a.st, b.st, t);
    U.uZen.value.copy(a.zen).lerp(b.zen, t);
    U.uHor.value.copy(a.hor).lerp(b.hor, t);
    U.uGlow.value.copy(a.glow).lerp(b.glow, t);
    U.uBelt.value.copy(a.belt).lerp(b.belt, t);
  }

  // Re-samples the sky for fog colour and reflections. The pixel read-back is asynchronous so it never
  // stalls a frame waiting on the GPU.
  probe() {
    const r = this.renderer;
    const u = this.probeSky.material.uniforms, s = this.sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) u[k].value = s[k].value;
    u.sunPosition.value.copy(s.sunPosition.value);
    const prev = r.getRenderTarget();
    const first = !this.envRT;
    try {
      // four views around the horizon, side by side in one 16x4 target -> one read-back
      r.setRenderTarget(this.probeRT);
      r.setScissorTest(true);
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + 0.6;
        this.probeCam.lookAt(Math.cos(a), 0.07, Math.sin(a));
        this.probeRT.viewport.set(k * 4, 0, 4, 4);
        this.probeRT.scissor.set(k * 4, 0, 4, 4);
        r.setRenderTarget(this.probeRT);
        r.render(this.probeScene, this.probeCam);
      }
      r.setScissorTest(false);
      const apply = (b) => {
        let R = 0, G = 0, B = 0, n = 0;
        for (let i = 0; i < 64; i++) {
          if (!isFinite(b[i * 4])) continue;
          R += Math.min(b[i * 4], 4); G += Math.min(b[i * 4 + 1], 4); B += Math.min(b[i * 4 + 2], 4); n++;
        }
        if (n) { this.horizonTarget.setRGB(R / n, G / n, B / n); if (!this.horizonSet) { this.horizonSet = true; this.skyHorizon.copy(this.horizonTarget); } }
      };
      if (first) { r.readRenderTargetPixels(this.probeRT, 0, 0, 16, 4, this.probeBuf); apply(this.probeBuf); }
      else r.readRenderTargetPixelsAsync(this.probeRT, 0, 0, 16, 4, this.probeBuf).then(apply).catch(() => {});
    } catch (e) { /* keep previous */ }
    r.setScissorTest(false);
    r.setRenderTarget(prev);
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.probeScene, 0, 1, 5000);
    this.envTexture = this.envRT.texture;
    if (old) old.dispose();
  }

  update(dt, camera, hours, weatherId, camVel) {
    this.t += dt;
    this.shared.uTime.value = this.t;
    const target = WEATHER[weatherId] || WEATHER.clear, w = this.w;
    const wr = this.wxRate; // 1 = quick change when picked by hand; small = weather that rolls in slowly
    for (const k of ['cover', 'sun', 'rain', 'snow', 'turb']) w[k] = damp(w[k], target[k], 0.5 * wr, dt);
    w.fog = damp(w.fog, target.fog, 0.6 * wr, dt);
    w.wet = damp(w.wet, target.wet, target.wet > w.wet ? 0.25 : 0.05, dt);
    this.shared.uWet.value = w.wet;
    this.shared.uSnow.value = damp(this.shared.uSnow.value, target.snow, target.snow ? 0.035 : 0.05, dt);

    this.computeSun(hours);
    const e = this.elevDeg;
    const day = smoothstep(-6, 6, e);
    this.night = 1 - day;
    this.shared.uNight.value = this.night;

    this.updateGrade(e, w.cover);
    const su = this.sky.material.uniforms;
    su.sunPosition.value.copy(this.sunDir);
    su.turbidity.value = w.turb;
    su.rayleigh.value = lerp(lerp(3.2, 1.3, smoothstep(0, 25, e)), 0.6, w.cover * 0.6);
    su.mieCoefficient.value = 0.004 + w.cover * 0.004;
    su.mieDirectionalG.value = 0.8;

    // near the horizon the sky changes fast, so sample more finely there; never more than every few seconds
    const stepDeg = Math.abs(e) < 12 ? 0.5 : 2;
    const key = `${Math.round(e / stepDeg) * stepDeg}|${w.turb.toFixed(0)}|${(Math.round(w.cover * 10) / 10).toFixed(1)}`;
    this.skyHorizon.lerp(this.horizonTarget, 1 - Math.exp(-dt * 0.8));
    if (key !== this.probeKey && (!this.envRT || this.t - this.lastProbe > 4)) {
      this.probeKey = key;
      this.lastProbe = this.t;
      this.probe();
    }

    // sun & ambient
    const warm = smoothstep(1, 30, e);
    const sunCol = new THREE.Color().setRGB(1, lerp(0.5, 0.96, warm), lerp(0.24, 0.9, warm));
    // full strength from 4 degrees up, so golden hour actually lights the land in gold
    const sunI = smoothstep(-1, 4, e) * 4.5 * w.sun; // a softer key light: less harsh shading
    const moon = this.night * 1.9 * (1 - w.cover * 0.6);
    if (sunI > moon) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = sunI;
      this.lightDir = this.sunDir;
    } else {
      this.sun.color.setRGB(0.55, 0.68, 1);
      this.sun.intensity = moon;
      this.lightDir = this.moonDir;
    }
    const ambDay = lerp(2.75, 3.1, w.cover);
    this.hemi.intensity = lerp(0.55, ambDay, day) * lerp(1, 0.75, w.rain);
    this.hemi.color.setRGB(lerp(0.3, lerp(0.74, 0.86, w.cover), day), lerp(0.4, lerp(0.83, 0.88, w.cover), day), lerp(0.75, lerp(1, 0.92, w.cover), day));
    // golden hour: the sky light itself turns warm and rosy
    const golden = smoothstep(-4, 2, e) * smoothstep(20, 6, e) * (1 - w.cover * 0.5);
    this.hemi.color.lerp(new THREE.Color(1, 0.72, 0.62), golden * 0.45);
    this.hemi.groundColor.setRGB(lerp(0.1, 0.55, day), lerp(0.12, 0.42, day), lerp(0.2, 0.33, day));

    // fog follows the real horizon colour, greyed by cloud cover
    const lum = this.skyHorizon.r * 0.3 + this.skyHorizon.g * 0.55 + this.skyHorizon.b * 0.15;
    const grey = new THREE.Color().setRGB(lum * 0.8 + 0.008, lum * 0.83 + 0.011, lum * 0.88 + 0.02);
    const fogCol = this.skyHorizon.clone().lerp(grey, clamp(w.cover * 1.1 - 0.1, 0, 1));
    { const k = this.gradeU.uGlowAmt.value * 0.05 * (1 - clamp(w.cover, 0, 1) * 0.6), g = this.gradeU.uGlow.value; fogCol.r += g.r * k; fogCol.g += g.g * k; fogCol.b += g.b * k; }
    fogCol.r += 0.004; fogCol.g += 0.006; fogCol.b += 0.014;
    this.fog.color.copy(fogCol);
    this.fog.density = w.fog;

    // clouds
    const cu = this.cloudU;
    cu.uTime.value = this.t;
    cu.uCover.value = w.cover;
    cu.uFog.value.copy(fogCol);
    const litBase = lum * lerp(1.5, 1.05, w.cover) + 0.01;
    cu.uLit.value.setRGB(litBase * lerp(1.25, 1, warm), litBase * lerp(0.9, 1, warm), litBase * lerp(0.75, 1.02, warm));
    cu.uDark.value.setRGB(lum * 0.42 + 0.006, lum * 0.45 + 0.008, lum * 0.52 + 0.014);
    cu.uSunDir.value.copy(this.sunDir);
    cu.uGlow.value.copy(this.gradeU.uGlow.value);
    cu.uTw.value = clamp(this.gradeU.uGlowAmt.value * 0.75, 0, 1.1) * smoothstep(-14, -6, e);
    if (this.night > 0.5) { // moonlit blue-grey
      const nb = (this.night - 0.5) * 2;
      cu.uLit.value.lerp(new THREE.Color(0.035, 0.045, 0.085), nb);
      cu.uDark.value.lerp(new THREE.Color(0.01, 0.014, 0.03), nb);
    }

    const starVis = smoothstep(-5, -16, e) * (1 - clamp(w.cover * 1.3, 0, 1));
    this.starU.uVis.value = starVis;
    this.starU.uTime.value = this.t;
    this.stars.material.opacity = starVis;
    this.stars.visible = starVis > 0.01;
    this.moon.material.opacity = smoothstep(-1, -8, e) * (1 - clamp(w.cover * 1.15, 0, 1));
    this.moon.visible = this.moon.material.opacity > 0.01;
    this.moon.position.copy(camera.position).addScaledVector(this.moonDir, 82000);

    for (const o of [this.sky, this.stars, this.clouds]) o.position.copy(camera.position);
    this.sun.target.position.copy(camera.position);
    this.sun.position.copy(camera.position).addScaledVector(this.lightDir, 120);

    // precipitation
    const bright = lerp(0.12, 1, day);
    this.rain.visible = w.rain > 0.02;
    if (this.rain.visible) {
      const u = this.rainU;
      u.uCam.value.copy(camera.position); u.uTime.value = this.t;
      u.uDrift.value.set(1.5, -11, 0.6);
      u.uStreak.value.set(1.5 - camVel.x, -11, 0.6 - camVel.z).multiplyScalar(0.03);
      u.uAlpha.value = 0.3 * w.rain * bright;
    }
    this.snow.visible = w.snow > 0.02;
    if (this.snow.visible) {
      const u = this.snowU;
      u.uCam.value.copy(camera.position); u.uTime.value = this.t;
      u.uDrift.value.set(0.5, -1.3, 0.25); u.uSway.value = 0.35; u.uSize.value = 46;
      u.uAlpha.value = 0.85 * w.snow * lerp(0.35, 1, day);
      u.uColor.value.setRGB(1, 1, 1);
    }
  }
}
