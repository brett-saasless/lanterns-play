// The road from the wood's end to the castle's drawbridge (issue #29, the owner's spec and mood
// record): about a minute's walk up a rutted dirt road in five switchbacks, sunset going to night
// as the warden climbs, and two scares that frighten and never touch: a boulder (and a second,
// half its size) that bounds across the road a few metres ahead, and a swarm of bats from a
// roadside cave followed, a step or two later, by one giant bat. And, the frame the boulder is
// gone, the werewolf cutaway's latch (logic/cutaway.js plays it: the thing that pushed it, seen up
// close, then running to the castle). Nothing here hurts: this file never imports the hurt path, has no
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
  // The foot: the east end of leg 1, where the walk from the Caterpillar's gate (logic/tunnelwalk.js)
  // comes out onto the road, facing west along it. `turn` is the quarter turn from the wood's frame
  // to the road's (the warden's facing, the sun and the side offset all turn with it, so what was
  // ahead is still ahead: the wood's north is the road's west). out: where the title's Road start
  // stands (outSeat), a few steps out onto the road.
  foot: { x: 48.5, z: 104, yaw: Math.PI / 2, turn: Math.PI / 2, out: 41.5 },
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
  // The old look-up glimpse (pass 3) is retired: the werewolf cutaway (logic/cutaway.js) shows the
  // creature instead, by itself, right after the boulder (the owner, 2026-11-18).
  // swarm: seconds the swarm holds the road, till its last bat is clear (SWARM_GUSTS: 3.67 s; was
  // 2.6 before the owner slowed the flocks). giant: seconds of the giant bat's flight (GIANT_PATH:
  // ~55 m at half its old ~15 m/s on average, two swoops around the warden; was 1.8 s, one
  // fly-by). tail: seconds of quiet after it has gone before the scare is over (the art critic).
  bats: { at: 268, cave: { x: 10, z: 63.4, y: 1.8 }, swarm: 3.7, gap: 0.6, steps: [2, 3], giant: 7.9, tail: 1 },
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
    // the werewolf cutaway's latch (logic/cutaway.js): ready | due (the boulder is gone) | play | done
    cutaway: { state: walked ? 'done' : 'ready' },
    // ready | swarm | quiet | giant | done; hold: the x of the road's block in front of the warden while the giant circles
    bats: { state: walked ? 'done' : 'ready', t: 0, steps: 0, need: 2, hold: null },
  };
}

/** A road state from anything (a restore keeps the road): latches and the ratchet only ever move one way; a scare in the air is finished. */
export function settledRoad(was) {
  const r = createRoad(false);
  if (!was || typeof was !== 'object') return createRoad(true);
  r.dark = clamp(Number.isFinite(was.dark) ? was.dark : 1);
  const bo = was.boulder && was.boulder.state;
  r.boulder.state = bo === 'ready' ? 'ready' : 'done';
  // where it came down is kept (the cutaway's rubble lies there)
  if (r.boulder.state === 'done' && Number.isFinite(was.boulder && was.boulder.x)) r.boulder.x = was.boulder.x;
  // the cutaway is spent with the boulder: once it has fallen (seen or cut short) it never plays again
  const cu = was.cutaway && was.cutaway.state;
  r.cutaway.state = r.boulder.state === 'ready' && (cu === 'ready' || cu == null) ? 'ready' : 'done';
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
 * Every small bat's way (the view draws it): a curve out of the cave's mouth, back down the road
 * over the warden's head at the trigger point, then away off the road's edge and down the slope.
 * `y` is over the road at the trigger point. A bat's own scatter (b: dx, dz, up) moves the middle
 * and the end, as the view always has.
 */
export const SWARM_PATH = f({
  mouth: f({ x: ROAD.bats.cave.x, y: 1.6, z: ROAD.bats.cave.z + 0.9 }),
  over: f({ x: BATS_X - BATS_DIR * 0.5, y: 2.25, z: 68 }),
  away: f({ x: BATS_X - BATS_DIR * 9, y: -2, z: 84 }),
});

/** Where a small bat is `u` (0 to 1) along its way, with its scatter b { dx, dz, up }. Into `out`: { x, y, z }. */
export function swarmPoint(u, b, out = {}) {
  const A = SWARM_PATH.mouth; const B = SWARM_PATH.over; const E = SWARM_PATH.away;
  const y0 = heightAt(ROAD.bats.at);
  const a1 = (1 - u) * (1 - u); const a2 = 2 * u * (1 - u); const a3 = u * u;
  out.x = a1 * A.x + a2 * (B.x + b.dx) + a3 * (E.x + b.dx * 2);
  out.y = y0 + a1 * A.y + a2 * (B.y + b.up) + a3 * (E.y + b.up);
  out.z = a1 * A.z + a2 * (B.z + b.dz * 0.5) + a3 * (E.z + b.dz);
  return out;
}

/**
 * How far along its way (0 to 1) a small bat passes the warden held at the block's near face: out
 * of a forward view up the road (toward the cave), on past the head, behind and below. ~0.495.
 */
export const SWARM_PAST = (() => {
  const held = BATS_X + BATS_DIR * ROAD.bats.gap;
  const o = {}; const b = { dx: 0, dz: 0, up: 0 };
  let lo = 0; let hi = 1;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (BATS_DIR * (swarmPoint(m, b, o).x - held) > 0) lo = m; else hi = m; }
  return Math.round(((lo + hi) / 2) * 10000) / 10000;
})();

/**
 * The swarm comes out in three uneven gusts, not a stream (review A7, A8): each `at` seconds after
 * the swarm starts, `share` of the bats, let go over `spread` seconds (the view lets bat i go at
 * at + spread * r^1.5, r uniform: on average 0.4 of the spread in); each of a gust's bats flies its
 * way in `fly` [min, max] seconds. The last is clear by ROAD.bats.swarm (the road's block holds
 * till then). The view's flock and the cue's clusters both read this.
 *
 * The owner (fix/bat-pacing): "slow the flocks of bats down to half speed so the user can get a
 * look at them. Keep the third flock of bats at full speed so it catches up with the second flock
 * as they leave the screen." Full speed is the old 1.3 to 1.5 s a bat; gusts 1 and 2 take twice
 * that over the same way (2.6 to 3.0 s). Gust 3 keeps 1.3 to 1.5 s and is let go after gust 2's
 * last bat, timed so that, on average, its bats draw level with gust 2's at SWARM_MEET along the
 * way, just before they pass the warden and leave a view up the road (SWARM_PAST), so the meeting
 * is on screen (the art critic):
 *   at(g, u) = g.at + 0.4 g.spread + u * mean(g.fly)   (when a gust is, on average, u along)
 *   at(2, 0.45) = 0.47 + 0.08 + 0.45 * 2.8 = 1.81 s
 *   gust 3's at = 1.81 - 0.4 * 0.24 - 0.45 * 1.4 = 1.084, so 1.08 s (gust 2's last bat goes at 0.67 s)
 * Gust 3 then pulls ahead past the warden; its last bat is clear at 1.08 + 0.24 + 1.5 = 2.82 s,
 * gust 2's at 0.67 + 3.0 = 3.67 s, so ROAD.bats.swarm is 3.7.
 *
 * The view's look of each gust (the art critic): `beat` [min, max] Hz of a bat's wing-beat (6 to 8
 * for the slow flocks, which at 9 to 12 read as hovering; 9 to 12 for the fast one), `scatter`
 * [across, along] metres of spread about the way (gust 3 tighter, so it cuts through as one), and
 * `tint` (its colour times this: gust 3 darker, so it is told apart from gust 2 as it catches it).
 */
export const SWARM_MEET = 0.45;
export const SWARM_GUSTS = (() => {
  const FULL = [1.3, 1.5]; // a bat's flight at full speed, seconds
  const HALF = [FULL[0] * 2, FULL[1] * 2];
  const mean = (a) => (a[0] + a[1]) / 2;
  const slow = { beat: [6, 8], scatter: [3.2, 3.4], tint: 1 };
  const g1 = { at: 0, share: 0.42, spread: 0.24, fly: HALF, ...slow };
  const g2 = { at: 0.47, share: 0.38, spread: 0.2, fly: HALF, ...slow };
  const meet2 = g2.at + 0.4 * g2.spread + SWARM_MEET * mean(g2.fly);
  const s3 = 0.24;
  const g3 = { at: Math.round((meet2 - 0.4 * s3 - SWARM_MEET * mean(FULL)) * 100) / 100, share: 0.2, spread: s3, fly: FULL,
    beat: [9, 12], scatter: [2.2, 2.4], tint: 0.55 };
  return f({ gusts: [g1, g2, g3] });
})();

/**
 * The giant bat's flight (the owner, fix/bat-pacing: "Have the large bat swoop around the user
 * twice so it can be seen and cause dread. Slow by half. It flies by so quick it can't be
 * appreciated."): out of the cave's mouth toward the warden, a first swoop just over their head
 * (on the bank side), on past their shoulder, a wide banking loop round out over the slope and back
 * in front of them, a second swoop over the head coming in at their face, past the shoulder again
 * and away down the slope ahead of them. The art critic's pass: the loop is kept off the warden's
 * back (at the corner of a view up the road), the first swoop comes ~1.75 s after it appears, it
 * slows to GIANT_SLOW (4.5 m/s) through each swoop so each reads for more than half a second, and
 * out on the loop it is slower where a warden facing up the road sees it than where they do not.
 * Half the old fly-by's speed on average: that was ~27 m in 1.8 s (~15 m/s) from where the warden
 * stands as it comes out (`home`, two or three steps past the trigger point); this is ~55 m in
 * ROAD.bats.giant = 7.9 s (~7 m/s; 4.5 m/s at the swoops, up to ~11 m/s behind the shoulder). A
 * scare only: it never comes nearer the eye than `clear` (the old pass straight over the head) and
 * touches nothing.
 *
 * `points`: the way after the mouth, each [ahead (up the road), up, down the slope (+z)] metres
 * from `over`, the point `clear` over the warden's eye; the view keeps `over` on the warden as they
 * move. A centripetal Catmull-Rom curve runs through the mouth and the points, timed at `home` by
 * the speeds above. `passes`: the seconds of the two close passes (the cue's air). `hold`: the road
 * is held in front of the warden (roadBlock) until this many seconds in, just after the second
 * swoop, so they stand for both and the circling is not a chase.
 */
const GIANT_CLEAR = 2.3; // the body over the eye at a pass: its wingtips (1.7 m, banked) still clear
const GIANT_EYE = 1.6; // the warden's eye over their feet (keepconfig player.eyeHeight)
const GIANT_POINTS = f([
  [2.5, 0, -1.5], // out of the mouth, growing as it comes (the art critic: watch it come ~1.6 s before the first swoop)
  [0, 0, -0.9], // the first swoop, just over the head on the bank side, going back down the road
  [-2.5, 0.8, 3.5], // past the shoulder, banking (kept off the back, at the corner of the eye)
  [-0.5, 1.6, 6.5], // out over the slope
  [3, 1.8, 6], // wide, broadside to the warden's downhill side
  [5.5, 1.3, 4], // ahead, coming round in front of them
  [5, 0.5, 0.2], // turning in, at their face
  [0, 0, -0.9], // the second swoop over the head
  [-1.5, 1, 3], // past the shoulder again, banking hard
  [2.5, 2.6, 8], // turning back out in front over the slope
  [6, 5, 17], // gone down the slope, ahead of them
]);
const GIANT_MOUTH = f({ x: ROAD.bats.cave.x, y: heightAt(ROAD.bats.at) + 1.7, z: ROAD.bats.cave.z + 0.9 });
const GIANT_N = GIANT_POINTS.length + 1; // the mouth and the points
const _gp = [{}, {}, {}, {}]; // the four control points of a span (scratch: no allocation a frame)
const _gq = [{}, {}, {}, {}, {}];

/** Control point i of the giant's curve around `over` into o (i -1 and GIANT_N are the ends mirrored). */
function giantCtrl(i, over, o) {
  if (i < 0) { giantCtrl(0, over, o); const ox = o.x; const oy = o.y; const oz = o.z; giantCtrl(1, over, o); o.x = 2 * ox - o.x; o.y = 2 * oy - o.y; o.z = 2 * oz - o.z; return o; }
  if (i >= GIANT_N) { giantCtrl(GIANT_N - 1, over, o); const ox = o.x; const oy = o.y; const oz = o.z; giantCtrl(GIANT_N - 2, over, o); o.x = 2 * ox - o.x; o.y = 2 * oy - o.y; o.z = 2 * oz - o.z; return o; }
  if (i === 0) { o.x = GIANT_MOUTH.x; o.y = GIANT_MOUTH.y; o.z = GIANT_MOUTH.z; return o; }
  const w = GIANT_POINTS[i - 1];
  o.x = over.x + BATS_DIR * w[0]; o.y = over.y + w[1]; o.z = over.z + w[2];
  return o;
}

const lerpTo = (o, a, b, ta, tb, t) => { const k = tb - ta > 1e-9 ? (t - ta) / (tb - ta) : 0; o.x = a.x + (b.x - a.x) * k; o.y = a.y + (b.y - a.y) * k; o.z = a.z + (b.z - a.z) * k; return o; };

/** The curve at g (0 to GIANT_N - 1: span floor(g), k into it) around `over`, into out. */
function giantCurve(g, over, out) {
  const i = Math.min(GIANT_N - 2, Math.max(0, Math.floor(g)));
  const k = clamp(g - i);
  const p0 = _gp[0]; const p1 = _gp[1]; const p2 = _gp[2]; const p3 = _gp[3];
  giantCtrl(i - 1, over, p0); giantCtrl(i, over, p1); giantCtrl(i + 1, over, p2); giantCtrl(i + 2, over, p3);
  const d = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)));
  const t1 = d(p0, p1); const t2 = t1 + d(p1, p2); const t3 = t2 + d(p2, p3);
  const t = t1 + (t2 - t1) * k;
  const a1 = _gq[0]; const a2 = _gq[1]; const a3 = _gq[2]; const b1 = _gq[3]; const b2 = _gq[4];
  lerpTo(a1, p0, p1, 0, t1, t); lerpTo(a2, p1, p2, t1, t2, t); lerpTo(a3, p2, p3, t2, t3, t);
  lerpTo(b1, a1, a2, 0, t2, t); lerpTo(b2, a2, a3, t1, t3, t);
  return lerpTo(out, b1, b2, t1, t2, t);
}

const GIANT_SAMPLES = 1200;
const GIANT_SLOW = 4.5; // m/s at a pass (the art critic: each swoop over the head reads for longer than half a second)
const GIANT_NEAR = [1.5, 3.5]; // m across the ground from the warden: all slow inside the first, full loop speed past the second
// Out on the loop it flies slower where a warden facing up the road sees it (within ~40 degrees of
// ahead) than where it is off their shoulder or behind (past ~75 degrees): GIANT_FRONT times as fast.
const GIANT_FRONT = 0.5;
const GIANT_SEEN = [Math.cos((75 * Math.PI) / 180), Math.cos((40 * Math.PI) / 180)];
const GIANT_TIMING = (() => {
  const feet = heightAt(ROAD.bats.at + 5); // ~2.5 strides past the trigger point
  const home = f({ x: BATS_X + BATS_DIR * 5, y: feet + GIANT_EYE + GIANT_CLEAR, z: 68 });
  const ds = new Float64Array(GIANT_SAMPLES + 1); // the length of each step of the curve's own parameter
  const near = new Float64Array(GIANT_SAMPLES + 1); // 1 at a pass, 0 out on the loop
  const p = {}; const q = {};
  giantCurve(0, home, q);
  const nearOf = (o) => 1 - smooth((Math.hypot(o.x - home.x, o.z - home.z) - GIANT_NEAR[0]) / (GIANT_NEAR[1] - GIANT_NEAR[0]));
  const front = new Float64Array(GIANT_SAMPLES + 1); // 1 well ahead of the warden, 0 off the shoulder or behind
  const frontOf = (o) => { const dx = BATS_DIR * (o.x - home.x); const dz = o.z - home.z; const c = dx / Math.max(1e-6, Math.hypot(dx, dz));
    return smooth((c - GIANT_SEEN[0]) / (GIANT_SEEN[1] - GIANT_SEEN[0])); };
  front[0] = frontOf(q);
  const flat = new Float64Array(GIANT_SAMPLES + 1);
  flat[0] = Math.hypot(q.x - home.x, q.z - home.z);
  near[0] = nearOf(q);
  let length = 0;
  for (let s = 1; s <= GIANT_SAMPLES; s++) {
    giantCurve((s / GIANT_SAMPLES) * (GIANT_N - 1), home, p);
    ds[s] = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    length += ds[s];
    flat[s] = Math.hypot(p.x - home.x, p.z - home.z);
    near[s] = nearOf(p);
    front[s] = frontOf(p);
    q.x = p.x; q.y = p.y; q.z = p.z;
  }
  // The loop's speed, found so the whole flight takes ROAD.bats.giant with GIANT_SLOW at the passes.
  const vAt = (fast, s) => { const loop = fast * (1 + (GIANT_FRONT - 1) * front[s]); return loop + (GIANT_SLOW - loop) * near[s]; };
  const timeAt = (fast) => { let t = 0; for (let s = 1; s <= GIANT_SAMPLES; s++) t += ds[s] / vAt(fast, s); return t; };
  let lo = GIANT_SLOW; let hi = 60;
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (timeAt(m) > ROAD.bats.giant) lo = m; else hi = m; }
  const fast = (lo + hi) / 2;
  const tim = new Float64Array(GIANT_SAMPLES + 1); // seconds into the flight at each step
  for (let s = 1; s <= GIANT_SAMPLES; s++) tim[s] = tim[s - 1] + ds[s] / vAt(fast, s);
  const k = ROAD.bats.giant / tim[GIANT_SAMPLES];
  for (let s = 0; s <= GIANT_SAMPLES; s++) tim[s] *= k;
  const passes = [];
  for (let s = 1; s < GIANT_SAMPLES; s++) {
    if (flat[s] < 1.5 && flat[s] <= flat[s - 1] && flat[s] < flat[s + 1]) passes.push(Math.round(tim[s] * 1000) / 1000);
  }
  return { path: f({ clear: GIANT_CLEAR, eye: GIANT_EYE, points: GIANT_POINTS, home, length: Math.round(length * 100) / 100,
    speed: Math.round((length / ROAD.bats.giant) * 100) / 100, slow: GIANT_SLOW, fast: Math.round(fast * 100) / 100, passes: f(passes),
    // the road is held in front of the warden from the giant's coming out until just after its second swoop
    hold: passes.length ? Math.round((passes[passes.length - 1] + 0.3) * 100) / 100 : 0 }), tim };
})();
/** Seconds into the flight at each of GIANT_SAMPLES + 1 even steps of the curve's own parameter, at home. */
const GIANT_TIM = GIANT_TIMING.tim;
export const GIANT_PATH = GIANT_TIMING.path;

/**
 * Where the giant bat is `t` seconds into its flight around `over` (the point GIANT_PATH.clear over
 * the warden's eye): GIANT_PATH.slow at the passes, GIANT_PATH.fast out on the loop, eased between.
 * Held at its last place after the end. Into `out`: { x, y, z }.
 */
export function giantAt(t, over, out = {}) {
  const tim = GIANT_TIM;
  const s = clamp(t, 0, ROAD.bats.giant);
  let lo = 0; let hi = GIANT_SAMPLES;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tim[m] <= s) lo = m; else hi = m; }
  const span = tim[hi] - tim[lo];
  const k = span > 1e-9 ? clamp((s - tim[lo]) / span) : 0;
  return giantCurve(((lo + k) / GIANT_SAMPLES) * (GIANT_N - 1), over, out);
}

/**
 * The giant bat's wing-beat (review A9): `rate` radians a second (~1.6 Hz, heavy; kept when the
 * flight was slowed), its wings spread at the start (phase 0, rising); a downstroke passes level at
 * each of `beats` (seconds), where the cue strikes, all the way through its flight.
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
 * warden cannot pass it until the swarm has cleared. While the giant bat circles, until just after
 * its second swoop (GIANT_PATH.hold): the same block just in front of where the warden stood as it
 * came out (the art critic and the controller: they stand for both swoops, and its loop around them
 * is not a chase; their walking is never slowed). keep.js keepBoxes adds it. Null otherwise.
 */
export function roadBlock(road) {
  const bt = road && road.bats;
  if (!bt) return null;
  const giant = bt.state === 'giant' && Number.isFinite(bt.hold) && bt.t < GIANT_PATH.hold;
  if (bt.state !== 'swarm' && !giant) return null;
  const r = RECTS[BATS_RECT];
  // the block's near face: just past the trigger point, or just in front of the warden as the giant came out
  const near = giant ? bt.hold : BATS_X + BATS_DIR * ROAD.bats.gap;
  const minX = Math.min(near, near + BATS_DIR * 0.4);
  const maxX = Math.max(near, near + BATS_DIR * 0.4);
  return {
    kind: giant ? 'giant' : 'swarm', x: (minX + maxX) / 2, z: (r.minZ + r.maxZ) / 2, w: maxX - minX, d: r.maxZ - r.minZ, h: 40,
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
 * view's small shake), batSwarm (out of the cave), giantBat (the second scare). The frame the
 * boulder is gone the cutaway's latch goes 'due' (keep.js starts it). rng is the run's
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
    if (b.t >= ROAD.boulder.gone) {
      b.state = 'done';
      b.t = ROAD.boulder.gone;
      if (road.cutaway && road.cutaway.state === 'ready') road.cutaway.state = 'due'; // the film, right after the fall
    }
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
      bt.hold = pl.x + BATS_DIR * ROAD.bats.gap; // the road held just in front of them till its second swoop
      events.push({ type: 'giantBat', x: ROAD.bats.cave.x, z: ROAD.bats.cave.z });
    }
  } else if (bt.state === 'giant' && dt > 0) {
    bt.t += dt;
    // its flight, then a moment of quiet after it has gone
    if (bt.t >= ROAD.bats.giant + ROAD.bats.tail) { bt.state = 'done'; bt.t = ROAD.bats.giant + ROAD.bats.tail; bt.hold = null; }
  }
}

/**
 * The title's Road start (the owner, 2026-11-17): the foot of the road a few steps on from where the
 * walk from the wood comes out onto it (logic/tunnelwalk.js), on the centreline, facing west up leg 1.
 * Returns the place: { x, z, y, yaw, pitch }.
 */
export function outSeat() {
  const F = ROAD.foot;
  return { x: F.out, z: F.z, y: heightAt(stationAt(F.out, F.z)), yaw: F.yaw, pitch: 0 };
}
