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
// nothing back. Beats 1 and 2 are on the real road and bank (the castle is not drawn for them, so
// its towers never show on the skyline over the climb). Beat 3 is the castle's REAL front (the
// owner, 2026-11-18: "that front door setting should be the same front door scene that currently
// exists at the front of the castle ... just keep the camera tight on the werewolf so the user does
// not see everything until the player climbs the rest of the road. The only guard to move in the
// scene should be the guard that fights."): the werewolf runs up the approach, along the
// drawbridge's deck, across the forecourt between the two suits (keepmap.js SENTRIES) and in at
// the front door (keepmap.js DOORS 'front'); the fighting suit (suits[1], seated as suit 2) leaves
// its post and shuts the real doors after it. `front` says the beat is on; castle.js draws the
// shell and the door leaves from `door`, keepcast.js poses the fighting suit from `guard`.
//
// Pure: no allocation a frame (cutawayAt writes into `out`), nothing random, no damage path.

import { ROAD, BOULDER_DIR, BOULDER_X, BOULDER_THUD, boulderAt, heightAt, stationAt, RECTS } from './road.js';
import { ZONES, SENTRIES, DOORS } from './keepmap.js';

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => { const c = clamp(k); return c * c * (3 - 2 * c); };

export const CUTAWAY = f({
  beats: [
    { beat: 'dust', from: 0, to: 2.0 }, // the last of the dust hanging, the small rocks coming to rest
    { beat: 'face', from: 2.0, to: 6.7 }, // up the bank and in to the werewolf-beefeater's face, and a hold on it
    { beat: 'run', from: 6.7, to: 17.05 }, // the run to the castle, in at its doors, the guard shuts them
  ],
  total: 17.05,
  fade: 0.3, // seconds of the dip to black at the end (and main.js's fade back in from it)
  lead: 0.8, // seconds the camera takes to leave the warden's eye for the dust shot
  eyeFov: 75, // the warden's own lens (world.js), where the film starts
  // beat 1: low over the road, a few metres back from where the boulder came down, pushing in
  dust: { back: [4.6, 3.6], side: 0.9, low: 0.55, aim: 0.35, fov: 50, settle: 1.4 },
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
  // beat 3, the castle's real front. The run: from `from` metres south on the approach, at the
  // drawbridge's foot (and `x0` off the middle), straight up the deck to the front wall's face (the
  // forecourt's south edge) in `reach` seconds, on the line between the two open leaves; in at the
  // doorway and on up the hall, bending off west by `inside` (its bend, then its end), behind the
  // west jamb where the hold cannot see it. One loping stride every `stride` metres; `r` is its
  // reach about its middle (arms and all), seen from above. `ease`: it gathers over its first
  // ease[0] seconds from ease[1] of its top speed (the critic: it no longer sets off at full tilt).
  run: { from: 35, x0: -0.12, reach: 3.6, ease: [0.4, 0.35], inside: [[-0.12, -6.8], [-3.4, -7.4]], stride: 2.6, r: 0.6 },
  // the doors (the owner, 2026-11-18: "the guard needs to manually close the door. the door is two
  // solid physical objects that swing close, nothing should pass thru the doors ... 1.6 second for
  // each door closing is fine they can be closed sequentially so the guard can make each closed
  // with a hand."): the front door's two real leaves (castle.js; they open into the hall), the west
  // then the east, each from `open` radians shut over `at` (seconds into the run beat), drawn shut
  // by the fighting suit's left claw on its street face. `hold`: where the suit stands in the
  // leaf's own frame while it does (`al` metres along the leaf from the hinge, `be` out from its
  // street face, its heading `ph` off square to the leaf), so it turns with the leaf about the
  // hinge and its hand never leaves it. The west: it backs out of the doorway drawing the leaf after
  // it; the east: it walks out east drawing the leaf shut behind it. Found by a search for the
  // most clearance (the claw cannot reach a second leaf any other way: from the street side it
  // would have to cross the first leaf or the jamb, from the hall side get round behind the leaf).
  leaves: [
    { side: -1, open: (70 * Math.PI) / 180, at: [5.05, 6.65], hold: { al: 1.15, be: 1.05, ph: -0.4 } },
    { side: 1, open: (55 * Math.PI) / 180, at: [7.55, 9.15], hold: { al: 0.15, be: 1.65, ph: 1.15 } },
  ],
  // a heavy leaf: it gathers, swings, comes to the stop at `settle` of its time and rebounds
  // `bounce` radians off it, then lies flush
  swing: { settle: 0.86, bounce: 0.02 },
  bar: 0.3, // the bar drops this long after the second leaf shuts
  // the fighting suit: at its post (keepmap SENTRIES.suits[1]) until `toWait`, when (the werewolf on
  // the bridge's far half) it steps to `wait` by the doorway, out of its line; after it is through
  // (`in`) it goes in `via` the doorway to the west leaf's hold; `step`, from the west leaf's end to
  // the east leaf's hold. A stride every `stride` metres; its hand height `hand`.
  guard: { suit: 2, toWait: [1.6, 2.6], wait: { x: 1.2, z: 1.5 }, in: [3.45, 5.05], via: { x: 0.6, z: 1.3 }, step: [6.65, 7.55], stepVia: { x: 0.4, z: 1.0 }, stride: 2.0, hand: 1.6, wrist: 0.37, claw: 0.37 },
  // the run's camera (the owner: low, from the side, following it across the drawbridge and in):
  // low and tight on the creature from its west (`side`: the still suit, west of the door, stays
  // beside or behind the camera, never in the frame), `r` metres off, swinging (angle `arc` radians
  // round it from ahead, over `swing` seconds) from ahead of it, looking back down at the road, to
  // its side, looking east across the deck; the castle's face is behind or beside the frame. Then
  // it comes in to the still suit's east side and holds on the doors looking north-east: the doors
  // and the fighting suit in frame, the still suit out of it.
  follow: { side: -1, r: 4.6, low: 0.8, aim: 1.2, lead: 0.6, fov: 34, arc: [0.6, 1.45], swing: [0.3, 2.6] },
  // (its look stays on the creature until `look`, then settles on the doors)
  hold: { x: -1.2, z: 4.9, low: 1.15, tx: 1.0, ty: 2.3, tz: 0.0, fov: 36, at: [2.4, 3.7], look: [2.5, 3.5] },
  // the warm lift on the creature (the view's rim and key): 0 on the road beat, up as the crane
  // lands, `run` of it on the set
  light: { run: 0.6 },
  // the film's light on the castle front (the art critic, 2026-11-18: "the castle reads overcast ...
  // same sun, same colour, only given a direction"): on the run beat only, the boulder moment's own
  // sun (the view aims it along the road's key direction, in the road's sun colour) is thrown as the
  // castle's shadowed key at `key`; the road's fill times `fill`; the grade's emissive floor times
  // `floor`, warmed to `floorHex`; the stone tinted `tint` (the critic: chroma toward the road's
  // earth); the deck (the castle's fittings) lifted by `deck`; the torches' pools times `torch`
  sun: { key: 6, fill: 1.5, floor: 0.65, floorHex: 0x7a5a48, tint: [1, 0.94, 0.86], deck: 0.15, torch: 1.5 },
  near: 15, // no live foe within this many metres of the warden when it starts (never over a fight)
});

// the real front, read from the castle's map
const FACE_Z = ZONES.find((z) => z.id === 'forecourt').rects[0].minZ; // the front wall's face
const POST = SENTRIES.suits[1]; // the fighting suit's post
const FRONT = DOORS.find((d) => d.id === 'front').rect;

/**
 * The front door's leaves as castle.js builds them: each `w` long from its hinge (boards and straps
 * stop 3 mm short of the doorway's middle, so the shut pair meet on a 6 mm seam: no faces on one
 * another to shimmer, and the second leaf's corner clears the first as it comes to), `t` either
 * side of its middle (the straps, its thickest along its length), the boards' face `face` out (where
 * the hand goes), the ring `ring` [from, to, t] along it; `h` tall; hung at the doorway's side on a
 * pivot at the leaf's own edge, `z` (flush with the hall's face of the wall).
 */
const HALF = (FRONT.maxX - FRONT.minX) / 2;
export const LEAF = Object.freeze({ w: HALF - 0.003, t: 0.05, face: 0.035, ring: Object.freeze([HALF - 0.17, HALF - 0.11, 0.08]), h: 4.6 - (FRONT.maxX - FRONT.minX) * 0.27, z: FRONT.minZ + 0.04 });

/**
 * A leaf's frame at `angle` (0 shut, + open into the hall): its hinge (hx, hz), along it (dx, dz)
 * and its street face's normal (nx, nz). side -1 the west leaf, +1 the east. Into out.
 */
export function leafFrame(side, angle, out) {
  const c = Math.cos(angle); const s = Math.sin(angle);
  out.hx = side * HALF; out.hz = LEAF.z;
  out.dx = -side * c; out.dz = -s;
  out.nx = -side * s; out.nz = c;
  return out;
}

// The armour's top view about its feet (keepcast.js: the cuirass at its widest flare, the pike in
// its right hand at the grip, its left shoulder's hump of spikes, its right shoulder's bristles):
// metres right (+x) and back (+z) of its middle, and their reach (sized on the browser's vertices).
const BODY = Object.freeze({ torso: [0, 0, 0.66], pike: [0.66, -0.08, 0.22], hump: [-0.72, 0, 0.4], bristle: [0.62, 0, 0.3], shoulder: [-0.5, 0, 2.05] });
/**
 * The guard's parts seen from above, for the no-overlap rules: { torso, pike, hump, bristle: { x, z, r },
 * shoulder: { x, y, z } (its left, the claw's) } from guard { x, z, heading }. Into out.
 */
export function guardBody(g, out) {
  const rx = Math.cos(g.heading); const rz = -Math.sin(g.heading); // its right
  const bx = Math.sin(g.heading); const bz = Math.cos(g.heading); // its back
  for (const k of ['torso', 'pike', 'hump', 'bristle']) {
    const [a, b, r] = BODY[k];
    const o = out[k] || (out[k] = {});
    o.x = g.x + rx * a + bx * b; o.z = g.z + rz * a + bz * b; o.r = r;
  }
  const sh = out.shoulder || (out.shoulder = {});
  sh.x = g.x + rx * BODY.shoulder[0]; sh.y = BODY.shoulder[2]; sh.z = g.z + rz * BODY.shoulder[0];
  return out;
}

const BEATS = CUTAWAY.beats;

/** The beat playing `t` seconds in: 'dust', 'face' or 'run' (clamped to the film). */
export function beatAt(t) {
  for (let i = BEATS.length - 1; i >= 0; i--) if (t >= BEATS[i].from) return BEATS[i].beat;
  return BEATS[0].beat;
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
 * call): { beat, front (the castle's real front is the shot), camera: { px, py, pz, tx, ty, tz, fov,
 * follow }, creature: { where ('bank' | 'front' | 'gone'), pose ('stand' | 'run'), x, y, z, heading,
 * stride, breathe }, door: [east, west] (the front door's leaves: 1 open, 0 shut), guard: { active
 * (the film poses the fighting suit), suit, x, z, heading, move (0 standing, 1 walking), walked
 * (metres), reach (0 to 1: its claw on the leaves) }, rubble (0 falling to 1 at rest) }.
 * On the bank, y is the nominal ground (the road's height plus the bank's); the view stands the
 * creature on its hill and moves the camera by the same (camera.follow says how much).
 */
export function cutawayAt(t, scene, out = {}) {
  const T = clamp(t, 0, CUTAWAY.total);
  if (!out.camera) {
    out.camera = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: CUTAWAY.eyeFov, follow: 0 };
    out.creature = { where: 'bank', pose: 'stand', x: 0, y: 0, z: 0, heading: 0, stride: 0, breathe: 0 };
    out.door = [1, 1];
    out.guard = { active: false, suit: CUTAWAY.guard.suit, x: 0, z: 0, heading: 0, move: 0, walked: 0, reach: 0, hand: { x: 0, y: 0, z: 0 }, contact: { leaf: -1, x: 0, y: 0, z: 0, nx: 0, nz: 1 } };
  }
  const c = out.camera; const cr = out.creature; const g = out.guard;
  const x0 = scene && Number.isFinite(scene.x) ? scene.x : 0;
  const L = boulderAt(BOULDER_THUD, x0, LAND); // at the bound: the stone on the road, its centre one radius up
  L.y -= ROAD.boulder.radius; // the road's surface there
  const B = ROAD.boulder;
  const F = CUTAWAY.face;
  out.beat = beatAt(T);
  out.rubble = smooth(T / CUTAWAY.dust.settle);
  out.door[0] = LV[0].open; out.door[1] = LV[1].open;
  g.contact.leaf = -1;
  g.active = false; g.x = POST.x; g.z = POST.z; g.heading = POST.yaw;
  g.move = 0; g.walked = 0; g.reach = 0;
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
    out.front = false;
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
    out.front = false;
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

  // ---- beat 3: the castle's real front ----
  out.front = true;
  const R = CUTAWAY.run;
  const u = T - BEATS[2].from;
  // its top speed, so that with the gathering start it is at the wall's face at `reach`
  const [ea, e0] = R.ease;
  const gather = ea * (e0 + (1 - e0) * 0.5); // metres-per-top-speed covered while it gathers
  const speed = (R.from - FACE_Z) / (gather + R.reach - ea);
  const ek = clamp(u / ea);
  const s = u < ea ? speed * (e0 * u + (1 - e0) * ea * (ek * ek * ek - (ek * ek * ek * ek) / 2)) : speed * (gather + u - ea); // metres run
  const outside = R.from - FACE_Z; // metres to the wall's face
  const inLen = Math.hypot(R.inside[0][0] - R.x0, R.inside[0][1] - FACE_Z) + Math.hypot(R.inside[1][0] - R.inside[0][0], R.inside[1][1] - R.inside[0][1]); // about the curve's length
  cr.pose = 'run';
  if (s <= outside) {
    cr.where = 'front';
    cr.z = R.from - s;
    cr.x = R.x0; // the line between the two open leaves
    cr.heading = 0; // north (-z), at the door
  } else if (s - outside < inLen) {
    // in at the doorway, bending off west: a quadratic curve from the threshold by the bend to the end
    cr.where = 'front';
    const k = (s - outside) / inLen;
    const [b0, b1] = R.inside;
    const a0 = (1 - k) * (1 - k); const a1 = 2 * k * (1 - k); const a2 = k * k;
    cr.x = a0 * R.x0 + a1 * b0[0] + a2 * b1[0];
    cr.z = a0 * FACE_Z + a1 * b0[1] + a2 * b1[1];
    const dx = 2 * (1 - k) * (b0[0] - R.x0) + 2 * k * (b1[0] - b0[0]);
    const dz = 2 * (1 - k) * (b0[1] - FACE_Z) + 2 * k * (b1[1] - b0[1]);
    cr.heading = Math.atan2(-dx, -dz);
  } else {
    cr.where = 'gone';
    cr.x = R.inside[1][0]; cr.z = R.inside[1][1]; cr.heading = Math.PI / 2;
  }
  cr.y = 0; // the approach, the deck and the forecourt are the castle's floor
  cr.stride = (s * 2 * Math.PI) / R.stride;

  // the camera: from its west, swinging round it from ahead to its side, low; then it stops and
  // holds on the doors
  const W = CUTAWAY.follow; const H = CUTAWAY.hold;
  const rz = Math.max(cr.z, FACE_Z); const rx = R.x0; // it follows to the threshold
  const arc = lerp(W.arc[0], W.arc[1], smooth((u - W.swing[0]) / (W.swing[1] - W.swing[0])));
  const fpx = rx + W.side * W.r * Math.sin(arc); const fpz = Math.max(rz - W.r * Math.cos(arc), H.z); const fpy = W.low; // never in past the hold's line (the forecourt's cover)
  const ftx = rx; const ftz = rz - W.lead; const fty = W.aim;
  const k = smooth((u - H.at[0]) / (H.at[1] - H.at[0]));
  c.px = lerp(fpx, H.x, k); c.py = lerp(fpy, H.low, k); c.pz = lerp(fpz, H.z, k);
  const kl = smooth((u - H.look[0]) / (H.look[1] - H.look[0]));
  c.tx = lerp(ftx, H.tx, kl); c.ty = lerp(fty, H.ty, kl * k); c.tz = lerp(ftz, H.tz, kl); // the look rises to the doors' head only as the camera comes in (the front's upper wall stays out of frame)
  c.fov = lerp(W.fov, H.fov, k);
  c.follow = 0;

  // the doors: each leaf shut in its turn, the fighting suit's hand on it
  for (let i = 0; i < 2; i++) out.door[i] = leafAngle(i, u);
  stageGuard(u, out.door, g);
  out.light = CUTAWAY.light.run;
  return out;
}

const LV = CUTAWAY.leaves;
const SW = CUTAWAY.swing;
/** How far leaf i has closed (0 open to 1 at the stop, never back), `u` seconds into the run beat. */
function leafClosed(i, u) {
  const l = LV[i];
  return smooth((u - l.at[0]) / ((l.at[1] - l.at[0]) * SW.settle));
}
/** Leaf i's angle `u` seconds into the run beat: open, then a heavy swing to the stop, one small rebound, flush. */
function leafAngle(i, u) {
  const l = LV[i];
  if (u <= l.at[0]) return l.open;
  if (u >= l.at[1]) return 0;
  const k = (u - l.at[0]) / (l.at[1] - l.at[0]);
  if (k < SW.settle) return l.open * (1 - leafClosed(i, u));
  return SW.bounce * Math.sin((Math.PI * (k - SW.settle)) / (1 - SW.settle));
}

const _lf = {};
const _bd = {};
/** The guard as it draws leaf i shut at `angle`: posed in the leaf's frame (CUTAWAY.leaves hold), into g (x, z, heading, hand, contact). */
function holdPose(i, angle, g) {
  const l = LV[i]; const P = l.hold;
  const L = leafFrame(l.side, angle, _lf);
  g.x = L.hx + P.al * L.dx + P.be * L.nx;
  g.z = L.hz + P.al * L.dz + P.be * L.nz;
  const c = Math.cos(P.ph); const s = Math.sin(P.ph);
  const fx = -L.nx * c + L.nz * s; const fz = -L.nx * s - L.nz * c; // square to the leaf, turned ph
  g.heading = Math.atan2(-fx, -fz);
  // the claw on the street face, at the point of it nearest its left shoulder; the wrist out from it
  // by exactly the claw's own reach (`claw`: keepcast.js, 0.14 to its knuckle, its curled talons
  // 0.283 on, measured in the browser), so the talons' tips touch the boards, never sink into them
  guardBody(g, _bd);
  const a = clamp((_bd.shoulder.x - L.hx) * L.dx + (_bd.shoulder.z - L.hz) * L.dz, 0.25, LEAF.w - 0.1);
  const Q = CUTAWAY.guard;
  const ct = g.contact;
  ct.leaf = i; ct.nx = L.nx; ct.nz = L.nz;
  ct.x = L.hx + a * L.dx + LEAF.face * L.nx; ct.z = L.hz + a * L.dz + LEAF.face * L.nz; ct.y = Q.hand;
  g.hand.x = ct.x + Q.wrist * L.nx; g.hand.y = Q.hand; g.hand.z = ct.z + Q.wrist * L.nz;
  return g;
}

// the guard's way, worked out once: where it stands at each phase's ends and how far it walks
const POSE = (() => {
  const q = { contact: {}, hand: {} };
  const at = (i, ang) => { holdPose(i, ang, q); return { x: q.x, z: q.z, h: q.heading }; };
  const Q = CUTAWAY.guard;
  const w0 = at(0, LV[0].open); const w1 = at(0, 0); const e0 = at(1, LV[1].open); const e1 = at(1, 0);
  const next = Q.via || w0; // where it walks in toward from its wait: by `via`, or straight to the west leaf
  const wait = { x: Q.wait.x, z: Q.wait.z, h: Math.atan2(-(next.x - Q.wait.x), -(next.z - Q.wait.z)) };
  const radius = (i) => { const p = LV[i].hold; return Math.hypot(p.al, p.be); }; // it turns with the leaf about the hinge
  const len = [
    Math.hypot(wait.x - POST.x, wait.z - POST.z),
    Q.via ? Math.hypot(Q.via.x - wait.x, Q.via.z - wait.z) + Math.hypot(w0.x - Q.via.x, w0.z - Q.via.z) : Math.hypot(w0.x - wait.x, w0.z - wait.z),
    radius(0) * LV[0].open,
    Math.hypot(Q.stepVia.x - w1.x, Q.stepVia.z - w1.z) + Math.hypot(e0.x - Q.stepVia.x, e0.z - Q.stepVia.z),
    radius(1) * LV[1].open,
  ];
  return Object.freeze({ post: { x: POST.x, z: POST.z, h: POST.yaw }, wait, w0, w1, e0, e1, len });
})();

/**
 * Along a walk from a to b (by `via`, or straight), k 0..1 of the way (eased), its heading turning
 * from a's to the way and on to b's; or, `turn` set, from a's straight round to b's in the middle of
 * the walk (where there is room for its spikes and pike), stepping on at its own pace.
 */
function walkAlong(a, b, via, k, g, turn = false) {
  const e = smooth(k);
  const l1 = via ? Math.hypot(via.x - a.x, via.z - a.z) : 0;
  const l2 = via ? Math.hypot(b.x - via.x, b.z - via.z) : Math.hypot(b.x - a.x, b.z - a.z);
  const d = e * (l1 + l2);
  let wx; let wz;
  if (via && d < l1) { const f = d / l1; g.x = a.x + (via.x - a.x) * f; g.z = a.z + (via.z - a.z) * f; wx = via.x - a.x; wz = via.z - a.z; }
  else { const s0 = via || a; const f = l2 > 0 ? (d - l1) / l2 : 1; g.x = s0.x + (b.x - s0.x) * f; g.z = s0.z + (b.z - s0.z) * f; wx = b.x - s0.x; wz = b.z - s0.z; }
  if (turn) { g.heading = a.h + wrapPi(b.h - a.h) * smooth((k - 0.1) / 0.8); return (l1 + l2) * e; } // a heavy turn, over most of the step (the critic: no spin)
  const way = Math.hypot(wx, wz) > 1e-6 ? Math.atan2(-wx, -wz) : b.h;
  let h = way + wrapPi(a.h - way) * (1 - smooth(k / 0.3));
  h += wrapPi(b.h - h) * smooth((k - 0.65) / 0.35);
  g.heading = h;
  return (l1 + l2) * e;
}

/** A walk's stepping: up as it sets off, down as it arrives (0..1). */
const stepping = (k) => smooth(k / 0.15) * (1 - smooth((k - 0.85) / 0.15));

/** The fighting suit `u` seconds into the run beat, given the leaves' angles: into g. */
function stageGuard(u, ang, g) {
  const Q = CUTAWAY.guard; const P = POSE; const len = P.len;
  g.active = true; // the film holds it through the run beat (square at its post, not turning to the camera)
  const ph = (a) => (u - a[0]) / (a[1] - a[0]);
  if (u < Q.toWait[0]) return; // at its post, as the real scene stands it
  let walked = 0;
  if (u < Q.toWait[1]) { const k = ph(Q.toWait); g.walked = walkAlong(P.post, P.wait, null, k, g, true); g.move = stepping(k); return; } // a heavy turn as it goes
  walked += len[0];
  if (u < Q.in[0]) { g.x = P.wait.x; g.z = P.wait.z; g.heading = P.wait.h; g.walked = walked; return; }
  if (u < Q.in[1]) { const k = ph(Q.in); g.walked = walked + walkAlong(P.wait, P.w0, Q.via, k, g, true); g.move = stepping(k); g.reach = smooth((k - 0.7) / 0.3); return; }
  walked += len[1];
  g.reach = 1;
  if (u < LV[0].at[0]) { holdPose(0, ang[0], g); g.walked = walked; return; }
  if (u < Q.step[0]) { holdPose(0, ang[0], g); g.walked = walked + len[2] * leafClosed(0, u); g.move = stepping(clamp(ph(LV[0].at))); return; }
  walked += len[2];
  if (ph(Q.step) < 1 - 1e-9) {
    const k = ph(Q.step);
    g.walked = walked + walkAlong(P.w1, P.e0, Q.stepVia, k, g, true); g.move = stepping(k);
    g.reach = 1 - Math.sin(Math.PI * k); // the claw off the first leaf, round, and onto the second
    g.contact.leaf = -1;
    holdHand(g);
    return;
  }
  walked += len[3];
  holdPose(1, ang[1], g);
  g.walked = walked + len[4] * leafClosed(1, u);
  g.move = u < LV[1].at[1] ? stepping(clamp(ph(LV[1].at))) : 0;
}

/** Between the leaves: the hand comes back to the side and goes out again (no contact). */
function holdHand(g) {
  guardBody(g, _bd);
  const fx = -Math.sin(g.heading); const fz = -Math.cos(g.heading);
  g.hand.x = _bd.shoulder.x + fx * 0.6; g.hand.y = CUTAWAY.guard.hand; g.hand.z = _bd.shoulder.z + fz * 0.6;
}

/** a - the nearest whole turn: in (-pi, pi]. */
function wrapPi(a) {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

/** The dip to black at the film's end: 0 until its last CUTAWAY.fade seconds, 1 at its end (main.js draws it). */
export function cutawayBlack(t) {
  return smooth((t - (CUTAWAY.total - CUTAWAY.fade)) / CUTAWAY.fade);
}

// ---- the film's light ----------------------------------------------------------------------------

/**
 * The film's light (the owner, 2026-11-18: "the entire scene of the werewolf running into the castle
 * should be in the same time of day as when the boulder falls with the same lighting/coloring etc."):
 * from its first frame to its last, every beat (the dust, the face, the run along the castle's real
 * front, the doors and the guard) is lit by the road's light at the dark the film began on, which is
 * the boulder moment's (the sim is frozen under the film, so it is the frame the boulder fell's, to
 * the step or two the warden may have taken while it fell). roadOn 1: the road's light holds, with no
 * hand-over to the castle's own moonlit night at the gate's threshold. null when the cutaway is not
 * playing: then the road lights itself from its ratchet, exactly as before the film. Into out:
 * { beat, dark, roadOn, front, key, fill, floor, floorHex, tint, deck, torch } (CUTAWAY.sun on the
 * castle front; on the road's beats key 0, fill 1, floor 1, floorHex null, tint null, deck 0, torch 1).
 */
export function filmLightAt(sim, out = {}) {
  const s = sim && sim.waves && sim.waves.scene;
  if (!s || s.kind !== 'cutaway') return null;
  const road = sim.waves.road;
  out.beat = beatAt(s.t || 0);
  out.dark = Number.isFinite(s.dark) ? s.dark : road && Number.isFinite(road.dark) ? road.dark : 0;
  out.roadOn = 1;
  // the castle front (the run beat): the same sun, given a direction (CUTAWAY.sun); the road's
  // beats exactly the boulder frame's light, nothing added
  const front = out.beat === 'run';
  const S = CUTAWAY.sun;
  out.front = front;
  out.key = front ? S.key : 0;
  out.fill = front ? S.fill : 1;
  out.floor = front ? S.floor : 1;
  out.floorHex = front ? S.floorHex : null;
  out.tint = front ? S.tint : null;
  out.deck = front ? S.deck : 0;
  out.torch = front ? S.torch : 1;
  return out;
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
    dark: w.road.dark, // the time of day the whole film is held at (filmLightAt)
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
    // each thud as its leaf visibly comes to the stop (the critic), the bar after the second
    const stop = (l) => run + l.at[0] + CUTAWAY.swing.settle * (l.at[1] - l.at[0]);
    for (const l of CUTAWAY.leaves) if (crossed(stop(l))) events.push({ type: 'cutawayDoor' });
    if (crossed(stop(CUTAWAY.leaves[1]) + CUTAWAY.bar)) events.push({ type: 'cutawayBar' });
  }
  if (!skipped && s.t < s.total) return true;
  w.scene = null;
  if (w.road && w.road.cutaway) w.road.cutaway.state = 'done';
  events.push({ type: 'sceneEnd', kind: 'cutaway', skipped });
  return true;
}
