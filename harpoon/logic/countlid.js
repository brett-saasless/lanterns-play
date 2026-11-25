// The Count's lid and how he comes up under it, as rules (the owner, 2026-11-19: "a coffin lid is
// solid like a door and should be treated like a door. his hand should push the lid open similar to
// the guard closing the front door in the cut scene"). Pure: no DOM, no three, no randomness, no
// allocation per call (the views pass `out` objects made once).
//
// Both views read this one answer, so they cannot disagree: keepprops.js turns the lid to
// `stage.lid`, keepcast.js poses him (his hand on the lid's inner face, his torso down until the
// lid is clear). The lid's angle is the master; his hand rides it, as the fighting suit's claw rides
// the door leaf in the werewolf cutaway (cutaway.js holdPose).
//
// The lid is hinged along the box's east long edge (the windows' side). Its angle `a` turns it about
// the hinge line (keepprops: rotation.z = -a): 0 shut, pi/2 standing on its hinge, past that it
// falls east and comes to rest as a ramp from the rim to the floor (LID.rest), below the rim's sight
// lines from the west (the death scene's camera) and beyond the box, so it never hides him.
//
// Two clocks. The lid runs on `lidClock`: his rise plus the rise each side curtain's recoil took
// back (count.js openCurtain: recoil seconds lost per side curtain). It never runs backwards, so a
// lid once thrown back stays back and a push never un-pushes: the recoil throws HIM back (his body
// runs on the rise itself, which the recoil sets back), never the lid. Both clocks advance with the
// rise, so his pace (1, 0.8, 0.6) slows every beat, never the wall clock. Since lidClock >= rise,
// the lid only ever leads his body: what the body may do at rise r the lid allowed at r already.

import { COUNT_ROOM } from './keepmap.js';
import { COUNT_TUNE, COUNT_FLOOR, FINAL_CURTAIN, riseLimit } from './count.js';

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };
/** Cubic Hermite from p0 to p1 over u 0..1, m0 and m1 the slopes per unit u (rad/s times the span). */
function herm(p0, p1, m0, m1, u) {
  const u2 = u * u; const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}

const B = COUNT_ROOM.box;
const BW = B.maxX - B.minX;
const BL = B.maxZ - B.minZ;

/**
 * The lid as built (keepprops.js builds it from these): hinged on the line x = hingeX, y = hingeY
 * (world), running along z through z; len across (hinge to free edge), half its length along the
 * box halfZ, a slab `thick` deep (its inner face, toward him, at the hinge line's height when shut),
 * iron straps `strap` proud of its outer face. rest: the angle it lies at thrown back, the outer
 * corner of its free edge (strap and all) on the floor.
 */
export const LID = (() => {
  const L = {
    hingeX: B.maxX + 0.03,
    hingeY: COUNT_FLOOR + B.h - 0.03,
    z: (B.minZ + B.maxZ) / 2,
    len: BW + 0.06,
    halfZ: BL / 2 + 0.03,
    thick: 0.04,
    strap: 0.012,
  };
  // rest: solve len sin a + (thick + strap) cos a = floor - hingeY for a in (pi, 3pi/2), by halving
  const h = L.thick + L.strap; const drop = COUNT_FLOOR - L.hingeY;
  let lo = Math.PI; let hi = 1.5 * Math.PI;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (L.len * Math.sin(m) + h * Math.cos(m) > drop) lo = m; else hi = m; }
  L.rest = (lo + hi) / 2;
  return Object.freeze(L);
})();

/**
 * The beats, in seconds of the lid's clock (his rise; at pace 1 these are wall seconds). crack: the
 * lid lifts off its seat to `crack` (a dark slit, nothing of him in it). reach: his hand comes up
 * from his side to the lid's inner face. push: the hand pushes it up to `pushTo`, leaving it moving
 * at `pushOut` rad/s. coast: it creeps over the top (pi/2) to `coastTo`. fall: the heavy fall east,
 * gathering and slowing to meet the floor at `land` rad/s (its peak about the door precedent's 0.76,
 * cutaway.js swing). bounce: it rebounds `bounceBy` rad off the floor (the impact turns it back at
 * under a third of its landing speed), then lies flush. release: the hand leaves the lid (pushTo is past 1.45 rad)
 * and goes to the rim. The hand's contact on the face: `d` metres from the hinge (from d[0] at the
 * crack to d[1] at pushTo: it slides a little toward the hinge as the lid swings over it), at `z`
 * off the box's middle (over his chest), the wrist `wrist` off the face (its palm's half depth,
 * measured in the browser, plus a hair). prop: how far he props up on the pushing elbow (a share of
 * the sit) as the lid goes from prop[0] to prop[1] rad. up: the rise (not the lid's clock) at which
 * he begins to sit up; the lid is long past vertical by then on any clock.
 */
export const LID_BEATS = Object.freeze({
  crack: Object.freeze([0, 4]), crackTo: 0.1,
  reach: Object.freeze([4, 8.5]),
  push: Object.freeze([9, 13.5]), pushTo: 1.5, pushOut: 0.22,
  coast: Object.freeze([13.5, 14.5]), coastTo: 1.66, coastOut: 0.15,
  fall: Object.freeze([14.5, 18.1]), land: 0.55,
  bounce: Object.freeze([18.1, 18.7]), bounceBy: 0.03,
  release: Object.freeze([13.5, 14.6]),
  d: Object.freeze([0.62, 0.5]), z: -0.48, wrist: 0.055,
  prop: Object.freeze([0.3, 1.2]), propBy: 0.18,
  up: 15,
});

/**
 * His body after `up` (shares of the rise left, limit - up, so deaths' extra time is spread over
 * it): he sits up over sitUp, holds, then stands over the last `stand`; his west hand takes the rim
 * over grip of the sit-up's start. The pyre (count.js PYRE_STAGES): the lid, wherever it was, is
 * flung back, `fling` seconds a radian it has to go (at least flingMin s, at most flingMax s;
 * twice as long, to flingMaxReduced, with reduced motion), so its peak is 1.5 / fling rad/s (1.2)
 * and nothing flies by; he comes up (keepcast's 0.6 s, 1.2 s reduced) only once it is past `clear`
 * rad.
 */
export const BODY_BEATS = Object.freeze({ sitUp: 0.4, stand: 0.4, grip: 0.24, fling: 1.25, flingMin: 1, flingMax: 4.8, flingMaxReduced: 6, clear: 1.45 });

/** Seconds the pyre's fling of the lid takes from angle a0 (BODY_BEATS fling). */
export function flingTime(a0, reduced = false) {
  const K = BODY_BEATS;
  const T = Math.min(K.flingMax, Math.max(K.flingMin, K.fling * Math.max(0, LID.rest - a0)));
  return reduced ? Math.min(K.flingMaxReduced, 2 * T) : T;
}

/**
 * Seconds on the lid's clock: the rise plus the rise the side curtains' recoils actually took back
 * (count.js keeps it as c.lost: a recoil at a rise under 4 s takes only what there was, so the lid
 * never snaps forward). It never runs back. A count state from before c.lost was kept counts the
 * full recoil for each open side curtain.
 */
export function lidClock(c, cfg) {
  if (!c || c.phase === 'box') return 0;
  const rise = Number.isFinite(c.rise) ? Math.max(0, c.rise) : 0;
  if (Number.isFinite(c.lost)) return rise + Math.max(0, c.lost);
  const t = cfg && cfg.count && Number.isFinite(cfg.count.recoil) ? cfg.count.recoil : COUNT_TUNE.recoil;
  let sides = 0;
  if (Array.isArray(c.open)) for (let i = 0; i < c.open.length; i++) if (i !== FINAL_CURTAIN && c.open[i]) sides++;
  return rise + t * sides;
}

/** The lid's angle at `v` seconds of its clock: one continuous curve, shut to rest. */
export function lidAngle(v) {
  const Q = LID_BEATS;
  if (!(v > 0)) return 0;
  const span = (p) => (v - p[0]) / (p[1] - p[0]);
  if (v < Q.crack[1]) return Q.crackTo * smooth(span(Q.crack));
  if (v < Q.push[0]) return Q.crackTo;
  if (v < Q.push[1]) {
    const T = Q.push[1] - Q.push[0];
    return herm(Q.crackTo, Q.pushTo, 0, Q.pushOut * T, span(Q.push));
  }
  if (v < Q.coast[1]) {
    const T = Q.coast[1] - Q.coast[0];
    return herm(Q.pushTo, Q.coastTo, Q.pushOut * T, Q.coastOut * T, span(Q.coast));
  }
  if (v < Q.fall[1]) {
    const T = Q.fall[1] - Q.fall[0];
    return herm(Q.coastTo, LID.rest, Q.coastOut * T, Q.land * T, span(Q.fall));
  }
  if (v < Q.bounce[1]) return LID.rest - Q.bounceBy * Math.sin(Math.PI * span(Q.bounce));
  return LID.rest;
}

/**
 * The point `d` metres from the hinge on the lid's inner face at angle `a`, into out (world x, y;
 * z is the caller's), with the face's inward normal (nx, ny: toward him) and the way along it from
 * the hinge to the free edge (tx, ty).
 */
export function lidFace(a, d, out) {
  const c = Math.cos(a); const s = Math.sin(a);
  out.tx = -c; out.ty = s;
  out.nx = -s; out.ny = -c;
  out.x = LID.hingeX + d * out.tx;
  out.y = LID.hingeY + d * out.ty;
  return out;
}

/**
 * True when the world point (x, y) is on the far side of the lid's inner face at angle `a` and
 * within its span from the hinge (the lid's boards or beyond them): what must never hold for any
 * part of him. Along z the footprint is the whole lid (|z - LID.z| <= halfZ); the caller checks z.
 */
export function beyondLid(a, x, y) {
  const c = Math.cos(a); const s = Math.sin(a);
  const rx = x - LID.hingeX; const ry = y - LID.hingeY;
  const along = rx * -c + ry * s;
  const out = rx * s + ry * c; // along the outward normal (-nx, -ny)
  return along >= 0 && along <= LID.len && out > 0;
}

const _f = { x: 0, y: 0, tx: 0, ty: 0, nx: 0, ny: 0 };

/** How far his hand is on the lid at `v` (0 off it, 1 on it). */
export function handReach(v) {
  const Q = LID_BEATS;
  return smooth((v - Q.reach[0]) / (Q.reach[1] - Q.reach[0])) * (1 - smooth((v - Q.release[0]) / (Q.release[1] - Q.release[0])));
}

/** How far he props on the pushing elbow at lid angle a (a share of the sit, 0..propBy). */
export function propAt(a) {
  const Q = LID_BEATS;
  return Q.propBy * smooth((a - Q.prop[0]) / (Q.prop[1] - Q.prop[0]));
}

/** Seconds into the pyre scene (count.js startScene: its own clock t, or what is gone of it), or NaN with no pyre playing. */
export function pyreClock(w) {
  const sc = w && w.scene;
  if (!sc || sc.kind !== 'pyre') return NaN;
  if (Number.isFinite(sc.t)) return sc.t;
  if (Number.isFinite(sc.left)) return (Number.isFinite(sc.total) ? sc.total : 10) - sc.left;
  return NaN;
}

/** A fresh stage for countStage to fill (one per view, made once). */
export function newCountStage() {
  return {
    phase: 'box', v: 0, rise: 0, limit: 0, lid: 0, reach: 0, onLid: false,
    contact: { x: 0, y: 0, z: 0 }, wrist: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, along: { x: 0, y: 0, z: 0 },
    sit: 0, stand: 0, grip: [0, 0], release: 0, up: 0, burn: -1, shown: false,
  };
}

/**
 * The stage of his rise both views draw, worked out from the sim alone (and the pyre's clock).
 * sim: { cfg, waves: { count, game } }; burn: seconds into the pyre (NaN when there is none);
 * reduced: reduced motion (he comes up over 1.2 s instead of 0.6 s in the pyre). Into out
 * (newCountStage()): phase; v (the lid's clock); lid (angle, rad); reach (0..1, the east hand on
 * the lid's inner face) with contact (world point on the face), wrist (where the wrist goes:
 * contact + normal * wrist), normal (the face's inward normal), along (hinge to free edge); sit and
 * stand (0..1 each: his torso up, then him on his feet); grip[i] (hand i on the rim: 0 his west
 * hand, 1 his east, which first pushes the lid); release (0..1: the east hand gone from the lid);
 * up (0..1, the pyre: he comes up into the light); shown (he is drawn at all).
 */
export function countStage(sim, burn, reduced, out) {
  const w = sim && sim.waves;
  const c = w && w.count;
  const Q = LID_BEATS; const K = BODY_BEATS;
  out.phase = c ? c.phase : 'box';
  out.reach = 0; out.onLid = false; out.sit = 0; out.stand = 0; out.grip[0] = 0; out.grip[1] = 0; out.release = 0; out.up = 0; out.burn = -1;
  if (!c || c.phase === 'box') { out.v = 0; out.lid = 0; out.shown = false; return out; }
  if (c.phase === 'ash') { out.v = Infinity; out.lid = LID.rest; out.shown = false; return out; }
  const deaths = w.game && Number.isFinite(w.game.countDeaths) ? w.game.countDeaths : 0;
  const limit = riseLimit(sim.cfg, deaths);
  const rise = clamp(Number.isFinite(c.rise) ? c.rise : 0, 0, limit);
  const v = lidClock(c, sim.cfg);
  out.v = v; out.rise = rise; out.limit = limit; out.shown = true;
  let a = lidAngle(v);
  // his body, on the rise: down until `up`, then the sit-up, a hold, and the stand, shared over what is left
  const R = Math.max(1e-6, limit - Q.up);
  const u = (rise - Q.up) / R;
  let sit = Math.max(smooth(u / K.sitUp), propAt(a));
  let stand = smooth((u - (1 - K.stand)) / K.stand);
  let grip0 = smooth(u / K.grip);
  let reach = handReach(v);
  let release = smooth((v - Q.release[0]) / (Q.release[1] - Q.release[0]));
  if (c.phase === 'lurch') { sit = 1; stand = 1; grip0 = 1; reach = 0; release = 1; }
  if (c.phase === 'burning') {
    // the pyre: the lid is flung back from wherever it was, and he comes up into the light once it is clear
    // (no pyre clock, NaN: its first moment, so every view reads the same stage)
    const t = Number.isFinite(burn) ? Math.max(0, burn) : 0;
    out.burn = t;
    const a0 = a;
    const T = flingTime(a0, reduced);
    const k = smooth(t / T);
    a = a0 >= LID.rest - 1e-9 ? a0 : lerp(a0, LID.rest, k);
    // when the fling passes `clear` (inverse smoothstep): his rise into the light waits for it
    const q = a0 >= K.clear ? 0 : clamp((K.clear - a0) / (LID.rest - a0));
    const wait = q > 0 ? T * (0.5 - Math.sin(Math.asin(1 - 2 * q) / 3)) : 0;
    const up = smooth((t - wait) / (reduced ? 1.2 : 0.6));
    out.up = up;
    sit = lerp(sit, 1, up); stand = lerp(stand, 1, up); grip0 = lerp(grip0, 0, up);
    reach *= 1 - smooth(t / 0.3); release = Math.max(release, smooth(t / 0.3));
  }
  out.lid = a;
  out.sit = sit; out.stand = stand; out.grip[0] = grip0; out.grip[1] = release; out.release = release;
  out.reach = reach;
  // the east hand on the lid's inner face: the contact rides the lid, the wrist off it along the normal
  const s = clamp((a - Q.crackTo) / (Q.pushTo - Q.crackTo));
  const f = lidFace(Math.min(a, Q.pushTo + 0.3), lerp(Q.d[0], Q.d[1], s), _f);
  out.contact.x = f.x; out.contact.y = f.y; out.contact.z = LID.z + Q.z;
  out.normal.x = f.nx; out.normal.y = f.ny; out.normal.z = 0;
  out.along.x = f.tx; out.along.y = f.ty; out.along.z = 0;
  out.wrist.x = f.x + f.nx * Q.wrist; out.wrist.y = f.y + f.ny * Q.wrist; out.wrist.z = out.contact.z;
  out.onLid = reach > 0.999 && a <= Q.pushTo + 1e-9;
  return out;
}

/**
 * The thrown-back lid as a solid (the owner: "a coffin lid is solid like a door"): the ramp's
 * footprint from the box's east rim to its foot on the floor, along the whole lid, its rim height
 * tall. The collision is in the plan only (collide.js), so one box hugs the ramp: from the box's
 * edge to 3 cm past its foot. It stands once the lid has fallen past `LID_SOLID_FROM` rad (keep.js
 * keepBoxes reads lidBox every frame); before that the lid is over the box, which is boxed.
 */
export const LID_SOLID_FROM = 3.0;
export const LID_BOX = Object.freeze((() => {
  const foot = LID.hingeX - LID.len * Math.cos(LID.rest) + (LID.thick + LID.strap) * Math.sin(LID.rest - Math.PI) + 0.03;
  const minX = B.maxX; const maxX = foot; const minZ = LID.z - LID.halfZ; const maxZ = LID.z + LID.halfZ; const h = LID.hingeY - COUNT_FLOOR + LID.thick;
  return { kind: 'countLid', x: (minX + maxX) / 2, z: LID.z, w: maxX - minX, d: maxZ - minZ, h, minX, maxX, minY: 0, maxY: h, minZ, maxZ };
})());

const _solidStage = newCountStage();
const _solidSim = { cfg: null, waves: null };

/** LID_BOX while the lid lies thrown back (or is falling the last of the way), else null. */
export function lidBox(cfg, w) {
  const c = w && w.count;
  if (!c || c.phase === 'box') return null;
  if (c.phase === 'ash') return LID_BOX;
  _solidSim.cfg = cfg; _solidSim.waves = w;
  countStage(_solidSim, pyreClock(w), false, _solidStage);
  return _solidStage.lid >= LID_SOLID_FROM ? LID_BOX : null;
}
