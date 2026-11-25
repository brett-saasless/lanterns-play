// Queequeg, once won (R5): following in the open (the quay, the pier), waiting at the edge
// where the warden goes somewhere he does not follow (the tavern's door, the gangway's foot: the
// caller names which), and looking toward the nearest proof not yet found. Pure.

/** Queequeg's walking speed (metres a second): a starting value. */
export const MATE_SPEED = 3.2;

/** How close he keeps to the warden while following. */
export const FOLLOW_DIST = 2.2;

/** A fresh mate at `at`, waiting (not yet won: dock.js does not step this until he is). */
export function createMate(at) {
  return { x: at.x, z: at.z, state: 'wait', lookAt: null };
}

function moveToward(m, tx, tz, speed, dt) {
  const dx = tx - m.x;
  const dz = tz - m.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return;
  const step = Math.min(d, speed * dt);
  m.x += (dx / d) * step;
  m.z += (dz / d) * step;
}

/**
 * One frame: `followZones` lists the zones he follows into; while the warden stands in one of
 * them he closes to FOLLOW_DIST and looks at nothing in particular (lookAt null). Elsewhere he
 * walks to `edgePos` and waits there, looking toward `lookTarget` (the nearest proof not yet
 * found, or null once all are, or while the warden is signed on and he simply walks at the
 * warden's side - the caller passes null lookTarget and a followZones list of everywhere once
 * signed on).
 */
export function stepMate(m, player, playerZone, followZones, lookTarget, edgePos, dt) {
  if (followZones.includes(playerZone)) {
    m.state = 'follow';
    m.lookAt = null;
    const dx = player.x - m.x;
    const dz = player.z - m.z;
    const d = Math.hypot(dx, dz);
    if (d > FOLLOW_DIST) {
      const k = (d - FOLLOW_DIST) / d;
      moveToward(m, m.x + dx * k, m.z + dz * k, MATE_SPEED, dt);
    }
    return;
  }
  m.state = lookTarget ? 'look' : 'wait';
  m.lookAt = lookTarget || null;
  if (edgePos) moveToward(m, edgePos.x, edgePos.z, MATE_SPEED, dt);
}
