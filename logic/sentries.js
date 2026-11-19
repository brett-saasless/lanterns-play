// The castle's only enemies (R4, R6, G3, G4): the two suits of armour at the door and the
// phantom wife in the first corridor. All three are creatures in sim.enemies, so the shipped
// hit, stun and body paths apply; enemy.js hands types 'armour' and 'wife' to stepSentry.
//
// The first suit (e.suit 1) never strikes: woken, it says its line, takes five steps and comes
// apart (suitFalls), and its heap stays. The second (e.suit 2) wakes as the first falls, says
// its two threats and only then walks; a shot before it has spoken makes it speak and come at
// once. Before every blow the pike goes back (strikeTell, cfg.armour.tell); the blow lands
// where the warden stood when the tell began, so stepping aside or behind cover avoids it. It
// taunts about every tauntEvery seconds, never the same line twice running (talk.js), and says
// its last line as it falls (sentryKilled, which also sets done.armour). The cup's splash stops
// it (courtiers.js splashStun, once the cup's `stuns` list names 'armour'; G3).
// The armour's pace reads against the court guard (Conflicts 4): each number within 20 percent
// of the guard's, slower to walk, to wind up and between blows, harder in the blow.
//
// The wife is immune and intangible: no shot, stake, swing or splash finds her. Passing her
// painting she whispers (wifeStir); a few steps on she comes out of the canvas over emergeTime
// (logic/emerge.js, still 'stir': untouchable and harmless until she stands free) and strikes cold. The garlic is
// wielded on Q like any weapon (#9): fired, it is held up (raiseGarlic, stepGarlic), and each
// hold-up that finds her within cfg.wife.ward drives her back out through a wall, the ceiling or
// the floor (wifeDriven); she comes back from any side, keening as she comes (wifeNear, #10).
// The cfg.wife.drives-th drives her away (wifeGone), done.wife is set, and she is never seated
// again (G4). Raising the garlic spends nothing: only sim.waves.raised is consumed (security A7).

import { chase, hurtPlayer, spawnEnemy } from './enemy.js';
import { lineOfSight } from './hitscan.js';
import { greet, greeting, stepSpeaker, taunt, deathLine, warn, keySeconds } from './talk.js';
import { zoneAt } from './keepmap.js';
import { specOf, weaponNamed } from './weapon.js';
import { EMERGE, emergeAt } from './emerge.js';

/** #29: the road up from the wood: no sentry follows the warden onto it, and no blow lands there. */
const onTheRoad = (pl) => zoneAt(pl.x, pl.z) === 'road';

/** keepmap.js's zone id for the ground before the door, where the suits wake. */
const FORECOURT = 'forecourt';

/** Starting values (the design's Numbers table); CASTLE_CONFIG.armour overrides any of them. */
export const ARMOUR_TUNE = Object.freeze({
  hp: 400,
  speed: 2.0, // guard 2.4: slower
  reach: 3, // the pike
  tell: 0.8, // guard 0.7: a longer wind-up
  damage: 22, // guard 19: a harder blow
  attackInterval: 2.1, // guard 1.8: longer between blows
  radius: 0.6,
  hitRadius: 1.0,
  hitY: 1.6,
  hitZones: Object.freeze([
    Object.freeze({ name: 'head', x: 0, y: 2.5, z: 0, r: 0.45, mult: 1.5 }),
    Object.freeze({ name: 'body', x: 0, y: 1.4, z: 0, r: 0.65, mult: 1 }),
    Object.freeze({ name: 'body', x: 0, y: 0.55, z: 0, r: 0.5, mult: 1 }),
  ]),
  knockback: 0,
  flinchable: false,
  tread: 1.1,
  noDrop: true,
  wakeRange: 14, // metres: the warden off the bridge, on the forecourt
  firstSteps: 3.5, // metres the first suit walks (five steps) before it starts to come apart
  crumbleTime: 9, // seconds it stands and sheds its pieces, one by one, before the heap is down (long enough for both rust lines to be read in full)
  crumbleLead: 0.3, // seconds into the crumble that the first rust complaint is said; the second follows when the first has had its time
  blowRadius: 1.0, // metres from where the warden stood at the tell that the blow covers
  slack: 0.4, // past its reach the blow still lands
  recover: 0.5, // seconds of follow-through
  tauntEvery: 12,
});

/** Starting values for the phantom wife; CASTLE_CONFIG.wife overrides any of them. */
export const WIFE_TUNE = Object.freeze({
  hp: 1, // nothing can take it: she is immune and intangible
  tell: 0.6, // her lunge after the tell
  damage: 15, // the cold strike (the Rabbit's lunge)
  attackInterval: 2.4,
  drives: 3, // hold-ups that find her: each before the last drives her back, the last away for good (#9)
  ward: 3.5, // metres (in three dimensions) from the warden within which a raised garlic finds her
  stirRange: 3, // metres from the painting that wake the whisper
  outAfter: 3, // metres walked on past the whisper before she comes out
  outTime: 5, // or seconds, whichever comes first
  // Then she comes out of the canvas over emergeTime (logic/emerge.js), still 'stir': nothing she
  // does strikes and no garlic finds her until she stands free, `free` metres off the wall.
  emergeTime: EMERGE.time,
  free: EMERGE.free,
  reach: 1.4,
  slack: 0.5,
  speed: 3,
  // Driven back (#10): out through a wall, the ceiling or the floor, then away a while, unseen.
  fleeSpeed: 6, // metres a second, straight away from the warden
  fleeTime: 1.5, // seconds she is seen going
  fleeRise: 4, // metres up into the ceiling
  fleeSink: 3, // metres down through the floor
  awayMin: 4, // seconds she stays away, drawn between these two
  awayMax: 9,
  // Back again: returnDist from the warden on any bearing, level, above or below, at `speed`.
  returnDist: 10, // so a warden standing still hears her (10 - reach) / speed = 2.9 s before her tell
  returnRise: 3.5,
  returnSink: 2.5,
  nearEvery: 0.9, // seconds between her keens (wifeNear) as she comes
  radius: 0.45,
  hitRadius: 0.6,
  hitY: 1.2,
  knockback: 0,
  flinchable: false,
  tread: 0,
  noDrop: true,
});

const DEFAULTS = Object.freeze({ armour: ARMOUR_TUNE, wife: WIFE_TUNE });
const specs = new WeakMap();

/** cfg.armour or cfg.wife over the starting values, made once per config. */
export function sentrySpec(cfg, type) {
  let byType = specs.get(cfg);
  if (!byType) {
    byType = {};
    specs.set(cfg, byType);
  }
  if (!byType[type]) byType[type] = Object.freeze({ ...DEFAULTS[type], ...((cfg && cfg[type]) || {}) });
  return byType[type];
}

/** Sets a sentry's own fields (enemy.js createEnemy calls it for 'armour' and 'wife'). */
export function initSentry(e, cfg) {
  e.timer = 0;
  e.tell = 0;
  e.cooldown = 0;
  e.called = false;
  e.speedNow = 0;
  if (e.type === 'armour') {
    e.suit = e.suit || 2;
    e.state = 'stand';
    e.immune = e.suit === 1; // the first suit never fights, so nothing it takes matters
    e.walked = 0;
    e.aim = null; // where the warden stood when the tell began
    e.tauntIn = sentrySpec(cfg, 'armour').tauntEvery;
  } else if (e.type === 'wife') {
    e.state = 'painting';
    e.immune = true;
    e.intangible = true;
    e.phantom = true; // nothing in the plan stops her and nothing pushes her (enemy.js separate)
    e.hidden = false; // away: unseen and unheard until she comes back
    e.home = { x: e.x, z: e.z };
    e.stirAt = null;
    e.stirFor = 0;
    e.emerge = null; // seconds into coming out of the canvas (logic/emerge.js), null until she begins
    e.flee = null; // { x, y, z, speed }: where she is going out through the house
    e.nearIn = 0; // seconds to her next keen as she comes back
  }
}

function struck(e, events) {
  for (const ev of events) if (ev.type === 'hit' && ev.id === e.id) return true;
  return false;
}

const faceTo = (e, x, z) => { e.heading = Math.atan2(-(x - e.x), -(z - e.z)); };

// ---- the armour ---------------------------------------------------------------------------

/**
 * The warden has come to the door: on the forecourt (keepmap.js's zone, so off the bridge and
 * not down in the pit) and within wakeRange of the suit.
 */
function onForecourt(e, sim, c) {
  const pl = sim.player;
  if (pl.dead || (sim.waves && sim.waves.under)) return false;
  if (zoneAt(pl.x, pl.z) !== FORECOURT) return false;
  return Math.hypot(pl.x - e.x, pl.z - e.z) <= c.wakeRange;
}

function wakeNear(e, sim, c) {
  return e.called || onForecourt(e, sim, c);
}

function stepFirstSuit(e, sim, dt, events, c) {
  const pl = sim.player;
  stepSpeaker(sim, 'armourFirst', dt, events);
  if (e.state === 'stand') {
    if (!wakeNear(e, sim, c)) return;
    e.state = 'speak';
    greet(sim, 'armourFirst', events);
    faceTo(e, pl.x, pl.z);
    return;
  }
  if (e.state === 'speak') {
    faceTo(e, pl.x, pl.z);
    if (!greeting(sim, 'armourFirst')) e.state = 'stagger';
    return;
  }
  if (e.state === 'stagger') {
    const x0 = e.x;
    const z0 = e.z;
    chase(e, sim, c.speed, dt, Math.hypot(pl.x - e.x, pl.z - e.z));
    e.walked += Math.hypot(e.x - x0, e.z - z0);
    if (e.walked < c.firstSteps) return;
    // It stops where it stands and comes apart a piece at a time (#14); the heap is down at the end.
    e.state = 'crumble';
    e.crumbleT = 0; // its own clock: the cup's stop and enemy.js reset e.timer
    e.said = 0;
    e.speedNow = 0;
    events.push({ type: 'suitCrumbles', id: e.id, x: e.x, z: e.z });
    return;
  }
  if (e.state === 'crumble') {
    e.speedNow = 0;
    e.crumbleT += dt;
    // The rust complaints (talk.js warn ladder of armourFirst): the second when the first has had its full time.
    const at = [c.crumbleLead, c.crumbleLead + keySeconds('armourRust1', sim.cfg)];
    while (e.said < at.length && e.crumbleT >= at[e.said]) {
      warn(sim, 'armourFirst', e.said, events);
      e.said += 1;
    }
    if (e.crumbleT < c.crumbleTime) return;
    e.state = 'heap';
    e.dead = true;
    events.push({ type: 'suitFalls', id: e.id, x: e.x, z: e.z });
    for (const o of sim.enemies) if (o.type === 'armour' && o.suit === 2 && !o.dead) o.called = true;
  }
}

function stepSecondSuit(e, sim, dt, events, c) {
  const pl = sim.player;
  stepSpeaker(sim, 'armour', dt, events);
  const dx = pl.x - e.x;
  const dz = pl.z - e.z;
  const dist = Math.hypot(dx, dz);
  e.cooldown = Math.max(0, e.cooldown - dt);
  if (e.state === 'stand' || e.state === 'threat') {
    const shot = struck(e, events);
    if (e.state === 'stand') {
      // Woken by the first suit's fall, by a shot, or (after a restore, with the first already
      // a heap) by the warden coming onto the forecourt (e.onApproach, set by seatSentries).
      if (!e.called && !shot && !(e.onApproach && onForecourt(e, sim, c))) return;
      const fresh = greet(sim, 'armour', events); // false once greeted in this run (kept across deaths)
      e.state = fresh && !shot ? 'threat' : 'walk';
      faceTo(e, pl.x, pl.z);
      return;
    }
    faceTo(e, pl.x, pl.z);
    if (shot || !greeting(sim, 'armour')) e.state = 'walk';
    return;
  }
  if (e.state === 'tell') {
    e.speedNow = 0;
    faceTo(e, e.aim.x, e.aim.z);
    e.timer -= dt;
    e.tell = Math.max(0, e.timer);
    if (e.timer > 0) return;
    e.tell = 0;
    events.push({ type: 'strike', id: e.id, enemy: 'armour', move: 'pike' });
    const chest = (p) => ({ x: p.x, y: (p.y || 0) + 1.3, z: p.z });
    const landed = !pl.dead && !onTheRoad(pl) // #29: nothing on the road hurts the warden
      && Math.hypot(pl.x - e.aim.x, pl.z - e.aim.z) <= c.blowRadius
      && dist <= c.reach + c.slack
      && lineOfSight(chest(e), chest(pl), sim.boxes || []);
    if (landed) hurtPlayer(sim, c.damage, e.x, e.z, events);
    e.aim = null;
    e.state = 'strike';
    e.timer = c.recover;
    e.cooldown = c.attackInterval;
    return;
  }
  if (e.state === 'strike') {
    e.speedNow = 0;
    e.timer -= dt;
    if (e.timer <= 0) e.state = 'walk';
    return;
  }
  // walk (and 'approach' or 'stunned' after the cup's stop, which resume it)
  e.state = 'walk';
  if (pl.dead) { e.speedNow = 0; return; }
  if (onTheRoad(pl)) { e.speedNow = 0; faceTo(e, pl.x, pl.z); return; } // #29: a suit stops at the gate and watches
  e.tauntIn -= dt;
  if (e.tauntIn <= 0 && !greeting(sim, 'armour')) {
    taunt(sim, 'armour', sim.rng, events);
    e.tauntIn = c.tauntEvery;
  }
  if (dist <= c.reach) {
    e.speedNow = 0;
    faceTo(e, pl.x, pl.z);
    if (e.cooldown <= 0) {
      e.state = 'tell';
      e.timer = c.tell;
      e.tell = c.tell;
      e.aim = { x: pl.x, z: pl.z };
      events.push({ type: 'strikeTell', id: e.id, enemy: 'armour', move: 'pike' });
    }
    return;
  }
  chase(e, sim, c.speed, dt, dist);
}

// ---- the wife -------------------------------------------------------------------------------
// Out of the canvas (out, tell) she glides at the warden through anything and lunges after her
// tell. A garlic raised within `ward` of her (stepGarlic) drives her back (flee): she leaves
// through a wall, the ceiling or the floor (drawn from sim.rng) and nothing in the plan stops her;
// then she is gone a while, unseen (away). She comes back from any side of the warden, above or
// below (return), keening as she comes (wifeNear, on her own strip, every nearEvery), and only
// within reach does her tell begin: a warden standing still hears her (returnDist - reach) /
// speed seconds before it (about 2.9 s), time to run or raise the garlic again (#10).

/** Where a raised garlic can find her. */
const PRESENT = Object.freeze(['out', 'tell', 'return']);
/** Out of her painting and not yet driven away for good. */
const OUT = Object.freeze([...PRESENT, 'flee', 'away']);
/**
 * Her own stretch (keepmap.js zones): the hall and the first corridor. She comes back only while
 * the warden is there, so she never follows him into a puzzle room, onto the Knight's Walk or into
 * the Count's room, where a death would count against him (A8, G7, G9). Away, she waits for him.
 */
const HAUNT = Object.freeze(['hall', 'cor1']);
const onHerStretch = (pl) => HAUNT.includes(zoneAt(pl.x, pl.z)) && feetY(pl) < 2;

const feetY = (p) => (Number.isFinite(p.y) ? p.y : 0);
/** Her distance from the warden in three dimensions: she can be in the ceiling or under the floor. */
const dist3 = (e, pl) => Math.hypot(pl.x - e.x, feetY(pl) - feetY(e), pl.z - e.z);

/** Moves e straight toward (tx, ty, tz) at speed without collision (she drifts through the house). */
function glide(e, tx, ty, tz, speed, dt) {
  const dx = tx - e.x;
  const dy = ty - feetY(e);
  const dz = tz - e.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-4) { e.speedNow = 0; return 0; }
  const step = Math.min(d, speed * dt);
  e.x += (dx / d) * step;
  e.y = feetY(e) + (dy / d) * step;
  e.z += (dz / d) * step;
  e.speedNow = step / (dt || 1);
  return d - step;
}

/** A hold-up reached her and it was not the last: back and out through the house (wifeDriven). */
function driveBack(e, sim, events, c) {
  const pl = sim.player;
  const r = sim.rng();
  const through = r < 1 / 3 ? 'ceiling' : r < 2 / 3 ? 'floor' : 'wall';
  const dx = e.x - pl.x;
  const dz = e.z - pl.z;
  const d = Math.hypot(dx, dz);
  // Straight away from the warden; on top of him, the way he faces.
  const ux = d > 1e-3 ? dx / d : -Math.sin(pl.yaw || 0);
  const uz = d > 1e-3 ? dz / d : -Math.cos(pl.yaw || 0);
  const run = c.fleeSpeed * c.fleeTime;
  const rise = through === 'ceiling' ? c.fleeRise : through === 'floor' ? -c.fleeSink : 0;
  e.flee = { x: e.x + ux * run, y: feetY(e) + rise, z: e.z + uz * run, speed: Math.hypot(run, rise) / c.fleeTime };
  e.state = 'flee';
  e.timer = c.fleeTime;
  e.tell = 0;
  events.push({ type: 'wifeDriven', id: e.id, x: e.x, z: e.z, through });
}

/** The third hold-up: she shreds away for good (wifeGone, done.wife; G4). Only raised is consumed (A7). */
function driveAway(e, sim, events) {
  const w = sim.waves;
  e.state = 'gone';
  e.dead = true;
  e.speedNow = 0;
  w.raised = 0;
  if (w.done) w.done.wife = true;
  sim.enemies = sim.enemies.filter((o) => o !== e);
  events.push({ type: 'wifeGone', x: e.x, z: e.z });
}

/** Where she comes back from: returnDist from the warden on any bearing, level, above or below. */
function returnPoint(sim, c) {
  const pl = sim.player;
  const a = (pl.yaw || 0) + sim.rng() * 2 * Math.PI; // any bearing, behind as often as ahead
  const lift = sim.rng();
  const dy = lift < 1 / 3 ? c.returnRise : lift < 2 / 3 ? -c.returnSink : 0;
  const flat = Math.sqrt(Math.max(0, c.returnDist * c.returnDist - dy * dy));
  return { x: pl.x - Math.sin(a) * flat, y: feetY(pl) + dy, z: pl.z - Math.cos(a) * flat };
}

const lifted = {}; // emergeAt's out, reused every frame

const near = (e) => ({ type: 'wifeNear', id: e.id, x: e.x, y: feetY(e), z: e.z });

function stepWife(e, sim, dt, events, c) {
  const pl = sim.player;
  e.immune = true;
  e.intangible = true;
  e.phantom = true; // nothing in the plan stops her and nothing pushes her (enemy.js separate)
  if (e.state === 'painting') {
    if (pl.dead || Math.hypot(pl.x - e.home.x, pl.z - e.home.z) > c.stirRange) return;
    e.state = 'stir';
    e.stirAt = { x: pl.x, z: pl.z };
    e.stirFor = 0;
    e.home.yaw = Number.isFinite(e.heading) ? e.heading : 0; // the way her canvas faces (seatSentries)
    warn(sim, 'wife', 0, events);
    events.push({ type: 'wifeStir', x: e.x, z: e.z });
    return;
  }
  if (e.state === 'stir') {
    faceTo(e, pl.x, pl.z);
    if (e.emerge == null) {
      e.stirFor += dt;
      if (Math.hypot(pl.x - e.stirAt.x, pl.z - e.stirAt.z) >= c.outAfter || e.stirFor >= c.outTime) e.emerge = 0;
      return;
    }
    // Coming out of the canvas: off the wall along its facing, by the timeline's lift.
    e.emerge = Math.min(c.emergeTime, e.emerge + dt);
    const k = emergeAt(e.emerge, c.emergeTime, lifted).lift;
    const yaw = e.home.yaw || 0;
    e.x = e.home.x - Math.sin(yaw) * c.free * k;
    e.z = e.home.z - Math.cos(yaw) * c.free * k;
    if (e.emerge >= c.emergeTime) e.state = 'out';
    return;
  }
  e.cooldown = Math.max(0, e.cooldown - dt);
  if (e.state === 'flee') {
    glide(e, e.flee.x, e.flee.y, e.flee.z, e.flee.speed, dt);
    e.timer -= dt;
    if (e.timer > 0) return;
    e.state = 'away';
    e.hidden = true;
    e.speedNow = 0;
    e.timer = c.awayMin + sim.rng() * (c.awayMax - c.awayMin);
    return;
  }
  if (e.state === 'away') {
    e.timer = Math.max(0, e.timer - dt);
    if (e.timer > 0 || pl.dead || !onHerStretch(pl)) return;
    Object.assign(e, returnPoint(sim, c));
    e.hidden = false;
    e.state = 'return';
    e.nearIn = c.nearEvery;
    e.cooldown = 0;
    faceTo(e, pl.x, pl.z);
    events.push(near(e));
    return;
  }
  if (e.state === 'return') {
    if (pl.dead) { e.speedNow = 0; return; }
    if (!onHerStretch(pl)) {
      // He has left her stretch before she reached him: she goes back to waiting, unseen.
      e.state = 'away';
      e.hidden = true;
      e.speedNow = 0;
      e.timer = c.awayMin;
      return;
    }
    faceTo(e, pl.x, pl.z);
    glide(e, pl.x, feetY(pl), pl.z, c.speed, dt);
    e.nearIn -= dt;
    if (e.nearIn <= 0) {
      e.nearIn += c.nearEvery;
      events.push(near(e));
    }
    if (dist3(e, pl) > c.reach) return;
    e.state = 'out'; // within reach: her tell begins below
  }
  const dist = dist3(e, pl);
  if (e.state === 'tell') {
    faceTo(e, pl.x, pl.z);
    e.timer -= dt;
    e.tell = Math.max(0, e.timer);
    if (e.timer > 0) return;
    e.tell = 0;
    events.push({ type: 'strike', id: e.id, enemy: 'wife', move: 'lunge' });
    if (!pl.dead && !onTheRoad(pl) && dist <= c.reach + c.slack) hurtPlayer(sim, c.damage, e.x, e.z, events); // #29
    e.state = 'out';
    e.cooldown = c.attackInterval;
    return;
  }
  e.state = 'out';
  if (pl.dead) { e.speedNow = 0; return; }
  faceTo(e, pl.x, pl.z);
  if (dist > c.reach) {
    glide(e, pl.x, feetY(pl), pl.z, c.speed, dt);
    if (dist3(e, pl) > c.reach) return;
  } else {
    e.speedNow = 0;
  }
  if (e.cooldown <= 0) {
    e.state = 'tell';
    e.timer = c.tell;
    e.tell = c.tell;
    events.push({ type: 'strikeTell', id: e.id, enemy: 'wife', move: 'lunge' });
  }
}

const FIRST_STATES = ['stand', 'speak', 'stagger', 'crumble', 'heap'];

/**
 * One frame of a sentry (enemy.js's stepEnemy hands it 'armour' and 'wife'). A stop from the
 * cup (e.stun) is counted down here too, so the sentries keep the shipped rule whichever caller
 * counts it: nothing happens until it runs out, then the walk resumes.
 */
export function stepSentry(e, sim, dt, events) {
  if (e.dead) return;
  if (e.stun > 0) {
    e.stun = Math.max(0, e.stun - dt);
    e.speedNow = 0;
    e.tell = 0;
    e.aim = null;
    if (e.stun === 0) e.state = e.suit === 1 && e.was ? e.was : 'walk'; // the first suit goes on from where it was (a stop must not strand its collapse)
    return;
  }
  const c = sentrySpec(sim.cfg, e.type);
  if (e.type === 'wife') stepWife(e, sim, dt, events, c);
  else if (e.suit === 1) {
    // A stop from the cup (enemy.js ends it as 'approach') or any state it does not know: back to where it was.
    if (!FIRST_STATES.includes(e.state)) e.state = e.was || 'stand';
    stepFirstSuit(e, sim, dt, events, c);
    e.was = e.state;
  }
  else stepSecondSuit(e, sim, dt, events, c);
}

/**
 * After the shots and swings of a frame: for the second suit's `kill` event, its last line and
 * done.armour (the door opens; keep.js reads it). Once only.
 */
export function sentryKilled(sim, events) {
  const w = sim.waves;
  const n = events.length;
  for (let k = 0; k < n; k++) {
    const ev = events[k];
    if (ev.type !== 'kill' || ev.enemy !== 'armour') continue;
    if (w.done && w.done.armour) continue;
    deathLine(sim, 'armour', events);
    if (w.done) w.done.armour = true;
  }
}

/** The wife out of her painting and not yet driven away for good, or null. */
export function wifeOut(sim) {
  return sim.enemies.find((e) => e.type === 'wife' && !e.dead && OUT.includes(e.state)) || null;
}

// ---- the garlic, wielded on Q (#9) ----------------------------------------------------------
// The braid is a weapon in the castle's cycle (keepconfig.js GARLIC, carried while any garlic
// is: keep.js syncGarlic). The fire button raises it (raiseGarlic: a fresh press only, A6) and it
// stays up for raiseTime (stepGarlic). The first frame it is up with the wife present within
// cfg.wife.ward of the warden counts once: sim.waves.raised goes up by one, and she is driven
// back (driveBack) or, at cfg.wife.drives, away for good. Raising it spends nothing: only
// sim.waves.raised is consumed (security A7).

/**
 * The fire button with the garlic in hand (sim.js calls it every frame with the button's state).
 * Raises it on a press the sim observed: the button must have been up since the last raise, a
 * card or a pause (lowerGarlic). Emits garlicUp { held: true }. Returns true when it went up.
 */
export function raiseGarlic(sim, w, down, events) {
  if (!w) return false;
  if (!down) { w.down = false; return false; }
  if (w.down) return false; // held since the last raise, card, pause or restore (A6)
  const items = sim.waves && sim.waves.items;
  // A press made while it is still up, cooling or being swapped to is kept, not lost: held, it
  // raises the garlic the moment it can (it is still a press the sim observed).
  if (!(items && items.garlic > 0) || w.cooldown > 0 || w.raise > 0) return false;
  w.down = true;
  const spec = specOf(sim.cfg, w);
  w.raise = spec.raiseTime;
  w.warded = false;
  w.cooldown = spec.fireInterval;
  events.push({ type: 'garlicUp', held: true });
  return true;
}

/** While the garlic is up: the first frame the wife is present within ward of the warden counts. Returns true then. */
export function stepGarlic(sim, w, dt, events) {
  if (!w || !(w.raise > 0)) return false;
  const counts = !w.warded;
  w.raise = Math.max(0, w.raise - dt);
  if (!counts) return false;
  const her = sim.enemies.find((e) => e.type === 'wife' && !e.dead && PRESENT.includes(e.state));
  const c = sentrySpec(sim.cfg, 'wife');
  if (!her || sim.player.dead || dist3(her, sim.player) > c.ward) return false;
  w.warded = true;
  const st = sim.waves;
  st.raised = (Number.isFinite(st.raised) ? st.raised : 0) + 1;
  if (st.raised >= c.drives) driveAway(her, sim, events);
  else driveBack(her, sim, events, c);
  return true;
}

/** A card, a pause, a scene or a restore: the garlic comes down and a button held through it counts for nothing (A6). */
export function lowerGarlic(sim) {
  const g = weaponNamed(sim, 'garlic');
  if (!g) return;
  g.raise = 0;
  g.down = true;
}

/** The hall's inner door: open while the warden carries garlic (A7, Conflicts 7). */
export function innerDoorOpen(sim) {
  const items = sim.waves && sim.waves.items;
  return !!(items && items.garlic > 0);
}

/**
 * Seats the sentries for a life. at: { suits: [{ x, z, yaw }, { x, z, yaw }], painting: { x, z,
 * yaw } } (keepmap.js), else cfg.sentries. The first suit is seated as its heap once it has
 * fallen in this run (firstFallen, else read from its kept talk record); the second only until
 * done.armour; the wife only until done.wife (G4). Returns the seated creatures.
 */
export function seatSentries(sim, events, at = sim.cfg.sentries, firstFallen = null) {
  const w = sim.waves;
  const done = (w && w.done) || {};
  const out = [];
  if (!at) return out;
  const t = w && w.talk;
  const fallen = firstFallen != null ? !!firstFallen : !!(done.armour || (t && t.armourFirst && t.armourFirst.greeted));
  const seat = (type, p, extra) => {
    const e = spawnEnemy(sim, type, p.x, p.z, events, extra);
    initSentry(e, sim.cfg);
    e.heading = p.yaw || 0;
    out.push(e);
    return e;
  };
  if (at.suits && at.suits[0]) {
    const e = seat('armour', at.suits[0], { suit: 1 });
    if (fallen) {
      e.state = 'heap';
      e.dead = true;
    }
  }
  if (at.suits && at.suits[1] && !done.armour) {
    const second = seat('armour', at.suits[1], { suit: 2 });
    // Nothing is left to fall and wake it: it wakes as the warden comes to the door.
    if (fallen) second.onApproach = true;
  }
  if (at.painting && !done.wife) seat('wife', at.painting, {});
  return out;
}
