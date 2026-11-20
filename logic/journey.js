// One continuous journey (issue #29): yard, cave, the Rose Court and its wood, the castle. A
// level that is won no longer ends on a card: the way on opens and the warden walks it. The yard's
// last surge leaves a ramp of rubble down into the dark under its broken floor (the way down into
// the cave); the Nave, once the Cantor falls, a mound of fallen rock under a hole in the vault, the
// daylight pouring through it (the way up into the Rose Court, out of the crater the court begins
// beside); the wood's end runs straight on to the road up to the castle (road.js; main.js hands
// over there).
//
// The rubble ways (the owner, 2026-11-18; rubble.js): the ramp and the mound are a PATH, real
// ground the warden walks down (or up), the eye falling (or rising) with it. RUBBLE.trigger metres
// along it the view takes over by itself and FOLLOWS the path for FOLLOW.length seconds (a scene,
// kind 'descent' in the yard, 'ascent' in the cave: the same freeze, skip and latch as the way-out
// scenes, A4/A6), a fade coming in at its end; turning back before the trigger leaves nothing
// started. When the follow ends (or is skipped) `done` is set and main.js hands the run to the next
// room with what the warden carries (carryOf, seatCarry), as before. A passage with no path (a site
// kept with no heading) keeps the old mouth: PASSAGE.through seconds inside it, PASSAGE.back
// faster undone. Pure: state lives in sim.waves.passage, created when the level is won (sim.js
// openPassage), so a run that is not won has none.

import { rewriteEntrance } from './trail.js';
import { siteFor, wayoutKind, wayoutMouth, latch } from './wayout.js';
import { RUBBLE, FOLLOW, pathFor, laneU, seatAllOnPath, followFade } from './rubble.js';
import { ceilingAt } from './cavemap.js';

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
  through: 1.6, // a passage with no path: seconds inside the mouth to be carried through it
  back: 1.5, // and how much faster it undoes, walking back out
  arrive: 1.4, // seconds the next room takes to come up out of the dark (or the light) as it starts
  trigger: RUBBLE.trigger, // metres along the rubble path at which the follow starts
  follow: FOLLOW.length, // seconds the follow takes, to the hand-over
  near: 0.12, // the cover's strength at the trigger as the warden walks down (or up) toward it: a touch of the dark (or the glare)
});

/** The scene the follow plays as: down the ramp into the dark (the yard), up the mound into the light (the cave). */
export const FOLLOW_KIND = Object.freeze({ yard: 'descent', cave: 'ascent' });

const PATHS = new WeakMap(); // wayout -> its path (derived, never stored in the sim)

/** The rubble path of the room's kept way out once it is open (rubble.js pathFor), or null. */
export function pathOf(sim) {
  const o = sim && sim.waves && sim.waves.wayout;
  if (!o || !o.open || !MOUTHS[sim.cfg.room] || o.kind !== wayoutKind(sim.cfg.room)) return null;
  const room = sim.cfg.room;
  let c = PATHS.get(o);
  if (!c || c.room !== room || c.x !== o.x || c.z !== o.z || c.dx !== o.dx || c.dz !== o.dz || c.vault !== o.vault) {
    c = { room, x: o.x, z: o.z, dx: o.dx, dz: o.dz, vault: o.vault, path: pathFor(room, o) };
    PATHS.set(o, c);
  }
  return c.path;
}

/**
 * As the way out opens (its blast, or a level ended directly): every pickup lying on the path is
 * laid on its floor, and one in its walls' footprint (over the yard's opening, on the heap's
 * flank) moved onto the lane, so all of them stay within reach (rubble.js seatOnPath).
 */
export function seatPickups(sim) {
  return seatAllOnPath(pathOf(sim), sim.pickups, (sim.cfg.player && sim.cfg.player.radius) || 0.4);
}

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
    w.wayout = { kind, x: s.x, z: s.z, r: s.r, dx: s.dx, dz: s.dz, open: true };
    if (kind === 'vault') w.wayout.vault = ceilingAt(s.x, s.z);
    seatPickups(sim);
  } else if (w.wayout) w.wayout.open = true;
  w.passage = p;
  return p;
}

/** True when (x, z) is inside the mouth (the run's kept site when a sim is given). */
export function inMouth(room, x, z, sim = null) {
  const m = sim ? mouthOf(sim, room) : MOUTHS[room];
  return !!m && Math.hypot(x - m.x, z - m.z) <= m.r;
}

/**
 * One frame of the way on (sim.js, while `won`, after the feet have moved). On a rubble path: how
 * far along it the warden stands (p.u, 0 off it), and at PASSAGE.trigger metres the follow starts
 * (sim.waves.scene; input: this frame's: a key held since the last frame too is not taken for a
 * skip, one pressed on this very frame is: p.down keeps the last frame's). With no
 * path: inside the mouth it carries the warden through; out of it, it lets go.
 */
export function stepPassage(sim, dt, input = null) {
  const p = sim && sim.waves && sim.waves.passage;
  if (!p || p.done || !(dt > 0)) return;
  const pl = sim.player;
  const path = pathOf(sim);
  if (path) {
    const u = laneU(path, pl.x, pl.z);
    p.u = u == null ? 0 : u;
    if (u != null && u >= PASSAGE.trigger && !sim.waves.scene) startFollow(sim, input);
    const down = p.down || (p.down = {});
    for (const k of HELD) down[k] = !!(input && input[k]);
    return;
  }
  if (inMouth(p.room, pl.x, pl.z, sim)) p.t = Math.min(PASSAGE.through, p.t + dt);
  else p.t = Math.max(0, p.t - dt * PASSAGE.back);
  if (p.t >= PASSAGE.through) p.done = true;
}

const HELD = ['fire', 'jump', 'interact', 'skip'];

/** The follow begins: the view takes over from the warden's eye, where they stand, as they face. */
export function startFollow(sim, input = null) {
  const w = sim.waves;
  const pl = sim.player;
  const was = (w.passage && w.passage.down) || {};
  const held = {};
  for (const k of HELD) if (input && input[k] && was[k]) held[k] = true; // held since before it began (pressed on its first frame: a press)
  w.scene = {
    kind: FOLLOW_KIND[sim.cfg.room], t: 0, length: FOLLOW.length, skippable: true, held,
    from: { x: pl.x, y: pl.y, z: pl.z, yaw: pl.yaw, pitch: pl.pitch },
  };
  w.passage.t = 0;
  return w.scene;
}

/**
 * One frame of the follow (sim.js, first, while it plays: nothing else moves, A4). Its clock runs;
 * it ends by itself at its length, or at once on E, Enter, Space or a fresh click (a key held as it
 * began counts only once let go and pressed again). Ending: the passage is through (`done`), and
 * whatever is held is latched (A6). False when no follow plays.
 */
export function stepFollow(sim, input, dt) {
  const w = sim && sim.waves;
  const s = w && w.scene;
  if (!s || (s.kind !== 'descent' && s.kind !== 'ascent')) return false;
  s.t = Math.min(s.length, s.t + Math.max(0, dt || 0));
  for (const k of HELD) if (s.held[k] && !(input && input[k])) delete s.held[k];
  const skip = HELD.some((k) => input && input[k] && !s.held[k]);
  if (w.passage) w.passage.t = s.t;
  if (skip || s.t >= s.length) {
    w.scene = null;
    if (w.passage) { w.passage.done = true; w.passage.skipped = !!skip; }
    latch(w, input);
  }
  return true;
}

/**
 * For the view: { k: 0 to 1 how far through, way: 'down' | 'up', mouth, done, path, u, near (0 to
 * 1: how near the trigger the warden has walked), follow (seconds into the follow, or null), cover
 * (0 to 1: the strength of the dark or the daylight to draw over the view) } or null with no
 * passage open. On a path k is the follow's fade (0 while walking); with none, the time inside the mouth.
 */
export function passageOf(sim) {
  const p = sim && sim.waves && sim.waves.passage;
  if (!p) return null;
  const m = mouthOf(sim, p.room);
  const path = pathOf(sim);
  if (!path) return { k: clamp(p.t / PASSAGE.through), way: m.way, mouth: m, done: p.done, path: null, cover: null };
  const sc = sim.waves.scene;
  const follow = sc && (sc.kind === 'descent' || sc.kind === 'ascent') ? sc.t : null;
  const near = clamp((p.u || 0) / PASSAGE.trigger);
  const k = p.done ? 1 : follow != null ? followFade(follow) : 0;
  return {
    k, way: m.way, mouth: m, done: p.done, path, u: p.u || 0, near, follow,
    cover: p.done ? 1 : Math.max(k, PASSAGE.near * near * near),
  };
}

/** All the weapons carried, in Q order from the one in hand. */
const carriedOf = (sim) => [sim.weapon, sim.holster, ...(sim.rack || [])].filter(Boolean);

/**
 * What the warden carries out of a room: health, every carried weapon (a copy), and the log. A
 * copy: nothing of the old sim is shared.
 */
export function carryOf(sim) {
  if (!sim || !sim.player) return null;
  const held = sim.waves && sim.waves.latch;
  const keys = held ? Object.keys(held).filter((k) => k !== 'move') : [];
  return {
    from: sim.cfg && sim.cfg.room,
    health: sim.player.health,
    weapons: clone(carriedOf(sim)),
    log: clone((sim.waves && sim.waves.log) || []),
    // the follow's latch (A6): a key held as it ended counts for nothing in the next room either,
    // until let go. Not the stride: walking on is the point.
    latch: keys.length ? Object.fromEntries(keys.map((k) => [k, true])) : null,
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
  if (sim.waves && carry.latch && typeof carry.latch === 'object') {
    const keys = Object.keys(carry.latch).filter((k) => HELD.includes(k) || k === 'reload' || k === 'sprint' || k === 'hold');
    if (keys.length) sim.waves.latch = Object.fromEntries(keys.map((k) => [k, true]));
  }
  rewriteEntrance(sim); // the court's entrance checkpoint holds what was carried in (the yard and the cave have none)
  return true;
}

/**
 * Where the warden walks out of the wood (the court's end, just through the Caterpillar's gate): the
 * offset across the approach from its middle, how far down it (z), and the facing, for the walk to
 * the road (tunnelwalk.js tunnelSeat). x0: the approach's middle.
 */
export function poseOf(sim, x0 = 0) {
  const pl = sim.player;
  return { offset: pl.x - x0, z: pl.z, yaw: pl.yaw, pitch: pl.pitch };
}
