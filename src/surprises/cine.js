// Camera moments: every so often, on a good stretch, the camera drifts out from the ride for a slow
// cinematic look around (about 15 s), then settles back. It makes a long drive feel filmed.
import * as THREE from 'three';

const ease = (t) => t * t * (3 - 2 * t);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function makeShot(ctx) {
  const city = ctx.place?.kind === 'city';
  // cities: rise up like a crane, so buildings never get in the way; open country: a slow swing round
  const style = city ? 'crane' : Math.random() < 0.65 ? 'orbit' : 'crane';
  const side = Math.random() < 0.5 ? -1 : 1;
  const len = 15;
  const tmpQ = new THREE.Quaternion(), fromQ = new THREE.Quaternion(), m = new THREE.Matrix4();
  const from = new THREE.Vector3(), to = new THREE.Vector3(), look = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let t = 0, ended = false;
  return {
    t: 0,
    update(dt, c) {
      if (c.inTunnel || !c.started) ended = true;
      t += dt;
      return !ended && t < len;
    },
    camera(camera, dt, c) {
      if (ended) return;
      const p = c.pose;
      // in and out over 3.5 s each; the shot itself keeps moving the whole time
      const w = ease(clamp(t / 3.5, 0, 1)) * ease(clamp((len - t) / 3.5, 0, 1));
      if (w <= 0) return;
      const k = t / len, yaw = p.yaw;
      if (style === 'orbit') {
        // starts beside the ride and swings slowly out and round, about a third of a turn
        const a = yaw + side * (Math.PI * 0.45 + k * Math.PI * 0.65);
        const r = 8 + k * 6, h = 2 + k * 3;
        to.set(p.x + Math.sin(a) * r, p.y + h, p.z + Math.cos(a) * r);
      } else {
        // from just behind, rising over the road (kept above the road, clear of the trees)
        const a = yaw + side * (0.08 + k * 0.22);
        const r = 8 + k * 6, h = 3 + k * 9;
        to.set(p.x + Math.sin(a) * r, p.y + h, p.z + Math.cos(a) * r);
      }
      // never under the ground
      const g = c.terrain?.heightAt?.(to.x, to.z);
      if (g != null) to.y = Math.max(to.y, g + 1.6);
      // look at the ride and on down the road (the crane looks further ahead, so it never stares down)
      const ahead = style === 'crane' ? 22 : 6;
      look.set(p.x - Math.sin(yaw) * ahead, p.y + 1.1, p.z - Math.cos(yaw) * ahead);
      m.lookAt(to, look, up);
      tmpQ.setFromRotationMatrix(m);
      from.copy(camera.position); fromQ.copy(camera.quaternion);
      camera.position.lerpVectors(from, to, w);
      camera.quaternion.copy(fromQ).slerp(tmpQ, w);
    },
    dispose() {},
  };
}

export const CINE_SURPRISES = [
  {
    id: 'cine', calm: false,
    kind: 'random',
    cooldown: 360,
    possible: (c) => !!c.pose,
    // best in the golden hours and on open, scenic roads; only while actually driving
    chance: (c) => {
      if (c.speed < 4) return 0;
      const golden = c.elevDeg > -6 && c.elevDeg < 14 ? 1.6 : 1;
      return (c.place?.kind === 'scenic' ? 1.2 : 0.8) * golden;
    },
    create: (c) => makeShot(c),
  },
];
