// One continuous journey (issue #29): yard, cave, the Rose Court and its wood, the castle. A
// level that is won no longer ends on a card: the way on opens and the warden walks it. The yard's
// last surge leaves a crater (the way down into the cave); the Nave, once the Cantor falls, shows a
// shaft of daylight (the way up into the Rose Court, out of the crater the court begins beside);
// the wood's end runs straight on to the road up to the castle (road.js; main.js hands over there).
// Walking into a mouth carries the warden through it over PASSAGE.through seconds (the view goes
// down into the dark, or up into the light: main.js draws it from passageOf); walking back out
// undoes it. When it is through, `done` is set and main.js hands the run to the next room with
// what the warden carries (carryOf, seatCarry). Pure: state lives in sim.waves.passage, created
// when the level is won (sim.js openPassage), so a run that is not won has none.

import { rewriteEntrance } from './trail.js';
import { siteFor, wayoutKind, wayoutMouth } from './wayout.js';

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

/** The room each room's way on leads to. */
export const NEXT = Object.freeze({ yard: 'cave', cave: 'court', court: 'castle' });

/**
 * The mouth of each passage: its radius and which way it goes (down into the dark, up into the
 * light). Where it opens is the site the win's cut scene picked and kept (wayout.js, the owner's
 * 23:0x and 23:3x PST: anywhere open, never on top of the warden); x and z here are only the
 * shipped places, for a run with no kept site (mouthOf).
 */
export const MOUTHS = Object.freeze({
  yard: Object.freeze({ x: 0, z: -4.5, r: 2.0, way: 'down' }),
  cave: Object.freeze({ x: 2, z: -82, r: 1.8, way: 'up' }),
});

export const PASSAGE = Object.freeze({
  through: 1.6, // seconds inside the mouth to be carried through it
  back: 1.5, // how much faster it undoes, walking back out
  arrive: 1.4, // seconds the next room takes to come up out of the dark (or the light) as it starts
});

/** A fresh passage for a room just won, or null for a room with no mouth (the court hands over at the wood's end). */
export function createPassage(room) {
  return MOUTHS[room] ? { room, t: 0, done: false } : null;
}

/** The mouth of a room's passage in this run: its kept site once open, else the shipped place. */
export function mouthOf(sim, room) {
  return wayoutMouth(sim, room) || MOUTHS[room] || null;
}

/**
 * Opens the way on as a level is won (sim.js calls it on the frame `won` is emitted). A room won
 * with no scene played (a level ended directly) picks and keeps its site now, open at once.
 */
export function openPassage(sim) {
  if (!sim || !sim.cfg || !sim.waves) return null;
  const room = sim.cfg.room;
  const p = createPassage(room);
  if (!p) return null;
  const w = sim.waves;
  const kind = wayoutKind(room);
  if (kind && !w.wayout) {
    const pl = sim.player;
    const s = siteFor(room, sim.cfg, sim.seed, { x: pl.x, z: pl.z }, sim.boxes || sim.cfg.boxes);
    w.wayout = { kind, x: s.x, z: s.z, r: s.r, open: true };
  } else if (w.wayout) w.wayout.open = true;
  w.passage = p;
  return p;
}

/** True when (x, z) is inside the mouth (the run's kept site when a sim is given). */
export function inMouth(room, x, z, sim = null) {
  const m = sim ? mouthOf(sim, room) : MOUTHS[room];
  return !!m && Math.hypot(x - m.x, z - m.z) <= m.r;
}

/** One frame of the way on (sim.js, while `won`): inside the mouth it carries the warden through; out of it, it lets go. */
export function stepPassage(sim, dt) {
  const p = sim && sim.waves && sim.waves.passage;
  if (!p || p.done || !(dt > 0)) return;
  const pl = sim.player;
  if (inMouth(p.room, pl.x, pl.z, sim)) p.t = Math.min(PASSAGE.through, p.t + dt);
  else p.t = Math.max(0, p.t - dt * PASSAGE.back);
  if (p.t >= PASSAGE.through) p.done = true;
}

/** For the view: { k: 0 to 1 how far through, way: 'down' | 'up', mouth } or null with no passage open. */
export function passageOf(sim) {
  const p = sim && sim.waves && sim.waves.passage;
  if (!p) return null;
  const m = mouthOf(sim, p.room);
  return { k: clamp(p.t / PASSAGE.through), way: m.way, mouth: m, done: p.done };
}

/** All the weapons carried, in Q order from the one in hand. */
const carriedOf = (sim) => [sim.weapon, sim.holster, ...(sim.rack || [])].filter(Boolean);

/**
 * What the warden carries out of a room: health, every carried weapon (a copy), and the log. A
 * copy: nothing of the old sim is shared.
 */
export function carryOf(sim) {
  if (!sim || !sim.player) return null;
  return {
    from: sim.cfg && sim.cfg.room,
    health: sim.player.health,
    weapons: clone(carriedOf(sim)),
    log: clone((sim.waves && sim.waves.log) || []),
  };
}

/**
 * Seats a carry in the room the sim has just been reset into (the cave from the yard, the court
 * from the cave): the health as it was (never more than the room's full, never less than 1); a
 * weapon this room also arms (the salt gun out of the cave into the court) with the rounds it had,
 * clamped to the weapon's spec; a weapon the room does not arm stays behind (the yard's carbine:
 * each new weapon is picked up on arrival, the owner's record of 2026-11-12); and the log's entries
 * ahead of the room's own (none before the court has a log). Returns false for no carry.
 */
export function seatCarry(sim, carry) {
  if (!sim || !carry || !Number.isFinite(carry.health) || carry.health <= 0) return false;
  const cfg = sim.cfg;
  sim.player.health = clamp(carry.health, 1, cfg.player.health);
  const list = Array.isArray(carry.weapons) ? carry.weapons : [];
  for (const w of carriedOf(sim)) {
    const was = list.find((x) => x && x.name === w.name);
    if (!was) continue;
    const spec = (cfg.weapons && cfg.weapons[w.name]) || (cfg.weapon && cfg.weapon.name === w.name ? cfg.weapon : null);
    if (!spec) continue;
    if (Number.isFinite(was.mag)) w.mag = clamp(Math.floor(was.mag), 0, spec.magazine);
    if (Number.isFinite(was.reserve)) w.reserve = clamp(Math.floor(was.reserve), 0, spec.maxReserve);
  }
  if (sim.waves && Array.isArray(sim.waves.log) && Array.isArray(carry.log)) {
    const own = sim.waves.log;
    sim.waves.log = [...carry.log.filter((k) => typeof k === 'string'), ...own].filter((k, i, a) => a.indexOf(k) === i);
  }
  rewriteEntrance(sim); // the court's entrance checkpoint holds what was carried in (the yard and the cave have none)
  return true;
}

/**
 * Where the warden walks out of the wood (the court's end): the offset across the approach from
 * its middle, and the facing, for the road's foot (road.js footSeat). x0: the approach's middle.
 */
export function poseOf(sim, x0 = 0) {
  const pl = sim.player;
  return { offset: pl.x - x0, yaw: pl.yaw, pitch: pl.pitch };
}
