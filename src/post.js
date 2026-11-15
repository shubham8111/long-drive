// Cinematic post-processing: HDR targets -> dual-filter bloom -> diffusion ("soft look") -> one final
// grade/tonemap pass.
// Two scene targets: the landscape at the graphics mode's resolution (480/720/1080 lines), and the
// car or horse at full screen resolution (layer RIDE_LAYER), drawn over it in the final pass. Both
// are multisampled, so foliage edges and thin poles hold still instead of crawling.
// The soft look is what a diffusion filter does on a film camera: a wide, gentle blur of the whole
// picture is laid back over the sharp one. Hard edges lose their bite, bright things (sky between
// leaves, lamps, wet road) get a halo, and with lifted blacks and calmer greens the image stops
// looking like crisp toy plastic. It costs five tiny blur passes.
import * as THREE from 'three';

const VERT = `
varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// the landscape with the ride laid over it (the ride target holds premultiplied colour + coverage)
const COMPOSE = `
uniform sampler2D tSrc, tRide;
vec3 scn(vec2 uv){ vec4 r = texture2D(tRide, uv); return texture2D(tSrc, uv).rgb * (1.0 - r.a) + r.rgb; }`;

const PRE_FRAG = `
precision highp float;
uniform vec2 texel; uniform float exposure, threshold, knee;
varying vec2 vUv;
${COMPOSE}
vec3 pf(vec3 c){
  float l = max(max(c.r, c.g), c.b) * exposure;
  float s = clamp(l - threshold + knee, 0.0, 2.0 * knee);
  s = s * s / (4.0 * knee + 1e-4);
  float w = max(s, l - threshold) / max(l, 1e-4);
  return min(c * w, vec3(60.0));
}
// Karis average: each tap weighted by 1/(1+brightness), so a lamp or glint smaller than a pixel can't
// make the bloom blink on and off as it moves across pixels ("fireflies")
float kw(vec3 c){ return 1.0 / (1.0 + max(max(c.r, c.g), c.b) * exposure); }
void main(){
  vec3 a = pf(scn(vUv + texel * vec2(-1.0,-1.0)));
  vec3 b = pf(scn(vUv + texel * vec2( 1.0,-1.0)));
  vec3 c = pf(scn(vUv + texel * vec2(-1.0, 1.0)));
  vec3 d = pf(scn(vUv + texel * vec2( 1.0, 1.0)));
  float wa = kw(a), wb = kw(b), wc = kw(c), wd = kw(d);
  gl_FragColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);
}`;

// first step of the diffusion blur: half size, from the composed picture, also firefly-safe
const SOFT0_FRAG = `
precision highp float;
uniform vec2 texel; uniform float exposure; varying vec2 vUv;
${COMPOSE}
float kw(vec3 c){ return 1.0 / (1.0 + max(max(c.r, c.g), c.b) * exposure * 0.5); }
void main(){
  vec3 a = scn(vUv + texel * vec2(-1.0,-1.0)), b = scn(vUv + texel * vec2( 1.0,-1.0));
  vec3 c = scn(vUv + texel * vec2(-1.0, 1.0)), d = scn(vUv + texel * vec2( 1.0, 1.0));
  float wa = kw(a), wb = kw(b), wc = kw(c), wd = kw(d);
  gl_FragColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);
}`;

const DOWN_FRAG = `
precision highp float;
uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + texel * vec2(-1.0,-1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2( 1.0,-1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2( 1.0, 1.0)).rgb;
  gl_FragColor = vec4(c * 0.125, 1.0);
}`;

const UP_FRAG = `
precision highp float;
uniform sampler2D tSrc; uniform vec2 texel; uniform float gain; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv + texel * vec2(-1.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2( 1.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2( 0.0,-1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2( 0.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + texel * vec2(-0.5,-0.5)).rgb * 2.0;
  c += texture2D(tSrc, vUv + texel * vec2( 0.5,-0.5)).rgb * 2.0;
  c += texture2D(tSrc, vUv + texel * vec2(-0.5, 0.5)).rgb * 2.0;
  c += texture2D(tSrc, vUv + texel * vec2( 0.5, 0.5)).rgb * 2.0;
  gl_FragColor = vec4(c * (gain / 12.0), 1.0);
}`;

const FINAL_FRAG = `
precision highp float;
uniform sampler2D tScene, tBloom, tSoft, tRide;
uniform float softAmt, lift, greenTame;
uniform float exposure, bloomAmt, mbStrength, night, wet, time, vignette, grain, ditherAmt;
uniform vec2 res, sceneSize;
varying vec2 vUv;

// Smooth (cubic B-spline) upscaling of the landscape from its lower resolution, in four bilinear taps.
// Unlike plain bilinear stretching it leaves no trace of the pixel grid: just a soft, filmic picture.
vec3 upscale(sampler2D tex, vec2 uv){
  vec2 p = uv * sceneSize - 0.5, f = fract(p), i = p - f;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 1.0 + w1 / g0 + 0.5) / sceneSize, h1 = (i + 1.0 + w3 / g1 + 0.5) / sceneSize;
  return (texture2D(tex, vec2(h0.x, h0.y)).rgb * g0.x + texture2D(tex, vec2(h1.x, h0.y)).rgb * g1.x) * g0.y
       + (texture2D(tex, vec2(h0.x, h1.y)).rgb * g0.x + texture2D(tex, vec2(h1.x, h1.y)).rgb * g1.x) * g1.y;
}

vec3 RRTAndODTFit(vec3 v){
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color){
  const mat3 I = mat3(vec3(0.59719,0.07600,0.02840), vec3(0.35458,0.90834,0.13383), vec3(0.04823,0.01566,0.83777));
  const mat3 O = mat3(vec3(1.60475,-0.10208,-0.00327), vec3(-0.53108,1.10813,-0.07276), vec3(-0.07367,-0.00605,1.07602));
  color *= exposure / 0.6;
  color = I * color; color = RRTAndODTFit(color); color = O * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main(){
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  d.x *= res.x / res.y;
  float r = length(d);

  // radial motion blur (HDR), edges only
  vec3 col = upscale(tScene, uv);
  #if MB_TAPS > 0
  if (mbStrength > 0.0005) {
    float m = smoothstep(0.30, 0.85, r) * mbStrength;
    vec2 dir = (uv - 0.5) * m;
    vec3 acc = col; float wsum = 1.0;
    for (int i = 1; i <= MB_TAPS; i++) {
      float t = float(i) / float(MB_TAPS);
      float w = 1.0 - 0.5 * t;
      acc += texture2D(tScene, uv - dir * t).rgb * w; wsum += w;
    }
    col = acc / wsum;
  }
  #endif
  // the car / horse, sharp, over the (motion-blurred) landscape
  vec4 rd = texture2D(tRide, uv);
  col = col * (1.0 - rd.a) + rd.rgb;

  col += texture2D(tBloom, uv).rgb * bloomAmt;
  // diffusion: blend towards, and add a little of, the wide blur of the whole frame
  if (softAmt > 0.001) {
    vec3 soft = texture2D(tSoft, uv).rgb;
    col = (mix(col, soft, softAmt * 0.55) + soft * softAmt * 0.4) / (1.0 + softAmt * 0.4);
  }

  // tone map once (ACES, with renderer exposure), then grade in display space
  vec3 c = aces(col);
  c = toSRGB(c);

  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // gentle S-curve
  // softer at night: less contrast, so the dark is restful rather than stark
  float contrast = (0.10 - 0.04 * night + 0.03 * wet) * (1.0 - 0.6 * min(1.0, softAmt * 3.0));
  vec3 s = c * c * (3.0 - 2.0 * c);
  c = mix(c, s, contrast * 1.6);
  // saturation
  luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sat = 1.07 - 0.10 * night - 0.06 * wet;
  c = mix(vec3(luma), c, sat);
  // split tone: warm highlights, cool shadows
  float sh = (1.0 - smoothstep(0.0, 0.5, luma)) * smoothstep(0.0, 0.12, luma);
  float hi = smoothstep(0.45, 1.0, luma);
  vec3 coolS = vec3(-0.012, 0.004, 0.022);
  vec3 warmH = vec3(0.020, 0.008, -0.016);
  c += coolS * sh * (1.0 + 0.6 * night) + warmH * hi * (1.0 - 0.2 * night);
  // night: blue sky and shadows, but a touch of warmth over everything (lamplight, not moonlight on steel)
  c *= mix(vec3(1.0), vec3(1.01, 0.995, 0.975), night * 0.8);

  // calmer foliage: saturated yellow-greens are the most toy-like colour on screen
  {
    float yg = clamp((c.g - c.b) * 3.0, 0.0, 1.0) * smoothstep(0.88, 1.0, c.g / max(c.r, 1e-3));
    float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, mix(vec3(l2), c, 0.70) * vec3(0.95, 0.985, 1.03), yg * greenTame);
  }
  // matte blacks: nothing is ever pure black, like a print
  c = c * (1.0 - lift) + lift * vec3(0.55, 0.62, 0.80) * (1.0 - 0.5 * night);

  // vignette
  float v = smoothstep(0.35, 1.05, r);
  c *= 1.0 - vignette * v * v;

  // film grain, luminance weighted
  float g = hash(gl_FragCoord.xy + fract(time * 7.13) * 311.0) - 0.5;
  float lw = 1.0 - abs(luma - 0.45) * 1.1;
  c += g * grain * clamp(lw, 0.25, 1.0);

  // triangular dither
  float n = hash(gl_FragCoord.xy * 1.37 + 17.0 + fract(time) * 53.0) + hash(gl_FragCoord.yx * 0.73 + 91.0 + fract(time * 1.7) * 29.0) - 1.0;
  c += n / 255.0 * ditherAmt;

  gl_FragColor = vec4(max(c, 0.0), 1.0);
}`;

export const RIDE_LAYER = 1;

const hdrTarget = (w, h, samples = 0, depth = false) => {
  const rt = new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
    type: THREE.HalfFloatType, samples, depthBuffer: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  if (depth) {
    // a float depth buffer: with the reversed depth range this keeps distant surfaces from fighting
    rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height, THREE.FloatType);
    rt.resolveDepthBuffer = false; // nothing reads it back
  }
  return rt;
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.time = 0; this.mb = 0;
    this.w = 2; this.h = 2; this.fw = 2; this.fh = 2; this.msaa = 4;
    this.info = {};
    this.sceneRT = hdrTarget(2, 2, 4, true);
    this.rideRT = hdrTarget(2, 2, +(new URLSearchParams(location.search).get('ridemsaa') ?? 4), true);
    this.blank = hdrTarget(2, 2);
    this.rideUsed = false;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(geo, null);
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene(); this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); // (the quad ignores it; reversed depth needs a real projection)

    const mk = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra,
    });
    this.matPre = mk(PRE_FRAG, { tSrc: { value: null }, tRide: { value: null }, texel: { value: new THREE.Vector2() }, exposure: { value: 0.5 }, threshold: { value: 1.8 }, knee: { value: 0.9 } });
    this.matSoft0 = mk(SOFT0_FRAG, { tSrc: { value: null }, tRide: { value: null }, texel: { value: new THREE.Vector2() }, exposure: { value: 0.5 } });
    this.matDown = mk(DOWN_FRAG, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
    this.matUpR = mk(UP_FRAG, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, gain: { value: 1 } });
    this.soft = [];
    this.softOn = new URLSearchParams(location.search).get('soft') !== '0';
    this.matUp = mk(UP_FRAG, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, gain: { value: 1 } },
      { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    this.finals = {};
    this.mips = [];
    this._clear = new THREE.Color();
    // GPU time of a whole frame, when the browser can measure it (window.__ld.post.info.gpu)
    const gl = renderer.getContext();
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.queries = []; this.gpuMs = 0;
    const q = new URLSearchParams(location.search); this.tune = q.has('tune') ? Object.fromEntries(q.get('tune').split(',').map((kv) => kv.split(':')).map(([k, v]) => [k, +v])) : null;
  }

  _final(taps) {
    if (!this.finals[taps]) {
      this.finals[taps] = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false, toneMapped: false,
        defines: { MB_TAPS: taps },
        uniforms: {
          tScene: { value: this.sceneRT.texture }, tBloom: { value: null }, tSoft: { value: null }, tRide: { value: null }, softAmt: { value: 0 }, lift: { value: 0 }, greenTame: { value: 0 }, exposure: { value: 0.5 }, bloomAmt: { value: 0.1 },
          mbStrength: { value: 0 }, night: { value: 0 }, wet: { value: 0 }, time: { value: 0 }, vignette: { value: 0.28 },
          grain: { value: 0.022 }, ditherAmt: { value: 1 }, res: { value: new THREE.Vector2(1, 1) }, sceneSize: { value: new THREE.Vector2(1, 1) },
        },
      });
    }
    return this.finals[taps];
  }

  // width/height in CSS pixels; worldRatio sizes the landscape, fullRatio the ride and the screen
  setSize(width, height, worldRatio, fullRatio = worldRatio, msaa = 4) {
    const w = Math.max(2, Math.round(width * worldRatio)), h = Math.max(2, Math.round(height * worldRatio));
    const fw = Math.max(2, Math.round(width * fullRatio)), fh = Math.max(2, Math.round(height * fullRatio));
    if (msaa !== this.msaa) { this.msaa = msaa; this.sceneRT.dispose(); this.sceneRT.samples = msaa; }
    if (w !== this.w || h !== this.h) {
      this.w = w; this.h = h;
      this.sceneRT.setSize(w, h);
      this._buildMips();
    }
    if (fw !== this.fw || fh !== this.fh) { this.fw = fw; this.fh = fh; this.rideRT.setSize(fw, fh); }
    this.info.world = `${w}x${h}`; this.info.full = `${fw}x${fh}`; this.info.msaa = msaa;
  }

  _buildMips() {
    for (const m of this.mips) m.dispose();
    this.mips = [];
    // bloom: from half the landscape size down to about 1/64 of the screen height
    const levels = Math.max(3, Math.min(6, Math.round(Math.log2(this.h / 12))));
    let w = Math.max(2, this.w >> 1), h = Math.max(2, this.h >> 1);
    for (let i = 0; i < levels; i++) { this.mips.push(hdrTarget(w, h)); w >>= 1; h >>= 1; }
    for (const m of this.soft) m.dispose();
    this.soft = [];
    for (let i = 1; i <= 3; i++) this.soft.push(hdrTarget(this.w >> i, this.h >> i));
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  _gpuBegin() {
    const t = this.timer; if (!t) return;
    const gl = this.renderer.getContext();
    while (this.queries.length && gl.getQueryParameter(this.queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const qq = this.queries.shift();
      if (!gl.getParameter(t.GPU_DISJOINT_EXT)) this.gpuMs = this.gpuMs * 0.9 + (gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6) * 0.1;
      gl.deleteQuery(qq);
    }
    if (this.queries.length > 4) return;
    this._q = gl.createQuery(); gl.beginQuery(t.TIME_ELAPSED_EXT, this._q);
  }

  _gpuEnd() {
    if (!this._q) return;
    const gl = this.renderer.getContext();
    gl.endQuery(this.timer.TIME_ELAPSED_EXT); this.queries.push(this._q); this._q = null;
    this.info.gpu = +this.gpuMs.toFixed(2);
  }

  // s: { speed, night, wet, ride }: ride = draw the car/horse in its own full-resolution pass (only
  // when the camera is close to it: from afar it must be hidden by trees like everything else)
  render(dt, s) {
    const r = this.renderer, cam = this.camera;
    this.time += dt;
    this._gpuBegin();
    r.info.autoReset = false; r.info.reset();

    const prevRT = r.getRenderTarget();
    const prevAuto = r.autoClear;
    const exposure = r.toneMappingExposure;
    const near0 = cam.near, mask0 = cam.layers.mask;

    // 1. landscape -> multisampled HDR target at the mode's resolution
    const split = !!s.ride;
    if (split) {
      cam.layers.set(0);
      // nothing of the world is ever this close: a farther near plane buys depth precision
      cam.near = Math.max(near0, 0.5); cam.updateProjectionMatrix();
    } else cam.layers.mask = mask0 | (1 << RIDE_LAYER);
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(this.scene, cam);

    // 1b. the ride at full resolution over a transparent background; the sun's shadow map from the
    // landscape pass (which includes the ride's own shadow) is reused, not drawn again
    let ride = this.blank.texture;
    if (split) {
      cam.layers.set(RIDE_LAYER);
      cam.near = near0; cam.updateProjectionMatrix();
      const sm = r.shadowMap.autoUpdate;
      r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false;
      r.getClearColor(this._clear); const ca = r.getClearAlpha();
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(this.rideRT);
      r.clear();
      r.render(this.scene, cam);
      r.setClearColor(this._clear, ca);
      r.shadowMap.autoUpdate = sm;
      ride = this.rideRT.texture;
    }
    cam.layers.mask = mask0 | (1 << RIDE_LAYER);
    cam.near = near0; cam.updateProjectionMatrix();

    // 2. bloom
    const mips = this.mips, n = mips.length;
    const pre = this.matPre;
    pre.uniforms.tSrc.value = this.sceneRT.texture;
    pre.uniforms.tRide.value = ride;
    pre.uniforms.texel.value.set(1 / this.w, 1 / this.h);
    pre.uniforms.exposure.value = exposure;
    pre.uniforms.threshold.value = 1.8 - 0.5 * s.night;
    this._pass(pre, mips[0]);
    const down = this.matDown;
    for (let i = 1; i < n; i++) {
      down.uniforms.tSrc.value = mips[i - 1].texture;
      down.uniforms.texel.value.set(1 / mips[i - 1].width, 1 / mips[i - 1].height);
      this._pass(down, mips[i]);
    }
    const up = this.matUp;
    r.autoClear = false;
    for (let i = n - 1; i > 0; i--) {
      up.uniforms.tSrc.value = mips[i].texture;
      up.uniforms.texel.value.set(1 / mips[i].width, 1 / mips[i].height);
      up.uniforms.gain.value = 1.0;
      this._pass(up, mips[i - 1]);
    }
    r.autoClear = prevAuto;

    // 2b. diffusion blur of the whole frame: 1/2 -> 1/4 -> 1/8 and back up
    const sf = this.soft;
    if (this.softOn && sf.length) {
      const s0 = this.matSoft0;
      s0.uniforms.tSrc.value = this.sceneRT.texture; s0.uniforms.tRide.value = ride;
      s0.uniforms.texel.value.set(1 / this.w, 1 / this.h); s0.uniforms.exposure.value = exposure;
      this._pass(s0, sf[0]);
      for (let i = 1; i < sf.length; i++) {
        down.uniforms.tSrc.value = sf[i - 1].texture;
        down.uniforms.texel.value.set(1 / sf[i - 1].width, 1 / sf[i - 1].height);
        this._pass(down, sf[i]);
      }
      const upr = this.matUpR;
      for (let i = sf.length - 1; i > 0; i--) {
        upr.uniforms.tSrc.value = sf[i].texture;
        upr.uniforms.texel.value.set(1 / sf[i].width, 1 / sf[i].height);
        this._pass(upr, sf[i - 1]);
      }
    }

    // 3. final, at full screen resolution
    const f = this._final(4);
    const u = f.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tRide.value = ride;
    u.tBloom.value = mips[0].texture;
    u.exposure.value = exposure;
    u.bloomAmt.value = 0.05 + 0.09 * s.night + 0.03 * s.wet;
    const sp = THREE.MathUtils.smoothstep(s.speed, 10, 39);
    u.mbStrength.value = sp * 0.032;
    u.night.value = s.night; u.wet.value = s.wet;
    const softOn = this.softOn && sf.length;
    u.tSoft.value = softOn ? sf[0].texture : null;
    u.softAmt.value = softOn ? 0.30 + 0.10 * s.night + 0.06 * s.wet : 0;
    u.lift.value = softOn ? 0.035 + 0.015 * s.night : 0; // matte, gentle blacks, a little more so at night
    u.greenTame.value = softOn ? 0.85 : 0;
    if (softOn) u.bloomAmt.value *= 1.5;
    u.time.value = this.time;
    u.res.value.set(this.fw, this.fh);
    u.sceneSize.value.set(this.w, this.h);
    const T = this.tune; if (T) { if (T.bloom !== undefined) u.bloomAmt.value = T.bloom; if (T.mb !== undefined) u.mbStrength.value = T.mb; if (T.vig !== undefined) u.vignette.value = T.vig; if (T.grain !== undefined) u.grain.value = T.grain; if (T.dither !== undefined) u.ditherAmt.value = T.dither; if (T.soft !== undefined) u.softAmt.value = T.soft; if (T.lift !== undefined) u.lift.value = T.lift; if (T.green !== undefined) u.greenTame.value = T.green; }
    this._pass(f, null);

    r.setRenderTarget(prevRT);
    this.info.calls = r.info.render.calls; this.info.tris = r.info.render.triangles;
    r.info.autoReset = true;
    this._gpuEnd();
  }
}
