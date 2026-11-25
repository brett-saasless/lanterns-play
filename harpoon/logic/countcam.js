// The cut scenes' camera in the Count's room, as rules: the death scene (the pyre) and the triumph. Pure: no DOM,
// no three, no randomness, no allocation per call (castle.js passes an `out` made once). castle.js sceneCamera draws
// both from here, and the Dracula pass (vamp.js, its tests and the smoke) checks the decor against the very same
// lines, so there is one camera, not a copy (group 5's fix round, the technical critic's T-A).
//
// The pyre (K10): close on him while he burns (about half the frame's height), then crane up with the whirlwind from
// 4.2 s so the shades go out through the dawn in frame, then settle on the ash in the still gold. A longer lens than
// the warden's, widening as it cranes. From the warden's side of the box.
// The triumph (issue #20, K12): from the warden's own eye, the look turns and rises into the middle window, square on,
// so by THE END (4 s) its sky and the sunrise over the land fill most of the frame.

import { COUNT_ROOM, MIDDLE_CURTAIN, ZONES } from './keepmap.js';

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };

/** Every number of the two cameras: offsets from the box (bx, bz), the room's floor (y) and the middle window. */
export const COUNT_CAM = Object.freeze({
  pyre: Object.freeze({
    pushT: 5, craneT: Object.freeze([4.2, 3.0]), settleT: Object.freeze([8.3, 1.5]), // seconds: the push over, the crane and the settle from and over
    pos: Object.freeze({ x: Object.freeze([-4.3, -3.8]), y: Object.freeze([1.85, 2.0]), side: Object.freeze([3.1, 2.7]) }), // pushing in
    look: Object.freeze([2.15, 2.25]), // the look's height on him while it pushes in
    crane: Object.freeze({ x: -5.2, y: 3.4, side: 3.8, look: Object.freeze({ win: -4, y: 3.9 }) }), // and up, looking out of the middle window
    settle: Object.freeze({ x: 1.5, y: 1.0 }), // the look down on the ash, past the box
    fov: Object.freeze([48, 62]),
  }),
  triumph: Object.freeze({ go: 4.2, lift: Object.freeze([0.6, 4.6]), fovT: 4.6, eye: 1.65, sill: 1.3, eyeTo: 1.75, out: 6, rise: 0.17, ahead: 4, fov: Object.freeze([75, 50]) }),
});

const FLOOR = (ZONES.find((z) => z.id === 'count') || { y: 0 }).y;

/**
 * The camera at t seconds into the scene: kind 'pyre' or 'triumph', pl the warden ({ x, z, yaw }). Fills out
 * ({ pos: [x, y, z], target: [x, y, z], fov }) and returns it.
 */
export function countSceneCamera(kind, t, pl = {}, out = { pos: [0, 0, 0], target: [0, 0, 0], fov: 0 }) {
  const y = FLOOR; const r = COUNT_ROOM.rect; const win = COUNT_ROOM.curtains[MIDDLE_CURTAIN];
  const bx = COUNT_ROOM.boxAt.x; const bz = COUNT_ROOM.boxAt.z;
  const P = out.pos; const T = out.target; pl = pl || {};
  if (kind === 'pyre') {
    const C = COUNT_CAM.pyre;
    const side = Number.isFinite(pl.z) && pl.z > bz ? 1 : -1; // from the warden's side of the room
    const push = smooth(t / C.pushT); const crane = smooth((t - C.craneT[0]) / C.craneT[1]); const settle = smooth((t - C.settleT[0]) / C.settleT[1]);
    P[0] = lerp(lerp(bx + C.pos.x[0], bx + C.pos.x[1], push), bx + C.crane.x, crane);
    P[1] = lerp(y + lerp(C.pos.y[0], C.pos.y[1], push), y + C.crane.y, crane);
    P[2] = lerp(bz + side * lerp(C.pos.side[0], C.pos.side[1], push), bz + side * C.crane.side, crane);
    T[0] = lerp(lerp(bx, win.x + C.crane.look.win, crane), bx + C.settle.x, settle);
    T[1] = lerp(lerp(y + lerp(C.look[0], C.look[1], push), y + C.crane.look.y, crane), y + C.settle.y, settle);
    T[2] = lerp(lerp(bz, win.z, crane), bz, settle);
    out.fov = lerp(C.fov[0], C.fov[1], crane);
    return out;
  }
  const C = COUNT_CAM.triumph;
  const px = Number.isFinite(pl.x) ? pl.x : win.x - 2; const pz = Number.isFinite(pl.z) ? pl.z : win.z;
  const yaw = Number.isFinite(pl.yaw) ? pl.yaw : -Math.PI / 2; // the look starts where the warden was looking (no cut)
  const eyeY = y + C.eye;
  const go = smooth(clamp(t / C.go)); const lift = smooth(clamp((t - C.lift[0]) / C.lift[1]));
  const sill = r.maxX - C.sill; // close to the window's inner face, so its light fills the frame
  P[0] = lerp(px, sill, go); P[1] = lerp(eyeY, y + C.eyeTo, go); P[2] = lerp(pz, win.z, go);
  T[0] = lerp(px - Math.sin(yaw) * C.ahead, r.maxX + C.out, go); T[1] = lerp(eyeY, y + C.eyeTo + C.out * C.rise, lift); T[2] = lerp(pz - Math.cos(yaw) * C.ahead, win.z, go);
  out.fov = lerp(C.fov[0], C.fov[1], smooth(clamp(t / C.fovT)));
  return out;
}
