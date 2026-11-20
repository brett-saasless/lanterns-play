// The Dracula pass (the owner, 2026-11-19: "the castle looks generic. give it a vampiric tone. a
// house fit for dracula"; "most should be pure vampiric", about one Alice hybrid in five): the pure
// half of it. How rich each room is (decayed grandeur that deepens toward the Count), the light's
// faint crimson grade at that richness, the palette, the dust motes' points and drift, and where
// every piece of decor stands, as one list (decorPlan) that castle.js builds from and the tests
// check against the doors, the clues, the wall art and the routes. No three, no DOM, no Math.random:
// the seeded placements come from rng.js.
//
// Decor kinds: gargoyle (crouch, spread, cheshire*, teacup*), bat (bat, watch*), crest (dracul,
// spade*, heart*, hatter*; finish plaque or relief), coffin (iron, spade*), chandelier (iron, teacup*),
// candelabra (iron, teacup*), bottle* (the cracked DRINK ME carved on a lintel), web (corner or
// arch: three points), motes (a shaft of dust). * is an Alice hybrid.
//
// A placement: { id, zone, kind, variant, hybrid, x, y, z, n: [nx, nz], w, h, proud, out, mount }.
// Wall things: (x, z) on the wall's inner face, y the bottom (absolute), n the wall's inward normal,
// w along the wall, h tall, proud how far it stands off its mounting face, out how far that face
// stands off the wall (a mantel's overmantel, a pier's face). Corner things: (x, z) the corner, n the
// diagonal into the room. Hung things (mount 'hang'): (x, z) the centre, y the lowest point, h up to
// the ceiling, w across.

import {
  ZONES, DOORS, HALL, CORRIDOR, HEARTHS, PIERS, WALL, wallArt, TEA, CLOCKS, WINDOWS, GALLERY_PROPS, GALLERY, CRYPT, CRYPT_PROPS, WALL_ART, stairHeight,
} from './keepmap.js';
import { doorHeight } from './doorleaves.js';
import { makeRng } from './rng.js';
import { BOARD, PIECE_FOOT, PADS, STAIRS, UPPER, WRECK, wreckFoot, wreckBoxes, stairFloor } from './keepmap.js'; // group 3: the Knight's Walk, the stairs, the landing

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

/**
 * The zones the pass has dressed so far (group 1, then group 2: the tea room, the gallery and the crypt
 * under it); later groups add theirs. Only these take the grade.
 */
export const DRESSED = f(['outside', 'hall', 'cor1', 'cor2', 'cor3', 'tea', 'gallery', 'crypt',
  'walk', 'stairs', 'landing', // group 3
  // (until group 4 dresses the mirror room, the landing's graded stone meets the mirror room's ungraded stone at
  // the mirrorIn arch: a one-step seam, acceptable only because the mirror room is dressed next)
]);

/**
 * The phone's share (a coarse pointer: castle.js reads it once at build): the dust is thinned to this
 * share of its points, and a candelabra's floor pool is left out (its wall pool stays), so the
 * additive fill a phone pays for the pass stays small. Nothing else changes.
 */
export const TOUCH = f({ motes: 0.5, floorGlow: false });

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
 * A room's warm bias (round 2, the art critic: the gallery read darker, not redder, than the tea room):
 * how far its stone and its night air lean warm on top of the grade. Faint; the moon is never touched.
 */
export const WARM_BIAS = f({ gallery: 0.08, crypt: 0.08,
  walk: 0.03, stairs: 0.06, landing: 0.06, // group 3: half in the moon's walk, ramping to the stair's along the walk's last third (WARM_RAMP), so it eases into the stair
});

/**
 * Group 3, round 2 (the art critic, H9: the cold walk cut to a warm stair at the door): the walk's stone takes
 * its bias from z0 (0 extra) to z1 (the stair's bias), drawn per vertex by castle.js, so the warmth eases toward
 * the door on. The night air's bias eases in time as ever (castle.js GRADE_MIX).
 */
export const WARM_RAMP = f({ walk: { z0: -109, z1: -117, to: 0.06 } });

/**
 * Group 3, round 2 (H9: the stair's red read mauve-pink): the stair's and the landing's flames lean to a deeper
 * crimson and their night air to an oxblood sky, at the same strengths as everywhere (only the hue steps).
 */
export const GRADE_HUE = f({ stairs: { fire: 0xd8282e, sky: 0x4a1a24 }, landing: { fire: 0xd8282e, sky: 0x4a1a24 } });

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
    bias: DRESSED.includes(id) && WARM_BIAS[id] ? WARM_BIAS[id] : 0,
    fireHex: (DRESSED.includes(id) && GRADE_HUE[id] && GRADE_HUE[id].fire) || GRADE.fire.hex, // group 3: the hue the flames lean to
    skyHex: (DRESSED.includes(id) && GRADE_HUE[id] && GRADE_HUE[id].sky) || GRADE.sky.hex, // and the night air
    glow: g0.map((c, i) => c + (GRADE.glow[i] - c) * r),
  };
}

/**
 * The grade's tint on a zone's stone, [r, g, b] multipliers: a shade darker by its richness, and redder
 * by its warm and its bias. castle.js gradeStone draws a room's walls with it, and the carved stone it
 * draws in the room's fittings (FIT_STONE) with the same tint, so a carving and its wall share one grade.
 * All ones for a zone not yet dressed.
 */
export function gradeTint(g) {
  if (typeof g === 'string') g = gradeOf(g);
  if (!g.r) return [1, 1, 1];
  const w = g.warm + (g.bias || 0);
  return [g.stoneK * (1 + w), g.stoneK, g.stoneK * (1 - w)];
}

/**
 * The visibility pass (the art critic, round 3): the gargoyles and carved bats are drawn in their room's
 * fittings mesh (the candles' vertex-colour material) rather than its walls' stone, whose dark albedo
 * kept them black beside a lit wall. In that mesh they would read pale, so their stone is drawn at
 * this share of its own value: a gargoyle 0.6, a bat 0.4 (the critic's 0.7 and 0.5, a shade down once
 * the room's hue is on them; at 0.7 a bat read as a white pigeon).
 * No light is added, nothing is lifted.
 */
export const FIT_STONE = f({ gargoyle: 0.6, bat: 0.4 });

/**
 * The rooms whose gargoyles and bats are drawn in the fittings, each with a scale on FIT_STONE: group 1's
 * hall and passages are lit brighter and closer, so their carvings take about half the share (at the full
 * share they read as white plaster). Outside is left in its stone: under the moon its gargoyles already
 * read as dark silhouettes against the sky and the wall, as they should.
 */
export const FIT_STONE_ROOMS = f({ hall: 0.5, cor1: 0.55, cor2: 0.55, cor3: 0.55, tea: 1, gallery: 1, crypt: 1,
  walk: 0.85, stairs: 0.36, landing: 0.36, // group 3: the walk's moon pool is brighter than the gallery's; the stair and landing torchlit close (round 2: 0.8 of 0.45, cooled: FIT_COOL)
});

/**
 * How far a routed carving leans toward its room's own light: the candle's colour at the room's richness
 * (warm in the tea room and the crypt), the moon's in the gallery, so it sits in its room and is never a
 * cold grey against a warm wall (the critic's one flaw in the prototype).
 */
export const FIT_HUE = 0.45; // (at 0.3 a crypt gargoyle's moonward side still read blue)

/**
 * Group 3, round 2 (the art critics, H7/H8: the stair's and landing's carving read flesh-pink, its blue a little over
 * half its red against walls at about 0.85): there the lean to the torchlight is small and the stone is cooled a
 * shade toward grey-violet, so a gargoyle reads as the wall's own stone, darker.
 */
export const FIT_HUE_ROOMS = f({ stairs: 0.1, landing: 0.1 });
export const FIT_COOL = f({ stairs: [0.96, 0.95, 1.06], landing: [0.96, 0.95, 1.06] });
/** How far a room's carving leans to its light (FIT_HUE, or its own). */
export function fitHueOf(id) { return Object.prototype.hasOwnProperty.call(FIT_HUE_ROOMS, id) ? FIT_HUE_ROOMS[id] : FIT_HUE; }

/** Group 3, round 2: the moon's still washes in the walk, a paler moon blue (the coffins', the arms'), and the way the walk's cold iron catches the moon (toward the great window and up). */
export const MOON_WASH = f([0.6, 0.67, 0.8]);
export const MOON_EDGE = f([0.6, 0.8, 0]);

/** The rooms lit by the moon alone (their carving leans to its light): the gallery, and the Knight's Walk (group 3). */
export const MOON_ROOMS = f(['gallery', 'walk']);

/** A room's own light, [r, g, b] with its brightest channel 1: the moon's in the gallery and the walk, else its candles'. */
export function roomHue(id) {
  const c = MOON_ROOMS.includes(id) ? GRADE.moon : gradeOf(id).glow;
  const m = Math.max(...c);
  return c.map((v) => v / m);
}

/**
 * fitStoneTint(zoneId, kind) -> [r, g, b]: what a carving's vertex colour is multiplied by when it is
 * drawn in the fittings: its share (FIT_STONE, scaled for the room) times its room's grade tint
 * (gradeTint, as on its walls) times FIT_HUE of the room's own light. null when the piece stays in the
 * room's stone.
 */
export function fitStoneTint(id, kind) {
  if (!FIT_STONE[kind] || !Object.prototype.hasOwnProperty.call(FIT_STONE_ROOMS, id)) return null;
  const k = FIT_STONE[kind] * FIT_STONE_ROOMS[id]; const g = gradeTint(id); const h = roomHue(id);
  const lean = fitHueOf(id); const cool = FIT_COOL[id] || [1, 1, 1];
  return g.map((c, i) => c * k * (1 - lean + lean * h[i]) * cool[i]);
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

/**
 * The crypt as the pass sees it: the gallery's lower floor (keepmap CRYPT), its own zone for the plan,
 * floor 4 m down, walls up to the stone ceiling 0.3 m under the gallery's floor (castle.js buildGallery).
 */
export const CRYPT_ZONE = f({ id: 'crypt', y: CRYPT.floor, rects: [CRYPT.rect], h: -CRYPT.floor - 0.3 });

/** A zone of the plan by id (the keep's zones, and the crypt). */
export function vampZone(id) {
  return id === 'crypt' ? CRYPT_ZONE : ZONES.find((z) => z.id === id);
}
const zoneOf = vampZone;
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

/** The rooms' windows as castle.js makePlan cuts them (WIN(0, side, z, w, h, sill), kept equal by a test), at keepmap WINDOWS. */
export const ROOM_WINDOWS = f({ tea: { side: 'e', w: 1.5, h: 3.8, sill: 1.3 }, gallery: { side: 'e', w: 1.7, h: 4.6, sill: 0.9 },
  walk: { side: 'e', w: 10, h: 9.6, sill: 1.4 }, // group 3: the Knight's Walk's great east window
});

/**
 * The flames castle.js hangs on a group-2 room's walls (buildTea, teaGougeLight, buildGallery,
 * cryptLights; kept equal by a test), so decor keeps off them: [{ x, z, n, y }], y the bracket's height.
 */
export function roomLights(id) {
  if (!['tea', 'gallery', 'crypt'].includes(id)) return [];
  const z = zoneOf(id); const r = z.rects[0];
  if (id === 'tea') return [{ ...onWall(r, 's', r.minX + 3.6), y: 2.3 }, { ...onWall(r, 'e', TEA.werewolf.gouge.z - 2.3), y: 2.2 }];
  if (id === 'gallery') return GALLERY_PROPS.torches.map((t) => ({ ...onWall(r, 'e', t.z), y: z.y + 2.3 }));
  if (id === 'crypt') {
    const fl = GALLERY.field; const st = CRYPT.stair.rect;
    const sx = st.minX + (st.maxX - st.minX) * 0.2;
    return [
      ...[fl.minZ + 6, fl.maxZ - 7].map((c) => ({ ...onWall(r, 'w', c), y: z.y + 2.1 })),
      { ...onWall(r, 'e', CRYPT_PROPS.coffin.z), y: z.y + 1.9 },
      { ...onWall(r, 's', sx), y: stairHeight(CRYPT.stair, sx, (st.minZ + st.maxZ) / 2) + 2.3 },
    ];
  }
  return [];
}

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
const HYBRID = new Set(['cheshire', 'teacup', 'watch', 'spade', 'heart', 'drinkme', 'hatter']);
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

  // ---- group 2: the tea room, the gallery, the crypt (its own seeded hand, so group 1 is the same house) ----
  out.push(...groupTwo(makeRng((seed * 7 + 2) >>> 0)));
  // ---- group 3: the Knight's Walk, the stairs, the landing (its own seeded hand) ----
  out.push(...groupThree(makeRng((seed * 13 + 3) >>> 0)));

  const plan = f(out);
  if (seed === VAMP_SEED) PLAN = plan;
  return plan;
}

/**
 * Group 2, rising 0.4, 0.5, 0.6. The tea room is where the Alice hybrids live (the Hatter's hat in the
 * arms over the hearth, a teacup chandelier over the table, a gargoyle holding a teacup, the Cheshire grin in a
 * corner, DRINK ME over the way out); no pocket-watch bat there, where five clocks are the puzzle and a
 * sixth would mislead. The gallery keeps the glass, the windows, the sitters and the pedestal clear:
 * its decor is high on the end walls and the window piers, and two chandeliers hang in the vault far
 * above the floor; no Cheshire grin there, where a grin is the path's hint. The crypt is pure vampiric:
 * coffins stood in niches, the Count's painted arms, candelabras, gargoyles, bats, webs and dust.
 */
function groupTwo(rand) {
  const out = [];
  const add = (...xs) => out.push(...xs);
  const gseed = () => Math.floor(rand() * 1000);
  const bat = (id, zone, at, y, w = 0.78) => wallThing(id, zone, 'bat', 'bat', at, y, w, 0.44, 0.09, { tilt: (rand() - 0.5) * 0.22, seed: gseed() });

  // ---- the tea room (0.4): the table, the five clocks, the werewolf, the exit candle all as they were ----
  const tz = zoneOf('tea'); const T = tz.rects[0];
  // a teacup chandelier over the middle of the table, its lowest cup 3.7 m up, its chain to the beams
  add({ id: 'tea-chandelier', zone: 'tea', kind: 'chandelier', variant: 'teacup', hybrid: true, x: (TEA.table.minX + TEA.table.maxX) / 2, y: 3.7,
    z: (TEA.table.minZ + TEA.table.maxZ) / 2, n: [0, 0], w: 1.8, h: 6 - 3.7, proud: 0, out: 0, mount: 'hang', arms: 6, cups: 1.5 });
  // the Hatter's arms (the hat with its 10/6 in the coil) painted over the hearth, above the mantel clock and the raven's perch on it
  const fb = TEA.fireplace;
  add(wallThing('tea-crest-hearth', 'tea', 'crest', 'hatter', onWall(T, 'w', (fb.minZ + fb.maxZ) / 2), 3.5, 1.0, 1.2, 0.08, { finish: 'plaque', frame: 'gilt' }));
  // the Count's arms carved over the way in, seen as the warden turns from the table
  const ti = archFace('teaIn', 'tea');
  add(wallThing('tea-crest-door', 'tea', 'crest', 'dracul', { x: ti.x, z: ti.z, n: ti.n }, 3.55, 1.05, 1.25, 0.1, { finish: 'relief', mount: 'lintel', door: 'teaIn' }));
  // DRINK ME cut over the way out (its leaves swing under it)
  const to = archFace('teaOut', 'tea');
  // (round 2, G9: larger, gilt, its label lettered, a little of the exit candle's glow on it)
  add(wallThing('tea-drinkme', 'tea', 'bottle', 'drinkme', { x: to.x, z: to.z, n: to.n }, 3.3, 0.42, 0.7, 0.1, { mount: 'lintel', door: 'teaOut', gilt: true, label: true, candleGlow: true }));
  // a gargoyle in each corner under the beams; the Cheshire one in the far corner seen from the door
  const tk = concaveCorners('tea');
  for (const c of tk) {
    const ne = c.x > T.minX + 1 && c.z < T.minZ + 1; const se = c.x > T.minX + 1 && c.z > T.maxZ - 1;
    const v = ne ? 'cheshire' : se ? 'teacup' : 'crouch';
    // at 3.6 on a gilt-lipped corbel, low enough for the room's candlelight to find (at 4.4 they were black shapes)
    add({ ...cornerThing(`tea-garg-${c.x},${c.z}`, 'tea', 'gargoyle', v, c, tz.y + 3.6, 0.55, v === 'crouch' ? 0.85 : 0.95, 0.5), seed: gseed(), edge: 'gilt', glow: v === 'cheshire' });
  }
  // carved bats high on the walls, clear of the windows, the sconce and the clocks
  add(bat('tea-bat-n0', 'tea', onWall(T, 'n', 20.5), 4.3), bat('tea-bat-n1', 'tea', onWall(T, 'n', 26.2), 4.4));
  // a coffin stood in a niche on the far wall, an iron candelabra of five on the door wall
  add(wallThing('tea-coffin', 'tea', 'coffin', 'iron', onWall(T, 'n', 29.4), tz.y, 1.0, 2.3, 0.15, { lid: 'pale' }));
  add(wallThing('tea-candelabra', 'tea', 'candelabra', 'iron', onWall(T, 's', 27.6), 1.85, 0.85, 0.62, 0.3, { arms: 5 }));
  for (const c of tk) add(cornerWeb(`tea-web-${c.x},${c.z}`, 'tea', c, 5.92, 0.95));
  add(...doorWebs('tea-web-teaIn', 'tea', 'teaIn'));
  // dust in the hearth's light and in the chandelier's, over the table (above its candles)
  add({ id: 'tea-motes-hearth', zone: 'tea', kind: 'motes', variant: 'fire', hybrid: false, mount: 'air', from: [14.6, 1.6, -32], to: [16.0, 0.45, -32], spread: [0.8, 0.3], n: 90 });
  add({ id: 'tea-motes-chandelier', zone: 'tea', kind: 'motes', variant: 'fire', hybrid: false, mount: 'air', from: [22, 3.5, -32], to: [22, 2.75, -32], spread: [0.95, 0.2], n: 110 });

  // ---- the gallery (0.5): darker, richer; the glass, the sitters, the windows and the pedestal left alone ----
  const gz = zoneOf('gallery'); const Gr = gz.rects[0];
  // two iron chandeliers of eight from the vault's crown (9.6), their cups 4.6 m up, in the bays either side of the middle
  for (const [i, zz] of [[0, -60.5], [1, -72.5]]) {
    add({ id: `gallery-chandelier-${i}`, zone: 'gallery', kind: 'chandelier', variant: 'iron', hybrid: false, x: (Gr.minX + Gr.maxX) / 2, y: 4.6, z: zz, n: [0, 0],
      w: 2.0, h: 9.6 - 4.6, proud: 0, out: 0, mount: 'hang', arms: 8 });
  }
  // the Count's arms, carved and gilded, over the far door between the two sitters; the spade over the way in
  const go = archFace('galleryOut', 'gallery');
  add(wallThing('gallery-crest-far', 'gallery', 'crest', 'dracul', { x: go.x, z: go.z, n: go.n }, 3.7, 0.94, 1.1, 0.1, { finish: 'relief', frame: 'gilt', mount: 'lintel', door: 'galleryOut' }));
  const gi = archFace('galleryIn', 'gallery');
  add(wallThing('gallery-crest-in', 'gallery', 'crest', 'spade', { x: gi.x, z: gi.z, n: gi.n }, 3.6, 0.9, 1.05, 0.1, { finish: 'relief', frame: 'gilt', mount: 'lintel', door: 'galleryIn' }));
  // a gargoyle on a corbel high on each pier between the windows; one holds a teacup
  for (const [i, zz, v] of [[0, -63, 'spread'], [1, -70, 'teacup'], [2, -77, 'crouch']]) {
    add(wallThing(`gallery-garg-${i}`, 'gallery', 'gargoyle', v, onWall(Gr, 'e', zz), 4.5, v === 'spread' ? 1.1 : 0.62, 1.0, 0.72, { seed: gseed(), edge: 'gilt' }));
  }
  // carved bats high on the end walls
  add(bat('gallery-bat-nw', 'gallery', onWall(Gr, 'n', -9.0), 4.5), bat('gallery-bat-ne', 'gallery', onWall(Gr, 'n', -0.7), 4.5));
  // a candelabra of five out beyond each of the two sitters at the far end (as far from their frames as the glass and the corner allow), by the pedestal's tonic
  add(wallThing('gallery-candelabra-w', 'gallery', 'candelabra', 'iron', onWall(Gr, 'n', -9.05), 1.85, 0.72, 0.62, 0.3, { arms: 5 }));
  add(wallThing('gallery-candelabra-e', 'gallery', 'candelabra', 'iron', onWall(Gr, 'n', -0.6), 1.85, 0.72, 0.62, 0.3, { arms: 5 }));
  // webs in the window wall's top corners (none on the glass) and the open arch in
  for (const c of concaveCorners('gallery').filter((q) => q.x > Gr.minX + 1)) add(cornerWeb(`gallery-web-${c.x},${c.z}`, 'gallery', c, 5.95, 0.8));
  add(...doorWebs('gallery-web-galleryIn', 'gallery', 'galleryIn'));
  // dust in the moon's shafts through the two middle windows, down across the floor toward the glass
  for (const w of WINDOWS.gallery.slice(1, 3)) {
    const ws = ROOM_WINDOWS.gallery; const y0 = gz.y + ws.sill + ws.h * 0.55;
    add({ id: `gallery-motes-${w.z}`, zone: 'gallery', kind: 'motes', variant: 'moon', hybrid: false, mount: 'air',
      from: [w.x - 0.8, y0, w.z], to: [w.x - 0.8 - (y0 - 0.65) * 50 / 21, gz.y + 0.65, w.z - (y0 - 0.65) * 12 / 21], spread: [0.55, 0.9], n: 130 });
  }

  // ---- the crypt (0.6): pure vampiric, the deepest of the three ----
  const cz = zoneOf('crypt'); const C = cz.rects[0]; const cy = cz.y;
  // coffins stood in niches: two at the far end either side of the Count's arms, one on the east wall
  add(wallThing('crypt-coffin-nw', 'crypt', 'coffin', 'iron', onWall(C, 'n', -8.2), cy, 1.0, 2.3, 0.15));
  add(wallThing('crypt-coffin-ne', 'crypt', 'coffin', 'iron', onWall(C, 'n', -1.8), cy, 1.0, 2.3, 0.15));
  add(wallThing('crypt-coffin-e', 'crypt', 'coffin', 'iron', onWall(C, 'e', -59.2), cy, 1.0, 2.3, 0.15));
  add(wallThing('crypt-crest', 'crypt', 'crest', 'dracul', onWall(C, 'n', -5), cy + 1.55, 1.0, 1.2, 0.08, { finish: 'plaque', frame: 'gilt' }));
  // gargoyles on corbels in the flames' light (a crypt corner is black): either side of the candle over the coffin and the Hare, and by the torch over the nun
  for (const [i, side, c, v] of [[0, 'e', -75.6, 'crouch'], [1, 'e', -72.4, 'spread'], [2, 'w', -63.0, 'crouch']]) {
    add(wallThing(`crypt-garg-${i}`, 'crypt', 'gargoyle', v, onWall(C, side, c), cy + HEAD_LINE + 0.17, v === 'spread' ? 0.9 : 0.55, 0.5, 0.6, { seed: gseed(), edge: 'gilt' })); // (group 3, round 2: 15 cm up, so the corbel under it, now in its box, clears the head line too)
  }
  const ck = concaveCorners('crypt').filter((c) => !(c.x > C.maxX - 1 && c.z > C.maxZ - 1)); // the stair's landing fills the fourth corner
  add(bat('crypt-bat-w', 'crypt', onWall(C, 'w', -55.6), cy + 2.55), bat('crypt-bat-e', 'crypt', onWall(C, 'e', -69.6), cy + 2.55));
  add(wallThing('crypt-candelabra-w', 'crypt', 'candelabra', 'iron', onWall(C, 'w', -67.0), cy + 1.85, 0.8, 0.62, 0.3, { arms: 5 }));
  // (round 2, G1: the second candelabra on the far wall beside the arms, and a broad baked warm-red glow there, so the far end reads)
  add(wallThing('crypt-candelabra-far', 'crypt', 'candelabra', 'iron', onWall(C, 'n', -3.35), cy + 1.85, 0.8, 0.62, 0.3, { arms: 5 }));
  // (round 3, the visibility pass: the 7.6 by 2.6 m glow read a little like a spotlight on the arms. Now a
  // still, broad, soft wash behind them, and a thinner one behind each coffin, in the crypt's candle colour,
  // breathing with the moon's still glow, never flickering; all well under the candelabra's 0.34 on its wall)
  add({ id: 'crypt-far-glow', zone: 'crypt', kind: 'glow', variant: 'wall', hybrid: false, mount: 'air', still: true, x: -5, y: cy + 1.9, z: C.minZ + 0.03, n: [0, 1], w: 4.4, h: 3.6, strength: 0.09 });
  for (const [s, cx] of [['nw', -8.2], ['ne', -1.8]]) {
    add({ id: `crypt-coffin-glow-${s}`, zone: 'crypt', kind: 'glow', variant: 'wall', hybrid: false, mount: 'air', still: true, x: cx, y: cy + 1.2, z: C.minZ + 0.03, n: [0, 1], w: 1.6, h: 2.3, strength: 0.08 });
  }
  for (const c of ck) add(cornerWeb(`crypt-web-${c.x},${c.z}`, 'crypt', c, cy + cz.h - 0.06, 0.75));
  add({ id: 'crypt-motes-torch', zone: 'crypt', kind: 'motes', variant: 'fire', hybrid: false, mount: 'air', from: [-9.3, cy + 2.4, -72.5], to: [-8.2, cy + 1.3, -72.5], spread: [0.6, 0.3], n: 80 });
  // every group-2 piece in the kit's lean build (fewer facets on its rounded parts), so each room keeps to
  // the group-1 budget (+5 draw calls, +9.5k triangles a room); the pieces are high up or in the dark
  for (const p of out) { p.lean = true; if (p.kind === 'gargoyle' || p.kind === 'bat') p.light = 1.32; } // (round 2, G3/G6: a paler stone, so they part from the dark wall)
  add({ id: 'crypt-motes-candelabra', zone: 'crypt', kind: 'motes', variant: 'fire', hybrid: false, mount: 'air', from: [-9.3, cy + 2.3, -67], to: [-7.9, cy + 0.5, -67], spread: [0.8, 0.35], n: 90 });
  return out;
}

/** The placements in one zone. */
export function decorFor(zone, plan = decorPlan()) {
  return plan.filter((p) => p.zone === zone);
}

/** How far a gargoyle's corbel hangs under its y (vampkit.js: 0.27 of its carving's scale), 0 for anything else or a gargoyle on a pier's top. */
export function corbelDrop(p) {
  if (p.kind !== 'gargoyle' || p.mount === 'top') return 0;
  return 0.27 * (p.h || 0.8) / (p.variant === 'hatter' ? 1.12 : 0.9);
}

/**
 * The box a placement takes: { minX, maxX, minY, maxY, minZ, maxZ }. A wall thing runs w along its
 * wall and stands from out to out + proud off it; a corner thing proud out along both walls; a hung
 * thing w across; a web its three points; a shaft of dust its run and spread.
 */
export function boxOf(p) {
  if (p.kind === 'wreck') return { ...p.box }; // group 3: the broken white knight, every piece of it on the floor
  if (p.kind === 'web') {
    const xs = p.pts.map((q) => q[0]); const ys = p.pts.map((q) => q[1]); const zs = p.pts.map((q) => q[2]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }
  if (p.kind === 'motes') { // every point it can drift to: the shaft's points (the seed castle.js gives them does not matter: the shaft's own bounds do) and the drift's reach
    const a = MOTES.amp;
    const lo = [p.from[0], p.from[1], p.from[2]]; const hi = [...lo];
    const cl = Math.hypot(p.to[2] - p.from[2], p.to[0] - p.from[0]);
    const cx = cl < 1e-6 ? 1 : Math.abs(p.to[2] - p.from[2]) / cl; const cz = cl < 1e-6 ? 0 : Math.abs(p.to[0] - p.from[0]) / cl;
    for (const t of [0, 1]) {
      const c = p.from.map((v, i) => v + (p.to[i] - v) * t); const up = p.spread[1] * (1 - 0.6 * t);
      for (const [k, d] of [[0, cx * p.spread[0]], [1, up], [2, cz * p.spread[0]]]) { lo[k] = Math.min(lo[k], c[k] - d); hi[k] = Math.max(hi[k], c[k] + d); }
    }
    return { minX: lo[0] - a, maxX: hi[0] + a, minY: lo[1] - a * 0.7, maxY: hi[1] + a * 0.7, minZ: lo[2] - a, maxZ: hi[2] + a };
  }
  if (p.kind === 'glow') { // a baked pool of light on a wall: w along it, h tall, centred on (x, y), a hair off the face
    const ax = p.n[1] !== 0;
    return ax ? { minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minY: p.y - p.h / 2, maxY: p.y + p.h / 2, minZ: Math.min(p.z, p.z - p.n[1] * 0.03), maxZ: Math.max(p.z, p.z - p.n[1] * 0.03) }
      : { minX: Math.min(p.x, p.x - p.n[0] * 0.03), maxX: Math.max(p.x, p.x - p.n[0] * 0.03), minY: p.y - p.h / 2, maxY: p.y + p.h / 2, minZ: p.z - p.w / 2, maxZ: p.z + p.w / 2 };
  }
  // (group 3, round 2: a chandelier's candles in their pans stand 7 cm past its ring's w)
  if (p.mount === 'hang') { const a = p.w / 2 + (p.kind === 'chandelier' ? 0.07 : 0); return { minX: p.x - a, maxX: p.x + a, minY: p.y, maxY: p.y + p.h, minZ: p.z - a, maxZ: p.z + a }; }
  const y0 = p.y - corbelDrop(p); // (round 2, the technical critic: a gargoyle's corbel hangs under its y)
  if (p.mount === 'corner') {
    const sx = Math.sign(p.n[0]); const sz = Math.sign(p.n[1]);
    const a = p.proud;
    return { minX: Math.min(p.x, p.x + sx * a), maxX: Math.max(p.x, p.x + sx * a), minY: y0, maxY: p.y + p.h, minZ: Math.min(p.z, p.z + sz * a), maxZ: Math.max(p.z, p.z + sz * a) };
  }
  const [nx, nz] = p.n; const a0 = p.out || 0; const a1 = a0 + p.proud;
  const ax = nz !== 0; // the wall runs along x
  const minN = Math.min(a0, a1); const maxN = Math.max(a0, a1);
  if (ax) return { minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minY: y0, maxY: p.y + p.h, minZ: Math.min(p.z + nz * minN, p.z + nz * maxN), maxZ: Math.max(p.z + nz * minN, p.z + nz * maxN) };
  return { minX: Math.min(p.x + nx * minN, p.x + nx * maxN), maxX: Math.max(p.x + nx * minN, p.x + nx * maxN), minY: y0, maxY: p.y + p.h, minZ: p.z - p.w / 2, maxZ: p.z + p.w / 2 };
}

// ---- what decor must keep clear of --------------------------------------------------------------

/**
 * The least gap, metres, between any piece of decor and each kind of thing it keeps clear of (the
 * owner: every clue, puzzle object and door as readable as before): a door's opening and surround 0.4,
 * a torch, a picture or banner, a moon slit, a carved grin and a clue 0.3; a room's window 0.3 and the
 * way down the crypt stair 0.4 (group 2).
 */
export const MIN_GAP = f({ door: 0.4, torch: 0.3, art: 0.3, slit: 0.3, grin: 0.3, clue: 0.3, window: 0.3, route: 0.4 });

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
    // where each canvas really hangs (keepcast.js): the gallery's sitters centred at 2.35, the werewolf at 1.95; frames 0.1 m round
    const hung = a.id.startsWith('gallery-') ? [2.35, WALL_ART.portrait.h] : a.id === 'werewolf' ? [1.95, WALL_ART.werewolf.h] : null;
    const ys = isBanner ? [y0 + 0.4, y0 + 3.0] : hung ? [y0 + hung[0] - hung[1] / 2 - 0.1, y0 + hung[0] + hung[1] / 2 + 0.1] : [y0 + 0.95, y0 + 2.65];
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
  // group 2: a room's own wall flames, its windows (and the moon through them), and what is read or taken in it
  for (const t of roomLights(zone)) {
    const ys = [t.y - 0.5, t.y + 0.75];
    if (t.n[1] !== 0) box(`torch ${t.x},${t.z}`, 'torch', t.x - 0.3, t.x + 0.3, ys[0], ys[1], Math.min(t.z, t.z + t.n[1] * 0.6), Math.max(t.z, t.z + t.n[1] * 0.6));
    else box(`torch ${t.x},${t.z}`, 'torch', Math.min(t.x, t.x + t.n[0] * 0.6), Math.max(t.x, t.x + t.n[0] * 0.6), ys[0], ys[1], t.z - 0.3, t.z + 0.3);
  }
  if (ROOM_WINDOWS[zone]) {
    const ws = ROOM_WINDOWS[zone]; const r = z.rects[0];
    for (const w of WINDOWS[zone]) box(`window ${w.z}`, 'window', r.maxX - 0.3, r.maxX, y0 + ws.sill, y0 + ws.sill + ws.h, w.z - ws.w / 2, w.z + ws.w / 2);
  }
  if (zone === 'tea') {
    const T = z.rects[0];
    for (const c of CLOCKS) {
      const perch = TEA.ravenPerches.find((p) => p.on === c.id); // the clock's top, where the raven sits
      box(`clock ${c.id}`, 'clue', c.x - 0.45, c.x + 0.45, 0, perch.y + 0.45, c.z - 0.45, c.z + 0.45);
    }
    const C = TEA.exitCandle; // the shelf, the candle and its glow up the wall
    box('exit candle', 'clue', C.x - 0.6, C.x + 0.95, C.shelf.top - 0.15, C.y + 1.35, T.minZ, T.minZ + C.shelf.d + 0.1);
    const sb = TEA.sideboard; box('sideboard', 'clue', sb.minX, sb.maxX, 0, sb.h + 0.1, sb.minZ, sb.maxZ);
    const fb = TEA.fireplace; box('hearth', 'torch', fb.minX, fb.maxX + 0.25, 0, TEA.mantelTop + 1.12, fb.minZ - 0.3, fb.maxZ + 0.3); // the chimneypiece and its overmantel
    const tb = TEA.table; box('table', 'clue', tb.minX - 0.9, tb.maxX + 0.9, 0, 2.1, tb.minZ - 0.9, tb.maxZ + 0.9); // the dishes, the candelabras, the two sitters
    const g = TEA.werewolf.gouge; box('gouge', 'clue', g.x - 0.9, g.x + 0.9, 0, 0.1, g.z - 0.9, g.z + 0.9);
  }
  if (zone === 'gallery') {
    const Gr = z.rects[0];
    box('mirror', 'art', Gr.minX, Gr.minX + 0.2, y0, y0 + GALLERY.mirrorH + 0.85, Gr.minZ + 0.35, Gr.maxZ - 0.35); // the glass and its gilt frame, its points on top
    const gh = HEARTHS.gallery; box('hearth', 'torch', gh.minX - 0.4, gh.maxX, y0, y0 + 2.65, gh.minZ, gh.maxZ);
    const p = GALLERY_PROPS.pedestal; box('pedestal', 'clue', p.x - 0.3, p.x + 0.3, y0, y0 + 1.35, p.z - 0.3, p.z + 0.3);
    const t = GALLERY_PROPS.tall; box('tall figure', 'clue', t.x - 0.5, t.x + 0.5, y0, y0 + 2.6, t.z - 0.5, t.z + 0.5);
    for (const b of CRYPT.rails) box(`rail ${b.minX}`, 'route', b.minX, b.maxX, y0, y0 + 2.4, b.minZ, b.maxZ);
    const st = CRYPT.stair.rect; box('crypt stair', 'route', st.minX, st.maxX, y0, y0 + 2.4, st.minZ, st.maxZ);
  }
  if (zone === 'crypt') {
    for (const b of CRYPT.props) box(`${b.kind} ${b.minX},${b.minZ}`, 'clue', b.minX, b.maxX, y0, y0 + b.h + 0.15, b.minZ, b.maxZ);
    const h = CRYPT_PROPS.hare; box('hare', 'clue', h.x - 0.5, h.x + 0.5, y0, y0 + 2.1, h.z - 0.5, h.z + 0.5);
    const n = CRYPT_PROPS.nun; box('nun', 'clue', n.x - 0.8, n.x + 0.8, y0, y0 + 1.6, n.z - 0.8, n.z + 0.8);
    for (const k of ['nunTonic', 'underStair']) { const q = CRYPT_PROPS[k]; box(k, 'clue', q.x - 0.3, q.x + 0.3, y0, y0 + 0.7, q.z - 0.3, q.z + 0.3); }
    CRYPT_PROPS.rats.forEach((q, i) => box(`rats ${i}`, 'clue', q.x - 1.2, q.x + 1.2, y0, y0 + 0.3, q.z - 1.2, q.z + 1.2));
    const st = CRYPT.stair.rect; box('crypt stair', 'route', st.minX, st.maxX, y0, 0, st.minZ, st.maxZ); // its treads and the head room over them
  }
  keepClearThree(zone, box, out); // group 3: the Knight's Walk, the stairs, the landing
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

// ---- group 3: the Knight's Walk (0.6), the stairs (0.65), the landing (0.8) ----------------------
//
// The walk is the moon's room ("bare stone, no flame": castle.js takes no flame's light there), so its
// iron is cold: two chandeliers of eight and two candelabras of guttered, cobwebbed candles that no one
// has lit in a century; its coffins stand in niches on the far wall under a still moon wash, two
// gargoyles crouch over the white pieces in the moon on the west wall (one holds a teacup), the Count's
// arms are carved over the way on and the heart over the way in, and the dust hangs in the moon under
// the great window (never over the board). On the floor in the south-west corner lies the White Knight
// of the same set, fallen off the board and broken (the owner: "a white piece, lying on the ground, off
// the board broken into a few pieces"): solid where it lies (solids.js boxes its three big pieces).
// The stair, a 2 m shaft, is lit: a lean chandelier of six hung in the shaft well over every tread's
// head room, gargoyles and bats high on its walls, the arms painted on its west wall. The landing is
// the richest: a chandelier under its slab, a candelabra each side with a gargoyle over it (the east one
// in the Hatter's hat with its 10/6 card), the spade carved over the way into the mirror room.

/** The torches castle.js buildStairs and buildLanding hang (kept equal by a test), so decor keeps off them: [{ x, z, n, y }]. */
export function stairLights(id) {
  const z = zoneOf(id); if (!z || !['stairs', 'landing'].includes(id)) return [];
  const r = z.rects[0];
  if (id === 'stairs') { // castle.js: at a quarter and seven tenths of the run, 2.3 m over the tread there
    const run = STAIRS.run * STAIRS.treads; const rise = STAIRS.rise * STAIRS.treads;
    return [['w', 0.25], ['e', 0.7]].map(([side, k]) => ({ ...onWall(r, side, STAIRS.foot - run * k), y: z.y + rise * k + 2.3 }));
  }
  return [r.minX + 0.9, r.maxX - 0.9].map((c) => ({ ...onWall(r, 'n', c), y: z.y + 2.3 }));
}

/** The tread height at z on the main stair (keepmap stairFloor, the rule its floor is walked on), or null off it. */
export function treadAt(z) {
  const m = STAIRS.foot - z; // metres north of the foot (z falls going up)
  if (m < 0 || m > STAIRS.run * STAIRS.treads) return null;
  return stairFloor(z);
}

/** The head room kept over every tread of the main stair, from the tread (and the warden is 1.8 m tall). */
export const STAIR_HEAD = 2.45;

// The White Knight, fallen off the board and broken: its pieces and footprints are keepmap.js's (WRECK,
// wreckFoot, wreckBoxes, next to the board: solids.js boxes them from there); re-exported here for the plan.
export { WRECK, wreckFoot, wreckBoxes };

/** The tint the wreck's ivory takes in the fittings: its share, under its room's grade, leaning FIT_HUE to the room's light. */
export function wreckTint(id) {
  const g = gradeTint(id); const h = roomHue(id);
  return g.map((c, i) => c * WRECK.share * (1 - FIT_HUE + FIT_HUE * h[i]));
}

/** The vault over the walk (castle.js: a half ellipse, rise 5 over the 24 m span, springing at 6.5): its height at z. */
function walkVaultAt(zz) {
  const r = zoneOf('walk').rects[0]; const half = (r.maxZ - r.minZ) / 2; const d = zz - (r.minZ + r.maxZ) / 2;
  return 6.5 + 5 * Math.sqrt(Math.max(0, 1 - (d / half) ** 2));
}

function groupThree(rand) {
  const out = [];
  const add = (...xs) => out.push(...xs);
  const gseed = () => Math.floor(rand() * 1000);
  const bat = (id, zone, at, y, v = 'bat', w = 0.78) => wallThing(id, zone, 'bat', v, at, y, w, 0.44, 0.09, { tilt: (rand() - 0.5) * 0.22, seed: gseed() });
  // (round 2: every corbel in the figure's own stone, not a black block; the stair's without the gilt lip, which read as a flat tan slab)
  const garg = (id, zone, at, y, v, h = 1.0) => wallThing(id, zone, 'gargoyle', v, at, y, v === 'spread' ? 1.1 : 0.62, h, v === 'spread' ? 0.72 : 0.6, { seed: gseed(), edge: zone === 'stairs' ? undefined : 'gilt', corbelTone: true });

  // ---- the Knight's Walk (0.6): the moon's room; its iron is cold ----
  const wz = zoneOf('walk'); const W = wz.rects[0];
  // two cold chandeliers of five in the vault over the margins (never over the board), on iron rods to the vault, 8 cm short of it
  for (const [s, zz] of [['s', -95.0], ['n', -115.0]]) {
    add({ id: `walk-chandelier-${s}`, zone: 'walk', kind: 'chandelier', variant: 'iron', hybrid: false, x: 13, y: 4.4, z: zz, n: [0, 0],
      w: 1.9, h: walkVaultAt(zz) - 0.1 - 4.4, proud: 0, out: 0, mount: 'hang', arms: 5, cold: true, rod: true, noWeb: s === 'n' }); // (round 2: no web strung across the arms over the way on)
  }
  // the Count's arms carved and gilded over the way on (toward him); the heart over the way in
  const wo = archFace('walkOut', 'walk');
  add(wallThing('walk-crest-out', 'walk', 'crest', 'dracul', { x: wo.x, z: wo.z, n: wo.n }, 3.4, 1.0, 1.2, 0.1, { finish: 'relief', frame: 'gilt', mount: 'lintel', door: 'walkOut' }));
  const wi = archFace('walkIn', 'walk');
  add(wallThing('walk-crest-in', 'walk', 'crest', 'heart', { x: wi.x, z: wi.z, n: wi.n }, 3.4, 0.9, 1.05, 0.1, { finish: 'relief', frame: 'gilt', mount: 'lintel', door: 'walkIn' }));
  // (round 2, H5: a still moon wash laid over each, so the dragon and the bat show from 8 m in the dark vault)
  for (const [s, a, c] of [['out', wo, -1], ['in', wi, 1]]) {
    add({ id: `walk-crest-${s}-glow`, zone: 'walk', kind: 'glow', variant: 'moon', hybrid: false, mount: 'lintel', door: s === 'out' ? 'walkOut' : 'walkIn', still: true, x: a.x, y: 4.05, z: a.z - c * 0.12, n: a.n, w: 1.5, h: 1.3, strength: 0.1 });
  }
  // two coffins stood in niches in the far wall, either side of the way on, under a still moon wash
  // (a still, broad moon wash behind each, as the crypt's coffins have theirs, never a spot on the lid; round 2, H3: stronger and paler,
  // so lid and arch read as a silhouette from the door; the lid a cold dark wood, its straps catching the moon)
  for (const [s, c] of [['w', 8.2], ['e', 17.8]]) {
    add(wallThing(`walk-coffin-${s}`, 'walk', 'coffin', 'iron', onWall(W, 'n', c), wz.y, 1.0, 2.3, 0.15, { lid: 'moon' }));
    add({ id: `walk-coffin-glow-${s}`, zone: 'walk', kind: 'glow', variant: 'moon', hybrid: false, mount: 'air', still: true, x: c, y: wz.y + 1.55, z: W.minZ + 0.03, n: [0, 1], w: 2.4, h: 3.0, strength: 0.12 });
  }
  // two gargoyles crouched on corbels over the white pieces, in the moon on the west wall; one holds a teacup
  add(garg('walk-garg-0', 'walk', onWall(W, 'w', -102.5), 4.5, 'crouch'), garg('walk-garg-1', 'walk', onWall(W, 'w', -107.5), 4.5, 'teacup', 1.18)); // (round 2: the hybrid a sixth larger)
  // carved bats at the moon's edges on the west wall, and either side of the great window (the watch bat by its north side)
  add(bat('walk-bat-w0', 'walk', onWall(W, 'w', -97.6), 5.2), bat('walk-bat-w1', 'walk', onWall(W, 'w', -112.4), 5.2));
  add(bat('walk-bat-e0', 'walk', onWall(W, 'e', -97.1), 6.0, 'bat', 0.92), bat('walk-bat-e1', 'walk', onWall(W, 'e', -112.9), 6.0, 'watch', 1.0)); // (round 2: larger, the watch bat most)
  // two cold candelabras of three either side of the way in
  for (const [s, c] of [['w', 9.6], ['e', 16.4]]) add(wallThing(`walk-candelabra-${s}`, 'walk', 'candelabra', 'iron', onWall(W, 's', c), 1.85, 0.6, 0.62, 0.3, { arms: 3, cold: true })); // (three arms: the walk's triangle budget)
  // the White Knight, fallen and broken in the south-west corner
  {
    const xs = []; const zs = [];
    for (const p of WRECK.parts) { const b = wreckFoot(p); xs.push(b.minX, b.maxX); zs.push(b.minZ, b.maxZ); }
    for (const [x, zz, s] of WRECK.chips) { xs.push(x - s, x + s); zs.push(zz - s, zz + s); }
    const sc = WRECK.scatter; xs.push(sc.x - sc.r, sc.x + sc.r); zs.push(sc.z - sc.r, sc.z + sc.r);
    const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: wz.y, maxY: wz.y + Math.max(...WRECK.parts.map((p) => p.h)), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    add({ id: 'walk-wreck', zone: 'walk', kind: 'wreck', variant: 'whiteKnight', hybrid: false, mount: 'floor', x: WRECK.scatter.x, y: wz.y, z: WRECK.scatter.z, n: [0, 0], box, seed: gseed() });
  }
  for (const c of concaveCorners('walk')) add(cornerWeb(`walk-web-${c.x},${c.z}`, 'walk', c, 6.4, 0.9));
  add(...doorWebs('walk-web-walkIn', 'walk', 'walkIn'));
  // the dust in the moon under the great window, down the east margin (never over the board)
  const wz0 = WINDOWS.walk[0].z;
  add({ id: 'walk-motes-moon', zone: 'walk', kind: 'motes', variant: 'moon', hybrid: false, mount: 'air', from: [24.3, 5.8, wz0], to: [22.4, 1.4, wz0], spread: [3.6, 1.0], n: 170 });

  // ---- the stairs (0.65): a 2 m shaft, torchlit; nothing stands on a tread or in its head room ----
  const sz = zoneOf('stairs'); const S = sz.rects[0];
  add({ id: 'stairs-chandelier', zone: 'stairs', kind: 'chandelier', variant: 'iron', hybrid: false, x: 13, y: 5.6, z: -122.75, n: [0, 0],
    w: 1.1, h: sz.y + 9.2 - 0.08 - 5.6, proud: 0, out: 0, mount: 'hang', arms: 6, pool: 0 }); // no floor pool: under it are treads
  add(garg('stairs-garg-w', 'stairs', onWall(S, 'w', -126.0), 7.45, 'crouch', 0.85), garg('stairs-garg-e', 'stairs', onWall(S, 'e', -119.6), 4.45, 'spread', 0.9));
  add(bat('stairs-bat-0', 'stairs', onWall(S, 'e', -122.2), 5.3), bat('stairs-bat-1', 'stairs', onWall(S, 'e', -126.6), 7.5));
  add(wallThing('stairs-crest', 'stairs', 'crest', 'dracul', onWall(S, 'w', -123.4), 4.0, 0.66, 0.8, 0.08, { finish: 'plaque', frame: 'gilt' })); // (round 2: a sixth smaller, it filled the climb)
  // webs in the angle of each wall and the slab (its only corners are over the arch to the landing, where a web would hang in the way)
  for (const [x, nx, z0] of [[S.minX, 1, -121.6], [S.maxX, -1, -126.4]]) {
    add({ id: `stairs-web-${x}`, zone: 'stairs', kind: 'web', variant: 'corner', hybrid: false, mount: 'corner',
      pts: [[x + nx * 0.015, sz.y + 8.45, z0 - 0.4], [x + nx * 0.015, sz.y + 9.18, z0], [x + nx * 0.6, sz.y + 9.18, z0 - 0.8]] });
  }
  add({ id: 'stairs-motes-torch', zone: 'stairs', kind: 'motes', variant: 'fire', hybrid: false, mount: 'air', from: [13.3, 7.8, -125.0], to: [13.3, 6.9, -125.0], spread: [0.4, 0.3], n: 80 }); // over the east torch, over the head room

  // ---- the landing (0.8): the richest of the three ----
  const lz = zoneOf('landing'); const L = lz.rects[0]; const ly = lz.y;
  add({ id: 'landing-chandelier', zone: 'landing', kind: 'chandelier', variant: 'iron', hybrid: false, x: 13, y: ly + 3.3, z: (L.minZ + L.maxZ) / 2, n: [0, 0],
    w: 1.3, h: 4.2 - 0.08 - 3.3, proud: 0, out: 0, mount: 'hang', arms: 6, pool: 1.3 }); // a small pool, kept on the landing (never over the stair)
  const mi = archFace('mirrorIn', 'landing');
  add(wallThing('landing-crest', 'landing', 'crest', 'spade', { x: mi.x, z: mi.z, n: mi.n }, ly + 3.32, 0.66, 0.76, 0.1, { finish: 'relief', frame: 'gilt', mount: 'lintel', door: 'mirrorIn' }));
  // (round 2, H13: the two alcoves differ: three candles in the west, five in the east)
  for (const [s, side, arms] of [['w', 'w', 3], ['e', 'e', 5]]) add(wallThing(`landing-candelabra-${s}`, 'landing', 'candelabra', 'iron', onWall(L, side, (L.minZ + L.maxZ) / 2), ly + 1.85, arms === 3 ? 0.55 : 0.7, 0.62, 0.3, { arms }));
  add(garg('landing-garg-w', 'landing', onWall(L, 'w', (L.minZ + L.maxZ) / 2), ly + 2.95, 'crouch', 0.85), garg('landing-garg-e', 'landing', onWall(L, 'e', (L.minZ + L.maxZ) / 2), ly + 2.95, 'hatter', 1.0));
  add(bat('landing-bat-w', 'landing', onWall(L, 's', 10.9), ly + 2.9), bat('landing-bat-e', 'landing', onWall(L, 's', 15.1), ly + 2.9));
  for (const c of concaveCorners('landing')) add(cornerWeb(`landing-web-${c.x},${c.z}`, 'landing', c, ly + 4.15, c.x < 13 && c.z > -129.5 ? 0.8 : 0.55)); // (round 2: a heavier web in the west alcove's near corner)
  add({ id: 'landing-motes-candelabra', zone: 'landing', kind: 'motes', variant: 'fire', hybrid: false, mount: 'air', from: [10.6, ly + 2.9, -129.5], to: [10.9, ly + 1.3, -129.5], spread: [0.5, 0.25], n: 70 }); // in the west candelabra's light, beside the way

  // the lean build and the paler stone of group 2, so each room keeps to the budget and its carving parts from the wall
  // (and a teacup held in the fittings, its china its own pale colour, so the hybrid reads)
  for (const p of out) { if (p.kind !== 'wreck') p.lean = true; if (p.kind === 'gargoyle' || p.kind === 'bat') p.light = 1.32; if (p.variant === 'teacup') p.cupFit = true; }
  return out;
}

/** Group 3's boxes nothing may enter (called by keepClear with its padded box(); the stair's head room is pushed unpadded). */
function keepClearThree(zone, box, out) {
  const z = zoneOf(zone); if (!z || !['walk', 'stairs', 'landing'].includes(zone)) return;
  const y0 = z.y;
  for (const t of stairLights(zone)) {
    const ys = [t.y - 0.5, t.y + 0.75];
    if (t.n[1] !== 0) box(`torch ${t.x},${t.z}`, 'torch', t.x - 0.3, t.x + 0.3, ys[0], ys[1], Math.min(t.z, t.z + t.n[1] * 0.6), Math.max(t.z, t.z + t.n[1] * 0.6));
    else box(`torch ${t.x},${t.z}`, 'torch', Math.min(t.x, t.x + t.n[0] * 0.6), Math.max(t.x, t.x + t.n[0] * 0.6), ys[0], ys[1], t.z - 0.3, t.z + 0.3);
  }
  const st = STAIRS.rect;
  if (zone === 'walk') {
    const B = BOARD.rect; const e = 0.22; // the board and its fillet, the pieces on it and the knight's leap over them
    box('board', 'clue', B.minX - e, B.maxX + e, y0, y0 + 5.0, B.minZ - e, B.maxZ + e);
    for (const w of BOARD.whites) { const p = PIECE_FOOT[w.kind]; box(`white ${w.kind}`, 'clue', w.x - p.R, w.x + p.R, y0, y0 + p.H + p.top + 0.1, w.z - p.R, w.z + p.R); }
    box('board plate', 'clue', BOARD.plate.x - 0.5, BOARD.plate.x + 0.5, y0, y0 + 0.75, BOARD.plate.z + 0.1 - 0.31, BOARD.plate.z + 0.1 + 0.31); // the lectern (solids.js)
    for (const p of PADS.filter((q) => q.stage === 4)) box(`pad ${p.at}`, 'clue', p.x - 0.4, p.x + 0.4, y0, y0 + 0.5, p.z - 0.4, p.z + 0.4);
    box('leaves walkOut', 'door', st.minX - 0.25, st.maxX + 0.25, y0, y0 + 3.0, z.rects[0].minZ, z.rects[0].minZ + 1.1); // its leaves stand open into the walk
    // the ways across the margins: the door in to b1 and g1, rank 8 to the door on
    box('way in', 'route', B.minX + 2, B.maxX - 2, y0, y0 + 2.6, B.maxZ + 0.2, z.rects[0].maxZ - 1.0);
    box('way on', 'route', B.minX + 2, B.maxX - 2, y0, y0 + 2.6, z.rects[0].minZ + 0.8, B.minZ - 0.2);
  }
  if (zone === 'stairs' || zone === 'landing') box('door stairTop', 'door', st.minX - 0.25, st.maxX + 0.25, UPPER, UPPER + doorHeight({ id: 'stairTop' }) + 0.3, st.minZ - 0.3, st.minZ + 0.3);
  if (zone === 'stairs') { // every tread's head room, between the wall reliefs (RELIEF_MAX each side), measured from that tread
    for (let k = 1; k <= STAIRS.treads; k++) {
      const top = k * STAIRS.rise; const z1 = STAIRS.foot - (k - 1) * STAIRS.run; const z0 = STAIRS.foot - k * STAIRS.run;
      out.push({ id: `tread ${k}`, kind: 'route', minX: st.minX + RELIEF_MAX, maxX: st.maxX - RELIEF_MAX, minY: top, maxY: top + STAIR_HEAD, minZ: z0 - 0.05, maxZ: z1 + 0.05 });
    }
  }
  if (zone === 'landing') box('landing way', 'route', st.minX, st.maxX, y0, y0 + 2.4, z.rects[0].minZ, z.rects[0].maxZ); // the stair's head to the mirror room's door
}
