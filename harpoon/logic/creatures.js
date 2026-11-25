// Lurch (melee leaper) and Weeper (glob lobber) state machines. Flinch stun is handled by
// stepEnemy before these run; it hands back state 'approach' with timer 0, which is the entry
// state of both machines, so a flinch cancels any coil, leap or swell.
// Contract: docs/features/cave/build-notes.md.
//
// Lurch states:  approach -> coil -> leap -> winded -> approach
// Weeper states: approach -> swell -> approach
//
// The pack (R9, cfg.lurch.pack): stalking Lurches chained within `link` metres of each other
// hunt together. While a pack of two or more is gathering, each member stays in 'approach' with
// e.pack set ({ at, ids, slot, of, gather, base, rush }) and steers for its own evenly spaced,
// circling slot on a ring round the warden. When every member is on the ring, or the pack has
// gathered for `patience` seconds, the first member to step that frame decides the rush for all
// of them: each member with a clear leap line coils on that same frame (one sound-only
// `packRush` for the group) and leaps far enough to reach the warden from the ring, capped at
// pack.rushLeap (the lone leap plus 20 percent); a member with rock in the way leaves the pack
// and stalks alone. A Lurch with no packmate behaves as shipped.

import { chase, steer, hurtPlayer } from './enemy.js';
import { lineOfSight } from './hitscan.js';
import { moveCircle } from './collide.js';
import { launchGlob } from './hazards.js';
import { emitSound } from './sounds.js';

const TAU = Math.PI * 2;

function facing(dx, dz) {
  return Math.atan2(-dx, -dz);
}

/** Called once by createEnemy for a new Lurch: add any per-Lurch fields here. */
export function initLurch(e, cfg, rng) {
  // Stride clock, started at a random point so a pack does not pulse and weave in step.
  e.gait = rng() * cfg.lurch.weavePeriod;
  e.leapLeft = 0; // metres of the current leap still to travel
  e.leapLen = cfg.lurch.leapDistance; // metres of the current leap in all
  e.leapDir = { x: 0, z: 0 }; // unit direction locked when the coil ended
  e.pack = null; // the pack it is gathering with, or null (see the header)
  e.rush = false; // this coil and leap are a pack rush
}

/** Called once by createEnemy for a new Weeper: add any per-Weeper fields here. */
export function initWeeper(e, cfg, rng) {
  e.cooldown = rng() * cfg.weeper.lobInterval; // lob clock, staggered between Weepers
  e.aim = { x: e.x, z: e.z }; // ground point locked when a swell starts
}

/** True when the floor-level line a leap would follow from the Lurch to the player is clear. */
function leapLineClear(e, sim, c) {
  const pl = sim.player;
  return lineOfSight(
    { x: e.x, y: c.hitY, z: e.z },
    { x: pl.x, y: c.hitY, z: pl.z },
    sim.boxes,
  );
}

/** Stalking: pulsed speed, weaving either side of the line to the player. */
function stalk(e, sim, dt, cfg, dist, clear) {
  const c = cfg.lurch;
  const pl = sim.player;
  e.gait += dt;
  const speed = c.speed * (1 + c.pulseDepth * Math.sin((TAU * e.gait) / c.pulsePeriod));
  // Blind, re-routing or making no ground: the shared chase (with its stuck re-route) decides.
  if (!clear || e.rerouteLeft > 0 || e.stuckFor >= cfg.steering.stuckTime || dist < 1e-4) {
    chase(e, sim, speed, dt, dist);
    return;
  }
  if (dist < e.bestDist) {
    e.bestDist = dist;
    e.stuckFor = 0;
  } else {
    e.stuckFor += dt;
  }
  const a = e.side * c.weaveAngle * Math.sin((TAU * e.gait) / c.weavePeriod);
  const dx = pl.x - e.x;
  const dz = pl.z - e.z;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  steer(e, e.x + dx * cos - dz * sin, e.z + dx * sin + dz * cos, speed, dt, cfg, sim.boxes);
}

/** One frame of a Lurch. */
export function stepLurch(e, sim, dt, events, rng, cfg) {
  const c = cfg.lurch;
  const pl = sim.player;
  const dx = pl.x - e.x;
  const dz = pl.z - e.z;
  const dist = Math.hypot(dx, dz);

  if (e.state === 'coil') {
    // Stands and tracks the player; the leap direction is the facing when the coil ends.
    e.speedNow = 0;
    if (dist > 1e-4) e.heading = facing(dx, dz);
    e.timer -= dt;
    if (e.timer <= 0) {
      e.state = 'leap';
      e.leapLen = e.rush ? rushLength(c, dist) : c.leapDistance;
      e.leapLeft = e.leapLen;
      e.leapDir = { x: -Math.sin(e.heading), z: -Math.cos(e.heading) };
      events.push({ type: 'leap', id: e.id });
    }
    return;
  }

  if (e.state === 'leap') {
    const step = Math.min(c.leapSpeed * dt, e.leapLeft);
    const blocked = moveCircle(
      e, { x: e.leapDir.x * step, z: e.leapDir.z * step }, c.radius, sim.boxes, cfg.arena.half,
    );
    e.leapLeft -= step;
    e.speedNow = c.leapSpeed;
    // Airborne: a low arc over the leap, so the hit volume follows the body off the floor.
    const u = 1 - e.leapLeft / (e.leapLen || c.leapDistance);
    e.y = 4 * (c.leapHeight || 0) * u * (1 - u);
    // Touch: the Lurch's leap reach against the player's body circle.
    const touch = Math.hypot(pl.x - e.x, pl.z - e.z) <= c.leapHitRadius + cfg.player.radius;
    if (touch) hurtPlayer(sim, c.leapDamage, e.x, e.z, events);
    if (touch || blocked || e.leapLeft <= 1e-9) {
      if (!touch) emitSound(events, { type: 'leapMiss', id: e.id, x: e.x, z: e.z });
      e.state = 'winded';
      e.timer = c.windedTime;
      e.leapLeft = 0;
      e.rush = false;
      e.speedNow = 0;
      e.y = 0;
    }
    return;
  }

  if (e.state === 'winded') {
    e.speedNow = 0;
    e.timer -= dt;
    if (e.timer <= 0) {
      e.state = 'approach';
      e.timer = c.pulsePeriod; // free to coil again at once
      e.bestDist = Infinity;
      e.stuckFor = 0;
    }
    return;
  }

  // 'approach' (also where a flinch returns it, with timer 0): any leap in progress is
  // forgotten. timer counts time stalked; a fresh or flinched Lurch takes one stride pulse
  // before it may coil, so a flinch buys more than the stun.
  e.state = 'approach';
  e.leapLeft = 0;
  e.y = 0;
  e.rush = false;
  e.timer = Math.min(c.pulsePeriod, e.timer + dt);
  const pack = c.pack && !pl.dead ? packOf(e, sim, dt, events, c) : null;
  const clear = leapLineClear(e, sim, c);
  if (pack && !pack.rush) {
    holdRing(e, sim, dt, cfg, pack);
    return;
  }
  if (pack && pack.rush) {
    // The rush: every member with a clear leap line coils now, on the same frame as the rest; one
    // with rock between it and the warden leaves the pack and stalks alone.
    if (clear) {
      coil(e, events, dist, dx, dz, c);
      e.rush = true;
      return;
    }
    e.pack = null;
    stalk(e, sim, dt, cfg, dist, clear);
    return;
  }
  if (clear && dist <= c.coilRange && e.timer >= c.pulsePeriod && !pl.dead) {
    coil(e, events, dist, dx, dz, c);
    return;
  }
  stalk(e, sim, dt, cfg, dist, clear);
}

function coil(e, events, dist, dx, dz, c) {
  e.state = 'coil';
  e.timer = c.coilTime;
  e.speedNow = 0;
  e.rerouteLeft = 0;
  e.stuckFor = 0;
  e.bestDist = dist;
  e.pack = null;
  if (dist > 1e-4) e.heading = facing(dx, dz);
  events.push({ type: 'coil', id: e.id });
}

/** A pack leap: long enough to reach the warden from the ring, never shorter than a lone leap, never past rushLeap. */
function rushLength(c, dist) {
  const p = c.pack;
  return Math.max(c.leapDistance, Math.min(p.rushLeap, dist + p.reach));
}

/** Two Lurches in one pack: within link of each other, or already gathering together. */
function linked(a, b, p) {
  if (Math.hypot(a.x - b.x, a.z - b.z) <= p.link) return true;
  return !!(a.pack && b.pack && a.pack.ids.includes(b.id) && b.pack.ids.includes(a.id));
}

/** A Lurch free to join a pack this frame: alive, stalking, not stunned. */
const stalking = (x) => x.type === 'lurch' && !x.dead && x.state === 'approach' && !(x.stun > 0);

/**
 * e's pack this frame, or null when it has no packmate. The first member stepped in a frame
 * works the pack out for every member (so all of them agree, and a rush is the same frame for
 * all); later members read what it wrote. Members are chained: each within `link` of another.
 */
function packOf(e, sim, dt, events, c) {
  if (e.pack && e.pack.at === sim.time && e.pack.ids.includes(e.id)) return e.pack;
  const p = c.pack;
  const pl = sim.player;
  // Only Lurches already hunting this warden (within link of the ring) gather; farther off they stalk alone.
  const near = (x) => Math.hypot(x.x - pl.x, x.z - pl.z) <= p.ring + p.link;
  if (!near(e)) {
    e.pack = null;
    return null;
  }
  const free = sim.enemies.filter((x) => stalking(x) && near(x));
  const members = [e];
  for (let k = 0; k < members.length; k++) {
    const a = members[k];
    for (const b of free) {
      if (!members.includes(b) && linked(a, b, p)) members.push(b);
    }
  }
  if (members.length < 2) {
    e.pack = null;
    return null;
  }
  const angle = (m) => Math.atan2(m.z - pl.z, m.x - pl.x);
  let gather = 0;
  for (const m of members) if (m.pack) gather = Math.max(gather, m.pack.gather);
  gather += dt;
  const n = members.length;
  const spin = (c.speed * p.circle * gather) / p.ring;
  // While its members stay the same each keeps its slot and the ring its base angle. When the
  // pack forms or changes, slots go to members in their order round the warden, and the base
  // is set so that, between them, they have the least way to go round the ring to their slots.
  const same = members.every((m) => m.pack && m.pack.of === n && members.every((o) => m.pack.ids.includes(o.id)));
  let base;
  if (same) {
    members.sort((a, b) => a.pack.slot - b.pack.slot);
    base = members[0].pack.base;
  } else {
    const first = members.reduce((a, m) => (m.id < a.id ? m : a));
    const around = (m) => (m === first ? 0 : (((angle(m) - angle(first)) % TAU) + TAU) % TAU);
    members.sort((a, b) => around(a) - around(b) || a.id - b.id);
    let sx = 0;
    let sz = 0;
    members.forEach((m, k) => {
      sx += Math.cos(angle(m) - (TAU * k) / n);
      sz += Math.sin(angle(m) - (TAU * k) / n);
    });
    base = Math.atan2(sz, sx) - spin;
  }
  // On the ring: every member within tolerance of the ring and near its own slot on it.
  const onRing = members.every((m, slot) => {
    const t = slotPoint(pl, p, base, spin, slot, n);
    return Math.abs(Math.hypot(m.x - pl.x, m.z - pl.z) - p.ring) <= p.tolerance
      && Math.hypot(m.x - t.x, m.z - t.z) <= 2 * p.tolerance;
  });
  const rush = onRing || gather >= p.patience;
  const ids = members.map((m) => m.id);
  members.forEach((m, slot) => {
    m.pack = { at: sim.time, ids, slot, of: n, gather: rush ? 0 : gather, base, spin, rush };
  });
  if (rush) {
    // One shared chitter for the members that will coil this frame (a clear leap line each);
    // none when no member can.
    const going = members.filter((m) => leapLineClear(m, sim, c)).map((m) => m.id);
    if (going.length) emitSound(events, { type: 'packRush', ids: going, x: pl.x, z: pl.z });
  }
  return e.pack;
}

/** Where slot `slot` of `of` stands on the ring round the warden, the ring turned by spin. */
function slotPoint(pl, p, base, spin, slot, of) {
  const a = base + spin + (2 * Math.PI * slot) / of;
  return { x: pl.x + Math.cos(a) * p.ring, z: pl.z + Math.sin(a) * p.ring };
}

/** Steers for this member's slot on the circling ring. */
function holdRing(e, sim, dt, cfg, pack) {
  const c = cfg.lurch;
  const p = c.pack;
  const pl = sim.player;
  e.gait += dt;
  // Round the ring toward its slot, never across the warden: aim at most pack.arc along from where it stands.
  const slot = slotPoint(pl, p, pack.base, pack.spin, pack.slot, pack.of);
  const now = Math.atan2(e.z - pl.z, e.x - pl.x);
  let delta = Math.atan2(slot.z - pl.z, slot.x - pl.x) - now;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const a = now + Math.max(-p.arc, Math.min(p.arc, delta));
  const tx = pl.x + Math.cos(a) * p.ring;
  const tz = pl.z + Math.sin(a) * p.ring;
  e.stuckFor = 0;
  e.bestDist = Math.hypot(pl.x - e.x, pl.z - e.z);
  const speed = c.speed * (1 + c.pulseDepth * Math.sin((TAU * e.gait) / c.pulsePeriod));
  if (Math.hypot(tx - e.x, tz - e.z) > 0.05) steer(e, tx, tz, speed, dt, cfg, sim.boxes);
  else e.speedNow = 0;
  e.heading = facing(pl.x - e.x, pl.z - e.z); // it watches the warden as it circles
}

/** One frame of a Weeper. */
export function stepWeeper(e, sim, dt, events, rng, cfg) {
  const c = cfg.weeper;
  const pl = sim.player;
  const dx = pl.x - e.x;
  const dz = pl.z - e.z;
  const dist = Math.hypot(dx, dz);
  const face = () => {
    if (dist > 1e-4) e.heading = facing(dx, dz);
  };
  e.cooldown = Math.max(0, e.cooldown - dt);

  if (e.state === 'swell') {
    e.speedNow = 0;
    face();
    e.timer -= dt;
    if (e.timer <= 0) {
      launchGlob(sim, { x: e.x, y: e.y + c.muzzleY, z: e.z }, e.aim, e.id, events, cfg);
      e.state = 'approach';
      e.timer = 0;
    }
    return;
  }

  e.state = 'approach';
  const sight = lineOfSight(
    { x: e.x, y: e.y + c.muzzleY, z: e.z },
    { x: pl.x, y: pl.y + cfg.player.eyeHeight, z: pl.z },
    sim.boxes,
  );
  if (sight && e.cooldown <= 0 && !pl.dead) {
    e.state = 'swell';
    e.timer = c.swellTime;
    e.cooldown = c.lobInterval; // tell to tell; a flinched swell costs the whole lob
    e.aim = { x: pl.x, z: pl.z };
    e.speedNow = 0;
    face();
    events.push({ type: 'globTell', id: e.id });
    return;
  }

  if (e.seated) {
    // Keeps its ledge until the player is out of its band, then climbs down for good.
    if (dist <= c.holdMax) {
      e.speedNow = 0;
      face();
      return;
    }
    e.seated = false;
    e.y = 0;
    emitSound(events, { type: 'unseat', id: e.id, x: e.x, z: e.z });
  }

  if (dist > c.holdMax || (!sight && dist >= c.holdMin)) {
    chase(e, sim, c.speed, dt, dist); // too far, or in the band but blind: close in
  } else if (dist < c.holdMin && dist > 1e-4) {
    e.stuckFor = 0;
    steer(e, e.x - dx, e.z - dz, c.speed, dt, cfg, sim.boxes); // too close: shuffle back
    face();
  } else {
    e.stuckFor = 0;
    e.bestDist = dist;
    e.speedNow = 0;
    face();
  }
}
