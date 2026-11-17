// The road from the wood's end to the castle's drawbridge (issue #29, the owner's spec and mood
// record): about a minute's walk up a rutted dirt road in five switchbacks, sunset going to night
// as the warden climbs, and two scares that frighten and never touch: a boulder (and a second,
// half its size) that bounds across the road a few metres ahead, and a swarm of bats from a
// roadside cave followed, a step or two later, by one giant bat. And one glimpse, for a warden who
// looks up to where the boulder came from: something that pushed it, running away up the hill. Nothing here hurts: this file never imports the hurt path, has no
// damage number, and nothing on the road is a creature (tests/road.test.js checks all three).
//
// Pure and seeded. The geometry is data (keepmap.js reads RECTS as the 'road' zone, its floor
// from roadFloor); the state lives in sim.waves.road (keep.js creates it, keeps it across every
// restore and steps it). `dark` is a one-way ratchet: the highest progress up the road reached so
// far, never recomputed from where the warden stands now. The boulder and the bats are latched:
// each runs once, and a latch stays set across restores.
// Castle coordinates: north is -z; the approach and the gate are at z 44, the road runs south of it.

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};
const R = (minX, maxX, minZ, maxZ) => ({ minX, maxX, minZ, maxZ });
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const smooth = (k) => { const c = clamp(k); return c * c * (3 - 2 * c); };

/**
 * The centreline, foot to gate: out of the wood's edge at the hill's east foot and west along
 * the bottom (leg 1, the low sun ahead and to the left over open ground, as at the wood's end),
 * then four more legs across the hillside (east, west, east, then west to the middle) joined by
 * hairpins, and the top stretch north to the approach's gate.
 */
export const LINE = f([
  [48, 104], [-31, 104], [-31, 92], [31, 92], [31, 80], [-31, 80], [-31, 68], [31, 68], [31, 56], [0, 56], [0, 44],
]);

/**
 * The road's clear floor: one rectangle per stretch, none overlapping, each sharing an edge with
 * the next (so keepmap.js walls the outside edges and opens the joins). 4 m wide, 3 m at the gate.
 */
export const RECTS = f([
  R(-33, 50, 102, 106), // leg 1, east to west from the wood's edge (its east end)
  R(-33, -29, 94, 102), // hairpin
  R(-33, 33, 90, 94), // leg 2, west to east: the boulder
  R(29, 33, 82, 90), // hairpin
  R(-33, 33, 78, 82), // leg 3, east to west
  R(-33, -29, 70, 78), // hairpin
  R(-33, 33, 66, 70), // leg 4, west to east: the bats' cave
  R(29, 33, 58, 66), // hairpin
  R(-1.5, 33, 54, 58), // leg 5, east to the middle
  R(-1.5, 1.5, 44, 54), // the top stretch, north through the open gate onto the approach
]);

/** The stretches the scares are on (indexes into RECTS and the centreline's segments). */
const BOULDER_RECT = 2;
const BATS_RECT = 6;

const SEGS = (() => {
  const out = [];
  let s = 0;
  for (let i = 0; i + 1 < LINE.length; i++) {
    const [ax, az] = LINE[i];
    const [bx, bz] = LINE[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    out.push({ ax, az, bx, bz, len, s0: s, dx: (bx - ax) / len, dz: (bz - az) / len });
    s += len;
  }
  return f(out);
})();

/** The road's length along its centreline, foot to gate (metres). */
export const LENGTH = SEGS[SEGS.length - 1].s0 + SEGS[SEGS.length - 1].len;

export const ROAD = f({
  rise: 30, // metres from the foot up to the approach (the castle's ground, y 0)
  footY: -30,
  // Where a journey from the wood arrives: at the east end of leg 1, where it leaves the wood,
  // facing west along it. The wood's end faced north; `turn` is the quarter turn from the wood's
  // frame to the road's (the warden's facing, the sun and the side offset all turn with it, so
  // what was ahead is still ahead). halfWidth: how far to either side the arrival may be seated.
  // The foot is in the tunnel the wood's end runs into (#29 G29a, engine/tunnel.js): its mouth at
  // tunnel.mouthX, shut behind at backX, so the warden walks out of it onto the road.
  foot: { x: 48.5, z: 104, yaw: Math.PI / 2, turn: Math.PI / 2, halfWidth: 1.4, tunnel: { mouthX: 42.5, backX: 51.6 } },
  // The boulder (a startle, then unease): it lets go from the bank above leg 2 as the warden
  // crosses `at` (metres up the road), falls `fall` seconds down the bank, then crosses the road
  // `ahead` metres or more ahead of the warden in `cross` seconds, lands once on it (the thud and
  // the shake) and is gone down the slope below by `gone`. radius: the stone's.
  // cross 0.6 s is 4 m at ~6.7 m/s, rolling (spin = distance / radius), so it has weight (review A12);
  // then a short, steep drop off the downhill edge, gone by 2.0 s.
  // The owner (pass 2, A13): twice as large (radius 1.1), and 5 to 7 smaller rocks coming down
  // with it (BOULDER_ROCKS): still a clear near miss, rocks and all.
  boulder: { at: 122, ahead: 4, fall: 0.8, cross: 0.6, gone: 2.0, radius: 1.1, bankZ: 84.5, belowZ: 106, top: 3.2 },
  // The bats (a double startle): the cave is in the bank on the uphill side of leg 4. Crossing
  // `at` lets the swarm out; it streams across the road over the warden's head for `swarm`
  // seconds, and until it has cleared the road nothing passes the trigger point (`block`, the
  // block's near face `gap` past it). Then, on the warden's `steps`th step past the trigger
  // point (2 or 3, from the run's seed), one giant bat flies out, across and away in `giant` s.
  // The cave is 12 m on from the trigger point: the swarm streams back from it over the warden's
  // head, and two or three steps on, the giant bat comes out of it just ahead.
  // The glimpse (the owner, pass 3: "if the user looks up to where the boulder came from a hybrid
  // creature runs up the hill away from the user and out of sight. it runs up the hill, not up the
  // road; it does not attack"): from the crack until `window` seconds after the boulder is gone, a
  // warden looking up (pitch at least `minPitch`) within `cone` radians of the place it let go
  // (their eye `eye` above their feet) sees it once. It runs `run` seconds straight up the hillside
  // from just behind the outcrop (z `from`) across leg 3 and the bank above it to the crest of leg 4's
  // shelf (z `to`), drifting `drift` metres back from the cave's side, and sinks `sink` metres over
  // the crest in the last fifth: out of sight from the road below, and gone for good. `ease`: its
  // speed at the start as a share of its mean (it is already running when seen; it only gathers
  // pace). `stride`: metres of ground per loping stride (the view's limbs). Nothing on it is a strike.
  creature: { window: 3, cone: 0.42, minPitch: 0.1, eye: 1.65, run: 2.6, from: 83.2, to: 67, drift: 1.2, sink: 2, ease: 0.7, stride: 2.6 },
  bats: { at: 268, cave: { x: 10, z: 63.4, y: 1.8 }, swarm: 2.6, gap: 0.6, steps: [2, 3], giant: 1.8 },
});

/** The stretch a point is on: the index into RECTS, or -1 off the road. */
export function rectAt(x, z) {
  for (let i = 0; i < RECTS.length; i++) {
    const r = RECTS[i];
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return i;
  }
  return -1;
}

/** True when (x, z) is on the road's floor. */
export function onRoad(x, z) {
  return rectAt(x, z) >= 0;
}

const project = (g, x, z) => g.s0 + g.len * clamp(((x - g.ax) * g.dx + (z - g.az) * g.dz) / g.len);

/**
 * In the square where leg i (it runs along x) meets turn j (along z): the station swings round the
 * square's inner corner (the bank's corner) from the leg's value on its side to the turn's value on
 * its side, so the floor is continuous on both edges and climbs smoothly through the bend.
 */
function cornerStation(i, j, x, z) {
  const leg = RECTS[i];
  const turn = RECTS[j];
  const sq = { minX: turn.minX, maxX: turn.maxX };
  const legBeyond = leg.maxX > sq.maxX + 1e-9 ? 1 : -1; // the rest of the leg lies toward +x or -x
  const turnBeyond = turn.maxZ <= leg.minZ + 1e-9 ? -1 : 1; // the turn lies toward -z or +z
  const ix = legBeyond > 0 ? sq.maxX : sq.minX;
  const iz = turnBeyond < 0 ? leg.minZ : leg.maxZ;
  const sLeg = project(SEGS[i], ix, z);
  const sTurn = project(SEGS[j], x, iz);
  const a = Math.abs(ix - x); // into the square from the leg's edge
  const b = Math.abs(iz - z); // into the square from the turn's edge
  const k = a + b < 1e-9 ? 0.5 : Math.atan2(a, b) / (Math.PI / 2);
  return sLeg + (sTurn - sLeg) * k;
}

/**
 * Metres up the road (0 at the foot, LENGTH at the gate) at (x, z). On the road, the stretch's
 * own centreline answers, and a leg's corner square (where it meets a hairpin or the top stretch)
 * is the turn's: so the floor never jumps a step at a corner. Off the road: the nearest point.
 */
export function stationAt(x, z) {
  const i = rectAt(x, z);
  if (i >= 0) {
    for (const j of [i - 1, i + 1]) {
      const r = RECTS[j];
      if (r && i % 2 === 0 && x >= r.minX && x <= r.maxX) return cornerStation(i, j, x, z);
    }
    return project(SEGS[i], x, z);
  }
  let best = Infinity;
  let at = 0;
  for (const g of SEGS) {
    const t = clamp(((x - g.ax) * g.dx + (z - g.az) * g.dz) / g.len);
    const px = g.ax + g.dx * g.len * t;
    const pz = g.az + g.dz * g.len * t;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < best - 1e-9) { best = d; at = g.s0 + g.len * t; }
  }
  return at;
}

/** The centreline point `s` metres up the road, with the way the road runs there: { x, z, dx, dz }. */
export function pointAt(s) {
  const k = clamp(s, 0, LENGTH);
  let g = SEGS[SEGS.length - 1];
  for (const q of SEGS) if (k <= q.s0 + q.len) { g = q; break; }
  const t = (k - g.s0) / g.len;
  return { x: g.ax + (g.bx - g.ax) * t, z: g.az + (g.bz - g.az) * t, dx: g.dx, dz: g.dz };
}

/** The road's height `s` metres up: a steady climb from the foot to the approach. */
export function heightAt(s) {
  return ROAD.footY + ROAD.rise * clamp(s / LENGTH);
}

/** The floor under (x, z) on the road, or null off it (keepmap.js baseFloor reads it). */
export function roadFloor(x, z) {
  return onRoad(x, z) ? heightAt(stationAt(x, z)) : null;
}

/** How far up the road (x, z) is, 0 at the foot to 1 at the gate; 1 past the gate (the approach and the castle). */
export function progressAt(x, z) {
  if (onRoad(x, z)) return clamp(stationAt(x, z) / LENGTH);
  return z < RECTS[RECTS.length - 1].minZ + 1e-6 ? 1 : 0;
}

// ---- the road's state ------------------------------------------------------------------------

/**
 * The road's state. walked: the road already behind the warden (a title start or a checkpoint at
 * the approach): full dark, both scares spent. A journey from the wood seats a fresh one.
 */
export function createRoad(walked = true) {
  return {
    at: null, // metres up the road last frame (null off it): the scares fire on the way up past their points
    dark: walked ? 1 : 0, // the ratchet: the highest progress up the road so far, 0 to 1
    boulder: { state: walked ? 'done' : 'ready', t: 0, x: null, wx: null }, // ready | falling | done; x: where it crosses
    // ready | run | done; w: seconds since the crack (its window), t: into its run, x: where the boulder let go
    creature: { state: walked ? 'done' : 'ready', t: 0, w: 0, x: null, d: 0 }, // d: its distance from the warden last frame
    bats: { state: walked ? 'done' : 'ready', t: 0, steps: 0, need: 2 }, // ready | swarm | quiet | giant | done
  };
}

/** A road state from anything (a restore keeps the road): latches and the ratchet only ever move one way; a scare in the air is finished. */
export function settledRoad(was) {
  const r = createRoad(false);
  if (!was || typeof was !== 'object') return createRoad(true);
  r.dark = clamp(Number.isFinite(was.dark) ? was.dark : 1);
  const bo = was.boulder && was.boulder.state;
  r.boulder.state = bo === 'ready' ? 'ready' : 'done';
  // the glimpse is spent with the boulder: its window has passed (or is cut short), and once seen it is never seen again
  const cr = was.creature && was.creature.state;
  r.creature.state = r.boulder.state === 'ready' && (cr === 'ready' || cr == null) ? 'ready' : 'done';
  const bt = was.bats && was.bats.state;
  r.bats.state = bt === 'ready' ? 'ready' : 'done';
  const need = was.bats && was.bats.need;
  r.bats.need = need === 3 ? 3 : 2;
  return r;
}

/** Leg 2, where the boulder crosses, and leg 4, where the cave is: both run along x. */
const BOULDER_LEG = SEGS[BOULDER_RECT];
const BATS_LEG = SEGS[BATS_RECT];
/** The way up the road along each of those legs: +1 toward +x, -1 toward -x. */
export const BOULDER_DIR = Math.sign(BOULDER_LEG.dx);
export const BATS_DIR = Math.sign(BATS_LEG.dx);

/** The trigger point of the bats as a world x on leg 4. */
export const BATS_X = BATS_LEG.ax + BATS_LEG.dx * (ROAD.bats.at - BATS_LEG.s0);

/**
 * The swarm comes out in three uneven gusts, not a stream (review A7, A8): each `at` seconds after
 * the swarm starts, `share` of the bats, let go over `spread` seconds; every bat flies `fly` [min,
 * max] seconds from the mouth over the warden's head and away. The last is clear by ROAD.bats.swarm
 * (the road's block holds till then). The view's flock and the cue's clusters both read this.
 */
export const SWARM_GUSTS = f({
  gusts: f([f({ at: 0, share: 0.42, spread: 0.24 }), f({ at: 0.47, share: 0.38, spread: 0.2 }), f({ at: 0.86, share: 0.2, spread: 0.24 })]),
  fly: f([1.3, 1.5]),
});

/**
 * The giant bat's wing-beat (review A9): `rate` radians a second, its wings spread at the start
 * (phase 0, rising); a downstroke passes level at each of `beats` (seconds), where the cue strikes.
 */
export const GIANT_FLAP = (() => {
  const rate = 10;
  const beats = [];
  for (let k = 0; ; k++) {
    const t = (Math.PI * (2 * k + 1)) / rate;
    if (t > ROAD.bats.giant - 0.2) break;
    beats.push(Math.round(t * 1000) / 1000);
  }
  return f({ rate, beats: f(beats) });
})();
/** The boulder's trigger point as a world x on leg 2. */
export const BOULDER_X = BOULDER_LEG.ax + BOULDER_LEG.dx * (ROAD.boulder.at - BOULDER_LEG.s0);
/** True when x is at or past the bats' trigger point, going up leg 4. */
const pastBats = (x) => BATS_DIR * (x - BATS_X) >= 0;

/**
 * While the swarm is on the road: the block across leg 4 just past the trigger point, so the
 * warden cannot pass it until the swarm has cleared (keep.js keepBoxes adds it). Null otherwise.
 */
export function roadBlock(road) {
  if (!road || !road.bats || road.bats.state !== 'swarm') return null;
  const r = RECTS[BATS_RECT];
  const near = BATS_X + BATS_DIR * ROAD.bats.gap; // the block's near face, just past the trigger point
  const minX = Math.min(near, near + BATS_DIR * 0.4);
  const maxX = Math.max(near, near + BATS_DIR * 0.4);
  return {
    kind: 'swarm', x: (minX + maxX) / 2, z: (r.minZ + r.maxZ) / 2, w: maxX - minX, d: r.maxZ - r.minZ, h: 40,
    minX, maxX, minY: -40, maxY: 40, minZ: r.minZ, maxZ: r.maxZ,
  };
}

/**
 * Where the boulder is `t` seconds after it let go, given the x it crosses the road at
 * (null while it is still up the bank: the crossing is fixed when it reaches the road). Into
 * `out`: { x, y, z, spin } (spin in radians, for the view). The path: down the bank from above
 * the road, one bound onto the road, across it, and down the slope below, ending low and out of
 * sight. y is the stone's centre.
 */
export function boulderAt(t, crossX, out = {}) {
  const B = ROAD.boulder;
  const leg = RECTS[BOULDER_RECT];
  const x = crossX == null ? BOULDER_X + BOULDER_DIR * B.ahead : crossX;
  const yRoad = heightAt(BOULDER_LEG.s0 + (x - BOULDER_LEG.ax) * BOULDER_DIR);
  const up = leg.minZ; // the road's uphill edge (z 90)
  const down = leg.maxZ; // its downhill edge (z 94)
  const landT = B.fall + B.cross * 0.45; // the one bound lands on the road here
  let z; let y;
  if (t <= B.fall) {
    // down the bank: from bankZ, B.top above the road, gathering speed
    const k = t / B.fall;
    z = B.bankZ + (up - B.bankZ) * (0.5 * k + 0.5 * k * k); // not so fast at the foot that the road's roll is a stall
    // it ends at the crossing arc's start (0.9 m up), so there is no jump onto the road
    y = yRoad + B.radius + 0.9 + (B.top - 0.9) * (1 - k * k) + 0.6 * Math.sin(Math.PI * k) * (1 - k);
  } else if (t <= B.fall + B.cross) {
    // across the road: a low arc that lands once, then a second, lower one off the edge
    const k = (t - B.fall) / B.cross;
    z = up + (down - up) * k;
    const a = t <= landT ? (t - B.fall) / (landT - B.fall) : (t - landT) / (B.fall + B.cross - landT);
    y = yRoad + B.radius + (t <= landT ? 0.9 * (1 - a) * (1 - a) : 0.5 * Math.sin(Math.PI * a));
  } else {
    // down the slope below, falling away out of sight
    // leaving the edge at the crossing's own speed, then gathering it as it drops away
    const k = clamp((t - B.fall - B.cross) / (B.gone - B.fall - B.cross));
    const v0 = (down - up) / B.cross / ((B.belowZ - down) / (B.gone - B.fall - B.cross));
    z = down + (B.belowZ - down) * (v0 * k + (1 - v0) * k * k);
    y = yRoad + B.radius - 9 * k * k;
  }
  out.x = x;
  out.y = y;
  out.z = z;
  // it rolls: turned by the ground it has covered over its radius (the bank's fall is ~1.16 its z run)
  const run = z <= up ? (z - B.bankZ) * 1.16 : (up - B.bankZ) * 1.16 + (z - up);
  out.spin = run / B.radius;
  return out;
}

/** Seconds into the boulder's fall at which it lands on the road (the thud and the shake). */
export const BOULDER_THUD = ROAD.boulder.fall + ROAD.boulder.cross * 0.45;

/**
 * The smaller rocks that come down with the boulder (A13): each on the boulder's own path, set off
 * `dx` metres along the road from it (never more than 0.6 m back toward the warden, mostly on
 * ahead) and `dz` across, a stone of radius `r`, running `pace` times the boulder's speed, so they
 * spread out as they come and are all gone with it. Fixed: every fall the same (the sim is seeded).
 */
export const BOULDER_ROCKS = f([
  f({ dx: 1.6, dz: -0.4, r: 0.32, pace: 1.06 }), f({ dx: -0.6, dz: 0.5, r: 0.22, pace: 1.1 }),
  f({ dx: 2.6, dz: 0.3, r: 0.28, pace: 0.98 }), f({ dx: 0.8, dz: -0.7, r: 0.18, pace: 1.12 }),
  f({ dx: 3.3, dz: -0.2, r: 0.24, pace: 1.03 }), f({ dx: -0.3, dz: -0.5, r: 0.2, pace: 1.0 }),
]);

/** Where rock i of BOULDER_ROCKS is `t` seconds after the fall began (into out: { x, y, z, spin, r }). */
export function boulderRockAt(i, t, crossX, out = {}) {
  const R = BOULDER_ROCKS[i];
  const B = ROAD.boulder;
  const x = (crossX == null ? BOULDER_X + BOULDER_DIR * B.ahead : crossX) + BOULDER_DIR * R.dx;
  boulderAt(Math.min(B.gone, t * R.pace), x, out);
  out.z += R.dz;
  out.y += R.r - B.radius; // on the same ground, a smaller stone
  out.spin *= B.radius / R.r;
  out.r = R.r;
  return out;
}

/**
 * The second boulder (the owner, pass 3: "one more boulder 1/2 the size of the large boulder"):
 * radius `r`, half the large one's, on its path `dx` metres on ahead along the road (further from
 * the warden than it, never back toward them) and `dz` across; it lets go `lag` seconds after the
 * large one and makes the time up on the way down, so both are gone together.
 */
export const BOULDER_SMALL = f({ dx: 2.2, dz: 0.25, r: ROAD.boulder.radius / 2, lag: 0.22 });

/** Where the second boulder is `t` seconds after the fall began (into out: { x, y, z, spin, r }). */
export function boulderSmallAt(t, crossX, out = {}) {
  const Q = BOULDER_SMALL;
  const B = ROAD.boulder;
  const x = (crossX == null ? BOULDER_X + BOULDER_DIR * B.ahead : crossX) + BOULDER_DIR * Q.dx;
  const k = (Math.max(0, t - Q.lag) * B.gone) / (B.gone - Q.lag); // a beat late, then a little quicker
  boulderAt(Math.min(B.gone, k), x, out);
  out.z += Q.dz;
  out.y += Q.r - B.radius;
  out.spin *= B.radius / Q.r;
  out.r = Q.r;
  return out;
}

/**
 * Where the glimpsed creature is `t` seconds into its run, given the x the boulder let go at
 * (road.creature.x). Into `out`: { x, z, sink, heading, stride, u }. Not on the road, so no y:
 * the view stands it on the hill (roadview.js hillAt) and lowers it by `sink` over the crest.
 * heading: the way it runs, as a yaw (forward = (-sin, -cos) in x, z: up the hill, -z).
 * stride: its gait's phase in radians. u: 0 to 1 through the run. Always moving: never back down.
 */
export function creatureAt(t, x0, out = {}) {
  const C = ROAD.creature;
  const u = clamp(t / C.run);
  const e = C.ease * u + (1 - C.ease) * u * u;
  const dx = -BOULDER_DIR * C.drift; // back from the cave's side of the hill
  const dz = C.to - C.from;
  out.x = (x0 == null ? BOULDER_X : x0) + dx * e;
  out.z = C.from + dz * e;
  out.sink = C.sink * smooth((u - 0.8) / 0.2);
  out.heading = Math.atan2(-dx, -dz);
  out.stride = (Math.hypot(dx, dz) * e * 2 * Math.PI) / C.stride;
  out.u = u;
  return out;
}

const CREATURE_AT = {}; // stepRoad's own scratch for creatureAt (no allocation a frame)

const LET_GO = {}; // stepRoad's own scratch for the let-go place
/** The place the boulder let go from, as the glimpse's trigger aims at it: { x, y, z } (a scratch object). */
function letGoAt(x) {
  return boulderAt(0, x, LET_GO);
}
/** How far the glimpse is from the warden, `t` seconds into its run (scratch: no allocation). */
function creatureGap(t, x0, pl) {
  const at = creatureAt(t, x0, CREATURE_AT);
  return Math.hypot(at.x - pl.x, at.z - pl.z);
}

/** True when the warden is looking up at (x, y, z): pitched up at least minPitch, within cone of it. */
function looksUpAt(pl, x, y, z) {
  const C = ROAD.creature;
  if (!Number.isFinite(pl.yaw) || !Number.isFinite(pl.pitch) || pl.pitch < C.minPitch) return false;
  const cp = Math.cos(pl.pitch);
  const ex = x - pl.x;
  const ey = y - ((Number.isFinite(pl.y) ? pl.y : 0) + C.eye);
  const ez = z - pl.z;
  const d = Math.hypot(ex, ey, ez) || 1;
  return (-Math.sin(pl.yaw) * cp * ex + Math.sin(pl.pitch) * ey - Math.cos(pl.yaw) * cp * ez) / d >= Math.cos(C.cone);
}

/**
 * Where the boulder will cross: `ahead` metres in front of the warden up leg 2, never nearer the
 * trigger point than half a metre less, and inside the road.
 */
function aimBoulder(b, pl, on) {
  const leg = RECTS[BOULDER_RECT];
  const D = BOULDER_DIR;
  const wx = on && pl.z >= leg.minZ - 1 && pl.z <= leg.maxZ + 1 && pl.x > leg.minX && pl.x < leg.maxX ? pl.x : BOULDER_X;
  b.wx = wx;
  const along = Math.max(ROAD.boulder.ahead - 0.5, D * (wx - BOULDER_X) + ROAD.boulder.ahead); // metres past the trigger point
  b.x = Math.max(leg.minX + 1, Math.min(leg.maxX - 1, BOULDER_X + D * along));
}

const ROLL_MAX = 9; // m/s: the boulder's slant along the road as it crosses, at most

const stepsOf = (events) => (events && events.sounds ? events.sounds.filter((e) => e.type === 'step').length : 0);

/**
 * One frame of the road (keep.js calls it every frame the castle steps). The ratchet takes the
 * highest progress so far; the boulder lets go once as the warden first crosses its trigger
 * point; the bats come out once as the warden first crosses theirs, and the giant bat once
 * after them. Events: roadCrack (it lets go, up the bank), roadThud (it lands on the road: the
 * view's small shake), roadCreature (the glimpse starts its run up the hill), batSwarm (out of the cave), giantBat (the second scare). rng is the run's
 * generator (the giant bat's step, 2 or 3, is drawn once, as the swarm comes out).
 */
export function stepRoad(road, pl, dt, events, rng = () => 0.5) {
  if (!road || !pl) return;
  const p = progressAt(pl.x, pl.z);
  if (p > road.dark) road.dark = p; // only ever up: walking back down keeps the dark
  const on = onRoad(pl.x, pl.z);
  const s = on ? stationAt(pl.x, pl.z) : null;
  const prev = road.at; // where the warden was last frame: a scare fires only on the way up past its point
  road.at = s;
  const upPast = (point) => prev != null && s != null && prev < point && s >= point;

  const b = road.boulder;
  if (b.state === 'ready' && upPast(ROAD.boulder.at) && rectAt(pl.x, pl.z) === BOULDER_RECT && !pl.dead) {
    b.state = 'falling';
    b.t = 0;
    aimBoulder(b, pl, on);
    const at = boulderAt(0, b.x);
    events.push({ type: 'roadCrack', x: at.x, y: at.y, z: at.z });
    if (road.creature) road.creature.x = at.x;
  } else if (b.state === 'falling' && dt > 0) {
    const was = b.t;
    b.t += dt;
    // Down the bank it keeps ahead of the warden (a stone rolls slantwise down a slope); the
    // crossing is fixed as it reaches the road.
    if (b.t < ROAD.boulder.fall) aimBoulder(b, pl, on);
    else if (b.t < ROAD.boulder.fall + ROAD.boulder.cross) {
      // A slow crossing (review A12) leaves time to run into it, so across the road it still
      // rolls slantwise on ahead of a warden pressing up the road (never back toward them, and
      // no faster than a sprint), and keeps its distance.
      const x0 = b.x;
      aimBoulder(b, pl, on);
      const D = BOULDER_DIR;
      b.x = x0 + D * Math.max(0, Math.min(ROLL_MAX * dt, D * (b.x - x0)));
    }
    if (was < BOULDER_THUD && b.t >= BOULDER_THUD) {
      const at = boulderAt(b.t, b.x);
      events.push({ type: 'roadThud', x: at.x, z: at.z });
    }
    if (b.t >= ROAD.boulder.gone) { b.state = 'done'; b.t = ROAD.boulder.gone; }
  }

  // The glimpse: once only, and only for a warden who looks up to where the boulder let go, from
  // the crack until a few seconds after it is gone. Then it runs, away up the hill; it never comes
  // toward the warden and touches nothing.
  const c = road.creature;
  if (c && c.state === 'ready' && b.state !== 'ready') {
    if (c.x == null) c.x = b.x;
    if (dt > 0) c.w += dt;
    const O = letGoAt(c.x);
    if (c.w > ROAD.boulder.gone + ROAD.creature.window) c.state = 'done'; // not looked for: never seen
    else if (!pl.dead && looksUpAt(pl, O.x, O.y, O.z)) {
      c.state = 'run';
      c.t = 0;
      const at = creatureAt(0, c.x, CREATURE_AT);
      c.d = Math.hypot(at.x - pl.x, at.z - pl.z);
      events.push({ type: 'roadCreature', x: at.x, y: O.y - ROAD.boulder.radius, z: at.z });
    }
  } else if (c && c.state === 'run' && dt > 0) {
    // Its path only ever leads away up the hill, so a warden pressing after it is answered by its
    // going quicker: never a frame nearer them than the last (a few frames' ground at most).
    const run = ROAD.creature.run;
    c.t = Math.min(run, c.t + dt);
    let d = creatureGap(c.t, c.x, pl);
    for (let k = 0; k < 8 && d < c.d && c.t < run; k++) { c.t = Math.min(run, c.t + dt); d = creatureGap(c.t, c.x, pl); }
    c.d = Math.max(c.d || 0, d);
    if (c.t >= run) { c.state = 'done'; c.t = run; }
  }

  const bt = road.bats;
  const past = on && rectAt(pl.x, pl.z) === BATS_RECT && pastBats(pl.x);
  if (bt.state === 'ready' && past && upPast(ROAD.bats.at) && !pl.dead) {
    bt.state = 'swarm';
    bt.t = 0;
    bt.steps = 0;
    bt.need = rng() < 0.5 ? ROAD.bats.steps[0] : ROAD.bats.steps[1];
    events.push({ type: 'batSwarm', x: ROAD.bats.cave.x, z: ROAD.bats.cave.z });
  } else if (bt.state === 'swarm' && dt > 0) {
    bt.t += dt;
    if (bt.t >= ROAD.bats.swarm) { bt.state = 'quiet'; bt.t = 0; bt.steps = 0; } // clear of the road: the silence
  } else if (bt.state === 'quiet') {
    if (dt > 0) bt.t += dt;
    if (past) bt.steps += stepsOf(events);
    if (bt.steps >= bt.need) {
      bt.state = 'giant';
      bt.t = 0;
      events.push({ type: 'giantBat', x: ROAD.bats.cave.x, z: ROAD.bats.cave.z });
    }
  } else if (bt.state === 'giant' && dt > 0) {
    bt.t += dt;
    if (bt.t >= ROAD.bats.giant) { bt.state = 'done'; bt.t = ROAD.bats.giant; }
  }
}

/**
 * Seats a journey from the wood at the road's foot: the warden where leg 1 leaves the wood,
 * `offset` metres to their right (clamped inside the road), facing as they were in the wood's
 * frame turned by ROAD.foot.turn (so ahead stays ahead: the wood's north is the road's west).
 * pose: { offset, yaw, pitch } (any may be missing). Returns the place: { x, z, y, yaw, pitch }.
 */
export function footSeat(pose = {}) {
  const F = ROAD.foot;
  const off = Number.isFinite(pose.offset) ? clamp(pose.offset, -F.halfWidth, F.halfWidth) : 0;
  // the warden's right, facing along the road at the foot (sim.js: right = (cos yaw, -sin yaw))
  const x = F.x + Math.cos(F.yaw) * off;
  const z = F.z - Math.sin(F.yaw) * off;
  return {
    x, z, y: heightAt(stationAt(x, z)),
    yaw: Number.isFinite(pose.yaw) ? pose.yaw + F.turn : F.yaw,
    pitch: Number.isFinite(pose.pitch) ? clamp(pose.pitch, -1.4, 1.4) : 0,
  };
}
