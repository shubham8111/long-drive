// Sky surprises: a shooting star, hot-air balloons at dawn, far lightning, a rainbow after rain, a jet's contrail.
// Everything here is cheap: a handful of draw calls, tiny geometry, no lights, nothing allocated per frame.
// Sky things are anchored to the camera (directions on a big sphere, like the stars); balloons live in the world.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const D2R = Math.PI / 180;
const FORCE = (() => { try { return new URLSearchParams(location.search).get('surprise'); } catch (e) { return null; } })();

const HOLD = typeof location !== 'undefined' && /skyhold/.test(location.search); // testing
const SKY_R = 100000;      // radius of the sphere sky things sit on (inside the cloud dome at 170 km)
const SKY_ORDER = -7;      // transparent, after the clouds (-8), before everything else

// ---------- helpers ----------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// unit direction for a heading (yaw as the game uses it: forward = (-sin, -cos)) and elevation
function dirFrom(yaw, el, out) {
  const ce = Math.cos(el);
  return out.set(-Math.sin(yaw) * ce, Math.sin(el), -Math.cos(yaw) * ce);
}

function glowTexture(size = 128, stops = [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function disposeObject(o) {
  o.parent?.remove(o);
  o.traverse?.((n) => {
    n.geometry?.dispose?.();
    const m = n.material;
    if (m) for (const mm of Array.isArray(m) ? m : [m]) { mm.map?.dispose?.(); mm.dispose?.(); }
  });
}

function skyMaterial(extra = {}) {
  return new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide, ...extra });
}

// ============================================================ 1. shooting stars
const STREAKS = 3, SSEG = 10;

function createShootingStar(ctx) {
  const nv = STREAKS * (SSEG + 1) * 2;
  const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 4);
  const idx = [];
  for (let k = 0; k < STREAKS; k++) {
    const o = k * (SSEG + 1) * 2;
    for (let i = 0; i < SSEG; i++) { const a = o + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, skyMaterial({ blending: THREE.AdditiveBlending }));
  mesh.frustumCulled = false; mesh.renderOrder = SKY_ORDER;
  ctx.scene.add(mesh);

  const n = 1 + Math.floor(Math.random() * 3);
  const yaw0 = ctx.pose?.yaw ?? 0;
  const streaks = [];
  let t0 = rand(1, 3);
  for (let k = 0; k < n; k++) {
    const bright = Math.random() < 0.3;
    const S = dirFrom(yaw0 + rand(-60, 60) * D2R, rand(28, 62) * D2R, new THREE.Vector3());
    const down = _a.copy(UP).addScaledVector(S, -S.dot(UP)).normalize().negate();   // tangent pointing toward the horizon
    const side = _b.crossVectors(S, down);
    const psi = rand(-1, 1) * 0.95;
    const T = new THREE.Vector3().copy(down).multiplyScalar(Math.cos(psi)).addScaledVector(side, Math.sin(psi)).normalize();
    streaks.push({ S, T, bright, t0, dur: bright ? 1.7 : rand(1.0, 1.3), len: (bright ? rand(20, 30) : rand(11, 20)) * D2R, w: bright ? 1.5 : 1 });
    t0 += rand(3, 6.5);
  }
  let t = 0;
  const end = t0 + 1;

  const point = (s, k, side, out) => {
    const st = streaks[k];
    // P(s) = S cos s + T sin s ; tangent = -S sin s + T cos s
    const cs = Math.cos(s), sn = Math.sin(s);
    _c.copy(st.S).multiplyScalar(cs).addScaledVector(st.T, sn);
    _d.copy(st.S).multiplyScalar(-sn).addScaledVector(st.T, cs);
    const sd = _a.crossVectors(_c, _d).normalize().multiplyScalar(side);
    return out.copy(_c).multiplyScalar(SKY_R).add(sd);
  };

  return {
    update(dt, c) {
      t += dt;
      mesh.position.copy(c.camera.position);
      mesh.visible = !c.inTunnel;
      for (let k = 0; k < STREAKS; k++) {
        const st = streaks[k];
        const o = k * (SSEG + 1) * 2;
        const p = st ? (t - st.t0) / st.dur : -1;      // 0..1.35
        const live = st && p > 0 && p < 1.35;
        for (let i = 0; i <= SSEG; i++) {
          const v = o + i * 2;
          if (!live) { col[v * 4 + 3] = col[(v + 1) * 4 + 3] = 0; pos[v * 3] = pos[v * 3 + 1] = pos[v * 3 + 2] = pos[(v + 1) * 3] = pos[(v + 1) * 3 + 1] = pos[(v + 1) * 3 + 2] = 0; continue; }
          const head = st.len * clamp(p, 0, 1), tail = st.len * clamp(p - 0.38, 0, 1);
          const u = i / SSEG;                           // 0 head .. 1 tail
          const s = lerp(head, tail, u);
          const w = st.w * 95 * (1 - u * 0.95);
          point(s, k, w, _b); pos[v * 3] = _b.x; pos[v * 3 + 1] = _b.y; pos[v * 3 + 2] = _b.z;
          point(s, k, -w, _b); pos[(v + 1) * 3] = _b.x; pos[(v + 1) * 3 + 1] = _b.y; pos[(v + 1) * 3 + 2] = _b.z;
          const fade = p < 1 ? sstep(0, 0.08, p) : (1.35 - p) / 0.35;
          const a = Math.pow(1 - u, 1.6) * fade * (st.bright ? 1 : 0.75) * (1 - ctx0(c));
          for (const q of [v, v + 1]) { col[q * 4] = 1; col[q * 4 + 1] = 0.97 - 0.1 * u; col[q * 4 + 2] = 0.9 - 0.2 * u; col[q * 4 + 3] = a; }
        }
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      return t < end + 1.5;
    },
    dispose() { disposeObject(mesh); },
  };
}
const ctx0 = (c) => clamp((c.w?.cover ?? 0) * 0.8, 0, 0.5);

const shootingStar = {
  id: 'shooting-star', kind: 'random', label: 'a shooting star', cooldown: 240,
  possible: (c) => c.night > 0.7 && (c.w?.cover ?? 0) < 0.5 && !c.inTunnel,
  chance: () => 1,
  create: createShootingStar,
};

// ============================================================ 2. hot-air balloons
const PALETTES = [
  ['#d9442c', '#f3e6cf'], ['#2f6fb0', '#f1c84b', '#f3e6cf'], ['#e08a1f', '#9b2f52'], ['#2c8a6e', '#f3e6cf'],
  ['#c23a6a', '#f2b84b'], ['#6a4aa8', '#e9e2cf', '#d9442c'], ['#e5b92b', '#b8352b'],
];
let _balloonGeos = null;
function balloonGeometry(pi) {
  _balloonGeos ??= [];
  if (_balloonGeos[pi]) return _balloonGeos[pi];
  const pal = PALETTES[pi].map((s) => new THREE.Color(s));
  const prof = [new THREE.Vector2(1.45, 0), new THREE.Vector2(1.5, 1.2)];
  const base = 2.4, H = 19;
  for (let i = 0; i <= 22; i++) {
    const u = i / 22, v = Math.pow(u, 1.25);
    const r = 8.3 * Math.pow(Math.max(Math.sin(Math.PI * v), 0), 0.6) + 1.6 * Math.max(0, 1 - u * 5);
    prof.push(new THREE.Vector2(Math.max(r, 0.001), base + u * H));
  }
  const GS = 12, SEGS = GS * 2;
  let env = new THREE.LatheGeometry(prof, SEGS).toNonIndexed();
  const p = env.attributes.position, nrm = env.attributes.normal;
  const cols = new Float32Array(p.count * 3);
  for (let f = 0; f < p.count; f += 3) {
    let cx = 0, cz = 0, cy = 0;
    for (let k = 0; k < 3; k++) { cx += p.getX(f + k); cz += p.getZ(f + k); cy += p.getY(f + k); }
    const ang = (Math.atan2(cx, cz) + Math.PI * 2) % (Math.PI * 2);
    const gore = Math.floor(ang / (Math.PI * 2 / GS));
    cy /= 3;
    let c = pal[gore % pal.length];
    if (cy < base + 0.5) c = pal[0].clone().multiplyScalar(0.55);                         // skirt
    else if (pi % 2 === 0 && cy > base + H * 0.40 && cy < base + H * 0.50) c = pal[pal.length - 1];   // a band
    for (let k = 0; k < 3; k++) { cols[(f + k) * 3] = c.r; cols[(f + k) * 3 + 1] = c.g; cols[(f + k) * 3 + 2] = c.b; }
  }
  env.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  env.deleteAttribute('uv');
  let basket = new THREE.BoxGeometry(1.7, 1.3, 1.7).toNonIndexed();
  basket.translate(0, -1.0, 0);
  basket.deleteAttribute('uv');
  const bc = new Float32Array(basket.attributes.position.count * 3);
  const brown = new THREE.Color('#6b4a2e');
  for (let i = 0; i < bc.length; i += 3) { bc[i] = brown.r; bc[i + 1] = brown.g; bc[i + 2] = brown.b; }
  basket.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  const geo = mergeGeometries([env, basket]);
  env.dispose(); basket.dispose();
  return (_balloonGeos[pi] = geo);
}

function createBalloons(ctx) {
  const cam = ctx.camera.position;
  const yaw = ctx.pose?.yaw ?? 0;
  const n = 3 + Math.floor(Math.random() * 5);
  const wind = rand(0, Math.PI * 2), wsp = rand(1.2, 2.6);
  const wx = Math.cos(wind) * wsp, wz = Math.sin(wind) * wsp;
  const group = new THREE.Group(); group.name = 'balloons';
  ctx.scene.add(group);
  const glowTex = glowTexture(64);
  const pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 7, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, sizeAttenuation: true }));
  const bpos = new Float32Array(n * 3), bcol = new Float32Array(n * 3);
  pts.geometry.setAttribute('position', new THREE.BufferAttribute(bpos, 3).setUsage(THREE.DynamicDrawUsage));
  pts.geometry.setAttribute('color', new THREE.BufferAttribute(bcol, 3).setUsage(THREE.DynamicDrawUsage));
  pts.frustumCulled = false; pts.renderOrder = 5;
  ctx.scene.add(pts);

  const pal0 = Math.floor(Math.random() * PALETTES.length);
  const list = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(balloonGeometry((pal0 + i * 3 + Math.floor(Math.random() * 2)) % PALETTES.length),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, transparent: true, opacity: 0, side: THREE.DoubleSide }));
    const sc = rand(0.85, 1.25) * 1.35;
    m.scale.setScalar(sc);
    m.frustumCulled = true;
    group.add(m);
    const a = yaw + rand(-38, 38) * D2R, dist = rand(320, 1200);
    list.push({
      m, sc,
      rx: -Math.sin(a) * dist, rz: -Math.cos(a) * dist,
      dy: i % 3 === 0 ? rand(-60, 10) : rand(30, 320),                // some lower, some high
      ph: rand(0, 6.28), rate: rand(0.05, 0.12), amp: rand(5, 14),
      spin: rand(-0.03, 0.03), rot: rand(0, 6.28),
      burn: rand(2, 8), burning: 0, vy: 0,
    });
  }
  const cx0 = cam.x, cy0 = cam.y, cz0 = cam.z;
  const FOLLOW = 0.93;
  const life = rand(150, 190);
  let t = 0;
  const _dir = new THREE.Vector3();

  return {
    update(dt, c) {
      t += dt;
      const vis = !c.inTunnel;
      group.visible = pts.visible = vis;
      const fadeIO = Math.min(sstep(0, 10, t), sstep(life, life - 14, t));
      const sunUp = clamp(c.elevDeg / 8, 0, 1);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const x = cx0 + b.rx + wx * t + FOLLOW * (cam.x - cx0);
        const z = cz0 + b.rz + wz * t + FOLLOW * (cam.z - cz0);
        const y = cy0 + b.dy + 0.9 * (cam.y - cy0) + Math.sin(b.ph + t * b.rate) * b.amp;
        b.m.position.set(x, y, z);
        b.rot += b.spin * dt; b.m.rotation.y = b.rot;
        _dir.set(x - cam.x, y - cam.y, z - cam.z);
        const d = _dir.length(); _dir.multiplyScalar(1 / d);
        const mat = b.m.material;
        mat.opacity = fadeIO * sstep(60, 200, d) * (1 - sstep(1400, 2200, d));
        b.m.visible = mat.opacity > 0.01;
        // backlit: the envelope glows when it sits between us and the sun
        const back = Math.pow(Math.max(0, _dir.dot(c.sunDir)), 5) * sunUp;
        mat.color.setScalar(1 + 0.9 * back);
        mat.emissive.setRGB(0.35, 0.16, 0.05).multiplyScalar(back * 0.5);
        // burner
        b.burn -= dt;
        if (b.burn < 0) { b.burning = b.burning > 0 ? 0 : rand(0.8, 1.6); b.burn = b.burning > 0 ? b.burning : rand(7, 16); }
        const flick = b.burning > 0 ? 0.55 + 0.45 * Math.sin(t * 40 + i * 3) * Math.sin(t * 17 + i) : 0;
        bpos[i * 3] = x; bpos[i * 3 + 1] = y + 1.8 * b.sc; bpos[i * 3 + 2] = z;
        const k = flick * mat.opacity;
        bcol[i * 3] = k; bcol[i * 3 + 1] = k * 0.55; bcol[i * 3 + 2] = k * 0.2;
      }
      pts.geometry.attributes.position.needsUpdate = true; pts.geometry.attributes.color.needsUpdate = true;
      return t < life;
    },
    dispose() {
      for (const b of list) b.m.material.dispose();   // geometry is shared and cached
      group.parent?.remove(group);
      pts.parent?.remove(pts); pts.geometry.dispose(); pts.material.dispose(); glowTex.dispose();
    },
  };
}

const balloons = {
  id: 'balloons', kind: 'random', local: true, cooldown: 900,
  label: (c) => (c.place?.id === 'bryce' ? 'hot-air balloons drifting over the canyon' : 'hot-air balloons drifting in the morning air'),
  possible: (c) => c.place?.kind === 'scenic' && !c.inTunnel && (c.weatherId === 'clear' || c.weatherId === 'clouds') && (c.w?.rain ?? 0) < 0.05 && (c.w?.fog ?? 0) < 0.0006
    && ((c.hours >= 5.5 && c.hours <= 9.5) || (c.hours < 12 && c.elevDeg > -2 && c.elevDeg < 20)),
  chance: (c) => (c.weatherId === 'clear' ? 1.5 : 1),
  create: createBalloons,
};

// ============================================================ 3. far-off lightning
const BOLT_SEGS = 36;
const GLOW_R = 25000; // the flash lights clouds 25 km out: near enough to be hidden by hills and trees in front

function createLightning(ctx) {
  const tex = glowTexture(128, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(210,225,255,0.55)'], [0.55, 'rgba(160,185,255,0.12)'], [1, 'rgba(150,170,255,0)']]);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, opacity: 0, color: new THREE.Color(0.8, 0.88, 1) }));
  glow.renderOrder = SKY_ORDER; glow.frustumCulled = false;
  const bpos = new Float32Array(BOLT_SEGS * 2 * 3);
  const bgeo = new THREE.BufferGeometry();
  bgeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3).setUsage(THREE.DynamicDrawUsage));
  const bolt = new THREE.LineSegments(bgeo, new THREE.LineBasicMaterial({ color: new THREE.Color(0.85, 0.9, 1), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
  bolt.frustumCulled = false; bolt.renderOrder = SKY_ORDER;
  ctx.scene.add(glow); ctx.scene.add(bolt);

  const yaw0 = ctx.pose?.yaw ?? 0;
  const flashes = [];
  const count = 3 + Math.floor(Math.random() * 4);
  let tt = rand(2, 5);
  for (let i = 0; i < count; i++) {
    flashes.push({
      t: tt, az: yaw0 + rand(-80, 80) * D2R, el: rand(5, 12) * D2R, size: rand(0.7, 1.3),
      bolt: Math.random() < 0.45, pulses: 2 + Math.floor(Math.random() * 2), done: false, boltSeed: Math.random(),
    });
    tt += rand(3, 9);
  }
  const end = tt + 4;
  let t = 0, cur = null, thunders = [];
  let auBuf = null;

  const setBolt = (f) => {
    const top = f.el + rand(6, 11) * D2R, bot = Math.max(f.el - 3 * D2R, 0.2 * D2R);
    let az = f.az, el = top, n = 0;
    const steps = 14;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      pts.push(dirFrom(az, el, new THREE.Vector3()));
      el = lerp(top, bot, (i + 1) / steps);
      az += rand(-0.55, 0.55) * D2R;
    }
    for (const p of pts) p.multiplyScalar(SKY_R * 1.1);
    for (let i = 0; i < steps && n < BOLT_SEGS; i++, n++) { // main channel
      pts[i].toArray(bpos, n * 6); pts[i + 1].toArray(bpos, n * 6 + 3);
    }
    // a branch
    const s0 = 5 + Math.floor(Math.random() * 4);
    let prev = pts[s0].clone();
    let baz = f.az, bel = Math.atan2(prev.y, Math.hypot(prev.x, prev.z));
    baz = Math.atan2(-prev.x, -prev.z);
    const dirSign = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < 6 && n < BOLT_SEGS; i++, n++) {
      baz += dirSign * rand(0.2, 0.9) * D2R; bel -= rand(0.2, 0.8) * D2R;
      const q = dirFrom(baz, Math.max(bel, 0.1 * D2R), new THREE.Vector3()).multiplyScalar(SKY_R * 1.1);
      prev.toArray(bpos, n * 6); q.toArray(bpos, n * 6 + 3); prev = q;
    }
    for (; n < BOLT_SEGS; n++) for (let k = 0; k < 6; k++) bpos[n * 6 + k] = 0;
    bgeo.attributes.position.needsUpdate = true;
  };

  const thunder = (a, delay, vol) => {
    try {
      const ac = a?.ctx, out = a?.out;
      if (!ac || !out) return;
      if (!auBuf) {
        const len = Math.floor(ac.sampleRate * 3);
        auBuf = ac.createBuffer(1, len, ac.sampleRate);
        const d = auBuf.getChannelData(0); let l = 0;
        for (let i = 0; i < len; i++) { l = l * 0.985 + (Math.random() * 2 - 1) * 0.15; d[i] = l * (0.5 + 0.5 * Math.sin(i / ac.sampleRate * 9)); }
      }
      const src = ac.createBufferSource(); src.buffer = auBuf;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140; lp.Q.value = 0.4;
      const g = ac.createGain();
      const now = ac.currentTime + delay;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(vol, now + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0005, now + 5.5);
      src.connect(lp); lp.connect(g); g.connect(out);
      src.start(now); src.stop(now + 6);
      thunders.push(src);
    } catch (e) { /* audio is optional */ }
  };

  return {
    update(dt, c) {
      t += dt;
      glow.position.copy(c.camera.position); bolt.position.copy(c.camera.position);
      let g = 0, bo = 0;
      for (const f of flashes) {
        const lt = t - f.t;
        if (lt < 0 || lt > 0.9) continue;
        if (cur !== f) {
          cur = f;
          dirFrom(f.az, f.el, _a).multiplyScalar(GLOW_R);
          glow.position.copy(c.camera.position).add(_a);
          glow.userData.f = f;
          if (f.bolt) setBolt(f);
          if (!f.done) { f.done = true; thunder(c.audio, rand(2.5, 6), 0.1 * f.size); }
        }
        // a couple of quick pulses, then a soft afterglow
        const pu = f.pulses;
        const pulse = Math.max(0, Math.sin(lt * pu * 2 * Math.PI / 0.45)) * (lt < 0.45 ? 1 : 0.3 * (1 - (lt - 0.45) / 0.45));
        g = Math.max(g, pulse * 0.8 + 0.2 * Math.exp(-lt * 4));
        if (f.bolt) bo = Math.max(bo, lt < 0.22 ? (Math.sin(lt * 60) > -0.4 ? 1 : 0.25) : 0);
      }
      const f = glow.userData.f;
      if (HOLD && f) g = 0.8;
      if (f) {
        dirFrom(f.az, f.el, _a).multiplyScalar(GLOW_R);
        glow.position.copy(c.camera.position).add(_a);
        glow.scale.set(60000 * f.size * (GLOW_R / (SKY_R * 1.05)), 22000 * f.size * (GLOW_R / (SKY_R * 1.05)), 1);
        glow.material.opacity = clamp(g, 0, 1) * 0.7;
      }
      bolt.material.opacity = bo * 0.9;
      glow.visible = bolt.visible = !c.inTunnel && (g > 0.001 || bo > 0 || (HOLD && !!f));
      return t < end;
    },
    dispose() {
      disposeObject(glow); disposeObject(bolt); tex.dispose();
      for (const s of thunders) { try { s.stop(); } catch (e) { /* already stopped */ } }
    },
  };
}

const lightning = {
  id: 'lightning', kind: 'random', label: 'lightning far off on the horizon', cooldown: 400, calm: false,
  possible: (c) => !c.inTunnel && (c.weatherId === 'overcast' || c.weatherId === 'rain' || (c.weatherId === 'clouds' && (c.night > 0.3 || (c.hours > 12 && c.elevDeg < 8)))),
  chance: (c) => (c.weatherId === 'clouds' ? 0.6 : 1),
  create: createLightning,
};

// ============================================================ 4. rainbow
const RB_SEG = 160;
const BANDS = [ // [inner angle, outer angle, peak alpha, reversed]
  [40.4 * D2R, 43.6 * D2R, 0.42, false],
  [50.2 * D2R, 54.0 * D2R, 0.15, true],
];
const SPECTRUM = [[0.55, 0.25, 0.95], [0.25, 0.4, 1.0], [0.3, 0.85, 0.5], [0.95, 0.9, 0.3], [1.0, 0.55, 0.2], [1.0, 0.22, 0.18]];
const RB_ROWS = 9;

function spectrum(t, out) {
  const x = clamp(t, 0, 1) * (SPECTRUM.length - 1), i = Math.min(Math.floor(x), SPECTRUM.length - 2), f = x - i;
  for (let k = 0; k < 3; k++) out[k] = lerp(SPECTRUM[i][k], SPECTRUM[i + 1][k], f);
}

let rainbowGeo = null, rainbowSeenRain = false;
function createRainbow(ctx) {
  if (!rainbowGeo) {
    const nv = BANDS.length * RB_ROWS * (RB_SEG + 1);
    const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 4);
    const idx = [];
    const rgb = [0, 0, 0];
    let v = 0;
    for (const [a0, a1, pk, rev] of BANDS) {
      const base = v;
      for (let r = 0; r < RB_ROWS; r++) {
        const tr = r / (RB_ROWS - 1), th = lerp(a0, a1, tr);
        spectrum(rev ? 1 - tr : tr, rgb);
        const al = Math.pow(Math.sin(Math.PI * tr), 1.1) * pk;
        for (let s = 0; s <= RB_SEG; s++, v++) {
          const ph = (s / RB_SEG) * Math.PI * 2;
          pos[v * 3] = Math.sin(th) * Math.cos(ph); pos[v * 3 + 1] = Math.sin(th) * Math.sin(ph); pos[v * 3 + 2] = Math.cos(th);
          col[v * 4] = rgb[0]; col[v * 4 + 1] = rgb[1]; col[v * 4 + 2] = rgb[2]; col[v * 4 + 3] = al;
        }
      }
      for (let r = 0; r < RB_ROWS - 1; r++) for (let s = 0; s < RB_SEG; s++) {
        const a = base + r * (RB_SEG + 1) + s, b = a + RB_SEG + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    rainbowGeo = new THREE.BufferGeometry();
    rainbowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rainbowGeo.setAttribute('aCol', new THREE.BufferAttribute(col, 4));
    rainbowGeo.setIndex(idx);
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOp: { value: 0 } },
    vertexShader: `attribute vec4 aCol; varying vec4 vC; varying float vH;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vH = normalize(wp.xyz - modelMatrix[3].xyz).y; vC = aCol; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float uOp; varying vec4 vC; varying float vH;
      void main(){ gl_FragColor = vec4(vC.rgb, vC.a * uOp * smoothstep(0.0, 0.07, vH)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const mesh = new THREE.Mesh(rainbowGeo, mat);
  mesh.scale.setScalar(SKY_R * 1.15);
  mesh.frustumCulled = false; mesh.renderOrder = SKY_ORDER;
  ctx.scene.add(mesh);
  rainbowSeenRain = false;
  const life = rand(100, 125);
  let t = 0;
  const Z = new THREE.Vector3(0, 0, 1);
  return {
    update(dt, c) {
      t += dt;
      mesh.position.copy(c.camera.position);
      _a.copy(c.sunDir).negate();
      mesh.quaternion.setFromUnitVectors(Z, _a);
      const sunOk = sstep(1, 4, c.elevDeg) * (1 - sstep(40, 46, c.elevDeg));
      const clear = 1 - sstep(0.3, 0.9, c.w?.cover ?? 0) * 0.5;
      mat.uniforms.uOp.value = Math.min(sstep(0, 10, t), sstep(life, life - 14, t)) * sunOk * clear * (1 - (c.w?.rain ?? 0));
      mesh.visible = !c.inTunnel;
      return t < life;
    },
    dispose() { mesh.parent?.remove(mesh); mat.dispose(); /* the geometry is shared and kept */ },
  };
}

const rainbow = {
  id: 'rainbow', kind: 'random', label: 'a rainbow after the rain', cooldown: 600,
  possible: (c) => {
    const w = c.w || {};
    if (w.rain > 0.5) rainbowSeenRain = true;
    if (c.inTunnel || !(c.elevDeg > 3 && c.elevDeg < 42)) return false;
    if (FORCE === 'rainbow') return true;
    return rainbowSeenRain && w.rain < 0.3 && w.wet > 0.4;
  },
  chance: () => 1,
  create: createRainbow,
};

// ============================================================ 5. contrail
const CT_N = 56;

function createContrail(ctx) {
  const nv = CT_N * 3;
  const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 4);
  const idx = [];
  for (let i = 0; i < CT_N - 1; i++) {
    const a = i * 3, b = a + 3;
    idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, skyMaterial());
  mesh.frustumCulled = false; mesh.renderOrder = SKY_ORDER;
  const ppos = new Float32Array(3), pcol = new Float32Array(3);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(ppos, 3).setUsage(THREE.DynamicDrawUsage));
  pg.setAttribute('color', new THREE.BufferAttribute(pcol, 3).setUsage(THREE.DynamicDrawUsage));
  const plane = new THREE.Points(pg, new THREE.PointsMaterial({ size: 2.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  plane.frustumCulled = false; plane.renderOrder = SKY_ORDER;
  ctx.scene.add(mesh); ctx.scene.add(plane);

  // a great circle through M, travelling along T
  const yaw0 = ctx.pose?.yaw ?? 0;
  const M = dirFrom(yaw0 + rand(-45, 45) * D2R, rand(36, 58) * D2R, new THREE.Vector3());
  const right = new THREE.Vector3().crossVectors(M, UP).normalize();
  const hz = new THREE.Vector3().crossVectors(UP, right).normalize();        // horizontal-ish tangent along the view axis
  const ang = rand(-28, 28) * D2R, sgn = Math.random() < 0.5 ? -1 : 1;
  const T = right.multiplyScalar(Math.cos(ang) * sgn).addScaledVector(hz, Math.sin(ang)).addScaledVector(M, 0).normalize();
  T.addScaledVector(M, -T.dot(M)).normalize();
  const OMEGA = rand(1.1, 1.5) * D2R, S0 = -rand(50, 58) * D2R, S1 = -S0, LIFE = rand(45, 60);
  const cross = (S1 - S0) / OMEGA;
  const total = cross + LIFE;
  let t = 0;

  const P = (s, out) => out.copy(M).multiplyScalar(Math.cos(s)).addScaledVector(T, Math.sin(s));
  const _T2 = new THREE.Vector3();
  const lerpC = (a, b, f) => a + (b - a) * f;

  return {
    update(dt, c) {
      t += dt;
      mesh.position.copy(c.camera.position); plane.position.copy(c.camera.position);
      mesh.visible = plane.visible = !c.inTunnel;
      const s = Math.min(S0 + OMEGA * t, S1), moving = S0 + OMEGA * t < S1;
      const sunset = sstep(12, 2, c.elevDeg);
      const light = sstep(-6, -1.5, c.elevDeg);         // the trail stays lit a little after the sun is down
      const day = 0.78 + 0.2 * sunset;                 // peak alpha
      for (let i = 0; i < CT_N; i++) {
        const f = i / (CT_N - 1);
        const back = Math.pow(f, 1.7) * Math.min(OMEGA * LIFE, s - S0);          // angular distance behind the plane
        const sk = s - back, age = back / OMEGA;
        P(sk, _c);
        _T2.copy(M).multiplyScalar(-Math.sin(sk)).addScaledVector(T, Math.cos(sk));
        _d.crossVectors(_c, _T2).normalize();
        const hw = SKY_R * (0.12 + 0.01 * age) * D2R;                         // half-width in metres
        const r0 = i * 3;
        for (let k = 0; k < 3; k++) {
          const sd = (k - 1) * hw;
          _b.copy(_c).multiplyScalar(SKY_R).addScaledVector(_d, sd);
          pos[(r0 + k) * 3] = _b.x; pos[(r0 + k) * 3 + 1] = _b.y; pos[(r0 + k) * 3 + 2] = _b.z;
        }
        const elev = Math.asin(clamp(_c.y, -1, 1));
        const base = sstep(0, 3.0, age) * Math.pow(Math.max(0, 1 - age / LIFE), 1.3) * sstep(3 * D2R, 9 * D2R, elev) * light * day * (1 - 0.6 * (c.w?.cover ?? 0));
        const pink = clamp(sunset * (0.55 + 0.45 * Math.min(age / 25, 1)), 0, 1);
        const r = lerpC(0.94, 1.0, pink), g = lerpC(0.95, 0.52, pink), b = lerpC(0.98, 0.46, pink);
        const dim = lerpC(1, 0.9, sunset);
        for (let k = 0; k < 3; k++) {
          const q = (r0 + k) * 4;
          col[q] = r * dim; col[q + 1] = g * dim; col[q + 2] = b * dim;
          col[q + 3] = base * (k === 1 ? 1 : 0.3);
        }
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      // the plane itself: a glint
      P(s, _c); _c.multiplyScalar(SKY_R);
      ppos[0] = _c.x; ppos[1] = _c.y; ppos[2] = _c.z;
      const pv = moving ? light * sstep(3 * D2R, 9 * D2R, Math.asin(clamp(_c.y / SKY_R, -1, 1))) * (1 - 0.6 * (c.w?.cover ?? 0)) : 0;
      pcol[0] = pv; pcol[1] = pv * lerpC(0.96, 0.7, sunset); pcol[2] = pv * lerpC(0.92, 0.55, sunset);
      pg.attributes.position.needsUpdate = true; pg.attributes.color.needsUpdate = true;
      return t < total;
    },
    dispose() { disposeObject(mesh); disposeObject(plane); },
  };
}

const contrail = {
  id: 'contrail', kind: 'random', cooldown: 400,
  label: (c) => (c.elevDeg < 10 ? 'a contrail turning pink in the sunset' : 'a jet drawing a line across the sky'),
  possible: (c) => !c.inTunnel && c.elevDeg > -4 && (c.w?.cover ?? 0) < 0.6 && (c.w?.rain ?? 0) < 0.05 && (c.w?.snow ?? 0) < 0.05,
  chance: (c) => (c.elevDeg < 10 ? 1.6 : 1),
  create: createContrail,
};

export const SKY_SURPRISES = [shootingStar, balloons, lightning, rainbow, contrail];
