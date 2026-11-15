// Synthesized ambience for Long Drive. Web Audio API only, no audio files.
// The AudioContext is created lazily in resume() (browser autoplay rules).

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const rnd = (a, b) => a + Math.random() * (b - a);

// How busy the birds are at a given game hour (0..1). A strong dawn chorus,
// a thin daytime song, a small evening burst, and silence at night.
export function birdDensity(h) {
  h = ((h % 24) + 24) % 24;
  const dawn = Math.exp(-(((h - 6.5) / 1.3) ** 2)) * smooth(4, 5.2, h);
  const day = 0.22 * smooth(6, 8, h) * (1 - smooth(17, 19.5, h));
  const eve = 0.3 * Math.exp(-(((h - 18) / 0.9) ** 2));
  return clamp(Math.max(dawn, day, eve), 0, 1);
}

// 1 in the dark hours, ramping down around dawn and up around dusk.
export function hourNight(h) {
  h = ((h % 24) + 24) % 24;
  return h < 12 ? 1 - smooth(4.5, 6.5, h) : smooth(19, 21, h);
}

export function makeNoiseBuffer(ctx, type, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (type === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  } else {
    // Paul Kellet's pink noise filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  // Short fades at the seam so the loop never clicks.
  const fade = Math.min(512, len >> 3);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    d[i] *= g;
    d[len - 1 - i] *= g;
  }
  return buf;
}

export class Ambience {
  constructor() {
    this._ctx = null;
    this._g = null;
    this._volume = 0.8;
    this._duck = 0;
    this._last = {
      mode: 'car', speed: 0, rain: 0, snow: 0, night: 0, paused: false,
      hours: undefined, kind: 'scenic', paved: false, wind: 0.3, fog: 0, inTunnel: false,
    };
    this._failed = false;
    this._fade = 1; // wind-down target (0..1), see setFade
    this._fadeNow = 1; // smoothed copy, for the `level` getter
    this._fadeTc = 1.3;
    this._gust = { v: 0, target: 0.3, until: 0 };
    this._next = { bird: 0, patter: 0, owl: 0, traffic: 0, crickets: [] };
    this._busyUntil = 0; // birds never overlap: end time of the current phrase
    this._live = 0; // short-lived rain nodes alive right now
    this._offline = false; // rendering into an OfflineAudioContext (scripts/bake-ambience.mjs)
    this._tcScale = 1; // scales every smoothing time constant (the baker sets it ~0 so levels are instant)
  }

  // Use an existing (Offline)AudioContext instead of creating one: the same graph then renders offline.
  attach(ctx, { offline = true, tcScale = 1 } = {}) {
    this._ctx = ctx;
    this._offline = offline;
    this._tcScale = tcScale;
    this._build();
  }

  // Master multiplier 0..1 for a sleep timer. Stacks with volume and duck.
  setFade(f, seconds = 4) {
    this._fade = clamp(num(f, 1), 0, 1);
    const sec = Math.max(0.05, num(seconds, 4));
    this._fadeTc = sec / 3; // ~95% of the way there after `seconds`
    if (this._g) this._set(this._g.fade.gain, this._fade, this._fadeTc);
  }

  get level() {
    return this._ctx ? this._fadeNow : this._fade;
  }

  get context() {
    return this._ctx;
  }

  setVolume(v) {
    this._volume = clamp(num(v, 0.8), 0, 1);
    this._applyMaster();
  }

  duck(amount) {
    this._duck = clamp(num(amount, 0), 0, 1);
    const g = this._g;
    if (!g) return;
    this._set(g.duck.gain, 1 - this._duck * 0.92, 0.35);
  }

  resume() {
    try {
      if (!this._ctx && !this._failed) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
          this._failed = true;
          return;
        }
        this._ctx = new AC({ latencyHint: 'playback' });
        try {
          this._build();
        } catch (e) {
          this._failed = true;
          this._g = null;
        }
      }
      if (this._ctx && this._ctx.state === 'suspended') {
        const p = this._ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) {
      this._failed = true;
    }
  }

  // ---- graph -------------------------------------------------------------

  _set(param, value, tc = 0.4) {
    const ctx = this._ctx;
    if (!ctx || !param) return;
    try {
      param.setTargetAtTime(value, ctx.currentTime, Math.max(1e-4, tc * this._tcScale));
    } catch (e) { /* ignore */ }
  }

  _applyMaster() {
    if (this._g) this._set(this._g.master.gain, this._volume * 0.9, 0.2);
  }

  _noiseSource(buf) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(0, Math.random() * buf.duration);
    return src;
  }

  _build() {
    const ctx = this._ctx;
    const gain = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const filter = (type, f, q = 0.707) => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      return n;
    };

    this._pink = makeNoiseBuffer(ctx, 'pink', 5);
    this._brown = makeNoiseBuffer(ctx, 'brown', 5);

    const master = gain(this._volume * 0.9);
    const pause = gain(1);
    const duck = gain(1 - this._duck * 0.92);
    const fade = gain(this._fade);
    const bus = gain(1);
    // Outdoor layers share one gain so a tunnel can hush them all at once.
    const outdoor = gain(1);
    outdoor.connect(bus);
    // Tunnel: the bus is low-passed, and a small reverb send adds the enclosed feel.
    const tunnelLP = filter('lowpass', 20000, 0.5);
    bus.connect(tunnelLP);
    tunnelLP.connect(duck);
    const sendLP = filter('lowpass', 1600, 0.5);
    const reverbSend = gain(0);
    const reverb = ctx.createConvolver();
    {
      const len = Math.floor(ctx.sampleRate * 1.6);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.35));
      }
      reverb.buffer = ir;
    }
    bus.connect(sendLP);
    sendLP.connect(reverbSend);
    reverbSend.connect(reverb);
    reverb.connect(duck);
    // `master` is the shared entry point (other code plugs sounds into it), so
    // everything flows master -> pause -> fade -> limiter -> speakers.
    duck.connect(master);
    master.connect(pause);
    pause.connect(fade);
    // gentle limiter so nothing ever peaks
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    comp.attack.value = 0.03;
    comp.release.value = 0.4;
    fade.connect(comp);
    comp.connect(ctx.destination);
    const pan = (p) => {
      const n = ctx.createStereoPanner();
      n.pan.value = p;
      return n;
    };

    // Engine: three gently detuned oscillators through two low-pass stages.
    const engineOut = gain(0);
    const engLP1 = filter('lowpass', 180, 0.5);
    const engLP2 = filter('lowpass', 260, 0.3);
    const oscs = [];
    const defs = [
      ['sawtooth', 1, -6, 0.3],
      ['sawtooth', 1, 7, 0.3],
      ['triangle', 0.5, 0, 0.5],
    ];
    for (const [type, mult, cents, level] of defs) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 40;
      o.detune.value = cents;
      const g = gain(level);
      o.connect(g);
      g.connect(engLP1);
      o.start();
      oscs.push({ o, mult });
    }
    // slow, tiny pitch drift keeps the hum alive without any buzz
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.23;
    const driftDepth = gain(6);
    drift.connect(driftDepth);
    for (const { o } of oscs) driftDepth.connect(o.detune);
    drift.start();
    engLP1.connect(engLP2);
    engLP2.connect(engineOut);
    engineOut.connect(bus);

    // Tyre roar: brown noise, low-passed.
    const tyreLP = filter('lowpass', 500, 0.4);
    const tyreOut = gain(0);
    this._noiseSource(this._brown).connect(tyreLP);
    tyreLP.connect(tyreOut);
    tyreOut.connect(bus);

    // Wind rush: pink noise band.
    const windBP = filter('bandpass', 700, 0.5);
    const windOut = gain(0);
    this._noiseSource(this._pink).connect(windBP);
    windBP.connect(windOut);
    windOut.connect(outdoor);

    // Breeze: always present, slowly breathing.
    const breezeBP = filter('bandpass', 1100, 0.4);
    const breezeOut = gain(0.012);
    this._noiseSource(this._pink).connect(breezeBP);
    breezeBP.connect(breezeOut);
    breezeOut.connect(outdoor);
    const breezeLfo = ctx.createOscillator();
    breezeLfo.frequency.value = 0.11;
    const breezeDepth = gain(0.005);
    breezeLfo.connect(breezeDepth);
    breezeDepth.connect(breezeOut.gain);
    breezeLfo.start();

    // Rain bed: hiss plus a duller body.
    const rainHP = filter('highpass', 1400, 0.5);
    const rainLP = filter('lowpass', 6500, 0.5);
    const rainOut = gain(0);
    this._noiseSource(this._pink).connect(rainHP);
    rainHP.connect(rainLP);
    rainLP.connect(rainOut);
    rainOut.connect(outdoor);
    const bodyLP = filter('lowpass', 420, 0.5);
    const bodyOut = gain(0);
    this._noiseSource(this._brown).connect(bodyLP);
    bodyLP.connect(bodyOut);
    bodyOut.connect(outdoor);

    // Wind in the trees: a soft band of noise plus high leaf rustle. Gusts are
    // driven from update() so they swell slowly and fade even more slowly.
    const treesBP = filter('bandpass', 450, 0.6);
    const treesOut = gain(0);
    this._noiseSource(this._pink).connect(treesBP);
    treesBP.connect(treesOut);
    treesOut.connect(outdoor);
    const leafHP = filter('highpass', 3200, 0.5);
    const leafLP = filter('lowpass', 7000, 0.5);
    const leafOut = gain(0);
    this._noiseSource(this._pink).connect(leafHP);
    leafHP.connect(leafLP);
    leafLP.connect(leafOut);
    leafOut.connect(outdoor);

    // One-shot layers each get a gain node (ramped slowly) into the outdoor group.
    const birdOut = gain(0);
    birdOut.connect(outdoor);
    const insectOut = gain(0);
    insectOut.connect(outdoor);
    const owlOut = gain(0.6);
    owlOut.connect(outdoor);
    const patterOut = gain(0);
    patterOut.connect(outdoor);
    const patterPans = [-0.6, 0, 0.6].map((p) => {
      const n = pan(p);
      n.connect(patterOut);
      return n;
    });
    const cricketPans = [-0.7, 0.1, 0.8].map((p) => {
      const n = pan(p);
      n.connect(insectOut);
      return n;
    });
    this._next.crickets = cricketPans.map((_, i) => ({
      t: 0, freq: 4300 + i * 190 + rnd(-40, 40), phase: Math.random() * 6.28, rate: rnd(0.9, 1.15),
    }));

    // City hum: very low, slowly swelling brown noise. Not part of "outdoor"
    // so a tunnel does not remove it entirely (it just sits under the bus filter).
    const humLP = filter('lowpass', 240, 0.5);
    const humOut = gain(0);
    this._noiseSource(this._brown).connect(humLP);
    humLP.connect(humOut);
    humOut.connect(bus);
    const humLfo = ctx.createOscillator();
    humLfo.frequency.value = 0.045;
    const humDepth = gain(0.006);
    humLfo.connect(humDepth);
    humDepth.connect(humOut.gain);
    humLfo.start();
    const trafficOut = gain(0);
    trafficOut.connect(bus);

    this._g = {
      master, pause, duck, bus,
      oscs, engLP1, engLP2, engineOut,
      tyreLP, tyreOut, windBP, windOut,
      breezeOut, breezeDepth, breezeBP,
      rainHP, rainLP, rainOut, bodyOut,
      fade, outdoor, tunnelLP, reverbSend,
      treesBP, treesOut, leafOut, birdOut, insectOut, owlOut, patterOut, patterPans,
      cricketPans, humOut, humDepth, trafficOut,
    };
    this._apply(this._last, 0.05);
  }

  // ---- per-frame ---------------------------------------------------------

  update(dt, s) {
    if (s && typeof s === 'object') this._last = s;
    if (!this._ctx || !this._g) return;
    const d = this._apply(this._last, 0.4);
    this._tick(clamp(num(dt, 0.016), 0, 0.25), d);
  }

  _apply(s, tc) {
    const g = this._g;
    if (!g) return null;
    const mode = s.mode === 'horse' || s.mode === 'walk' ? s.mode : 'car';
    const car = mode === 'car';
    const speed = clamp(num(s.speed), 0, 60);
    const rain = clamp(num(s.rain), 0, 1);
    const snow = clamp(num(s.snow), 0, 1);
    const night = clamp(num(s.night), 0, 1);
    const wind = clamp(num(s.wind, 0.3), 0, 1);
    const fog = clamp(num(s.fog), 0, 1);
    const hasHours = typeof s.hours === 'number' && isFinite(s.hours);
    const city = s.kind === 'city' || !!s.paved;
    const scenic = !city && s.kind !== 'circuit';
    const tunnel = !!s.inTunnel;
    const sn = clamp(speed / 30, 0, 1.4);
    const sq = sn * sn;

    this._set(g.pause.gain, s.paused ? 0 : 1, s.paused ? 0.15 : 0.3);

    // Tunnel: outdoor layers drop away, the bus loses its top end, a little
    // reverb makes it feel enclosed.
    this._set(g.outdoor.gain, tunnel ? 0.22 : 1, 1.2);
    this._set(g.tunnelLP.frequency, tunnel ? 1700 : 20000, tunnel ? 0.6 : 1.0);
    this._set(g.reverbSend.gain, tunnel ? 0.5 : 0, 1.2);
    const tun = tunnel ? 1.3 : 1;

    // Engine: a soft, low purr
    const base = 36 + Math.min(speed, 40) * 1.3;
    for (const { o, mult } of g.oscs) this._set(o.frequency, base * mult, tc);
    this._set(g.engLP1.frequency, 120 + Math.min(speed, 40) * 3.5, tc);
    this._set(g.engLP2.frequency, 170 + Math.min(speed, 40) * 5, tc);
    this._set(g.engineOut.gain, car ? (0.06 + Math.min(sn, 1.3) * 0.05) * tun : 0, 0.8);

    // Tyres and wind (snow muffles them a little)
    const muffle = 1 - snow * 0.35;
    this._set(g.tyreLP.frequency, 360 + speed * 14, tc);
    this._set(g.tyreOut.gain, car ? sq * 0.045 * muffle * tun : 0, 0.8);
    this._set(g.windBP.frequency, 550 + speed * 22, tc);
    this._set(g.windOut.gain, car ? sq * 0.022 * muffle : 0, 0.8);

    // Breeze
    const breeze = car ? 0.008 + sn * 0.004 : 0.016 + snow * 0.006;
    this._set(g.breezeOut.gain, breeze, 1.5);
    this._set(g.breezeDepth.gain, breeze * 0.4, 1.5);

    // Rain bed
    this._set(g.rainLP.frequency, car ? 2300 : 6500, 0.8);
    this._set(g.rainOut.gain, rain * (car ? 0.035 : 0.05), 1.5);
    this._set(g.bodyOut.gain, rain * (car ? 0.04 : 0.022), 1.5);
    this._set(g.patterOut.gain, rain * (car ? 1 : 0.6), 1.5);

    // Wind in the trees (gust level comes from _tick)
    const windBase = (0.2 + 0.8 * wind) * (1 + sn * 0.3) * (city ? 0.25 : 1);
    const gv = this._gust.v;
    this._set(g.treesBP.frequency, 380 + 330 * gv + wind * 150, 1.5);
    this._set(g.treesOut.gain, windBase * 0.03 * (0.3 + 0.7 * gv), 1.5);
    this._set(g.leafOut.gain, windBase * 0.012 * gv * gv, 1.5);

    // Birds: quieter when the car's own wind masks them, none in heavy rain
    const weather = clamp(1 - rain * 1.6, 0, 1) * (1 - 0.4 * fog) * (1 - 0.7 * snow);
    const aud = car ? clamp(1 - speed / 25, 0.15, 1) : 1;
    this._set(g.birdOut.gain, weather * aud * 0.5, 2.5);
    const dens = hasHours ? birdDensity(s.hours) : (1 - night) * 0.3;

    // Crickets: night only, none in rain, snow or thick mist, far fewer in town
    const nightAmt = hasHours ? Math.min(night + 0.0, 1) * hourNight(s.hours) : night;
    const cold = (1 - rain) * (1 - snow) * (1 - fog * 0.7);
    const insects = nightAmt * cold * (city ? 0.12 : 1) * (car ? 0.6 * clamp(1 - speed / 40, 0.3, 1) : 1);
    this._set(g.insectOut.gain, insects, 3);

    // City hum and distant traffic swells; quieter at night
    const cityAmt = city ? 1 - 0.5 * night : 0;
    this._set(g.humOut.gain, cityAmt * 0.03, 3);
    this._set(g.humDepth.gain, cityAmt * 0.008, 3);
    this._set(g.trafficOut.gain, cityAmt, 3);

    return { car, rain, snow, wind, fog, city, scenic, tunnel, weather, dens, insects, cityAmt, speed };
  }

  // ---- scheduled layers (called every frame, create short-lived nodes) ------

  _tick(dt, d) {
    const ctx = this._ctx;
    // smoothed fade value for the `level` getter
    this._fadeNow += (this._fade - this._fadeNow) * Math.min(1, dt / Math.max(0.05, this._fadeTc));
    if (!d || !this._ready() || this._last.paused) return;
    const now = ctx.currentTime;
    const n = this._next;

    // Gusts: pick a new strength every 5-17 s; rise in ~3 s, fall in ~7 s.
    const gu = this._gust;
    gu.until -= dt;
    if (gu.until <= 0) {
      gu.target = Math.pow(Math.random(), 1.6);
      gu.until = rnd(5, 17);
    }
    gu.v += (gu.target - gu.v) * Math.min(1, dt / (gu.target > gu.v ? 3 : 7));

    try {
      this._tickBirds(now, d, n);
      this._tickCrickets(now, d, n);
      this._tickOwl(now, d, n);
      this._tickRain(now, d, n);
      this._tickTraffic(now, d, n);
    } catch (e) { /* audio must never break the game */ }
  }

  _tickBirds(now, d, n) {
    if (!n.bird) n.bird = now + rnd(2, 6);
    if (now < n.bird) return;
    const dens = d.dens * d.weather * (d.city ? 0.35 : 1);
    if (dens < 0.03 || d.tunnel || now < this._busyUntil) {
      n.bird = now + rnd(3, 8);
      return;
    }
    const dur = this._birdPhrase(now + 0.05, d.city);
    this._busyUntil = now + 0.05 + dur + 0.4;
    n.bird = this._busyUntil + (36 - 32 * dens) * rnd(0.5, 1.5);
  }

  // One short bird phrase, panned and distance-softened. Returns its length.
  _birdPhrase(t, sparrow) {
    const ctx = this._ctx;
    const dist = Math.random();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000 - 6000 * dist;
    const pn = ctx.createStereoPanner();
    pn.pan.value = rnd(-0.85, 0.85);
    lp.connect(pn);
    pn.connect(this._g.birdOut);
    const level = 0.05 * (1 - 0.7 * dist);
    let left = 0;
    let end = 0;
    const note = (at, f0, f1, len, peak, fm) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(f1, at + len);
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, at);
      gn.gain.linearRampToValueAtTime(peak, at + Math.min(0.012, len * 0.3));
      gn.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(gn);
      gn.connect(lp);
      let mod = null;
      let md = null;
      if (fm) {
        mod = ctx.createOscillator();
        mod.frequency.value = fm.rate;
        md = ctx.createGain();
        md.gain.value = fm.depth;
        mod.connect(md);
        md.connect(o.frequency);
        mod.start(at);
        mod.stop(at + len + 0.05);
      }
      left++;
      end = Math.max(end, at + len);
      o.onended = () => {
        try { o.disconnect(); gn.disconnect(); if (mod) { mod.disconnect(); md.disconnect(); } } catch (e) { /* ignore */ }
        if (--left === 0) { try { lp.disconnect(); pn.disconnect(); } catch (e) { /* ignore */ } }
      };
      o.start(at);
      o.stop(at + len + 0.05);
    };

    const kind = sparrow ? 3 : Math.floor(Math.random() * 3);
    if (kind === 0) {
      // descending whistle
      let f = rnd(3000, 4200);
      const count = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        note(t + i * 0.22, f, f * 0.84, 0.18, level);
        f *= 0.92;
      }
    } else if (kind === 1) {
      // quick trill with a wobble
      const f = rnd(3400, 4800);
      const count = 6 + Math.floor(Math.random() * 5);
      for (let i = 0; i < count; i++) {
        note(t + i * 0.055, f, f * 1.08, 0.045, level * 0.8, { rate: 70, depth: 120 });
      }
    } else if (kind === 2) {
      // two-tone call, repeated
      const f = rnd(2600, 3400);
      const reps = 1 + Math.floor(Math.random() * 2);
      for (let r = 0; r < reps; r++) {
        note(t + r * 0.55, f, f * 1.02, 0.2, level);
        note(t + r * 0.55 + 0.25, f * 1.26, f * 1.24, 0.2, level);
      }
    } else {
      // sparrow-like short chirps
      let at = t;
      const count = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const f = rnd(2400, 3500);
        note(at, f, f * rnd(0.9, 1.15), 0.06, level * 0.8);
        at += rnd(0.1, 0.22);
      }
    }
    return end - t;
  }

  _tickCrickets(now, d, n) {
    if (d.insects < 0.02) return;
    n.crickets.forEach((c, i) => {
      if (now + 0.25 < c.t) return;
      if (c.t < now) c.t = now + rnd(0.05, 0.4);
      // each individual swells in and out on its own slow cycle, so it rests now and then
      const swell = 0.5 + 0.5 * Math.sin(now * 0.07 * c.rate + c.phase);
      if (swell > 0.3 && c.t - now < 0.25) this._cricketGroup(c.t, c, swell, this._g.cricketPans[i]);
      c.t += (0.5 + Math.random() * 0.5) / c.rate;
    });
  }

  _cricketGroup(t, c, swell, dest) {
    const ctx = this._ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = c.freq * (1 + rnd(-0.004, 0.004));
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0, t);
    const pulses = 3 + Math.floor(Math.random() * 2);
    const peak = 0.01 * (0.3 + 0.7 * swell);
    for (let k = 0; k < pulses; k++) {
      const at = t + k * 0.075;
      gn.gain.linearRampToValueAtTime(peak, at + 0.012);
      gn.gain.linearRampToValueAtTime(0, at + 0.045);
    }
    o.connect(gn);
    gn.connect(dest);
    const end = t + pulses * 0.075 + 0.05;
    o.start(t);
    o.stop(end);
    o.onended = () => { try { o.disconnect(); gn.disconnect(); } catch (e) { /* ignore */ } };
  }

  // A very rare, very soft owl on quiet scenic nights.
  _tickOwl(now, d, n) {
    if (!n.owl) n.owl = now + rnd(60, 240);
    if (now < n.owl || !d.scenic || d.tunnel || d.insects < 0.4) return;
    const ctx = this._ctx;
    const pn = ctx.createStereoPanner();
    pn.pan.value = rnd(-0.8, 0.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    lp.connect(pn);
    pn.connect(this._g.owlOut);
    const f = rnd(380, 420);
    const t = now + 0.05;
    const notes = [[0, f], [0.75, f * 0.88]];
    notes.forEach(([dt, fr], i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr;
      const gn = ctx.createGain();
      const at = t + dt;
      gn.gain.setValueAtTime(0.0001, at);
      gn.gain.linearRampToValueAtTime(0.012, at + 0.12);
      gn.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
      o.connect(gn);
      gn.connect(lp);
      o.start(at);
      o.stop(at + 0.7);
      o.onended = () => {
        try { o.disconnect(); gn.disconnect(); if (i === 1) { lp.disconnect(); pn.disconnect(); } } catch (e) { /* ignore */ }
      };
    });
    n.owl = now + rnd(150, 420);
  }

  // Soft droplet patter: tiny filtered ticks, random pitch and level.
  _tickRain(now, d, n) {
    const rate = d.rain * (d.car ? 22 : 14);
    if (d.rain < 0.03 || d.tunnel) { n.patter = 0; return; }
    if (n.patter < now) n.patter = now + 0.02;
    let guard = 0;
    while (n.patter < now + 0.15 && guard++ < 12) {
      if (this._live < 24) {
        const pan = this._g.patterPans[Math.floor(Math.random() * 3)];
        this._live++;
        this._burst({
          buf: this._pink, type: 'bandpass',
          freq: d.car ? rnd(1800, 5200) : rnd(1100, 3200), q: 2.5,
          peak: rnd(0.008, 0.028), attack: 0.002, decay: rnd(0.02, 0.05),
          when: n.patter, dest: pan, done: () => { this._live--; },
        });
      }
      n.patter += -Math.log(1 - Math.random()) / rate;
    }
  }

  // Distant traffic: a low noise swell rising and falling over 4-8 s.
  _tickTraffic(now, d, n) {
    if (!n.traffic) n.traffic = now + rnd(4, 12);
    if (now < n.traffic) return;
    n.traffic = now + rnd(12, 30);
    if (d.cityAmt < 0.1) return;
    const half = rnd(2, 4);
    this._burst({
      buf: this._brown, type: 'bandpass', freq: rnd(140, 300), q: 0.6,
      peak: rnd(0.02, 0.04), attack: half, decay: half * rnd(1, 1.4),
      when: now + 0.05, dest: this._g.trafficOut,
    });
  }

  // ---- one-shots ---------------------------------------------------------

  _ready() {
    return this._ctx && this._g && (this._offline || this._ctx.state === 'running');
  }

  _burst({ buf, type, freq, q, peak, attack, decay, when, dest, done }) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    const end = when + attack + decay + 0.05;
    src.start(when, Math.random() * Math.max(0.1, buf.duration - 1));
    src.stop(end);
    src.onended = () => {
      try { g.disconnect(); f.disconnect(); src.disconnect(); } catch (e) { /* ignore */ }
      if (done) done();
    };
  }

  step(kind) {
    if (!this._ready()) return;
    try {
      const ctx = this._ctx;
      const t = ctx.currentTime + 0.005;
      const dest = this._g.duck;
      if (kind === 'hoof') {
        const v = 0.85 + Math.random() * 0.3;
        this._burst({ buf: this._brown, type: 'bandpass', freq: 320 * v, q: 1.4, peak: 0.24, attack: 0.003, decay: 0.07, when: t, dest });
        this._burst({ buf: this._pink, type: 'bandpass', freq: 1400 * v, q: 1.0, peak: 0.045, attack: 0.002, decay: 0.03, when: t, dest });
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(150 * v, t);
        o.frequency.exponentialRampToValueAtTime(58, t + 0.1);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
        o.connect(g);
        g.connect(dest);
        o.start(t);
        o.stop(t + 0.16);
        o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) { /* ignore */ } };
      } else {
        // gravel crunch: a few tiny grains and a soft thud
        const grains = 4 + Math.floor(Math.random() * 4);
        for (let i = 0; i < grains; i++) {
          this._burst({
            buf: this._pink, type: 'bandpass',
            freq: 1800 + Math.random() * 2600, q: 0.8,
            peak: 0.03 + Math.random() * 0.03,
            attack: 0.002, decay: 0.012 + Math.random() * 0.02,
            when: t + Math.random() * 0.13, dest,
          });
        }
        this._burst({ buf: this._brown, type: 'lowpass', freq: 220, q: 0.7, peak: 0.07, attack: 0.004, decay: 0.09, when: t, dest });
      }
    } catch (e) { /* ignore */ }
  }

  radioStatic(seconds) {
    if (!this._ready()) return;
    try {
      const ctx = this._ctx;
      const dur = clamp(num(seconds, 1.5), 0.3, 12);
      const t = ctx.currentTime + 0.02;
      const src = this._noiseSource(this._pink);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.linearRampToValueAtTime(2600, t + dur * 0.4);
      bp.frequency.linearRampToValueAtTime(1500, t + dur);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp);
      bp.connect(lp);
      lp.connect(g);
      g.connect(this._g.master);

      // faint tuning whistle at the start
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(1150, t + Math.min(0.7, dur * 0.5));
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime(0.006, t + 0.15);
      og.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.8, dur * 0.6));
      o.connect(og);
      og.connect(this._g.master);
      o.start(t);
      o.stop(t + 1);

      src.stop(t + dur + 0.1);
      src.onended = () => {
        try { src.disconnect(); bp.disconnect(); lp.disconnect(); g.disconnect(); } catch (e) { /* ignore */ }
      };
    } catch (e) { /* ignore */ }
  }
}
