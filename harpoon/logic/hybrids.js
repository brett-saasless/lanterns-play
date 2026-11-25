// The four gate creatures of the wood: the Rabbit (band 1), the Hatter-at-Arms (2), the
// Cheshire Bat (3) and the Smoke Caterpillar (4). trail.js seats each with e.gate = its band;
// each sleeps until the warden enters its glade and is leashed there (the Bat to its band).
// Each is beaten its own way: the Rabbit only by the salad (trail.js sets e.fed), the Hatter by
// shots under his armoured brim, the Bat only while light touches it, the Caterpillar only once
// its pipe is doused (trail.js sets e.doused) and the smoke has cleared. Pins ride sim.bolts
// and stick into sim.waves.pins (enemy.js, capped); nothing else holds them.
// What they say comes from talk.js: the Rabbit greets, talks on Speak (trail.js calls
// talkTo) and warns five times, at least warnGap apart, before any lunge; the Hatter greets,
// taunts about every tauntEvery seconds and says his last line as he falls (hybridKilled);
// the Hatter's volley and the Bat's swoop each open with a strikeTell the views can read.

import { hurtPlayer, steer, blockersFor } from './enemy.js';
import { moveCircle, circleBlocked } from './collide.js';
import { lineOfSight } from './hitscan.js';
import { MAZE, stageAt } from './courtmap.js';
import { addEntry } from './journal.js';
import { greet, greeting, stepSpeaker, warn, warnings, taunt, deathLine } from './talk.js';

// Timings and distances the design leaves unnamed. Read from the creature's config block when
// it carries them (cfg.rabbit.lungeSpeed and so on), else these starting values.
const TUNE = Object.freeze({
  rabbit: Object.freeze({
    lungeSpeed: 12, // across the table
    returnSpeed: 5, // back to his chair
    lungeHit: 1.4, // he strikes when this close, or at the end of his leash
    lungeSlack: 0.5, // the strike lands within lungeHit plus this
    leash: 4.5, // never further from his chair
    tut: 1.2, // seconds of tutting after a shot passes where he was
    shotNear: 1.2,
    warnGap: 3, // seconds at least between his warnings, and from the fifth to any lunge
  }),
  hatter: Object.freeze({
    aimTime: 0.54, // drawing pins from the hatband before a volley: the volley's tell
    handY: 1.9,
    pinFan: 0.05, // radians between the pins of a volley
    kickRecover: 0.5,
    kickPush: 3, // metres the warden is kicked back
    kickSlack: 0.5,
    kickInterval: 1.6,
    moveMax: 6.5, // farthest cover point he will walk to between volleys
    moveTime: 4, // a walk that has not arrived by then ends where he stands
    arrive: 0.35,
    tauntEvery: 12, // seconds between taunts while the warden is in his band
  }),
  bat: Object.freeze({
    hover: 1.4, // height over its swoop height while drifting
    driftSpeed: 3.5,
    swoopSpeed: 9,
    biteReach: 1.6, // it bites when this close
    biteSlack: 0.4,
    swoopMax: 2.2, // a swoop that has not reached the warden by then is given up
    linger: 0.5, // seconds it hangs at the warden after a bite
    perchEvery: 1.6, // seconds between choosing a new place to drift to
    climbRate: 3, // metres per second up or down
  }),
  caterpillar: Object.freeze({
    whipRecover: 0.6,
    whipSlack: 0.4,
  }),
});

const tune = (c, type, k) => (c[k] != null ? c[k] : TUNE[type][k]);

export function initHybrid(e, cfg, rng) {
  e.state = 'still';
  e.timer = 0; // seconds left in the current timed state
  e.tell = 0; // seconds left in the wind-up (0 unless state is 'tell' or the Hatter's 'aim'); no view reads it: beasts.js times wind-ups from the strikeTell event
  e.cooldown = 0;
  e.progress = 0; // feeds the hint ladder (journal.progress)
  e.intangible = false;
  e.speedNow = 0;
  if (e.type === 'rabbit') {
    e.intangible = true; // shots and stakes pass where he was
    e.fed = false;
    e.eating = 0; // seconds of eating left
    e.tut = 0;
    e.warned = 0; // warnings given, 0 to 5; a lunge only after the fifth
    e.warnIn = 0; // seconds until he may warn again
  } else if (e.type === 'hatter') {
    const pts = MAZE.hatter.points;
    e.cover = nearestPoint(pts, e.x, e.z);
    e.volleyLeft = 0;
    e.pinTimer = 0;
    e.kickCool = 0;
    e.cooldown = 1; // the first volley comes a moment after he wakes
    e.tauntIn = tune(cfg.hatter, 'hatter', 'tauntEvery');
  } else if (e.type === 'bat') {
    e.intangible = true; // only light gives it a body
    e.solid = false;
    e.y = tune(cfg.bat, 'bat', 'hover');
    e.perch = { x: e.x, z: e.z };
    e.perchIn = 0;
    e.cooldown = cfg.bat.swoopInterval / 2;
    e.lanterns = MAZE.bat.lanterns.map(() => ({ down: 0, spent: false }));
  } else if (e.type === 'caterpillar') {
    e.intangible = true; // no shot finds him through the smoke
    e.doused = false;
    e.smoke = 1; // smoke density, 1 to 0 over clearTime after dousing
    e.tick = 0;
  }
}

function nearestPoint(pts, x, z) {
  let best = 0;
  let bd = Infinity;
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function inGlade(sim, band) {
  const g = MAZE.glades[band - 1];
  const p = sim.player;
  return !!g && p.x >= g.minX && p.x <= g.maxX && p.z >= g.minZ && p.z <= g.maxZ;
}

const facing = (e, x, z) => Math.atan2(-(x - e.x), -(z - e.z));

/** Moves e straight toward (tx, tz) at speed without collision (it leaps or flies). */
function glide(e, tx, tz, speed, dt) {
  const dx = tx - e.x;
  const dz = tz - e.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) { e.speedNow = 0; return 0; }
  const step = Math.min(d, speed * dt);
  e.x += (dx / d) * step;
  e.z += (dz / d) * step;
  e.heading = Math.atan2(-dx, -dz);
  e.speedNow = speed;
  return d - step;
}

function segDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len2));
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y, a.z + dz * t - p.z);
}

/** The segments of every shot fired this frame (one per pellet), as [from, to]. */
function shotSegments(events) {
  const out = [];
  for (const ev of events) {
    if (ev.type !== 'shot' || !ev.from) continue;
    const ends = ev.pellets && ev.pellets.length ? ev.pellets.map((q) => q.to) : [ev.to];
    for (const to of ends) if (to) out.push([ev.from, to]);
  }
  return out;
}

function tell(e, events, secs, move) {
  e.state = 'tell';
  e.timer = secs;
  e.tell = secs;
  events.push({ type: 'strikeTell', id: e.id, enemy: e.type, move });
}

/** Counts a tell down; true on the frame it ends. */
function tellDone(e, dt) {
  e.timer -= dt;
  e.tell = Math.max(0, e.timer);
  if (e.timer > 0) return false;
  e.tell = 0;
  return true;
}

function strike(e, sim, events, move, damage, landed) {
  events.push({ type: 'strike', id: e.id, enemy: e.type, move });
  if (landed && !sim.player.dead) hurtPlayer(sim, damage, e.x, e.z, events);
}

/** A death by the creature's own rule (not a shot): sim.js counts and removes shot kills itself. */
function dieOwnRule(e, sim, events, cause) {
  e.dead = true;
  e.hp = 0;
  e.state = 'dead';
  e.speedNow = 0;
  sim.stats.kills += 1;
  events.push({ type: 'kill', id: e.id, enemy: e.type, x: e.x, y: e.y, z: e.z, cause });
}

// ---- the Rabbit -------------------------------------------------------------------------
// still (at table) -> sit -> tell -> lunge (across the table) -> return -> sit; fed -> eat -> dead.

function stepRabbit(e, sim, dt, events, c) {
  const pl = sim.player;
  const chair = MAZE.rabbit.chair;
  e.tut = Math.max(0, e.tut - dt);
  e.intangible = true;

  if (e.fed) {
    if (e.state !== 'eat') {
      e.state = 'eat';
      e.eating = c.eatTime;
      e.tell = 0;
      events.push({ type: 'eats', id: e.id });
    }
    glide(e, chair.x, chair.z, tune(c, 'rabbit', 'returnSpeed'), dt); // back to the bowl he pulled to him
    e.speedNow = 0;
    e.eating -= dt;
    if (e.eating <= 0) {
      e.eating = 0;
      dieOwnRule(e, sim, events, 'salad');
    }
    return;
  }

  const body = { x: e.x, y: e.y + c.hitY, z: e.z };
  let shotAt = false;
  for (const [a, b] of shotSegments(events)) {
    if (segDist(body, a, b) < tune(c, 'rabbit', 'shotNear')) {
      e.tut = tune(c, 'rabbit', 'tut');
      addEntry(sim, 'rabbitShot', events);
      shotAt = true;
      break;
    }
  }
  if (e.state === 'still') return;

  const fromChair = Math.hypot(pl.x - chair.x, pl.z - chair.z);
  const reach = tune(c, 'rabbit', 'lungeHit');
  if (e.state === 'tell') {
    e.heading = facing(e, pl.x, pl.z);
    if (tellDone(e, dt)) {
      e.state = 'lunge';
      e.timer = 0;
    }
    return;
  }
  if (e.state === 'lunge') {
    const leash = tune(c, 'rabbit', 'leash');
    let tx = pl.x;
    let tz = pl.z;
    if (fromChair > leash) {
      tx = chair.x + ((pl.x - chair.x) / fromChair) * leash;
      tz = chair.z + ((pl.z - chair.z) / fromChair) * leash;
    }
    glide(e, tx, tz, tune(c, 'rabbit', 'lungeSpeed'), dt);
    e.timer += dt;
    const d = Math.hypot(pl.x - e.x, pl.z - e.z);
    const atEnd = Math.hypot(tx - e.x, tz - e.z) < 0.05;
    if (d <= reach || atEnd || e.timer > 1) {
      strike(e, sim, events, 'lunge', c.lungeDamage, d <= reach + tune(c, 'rabbit', 'lungeSlack'));
      e.state = 'return';
      e.cooldown = c.lungeInterval;
    }
    return;
  }
  if (e.state === 'return') {
    if (glide(e, chair.x, chair.z, tune(c, 'rabbit', 'returnSpeed'), dt) <= 0.01) {
      e.state = 'sit';
      e.speedNow = 0;
    }
    return;
  }
  // sit: a trespass (within lungeRange of his chair, or a shot at him) earns the next warning,
  // at least warnGap after the last; only a trespass warnGap or more after the fifth is lunged at.
  e.state = 'sit';
  e.speedNow = 0;
  e.cooldown = Math.max(0, e.cooldown - dt);
  e.warnIn = Math.max(0, e.warnIn - dt);
  const near = !pl.dead && fromChair <= c.lungeRange;
  if (e.warned < warnings('rabbit')) {
    if (!pl.dead && (near || shotAt) && e.warnIn <= 0 && !greeting(sim, 'rabbit')) { // both greetings first
      const gap = tune(c, 'rabbit', 'warnGap');
      e.heading = facing(e, pl.x, pl.z);
      warn(sim, 'rabbit', e.warned, events);
      e.warned += 1;
      e.warnIn = gap;
      e.cooldown = Math.max(e.cooldown, gap);
    }
    return;
  }
  if (near && e.cooldown <= 0) tell(e, events, c.lungeTell, 'lunge');
}

// ---- the Hatter-at-Arms -----------------------------------------------------------------
// still -> cover (at point e.cover) -> aim -> throw (a volley of pins) -> move (to another
// point) -> cover ...; a warden inside kickRange gets tell -> strike (kick, pushed back).

function chestOf(sim) {
  const pl = sim.player;
  return { x: pl.x, y: pl.y + 1.2, z: pl.z };
}

function eyeOf(sim) {
  const pl = sim.player;
  return { x: pl.x, y: pl.y + sim.cfg.player.eyeHeight, z: pl.z };
}

/** Another cover point within walking range: one his block hides him at, else one with sight. */
function nextCover(e, sim, rng, c) {
  const pts = MAZE.hatter.points;
  const chest = chestOf(sim);
  const eye = eyeOf(sim);
  const far = tune(c, 'hatter', 'moveMax');
  const scored = [];
  pts.forEach((p, i) => {
    if (i === e.cover) return;
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    if (d > far) return;
    const hidden = !lineOfSight(chest, { x: p.x, y: 1.0, z: p.z }, sim.boxes);
    const sees = lineOfSight(eye, { x: p.x, y: tune(c, 'hatter', 'handY'), z: p.z }, sim.boxes);
    const close = Math.hypot(p.x - sim.player.x, p.z - sim.player.z) <= c.kickRange + 1;
    scored.push({ i, score: (hidden ? 2 : 0) + (sees ? 1 : 0) - (close ? 3 : 0) + rng() * 0.9 });
  });
  if (!scored.length) return e.cover;
  scored.sort((a, b) => b.score - a.score);
  return scored[0].i;
}

function throwPin(e, sim, events, c, k) {
  const pl = sim.player;
  const toward = facing(e, pl.x, pl.z);
  const fx = -Math.sin(toward);
  const fz = -Math.cos(toward);
  const from = { x: e.x + fx * 0.4, y: e.y + tune(c, 'hatter', 'handY'), z: e.z + fz * 0.4 };
  const chest = chestOf(sim);
  let dx = chest.x - from.x;
  const dy = chest.y - from.y;
  let dz = chest.z - from.z;
  const fan = (k - 1) * tune(c, 'hatter', 'pinFan'); // -1, 0, +1 fan of a three-pin volley
  const cs = Math.cos(fan);
  const sn = Math.sin(fan);
  [dx, dz] = [dx * cs - dz * sn, dx * sn + dz * cs];
  const len = Math.hypot(dx, dy, dz) || 1;
  const s = c.pinSpeed / len;
  const pin = { id: sim.nextId++, kind: 'pin', owner: e.id, x: from.x, y: from.y, z: from.z, vx: dx * s, vy: dy * s, vz: dz * s, life: c.pinLife };
  sim.bolts.push(pin);
  events.push({ type: 'pinThrow', id: e.id, pin: pin.id, x: e.x, z: e.z });
}

function stepHatter(e, sim, dt, events, c, rng) {
  if (e.state === 'still') return;
  const pl = sim.player;
  const dist = Math.hypot(pl.x - e.x, pl.z - e.z);
  e.cooldown = Math.max(0, e.cooldown - dt);
  e.kickCool = Math.max(0, e.kickCool - dt);
  if (!pl.dead && stageAt(pl.x, pl.z) === e.gate) {
    e.tauntIn -= dt;
    if (e.tauntIn <= 0) {
      taunt(sim, 'hatter', rng, events);
      e.tauntIn = tune(c, 'hatter', 'tauntEvery');
    }
  }

  if (e.state === 'tell') {
    e.speedNow = 0;
    e.heading = facing(e, pl.x, pl.z);
    if (tellDone(e, dt)) {
      const landed = dist <= c.kickRange + tune(c, 'hatter', 'kickSlack');
      strike(e, sim, events, 'kick', c.kickDamage, landed);
      if (landed && dist > 1e-6) {
        const push = tune(c, 'hatter', 'kickPush');
        const nx = (pl.x - e.x) / dist;
        const nz = (pl.z - e.z) / dist;
        moveCircle(pl, { x: nx * push, z: nz * push }, sim.cfg.player.radius, sim.boxes, sim.cfg.arena.half);
      }
      e.state = 'strike';
      e.timer = tune(c, 'hatter', 'kickRecover');
      e.kickCool = tune(c, 'hatter', 'kickInterval');
    }
    return;
  }
  if (e.state === 'strike') {
    e.speedNow = 0;
    e.timer -= dt;
    if (e.timer <= 0) {
      e.cover = nextCover(e, sim, rng, c);
      e.state = 'move';
      e.timer = 0;
    }
    return;
  }
  if (e.state === 'throw') {
    e.speedNow = 0;
    e.heading = facing(e, pl.x, pl.z);
    e.pinTimer -= dt;
    if (e.pinTimer <= 0 && e.volleyLeft > 0) {
      throwPin(e, sim, events, c, c.volley - e.volleyLeft);
      e.volleyLeft -= 1;
      e.pinTimer = c.pinGap;
    }
    if (e.volleyLeft <= 0 && e.pinTimer <= 0) {
      e.cover = nextCover(e, sim, rng, c);
      e.state = 'move';
      e.timer = 0;
    }
    return;
  }
  // Anyone who rushes him is kicked back (not mid-volley).
  if (!pl.dead && dist <= c.kickRange && e.kickCool <= 0) {
    tell(e, events, c.kickTell, 'kick');
    e.speedNow = 0;
    return;
  }
  const sees = !pl.dead && lineOfSight({ x: e.x, y: e.y + tune(c, 'hatter', 'handY'), z: e.z }, eyeOf(sim), sim.boxes);
  if (e.state === 'aim') {
    e.speedNow = 0;
    e.heading = facing(e, pl.x, pl.z);
    if (tellDone(e, dt)) {
      if (sees) {
        e.state = 'throw';
        e.volleyLeft = c.volley;
        e.pinTimer = 0;
      } else {
        e.cover = nextCover(e, sim, rng, c);
        e.state = 'move';
        e.timer = 0;
      }
    }
    return;
  }
  const volleyDue = e.cooldown <= tune(c, 'hatter', 'aimTime');
  if (e.state === 'move') {
    const p = MAZE.hatter.points[e.cover];
    const there = Math.hypot(p.x - e.x, p.z - e.z) <= tune(c, 'hatter', 'arrive');
    e.timer += dt;
    if (!there && !(volleyDue && sees) && e.timer < tune(c, 'hatter', 'moveTime')) {
      steer(e, p.x, p.z, c.speed, dt, sim.cfg, blockersFor(sim, e));
      return;
    }
    e.state = 'cover';
  }
  // cover: wait on his timer, facing the warden; throw when due and he can see the warden.
  e.state = 'cover';
  e.speedNow = 0;
  e.heading = facing(e, pl.x, pl.z);
  if (!volleyDue) return;
  if (sees) {
    e.state = 'aim';
    e.timer = tune(c, 'hatter', 'aimTime');
    e.tell = e.timer;
    e.cooldown = c.volleyInterval + e.timer; // the next volley is due volleyInterval after this one
    events.push({ type: 'strikeTell', id: e.id, enemy: e.type, move: 'volley' }); // hand to the hatband, the pins glint
  } else {
    const was = e.cover;
    e.cover = nextCover(e, sim, rng, c);
    if (e.cover !== was) {
      e.state = 'move';
      e.timer = 0;
    }
    e.cooldown = 0.5 + tune(c, 'hatter', 'aimTime'); // look again shortly
  }
}

// ---- the Cheshire Bat -------------------------------------------------------------------
// still -> drift (around the warden, high) -> tell -> swoop (down at the warden) -> strike
// (the bite, hanging there a moment) -> drift ... Solid only while light touches it.

/** A point near the warden in open air, reached by a clear line from the warden's eye. */
function perchNear(e, sim, rng, c) {
  const pl = sim.player;
  const eye = eyeOf(sim);
  const a0 = rng() * Math.PI * 2;
  const r = c.radius;
  for (const d of [c.swoopRange, c.swoopRange * 0.66, c.swoopRange * 0.4]) {
    for (let k = 0; k < 8; k++) {
      const a = a0 + (k * Math.PI) / 4;
      const p = { x: pl.x + Math.cos(a) * d, z: pl.z + Math.sin(a) * d };
      if (circleBlocked(p.x, p.z, r, sim.boxes)) continue;
      if (!lineOfSight(eye, { x: p.x, y: eye.y, z: p.z }, sim.boxes)) continue;
      return p;
    }
  }
  return { x: e.x, z: e.z };
}

/** True when light touches the Bat: a lantern's pool on the ground or the sun shaft. */
function batLit(e, c) {
  const sh = MAZE.bat.shaft;
  if (Math.hypot(e.x - sh.x, e.z - sh.z) <= c.shaftRadius + c.radius) return true;
  return MAZE.bat.lanterns.some((l, i) => e.lanterns[i].down > 0 && Math.hypot(e.x - l.x, e.z - l.z) <= c.lanternRadius + c.radius);
}

function lanterns(e, sim, dt, events, c) {
  const segs = shotSegments(events);
  MAZE.bat.lanterns.forEach((l, i) => {
    const s = e.lanterns[i];
    if (s.down > 0) s.down = Math.max(0, s.down - dt); // the pool burns out; the lantern is spent
    if (s.spent || !segs.length) return;
    // The chain: from the lantern up past its hook.
    const cut = segs.some(([a, b]) => {
      for (let y = l.y + 0.3; y <= l.chainY + 1.0; y += 0.3) if (segDist({ x: l.x, y, z: l.z }, a, b) < c.chainHit) return true;
      return false;
    });
    if (!cut) return;
    s.spent = true;
    s.down = c.lanternTime;
    e.progress += 1;
    events.push({ type: 'lanternFall', index: i, x: l.x, z: l.z });
    addEntry(sim, 'lantern', events);
  });
}

function setSolid(e, lit, events) {
  if (lit === e.solid) return;
  e.solid = lit;
  e.intangible = !lit;
  events.push({ type: 'solid', id: e.id, on: lit });
}

function stepBat(e, sim, dt, events, c, rng) {
  lanterns(e, sim, dt, events, c);
  const pl = sim.player;
  const hover = tune(c, 'bat', 'hover');
  const climb = tune(c, 'bat', 'climbRate') * dt;
  const toward = (y) => { e.y = e.y < y ? Math.min(y, e.y + climb) : Math.max(y, e.y - climb); };

  if (e.state !== 'still') {
    const inBand = !pl.dead && stageAt(pl.x, pl.z) === e.gate;
    e.cooldown = Math.max(0, e.cooldown - dt);
    if (e.state === 'tell') {
      e.speedNow = 0;
      e.heading = facing(e, pl.x, pl.z);
      if (tellDone(e, dt)) {
        e.state = 'swoop';
        e.timer = 0;
      }
    } else if (e.state === 'swoop') {
      const speed = tune(c, 'bat', 'swoopSpeed');
      glide(e, pl.x, pl.z, speed, dt);
      e.y = Math.max(0, e.y - speed * 0.5 * dt);
      e.timer += dt;
      const d = Math.hypot(pl.x - e.x, pl.z - e.z);
      if (!inBand || e.timer > tune(c, 'bat', 'swoopMax')) {
        e.state = 'drift';
        e.perchIn = 0;
        e.cooldown = c.swoopInterval;
      } else if (d <= tune(c, 'bat', 'biteReach')) {
        strike(e, sim, events, 'swoop', c.biteDamage, true);
        e.state = 'strike';
        e.timer = tune(c, 'bat', 'linger');
        e.cooldown = c.swoopInterval;
      }
    } else if (e.state === 'strike') {
      e.speedNow = 0;
      e.heading = facing(e, pl.x, pl.z);
      e.timer -= dt;
      if (e.timer <= 0) {
        e.state = 'drift';
        e.perchIn = 0;
      }
    } else {
      e.state = 'drift';
      e.perchIn -= dt;
      if (!inBand) {
        e.perch = { x: MAZE.bat.home.x, z: MAZE.bat.home.z };
      } else if (e.perchIn <= 0) {
        e.perch = perchNear(e, sim, rng, c);
        e.perchIn = tune(c, 'bat', 'perchEvery');
      }
      glide(e, e.perch.x, e.perch.z, tune(c, 'bat', 'driftSpeed'), dt);
      toward(hover);
      if (inBand) e.heading = facing(e, pl.x, pl.z);
      if (inBand && e.cooldown <= 0) tell(e, events, c.swoopTell, 'swoop');
    }
  }
  setSolid(e, batLit(e, c), events);
}

// ---- the Smoke Caterpillar --------------------------------------------------------------
// still -> smoke (hurts every tick inside smokeRadius) -> doused: clear (smoke thins over
// clearTime, still untouchable) -> sit -> tell -> strike (the slow whip) -> sit ...

function stepCaterpillar(e, sim, dt, events, c) {
  const pl = sim.player;
  if (e.doused && (e.state === 'still' || e.state === 'smoke')) {
    e.state = 'clear';
    e.timer = c.clearTime;
    e.tick = 0;
    e.progress = Math.max(e.progress, 1);
    events.push({ type: 'doused', x: e.x, z: e.z });
  }
  if (e.state === 'still') return;
  if (e.state === 'smoke') {
    e.intangible = true;
    e.smoke = 1;
    if (!pl.dead && Math.hypot(pl.x - e.x, pl.z - e.z) <= c.smokeRadius) {
      e.tick -= dt;
      if (e.tick <= 0) {
        e.tick = c.smokeTick;
        events.push({ type: 'smokeTick', x: pl.x, z: pl.z });
        hurtPlayer(sim, c.smokeDamage, e.x, e.z, events);
        addEntry(sim, 'smoke', events);
      }
    } else {
      e.tick = 0; // the first breath of smoke bites at once
    }
    return;
  }
  if (e.state === 'clear') {
    e.timer -= dt;
    e.smoke = Math.max(0, e.timer / c.clearTime);
    if (e.timer <= 0) {
      e.smoke = 0;
      e.intangible = false;
      e.state = 'sit';
    }
    return;
  }
  e.smoke = 0;
  e.intangible = false;
  const dist = Math.hypot(pl.x - e.x, pl.z - e.z);
  e.cooldown = Math.max(0, e.cooldown - dt);
  if (e.state === 'tell') {
    e.heading = facing(e, pl.x, pl.z);
    if (tellDone(e, dt)) {
      strike(e, sim, events, 'whip', c.whipDamage, dist <= c.whipRange + tune(c, 'caterpillar', 'whipSlack'));
      e.state = 'strike';
      e.timer = tune(c, 'caterpillar', 'whipRecover');
      e.cooldown = c.whipInterval;
    }
    return;
  }
  if (e.state === 'strike') {
    e.timer -= dt;
    if (e.timer <= 0) e.state = 'sit';
    return;
  }
  e.state = 'sit';
  e.heading = facing(e, pl.x, pl.z);
  if (!pl.dead && dist <= c.whipRange && e.cooldown <= 0) tell(e, events, c.whipTell, 'whip');
}

// ---- dispatch ---------------------------------------------------------------------------

/** True when a shot did it harm this frame (sim.js fires before creatures step). */
function hurtNow(e, events) {
  return events.some((ev) => ev.type === 'hit' && ev.id === e.id && ev.damage > 0);
}

const WAKE = Object.freeze({ rabbit: 'sit', hatter: 'cover', bat: 'drift', caterpillar: 'smoke' });

const VOICED = Object.freeze(['rabbit', 'hatter']); // the gate creatures that speak (talk.js)

export function stepHybrid(e, sim, dt, events, rng, cfg) {
  const c = cfg[e.type];
  e.speedNow = 0;
  const was = e.state;
  if (e.state === 'still' && e.gate && (inGlade(sim, e.gate) || hurtNow(e, events))) e.state = WAKE[e.type];
  if (e.state === 'awake') e.state = WAKE[e.type]; // a caller may wake a creature by name
  if (VOICED.includes(e.type) && sim.waves) {
    if (was === 'still' && e.state !== 'still') greet(sim, e.type, events); // once a run: kept across checkpoints
    else stepSpeaker(sim, e.type, dt, events, e.state === 'still');
  }
  if (e.type === 'rabbit') stepRabbit(e, sim, dt, events, c);
  else if (e.type === 'hatter') stepHatter(e, sim, dt, events, c, rng);
  else if (e.type === 'bat') stepBat(e, sim, dt, events, c, rng);
  else if (e.type === 'caterpillar') stepCaterpillar(e, sim, dt, events, c);
}

/**
 * A gate creature's last word as it falls (the Hatter's: once a run). sim.js removes shot kills
 * before a dead creature steps again, so trail.js calls this for each kill event it settles.
 */
export function hybridKilled(sim, kill, events) {
  if (kill && kill.enemy === 'hatter' && sim.waves) deathLine(sim, 'hatter', events);
}
