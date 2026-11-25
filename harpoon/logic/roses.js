// The rose puzzle: four valves, cross-plumbed. Valve i feeds the next bed clockwise down rill i;
// opening Hearts, Diamonds or Spades slams one other valve shut if it is open; Clubs slams
// nothing and feeds the half-painted Hearts bed. So the one order that leaves all four open is
// Diamonds, Spades, Hearts, Clubs, and from any state that order still works. An open wheel
// never turns back by hand. Also the list of boxes only monsters collide with: walls plus one
// box per running rill (and the arch threshold once the roses are red).
// Polish (R1, R4): each hand turn calls one more court figure awake, in the wake order (a slam
// calls nobody); each turn sends water down its rill, timed by sim.waves.flows[i] (the rules
// count the bed red at once; the views draw the travel), and waterArrive marks its landing.

import { COURT } from './courtmap.js';
import { COURT_CONFIG } from './courtconfig.js';
import { circleBlocked } from './collide.js';
import { addEntry } from './journal.js';
import { trailBoxes } from './trail.js';

/** Bed each valve feeds (by index: 0 Clubs, 1 Hearts, 2 Diamonds, 3 Spades). */
export const FEEDS = Object.freeze([1, 2, 3, 0]);
/** Valve each valve slams shut when opened, or null. */
export const SLAMS = Object.freeze([null, 0, 3, 1]);
/** The one order that solves it: Diamonds, Spades, Hearts, Clubs. */
export const ORDER = Object.freeze([2, 3, 1, 0]);
/** The kinds called awake, one per hand turn: COURT_CONFIG.wakeOrder (read here, never copied). */
export const WAKE_ORDER = COURT_CONFIG.wakeOrder;

/** Seconds the water takes to run down a rill to its bed (COURT_CONFIG.valveFlow). */
export function flowTime(cfg) {
  return cfg.valveFlow;
}

/** True when all four beds are red. state is sim.waves (or anything with beds[]). */
export function bedsRed(state) {
  return state.beds.length === 4 && state.beds.every(Boolean);
}

/** How many valves of the right order are open, counted from the first. */
export function rightTurns(state) {
  let k = 0;
  while (k < ORDER.length && state.valves[ORDER[k]]) k++;
  return k;
}

/** The next valve of the right order that is shut (an index into COURT.valves), or null. */
export function nextValve(state) {
  const v = ORDER.find((i) => !state.valves[i]);
  return v == null ? null : v;
}

/**
 * The boxes creatures collide with in this room: sim.boxes plus a box for each running rill,
 * plus the arch threshold once the roses are red. The player's movement never reads it.
 */
export function monsterBoxes(sim) {
  const w = sim.waves;
  const out = [...sim.boxes];
  COURT.rills.forEach((r, i) => { if (w.channels[i]) out.push(r); });
  if (w.done.roses) out.push(COURT.threshold);
  return out;
}

/** Recomputes the derived lists after the valves or the gates change. */
export function refreshBlockers(sim) {
  sim.boxes = trailBoxes(sim.cfg, sim.waves);
  sim.waves.blockers = monsterBoxes(sim);
}

function shut(sim, j, events) {
  const w = sim.waves;
  w.valves[j] = false;
  w.channels[j] = false;
  if (w.flows) w.flows[j] = 0; // drains from the valve end: nothing more arrives
  const v = COURT.valves[j];
  events.push({ type: 'valveSlam', index: j, x: v.x, z: v.z });
  const bed = FEEDS[j];
  if (w.beds[bed]) {
    w.beds[bed] = false;
    events.push({ type: 'bedTurn', index: bed, red: false });
  }
  addEntry(sim, 'firstSlam', events);
}

/**
 * Marks the next court figure called (e.called): the kind cfg.wakeOrder names for this turn, the
 * one of that kind nearest valve i; if none of that kind is left, the nearest of any. Counts
 * it in sim.waves.called. Returns the figure, or null when every figure is called.
 */
export function callNext(sim, i, events) {
  const w = sim.waves;
  const v = COURT.valves[i];
  const left = sim.enemies.filter((e) => (e.type === 'guard' || e.type === 'gardener') && !e.friendly && !e.dead && !e.called);
  if (!left.length) return null;
  const order = sim.cfg.wakeOrder; // gardener, guard, gardener, guard, gardener
  const want = order[Math.min(w.called || 0, order.length - 1)];
  const pool = left.some((e) => e.type === want) ? left.filter((e) => e.type === want) : left;
  let best = pool[0];
  let bd = Infinity;
  for (const e of pool) {
    const d = Math.hypot(e.x - v.x, e.z - v.z);
    if (d < bd) { bd = d; best = e; }
  }
  best.called = true;
  w.called = (w.called || 0) + 1;
  return best;
}

/**
 * Opens valve i by hand. Its rill runs and the bed it feeds turns red; the valve it is plumbed
 * against, if open, slams shut and its bed pales. The first turn of any valve wakes the court;
 * every hand turn calls one more figure (callNext). The water sets off down the rill
 * (flows[i], and valveTurn carries flow in seconds). All four red: the roses are solved and
 * the arch opens. Returns false (and changes nothing) for an open valve, a bad index, or once
 * the roses are solved.
 */
export function turnValve(sim, i, events) {
  const w = sim.waves;
  if (!Number.isInteger(i) || i < 0 || i > 3 || w.valves[i] || w.done.roses) return false;
  const first = w.phase === 'still';
  w.valves[i] = true;
  w.channels[i] = true;
  const v = COURT.valves[i];
  const flow = flowTime(sim.cfg);
  if (w.flows) w.flows[i] = flow;
  events.push({ type: 'valveTurn', index: i, x: v.x, z: v.z, flow });
  const bed = FEEDS[i];
  if (!w.beds[bed]) {
    w.beds[bed] = true;
    events.push({ type: 'bedTurn', index: bed, red: true });
  }
  if (first) {
    w.phase = 'awake';
    events.push({ type: 'wake' });
    addEntry(sim, 'firstTurn', events);
  }
  callNext(sim, i, events);
  const j = SLAMS[i];
  if (j != null && w.valves[j]) shut(sim, j, events);
  if (bedsRed(w)) {
    w.done.roses = true;
    w.phase = 'open';
    events.push({ type: 'rosesSolved' });
    addEntry(sim, 'fountain', events);
  }
  refreshBlockers(sim);
  return true;
}

/** The water in rill i lands now: its flow timer is cleared and waterArrive { index, bed } emitted. */
export function finishFlow(sim, i, events) {
  const w = sim.waves;
  if (!w.flows || !(w.flows[i] > 0)) return false;
  w.flows[i] = 0;
  events.push({ type: 'waterArrive', index: i, bed: FEEDS[i] });
  return true;
}

/** Runs every rill's water on by dt; each that reaches its bed emits waterArrive. */
export function stepFlows(sim, dt, events) {
  const w = sim.waves;
  if (!w || !w.flows) return;
  for (let i = 0; i < w.flows.length; i++) {
    if (!(w.flows[i] > 0)) continue;
    w.flows[i] -= dt;
    if (w.flows[i] <= 1e-9) {
      w.flows[i] = 0;
      events.push({ type: 'waterArrive', index: i, bed: FEEDS[i] });
    }
  }
}

/** Writes the log line the first time an awake figure stands at a running rill. */
export function noteWater(sim, events) {
  const w = sim.waves;
  if (w.index !== 0 || w.phase === 'still' || w.log.includes('water')) return;
  const running = COURT.rills.filter((r, i) => w.channels[i]);
  if (!running.length) return;
  for (const e of sim.enemies) {
    if (e.dead || e.state === 'still') continue;
    const r = sim.cfg[e.type].radius + 0.35;
    if (circleBlocked(e.x, e.z, r, running)) {
      addEntry(sim, 'water', events);
      return;
    }
  }
}
