// The Rose Court encounter (cfg.encounter 'trail'): six stages (the court, four bands of wood,
// the approach), the interact dispatch and what E is looking at, found items, gates, the pit
// and the grin, checkpoints and restore, and the end trigger. State lives in sim.waves under
// the shared field names (index, count, queue, phase) so reset, isolation and the HUD work.
// Creature rules live in courtiers.js and hybrids.js; this file seats them and reads only the
// shared fields they keep (id, type, gate, dead, fed, doused).
// Polish: the bloom scene, a sim-time freeze after the first valve turn of a run (stepScene is
// the allow-list of what runs during it, security A4); the clue card (read) and the notice
// line (notice); the plot gardeners, the Rabbit and the hunter on Speak (talk.js); the hats
// (hats.js), between the Hatter's death and his gate; dropped halberds; the cup as a weapon
// and any running water to fill it; and the bodies of beaten gate creatures, which a restore
// or a start-door run always lays out again (R18).

import { COURT, MAZE, LOOT, deadEnds, stageAt } from './courtmap.js';
import { PLACES } from './script.js';
import { spawnEnemy, hurtPlayer } from './enemy.js';
import { createPlayer } from './player.js';
import { createWeapon, cancelReload, carryWeapon, swapWeapon } from './weapon.js';
import { restockPads } from './pickups.js';
import { turnValve, refreshBlockers, noteWater, stepFlows, finishFlow } from './roses.js';
import { addEntry, stepHints, createHints } from './journal.js';
import { pullStake, pullable, stakesToBody, stakesDrop, addFreshStakes, crossbowOf } from './stakes.js';
import { stepRenfield, seatFriendlies } from './courtiers.js';
import { hybridKilled } from './hybrids.js';
import { aabb } from './courtmap.js';
import { createHats, restoredHats, useHat, hatsOpen, pegOf, HATS } from './hats.js';
import { createWeather, restoredWeather, stepWeather } from './weather.js'; // issue #28
import { talkTo, plotSpeaker, hush } from './talk.js';

const STAGES = 6; // court, bands 1 to 4, approach
const COURT_FIGURES = Object.freeze(['guard', 'gardener']);
const GATE_BOXES = MAZE.glades.map((g) => aabb(g.gate.x - 4, g.gate.x + 4, g.gate.z - 0.6, g.gate.z + 0.6, 4, 'gate'));


/**
 * The notice line's key (a script.js NOTICES key) for each loot kind taken here, the filled
 * cup and the halberd; pickups.js shows the pads' (health, ammo). The yard and the cave keep
 * their own toasts. The crossbow has no approved name line, so it shows none.
 */
export const NOTICE_KEYS = Object.freeze({
  garlic: 'garlic', carrot: 'carrot', stakes: 'stake', cup: 'cupEmpty', cupFull: 'cupFull', halberd: 'halberd',
});

/**
 * Where the polish track's new things stand: courtmap.js's places when it has them, else a
 * spot derived from the shipped map. plots: one gardener at each vegetable plot
 * { plot, holds, band, x, z, yaw } (MAZE.plots); hunter { x, z } (MAZE.hunter); hatStand: { card,
 * hats[5], pegs[5] } (MAZE.hatter.card, .hats, .pegs; pegs from the gate outward); cupNote
 * { x, z } (MAZE.cupNote, else under the cup).
 */
export function polishPlaces() {
  const plots = MAZE.plots || MAZE.plotGardeners || deadEnds().filter((d) => d.holds === 'garlic' || d.holds === 'carrot')
    .map((d) => ({ holds: d.holds, band: d.band, x: d.x + d.exit.x * 2.6 + d.exit.z * 1.4, z: d.z + d.exit.z * 2.6 + d.exit.x * 1.4 }));
  const g2 = MAZE.glades[1].gate;
  const g3 = MAZE.glades[2];
  const hunter = MAZE.hunter || { x: g3.x, z: g3.maxZ + 2 };
  const ht = MAZE.hatter;
  const hatStand = {
    card: ht.card || { x: g2.x - 3, z: g2.z + 2.4 },
    hats: ht.hats || HATS.map((h, i) => ({ x: g2.x - 5 + i * 0.8, z: g2.z + 3.2 })),
    pegs: ht.pegs || HATS.map((h, i) => ({ x: g2.x - 1.2 - i * 0.9, z: g2.z + 1.2 })),
  };
  const cup = LOOT.find((l) => l.kind === 'cup');
  const cupNote = MAZE.cupNote || { x: cup.x, z: cup.z };
  return { plots, hunter, hatStand, cupNote };
}

/**
 * What restoreCheckpoint does to each field (security A2): every field of sim and of
 * sim.waves is either written from the checkpoint (or rebuilt) or deliberately kept. A field
 * added to either without appearing here is the defect; tests/trail.test.js fails on it.
 */
export const RESTORE_FIELDS = Object.freeze({
  sim: Object.freeze({
    writes: Object.freeze(['player', 'weapon', 'holster', 'rack', 'enemies', 'bolts', 'globs', 'pools', 'pickups', 'boxes',
      'status', 'statusTimer', 'softlockFor', 'pending', 'waves']),
    keeps: Object.freeze(['cfg', 'seed', 'rng', 'time', 'nextId', 'stats']),
  }),
  waves: Object.freeze({
    writes: Object.freeze(['index', 'queue', 'phase', 'valves', 'beds', 'channels', 'items', 'loot', 'stakes', 'bodies',
      'pins', 'hints', 'focus', 'line', 'gateId', 'blockers', 'falling', 'grinArmed', 'checkpoint',
      'flows', 'called', 'scene', 'hats', 'dropped', 'notice', 'weather']),
    keeps: Object.freeze(['count', 'done', 'log', 'renfield', 'talk']),
  }),
});

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

function freshItems() {
  return { garlic: 0, carrot: 0, cup: 'none', ticket: false, stakes: 0 };
}

export function createTrail(cfg) {
  return {
    index: 0,
    count: STAGES,
    phase: 'still', // still | awake | open | done
    queue: [], // stays empty: nothing is queued in this room
    valves: [false, false, false, false],
    beds: [false, false, false, false],
    channels: [false, false, false, false],
    done: {
      roses: false, gates: [false, false, false, false], pitOpen: false, grinSpent: false,
      bloomSeen: false, hatter: false, hats: false,
    },
    items: freshItems(),
    loot: cfg.loot.map((l) => ({ key: l.key, taken: false })),
    stakes: [],
    bodies: [],
    pins: [], // stuck hat-pins, capped at cfg.maxPins (enemy.js stickPin)
    log: ['fromCave', 'arrive'],
    hints: createHints(),
    checkpoint: null,
    focus: null,
    line: null, // { who, key, left }
    gateId: null, // the current band's gate creature
    blockers: [], // monster-only collision (roses.monsterBoxes), rebuilt with sim.boxes
    falling: false, // the warden is dropping into the pit
    grinArmed: false,
    renfield: {}, // courtiers.js keeps Renfield's own state here
    flows: [0, 0, 0, 0], // seconds of travel left for the water in each rill (roses.js)
    called: 0, // court figures called awake so far, one per hand turn (roses.js)
    scene: null, // { kind, index, left } while the bloom scene plays
    talk: {}, // talk.js keeps each speaker's conversation here
    hats: createHats(), // hats.js: { pegs[5] }
    dropped: [], // halberds where guards fell: { id, x, z, taken }
    notice: null, // { key, left }: the one name or narration line on screen
    weather: createWeather(), // weather.js (#28): rain until the Caterpillar's gate; reseeded by startTrail
  };
}

/** Live collision: the room's boxes, the briar until the roses are red, every closed gate. */
export function trailBoxes(cfg, w) {
  const out = [...cfg.boxes];
  if (!w.done.roses) out.push(COURT.briar);
  w.done.gates.forEach((open, i) => { if (!open) out.push(GATE_BOXES[i]); });
  return out;
}

/** The gate box of band 1 to 4 (closed until its creature dies). */
export function gateBox(band) {
  return GATE_BOXES[band - 1] || null;
}

function phaseFor(w, k) {
  if (k === 0) return w.done.roses ? 'open' : 'still';
  if (k === 2 && !w.done.gates[1] && w.done.hatter) return 'awake'; // he is dead; the hats are not right yet
  if (k <= 4) return w.done.gates[k - 1] ? 'open' : 'still';
  return 'open';
}

/** Seats the figures of stage k that are not done, pushing their spawn events to events. */
function seatStage(sim, k, events) {
  const w = sim.waves;
  w.gateId = null;
  if (k === 0) {
    if (w.done.roses) return;
    for (const g of COURT.guards) spawnEnemy(sim, 'guard', g.x, g.z, events, { heading: Math.PI });
    for (const g of COURT.gardeners) spawnEnemy(sim, 'gardener', g.x, g.z, events, { heading: Math.atan2(-(10 - g.x), -(-10 - g.z)) });
    return;
  }
  seatFriendlies(sim, k, events);
  if (k > 4 || w.done.gates[k - 1] || (k === 2 && w.done.hatter)) return;
  const type = sim.cfg.gateCreatures[k - 1];
  const home = type === 'rabbit' ? MAZE.rabbit.chair : MAZE[type].home;
  const e = spawnEnemy(sim, type, home.x, home.z, events, { gate: k });
  w.gateId = e.id;
}

function snapshot(sim, index) {
  const w = sim.waves;
  const at = MAZE.spawns[index];
  return {
    index,
    spawn: { x: at.x, z: at.z },
    facing: at.yaw,
    health: sim.player.health,
    weapon: clone(sim.weapon),
    holster: clone(sim.holster),
    rack: clone(sim.rack || []),
    items: clone(w.items),
    loot: clone(w.loot),
    stakes: clone(w.stakes),
    bodies: clone(w.bodies),
    pins: clone(w.pins),
    dropped: clone(w.dropped || []),
    pickups: clone(sim.pickups),
    done: clone(w.done),
  };
}

/**
 * Issue #29: a journey up out of the cave arrives with what the warden carried (journey.js
 * seatCarry), so the court's entrance checkpoint is written again after it is seated: a death
 * before the arch restores the carried health and rounds, as the castle's arrival does (A2).
 */
export function rewriteEntrance(sim) {
  if (!sim || !sim.cfg || sim.cfg.encounter !== 'trail' || !sim.waves || sim.waves.index !== 0) return false;
  sim.waves.checkpoint = snapshot(sim, 0);
  return true;
}

/** Where a beaten gate creature's body lies when nothing better is known: its home. */
function homeOf(type) {
  return type === 'rabbit' ? MAZE.rabbit.chair : MAZE[type].home;
}

/** True when the gate creature of band k (1 to 4) is beaten (the Hatter: dead, gate or not). */
function beaten(done, k) {
  return !!(done.gates[k - 1] || (k === 2 && done.hatter));
}

/**
 * The bodies list with the body of every beaten gate creature in it (R18): kept where it is
 * listed, else where it fell (from `fallen`, the bodies seen before a restore), else at its
 * home. Each gate creature's body appears once.
 */
function withGateBodies(cfg, done, bodies, fallen = []) {
  const out = bodies.slice();
  for (let k = 1; k <= 4; k++) {
    const type = cfg.gateCreatures[k - 1];
    if (!beaten(done, k) || out.some((b) => b.enemy === type)) continue;
    const was = fallen.find((b) => b && b.enemy === type);
    const home = homeOf(type);
    out.push(was ? { ...was } : { id: null, enemy: type, x: home.x, z: home.z, gate: k });
  }
  return out;
}

/** The encounter's start, after resetSim built the state: blockers, the court's figures, the arrival checkpoint. */
export function startTrail(sim) {
  refreshBlockers(sim);
  seatStage(sim, 0, sim.pending);
  sim.waves.weather = createWeather(sim.seed); // #28: the cloud breaks follow the run's seed
  sim.waves.checkpoint = snapshot(sim, 0);
}

/**
 * The snapshot the start door seats at band `index` (1 to 4): full health, the arrival salt,
 * the crossbow with four stakes, no items, every earlier stage done and no later one. Returns
 * null for anything but a whole number from 1 to 4 (security A1), or outside this room.
 */
export function checkpointAt(cfg, index) {
  if (!cfg || cfg.encounter !== 'trail' || !Number.isInteger(index) || index < 1 || index > 4) return null;
  const at = MAZE.spawns[index];
  const crossbow = createWeapon(cfg, cfg.weapons.crossbow);
  crossbow.reserve = 3; // one on the string and three more
  const done = {
    roses: true, gates: [0, 1, 2, 3].map((g) => g < index - 1), pitOpen: false, grinSpent: false,
    bloomSeen: true, // a start-door run has not earned the scene (R3: once per run, from the court)
    hatter: index > 2,
    hats: index > 2,
  };
  return {
    index,
    spawn: { x: at.x, z: at.z },
    facing: at.yaw,
    health: cfg.player.health,
    weapon: createWeapon(cfg),
    holster: crossbow,
    rack: [],
    items: freshItems(),
    loot: cfg.loot.map((l) => ({ key: l.key, taken: l.key === 'crossbow' || l.key === 'lidStake' })),
    stakes: [],
    bodies: withGateBodies(cfg, done, []),
    pins: [],
    dropped: [],
    pickups: null, // every pad stocked
    done,
  };
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

function validWeapon(w, cfg) {
  return isObj(w) && finite(w.mag) && finite(w.reserve) && w.mag >= 0 && w.reserve >= 0
    && (w.name == null || !cfg.weapons || Object.prototype.hasOwnProperty.call(cfg.weapons, w.name));
}

/**
 * The carried weapons of a snapshot (security A1): every one valid, the rack a list no longer
 * than the room's weapons less the two in hand and holster, and no weapon name carried twice.
 */
function validCarried(s, cfg) {
  if (!Array.isArray(s.rack) || !s.rack.every((r) => validWeapon(r, cfg))) return false;
  const kinds = cfg.weapons ? Object.keys(cfg.weapons).length : 1;
  if (s.rack.length > Math.max(0, kinds - 2)) return false;
  if (s.rack.length && s.holster == null) return false;
  const names = [s.weapon, s.holster, ...s.rack].filter(Boolean).map((w) => (w.name == null ? cfg.weapon.name : w.name));
  return new Set(names).size === names.length;
}

/** A dropped halberd in a snapshot: an id, a finite place and whether it was taken. */
function validDropped(d) {
  return isObj(d) && (Number.isInteger(d.id) || typeof d.id === 'string') && finite(d.x) && finite(d.z) && typeof d.taken === 'boolean';
}

/** A snapshot restoreCheckpoint will accept: anything else leaves the sim untouched. */
export function validSnapshot(s, cfg) {
  return isObj(s) && Number.isInteger(s.index) && s.index >= 0 && s.index < STAGES
    && isObj(s.spawn) && finite(s.spawn.x) && finite(s.spawn.z) && finite(s.facing)
    && finite(s.health) && s.health > 0
    && validWeapon(s.weapon, cfg) && (s.holster == null || validWeapon(s.holster, cfg))
    && validCarried(s, cfg)
    && Array.isArray(s.dropped) && s.dropped.every(validDropped)
    && isObj(s.items) && Array.isArray(s.loot) && s.loot.length === cfg.loot.length
    && Array.isArray(s.stakes) && Array.isArray(s.bodies) && Array.isArray(s.pins)
    && (s.pickups == null || Array.isArray(s.pickups))
    && isObj(s.done) && Array.isArray(s.done.gates) && s.done.gates.length === 4;
}

/**
 * Puts the last checkpoint back after a death (or seats a start-door snapshot passed as snap).
 * Writes and keeps exactly what RESTORE_FIELDS lists: the player at the checkpoint with the
 * health, weapons (by identity and ammunition), items, loot, stakes, bodies, pins and pickups
 * it had there; no creatures, bolts or hazards; every figure of a stage not done re-seated;
 * the plumbing as `done` says; sim.boxes and the monster blocker list recomputed. `done` (only
 * ever merged upward) and the log are kept. Returns false and changes nothing for a bad snapshot.
 * With one argument it restores sim.waves.checkpoint; a second argument, even undefined, is the
 * snapshot to seat (so a failed start-door lookup can never fall through to something else).
 */
export function restoreCheckpoint(sim, ...given) {
  const snap = given.length ? given[0] : sim && sim.waves && sim.waves.checkpoint;
  const cfg = sim && sim.cfg;
  if (!cfg || cfg.encounter !== 'trail' || !validSnapshot(snap, cfg)) return false;
  const w = sim.waves;
  const s = clone(snap);

  w.done.roses = w.done.roses || !!s.done.roses;
  w.done.gates = w.done.gates.map((g, i) => g || !!s.done.gates[i]);
  w.done.pitOpen = w.done.pitOpen || !!s.done.pitOpen;
  w.done.grinSpent = w.done.grinSpent || !!s.done.grinSpent;
  w.done.bloomSeen = !!(w.done.bloomSeen || s.done.bloomSeen);
  w.done.hatter = !!(w.done.hatter || s.done.hatter);
  w.done.hats = !!(w.done.hats || s.done.hats);
  const fallen = (w.bodies || []).slice();

  const red = w.done.roses;
  w.valves = [red, red, red, red];
  w.beds = [red, red, red, red];
  w.channels = [red, red, red, red];
  w.index = s.index;
  w.queue = [];
  w.phase = phaseFor(w, s.index);
  w.items = { ...freshItems(), ...s.items };
  w.loot = s.loot;
  w.stakes = s.stakes;
  w.bodies = withGateBodies(cfg, w.done, s.bodies, fallen);
  w.pins = s.pins;
  w.flows = [0, 0, 0, 0];
  w.called = red ? COURT.guards.length + COURT.gardeners.length : 0;
  w.scene = null;
  w.hats = restoredHats(w.done);
  w.dropped = s.dropped;
  w.notice = null;
  w.weather = restoredWeather(w.weather, s.index, sim.seed, w.done.gates[3]); // #28: clear past the Caterpillar's gate
  w.hints = createHints();
  w.focus = null;
  w.line = null;
  hush(sim); // no queued line from before the death plays after it
  w.gateId = null;
  w.falling = false;
  w.grinArmed = false;
  w.checkpoint = snap;

  const pl = createPlayer(cfg);
  pl.x = s.spawn.x;
  pl.z = s.spawn.z;
  pl.yaw = s.facing;
  pl.health = Math.min(s.health, cfg.player.health);
  sim.player = pl;
  sim.weapon = s.weapon;
  cancelReload(sim.weapon);
  sim.holster = s.holster || null;
  if (sim.holster) cancelReload(sim.holster);
  if (Object.prototype.hasOwnProperty.call(sim, 'rack')) {
    sim.rack = s.rack;
    for (const r of sim.rack) cancelReload(r);
  }
  sim.enemies = [];
  sim.bolts = [];
  sim.globs = [];
  sim.pools = [];
  sim.pickups = [];
  if (s.pickups) sim.pickups = s.pickups;
  else restockPads(sim);
  refreshBlockers(sim);
  sim.status = 'playing';
  sim.statusTimer = 0;
  sim.softlockFor = 0;
  sim.pending = [
    { type: 'restored', index: w.index },
    { type: 'waveStart', wave: w.index + 1, of: w.count, stage: w.index },
  ];
  seatStage(sim, w.index, sim.pending);
  return true;
}

// ---- what E would act on --------------------------------------------------------------------

function gateCreature(sim, band) {
  return sim.enemies.find((e) => e.gate === band && !e.dead) || null;
}

function inRect(r, x, z, pad = 0) {
  return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
}

/** Every weapon the warden carries: in hand, holstered, on the rack. */
export function carried(sim) {
  return [sim.weapon, sim.holster, ...(Array.isArray(sim.rack) ? sim.rack : [])].filter(Boolean);
}

const carries = (sim, name) => carried(sim).some((x) => x.name === name);

/** The running water (stream, or a rill or the threshold while it runs) at (x, z), or null. */
function runningWaterAt(w, x, z) {
  if (inRect(MAZE.stream, x, z, 0.3)) return 'stream';
  if (w.index === 0 || stageAt(x, z) === 0) {
    for (let i = 0; i < COURT.rills.length; i++) if (w.channels[i] && inRect(COURT.rills[i], x, z, 0.3)) return 'rill';
    if (w.done.roses && inRect(COURT.threshold, x, z, 0.3)) return 'rill';
  }
  return null;
}

/**
 * The nearest thing within reach and in view that E would act on, or null:
 * { kind, verb, x, z, index?, key?, id?, item?, ready?, who?, hat?, tag? }. kind: valve | loot
 * | stake | note | renfield | menu | bowl | stream | pipe | plot | rabbit | hunter | hat |
 * hatCard | cupNote | halberd. verb is a PROMPTS key; a hat's tag is its price tag's key.
 */
export function focusOf(sim) {
  const { cfg, player: pl, waves: w } = sim;
  if (!w || pl.dead) return null;
  const fx = -Math.sin(pl.yaw);
  const fz = -Math.cos(pl.yaw);
  const ic = cfg.interact;
  let best = null;
  let bestScore = Infinity;
  const consider = (cand, x, z, reach = ic.reach, prio = 0) => {
    const dx = x - pl.x;
    const dz = z - pl.z;
    const d = Math.hypot(dx, dz);
    if (d > reach) return;
    const cos = d < 0.25 ? 1 : (dx * fx + dz * fz) / d;
    if (cos < ic.cone) return;
    const score = d * (2 - cos) - prio;
    if (score < bestScore) {
      bestScore = score;
      best = { ...cand, x, z };
    }
  };

  if (!w.done.roses) {
    COURT.valves.forEach((v, i) => { if (!w.valves[i]) consider({ kind: 'valve', verb: 'turn', index: i }, v.x, v.z); });
  }
  cfg.loot.forEach((l, i) => {
    const open = l.patch ? (w.items[l.kind] || 0) < l.gives : !w.loot[i].taken;
    if (open) consider({ kind: 'loot', verb: 'take', index: i, key: l.key, item: l.kind }, l.x, l.z, ic.reach, 0.5);
  });
  for (const s of w.stakes) if (pullable(s)) consider({ kind: 'stake', verb: 'pull', id: s.id }, s.x, s.z, ic.reach, 0.4);
  for (const n of COURT.notes) {
    if (w.log.includes(n.key)) continue;
    if (n.until === 'roses' && w.done.roses) continue;
    if (n.from === 'north' && !(pl.z < n.z)) continue;
    consider({ kind: 'note', verb: 'read', key: n.key }, n.x, n.z);
  }
  if (stageAt(pl.x, pl.z) === 0) consider({ kind: 'renfield', verb: 'speak' }, COURT.renfield.x, COURT.renfield.z, ic.renfieldReach);

  const places = polishPlaces();
  const stage = stageAt(pl.x, pl.z);
  for (const e of sim.enemies) {
    if (!e.friendly) continue;
    const who = e.type === 'hunter' ? 'hunter' : plotSpeaker(e.holds);
    if (who) consider({ kind: e.type === 'hunter' ? 'hunter' : 'plot', verb: 'speak', who, id: e.id }, e.x, e.z);
  }
  for (const d of w.dropped || []) {
    if (!d.taken && !carries(sim, 'halberd')) consider({ kind: 'halberd', verb: 'take', id: d.id }, d.x, d.z, ic.reach, 0.5);
  }
  if (w.items.cup !== 'none' && !w.log.includes('cupNote')) {
    consider({ kind: 'cupNote', verb: 'read', key: 'cupNote' }, places.cupNote.x, places.cupNote.z, ic.reach, 0.7);
  }
  if (stage === 2 && w.done.hatter) {
    const hs = places.hatStand;
    if (!w.log.includes('hatCard')) consider({ kind: 'hatCard', verb: 'read', key: 'hatCard' }, hs.card.x, hs.card.z);
    if (hatsOpen(w)) {
      HATS.forEach((h, i) => {
        const peg = pegOf(w.hats, i);
        const at = peg >= 0 ? hs.pegs[peg] : hs.hats[i];
        consider({ kind: 'hat', verb: 'set', hat: i, tag: h.key, peg }, at.x, at.z);
      });
    }
  }

  const rabbit = gateCreature(sim, 1);
  if (rabbit && !rabbit.fed) consider({ kind: 'rabbit', verb: 'speak', who: 'rabbit' }, rabbit.x, rabbit.z, cfg.interact.speakReach);
  if (rabbit && !w.log.includes('menu')) consider({ kind: 'menu', verb: 'read', key: 'menu' }, MAZE.rabbit.card.x, MAZE.rabbit.card.z);
  if (rabbit && !rabbit.fed) {
    consider({ kind: 'bowl', verb: 'mix', ready: w.items.garlic > 0 && w.items.carrot > 0 }, MAZE.rabbit.bowl.x, MAZE.rabbit.bowl.z);
  }
  if (w.items.cup === 'empty') {
    const ax = pl.x + fx * 0.8;
    const az = pl.z + fz * 0.8;
    const water = runningWaterAt(w, ax, az);
    if (water) consider({ kind: 'stream', verb: 'fill', water }, ax, az);
  }
  const cat = gateCreature(sim, 4);
  if (cat && !cat.doused && w.items.cup === 'full') {
    consider({ kind: 'pipe', verb: 'douse' }, MAZE.caterpillar.pipe.x, MAZE.caterpillar.pipe.z);
  }
  return best;
}

/** Shows the notice line for key (the newest wins) and emits notice { key }. */
export function notice(sim, key, events) {
  if (!key) return;
  sim.waves.notice = { key, left: sim.cfg.noticeTime };
  events.push({ type: 'notice', key });
}

/**
 * A newly carried weapon joins the Q cycle at its place in cfg.weaponOrder (weapon.js
 * carryWeapon); the one in hand stays in hand. Returns false (and carries nothing) when the
 * room has no such weapon or one is already carried.
 */
function carry(sim, name) {
  const spec = sim.cfg.weapons && sim.cfg.weapons[name];
  if (!spec || carries(sim, name)) return false;
  return carryWeapon(sim, createWeapon(sim.cfg, spec));
}

function take(sim, i, events) {
  const { cfg, waves: w } = sim;
  const l = cfg.loot[i];
  const at = { item: l.kind, at: l.key, x: l.x, z: l.z };
  if (l.patch) {
    if ((w.items[l.kind] || 0) >= l.gives) return;
    w.items[l.kind] = l.gives;
    events.push({ type: 'itemTake', ...at });
    notice(sim, NOTICE_KEYS[l.kind], events);
    return;
  }
  if (w.loot[i].taken) return;
  w.loot[i].taken = true;
  if (l.kind === 'crossbow') {
    const cb = createWeapon(cfg, cfg.weapons.crossbow);
    cb.mag = 1;
    cb.reserve = Math.min(cfg.weapons.crossbow.maxReserve, l.count - 1 + w.items.stakes);
    w.items.stakes = 0;
    // Into the cycle at its place (nothing already carried is dropped), then to hand at once.
    if (!carryWeapon(sim, cb) || !swapWeapon(sim, 'crossbow')) return;
    cb.cooldown = 0; // it comes to hand ready, as it always has
    events.push({ type: 'itemTake', ...at });
    events.push({ type: 'swap', weapon: cb.name });
    return;
  }
  if (l.kind === 'stakes') {
    addFreshStakes(sim, l.count);
    const cb = crossbowOf(sim);
    if (cb && cb.mag <= 0 && !cb.reloading && cb.autoReloadIn < 0) cb.autoReloadIn = 0;
  }
  if (l.kind === 'cup') {
    w.items.cup = 'empty';
    carry(sim, 'cup');
    addEntry(sim, 'cup', events);
  }
  events.push({ type: 'itemTake', ...at });
  notice(sim, NOTICE_KEYS[l.kind], events);
}

/** Opens the clue card: read { key }, and the entry goes into the log (once). */
function read(sim, key, events) {
  events.push({ type: 'read', key });
  addEntry(sim, key, events);
}

/** Starts the bloom scene on the first hand turn of a run (once per run, kept across restores). */
function startScene(sim, index, events, input) {
  const w = sim.waves;
  if (w.done.bloomSeen) return;
  w.done.bloomSeen = true;
  // fireHeld: the trigger was down as the scene began (fire is a held input), so a click only
  // skips once it has been let go and pressed again.
  w.scene = { kind: 'bloom', index, left: sim.cfg.bloomScene, fireHeld: !!(input && input.fire) };
  events.push({ type: 'sceneStart', kind: 'bloom', index });
}

/**
 * What runs while the bloom scene plays (security A4): the scene clock and the flow timers,
 * nothing else. This list documents it; the allow-list itself is stepScene below plus the early
 * return in sim.js's stepSim, which calls stepScene before anything else steps and returns at
 * once when it consumed the frame: no player, creature, bolt, pickup, weapon, hint, line,
 * notice or run clock moves. A step added to stepSim is outside a scene by default.
 */
export const SCENE_STEPS = Object.freeze(['scene', 'flows']);

/**
 * One frame of the bloom scene, or false when none plays. E, Enter, Space or a click (input
 * interact, fire, jump or skip) ends it early with the water already arrived; it also ends by
 * itself. Ending emits sceneEnd { kind, index }. Returns true for every frame it consumed.
 */
export function stepScene(sim, input, dt, events) {
  const w = sim.waves;
  const s = w && w.scene;
  if (!s) return false;
  stepFlows(sim, dt, events);
  s.left -= dt;
  const fire = !!(input && input.fire);
  if (s.fireHeld && !fire) s.fireHeld = false;
  const click = fire && !s.fireHeld; // a fresh press, not the trigger still held from the turn
  const skip = !!(input && (input.interact || click || input.jump || input.skip));
  if (skip) finishFlow(sim, s.index, events);
  if (skip || s.left <= 0) {
    w.scene = null;
    events.push({ type: 'sceneEnd', kind: s.kind, index: s.index });
  }
  return true;
}

/** Acts on what E is looking at. Returns true when the warden spoke to Renfield. */
function interact(sim, f, events, input) {
  const w = sim.waves;
  switch (f.kind) {
    case 'valve':
      if (turnValve(sim, f.index, events)) startScene(sim, f.index, events, input);
      return false;
    case 'loot': take(sim, f.index, events); return false;
    case 'stake': pullStake(sim, f.id, events); return false;
    case 'note': read(sim, f.key, events); return false;
    case 'menu': read(sim, 'menu', events); return false;
    case 'cupNote': read(sim, 'cupNote', events); return false;
    case 'hatCard': read(sim, 'hatCard', events); return false;
    case 'renfield': return true;
    case 'plot':
    case 'hunter':
    case 'rabbit':
      talkTo(sim, f.who, events);
      return false;
    case 'hat': {
      const r = useHat(sim, f.hat, events);
      if (r === 'solved') notice(sim, 'hatsSolved', events);
      if (r === 'fell') notice(sim, 'hatsFall', events);
      return false;
    }
    case 'halberd': {
      const d = (w.dropped || []).find((x) => x.id === f.id);
      if (!d || d.taken || !carry(sim, 'halberd')) return false;
      d.taken = true;
      events.push({ type: 'itemTake', item: 'halberd', at: 'dropped', x: d.x, z: d.z });
      notice(sim, NOTICE_KEYS.halberd, events);
      return false;
    }
    case 'bowl': {
      const rabbit = gateCreature(sim, 1);
      if (!rabbit) return false;
      if (w.items.garlic > 0 && w.items.carrot > 0) {
        w.items.garlic -= 1;
        w.items.carrot -= 1;
        rabbit.fed = true;
        events.push({ type: 'itemUse', item: 'salad', at: 'bowl', x: f.x, z: f.z });
      } else {
        events.push({ type: 'itemUse', item: 'salad', at: 'bowl', x: f.x, z: f.z, refused: true });
      }
      return false;
    }
    case 'stream':
      w.items.cup = 'full';
      events.push({ type: 'itemUse', item: 'cup', at: 'stream', x: f.x, z: f.z });
      notice(sim, NOTICE_KEYS.cupFull, events);
      return false;
    case 'pipe': {
      const cat = gateCreature(sim, 4);
      if (!cat || w.items.cup !== 'full') return false;
      w.items.cup = 'empty';
      cat.doused = true;
      events.push({ type: 'itemUse', item: 'cup', at: 'pipe', x: f.x, z: f.z });
      return false;
    }
    default: return false;
  }
}

// ---- the stepper --------------------------------------------------------------------------

/** Kills this frame (and any creature that died by its own rule): bodies, stakes, removal. */
function settleKills(sim, events) {
  const w = sim.waves;
  const seen = new Set();
  for (const ev of events.filter((x) => x.type === 'kill')) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    w.bodies.push({ id: ev.id, enemy: ev.enemy, x: ev.x, z: ev.z });
    stakesToBody(sim, ev.id, ev.x, ev.z);
    hybridKilled(sim, ev, events); // a gate creature's last word (the Hatter's, once a run)
  }
  if (!sim.enemies.some((e) => e.dead)) return;
  for (const e of sim.enemies) {
    if (!e.dead || seen.has(e.id)) continue;
    w.bodies.push({ id: e.id, enemy: e.type, x: e.x, z: e.z });
    stakesToBody(sim, e.id, e.x, e.z);
    hybridKilled(sim, { id: e.id, enemy: e.type, x: e.x, z: e.z }, events);
  }
  sim.enemies = sim.enemies.filter((e) => !e.dead);
}

function checkGate(sim, events) {
  const w = sim.waves;
  if (w.gateId == null || sim.enemies.some((e) => e.id === w.gateId && !e.dead)) return;
  const band = w.index;
  w.gateId = null;
  if (band < 1 || band > 4 || w.done.gates[band - 1]) return;
  if (band === 2) {
    // The Hatter is dead; his gate waits for the hats (R19).
    w.done.hatter = true;
    w.phase = 'awake';
    return;
  }
  openGate(sim, band, events);
}

function openGate(sim, band, events) {
  const w = sim.waves;
  w.done.gates[band - 1] = true;
  if (w.index === band) w.phase = 'open';
  refreshBlockers(sim);
  const g = MAZE.glades[band - 1].gate;
  events.push({ type: 'gateOpen', gate: band, x: g.x, z: g.z });
}

/** The Hatter's gate opens once the hats are right (and stays open). */
function hatsGate(sim, events) {
  const w = sim.waves;
  if (w.done.hats && !w.done.gates[1]) openGate(sim, 2, events);
}

function pit(sim, events) {
  const { player: pl, waves: w } = sim;
  const p = MAZE.pit;
  if (!w.done.pitOpen && pl.grounded && !pl.dead && Math.hypot(pl.x - p.x, pl.z - p.z) < p.trigger) {
    w.done.pitOpen = true;
    events.push({ type: 'pitFall', x: p.x, z: p.z });
    addEntry(sim, 'pit', events);
    pl.grounded = false;
    pl.vy = 0;
    pl.airPeak = pl.y;
    w.falling = true;
    return;
  }
  if (w.falling && pl.grounded) {
    w.falling = false;
    hurtPlayer(sim, sim.cfg.pit.damage, pl.x, pl.z, events);
  }
}

const EMPTY = deadEnds().find((d) => d.holds === 'empty');

function grin(sim, events) {
  const { cfg, player: pl, waves: w } = sim;
  if (w.done.grinSpent) return;
  const d = Math.hypot(pl.x - EMPTY.x, pl.z - EMPTY.z);
  if (!w.grinArmed) {
    if (d < cfg.grin.armed) w.grinArmed = true;
    return;
  }
  if (d > MAZE.cell) {
    w.grinArmed = false;
    return;
  }
  const fx = -Math.sin(pl.yaw);
  const fz = -Math.cos(pl.yaw);
  if (fx * EMPTY.exit.x + fz * EMPTY.exit.z < cfg.grin.turn) return;
  w.done.grinSpent = true;
  w.grinArmed = false;
  const r = cfg.grin.reach;
  events.push({ type: 'grin', x: pl.x + fx * r, y: pl.y + cfg.player.eyeHeight, z: pl.z + fz * r });
  addEntry(sim, 'grin', events);
}

function enterStage(sim, k, events) {
  const w = sim.waves;
  w.index = k;
  w.phase = phaseFor(w, k);
  sim.stats.waveReached = Math.max(sim.stats.waveReached, k + 1);
  if (k === 1) {
    // The court's figures stay behind the threshold rill; they are not seen again.
    for (const e of sim.enemies) if (COURT_FIGURES.includes(e.type)) stakesDrop(sim, e.id, e.x, e.z);
    sim.enemies = sim.enemies.filter((e) => !COURT_FIGURES.includes(e.type));
    sim.bolts = [];
    addEntry(sim, 'toForest', events);
    addEntry(sim, 'wood', events);
  }
  if (k === 2) addEntry(sim, 'rats', events);
  if (k === 4) addEntry(sim, 'rain', events);
  events.push({ type: 'checkpoint', index: k, name: PLACES[k] });
  events.push({ type: 'waveStart', wave: k + 1, of: w.count, stage: k });
  seatStage(sim, k, events);
  w.checkpoint = snapshot(sim, k);
}

function finish(sim, events) {
  const { player: pl, waves: w } = sim;
  w.phase = 'done';
  w.items.ticket = true;
  w.focus = null;
  events.push({ type: 'itemTake', item: 'ticket', at: 'end', x: pl.x, z: pl.z });
  addEntry(sim, 'toCastle', events);
  events.push({ type: 'allClear' });
}

/**
 * One frame of the level, after the player, creatures, bolts and pickups have moved and death
 * has been checked (so a same-frame death beats a gate creature's death). input.interact acts
 * on focusOf(sim).
 */
export function stepTrail(sim, dt, events, input = {}) {
  const { cfg, player: pl, waves: w } = sim;
  if (w.phase === 'done') return;
  if (w.line) {
    w.line.left -= dt;
    if (w.line.left <= 0) w.line = null;
  }
  if (w.notice) {
    w.notice.left -= dt;
    if (w.notice.left <= 0) w.notice = null;
  }
  stepFlows(sim, dt, events);
  settleKills(sim, events);
  checkGate(sim, events);

  let asked = false;
  if (input && input.interact) {
    const f = focusOf(sim);
    if (f) asked = interact(sim, f, events, input);
  }
  hatsGate(sim, events);
  stepRenfield(sim, dt, events, asked);
  noteWater(sim, events);
  pit(sim, events);
  grin(sim, events);

  if (w.index >= 1 && w.index <= 4 && w.phase === 'still' && inRect(MAZE.glades[w.index - 1], pl.x, pl.z)) w.phase = 'awake';
  const s = stageAt(pl.x, pl.z);
  while (w.index < s) enterStage(sim, w.index + 1, events);
  stepWeather(sim, dt); // #28: the sky clears once the Caterpillar's gate is open
  if (w.index === STAGES - 1 && pl.z < cfg.end.z) {
    finish(sim, events);
    return;
  }
  stepHints(sim, dt, events);
  w.focus = focusOf(sim);
}
