// The Rose Court's figures: the two Guards and three Card Gardeners (still, wake, walk, tell,
// strike), the friendly figures of the wood, and Renfield's line triggers.
//
// Figures stand still and take no harm until they are called (e.called, set one per hand turn
// by roses.js callNext in the wake order). A called figure leaves `still` on its next step with
// a `wakeOne` event (its shout and clank or rustle play from where it stands), takes a wake beat,
// then closes on the warden and strikes after a tell; never across running water (the monster
// blocker list). Guards route round beds, hedges and the fountain on paths.js's walk grid; with
// two awake, the second to wake heads for a point past the warden so the pair close from both
// sides (e.flank), and each hits a little softer than before (cfg.guard.damage). Gardeners run
// straight with a wobble: a heading off by up to cfg.wobble.angle either side, re-drawn every
// cfg.wobble.min to max seconds from the injected generator. The cup's splash stops a guard or
// gardener for cfg.weapons.cup.stun seconds (splashStun, a `stun` event). A guard that dies
// leaves its halberd beside it in sim.waves.dropped (dropHalberds, a `halberdDrop` event).
//
// Friendly figures (security A6): the plot gardeners and the hunter carry `friendly: true`;
// enemy.js and hitscan.js check it first on every damage path, and stepFriendly here keeps them
// where they sit (a gardener ducks when a shot, a swing or a splash comes near). seatFriendlies
// seats a band's friendlies as creatures with the mark.
//
// Renfield never moves, attacks or takes harm; he only speaks, through journal.speak, with
// script.js keys.

import { chase, steer, hurtPlayer, blockersFor, spawnEnemy } from './enemy.js';
import { circleBlocked, moveCircle } from './collide.js';
import { COURT, MAZE } from './courtmap.js';
import { speak, addEntry } from './journal.js';
import { gridFor, route, flankGoal, clearLine, onGrid } from './paths.js';

// Timings the design leaves unnamed. Read from the figure's config block when it carries them
// (cfg.guard.wake and so on), else these starting values. The routing, wobble and stun numbers
// are the design's, read from cfg.paths, cfg.wobble and cfg.weapons.cup, else these; the
// flank, wobble, duck and drop numbers are read from cfg.courtiers (K below).
const TUNE = Object.freeze({
  guard: Object.freeze({ wake: 0.8, recover: 0.45, slack: 0.4 }),
  gardener: Object.freeze({ wake: 0.5, recover: 0.25, slack: 0.3 }),
  glance: 1.2, // seconds a still figure's head stays over-turned after a shot puffs off it
  paths: Object.freeze({ replan: 0.5, flankBeyond: 5, flankUntil: 6 }),
  wobble: Object.freeze({ angle: 30, min: 0.8, max: 1.6 }), // degrees; seconds
  stun: 3, // seconds the cup's splash stops a guard or gardener
  stuns: Object.freeze(['guard', 'gardener']),
  waypoint: 0.5, // metres from a route point that counts as there
});

/**
 * cfg.courtiers: flankArc, flankClear, straight, duckNear, duckTime, dropSide (courtconfig.js).
 * A room without that block gets these starting values (the same numbers), whole.
 */
const COURTIERS = Object.freeze({ flankArc: 60, flankClear: 1, straight: 3, duckNear: 3, duckTime: 1.5, dropSide: 0.8 });
const K = (sim) => (sim.cfg && sim.cfg.courtiers) || COURTIERS;

const tune = (c, type, k) => (c[k] != null ? c[k] : TUNE[type][k]);
const num = (o, k, d) => (o && Number.isFinite(o[k]) ? o[k] : d);

function initFigure(e) {
  e.state = 'still';
  e.immune = true; // nothing harms a still figure (Conflicts 6)
  e.called = false; // set by roses.js callNext: it wakes on its next step
  e.timer = 0; // seconds left in the current wake, tell or strike
  e.tell = 0; // seconds left in the wind-up (0 unless state is 'tell'); no view reads it: the views time wind-ups from the strikeTell event
  e.cooldown = 0; // seconds before the next tell may start
  e.glance = 0; // seconds left of the over-turned head after a shot while still
  e.atWater = false; // standing at a running rill it will not cross; read by tests, not drawn
  e.speedNow = 0;
  e.woke = -1; // sim time it woke (orders the guards: the second to wake flanks)
}

export function initGuard(e, cfg, rng) {
  initFigure(e);
  e.path = null; // { points, i, left, grid, reached, flank }: its route on paths.js's grid
  e.flank = null; // { x, z }: the flank goal while it is the second guard and still far off
}

export function initGardener(e, cfg, rng) {
  initFigure(e);
  e.wobble = 0; // radians off the straight line to the warden
  e.wobbleIn = 0; // seconds until the wobble is re-drawn (0: drawn on its first stride)
}

/** True when a shot struck e this frame (sim.js fires before creatures step). */
function struck(e, events) {
  for (const ev of events) if (ev.type === 'hit' && ev.id === e.id) return true;
  return false;
}

/** Standing against a running rill (the monster blocker list holds the running ones). */
function atRunningWater(e, sim, c) {
  const w = sim.waves;
  if (!w || !w.channels) return false;
  const r = c.radius + 0.35;
  for (let i = 0; i < COURT.rills.length; i++) {
    if (w.channels[i] && circleBlocked(e.x, e.z, r, [COURT.rills[i]])) return true;
  }
  return !!(w.done && w.done.roses) && circleBlocked(e.x, e.z, r, [COURT.threshold]);
}

/**
 * One frame of a court figure. still -> wake (a beat: heads snap to the warden) -> walk
 * (route or run) -> tell (wind-up, standing) -> strike (follow-through; damage if the warden
 * is still within reach plus slack) -> walk. sim.js may set 'flinch' (a stun) on a gardener,
 * splashStun 'stunned' on either, and enemy.js 'approach' when a stun ends; all resume as 'walk'.
 */
function stepFigure(e, sim, dt, events, c, move) {
  const pl = sim.player;
  const type = e.type;
  if (e.state === 'still') {
    e.speedNow = 0;
    e.glance = Math.max(0, e.glance - dt);
    if (struck(e, events)) e.glance = TUNE.glance;
    if (!e.called) return;
    e.state = 'wake';
    e.immune = false;
    e.glance = 0;
    e.woke = sim.time;
    e.timer = tune(c, type, 'wake');
    events.push({ type: 'wakeOne', id: e.id, enemy: type, x: e.x, z: e.z });
  }
  const dx = pl.x - e.x;
  const dz = pl.z - e.z;
  const dist = Math.hypot(dx, dz);
  const face = () => { e.heading = Math.atan2(-dx, -dz); };
  e.cooldown = Math.max(0, e.cooldown - dt);
  e.atWater = false;

  if (e.state === 'wake') {
    e.speedNow = 0;
    face();
    e.timer -= dt;
    if (e.timer <= 0) e.state = 'walk';
    return;
  }
  if (e.state === 'tell') {
    e.speedNow = 0;
    face();
    e.timer -= dt;
    e.tell = Math.max(0, e.timer);
    if (e.timer <= 0) {
      e.tell = 0;
      events.push({ type: 'strike', id: e.id, enemy: type, move });
      if (!pl.dead && dist <= c.reach + tune(c, type, 'slack')) hurtPlayer(sim, c.damage, e.x, e.z, events);
      e.state = 'strike';
      e.timer = tune(c, type, 'recover');
      e.cooldown = c.attackInterval;
    }
    return;
  }
  if (e.state === 'strike') {
    e.speedNow = 0;
    e.timer -= dt;
    if (e.timer <= 0) e.state = 'walk';
    return;
  }
  e.state = 'walk'; // 'approach' after a flinch or a splash, or anything else, resumes the walk
  e.tell = 0;
  if (pl.dead) {
    e.speedNow = 0;
    return;
  }
  if (dist <= c.reach) {
    e.speedNow = 0;
    face();
    e.stuckFor = 0;
    e.bestDist = dist;
    e.rerouteLeft = 0;
    if (e.cooldown <= 0) {
      e.state = 'tell';
      e.timer = c.tell;
      e.tell = c.tell;
      events.push({ type: 'strikeTell', id: e.id, enemy: type, move });
    }
    return;
  }
  const x0 = e.x;
  const z0 = e.z;
  if (type === 'guard') walkGuard(e, sim, dt, c, dist);
  else runGardener(e, sim, dt, c, dist);
  if (blockersFor(sim, e) !== sim.boxes && atRunningWater(e, sim, c)) {
    e.atWater = true;
    if (Math.hypot(e.x - x0, e.z - z0) < c.speed * dt * 0.25) face(); // stands there smiling at it
  }
}

// ---- guards: routes and the flank ---------------------------------------------------------

/** The guard that woke before e and is still up, when e is the second of an awake pair. */
function leadOf(e, sim) {
  let lead = null;
  for (const o of sim.enemies) {
    if (o === e || o.type !== 'guard' || o.dead || o.friendly || o.state === 'still') continue;
    if (o.woke < e.woke || (o.woke === e.woke && o.id < e.id)) {
      if (!lead || o.woke < lead.woke) lead = o;
    }
  }
  return lead;
}

/** Angle in radians between the bearings of a and b as seen from p. */
function apart(p, a, b) {
  const d = Math.abs(Math.atan2(a.z - p.z, a.x - p.x) - Math.atan2(b.z - p.z, b.x - p.x));
  return Math.min(d, 2 * Math.PI - d);
}

/**
 * A guard's walk: re-plan its route on the court's grid when the grid is new (a valve turned,
 * a restore), every cfg.paths.replan seconds, or when it has none; follow it; at its end, close
 * the last stretch straight, or, when the warden cannot be reached (a running rill between,
 * or he stands in the water), close as far as the water lets it and stand there watching him.
 * The second guard of an awake pair heads for the flank goal (cfg.paths.flankBeyond past the
 * warden from the lead), going round him rather than past him, until it is within
 * cfg.paths.flankUntil of him with its bearing on him well away from the lead's; then it closes.
 */
function walkGuard(e, sim, dt, c, dist) {
  const { cfg, player: pl } = sim;
  const grid = gridFor(sim);
  if (!grid || !onGrid(e.x, e.z) || !onGrid(pl.x, pl.z)) {
    e.path = null;
    e.flank = null;
    chase(e, sim, c.speed, dt, dist);
    return;
  }
  const pc = cfg.paths || {};
  const lead = leadOf(e, sim);
  const beyond = num(pc, 'flankBeyond', TUNE.paths.flankBeyond);
  const round = !!lead && apart(pl, e, lead) >= (K(sim).flankArc * Math.PI) / 180;
  const flanking = !!lead && !(dist <= num(pc, 'flankUntil', TUNE.paths.flankUntil) && round);
  e.flank = flanking ? flankGoal(grid, lead, pl, beyond) : null;
  const goal = e.flank || { x: pl.x, z: pl.z };
  const was = e.path;
  if (was) was.left -= dt;
  if (!was || was.grid !== grid.serial || was.left <= 0 || was.flank !== flanking) {
    const avoid = flanking ? { x: pl.x, z: pl.z, r: Math.max(0, beyond - K(sim).flankClear) } : null;
    const r = route(grid, e, goal, avoid);
    e.path = {
      points: r.points, i: 0, left: num(pc, 'replan', TUNE.paths.replan), grid: grid.serial, reached: r.reached, flank: flanking,
    };
  }
  const path = e.path;
  const blockers = blockersFor(sim, e);
  // The warden in plain reach on the grid and no flank to make: straight at him.
  if (!flanking && path.reached && clearLine(grid, e, pl)) {
    steer(e, pl.x, pl.z, c.speed, dt, cfg, blockers);
    return;
  }
  const pts = path.points;
  while (path.i < pts.length - 1 && Math.hypot(pts[path.i].x - e.x, pts[path.i].z - e.z) < TUNE.waypoint) path.i += 1;
  const wp = pts[path.i];
  if (!wp || (path.i === pts.length - 1 && Math.hypot(wp.x - e.x, wp.z - e.z) < TUNE.waypoint)) {
    if (path.reached && !flanking) {
      steer(e, pl.x, pl.z, c.speed, dt, cfg, blockers);
      return;
    }
    // The end of the way: at the flank point, turn in; cut off by water, press up to the
    // water's edge (moving straight at him, so it settles there rather than sliding about).
    e.heading = Math.atan2(-(pl.x - e.x), -(pl.z - e.z));
    if (flanking) {
      e.flank = null;
      path.flank = false;
      path.left = 0;
      steer(e, pl.x, pl.z, c.speed, dt, cfg, blockers);
      return;
    }
    const x0 = e.x;
    const z0 = e.z;
    const step = Math.min(c.speed * dt, Math.max(0, dist - c.reach * 0.9));
    if (step > 0) moveCircle(e, { x: ((pl.x - e.x) / dist) * step, z: ((pl.z - e.z) / dist) * step }, c.radius, blockers, cfg.arena.half);
    const moved = Math.hypot(e.x - x0, e.z - z0);
    if (moved < 0.2 * step || moved < 1e-4) {
      e.x = x0; // pressed against the water: stand, do not slide along it
      e.z = z0;
      e.speedNow = 0;
    } else {
      e.speedNow = moved / dt;
    }
    return;
  }
  steer(e, wp.x, wp.z, c.speed, dt, cfg, blockers);
}

// ---- gardeners: straight, with a wobble ---------------------------------------------------

/** A gardener's run: at the warden, the heading off by its wobble, re-drawn now and then. */
function runGardener(e, sim, dt, c, dist) {
  const { cfg, player: pl, rng } = sim;
  const st = cfg.steering;
  if (e.rerouteLeft > 0 || e.stuckFor >= st.stuckTime || dist < 1e-4) {
    chase(e, sim, c.speed, dt, dist); // stuck or re-routing: the shared chase decides
    return;
  }
  const wc = cfg.wobble || {};
  e.wobbleIn -= dt;
  if (e.wobbleIn <= 0) {
    const most = (num(wc, 'angle', TUNE.wobble.angle) * Math.PI) / 180;
    const lo = num(wc, 'min', TUNE.wobble.min);
    const hi = num(wc, 'max', TUNE.wobble.max);
    e.wobble = (rng() * 2 - 1) * most;
    e.wobbleIn = lo + rng() * (hi - lo);
  }
  if (dist < e.bestDist - 0.4) {
    e.bestDist = dist;
    e.stuckFor = 0;
  } else {
    e.stuckFor += dt;
  }
  const a = e.wobble * Math.min(1, dist / K(sim).straight);
  const dx = pl.x - e.x;
  const dz = pl.z - e.z;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  steer(e, e.x + dx * cs - dz * sn, e.z + dx * sn + dz * cs, c.speed, dt, cfg, blockersFor(sim, e));
}

export function stepGuard(e, sim, dt, events, rng, cfg) {
  stepFigure(e, sim, dt, events, cfg.guard, 'halberd');
}

export function stepGardener(e, sim, dt, events, rng, cfg) {
  stepFigure(e, sim, dt, events, cfg.gardener, 'brush');
}

// ---- the cup's splash and the fallen guards' halberds -----------------------------------

/**
 * The cup's splash reaching creature e (sim.js decides who it reaches; hitscan.arcTargets
 * skips friendlies). A guard or gardener that is up is stopped for cfg.weapons.cup.stun
 * seconds and a `stun` event is pushed; anything else (a friendly, a still figure, the Rabbit,
 * the Hatter, the Bat, the Caterpillar, a Lurch) is untouched. Returns true when it stunned.
 */
export function splashStun(sim, e, events) {
  if (!e || e.friendly || e.dead) return false; // security A6: checked first
  const spec = (sim.cfg.weapons && sim.cfg.weapons.cup) || {};
  const kinds = Array.isArray(spec.stuns) ? spec.stuns : TUNE.stuns;
  if (!kinds.includes(e.type) || e.state === 'still') return false;
  e.stun = num(spec, 'stun', TUNE.stun);
  e.state = 'stunned';
  e.timer = 0;
  e.tell = 0;
  e.speedNow = 0;
  e.rerouteLeft = 0;
  events.push({ type: 'stun', id: e.id });
  return true;
}

/**
 * For every guard that fell this frame (a `kill` event of enemy 'guard'), its halberd is left
 * lying beside where it fell: one { id, x, z, taken: false } in sim.waves.dropped and a
 * `halberdDrop` event. Once per guard, however often it is called in a frame (enemy.js calls
 * it after the bolts every frame; trail.js may too).
 */
export function dropHalberds(sim, events) {
  const w = sim.waves;
  if (!w || !Array.isArray(w.dropped)) return;
  const n = events.length;
  for (let k = 0; k < n; k++) {
    const ev = events[k];
    if (ev.type !== 'kill' || ev.enemy !== 'guard' || w.dropped.some((d) => d.id === ev.id)) continue;
    const at = besideFallen(sim, ev);
    w.dropped.push({ id: ev.id, x: at.x, z: at.z, taken: false });
    events.push({ type: 'halberdDrop', id: ev.id, x: at.x, z: at.z });
  }
}

/** A spot cfg.courtiers.dropSide beside a fallen guard, clear of walls, beds and water, else where it fell. */
function besideFallen(sim, ev) {
  const boxes = blockersFor(sim, null);
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = ev.x + ox * K(sim).dropSide;
    const z = ev.z + oz * K(sim).dropSide;
    if (!circleBlocked(x, z, 0.3, boxes)) return { x, z };
  }
  return { x: ev.x, z: ev.z };
}

// ---- the friendly figures of the wood ---------------------------------------------------

function segDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len2));
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y, a.z + dz * t - p.z);
}

function shotNear(events, p, r) {
  for (const ev of events) {
    if (ev.type !== 'shot' || !ev.from) continue;
    const ends = ev.pellets && ev.pellets.length ? ev.pellets.map((q) => q.to) : [ev.to];
    if (ends.some((to) => to && segDist(p, ev.from, to) < r)) return true;
  }
  return false;
}

/** A halberd swing or a cup splash landing within r of (x, z) this frame. */
function blowNear(events, x, z, r) {
  for (const ev of events) {
    if ((ev.type === 'swing' || ev.type === 'splashThrow') && Number.isFinite(ev.x) && Number.isFinite(ev.z)
      && Math.hypot(ev.x - x, ev.z - z) < r) return true;
  }
  return false;
}

/**
 * One frame of a friendly figure (enemy.js hands every e.friendly here, before anything else):
 * it never moves, attacks or takes harm. A plot gardener ducks (e.duck: seconds left, read by
 * the view) when a shot passes, or a swing or splash lands, within cfg.courtiers.duckNear; the hunter
 * does not move at all.
 */
export function stepFriendly(e, sim, dt, events) {
  e.speedNow = 0;
  e.duck = Math.max(0, (e.duck || 0) - dt);
  if (e.type === 'hunter') return;
  const chest = { x: e.x, y: 0.9, z: e.z };
  const k = K(sim);
  if (shotNear(events, chest, k.duckNear) || blowNear(events, e.x, e.z, k.duckNear)) e.duck = k.duckTime;
}

/**
 * Seats band k's friendly figures as creatures carrying the mark: a crouched card gardener
 * (type 'plotGardener', drawn as the shipped gardener, crouched) at each of the band's
 * vegetable plots (MAZE.plots) and, in its band, the hunter (type 'hunter',
 * MAZE.hunter). Neither type has a config block or is a court figure, so no court rule (the wake
 * order, the arch) ever counts one. Each is immune and friendly, so no damage path can reach it
 * (security A6); the spawn event carries friendly: true. Returns them.
 */
export function seatFriendlies(sim, k, events) {
  const out = [];
  for (const g of MAZE.plots || MAZE.plotGardeners || []) {
    if (g.band !== k) continue;
    out.push(spawnEnemy(sim, 'plotGardener', g.x, g.z, events, {
      friendly: true, immune: true, state: 'crouch', plot: g.plot, holds: g.holds, heading: g.yaw || 0, duck: 0,
    }));
  }
  const h = MAZE.hunter;
  if (h && h.band === k) {
    out.push(spawnEnemy(sim, 'hunter', h.x, h.z, events, { friendly: true, immune: true, state: 'slumped', heading: h.yaw || 0, duck: 0 }));
  }
  return out;
}

// ---- Renfield ---------------------------------------------------------------------------

const RENFIELD = Object.freeze({
  greet: 6, // metres from his table: the first line
  warm: 2, // metres from him ...
  warmTime: 8, // ... for this long: the warm line
  near: 1.5, // a shot passing this close to him is "at or near him"
  y: 1.2, // his chest, seated
});

/** Says key now and, after a line's length, then (or nothing). Lines never stack: newest wins. */
function say(sim, r, key, events, then = null) {
  speak(sim, 'renfield', key, events);
  r.next = then;
  r.nextIn = then ? sim.cfg.lineTime : 0;
}

/**
 * Renfield, every frame of the court (he is silent once the warden is in the wood).
 * asked: E was pressed facing him this frame. State lives in sim.waves.renfield and is kept
 * across checkpoints: greeted, asked (times), next/nextIn (a queued line), warmFor, warmSaid,
 * rosesSaid, archSaid.
 */
export function stepRenfield(sim, dt, events, asked) {
  const w = sim.waves;
  if (!w || !w.renfield || w.index !== 0) return;
  const r = w.renfield;
  const pl = sim.player;
  const red = !!(w.done && w.done.roses);

  if (r.next && r.nextIn > 0) {
    r.nextIn -= dt;
    if (r.nextIn <= 0) {
      const key = r.next;
      r.next = null;
      say(sim, r, key, events);
    }
  }

  if (asked) {
    r.asked = (r.asked || 0) + 1;
    const key = r.asked === 1 ? 'clue' : r.asked === 2 ? 'again' : 'after';
    say(sim, r, key, events, red ? null : 'white');
    if (key === 'clue') addEntry(sim, 'hour', events);
    return;
  }

  if (shotNear(events, { x: COURT.renfield.x, y: RENFIELD.y, z: COURT.renfield.z }, RENFIELD.near)) {
    if (!(w.line && w.line.who === 'renfield' && w.line.key === 'salt')) say(sim, r, 'salt', events);
    return;
  }

  if (red && !r.archSaid && pl.z < COURT.arch.z + 1 && Math.abs(pl.x - COURT.arch.x) < COURT.arch.width / 2 + 1) {
    r.archSaid = true;
    r.rosesSaid = true;
    say(sim, r, 'arch', events);
    return;
  }
  if (red && !r.rosesSaid) {
    r.rosesSaid = true;
    say(sim, r, 'roses', events);
    return;
  }

  if (!r.greeted && Math.hypot(pl.x - COURT.renfield.table.x, pl.z - COURT.renfield.table.z) < RENFIELD.greet) {
    r.greeted = true;
    say(sim, r, 'approach', events, 'second');
    return;
  }

  if (!r.warmSaid) {
    if (!pl.dead && Math.hypot(pl.x - COURT.renfield.x, pl.z - COURT.renfield.z) < RENFIELD.warm) {
      r.warmFor = (r.warmFor || 0) + dt;
      if (r.warmFor >= RENFIELD.warmTime) {
        r.warmSaid = true;
        say(sim, r, 'warm', events);
      }
    } else {
      r.warmFor = 0;
    }
  }
}
