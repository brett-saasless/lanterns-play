// Cave encounter: chamber table, entry triggers, veils (open and seal), staggered pore
// spawns under a per-chamber alive cap, seated Weepers, the Cantor, and win detection.
// State lives in sim.waves with the yard's field names (index, count, queue, phase) so the
// HUD counter and hostilesLeft work in both rooms.

import { spawnEnemy } from './enemy.js';
import { restockPads } from './pickups.js';
import { createSong, stepSong, settleSong } from './cantorsong.js';

/** Spawn order for chamber `index` (seated Weepers and the boss's Call are not queued). */
export function buildChamberQueue(index, cfg, rng) {
  const ch = cfg.chambers[index];
  const q = [];
  for (let i = 0; i < ch.lurch; i++) q.push('lurch');
  for (let i = 0; i < ch.weeper - ch.seated; i++) q.push('weeper');
  // Fisher-Yates, keeping the first entry first (a Lurch opens the chamber).
  for (let i = q.length - 1; i > 1; i--) {
    const j = 1 + Math.floor(rng() * i);
    [q[i], q[j]] = [q[j], q[i]];
  }
  if (ch.boss) q.push(ch.boss);
  return q;
}

/**
 * Phases: 'banner' (timer counts down, then the pores open) -> 'active' (spawning and
 * fighting) -> 'cleared' (exit veil open, waiting for the player to cross the next
 * chamber's trigger) -> 'banner' of the next chamber ... -> 'done' after the boss dies.
 * veilsClosed[i] mirrors cfg.veils[i]; exit veils start closed, entry veils start open.
 */
export function createChambers(cfg, rng) {
  return {
    index: 0,
    count: cfg.chambers.length,
    phase: 'banner',
    timer: cfg.firstWaveDelay,
    queue: buildChamberQueue(0, cfg, rng),
    spawnTimer: 0,
    spawnedThisWave: 0,
    veilsClosed: cfg.veils.map((v) => v.role === 'exit'),
    bossId: null,
    song: createSong(cfg), // the Cantor's song and the stalactites it has brought down (cantorsong.js)
  };
}

/** The live collision list for this chamber state: the room's boxes plus every closed veil. */
export function chamberBoxes(cfg, w) {
  const closed = cfg.veils.filter((v, i) => w.veilsClosed[i]).map((v) => v.box);
  return closed.length ? [...cfg.boxes, ...closed] : cfg.boxes;
}

function setVeil(sim, i, closed) {
  sim.waves.veilsClosed[i] = closed;
  sim.boxes = chamberBoxes(sim.cfg, sim.waves);
}

function inside(p, t) {
  return p.x > t.minX && p.x < t.maxX && p.z > t.minZ && p.z < t.maxZ;
}

/**
 * Picks a pore of chamber `chamber` away from the player and clear of other enemies,
 * at random among the two farthest that qualify. Returns the pore ({chamber, x, z}).
 */
export function choosePore(sim, chamber = sim.waves.index) {
  const { cfg, player: pl, enemies, rng } = sim;
  const scored = cfg.pores
    .filter((p) => p.chamber === chamber)
    .map((g) => ({ g, d: Math.hypot(g.x - pl.x, g.z - pl.z) }));
  let ok = scored.filter(
    (s) => s.d >= cfg.minPoreDist && enemies.every((e) => Math.hypot(e.x - s.g.x, e.z - s.g.z) > 1.6),
  );
  if (!ok.length) ok = scored.filter((s) => s.d >= cfg.minPoreDist);
  if (!ok.length) ok = scored;
  ok.sort((a, b) => b.d - a.d);
  const top = ok.slice(0, Math.min(2, ok.length));
  return top[Math.floor(rng() * top.length)].g;
}

/** Spawns one creature of type at a pore of the current chamber (also used by the Cantor's Call). */
export function spawnAtPore(sim, type, events, chamber = sim.waves.index) {
  const g = choosePore(sim, chamber);
  const j = sim.cfg.poreJitter;
  return spawnEnemy(sim, type, g.x + (sim.rng() - 0.5) * j, g.z + (sim.rng() - 0.5) * j, events);
}

function noteSpawn(sim) {
  const w = sim.waves;
  if (w.spawnedThisWave === 0) sim.player.grace = sim.cfg.player.spawnGrace;
  w.spawnedThisWave += 1;
}

function enterChamber(sim, events) {
  const { cfg, waves: w } = sim;
  w.index += 1;
  const ch = cfg.chambers[w.index];
  if (ch.entryVeil != null) setVeil(sim, ch.entryVeil, true);
  w.queue = buildChamberQueue(w.index, cfg, sim.rng);
  w.phase = 'banner';
  w.timer = cfg.waveDelay;
  w.spawnTimer = 0;
  w.spawnedThisWave = 0;
  sim.stats.waveReached = w.index + 1;
  events.push({ type: 'gateSeal', chamber: w.index + 1, veil: ch.entryVeil });
  events.push({ type: 'waveStart', wave: w.index + 1, of: w.count, chamber: w.index + 1 });
  // Weepers are already seated on their ledges when the chamber starts.
  const ledges = cfg.ledges.filter((l) => l.chamber === w.index);
  for (let i = 0; i < ch.seated && i < ledges.length; i++) {
    const l = ledges[i];
    spawnEnemy(sim, 'weeper', l.x, l.z, events, { y: l.y, seated: true, ledge: { x: l.x, y: l.y, z: l.z } });
    noteSpawn(sim);
  }
}

function clearChamber(sim, events) {
  const { cfg, waves: w } = sim;
  const ch = cfg.chambers[w.index];
  w.phase = 'cleared';
  if (ch.exitVeil != null) setVeil(sim, ch.exitVeil, false);
  sim.globs = [];
  sim.pools = [];
  restockPads(sim, w.index + 1);
  events.push({ type: 'waveCleared', wave: w.index + 1, chamber: w.index + 1 });
  events.push({ type: 'gateOpen', chamber: w.index + 1, veil: ch.exitVeil });
}

function finishRun(sim, events) {
  const w = sim.waves;
  // Everything still alive falls with the boss; these are not player kills.
  for (const e of sim.enemies) {
    e.dead = true;
    e.hp = 0;
    events.push({ type: 'kill', id: e.id, enemy: e.type, x: e.x, y: e.y, z: e.z, cause: 'boss' });
  }
  sim.enemies = [];
  sim.globs = [];
  sim.pools = [];
  settleSong(sim);
  w.phase = 'done';
  events.push({ type: 'allClear' });
}

export function stepChambers(sim, dt, events) {
  const { cfg, waves: w } = sim;
  if (w.phase === 'done') return;

  if (w.phase === 'cleared') {
    const next = cfg.chambers[w.index + 1];
    if (next && next.trigger && inside(sim.player, next.trigger)) enterChamber(sim, events);
    return;
  }

  if (w.phase === 'banner') {
    w.timer -= dt;
    if (w.timer <= 0) {
      w.phase = 'active';
      w.spawnTimer = 0;
    }
    return;
  }

  // active
  const ch = cfg.chambers[w.index];
  w.spawnTimer -= dt;
  if (w.queue.length && sim.enemies.length < ch.maxAlive && w.spawnTimer <= 0) {
    const type = w.queue.shift();
    let e;
    if (type === ch.boss) {
      e = spawnEnemy(sim, type, ch.bossSpawn.x, ch.bossSpawn.z, events);
      w.bossId = e.id;
    } else {
      e = spawnAtPore(sim, type, events);
    }
    noteSpawn(sim);
    w.spawnTimer = cfg.spawnInterval;
  }

  if (ch.boss) {
    if (w.bossId != null) stepSong(sim, sim.enemies.find((e) => e.id === w.bossId) || null, dt, events);
    if (!w.queue.length && w.bossId != null && !sim.enemies.some((e) => e.id === w.bossId)) finishRun(sim, events);
    return;
  }
  if (!w.queue.length && !sim.enemies.length) {
    if (w.index >= w.count - 1) finishRun(sim, events);
    else clearChamber(sim, events);
  }
}
