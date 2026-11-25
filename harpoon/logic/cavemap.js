// The cave's shape. Open space is a scalar field: a smooth union of round rooms and winding
// tunnels, roughened by noise, so no wall is straight and no corner is square. The field is
// sampled once onto a fine grid; collision boxes (caveconfig.js) and the rock the engine draws
// (engine/cave.js) both come from it. Pure and deterministic: no Math.random, no DOM.

// ---- deterministic value noise ------------------------------------------------------------
function hash3(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);

/** Smooth 3D value noise in [-1, 1]. */
export function noise3(x, y, z) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const u = fade(x - i);
  const v = fade(y - j);
  const w = fade(z - k);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (di, dj, dk) => hash3(i + di, j + dj, k + dk);
  const n = l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
  return n * 2 - 1;
}
export const noise2 = (x, z) => noise3(x, 7.31, z);

// ---- layout -------------------------------------------------------------------------------
// The path runs along -Z from the spawn. kind: chamber | passage. chamber: index of the chamber
// the space belongs to (a passage belongs to the chamber it leaves). ceiling: metres.
export const SPACE_DEFS = [
  { name: 'throat', kind: 'chamber', chamber: 0, ceiling: 4.5 },
  { name: 'passage1', kind: 'passage', chamber: 0, ceiling: 3 },
  { name: 'hatchery', kind: 'chamber', chamber: 1, ceiling: 5.5 },
  { name: 'passage2', kind: 'passage', chamber: 1, ceiling: 3 },
  { name: 'nave', kind: 'chamber', chamber: 2, ceiling: 7 },
];

const circle = (space, x, z, r) => ({ space, r, pts: [[x, z]] });
const tunnel = (space, r, pts) => ({ space, r, pts });

// Rooms are a few overlapping rounds; tunnels are fat polylines that wind between them.
const SHAPES = [
  // Throat
  circle(0, -1.5, -5.5, 6.3), circle(0, 2.2, -10.2, 5.8), circle(0, -2.6, -11.8, 4.3), circle(0, 3.6, -3.6, 4.2),
  tunnel(1, 2.0, [[0, -14.5], [0, -19.5], [0.8, -21.8], [3.4, -23.6], [6.6, -24.6], [8.2, -26.2], [8.5, -28], [8.5, -31.5]]),
  // Hatchery
  circle(2, 0, -38.5, 9.3), circle(2, 6, -34.3, 5.2), circle(2, -6.3, -33.5, 5.0), circle(2, -6, -41.8, 5.2),
  circle(2, 5.5, -43, 5.0),
  tunnel(3, 2.0, [[-8.5, -44.5], [-8.5, -49.8], [-7.6, -52.2], [-4.6, -53.9], [-1.6, -54.8], [-0.2, -56.3], [0, -58], [0, -61.5]]),
  // Nave
  circle(4, 0, -72.5, 12.8), circle(4, -5, -67, 7.6), circle(4, 6, -68, 7), circle(4, 5, -79.5, 8),
  circle(4, -6.5, -78.5, 7.6),
];

// Noise-free pockets cut after the roughening: the ledge alcoves, which must hold a Weeper.
const POCKETS = [
  circle(2, -11.5, -31.6, 1.9),
  circle(2, 11.2, -37.5, 1.9),
];

function shapeValue(s, x, z) {
  const p = s.pts;
  if (p.length === 1) return s.r - Math.hypot(x - p[0][0], z - p[0][1]);
  let best = Infinity;
  for (let i = 0; i < p.length - 1; i++) {
    const ax = p[i][0];
    const az = p[i][1];
    const bx = p[i + 1][0] - ax;
    const bz = p[i + 1][1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz)));
    const d = Math.hypot(x - ax - bx * t, z - az - bz * t);
    if (d < best) best = d;
  }
  return s.r - best;
}

const BLEND = 2.0; // metres over which neighbouring shapes melt into each other
function smax(a, b) {
  const h = Math.max(BLEND - Math.abs(a - b), 0) / BLEND;
  return Math.max(a, b) + h * h * BLEND * 0.25;
}

/**
 * Distance-like field: positive inside the cave, about metres from the rock face, negative in
 * rock. The rock face the engine draws is the zero line.
 */
export function caveField(x, z) {
  let f = -Infinity;
  for (const s of SHAPES) f = f === -Infinity ? shapeValue(s, x, z) : smax(f, shapeValue(s, x, z));
  f += 0.45 * noise2(x / 3.1, z / 3.1) + 0.2 * noise2(x / 1.1 + 17, z / 1.1 - 5);
  for (const s of POCKETS) f = Math.max(f, shapeValue(s, x, z));
  return f;
}

/** Index into SPACE_DEFS of the space that owns (x, z): the shape the point sits deepest in. */
export function spaceIndexAt(x, z) {
  let best = -Infinity;
  let at = 0;
  for (const s of SHAPES) {
    const v = shapeValue(s, x, z);
    if (v > best) { best = v; at = s.space; }
  }
  return at;
}

/** Ceiling height at (x, z): the owning spaces' heights, blended where they meet. */
export function ceilingAt(x, z) {
  let sum = 0;
  let wsum = 0;
  for (const s of SHAPES) {
    const w = Math.exp(Math.max(-30, Math.min(8, shapeValue(s, x, z) * 1.4)));
    sum += w * SPACE_DEFS[s.space].ceiling;
    wsum += w;
  }
  return sum / wsum;
}

// ---- the sampled grid ---------------------------------------------------------------------
export const CELL = 0.25; // collision cell
export const WALK_MARGIN = 0.3; // walkable space stops this far short of the rock face
export const BOUNDS = { minX: -18, maxX: 18, minZ: -92, maxZ: 4 };
const NX = Math.round((BOUNDS.maxX - BOUNDS.minX) / CELL);
const NZ = Math.round((BOUNDS.maxZ - BOUNDS.minZ) / CELL);

const open = new Uint8Array(NX * NZ);
const owner = new Uint8Array(NX * NZ);
for (let j = 0; j < NZ; j++) {
  const z = BOUNDS.minZ + (j + 0.5) * CELL;
  for (let i = 0; i < NX; i++) {
    const x = BOUNDS.minX + (i + 0.5) * CELL;
    const f = caveField(x, z);
    if (f > -2) owner[j * NX + i] = spaceIndexAt(x, z);
    if (f > WALK_MARGIN) open[j * NX + i] = 1;
  }
}

/** True when the collision cell holding (x, z) is walkable. */
export function isOpen(x, z) {
  const i = Math.floor((x - BOUNDS.minX) / CELL);
  const j = Math.floor((z - BOUNDS.minZ) / CELL);
  return i >= 0 && i < NX && j >= 0 && j < NZ && open[j * NX + i] === 1;
}

// near[c]: an open cell lies within `band` metres (square neighbourhood).
function dilate(band) {
  const k = Math.round(band / CELL);
  const rowHit = new Uint8Array(NX * NZ);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      let hit = 0;
      for (let a = Math.max(0, i - k); a <= Math.min(NX - 1, i + k) && !hit; a++) hit = open[j * NX + a];
      rowHit[j * NX + i] = hit;
    }
  }
  const out = new Uint8Array(NX * NZ);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      let hit = 0;
      for (let b = Math.max(0, j - k); b <= Math.min(NZ - 1, j + k) && !hit; b++) hit = rowHit[b * NX + i];
      out[j * NX + i] = hit;
    }
  }
  return out;
}

/**
 * Covers every cell where pred(cellIndex) holds with boxes: one per run of cells in a row,
 * joined to the identical run in the rows after it. make(minX, maxX, minZ, maxZ) builds a box.
 */
function rowBoxes(pred, make) {
  const boxes = [];
  let active = new Map(); // "i0:i1" -> j0
  const close = (key, j0, j1) => {
    const [i0, i1] = key.split(':').map(Number);
    boxes.push(make(
      BOUNDS.minX + i0 * CELL, BOUNDS.minX + i1 * CELL,
      BOUNDS.minZ + j0 * CELL, BOUNDS.minZ + j1 * CELL,
    ));
  };
  for (let j = 0; j <= NZ; j++) {
    const runs = new Set();
    if (j < NZ) {
      let i = 0;
      while (i < NX) {
        if (!pred(j * NX + i)) { i++; continue; }
        const i0 = i;
        while (i < NX && pred(j * NX + i)) i++;
        runs.add(`${i0}:${i}`);
      }
    }
    const next = new Map();
    for (const [key, j0] of active) {
      if (runs.has(key)) next.set(key, j0);
      else close(key, j0, j);
    }
    for (const key of runs) if (!next.has(key)) next.set(key, j);
    active = next;
  }
  return boxes;
}

/** The solid band of rock, `band` metres thick, around all walkable space. */
export function wallBoxes(band, make) {
  const near = dilate(band);
  return rowBoxes((c) => !open[c] && near[c] === 1, make);
}

/** Lids over space `index` (walkable cells and the rock band around them). */
export function ceilingBoxes(index, band, make) {
  const near = dilate(band);
  return rowBoxes((c) => near[c] === 1 && owner[c] === index, make);
}

/** Bounding rectangle of the walkable cells of space `index`. */
export function spaceBounds(index) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      if (!open[j * NX + i] || owner[j * NX + i] !== index) continue;
      minX = Math.min(minX, i); maxX = Math.max(maxX, i + 1);
      minZ = Math.min(minZ, j); maxZ = Math.max(maxZ, j + 1);
    }
  }
  return {
    minX: BOUNDS.minX + minX * CELL, maxX: BOUNDS.minX + maxX * CELL,
    minZ: BOUNDS.minZ + minZ * CELL, maxZ: BOUNDS.minZ + maxZ * CELL,
  };
}

/** The walkable stretch of the tunnel crossing z at x0, over a slab `t` thick: { minX, maxX }. */
export function mouthAt(x0, z, t) {
  let minX = Infinity;
  let maxX = -Infinity;
  const j0 = Math.floor((z - t / 2 - BOUNDS.minZ) / CELL);
  const j1 = Math.floor((z + t / 2 - 1e-9 - BOUNDS.minZ) / CELL);
  const i0 = Math.floor((x0 - BOUNDS.minX) / CELL);
  for (let j = j0; j <= j1; j++) {
    if (!open[j * NX + i0]) continue;
    let a = i0;
    let b = i0;
    while (a > 0 && open[j * NX + a - 1]) a--;
    while (b < NX - 1 && open[j * NX + b + 1]) b++;
    minX = Math.min(minX, BOUNDS.minX + a * CELL);
    maxX = Math.max(maxX, BOUNDS.minX + (b + 1) * CELL);
  }
  return { minX, maxX };
}

/**
 * Walks from (x, z) along (dx, dz) and returns the last point that still has `clear` metres of
 * field under it: a spot by the wall in that direction.
 */
export function towardWall(x, z, dx, dz, clear) {
  const len = Math.hypot(dx, dz);
  let px = x;
  let pz = z;
  for (let d = 0; d < 40; d += 0.1) {
    const nx = x + (dx / len) * d;
    const nz = z + (dz / len) * d;
    if (caveField(nx, nz) < clear) break;
    px = nx;
    pz = nz;
  }
  return { x: Math.round(px * 100) / 100, z: Math.round(pz * 100) / 100 };
}

// ---- standing water -----------------------------------------------------------------------
// The pools sit in shallow bowls in the floor; the shore is wherever the rock dips under the
// water line, so no pool is a circle. Placed here (pure) so the rules hear what the engine draws.

/** Seed of the cave's dressing generator; pool placement is its first consumer. */
export const CAVE_SEED = 0xca7e5eed;
/** Bowl value above which the floor is under water (the threshold the drips use). */
export const SHORE = 0.45;
/** The Nave keeps one wide sheet of water at its centre. */
const NAVE_SHEET = { x: 0.5, z: -72.5, r: 4.4 };

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Places the standing pools: rejection sampling per chamber space, drawing from rng (three
 * draws per try), clear of other pools, pads and rock columns. Returns [{ x, z, r, chamber }],
 * the Nave sheet last. Needs spaces (with bounds), pads and boxes; reads nothing else, so it
 * can run while the cave config is being built and again against the engine's own generator.
 */
export function placePools(rng, { spaces, pads, boxes }) {
  const rr = (a, b) => a + rng() * (b - a);
  const pools = [];
  const clearOf = (x, z, list, d) => list.every((q) => Math.hypot(q.x - x, q.z - z) > d + (q.r || 0));
  const columns = boxes.filter((b) => b.kind === 'pillar' || b.kind === 'lowPillar');
  for (const s of spaces) {
    if (s.kind !== 'chamber') continue;
    const area = (s.maxX - s.minX) * (s.maxZ - s.minZ);
    const want = 2 + Math.floor(area / 130);
    for (let tries = 0, made = 0; tries < 400 && made < want; tries++) {
      const r = rr(1.1, 2.5);
      const x = rr(s.minX, s.maxX);
      const z = rr(s.minZ, s.maxZ);
      if (caveField(x, z) < r + 1.0 || spaces[spaceIndexAt(x, z)] !== s) continue;
      if (!clearOf(x, z, pools, r + 1.5) || !clearOf(x, z, pads, r + 1) || !clearOf(x, z, columns, r + 1.2)) continue;
      pools.push({ x, z, r, chamber: s.chamber });
      made++;
    }
  }
  pools.push({ ...NAVE_SHEET, chamber: spaces[spaceIndexAt(NAVE_SHEET.x, NAVE_SHEET.z)].chamber });
  return pools;
}

/** How far under water (x, z) is, 0 to 1, over pools [{ x, z, r }]; wet above SHORE. */
export function bowlAt(pools, x, z) {
  let b = 0;
  for (const q of pools) {
    const d = Math.hypot(x - q.x, z - q.z) / q.r;
    if (d > 1.4) continue;
    b = Math.max(b, smoothstep(1, 0.5, d + 0.28 * noise2(x * 0.8 + 3, z * 0.8)));
  }
  return b;
}
