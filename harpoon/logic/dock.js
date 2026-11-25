// The dock encounter (cfg.encounter 'dock', docs/features/sea-1-dock/02-design.md): five stages
// (0 arrived, 1 harpoon won, 2 signed on, 3 nailed, 4 cast off), what E is looking at, what E and
// the fire button do, the arrival (journey.js seatCarry over the title kit, since the dock has no
// weapon allow-list of its own that the yard's nameless carbine could ever match - security A2
// is journey.js's own, as the claim trace records), the stowed kit, the water dunk, the hint
// ladder, the two scenes (the scare plays inline, not a status-frozen scene; cast-off does), and
// the end (castOff finishing hands the run to main.js's shipped "won" path, R10). No checkpoints
// (the design's own decision: nothing kills the warden here, and nothing is stored).
// State lives in sim.waves; `under` is derived from position by dockmap.js floorZoneAt (A3, as
// the castle's). Rules for each sub-system live in their own pure files (harpoon, contest,
// proofs, doubloon, mate, dawn); this file seats them, calls them, and turns their results into
// events and sim fields.

import {
  PLACES, CLIPPINGS, KNOT_PEGS, LAY_SPOTS, KNOTS, LAY_TICKETS, inWater, zoneAt, floorZoneAt,
} from './dockmap.js';
import { DOCK_NOTICE_TEMPLATES, DOCK_KNOT_NAMES, DOCK_LAY_NAMES } from './script.js';
import { createHarpoon, aim as aimHarpoon, throwIron, stepFlight, land as landHarpoon, startHaul, stepHaul } from './harpoon.js';
import { createContest, startContest, barrelAt, nedThrow, wardenThrow, finished as contestFinished, tally } from './contest.js';
import { createProofs, takeKnot, takeLay, takeLog, readClipping, rightness, missing as proofsMissing, allRight } from './proofs.js';
import { createGlass, raise as raiseGlass, lower as lowerGlass, stepCollar, stepHold } from './doubloon.js';
import { createMate, stepMate } from './mate.js';
import { stepDawn } from './dawn.js';
import { createWeapon } from './weapon.js';
import { speak, addEntry } from './journal.js';
import { talkTo, greet, talkState } from './talk.js';
import { seatCarry } from './journey.js';

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const DOCK_SPEAK_REACH = 7;
const MARK_RADIUS = 3; // metres of the contest mark the warden must stand within to throw its iron
const WATER_Y = -0.3; // below this, a thrown iron that struck nothing has gone into the sea (a miss)

/** A fresh dock state (resetSim). */
export function createDock(cfg, rng = () => 0.5) {
  return {
    stage: 0,
    kit: 'slung',
    contest: createContest(),
    contestPhase: null, // null | 'nedThrown' | 'hauling'
    harpoon: createHarpoon('none', PLACES.contestMark),
    proofs: createProofs(),
    mate: null, // created once Queequeg is won
    scare: { armed: false, played: false, t: 0, surfaceT: 0, x: PLACES.burstSpot.x, z: PLACES.burstSpot.z },
    glass: createGlass(),
    dawn: 0,
    talk: {},
    log: [],
    hints: { proofsIdle: 0, proofsRung: false, glassIdle: 0, glassRung: 0 },
    scene: null, // the cast-off scene; the scare plays inline (status stays 'playing')
    latch: null,
    under: null,
    notice: null,
    line: null,
    boatFarSeen: false,
    dunkCool: 0,
    hush: 0, // the tavern's murmur (R7, Numbers): 0 full, 1 hushed; see stepTavernHush
  };
}

// ---- floor and collision (security A3, as the castle's) ---------------------------------------

export function dockFloor(sim, x, z, y) {
  return floorZoneAt(x, z, y).floor;
}

export function dockGround(sim) {
  const w = sim.waves;
  const pl = sim.player;
  const under = floorZoneAt(pl.x, pl.z, pl.y).under;
  if (under !== w.under) {
    w.under = under;
    sim.boxes = dockBoxes(sim.cfg, w);
  }
}

/** Live collision: the plan's walls, rails and named props - all always solid; nothing swaps by floor on the dock (the stage under the pier and the deck are reached by their own ramps, not a door). */
export function dockBoxes(cfg, w) {
  return [...cfg.boxes];
}

// ---- kit -----------------------------------------------------------------------------------

function seatTitle(sim) {
  const { cfg, waves: w } = sim;
  sim.weapon = createWeapon(cfg, cfg.weapons.carbine);
  sim.holster = null;
  sim.rack = [];
  sim.player.health = cfg.titleKit.health;
  w.log = ['dockArrive'];
  w.kit = 'slung';
}

/** The breach's arrival (R1, G1): seats the title kit, then overlays what was carried (health, log) - journey.js seatCarry, as the yard's own hand-overs do. No weapon of the yard's ever matches the dock's allow-list by name (A2, the claim trace), so the carbine always starts fresh and slung. */
export function arrive(sim, carry) {
  if (!sim || !sim.cfg || sim.cfg.encounter !== 'dock') return [];
  seatTitle(sim);
  if (carry) seatCarry(sim, carry);
  return [];
}

/** Drops the carbine from hand at signing on (R3): only the harpoon is ever carried again. */
function stowCarbine(sim) {
  sim.weapon = sim.rack && sim.rack.length ? sim.rack[0] : sim.weapon;
  if (sim.weapon && sim.weapon.name === 'carbine') sim.weapon = null;
  sim.holster = null;
  sim.rack = [];
  sim.waves.kit = 'stowed';
}

// ---- focus (what E would act on) -------------------------------------------------------------

function within(player, x, z, reach) {
  return Math.hypot(player.x - x, player.z - z) <= reach;
}

/**
 * The one thing E would act on, or null: { kind, verb, x, z, ...extra }. Throwing the harpoon is
 * the fire button (contest barrels, the boat, the monster), never E: focusOf never offers 'throw'.
 * Candidates are scored by distance alone (as keep.js's consider, less the facing cone, which
 * the dock's tight clusters - the knot pegs 0.3 m apart, the lay tickets 0.25 m apart - need: the
 * nearest one wins, never whichever happens to be listed first.
 */
export function focusOf(sim) {
  const { cfg, player: pl, waves: w } = sim;
  if (!w || pl.dead || w.scene) return null;
  const ic = cfg.interact;
  let best = null;
  let bestD = Infinity;
  const consider = (cand, x, z, reach) => {
    const d = Math.hypot(pl.x - x, pl.z - z);
    if (d > reach || d >= bestD) return;
    bestD = d;
    best = { ...cand, x, z };
  };

  consider({ kind: 'elijah', verb: 'speak' }, PLACES.gangwayFoot.x, PLACES.gangwayFoot.z, DOCK_SPEAK_REACH);
  if (w.stage < 2) {
    for (const peg of KNOT_PEGS) consider({ kind: 'knot', verb: 'take', name: peg.name }, peg.x, peg.z, ic.reach);
    for (const spot of LAY_SPOTS) consider({ kind: 'lay', verb: 'take', key: spot.key }, spot.x, spot.z, ic.reach);
  }
  for (const c of CLIPPINGS) {
    if (w.proofs.clippings.includes(c.key)) continue;
    consider({ kind: 'clipping', verb: 'read', key: c.key }, c.x, c.z, ic.reach);
  }
  consider({ kind: 'peleg', verb: 'speak' }, PLACES.gangwayHead.x, PLACES.gangwayHead.z, DOCK_SPEAK_REACH);
  if (best) return best;
  if (w.stage < 1 && within(pl, PLACES.contestMark.x, PLACES.contestMark.z, DOCK_SPEAK_REACH)) {
    return { kind: 'ned', verb: 'speak', x: PLACES.contestMark.x, z: PLACES.contestMark.z };
  }
  if (!w.proofs.log && w.harpoon.stands && w.harpoon.stands.target === 'boat') {
    return { kind: 'boat', verb: 'haul', x: PLACES.logBoat.x, z: PLACES.logBoat.z };
  }
  if (!w.proofs.log && within(pl, PLACES.logBoat.x, PLACES.logBoat.z, ic.reach + 2)) {
    return { kind: 'boatFar', verb: null, x: PLACES.logBoat.x, z: PLACES.logBoat.z };
  }
  if (w.stage >= 2 && within(pl, PLACES.mast.x, PLACES.mast.z, ic.reach + 1)) {
    if (!w.glass.up) return { kind: 'glass', verb: 'raiseGlass', x: PLACES.mast.x, z: PLACES.mast.z };
    return { kind: 'glass', verb: w.glass.nailed ? 'nailIt' : 'lowerGlass', x: PLACES.mast.x, z: PLACES.mast.z };
  }
  return null;
}

// ---- interact (E) ----------------------------------------------------------------------------

function noticeText(sim, text, events) {
  sim.waves.notice = { key: null, left: sim.cfg.noticeTime };
  events.push({ type: 'notice', text });
}

function noticeKey(sim, key, events) {
  sim.waves.notice = { key, left: sim.cfg.noticeTime };
  events.push({ type: 'notice', key });
}

function speakPeleg(sim, events) {
  const { cfg, waves: w } = sim;
  const t = talkState(sim, 'peleg');
  if (t.at === 0) { speak(sim, 'peleg', 'peleg1', events); t.at = 1; return; }
  const miss = proofsMissing(w.proofs, cfg);
  if (miss.length) {
    speak(sim, 'peleg', 'peleg2', events);
    noticeText(sim, `Still wanting: ${miss.join(', ')}.`, events);
    return;
  }
  speak(sim, 'peleg', 'peleg3', events);
  signOn(sim, events);
}

function signOn(sim, events) {
  const w = sim.waves;
  w.stage = 2;
  stowCarbine(sim);
  noticeKey(sim, 'stowed', events);
  addEntry(sim, 'dockProofs', events);
  events.push({ type: 'signedOn' });
  events.push({ type: 'kitStowed' });
}

function startNedRound(sim, events) {
  const { cfg, waves: w } = sim;
  nedThrow(w.contest, cfg);
  w.contestPhase = 'nedThrown';
  const i = w.contest.round;
  events.push({ type: 'contestRound', round: i, who: 'ned', hit: w.contest.nedStuck[i] });
  events.push({ type: w.contest.nedStuck[i] ? 'barrelHit' : 'barrelMiss', who: 'ned', round: i });
  if (i === 0) speak(sim, 'ned', 'ned2', events); // (ned2's "Fair throw" also covers Ned's own good first throws, visually)
}

function startContestAt(sim, events) {
  const { waves: w } = sim;
  startContest(w.contest);
  w.harpoon = { ...w.harpoon, held: 'contest' };
  sim.weapon = createWeapon(sim.cfg, sim.cfg.weapons.harpoon);
  sim.holster = null;
  sim.rack = [];
  speak(sim, 'ned', 'ned1', events);
  noticeKey(sim, 'contestIron', events);
  startNedRound(sim, events);
}

/** Handles E on the current focus (main.js calls this; keep.js's and trail.js's own `read`/`take` helpers are the pattern). */
export function interact(sim, focus, events) {
  const { cfg, waves: w } = sim;
  if (!focus) return;
  if (focus.kind === 'elijah') {
    if (!greet(sim, 'elijah', events)) talkTo(sim, 'elijah', events);
    return;
  }
  if (focus.kind === 'peleg') { speakPeleg(sim, events); return; }
  if (focus.kind === 'ned') {
    if (w.contest.active) return; // a round is already live: fire throws, Speak does nothing mid-round
    startContestAt(sim, events);
    return;
  }
  if (focus.kind === 'knot') {
    takeKnot(w.proofs, focus.name);
    const label = DOCK_KNOT_NAMES[Math.max(0, KNOTS.indexOf(focus.name))];
    noticeText(sim, DOCK_NOTICE_TEMPLATES.knot(label), events);
    events.push({ type: 'proof', proof: 'knot', value: focus.name });
    bumpProofsIdle(sim, true);
    return;
  }
  if (focus.kind === 'lay') {
    takeLay(w.proofs, focus.key);
    const label = DOCK_LAY_NAMES[Math.max(0, LAY_TICKETS.indexOf(focus.key))];
    noticeText(sim, DOCK_NOTICE_TEMPLATES.lay(label), events);
    events.push({ type: 'proof', proof: 'lay', value: focus.key });
    bumpProofsIdle(sim, true);
    return;
  }
  if (focus.kind === 'clipping') {
    const r = readClipping(w.proofs, focus.key);
    events.push({ type: 'read', key: focus.key });
    addEntry(sim, focus.key, events);
    events.push({ type: 'clipping', key: focus.key, count: w.proofs.clippings.length });
    noticeText(sim, DOCK_NOTICE_TEMPLATES.clipping(w.proofs.clippings.length), events);
    if (r.allFour) {
      addEntry(sim, 'dockMonster', events);
      events.push({ type: 'monsterKnown' });
    }
    return;
  }
  if (focus.kind === 'boat') {
    if (!w.harpoon.haul) startHaul(w.harpoon, cfg.boatHaul.time);
    return;
  }
  if (focus.kind === 'glass') {
    if (focus.verb === 'raiseGlass') { raiseGlass(w.glass); events.push({ type: 'glassUp' }); return; }
    if (focus.verb === 'lowerGlass') { lowerGlass(w.glass); return; }
    if (focus.verb === 'nailIt') {
      w.stage = 3;
      lowerGlass(w.glass);
      events.push({ type: 'nailed' });
      startCastOff(sim, events);
    }
  }
}

function bumpProofsIdle(sim, progressed) {
  if (progressed) { sim.waves.hints.proofsIdle = 0; sim.waves.hints.proofsRung = false; }
}

// ---- fire (the harpoon) -----------------------------------------------------------------------

/** sim.js routes fire here while the weapon in hand is the harpoon. Returns true when a throw started. */
export function fireHarpoon(sim, events) {
  const { cfg, player: pl, waves: w } = sim;
  if (w.harpoon.flight || w.harpoon.haul) return false;
  if (w.harpoon.held === 'contest' && !within(pl, PLACES.contestMark.x, PLACES.contestMark.z, MARK_RADIUS)) return false; // off the mark: the round pauses
  const figures = pelegEtAl(sim);
  const a = aimHarpoon(pl, figures, cfg);
  if (!a.can) return false;
  const cp = Math.cos(pl.pitch || 0);
  const dir = { x: -Math.sin(pl.yaw) * cp, y: Math.sin(pl.pitch || 0), z: -Math.cos(pl.yaw) * cp };
  const from = { x: pl.x, y: pl.y + cfg.player.eyeHeight, z: pl.z };
  throwIron(w.harpoon, cfg, from, dir);
  events.push({ type: 'harpoonThrow' });
  return true;
}

function pelegEtAl(sim) {
  const w = sim.waves;
  const list = [PLACES.gangwayFoot, PLACES.gangwayHead];
  if (w.contest.active) list.push({ x: PLACES.contestMark.x, z: PLACES.contestMark.z });
  if (w.mate) list.push({ x: w.mate.x, z: w.mate.z });
  return list;
}

/** One frame of an in-flight iron: tests against the live contest round's barrel, the log boat, or the scare's monster. */
function stepHarpoonFlight(sim, dt, events) {
  const { cfg, waves: w } = sim;
  const p = stepFlight(w.harpoon, cfg, dt);
  if (!p) return;
  if (w.contest.active && w.contestPhase === 'nedThrown') {
    const b = barrelAt(w.contest.round, sim.time, cfg);
    const d = Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z);
    if (d <= cfg.contest.hitRadius) {
      landHarpoon(w.harpoon, p, 'barrel', w.contest.round);
      finishWardenThrow(sim, true, events);
      return;
    }
    if (p.y <= WATER_Y) {
      landHarpoon(w.harpoon, p, 'ground');
      finishWardenThrow(sim, false, events);
      return;
    }
    return;
  }
  if (!w.proofs.log && w.harpoon.held === 'own') {
    const boat = PLACES.logBoat;
    if (Math.hypot(p.x - boat.x, p.z - boat.z) <= 1.2) {
      landHarpoon(w.harpoon, p, 'boat');
      events.push({ type: 'harpoonStick' });
      return;
    }
  }
  if (w.scare.armed && !w.scare.played && w.scare.surfaceT > 0) {
    const burst = w.scare; // P5: placed relative to the warden at arming time (stepScare), not a fixed world point
    if (Math.hypot(p.x - burst.x, p.z - burst.z) <= 2.5) {
      landHarpoon(w.harpoon, p, 'monster');
      events.push({ type: 'harpoonRing' });
      startHaul(w.harpoon, cfg.weapons.harpoon.haulTime);
      return;
    }
  }
  if (p.y <= WATER_Y) {
    landHarpoon(w.harpoon, p, 'ground');
    startHaul(w.harpoon, cfg.weapons.harpoon.haulTime);
  }
}

function finishWardenThrow(sim, hit, events) {
  const { cfg, waves: w } = sim;
  events.push({ type: hit ? 'barrelHit' : 'barrelMiss', who: 'warden', round: w.contest.round });
  const t = tally(w.contest);
  noticeText(sim, DOCK_NOTICE_TEMPLATES.score(t.ned, hit ? t.warden + 1 : t.warden), events);
  wardenThrow(w.contest, hit);
  w.contestPhase = 'hauling';
  startHaul(w.harpoon, cfg.weapons.harpoon.haulTime);
}

// ---- water, the scare, the hint ladder --------------------------------------------------------

function stepDunk(sim, dt, events) {
  const { player: pl, waves: w } = sim;
  w.dunkCool = Math.max(0, w.dunkCool - dt);
  if (inWater(pl.x, pl.z) && w.dunkCool <= 0) {
    pl.x = 0; pl.z = -2; pl.y = 0; pl.vy = 0; pl.grounded = true;
    w.dunkCool = 1.0;
    events.push({ type: 'dunk' });
    noticeKey(sim, 'dockDunk', events);
  }
}

/** P5 (R8, "so it is seen"): where the scare breaks the surface, placed off the warden's own
 * position and facing at the moment it arms - between burstNear and burstFar metres out, dead
 * ahead (the middle of the view), not dockmap.js's fixed burstSpot. */
function placeScareBurst(pl, cfg) {
  const dist = (cfg.scare.burstNear + cfg.scare.burstFar) / 2;
  return { x: pl.x - Math.sin(pl.yaw) * dist, z: pl.z - Math.cos(pl.yaw) * dist };
}

function stepScare(sim, dt, events) {
  const { cfg, waves: w } = sim;
  if (w.proofs.log && !w.scare.armed) {
    w.scare.armed = true;
    Object.assign(w.scare, placeScareBurst(sim.player, cfg));
  }
  if (!w.scare.armed || w.scare.played) return;
  w.scare.t += dt;
  if (w.scare.t >= cfg.scare.delayAfterLog && w.scare.surfaceT <= 0 && w.scare.t < cfg.scare.delayAfterLog + 0.01) {
    w.scare.surfaceT = cfg.scare.surfaceTime;
    events.push({ type: 'scare' });
    addEntry(sim, 'dockScare', events);
  }
  if (w.scare.surfaceT > 0) {
    w.scare.surfaceT -= dt;
    if (w.scare.surfaceT <= 0) w.scare.played = true;
  }
}

const PROOF_HINTS = ['plainDockKnot', 'plainDockLay'];

function stepHints(sim, dt, events) {
  const { cfg, waves: w } = sim;
  if (!allRight(w.proofs, cfg)) {
    w.hints.proofsIdle += dt;
    if (!w.hints.proofsRung && w.hints.proofsIdle >= cfg.hints.proofs) {
      w.hints.proofsRung = true;
      const r = rightness(w.proofs, cfg);
      const key = r.knot !== true ? 'plainDockKnot' : r.lay !== true ? 'plainDockLay'
        : w.harpoon.held !== 'own' ? 'plainDockLogNoHarpoon' : 'plainDockLog';
      addEntry(sim, key, events);
    }
  }
  if (w.glass.up && !w.glass.nailed) {
    w.hints.glassIdle += dt;
    const rungs = cfg.hints.glass;
    if (w.hints.glassRung < 1 && w.hints.glassIdle >= rungs[0]) { w.hints.glassRung = 1; addEntry(sim, 'plainDockGlass1', events); }
    if (w.hints.glassRung < 2 && w.hints.glassIdle >= rungs[1]) { w.hints.glassRung = 2; addEntry(sim, 'plainDockGlass2', events); }
    if (w.hints.glassRung < 3 && w.hints.glassIdle >= rungs[2]) { w.hints.glassRung = 3; addEntry(sim, 'plainDockGlass3', events); }
  } else {
    w.hints.glassIdle = 0;
  }
}

// ---- the cast-off scene (R10, Numbers) --------------------------------------------------------

function startCastOff(sim, events) {
  const { cfg, waves: w } = sim;
  w.scene = { kind: 'castoff', t: 0, length: cfg.castOff.length, skippable: true, held: {} };
}

const HELD = ['fire', 'jump', 'interact', 'skip'];

/** sim.js's scene stepper while cast-off plays (the whole frame, as every scene does, A4). */
export function stepDockScene(sim, input, dt, events) {
  const w = sim.waves;
  const s = w.scene;
  if (!s || s.kind !== 'castoff') return false;
  s.t += Math.max(0, dt || 0);
  const skip = HELD.some((k) => input && input[k]);
  if (skip || s.t >= s.length) {
    w.scene = null;
    w.stage = 4;
    events.push({ type: 'castOff' });
    events.push({ type: 'won', stats: { ...sim.stats } });
    sim.status = 'won';
  }
  return true;
}

// ---- the end: main.js reads sim.status 'won' as every other room's; no passage opens (R10: returns to the title) ----

/** The tavern's hush (R7, Numbers; cfg.tavern): within hushWithin metres of the bar's own spike
 * (PLACES.layTicketSpike - "the three lay tickets on the bar's spike", dockmap.js) sim.waves.hush
 * drops to 1 at once; stepping away eases it back to 0 over murmurBack seconds. Pure state only -
 * the ambient murmur bed itself is left for the art pass (dockcues.js's own header comment); this
 * is the mechanism ready for it to read once that bed exists, not an audible effect this pass.
 */
function stepTavernHush(sim, dt) {
  const { cfg, waves: w, player: p } = sim;
  const tav = cfg.tavern || { hushWithin: 3, murmurBack: 2 };
  const dx = p.x - PLACES.layTicketSpike.x;
  const dz = p.z - PLACES.layTicketSpike.z;
  const within = dx * dx + dz * dz <= tav.hushWithin * tav.hushWithin;
  const target = within ? 1 : 0;
  if (target >= w.hush || !(tav.murmurBack > 0)) w.hush = target;
  else w.hush = Math.max(target, w.hush - Math.max(0, dt || 0) / tav.murmurBack);
}

/** One frame (sim.js ENCOUNTERS.dock.step). Order: the scene (handled by sim.js before this runs), flight, hauls, dunk, scare, dawn, hints, mate. */
export function stepDock(sim, dt, events, input) {
  const { cfg, waves: w } = sim;
  stepTavernHush(sim, dt);
  stepHarpoonFlight(sim, dt, events);
  if (w.harpoon.haul) {
    const done = stepHaul(w.harpoon, dt);
    if (done) onHaulDone(sim, events);
  }
  stepDunk(sim, dt, events);
  stepScare(sim, dt, events);
  stepDawn(sim, dt);
  stepHints(sim, dt, events);
  if (w.glass.up) {
    stepCollar(w.glass, input ? input.moveX : 0, cfg, dt);
    if (stepHold(w.glass, cfg, dt)) { /* nailed goes true; the prompt changes, the player still presses E to drive it home */ }
  }
  if (w.mate) {
    const followZones = ['quay', 'pier', 'deck'];
    const zone = zoneAt(sim.player.x, sim.player.z) || 'quay';
    const missingList = proofsMissing(w.proofs, cfg);
    const lookTarget = w.kit === 'stowed' ? null : (missingList.length ? targetForMissing(missingList[0]) : null);
    const edgePos = zone === 'tavern' ? PLACES.tavernDoor : zone === 'underPier' ? PLACES.whaleboatSteps : null;
    stepMate(w.mate, sim.player, zone, followZones, lookTarget, edgePos, dt);
  }
}

function targetForMissing(which) {
  if (which === 'knot') return PLACES.knotBoard;
  if (which === 'lay') return PLACES.layTicketSpike;
  return PLACES.logBoat;
}

function onHaulDone(sim, events) {
  const { cfg, waves: w } = sim;
  const target = w.harpoon.stands ? w.harpoon.stands.target : null;
  if (target === 'boat') {
    takeLog(w.proofs);
    landHarpoon(w.harpoon, PLACES.contestMark, 'mark');
    noticeKey(sim, 'dockLog', events);
    events.push({ type: 'proof', proof: 'log', value: true });
    bumpProofsIdle(sim, true);
    return;
  }
  events.push({ type: 'harpoonHaul' });
  // The contest iron always comes home to the mark; once it is Queequeg's own it is simply back
  // in hand (nothing standing anywhere, ready to throw again at the boat or the scare's monster).
  if (w.harpoon.held === 'contest') landHarpoon(w.harpoon, PLACES.contestMark, 'mark');
  else w.harpoon.stands = null;
  if (w.contest.active && w.contestPhase === 'hauling') {
    if (contestFinished(w.contest)) {
      w.contestPhase = null;
      w.contest.active = false;
      if (w.contest.won) {
        events.push({ type: 'contestWon' });
        speak(sim, 'ned', 'ned4', events);
        noticeKey(sim, 'dockHarpoon', events);
        w.stage = 1;
        w.harpoon.held = 'own';
        w.mate = createMate(PLACES.queequegWait);
      } else {
        speak(sim, 'ned', 'ned3', events);
      }
    } else {
      startNedRound(sim, events);
    }
  }
}
