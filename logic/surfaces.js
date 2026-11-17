// What is underfoot: the six surface families, the material-to-family table, and the lookup
// of a point against a room's cfg.surfaces ({ base, zones }) plus any live Weeper pool. A zone
// with a `channel` (the Rose Court's rills) counts only while that channel runs.

import { bowlAt, SHORE } from './cavemap.js';

export const FAMILIES = Object.freeze(['hard', 'wet', 'metal', 'soft', 'wood', 'carpet']);

export const MATERIALS = Object.freeze({
  concrete: 'hard', rock: 'hard', stone: 'hard',
  puddle: 'wet', pool: 'wet', shallows: 'wet',
  plate: 'metal', crate: 'metal', ramp: 'metal',
  grass: 'soft', earth: 'soft',
  plank: 'wood', boards: 'wood',
  // The Rose Court: gravel walks and plaza flags ring hard, leaf litter is soft, rills and the
  // stream are wet.
  gravel: 'hard', flag: 'hard', litter: 'soft', stream: 'wet',
  // The castle: marble and cut stone ring hard (marble brighter, in the voice); rugs and the
  // gallery's runner are the sixth family, carpet.
  marble: 'hard', ashlar: 'hard', rug: 'carpet', runner: 'carpet',
});

/** Material a sim pool (a Weeper's glob puddle) reads as while it lives. */
export const WEEPER_POOL_MATERIAL = 'shallows';

function inZone(z, x, zz) {
  if (z.shape === 'ellipse') {
    const u = (x - z.x) / z.rx;
    const v = (zz - z.z) / z.rz;
    return u * u + v * v <= 1;
  }
  if (z.shape === 'rect') return x >= z.minX && x <= z.maxX && zz >= z.minZ && zz <= z.maxZ;
  if (z.shape === 'bowl') return bowlAt([z], x, zz) > SHORE;
  return false;
}

const result = (material) => ({ material, family: MATERIALS[material] || 'hard' });

/** A rill zone is underfoot only while it runs: channel 0 to 3 by valve, 'arch' once the roses are red. */
function running(sim, zone) {
  if (zone.channel == null) return true;
  const w = sim.waves;
  if (!w || !w.channels) return false;
  if (zone.channel === 'arch') return !!(w.done && w.done.roses);
  return !!w.channels[zone.channel];
}

/**
 * { material, family } at (x, z). A live Weeper pool wins (shallows), then the first matching
 * zone of cfg.surfaces, else its base. A room with no surfaces reads as concrete.
 */
export function surfaceAt(sim, x, z) {
  const pools = sim.pools || [];
  for (const p of pools) if (Math.hypot(x - p.x, z - p.z) <= p.radius) return result(WEEPER_POOL_MATERIAL);
  const s = sim.cfg && sim.cfg.surfaces;
  if (!s) return result('concrete');
  for (const zone of s.zones) if (running(sim, zone) && inZone(zone, x, z)) return result(zone.material);
  return result(s.base);
}
