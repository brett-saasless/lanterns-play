// The harpoon contest (R5, R22; Numbers): three rounds, one barrel a round, nearest first; each
// barrel's bob and drift are sines of sim time (contest.barrelAt), so the view and the hit test
// read the one value and no random number is drawn. Ned Land's throws are fixed (hit, hit, miss);
// the tally of barrels hit; win on three of three, a loss costs nothing and restarts. Pure.

import { PLACES } from './dockmap.js';

const MARK = PLACES.contestMark;

/** A fresh contest: round 0, nothing thrown yet. */
export function createContest() {
  return { active: false, round: 0, nedHits: [], wardenHits: [], nedStuck: [false, false, false], wardenStuck: [false, false, false], won: false };
}

/** Starts (or restarts, "fresh barrels") the contest at round 0. */
export function startContest(c) {
  c.active = true;
  c.round = 0;
  c.nedHits = [];
  c.wardenHits = [];
  c.nedStuck = [false, false, false];
  c.wardenStuck = [false, false, false];
  c.won = false;
}

/**
 * The barrel of `round` (0 to 2) at sim time `t`: its place, bobbing up and down
 * (cfg.contest.bobPeriod, bobAmplitude) and, past the nearest, drifting side to side
 * (cfg.contest.drift[round] each way, over driftPeriod). y is the bob alone (height above the
 * water); the hit test (dock.js, against harpoon.stepFlight's position) uses x, y, z and
 * cfg.contest.hitRadius.
 */
export function barrelAt(round, t, cfg) {
  const C = cfg.contest;
  const dist = C.distances[round];
  const bob = Math.sin((2 * Math.PI * t) / C.bobPeriod) * C.bobAmplitude;
  const amt = C.drift[round] || 0;
  const drift = amt > 0 ? Math.sin((2 * Math.PI * t) / C.driftPeriod) * amt : 0;
  return { x: MARK.x + drift, y: bob, z: MARK.z - dist };
}

/** Ned's throw for the current round (cfg.contest.nedHits[round]): records the hit and whether his iron stands in the barrel. */
export function nedThrow(c, cfg) {
  const hit = !!cfg.contest.nedHits[c.round];
  c.nedHits.push(hit);
  c.nedStuck[c.round] = hit;
  return hit;
}

/** The warden's result for the current round: records it, moves to the next (or finishes at 3). */
export function wardenThrow(c, hit) {
  c.wardenHits.push(!!hit);
  c.wardenStuck[c.round] = !!hit;
  const done = c.round >= 2;
  if (!done) c.round += 1;
  else c.won = c.wardenHits.filter(Boolean).length >= 3;
  return done;
}

/** True once all three rounds have been thrown both ways. */
export function finished(c) {
  return c.wardenHits.length >= 3 && c.nedHits.length >= 3;
}

/** The notice line's tally: Ned's barrels hit, the warden's (script.js NOTICES "notice, score"). */
export function tally(c) {
  return { ned: c.nedHits.filter(Boolean).length, warden: c.wardenHits.filter(Boolean).length };
}
