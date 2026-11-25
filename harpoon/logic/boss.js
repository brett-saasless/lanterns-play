// The Cantor: one ordered state machine (Drag, Sweep, Open, Shed, Call), one beat at a time.
// Contract: docs/features/cave/build-notes.md section 5; design: 02-design.md "The Cantor"
// beat rules 1-7 with approved amendment 1 (turns only in Drag and the Sweep wind-up).
//
// e.state is the running beat: 'drag' | 'sweep' (the wind-up) | 'swing' (arc locked, hit at
// swingHitAt) | 'open' | 'shed'. Call takes no time, so it never owns e.state: it fires from Drag and the
// Cantor goes on dragging. A timed beat that ends hands back to Drag on the next frame.

import { chase, hurtPlayer } from './enemy.js';
import { spawnAtPore } from './chambers.js';
import { launchGlob } from './hazards.js';

/** Called once by createEnemy for the Cantor: adds the beat machine's fields. */
export function initCantor(e, cfg, rng) {
  e.state = 'drag';
  e.timer = 0;
  e.critWindow = false;
  e.shedOn = false; // Shed clock running (from the end of chamber 3's spawn grace)
  e.shedClock = 0;
  e.callOn = false; // Call clock running (from health first below half)
  e.callClock = 0;
  e.sweepFacing = null; // heading the arc locked to when the wind-up ended
  e.swingResolved = false; // the current swing's hit has been resolved
  e.shedTarget = null; // where the player stood when the Shed stop began
  e.sing = -1; // seconds into the bout of song he is singing, or -1 (cantorsong.js writes it; the view reads it)
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Turns e.heading toward `want` by at most `max` radians. */
function turnToward(e, want, max) {
  const d = wrap(want - e.heading);
  e.heading = wrap(e.heading + Math.max(-max, Math.min(max, d)));
}

/** True when (px, pz) is inside the arc of `arc` radians centred on heading, out to reach. */
export function inSweep(x, z, heading, px, pz, reach, arc) {
  const dx = px - x;
  const dz = pz - z;
  const d = Math.hypot(dx, dz);
  if (d > reach) return false;
  if (d < 1e-6) return true;
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const cos = (dx * fx + dz * fz) / d;
  return cos >= Math.cos(arc / 2) - 1e-9;
}

/** Wind-up over: the arc locks to the facing it has now and the swing starts. */
function startSwing(e, events, c) {
  e.sweepFacing = e.heading;
  e.state = 'swing';
  e.timer = 0; // counts up through the swing
  e.swingResolved = false;
  events.push({ type: 'bossSweep', id: e.id, facing: e.sweepFacing, swingTime: c.swingTime });
}

/** At swingHitAt: the locked arc against where the player is at that moment. */
function resolveSwing(e, sim, events, c) {
  const pl = sim.player;
  e.swingResolved = true;
  let hit = false;
  if (!pl.dead && inSweep(e.x, e.z, e.sweepFacing, pl.x, pl.z, c.sweepReach, c.sweepArc)) {
    hit = hurtPlayer(sim, c.sweepDamage, e.x, e.z, events) > 0;
  }
  events.push({ type: 'bossSwingHit', id: e.id, hit });
}

/** Swing over: Open follows at once and nothing cuts it short. */
function startOpen(e, events, c) {
  e.state = 'open';
  e.timer = c.openTime;
  e.critWindow = true;
  events.push({ type: 'bossOpen', id: e.id });
}

function shed(e, sim, events, c, cfg) {
  const t = e.shedTarget;
  let dx = t.x - e.x;
  let dz = t.z - e.z;
  let d = Math.hypot(dx, dz);
  if (d < 1e-6) { dx = -Math.sin(e.heading); dz = -Math.cos(e.heading); d = 1; }
  const ux = dx / d;
  const uz = dz / d;
  const reach = Math.max(d, c.shedFanDistanceMin);
  const from = { x: e.x, y: e.y + c.hitY, z: e.z };
  const n = c.shedGlobs;
  for (let i = 0; i < n; i++) {
    const a = (i - (n - 1) / 2) * c.shedFan;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const rx = ux * ca - uz * sa;
    const rz = ux * sa + uz * ca;
    launchGlob(sim, from, { x: e.x + rx * reach, z: e.z + rz * reach }, e.id, events, cfg);
  }
}

function call(e, sim, events, c) {
  const alive = sim.enemies.filter((x) => x.type === c.callType && !x.dead).length;
  const woke = Math.max(0, c.callMax - alive);
  for (let i = 0; i < woke; i++) spawnAtPore(sim, c.callType, events);
  e.callClock = 0;
  events.push({ type: 'bossCall', id: e.id, woke });
}

/** One frame of the Cantor. Never flinches (cfg.cantor.flinchable is false). */
export function stepCantor(e, sim, dt, events, rng, cfg) {
  if (e.dead) return;
  const c = cfg.cantor;
  const pl = sim.player;

  // Clocks count in every beat (rule 3); each starts once (rule 5).
  if (!e.shedOn && pl.grace <= 0) e.shedOn = true;
  else if (e.shedOn) e.shedClock += dt;
  if (!e.callOn && e.hp < c.hp * c.callBelow) e.callOn = true;
  else if (e.callOn) e.callClock += dt;

  const dx = pl.x - e.x;
  const dz = pl.z - e.z;
  const dist = Math.hypot(dx, dz);

  if (e.state === 'sweep') {
    // Wind-up: stands still, keeps turning toward the player (amendment 1).
    e.speedNow = 0;
    turnToward(e, Math.atan2(-dx, -dz), c.turnRate * dt);
    e.timer -= dt;
    if (e.timer <= 1e-9) startSwing(e, events, c);
    return;
  }
  if (e.state === 'swing') {
    // Neither moves nor turns; the arc stays locked (amendment 1).
    e.speedNow = 0;
    e.timer += dt;
    if (!e.swingResolved && e.timer >= c.swingHitAt - 1e-9) resolveSwing(e, sim, events, c);
    if (e.timer >= c.swingTime - 1e-9) startOpen(e, events, c);
    return;
  }
  if (e.state === 'open') {
    e.speedNow = 0;
    e.timer -= dt;
    if (e.timer <= 1e-9) {
      e.critWindow = false;
      e.state = 'drag';
      e.timer = 0;
      events.push({ type: 'bossShut', id: e.id });
    }
    return;
  }
  if (e.state === 'shed') {
    e.speedNow = 0;
    e.timer -= dt;
    if (e.timer <= 1e-9) {
      shed(e, sim, events, c, cfg);
      e.state = 'drag';
      e.timer = 0;
    }
    return;
  }

  // Drag: the only beat that starts others (rule 2), in the order Shed, Call, Sweep (rule 4).
  e.state = 'drag';
  e.critWindow = false;
  if (e.shedOn && e.shedClock >= c.shedInterval) {
    e.shedClock = 0;
    e.shedTarget = { x: pl.x, z: pl.z };
    e.state = 'shed';
    e.timer = c.shedTime;
    e.speedNow = 0;
    events.push({ type: 'bossTell', id: e.id, attack: 'shed' });
    return;
  }
  if (e.callOn && e.callClock >= c.callInterval) {
    call(e, sim, events, c); // takes no time: keeps dragging this frame
  } else if (dist <= c.sweepRange) {
    e.state = 'sweep';
    e.timer = c.sweepWindup;
    e.speedNow = 0;
    events.push({ type: 'bossTell', id: e.id, attack: 'sweep' });
    return;
  }
  const h0 = e.heading;
  chase(e, sim, c.speed, dt, dist);
  // Turn toward the way it drags at no more than turnRate.
  const want = e.heading;
  e.heading = h0;
  turnToward(e, want, c.turnRate * dt);
}
