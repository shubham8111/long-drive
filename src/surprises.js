// Surprises: rare, unhurried moments on the drive — a shooting star, balloons at dawn, bells on the
// hour, steam rising from a Manhattan street, the camera drifting out for a look around.
//
// Each surprise is a definition (see src/surprises/*.js):
//   {
//     id: 'shooting-star',
//     kind: 'random' | 'clock' | 'ambient',
//        random:  picked by the scheduler, one notable moment every few minutes, never two at once
//        clock:   starts by itself when due(ctx) says so (e.g. bells on the hour); ignores the schedule
//        ambient: runs whenever chance(ctx) > 0 (e.g. steam vents in Manhattan); ends when update() says
//     label: 'a shooting star',      // optional: offered to the radio as something seen
//     cooldown: 300,                 // seconds before the same surprise may come again
//     local: true,                   // belongs to the current place (put away when the place changes)
//     calm: false,                   // too eventful for quiet mode or a wind-down (camera takeovers, lightning)
//     possible(ctx) -> bool,         // can it ever happen here (place, kind of place)?
//     chance(ctx) -> number >= 0,    // how likely right now (hour, weather...); 0 = not now
//     due(ctx) -> bool,              // clock surprises only
//     create(ctx) -> instance        // { update(dt, ctx) -> false when finished, dispose(),
//                                    //   camera?(camera, dt, ctx) — may move the camera after the ride's own }
//   }
// ctx is described in main.js (surpriseCtx).

const rand = (a, b) => a + Math.random() * (b - a);

export class Surprises {
  constructor(defs, { gap = [120, 240], force = null } = {}) {
    this.defs = defs;
    this.gapRange = gap;
    this.wait = rand(45, 90); // the first one comes a little sooner
    this.active = [];        // { def, inst }
    this.last = new Map();   // id -> time it last started
    this.t = 0;
    this.force = force;      // testing: ?surprise=<id> starts that one as soon as it is possible
  }

  get busy() { return this.active.some((a) => a.def.kind === 'random'); }

  start(def, ctx) {
    let inst;
    try { inst = def.create(ctx); } catch (e) { console.warn('surprise failed to start', def.id, e); return null; }
    if (!inst) return null;
    this.active.push({ def, inst });
    this.last.set(def.id, this.t);
    if (def.label && this.onSight) this.onSight(def, typeof def.label === 'function' ? def.label(ctx) : def.label);
    return inst;
  }

  ready(def) { const l = this.last.get(def.id); return l == null || this.t - l > (def.cooldown ?? 300); }
  running(def) { return this.active.some((a) => a.def === def); }

  update(dt, ctx) {
    this.t += dt;
    // what is already happening
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      let alive = false;
      try { alive = a.inst.update(dt, ctx) !== false; } catch (e) { console.warn('surprise error', a.def.id, e); }
      if (!alive) { try { a.inst.dispose(); } catch (e) { /* ignore */ } this.active.splice(i, 1); }
    }
    if (!ctx.started || ctx.inTunnel) return;
    const safe = (f, d) => { try { return f(); } catch (e) { return d; } };
    // testing hook
    if (this.force) {
      const def = this.defs.find((d) => d.id === this.force);
      if (def && !this.running(def) && safe(() => def.possible(ctx), false)) { this.start(def, ctx); this.force = null; }
    }
    const ok = (def) => !(ctx.calm && def.calm === false); // quiet mode / wind-down: only the gentle ones
    for (const def of this.defs) {
      if (!ok(def) || this.running(def) || !safe(() => def.possible(ctx), false)) continue;
      if (def.kind === 'clock' && safe(() => def.due(ctx), false) && this.ready(def)) this.start(def, ctx);
      else if (def.kind === 'ambient' && safe(() => def.chance(ctx), 0) > 0 && this.ready(def)) this.start(def, ctx);
    }
    // the next notable moment
    this.wait -= dt;
    if (this.wait > 0 || this.busy) return;
    const opts = [];
    for (const def of this.defs) {
      if (def.kind !== 'random' || !ok(def) || !this.ready(def) || !safe(() => def.possible(ctx), false)) continue;
      const w = safe(() => def.chance(ctx), 0);
      if (w > 0) opts.push([def, w]);
    }
    if (!opts.length) { this.wait = 20; return; }
    let r = Math.random() * opts.reduce((a, o) => a + o[1], 0), pick = opts[0][0];
    for (const [def, w] of opts) if ((r -= w) <= 0) { pick = def; break; }
    this.start(pick, ctx);
    this.wait = rand(this.gapRange[0], this.gapRange[1]);
  }

  // after the ride's camera: a surprise may take the camera for a while (a slow look around)
  camera(camera, dt, ctx) {
    for (const a of this.active) if (a.inst.camera) { try { a.inst.camera(camera, dt, ctx); } catch (e) { /* ignore */ } }
  }

  // the place changed (endless drive): everything tied to the old place goes
  placeChanged() {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      try { a.inst.dispose(); } catch (e) { /* ignore */ }
      this.active.splice(i, 1);
    }
  }
}
