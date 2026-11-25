// Wave table, staggered spawn queue, max-alive cap, breather, win detection, Bellows fallback.

import { createEnemy } from './enemy.js';
import { restockPads } from './pickups.js';

/** Spawn order for one wave. Without Bellows each one becomes two extra Wicks. */
export function buildQueue(index, cfg, rng) {
  const w = cfg.waves[index];
  const bellows = cfg.bellowsEnabled ? w.bellows : 0;
  const wicks = w.wicks + (cfg.bellowsEnabled ? 0 : 2 * w.bellows);
  const q = [];
  for (let i = 0; i < wicks; i++) q.push('wick');
  for (let i = 0; i < bellows; i++) q.push('bellows');
  // Fisher-Yates, but keep a Wick first so every wave opens with a rush.
  for (let i = q.length - 1; i > 1; i--) {
    const j = 1 + Math.floor(rng() * i);
    [q[i], q[j]] = [q[j], q[i]];
  }
  return q;
}

export function createWaves(cfg, rng) {
  return {
    index: 0,
    count: cfg.waves.length,
    phase: 'banner',
    timer: cfg.firstWaveDelay,
    queue: buildQueue(0, cfg, rng),
    spawnTimer: 0,
    spawnedThisWave: 0,
  };
}

/** Enemies still to defeat in the current wave (queued plus alive). */
export function hostilesLeft(sim) {
  return sim.waves.queue.length + sim.enemies.length;
}

/** Picks a gate far from the player and clear of other enemies. */
export function chooseGate(sim) {
  const { cfg, player: pl, enemies, rng } = sim;
  const scored = cfg.gates.map((g) => ({ g, d: Math.hypot(g.x - pl.x, g.z - pl.z) }));
  let ok = scored.filter(
    (s) => s.d >= cfg.minSpawnDist && enemies.every((e) => Math.hypot(e.x - s.g.x, e.z - s.g.z) > 1.6),
  );
  if (!ok.length) ok = scored.filter((s) => s.d >= cfg.minSpawnDist);
  if (!ok.length) ok = scored;
  ok.sort((a, b) => b.d - a.d);
  const top = ok.slice(0, Math.min(3, ok.length));
  return top[Math.floor(rng() * top.length)].g;
}

export function stepWaves(sim, dt, events) {
  const { cfg, waves: w } = sim;
  if (w.phase === 'done') return;

  if (w.phase === 'banner') {
    w.timer -= dt;
    if (w.timer <= 0) {
      w.phase = 'active';
      w.spawnTimer = 0;
    }
    return;
  }

  if (w.phase === 'breather') {
    w.timer -= dt;
    if (w.timer <= 0) {
      w.index += 1;
      w.queue = buildQueue(w.index, cfg, sim.rng);
      w.phase = 'banner';
      w.timer = cfg.waveDelay;
      w.spawnedThisWave = 0;
      sim.stats.waveReached = w.index + 1;
      events.push({ type: 'waveStart', wave: w.index + 1, of: w.count });
    }
    return;
  }

  // active
  w.spawnTimer -= dt;
  if (w.queue.length && sim.enemies.length < cfg.maxAlive && w.spawnTimer <= 0) {
    const type = w.queue.shift();
    const g = chooseGate(sim);
    const e = createEnemy(sim.nextId++, type, g.x + (sim.rng() - 0.5), g.z + (sim.rng() - 0.5), cfg, sim.rng);
    sim.enemies.push(e);
    if (w.spawnedThisWave === 0) sim.player.grace = cfg.player.spawnGrace;
    w.spawnedThisWave += 1;
    w.spawnTimer = cfg.spawnInterval;
    events.push({ type: 'spawn', id: e.id, enemy: type, x: e.x, z: e.z });
  }
  if (!w.queue.length && !sim.enemies.length) {
    if (w.index >= w.count - 1) {
      w.phase = 'done';
      events.push({ type: 'allClear' });
    } else {
      w.phase = 'breather';
      w.timer = cfg.breather;
      restockPads(sim);
      events.push({ type: 'waveCleared', wave: w.index + 1 });
    }
  }
}
