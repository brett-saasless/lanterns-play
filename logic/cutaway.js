// The werewolf cutaway (docs/superpowers/specs/2026-11-18-werewolf-cutaway-design.md; the owner:
// "Make it happen right after the rock fall. Start the cutaway with the last of the settling dust
// and rubble, then move up to the werewolf-beefeater close-up, then the hybrid running to the
// castle ... show him running through the open castle doors and the one armour guard that fights
// the player closing the door after the werewolf goes in. Keep the shot tight on the werewolf as he
// approaches the castle so that most of the castle remains unseen.").
//
// One film beat, once per run, by itself the frame the large boulder is gone (road.js sets the
// road's cutaway latch 'due'; keep.js starts it here). It is a castle scene like the others
// (sim.waves.scene = { kind: 'cutaway', t, ... }): the sim is frozen under it, so the warden is
// where they stood, facing as they were, kit and all, when it ends. Enter (or the touch SKIP) ends
// it at once; nothing else does. Restores never replay it (road.js settledRoad spends the latch).
//
// cutawayAt(t, scene, out) is the whole film as data: the beat, the camera (position, target,
// lens), the creature (where, pose, heading, gait), the two door leaves' open fractions, the
// guard and the rubble's settling. The views (roadview.js, roadcreature.js) read it and write
// nothing back. Beats 1 and 2 are on the real road and bank; beat 3 is a staged set (the design's
// call): a stretch of hillside, the gate in a length of the castle's wall, its two leaves and the
// one fighting armour, far up out of everything else's way, framed so the wall's top never shows.
//
// Pure: no allocation a frame (cutawayAt writes into `out`), nothing random, no damage path.

import { ROAD, BOULDER_DIR, BOULDER_X, BOULDER_THUD, boulderAt, heightAt, stationAt, RECTS } from './road.js';

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => { const c = clamp(k); return c * c * (3 - 2 * c); };

export const CUTAWAY = f({
  beats: [
    { beat: 'dust', from: 0, to: 2.6 }, // the last of the dust hanging, the small rocks coming to rest
    { beat: 'face', from: 2.6, to: 7.3 }, // up the bank and in to the werewolf-beefeater's face, and a hold on it
    { beat: 'run', from: 7.3, to: 15.4 }, // the run to the castle, in at its doors, the guard shuts them
  ],
  total: 15.4,
  fade: 0.3, // seconds of the dip to black at the end (and main.js's fade back in from it)
  lead: 0.8, // seconds the camera takes to leave the warden's eye for the dust shot
  eyeFov: 75, // the warden's own lens (world.js), where the film starts
  // beat 1: low over the road, a few metres back from where the boulder came down, pushing in
  dust: { back: [4.6, 3.6], side: 0.9, low: 0.55, aim: 0.35, fov: 50, settle: 1.8 },
  // the art critic's pass: the face in front of the camera at `near`, the camera `off` (x, y) of
  // it: under it, looking up ~9 degrees so the face sits against the dusk sky; the crane is `crane`
  // seconds across and `rise` up (eased in slowly), the look on the creature within `look`; one
  // blink at `blink` (seconds into the beat, and its length)
  // beat 2: the creature stands on the bank by the outcrop the boulder broke from, `along` metres
  // back toward the warden from the outcrop's near end (roadview.js buildStones lays its stones from
  // 1 m behind the trigger point on up the road: so it and the camera are clear of them), `up`
  // metres up the bank, looking down at the road; its face is `height`
  // over its feet and `ahead` in front of them. The camera cranes up to `near[0]` in front of the
  // face in `crane` seconds and pushes in to `near[1]`, on a long lens.
  face: { along: 4, up: 0.5, height: 1.94, ahead: 1.09, near: [1.6, 1.25], crane: 2.4, rise: 1.8, look: 0.4, fov: 32, off: [0.1, -0.2], blink: [4.0, 0.22] },
  // beat 3, the staged set: its gate's threshold at (x, y, z), the wall along x facing south (+z),
  // `wallH` high; the hill falls away south of it at `slope`; the doorway `door` (w, h to its point).
  set: { x: 0, y: 60, z: 170, slope: 0.2, wallH: 7.5, door: { w: 3.2, h: 4.4 } },
  // the run on the set: from `from` metres out (and `dx` to the side) to the threshold in `reach`
  // seconds, then on in to `inside`; one loping stride every `stride` metres
  run: { from: 14, dx: 0.5, reach: 4.0, inside: -3.5, stride: 2.2 },
  // the two leaves shut (seconds into the run beat): the right then the left, 1.6 s each; the bar
  // drops `bar` seconds after the second; the shut doors hold 1.5 s
  doors: [[4.5, 6.1], [5.0, 6.6]],
  bar: 0.3,
  // the fighting armour walks out of the dark behind the left leaf to the doorway as it is through,
  // a stride every `stride` metres
  guard: { at: [4.1, 5.3], from: { x: -2.3, z: -1.6 }, to: { x: -0.5, z: -0.9 }, stride: 2.0 },
  // the run's camera: a tight follow behind and to the side (wide enough of it for the snout's
  // profile), low, then a hold on the doorway
  follow: { side: 1.6, back: 3.6, low: 1.25, aim: 1.35, lead: 1.5, fov: 38 },
  hold: { x: 0.8, z: 6.5, low: 0.75, tx: 0, ty: 1.9, tz: -0.5, fov: 40, at: [3.2, 4.4] },
  // the warm lift on the creature (the view's rim and key): 0 on the road beat, up as the crane
  // lands, `run` of it on the set
  light: { run: 0.6 },
  near: 15, // no live foe within this many metres of the warden when it starts (never over a fight)
});

const BEATS = CUTAWAY.beats;

/** The beat playing `t` seconds in: 'dust', 'face' or 'run' (clamped to the film). */
export function beatAt(t) {
  for (let i = BEATS.length - 1; i >= 0; i--) if (t >= BEATS[i].from) return BEATS[i].beat;
  return BEATS[0].beat;
}

/** The staged set's ground, `zl` metres south of its gate's threshold (relative to the set's y). */
export function setGround(zl) {
  return zl > 0 ? -CUTAWAY.set.slope * zl : 0;
}

const LAND = {}; // scratch: where the boulder came down
const roadY = (x, z) => {
  const leg = RECTS[2];
  return heightAt(stationAt(x, clamp(z, leg.minZ, leg.maxZ)));
};

/** Beat 1's camera at k (0..1 through the beat) into c, given the landing place L. */
function dustCam(k, L, c) {
  const D = CUTAWAY.dust;
  const back = lerp(D.back[0], D.back[1], smooth(k));
  c.px = L.x - BOULDER_DIR * back;
  c.pz = L.z + D.side;
  c.py = roadY(c.px, c.pz) + D.low;
  c.tx = L.x; c.ty = L.y + D.aim; c.tz = L.z;
  c.fov = D.fov;
}

/**
 * The film `t` seconds in, for the scene startCutaway made (scene.x: where the boulder crossed;
 * scene.from: the warden's eye as it began). Into `out` (reused: nothing allocated after the first
 * call): { beat, set, camera: { px, py, pz, tx, ty, tz, fov, follow }, creature: { where ('bank' |
 * 'set' | 'gone'), pose ('stand' | 'run'), x, y, z, heading, stride, breathe }, door: [right,
 * left] (1 open, 0 shut), guard: { show, x, z, heading }, rubble (0 falling to 1 at rest) }.
 * On the bank, y is the nominal ground (the road's height plus the bank's); the view stands the
 * creature on its hill and moves the camera by the same (camera.follow says how much).
 */
export function cutawayAt(t, scene, out = {}) {
  const T = clamp(t, 0, CUTAWAY.total);
  if (!out.camera) {
    out.camera = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: CUTAWAY.eyeFov, follow: 0 };
    out.creature = { where: 'bank', pose: 'stand', x: 0, y: 0, z: 0, heading: 0, stride: 0, breathe: 0 };
    out.door = [1, 1];
    out.guard = { show: false, x: 0, z: 0, heading: Math.PI, walk: 0, stride: 0 };
  }
  const c = out.camera; const cr = out.creature; const g = out.guard;
  const x0 = scene && Number.isFinite(scene.x) ? scene.x : 0;
  const L = boulderAt(BOULDER_THUD, x0, LAND); // at the bound: the stone on the road, its centre one radius up
  L.y -= ROAD.boulder.radius; // the road's surface there
  const B = ROAD.boulder;
  const F = CUTAWAY.face;
  out.beat = beatAt(T);
  out.rubble = smooth(T / CUTAWAY.dust.settle);
  out.door[0] = 1; out.door[1] = 1;
  g.show = false; g.x = CUTAWAY.set.x + CUTAWAY.guard.from.x; g.z = CUTAWAY.set.z + CUTAWAY.guard.from.z; g.heading = Math.PI;
  g.walk = 0; g.stride = 0;
  out.light = 0;
  out.rubbleT = T;

  // the creature on the bank by the outcrop the boulder broke from, looking down at the road (+z)
  cr.where = 'bank'; cr.pose = 'stand';
  cr.x = BOULDER_X - BOULDER_DIR * F.along;
  cr.z = B.bankZ - F.up;
  cr.y = L.y + B.top;
  cr.heading = Math.PI;
  cr.stride = 0;
  cr.breathe = T;
  cr.blink = 0;
  const fx = cr.x; const fy = cr.y + F.height; const fz = cr.z + F.ahead; // its face

  if (out.beat === 'dust') {
    out.set = false;
    const k = (T - BEATS[0].from) / (BEATS[0].to - BEATS[0].from);
    dustCam(k, L, c);
    c.follow = 0;
    // out of the warden's eye, looking where they looked, into the low shot
    const a = smooth(T / CUTAWAY.lead);
    if (a < 1 && scene && scene.from) {
      const e = scene.from;
      const cp = Math.cos(e.pitch || 0);
      const ex = e.x - Math.sin(e.yaw) * cp * 4; const ey = e.y + Math.sin(e.pitch || 0) * 4; const ez = e.z - Math.cos(e.yaw) * cp * 4;
      c.px = lerp(e.x, c.px, a); c.py = lerp(e.y, c.py, a); c.pz = lerp(e.z, c.pz, a);
      c.tx = lerp(ex, c.tx, a); c.ty = lerp(ey, c.ty, a); c.tz = lerp(ez, c.tz, a);
      c.fov = lerp(CUTAWAY.eyeFov, c.fov, a);
    }
    return out;
  }

  if (out.beat === 'face') {
    out.set = false;
    const u = T - BEATS[1].from;
    const len = BEATS[1].to - BEATS[1].from;
    dustCam(1, L, c); // where the dust shot left it
    const ax = c.px; const ay = c.py; const az = c.pz; const atx = c.tx; const aty = c.ty; const atz = c.tz;
    const kxz = smooth(u / F.crane);
    const ky0 = smooth(u / F.rise);
    const ky = ky0 * ky0; // eased in slowly: the camera does not lift over the ridgeline before the look is on the creature
    const push = smooth((u - F.crane) / (len - F.crane));
    const near = lerp(F.near[0], F.near[1], push);
    const bx = fx + F.off[0]; const by = fy + F.off[1]; const bz = fz + near;
    c.px = lerp(ax, bx, kxz); c.py = lerp(ay, by, ky); c.pz = lerp(az, bz, kxz);
    const kt = smooth(u / F.look); // the look finds the creature early in the rise, so the move is never a stare at the bank
    c.tx = lerp(atx, fx, kt); c.ty = lerp(aty, fy, kt); c.tz = lerp(atz, fz, kt);
    c.fov = lerp(CUTAWAY.dust.fov, F.fov, kxz);
    c.follow = ky; // the share of the camera's height that is the creature's (the view's hill under it)
    out.light = smooth((u - F.crane * 0.5) / (F.crane * 0.5));
    const bk = (u - F.blink[0]) / F.blink[1];
    cr.blink = bk > 0 && bk < 1 ? Math.sin(Math.PI * bk) : 0;
    return out;
  }

  // ---- beat 3: the staged set ----
  out.set = true;
  const S = CUTAWAY.set; const R = CUTAWAY.run;
  const u = T - BEATS[2].from;
  const speed = R.from / R.reach;
  const zl = R.from - speed * u; // metres south of the threshold (negative: inside)
  const xl = R.dx * clamp(zl / R.from, 0, 1);
  if (zl > R.inside) {
    cr.where = 'set'; cr.pose = 'run';
    cr.x = S.x + xl; cr.z = S.z + zl; cr.y = S.y + setGround(zl);
    cr.heading = Math.atan2(R.dx / R.from, 1); // up the hill (-z), drifting in to the doorway's middle
  } else {
    cr.where = 'gone'; cr.pose = 'run';
    cr.x = S.x; cr.z = S.z + R.inside; cr.y = S.y; cr.heading = 0;
  }
  cr.stride = ((R.from - zl) * 2 * Math.PI) / R.stride;

  // the camera: tight behind it and to its side, low, looking up the hill past it; then it stops
  // short of the gate and holds on the doorway while the doors shut
  const W = CUTAWAY.follow; const H = CUTAWAY.hold;
  const czl = Math.max(zl, 0) + W.back;
  const fpx = S.x + xl + W.side; const fpz = S.z + czl; const fpy = S.y + setGround(czl) + W.low;
  const ftx = S.x + xl * 0.5; const ftz = S.z + Math.max(zl, 0) - W.lead; const fty = S.y + setGround(Math.max(zl, 0)) + W.aim;
  const hpx = S.x + H.x; const hpz = S.z + H.z; const hpy = S.y + setGround(H.z) + H.low;
  const k = smooth((u - H.at[0]) / (H.at[1] - H.at[0]));
  c.px = lerp(fpx, hpx, k); c.py = lerp(fpy, hpy, k); c.pz = lerp(fpz, hpz, k);
  c.tx = lerp(ftx, S.x + H.tx, k); c.ty = lerp(fty, S.y + H.ty, k); c.tz = lerp(ftz, S.z + H.tz, k);
  c.fov = lerp(W.fov, H.fov, k);
  c.follow = 0;

  // the doors, and the guard who shuts them after it
  for (let i = 0; i < 2; i++) out.door[i] = 1 - smooth((u - CUTAWAY.doors[i][0]) / (CUTAWAY.doors[i][1] - CUTAWAY.doors[i][0]));
  const Q = CUTAWAY.guard;
  g.show = u >= Q.at[0];
  const gk = smooth((u - Q.at[0]) / (Q.at[1] - Q.at[0]));
  g.x = S.x + lerp(Q.from.x, Q.to.x, gk);
  g.z = S.z + lerp(Q.from.z, Q.to.z, gk);
  g.heading = Math.PI; // facing out of the doorway, at the hill: it shuts the leaves toward itself
  g.walk = u > Q.at[0] && u < Q.at[1] ? 1 : 0;
  g.stride = (Math.hypot(Q.to.x - Q.from.x, Q.to.z - Q.from.z) * gk * 2 * Math.PI) / Q.stride;
  out.light = CUTAWAY.light.run;
  return out;
}

/** The dip to black at the film's end: 0 until its last CUTAWAY.fade seconds, 1 at its end (main.js draws it). */
export function cutawayBlack(t) {
  return smooth((t - (CUTAWAY.total - CUTAWAY.fade)) / CUTAWAY.fade);
}

// ---- the rules -----------------------------------------------------------------------------------

/** True when the road's cutaway is due and the warden is clear to watch it: alive, playing, no scene, no foe near. */
export function cutawayDue(sim) {
  const w = sim && sim.waves;
  const road = w && w.road;
  if (!road || !road.cutaway || road.cutaway.state !== 'due') return false;
  if (w.scene || w.leap || sim.status !== 'playing') return false;
  const pl = sim.player;
  if (!pl || pl.dead) return false;
  for (const e of sim.enemies || []) {
    if (!e.dead && Math.hypot(e.x - pl.x, e.z - pl.z) < CUTAWAY.near) return false;
  }
  return true;
}

/** Starts the cutaway (keep.js, when cutawayDue): the scene over the frozen sim, the latch on 'play'. */
export function startCutaway(sim, events) {
  const w = sim.waves;
  const pl = sim.player;
  const eye = sim.cfg && sim.cfg.player && Number.isFinite(sim.cfg.player.eyeHeight) ? sim.cfg.player.eyeHeight : 1.65;
  w.scene = {
    kind: 'cutaway', t: 0, left: CUTAWAY.total, total: CUTAWAY.total, skippable: true,
    x: w.road.boulder.x,
    from: { x: pl.x, y: (pl.y || 0) + eye, z: pl.z, yaw: pl.yaw || 0, pitch: pl.pitch || 0 },
  };
  w.road.cutaway.state = 'play';
  events.push({ type: 'sceneStart', kind: 'cutaway' });
  return w.scene;
}

/**
 * One frame of the cutaway (keep.js stepKeepScene, the castle's scene freeze), or false when it is
 * not the scene playing. Only a skip ends it early. The run's footfalls (roadCreature, the old
 * glimpse's cue) go once as the run begins. On its end: sceneEnd { kind, skipped } and the latch spent.
 */
export function stepCutaway(sim, input, dt, events) {
  const w = sim.waves;
  const s = w && w.scene;
  if (!s || s.kind !== 'cutaway') return false;
  const was = s.t;
  s.t += dt > 0 ? dt : 0;
  s.left = s.total - s.t;
  const run = BEATS[2].from;
  const pl = sim.player;
  if (was < run && s.t >= run) events.push({ type: 'roadCreature', x: pl.x, y: (pl.y || 0) + 1, z: pl.z });
  const skipped = !!(input && input.skip);
  if (!skipped) {
    // the sound of the film (centred: it is the film's, not a place's): the growl as the close-up
    // lands, a heavy thud as each leaf shuts, the bar dropped across them
    const crossed = (at) => was < at && s.t >= at;
    if (crossed(BEATS[1].from + CUTAWAY.face.crane)) events.push({ type: 'cutawayGrowl' });
    for (const d of CUTAWAY.doors) if (crossed(run + d[1])) events.push({ type: 'cutawayDoor' });
    if (crossed(run + CUTAWAY.doors[1][1] + CUTAWAY.bar)) events.push({ type: 'cutawayBar' });
  }
  if (!skipped && s.t < s.total) return true;
  w.scene = null;
  if (w.road && w.road.cutaway) w.road.cutaway.state = 'done';
  events.push({ type: 'sceneEnd', kind: 'cutaway', skipped });
  return true;
}
