// Lobbed globs (timed flight to a fixed ground point) and the pools they leave.
// Contract: docs/features/cave/build-notes.md. Pools and landings hurt only the player.

import { hurtPlayer } from './enemy.js';

/**
 * Launches one glob from `from` ({x, y, z}) to the ground point `to` ({x, z}).
 * owner is the launching enemy's id. Pushes onto sim.globs, emits 'globLaunch', returns it.
 */
export function launchGlob(sim, from, to, owner, events, cfg = sim.cfg) {
  const g = {
    id: sim.nextId++,
    owner,
    from: { x: from.x, y: from.y, z: from.z },
    to: { x: to.x, z: to.z },
    flight: cfg.glob.flight,
    t: 0,
  };
  sim.globs.push(g);
  events.push({ type: 'globLaunch', id: g.id, owner, from: g.from, to: g.to, flight: g.flight });
  return g;
}

/**
 * Advances pools, then globs, once per frame (cave only). A pool made by a landing this
 * frame starts counting next frame.
 */
export function stepHazards(sim, dt, events, rng, cfg) {
  const pl = sim.player;

  const pools = [];
  for (const p of sim.pools) {
    p.life -= dt;
    if (p.life <= 0) {
      events.push({ type: 'poolGone', id: p.id });
      continue;
    }
    if (Math.hypot(pl.x - p.x, pl.z - p.z) <= p.radius) {
      p.tick += dt;
      while (p.tick >= cfg.pool.tickInterval) {
        p.tick -= cfg.pool.tickInterval;
        hurtPlayer(sim, cfg.pool.damage, p.x, p.z, events);
      }
    }
    pools.push(p);
  }

  const globs = [];
  for (const g of sim.globs) {
    g.t += dt;
    if (g.t < g.flight) {
      globs.push(g);
      continue;
    }
    const { x, z } = g.to;
    events.push({ type: 'globLand', id: g.id, x, z, radius: cfg.glob.radius });
    if (Math.hypot(pl.x - x, pl.z - z) <= cfg.glob.radius) {
      hurtPlayer(sim, cfg.glob.damage, x, z, events);
    }
    pools.push({ id: sim.nextId++, x, z, radius: cfg.pool.radius, life: cfg.pool.life, tick: 0 });
  }

  sim.globs = globs;
  sim.pools = pools;
}
