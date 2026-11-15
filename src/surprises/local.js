// Local (place-specific) surprises: bells on the hour, Manhattan steam, the Eiffel Tower, a street musician.
// Interface: see src/surprises.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sm = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const audioOK = (ctx) => !!(ctx.audio && ctx.audio.ctx && ctx.audio.out);
const noWx = (ctx) => (ctx.w?.rain ?? 0) < 0.1 && (ctx.w?.snow ?? 0) < 0.1;

// ---------------------------------------------------------------- audio helpers
function makeIR(ac, secs, power) {
  const n = Math.floor(ac.sampleRate * secs), buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, power);
  }
  return buf;
}

// input -> lowpass -> (dry + reverb) -> pan -> duck gain -> ambience master
function makeBus(ac, out, { lp = 3000, wet = 0.35, pan = 0, gain = 1, ir = 2.6 } = {}) {
  const input = ac.createGain();
  const lpf = ac.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = lp; lpf.Q.value = 0.3;
  const dry = ac.createGain();
  const conv = ac.createConvolver(); conv.buffer = makeIR(ac, ir, 2.4);
  const wetG = ac.createGain(); wetG.gain.value = wet;
  const panner = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
  if (panner.pan) panner.pan.value = pan;
  const duck = ac.createGain(); duck.gain.value = gain;
  input.connect(lpf); lpf.connect(dry); lpf.connect(conv); conv.connect(wetG);
  dry.connect(panner); wetG.connect(panner); panner.connect(duck); duck.connect(out);
  const nodes = [input, lpf, dry, conv, wetG, panner, duck];
  return {
    input, lpf, panner, duck,
    dispose() { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } } },
  };
}

// a bell: inharmonic partials, each with its own exponential decay
const PARTIALS = [[0.5, 0.55, 1.0], [1, 1, 0.9], [1.19, 0.5, 0.7], [1.5, 0.32, 0.6], [2, 0.5, 0.5], [2.5, 0.18, 0.35], [3, 0.12, 0.28], [4.1, 0.06, 0.18]];
function bell(ac, dest, t, f, vol, dur = 4, pan = 0) {
  const out = ac.createGain(); out.gain.value = 1;
  let tail = dest;
  if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; p.connect(dest); tail = p; }
  out.connect(tail);
  for (const [r, a, dm] of PARTIALS) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = f * r * (1 + rand(-0.0015, 0.0015));
    const d = dur * dm * (f < 200 ? 1.5 : 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol * a / 3.3, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + d + 0.1);
  }
}

// something that plays a scheduled audio piece through a bus, ducks in tunnels, and ends
function audioInstance(ctx, bus, length, hooks = {}) {
  let t = 0;
  return {
    update(dt, c) {
      t += dt;
      if (hooks.update) hooks.update(dt, c, t);
      else bus.duck.gain.setTargetAtTime(c.inTunnel ? 0 : hooks.gain ?? 1, c.audio.ctx.currentTime, 0.4);
      return t < length;
    },
    dispose() { bus.dispose(); hooks.dispose?.(); },
  };
}

// ---------------------------------------------------------------- 1. bells
const WESTMINSTER = { lat: 51.5007, lon: -0.1246 };
const placeCache = { id: null, near: false };
function nearWestminster(ctx) {
  if (placeCache.id !== ctx.place.id) {
    placeCache.id = ctx.place.id;
    const d = ctx.route.nearestWide ? ctx.route.nearestWide(ctx.geo.x(WESTMINSTER.lon), ctx.geo.z(WESTMINSTER.lat), 3000) : -1;
    placeCache.near = d >= 0;
  }
  return placeCache.near;
}
// the hour that was just crossed (0..23), or -1
function crossedHour(ctx) {
  let d = ctx.hours - ctx.prevHours;
  if (d < -12) d += 24;
  if (!(d > 0 && d < 0.6)) return -1;
  const h = Math.floor(ctx.hours) % 24;
  return h === Math.floor(ctx.prevHours) % 24 ? -1 : h;
}
const quietHour = (h) => h >= 23 || h < 6;
let bellHour = 12;

// Westminster quarters, the four phrases (E major): G# F# E B / E G# F# B / E F# G# E / G# E F# B
const WQ = [[415.3, 370, 329.6, 246.9], [329.6, 415.3, 370, 246.9], [329.6, 370, 415.3, 329.6], [415.3, 329.6, 370, 246.9]];

function bellsInstance(ctx) {
  const ac = ctx.audio.ctx, id = ctx.place.id;
  const h = bellHour, h12 = h % 12 === 0 ? 12 : h % 12;
  const bus = makeBus(ac, ctx.audio.out, { lp: 2400, wet: 0.45, pan: rand(-0.4, 0.4), gain: 0 });
  const t0 = ac.currentTime + 0.4;
  let len = 20;
  if (id === 'london') {
    let t = t0;
    for (const ph of WQ) { for (const f of ph) { bell(ac, bus.input, t, f, 0.2, 3.2); t += 0.85; } t += 0.85; }
    t += 1.4;
    const gap = h12 > 6 ? 2.0 : 2.5;
    for (let i = 0; i < h12; i++) { bell(ac, bus.input, t + i * gap, 164.8, 0.34, 6.5); }
    len = t + h12 * gap + 5 - t0;
  } else if (id === 'paris' && (h === 12 || h === 18)) {
    const pr = [196, 261.6, 293.7, 392], per = [2.9, 2.2, 1.75, 1.4], pans = [-0.5, 0.3, -0.2, 0.5], dur = 22;
    for (let b = 0; b < 4; b++) {
      for (let t = rand(0, per[b]); t < dur; t += per[b] + rand(-0.09, 0.09)) {
        const env = sm(0, 5, t) * (1 - sm(dur - 6, dur, t));
        if (env > 0.02) bell(ac, bus.input, t0 + t, pr[b], 0.2 * env, 3.4, pans[b]);
      }
    }
    len = dur + 5;
  } else if (id === 'paris') {
    bell(ac, bus.input, t0, 392, 0.2, 3, -0.3); bell(ac, bus.input, t0 + 0.9, 293.7, 0.22, 3.4, 0.2);
    const n = Math.min(h12, 6);
    for (let i = 0; i < n; i++) bell(ac, bus.input, t0 + 3.8 + i * 2.6, 261.6, 0.26, 5, 0.1);
    len = 3.8 + n * 2.6 + 5;
  } else {
    const n = h12;
    for (let i = 0; i < n; i++) bell(ac, bus.input, t0 + i * 2.2, 220, 0.22, 5, 0.2);
    len = n * 2.2 + 5;
  }
  return audioInstance(ctx, bus, len, { gain: id === 'london' ? 0.8 : 0.9 });
}

const BELLS = {
  id: 'bells', kind: 'clock', local: true, cooldown: 150,
  label: (ctx) => (ctx.place.id === 'london' ? 'Big Ben striking the hour' : ctx.place.id === 'paris' ? 'church bells across Paris' : 'the bells striking the hour'),
  possible(ctx) {
    if (!audioOK(ctx) || !ctx.route) return false;
    const id = ctx.place?.id;
    if (id === 'london') return nearWestminster(ctx);
    return id === 'paris' || id === 'monaco' || id === 'manhattan';
  },
  chance() { return 0; },
  due(ctx) {
    const h = crossedHour(ctx);
    if (h < 0 || quietHour(h)) return false;
    const id = ctx.place.id;
    if ((id === 'monaco' || id === 'manhattan') && h !== 12) return false;
    bellHour = h;
    return true;
  },
  create(ctx) {
    if (!audioOK(ctx)) return null;
    if (ctx.hours != null) { const h = Math.round(ctx.hours) % 24; if (!(crossedHour(ctx) >= 0)) bellHour = quietHour(h) ? 12 : h; }
    return bellsInstance(ctx);
  },
};

// ---------------------------------------------------------------- 2. manhattan steam
const FOG_GLSL_V = 'varying float vFog; uniform float uFogDen;';
const STEAM_VS = `
attribute float aAge; attribute float aSize;
uniform float uScale; uniform float uFogDen;
varying float vAge; varying float vFog;
void main(){
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  float d = max(-mv.z, 0.1);
  vAge = aAge;
  vFog = 1.0 - exp(-uFogDen*uFogDen*d*d);
  float near = smoothstep(1.5, 6.0, d);
  gl_PointSize = min(aSize * uScale / d, 400.0) * step(0.0, aSize);
  vAge = aAge + (1.0 - near) * 5.0;  // fades out when too close to the camera
  gl_Position = projectionMatrix * mv;
}`;
const STEAM_FS = `
uniform vec3 uColor; uniform vec3 uFogColor; uniform float uAlpha;
varying float vAge; varying float vFog;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;
  if (d > 1.0 || vAge > 1.0) discard;
  float a = exp(-d*d*3.2) * (1.0 - smoothstep(0.7, 1.0, d));
  a *= smoothstep(0.0, 0.12, vAge) * (1.0 - smoothstep(0.35, 1.0, vAge)) * uAlpha;
  a *= 1.0 - 0.6 * vFog;
  vec3 col = mix(uColor, uFogColor, vFog * 0.7);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Steam from manholes in the street, the way it really drifts up in Manhattan: now and then, not on
// every block (a vent every ~300-800 m, at most two in view), and a soft low wisp rather than a cloud.
// Stronger on cold, wet or foggy nights, when real steam shows most.
const STEAM = {
  id: 'steam', kind: 'ambient', local: true, cooldown: 1,
  possible: (ctx) => ctx.place?.id === 'manhattan' && !!ctx.route && !!ctx.world,
  chance: () => 1,
  create(ctx) {
    const NV = 2, P = 22, N = NV * P;
    const route = ctx.route, tmp = { x: 0, y: 0, z: 0, tx: 0, tz: 1 };
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3), age = new Float32Array(N), size = new Float32Array(N).fill(-1);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAge', new THREE.BufferAttribute(age, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 }, uFogDen: { value: 0.0004 }, uColor: { value: new THREE.Color() }, uFogColor: { value: new THREE.Color() }, uAlpha: { value: 0.15 } },
      vertexShader: STEAM_VS, fragmentShader: STEAM_FS, transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5;
    ctx.world.add(pts);

    const vs = new Float32Array(NV), vx = new Float32Array(NV), vy = new Float32Array(NV), vz = new Float32Array(NV), str = new Float32Array(NV);
    const t = new Float32Array(N), life = new Float32Array(N), rx = new Float32Array(N), rz = new Float32Array(N), sd = new Float32Array(N);
    let ahead = 0; // distance along the route of the furthest vent placed so far
    const place = (v, first) => {
      const dirn = ctx.dir || 1;
      const from = first ? ctx.s + dirn * rand(60, 250) : ahead;
      vs[v] = clamp(from + dirn * (first && v === 0 ? 0 : rand(300, 800)), 0, route.loop ? 1e9 : route.length - 5);
      ahead = vs[v];
      route.sample(vs[v], tmp);
      // a manhole in the roadway: in a lane, never on the pavement
      const half = route.road?.half ?? 11, lat = (Math.random() < 0.5 ? -1 : 1) * rand(1.5, Math.max(2, half - 3.5));
      vx[v] = tmp.x - tmp.tz * lat; vz[v] = tmp.z + tmp.tx * lat; vy[v] = tmp.y + 0.05;
      str[v] = rand(0.6, 1.0); // some vents barely breathe
      for (let j = 0; j < P; j++) { const i = v * P + j; life[i] = rand(4, 6.5); t[i] = rand(0, life[i]); rx[i] = rand(-0.2, 0.2); rz[i] = rand(-0.2, 0.2); sd[i] = Math.random() * 6.28; }
    };
    for (let v = 0; v < NV; v++) place(v, true);

    return {
      update(dt, c) {
        pts.visible = !c.inTunnel;
        const night = c.night, wet = Math.max(c.w?.wet ?? 0, c.w?.rain ?? 0, (c.w?.fog ?? 0) * 0.7, c.w?.snow ?? 0);
        const k = clamp(Math.max(night * 0.8, wet), 0, 1);
        const dirn = c.dir || 1;
        if (Math.abs(ahead - c.s) > 1500) { ahead = c.s; for (let v = 0; v < NV; v++) place(v, true); } // a jump or a turn-around
        for (let v = 0; v < NV; v++) if ((vs[v] - c.s) * dirn < -20) place(v, false);
        const frac = 0.55 + 0.45 * k; // how many of the puffs are out
        for (let v = 0; v < NV; v++) {
          const H = 4.5 * str[v], tau = 2.2, s0 = 0.6, s1 = 2.6 + 0.8 * str[v];
          for (let j = 0; j < P; j++) {
            const i = v * P + j;
            t[i] += dt;
            if (t[i] > life[i]) { t[i] = 0; life[i] = rand(4, 6.5); rx[i] = rand(-0.2, 0.2); rz[i] = rand(-0.2, 0.2); sd[i] = Math.random() * 6.28; }
            const u = t[i] / life[i];
            const i3 = i * 3;
            const sw = Math.sin(t[i] * 0.8 + sd[i]) * 0.8 * u, sw2 = Math.cos(t[i] * 0.65 + sd[i] * 1.7) * 0.8 * u;
            pos[i3] = vx[v] + rx[i] + sw + 0.5 * t[i] * u;
            pos[i3 + 1] = vy[v] + 0.1 + H * (1 - Math.exp(-t[i] / tau));
            pos[i3 + 2] = vz[v] + rz[i] + sw2 + 0.2 * t[i] * u;
            age[i] = u;
            size[i] = j < P * frac * str[v] ? s0 + (s1 - s0) * Math.sqrt(u) : -1;
          }
        }
        geo.attributes.position.needsUpdate = geo.attributes.aAge.needsUpdate = geo.attributes.aSize.needsUpdate = true;
        // light: cool grey by day, warm street-light at night (kept near white: steam, not glow)
        const col = mat.uniforms.uColor.value;
        const n = sm(0.15, 0.7, night);
        col.setRGB(1.0 + 0.1 * n, 1.05 - 0.2 * n, 1.12 - 0.45 * n).multiplyScalar(0.75 + 0.25 * n);
        mat.uniforms.uAlpha.value = 0.12 + 0.1 * k;
        mat.uniforms.uFogColor.value.copy(c.fog.color);
        mat.uniforms.uFogDen.value = c.fog.density;
        const cam = c.camera;
        mat.uniforms.uScale.value = c.renderer.domElement.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
        return true;
      },
      dispose() {
        ctx.world.remove(pts);
        geo.dispose(); mat.dispose();
      },
    };
  },
};

// ---------------------------------------------------------------- 3. the Eiffel Tower
const EIFFEL = { lat: 48.85837, lon: 2.294481 };
const ROT = 0.52; // faces turned off north-south, like the Champ de Mars
const H = 330;
const PROFILE = [[0, 62], [57, 36], [115, 19], [190, 9.5], [276, 4.6], [300, 2.6], [330, 0.7]];
function halfW(y) {
  for (let i = 1; i < PROFILE.length; i++) {
    if (y <= PROFILE[i][0]) {
      const [y0, w0] = PROFILE[i - 1], [y1, w1] = PROFILE[i];
      const t = (y - y0) / (y1 - y0), s = t * t * (3 - 2 * t);
      return w0 + (w1 - w0) * (0.5 * t + 0.5 * s);
    }
  }
  return PROFILE[PROFILE.length - 1][1];
}
const faceN = (f) => [Math.cos(ROT + (f * Math.PI) / 2), Math.sin(ROT + (f * Math.PI) / 2)];
const eiffelState = { spark: 0 };

const TOWER_VS = `
attribute vec2 aUV; attribute float aH;
varying vec2 vUV; varying float vH; varying float vFog;
uniform float uFogDen;
void main(){
  vUV = aUV; vH = aH;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  float d = -mv.z;
  vFog = 1.0 - exp(-uFogDen*uFogDen*d*d);
  gl_Position = projectionMatrix * mv;
}`;
const TOWER_FS = `
varying vec2 vUV; varying float vH; varying float vFog;
uniform vec3 uFogColor; uniform float uGlow; uniform float uDay;
float seg(float v, float a, float b){ return step(a, v) * step(v, b); }
void main(){
  float u = vUV.x, y = vUV.y, h = vH;
  float au = abs(u);
  // the arch between the legs
  float archW = 0.56;
  if (y < 44.0 && au < archW && y < 44.0 * sqrt(max(0.0, 1.0 - (au/archW)*(au/archW)))) discard;
  float bay = y < 57.0 ? 9.0 : (y < 115.0 ? 8.0 : (y < 276.0 ? 12.0 : 5.0));
  float lw = y < 115.0 ? 0.9 : (y < 276.0 ? 0.6 : 0.4);
  float ly = fract(y / bay), lx = u * 0.5 + 0.5;
  float d1 = abs(ly - lx) * bay, d2 = abs(ly - (1.0 - lx)) * bay;
  d1 = min(d1, min(abs(ly - lx - 1.0), abs(ly - lx + 1.0)) * bay);
  float dist = min(d1, d2) * 0.6;
  float edge = (1.0 - au) * h;
  dist = min(dist, edge * 0.8);
  float hb = min(ly, 1.0 - ly) * bay;
  dist = min(dist, hb * 1.0);
  float plat = seg(y, 53.0, 58.5) + seg(y, 111.5, 117.0) + seg(y, 272.0, 278.0);
  if (plat > 0.5 && au < 0.98) dist = -1.0;
  if (h < 2.2) dist = min(dist, edge); // the spire stays slim but solid
  float fw = max(fwidth(dist), 0.0001);
  float a = 1.0 - smoothstep(lw * 0.5 - fw, lw * 0.5 + fw, dist);
  a = mix(a, 0.5, smoothstep(0.4, 1.4, fw / lw));
  if (a < 0.02) discard;
  vec3 bronze = vec3(0.2, 0.14, 0.1) * uDay;
  vec3 gold = vec3(1.0, 0.58, 0.2) * (2.2 + 1.6 * plat + 0.8 * (1.0 - y / 330.0));
  vec3 col = mix(bronze, gold, uGlow);
  col = mix(col, uFogColor, vFog * mix(0.5, 0.3, uGlow));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const SPARK_VS = `
attribute float aPhase; attribute float aRate; attribute float aSz;
uniform float uTime; uniform float uScale; uniform float uSpark;
varying float vF;
void main(){
  float f = fract(uTime * aRate + aPhase);
  vF = smoothstep(0.0, 0.025, f) * (1.0 - smoothstep(0.025, 0.14, f)) * uSpark;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mv.z, 1.0);
  gl_PointSize = clamp(aSz * uScale / d, 1.6, 10.0) * (0.5 + vF);
  gl_Position = projectionMatrix * mv;
}`;
const SPARK_FS = `
varying float vF;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0 || vF < 0.01) discard;
  float a = exp(-d*d*3.0) * vF;
  gl_FragColor = vec4(vec3(1.0, 0.92, 0.75) * 4.0, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const BEAM_VS = `
varying float vL; varying vec3 vN; varying vec3 vV;
void main(){
  vL = position.x / 1800.0;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FS = `
uniform float uOp;
varying float vL; varying vec3 vN; varying vec3 vV;
void main(){
  float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
  float a = f * pow(clamp(1.0 - vL, 0.0, 1.0), 1.5) * smoothstep(0.0, 0.03, vL) * uOp;
  gl_FragColor = vec4(vec3(1.0, 0.85, 0.55) * 3.0, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function buildTowerGeometry() {
  const steps = 56, pos = [], uv = [], hh = [], idx = [];
  for (let f = 0; f < 4; f++) {
    const [nx, nz] = faceN(f), tx = -nz, tz = nx, base = pos.length / 3;
    for (let i = 0; i <= steps; i++) {
      const y = (i / steps) * H, h = halfW(y);
      for (const u of [-1, 1]) {
        pos.push(nx * h + tx * h * u, y, nz * h + tz * h * u); uv.push(u, y); hh.push(h);
      }
    }
    for (let i = 0; i < steps; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1));
  g.setIndex(idx);
  return g;
}
function buildSparkGeometry(n) {
  const pos = new Float32Array(n * 3), ph = new Float32Array(n), rt = new Float32Array(n), sz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let y, u;
    do { y = Math.pow(Math.random(), 0.85) * (H - 4) + 2; u = rand(-1, 1); } while (y < 44 && Math.abs(u) < 0.56);
    const h = halfW(y), [nx, nz] = faceN(Math.floor(Math.random() * 4)), tx = -nz, tz = nx;
    pos[i * 3] = nx * h + tx * h * u; pos[i * 3 + 1] = y; pos[i * 3 + 2] = nz * h + tz * h * u;
    ph[i] = Math.random(); rt[i] = rand(0.7, 2.2); sz[i] = rand(0.8, 2.2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  g.setAttribute('aRate', new THREE.BufferAttribute(rt, 1));
  g.setAttribute('aSz', new THREE.BufferAttribute(sz, 1));
  return g;
}
function buildBeamGeometry() {
  const mk = (flip) => {
    const g = new THREE.ConeGeometry(30, 1800, 14, 1, true);
    g.translate(0, -900, 0);          // apex at origin, opening toward -y
    g.rotateZ(Math.PI / 2);           // now opening toward +x
    if (flip) g.rotateY(Math.PI);
    return g;
  };
  const a = mk(false), b = mk(true);
  const m = mergeGeometries([a, b]); a.dispose(); b.dispose();
  return m;
}

const EIFFEL_TOWER = {
  id: 'eiffel-tower', kind: 'ambient', local: true, cooldown: 1,
  possible: (ctx) => ctx.place?.id === 'paris' && !!ctx.world && !!ctx.geo,
  chance: () => 1,
  create(ctx) {
    const x = ctx.geo.x(EIFFEL.lon), z = ctx.geo.z(EIFFEL.lat);
    const y = (ctx.terrain?.heightAt ? ctx.terrain.heightAt(x, z) : 35) - 2;
    const g = new THREE.Group(); g.position.set(x, y, z);
    const tg = buildTowerGeometry();
    const tm = new THREE.ShaderMaterial({
      uniforms: { uFogColor: { value: new THREE.Color() }, uFogDen: { value: 0.0003 }, uGlow: { value: 0 }, uDay: { value: 1 } },
      vertexShader: TOWER_VS, fragmentShader: TOWER_FS, transparent: true, side: THREE.DoubleSide, depthWrite: false, extensions: {},
    });
    const tower = new THREE.Mesh(tg, tm); tower.frustumCulled = false; tower.renderOrder = 2;
    g.add(tower);
    const sg = buildSparkGeometry(2000);
    const sMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 800 }, uSpark: { value: 0 } },
      vertexShader: SPARK_VS, fragmentShader: SPARK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const sparks = new THREE.Points(sg, sMat); sparks.frustumCulled = false; sparks.renderOrder = 3; sparks.visible = false;
    g.add(sparks);
    const bg = buildBeamGeometry();
    const bMat = new THREE.ShaderMaterial({
      uniforms: { uOp: { value: 0 } }, vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(bg, bMat); beam.position.y = H + 2; beam.frustumCulled = false; beam.visible = false; beam.renderOrder = 4;
    g.add(beam);
    ctx.world.add(g);
    let time = 0, spark = 0, glow = 0, scan = 0;
    // OpenStreetMap carries the tower as an extruded footprint block: hide those triangles
    // (tiles stream in and out, so look again now and then) and put them back afterwards.
    const cut = []; // { geo, idx, saved: [k, a, b, c, ...] }
    const R2 = 95 * 95;
    const hideBlock = (scene) => {
      for (const m of scene.children) {
        if (!m.isMesh || !m.userData?.tris || m.userData._eiffelCut) continue;
        const gm = m.geometry, bb = gm.boundingBox;
        if (!bb || !gm.index) continue;
        const px = m.position.x, pz = m.position.z;
        if (x < px + bb.min.x - 120 || x > px + bb.max.x + 120 || z < pz + bb.min.z - 120 || z > pz + bb.max.z + 120) continue;
        m.userData._eiffelCut = true;
        const idx = gm.index.array, pa = gm.attributes.position.array, saved = [];
        for (let k = 0; k + 2 < idx.length; k += 3) {
          const a = idx[k], dx = pa[a * 3] + px - x, dz = pa[a * 3 + 2] + pz - z;
          if (dx * dx + dz * dz < R2) { saved.push(k, a, idx[k + 1], idx[k + 2]); idx[k + 1] = a; idx[k + 2] = a; }
        }
        if (saved.length) { gm.index.needsUpdate = true; cut.push({ gm, idx, saved, m }); }
      }
    };
    hideBlock(ctx.world);
    return {
      update(dt, c) {
        time += dt;
        if ((scan -= dt) < 0) { scan = 1; hideBlock(ctx.world); }
        g.visible = !c.inTunnel;
        const gt = sm(0.25, 0.65, c.night);
        glow += (gt - glow) * Math.min(1, dt * 0.5);
        tm.uniforms.uGlow.value = glow;
        tm.uniforms.uDay.value = 1.1 - 0.5 * c.night;
        tm.uniforms.uFogColor.value.copy(c.fog.color);
        tm.uniforms.uFogDen.value = c.fog.density;
        spark += ((eiffelState.spark ? 1 : 0) - spark) * Math.min(1, dt * 0.6);
        sparks.visible = spark > 0.01;
        sMat.uniforms.uSpark.value = spark * glow;
        sMat.uniforms.uTime.value = time;
        sMat.uniforms.uScale.value = c.renderer.domElement.height / (2 * Math.tan((c.camera.fov * Math.PI) / 360));
        beam.visible = glow > 0.05;
        bMat.uniforms.uOp.value = 0.16 * glow;
        beam.rotation.y = time * 0.35;
        return true;
      },
      dispose() {
        for (const { gm, idx, saved, m } of cut) {
          if (!gm.index || gm.index.array !== idx) continue;
          for (let i = 0; i < saved.length; i += 4) { idx[saved[i]] = saved[i + 1]; idx[saved[i] + 1] = saved[i + 2]; idx[saved[i] + 2] = saved[i + 3]; }
          gm.index.needsUpdate = true; m.userData._eiffelCut = false;
        }
        ctx.world.remove(g);
        tg.dispose(); tm.dispose(); sg.dispose(); sMat.dispose(); bg.dispose(); bMat.dispose();
      },
    };
  },
};

const EIFFEL_SPARKLE = {
  id: 'eiffel-sparkle', kind: 'clock', local: true, cooldown: 330,
  label: 'the Eiffel Tower sparkling on the hour',
  possible: (ctx) => ctx.place?.id === 'paris',
  chance: () => 0,
  due: (ctx) => ctx.night > 0.55 && crossedHour(ctx) >= 0,
  create() {
    let t = 0;
    eiffelState.spark = 1;
    return {
      update(dt) { t += dt; if (t > 300) eiffelState.spark = 0; return t < 306; },
      dispose() { eiffelState.spark = 0; },
    };
  },
};

// ---------------------------------------------------------------- 4. street musician
// each tune: [midi|null, beats] melody
const WALTZ = [[69, 1.5], [72, .5], [71, 1], [69, 1.5], [67, .5], [64, 1], [65, 1.5], [67, .5], [69, 1], [67, 2], [null, 1],
  [69, 1.5], [72, .5], [76, 1], [74, 1.5], [72, .5], [71, 1], [69, 1.5], [71, .5], [68, 1], [69, 3]];
const WALTZ_BASS = [[45, 0], [45, 0], [41, 1], [40, 1], [45, 0], [43, 1], [40, 1], [45, 0]]; // root, major?
const SAX = [[67, 1.5], [70, .5], [72, 2], [74, 1.5], [72, .5], [70, 1], [67, 1], [65, 2], [67, 1], [63, 1], [67, 3], [null, 1],
  [70, 1.5], [72, .5], [75, 1], [74, 1], [72, 1.5], [70, .5], [67, 1], [69, 1], [67, 4]];
const SAX_BASS = [43, 43, 41, 41, 39, 39, 38, 38, 43, 43, 41, 41];
const GUITAR = [[48, 60, 64, 67], [43, 59, 62, 67], [45, 60, 64, 69], [41, 60, 65, 69], [48, 60, 64, 67], [43, 59, 62, 67], [45, 60, 64, 69], [41, 60, 65, 72]];
const PICK = [0, 2, 1, 3, 2, 1, 3, 1];

function pluck(ac, dest, t, f, vol, dur) {
  const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
  o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f * 2;
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(500, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const g2 = ac.createGain(); g2.gain.value = 0.25;
  o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(dest);
  o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}
function reed(ac, dest, t, f, len, vol, kind) {
  // kind 'acc': two detuned saws (musette); 'sax': saw + square with vibrato
  const g = ac.createGain(), lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = kind === 'acc' ? 1900 : 1300; lp.Q.value = kind === 'acc' ? 0.7 : 2;
  const atk = kind === 'acc' ? 0.05 : 0.09, rel = 0.12;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + atk);
  g.gain.setValueAtTime(vol * (kind === 'sax' ? 0.8 : 1), t + Math.max(atk, len - rel)); g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.05);
  lp.connect(g); g.connect(dest);
  const mk = (type, fr, v) => {
    const o = ac.createOscillator(), og = ac.createGain();
    o.type = type; o.frequency.value = fr; og.gain.value = v; o.connect(og); og.connect(lp);
    o.start(t); o.stop(t + len + 0.1); return o;
  };
  if (kind === 'acc') { mk('sawtooth', f * 1.004, 0.5); mk('sawtooth', f * 0.996, 0.5); mk('square', f * 2, 0.12); }
  else {
    const a = mk('sawtooth', f, 0.55), b = mk('square', f, 0.25);
    const lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(len, 0.5));
    lfo.connect(lg); lg.connect(a.frequency); lg.connect(b.frequency); lfo.start(t); lfo.stop(t + len + 0.1);
  }
}

function schedulePiece(ac, dest, t0, id) {
  if (id === 'paris') {
    const beat = 0.6; let t = t0;
    for (const [m, b] of WALTZ) { if (m != null) reed(ac, dest, t, mtof(m), b * beat * 0.95, 0.22, 'acc'); t += b * beat; }
    const maj = [0, 0, 1, 1, 0, 1, 1, 0];
    for (let bar = 0; bar < 8; bar++) {
      const [r] = WALTZ_BASS[bar], root = mtof(WALTZ_BASS[bar][0]), mj = maj[bar];
      pluck(ac, dest, t0 + bar * 3 * beat, root, 0.2, 0.5);
      for (const bt of [1, 2]) for (const iv of [0, mj ? 4 : 3, 7]) pluck(ac, dest, t0 + (bar * 3 + bt) * beat, mtof(WALTZ_BASS[bar][0] + 12 + iv), 0.05, 0.3);
      void r;
    }
    return 24 * beat;
  }
  if (id === 'manhattan') {
    const beat = 0.9; let t = t0;
    for (const [m, b] of SAX) { if (m != null) reed(ac, dest, t, mtof(m - 12 + 12), b * beat * 0.92, 0.2, 'sax'); t += b * beat; }
    for (let i = 0; i < SAX_BASS.length; i++) pluck(ac, dest, t0 + i * 2 * beat, mtof(SAX_BASS[i] - 12), 0.28, 1.6);
    return 24 * beat;
  }
  // guitar arpeggio
  const eighth = 0.34; let t = t0;
  for (const ch of GUITAR) for (let k = 0; k < 8; k++) { pluck(ac, dest, t, mtof(ch[PICK[k]]), k === 0 ? 0.3 : 0.18, 1.3); t += eighth; }
  return t - t0;
}

const MUSICIAN = {
  id: 'street-musician', kind: 'random', local: true, cooldown: 600,
  label: 'a street musician playing on the corner',
  possible: (ctx) => audioOK(ctx) && !!ctx.route && ['paris', 'manhattan', 'london', 'la', 'monaco'].includes(ctx.place?.id),
  chance(ctx) {
    if (ctx.hours < 9 || ctx.hours > 21 || ctx.night > 0.75 || !noWx(ctx)) return 0;
    return 1;
  },
  create(ctx) {
    const ac = ctx.audio.ctx, route = ctx.route, tmp = {};
    const s = ctx.s + (ctx.dir || 1) * rand(70, 100);
    route.sample(clamp(s, 0, route.loop ? 1e9 : route.length), tmp);
    const side = Math.random() < 0.5 ? -1 : 1, lat = side * ((route.road?.half ?? 11) + 2.5);
    const px = tmp.x - tmp.tz * lat, pz = tmp.z + tmp.tx * lat;
    const bus = makeBus(ac, ctx.audio.out, { lp: 1500, wet: 0.18, gain: 0, ir: 1.2 });
    const src = ac.createGain(); src.gain.value = 0.55; src.connect(bus.input);
    let started = false, len = 24, t = 0, ended = 0;
    const cam = ctx.camera;
    return {
      update(dt, c) {
        t += dt;
        const e = cam.matrixWorld.elements;
        const dx = px - cam.position.x, dz = pz - cam.position.z, d = Math.hypot(dx, dz);
        if (!started && d < 95) {
          len = schedulePiece(ac, src, ac.currentTime + 0.2, c.place.id) + 1.5; started = true; t = 0;
        }
        if (started) {
          const lat2 = (dx * e[0] + dz * e[2]) / (d + 1);   // camera-right component
          const fb = (dx * -e[8] + dz * -e[10]) / (d + 1);  // forward component
          const g = c.inTunnel ? 0 : 0.5 / (1 + (d / 14) * (d / 14)) * (0.75 + 0.25 * Math.max(0, fb));
          const now = ac.currentTime;
          bus.duck.gain.setTargetAtTime(g, now, 0.25);
          bus.lpf.frequency.setTargetAtTime(500 + 3500 / (1 + d / 20), now, 0.25);
          if (bus.panner.pan) bus.panner.pan.setTargetAtTime(clamp(lat2 * 1.2, -0.9, 0.9), now, 0.2);
          if (t > len) ended = 1;
        } else if (t > 90) ended = 1; // never got near
        return !ended;
      },
      dispose() { bus.dispose(); try { src.disconnect(); } catch (e) { /* ignore */ } },
    };
  },
};

export const LOCAL_SURPRISES = [BELLS, STEAM, EIFFEL_TOWER, EIFFEL_SPARKLE, MUSICIAN];
