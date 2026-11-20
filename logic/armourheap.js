// A fallen suit's pieces, each pushed on its own and kept out of stone (the owner, 2026-11-19:
// "when I push the rusted suit of armor around after it's fallen to the ground, it still moves
// through stone walls. Treat the different pieces of the armor ... as individual pieces when they
// get pushed around. They cannot move through solid objects"; and of the suit that fights: "after
// it dies its pieces can get pushed around, but should never move through a wall, pillar, door").
//
// Until now the heap was the first suit's enemy record: enemy.js separate() kept it off the
// warden as one circle (radius 0.6) and the view carried every piece with it, so the circle's
// middle stayed out of the walls while the cuirass, the plates and the 3.3 m pike, lying a metre
// and more from it, went into them. The second suit's pieces were never pushed at all.
//
// Now each suit that comes apart lays a heap here (sim.waves.heaps): its sixteen pieces, the four
// big ones (cuirass, helm, claw, pike) and the twelve limb plates, each a rod lying on the floor
// (ends a and b, radius r: the same rods debris.js lets fall), laid where the fall lays it
// (debris.js clearRest) and made clear of the boxes and inside the plan. The heap's own enemy
// record no longer moves (e.anchored). Each frame (stepHeaps, from keep.js stepKeep):
//   - the warden's circle (his radius and PAD) shoves every piece it overlaps straight out of it,
//     by the overlap, as the heap was shoved before: no speed of its own, no slide on after;
//   - a piece moves in substeps shorter than 0.9 of its radius, and after each the rod is pushed
//     out of every box it meets (its samples, every few centimetres, as circles against the boxes
//     in plan; a box above or below the rod is not met), so it slides along a face and no push,
//     however fast, takes it through even a door leaf; a substep that leaves it in a box or takes
//     an end off the plan (out of every room, off the bridge's deck, onto a stair) is undone and
//     it goes no further this frame;
//   - a piece it is shoved into is shoved on by what it was pushed into it (simple separation:
//     pieces of the heap already lying across each other are left so), and what that one cannot
//     take comes back on the first;
//   - any piece some box has come into (a door leaf swinging) is pushed out of it.
// The boxes are the live collision list the warden walks against (sim.boxes, keep.js keepBoxes:
// the walls, the jambs, the doors shut or their leaves, the cover, furniture, chessmen), less the
// ones nobody sees (debris.js stoneFor). Pure: no DOM, no Math.random; the view (keepcast.js) lays
// the fall onto each piece's rest and draws each piece moved by its offset (ox, oz).

import { SUIT_RODS, restEnds, heapLayout, toWorld, clearRest, stoneFor } from './debris.js';
import { COVER, ZONES, SENTRIES, zoneAt, floorZoneAt } from './keepmap.js';

const fz = (o) => Object.freeze(o);

/**
 * The pieces of a suit, in the order the view keeps them (keepcast.js: the four meshes, then the
 * twelve instanced plates of S.limbs: each arm shoulder to elbow, elbow to wrist, the mitten; each
 * leg hip to knee, knee to ankle, the foot). r: the rod's radius, the piece's footprint about its
 * axis (at least 8 cm, as the fall's).
 */
const ARM = [0.115, 0.115 * 0.82, 0.115 * 1.2]; // keepcast.js placeArm(r 0.115, mitt 1.2)
const LEG = [0.135, 0.135 * 0.76, 0.135 * 0.86]; // placeLeg(r 0.135)
const PLATE_NAMES = ['rerebrace', 'vambrace', 'mitten', 'cuisse', 'greave', 'sabaton'];
export const HEAP_PIECES = fz([
  fz({ id: 'torso', name: 'cuirass', r: SUIT_RODS.torso.r }),
  fz({ id: 'helm', name: 'helm', r: SUIT_RODS.helm.r }),
  fz({ id: 'claw', name: 'gauntlet', r: SUIT_RODS.claw.r }),
  fz({ id: 'pike', name: 'pike', r: SUIT_RODS.pike.r }),
  ...Array.from({ length: 12 }, (_, i) => {
    const leg = i >= 6; const k = i % 3;
    const side = Math.floor(i / 3) % 2 ? 'left' : 'right';
    return fz({ id: `plate${i}`, name: `${side} ${PLATE_NAMES[k + (leg ? 3 : 0)]}`, r: Math.max(0.08, (leg ? LEG : ARM)[k]) });
  }),
]);

/** The view's seeded generator (sculpt.js rng), here so the heap's plates lie where the view's fall lays them. */
export function heapRand(seed = 1) {
  let s = (Math.floor(seed * 2654435761) ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed each suit's view is built from (keepcast.js buildArmour). */
export const suitSeed = (suit) => (suit === 1 ? 31 : 44);

const LOCAL = new Map();
/**
 * Where each piece lies once the suit has come apart, in the suit's frame ({ a, b } each), before
 * any stone is met: the four big pieces at debris.js SUIT_REST, the plates in the heap heapLayout
 * draws from the suit's seed (the view draws four waits first, one for each big piece).
 */
export function suitRests(suit) {
  let out = LOCAL.get(suit);
  if (out) return out;
  const rand = heapRand(suitSeed(suit));
  for (let i = 0; i < 4; i++) rand();
  const h = heapLayout(rand);
  out = fz([
    ...['torso', 'helm', 'claw', 'pike'].map((k) => fz(restEnds(k))),
    ...h.A.map((a, i) => fz({ a: a.slice(), b: h.B[i].slice() })),
  ]);
  LOCAL.set(suit, out);
  return out;
}

/** (x, z) moved clear of the forecourt's cover by r, so a heap never lies in a block: writes into out. */
export function clearOfCover(x, z, r, out) {
  let nz = z;
  for (const b of COVER) {
    if (x > b.minX - r && x < b.maxX + r && nz > b.minZ - r && nz < b.maxZ + r) nz = nz < (b.minZ + b.maxZ) / 2 ? b.minZ - r : b.maxZ + r;
  }
  out.x = x; out.z = Math.max(1.5, nz); // and off the door's own wall
  return out;
}

// ---- tuning ---------------------------------------------------------------------------------

/** Metres beyond the warden's radius that his feet shove a piece (the old heap's 0.35 over its 0.6 circle, now at each piece's own edge). */
export const PAD = 0.12;
const SAMPLE = 0.08; // metres between a rod's tested circles at most (debris.js)
const SUB = 0.9; // a substep moves a piece at most this share of its radius
const PASSES = 4;
const REACH = 0.5; // metres: a box this far beyond a piece's extent is not looked at
const FLOOR_DY = 0.6; // the warden shoves only on the heap's own floor
const SLOP = 1e-4;

// zones whose floor is not one level everywhere: a piece's ends there are read against the floor itself
const FLOOR_VARIES = new Set(['road', 'stairs', ...ZONES.filter((z) => z.lower).map((z) => z.id)]);
const ZONE_Y = new Map(ZONES.map((z) => [z.id, z.y]));

// ---- small 2D geometry (scratch, no allocation) ---------------------------------------------

const P = { x: 0, z: 0, t: 0, d: 0 }; // closest point on a segment
function closestOnSeg(ax, az, bx, bz, px, pz) {
  const ux = bx - ax; const uz = bz - az;
  const L2 = ux * ux + uz * uz;
  let t = L2 > 1e-12 ? ((px - ax) * ux + (pz - az) * uz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  P.x = ax + ux * t; P.z = az + uz * t; P.t = t;
  P.d = Math.hypot(px - P.x, pz - P.z);
  return P;
}

const Q = { px: 0, pz: 0, qx: 0, qz: 0, d: 0 }; // closest points between two segments
function segSeg(ax, az, bx, bz, cx, cz, dx, dz) {
  // Ericson 5.1.9, in plan
  const d1x = bx - ax; const d1z = bz - az; const d2x = dx - cx; const d2z = dz - cz;
  const rx = ax - cx; const rz = az - cz;
  const a = d1x * d1x + d1z * d1z; const e = d2x * d2x + d2z * d2z; const f = d2x * rx + d2z * rz;
  let s; let t;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1x * rx + d1z * rz;
    if (e <= 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1x * d2x + d1z * d2z; const den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  Q.px = ax + d1x * s; Q.pz = az + d1z * s; Q.qx = cx + d2x * t; Q.qz = cz + d2z * t;
  Q.d = Math.hypot(Q.qx - Q.px, Q.qz - Q.pz);
  return Q;
}

const N = { x: 0, z: 0, d: 0 }; // a circle's way out of a box, and how deep it stands
/** A circle (x, z, r) against a box in plan: depth (0 when clear) and the way out in N. */
function circleBox(x, z, r, b) {
  if (b.round) {
    const dx = x - b.x; const dz = z - b.z; const need = r + b.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= need * need) return 0;
    const d = Math.sqrt(d2);
    if (d > 1e-9) { N.x = dx / d; N.z = dz / d; } else { N.x = 0; N.z = 1; }
    N.d = need - d;
    return N.d;
  }
  const cx = x < b.minX ? b.minX : x > b.maxX ? b.maxX : x;
  const cz = z < b.minZ ? b.minZ : z > b.maxZ ? b.maxZ : z;
  const dx = x - cx; const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return 0;
  if (d2 > 1e-14) {
    const d = Math.sqrt(d2);
    N.x = dx / d; N.z = dz / d; N.d = r - d;
    return N.d;
  }
  // the middle inside the box (only a box that came onto it, a leaf swinging): out by the shallowest face
  const l = x - b.minX; const rr = b.maxX - x; const bk = z - b.minZ; const fr = b.maxZ - z;
  const m = Math.min(l, rr, bk, fr);
  if (m === l) { N.x = -1; N.z = 0; } else if (m === rr) { N.x = 1; N.z = 0; } else if (m === bk) { N.x = 0; N.z = -1; } else { N.x = 0; N.z = 1; }
  N.d = m + r;
  return N.d;
}

// ---- a piece ---------------------------------------------------------------------------------

/** A piece's ends now (its rest moved by its offset), in plan: written to E. */
const E = { ax: 0, az: 0, bx: 0, bz: 0 };
function endsOf(p) {
  E.ax = p.a[0] + p.ox; E.az = p.a[2] + p.oz; E.bx = p.b[0] + p.ox; E.bz = p.b[2] + p.oz;
  return E;
}

const ONE = [];
const ONE_OF = (h) => { ONE.length = 0; ONE.push(h); return ONE; };

/** The boxes near the heaps this frame (reused), each met only by pieces it stands beside. */
const NEAR = [];
function gather(heaps, boxes, extra = 0) {
  NEAR.length = 0;
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const h of heaps) for (const p of h.pieces) {
    const e = endsOf(p);
    minX = Math.min(minX, e.ax - p.r, e.bx - p.r); maxX = Math.max(maxX, e.ax + p.r, e.bx + p.r);
    minZ = Math.min(minZ, e.az - p.r, e.bz - p.r); maxZ = Math.max(maxZ, e.az + p.r, e.bz + p.r);
  }
  const pad = REACH + 1 + extra; // a piece moves under a metre in a frame
  for (const b of boxes || []) {
    if (!b || b.kind === 'board' || b.kind === 'swarm' || b.kind === 'giant') continue; // debris.js stoneFor's unseen boxes
    if (b.maxX < minX - pad || b.minX > maxX + pad || b.maxZ < minZ - pad || b.minZ > maxZ + pad) continue;
    NEAR.push(b);
  }
}

/** Does box b stand where the rod p lies, in height? (a box's minY/maxY over the floor, as debris.js stoneFor) */
function meetsInHeight(p, b, floor) {
  const lo = Math.min(p.a[1], p.b[1]) - p.r; const hi = Math.max(p.a[1], p.b[1]) + p.r;
  const bMin = floor + (Number.isFinite(b.minY) ? b.minY : 0);
  const bMax = floor + (Number.isFinite(b.maxY) ? b.maxY : 6);
  return hi > bMin + 1e-6 && lo < bMax - 1e-6;
}

/** Pushes the piece rigidly out of the near boxes (a few passes). Returns how deep it still stands. */
function pushOut(p, floor) {
  let worst = 0;
  for (let pass = 0; pass < PASSES; pass++) {
    worst = 0;
    const e = endsOf(p);
    const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
    const n = Math.max(1, Math.ceil(len / Math.min(SAMPLE, p.r)));
    const loX = Math.min(e.ax, e.bx) - p.r; const hiX = Math.max(e.ax, e.bx) + p.r;
    const loZ = Math.min(e.az, e.bz) - p.r; const hiZ = Math.max(e.az, e.bz) + p.r;
    let moved = false;
    for (const b of NEAR) {
      if (b.maxX < loX || b.minX > hiX || b.maxZ < loZ || b.minZ > hiZ) continue;
      if (!meetsInHeight(p, b, floor)) continue;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = p.a[0] + p.ox + (p.b[0] - p.a[0]) * t; const z = p.a[2] + p.oz + (p.b[2] - p.a[2]) * t;
        const d = circleBox(x, z, p.r, b);
        if (d <= SLOP) continue;
        worst = Math.max(worst, d);
        p.ox += N.x * (d + SLOP); p.oz += N.z * (d + SLOP);
        moved = true;
      }
    }
    if (!moved) return 0;
  }
  return depthIn(p, floor);
}

/** How deep the piece stands in the near boxes at most (0: clear). */
function depthIn(p, floor) {
  let worst = 0;
  const e = endsOf(p);
  const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
  const n = Math.max(1, Math.ceil(len / Math.min(SAMPLE, p.r)));
  for (const b of NEAR) {
    if (!meetsInHeight(p, b, floor)) continue;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const d = circleBox(e.ax + (e.bx - e.ax) * t, e.az + (e.bz - e.az) * t, p.r, b);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/** Is (x, z) on the plan, on the heap's floor? */
function onFloor(x, z, floor, w) {
  const zn = zoneAt(x, z);
  if (zn == null) return false;
  if (FLOOR_VARIES.has(zn)) return Math.abs(floorZoneAt(x, z, floor + 0.3, w).floor - floor) < 0.05;
  const y = ZONE_Y.get(zn);
  return y == null || Math.abs(y - floor) < 0.05;
}

/** Is the piece on the plan: both ends and its middle in a room, on its own floor? */
function onPlan(p, floor, w) {
  const e = endsOf(p);
  return onFloor(e.ax, e.az, floor, w) && onFloor(e.bx, e.bz, floor, w) && onFloor((e.ax + e.bx) / 2, (e.az + e.bz) / 2, floor, w);
}

/**
 * Moves the piece by (dx, dz) in substeps, out of the boxes after each; a substep that leaves it
 * in stone or off the plan is undone and the piece goes no further. Returns how far it went
 * along (dx, dz) (0..1 of it).
 */
export function movePiece(p, dx, dz, floor, w) {
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return 1;
  const n = Math.max(1, Math.ceil(len / (SUB * p.r)));
  const sx = dx / n; const sz = dz / n;
  const x0 = p.ox; const z0 = p.oz;
  for (let s = 0; s < n; s++) {
    const px = p.ox; const pz = p.oz;
    p.ox += sx; p.oz += sz;
    if (pushOut(p, floor) > 0.002 || !onPlan(p, floor, w)) { p.ox = px; p.oz = pz; break; }
  }
  return Math.max(0, ((p.ox - x0) * dx + (p.oz - z0) * dz) / (len * len));
}

/** The other pieces p was just moved into: each shoved on by what it was pushed in; what it cannot take comes back on p. */
function shoveOn(w, p, h, bx0, bz0, depth) {
  for (const h2 of w.heaps) for (const q of h2.pieces) {
    if (q === p) continue;
    const e = endsOf(p);
    const ax = e.ax; const az = e.az; const bx = e.bx; const bz = e.bz;
    const qa0 = q.a[0] + q.ox; const qa2 = q.a[2] + q.oz; const qb0 = q.b[0] + q.ox; const qb2 = q.b[2] + q.oz;
    const need = p.r + q.r;
    const now = segSeg(ax, az, bx, bz, qa0, qa2, qb0, qb2);
    if (now.d >= need) continue;
    const dNow = now.d; const nx0 = now.qx - now.px; const nz0 = now.qz - now.pz;
    // how far into q it was before this move (pieces already lying across each other are left so)
    const was = segSeg(ax - bx0, az - bz0, bx - bx0, bz - bz0, qa0, qa2, qb0, qb2).d;
    const into = Math.max(0, need - dNow) - Math.max(0, need - was);
    if (into <= 1e-4) continue;
    let nx; let nz;
    if (dNow > 1e-6) { nx = nx0 / dNow; nz = nz0 / dNow; } else { const m = Math.hypot(bx0, bz0) || 1; nx = bx0 / m; nz = bz0 / m; }
    const took = depth < 2 ? shove(w, q, h2, nx * into, nz * into, depth + 1) : movePiece(q, nx * into, nz * into, h2.floor, w);
    const back = into * (1 - took);
    if (back > 1e-4) movePiece(p, -nx * back, -nz * back, h.floor, w);
  }
}

/** Moves p by (dx, dz), then shoves on what it ran into. Returns the share of the move it made. */
function shove(w, p, h, dx, dz, depth = 0) {
  const ox = p.ox; const oz = p.oz;
  const took = movePiece(p, dx, dz, h.floor, w);
  const mx = p.ox - ox; const mz = p.oz - oz;
  if (mx * mx + mz * mz > 1e-10) shoveOn(w, p, h, mx, mz, depth);
  return took;
}

// ---- heaps -------------------------------------------------------------------------------------

/**
 * A heap laid where a suit came apart: frame { x, z, f } (where it stood and faced, f as three.js
 * rotation.y), on floor `floor`, against the boxes. Each piece where the fall lays it (the heap
 * first moved clear of the forecourt's cover, as the view always moved it; then clearRest), then
 * made clear of the boxes in plan and kept on the plan (drawn in toward the suit's middle, a few
 * centimetres at a time, until it is). Returns { suit, x, z, f, floor, push, pieces }.
 */
export function layHeap(suit, frame, floor, boxes, w) {
  const f = Number.isFinite(frame.f) ? frame.f : 0;
  const fr = { x: frame.x, y: floor, z: frame.z, f };
  const at = clearOfCover(frame.x - Math.sin(f) * 0.6, frame.z - Math.cos(f) * 0.6, 1.25, { x: 0, z: 0 });
  const sx = at.x - (frame.x - Math.sin(f) * 0.6); const sz = at.z - (frame.z - Math.cos(f) * 0.6);
  const stone = stoneFor(boxes, floor, fr, 7);
  const pivot = { x: frame.x, z: frame.z };
  const rests = suitRests(suit);
  const pieces = HEAP_PIECES.map((spec, i) => {
    const q = rests[i];
    const a = toWorld(fr, q.a); const b = toWorld(fr, q.b);
    a[0] += sx; a[2] += sz; b[0] += sx; b[2] += sz;
    const c = clearRest({ a, b }, spec.r, stone, pivot, floor);
    return { id: spec.id, r: spec.r, a: c.a, b: c.b, ox: 0, oz: 0 };
  });
  const h = { suit, x: frame.x, z: frame.z, f, floor, push: false, rev: 0, sum: 0, pieces };
  gather(ONE_OF(h), boxes);
  for (const p of pieces) {
    // the least draw in toward the suit's middle (5 cm at a time) from which it comes clear and on the plan
    const mx = (p.a[0] + p.b[0]) / 2; const mz = (p.a[2] + p.b[2]) / 2;
    const d = Math.hypot(pivot.x - mx, pivot.z - mz);
    const ux = d > 1e-6 ? (pivot.x - mx) / d : 0; const uz = d > 1e-6 ? (pivot.z - mz) / d : 0;
    let ok = false;
    for (let k = 0; k * 0.05 <= d + 1e-9 && !ok; k++) {
      p.ox = ux * 0.05 * k; p.oz = uz * 0.05 * k;
      ok = pushOut(p, floor) <= 0.002 && onPlan(p, floor, w);
    }
    if (!ok) { p.ox = pivot.x - mx; p.oz = pivot.z - mz; pushOut(p, floor); } // on the spot it stood on
    // the rest is where it lies: the fall is laid onto it
    for (const e of [p.a, p.b]) { e[0] += p.ox; e[2] += p.oz; }
    p.ox = 0; p.oz = 0;
  }
  return h;
}

/** The heap of suit `suit`, or null. */
export function heapOf(w, suit) {
  const hs = w && w.heaps;
  if (!hs) return null;
  for (const h of hs) if (h.suit === suit) return h;
  return null;
}

/** Where the second suit's heap lies when no kill was seen: its body's record, else a step out from where it stood (keepcast.js layHeaps). */
function secondFrame(w, kill) {
  if (kill) return { x: kill.x, z: kill.z, f: kill.heading };
  const body = (w.bodies || []).find((b) => b && b.enemy === 'armour' && (b.suit == null || b.suit === 2));
  const p = SENTRIES.suits[1];
  if (body) return { x: body.x, z: body.z, f: Number.isFinite(body.heading) ? body.heading : (p.yaw || 0) - 0.4 };
  const at = clearOfCover(p.x - Math.sin(p.yaw || 0) * 1.6, p.z - Math.cos(p.yaw || 0) * 1.6, 1.25, { x: 0, z: 0 });
  return { x: at.x, z: at.z, f: (p.yaw || 0) - 0.4 };
}

/**
 * One frame of the heaps (keep.js stepKeep, after the warden and the creatures have moved and the
 * frame's kills are settled): a heap is laid for each suit that has begun to come apart (the first
 * as it starts to crumble, shoved only once it is down; the second as it is killed, or after a
 * restore from its body), then the warden shoves the pieces his circle overlaps and every piece is
 * kept out of the boxes.
 */
export function stepHeaps(sim, events) {
  const w = sim.waves;
  if (!w) return;
  if (!Array.isArray(w.heaps)) w.heaps = [];
  let first = null;
  for (const e of sim.enemies) if (e.type === 'armour' && e.suit === 1) first = e;
  if (first && (first.state === 'crumble' || first.state === 'heap')) {
    first.anchored = true;
    let h = heapOf(w, 1);
    if (!h) { h = layHeap(1, { x: first.x, z: first.z, f: first.heading }, 0, sim.boxes, w); w.heaps.push(h); }
    h.push = first.state === 'heap';
  }
  if (w.done && w.done.armour && !heapOf(w, 2)) {
    let kill = null;
    for (const ev of events || []) if (ev.type === 'kill' && ev.enemy === 'armour') kill = ev;
    const h = layHeap(2, secondFrame(w, kill), 0, sim.boxes, w);
    h.push = true;
    w.heaps.push(h);
  }
  if (!w.heaps.length) return;
  gather(w.heaps, sim.boxes);
  const pl = sim.player;
  const R = sim.cfg.player.radius + PAD;
  if (pl && !pl.dead) {
    for (const h of w.heaps) {
      if (!h.push || Math.abs((pl.y || 0) - h.floor) > FLOOR_DY) continue;
      for (const p of h.pieces) {
        const e = endsOf(p);
        const c = closestOnSeg(e.ax, e.az, e.bx, e.bz, pl.x, pl.z);
        const need = R + p.r;
        if (c.d >= need) continue;
        let nx; let nz;
        if (c.d > 1e-6) { nx = (c.x - pl.x) / c.d; nz = (c.z - pl.z) / c.d; }
        else { nx = -Math.sin(pl.yaw || 0); nz = -Math.cos(pl.yaw || 0); } // dead under him: on the way he faces
        const k = need - c.d;
        shove(w, p, h, nx * k, nz * k);
      }
    }
  }
  // a box come onto a piece (a leaf swinging to): out of it
  for (const h of w.heaps) for (const p of h.pieces) pushOut(p, h.floor);
  for (const h of w.heaps) markMoves(h);
}

/** h.rev goes up whenever a piece of the heap has moved since it was last marked (the view redraws a fallen suit only then). */
function markMoves(h) {
  let sum = 0;
  for (let i = 0; i < h.pieces.length; i++) sum += h.pieces[i].ox * (i + 1) + h.pieces[i].oz * (i + 17);
  if (sum !== h.sum) { h.sum = sum; h.rev = (h.rev || 0) + 1; }
}

/**
 * Shoves piece `index` of suit `suit`'s heap by (dx, dz) at once, as the warden's push does (in
 * substeps, against the boxes, shoving on what it meets). For tests. Returns the share it went.
 */
export function pushPiece(w, boxes, suit, index, dx, dz) {
  const h = heapOf(w, suit);
  if (!h || !h.pieces[index]) return 0;
  gather(w.heaps, boxes, Math.hypot(dx, dz));
  const took = shove(w, h.pieces[index], h, dx, dz);
  for (const h2 of w.heaps) markMoves(h2);
  return took;
}

/** Each piece now: where it lies, how deep it stands in the boxes (0: clear) and whether it is on the plan. For tests and the smoke. */
export function heapReport(w, boxes) {
  const out = [];
  if (!w || !Array.isArray(w.heaps)) return out;
  gather(w.heaps, boxes);
  for (const h of w.heaps) {
    for (let i = 0; i < h.pieces.length; i++) {
      const p = h.pieces[i];
      out.push({
        suit: h.suit, id: p.id, name: HEAP_PIECES[i].name, r: p.r, ox: p.ox, oz: p.oz,
        a: [p.a[0] + p.ox, p.a[1], p.a[2] + p.oz], b: [p.b[0] + p.ox, p.b[1], p.b[2] + p.oz],
        depth: depthIn(p, h.floor), onPlan: onPlan(p, h.floor, w),
      });
    }
  }
  return out;
}
