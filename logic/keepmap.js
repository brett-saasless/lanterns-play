// The castle's plan as data (docs/features/castle/02-design.md, Data): the zones and their
// clear floor rectangles, the doors between them (and what each waits on), the walls built from
// both, the floor heights (two floors share the plan at the bridge over the pit and the gallery
// over the crypt: floorZoneAt is the one answer to which floor the warden is on, security A3),
// the checkpoints, the clocks, the gallery's tiles and its true path (data for gallery.js only;
// the view never reads it, security A5), the board, the forecourt's cover, the pads, the hidden
// good things, and where every prop stands. Metres; north is toward negative z, as in the court.
// Positions only: every number that is balance lives in keepconfig.js.

import { aabb } from './courtmap.js';
import { stairHeight, levelAt, STEP_UP } from './levels.js';
import { RECTS as ROAD_RECTS, roadFloor } from './road.js'; // issue #29: the road up from the wood
import { RECTS as WALK_RECTS, TUNNEL, tunnelFloor } from './tunnelwalk.js'; // the walk from the Caterpillar's gate to the road's foot

// The stair rule and the step height are shared with the yard's crates (levels.js).
export { stairHeight, STEP_UP };

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};

const R = (minX, maxX, minZ, maxZ) => ({ minX, maxX, minZ, maxZ });
const inRect = (r, x, z, pad = 0) => x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
const EPS = 1e-6;

/** Wall height and thickness: walls stand just outside each zone's clear floor. */
export const WALL = f({ h: 6, t: 0.5 });

/** The upper storey's floor (the stairs rise this far, north of every ground-floor room). */
export const UPPER = 5;

// ---- zones ------------------------------------------------------------------------------------
// id, stage (the checkpoint index the zone belongs to), y (floor), rects (clear floor). The
// pit and the crypt are the lower floors of `bridge` and `gallery`: same footprint, own zone.

export const ZONES = f([
  { id: 'approach', stage: 0, y: 0, rects: [R(-12, 12, 34, 44)] },
  // Issue #29: the road up from the wood's end, south of the approach (its floor climbs: road.js).
  // The walk from the wood (tunnelwalk.js) is the road's too: its metre-wide slices of clear floor
  // come first, east of leg 1, the last abutting it, so the walls close it in and open onto the road.
  { id: 'road', stage: 0, y: 0, rects: [...ROAD_RECTS, ...WALK_RECTS].map((r) => R(r.minX, r.maxX, r.minZ, r.maxZ)) },
  { id: 'bridge', stage: 0, y: 0, rects: [R(-12, 12, 14, 34)], lower: 'pit' },
  { id: 'forecourt', stage: 0, y: 0, rects: [R(-9, 9, 0.5, 14)] },
  { id: 'hall', stage: 1, y: 0, rects: [R(-4, 4, -8.5, -0.5)] },
  { id: 'cor1', stage: 1, y: 0, rects: [R(-1, 1, -14, -9.5), R(-1, 23, -16, -14), R(21, 23, -23.5, -16)] },
  { id: 'tea', stage: 2, y: 0, rects: [R(12, 32, -40.5, -24.5)] },
  { id: 'cor2', stage: 2, y: 0, rects: [R(14, 16, -44, -41.5), R(-9, 16, -46, -44), R(-9, -7, -49.5, -46)] },
  { id: 'gallery', stage: 3, y: 0, rects: [R(-10, 0, -82.5, -50.5)], lower: 'crypt' },
  { id: 'cor3', stage: 3, y: 0, rects: [R(-6, -4, -90, -83.5), R(-6, 14, -92, -90)] },
  { id: 'walk', stage: 4, y: 0, rects: [R(1, 25, -117, -93)] },
  { id: 'stairs', stage: 4, y: 0, rects: [R(12, 14, -128, -118)] },
  { id: 'landing', stage: 5, y: UPPER, rects: [R(10, 16, -131, -128)] },
  { id: 'mirror', stage: 5, y: UPPER, rects: [R(3, 23, -146, -132)] },
  { id: 'passage', stage: 5, y: UPPER, rects: [R(-10, 2, -142, -140), R(-10, -8, -148.5, -142)] },
  { id: 'nursery', stage: 5, y: UPPER, rects: [R(-16, -4, -159.5, -149.5)] },
  { id: 'countway', stage: 5, y: UPPER, rects: [R(12, 14, -150, -147)] },
  { id: 'count', stage: 6, y: UPPER, rects: [R(1, 25, -171, -151)] },
]);

/**
 * Doors: a rectangle the thickness of the wall between two zones. key: what must be so before
 * it opens (keep.js keepBoxes shuts it until then): 'armour' (the second suit beaten),
 * 'garlic' (garlic carried, security A7), 'clocks', 'gallery' (the far apron reached),
 * 'knight' (the board won). No key: always open.
 */
export const DOORS = f([
  { id: 'front', key: 'armour', zones: ['forecourt', 'hall'], rect: R(-1.5, 1.5, -0.5, 0.5) },
  { id: 'inner', key: 'garlic', zones: ['hall', 'cor1'], rect: R(-1, 1, -9.5, -8.5) },
  { id: 'teaIn', key: null, zones: ['cor1', 'tea'], rect: R(21, 23, -24.5, -23.5) },
  { id: 'teaOut', key: 'clocks', zones: ['tea', 'cor2'], rect: R(14, 16, -41.5, -40.5) },
  { id: 'galleryIn', key: null, zones: ['cor2', 'gallery'], rect: R(-9, -7, -50.5, -49.5) },
  { id: 'galleryOut', key: 'gallery', zones: ['gallery', 'cor3'], rect: R(-6, -4, -83.5, -82.5) },
  { id: 'walkIn', key: null, zones: ['cor3', 'walk'], rect: R(12, 14, -93, -92) },
  { id: 'walkOut', key: 'knight', zones: ['walk', 'stairs'], rect: R(12, 14, -118, -117) },
  { id: 'mirrorIn', key: null, zones: ['landing', 'mirror'], rect: R(12, 14, -132, -131) },
  { id: 'passageIn', key: null, zones: ['mirror', 'passage'], rect: R(2, 3, -142, -140) },
  { id: 'nurseryIn', key: null, zones: ['passage', 'nursery'], rect: R(-10, -8, -149.5, -148.5) },
  { id: 'countwayIn', key: null, zones: ['mirror', 'countway'], rect: R(12, 14, -147, -146) },
  { id: 'countIn', key: null, zones: ['countway', 'count'], rect: R(12, 14, -151, -150) },
]);

/** The door called id. */
export function doorOf(id) {
  return DOORS.find((d) => d.id === id) || null;
}

// ---- the two shared places: the bridge over the pit, the gallery over the crypt ---------------

/**
 * The pit under the bridge (R3): 24 m wide, 4 m deep, the deck 5 m wide over it with no
 * rails, and the stair on the west side, its head at the approach end. While the warden is on
 * the pit floor or its stair, `walls` close it (the stair's head is the way out).
 */
export const PIT = f({
  id: 'pit',
  over: 'bridge',
  rect: R(-12, 12, 14, 34),
  top: 0,
  floor: -4,
  deck: R(-2.5, 2.5, 14, 34),
  stair: { rect: R(-12, -10, 22, 34), axis: 'z', head: 34, dir: -1, landing: 0.75, run: 0.75, rise: 0.25, treads: 16, top: 0 },
  walls: [
    aabb(-9, 9, 13.5, 14, WALL.h, 'pitWall'), // the forecourt's edge, seen from below
    aabb(-10, 12, 34, 34.5, WALL.h, 'pitWall'), // the approach end, but for the stair's head
  ],
  snakes: R(-12, 12, 14, 34), // the pit floor; the stair is clear of them (keep.js)
});

/**
 * The crypt under the gallery (R8, R12): the same footprint, floor 4 m down. Its stair's mouth
 * is in the entrance apron against the window wall, outside the tile field; the stair runs
 * west along the entrance wall from a landing at its head. Rails stand round the stairwell on
 * the gallery floor; below, the crypt's doors are walled and its boxes of earth stand.
 */
export const CRYPT = f({
  id: 'crypt',
  over: 'gallery',
  rect: R(-10, 0, -82.5, -50.5),
  top: 0,
  floor: -4,
  stair: { rect: R(-5, 0, -52.1, -50.5), axis: 'x', head: 0, dir: -1, landing: 1.2, run: 3.8 / 15, rise: 0.25, treads: 16, top: 0 },
  rails: [
    aabb(-5, -1.2, -52.3, -52.1, 1.1, 'rail'), // the north side, open at the landing
    aabb(-5.2, -5, -52.3, -50.5, 1.1, 'rail'), // the stair's foot end
  ],
  walls: [
    aabb(-9, -7, -50.5, -49.5, WALL.h, 'cryptWall'), // under the entrance door
    aabb(-6, -4, -83.5, -82.5, WALL.h, 'cryptWall'), // under the far door
  ],
  props: [
    aabb(-3.6, -2.4, -66.2, -63.8, 1.1, 'earthBox'),
    aabb(-7.6, -6.4, -71.2, -68.8, 1.1, 'earthBox'),
    aabb(-8.6, -7.4, -77.2, -74.8, 1.1, 'earthBox'),
    aabb(-2.6, -1.4, -75.2, -72.8, 1.0, 'coffin'),
  ],
});

/** The lower floors, each under its upper zone. */
export const LOWER = f([PIT, CRYPT]);

/** The main staircase from the Knight's Walk's north door up to the landing (R10). */
export const STAIRS = f({ rect: R(12, 14, -128, -118), axis: 'z', foot: -118, run: 0.5, rise: 0.25, treads: 20, top: UPPER });

// ---- the gallery's tiles and true path (R8; data for gallery.js alone, security A5) -----------

export const GALLERY = f({
  rect: R(-10, 0, -82.5, -50.5),
  mirrorX: -10, // the whole west wall is the glass
  windowX: 0,
  entrance: R(-10, 0, -54.5, -50.5), // the 4 m apron at each end
  farApron: R(-10, 0, -82.5, -78.5),
  field: R(-10, 0, -78.5, -54.5),
  cols: 5,
  rows: 12,
  tile: 2,
  runnerCol: 2, // column C: the red runner, in the eye only
  mirrorH: 5.4, // the glass's height (castle.js and mirror.js read this one number)
});

/** The true path, column (A nearest the mirror) and row (1 at the entrance), entrance to far apron. */
export const TRUE_PATH_SOURCE = f([
  'B1', 'B2', 'A2', 'A3', 'A4', 'B4', 'C4', 'D4', 'D5', 'E5', 'E6', 'E7', 'D7', 'D8', 'C8', 'B8', 'B9', 'B10',
  'C10', 'D10', 'D11', 'D12',
]);

/** Tile i (index (row - 1) * 5 + column, as gallery.js numbers them): its rectangle and centre. */
export function tileRect(i) {
  const col = i % GALLERY.cols;
  const row = Math.floor(i / GALLERY.cols) + 1;
  const minX = GALLERY.field.minX + col * GALLERY.tile;
  const maxZ = GALLERY.field.maxZ - (row - 1) * GALLERY.tile;
  return { minX, maxX: minX + GALLERY.tile, minZ: maxZ - GALLERY.tile, maxZ, x: minX + GALLERY.tile / 2, z: maxZ - GALLERY.tile / 2, col, row };
}

/** The tile under (x, z), or -1 off the field. */
export function tileAt(x, z) {
  const fl = GALLERY.field;
  if (x < fl.minX || x >= fl.maxX || z <= fl.minZ || z > fl.maxZ) return -1;
  const col = Math.min(GALLERY.cols - 1, Math.floor((x - fl.minX) / GALLERY.tile));
  const row = Math.min(GALLERY.rows, 1 + Math.floor((fl.maxZ - z) / GALLERY.tile));
  return (row - 1) * GALLERY.cols + col;
}

// ---- the floor: one answer for both readers (security A3) ----------------------------------

function upperSolid(L, x, z, state) {
  if (L.id === 'pit') return inRect(L.deck, x, z);
  if (inRect(L.stair.rect, x, z)) return false; // the stairwell
  const t = tileAt(x, z);
  if (t < 0) return true; // an apron
  const gone = state && state.tiles && state.tiles.gone;
  return !(gone && gone[t]);
}

/** Ground height on the single-floor parts of the plan: 0, the stairs, or the upper storey. */
function baseFloor(x, z) {
  const road = roadFloor(x, z); // issue #29: the road climbs from the wood to the approach
  if (road != null) return road;
  const walk = tunnelFloor(x, z); // the walk to it, level with its foot
  if (walk != null) return walk;
  if (inRect(STAIRS.rect, x, z)) return stairFloor(z);
  return z <= -128 ? UPPER : 0;
}

/** The main stair's tread height at z (on the stair's footprint): the one rule baseFloor and the Dracula pass's head room (vamp.js treadAt) read. */
export function stairFloor(z) {
  const m = Math.max(0, -118 - z); // metres north of the stairs' foot
  const k = Math.min(STAIRS.treads, 1 + Math.floor(m / STAIRS.run));
  return Math.min(UPPER, k * 0.25);
}

/**
 * Which floor the warden is on at (x, z) with feet at height y, and the ground height under
 * them: { under, floor, zone }. under is 'pit' or 'crypt' whenever the warden is inside that
 * floor's footprint below its head height (dropped there, or walked down its stair), else null.
 * The ground is the highest surface in that place that the warden stands on or above
 * (STEP_UP allowed): the lower floor, a stair tread, or the upper floor where it is solid (the
 * deck, an apron, a tile not gone). Both floorAt and keepBoxes read it, so no event can be
 * missed. state (optional) is sim.waves: only its tiles.gone is read.
 */
export function floorZoneAt(x, z, y = 0, state = null) {
  const r = levelAt(LOWER, x, z, y, STEP_UP, upperSolid, state);
  if (r) return { under: r.under, floor: r.floor, zone: r.under || r.entry.over };
  return { under: null, floor: baseFloor(x, z), zone: zoneAt(x, z) };
}

/** Ground height under (x, z) for feet at y (default: on the floor state.under names). */
export function floorAt(state, x, z, y) {
  const at = y != null ? y : (state && state.under ? -4 : 0);
  return floorZoneAt(x, z, at, state).floor;
}

/** The zone id at (x, z) on the plan (the upper of two shared floors), or null in a wall. */
export function zoneAt(x, z) {
  for (const zn of ZONES) for (const r of zn.rects) if (inRect(r, x, z)) return zn.id;
  for (const d of DOORS) if (inRect(d.rect, x, z)) return d.zones[1];
  return null;
}

/** The stage (0 to 6) of a zone id. The pit is stage 0, the crypt stage 3. */
export function stageOf(zone) {
  if (zone === 'pit') return 0;
  if (zone === 'crypt') return 3;
  const zn = ZONES.find((z) => z.id === zone);
  return zn ? zn.stage : 0;
}

// ---- walls --------------------------------------------------------------------------------

/** Every clear rectangle on the plan: each zone's, then each door's. */
function regions() {
  return [...ZONES.flatMap((z) => z.rects), ...DOORS.map((d) => d.rect)];
}

/** [a, b] less every interval in cuts. */
function subtract(a, b, cuts) {
  let out = [[a, b]];
  for (const [c, d] of cuts) {
    const next = [];
    for (const [p, q] of out) {
      if (d <= p + EPS || c >= q - EPS) { next.push([p, q]); continue; }
      if (c > p + EPS) next.push([p, c]);
      if (d < q - EPS) next.push([d, q]);
    }
    out = next;
  }
  return out.filter(([p, q]) => q - p > EPS);
}

let WALLS = null;
let ALL_WALLS = null;
let WALK_WALLS = null;
// The walk from the gate (tunnelwalk.js) is ~90 metre slices, so ~500 wall and corner boxes: they are
// kept out of the castle's always-solid list (every mover in the castle tests every box) and
// added by keep.js keepBoxes only round where the warden is on it (walkWallsNear).
const WALK_X = TUNNEL.mouth.x - 0.6;

/**
 * The always-solid walls: every side of every clear rectangle, less where another clear
 * rectangle abuts it (a turn of a passage, or a door), as boxes WALL.t thick just outside it.
 * Not the walk's (walkWalls).
 */
export function keepWalls() {
  if (!WALLS) WALLS = f(allWalls().filter((b) => b.minX < WALK_X));
  return WALLS;
}

/**
 * The walk's walls and corner posts (every one east of the road's leg 1), side runs merged where
 * they line up, sorted by their west edge.
 */
export function walkWalls() {
  if (WALK_WALLS) return WALK_WALLS;
  const raw = [...allWalls(), ...allCorners()].filter((b) => b.minX >= WALK_X).sort((a, b) => a.minZ - b.minZ || a.maxZ - b.maxZ || a.minX - b.minX);
  const out = [];
  for (const b of raw) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.minZ - b.minZ) < EPS && Math.abs(last.maxZ - b.maxZ) < EPS && b.minX <= last.maxX + EPS) {
      out[out.length - 1] = aabb(last.minX, Math.max(last.maxX, b.maxX), last.minZ, last.maxZ, WALL.h, 'wall');
    } else out.push(b);
  }
  out.sort((a, b) => a.minX - b.minX);
  WALK_WALLS = f(out);
  return WALK_WALLS;
}

/** The walk's walls that reach into x0 to x1 (into out, which is returned). */
export function walkWallsNear(x0, x1, out = []) {
  for (const b of walkWalls()) {
    if (b.minX > x1) break;
    if (b.maxX >= x0) out.push(b);
  }
  return out;
}

function allWalls() {
  if (ALL_WALLS) return ALL_WALLS;
  const all = regions();
  const T = WALL.t;
  const out = [];
  for (const r of all) {
    const others = all.filter((o) => o !== r);
    const cutsX = (line, side) => others
      .filter((o) => Math.abs((side < 0 ? o.maxZ : o.minZ) - line) < EPS)
      .map((o) => [Math.max(r.minX, o.minX), Math.min(r.maxX, o.maxX)]);
    const cutsZ = (line, side) => others
      .filter((o) => Math.abs((side < 0 ? o.maxX : o.minX) - line) < EPS)
      .map((o) => [Math.max(r.minZ, o.minZ), Math.min(r.maxZ, o.maxZ)]);
    for (const [a, b] of subtract(r.minX, r.maxX, cutsX(r.minZ, -1))) out.push(aabb(a, b, r.minZ - T, r.minZ, WALL.h, 'wall'));
    for (const [a, b] of subtract(r.minX, r.maxX, cutsX(r.maxZ, 1))) out.push(aabb(a, b, r.maxZ, r.maxZ + T, WALL.h, 'wall'));
    for (const [a, b] of subtract(r.minZ, r.maxZ, cutsZ(r.minX, -1))) out.push(aabb(r.minX - T, r.minX, a, b, WALL.h, 'wall'));
    for (const [a, b] of subtract(r.minZ, r.maxZ, cutsZ(r.maxX, 1))) out.push(aabb(r.maxX, r.maxX + T, a, b, WALL.h, 'wall'));
  }
  ALL_WALLS = out;
  return ALL_WALLS;
}

let CORNERS = null;

/**
 * The stone at the outside of every corner: keepWalls runs each side's box only along its own side,
 * so two walls meeting at a room's corner touch at a point and leave the square outside the corner
 * open. Nothing as wide as the warden passes a point, but a thin thing could (a fallen pike, slid
 * along the floor: debris.js), so each corner square that no clear rectangle or doorway takes is a
 * post WALL.t square.
 */
export function keepCorners() {
  if (!CORNERS) CORNERS = f(allCorners().filter((b) => b.minX < WALK_X));
  return CORNERS;
}
let ALL_CORNERS = null;
function allCorners() {
  if (ALL_CORNERS) return ALL_CORNERS;
  const all = regions();
  const T = WALL.t;
  const out = [];
  const seen = new Set();
  for (const r of all) {
    for (const [cx, sx] of [[r.minX, -1], [r.maxX, 1]]) {
      for (const [cz, sz] of [[r.minZ, -1], [r.maxZ, 1]]) {
        const minX = sx < 0 ? cx - T : cx; const maxX = minX + T;
        const minZ = sz < 0 ? cz - T : cz; const maxZ = minZ + T;
        const key = `${minX.toFixed(3)},${minZ.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const open = all.some((o) => o.minX < maxX - EPS && o.maxX > minX + EPS && o.minZ < maxZ - EPS && o.maxZ > minZ + EPS);
        if (!open) out.push(aabb(minX, maxX, minZ, maxZ, WALL.h, 'wall'));
      }
    }
  }
  ALL_CORNERS = out;
  return ALL_CORNERS;
}

// ---- checkpoints --------------------------------------------------------------------------

/**
 * Where each stage's checkpoint seats the warden (index 0 to 6): the approach, inside the
 * castle door, the tea room's door, the gallery's entrance, the Knight's Walk's south door,
 * the top of the stairs, the Count's door. y is the floor there.
 */
export const SPAWNS = f([
  { x: 0, z: 42, y: 0, yaw: 0 },
  { x: 0, z: -2, y: 0, yaw: 0 },
  { x: 22, z: -26, y: 0, yaw: 0 },
  { x: -8, z: -52.5, y: 0, yaw: 0 },
  { x: 13, z: -94.5, y: 0, yaw: 0 },
  { x: 13, z: -129.5, y: UPPER, yaw: 0 },
  { x: 13, z: -152.5, y: UPPER, yaw: 0 },
]);

/** The middle window of the Count's room: walking to it after the dawn ends the level (R15). */
export const END = f({ x: 23.6, z: -161, r: 1.6 });

// ---- the exterior and the door (R3, R4) ---------------------------------------------------

/** The forecourt's eight pieces of cover: one within 4 m of anywhere on it, four over 8 m from the door. */
export const COVER = f([
  [-6.75, 10.5], [-2.25, 10.5], [2.25, 10.5], [6.75, 10.5],
  [-6.75, 4], [-2.25, 4], [2.25, 4], [6.75, 4],
].map(([x, z]) => aabb(x - 0.7, x + 0.7, z - 0.45, z + 0.45, 1.5, 'cover')));

/** The castle door (the second suit fights in front of it). */
export const DOOR = f({ x: 0, z: 0 });

/**
 * Where the one who leaves is painted on the wives' canvas (keepcast.js wifeWhoLeaves), in shares
 * of the canvas: her face's middle at u across (from its left as seen) and v down, s her face's half
 * width as a share of the canvas's width. She comes out of the canvas there (logic/emerge.js).
 */
export const WIFE_SPOT = f({ u: 0.2, v: 0.38, s: 0.064 });

/**
 * Where the sentries stand (sentries.js seatSentries): the two suits either side of the door, the
 * wife in her painting, in front of where she is painted (the wives' canvas is 2.5 m wide, WALL_ART,
 * centred on CORRIDOR.painting.x and facing +z, so its left as seen is -x).
 */
export const SENTRIES = f({
  suits: [{ x: -3, z: 1.8, yaw: Math.PI }, { x: 3, z: 1.8, yaw: Math.PI }],
  painting: { x: 11 + (WIFE_SPOT.u - 0.5) * 2.5, z: -15.4, yaw: Math.PI },
});

/** The pikes' price tags (read; the shipped tag "In this Style 10/6"). */
export const PIKES = f([{ x: -3.6, z: 2.2, tag: 'style106' }, { x: 3.6, z: 2.2, tag: 'style106' }]);

// ---- the hall and the first corridor (R5, R6) ----------------------------------------------

export const HALL = f({
  braid: { x: -3.6, z: -2.2 }, // on its nail by the west wall
  scratch: { x: -3.7, z: -3.4 }, // the words scratched beside it (read: garlicScratch)
  curtain: { x: 3.7, z: -5.5 }, // a curtain, a tonic behind it (PADS)
});

export const CORRIDOR = f({
  painting: { x: 11, z: -15.95, yaw: Math.PI }, // the three wives, half-way along the east run
  banners: [{ x: 6, z: -15.9 }, { x: -2, z: -45.9 }, { x: 4, z: -91.9 }],
  grins: [{ x: 22, z: -23.6 }, { x: -8, z: -49.6 }, { x: 13, z: -92.1 }],
});

// ---- Tea for the Dead (R7) ----------------------------------------------------------------

/** The five clocks, in the order of clocks.hours (clocks.js CLOCK_NAMES). */
export const CLOCKS = f([
  { id: 'longcase', x: 19.8, z: -25.2 }, // by the door
  { id: 'mantel', x: 12.7, z: -32 }, // on the fireplace, the left wall
  { id: 'carriage', x: 21, z: -29.2 }, // on the table, in front of the ghost
  { id: 'pocket', x: 23.6, z: -34.6 }, // in the skeleton's hand
  { id: 'wall', x: 31.6, z: -28.4 }, // beside the werewolf, just outside its reach
]);

// The mantel clock is MANTEL_CLOCK_K times its first size (the owner: twice as big); its case and arch stand 0.55 m tall at 1.
const MANTEL_TOP = 1.5; // just under the warden's eye (1.65), so the shelf never hides the clock face from the one setting it
const MANTEL_CLOCK_K = 2;
export const TEA = f({
  table: aabb(20, 24, -36, -28, 0.8, 'table'),
  fireplace: aabb(12, 12.8, -33.4, -30.6, 1.3, 'hearth'),
  mantelTop: MANTEL_TOP, mantelClockK: MANTEL_CLOCK_K, // the chimneypiece's shelf (castle.js builds it, the mantel clock stands on it: #17)
  sideboard: aabb(12, 13, -39.6, -37, 1, 'sideboard'),
  ghost: { x: 21, z: -28.4 }, // seated, the carriage clock in front of her
  skeleton: { x: 24.3, z: -34.6 }, // the Beefeater, seated
  bottle: { x: 23, z: -31 },
  werewolf: { x: 31.8, z: -32, gouge: { x: 30.9, z: -32 } }, // the painting, and the centre of its gouges
  candelabras: [{ x: 20.4, z: -30.5 }, { x: 23.6, z: -33.5 }],
  // y: the top of each clock (keepprops.js), where the raven sits; the rules' dodge test and the view both read it
  ravenPerches: [{ x: 19.8, y: 2.33, z: -25.2, on: 'longcase' }, { x: 12.7, y: MANTEL_TOP + 0.55 * MANTEL_CLOCK_K, z: -32, on: 'mantel' }, { x: 21, y: 1.1, z: -29.2, on: 'carriage' },
    { x: 23.6, y: 1.0, z: -34.6, on: 'pocket' }, { x: 31.6, y: 2.14, z: -28.4, on: 'wall' }],
  drawer: { x: 13.7, z: -38.3 }, // ajar, salt in it (PADS)
  // A dim candle on a low wall shelf just east of the exit door (teaOut), so that corner reads. The shelf hangs
  // from the door wall (the room's minZ); x, z: the candle on it, y: the shelf top. power: its glow, the same as the
  // table's candelabra candles (castle.js: 0.7; it was 0.22, the owner: "as bright as the other candles in the room").
  // It is a baked glow, not one of the pool's five real lights (the room already keeps five), so it costs no light.
  exitCandle: { x: 16.85, y: 1.05, z: -40.39, power: 0.7, shelf: { w: 0.46, d: 0.22, top: 1.05 } },
});

/** The werewolf's claws: the arm (keepcast.js) and the scores it leaves in the flags (clawrake.js) both read this, so they cannot drift apart. */
export const WEREWOLF_CLAW = f({ fingers: 4, length: 0.46, spread: 0.6, curl: 1.0, r: 0.05 });

// ---- the gallery and the crypt (R8, R12) ----------------------------------------------------

export const GALLERY_PROPS = f({
  portraits: [{ x: -5.4, z: -50.6, wall: 's' }, { x: -3, z: -82.4, wall: 'n' }, { x: -7, z: -82.4, wall: 'n' }], // the first clear of the door from cor2 (#12)
  torches: [{ x: -0.1, z: -56 }, { x: -0.1, z: -64 }, { x: -0.1, z: -72 }, { x: -0.1, z: -80 }],
  windows: [{ x: 0, z: -59.5 }, { x: 0, z: -66.5 }, { x: 0, z: -73.5 }, { x: 0, z: -80.5 }],
  tall: { x: -5, z: -81 }, // where the tall figure stands, in the glass only (haunts.js)
  pedestal: { x: -2, z: -81.6 }, // a tonic (LOOT)
});

export const CRYPT_PROPS = f({
  hare: { x: -3, z: -73.6 }, // chained to the coffin
  coffin: { x: -2, z: -74 },
  nun: { x: -8.4, z: -60 },
  nunTonic: { x: -7.2, z: -60 }, // a half tonic (LOOT), on the floor before her knees
  rats: [{ x: -6, z: -62 }, { x: -4, z: -68 }, { x: -8, z: -72 }],
  underStair: { x: -0.6, z: -51.3 }, // a tonic (LOOT), at the crypt's floor
});

// ---- the Knight's Walk (R9) ---------------------------------------------------------------

/** The board: 16 m square of 2 m squares, file a to the west, rank 1 to the south. */
export const BOARD = f({
  rect: R(5, 21, -113, -97),
  square: 2,
  files: 'abcdefgh',
  start: ['b1', 'g1'],
  plate: { x: 13, z: -96.4 }, // the brass plate at the near edge (read: boardPlate)
  south: R(1, 25, -97, -93), // the margins
  north: R(1, 25, -117, -113),
  whites: [ // watching along the west wall
    { kind: 'turtle', x: 2.2, z: -100 }, { kind: 'dormouse', x: 2.2, z: -105 }, { kind: 'duchess', x: 2.2, z: -110 },
  ],
  window: { x: 25, z: -105 },
});

/**
 * Each chessman's turned base and height (metres), the one description of its size: chessmen.js
 * carves every piece from it (R: the foot's radius, H: the base's height, top: the figure above
 * the base), and pieceCollider stands the same foot in the collision list, so what is drawn and
 * what stops the warden cannot drift apart (the owner, 2026-11-18: "they are solid pieces").
 */
export const PIECE_FOOT = f({
  pawn: { R: 0.5, H: 0.8, top: 2.1 },
  knight: { R: 0.6, H: 0.95, top: 3.05 },
  bishop: { R: 0.58, H: 0.95, top: 3.0 },
  rook: { R: 0.66, H: 0.9, top: 2.75 },
  queen: { R: 0.64, H: 1.0, top: 2.75 },
  king: { R: 0.7, H: 1.0, top: 3.0 },
  turtle: { R: 0.62, H: 0.95, top: 2.6 },
  dormouse: { R: 0.6, H: 0.95, top: 2.1 },
  duchess: { R: 0.66, H: 0.95, top: 2.12 },
});

/**
 * A chessman standing at (x, z) as a round collider (collide.js reads `r`: circle against circle),
 * its AABB the foot's square for everything that reads boxes (sight, shots). Null for an unknown kind.
 */
export function pieceCollider(kind, x, z, extra = {}) {
  const p = PIECE_FOOT[kind];
  if (!p) return null;
  const r = p.R;
  return { kind: 'piece', piece: kind, round: true, r, x, z, w: 2 * r, d: 2 * r, h: p.H + p.top,
    minX: x - r, maxX: x + r, minY: 0, maxY: p.H + p.top, minZ: z - r, maxZ: z + r, ...extra };
}

/**
 * Every chessman the Knight's Walk draws now, as colliders: the black pieces standing on the board
 * (knight.js: not taken; a taken piece dies and is gone) and the three white ones watching along the
 * west wall. board: sim.waves.board ({ pieces[] each { kind, square, taken } }), or null.
 */
export function chessColliders(board) {
  const out = [];
  if (board && board.pieces) {
    for (const p of board.pieces) {
      if (p.taken) continue;
      const s = squareRect(p.square);
      const c = s && pieceCollider(p.kind, s.x, s.z, { square: p.square });
      if (c) out.push(c);
    }
  }
  for (const w of BOARD.whites) out.push(pieceCollider(w.kind, w.x, w.z, { white: true }));
  return out;
}

/** The opening position (design, Data): white's view. */
export const OPENING = f([
  { kind: 'king', square: 'g8' },
  { kind: 'queen', square: 'c7' },
  { kind: 'rook', square: 'c6' },
  { kind: 'bishop', square: 'e8' },
  { kind: 'knight', square: 'b6' },
  { kind: 'pawn', square: 'a6' },
  { kind: 'pawn', square: 'd3' },
  { kind: 'pawn', square: 'f6' },
]);

/** 'e4' -> { file 0-7, rank 1-8 }, or null. */
export function squareCell(sq) {
  if (typeof sq !== 'string') return null;
  const m = /^([a-h])([1-8])$/.exec(sq);
  return m ? { file: m[1].charCodeAt(0) - 97, rank: Number(m[2]) } : null;
}

/** A square's rectangle and centre on the floor, or null. */
export function squareRect(sq) {
  const c = squareCell(sq);
  if (!c) return null;
  const s = BOARD.square;
  const minX = BOARD.rect.minX + c.file * s;
  const maxZ = BOARD.rect.maxZ - (c.rank - 1) * s;
  return { minX, maxX: minX + s, minZ: maxZ - s, maxZ, x: minX + s / 2, z: maxZ - s / 2 };
}

/** The square under (x, z), or null off the board. */
export function squareAt(x, z) {
  const b = BOARD.rect;
  if (x < b.minX || x >= b.maxX || z <= b.minZ || z > b.maxZ) return null;
  const file = Math.min(7, Math.floor((x - b.minX) / BOARD.square));
  const rank = Math.min(8, 1 + Math.floor((b.maxZ - z) / BOARD.square));
  return BOARD.files[file] + rank;
}

/**
 * The White Knight, fallen off the board and broken (the owner, 2026-11-19; the Dracula pass, group 3):
 * the set's knight is the Gryphon (the owner, 2026-11-19: "add flair like the other white pieces"; the
 * Mock Turtle's companion, carved in chessmen.js's ivory by carveGryphon on PIECE_FOOT.knight's turned
 * base), in four pieces and a scatter of chips in the walk's south-west corner between the door and the
 * Mock Turtle, off the board and its frame. A prop, not a chessman: no rule reads it but the collision
 * (solids.js boxes its three big pieces; the wing lies flat, 15 cm high, and is walked over like the
 * chips). Each part: { id, x, z (the middle of its footprint), yaw (its long axis, radians from +x
 * toward +z), len, r (half its width across), h (how tall it lies) }, len and r the exact extent of the
 * carved piece as vampkit.js lays it (the smoke measures them). The foot (the turned base's stub) stands
 * upright where it snapped above its bulb; the body sits where it fell just south of it, off its base and
 * tipped onto his right side, his profile (haunches, breast, forelegs, raised tail and half-raised wing)
 * to the room; the head stands on its neck's break and its beak's hook a step on, the beak toward the
 * Turtle, its profile (and its one pearl tear) to the way in; the snapped wing lies open beside the stub.
 */
export const WRECK = f({
  ivory: 0xe9e2cf, // chessmen.js IVORY
  share: 0.65, // drawn in the fittings at this share of the ivory, under the room's grade (round 2, the art critic: 0.82 read pasted in)
  parts: [
    { id: 'foot', x: 2.4, z: -95.6, yaw: 0.5, len: 0, r: 0.6, h: 0.65, solid: true }, // the base's stub, still upright, snapped above its bulb
    { id: 'body', x: 2.45, z: -94.08, yaw: 0, len: 0.992, r: 0.87, h: 1.53, solid: true }, // sat where he fell, tipped onto his right side, facing the south wall: his profile to the room
    { id: 'head', x: 4.9, z: -94.3, yaw: -Math.PI / 2, len: 1.055, r: 0.268, h: 0.98, solid: true }, // on its neck's break and its beak, the beak to the north, the tear to the way in
    { id: 'wing', x: 3.9, z: -95.9, yaw: -0.2, len: 1.383, r: 0.255, h: 0.15, solid: false }, // the right wing, open on the flags beside the stub, its feathers toward the body
  ],
  // chips: [x, z, size (half its extent), yaw, kind] (kind: one of his own carved pieces; none, a flake of ivory)
  chips: [[3.45, -96.3, 0.08, 0.3], [1.5, -96.0, 0.06, 1.1], [4.7, -95.0, 0.08, 2.0, 'beak'], [1.55, -95.0, 0.08, 0.7, 'claw'], [4.4, -96.3, 0.05, 1.6], [4.25, -94.95, 0.18, 2.6, 'plume']],
  scatter: { x: 3.2, z: -94.8, r: 1.1, n: 14 }, // a faint scatter of ivory dust and flecks on the flags round it
});

/** One wreck part's footprint: { minX, maxX, minZ, maxZ }, the exact bounds of its oriented len by 2r rectangle. */
export function wreckFoot(p) {
  const c = Math.abs(Math.cos(p.yaw)); const s = Math.abs(Math.sin(p.yaw));
  const hx = c * p.len / 2 + s * p.r; const hz = s * p.len / 2 + c * p.r;
  if (!p.len) return { minX: p.x - p.r, maxX: p.x + p.r, minZ: p.z - p.r, maxZ: p.z + p.r }; // a round stub
  return { minX: p.x - hx, maxX: p.x + hx, minZ: p.z - hz, maxZ: p.z + hz };
}

/** The wreck's solid pieces as collision boxes (solids.js): { id, minX, maxX, minZ, maxZ, h }. */
export function wreckBoxes() {
  return WRECK.parts.filter((p) => p.solid).map((p) => ({ id: `wreck-${p.id}`, ...wreckFoot(p), h: p.h }));
}

// ---- upstairs (R10, R11, R13) -------------------------------------------------------------

export const MIRROR_ROOM = f({
  table: aabb(19.2, 20.8, -142.6, -141.4, 0.8, 'table'),
  saltBox: { x: 20, z: -141.2 },
  figureMirror: { x: 3.3, z: -137, yaw: -Math.PI / 2 },
  portraits: [{ x: 8, z: -132.1 }, { x: 18, z: -132.1 }, { x: 22.9, z: -137 }],
});

/** The five pieces of jumpy furniture, three places each: none within a doorway (haunts.js picks). */
export const FURNITURE = f([
  { id: 'chairA', kind: 'chair', places: [{ x: 7, z: -135, yaw: 0.4 }, { x: 17, z: -135.5, yaw: 2.2 }, { x: 9, z: -143.5, yaw: -1 }] },
  { id: 'chairB', kind: 'chair', places: [{ x: 6, z: -144, yaw: 1.2 }, { x: 16.5, z: -143.5, yaw: -2.6 }, { x: 21, z: -134.5, yaw: 3 }] },
  { id: 'cabinet', kind: 'cabinet', places: [{ x: 4.2, z: -134, yaw: 1.57 }, { x: 22.2, z: -138, yaw: -1.57 }, { x: 10, z: -132.9, yaw: 0 }] },
  { id: 'wardrobe', kind: 'wardrobe', places: [{ x: 22.2, z: -145, yaw: -1.57 }, { x: 4.2, z: -138.5, yaw: 1.57 }, { x: 17, z: -132.9, yaw: 0 }] },
  { id: 'settle', kind: 'settle', places: [{ x: 9, z: -139, yaw: 0 }, { x: 15, z: -139.5, yaw: 3.14 }, { x: 8, z: -144.6, yaw: 3.14 }] },
]);

export const NURSERY = f({
  cot: aabb(-8.5, -6.5, -157, -155, 0.9, 'cot'),
  bundle: { x: -7.5, z: -155.3 }, // six stakes in the cot, at its near edge; a crossbow under it if none is carried
  horse: { x: -13, z: -152 },
  musicBox: { x: -14.6, z: -158.4 },
  sheets: [{ x: -5, z: -151 }, { x: -12, z: -157.5 }],
  window: { x: -16, z: -154 },
});

/**
 * The Count's room (R14): the box in the middle, three curtained windows in the east wall.
 * Curtains by way (count.js CURTAIN_WAYS): 0 the tangled cord, 1 the padlocked bar, 2 the three
 * nails in the hem. The cord's is the middle window, square on the box (issue #7): it is the last
 * to open, and its shaft is the one that falls on him. The padlock's is the window nearest the
 * door, the nails' the far one. perch: where the raven sits to point at each way (keepcast.js),
 * y above the room's floor.
 */
export const COUNT_ROOM = f({
  rect: R(1, 25, -171, -151),
  box: aabb(12.4, 13.6, -162.2, -159.8, 0.9, 'earthBox'),
  boxAt: { x: 13, z: -161 },
  curtains: [
    { x: 24.7, z: -161, way: 'cord', middle: true, cord: { x: 24.2, z: -159.6 }, perch: { x: 24.2, y: 1.75, z: -159.6 } },
    { x: 24.7, z: -156, way: 'lock', lock: { x: 24.6, y: 1.4, z: -156 }, perch: { x: 24.45, y: 1.47, z: -155.6 } },
    { x: 24.7, z: -166, way: 'nails', nails: [{ x: 24.6, y: 0.35, z: -165.4 }, { x: 24.6, y: 0.35, z: -166 }, { x: 24.6, y: 0.35, z: -166.6 }], perch: { x: 24.4, y: 0.52, z: -166.9 } },
  ],
});

/** The middle curtain's index (the last to open, issue #7). */
export const MIDDLE_CURTAIN = COUNT_ROOM.curtains.findIndex((c) => c.middle);

/** The card tacked up in the passage to the Count's door (read: curtainNote, issue #8), on its west wall. */
export const COUNTWAY = f({ note: { x: 12.05, y: 1.5, z: -148.5 } });

/** Rooms with windows creatures pass now and then (G10), by zone. */
export const WINDOWS = f({
  tea: [{ x: 32, z: -27.2 }, { x: 32, z: -36.8 }],
  gallery: GALLERY_PROPS.windows,
  walk: [BOARD.window],
  nursery: [NURSERY.window],
});

// ---- things to pick up (R19: hidden good items sit in plain sight, with no trail) -------------

/** Walk-over pads (pickups.js), all on single-floor ground: tonics and salt. */
export const PADS = f([
  { stage: 1, x: 3.4, z: -5.5, kind: 'health', at: 'curtain' }, // behind the hall's curtain
  { stage: 2, x: 13.7, z: -38.3, kind: 'ammo', at: 'drawer' }, // in the sideboard drawer
  { stage: 4, x: 22.5, z: -95, kind: 'health', at: 'southMargin' },
  { stage: 4, x: 3.5, z: -115, kind: 'health', at: 'northMargin' },
]);

/**
 * Things E takes (keep.js). level: the floor it lies on where two floors share the plan
 * ('crypt', or 'upper' for the gallery floor), so it cannot be taken from the other one.
 * garlic: the braid (one garlic). health: a tonic (share: of the tonic's amount, 1 if absent).
 * crossbow: only for a warden without one.
 */
export const LOOT = f([
  { key: 'braid', kind: 'garlic', gives: 1, x: HALL.braid.x, z: HALL.braid.z, stage: 1 },
  { key: 'cryptTonic', kind: 'health', x: CRYPT_PROPS.underStair.x, z: CRYPT_PROPS.underStair.z, stage: 3, level: 'crypt' },
  { key: 'nunTonic', kind: 'health', share: 0.5, x: CRYPT_PROPS.nunTonic.x, z: CRYPT_PROPS.nunTonic.z, stage: 3, level: 'crypt' },
  { key: 'pedestal', kind: 'health', x: GALLERY_PROPS.pedestal.x, z: GALLERY_PROPS.pedestal.z, stage: 3, level: 'upper' },
  { key: 'crossbow', kind: 'crossbow', x: NURSERY.bundle.x, z: NURSERY.bundle.z, stage: 5, missing: true },
]);

/** The two upstairs stocks (R11, R13): restocked on every death. */
export const STOCK = f({
  salt: { x: MIRROR_ROOM.saltBox.x, z: MIRROR_ROOM.saltBox.z },
  stakes: { x: NURSERY.bundle.x, z: NURSERY.bundle.z },
});

/**
 * The places haunts.js reads (its header): the furniture, the mirror room's doorways, the strip
 * before the figure-mirror, the rocking horse, the tall figure's spot, and the raven's perches by
 * zone ({ id, x, y, z }). The board's perches are its squares (the ladder lands it there).
 */
export const HAUNT_PLACES = f({
  furniture: FURNITURE,
  doors: [R(11.5, 14.5, -133.5, -131), R(2, 4.5, -142.5, -139.5), R(11.5, 14.5, -147, -144.5)],
  mirror: R(3, 6, -139, -135),
  horse: NURSERY.horse,
  tall: GALLERY_PROPS.tall,
  raven: {
    tea: TEA.ravenPerches.map((p) => ({ id: p.on, x: p.x, y: p.y, z: p.z })), // lights: real clock-top heights
    count: [{ id: 'cord', x: COUNT_ROOM.curtains[MIDDLE_CURTAIN].cord.x, y: 2.4, z: COUNT_ROOM.curtains[MIDDLE_CURTAIN].cord.z }], // count: the cord moved to the middle window
  },
});

/** The Count's room's shot targets for count.js shotsAtCurtains: the padlock and the three nails. */
export const CURTAIN_TARGETS = f({
  lock: COUNT_ROOM.curtains[1].lock,
  nails: COUNT_ROOM.curtains[2].nails,
});

/**
 * The drawbridge's two lifting piers, standing in the pit either side of the deck at its castle
 * end, and the five hearths that stand 0.7 m out from their walls (castle.js draws them there;
 * the gallery's at z -53.4 on the entrance apron, clear of the tile field and of the crypt stair's
 * mouth). The tea room's is TEA.fireplace.
 */
export const PIERS = f([aabb(-3.6, -2.6, 14, 15, 7, 'pier'), aabb(2.6, 3.6, 14, 15, 7, 'pier')]);
export const HEARTHS = f({
  hall: aabb(-4, -3.3, -7.3, -5.3, 2, 'hearth'),
  // On the gallery's floor (floor: 'upper', so never a box in the crypt below), and shallow, so the way onto the crypt stair's landing stays 1 m wide.
  gallery: { ...aabb(-0.3, 0, -54, -52.8, 2, 'hearth'), floor: 'upper' },
  mirror: aabb(16.8, 19.2, -146, -145.3, 2.3, 'hearth'),
  nursery: aabb(-4.7, -4, -155.9, -154.1, 1.9, 'hearth'),
  count: aabb(1, 1.7, -162.5, -159.5, 2.5, 'hearth'),
});

/** Every solid prop that is not a wall: the cover, the tea room's table, fireplace and sideboard, upstairs. */
export function keepProps() {
  return [...COVER, ...PIERS, ...Object.values(HEARTHS), TEA.table, TEA.fireplace, TEA.sideboard, MIRROR_ROOM.table, NURSERY.cot, COUNT_ROOM.box];
}

// ---- what hangs on the walls (issue #12) ----------------------------------------------------

/** The size each kind of picture is hung at (keepcast.js reads these), and a corridor banner's width (castle.js). */
export const WALL_ART = f({
  portrait: { w: 1.25, h: 1.7 }, // the gallery's sitters
  mirrorPortrait: { w: 1.15, h: 1.55 },
  wives: { w: 2.5, h: 1.6 },
  werewolf: { w: 1.5, h: 2.1 },
  banner: { w: 1.4 }, // the iron rail it hangs from
});

/** Every picture and banner on a wall: { id, x, z, w }. No footprint may stand in a doorway (tests/wallart.test.js). */
export function wallArt() {
  return [
    ...GALLERY_PROPS.portraits.map((p, i) => ({ id: `gallery-${i}`, x: p.x, z: p.z, w: WALL_ART.portrait.w })),
    ...MIRROR_ROOM.portraits.map((p, i) => ({ id: `mirror-${i}`, x: p.x, z: p.z, w: WALL_ART.mirrorPortrait.w })),
    { id: 'wives', x: CORRIDOR.painting.x, z: CORRIDOR.painting.z, w: WALL_ART.wives.w },
    { id: 'werewolf', x: TEA.werewolf.x, z: TEA.werewolf.z, w: WALL_ART.werewolf.w },
    ...CORRIDOR.banners.map((b, i) => ({ id: `banner-${i}`, x: b.x, z: b.z, w: WALL_ART.banner.w })),
  ];
}
