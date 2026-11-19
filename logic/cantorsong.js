// The Cantor's song (the owner, 2026-11-19: "the cantor level is too easy"). While the fight is on
// the Cantor sings in bouts, a few clear notes in a minor key, and each bout shakes stalactites
// loose from the Nave's vault. The first ever to fall comes down where the warden is looking; every
// one after it falls over him or near him. A fallen stalactite is gone for the rest of the run: it
// leaves a broken stump on the vault and a small rubble pile on the floor that is only seen (no
// collision, no path, the rubble way untouched).
//
// State lives in sim.waves.song (chambers.js createChambers), so resetSim rebuilds it with the rest
// of the encounter and nothing carries between runs. The rules for one bout, as a function of time:
//
//   bout:  boutT 0 .. cfg.song.length (the notes, SONG_NOTES)  ->  then the gap to the next bout
//   drop k (k < the bout's count) begins at boutT = cfg.song.drops[k]: its target is chosen then
//          (where the warden is at that moment), and its telegraph runs warn seconds to the impact:
//            t in [0, warn - fall)   loosening (0.8 s): the warning grows on the floor, the stone glints, grit trickles, the rock grinds
//            t in [warn - fall, warn) falling: released, under gravity, landing at t = warn
//            t = warn                impact: within radius of the warden -> damage (once a bout)
//
// Each stalactite's state (song.state[i]): 0 hanging, 1 loosening, 2 falling, 3 down (stump + rubble).
// Pure and deterministic: every draw is sim.rng's; nothing is allocated per frame.

import { hurtPlayer } from './enemy.js';
import { caveField, ceilingAt, spaceIndexAt } from './cavemap.js';
import { NAVE } from './stalactites.js';

export const HANGING = 0;
export const LOOSENING = 1;
export const FALLING = 2;
export const DOWN = 3;

/** The song: four notes of A natural minor, falling from the fifth to the root (E5 C5 B4 A4). */
export const SONG_NOTES = Object.freeze([
  Object.freeze({ name: 'E5', hz: 659.26, at: 0.0, dur: 0.6 }),
  Object.freeze({ name: 'C5', hz: 523.25, at: 0.6, dur: 0.6 }),
  Object.freeze({ name: 'B4', hz: 493.88, at: 1.2, dur: 0.6 }),
  Object.freeze({ name: 'A4', hz: 440.0, at: 1.8, dur: 0.6 }),
]);

const MAX_DROPS = 3;

/** A fresh song for a run of the cave (null in a room without one). */
export function createSong(cfg) {
  const c = cfg && cfg.song;
  if (!c) return null;
  const drops = [];
  for (let k = 0; k < MAX_DROPS; k++) drops.push({ i: -1, t: 0, bout: 0 });
  return {
    clock: c.first, // seconds to the next bout, counting once the fight is on
    boutT: -1, // seconds into the bout being sung, or -1
    bouts: 0, // bouts begun this run
    count: 0, // stalactites this bout brings down
    started: 0, // of those, how many have begun
    firstDone: false, // the first one (where the warden looks) has fallen or been tried
    hitBout: 0, // the last bout whose rock struck the warden (one strike a bout)
    state: c.stalactites.map(() => HANGING),
    drops, // the stalactites coming down now: { i (index, -1 free), t (seconds since loosened), bout }
  };
}

/** Which note of the song is sounding boutT seconds in, or -1. */
export function noteAt(boutT) {
  for (let k = SONG_NOTES.length - 1; k >= 0; k--) {
    const n = SONG_NOTES[k];
    if (boutT >= n.at && boutT < n.at + n.dur) return k;
  }
  return -1;
}

/** How many stalactites a bout brings down: one the first time, then more as the Cantor weakens. */
export function boutCount(c, bout, hp, maxHp) {
  if (bout <= 1) return 1;
  let n = 1;
  for (const f of c.more) if (hp < maxHp * f) n += 1;
  return Math.min(MAX_DROPS, n, c.drops.length);
}

/** Seconds from one bout's end to the next one's start: gapMin to gapMax, from the run's rng. */
export function boutGap(c, rng) {
  return c.gapMin + (c.gapMax - c.gapMin) * rng();
}

/**
 * The point on the floor plan the warden is looking at, for the first stalactite: along his heading,
 * where his view meets the vault (level or looking down: c.look.level metres ahead), clamped to
 * c.look.min .. c.look.max metres and pulled back toward him until it is over the Nave's open floor.
 * Writes { x, z } into out.
 */
export function lookPoint(sim, out) {
  const { cfg, player: pl } = sim;
  const L = cfg.song.look;
  const fx = -Math.sin(pl.yaw);
  const fz = -Math.cos(pl.yaw);
  let d = L.level;
  if (pl.pitch > 0.05) d = (ceilingAt(pl.x, pl.z) - (pl.y + cfg.player.eyeHeight)) / Math.tan(pl.pitch);
  d = Math.max(L.min, Math.min(L.max, d));
  while (d > 0 && (spaceIndexAt(pl.x + fx * d, pl.z + fz * d) !== NAVE || caveField(pl.x + fx * d, pl.z + fz * d) < 1)) d -= 0.25;
  d = Math.max(0, d);
  out.x = pl.x + fx * d;
  out.z = pl.z + fz * d;
  return out;
}

/** The hanging stalactite nearest (x, z), or -1 when none hangs. */
export function nearestHanging(c, s, x, z) {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < c.stalactites.length; i++) {
    if (s.state[i] !== HANGING) continue;
    const st = c.stalactites[i];
    const d = (st.x - x) ** 2 + (st.z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * After the first: one of the hanging stalactites within c.near of the warden (over him or near
 * him), at random; with none so close, the nearest that still hangs; -1 when none hangs at all.
 */
export function nearTarget(sim, s) {
  const c = sim.cfg.song;
  const pl = sim.player;
  const r2 = c.near * c.near;
  let n = 0;
  for (let i = 0; i < c.stalactites.length; i++) {
    const st = c.stalactites[i];
    if (s.state[i] === HANGING && (st.x - pl.x) ** 2 + (st.z - pl.z) ** 2 <= r2) n += 1;
  }
  if (!n) return nearestHanging(c, s, pl.x, pl.z);
  let k = Math.floor(sim.rng() * n);
  for (let i = 0; i < c.stalactites.length; i++) {
    const st = c.stalactites[i];
    if (s.state[i] === HANGING && (st.x - pl.x) ** 2 + (st.z - pl.z) ** 2 <= r2 && k-- === 0) return i;
  }
  return -1;
}

const look = { x: 0, z: 0 };

/**
 * The first stalactite: among the hanging ones c.look.min to c.look.max metres ahead of him along
 * his heading, the one nearest his line of sight (a tenth of its distance from the look point
 * breaks a tie). With none in that band, the hanging one nearest the look point.
 */
export function lookTarget(sim, s) {
  const c = sim.cfg.song;
  const pl = sim.player;
  lookPoint(sim, look);
  const fx = -Math.sin(pl.yaw);
  const fz = -Math.cos(pl.yaw);
  const d = Math.hypot(look.x - pl.x, look.z - pl.z);
  let best = -1;
  let bs = Infinity;
  for (let i = 0; i < c.stalactites.length; i++) {
    if (s.state[i] !== HANGING) continue;
    const st = c.stalactites[i];
    const dx = st.x - pl.x;
    const dz = st.z - pl.z;
    const along = dx * fx + dz * fz;
    if (along < c.look.min - 1e-9 || along > c.look.max + 1e-9) continue;
    const score = Math.abs(dx * fz - dz * fx) + 0.1 * Math.abs(along - d);
    if (score < bs) { bs = score; best = i; }
  }
  return best >= 0 ? best : nearestHanging(c, s, look.x, look.z);
}

/** Chooses and loosens the next stalactite of the bout: its telegraph starts now. */
function loosen(sim, s, events) {
  const c = sim.cfg.song;
  let i;
  if (!s.firstDone) {
    s.firstDone = true;
    i = lookTarget(sim, s);
  } else {
    i = nearTarget(sim, s);
  }
  if (i < 0) return; // none left: he sings, and nothing falls
  let slot = null;
  for (const d of s.drops) if (d.i < 0) { slot = d; break; }
  if (!slot) return;
  slot.i = i;
  slot.t = 0;
  slot.bout = s.bouts;
  s.state[i] = LOOSENING;
  const st = c.stalactites[i];
  events.push({ type: 'stalactiteLoose', i, x: st.x, z: st.z, warn: c.warn, fall: c.fall });
}

/** It lands: it is down for good, and it strikes the warden if he stands within its radius. */
function land(sim, s, slot, events) {
  const c = sim.cfg.song;
  const pl = sim.player;
  const st = c.stalactites[slot.i];
  s.state[slot.i] = DOWN;
  let hit = false;
  if (s.hitBout !== slot.bout && Math.hypot(pl.x - st.x, pl.z - st.z) <= c.radius) {
    hit = hurtPlayer(sim, c.damage, st.x, st.z, events) > 0;
    if (hit) s.hitBout = slot.bout;
  }
  events.push({ type: 'stalactiteFall', i: slot.i, x: st.x, z: st.z, hit });
  slot.i = -1;
}

/**
 * One frame of the song (chambers.js, in the Cantor's chamber while it fights). boss: the Cantor,
 * or null once it is gone. The stalactites already coming down finish their fall whatever the
 * Cantor does; a bout begins only while he drags (not mid-swing, Open or Shed), and only once
 * the fight is on (his Shed clock running: the end of the chamber's spawn grace). Singing does
 * not stop his other beats and does not shield him.
 */
export function stepSong(sim, boss, dt, events) {
  const s = sim.waves && sim.waves.song;
  const c = sim.cfg.song;
  if (!s || !c) return;
  for (const slot of s.drops) {
    if (slot.i < 0) continue;
    slot.t += dt;
    if (slot.t >= c.warn - 1e-9) land(sim, s, slot, events);
    else s.state[slot.i] = slot.t >= c.warn - c.fall - 1e-9 ? FALLING : LOOSENING;
  }
  if (!boss || boss.dead) {
    s.boutT = -1;
    if (boss) boss.sing = -1;
    return;
  }
  if (!boss.shedOn) return;
  if (s.boutT < 0) {
    s.clock -= dt;
    if (s.clock <= 0 && boss.state === 'drag') {
      s.bouts += 1;
      s.boutT = 0;
      s.started = 0;
      s.count = boutCount(c, s.bouts, boss.hp, sim.cfg.cantor.hp);
      events.push({ type: 'bossSing', id: boss.id, x: boss.x, z: boss.z, bout: s.bouts, drops: s.count, length: c.length });
    }
  } else {
    s.boutT += dt;
    while (s.started < s.count && s.boutT >= c.drops[s.started] - 1e-9) {
      s.started += 1;
      loosen(sim, s, events);
    }
    if (s.boutT >= c.length - 1e-9 && s.started >= s.count) {
      s.boutT = -1;
      s.clock = boutGap(c, sim.rng);
    }
  }
  boss.sing = s.boutT;
}

/**
 * The fight is over (chambers.js finishRun): the song stops. A stalactite already let go lands
 * where it was falling (down, no harm: the warden is safe through the win); one only loosening
 * stays up.
 */
export function settleSong(sim) {
  const s = sim.waves && sim.waves.song;
  if (!s) return;
  for (const slot of s.drops) {
    if (slot.i < 0) continue;
    s.state[slot.i] = s.state[slot.i] === FALLING ? DOWN : HANGING;
    slot.i = -1;
  }
  s.boutT = -1;
}

/** How many stalactites still hang (none left: the Cantor sings and nothing falls). */
export function hangingLeft(sim) {
  const s = sim.waves && sim.waves.song;
  return s ? s.state.reduce((n, v) => n + (v === HANGING ? 1 : 0), 0) : 0;
}
