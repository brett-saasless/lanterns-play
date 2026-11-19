// The Count's room as rules (R14, R15, G9): the rise clock, the three curtains three ways (the
// tangled cord held with E, the padlock shot with salt, the three hem nails shot with stakes),
// the recoil and the slowing for each shaft of dawn, the lurch, the bite and the burning; the
// castle's cut scenes (`strike`, `pyre` and `triumph`) and their stages; and which deaths count
// toward his rise. Issue #7: the cord's curtain is the middle window's and opens only last, once
// both side curtains are open; its shaft burns him. Issue #8: a stake at him glances off
// (stakeGlance), and a death in his room picks the plain line for the next shut curtain
// (countHint). Issue #20: at the middle window after the dawn the triumph plays (the light, then
// THE END) and leaves count.cheered, after which keep.js ends the level.
//
// State is sim.waves.count: { rise, open[3], cord, lock, nails[3], phase, still, stirred,
// lurchLeft, away, relurched, bitten, cheered, lost }. lost: the seconds of rise the recoils actually took (a recoil at a rise under 4 s takes only what there was); countlid.js runs the lid on rise + lost, a record only, read by nothing in the rules. phase is 'box' (asleep, the warden not yet in), 'rising', 'lurch',
// 'burning' (the pyre scene plays) or 'ash' (done.dawn). The rise clock advances only while the
// warden is inside the Count's room (security A1): outside it the clock and his pose hold, and
// re-entry resumes, so countStir fires once per life. The lurch is entered only with the warden
// in the room. How long he takes to rise is derived, never stored: 75 s plus 10 s for each death
// in his room (sim.waves.game.countDeaths), at most 105 s (riseLimit).
//
// Scenes (security A4): sim.waves.scene carries `skippable`, true for `strike`, false for
// `pyre`. stepScene consults it before it reads any input; the pyre also latches interact and
// hold at its start, so a key still down from the third curtain never reaches the scene or the
// first frame after it (the latch rides out on sceneEnd for the encounter's press tracking).

import { hurtPlayer } from './enemy.js';
import { floorZoneAt, CURTAIN_TARGETS, ZONES, COUNT_ROOM, MIDDLE_CURTAIN } from './keepmap.js';

/** keepmap.js's zone id for the Count's room. */
export const COUNT_ZONE = 'count';

/** The Count's room's floor height (keepmap.js), which the curtain targets' heights stand on. */
export const COUNT_FLOOR = (ZONES.find((z) => z.id === COUNT_ZONE) || { y: 0 }).y;

/** Starting values from the design's Numbers table; CASTLE_CONFIG.count overrides any of them. */
export const COUNT_TUNE = Object.freeze({
  rise: 75, // seconds of rising with nothing done
  perDeath: 10, // more for each death in his room (G9)
  riseMax: 105,
  recoil: 4, // seconds of rising lost to a shaft of dawn
  recoilHold: 1.5, // seconds held still by it
  pace: Object.freeze([1, 0.8, 0.6]), // his pace with none, one, two curtains open
  cord: 4, // seconds of holding E in all
  lock: 120, // salt damage the padlock takes (two fair blasts)
  nailRadius: 0.18, // metres: each nail as a target
  // metres: the padlock as a target. Sized so two fair salt blasts from the room's ordinary
  // range (6 m) put all fourteen pellets on it (6 tan 5 degrees is 0.525 m): 126 of its 120.
  lockRadius: 0.55,
  lurch: 1.2, // seconds across the room before the bite
  // Issue #8: a stake at him glances off. Metres: how near his middle a stake must pass, and how
  // far back along its flight it comes down. hintDeaths: deaths in his room before the first
  // plain line is written (the 210 s ladder never reaches him: he lurches at 75 s).
  glanceRadius: 0.45,
  glanceBack: 1.2,
  hintDeaths: 1,
});

/**
 * The castle's cut scenes: how long each is and whether it can be ended early (R7, R15, A4).
 * `triumph` (issue #20) plays when the warden reaches the middle window after the dawn: the
 * light, then THE END, then the level ends and the closing card shows. It cannot be ended early.
 */
export const SCENE_TUNE = Object.freeze({ strike: 6, pyre: 10, triumph: 8 });
export const SCENE_KINDS = Object.freeze({
  strike: Object.freeze({ skippable: true }),
  pyre: Object.freeze({ skippable: false }),
  triumph: Object.freeze({ skippable: false }),
});

/** The triumph's stages by seconds into the scene: the warden in the light, then THE END. */
export const TRIUMPH_STAGES = Object.freeze([
  Object.freeze({ stage: 'light', from: 0 }),
  Object.freeze({ stage: 'end', from: 4 }),
]);

/** The pyre's stages by seconds into the scene (the view stages fire, shades and ash from these). */
export const PYRE_STAGES = Object.freeze([
  Object.freeze({ stage: 'scream', from: 0 }),
  Object.freeze({ stage: 'burn', from: 1.5 }),
  Object.freeze({ stage: 'shades', from: 4 }),
  Object.freeze({ stage: 'whirl', from: 6.5 }),
  Object.freeze({ stage: 'ash', from: 8.5 }),
]);

const PYRE_SHADES = PYRE_STAGES.find((p) => p.stage === 'shades').from;

/** Which curtain opens which way: 0 the cord, 1 the padlock, 2 the nails (UX flow, R14). */
export const CURTAIN_WAYS = Object.freeze(['cord', 'lock', 'nails']);

/**
 * Issue #7: the middle window's curtain (keepmap.js, the cord's) is the last to open. It cannot
 * be worked until both side curtains are open; its shaft falls on the box and starts the burning.
 */
export const FINAL_CURTAIN = MIDDLE_CURTAIN;
// The cord is the middle curtain's way (pullCord works the middle one): keepmap must agree.
if (CURTAIN_WAYS[FINAL_CURTAIN] !== 'cord') throw new Error('count.js: the middle curtain must be the cord\'s (keepmap COUNT_ROOM)');
const SIDES = Object.freeze(CURTAIN_WAYS.map((_, i) => i).filter((i) => i !== FINAL_CURTAIN));

/** The order the curtains are worked in (the raven's and the hints'): the sides by index, then the middle. */
export const CURTAIN_ORDER = Object.freeze([...SIDES, FINAL_CURTAIN]);

/** The warden's-log key of each curtain's plain line (script.js ENTRIES), by curtain (issue #8). */
export const CURTAIN_PLAIN = Object.freeze(['plainCord', 'plainLock', 'plainNails']);

/** True when curtain i can be worked now (shut, and for the middle one, both sides open). */
export function curtainReady(c, i) {
  if (!c || !Array.isArray(c.open) || c.open[i]) return false;
  return i !== FINAL_CURTAIN || SIDES.every((k) => c.open[k]);
}

/** The next curtain to work, in CURTAIN_ORDER, or null when all are open (the raven goes there). */
export function nextCurtain(c) {
  if (!c || !Array.isArray(c.open)) return null;
  const i = CURTAIN_ORDER.find((k) => !c.open[k]);
  return i == null ? null : i;
}

const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const tuneOf = (cfg) => ({ ...COUNT_TUNE, ...((cfg && cfg.count) || {}) });
const sceneLen = (cfg, kind) => {
  const s = cfg && cfg.scenes;
  return s && Number.isFinite(s[kind]) ? s[kind] : SCENE_TUNE[kind];
};

/** Seconds he takes to rise in a game with `deaths` deaths in his room: 75 + 10 each, at most 105. */
export function riseLimit(cfg, deaths = 0) {
  const t = tuneOf(cfg);
  const n = Number.isFinite(deaths) && deaths > 0 ? Math.floor(deaths) : 0;
  return Math.min(t.riseMax, t.rise + t.perDeath * n);
}

/** The room as it is after a death or on first entry: shut, him in his box; ash once done.dawn (R18). */
export function createCount(done = null) {
  return {
    rise: 0,
    open: [false, false, false],
    cord: 0,
    lock: 0,
    nails: [false, false, false],
    phase: done && done.dawn ? 'ash' : 'box',
    still: 0,
    stirred: false,
    lurchLeft: 0,
    away: false, // the warden left during the lurch
    relurched: false, // this lurch has already been met afresh once on a return
    bitten: false,
    cheered: false, // the triumph has played (issue #20): the level ends on the next frame
    lost: 0, // seconds of rise the recoils have taken (countlid.js lidClock); nothing here reads it
  };
}

const deathsOf = (w) => (w && w.game && Number.isFinite(w.game.countDeaths) ? w.game.countDeaths : 0);
const openCount = (c) => c.open.filter(Boolean).length;

/** How far he has risen, 0 to 1, and the pose that reads across the room (lid, hand, sit, stand). */
export function poseOf(sim) {
  const w = sim.waves;
  const c = w.count;
  if (c.phase === 'box') return { part: 0, pose: 'box' };
  if (c.phase === 'lurch' || c.phase === 'burning' || c.phase === 'ash') return { part: 1, pose: c.phase };
  const part = Math.min(1, c.rise / riseLimit(sim.cfg, deathsOf(w)));
  const pose = part < 0.25 ? 'lid' : part < 0.5 ? 'hand' : part < 0.75 ? 'sit' : 'stand';
  return { part, pose };
}

/** His pace now: 1, then 0.8 with one curtain open, 0.6 with two. */
export function paceOf(sim) {
  const t = tuneOf(sim.cfg);
  return t.pace[Math.min(openCount(sim.waves.count), t.pace.length - 1)];
}

function firstShut(c) {
  return c.open.findIndex((o) => !o);
}

/**
 * True when the warden stands inside the Count's room: keepmap.js's zone query at the warden's
 * position (the one answer for every floor, security A3), so A1 and A8 rest on where the warden
 * is, never on a flag a caller passes.
 */
export function inCountRoom(sim) {
  const pl = sim && sim.player;
  if (!pl || !Number.isFinite(pl.x) || !Number.isFinite(pl.z)) return false;
  return floorZoneAt(pl.x, pl.z, Number.isFinite(pl.y) ? pl.y : 0, sim.waves || null).zone === COUNT_ZONE;
}

/**
 * One frame of the Count's room. Outside the room (inCountRoom) nothing moves (A1). Inside:
 * the first frame of a life stirs him (countStir, once); rising advances `rise` at his pace
 * unless a shaft holds him still; at the limit with a curtain shut he lurches (countLurch), and
 * the lurch ends in the bite (countBite), which kills the warden. A warden who left during the
 * lurch and comes back meets it from its start once (the full lurch time and countLurch again,
 * then `relurched`); any later return in the same lurch resumes the time left, so hopping the
 * door cannot hold him off. No curtain can be worked during the lurch (working()).
 */
export function stepCount(sim, dt, events) {
  const w = sim.waves;
  const c = w && w.count;
  if (!c || sim.player.dead) return;
  if (!inCountRoom(sim)) {
    if (c.phase === 'lurch' && !c.bitten) c.away = true;
    return;
  }
  const t = tuneOf(sim.cfg);
  if (c.phase === 'lurch' && c.away && !c.bitten) {
    c.away = false;
    if (!c.relurched) {
      c.relurched = true;
      c.lurchLeft = t.lurch;
      events.push({ type: 'countLurch', rise: c.rise, curtain: firstShut(c) });
      return;
    }
  }
  if (c.phase === 'box') {
    if (c.stirred) return;
    c.stirred = true;
    c.phase = 'rising';
    events.push({ type: 'countStir', rise: c.rise, curtain: null });
    return;
  }
  if (c.phase === 'rising') {
    if (c.still > 0) {
      c.still = Math.max(0, c.still - dt);
      return;
    }
    c.rise += dt * paceOf(sim);
    const limit = riseLimit(sim.cfg, deathsOf(w));
    if (c.rise >= limit) {
      c.rise = limit;
      c.phase = 'lurch';
      c.lurchLeft = t.lurch;
      events.push({ type: 'countLurch', rise: c.rise, curtain: firstShut(c) });
    }
    return;
  }
  if (c.phase === 'lurch' && !c.bitten) {
    c.lurchLeft -= dt;
    if (c.lurchLeft > 0) return;
    c.lurchLeft = 0;
    c.bitten = true;
    events.push({ type: 'countBite', rise: c.rise, curtain: firstShut(c) });
    const pl = sim.player;
    pl.grace = 0; // nothing outlasts the bite
    hurtPlayer(sim, pl.health, pl.x, pl.z, events);
  }
}

/**
 * True while a curtain can still be opened: he is rising and the warden is alive. Once he
 * lurches out it is too late: a curtain still shut then means the bite (R14).
 */
function working(sim) {
  const c = sim.waves.count;
  return !sim.player.dead && c.phase === 'rising' && !c.bitten;
}

/**
 * Curtain i falls open by way `by`: curtainOpen { curtain, by }. A side curtain's shaft throws
 * him back while he is rising (countRecoil { rise, curtain }): recoil seconds of rising lost and
 * recoilHold held still, then he rises at his slower pace. The middle curtain, last (#7), falls
 * square on him and burns him at once: phase 'burning' and the pyre scene starts.
 */
function openCurtain(sim, i, by, events, input) {
  const c = sim.waves.count;
  if (!curtainReady(c, i)) return false;
  const t = tuneOf(sim.cfg);
  c.open[i] = true;
  events.push({ type: 'curtainOpen', curtain: i, by });
  if (i === FINAL_CURTAIN) {
    c.phase = 'burning';
    c.still = 0;
    c.lurchLeft = 0;
    startScene(sim, 'pyre', input, events);
    return true;
  }
  if (c.phase === 'rising') {
    const before = c.rise;
    c.rise = Math.max(0, c.rise - t.recoil);
    c.lost = (Number.isFinite(c.lost) ? c.lost : 0) + (before - c.rise);
    c.still = t.recoilHold;
    events.push({ type: 'countRecoil', rise: c.rise, curtain: i });
  }
  return true;
}

/**
 * E held on the tangled cord for dt seconds (keep.js calls it only for a hold the sim observed
 * from a fresh press, A6). Letting go keeps what was pulled. At cfg.count.cord seconds in all
 * the middle curtain runs free. While a side curtain is shut the cord does not give: nothing is
 * pulled (#7). Returns true on the frame it opens.
 */
export function pullCord(sim, dt, events, input = null) {
  const c = sim.waves.count;
  if (!working(sim) || !curtainReady(c, FINAL_CURTAIN) || !(dt > 0)) return false;
  c.cord = Math.min(tuneOf(sim.cfg).cord, c.cord + dt);
  if (c.cord < tuneOf(sim.cfg).cord) return false;
  return openCurtain(sim, FINAL_CURTAIN, 'cord', events, input);
}

/** Salt damage on the padlock (any other weapon does nothing). At 120 the bar falls and the second curtain opens. */
export function hitLock(sim, damage, weapon, events, input = null) {
  const c = sim.waves.count;
  if (!working(sim) || !curtainReady(c, 1) || weapon !== 'bore' || !(damage > 0)) return false;
  c.lock = Math.min(tuneOf(sim.cfg).lock, c.lock + damage);
  if (c.lock < tuneOf(sim.cfg).lock) return false;
  return openCurtain(sim, 1, 'lock', events, input);
}

/** A stake on hem nail n (0 to 2; any other weapon does nothing). The third nail out opens the third curtain. */
export function hitNail(sim, n, weapon, events, input = null) {
  const c = sim.waves.count;
  if (!working(sim) || !curtainReady(c, 2) || weapon !== 'crossbow' || !Number.isInteger(n) || n < 0 || n > 2 || c.nails[n]) return false;
  c.nails[n] = true;
  if (!c.nails.every(Boolean)) return false;
  return openCurtain(sim, 2, 'nails', events, input);
}

function segDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz || 1;
  const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len2));
  return Math.hypot(a.x + dx * k - p.x, a.y + dy * k - p.y, a.z + dz * k - p.z);
}

/**
 * Reads this frame's shots against the curtains. places: { lock: {x,y,z}, nails: [{x,y,z} x3] },
 * by default keepmap.js's CURTAIN_TARGETS, whose y is a height above the room's floor (keepprops
 * draws them there): every target is tested at floor + y, the floor being the Count's room's
 * own (5 m, upstairs) unless `floor` says otherwise. A salt pellet passing within lockRadius of
 * the padlock deals the salt gun's pellet damage to it; a stake passing within nailRadius of a
 * nail still in takes it out. A stake that met no nail drops to that floor beneath where it
 * struck, to be taken again (R13). Call after the shot is fired, in the same frame.
 */
export function shotsAtCurtains(sim, events, places = CURTAIN_TARGETS, input = null, floor = COUNT_FLOOR) {
  if (!places || !sim.waves.count) return;
  const t = tuneOf(sim.cfg);
  const lift = (p) => ({ x: p.x, y: floor + p.y, z: p.z });
  places = { lock: places.lock ? lift(places.lock) : null, nails: (places.nails || []).map(lift) };
  const n = events.length;
  for (let k = 0; k < n; k++) {
    const ev = events[k];
    if (ev.type !== 'shot' || !ev.from) continue;
    if (ev.weapon === 'bore' && places.lock) {
      const ends = ev.pellets && ev.pellets.length ? ev.pellets.map((p) => p.to) : [ev.to];
      const near = ends.filter((to) => to && segDist(places.lock, ev.from, to) <= t.lockRadius).length;
      const per = sim.cfg.weapons && sim.cfg.weapons.bore ? sim.cfg.weapons.bore.damage : 9;
      if (near) hitLock(sim, near * per, 'bore', events, input);
    } else if (ev.weapon === 'crossbow' && ev.to) {
      let struck = false;
      (places.nails || []).forEach((p, i) => {
        if (!struck && !sim.waves.count.nails[i] && segDist(p, ev.from, ev.to) <= t.nailRadius) {
          struck = true;
          hitNail(sim, i, 'crossbow', events, input);
        }
      });
      if (!struck && glancesOff(sim, ev, floor)) glanceStake(sim, events, k, ev, floor);
      else if (!struck) dropStake(sim, events, k, floor);
    }
  }
}

// ---- issue #8: a stake at the Count glances off him ---------------------------------------------

/** His middle as a target: a vertical segment over the box, from its rim to as high as he has risen. */
function countAxis(sim, floor) {
  const at = COUNT_ROOM.boxAt;
  const rim = floor + COUNT_ROOM.box.h;
  return { a: { x: at.x, y: rim, z: at.z }, b: { x: at.x, y: rim + 0.2 + 0.9 * poseOf(sim).part, z: at.z } };
}

/**
 * Distance from the flight p0-p1 to his vertical axis a-b (a below b, same x and z): on the plan
 * the flight's closest approach to the axis, and above or below the axis's ends by however far
 * the flight is there. Closed form, so a long shot across the room is judged as finely as a short one.
 */
function segAxis(p0, p1, a, b) {
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const len2 = dx * dx + dz * dz;
  const k = len2 > 0 ? Math.max(0, Math.min(1, ((a.x - p0.x) * dx + (a.z - p0.z) * dz) / len2)) : 0;
  const plan = Math.hypot(p0.x + dx * k - a.x, p0.z + dz * k - a.z);
  const y = p0.y + (p1.y - p0.y) * k;
  return Math.hypot(plan, Math.max(0, a.y - y, y - b.y));
}

/** True when a crossbow shot passed through him while he is up (rising or lurching): stakes do him no harm. */
function glancesOff(sim, ev, floor) {
  const c = sim.waves.count;
  if (!c || (c.phase !== 'rising' && c.phase !== 'lurch') || !ev.to) return false;
  const { a, b } = countAxis(sim, floor);
  return segAxis(ev.from, ev.to, a, b) <= tuneOf(sim.cfg).glanceRadius;
}

/**
 * The stake glanced off him (stakeGlance { x, z, on: 'count' }): the stake the shot lodged comes
 * down on the room floor glanceBack metres short of him along its flight, to be taken again.
 */
function glanceStake(sim, events, k, ev, floor) {
  const at = COUNT_ROOM.boxAt;
  const t = tuneOf(sim.cfg);
  const dx = ev.to.x - ev.from.x;
  const dz = ev.to.z - ev.from.z;
  const len = Math.hypot(dx, dz) || 1;
  // The closest point of the flight to him, on the plan, then back toward the warden.
  const k2 = Math.max(0, Math.min(1, ((at.x - ev.from.x) * dx + (at.z - ev.from.z) * dz) / (len * len)));
  const box = COUNT_ROOM.box;
  let x = ev.from.x + dx * k2 - (dx / len) * t.glanceBack;
  let z = ev.from.z + dz * k2 - (dz / len) * t.glanceBack;
  for (let i = 0; i < 20 && x > box.minX - 0.2 && x < box.maxX + 0.2 && z > box.minZ - 0.2 && z < box.maxZ + 0.2; i++) {
    x -= (dx / len) * 0.25;
    z -= (dz / len) * 0.25;
  }
  events.push({ type: 'stakeGlance', x, z, on: 'count' });
  const lodge = events.slice(k + 1).find((e) => e.type === 'stakeLodge');
  if (!lodge || !Array.isArray(sim.waves.stakes)) return;
  const s = sim.waves.stakes.find((q) => q.id === lodge.id);
  if (!s || s.state !== 'standing') return;
  s.x = x;
  s.y = floor;
  s.z = z;
}

/**
 * Issue #8: the plain line a death in his room writes (keep.js calls it after countDeath counted
 * that death, before the room is shut again): the next curtain still shut at the bite, in
 * CURTAIN_ORDER, whose line is not yet in the log; once deaths in his room reach hintDeaths.
 * Null when there is nothing to write.
 */
export function countHint(sim) {
  const w = sim && sim.waves;
  const c = w && w.count;
  if (!c || !Array.isArray(c.open) || deathsOf(w) < tuneOf(sim.cfg).hintDeaths) return null;
  const log = Array.isArray(w.log) ? w.log : [];
  for (const i of CURTAIN_ORDER) if (!c.open[i] && !log.includes(CURTAIN_PLAIN[i])) return CURTAIN_PLAIN[i];
  return null;
}

/** The stake the shot at index k lodged (the next stakeLodge after it) comes down to the floor. */
function dropStake(sim, events, k, floor) {
  const lodge = events.slice(k + 1).find((e) => e.type === 'stakeLodge');
  if (!lodge || !Array.isArray(sim.waves.stakes)) return;
  const s = sim.waves.stakes.find((q) => q.id === lodge.id);
  if (!s || s.state !== 'standing') return;
  s.y = floor;
}

/**
 * A death has happened (A8, G9): it counts toward his rise only when the warden died inside
 * his room (inCountRoom, at the warden's position as the death is seen, before any restore)
 * and he is not yet ash. Returns true when counted.
 */
export function countDeath(sim) {
  const w = sim.waves;
  if (!w || (w.done && w.done.dawn) || !inCountRoom(sim)) return false;
  if (!w.game) w.game = { chessDeaths: 0, countDeaths: 0 };
  w.game.countDeaths = deathsOf(w) + 1;
  return true;
}

// ---- the castle's cut scenes ----------------------------------------------------------------

/**
 * Starts scene `kind` ('strike', 'pyre' or 'triumph'): sim.waves.scene = { kind, left, total, t,
 * skippable, fireHeld, latch, theEnd? } and sceneStart { kind }. latch (the pyre only, A4) holds
 * interact and hold from the frame it starts until each is let go. theEnd: the triumph only (#20).
 */
export function startScene(sim, kind, input, events) {
  if (!own(SCENE_KINDS, kind)) return null;
  const w = sim.waves;
  const s = {
    kind,
    left: sceneLen(sim.cfg, kind),
    total: sceneLen(sim.cfg, kind),
    t: 0,
    skippable: SCENE_KINDS[kind].skippable,
    fireHeld: !!(input && input.fire),
    latch: kind === 'pyre' ? { interact: true, hold: true } : null,
  };
  if (kind === 'triumph') s.theEnd = false; // THE END is up (issue #20): the view shows the banner while true
  w.scene = s;
  events.push({ type: 'sceneStart', kind });
  return s;
}

/**
 * One frame of the castle's scene, or false when none plays (keep.js calls it first in its
 * frame and returns when it is true, the shipped freeze). skippable is consulted before any
 * input is read: a skippable scene ends on interact, a fresh fire, jump or skip; the pyre reads
 * no input to end and runs its full length. On its end: sceneEnd { kind, latch } once, and the
 * pyre leaves him ash (count.phase 'ash', done.dawn).
 */
export function stepScene(sim, input, dt, events) {
  const w = sim.waves;
  const s = w && w.scene;
  if (!s || !own(SCENE_KINDS, s.kind)) return false;
  const before = s.t;
  s.left -= dt;
  s.t += dt;
  // Owner Q12: the demon spirits howl as they claw out of him and escape, once, as the pyre
  // reaches its shades stage (the cue runs on through the whirl and out of the window).
  if (s.kind === 'pyre' && before < PYRE_SHADES && s.t >= PYRE_SHADES) events.push({ type: 'shadesHowl' });
  let skip = false;
  if (s.skippable) {
    const fire = !!(input && input.fire);
    if (s.fireHeld && !fire) s.fireHeld = false;
    skip = !!(input && (input.interact || (fire && !s.fireHeld) || input.jump || input.skip));
  } else if (s.latch) {
    // Held keys stay latched until released; they never end the scene either way.
    if (!(input && input.interact)) s.latch.interact = false;
    if (!(input && input.hold)) s.latch.hold = false;
  }
  if (s.kind === 'triumph' && triumphStage(s) === 'end') s.theEnd = true;
  if (!skip && s.left > 0) return true;
  w.scene = null;
  if (s.kind === 'pyre') {
    if (w.count) w.count.phase = 'ash';
    if (w.done) w.done.dawn = true;
    // K11: the view hands back to a warden turned to the light, square on to the east windows
    // (yaw 0 looks down -z), so the camera's ease out of the scene ends on the middle window
    if (sim.player) { sim.player.yaw = -Math.PI / 2; sim.player.pitch = 0; }
  }
  if (s.kind === 'triumph' && w.count) w.count.cheered = true;
  const ev = { type: 'sceneEnd', kind: s.kind };
  if (s.latch) ev.latch = { interact: s.latch.interact, hold: s.latch.hold };
  events.push(ev);
  return true;
}

/** The triumph's stage now ('light', 'end'), or null when no triumph plays (issue #20). */
export function triumphStage(scene) {
  if (!scene || scene.kind !== 'triumph') return null;
  let out = TRIUMPH_STAGES[0].stage;
  for (const p of TRIUMPH_STAGES) if (scene.t >= p.from) out = p.stage;
  return out;
}

/** The pyre's stage now ('scream', 'burn', 'shades', 'whirl', 'ash'), or null when no pyre plays. */
export function pyreStage(scene) {
  if (!scene || scene.kind !== 'pyre') return null;
  let out = PYRE_STAGES[0].stage;
  for (const p of PYRE_STAGES) if (scene.t >= p.from) out = p.stage;
  return out;
}
