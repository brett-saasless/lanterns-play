// One run of LANTERN YARD (any room). stepSim(sim, input, dt) -> events[] is the only seam
// between the rules and the presentation layer. The room is sim.cfg; cfg.encounter picks the
// encounter stepper (waves for the yard, chambers for the cave, trail for the Rose Court, keep
// for the castle).

import { CONFIG } from './config.js';
import { makeRng } from './rng.js';
import { createPlayer, respawnPosition } from './player.js';
import { createWeapon, tryFire, startReload, cancelReload, cancelSwing, stepWeapon, specOf, swapWeapon, gunOf } from './weapon.js';
import { moveCircle } from './collide.js';
import { surfaceAt, WEEPER_POOL_MATERIAL } from './surfaces.js';
import { soundsOf, emitSound } from './sounds.js';
import { castShot, arcTargets, lineOfSight } from './hitscan.js';
import { stepEnemy, damageEnemy, stepBolts, separate, blockersFor, hurtPlayer } from './enemy.js';
import { climbs, climbFloor, climbSurface, climbMove, onLadder, fallHurt, frameStart, settle, yardFloor } from './climb.js';
import { createWaves, stepWaves, hostilesLeft } from './waves.js';
import { createChambers, stepChambers, chamberBoxes } from './chambers.js';
import { createTrail, stepTrail, trailBoxes, startTrail, stepScene } from './trail.js';
import { floorAt, MAZE } from './courtmap.js';
import { createKeep, stepKeep, keepBoxes, startKeep, keepFloor, keepGround, stepKeepScene, pauseKeep, keepSurface } from './keep.js';
import { lodgeStake } from './stakes.js';
import { splashStun } from './courtiers.js';
import { raiseGarlic, stepGarlic } from './sentries.js';
import { stepHazards } from './hazards.js';
import { restockPads, rollDrop, addDrop, stepPickups } from './pickups.js';
import { openPassage, stepPassage, stepFollow, pathOf } from './journey.js'; // issue #29: the way on from a won level
import { laneFloor, keepToPath } from './rubble.js'; // the rubble ways: the yard's ramp, the cave's heap (real ground)
import { startWayout, stepWayoutScene, releaseLatch, wayoutKind } from './wayout.js'; // #29: the crater's and the vault's cut scenes

export { hostilesLeft };

export const MAX_DT = 0.05;

/**
 * interact and swap are one-shot, like jump. swap: true is Q (the next carried weapon); a name
 * ('bore', 'crossbow', 'halberd', 'cup', 'garlic': keys 1 to 5) asks for that one. skip (Enter)
 * ends the bloom scene early, as E, Space or a click do. hold is E held down (the castle's cord,
 * read only from a press the sim observed: keep.js, security A6). The castle's garlic is raised
 * by fire, from a press the sim observed (sentries.js raiseGarlic).
 */
export const IDLE_INPUT = Object.freeze({
  moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0,
  fire: false, reload: false, sprint: false, jump: false,
  interact: false, swap: false, skip: false, hold: false,
});

/**
 * Encounter steppers by cfg.encounter. boxes(cfg, state) gives the live collision list;
 * start(sim), when present, runs at the end of resetSim (the trail seats its figures there).
 * The castle's keep also gives floor(sim, x, z, y) (the room's map answers the ground height),
 * ground(sim) (after the warden moves: which floor, sim.waves.under, and the boxes for it),
 * scene (its own scene stepper), pause, and surface (what is underfoot on the lower floors).
 */
const ENCOUNTERS = {
  // The yard: its climbable crates answer the floor and what is underfoot (climb.js, #21).
  // #29: the yard's and the cave's way out open in a cut scene (wayout.js stepWayoutScene, the same freeze, A4).
  waves: { create: createWaves, step: stepWaves, boxes: (cfg) => cfg.boxes, floor: climbFloor, surface: climbSurface, scene: stepWayoutScene },
  chambers: { create: createChambers, step: stepChambers, boxes: chamberBoxes, scene: stepWayoutScene },
  trail: { create: createTrail, step: stepTrail, boxes: trailBoxes, start: startTrail },
  keep: {
    create: createKeep, step: stepKeep, boxes: keepBoxes, start: startKeep,
    floor: keepFloor, ground: keepGround, scene: stepKeepScene, pause: pauseKeep, surface: keepSurface,
  },
};

/**
 * Ground height under (x, z) for feet at y: the room's map answers (the castle's two floors on
 * one plan, keepmap.js floorZoneAt), the Rose Court's pit once open, else 0.
 */
function floorOf(sim, x, z, y) {
  // the rubble ways (journey.js pathOf, once the way out is open): the ramp's floor falls under
  // the yard's, the heap's rises over the cave's (rubble.js laneFloor), as the castle's stairs do
  const lane = laneFloor(pathOf(sim), x, z);
  if (lane != null) return lane;
  const enc = encounterOf(sim.cfg);
  if (enc.floor) return enc.floor(sim, x, z, y);
  return sim.cfg.encounter === 'trail' ? floorAt(sim.waves, x, z) : 0;
}

/** Height the warden steps down without leaving the ground (walking down the pit's slope). */
const STEP_DOWN = 0.25;

function encounterOf(cfg) {
  return ENCOUNTERS[cfg.encounter] || ENCOUNTERS.waves;
}

/**
 * Every field of sim, all of which resetSim rebuilds from cfg and seed (cfg itself is taken
 * from the argument). Nothing survives a reset, so nothing carries between runs or rooms.
 * Adding a field to sim without adding it here (and rebuilding it in resetSim) is a defect;
 * tests/isolation.test.js fails on any sim field missing from this list.
 */
export const RESET_FIELDS = Object.freeze([
  'cfg', // the room; replaced when resetSim is given a cfg
  'seed',
  'rng',
  'time',
  'nextId',
  'player',
  'weapon', // the weapon in hand
  'holster', // the next weapon on Q (the Rose Court), or null
  'rack', // the rest of the carried weapons after the holster, in Q order; empty with two
  'enemies', // emptied: no Wick, Bellows, Lurch, Weeper or Cantor survives a reset
  'bolts',
  'globs', // cave hazards in flight
  'pools', // cave hazards on the floor
  'pickups',
  'waves', // encounter state (waves.js or chambers.js), incl. veil state in the cave
  'boxes', // live collision list: cfg.boxes in the yard (same array), + closed veils in the cave
  'stats',
  'status',
  'statusTimer',
  'softlockFor',
  'pending',
]);

export function createSim(seed = 1, cfg = CONFIG) {
  const sim = { cfg };
  resetSim(sim, seed);
  return sim;
}

/**
 * Full reset in place: fresh player, weapon, encounter, re-seeded pickups, zeroed stats.
 * cfg (optional) switches the room. Every field in RESET_FIELDS is rebuilt; any other field
 * found on sim is deleted, so no state from the previous run or room survives.
 */
export function resetSim(sim, seed = sim.seed, cfg = sim.cfg) {
  for (const k of Object.keys(sim)) if (!RESET_FIELDS.includes(k)) delete sim[k];
  sim.cfg = cfg;
  const enc = encounterOf(cfg);
  sim.seed = seed;
  sim.rng = makeRng(seed);
  sim.time = 0;
  sim.nextId = 1;
  sim.player = createPlayer(cfg);
  sim.weapon = createWeapon(cfg);
  sim.holster = null;
  sim.rack = [];
  sim.enemies = [];
  sim.bolts = [];
  sim.globs = [];
  sim.pools = [];
  sim.pickups = [];
  sim.waves = enc.create(cfg, sim.rng);
  sim.boxes = enc.boxes(cfg, sim.waves);
  sim.stats = { shots: 0, hits: 0, kills: 0, damageTaken: 0, time: 0, waveReached: 1 };
  sim.status = 'playing'; // playing | winning | dying | won | lost
  sim.statusTimer = 0;
  sim.softlockFor = 0;
  sim.pending = [{ type: 'waveStart', wave: 1, of: sim.waves.count }];
  if (cfg.encounter === 'trail' || cfg.encounter === 'keep') sim.pending[0].stage = 0;
  restockPads(sim);
  if (enc.start) enc.start(sim);
  return sim;
}

export function lookDir(pl) {
  const cp = Math.cos(pl.pitch);
  return { x: -Math.sin(pl.yaw) * cp, y: Math.sin(pl.pitch), z: -Math.cos(pl.yaw) * cp };
}

/**
 * Pellet directions for one trigger pull. The first pellet flies down the aim line; the
 * rest are spread uniformly over the disc of the cone whose half-angle is spread. With one
 * pellet or no spread no randomness is drawn (the carbine).
 */
export function pelletDirs(dir, pellets, spread, rng) {
  const out = [dir];
  if (pellets <= 1) return out;
  // Orthonormal basis around dir.
  let rx = -dir.z;
  let rz = dir.x;
  let rl = Math.hypot(rx, rz);
  if (rl < 1e-6) { rx = 1; rz = 0; rl = 1; }
  const right = { x: rx / rl, y: 0, z: rz / rl };
  const up = {
    x: right.y * dir.z - right.z * dir.y,
    y: right.z * dir.x - right.x * dir.z,
    z: right.x * dir.y - right.y * dir.x,
  };
  for (let i = 1; i < pellets; i++) {
    if (spread <= 0) { out.push(dir); continue; }
    const theta = spread * Math.sqrt(rng());
    const phi = 2 * Math.PI * rng();
    const s = Math.sin(theta);
    const c = Math.cos(theta);
    const a = Math.cos(phi) * s;
    const b = Math.sin(phi) * s;
    out.push({
      x: dir.x * c + right.x * a + up.x * b,
      y: dir.y * c + right.y * a + up.y * b,
      z: dir.z * c + right.z * a + up.z * b,
    });
  }
  return out;
}

/**
 * Moves and turns the warden, and emits what the feet do (step, jump, land, splash; payloads
 * in docs/features/audio/02-design.md). Steps count ground actually covered after collision,
 * so walking into a wall is silent; nothing is emitted at dt 0, in the air or once dead.
 */
function movePlayer(sim, input, dt, events) {
  const { cfg, player: pl } = sim;
  const pc = cfg.player;
  pl.yaw -= input.lookDX || 0;
  pl.pitch = Math.max(-pc.pitchLimit, Math.min(pc.pitchLimit, pl.pitch - (input.lookDY || 0)));

  let mx = Math.max(-1, Math.min(1, input.moveX || 0));
  let mz = Math.max(-1, Math.min(1, input.moveZ || 0));
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  pl.sprinting = !!input.sprint && mz > 0;
  let speed = pl.sprinting ? pc.sprintSpeed : pc.walkSpeed;
  if (pl.dropping && !pl.grounded) speed = Math.min(speed, cfg.climb.dropSpeed); // a step off a crate edge (#21)
  const s = Math.sin(pl.yaw);
  const c = Math.cos(pl.yaw);
  // right = (cos, -sin), forward = (-sin, -cos)
  const vx = (mx * c - mz * s) * speed;
  const vz = (-mx * s - mz * c) * speed;
  pl.moving = len > 0.01;
  const x0 = pl.x;
  const z0 = pl.z;
  if (climbs(cfg)) climbMove(sim, pl, { x: vx * dt, z: vz * dt }, pc.radius, pl.grounded, dt); // the yard's crates (#21)
  else moveCircle(pl, { x: vx * dt, z: vz * dt }, pc.radius, sim.boxes, cfg.arena.half);
  const rubble = pathOf(sim);
  if (rubble) keepToPath(rubble, x0, z0, pl, pc.radius); // the trench's edge, the heap's flank: walls where the lane stands off the floor

  // Ground height (zero but for the Rose Court's opened pit): follow it down a slope, or drop.
  const floor = floorOf(sim, pl.x, pl.z, pl.y);
  if (pl.grounded && floor !== pl.y) {
    if (floor < pl.y - STEP_DOWN) {
      pl.grounded = false;
      pl.vy = 0;
      pl.airPeak = pl.y;
      if (climbs(cfg)) { pl.dropping = true; pl.takeoff = pl.y; } // walked off an edge: down near-straight (#21)
    } else {
      pl.y = floor;
    }
  }

  const audible = dt > 0 && !pl.dead;
  if (audible && pl.splashCool > 0) pl.splashCool = Math.max(0, pl.splashCool - dt);
  if (audible && pl.grounded) footfalls(sim, pl, Math.hypot(pl.x - x0, pl.z - z0), events);

  if (input.jump && pl.grounded) {
    if (pl.dropping) pl.dropping = false;
    if (climbs(cfg)) pl.takeoff = pl.y; // the floor jumped from: the fall is measured from it (#21)
    pl.vy = pc.jumpVelocity;
    pl.grounded = false;
    pl.airPeak = pl.y;
    const under = groundAt(sim, pl.x, pl.z); // the surface left behind
    pl.surface = under.family;
    pl.material = under.material;
    if (audible) emitSound(events, { type: 'jump', surface: pl.surface, material: pl.material });
  }
  if (!pl.grounded) {
    if (pl.y > pl.airPeak) pl.airPeak = pl.y;
    pl.vy -= pc.gravity * dt;
    pl.y += pl.vy * dt;
    if (pl.y > pl.airPeak) pl.airPeak = pl.y;
    if (pl.y < pc.fallResetY) respawnPosition(pl, cfg);
    else if (pl.y <= floor) {
      const impact = -pl.vy;
      pl.y = floor;
      pl.vy = 0;
      pl.grounded = true;
      if (pl.dropping) pl.dropping = false;
      if (audible) landing(sim, pl, impact, events);
    }
  }
  // The castle: which floor the warden is now on (sim.waves.under, read by the fall, the landing
  // and the collision for that floor), from position alone (security A3).
  const enc = encounterOf(cfg);
  if (enc.ground) enc.ground(sim);
  if (climbs(cfg)) pl.climbing = pl.grounded && onLadder(cfg, pl); // the climb pose (#21)
}

const gaitOf = (pl) => (pl.sprinting ? 'run' : 'walk');

/** What is underfoot at the warden's feet: the room's own answer where it has one (the castle's lower floors). */
function groundAt(sim, x, z) {
  const enc = encounterOf(sim.cfg);
  return enc.surface ? enc.surface(sim, x, z) : surfaceAt(sim, x, z);
}

/**
 * Reads the ground at the warden's feet. Returns the splash event when this contact turned the
 * family wet from anything else (not for a Weeper's pool, at most once per splashCooldown).
 */
function touchGround(sim, pl, impact) {
  const was = pl.surface;
  const under = groundAt(sim, pl.x, pl.z);
  pl.surface = under.family;
  pl.material = under.material;
  if (under.family !== 'wet' || was === 'wet' || under.material === WEEPER_POOL_MATERIAL || pl.splashCool > 0) return null;
  pl.splashCool = sim.cfg.player.splashCooldown;
  return { type: 'splash', impact, gait: gaitOf(pl) };
}

/** Grounded frame: covered metres of ground advance the stride; one step per stride length. */
function footfalls(sim, pl, covered, events) {
  const stride = sim.cfg.player.stride;
  if (!pl.moving || covered < 1e-6) {
    if (!pl.moving) pl.stride = 0.5; // a new move takes its first step after half a stride
    return;
  }
  const splash = touchGround(sim, pl, 0);
  if (splash) emitSound(events, splash);
  pl.stride += covered / stride[gaitOf(pl)];
  if (pl.stride < 1) return;
  pl.stride -= Math.floor(pl.stride);
  emitSound(events, { type: 'step', gait: gaitOf(pl), surface: pl.surface, material: pl.material, foot: pl.foot });
  pl.foot = 1 - pl.foot;
}

/** Touchdown: a landing in the family landed on, then (into water) a splash. */
function landing(sim, pl, impact, events) {
  const fall = pl.airPeak - pl.y; // pl.y is the floor landed on (0 but in the pit)
  const splash = touchGround(sim, pl, impact);
  emitSound(events, { type: 'land', surface: pl.surface, material: pl.material, impact, fall });
  if (splash) emitSound(events, splash); // a larger splash over the landing's thump
  if (climbs(sim.cfg)) fallOff(sim, pl, events);
  pl.airPeak = 0;
  pl.stride = 0.5; // the landing is the footfall; the next step comes half a stride on
}

/**
 * The yard's fall (#21): a landing more than cfg.climb.safeDrop below the floor it left (walked
 * off or jumped from; a jump's own height is not a drop, so a hop off the small box is free)
 * costs a share of the gallery's fall. The hurt carries fall: true (no direction to show).
 */
function fallOff(sim, pl, events) {
  const drop = (Number.isFinite(pl.takeoff) ? pl.takeoff : pl.y) - pl.y;
  pl.takeoff = pl.y;
  const amount = fallHurt(sim.cfg, drop);
  if (amount > 0 && hurtPlayer(sim, amount, pl.x, pl.z, events) > 0) events[events.length - 1].fall = true;
}

/**
 * One trigger pull: cfg.weapon.pellets hitscan pellets (1 for the carbine). Emits one 'shot'
 * (with pellets[]), counts one shot and at most one hit, sums damage per enemy and emits one
 * 'hit' per enemy struck ({pellets, crit, damage}); a flinchable enemy struck by at least
 * cfg.weapon.flinchPellets pellets that survives gets a 'flinch' and a stun.
 */
function fire(sim, events) {
  const { cfg, player: pl, weapon: w } = sim;
  const wc = specOf(cfg, w);
  if (wc.melee) { heave(w, wc); return; }
  if (wc.splash) { splash(sim, w, wc, events); return; }
  const worn = !!w.loadedWorn; // the stake on the string, if this is the crossbow
  const r = tryFire(w, cfg);
  if (!r.ok) {
    if (r.reason === 'dry' || r.reason === 'empty') events.push({ type: r.reason });
    return;
  }
  if (wc.stake) w.loadedWorn = false;
  sim.stats.shots += 1;
  const origin = { x: pl.x, y: pl.y + cfg.player.eyeHeight, z: pl.z };
  const dir = lookDir(pl);
  const dirs = pelletDirs(dir, wc.pellets || 1, wc.spread || 0, sim.rng);
  // A friendly figure (the plot gardeners, the hunter) is never a target: shots pass through
  // it to whatever is behind (security A6), so it is left out of the cast altogether.
  const targets = sim.enemies.filter((e) => !e.friendly);
  const hits = dirs.map((d) => castShot(origin, d, wc.range, sim.boxes, targets, cfg));
  const main = hits[0];
  const shotEv = {
    type: 'shot', from: origin, to: main.point, kind: main.kind, mag: w.mag,
    pellets: hits.map((h) => ({ to: h.point, kind: h.kind })),
  };
  if (cfg.weapons) shotEv.weapon = w.name; // the Rose Court has two weapons
  events.push(shotEv);
  if (wc.stake) leaveStake(sim, main, origin, dir, worn, events);

  // Group pellets by enemy, in the order each enemy was first struck.
  const struck = new Map();
  for (const h of hits) {
    if (h.kind !== 'enemy') continue;
    const s = struck.get(h.enemy);
    const m = h.mult == null ? 1 : h.mult;
    if (s) {
      s.count += 1;
      s.weight += m;
      if (m > s.best) { s.best = m; s.zone = h.zone; s.point = h.point; }
    } else {
      struck.set(h.enemy, { count: 1, weight: m, best: m, zone: h.zone, point: h.point });
    }
  }
  if (!struck.size) return;
  sim.stats.hits += 1;

  for (const [e, s] of struck) {
    const ec = cfg[e.type];
    const crit = !!e.critWindow;
    // An immune creature (a court figure before the wake) is struck but takes nothing.
    const amount = e.immune ? 0 : wc.damage * s.weight * (crit ? (ec.critMultiplier || 1) : 1);
    const killed = e.immune ? false : damageEnemy(e, amount, dir, cfg, blockersFor(sim, e));
    const hitEv = {
      type: 'hit', id: e.id, kill: killed, x: s.point.x, y: s.point.y, z: s.point.z,
      pellets: s.count, crit, damage: amount,
    };
    if (s.zone) hitEv.zone = s.zone; // which part was struck hardest (creatures with hit zones)
    events.push(hitEv);
    if (killed) {
      slain(sim, e, events);
    } else if (!e.immune && wc.flinchPellets && ec.flinchable && s.count >= wc.flinchPellets) {
      e.stun = wc.flinchTime;
      e.state = 'flinch';
      e.timer = 0;
      e.speedNow = 0;
      const len = Math.hypot(dir.x, dir.z) || 1;
      const k = wc.flinchKnockback || 0;
      moveCircle(e, { x: (dir.x / len) * k, z: (dir.z / len) * k }, ec.radius, blockersFor(sim, e), cfg.arena.half);
      events.push({ type: 'flinch', id: e.id });
    }
  }
}

/** A creature the warden brought down: counted, removed, its kill event, and maybe a drop. */
function slain(sim, e, events) {
  const { cfg, player: pl } = sim;
  sim.stats.kills += 1;
  sim.enemies = sim.enemies.filter((x) => x !== e);
  events.push({ type: 'kill', id: e.id, enemy: e.type, x: e.x, y: e.y, z: e.z });
  // Drops are weighted by the salt gun's ammunition, found by name wherever it is carried (A2).
  const kind = cfg[e.type].noDrop ? null : rollDrop(sim.rng, pl, gunOf(sim), cfg);
  if (kind) {
    const p = addDrop(sim, kind, e.x, e.z, climbs(cfg) ? yardFloor(cfg, e.x, e.z, e.y).floor : 0);
    events.push({ type: 'drop', id: p.id, kind, x: p.x, z: p.z });
  }
}

/** The warden's facing on the ground: a unit vector. */
function facingOf(pl) {
  return { x: -Math.sin(pl.yaw), z: -Math.cos(pl.yaw) };
}

/** Height the halberd and the splash travel at (chest high), for the line-of-sight check. */
const REACH_Y = 1.2;

/** True when nothing in the live collision blocks the warden's chest from point (x, y, z). */
function clearTo(sim, x, y, z) {
  const pl = sim.player;
  return lineOfSight({ x: pl.x, y: pl.y + REACH_Y, z: pl.z }, { x, y, z }, sim.boxes);
}

/** True when (x, z) is within reach of the warden, within half degrees of his facing, and in sight. */
function ahead(sim, x, y, z, reach, half) {
  const pl = sim.player;
  const f = facingOf(pl);
  const dx = x - pl.x;
  const dz = z - pl.z;
  const d = Math.hypot(dx, dz);
  if (d > reach) return false;
  if (d > 1e-6 && (dx * f.x + dz * f.z) / d < Math.cos((half * Math.PI) / 180)) return false;
  return clearTo(sim, x, y, z);
}

/**
 * Creatures in front of the warden (hitscan.arcTargets: within reach of his centre to their
 * edge, within the half-angle in degrees of his facing; never a friendly, checked first, a dead
 * or an intangible one, A6), and in his sight: a hedge, wall or closed gate between stops the
 * halberd and the splash. Nearest first.
 */
function inFront(sim, reach, half, types = null) {
  const { cfg, player: pl } = sim;
  const from = { x: pl.x, y: pl.y + REACH_Y, z: pl.z };
  const near = arcTargets(from, facingOf(pl), reach, (half * Math.PI) / 180, sim.enemies, cfg, sim.boxes);
  return near.filter((e) => (!types || types.includes(e.type))
    && clearTo(sim, e.x, e.y + Math.min(REACH_Y, (cfg[e.type] && cfg[e.type].hitY) || REACH_Y), e.z));
}

/** The fire button with the halberd: the heave starts; the blow lands after its wind-up (R8). */
function heave(w, wc) {
  if (w.cooldown > 0 || w.windup > 0) return;
  w.windup = wc.windup;
  w.cooldown = wc.fireInterval;
}

/**
 * The halberd comes down: everything in the half-arc within reach takes its damage (nothing
 * for a figure still asleep) and is driven back. Emits swing { x, z, hits } (the ids struck),
 * a hit for each, and any kill.
 */
function swing(sim, w, events) {
  const { cfg, player: pl } = sim;
  const wc = specOf(cfg, w);
  const f = facingOf(pl);
  const struck = inFront(sim, wc.reach, wc.arc);
  sim.stats.shots += 1;
  if (struck.length) sim.stats.hits += 1;
  events.push({ type: 'swing', x: pl.x + f.x * wc.reach, z: pl.z + f.z * wc.reach, hits: struck.map((e) => e.id) });
  for (const e of struck) {
    const ec = cfg[e.type];
    const len = Math.hypot(e.x - pl.x, e.z - pl.z) || 1;
    const dir = { x: (e.x - pl.x) / len, y: 0, z: (e.z - pl.z) / len };
    const amount = e.immune ? 0 : wc.damage;
    const down = e.immune ? false : damageEnemy(e, amount, dir, cfg, blockersFor(sim, e));
    events.push({ type: 'hit', id: e.id, kill: down, x: e.x, y: e.y + (ec.hitY || 1), z: e.z, pellets: 1, crit: false, damage: amount });
    if (down) slain(sim, e, events);
    else if (!e.immune && wc.push > 0) moveCircle(e, { x: dir.x * wc.push, z: dir.z * wc.push }, ec.radius, blockersFor(sim, e), cfg.arena.half);
  }
}

/**
 * The fire button with the cup (R23). Full: a splash of running water ahead stops every guard
 * and gardener it reaches for the cup's stun, puts out the Caterpillar's pipe if it reaches it,
 * and empties the cup (sim.waves.items.cup is its one fill). Empty: it taps and throws nothing.
 */
function splash(sim, w, wc, events) {
  const { player: pl, waves: st } = sim;
  if (w.cooldown > 0) return;
  if (!st || !st.items || st.items.cup !== 'full') {
    w.cooldown = wc.dryInterval;
    events.push({ type: 'empty' });
    return;
  }
  w.cooldown = wc.fireInterval;
  st.items.cup = 'empty';
  const stunned = [];
  // courtiers.js owns the stop: only an awake guard or gardener is stopped (a figure still
  // asleep stays asleep, and never walks when the stun would have ended); it emits stun.
  for (const e of inFront(sim, wc.reach, wc.cone, wc.stuns)) if (splashStun(sim, e, events)) stunned.push(e.id);
  let doused = false;
  const cat = sim.enemies.find((e) => e.type === 'caterpillar' && !e.dead && !e.doused);
  const pipe = MAZE.caterpillar.pipe;
  if (cat && ahead(sim, pipe.x, pipe.y, pipe.z, wc.reach, wc.cone)) {
    cat.doused = true;
    doused = true;
  }
  const f = facingOf(pl);
  events.push({ type: 'splashThrow', x: pl.x + f.x * wc.reach, z: pl.z + f.z * wc.reach, stunned, doused });
}

/**
 * A crossbow shot leaves its stake where it stopped: lodged in the creature it struck (unless
 * that one is immune: then it drops at its feet), or standing in the ground or cover; a shot
 * into nothing comes down on the ground at the end of its range, pulled back out of any wall.
 */
function leaveStake(sim, hit, origin, dir, worn, events) {
  if (hit.kind === 'enemy' && !hit.enemy.immune) {
    lodgeStake(sim, { ...hit.point, worn, enemy: hit.enemy.id }, events);
    return;
  }
  let p = hit.point;
  if (hit.kind === 'enemy') p = { x: hit.enemy.x, y: 0, z: hit.enemy.z };
  else if (hit.kind === 'none') p = { x: p.x, y: 0, z: p.z };
  if (hit.kind === 'none' || hit.kind === 'cover') {
    const len = Math.hypot(dir.x, dir.z) || 1;
    const inside = (q) => sim.boxes.some((b) => q.x > b.minX && q.x < b.maxX && q.z > b.minZ && q.z < b.maxZ);
    for (let i = 0; i < 400 && inside(p); i++) p = { x: p.x - (dir.x / len) * 0.25, y: p.y, z: p.z - (dir.z / len) * 0.25 };
    if (inside(p)) p = { x: origin.x, y: 0, z: origin.z };
  }
  lodgeStake(sim, { ...p, worn, enemy: null }, events);
}

/**
 * Advances the run by dt seconds (clamped to MAX_DT) under input and returns the events
 * that happened. In the Rose Court a playing bloom scene takes the whole frame. Order matters: the player acts first, then enemies, then bolts, hazards
 * and pickups, then death is checked before the encounter so a same-frame death beats the kill.
 */
export function stepSim(sim, input = IDLE_INPUT, dt = 1 / 60) {
  const events = sim.pending.splice(0);
  soundsOf(events); // every returned array carries its (possibly empty) sound-only list
  if (sim.waves && sim.waves.latch) input = releaseLatch(sim.waves, input); // #29: held through a scene: nothing until let go (A6)
  if (sim.status === 'won' && sim.waves && sim.waves.passage) return walkOn(sim, input, dt, events);
  if (sim.status === 'won' || sim.status === 'lost') return events;
  dt = Math.max(0, Math.min(dt, MAX_DT));
  // The bloom scene (the Rose Court, R3, security A4): while it plays only its own clock and the
  // flow timers step (trail.js SCENE_STEPS, an allow-list); every other step and timer, the run
  // clock included, waits. A step added below is outside a scene by default.
  const sceneStep = encounterOf(sim.cfg).scene || stepScene; // the castle's own: strike, pyre (A4)
  if (sim.waves && sim.waves.scene && sceneStep(sim, input, dt, events)) return events;
  sim.time += dt;
  const { cfg, player: pl } = sim;

  if (sim.status === 'dying') {
    sim.statusTimer -= dt;
    if (sim.statusTimer <= 0) {
      sim.status = 'lost';
      events.push({ type: 'lost', wave: sim.stats.waveReached });
    }
    return events;
  }

  sim.stats.time += dt;
  movePlayer(sim, input, dt, events);
  if (pl.grace > 0) pl.grace = Math.max(0, pl.grace - dt);

  if (input.swap && sim.holster && swapWeapon(sim, input.swap)) events.push({ type: 'swap', weapon: sim.weapon.name });
  const w = sim.weapon;
  if (input.reload && startReload(w, cfg)) events.push({ type: 'reloadStart' });
  for (const t of stepWeapon(w, dt, cfg)) events.push({ type: t });
  if (w.windup > 0) {
    w.windup = Math.max(0, w.windup - dt);
    if (w.windup === 0) swing(sim, w, events);
  }
  if (specOf(cfg, w).ward) {
    // The castle's garlic (#9): a fresh press holds it up, and while it is up it may find the wife.
    raiseGarlic(sim, w, !!input.fire, events);
    stepGarlic(sim, w, dt, events);
  } else if (input.fire && !pl.climbing) fire(sim, events); // on a ladder both hands are on the rungs (#21)

  if (sim.status === 'winning') {
    stepPickups(sim, dt, events);
    sim.statusTimer -= dt;
    if (sim.statusTimer <= 0) {
      sim.status = 'won';
      cancelReload(w);
      events.push({ type: 'won', stats: { ...sim.stats } });
      openPassage(sim); // issue #29: the way on opens (the yard's crater, the Nave's daylight)
    }
    return events;
  }

  const starts = climbs(cfg) ? frameStart(sim) : null;
  for (const e of sim.enemies) stepEnemy(e, sim, dt, events);
  separate(sim);
  if (starts) settle(sim, starts, dt); // the yard: each creature's height from its place (#21)
  stepBolts(sim, dt, events);
  if (cfg.encounter === 'chambers') stepHazards(sim, dt, events, sim.rng, cfg);
  stepPickups(sim, dt, events);

  if (pl.dead) {
    cancelReload(w);
    cancelSwing(w);
    sim.status = 'dying';
    sim.statusTimer = cfg.loseBeat;
    events.push({ type: 'died', wave: sim.stats.waveReached });
    return events;
  }

  const before = events.length;
  encounterOf(cfg).step(sim, dt, events, input);
  const way = wayoutKind(cfg.room);
  if (way) {
    // #29: the one that wins the room: the yard's last foe, the Cantor (its fall takes the rest with it)
    for (const e of events) {
      if (e.type === 'kill' && (cfg.room === 'cave' ? e.id === sim.waves.bossId : e.cause !== 'boss')) {
        sim.waves.lastKill = { id: e.id, enemy: e.enemy, x: e.x, y: e.y || 0, z: e.z };
      }
    }
  }
  for (let i = before; i < events.length; i++) {
    if (events[i].type === 'allClear') {
      if (way) startWayout(sim, sim.waves.lastKill, input, events); // the cut scene: the way out opens
      sim.status = 'winning';
      sim.statusTimer = cfg.winBeat;
      sim.bolts = [];
      sim.globs = [];
      sim.pools = [];
    }
  }
  return events;
}

/**
 * Issue #29: a won level with a way on (journey.js): the warden walks on to it. Only the feet
 * move and the pickups are there for the taking (the owner, 2026-11-18: every ammo and health
 * pickup in the room, the last kills' drops too, until the warden leaves through the rubble):
 * nothing fires, nothing is left to fight, and no clock but the run's own runs. Once the warden
 * has walked far enough down the ramp (or up the heap) the follow plays (journey.js stepFollow):
 * it takes the whole frame, as the way-out scenes do (A4).
 */
function walkOn(sim, input, dt, events) {
  dt = Math.max(0, Math.min(dt, MAX_DT));
  if (stepFollow(sim, input, dt)) return events;
  sim.time += dt;
  movePlayer(sim, input, dt, events);
  stepPickups(sim, dt, events);
  stepPassage(sim, dt, input);
  return events;
}

/** Called when the presentation layer pauses: a reload in progress is cancelled, no ammo moves. */
export function pauseSim(sim) {
  cancelReload(sim.weapon);
  cancelSwing(sim.weapon);
  const enc = encounterOf(sim.cfg);
  if (enc.pause) enc.pause(sim); // the castle: a key held through the pause card counts for nothing (A6)
}
