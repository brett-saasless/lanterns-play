// The dock's plan as data (docs/features/sea-1-dock/02-design.md, Data): zones, walls and props
// as boxes, floor heights (the quay, the pier, the stage under it, the gangway, the deck), water
// rects, landmarks, every thing E can act on, and each place's mood id. Metres; north is toward
// negative z, as the court and the castle. Positions only: every number that is balance lives in
// dockconfig.js. The pit-under-bridge trick the castle's keepmap.js uses for two floors sharing
// one footprint serves twice here: the stage under the pier (floor -2.4, the pier's planking the
// top), and the Pequod's deck over its own hull footprint (floor 0 at the waterline, the deck
// itself the top, reached by the gangway's ramp) - both resolved by the one shared levelAt
// (levels.js), so there is one answer to "which floor" (security A3, as the castle's).

import { levelAt, STEP_UP } from './levels.js';

export { STEP_UP };

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};
const R = (minX, maxX, minZ, maxZ) => ({ minX, maxX, minZ, maxZ });
const inRect = (r, x, z) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const aabb = (minX, maxX, minZ, maxZ, h, kind) => ({
  kind, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ, h,
  minX, maxX, minY: 0, maxY: h, minZ, maxZ,
});

/** The deck's height above the quay (the Pequod moored alongside the pier's east side). */
export const DECK_Y = 3.2;

// ---- zones (single floor, y 0) -------------------------------------------------------------

export const ZONES = f([
  { id: 'quay', rects: [R(-16, 16, -2, 18)] }, // the wharf and wharf street, merged (budget table)
  { id: 'tavern', rects: [R(-28, -16, -6, 8)] },
  { id: 'pier', rects: [R(-2, 2, -34, -2)] },
]);

/** The one door, between the quay and the tavern: no key - always open (unlike the castle's). */
export const TAVERN_DOOR = f({ rect: R(-16.5, -15.5, 0.5, 3.5), zones: ['quay', 'tavern'] });

/** The stage under the pier: floor -2.4, the pier's planking (0) the top, steps down on the west side. */
export const UNDER_PIER = f({
  id: 'underPier',
  rect: R(-3, 3, -34, -2),
  floor: -2.4,
  top: 0,
  stair: { rect: R(-2.6, -2, -19, -17), axis: 'x', head: -2, dir: -1, landing: 0, run: 0.12, rise: 0.4, treads: 6, top: 0, smooth: true },
  props: [aabb(-1.4, 0.4, -18.6, -17.4, 1.0, 'whaleboat')], // out of reach by hand (R6)
});

/** The gangway's ramp, quay to deck (the one way up): head at the deck end, descending toward the quay. */
export const GANGWAY = f({
  rect: R(4, 6, -6, 0), axis: 'z', head: -6, dir: 1, landing: 0, run: 0.375, rise: 0.2, treads: 16, top: DECK_Y, smooth: true,
});

/** The Pequod's hull footprint and deck: floor 0 (the waterline, solid - nobody reaches it but the ramp), top DECK_Y. */
export const DECK = f({
  id: 'deck',
  rect: R(4, 14, -30, 0),
  floor: 0,
  top: DECK_Y,
  solid: true,
  stair: GANGWAY,
});

/** The two places with a floor below the one everybody else walks: levelAt's entries, in order. */
export const LOWER = f([UNDER_PIER, DECK]);

/** The upper surface's solidity: the pier's planking (always, over the stage); the deck (everywhere but the ramp's own rect). */
function upperSolid(L, x, z) {
  if (L.id === 'underPier') return true;
  return !inRect(GANGWAY.rect, x, z);
}

/**
 * Which floor the warden is on at (x, z) with feet at height y: { under, floor, zone }. under is
 * 'underPier' or 'deck' whenever the warden is inside that footprint below its top (the stage, or
 * the hull's waterline - never reached in play), else null (on the pier's planking, or the deck).
 * zone: the LOWER entry's id while under, else the ZONES id (or null in a wall). Both dockFloor
 * and dockBoxes (dock.js) read this (security A3): one answer, so no event can be missed.
 */
export function floorZoneAt(x, z, y = 0) {
  const r = levelAt(LOWER, x, z, y, STEP_UP, upperSolid);
  if (r) return { under: r.under, floor: r.floor, zone: r.under || r.entry.id };
  return { under: null, floor: 0, zone: zoneAt(x, z) };
}

/** The zone id at (x, z), or null in a wall (also true of a door's rect, which this does not search: see doorAt). */
export function zoneAt(x, z) {
  if (inRect(TAVERN_DOOR.rect, x, z)) return 'tavern';
  for (const zn of ZONES) for (const r of zn.rects) if (inRect(r, x, z)) return zn.id;
  if (inRect(DECK.rect, x, z)) return 'deck';
  return null;
}

// ---- walls (the always-solid list; levels.js's stairs and `props` are added by dock.js) -------

const T = 0.4; // wall thickness

/** Every wall round the plan's single-floor zones, the tavern's doorway left open, and the pier's rails. */
export function dockWalls() {
  return f([
    // the quay: north edge open onto the pier's mouth (x -2.4..2.4) and the gangway's foot (x 4..6),
    // rails either side of them instead; the Pequod's hull stands where the rail's east run would be
    aabb(-16, -2.4, -2.4, -2, 1.1, 'rail'),
    aabb(2.4, 3.6, -2.4, -2, 1.1, 'rail'),
    aabb(14.4, 16, -2.4, -2, 1.1, 'rail'),
    // the tavern: four walls, the doorway cut out of the east one
    aabb(-28.4, -28, -6, 8, 3.2, 'wall'),
    aabb(-28, -16, 7.6, 8, 3.2, 'wall'),
    aabb(-28, -16, -6.4, -6, 3.2, 'wall'),
    aabb(-16.4, -16, -6, TAVERN_DOOR.rect.minZ, 3.2, 'wall'),
    aabb(-16.4, -16, TAVERN_DOOR.rect.maxZ, 8, 3.2, 'wall'),
    // the pier: rails down both long sides (the west one broken where the stair goes down under
    // the planking), and the end rail broken at the contest mark, open to the water (the dunk)
    aabb(-2.4, -2, -34, UNDER_PIER.stair.rect.minZ - STAIR_GAP, 1.1, 'rail'),
    aabb(-2.4, -2, UNDER_PIER.stair.rect.maxZ + STAIR_GAP, -2, 1.1, 'rail'),
    aabb(2, 2.4, -34, -2, 1.1, 'rail'),
    aabb(-2.4, -MARK_GAP, -34.4, -34, 1.1, 'rail'),
    aabb(MARK_GAP, 2.4, -34.4, -34, 1.1, 'rail'),
  ]);
}

/** Half the width of the opening in the pier's end rail at the contest mark (x 0), metres: wider than the warden. */
const MARK_GAP = 1;
// the west rail stops this far short of the stair's sides, so the warden (0.4 m radius) can get round the whaleboat's box to the stair head
const STAIR_GAP = 0.5;

/**
 * The plan's boundary, solid but never drawn (the engine reads dockWalls and dockProps only): the
 * Pequod's hull all round (the deck's bulwarks, and the sides below it) with the gangway's mouth
 * left open and its east edge walled, the quay's east and south edges and its west edge past the
 * tavern, and the stage under the pier. Nowhere else is walkable water: the one way into it is the
 * pier's end at the contest mark, where WATER dunks the warden.
 */
export function dockEdges() {
  const H = DECK_Y;
  return f([
    // the Pequod: west, east, north and south sides; the ramp's east edge (its west edge is the hull's west side)
    aabb(3.6, 4, -30.4, 0, H, 'hull'),
    aabb(14, 14.4, -30.4, 0, H, 'hull'),
    aabb(3.6, 14.4, -30.4, -30, H, 'hull'),
    aabb(GANGWAY.rect.maxX, 14.4, -0.4, 0, H, 'hull'),
    aabb(GANGWAY.rect.maxX, GANGWAY.rect.maxX + 0.4, GANGWAY.rect.minZ, 0, H, 'hull'),
    // the quay: east and south edges, and the west edge below the tavern's door wall
    aabb(16, 16.4, -2.4, 18.4, 1.1, 'edge'),
    aabb(-16.4, 16.4, 18, 18.4, 1.1, 'edge'),
    aabb(-16.4, -16, 8, 18.4, 1.1, 'edge'),
    // the stage under the pier: its sides and its end either side of the opening
    aabb(-3.4, -3, -34.4, -2, 1.1, 'edge'),
    aabb(3, 3.4, -34.4, -2, 1.1, 'edge'),
    aabb(-3.4, -2.4, -34.4, -34, 1.1, 'edge'),
    aabb(2.4, 3.4, -34.4, -34, 1.1, 'edge'),
  ]);
}

/** Props with their own boxes: the knot board, the chandler's window, the mast and its fittings, the try-works, the tiller. */
export function dockProps() {
  return [
    aabb(-14.6, -13.4, 3.4, 4.6, 1.6, 'knotBoard'),
    aabb(-14.8, -13.2, 7.2, 8.8, 1.2, 'chandlerSill'), // P2: dock.js also stands a brass diving helmet on top of this box
    aabb(8.4, 9.6, -15.6, -14.4, 0.4, 'mastBase'),
    aabb(8, 10, -22.8, -21.2, 1.0, 'tryworks'),
    aabb(8.2, 9.8, -3.6, -2.4, 1.1, 'tiller'), // P3: dock.js also sets a compass into its top and a depth gauge on its forward face
    // art critique B4: off the throwing line (the mark is PLACES.contestMark, x 0), so the rack no
    // longer sits dead centre over where the barrels will be framed.
    aabb(-1.8, -0.6, -33.6, -32.4, 1.0, 'harpoonRack'),
  ];
}

// ---- named places (E acts on these; dock.js and the engine read them) -------------------------

export const PLACES = f({
  spawn: { x: 0, z: 16, yaw: 0 },
  gangwayFoot: { x: 5, z: 1 }, // Elijah
  gangwayHead: { x: 6, z: -5 }, // Peleg's wigwam, on deck
  mast: { x: 9, z: -15 },
  tryworks: { x: 9, z: -22 },
  tiller: { x: 9, z: -3 },
  contestMark: { x: 0, z: -33 },
  queequegWait: { x: 0, z: -30 },
  knotBoard: { x: -14, z: 4 },
  chandlerWindow: { x: -14, z: 8 },
  posterWall: { x: -15, z: 1 },
  tavernDoor: { x: -16.2, z: 2 },
  layTicketSpike: { x: -20, z: 2 },
  logBoat: { x: -0.5, z: -18 },
  whaleboatSteps: { x: -2.3, z: -18 },
  burstSpot: { x: 0.5, z: -20 }, // P5: only the scare's starting value, before it is placed off the warden at arming time (dock.js stepScare)
});

/** The four clippings, each a tag E reads (R7). */
export const CLIPPINGS = f([
  { key: 'clipping1', x: -17.3, z: 1 },
  { key: 'clipping2', x: -24, z: -4.6 },
  { key: 'clipping3', x: -22, z: 2 },
  { key: 'clipping4', x: -20.4, z: 1.5 },
]);

/** The knot board's six pegs, named (the right one is the bowline), each on its own peg. */
export const KNOTS = f(['bowline', 'reef', 'sheetbend', 'clove', 'figureeight', 'granny']);

/** Each peg's place, left to right along the board (PLACES.knotBoard). */
export const KNOT_PEGS = f(KNOTS.map((name, i) => ({
  name, x: PLACES.knotBoard.x - 0.75 + i * 0.3, z: PLACES.knotBoard.z,
})));

/** The three lay tickets on the bar's spike (the 300th is right: Melville ch. 16). */
export const LAY_TICKETS = f(['lay90', 'lay300', 'lay777']);

/** Each ticket's place on the spike (PLACES.layTicketSpike). */
export const LAY_SPOTS = f(LAY_TICKETS.map((key, i) => ({
  key, x: PLACES.layTicketSpike.x + i * 0.25, z: PLACES.layTicketSpike.z,
})));

/** Water rects (R8, dunk): the pier's outer edge and the harbour past it, less the pier's own footprint. */
export const WATER = f([
  { minX: -40, maxX: 40, minZ: -60, maxZ: -34 }, // open harbour past the pier's end
  { minX: -2.4, maxX: 2.4, minZ: -34.4, maxZ: -33.6 }, // the sliver either side would be walked round; kept simple
]);

/** True when (x, z) is in a water rect with a 0.35 m stringer allowance at the quay/pier edges (the design's jumpable lip). */
export function inWater(x, z) {
  return WATER.some((r) => inRect(r, x, z));
}

/** Mood id by zone (R11; mood.json carries the records). */
export const MOOD_OF = f({ quay: 'dock', pier: 'dock', underPier: 'pier-scare', tavern: 'tavern', deck: 'pequod-deck' });

/** The place banner's text by zone (UI direction, "places"). */
export const BANNER_OF = f({ quay: 'The Wharf', pier: 'The Wharf', tavern: 'The Spouter-Inn', underPier: 'Under the Pier', deck: 'The Pequod' });
