// The shape of the Rose Court level as data: the court (hedges, beds, rills, valves, props,
// notes, loot, pads), the frozen forest maze (bands, cells, wall bits, the twelve dead ends,
// four glades and gates), the stream, the pit and the approach. North is negative z.
// Positions only; every balance number lives in courtconfig.js.

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};

/** Axis-aligned box in the shape cfg.boxes uses everywhere. */
export function aabb(minX, maxX, minZ, maxZ, maxY, kind, minY = 0) {
  return {
    kind,
    x: (minX + maxX) / 2, z: (minZ + maxZ) / 2,
    w: maxX - minX, d: maxZ - minZ, h: maxY - minY,
    minX, maxX, minY, maxY, minZ, maxZ,
  };
}

// ---- the maze ---------------------------------------------------------------------------
// 7 cells wide, 20 deep, 8 m cells: x from -28 to 28, z from -24 to -184. Row 0 is nearest the
// court; row 19 is the approach. Each cell is one hex digit of wall bits. A seeded depth-first
// carve was run once (seed 2), every dead end beyond the twelve the brief lists was opened into
// a loop inside its own band, and the result is frozen here; tests/courtmap.test.js checks it.

export const WALL = f({ N: 1, E: 2, S: 4, W: 8 }); // N: toward -z (away from the court)

const CELL = 8;
const COLS = 7;
const ROWS = 20;
const X0 = -28;
const Z0 = -24;

const BITS = [
  'c7c3c6e', '85153aa', '846ec3a', 'b839153', 'eac5546',
  '8397c3a', '956c152', 'c692c6a', 'b953903', 'ec54506',
  'a96953a', '8504542', 'ac2953a', 'b92d553', 'c6ac556',
  '83a96ea', 'ac15383', '816c696', '95103d3', 'c440446',
].map((row) => [...row].map((ch) => parseInt(ch, 16)));

/** Centre of cell (row, col). */
export function cellCentre(row, col) {
  return { x: X0 + CELL * col + CELL / 2, z: Z0 - CELL * row - CELL / 2 };
}

/** Row and column under (x, z), or -1 outside the grid. */
export function rowAt(z) {
  const r = Math.floor((Z0 - z) / CELL);
  return r >= 0 && r < ROWS ? r : -1;
}
export function colAt(x) {
  const c = Math.floor((x - X0) / CELL);
  return c >= 0 && c < COLS ? c : -1;
}

/** Corridor width in row r: 5.6 m at the start, narrowing to 2.7 m by the second gate (row 8). */
export function corridor(row) {
  return 5.6 - 2.9 * Math.min(1, Math.max(0, row) / 8);
}

const BAND_ROWS = [[0, 3], [4, 8], [9, 13], [14, 18]];
const GLADE_COLS = [[1, 2], [4, 5], [1, 2], [3, 4]];
const GATE_COL = [1, 5, 2, 3];
const OPEN_COL = [3, 1, 5, 2];

function gladeOf(b) {
  const [, r1] = BAND_ROWS[b];
  const [c0, c1] = GLADE_COLS[b];
  const minX = X0 + CELL * c0;
  const maxX = X0 + CELL * (c1 + 1);
  const maxZ = Z0 - CELL * (r1 - 1);
  const minZ = Z0 - CELL * (r1 + 1);
  return { cols: [c0, c1], rows: [r1 - 1, r1], minX, maxX, minZ, maxZ, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}

function gateOf(b) {
  const [, r1] = BAND_ROWS[b];
  return { col: GATE_COL[b], x: cellCentre(r1, GATE_COL[b]).x, z: Z0 - CELL * (r1 + 1) };
}

// What each dead end holds, by band (R18): exactly twelve.
const DEAD_ENDS = [
  { band: 1, row: 0, col: 1, holds: 'garlic' },
  { band: 1, row: 0, col: 6, holds: 'health' },
  { band: 1, row: 2, col: 3, holds: 'carrot' },
  { band: 1, row: 3, col: 0, holds: 'stakes' },
  { band: 2, row: 4, col: 0, holds: 'salt' },
  { band: 2, row: 5, col: 3, holds: 'pit' },
  { band: 2, row: 8, col: 0, holds: 'garlic' },
  { band: 3, row: 9, col: 0, holds: 'stakes' },
  { band: 3, row: 13, col: 0, holds: 'empty' },
  { band: 3, row: 13, col: 3, holds: 'shaft' },
  { band: 4, row: 15, col: 5, holds: 'cup' },
  { band: 4, row: 18, col: 5, holds: 'health' },
];

function exitOf(row, col) {
  const b = BITS[row][col];
  if (!(b & WALL.N)) return { x: 0, z: -1 };
  if (!(b & WALL.S)) return { x: 0, z: 1 };
  if (!(b & WALL.E)) return { x: 1, z: 0 };
  return { x: -1, z: 0 };
}

const DEAD = DEAD_ENDS.map((d) => ({ ...d, ...cellCentre(d.row, d.col), exit: exitOf(d.row, d.col) }));
const deadAt = (holds, band) => DEAD.find((d) => d.holds === holds && d.band === band);

// The glades' furniture (positions only; the creatures' numbers are in courtconfig.js).
const GLADES = [0, 1, 2, 3].map((b) => ({ band: b + 1, ...gladeOf(b), gate: gateOf(b) }));
// The Rabbit sits at the head of his table on the far (east) side of his glade, 9 m or more
// from the one way in (R15); the bowl end of the table is toward the warden and out of reach.
const RABBIT = {
  chair: { x: -6.5, z: -47 },
  table: aabb(-12.8, -7.2, -47.7, -46.3, 0.8, 'table'),
  bowl: { x: -12.4, z: -47 },
  card: { x: -12.6, z: -48.1 },
};
// The Hatter's glade (R17): eight pieces of cover spread across it, so one is within 4 m of
// anywhere in the glade and three stand over 8 m from his start; he starts and stands in the
// gate half. His display (R19) is by the gate: five pegs on a rail running west from it, the
// stand with its shelf of five hats further along the north hedge, and the card on the stand.
const HATTER = {
  home: { x: 12, z: -91.6 },
  cover: [
    aabb(7.2, 8.4, -84, -82.8, 1.4, 'hatblock'), // the far (south) side: these three over 8 m from his start
    aabb(11.4, 12.6, -84, -82.8, 1.4, 'stump'),
    aabb(15.6, 16.8, -84, -82.8, 1.4, 'hatblock'),
    aabb(9.2, 10.4, -87.6, -86.4, 1.4, 'stump'),
    aabb(14, 15.2, -87.6, -86.4, 1.4, 'stump'),
    aabb(7, 8.2, -90.2, -89, 1.4, 'stump'),
    aabb(11.4, 12.6, -90.2, -89, 1.4, 'table'),
    aabb(16.2, 17.4, -90.2, -89, 1.4, 'hatblock'), // by the way in, clear of the way to the gate
  ],
  // Where he stands between volleys: in the gate half, behind the blocks nearest the gate.
  points: [
    { x: 12, z: -91.6 }, { x: 9.4, z: -91.2 }, { x: 14.6, z: -91.2 }, { x: 7.6, z: -91.4 }, { x: 16.8, z: -91.6 },
  ],
  // The display. hats[i] is shelf place i (the hat index hats.js uses); pegs[0] is by the gate.
  stand: aabb(6.8, 9.8, -93.3, -92.6, 1.1, 'hatstand'),
  hats: [7.2, 7.8, 8.4, 9.0, 9.6].map((x) => ({ x, z: -93, y: 1.25 })),
  pegs: [14, 13.2, 12.4, 11.6, 10.8].map((x) => ({ x, z: -93.1, y: 1.5 })),
  card: { x: 10.2, z: -92.9, y: 1.1 },
};
const BAT = {
  home: { x: -12, z: -127.5 },
  lanterns: [{ x: -14.5, z: -126, y: 3.2, chainY: 4.4 }, { x: -9.5, z: -126, y: 3.2, chainY: 4.4 }, { x: -12, z: -131, y: 3.2, chainY: 4.4 }],
  shaft: { x: deadAt('shaft', 3).x, z: deadAt('shaft', 3).z },
};
const CATERPILLAR = {
  home: { x: 6.5, z: -167 },
  pipe: { x: 5.2, z: -167, y: 1.4 },
};

// The stream crosses band 4 on the cup's row; the approach runs 16 m past row 19.
const CUP = deadAt('cup', 4);
const STREAM = { minX: X0, maxX: -X0, minZ: CUP.z - 1.2, maxZ: CUP.z + 1.2, flow: { x: 1, z: 0 } }; // runs east
// tunnel (#29 G29a): the corridor's half-width, where its mouth opens past the last gate's wall,
// and where its far end is shut (the end line is ten metres in).
const APPROACH = {
  minX: X0, maxX: -X0, minZ: -200, maxZ: Z0 - CELL * 19, endZ: Z0 - CELL * 19 - 12,
  tunnel: f({ half: 2.0, mouthZ: Z0 - CELL * 19 - 2.6, shutZ: Z0 - CELL * 19 - 19.6 }),
};
const PIT_DE = deadAt('pit', 2);
const PIT = { x: PIT_DE.x, z: PIT_DE.z, r: 2.4, depth: 1.8, trigger: 1.4 };

// A frightened card gardener crouched at each vegetable plot (R11), tucked in at the back of
// the plot's dead end and facing out, so the warden meets the plot first. holds is the plot's
// find (talk.js plotSpeaker), plot its LOOT key. Friendly: never a target (security A6).
const PLOTS = [['garlicWood', 'garlic', 1], ['carrots', 'carrot', 1], ['garlicDeep', 'garlic', 2]];
const PLOT_GARDENERS = PLOTS.map(([plot, holds, band]) => {
  const d = deadAt(holds, band);
  const half = corridor(d.row) / 2;
  const back = Math.min(1.4, half - 0.5);
  const side = Math.min(1.2, half - 0.5);
  const px = d.exit.z;
  const pz = -d.exit.x; // a quarter turn from the way out
  return {
    plot, holds, band,
    x: d.x - d.exit.x * back + px * side,
    z: d.z - d.exit.z * back + pz * side,
    yaw: Math.atan2(-d.exit.x, -d.exit.z), // facing the way out
  };
});

// The note under the tin cup (R24): uncovered when the cup is taken from its stone, and read
// where the cup lay.
const CUP_DE = deadAt('cup', 4);
const CUP_NOTE = { x: CUP_DE.x, z: CUP_DE.z };

// The dying hunter (R20): slumped against the trees in the south-west corner of the crossing
// just outside the Bat's glade, on the way in (the glade's one way in is 4 m north of him).
const HUNTER = { x: -8.9, z: -115.1, yaw: Math.atan2(-1, 1), band: 3 }; // facing into the crossing

/** Where a checkpoint puts the warden: arrival, just past the arch, just past each gate. */
const SPAWNS = [
  { x: 0, z: 16, yaw: 0 },
  { x: 0, z: -25.5, yaw: 0 },
  ...GLADES.map((g) => ({ x: g.gate.x, z: g.gate.z - 1.5, yaw: 0 })),
];

export const MAZE = f({
  cell: CELL, cols: COLS, rows: ROWS, x0: X0, z0: Z0,
  bits: BITS,
  bands: BAND_ROWS.map((rows, b) => ({ band: b + 1, rows, open: { row: rows[0], col: OPEN_COL[b] } })),
  glades: GLADES,
  rabbit: RABBIT,
  hatter: HATTER,
  bat: BAT,
  caterpillar: CATERPILLAR,
  stream: STREAM,
  approach: APPROACH,
  pit: PIT,
  spawns: SPAWNS,
  plots: PLOT_GARDENERS, // the plot gardeners: { plot, holds, band, x, z, yaw }
  hunter: HUNTER,
  cupNote: CUP_NOTE,
});

/** The twelve dead ends: { band, row, col, x, z, holds, exit } with exit the open direction. */
export function deadEnds() {
  return DEAD;
}
f(DEAD);

/** Wall thickness on a row's lines (8 m less the corridor). */
const thick = (row) => CELL - corridor(Math.min(row, ROWS - 1));

function hasWall(row, col, bit) {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS && (BITS[row][col] & bit) !== 0;
}

let BOXES = null;

/**
 * Collision for the wood: one box per wall run. Horizontal runs along each row line are merged
 * across columns; vertical runs along each column line are merged across rows of equal
 * thickness. Every run is extended by half its thickness at both ends so the corners close.
 * Also the approach's walls past row 19.
 */
export function mazeBoxes() {
  if (BOXES) return BOXES;
  const out = [];
  const H = 6;
  // Lines between rows: line k is z = Z0 - CELL * k, between row k - 1 and row k.
  for (let k = 0; k <= ROWS; k++) {
    const z = Z0 - CELL * k;
    const t = thick(Math.min(k, ROWS - 1));
    let start = -1;
    for (let c = 0; c <= COLS; c++) {
      const wall = c < COLS && (hasWall(k, c, WALL.S) || hasWall(k - 1, c, WALL.N));
      if (wall && start < 0) start = c;
      if (!wall && start >= 0) {
        out.push(aabb(X0 + CELL * start - t / 2, X0 + CELL * c + t / 2, z - t / 2, z + t / 2, H, 'trees'));
        start = -1;
      }
    }
  }
  // Lines between columns: line j is x = X0 + CELL * j.
  for (let j = 0; j <= COLS; j++) {
    const x = X0 + CELL * j;
    let start = -1;
    let t0 = 0;
    for (let r = 0; r <= ROWS; r++) {
      const wall = r < ROWS && (hasWall(r, j, WALL.W) || hasWall(r, j - 1, WALL.E));
      const t = r < ROWS ? thick(r) : 0;
      if (start >= 0 && (!wall || t !== t0)) {
        out.push(aabb(x - t0 / 2, x + t0 / 2, Z0 - CELL * r - t0 / 2, Z0 - CELL * start + t0 / 2, H, 'trees'));
        start = -1;
      }
      if (wall && start < 0) { start = r; t0 = t; }
    }
  }
  // The approach: side walls on from row 19 and the far end.
  const t = thick(ROWS - 1);
  out.push(aabb(X0 - t / 2, X0 + t / 2, APPROACH.minZ, APPROACH.maxZ - CELL, H, 'trees'));
  out.push(aabb(-X0 - t / 2, -X0 + t / 2, APPROACH.minZ, APPROACH.maxZ - CELL, H, 'trees'));
  out.push(aabb(X0 - t / 2, -X0 + t / 2, APPROACH.minZ - 2, APPROACH.minZ, H, 'trees'));
  // #29 (G29a): the wood's end is a short tunnel of trees and brambles (engine/tunnel.js), from
  // the last gate on past the end line: thicket either side of it, and its far end shut.
  const T = APPROACH.tunnel;
  // (thicket: forest.js dresses these itself, apart from the wood's walls)
  out.push({ ...aabb(X0 + CELL * 0.4, -T.half, APPROACH.minZ, T.mouthZ, H, 'trees'), thicket: true });
  out.push({ ...aabb(T.half, -X0 - CELL * 0.4, APPROACH.minZ, T.mouthZ, H, 'trees'), thicket: true });
  out.push({ ...aabb(-T.half, T.half, T.shutZ - 1.5, T.shutZ, H, 'trees'), thicket: true });
  BOXES = f(out);
  return BOXES;
}

/** Stage under (x, z): 0 the court (and the neck under the arch), 1 to 4 the bands, 5 the approach. */
export function stageAt(x, z) {
  if (z > Z0) return 0;
  const r = Math.floor((Z0 - z) / CELL);
  if (r >= 19) return 5;
  for (let b = 0; b < BAND_ROWS.length; b++) if (r <= BAND_ROWS[b][1]) return b + 1;
  return 5;
}

const ROUTES = [];

/**
 * The way through band 1 to 4: cell centres from the band's opening cell to its gate cell
 * (inside the glade), through open walls only. Shortest path, found once from the frozen bits.
 */
export function routeOf(band) {
  if (!Number.isInteger(band) || band < 1 || band > 4) return [];
  if (ROUTES[band]) return ROUTES[band];
  const b = band - 1;
  const [r0, r1] = BAND_ROWS[b];
  const start = [r0, OPEN_COL[b]];
  const goal = [r1, GATE_COL[b]];
  const key = (r, c) => r * COLS + c;
  const prev = new Map([[key(...start), null]]);
  const queue = [start];
  const moves = [[WALL.N, 1, 0], [WALL.S, -1, 0], [WALL.E, 0, 1], [WALL.W, 0, -1]];
  while (queue.length) {
    const [r, c] = queue.shift();
    if (r === goal[0] && c === goal[1]) break;
    for (const [bit, dr, dc] of moves) {
      const nr = r + dr;
      const nc = c + dc;
      if (hasWall(r, c, bit) || nr < r0 || nr > r1 || nc < 0 || nc >= COLS || prev.has(key(nr, nc))) continue;
      prev.set(key(nr, nc), [r, c]);
      queue.push([nr, nc]);
    }
  }
  const path = [];
  for (let at = goal; at; at = prev.get(key(...at))) path.unshift(cellCentre(...at));
  ROUTES[band] = f(path);
  return ROUTES[band];
}

/**
 * Ground height at (x, z): zero everywhere but the bramble pit once it has opened (state is
 * sim.waves; state.done.pitOpen). A flat bottom of the pit's depth inside half its radius,
 * then a straight slope up to the rim, which is the walkable way out.
 */
export function floorAt(state, x, z) {
  if (!state || !state.done || !state.done.pitOpen) return 0;
  const d = Math.hypot(x - PIT.x, z - PIT.z);
  if (d >= PIT.r) return 0;
  const inner = PIT.r / 2;
  if (d <= inner) return -PIT.depth;
  return -PIT.depth * (PIT.r - d) / (PIT.r - inner);
}

// ---- the court ---------------------------------------------------------------------------
// x and z from -20 to 20, hedged, crater and spawn at the south, the arch 8 m wide at the
// north. Beds index 0 Clubs (north-west), 1 Hearts (north-east, half painted), 2 Diamonds
// (south-east), 3 Spades (south-west). Valve i stands at bed i's inner corner and feeds the
// next bed clockwise down rill i; three valves slam one other valve shut (see roses.js).

const SUITS = ['clubs', 'hearts', 'diamonds', 'spades'];
const BED_AT = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
const RILLS = [
  aabb(-7.2, 7.2, -10.5, -9.5, 2, 'rill'), // 0 north: Clubs valve to Hearts
  aabb(9.5, 10.5, -7.2, 7.2, 2, 'rill'), // 1 east: Hearts valve to Diamonds
  aabb(-7.2, 7.2, 9.5, 10.5, 2, 'rill'), // 2 south: Diamonds valve to Spades
  aabb(-10.5, -9.5, -7.2, 7.2, 2, 'rill'), // 3 west: Spades valve to Clubs
];

const VALVE_AT = BED_AT.map(([x, z]) => ({ x: Math.sign(x) * 6.6, z: Math.sign(z) * 6.6 }));

// Which way the water runs (R4, R7): rill i from valve i's end to the bed it feeds, clockwise;
// the threshold rill under the arch west to east. dir is a unit vector; from and to are the ends.
const run = (fx, fz, tx, tz) => {
  const length = Math.hypot(tx - fx, tz - fz);
  return { from: { x: fx, z: fz }, to: { x: tx, z: tz }, dir: { x: (tx - fx) / length, z: (tz - fz) / length }, length };
};
const FLOWS = [
  run(-7.2, -10, 7.2, -10), // 0 north: Clubs to Hearts, east
  run(10, -7.2, 10, 7.2), // 1 east: Hearts to Diamonds, south
  run(7.2, 10, -7.2, 10), // 2 south: Diamonds to Spades, west
  run(-10, 7.2, -10, -7.2), // 3 west: Spades to Clubs, north
];

export const COURT = f({
  half: 20,
  spawn: SPAWNS[0],
  crater: { x: 5, z: 17.5, r: 1.5 },
  plaza: { x: 0, z: 0, r: 8.5 },
  fountain: { x: 0, z: 0, r: 4.5 },
  suits: SUITS,
  beds: BED_AT.map(([x, z], i) => ({ index: i, suit: SUITS[i], x, z, size: 6, box: aabb(x - 3, x + 3, z - 3, z + 3, 1.1, 'bed') })),
  valves: VALVE_AT.map((p, i) => ({ index: i, bed: i, ...p })),
  rills: RILLS,
  // The arch: closed by the briar until the roses are red; the threshold rill then runs and
  // only monsters see it.
  arch: { x: 0, z: -20, width: 8 },
  briar: aabb(-4, 4, -20.5, -19.5, 3, 'briar'),
  threshold: aabb(-4, 4, -23, -22, 2, 'rill'),
  flows: FLOWS, // flows[i] is rill i's direction of flow
  thresholdFlow: run(-4, -22.5, 4, -22.5),
  boxes: [
    aabb(-21.5, 21.5, 20, 21.5, 3, 'hedge'),
    aabb(20, 21.5, -20, 21.5, 3, 'hedge'),
    aabb(-21.5, -20, -20, 21.5, 3, 'hedge'),
    aabb(-28, -4, -24, -20, 3, 'hedge'),
    aabb(4, 28, -24, -20, 3, 'hedge'),
    ...BED_AT.map(([x, z]) => aabb(x - 3, x + 3, z - 3, z + 3, 1.1, 'bed')),
    aabb(-3.2, 3.2, -3.2, 3.2, 2.8, 'fountain'),
    aabb(-17.4, -15.8, -0.8, 0.8, 2.6, 'throne'),
    aabb(15, 17, 2, 4, 0.8, 'table'),
    aabb(17.2, 18.2, 2.5, 3.5, 1.4, 'chair'),
    aabb(-14.4, -13.6, 13.6, 14.4, 1, 'sundial'),
    aabb(2.25, 2.55, 14.35, 14.65, 2.4, 'signpost'),
    aabb(2.25, 2.55, -14.65, -14.35, 2.4, 'signpost'),
    aabb(14.5, 15.5, -16.5, -15.5, 5, 'tree'),
    aabb(-15.6, -14.4, -16, -14, 0.9, 'earthbox'),
    aabb(-13.1, -11.9, -17, -15, 0.9, 'earthbox'),
    aabb(3.5, 6.5, 16, 19, 0.6, 'crater'),
  ],
  renfield: { x: 17.7, z: 3, table: { x: 16, z: 3 } },
  throne: { x: -16.6, z: 0 },
  // The signposts: the north one points every suit at its own bed (no order); the south one,
  // read from the top, points at the valves in the one order that works, each arm carrying
  // the suit of the bed that turn will redden.
  signposts: {
    north: { x: 2.4, z: -14.5, arms: [0, 1, 2, 3].map((i) => ({ suit: SUITS[i], toward: BED_AT[i] })) },
    south: {
      x: 2.4, z: 14.5,
      arms: [2, 3, 1, 0].map((v) => ({ suit: SUITS[(v + 1) % 4], toward: [VALVE_AT[v].x, VALVE_AT[v].z], valve: v })),
    },
  },
  guards: [{ x: -6, z: -18 }, { x: 6, z: -18 }],
  gardeners: [{ x: 14.5, z: -8 }, { x: 12, z: -14.5 }, { x: 15, z: -13 }],
  // Things worth a note: E adds the entry of the same key, once. `from` limits the side.
  notes: [
    { key: 'boxes', x: -15, z: -13.7 },
    { key: 'sundial', x: -14, z: 13.3 },
    { key: 'signS', x: 2.0, z: 14.5 },
    { key: 'signN', x: 2.0, z: -14.5 },
    { key: 'halfBed', x: 10, z: -13.3 },
    { key: 'watch', x: 15, z: -15.2 },
    { key: 'door', x: -19.6, z: -4 },
    { key: 'chain', x: -2.5, z: -15 },
    { key: 'statue', x: 0, z: -3.5, from: 'north' },
    { key: 'arch', x: 0, z: -19.1, until: 'roses' },
    { key: 'garlic', x: -8, z: 18.6 },
    { key: 'throne', x: -15.5, z: -1 },
  ],
});

/** Loot lying in the world at the start (sim.waves.loot mirrors it with a `taken` flag). */
export const LOOT = f([
  { key: 'crossbow', kind: 'crossbow', x: -15.4, z: 0.3, stage: 0, count: 3 },
  { key: 'lidStake', kind: 'stakes', x: -12.5, z: -14.6, stage: 0, count: 1 },
  { key: 'garlicWood', kind: 'garlic', patch: true, gives: 2, x: deadAt('garlic', 1).x, z: deadAt('garlic', 1).z, stage: 1 },
  { key: 'carrots', kind: 'carrot', patch: true, gives: 1, x: deadAt('carrot', 1).x, z: deadAt('carrot', 1).z, stage: 1 },
  { key: 'stump', kind: 'stakes', x: deadAt('stakes', 1).x, z: deadAt('stakes', 1).z, stage: 1, count: 3 },
  { key: 'garlicDeep', kind: 'garlic', patch: true, gives: 2, x: deadAt('garlic', 2).x, z: deadAt('garlic', 2).z, stage: 2 },
  { key: 'bundle', kind: 'stakes', x: deadAt('stakes', 3).x, z: deadAt('stakes', 3).z, stage: 3, count: 3 },
  { key: 'cup', kind: 'cup', x: CUP.x, z: CUP.z, stage: 4 },
]);

/** Health pads and salt caches: two health and one salt in the court, the dead ends, one past each gate. */
export const PADS = f([
  { stage: 0, x: -17, z: 8, kind: 'health' },
  { stage: 0, x: 17, z: -6, kind: 'health' },
  { stage: 0, x: 17, z: 17, kind: 'ammo' },
  { stage: 1, x: deadAt('health', 1).x, z: deadAt('health', 1).z, kind: 'health' },
  { stage: 2, x: deadAt('salt', 2).x, z: deadAt('salt', 2).z, kind: 'ammo' },
  { stage: 4, x: deadAt('health', 4).x, z: deadAt('health', 4).z, kind: 'health' },
  ...GLADES.map((g) => ({ stage: g.band + 1, x: g.gate.x, z: g.gate.z - 4, kind: 'health' })),
]);

// ---- the glades' ways in and the trails (R14, R15) -----------------------------------------

/**
 * Where the way through band 1 to 4 enters its glade: the middle of the open wall between the
 * last route cell outside the glade and the first inside it. Null for anything but 1 to 4.
 */
export function gladeEntry(band) {
  const route = routeOf(band);
  if (!route.length) return null;
  const g = MAZE.glades[band - 1];
  const inG = (p) => p.x > g.minX && p.x < g.maxX && p.z > g.minZ && p.z < g.maxZ;
  const i = route.findIndex(inG);
  if (i <= 0) return { x: route[0].x, z: route[0].z };
  return { x: (route[i - 1].x + route[i].x) / 2, z: (route[i - 1].z + route[i].z) / 2 };
}

/** Spacing of the trails, in metres along the way (also COURT_CONFIG.trails). */
export const TRAIL_SPACING = f({ petal: 2.5, toadstool: 6 });

/** Points every `step` metres along a polyline, from `start` metres in, ending at its last point. */
function along(pts, step, start) {
  const out = [];
  let need = start;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let t = need;
    while (t <= len) {
      out.push({ x: a.x + ((b.x - a.x) * t) / len, z: a.z + ((b.z - a.z) * t) / len });
      t += step;
    }
    need = t - len;
  }
  return out;
}

/** Cells (row, col) from `from` to `to` inside one band's rows, through open walls (breadth first). */
function cellsBetween(from, to, r0, r1) {
  const key = (r, c) => r * COLS + c;
  const prev = new Map([[key(...from), null]]);
  const queue = [from];
  const moves = [[WALL.N, 1, 0], [WALL.S, -1, 0], [WALL.E, 0, 1], [WALL.W, 0, -1]];
  while (queue.length) {
    const [r, c] = queue.shift();
    if (r === to[0] && c === to[1]) break;
    for (const [bit, dr, dc] of moves) {
      const nr = r + dr;
      const nc = c + dc;
      if (hasWall(r, c, bit) || nr < r0 || nr > r1 || nc < 0 || nc >= COLS || prev.has(key(nr, nc))) continue;
      prev.set(key(nr, nc), [r, c]);
      queue.push([nr, nc]);
    }
  }
  if (!prev.has(key(...to))) return [];
  const out = [];
  for (let at = to; at; at = prev.get(key(...at))) out.unshift(at);
  return out;
}

let MARKS = null;

/**
 * The two trails as data (R14), built once from the frozen maze:
 * petals: per band, white rose petals in clusters (n of 3 to 6, a seed for the scatter) about
 *   every 2.5 m along the way through, from the band's opening to just short of its gate.
 * toadstools: per dead end holding a health pad or a salt cache, pale toadstools about every
 *   6 m from the way through to it (fewer and further apart). Nothing leads to the pit, the
 *   empty dead end, the shaft, or a find (garlic, carrot, stakes, the cup).
 * Each trail is { band, holds, end: { x, z }, marks: [{ x, z, n, seed }] }; holds is 'gate' for
 * a petal trail.
 */
export function trailMarks() {
  if (MARKS) return MARKS;
  const petals = [];
  const toadstools = [];
  for (let band = 1; band <= 4; band++) {
    const route = routeOf(band);
    const g = MAZE.glades[band - 1].gate;
    const end = { x: g.x, z: g.z + 1.2 }; // the gate's near side
    const way = [...route, end];
    const marks = along(way, TRAIL_SPACING.petal, 1).map((p, i) => ({ ...p, n: 3 + ((i * 7 + band * 3) % 4), seed: band * 101 + i }));
    petals.push({ band, holds: 'gate', end, marks });

    const [r0, r1] = BAND_ROWS[band - 1];
    const onWay = new Set(route.map((p) => `${rowAt(p.z)},${colAt(p.x)}`));
    for (const d of DEAD.filter((x) => x.band === band && (x.holds === 'health' || x.holds === 'salt'))) {
      // The nearest cell of the way through, then the cells from there to the dead end.
      let best = [];
      for (const p of route) {
        const cells = cellsBetween([rowAt(p.z), colAt(p.x)], [d.row, d.col], r0, r1);
        if (cells.length && (!best.length || cells.length < best.length)) best = cells;
      }
      const path = best.filter((rc, i) => i === 0 || !onWay.has(`${rc[0]},${rc[1]}`)).map((rc) => cellCentre(...rc));
      const stop = { x: d.x + d.exit.x * 1.2, z: d.z + d.exit.z * 1.2 }; // just short of the find
      const pts = along([...path.slice(0, -1), stop], TRAIL_SPACING.toadstool, TRAIL_SPACING.toadstool / 2);
      if (!pts.length || Math.hypot(pts[pts.length - 1].x - stop.x, pts[pts.length - 1].z - stop.z) > 1) pts.push(stop);
      const marks = pts.map((p, i) => ({ ...p, n: 1 + ((i + band) % 2), seed: band * 211 + d.row * 7 + d.col + i }));
      toadstools.push({ band, holds: d.holds, end: { x: d.x, z: d.z }, marks });
    }
  }
  MARKS = f({ petals, toadstools });
  return MARKS;
}
