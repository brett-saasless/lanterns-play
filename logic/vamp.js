// The Dracula pass (the owner, 2026-11-19: "the castle looks generic. give it a vampiric tone. a
// house fit for dracula"; "most should be pure vampiric", about one Alice hybrid in five): the pure
// half of it. How rich each room is (decayed grandeur that deepens toward the Count), the light's
// faint crimson grade at that richness, the palette, the dust motes' points and drift, and where
// every piece of decor stands, as one list (decorPlan) that castle.js builds from and the tests
// check against the doors, the clues, the wall art and the routes. No three, no DOM, no Math.random:
// the seeded placements come from rng.js.
//
// Decor kinds: gargoyle (crouch, spread, cheshire*, teacup*), bat (bat, watch*), crest (dracul,
// spade*, heart*; finish plaque or relief), coffin (iron, spade*), chandelier (iron, teacup*),
// candelabra (iron, teacup*), bottle* (the cracked DRINK ME carved on a lintel), web (corner or
// arch: three points), motes (a shaft of dust). * is an Alice hybrid.
//
// A placement: { id, zone, kind, variant, hybrid, x, y, z, n: [nx, nz], w, h, proud, out, mount }.
// Wall things: (x, z) on the wall's inner face, y the bottom (absolute), n the wall's inward normal,
// w along the wall, h tall, proud how far it stands off its mounting face, out how far that face
// stands off the wall (a mantel's overmantel, a pier's face). Corner things: (x, z) the corner, n the
// diagonal into the room. Hung things (mount 'hang'): (x, z) the centre, y the lowest point, h up to
// the ceiling, w across.

import { ZONES, DOORS, HALL, CORRIDOR, HEARTHS, PIERS, WALL, wallArt } from './keepmap.js';
import { doorHeight } from './doorleaves.js';
import { makeRng } from './rng.js';

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const SQ = Math.SQRT1_2;

/**
 * How rich each zone is, 0 to 1 (the owner's table): plain-grand at the door, darker through the
 * gallery and the Knight's Walk, lavish and wrong upstairs and in the Count's room. Never falls as the
 * stages rise (tests/vamp.test.js). Zones between the owner's rows take the value between them.
 */
export const RICHNESS = f({
  outside: 0.15, hall: 0.25, cor1: 0.3, cor2: 0.4, tea: 0.4, gallery: 0.5, crypt: 0.6, cor3: 0.55,
  walk: 0.6, stairs: 0.65, landing: 0.8, mirror: 0.8, passage: 0.8, nursery: 0.8, countway: 0.9, count: 1.0,
});

/** The zones the pass has dressed so far (group 1); later groups add theirs. Only these take the grade. */
export const DRESSED = f(['outside', 'hall', 'cor1', 'cor2', 'cor3']);

/** richness 0..1 of a castle zone id ('crypt' is the gallery's lower floor); 0 for anything else. */
export function richnessOf(id) {
  return Object.prototype.hasOwnProperty.call(RICHNESS, id) ? RICHNESS[id] : 0;
}

/** The decayed-grandeur palette: near-black stone, tarnished gold, dusty crimson, bone, candle amber, iron, wax. */
export const PALETTE = f({
  stone: 0x8d8f94, soot: 0x5d5f63, gold: 0x7d6330, goldDim: 0x5a4826, crimson: 0x5e1a1e, crimsonDust: 0x6e3a3a,
  bone: 0xd6cdb4, amber: 0xffb46a, iron: 0x171515, rust: 0x3a2018, wax: 0xcdbf9c, wood: 0x5a3a26, china: 0xe6e0d4,
});

/**
 * The grade at full richness: how far each part of the light leans toward its crimson at 1. Fire is
 * the flames' light (the pool and a fire key), sky and shadow the night air (hemisphere sky and
 * ground), fog the dark itself, stone how much darker the stone is drawn, warm how much redder.
 */
export const GRADE = f({
  // (the art critic: the red lives in the flame light; the stone stays cool near-black, the shadows oxblood)
  fire: { hex: 0xff6448, mix: 0.5 },
  sky: { hex: 0x5a3050, mix: 0.25 },
  shadow: { hex: 0x3a0c16, mix: 0.5 },
  fog: { hex: 0x1a0a10, mix: 0.4 },
  stone: 0.22, warm: 0.03,
  glow: [1.0, 0.42, 0.2], // a candle's baked pool at richness 1 (the tea room's exit candle is [1, 0.56, 0.22])
  moon: [0.5, 0.56, 0.68], // the moon's baked light on what stands in a slit's shaft (it never flickers: it breathes, MOON_BREATH)
});

/**
 * The grade of one zone: { r, fire, sky, shadow, fog, stoneK, warm, glow } with every mix already
 * scaled by its richness, or all zero for a zone not yet dressed. Outside, the moon is left alone:
 * only the torches' light leans red there.
 */
export function gradeOf(id) {
  const r = DRESSED.includes(id) ? richnessOf(id) : 0;
  const inside = id !== 'outside';
  const g0 = [1.0, 0.56, 0.22];
  return {
    r,
    fire: GRADE.fire.mix * r,
    sky: inside ? GRADE.sky.mix * r : 0,
    shadow: inside ? GRADE.shadow.mix * r : 0,
    fog: inside ? GRADE.fog.mix * r : 0,
    stoneK: 1 - GRADE.stone * r,
    warm: GRADE.warm * r,
    glow: g0.map((c, i) => c + (GRADE.glow[i] - c) * r),
  };
}

// ---- dust motes --------------------------------------------------------------------------------

/** The motes' drift: slow, so each one can be followed by eye (the owner: readable, not flying by). */
export const MOTES = f({ amp: 0.26, rates: [0.21, 0.133, 0.171], twinkle: 0.5, size: 0.04, maxSpeed: 0.1, peak: 0.08 });

/** The moon's still glow on a coffin breathes, too slow to read as flicker: +/- depth over period seconds. */
export const MOON_BREATH = f({ depth: 0.06, period: 25 });

/** The fastest a mote ever moves, metres a second: amp times the largest rate, per axis, as a length. */
export function moteTopSpeed() {
  return MOTES.amp * Math.hypot(...MOTES.rates);
}

/**
 * The points of one shaft of dust: { positions: Float32Array (x, y, z), seeds: Float32Array, glow:
 * Float32Array (0..1, how far into the light) }. vol: { from: [x, y, z], to: [x, y, z], spread: [a, b],
 * n } where spread is the shaft's half width across (a) and its half depth (b, taken along y at the
 * top end and narrowing to the floor); seeded, so the same shaft always holds the same dust.
 */
export function motePoints(vol, seed = 1) {
  const rand = makeRng((seed * 2654435761) >>> 0);
  const n = vol.n;
  const positions = new Float32Array(n * 3); const seeds = new Float32Array(n); const glow = new Float32Array(n);
  const [ax, ay, az] = vol.from; const [bx, by, bz] = vol.to;
  // across the shaft: the horizontal direction square to its run (or x when it falls straight down)
  let cx = -(bz - az); let cz = bx - ax;
  const cl = Math.hypot(cx, cz);
  if (cl < 1e-6) { cx = 1; cz = 0; } else { cx /= cl; cz /= cl; }
  for (let i = 0; i < n; i++) {
    const t = rand();
    const u = (rand() * 2 - 1); const v = (rand() * 2 - 1);
    const across = u * vol.spread[0]; const up = v * vol.spread[1] * (1 - 0.6 * t);
    positions[i * 3] = ax + (bx - ax) * t + cx * across;
    positions[i * 3 + 1] = ay + (by - ay) * t + up;
    positions[i * 3 + 2] = az + (bz - az) * t + cz * across;
    seeds[i] = rand();
    glow[i] = clamp(1 - Math.max(Math.abs(u), Math.abs(v)) ** 2) * (0.55 + 0.45 * (1 - t));
  }
  return { positions, seeds, glow };
}

// ---- the plan's geometry helpers ---------------------------------------------------------------

const zoneOf = (id) => ZONES.find((z) => z.id === id);
const doorById = (id) => DOORS.find((d) => d.id === id);

/**
 * The moon slits the passages have (castle.js makePlan's SLIT calls, kept equal by a test): rect index,
 * wall, along. Read for the dust in their shafts and to keep decor off them.
 */
export const SLITS = f({
  cor1: { rect: 1, side: 's', c: 8.4 }, cor2: { rect: 1, side: 's', c: 3.5 }, cor3: { rect: 1, side: 's', c: 7.5 },
  countway: { rect: 0, side: 'e', c: -148.6 },
});
export const SLIT_SIZE = f({ w: 0.5, h: 1.7, sill: 1.1, rise: 0.25 });

/** A point on a zone rect's wall face and the wall's inward normal: side n (minZ), s (maxZ), w (minX), e (maxX). */
export function onWall(r, side, c) {
  if (side === 'n') return { x: c, z: r.minZ, n: [0, 1] };
  if (side === 's') return { x: c, z: r.maxZ, n: [0, -1] };
  if (side === 'w') return { x: r.minX, z: c, n: [1, 0] };
  return { x: r.maxX, z: c, n: [-1, 0] };
}

/**
 * The torches castle.js buildPassage hangs in a passage, by its own rule (one in a short leg, one every
 * 7 m along a long run, on alternate walls, none within 2.2 m of the wives' painting or a banner), so
 * decor keeps off them: [{ x, z, n }].
 */
export function passageTorches(id) {
  const z = zoneOf(id);
  const taken = [CORRIDOR.painting, ...CORRIDOR.banners];
  const out = [];
  let k = 0;
  for (const r of z.rects) {
    const alongZ = (r.maxZ - r.minZ) >= (r.maxX - r.minX);
    const len = alongZ ? r.maxZ - r.minZ : r.maxX - r.minX;
    const sides = alongZ ? ['w', 'e'] : ['n', 's'];
    const lo = alongZ ? r.minZ : r.minX;
    const n = Math.max(1, Math.round(len / 7));
    for (let i = 0; i < n; i++) {
      const c = lo + (len * (i + 0.5)) / n;
      const p = onWall(r, sides[(k++) % 2], c);
      if (taken.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 2.2)) out.push(p);
    }
  }
  return out;
}

/**
 * The concave corners of a zone (where two of its walls meet with the floor on the inside), each with
 * the diagonal into the room: [{ x, z, n: [nx, nz] }]. A doorway's floor counts as floor, so a
 * passage's end that runs into a door is no corner.
 */
export function concaveCorners(id) {
  const z = zoneOf(id);
  const clear = [...z.rects, ...DOORS.filter((d) => d.zones.includes(id)).map((d) => d.rect)];
  const isClear = (x, zz) => clear.some((r) => x > r.minX && x < r.maxX && zz > r.minZ && zz < r.maxZ);
  const out = []; const seen = new Set();
  for (const r of z.rects) {
    for (const x of [r.minX, r.maxX]) for (const zz of [r.minZ, r.maxZ]) {
      const key = `${x},${zz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const e = 0.05;
      const quads = [[1, 1], [1, -1], [-1, 1], [-1, -1]].filter(([sx, sz]) => isClear(x + sx * e, zz + sz * e));
      if (quads.length === 1) out.push({ x, z: zz, n: [quads[0][0] * SQ, quads[0][1] * SQ] });
    }
  }
  return out;
}

/**
 * A point on an arch, as stone.js archPoints draws it: rise over half the width is a two-centred pointed
 * arch, rise under it a half ellipse; t 0 at the left springing, 0.5 the crown, 1 the right springing.
 * Returns [across from the middle, up from the springing].
 */
export function archPoint(w, rise, t) {
  const half = w / 2;
  const r0 = Math.max(rise, half);
  const cx = (r0 * r0 - half * half) / (2 * half);
  const r = cx + half;
  const top = Math.atan2(r0, -cx);
  const k = t <= 0.5 ? t * 2 : (1 - t) * 2;
  const a = Math.PI + (top - Math.PI) * k;
  const x = cx + Math.cos(a) * r; const y = Math.sin(a) * r * (rise / r0);
  return [t <= 0.5 ? x : -x, y];
}

/**
 * The web in the top corner of an arch, on one face: three points. at: the arch's middle on the face
 * ({ x, z } and which axis the face runs along), y0 the floor, w, h (to the crown) and rise, side -1 or
 * 1 for the left or right corner, n the face's normal into the zone (the web stands 2 cm off the face).
 */
function archWeb(cx, cz, alongX, y0, w, h, rise, sd, n) {
  const spring = y0 + h - rise;
  const at = (across, y) => (alongX ? [cx + across, y, cz + n[1] * 0.02] : [cx + n[0] * 0.02, y, cz + across]);
  const onArch = (k) => { const [a, up] = archPoint(w, rise, sd < 0 ? k : 1 - k); return at(a, spring + up); };
  return [at(sd * w / 2, spring - 0.32), onArch(0.08), onArch(0.3)];
}

/**
 * Where a door's arch face is, seen from zone id: a passage as wide as its door runs on into the door's
 * depth to the wall of the room beyond (castle.js makePlan), so its arch face is that wall's face; any
 * other zone's arch face is its own wall line. { x, z, alongX, n }.
 */
export function archFace(doorId, id) {
  const d = doorById(doorId); const r = d.rect;
  const alongX = (r.maxX - r.minX) >= (r.maxZ - r.minZ);
  const z = zoneOf(id);
  const lo = alongX ? r.minZ : r.minX; const hi = alongX ? r.maxZ : r.maxX;
  const mid = alongX ? (r.minX + r.maxX) / 2 : (r.minZ + r.maxZ) / 2;
  const w = alongX ? r.maxX - r.minX : r.maxZ - r.minZ;
  const own = z.rects.find((q) => (alongX ? Math.abs(q.maxZ - lo) < 1e-6 || Math.abs(q.minZ - hi) < 1e-6 : Math.abs(q.maxX - lo) < 1e-6 || Math.abs(q.minX - hi) < 1e-6)
    && (alongX ? q.minX <= mid && q.maxX >= mid : q.minZ <= mid && q.maxZ >= mid));
  const atHi = alongX ? Math.abs(own.minZ - hi) < 1e-6 : Math.abs(own.minX - hi) < 1e-6; // the zone lies on the door's high side
  const sameWidth = alongX ? Math.abs(own.maxX - own.minX - w) < 1e-6 : Math.abs(own.maxZ - own.minZ - w) < 1e-6;
  const face = sameWidth ? (atHi ? lo + WALL.t : hi - WALL.t) : (atHi ? hi : lo);
  const n = atHi ? (alongX ? [0, 1] : [1, 0]) : (alongX ? [0, -1] : [-1, 0]);
  return alongX ? { x: mid, z: face, alongX, n, w } : { x: face, z: mid, alongX, n, w };
}

// ---- the plan: group 1 (the forecourt and bridge, the hall, cor1, cor2, cor3) -----------------

const VAMP_SEED = 1897; // the year of the book
const HYBRID = new Set(['cheshire', 'teacup', 'watch', 'spade', 'heart', 'drinkme']);
const CORBEL_Y = 2.58; // a passage's carved things sit under its vault's springing (3.0)

function wallThing(id, zone, kind, variant, at, y, w, h, proud, more = {}) {
  return { id, zone, kind, variant, hybrid: HYBRID.has(variant), x: at.x, y, z: at.z, n: at.n, w, h, proud, out: 0, mount: 'wall', ...more };
}

function cornerThing(id, zone, kind, variant, c, y, w, h, proud) {
  return { id, zone, kind, variant, hybrid: HYBRID.has(variant), x: c.x, y, z: c.z, n: c.n, w, h, proud, out: 0, mount: 'corner' };
}

/** A corner web: two anchors at the top of each wall a little out from the corner, and the low point on the corner. */
function cornerWeb(id, zone, c, top, size) {
  const [nx, nz] = c.n; const sx = Math.sign(nx); const sz = Math.sign(nz);
  const e = 0.015;
  return { id, zone, kind: 'web', variant: 'corner', hybrid: false, mount: 'corner',
    pts: [[c.x + sx * size, top, c.z + sz * e], [c.x + sx * e, top, c.z + sz * size], [c.x + sx * 0.03, top - size * 1.15, c.z + sz * 0.03]] };
}

/** Both top corners of a door's arch, from zone id's side. */
function doorWebs(id, zone, doorId) {
  const a = archFace(doorId, zone);
  const d = doorById(doorId);
  const y0 = Math.max(...d.zones.map((q) => (zoneOf(q) ? zoneOf(q).y : 0)));
  return [-1, 1].map((sd, i) => ({ id: `${id}-${i}`, zone, kind: 'web', variant: 'arch', hybrid: false, mount: 'door', door: doorId,
    pts: archWeb(a.x, a.z, a.alongX, y0, a.w, doorHeight(d), a.w / 2, sd, a.n) }));
}

/** The diaphragm arch where two runs of a passage meet (castle.js shell): its face toward rect ri, and a web in one corner. */
function diaphragmWeb(id, zone, ri, qi, sd) {
  const z = zoneOf(zone); const r = z.rects[ri]; const q = z.rects[qi];
  let alongX; let at; let lo; let hi; let toward;
  if (Math.abs(r.minZ - q.maxZ) < 1e-6 || Math.abs(r.maxZ - q.minZ) < 1e-6) {
    alongX = true; at = Math.abs(r.minZ - q.maxZ) < 1e-6 ? r.minZ : r.maxZ; lo = Math.max(r.minX, q.minX); hi = Math.min(r.maxX, q.maxX);
    toward = at === r.minZ ? 1 : -1; // rect ri lies on the +z side of the line when the line is its minZ
  } else {
    alongX = false; at = Math.abs(r.minX - q.maxX) < 1e-6 ? r.minX : r.maxX; lo = Math.max(r.minZ, q.minZ); hi = Math.min(r.maxZ, q.maxZ);
    toward = at === r.minX ? 1 : -1;
  }
  const face = at + toward * 0.25; // the diaphragm is 0.5 m thick, centred on the line
  const w = hi - lo - 0.02; const h = 3.0 - 0.05; const rise = Math.min(1.0, 3.0 * 0.3);
  const n = alongX ? [0, toward] : [toward, 0];
  const mid = (lo + hi) / 2;
  return { id, zone, kind: 'web', variant: 'arch', hybrid: false, mount: 'diaphragm',
    pts: archWeb(alongX ? mid : face, alongX ? face : mid, alongX, z.y, w, h, rise, sd, n) };
}

/** A shaft of moonlight through a passage's slit, down to the floor 1.6 m into the passage (the moon key's aim). */
function slitMotes(zone, n = 120) {
  const s = SLITS[zone]; const z = zoneOf(zone);
  const p = onWall(z.rects[s.rect], s.side, s.c);
  const mid = z.y + SLIT_SIZE.sill + SLIT_SIZE.h / 2;
  return { id: `${zone}-motes`, zone, kind: 'motes', variant: 'moon', hybrid: false, mount: 'air',
    from: [p.x + p.n[0] * 0.15, mid, p.z + p.n[1] * 0.15], to: [p.x + p.n[0] * 1.5, z.y + 0.25, p.z + p.n[1] * 1.5], spread: [0.28, 0.55], n };
}

/** Carved bats under a passage's springing, one per spot, variant chosen by the seeded hand. */
function passageBats(zone, spots, rand) {
  const z = zoneOf(zone);
  return spots.map(([ri, side, c, variant], i) => {
    const p = onWall(z.rects[ri], side, c);
    const v = variant || 'bat';
    const w = 0.72 + rand() * 0.1;
    return wallThing(`${zone}-bat-${i}`, zone, 'bat', v, p, z.y + CORBEL_Y - 0.04, w, 0.44, 0.09, { tilt: (rand() - 0.5) * 0.24, seed: Math.floor(rand() * 1000) });
  });
}

let PLAN = null;

/**
 * decorPlan(seed = VAMP_SEED) -> the frozen list of every placement in the dressed zones. Pure: the same
 * seed gives the same list (the seeded part is only the carved bats' size, tilt and seed, and the
 * gargoyles' seed), so the house is the same house every visit.
 */
export function decorPlan(seed = VAMP_SEED) {
  if (seed === VAMP_SEED && PLAN) return PLAN;
  const rand = makeRng(seed);
  const out = [];
  const add = (...xs) => out.push(...xs);
  const gseed = () => Math.floor(rand() * 1000);

  // ---- outside: the road gate's piers, the bridge's lifting piers, the front door ----
  // the road gate's piers (castle.js buildOutside): 0.8 m square, capped at 3.16; a gargoyle each in
  // place of the stone finial, looking down the road the warden comes up
  const gateZ = zoneOf('approach').rects[0].maxZ + WALL.t / 2;
  for (const [sd, v] of [[-1, 'spread'], [1, 'crouch']]) {
    add({ id: `gate-${sd < 0 ? 'w' : 'e'}`, zone: 'outside', kind: 'gargoyle', variant: v, hybrid: false, x: sd * 1.9, y: 3.16, z: gateZ, n: [0, 1],
      w: v === 'spread' ? 1.0 : 0.5, h: 0.9, proud: 0.55, out: -0.25, mount: 'top', seed: gseed() });
  }
  // the bridge's lifting piers: a gargoyle on a corbel high on each south face, on the outer half,
  // clear of the chain that leaves the pier's head on its inner half
  for (const pr of PIERS) {
    const sd = Math.sign(pr.x);
    const v = sd < 0 ? 'cheshire' : 'spread';
    add({ id: `pier-${sd < 0 ? 'w' : 'e'}`, zone: 'outside', kind: 'gargoyle', variant: v, hybrid: HYBRID.has(v), x: pr.x + sd * 0.15, y: 4.2, z: pr.maxZ, n: [0, 1],
      w: 1.6, h: 1.4, proud: 1.0, out: 0, mount: 'pier', wings: 'spread', rim: true, seed: gseed() }); // wings spread, a moonlit rim behind
  }
  // the forecourt's side walls: a winged gargoyle on the first merlon of each, over the bridge
  // (stone.js battlements: 13.5 m of wall in eight merlons, the first centred 0.84 m in, capped at 6.02)
  const fc = zoneOf('forecourt').rects[0];
  for (const sd of [-1, 1]) {
    add({ id: `court-${sd < 0 ? 'w' : 'e'}`, zone: 'outside', kind: 'gargoyle', variant: 'spread', hybrid: false, x: sd * (fc.maxX + WALL.t / 2), y: 6.02, z: fc.maxZ - 0.84, n: [0, 1],
      w: 1.2, h: 1.1, proud: 0.6, out: -0.3, mount: 'top', seed: gseed() });
  }
  // the front wall (its face at z 0.5): the Count's arms over the door, between the carved grin and
  // the great window (raised for it, castle.js), and a carved bat either side
  const front = { x: 0, z: 0.5, n: [0, 1] };
  // in a gilded frame gone dull and cracked (rich, gone to seed), clear of the grin under it; the window over it stands from 9.1 m
  add(wallThing('front-crest', 'outside', 'crest', 'dracul', front, 6.62, 1.85, 2.2, 0.12, { finish: 'plaque', mount: 'lintel', door: 'front', frame: 'gilt' }));
  for (const sd of [-1, 1]) add(wallThing(`front-bat-${sd < 0 ? 'w' : 'e'}`, 'outside', 'bat', 'bat', { ...front, x: sd * 2.5 }, 7.2, 0.95, 0.52, 0.1, { tilt: sd * 0.12, seed: gseed() }));

  // ---- the hall: plain-grand ----
  const hall = zoneOf('hall'); const H = hall.rects[0];
  add({ id: 'hall-chandelier', zone: 'hall', kind: 'chandelier', variant: 'iron', hybrid: false, x: 0, y: 4.25, z: (H.minZ + H.maxZ) / 2, n: [0, 0],
    w: 1.9, h: 8 - 4.25, proud: 0, out: 0, mount: 'hang', arms: 8 });
  add(wallThing('hall-crest-door', 'hall', 'crest', 'dracul', onWall(H, 'n', 0), 4.3, 1.3, 1.55, 0.1, { finish: 'relief', mount: 'lintel', door: 'inner' }));
  // over the hearth: the arms painted on a plaque in the overmantel's pointed panel (castle.js hearth, 2 m by 2 m)
  const hh = HEARTHS.hall;
  add(wallThing('hall-crest-hearth', 'hall', 'crest', 'dracul', onWall(H, 'w', (hh.minZ + hh.maxZ) / 2), 2.42, 0.62, 0.78, 0.04, { finish: 'plaque', out: 0.35, mount: 'overmantel' }));
  // a gargoyle on a corbel at each end wall's corners, under the vault, clear of the corner shafts
  // the teacup one flanks the arms over the inner door, so it is seen on the way in
  for (const [side, sd, v] of [['n', -1, 'teacup'], ['n', 1, 'crouch'], ['s', -1, 'spread'], ['s', 1, 'crouch']]) {
    const sx = side === 's' ? 2.7 : 2.55;
    add(wallThing(`hall-garg-${side}${sd < 0 ? 'w' : 'e'}`, 'hall', 'gargoyle', v, onWall(H, side, sd * sx), 4.3, v === 'spread' ? 1.1 : 0.62, 1.0, 0.72, { seed: gseed(), edge: 'gilt' }));
  }
  for (const [side, c] of [['e', -7.17], ['w', -4.5], ['e', -4.5], ['w', -1.83]]) {
    add(wallThing(`hall-bat-${side}${c}`, 'hall', 'bat', 'bat', onWall(H, side, c), 4.0, 0.8, 0.45, 0.09, { tilt: (rand() - 0.5) * 0.2, seed: gseed() }));
  }
  for (const c of concaveCorners('hall')) add(cornerWeb(`hall-web-${c.x},${c.z}`, 'hall', c, 4.95, 0.8));
  add({ id: 'hall-motes-chandelier', zone: 'hall', kind: 'motes', variant: 'fire', hybrid: false, mount: 'air', from: [0, 3.9, -4.5], to: [0, 1.5, -4.5], spread: [1.0, 0.4], n: 165 });
  add({ id: 'hall-motes-hearth', zone: 'hall', kind: 'motes', variant: 'fire', hybrid: false, mount: 'air', from: [-2.9, 2.3, -6.3], to: [-1.8, 0.5, -6.3], spread: [0.8, 0.4], n: 90 });

  // ---- cor1, the wives' corridor: the painting and the moon slit stay as they are ----
  const c1 = zoneOf('cor1');
  // carved bats a little way from the torches, in their light
  add(...passageBats('cor1', [[0, 'w', -13.0], [1, 'n', 2.4], [1, 's', 4.3], [1, 's', 17.7], [2, 'w', -21.0]], rand));
  // the pocket-watch bat on the first sight line in from the hall, 1 m past the first torch, at 2 m
  add(wallThing('cor1-watchbat', 'cor1', 'bat', 'watch', onWall(c1.rects[0], 'e', -12.7), c1.y + 2.0, 0.8, 0.5, 0.11, { tilt: 0.1, seed: gseed() }));
  const k1 = concaveCorners('cor1');
  // the Cheshire grin at the far end of the east run, square to the eye looking down it past the painting
  k1.forEach((c, i) => add(cornerThing(`cor1-garg-${i}`, 'cor1', 'gargoyle', i === 0 ? 'crouch' : 'cheshire', c, c1.y + 2.3, 0.5, i === 0 ? 0.45 : 0.55, 0.46)));
  add(wallThing('cor1-candelabra', 'cor1', 'candelabra', 'iron', onWall(c1.rects[0], 'e', -11.15), 1.85, 0.7, 0.62, 0.3, { arms: 5 }));
  for (const c of k1) add(cornerWeb(`cor1-web-${c.x},${c.z}`, 'cor1', c, 2.97, 0.62));
  add(...doorWebs('cor1-web-teaIn', 'cor1', 'teaIn'));
  add(diaphragmWeb('cor1-web-dia0', 'cor1', 0, 1, -1), diaphragmWeb('cor1-web-dia1', 'cor1', 2, 1, 1));
  add(slitMotes('cor1'));

  // ---- cor2: darker; a coffin stood in a niche ----
  const c2 = zoneOf('cor2');
  // the coffin stands opposite the slit, where the moon falls
  add(wallThing('cor2-coffin', 'cor2', 'coffin', 'iron', onWall(c2.rects[1], 'n', SLITS.cor2.c), c2.y, 1.0, 2.3, 0.15, { moonlit: true }));
  add(...passageBats('cor2', [[1, 's', -4.6], [1, 's', 7.9], [0, 'e', -42.75]], rand));
  // richer than cor1: the crest in a gilded frame, a second candelabra
  add(wallThing('cor2-crest', 'cor2', 'crest', 'heart', onWall(c2.rects[1], 's', 5.3), 2.1, 0.7, 0.84, 0.1, { finish: 'relief', frame: 'gilt' }));
  add(wallThing('cor2-candelabra-2', 'cor2', 'candelabra', 'iron', onWall(c2.rects[1], 'n', 9.6), 1.85, 0.7, 0.62, 0.3, { arms: 5 }));
  const k2 = concaveCorners('cor2');
  k2.forEach((c, i) => add(cornerThing(`cor2-garg-${i}`, 'cor2', 'gargoyle', i === 0 ? 'teacup' : 'crouch', c, c2.y + 2.3, 0.5, i === 0 ? 0.55 : 0.45, 0.46)));
  add(wallThing('cor2-candelabra', 'cor2', 'candelabra', 'iron', onWall(c2.rects[2], 'w', -47.6), 1.85, 0.7, 0.62, 0.3, { arms: 5 }));
  for (const c of k2) add(cornerWeb(`cor2-web-${c.x},${c.z}`, 'cor2', c, 2.97, 0.72));
  add(...doorWebs('cor2-web-galleryIn', 'cor2', 'galleryIn'));
  add(diaphragmWeb('cor2-web-dia0', 'cor2', 0, 1, 1), diaphragmWeb('cor2-web-dia1', 'cor2', 2, 1, -1));
  add(slitMotes('cor2'));

  // ---- cor3: the way to the Knight's Walk; the coffin with the spade, the moon on it ----
  const c3 = zoneOf('cor3');
  add(wallThing('cor3-coffin', 'cor3', 'coffin', 'spade', onWall(c3.rects[1], 'n', SLITS.cor3.c), c3.y, 1.0, 2.3, 0.15, { moonlit: true }));
  add(...passageBats('cor3', [[1, 's', -1.3], [0, 'e', -86.75], [1, 's', 9.3]], rand));
  const go = archFace('galleryOut', 'cor3');
  add(wallThing('cor3-drinkme', 'cor3', 'bottle', 'drinkme', { x: go.x, z: go.z, n: go.n }, c3.y + 3.2, 0.3, 0.5, 0.08, { mount: 'lintel', door: 'galleryOut' }));
  const k3 = concaveCorners('cor3');
  k3.forEach((c, i) => add(cornerThing(`cor3-garg-${i}`, 'cor3', 'gargoyle', 'crouch', c, c3.y + 2.35, 0.5, 0.45, 0.46)));
  add(wallThing('cor3-candelabra', 'cor3', 'candelabra', 'iron', onWall(c3.rects[1], 'e', -90.9), 1.85, 0.6, 0.62, 0.3, { arms: 5 }));
  // richest of the three: the Count's own arms, carved and gilded, and a second candelabra
  add(wallThing('cor3-crest', 'cor3', 'crest', 'dracul', onWall(c3.rects[0], 'e', -88.4), 1.95, 0.8, 0.96, 0.1, { finish: 'relief', frame: 'gilt' }));
  add(wallThing('cor3-candelabra-2', 'cor3', 'candelabra', 'iron', onWall(c3.rects[1], 'n', 0.8), 1.85, 0.7, 0.62, 0.3, { arms: 5 }));
  for (const c of k3) add(cornerWeb(`cor3-web-${c.x},${c.z}`, 'cor3', c, 2.97, 0.78));
  add(...doorWebs('cor3-web-walkIn', 'cor3', 'walkIn')); // (galleryOut has leaves: a web there would meet them as they swing)
  add(diaphragmWeb('cor3-web-dia0', 'cor3', 0, 1, -1));
  add(slitMotes('cor3'));

  // the gargoyles' seeds for the corner ones too (a different face each)
  for (const p of out) if (p.kind === 'gargoyle' && p.seed == null) p.seed = gseed();
  const plan = f(out);
  if (seed === VAMP_SEED) PLAN = plan;
  return plan;
}

/** The placements in one zone. */
export function decorFor(zone, plan = decorPlan()) {
  return plan.filter((p) => p.zone === zone);
}

/**
 * The box a placement takes: { minX, maxX, minY, maxY, minZ, maxZ }. A wall thing runs w along its
 * wall and stands from out to out + proud off it; a corner thing proud out along both walls; a hung
 * thing w across; a web its three points; a shaft of dust its run and spread.
 */
export function boxOf(p) {
  if (p.kind === 'web') {
    const xs = p.pts.map((q) => q[0]); const ys = p.pts.map((q) => q[1]); const zs = p.pts.map((q) => q[2]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }
  if (p.kind === 'motes') {
    const s = Math.max(...p.spread) + 0.2;
    return { minX: Math.min(p.from[0], p.to[0]) - s, maxX: Math.max(p.from[0], p.to[0]) + s, minY: Math.min(p.from[1], p.to[1]) - s, maxY: Math.max(p.from[1], p.to[1]) + s,
      minZ: Math.min(p.from[2], p.to[2]) - s, maxZ: Math.max(p.from[2], p.to[2]) + s };
  }
  if (p.mount === 'hang') return { minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minY: p.y, maxY: p.y + p.h, minZ: p.z - p.w / 2, maxZ: p.z + p.w / 2 };
  if (p.mount === 'corner') {
    const sx = Math.sign(p.n[0]); const sz = Math.sign(p.n[1]);
    const a = p.proud;
    return { minX: Math.min(p.x, p.x + sx * a), maxX: Math.max(p.x, p.x + sx * a), minY: p.y, maxY: p.y + p.h, minZ: Math.min(p.z, p.z + sz * a), maxZ: Math.max(p.z, p.z + sz * a) };
  }
  const [nx, nz] = p.n; const a0 = p.out || 0; const a1 = a0 + p.proud;
  const ax = nz !== 0; // the wall runs along x
  const minN = Math.min(a0, a1); const maxN = Math.max(a0, a1);
  if (ax) return { minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minY: p.y, maxY: p.y + p.h, minZ: Math.min(p.z + nz * minN, p.z + nz * maxN), maxZ: Math.max(p.z + nz * minN, p.z + nz * maxN) };
  return { minX: Math.min(p.x + nx * minN, p.x + nx * maxN), maxX: Math.max(p.x + nx * minN, p.x + nx * maxN), minY: p.y, maxY: p.y + p.h, minZ: p.z - p.w / 2, maxZ: p.z + p.w / 2 };
}

// ---- what decor must keep clear of --------------------------------------------------------------

/**
 * The least gap, metres, between any piece of decor and each kind of thing it keeps clear of (the
 * owner: every clue, puzzle object and door as readable as before): a door's opening and surround 0.4,
 * a torch, a picture or banner, a moon slit, a carved grin and a clue 0.3.
 */
export const MIN_GAP = f({ door: 0.4, torch: 0.3, art: 0.3, slit: 0.3, grin: 0.3, clue: 0.3 });

/**
 * keepClear(zone) -> [{ id, kind, minX, maxX, minY, maxY, minZ, maxZ }]: the boxes nothing of the pass
 * may enter in a zone: every doorway (with its surround, to its arch's crown and moulding), the clues
 * and the things that are read (the braid, the scratched words, the curtain and the tonic behind it),
 * the wall art (the wives' painting, the banners), the carved grins over the arches, the moon slits and
 * the torches. Each is inflated by its MIN_GAP, so a box overlap is a gap under the minimum.
 */
export function keepClear(zone) {
  const z = zoneOf(zone);
  const out = [];
  const box = (id, kind, minX, maxX, minY, maxY, minZ, maxZ) => { const pad = MIN_GAP[kind]; out.push({ id, kind, minX: minX - pad, maxX: maxX + pad, minY, maxY: maxY + pad, minZ: minZ - pad, maxZ: maxZ + pad }); };
  const y0 = z ? z.y : 0;
  for (const d of DOORS) {
    if (zone !== 'outside' && !d.zones.includes(zone)) continue;
    if (zone === 'outside' && d.id !== 'front') continue;
    const r = d.rect; const alongX = (r.maxX - r.minX) >= (r.maxZ - r.minZ); const s = 0.25;
    const top = doorHeight(d) + 0.3; // the arch's crown and its moulding
    if (alongX) box(`door ${d.id}`, 'door', r.minX - s, r.maxX + s, y0, y0 + top, r.minZ - 0.3, r.maxZ + 0.3);
    else box(`door ${d.id}`, 'door', r.minX - 0.3, r.maxX + 0.3, y0, y0 + top, r.minZ - s, r.maxZ + s);
  }
  if (zone === 'hall') {
    const H = z.rects[0];
    box('braid', 'clue', H.minX, H.minX + 0.3, 1.1, 2.05, HALL.braid.z - 0.2, HALL.braid.z + 0.2);
    box('scratch', 'clue', H.minX, H.minX + 0.05, 1.31, 1.79, HALL.scratch.z - 0.96, HALL.scratch.z);
    box('curtain', 'clue', H.maxX - 0.7, H.maxX, 0, 2.62, HALL.curtain.z - 1.0, HALL.curtain.z + 1.0);
    for (const sx of [-2.6, 2.6]) box(`torch ${sx}`, 'torch', sx - 0.25, sx + 0.25, 1.9, 3.1, H.minZ, H.minZ + 0.6);
  }
  if (zone === 'outside') {
    for (const sx of [-2.7, 2.7]) box(`torch ${sx}`, 'torch', sx - 0.25, sx + 0.25, 2.3, 3.5, 0.5, 1.1);
    box('front grin', 'grin', -1.4, 1.4, 5.55, 6.3, 0.5, 0.75);
  }
  for (const a of wallArt()) {
    if (zoneAtWall(a.x, a.z) !== zone) continue;
    const wall = nearestWall(zone, a.x, a.z);
    const isBanner = a.id.startsWith('banner');
    const ys = isBanner ? [y0 + 0.4, y0 + 3.0] : [y0 + 0.95, y0 + 2.65];
    if (wall.alongX) box(a.id, 'art', a.x - a.w / 2, a.x + a.w / 2, ys[0], ys[1], wall.at - 0.2, wall.at + 0.2);
    else box(a.id, 'art', wall.at - 0.2, wall.at + 0.2, ys[0], ys[1], a.z - a.w / 2, a.z + a.w / 2);
  }
  for (const g of CORRIDOR.grins) {
    if (zoneAtWall(g.x, g.z) !== zone) continue;
    box(`grin ${g.x}`, 'grin', g.x - 0.6, g.x + 0.6, y0 + 3.05, y0 + 3.65, g.z - 0.4, g.z + 0.4);
  }
  if (SLITS[zone]) {
    const s = SLITS[zone]; const p = onWall(z.rects[s.rect], s.side, s.c);
    const ys = [y0 + SLIT_SIZE.sill, y0 + SLIT_SIZE.sill + SLIT_SIZE.h + 0.1];
    if (p.n[1] !== 0) box('moon slit', 'slit', s.c - 0.4, s.c + 0.4, ys[0], ys[1], p.z - 0.3, p.z + 0.3);
    else box('moon slit', 'slit', p.x - 0.3, p.x + 0.3, ys[0], ys[1], s.c - 0.4, s.c + 0.4);
  }
  if (z && z.id.startsWith('cor')) {
    for (const t of passageTorches(zone)) {
      if (t.n[1] !== 0) box(`torch ${t.x},${t.z}`, 'torch', t.x - 0.3, t.x + 0.3, y0 + 1.7, y0 + 3.0, t.z - 0.6, t.z + 0.6);
      else box(`torch ${t.x},${t.z}`, 'torch', t.x - 0.6, t.x + 0.6, y0 + 1.7, y0 + 3.0, t.z - 0.3, t.z + 0.3);
    }
  }
  return out;
}

/** The zone whose wall a hung thing at (x, z) is on (within 0.7 m of one of its rects), or null. */
function zoneAtWall(x, z) {
  let best = null;
  for (const zn of ZONES) for (const r of zn.rects) {
    if (x < r.minX - 0.7 || x > r.maxX + 0.7 || z < r.minZ - 0.7 || z > r.maxZ + 0.7) continue;
    const d = Math.min(Math.abs(x - r.minX), Math.abs(x - r.maxX), Math.abs(z - r.minZ), Math.abs(z - r.maxZ));
    if (!best || d < best.d) best = { d, id: zn.id };
  }
  return best ? best.id : null;
}

function nearestWall(zone, x, z) {
  let best = null;
  for (const r of zoneOf(zone).rects) {
    for (const [alongX, at] of [[true, r.minZ], [true, r.maxZ], [false, r.minX], [false, r.maxX]]) {
      const d = Math.abs((alongX ? z : x) - at);
      if (!best || d < best.d) best = { d, alongX, at };
    }
  }
  return best;
}

/** True when two boxes overlap (by more than a millimetre). */
export function overlaps(a, b) {
  const e = 1e-3;
  return a.minX < b.maxX - e && a.maxX > b.minX + e && a.minY < b.maxY - e && a.maxY > b.minY + e && a.minZ < b.maxZ - e && a.maxZ > b.minZ + e;
}

/** How far into a zone's floor a placement reaches at head height and under: the deepest any wall thing below the head line stands off its wall. */
export const HEAD_LINE = 2.55;
export const RELIEF_MAX = 0.32; // a torch's bracket stands 0.28 off the wall: nothing under the head line stands further
