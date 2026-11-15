// Long Drive UI layer: start screen, HUD, settings drawer, radio card, fade.
export const STORE_KEY = 'longdrive.settings';
const $ = (id) => document.getElementById(id);

export function timeLabel(hours) {
  let h = ((hours % 24) + 24) % 24;
  let total = Math.round(h * 60);
  if (total >= 1440) total = 0;
  const hh = Math.floor(total / 60), mm = total % 60;
  const ap = hh < 12 ? 'am' : 'pm';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}
export function timeDescriptor(hours) {
  const h = ((hours % 24) + 24) % 24;
  if (h < 4.5) return 'night';
  if (h < 6) return 'first light';
  if (h < 7.5) return 'sunrise light';
  if (h < 11) return 'morning';
  if (h < 14) return 'midday';
  if (h < 17) return 'afternoon';
  if (h < 18.5) return 'golden hour';
  if (h < 19.5) return 'sunset';
  if (h < 21) return 'dusk';
  return 'night';
}
export const friendlyTime = (h) => `${timeLabel(h)} · ${timeDescriptor(h)}`;

export class UI {
  constructor(opts) {
    this.opts = opts;
    this.onStart = null;
    this.onChange = null;
    this.onRadio = null;
    this._started = false;
    this._refreshers = [];
    this._draggingHours = false;
    this._hud = {};
    this._radioInfo = {};

    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { saved = {}; }
    const s = Object.assign({}, opts.settings, saved);
    if (s.weather === 'drift') s.weather = 'any'; // (earlier versions' "ever-changing")
    // validate against runtime options
    if (s.stop !== -1 && !(s.stop >= 0 && s.stop < opts.stops.length)) s.stop = opts.settings.stop || 0;
    if (!opts.rides[s.ride]) s.ride = opts.settings.ride;
    s.weather = 'any'; // (no longer chosen on the start screen: the drive begins in whatever the sky brings)
    if (!opts.stations.some((x) => x.id === s.station)) s.station = opts.settings.station;
    if (typeof s.hours !== 'number' || isNaN(s.hours)) s.hours = opts.settings.hours;
    this.settings = s;

    this.el = {
      start: $('start'), hud: $('hud'), drawer: $('drawer'), fade: $('fade'), toast: $('toast'),
    };
    this._buildGroups($('start-groups'), 'start');
    this._buildGroups($('drawer-groups'), 'drawer');
    this._buildCam();
    this._buildRadioChips();
    this._bindStatic();
    this._bindIdle();
    this._refreshers.push(() => document.getElementById('ui')?.classList.toggle('quiet', !!this.settings.quiet));
    this._refreshAll();
    if ($('start-route') && opts.route) $('start-route').textContent = opts.route;
  }

  get started() { return this._started; }
  get drawerOpen() { return this.el.drawer.classList.contains('open'); }

  // ---------- persistence / change plumbing ----------
  _save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.settings)); } catch (e) { /* ignore */ }
  }
  _change(key, value) {
    this.settings[key === 'jump' ? 'stop' : key] = value;
    this._save();
    this._refreshAll();
    if (this.onChange) this.onChange(key, value, this.settings);
  }
  set(key, value) {
    this.settings[key] = value;
    if (key === 'hours' && this._draggingHours) return;
    this._refreshAll();
  }
  _refreshAll() { for (const f of this._refreshers) f(); }
  // the endless drive has moved on to another place: its stops replace the old ones in the drawer
  setPlace({ place, stops }) {
    this.opts.place = place; this.opts.stops = stops;
    this.settings.stop = 0;
    const root = document.getElementById('drawer-groups');
    if (root) { root.innerHTML = ''; this._buildGroups(root, 'drawer'); } // (the old chips' refreshers now update detached buttons: harmless)
    this._refreshAll();
  }

  // ---------- builders ----------
  _chip(label, onClick, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    if (title) b.title = title;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => { onClick(); b.blur(); });
    return b;
  }
  _group(root, label, extraClass) {
    const g = document.createElement('div');
    g.className = 'group';
    const l = document.createElement('div');
    l.className = 'label';
    l.textContent = label;
    const body = document.createElement('div');
    body.className = extraClass || 'chips';
    body.setAttribute('role', 'group');
    body.setAttribute('aria-label', label);
    g.append(l, body);
    root.appendChild(g);
    return body;
  }
  _chipGroup(body, items, getCurrent, onPick) {
    const btns = items.map(({ value, label, title }) => {
      const b = this._chip(label, () => onPick(value), title);
      b._value = value;
      body.appendChild(b);
      return b;
    });
    this._refreshers.push(() => {
      const cur = getCurrent();
      for (const b of btns) b.setAttribute('aria-pressed', String(b._value === cur));
    });
  }

  // The start screen asks only where and at what hour to begin, how to travel and what music to bring
  // (two switches below the music: wind down and interleave). After that the drive goes on by itself
  // (time flows, the weather drifts, and with interleave on, place follows place through tunnels).
  // The settings drawer holds what can be changed on the way: the ride and the radio.
  _buildGroups(root, mode) {
    const o = this.opts;
    if (mode === 'start') {
      if (o.places && o.places.length > 1) {
        const pBody = this._group(root, 'Start in');
        this._chipGroup(pBody, o.places.map((pl) => ({ value: pl.id, label: pl.short || pl.name, title: [pl.name, pl.region].filter(Boolean).join(' · ') })),
          () => o.place, (id) => { if (id !== o.place && this.onChange) this.onChange('place', id, this.settings); });
      }
      this._buildTime(root);
      const rideBody = this._group(root, 'Travel by', 'chips rides');
      this._chipGroup(rideBody, Object.entries(o.rides).map(([id, r]) => ({ value: id, label: r.label })),
        () => this.settings.ride, (v) => this._change('ride', v));
      const sw = $('start-switches');
      if (sw) {
        this._toggle(sw, 'Wind down after an hour', 'The car eases its pace, night falls and the music fades away over 60 minutes; then the drive carries on quietly through the night.',
          () => (this.settings.windDown || 0) > 0, (on) => this._change('windDown', on ? 60 : 0));
        this._buildInterleave(sw);
      }
      return;
    }
    this._buildCalm(root);
    const rideBody = this._group(root, 'Travel by', 'chips rides');
    this._chipGroup(rideBody, Object.entries(o.rides).map(([id, r]) => ({ value: id, label: r.label })),
      () => this.settings.ride, (v) => this._change('ride', v));
    const rBody = this._group(root, 'Radio');
    this._chipGroup(rBody, o.stations.map((s) => ({ value: s.id, label: s.name, title: s.tagline })),
      () => this.settings.station, (v) => this._change('station', v));
  }

  // Wind down: over the chosen time the drive eases, night falls and the music fades away; then it
  // carries on quietly through the night. Quiet mode: music and the road only, no voice, no messages.
  _buildCalm(root) {
    const wBody = this._group(root, 'Wind down');
    this._chipGroup(wBody, [{ value: 0, label: 'Off' }, { value: 30, label: '30 min' }, { value: 60, label: '60 min' }, { value: 90, label: '90 min' }],
      () => this.settings.windDown || 0, (v) => this._change('windDown', v));
    const note = document.createElement('p');
    note.className = 'group-note';
    note.textContent = 'Over this time the car eases its pace, night falls and the music fades away. Then the drive carries on quietly through the night.';
    wBody.parentNode.appendChild(note);
    const g = document.createElement('div');
    g.className = 'group';
    const tog = document.createElement('button');
    tog.type = 'button';
    tog.className = 'toggle';
    tog.setAttribute('role', 'switch');
    tog.innerHTML = '<span class="box"></span><span>Quiet mode</span>';
    const qn = document.createElement('p');
    qn.className = 'group-note';
    qn.textContent = 'Just the music and the road: no announcer, no messages, no camera moments, nothing on screen.';
    g.append(tog, qn);
    root.appendChild(g);
    tog.addEventListener('click', () => { this._change('quiet', !this.settings.quiet); tog.blur(); });
    this._refreshers.push(() => tog.setAttribute('aria-checked', String(!!this.settings.quiet)));
  }

  _toggle(root, label, noteText, get, set) {
    const g = document.createElement('div');
    g.className = 'group';
    const tog = document.createElement('button');
    tog.type = 'button';
    tog.className = 'toggle';
    tog.setAttribute('role', 'switch');
    tog.innerHTML = '<span class="box"></span><span></span>';
    tog.lastChild.textContent = label;
    g.append(tog);
    if (noteText) { const n = document.createElement('p'); n.className = 'group-note'; n.textContent = noteText; g.append(n); }
    root.appendChild(g);
    tog.addEventListener('click', () => { set(!get()); tog.blur(); });
    this._refreshers.push(() => tog.setAttribute('aria-checked', String(!!get())));
  }

  // on: a tunnel every 4-5 km to a random point in another place; off: round and round the one place
  _buildInterleave(root) {
    if ((this.opts.places || []).length < 2) return;
    this._toggle(root, 'Interleave places', 'Every 4 to 5 km a tunnel takes you to a random spot in another place. Off: you stay here, going round and round.',
      () => !!this.settings.interleave, (on) => this._change('interleave', on));
  }

  _buildTime(root) {
    const tg = document.createElement('div');
    tg.className = 'group';
    const lab = document.createElement('div');
    lab.className = 'label';
    lab.textContent = 'Starting time';
    const row = document.createElement('div');
    row.className = 'time-row';
    const tl = document.createElement('span');
    tl.className = 'time-label';
    row.append(tl);
    const rng = document.createElement('input');
    rng.type = 'range'; rng.className = 'range';
    rng.min = '0'; rng.max = '24'; rng.step = '0.25';
    rng.setAttribute('aria-label', 'Starting time');
    tg.append(lab, row, rng);
    root.appendChild(tg);
    rng.addEventListener('input', () => {
      const v = parseFloat(rng.value);
      this.settings.hours = v;
      tl.textContent = friendlyTime(v);
      this._save();
      if (this.onChange) this.onChange('hours', v, this.settings);
    });
    rng.addEventListener('pointerup', () => rng.blur());
    this._refreshers.push(() => {
      tl.textContent = friendlyTime(this.settings.hours);
      if (document.activeElement !== rng) rng.value = String(this.settings.hours);
    });
  }

  _buildCam() {
    const body = $('drawer-cam');
    this._chipGroup(body, [{ value: 'seat', label: 'Seat' }, { value: 'chase', label: 'Chase' }],
      () => this.settings.cam, (v) => this._change('cam', v));
  }

  _buildRadioChips() {
    const body = $('hud-stations');
    this._chipGroup(body, this.opts.stations.map((s) => ({ value: s.id, label: s.name, title: s.tagline })),
      () => this.settings.station, (v) => this._change('station', v));
  }

  _bindRange(el, key) {
    el.value = String(this.settings[key] ?? 0);
    el.addEventListener('input', () => {
      this.settings[key] = parseFloat(el.value);
      this._save();
      if (this.onChange) this.onChange(key, this.settings[key], this.settings);
    });
    el.addEventListener('pointerup', () => el.blur());
    this._refreshers.push(() => { if (document.activeElement !== el) el.value = String(this.settings[key] ?? 0); });
  }

  _bindStatic() {
    $('begin').addEventListener('click', () => {
      $('begin').blur();
      const list = ($('start-playlist')?.value || '').trim();
      this._begin();
      if (list && this.onRadio) this.onRadio('custom', list);
    });
    $('settings-btn').addEventListener('click', (e) => { e.currentTarget.blur(); this._toggleDrawer(); });
    // back to the start screen: a fresh page (settings and the last place are remembered), without test params
    $('home-btn')?.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); location.href = location.pathname; });
    $('drawer-close').addEventListener('click', (e) => { e.currentTarget.blur(); this._toggleDrawer(false); });
    this._bindRange($('ambience'), 'ambience');
    this._bindRange($('radio-volume'), 'music');
    const ta = $('custom-text'), sp = $('start-playlist');
    ta.value = this.settings.customText || '';
    ta.addEventListener('input', () => { this.settings.customText = ta.value; this._save(); });
    // the start screen's playlist box is the same "My Station" list
    if (sp) {
      sp.value = this.settings.customText || '';
      sp.addEventListener('input', () => { this.settings.customText = ta.value = sp.value; this._save(); });
    }
    $('custom-go').addEventListener('click', (e) => {
      e.currentTarget.blur();
      if (this.onRadio) this.onRadio('custom', ta.value);
    });
    $('radio-toggle').addEventListener('click', (e) => { e.currentTarget.blur(); if (this.onRadio) this.onRadio('toggle'); });
    $('radio-next').addEventListener('click', (e) => { e.currentTarget.blur(); if (this.onRadio) this.onRadio('next'); });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._started && !document.body.classList.contains('demo')) { // (the demo has no settings)
        e.preventDefault();
        this._toggleDrawer();
      }
    });
  }

  _begin() {
    if (this._started) return;
    this._started = true;
    this.el.start.classList.add('gone');
    this.el.start.setAttribute('aria-hidden', 'true');
    this.el.start.inert = true;
    this.el.hud.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => this.el.hud.classList.add('show')));
    this._poke();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (this.onStart) this.onStart();
  }

  _toggleDrawer(force) {
    const open = force === undefined ? !this.drawerOpen : force;
    const d = this.el.drawer;
    d.classList.toggle('open', open);
    d.setAttribute('aria-hidden', String(!open));
    d.inert = !open;
    $('settings-btn').setAttribute('aria-expanded', String(open));
    if (!open && document.activeElement && d.contains(document.activeElement)) document.activeElement.blur();
    this._poke();
  }

  // ---------- idle fade ----------
  _bindIdle() {
    const poke = () => this._poke();
    window.addEventListener('mousemove', poke, { passive: true });
    window.addEventListener('keydown', poke);
    window.addEventListener('pointerdown', poke, { passive: true });
  }
  _poke() {
    if (!this._started) return;
    this.el.hud.classList.remove('idle');
    clearTimeout(this._idleT);
    this._idleT = setTimeout(() => {
      if (!this.drawerOpen) this.el.hud.classList.add('idle');
      else this._poke();
    }, 4000);
  }

  // ---------- runtime updates ----------
  setLoading(fraction, text) {
    const el = $('loading');
    const f = Math.max(0, Math.min(1, fraction || 0));
    if (f >= 1) { el.classList.add('done'); return; }
    el.classList.remove('done');
    $('loading-fill').style.width = `${Math.round(f * 100)}%`;
    const t = `${text || 'Preparing the landscape…'} ${Math.round(f * 100)}%`;
    if (this._loadText !== t) { this._loadText = t; $('loading-text').textContent = t; }
  }

  setHud({ kmh, place, km, totalKm, hours } = {}) {
    const h = this._hud;
    const set = (key, val, el, fmt) => {
      if (val === undefined || h[key] === val) return;
      h[key] = val;
      el.textContent = fmt ? fmt(val) : val;
    };
    if (kmh !== undefined) {
      const k = Math.round(Math.abs(kmh));
      set('kmh', k, this._e('hud-kmh'));
      set('mph', Math.round(Math.abs(kmh) * 0.621371), this._e('hud-mph'));
    }
    if (place !== undefined) set('place', place || '—', this._e('hud-place'));
    if (km !== undefined || totalKm !== undefined) {
      const kk = km !== undefined ? km : h.kmRaw;
      const tt = totalKm !== undefined ? totalKm : h.totalRaw;
      h.kmRaw = kk; h.totalRaw = tt;
      const txt = `km ${(kk || 0).toFixed(1)} of ${(tt || 0).toFixed(1)}`;
      set('kmTxt', txt, this._e('hud-km'));
    }
    if (hours !== undefined) set('timeTxt', timeLabel(hours), this._e('hud-time'));
  }
  _e(id) { return (this._els ||= {})[id] ||= $(id); }

  setRadio(info = {}) {
    const r = Object.assign(this._radioInfo, info);
    const set = (key, val, id) => {
      if (this._hud['r' + key] === val) return;
      this._hud['r' + key] = val;
      this._e(id).textContent = val;
    };
    set('name', r.stationName || 'Radio', 'radio-station');
    set('title', r.title || '—', 'radio-title');
    set('artist', r.artist || '', 'radio-artist');
    const st = r.state || 'loading';
    let line = '';
    if (st === 'announcer') line = r.line || 'On air';
    else if (st === 'playing') line = 'On air';
    else if (st === 'paused') line = 'Paused';
    else if (st === 'error') line = 'Signal lost, try next';
    else line = 'Tuning in…';
    set('line', line, 'radio-line');
    const stateEl = this._e('radio-state');
    if (this._hud.rstate !== st) {
      this._hud.rstate = st;
      stateEl.dataset.state = st;
      this._e('radio-toggle').classList.toggle('paused', st === 'paused' || st === 'error');
    }
    if (r.stationId && r.stationId !== this.settings.station) {
      this.settings.station = r.stationId;
      this._refreshAll();
    }
  }

  fade(on, caption) {
    const f = this.el.fade;
    const cap = $('fade-caption');
    if (on && caption !== undefined) cap.textContent = caption || '';
    if (!on) {
      // keep caption text until fully faded
      setTimeout(() => { if (!f.classList.contains('on')) cap.textContent = ''; }, 700);
    }
    if (f.classList.contains('on') === !!on) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (done) return; done = true; f.removeEventListener('transitionend', h); resolve(); };
      const h = (e) => { if (e.target === f && e.propertyName === 'opacity') fin(); };
      f.addEventListener('transitionend', h);
      setTimeout(fin, 900);
      f.classList.toggle('on', !!on);
    });
  }

  toast(text) {
    if (this.settings.quiet && this._started) return; // quiet mode: no messages
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }
}
