// The rubble ways (the owner, 2026-11-18): the yard's way down is a ramp of broken concrete and
// rubble sloping down into the dark under the broken floor, ending in a black opening; the cave's
// way up is a mound of fallen rock under a ragged hole in the vault, climbed toward the daylight.
// Both are one shape, a PATH: a straight lane RUBBLE.length long from its start (on the room's
// floor, the approach side) to its end (the yard's black opening; the top of the cave's heap,
// under the hole), its floor falling (yard) or rising (cave) RUBBLE.height along a smooth slope.
//
// The lane is real ground: sim.js asks laneFloor for the warden's floor on it (the eye follows,
// as on the castle's stairs), and keepToPath keeps the warden out of what is not walkable: the
// lane's sides are walls wherever its floor stands more than RUBBLE.step off the room's floor (the
// trench's edge, the heap's flank), and so are its end and the far side of the opening or the
// heap's back. The only way on or off is the approach end (and the shallow first metre or so of
// either side). Nothing can be walked over to anywhere out of bounds; nothing traps: the lane is
// always walked back up (or down) to its start.
//
// Walked RUBBLE.trigger metres along the lane, the view takes over (journey.js starts the follow:
// a short scene of FOLLOW.length seconds that goes on along the path, down into the dark or up
// toward the light, a fade coming in at its end); turning back before that cancels nothing,
// because nothing has started. followAt is the follow's camera, pure, by time.
//
// Pure: no Math.random, no DOM. A path is derived from the kept site (sim.waves.wayout: x, z, dx,
// dz, the vault's height in the cave), so the same site always gives the same path.

const f = Object.freeze;
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };
const mix = (a, b, k) => a + (b - a) * k;

export const RUBBLE = f({
  length: 4, // metres of lane, from its start on the room's floor to its end (the black opening; the top of the heap, under the hole)
  run: 3.5, // metres of it the slope takes; the rest is its foot (the yard) or its top (the cave), level
  height: 1.5, // metres it falls (the yard) or rises (the cave) over its run
  half: 1.1, // the walkable lane's half width
  trigger: 3.2, // metres along it at which the follow starts by itself (about three or four steps)
  step: 0.25, // the lane's side is a wall wherever its floor stands more than this off the room's (sim.js STEP_DOWN)
  back: f({ yard: 1.3, cave: 0.6 }), // beyond the end: the black opening's far edge (yard), the heap's back (cave)
  apron: 1.5, // metres of clear floor before the start: the approach
  rim: 1.0, // metres round the yard's opening its torn rim and slabs take (passages.js)
  flank: 0.9, // metres either side of the cave's lane its heap's flank takes (passages.js)
});

/**
 * The follow (the view along the path): its seconds, and the beats inside them (the art critic,
 * 2026-11-18: the yard holds at its start a moment, then goes down at about 1 m/s; the cave holds
 * its look along the heap for 1 s, then turns up; the fade starts at 2.4 s in both).
 */
export const FOLLOW = f({
  length: 3.0, // seconds, start to hand-over
  turn: 0.6, // seconds the look takes to turn from the warden's own onto the path
  fade: 0.6, // seconds at the end over which the cover (the dark, the daylight) comes in: from 2.4 s
  yard: f({ hold: 0.6, accel: 0.4, decel: 0.6 }), // seconds still at its start, coming up to pace, easing off
  cave: f({ hold: 0, accel: 0.6, decel: 0.6 }),
  look: -0.7, // the cave: the look down onto the heap, 40 degrees (the warden is 0.8 m from its top: 5 degrees down sees past it)
  level: 1.0, // the cave: seconds the look stays on the heap (it falls away below as the eye rises) before it turns up
  up: 1.2, // and the seconds it turns up over, toward the hole
});

/** The slope's shape, 0 to 1 over 0 to 1 of its length: mostly straight, eased at both ends, never steeper than 1.2 times the average grade. */
export const profile = (s) => { const k = clamp(s); return 0.6 * k + 0.4 * k * k * (3 - 2 * k); };

/** The steepest the slope gets: metres of height per metre of lane. */
export const MAX_GRADE = 1.2 * RUBBLE.height / RUBBLE.run;

/**
 * The path for a room's kept site: { room, sign, x0, z0 (the start), dx, dz (the heading, unit,
 * from start to end), nx, nz (its left), ex, ez (the end: the site itself), length, height, half,
 * back, uStep (how far along the lane its floor first stands RUBBLE.step off the room's), top (the
 * cave: the vault's height over the end; null in the yard) }, or null when the site has no heading.
 */
export function pathFor(room, site) {
  if (!site || !Number.isFinite(site.x) || !Number.isFinite(site.dx) || !Number.isFinite(site.dz)) return null;
  const len = Math.hypot(site.dx, site.dz);
  if (!(len > 1e-9)) return null;
  const dx = site.dx / len; const dz = site.dz / len;
  const L = RUBBLE.length;
  const sign = room === 'cave' ? 1 : -1;
  const p = {
    room, sign, dx, dz, nx: -dz, nz: dx,
    ex: site.x, ez: site.z, x0: site.x - dx * L, z0: site.z - dz * L,
    length: L, run: RUBBLE.run, height: RUBBLE.height, half: RUBBLE.half, back: room === 'cave' ? RUBBLE.back.cave : RUBBLE.back.yard,
    top: room === 'cave' && Number.isFinite(site.vault) ? site.vault : null, uStep: 0,
  };
  let lo = 0; let hi = L; // the slope only grows: bisect for where it passes the step
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (RUBBLE.height * profile(m / RUBBLE.run) > RUBBLE.step) hi = m; else lo = m; }
  p.uStep = hi;
  return f(p);
}

/** (x, z) in the path's own frame: u along it from its start, v across it (to its left). Writes `out`. */
export function toLane(path, x, z, out = {}) {
  const rx = x - path.x0; const rz = z - path.z0;
  out.u = rx * path.dx + rz * path.dz;
  out.v = rx * path.nx + rz * path.nz;
  return out;
}

/** The world point u along the lane and v across it. Writes `out` ({ x, z }). */
export function fromLane(path, u, v, out = {}) {
  out.x = path.x0 + path.dx * u + path.nx * v;
  out.z = path.z0 + path.dz * u + path.nz * v;
  return out;
}

/** The lane's floor u metres along it, against the room's floor: 0 at its start, -height (yard) or +height (cave) at its end. */
export function heightAt(path, u) {
  return path.sign * path.height * profile(u / path.run);
}

/** The warden's eye u metres along the lane (eye: the room's eye height). */
export function eyeAt(path, u, eye) {
  return heightAt(path, u) + eye;
}

const scratch = { u: 0, v: 0 };

/** The floor at (x, z) when that is on the lane (from its start to its end, side to side), else null. */
export function laneFloor(path, x, z) {
  if (!path) return null;
  const q = toLane(path, x, z, scratch);
  if (q.u < 0 || q.u > path.length || Math.abs(q.v) > path.half) return null;
  return heightAt(path, q.u);
}

/** How far along the lane (x, z) is, when on it; else null. */
export function laneU(path, x, z) {
  if (!path) return null;
  const q = toLane(path, x, z, scratch);
  if (q.u < 0 || q.u > path.length || Math.abs(q.v) > path.half) return null;
  return q.u;
}

/**
 * The walls, in the lane's frame [u0, v0, u1, v1]: both sides from where the floor first stands a
 * step off the room's to the far edge; the end of the slope (the opening's edge; the heap's top);
 * the far edge (the opening's far side; the heap's back).
 */
export function wallsOf(path) {
  const h = path.half; const far = path.length + path.back;
  return [
    [path.uStep, h, far, h],
    [path.uStep, -h, far, -h],
    [path.length, -h, path.length, h],
    [far, -h, far, h],
  ];
}

const W_CACHE = new WeakMap();
const wallsFor = (path) => { let w = W_CACHE.get(path); if (!w) { w = wallsOf(path); W_CACHE.set(path, w); } return w; };

/**
 * Keeps a circle of radius `rad` that moved from (x0, z0) to (m.x, m.z) out of the path's walls:
 * a wall crossed is not crossed (the circle stays on the side it came from), and one touched is
 * slid along. Moves m in place; returns true when it moved it.
 */
const KA = { u: 0, v: 0 }; const KB = { u: 0, v: 0 }; const KW = { x: 0, z: 0 }; // (scratch: nothing allocated a frame)
export function keepToPath(path, x0, z0, m, rad) {
  if (!path) return false;
  const A = toLane(path, x0, z0, KA);
  const B = toLane(path, m.x, m.z, KB);
  const walls = wallsFor(path);
  let moved = false;
  for (let pass = 0; pass < 3; pass++) {
    let any = false;
    for (let wi = 0; wi < walls.length; wi++) {
      const wl = walls[wi];
      const u0 = wl[0]; const v0 = wl[1]; const u1 = wl[2]; const v1 = wl[3];
      const along = v0 === v1; // a side (constant v) or an end (constant u)
      // the side it came from, by the line the wall lies on
      const side0 = along ? Math.sign(A.v - v0) : Math.sign(A.u - u0);
      const lo = along ? Math.min(u0, u1) : Math.min(v0, v1);
      const hi = along ? Math.max(u0, u1) : Math.max(v0, v1);
      const t = along ? B.u : B.v; // where along the wall's line it is now
      const off = along ? B.v - v0 : B.u - u0; // and how far off that line, signed
      if (t >= lo && t <= hi) {
        const s = side0 || Math.sign(off) || 1;
        if (off * s < rad) { // through it, or touching it: back out on the side it came from
          if (along) B.v = v0 + s * rad; else B.u = u0 + s * rad;
          any = true;
        }
      } else {
        // past the wall's end: its end point, as a post
        const cu = along ? (t < lo ? lo : hi) : u0;
        const cv = along ? v0 : (t < lo ? lo : hi);
        const du = B.u - cu; const dv = B.v - cv; const d = Math.hypot(du, dv);
        if (d < rad && d > 1e-9) { B.u = cu + (du / d) * rad; B.v = cv + (dv / d) * rad; any = true; }
      }
    }
    if (!any) break;
    moved = true;
  }
  if (moved) {
    const w = fromLane(path, B.u, B.v, KW);
    m.x = w.x; m.z = w.z;
  }
  return moved;
}

/**
 * Where a pickup lying on or by the path is laid as the path opens, so it can still be reached:
 * on the lane, at the lane's height there; in the walls' footprint off it (over the yard's
 * opening, on the cave heap's flank or back), moved onto the lane's nearest walkable stretch.
 * Returns { x, z, y } for one to move or lift, or null for one that is not in the way.
 */
export function seatOnPath(path, p, rad = 0.4) {
  if (!path || !p) return null;
  const q = toLane(path, p.x, p.z, {});
  const far = path.length + path.back;
  const side = path.half + (path.sign > 0 ? RUBBLE.flank : 0) + rad; // (the cave: the heap's flank too, not left buried in it)
  if (q.u < 0 || q.u > far + rad || Math.abs(q.v) > side) return null;
  if (q.u < path.uStep && Math.abs(q.v) > path.half) return null; // beside the shallow start: on the room's floor
  let u = q.u; let v = q.v;
  if (u > path.length - rad - 0.2 || Math.abs(v) > path.half - rad - 0.1) {
    u = Math.min(u, path.length - rad - 0.2);
    v = clamp(v, -(path.half - rad - 0.1), path.half - rad - 0.1);
  }
  const w = fromLane(path, u, v, {});
  return { x: w.x, z: w.z, y: heightAt(path, u) };
}

/** seatOnPath over a list of pickups, in place (y kept only off the room's floor). Returns how many it laid or moved. */
export function seatAllOnPath(path, pickups, rad = 0.4) {
  if (!path || !pickups) return 0;
  let n = 0;
  for (const p of pickups) {
    const at = seatOnPath(path, p, rad);
    if (!at) continue;
    p.x = at.x; p.z = at.z;
    if (Math.abs(at.y) > 1e-9) p.y = at.y; else delete p.y;
    n++;
  }
  return n;
}

// ---- the follow: the view along the path -------------------------------------------------------

/**
 * The follow's three points (the warden's eye as it starts; the slope's foot or top; into the dark
 * or up toward the light) as [x, y, z] x 3, from `from` ({ x, y, z } the warden's feet) and the
 * room's eye height. Writes `out` (a 9-long array).
 */
export function followPoints(path, from, eye, out = new Array(9)) {
  const L = path.length;
  const u1 = L - 0.35;
  out[0] = from.x; out[1] = from.y + eye; out[2] = from.z;
  out[3] = path.x0 + path.dx * u1; out[5] = path.z0 + path.dz * u1;
  if (path.sign < 0) {
    // the yard: down to the slope's foot, low (the warden stoops under the broken floor), then on
    // down the rubble that pours into the black opening
    out[4] = heightAt(path, L) + 0.75 * eye;
    const u2 = L + path.back * 0.5;
    out[6] = path.x0 + path.dx * u2; out[7] = heightAt(path, L) - 0.5; out[8] = path.z0 + path.dz * u2;
  } else {
    // the cave: up to the heap's top, then up into the hole toward the daylight
    out[4] = heightAt(path, L) + eye;
    const top = path.top != null ? path.top : heightAt(path, L) + eye + 3;
    out[6] = path.ex; out[7] = Math.max(out[4] + 1.5, top - 1.0); out[8] = path.ez; // (up to just under the hole: the sky above)
  }
  return out;
}

const bez = (a, b, c, s) => (1 - s) * (1 - s) * a + 2 * s * (1 - s) * b + s * s * c;
const ARC = 32;
const arcTable = new Float64Array(ARC + 1);
const ptsScratch = new Array(9);

const paceOf = (room) => (room === 'cave' ? FOLLOW.cave : FOLLOW.yard);

/** The follow's distance (metres along the curve) t seconds in, over a curve D metres long: still a moment (the yard), up to pace, a steady pace, easing off. */
export function followDistance(D, t, room = 'yard') {
  const P = paceOf(room);
  const T = FOLLOW.length - P.hold; const a = P.accel; const d = P.decel;
  const v = D / (T - a / 2 - d / 2);
  const k = clamp(t - P.hold, 0, T);
  if (k < a) return 0.5 * v * k * k / a;
  if (k < T - d) return v * (k - a / 2);
  const r = T - k;
  return D - 0.5 * v * r * r / d;
}

/** The follow's speed (metres a second) t seconds in, over a curve D metres long. */
export function followSpeed(D, t, room = 'yard') {
  const P = paceOf(room);
  const T = FOLLOW.length - P.hold; const a = P.accel; const d = P.decel;
  const v = D / (T - a / 2 - d / 2);
  const k = t - P.hold;
  if (k <= 0 || k >= T) return 0;
  if (k < a) return v * k / a;
  if (k < T - d) return v;
  return v * (T - k) / d;
}

/**
 * The follow's view t seconds in: { x, y, z (the eye), yaw, pitch (as the player's: forward =
 * (-sin yaw, -cos yaw)), s (0 to 1 along the curve), dist, length (metres), fade (0 to 1: the
 * cover) }. from: { x, y, z, yaw, pitch }, the warden as it started; eye: the room's eye height.
 * Pure; writes `out` (no allocation but the first call's).
 */
export function followAt(path, from, eye, t, out = {}) {
  const P = followPoints(path, from, eye, ptsScratch);
  // arc length along the curve (a table of chords)
  arcTable[0] = 0;
  let px = P[0]; let py = P[1]; let pz = P[2];
  for (let i = 1; i <= ARC; i++) {
    const s = i / ARC;
    const x = bez(P[0], P[3], P[6], s); const y = bez(P[1], P[4], P[7], s); const z = bez(P[2], P[5], P[8], s);
    arcTable[i] = arcTable[i - 1] + Math.hypot(x - px, y - py, z - pz);
    px = x; py = y; pz = z;
  }
  const D = arcTable[ARC];
  const room = path.sign < 0 ? 'yard' : 'cave';
  const dist = followDistance(D, t, room);
  let i = 1;
  while (i < ARC && arcTable[i] < dist) i++;
  const seg = arcTable[i] - arcTable[i - 1];
  const s = clamp((i - 1 + (seg > 1e-9 ? (dist - arcTable[i - 1]) / seg : 0)) / ARC);
  out.x = bez(P[0], P[3], P[6], s); out.y = bez(P[1], P[4], P[7], s); out.z = bez(P[2], P[5], P[8], s);
  // the look: from the warden's own onto the path (its heading), then down into the dark or up to the light
  const T = FOLLOW.length;
  const k = smooth(t / FOLLOW.turn);
  const heading = Math.atan2(-path.dx, -path.dz);
  let dy = heading - from.yaw;
  dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
  out.yaw = from.yaw + dy * k;
  // the yard: down along the ramp, then down into the dark; the cave: down onto the heap's crest
  // (FOLLOW.look) for FOLLOW.level seconds (the climb is seen), then up 72 degrees over FOLLOW.up, then on up to the sky
  const pathPitch = path.sign < 0
    ? mix(-0.45, -0.85, smooth((t - FOLLOW.turn) / (T - FOLLOW.turn)))
    : FOLLOW.look + 1.25 * smooth((t - FOLLOW.level) / FOLLOW.up) + 0.32 * smooth((t - FOLLOW.level - FOLLOW.up) / (T - FOLLOW.level - FOLLOW.up));
  out.pitch = mix(from.pitch, pathPitch, k);
  out.s = s; out.dist = dist; out.length = D;
  out.fade = followFade(t);
  return out;
}

/** The cover over the follow t seconds in, 0 to 1: nothing until its last FOLLOW.fade seconds. */
export function followFade(t) {
  return smooth((t - (FOLLOW.length - FOLLOW.fade)) / FOLLOW.fade);
}
