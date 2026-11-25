// Guard routing over the Rose Court (R9): a 1 m walk grid over the court built from the monster
// blocker list (walls, beds, the fountain and every running rill, so a running rill is a wall),
// a breadth-first route on it, and the flank goal for the second guard.
//
// The grid is derived, never stored (security A3). It is built from the blocker list it is
// given and kept only in a WeakMap keyed by that list, so it lives exactly as long as the list:
// roses.refreshBlockers makes a new list on every start, every valve turn, every gate and every
// checkpoint restore, and the next route asked for after any of them is planned on a fresh
// grid. Nothing about the grid is in sim; a guard holds only its own `path` and `flank`.

import { circleBlocked } from './collide.js';
import { COURT } from './courtmap.js';

const HALF = COURT.half; // the court runs from -20 to 20 on both axes
// Fallbacks only: the cell comes from cfg.paths.cell (1 m: 40 by 40 cells) and the clearance
// from cfg.guard.radius (a cell is open when a guard's body fits at its centre).
const CELL = 1;
const CLEAR = 0.55;

const MOVES = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

const CACHE = new WeakMap(); // blocker list -> its grid (derived: dies with the list)
let serial = 0; // each grid built gets the next number; a guard's path records which it used

/**
 * The walk grid for a blocker list: { n, half, cell, clear, open: Uint8Array(n * n), serial }.
 * open[j * n + i] is 1 when the centre of cell (i, j) is at least `clearance` from every box.
 */
export function buildGrid(boxes, clearance = CLEAR, cell = CELL) {
  const n = Math.round((2 * HALF) / cell);
  const lo = -HALF - clearance;
  const hi = HALF + clearance;
  const near = boxes.filter((b) => b.maxX > lo && b.minX < hi && b.maxZ > lo && b.minZ < hi);
  const open = new Uint8Array(n * n);
  const grid = { n, half: HALF, cell, clear: clearance, open, serial: 0 };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = cellCentre(grid, i, j);
      open[j * n + i] = circleBlocked(c.x, c.z, clearance, near) ? 0 : 1;
    }
  }
  serial += 1;
  grid.serial = serial;
  return grid;
}

/** The cell size and clearance this room's guards walk by: cfg.paths.cell and cfg.guard.radius. */
export function gridSpec(cfg) {
  const cell = cfg && cfg.paths && Number.isFinite(cfg.paths.cell) && cfg.paths.cell > 0 ? cfg.paths.cell : CELL;
  const clear = cfg && cfg.guard && Number.isFinite(cfg.guard.radius) ? cfg.guard.radius : CLEAR;
  return { cell, clear };
}

/**
 * The grid for this court as it is now: built from sim.waves.blockers (the monster list) with
 * gridSpec(sim.cfg) the first time it is asked for after that list (or the spec) changed, then
 * reused until either changes again. Returns null outside the Rose Court.
 */
export function gridFor(sim) {
  const list = sim && sim.waves && sim.waves.blockers;
  if (!Array.isArray(list) || !list.length) return null;
  const { cell, clear } = gridSpec(sim.cfg);
  const had = CACHE.get(list);
  if (had && had.size === list.length && had.grid.cell === cell && had.grid.clear === clear) return had.grid;
  const grid = buildGrid(list, clear, cell);
  CACHE.set(list, { grid, size: list.length });
  return grid;
}

/** Centre of cell (i, j) on grid. */
export function cellCentre(grid, i, j) {
  return { x: -grid.half + (i + 0.5) * grid.cell, z: -grid.half + (j + 0.5) * grid.cell };
}

/** Cell index under (x, z), or -1 off the grid. */
export function cellAt(grid, x, z) {
  const i = Math.floor((x + grid.half) / grid.cell);
  const j = Math.floor((z + grid.half) / grid.cell);
  if (i < 0 || j < 0 || i >= grid.n || j >= grid.n) return -1;
  return j * grid.n + i;
}

export function isOpen(grid, x, z) {
  const k = cellAt(grid, x, z);
  return k >= 0 && grid.open[k] === 1;
}

const centreOf = (grid, k) => cellCentre(grid, k % grid.n, Math.floor(k / grid.n));

/** The open cell nearest (x, z), searched outward ring by ring, or -1 if none within 4 m. */
function nearestOpen(grid, x, z) {
  const k = cellAt(grid, x, z);
  if (k >= 0 && grid.open[k]) return k;
  const ci = Math.max(0, Math.min(grid.n - 1, Math.floor((x + grid.half) / grid.cell)));
  const cj = Math.max(0, Math.min(grid.n - 1, Math.floor((z + grid.half) / grid.cell)));
  let best = -1;
  let bestD = Infinity;
  for (let r = 1; r <= 4 && best < 0; r++) {
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= grid.n || j >= grid.n) continue;
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const q = j * grid.n + i;
        if (!grid.open[q]) continue;
        const c = centreOf(grid, q);
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < bestD) { bestD = d; best = q; }
      }
    }
  }
  return best;
}

/**
 * True when every grid sample along the segment a to b is open (used to straighten a route),
 * and none falls inside the avoided disc ({x, z, r}) when one is given.
 */
export function clearLine(grid, a, b, avoid = null) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(len / (grid.cell * 0.25)));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (!isOpen(grid, x, z)) return false;
    if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < avoid.r) return false;
  }
  return true;
}

/**
 * A breadth-first route on grid from `from` to `to` ({x, z} each): eight neighbours, no corner
 * cutting past a blocked cell. Returns { points, reached }: points are the way to walk (cell
 * centres, straightened where the line between them is clear), ending at the goal's cell when
 * it can be reached (reached: true). When it cannot (the goal is in a wall, such as the warden
 * standing in a running rill, or sealed off, such as the plaza ringed by water) the route ends
 * at the reachable cell nearest the goal and reached is false: the guard stands at the water.
 * From a cell off the grid or boxed in, points is empty. avoid ({x, z, r}, optional) keeps the
 * route out of a disc (the flanking guard's way round the warden rather than past him).
 */
export function route(grid, from, to, avoid = null) {
  const start = nearestOpen(grid, from.x, from.z);
  if (start < 0) return { points: [], reached: false };
  const n = grid.n;
  const goal = cellAt(grid, to.x, to.z);
  const prev = new Int32Array(n * n).fill(-2);
  prev[start] = -1;
  const queue = [start];
  let best = start;
  let bestD = Infinity;
  let found = false;
  for (let h = 0; h < queue.length; h++) {
    const k = queue[h];
    const c = centreOf(grid, k);
    const d = Math.hypot(c.x - to.x, c.z - to.z);
    if (d < bestD - 1e-9) { bestD = d; best = k; }
    if (k === goal) { found = true; best = k; break; }
    const i = k % n;
    const j = (k - i) / n;
    for (const [di, dj] of MOVES) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const q = b * n + a;
      if (!grid.open[q] || prev[q] !== -2) continue;
      if (avoid && kept(grid, q, avoid)) continue;
      if (di && dj && (!grid.open[j * n + a] || !grid.open[b * n + i])) continue; // no corner cutting
      prev[q] = k;
      queue.push(q);
    }
  }
  const cells = [];
  for (let k = best; k !== -1; k = prev[k]) cells.unshift(centreOf(grid, k));
  // Straighten: from each kept point, jump to the farthest later point in a clear line.
  const points = [];
  let at = { x: from.x, z: from.z };
  let idx = 0;
  while (idx < cells.length) {
    let far = idx;
    for (let t = cells.length - 1; t > idx; t--) {
      if (clearLine(grid, at, cells[t], avoid)) { far = t; break; }
    }
    points.push(cells[far]);
    at = cells[far];
    idx = far + 1;
  }
  return { points, reached: found };
}

/** True when cell q lies inside the avoided disc. */
function kept(grid, q, avoid) {
  const c = centreOf(grid, q);
  return Math.hypot(c.x - avoid.x, c.z - avoid.z) < avoid.r;
}

/**
 * Where the second guard heads: `beyond` metres past the warden on the line from the lead guard
 * through him (so the pair close from opposite sides), moved to the nearest open cell. Returns
 * {x, z}, or the warden's own place when there is no lead or no open cell near.
 */
export function flankGoal(grid, lead, warden, beyond) {
  const dx = warden.x - lead.x;
  const dz = warden.z - lead.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return { x: warden.x, z: warden.z };
  const lim = HALF - 0.6;
  const x = Math.max(-lim, Math.min(lim, warden.x + (dx / len) * beyond));
  const z = Math.max(-lim, Math.min(lim, warden.z + (dz / len) * beyond));
  if (!grid) return { x, z };
  const k = nearestOpen(grid, x, z);
  return k < 0 ? { x: warden.x, z: warden.z } : centreOf(grid, k);
}

/** True when (x, z) is on the court's grid (the guards never leave it). */
export function onGrid(x, z) {
  return x > -HALF && x < HALF && z > -HALF && z < HALF;
}
