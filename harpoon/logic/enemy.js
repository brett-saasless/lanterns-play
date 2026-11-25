// Wick (melee) and Bellows (ranged) state machines, steering, stuck re-route, bolts, and the
// per-type dispatch to the cave creatures (creatures.js), the boss (boss.js), the Rose Court's
// figures (courtiers.js) and gate creatures (hybrids.js), and the castle's sentries (sentries.js). Sight reads sim.boxes, the live
// collision list (cfg.boxes plus any closed veils or gates). Movement, separation and knockback
// read blockersFor(sim, e): sim.boxes itself in the yard and cave, and in the Rose Court the
// monster list that adds running rills. Hat-pins ride the bolt list with their own numbers and
// stick where they stop (capped). Every creature's own ground movement is metered here into
// 'tread' sound events.
//
// Friendly figures (security A6): a creature carrying `friendly: true` (the plot gardeners and
// the hunter) is checked first by every damage path. castShot and arcTargets (hitscan.js) never
// find it, so bolts, salt, the halberd and the cup pass through; damageEnemy refuses it all
// damage and knockback before anything else; stepEnemy hands it to courtiers.js's stepFriendly
// (it never moves or attacks, and a gardener ducks); separate() never pushes it.

import { moveCircle, circleBlocked } from './collide.js';
import { lineOfSight } from './hitscan.js';
import { damagePlayer } from './player.js';
import { initLurch, initWeeper, stepLurch, stepWeeper } from './creatures.js';
import { initCantor, stepCantor } from './boss.js';
import { initGuard, initGardener, stepGuard, stepGardener, stepFriendly, dropHalberds } from './courtiers.js';
import { initHybrid, stepHybrid } from './hybrids.js';
import { initSentry, stepSentry } from './sentries.js';
import { surfaceAt } from './surfaces.js';
import { emitSound } from './sounds.js';
import { addEntry } from './journal.js';
import { climbs, blockersAt, climbChase, SEPARATE_DY, SWIPE_DY } from './climb.js';

/** The Rose Court's gate creatures, dispatched to hybrids.js. */
const HYBRIDS = Object.freeze(['rabbit', 'hatter', 'bat', 'caterpillar']);

/**
 * What creature e collides with when it moves: sim.boxes (the same array) in the yard and the
 * cave; in the Rose Court the monster list (walls plus running rills), sim.waves.blockers.
 */
export function blockersFor(sim, e) {
  if (climbs(sim.cfg)) return blockersAt(sim.cfg, sim.boxes, e.x, e.z, e.y, !e.air); // the yard's crates, by height (#21)
  return (sim.waves && sim.waves.blockers) || sim.boxes;
}

/** True for a figure no weapon may harm (the plot gardeners, the hunter): security A6. */
export function isFriendly(e) {
  return !!(e && e.friendly);
}

/**
 * Creates a creature. A type with no config block (a friendly figure such as the hunter) gets
 * a nominal 1 hp, which nothing can take from it.
 */
export function createEnemy(id, type, x, z, cfg, rng) {
  const c = cfg[type] || {};
  const e = {
    id, type, x, y: 0, z,
    hp: c.hp != null ? c.hp : 1,
    state: 'approach',
    timer: 0,
    cooldown: type === 'bellows' ? 1 + rng() : 0,
    hitFlash: 0,
    side: rng() < 0.5 ? -1 : 1,
    bestDist: Infinity,
    stuckFor: 0,
    reroute: null,
    rerouteLeft: 0,
    heading: 0,
    speedNow: 0,
    dead: false,
    stun: 0, // flinch stun left in seconds: set by sim.js fire(), counted down by stepEnemy
    critWindow: false, // while true, shots on it are critical (the Cantor sets it in Open)
    tread: (c.tread || 0) / 2, // metres walked toward the next tread sound (first comes at half)
  };
  if (type === 'lurch') initLurch(e, cfg, rng);
  else if (type === 'weeper') initWeeper(e, cfg, rng);
  else if (type === 'cantor') initCantor(e, cfg, rng);
  else if (type === 'guard') initGuard(e, cfg, rng);
  else if (type === 'gardener') initGardener(e, cfg, rng);
  else if (HYBRIDS.includes(type)) initHybrid(e, cfg, rng);
  else if (type === 'armour' || type === 'wife') initSentry(e, cfg); // the castle's sentries
  return e;
}

/**
 * Creates an enemy of type at (x, z), merges extra into it, adds it to sim.enemies and
 * emits { type: 'spawn', id, enemy, x, y, z, seated? }. Returns the enemy.
 */
export function spawnEnemy(sim, type, x, z, events, extra = {}) {
  const e = createEnemy(sim.nextId++, type, x, z, sim.cfg, sim.rng);
  Object.assign(e, extra);
  sim.enemies.push(e);
  const ev = { type: 'spawn', id: e.id, enemy: type, x: e.x, y: e.y, z: e.z };
  if (e.seated) ev.seated = true;
  if (e.friendly) ev.friendly = true; // a plot gardener or the hunter: drawn as a friend
  events.push(ev);
  return e;
}

function rotate(dx, dz, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

function pathBlocked(e, dir, radius, probe, boxes) {
  return (
    circleBlocked(e.x + dir.x * probe * 0.5, e.z + dir.z * probe * 0.5, radius, boxes) ||
    circleBlocked(e.x + dir.x * probe, e.z + dir.z * probe, radius, boxes)
  );
}

/**
 * Moves e toward (tx, tz) at speed, steering around cover and sliding along faces.
 * boxes defaults to cfg.boxes; sim code passes sim.boxes so closed veils block.
 */
export function steer(e, tx, tz, speed, dt, cfg, boxes = cfg.boxes) {
  const dx = tx - e.x;
  const dz = tz - e.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4 || speed <= 0) {
    e.speedNow = 0;
    return;
  }
  let dir = { x: dx / len, z: dz / len };
  const radius = cfg[e.type].radius;
  const probe = Math.min(cfg.steering.probe, len);
  if (pathBlocked(e, dir, radius, probe, boxes)) {
    const a = rotate(dir.x, dir.z, e.side * 1.2);
    const b = rotate(dir.x, dir.z, -e.side * 1.2);
    if (!pathBlocked(e, a, radius, probe, boxes)) dir = a;
    else if (!pathBlocked(e, b, radius, probe, boxes)) {
      dir = b;
      e.side = -e.side;
    }
  }
  const step = Math.min(speed * dt, len);
  moveCircle(e, { x: dir.x * step, z: dir.z * step }, radius, boxes, cfg.arena.half);
  e.heading = Math.atan2(-dir.x, -dir.z);
  e.speedNow = speed;
}

/**
 * Closes on the player at speed with the stuck re-route (dist = current distance to the
 * player). Shared by every melee mover; the cave stubs use it too.
 */
export function chase(e, sim, speed, dt, dist) {
  const { cfg, player: pl } = sim;
  const st = cfg.steering;
  if (climbs(cfg) && climbChase(e, sim, speed, dt, blockersFor(sim, e))) return; // up and down the crates (#21)
  if (e.rerouteLeft > 0) {
    e.rerouteLeft -= dt;
    steer(e, e.reroute.x, e.reroute.z, speed, dt, cfg, blockersFor(sim, e));
    if (Math.hypot(e.reroute.x - e.x, e.reroute.z - e.z) < 0.5) e.rerouteLeft = 0;
    return;
  }
  if (dist < e.bestDist - 0.4) {
    e.bestDist = dist;
    e.stuckFor = 0;
  } else {
    e.stuckFor += dt;
  }
  if (e.stuckFor >= st.stuckTime) {
    // Not closing distance: go around via a side offset perpendicular to the player line.
    const dx = (pl.x - e.x) / (dist || 1);
    const dz = (pl.z - e.z) / (dist || 1);
    const lim = cfg.arena.half - 1.5;
    e.reroute = {
      x: Math.max(-lim, Math.min(lim, e.x - dz * e.side * st.rerouteOffset + dx * 2)),
      z: Math.max(-lim, Math.min(lim, e.z + dx * e.side * st.rerouteOffset + dz * 2)),
    };
    e.rerouteLeft = st.rerouteTime;
    e.stuckFor = 0;
    e.bestDist = Infinity;
    e.side = -e.side;
    return;
  }
  steer(e, pl.x, pl.z, speed, dt, cfg, blockersFor(sim, e));
}

/** Damages the player from (fromX, fromZ); records stats and the event. */
export function hurtPlayer(sim, amount, fromX, fromZ, events) {
  const taken = damagePlayer(sim.player, amount);
  if (taken > 0) {
    sim.stats.damageTaken += taken;
    events.push({ type: 'hurt', amount: taken, fromX, fromZ, health: sim.player.health });
  }
  return taken;
}

function stepWick(e, sim, dt, events) {
  const { cfg, player: pl } = sim;
  const c = cfg.wick;
  // In the yard a warden up on a crate is out of reach from below (#21): treat him as far.
  const flat = Math.hypot(pl.x - e.x, pl.z - e.z);
  const dist = climbs(cfg) && Math.abs(pl.y - e.y) > SWIPE_DY ? Math.max(flat, c.reach * 1.3 + 1e-3) : flat;
  e.cooldown = Math.max(0, e.cooldown - dt);
  if (e.state === 'windup') {
    e.timer -= dt;
    e.speedNow = 0;
    if (e.timer <= 0) {
      events.push({ type: 'swipe', id: e.id });
      if (dist <= c.reach * 1.3) hurtPlayer(sim, c.damage, e.x, e.z, events);
      e.state = 'approach';
      e.cooldown = Math.max(0, c.attackInterval - c.windup);
    }
    return;
  }
  if (dist <= c.reach) {
    e.stuckFor = 0;
    e.bestDist = dist;
    e.rerouteLeft = 0;
    e.heading = Math.atan2(-(pl.x - e.x), -(pl.z - e.z));
    if (dist > c.reach * 0.85) steer(e, pl.x, pl.z, c.speed * 0.5, dt, cfg, blockersFor(sim, e));
    else e.speedNow = 0;
    if (e.cooldown <= 0) {
      e.state = 'windup';
      e.timer = c.windup;
      events.push({ type: 'windup', id: e.id });
    }
    return;
  }
  chase(e, sim, c.speed, dt, dist);
}

function stepBellows(e, sim, dt, events) {
  const { cfg, player: pl } = sim;
  const c = cfg.bellows;
  const dist = Math.hypot(pl.x - e.x, pl.z - e.z);
  e.cooldown = Math.max(0, e.cooldown - dt);
  const muzzle = { x: e.x, y: e.y + c.muzzleY, z: e.z };
  const chest = { x: pl.x, y: pl.y + 1.2, z: pl.z };

  if (e.state === 'windup') {
    e.timer -= dt;
    e.speedNow = 0;
    if (e.timer <= 0) {
      const dx = chest.x - muzzle.x;
      const dy = chest.y - muzzle.y;
      const dz = chest.z - muzzle.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const s = c.boltSpeed / len;
      sim.bolts.push({
        id: sim.nextId++,
        x: muzzle.x, y: muzzle.y, z: muzzle.z,
        vx: dx * s, vy: dy * s, vz: dz * s,
        life: c.boltLife,
      });
      events.push({ type: 'boltFired', id: e.id, x: muzzle.x, y: muzzle.y, z: muzzle.z });
      e.state = 'approach';
      e.cooldown = c.fireInterval;
    }
    return;
  }

  const sight = lineOfSight(muzzle, chest, sim.boxes);
  e.heading = Math.atan2(-(pl.x - e.x), -(pl.z - e.z));
  if (sight && e.cooldown <= 0 && dist <= c.holdMax + 8) {
    e.state = 'windup';
    e.timer = c.windup;
    events.push({ type: 'inhale', id: e.id });
    return;
  }
  if (!sight || dist > c.holdMax) {
    chase(e, sim, c.speed, dt, dist);
  } else if (dist < c.holdMin) {
    e.stuckFor = 0;
    const ax = e.x - (pl.x - e.x);
    const az = e.z - (pl.z - e.z);
    steer(e, ax, az, c.speed * 0.8, dt, cfg, blockersFor(sim, e));
    e.heading = Math.atan2(-(pl.x - e.x), -(pl.z - e.z));
  } else {
    // In the hold band: drift sideways slowly.
    e.stuckFor = 0;
    e.bestDist = dist;
    const dx = (pl.x - e.x) / dist;
    const dz = (pl.z - e.z) / dist;
    steer(e, e.x - dz * e.side * 3, e.z + dx * e.side * 3, c.speed * 0.4, dt, cfg, blockersFor(sim, e));
    e.heading = Math.atan2(-(pl.x - e.x), -(pl.z - e.z));
  }
}

/**
 * Advances one enemy. A flinch stun (e.stun > 0) is handled here for every type: the enemy
 * does nothing until it runs out, then resumes in state 'approach' with timer 0, so any
 * wind-up, coil or leap it had is cancelled. Cave types go to their own modules with
 * (e, sim, dt, events, rng, cfg).
 */
export function stepEnemy(e, sim, dt, events) {
  if (e.friendly) {
    stepFriendly(e, sim, dt, events);
    return;
  }
  if (e.dead) return;
  if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);
  if (e.stun > 0) {
    e.stun = Math.max(0, e.stun - dt);
    e.speedNow = 0;
    if (e.type === 'lurch' && e.y > 0) e.y = Math.max(0, e.y - 6 * dt); // shot out of the air: it drops
    if (e.stun === 0) {
      e.state = 'approach';
      e.timer = 0;
    }
    return;
  }
  const x0 = e.x;
  const z0 = e.z;
  const up = climbs(sim.cfg); // the yard: a creature on a crate top or a ramp is on the ground too (#21)
  const grounded = (up ? !e.air : e.y <= 0) && e.state !== 'leap';
  switch (e.type) {
    case 'bellows': stepBellows(e, sim, dt, events); break;
    case 'lurch': stepLurch(e, sim, dt, events, sim.rng, sim.cfg); break;
    case 'weeper': stepWeeper(e, sim, dt, events, sim.rng, sim.cfg); break;
    case 'cantor': stepCantor(e, sim, dt, events, sim.rng, sim.cfg); break;
    case 'guard': stepGuard(e, sim, dt, events, sim.rng, sim.cfg); break;
    case 'gardener': stepGardener(e, sim, dt, events, sim.rng, sim.cfg); break;
    case 'rabbit': case 'hatter': case 'bat': case 'caterpillar':
      stepHybrid(e, sim, dt, events, sim.rng, sim.cfg); break;
    case 'armour': case 'wife': stepSentry(e, sim, dt, events); break; // the castle (sentries.js)
    default: stepWick(e, sim, dt, events);
  }
  if (grounded && (up || e.y <= 0) && e.state !== 'leap') treads(e, sim, Math.hypot(e.x - x0, e.z - z0), events);
}

/**
 * Meters ground a grounded creature covered under its own power this frame (knockback and
 * separation happen outside stepEnemy and do not count) and emits one 'tread' per tread length.
 */
function treads(e, sim, covered, events) {
  const len = sim.cfg[e.type].tread;
  if (!(len > 0) || covered <= 0) return;
  e.tread += covered;
  if (e.tread < len) return;
  e.tread %= len;
  const wet = surfaceAt(sim, e.x, e.z).family === 'wet';
  emitSound(events, { type: 'tread', id: e.id, enemy: e.type, x: e.x, z: e.z, wet });
}

/** Pushes overlapping enemies apart and keeps them off the player. */
export function separate(sim) {
  const { enemies, cfg, player: pl } = sim;
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    if (a.friendly || a.phantom) continue; // a friendly figure, or the castle's wife, is never pushed, and pushes nothing
    // a suit come apart (sentries.js e.anchored) is never moved: its pieces are shoved one by one (armourheap.js)
    const boxes = blockersFor(sim, a);
    const ra = cfg[a.type].radius;
    const levels = climbs(cfg); // the yard: movers on different levels do not push (#21)
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
      if (b.friendly || b.phantom) continue;
      if (levels && Math.abs(a.y - b.y) > SEPARATE_DY) continue;
      const rb = cfg[b.type].radius;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = ra + rb;
      if (d < min) {
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        if (a.anchored && b.anchored) continue;
        const push = a.anchored || b.anchored ? min - d : (min - d) / 2;
        if (!a.anchored) moveCircle(a, { x: -nx * push, z: -nz * push }, ra, boxes, cfg.arena.half);
        if (!b.anchored) moveCircle(b, { x: nx * push, z: nz * push }, rb, blockersFor(sim, b), cfg.arena.half);
      }
    }
    const dx = a.x - pl.x;
    const dz = a.z - pl.z;
    const d = Math.hypot(dx, dz);
    const min = ra + cfg.player.radius + 0.35;
    if (d < min && !a.anchored && !(levels && Math.abs(a.y - pl.y) > SEPARATE_DY)) {
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      moveCircle(a, { x: nx * (min - d), z: nz * (min - d) }, ra, boxes, cfg.arena.half);
    }
  }
}

/**
 * Applies a hit. dir ({x, z}) is the shot direction for the knockback nudge; boxes
 * defaults to cfg.boxes (sim code passes sim.boxes). Returns true when the hit killed it.
 */
export function damageEnemy(e, amount, dir, cfg, boxes = cfg.boxes) {
  if (!e || e.friendly) return false; // security A6: checked before anything else
  if (e.dead) return false;
  e.hp -= amount;
  e.hitFlash = 0.08;
  if (e.hp <= 0) {
    e.hp = 0;
    e.dead = true;
    return true;
  }
  const k = cfg[e.type].knockback;
  const len = Math.hypot(dir.x, dir.z) || 1;
  if (k > 0) moveCircle(e, { x: (dir.x / len) * k, z: (dir.z / len) * k }, cfg[e.type].radius, boxes, cfg.arena.half);
  return false;
}

/**
 * A hat-pin stopped in cover or the ground: it stays there, in sim.waves.pins, up to
 * cfg.maxPins; the oldest goes when a new one would pass the cap (security A3). Emits
 * pinStick; the first pin in cover writes its log line. Returns the stuck pin.
 */
export function stickPin(sim, b, cover, events) {
  const w = sim.waves;
  const pin = { id: b.id, x: b.x, y: Math.max(0, b.y), z: b.z, cover: !!cover };
  w.pins.push(pin);
  const cap = sim.cfg.maxPins;
  if (w.pins.length > cap) w.pins.splice(0, w.pins.length - cap);
  events.push({ type: 'pinStick', id: pin.id, x: pin.x, z: pin.z });
  if (cover) addEntry(sim, 'pins', events);
  return pin;
}

/**
 * Moves bolts: Bellows bolts burst on cover, the ground, timeout, or the player. Hat-pins
 * (kind 'pin', numbers from cfg.hatter) hurt the player they reach, stick in cover or the
 * ground where they stop, and are gone when their life runs out in the air.
 */
export function stepBolts(sim, dt, events) {
  const { cfg, player: pl } = sim;
  const keep = [];
  for (const b of sim.bolts) {
    const pin = b.kind === 'pin';
    const r = pin ? cfg.hatter.pinRadius : cfg.bellows.boltRadius;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.life -= dt;
    const horiz = Math.hypot(b.x - pl.x, b.z - pl.z);
    if (!pl.dead && horiz < cfg.player.radius + r && b.y >= pl.y - r && b.y <= pl.y + cfg.player.eyeHeight + 0.25) {
      if (pin) {
        hurtPlayer(sim, cfg.hatter.pinDamage, b.x - b.vx, b.z - b.vz, events);
        continue;
      }
      hurtPlayer(sim, cfg.bellows.boltDamage, b.x - b.vx, b.z - b.vz, events);
      events.push({ type: 'boltBurst', x: b.x, y: b.y, z: b.z, onPlayer: true });
      continue;
    }
    let cover = false;
    for (const box of sim.boxes) {
      if (b.x > box.minX && b.x < box.maxX && b.z > box.minZ && b.z < box.maxZ && b.y < box.maxY) {
        cover = true;
        break;
      }
    }
    if (pin) {
      if (cover || b.y <= 0) stickPin(sim, b, cover, events);
      else if (b.life > 0) keep.push(b);
      continue;
    }
    const burst = b.life <= 0 || b.y <= 0 || cover;
    if (burst) {
      events.push({ type: 'boltBurst', x: b.x, y: Math.max(0, b.y), z: b.z, onPlayer: false });
      continue;
    }
    keep.push(b);
  }
  sim.bolts = keep;
  dropHalberds(sim, events); // every guard killed so far this frame leaves its halberd (R8)
}
