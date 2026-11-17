// The yard's climbable crates (#21). Each is a two-level place (levels.js levelAt, the castle's
// own resolver): the ground, the crate top, a ramp or a ladder between them, and a small box as
// the safe step down. Everything here reads height from position alone, for the warden and for
// every creature alike: the floor is the highest surface at or under y + STEP_UP (0 in the air),
// a crate or a step stops a mover only while it stands lower than the box's top, and a point
// with a surface higher than the reach (a crate's side, a ramp's side) cannot be walked into.
// A drop over cfg.climb.safeDrop costs a share of the gallery's fall (gallery.js fallDamage).
//
// Routes at height: the creatures plan on a walk grid over the yard (cfg.climb.cell) whose steps
// follow the same rule (a step up within STEP_UP is a walk or a climb, a higher one is blocked,
// a drop is allowed but costed by its fall), as a cost field toward the warden's cell. The grid
// and the fields are derived from cfg alone and kept only in a WeakMap keyed by cfg (nothing
// here is in sim): the yard's crates never move, so they are built once.

import { levelAt, STEP_UP } from './levels.js';
import { moveCircle } from './collide.js';
import { fallDamage } from './gallery.js';
import { surfaceAt } from './surfaces.js';

/** Height a grounded mover steps down without leaving the ground (sim.js STEP_DOWN). */
const STEP_DOWN = 0.25;
const EPS = 1e-6;

const inRect = (r, x, z, pad = 0) => x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
const deckSolid = (L, x, z) => inRect(L.deck, x, z);

const LIVE = new WeakMap(); // cfg -> its climbable places whose crate stands in cfg.boxes

/**
 * The room's climbable places (config.js levels): only in the yard's own encounter (a room built
 * from the yard's config for another encounter carries the data but not the crates), and only a
 * place whose crate is in the room's boxes (a test yard of bare walls has none).
 */
export function LEVELS_OF(cfg) {
  if (!cfg || typeof cfg !== 'object') return [];
  const had = LIVE.get(cfg);
  if (had) return had;
  const yard = !cfg.encounter || cfg.encounter === 'waves';
  const boxes = cfg.boxes || [];
  const list = yard && cfg.climb && Array.isArray(cfg.levels)
    ? cfg.levels.filter((L) => boxes.some((b) => b.kind === 'crate' && Math.abs(b.minX - L.deck.minX) < EPS
      && Math.abs(b.maxX - L.deck.maxX) < EPS && Math.abs(b.minZ - L.deck.minZ) < EPS && Math.abs(b.maxZ - L.deck.maxZ) < EPS))
    : [];
  LIVE.set(cfg, list);
  return list;
}

/** True in a room with climbable places (the yard). */
export function climbs(cfg) {
  return LEVELS_OF(cfg).length > 0;
}

/**
 * The floor at (x, z) for feet at y, reaching `reach` up (STEP_UP on the ground, 0 in the air):
 * { floor, on, entry, above } (levels.js levelAt; on is 'ground' outside every crate's place).
 */
export function yardFloor(cfg, x, z, y, reach = STEP_UP) {
  const r = levelAt(LEVELS_OF(cfg), x, z, y, reach, deckSolid);
  if (!r) return { floor: 0, on: 'ground', entry: null, above: -Infinity };
  return { floor: r.floor, on: r.on, entry: r.entry, above: r.above };
}

/** The ladder (a climb stair) under a grounded mover at (x, z, y), or null. */
function ladderAt(cfg, x, z, y) {
  const r = yardFloor(cfg, x, z, y);
  return r.on === 'stair' && r.entry.stair.climb ? r.entry.stair : null;
}

/** Health a drop of `drop` metres costs: 0 to safeDrop, then a share of fallDamage, capped at it. */
export function fallHurt(cfg, drop, maxHealth = cfg.player.health) {
  const { safeDrop, fallRef } = cfg.climb;
  if (!(drop > safeDrop)) return 0;
  const full = fallDamage(maxHealth);
  return Math.round(Math.min(full, (full * (drop - safeDrop)) / (fallRef - safeDrop)));
}

// ---- collision ------------------------------------------------------------------------------

const OWNERS = new WeakMap(); // cfg -> Map(box -> { entry, deck })

/** Which climbable place each crate (its deck) and small box belongs to: derived from cfg. */
function owners(cfg) {
  let m = OWNERS.get(cfg);
  if (m) return m;
  m = new Map();
  const same = (b, r) => Math.abs(b.minX - r.minX) < EPS && Math.abs(b.maxX - r.maxX) < EPS
    && Math.abs(b.minZ - r.minZ) < EPS && Math.abs(b.maxZ - r.maxZ) < EPS;
  for (const b of cfg.boxes || []) {
    for (const L of LEVELS_OF(cfg)) {
      if (b.kind === 'crate' && same(b, L.deck)) m.set(b, { entry: L, deck: true });
      else if (b.kind === 'step' && (L.steps || []).some((s) => same(b, s.rect))) m.set(b, { entry: L, deck: false });
    }
  }
  OWNERS.set(cfg, m);
  return m;
}

/**
 * What a mover at (x, z) with feet at y collides with: every box of `boxes`, but a climbable
 * crate or small box only while the mover stands lower than its top (less the reach), and never
 * the crate whose ramp or ladder it is on (the stair runs up to that crate's edge).
 */
export function blockersAt(cfg, boxes, x, z, y, grounded = true) {
  const own = owners(cfg);
  if (!own.size) return boxes;
  const reach = grounded ? STEP_UP : 0;
  const here = yardFloor(cfg, x, z, y, reach);
  const stairOf = here.on === 'stair' ? here.entry : null;
  // The list depends only on the stair (if any) and on which box tops stand above y + reach:
  // a few lists per room, kept by that key (no list is built per mover per frame).
  let key = stairOf ? stairOf.id : '';
  for (const t of tops(cfg, own)) key += b2(t > y + reach + EPS);
  let byBoxes = LISTS.get(boxes);
  if (!byBoxes) { byBoxes = new Map(); LISTS.set(boxes, byBoxes); }
  const had = byBoxes.get(key);
  if (had) return had;
  const list = boxes.filter((b) => {
    const o = own.get(b);
    if (!o) return true;
    if (o.deck && o.entry === stairOf) return false;
    return b.maxY > y + reach + EPS;
  });
  byBoxes.set(key, list);
  return list;
}

const LISTS = new WeakMap(); // box list -> Map(key -> the filtered list)
const TOPS = new WeakMap(); // cfg -> the distinct tops of its climbable crates and small boxes
const b2 = (v) => (v ? '1' : '0');

function tops(cfg, own) {
  let t = TOPS.get(cfg);
  if (!t) {
    t = [...new Set([...own.keys()].map((b) => b.maxY))].sort((a, c) => a - c);
    TOPS.set(cfg, t);
  }
  return t;
}

/** True when (x, z) holds a surface standing higher than the reach: no walking into it. */
function walledAt(cfg, x, z, y, reach) {
  return yardFloor(cfg, x, z, y, reach).above > -Infinity;
}

/**
 * After a move from (x0, z0): a mover whose centre went into a crate's or a ramp's side is put
 * back, sliding along the side where one axis alone is clear.
 */
function unwall(cfg, m, x0, z0, reach) {
  if (!walledAt(cfg, m.x, m.z, m.y, reach)) return;
  if (!walledAt(cfg, m.x, z0, m.y, reach)) { m.z = z0; return; }
  if (!walledAt(cfg, x0, m.z, m.y, reach)) { m.x = x0; return; }
  m.x = x0;
  m.z = z0;
}

/** Longest ground a mover covers on a ladder in dt (the climb speed, up or down). */
function ladderLimit(cfg, s, dt) {
  return (cfg.climb.ladderSpeed * s.run * dt) / s.rise;
}

/**
 * Moves the warden (or any mover) by delta in the yard: slowed to the climb speed on a ladder,
 * collision by blockersAt, and kept out of crate and ramp sides. Returns true on a collision.
 */
export function climbMove(sim, m, delta, radius, grounded, dt) {
  const { cfg } = sim;
  const x0 = m.x;
  const z0 = m.z;
  const reach = grounded ? STEP_UP : 0;
  let dx = delta.x;
  let dz = delta.z;
  const lad = grounded ? (ladderAt(cfg, m.x, m.z, m.y) || ladderAt(cfg, m.x + dx, m.z + dz, m.y)) : null;
  if (lad) {
    const len = Math.hypot(dx, dz);
    const max = ladderLimit(cfg, lad, dt);
    if (len > max) { dx *= max / len; dz *= max / len; }
  }
  const hit = moveCircle(m, { x: dx, z: dz }, radius, blockersAt(cfg, sim.boxes, m.x, m.z, m.y, grounded), cfg.arena.half);
  const bx = m.x;
  const bz = m.z;
  unwall(cfg, m, x0, z0, reach);
  return hit || bx !== m.x || bz !== m.z;
}

/** True while a grounded mover stands on a ladder (the climb pose). */
export function onLadder(cfg, m) {
  return m.y > CLIMB_POSE && !!ladderAt(cfg, m.x, m.z, m.y);
}

/** Height on a ladder below which the mover still stands at its foot (no climb pose yet). */
const CLIMB_POSE = 0.1;

/** The warden's floor (sim.js floorOf, the yard's enc.floor): reach STEP_UP on the ground, 0 in the air. */
export function climbFloor(sim, x, z, y) {
  if (!climbs(sim.cfg)) return 0;
  return yardFloor(sim.cfg, x, z, y, sim.player.grounded ? STEP_UP : 0).floor;
}

/** What is underfoot (the yard's enc.surface): a crate top or a small box, a ramp or a ladder, else the zones. */
export function climbSurface(sim, x, z) {
  if (climbs(sim.cfg)) {
    const r = yardFloor(sim.cfg, x, z, sim.player.y);
    const material = r.on === 'top' || r.on === 'step' ? 'crate' : r.on === 'stair' ? 'ramp' : null;
    if (material) return { material, family: 'metal' };
  }
  return surfaceAt(sim, x, z);
}

// ---- the creatures: height from position, falling, the ladder's pace ------------------------

/** Each live creature's place at the start of the frame, for settle (an array of [e, x, z]). */
export function frameStart(sim) {
  return sim.enemies.map((e) => [e, e.x, e.z]);
}

/**
 * After every creature has moved this frame (its own step, separation, knockback): out of any
 * crate or ramp side, no faster than the climb on a ladder, then onto the floor under it, or
 * falling under the warden's gravity until it lands. Sets e.air, e.vy and e.climbing.
 */
export function settle(sim, starts, dt) {
  const { cfg } = sim;
  const g = cfg.player.gravity;
  for (const [e, x0, z0] of starts) {
    if (e.friendly || e.dead || !sim.enemies.includes(e)) continue;
    const air = !!e.air;
    const reach = air ? 0 : STEP_UP;
    if (air) { // off an edge: down near-straight, as the warden (cfg.climb.dropSpeed)
      const dx = e.x - x0;
      const dz = e.z - z0;
      const len = Math.hypot(dx, dz);
      const max = cfg.climb.dropSpeed * dt;
      if (len > max) { e.x = x0 + (dx * max) / len; e.z = z0 + (dz * max) / len; }
    } else {
      const lad = ladderAt(cfg, x0, z0, e.y) || ladderAt(cfg, e.x, e.z, e.y);
      const dx = e.x - x0;
      const dz = e.z - z0;
      const len = Math.hypot(dx, dz);
      const max = lad ? ladderLimit(cfg, lad, dt) : Infinity;
      if (len > max) { e.x = x0 + (dx * max) / len; e.z = z0 + (dz * max) / len; }
    }
    unwall(cfg, e, x0, z0, reach);
    const floor = yardFloor(cfg, e.x, e.z, e.y, reach).floor;
    if (!air) {
      if (floor < e.y - STEP_DOWN) { e.air = true; e.vy = 0; } else e.y = floor;
    }
    if (e.air) {
      e.vy = (e.vy || 0) - g * dt;
      e.y += e.vy * dt;
      const under = yardFloor(cfg, e.x, e.z, e.y - e.vy * dt, 0).floor;
      if (e.y <= under) { e.y = under; e.vy = 0; e.air = false; }
    }
    e.climbing = !e.air && onLadder(cfg, e);
  }
}

/** The creature-on-creature and creature-on-warden push applies only between movers this close in height. */
export const SEPARATE_DY = 1.5;

/** A Wick's swipe reaches this far up or down (the warden on a small box is in reach, on a crate top not). */
export const SWIPE_DY = 1.3;

// ---- routes at height ------------------------------------------------------------------------

const GRAPHS = new WeakMap(); // cfg -> Map(radius -> graph)
const FIELDS_KEPT = 8; // cost fields kept per graph (one per warden cell asked for lately)
const MOVES = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const SUBSTEPS = 5;
const LADDER_COST = 5; // a metre of ladder costs as much as this much walking
const DROP_COST = 0.5; // a drop within safeDrop (onto a small box, off one)
const FALL_COST = 20; // a drop past safeDrop, plus its fall damage

/** The walk grid's geometry for cfg: n cells a side of `cell` metres over the arena. */
function gridGeom(cfg) {
  const cell = cfg.climb.cell;
  const half = cfg.arena.half;
  return { cell, half, n: Math.round((2 * half) / cell) };
}

const centre = (G, k) => ({ x: -G.half + ((k % G.n) + 0.5) * G.cell, z: -G.half + (Math.floor(k / G.n) + 0.5) * G.cell });

function cellOf(G, x, z) {
  const i = Math.floor((x + G.half) / G.cell);
  const j = Math.floor((z + G.half) / G.cell);
  if (i < 0 || j < 0 || i >= G.n || j >= G.n) return -1;
  return j * G.n + i;
}

/** True when a mover of radius r centred at p, arriving from height yFrom, is stopped by a box there. */
function boxedAt(cfg, own, p, h, yFrom, r) {
  if (Math.abs(p.x) > cfg.arena.half - r || Math.abs(p.z) > cfg.arena.half - r) return true;
  const here = yardFloor(cfg, p.x, p.z, h);
  const stairOf = here.on === 'stair' ? here.entry : null;
  const level = Math.max(h, yFrom) + STEP_UP + EPS;
  for (const b of cfg.boxes) {
    const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
    if ((p.x - cx) ** 2 + (p.z - cz) ** 2 >= r * r) continue;
    const o = own.get(b);
    if (!o) return true;
    if (o.deck && o.entry === stairOf) continue;
    if (b.maxY > level) return true;
  }
  return false;
}

/**
 * One step between neighbouring cells a and b by the yard's rule, walked in SUBSTEPS from a's
 * floor: a surface higher than STEP_UP on the way blocks it; a lower one is a drop. Returns its
 * cost, or Infinity.
 */
function stepCost(cfg, own, G, h, a, b, r) {
  const pa = centre(G, a);
  const pb = centre(G, b);
  let y = h[a];
  let drop = 0;
  let ladder = 0;
  const len = Math.hypot(pb.x - pa.x, pb.z - pa.z);
  for (let s = 1; s <= SUBSTEPS; s++) {
    const t = s / SUBSTEPS;
    const x = pa.x + (pb.x - pa.x) * t;
    const z = pa.z + (pb.z - pa.z) * t;
    const f = yardFloor(cfg, x, z, y);
    if (f.above > -Infinity) return Infinity;
    if (f.floor < y - STEP_DOWN) drop = Math.max(drop, y - f.floor);
    if (f.on === 'stair' && f.entry.stair.climb) ladder += len / SUBSTEPS;
    y = f.floor;
  }
  if (Math.abs(y - h[b]) > STEP_UP) return Infinity; // the cell's own floor is another level
  if (boxedAt(cfg, own, pb, h[b], h[a], r)) return Infinity;
  let cost = len + ladder * (LADDER_COST - 1);
  if (drop > cfg.climb.safeDrop) cost += FALL_COST + fallHurt(cfg, drop);
  else if (drop > 0) cost += DROP_COST;
  return cost;
}

/**
 * The walk grid for movers of radius r: each cell's floor, and the cost of each of its eight
 * steps (cost[a * 8 + m] for the step from a by MOVES[m], Infinity where there is none).
 */
function graphFor(cfg, r) {
  let byR = GRAPHS.get(cfg);
  if (!byR) { byR = new Map(); GRAPHS.set(cfg, byR); }
  const had = byR.get(r);
  if (had) return had;
  const G = gridGeom(cfg);
  const own = owners(cfg);
  const N = G.n * G.n;
  const h = new Float64Array(N);
  const hLo = new Float64Array(N);
  const hHi = new Float64Array(N);
  const open = new Uint8Array(N);
  const levels = LEVELS_OF(cfg);
  const nearLevel = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const p = centre(G, k);
    h[k] = yardFloor(cfg, p.x, p.z, Infinity).floor;
    // The cell's span of floor (a stair cell slopes): its corners, just inside.
    const q = G.cell / 2 - 0.01;
    let lo = h[k];
    let hi = h[k];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const f = yardFloor(cfg, p.x + sx * q, p.z + sz * q, Infinity).floor;
      if (f < lo) lo = f;
      if (f > hi) hi = f;
    }
    hLo[k] = lo;
    hHi[k] = hi;
    open[k] = boxedAt(cfg, own, p, h[k], h[k], r) ? 0 : 1;
    nearLevel[k] = levels.some((L) => inRect(L.rect, p.x, p.z, G.cell * 1.5)) ? 1 : 0;
  }
  const cost = new Float64Array(N * 8).fill(Infinity);
  for (let a = 0; a < N; a++) {
    const i = a % G.n;
    const j = (a - i) / G.n;
    for (let m = 0; m < 8; m++) {
      const [di, dj] = MOVES[m];
      const bi = i + di;
      const bj = j + dj;
      if (bi < 0 || bj < 0 || bi >= G.n || bj >= G.n) continue;
      const b = bj * G.n + bi;
      if (!nearLevel[a] && !nearLevel[b]) {
        if (!open[a] || !open[b]) continue;
        if (di && dj && (!open[j * G.n + bi] || !open[bj * G.n + i])) continue; // no corner cutting
        cost[a * 8 + m] = di && dj ? Math.SQRT2 * G.cell : G.cell;
        continue;
      }
      if (!open[a] && !nearLevel[a]) continue;
      if (di && dj && (stepCost(cfg, own, G, h, a, j * G.n + bi, r) === Infinity
        || stepCost(cfg, own, G, h, a, bj * G.n + i, r) === Infinity)) continue;
      cost[a * 8 + m] = stepCost(cfg, own, G, h, a, b, r);
    }
  }
  const graph = { G, h, hLo, hHi, cost, fields: new Map() };
  byR.set(r, graph);
  return graph;
}

/**
 * Cost to the warden's cell from every cell: a reverse Dijkstra, run lazily (settle(k) pops only
 * until cell k's cost is final, so a creature near him costs little), kept for a few cells.
 */
function fieldFor(graph, target) {
  const kept = graph.fields.get(target);
  if (kept) { // the most recently used goes to the back
    graph.fields.delete(target);
    graph.fields.set(target, kept);
    return kept;
  }
  const { G, cost } = graph;
  const n = G.n;
  const N = graph.h.length;
  // Arrays come back from the field this one pushes out (FIELDS_KEPT at most per graph).
  const spare = graph.fields.size >= FIELDS_KEPT ? graph.fields.get(graph.fields.keys().next().value) : null;
  if (spare) graph.fields.delete(graph.fields.keys().next().value);
  const dist = spare ? spare.dist.fill(Infinity) : new Float64Array(N).fill(Infinity);
  const done = spare ? spare.done.fill(0) : new Uint8Array(N);
  let key = spare ? spare.heap.key : new Float64Array(1024);
  let node = spare ? spare.heap.node : new Int32Array(1024);
  let size = 0;
  const push = (d, v) => {
    if (size === key.length) {
      const k2 = new Float64Array(size * 2); k2.set(key); key = k2;
      const n2 = new Int32Array(size * 2); n2.set(node); node = n2;
    }
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (key[p] <= d) break;
      key[i] = key[p];
      node[i] = node[p];
      i = p;
    }
    key[i] = d;
    node[i] = v;
  };
  const pop = () => {
    const d = key[0];
    const b = node[0];
    size -= 1;
    if (size) {
      const lk = key[size];
      const lv = node[size];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && key[c + 1] < key[c]) c += 1;
        if (key[c] >= lk) break;
        key[i] = key[c];
        node[i] = node[c];
        i = c;
      }
      key[i] = lk;
      node[i] = lv;
    }
    return d > dist[b] || done[b] ? -1 : b;
  };
  dist[target] = 0;
  push(0, target);
  const field = {
    dist,
    done,
    get heap() { return { key, node }; },
    /** Runs the search until cell k's cost is final (or nothing is left); returns that cost. */
    settle(k) {
      while (!done[k] && size) {
        const b = pop();
        if (b < 0) continue;
        done[b] = 1;
        const bi = b % n;
        const bj = (b - bi) / n;
        for (let m = 0; m < 8; m++) {
          const ai = bi - MOVES[m][0];
          const aj = bj - MOVES[m][1];
          if (ai < 0 || aj < 0 || ai >= n || aj >= n) continue;
          const a = aj * n + ai;
          const nd = dist[b] + cost[a * 8 + m];
          if (nd < dist[a]) { dist[a] = nd; push(nd, a); }
        }
      }
      return done[k] ? dist[k] : Infinity;
    },
  };
  graph.fields.set(target, field);
  return field;
}

/** Builds the yard's walk grids ahead of the fight (the view calls it as the yard loads). */
export function warmRoutes(cfg) {
  if (!climbs(cfg)) return;
  for (const type of ['wick', 'bellows']) if (cfg[type]) graphFor(cfg, cfg[type].radius);
}

/** True when feet at y stand on cell k's level (within its span of floor, give or take STEP_UP). */
const onLevel = (graph, k, y) => y >= graph.hLo[k] - STEP_UP && y <= graph.hHi[k] + STEP_UP;

/** The cell under (x, z) for feet at y: that cell, or the neighbour on y's level when it is another. */
function cellAtLevel(graph, x, z, y) {
  const { G } = graph;
  const k = cellOf(G, x, z);
  if (k < 0 || !Number.isFinite(y) || onLevel(graph, k, y)) return k;
  const i = k % G.n;
  const j = (k - i) / G.n;
  let best = k;
  let bd = Infinity;
  for (const [di, dj] of MOVES) {
    if (i + di < 0 || j + dj < 0 || i + di >= G.n || j + dj >= G.n) continue;
    const q = (j + dj) * G.n + (i + di);
    if (!onLevel(graph, q, y)) continue;
    const c = centre(G, q);
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

/**
 * The route field toward (tx, tz) with feet at ty (tests and the chase), for movers of radius r:
 * costAt(x, z, y) is the cost from there (Infinity where no route is), next(x, z, y) the centre
 * of the cell to head for, or null. A y left out reads the cell as it lies. Use a view at once:
 * once its field is pushed out of the cache its arrays are reused for another warden cell.
 */
export function crateField(cfg, r, tx, tz, ty) {
  const graph = graphFor(cfg, r);
  return fieldView(graph, cellAtLevel(graph, tx, tz, ty));
}

function fieldView(graph, target) {
  const { G } = graph;
  const field = target < 0 ? null : fieldFor(graph, target);
  const costOf = (k) => (field ? field.settle(k) : Infinity);
  const from = (x, z, y) => {
    const k = cellAtLevel(graph, x, z, y);
    if (k < 0 || !field) return -1;
    if (costOf(k) < Infinity) return k;
    // Pushed into a closed cell (a crate's skirt, a wall): the best neighbour on its level.
    let best = -1;
    let bd = Infinity;
    const i = k % G.n;
    const j = (k - i) / G.n;
    for (const [di, dj] of MOVES) {
      if (i + di < 0 || j + dj < 0 || i + di >= G.n || j + dj >= G.n) continue;
      const q = (j + dj) * G.n + (i + di);
      if (Math.abs(graph.h[q] - graph.h[k]) > STEP_UP) continue;
      const c = costOf(q);
      if (c < bd) { bd = c; best = q; }
    }
    return best;
  };
  return {
    target,
    costAt(x, z, y) {
      const k = from(x, z, y);
      return k < 0 ? Infinity : costOf(k);
    },
    next(x, z, y) {
      const k = from(x, z, y);
      if (k < 0 || costOf(k) === 0) return null;
      if (k !== cellOf(G, x, z)) return centre(G, k);
      // Every neighbour on the best way is already final (it costs less than k).
      const { dist } = field;
      let best = null;
      let bd = Infinity;
      const i = k % G.n;
      const j = (k - i) / G.n;
      for (let m = 0; m < 8; m++) {
        const c = graph.cost[k * 8 + m];
        if (c === Infinity) continue;
        const b = (j + MOVES[m][1]) * G.n + (i + MOVES[m][0]);
        if (c + dist[b] < bd) { bd = c + dist[b]; best = b; }
      }
      return best == null ? null : centre(G, best);
    },
  };
}

/** The warden's floor under him (a jump over open ground is still the ground). */
function wardenFloor(sim) {
  const pl = sim.player;
  return yardFloor(sim.cfg, pl.x, pl.z, pl.y).floor;
}

/** True when the straight way from e to the warden crosses a climbable place, or either is up. */
function needsRoute(sim, e, r, floor) {
  const pl = sim.player;
  if (floor > 0.05 || e.y > 0.05 || e.air) return true;
  for (const L of LEVELS_OF(sim.cfg)) {
    const R = L.rect;
    // Segment against the place's rect grown by the mover's radius (a slab test in x and z).
    let t0 = 0;
    let t1 = 1;
    const ax = [[e.x, pl.x - e.x, R.minX - r, R.maxX + r], [e.z, pl.z - e.z, R.minZ - r, R.maxZ + r]];
    let hit = true;
    for (const [o, d, lo, hi] of ax) {
      if (Math.abs(d) < EPS) { if (o < lo || o > hi) { hit = false; break; } continue; }
      let a = (lo - o) / d;
      let b = (hi - o) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}

/**
 * The chase at height (enemy.js chase, in the yard): when the warden or the creature is up, or
 * the straight way crosses a crate's place, the creature walks the route field toward the
 * warden's cell (up a ramp or a ladder, down by a small box). The cell it routes to (e.routeTo)
 * follows the warden only once he is more than a cell from it or on another level, so a warden
 * pacing a crate top does not set every creature a new field each step. Returns true when it
 * moved by the field, false to leave the ordinary chase to it (the open ground, his own cell,
 * or no route at all).
 */
export function climbChase(e, sim, speed, dt, blockers) {
  const { cfg, player: pl } = sim;
  const r = cfg[e.type].radius;
  const floor = wardenFloor(sim);
  if (!needsRoute(sim, e, r, floor)) return false;
  const graph = graphFor(cfg, r);
  const want = cellAtLevel(graph, pl.x, pl.z, floor);
  if (want < 0) return false;
  const had = Number.isInteger(e.routeTo) ? e.routeTo : -1;
  const G = graph.G;
  const near = had >= 0 && Math.abs((had % G.n) - (want % G.n)) <= 1
    && Math.abs(Math.floor(had / G.n) - Math.floor(want / G.n)) <= 1
    && Math.abs(graph.h[had] - graph.h[want]) <= STEP_UP;
  if (!near) e.routeTo = want;
  const next = fieldView(graph, e.routeTo).next(e.x, e.z, e.air ? Infinity : e.y);
  if (!next) return false;
  const dx = next.x - e.x;
  const dz = next.z - e.z;
  const len = Math.hypot(dx, dz);
  if (len < EPS) return true;
  const step = Math.min(speed * dt, len);
  moveCircle(e, { x: (dx / len) * step, z: (dz / len) * step }, r, blockers, cfg.arena.half);
  e.heading = Math.atan2(-dx, -dz);
  e.speedNow = speed;
  e.stuckFor = 0;
  e.bestDist = Infinity;
  e.rerouteLeft = 0;
  return true;
}
