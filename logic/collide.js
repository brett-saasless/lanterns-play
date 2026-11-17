// Circle-vs-AABB slide in the XZ plane, plus an arena bounds clamp.

function pushOut(pos, radius, b) {
  const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
  const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
  const dx = pos.x - cx;
  const dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return false;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    pos.x = cx + (dx / d) * radius;
    pos.z = cz + (dz / d) * radius;
    return true;
  }
  // Centre is inside the box: leave along the shallowest axis.
  const left = pos.x - b.minX;
  const right = b.maxX - pos.x;
  const back = pos.z - b.minZ;
  const front = b.maxZ - pos.z;
  const m = Math.min(left, right, back, front);
  if (m === left) pos.x = b.minX - radius;
  else if (m === right) pos.x = b.maxX + radius;
  else if (m === back) pos.z = b.minZ - radius;
  else pos.z = b.maxZ + radius;
  return true;
}

/**
 * Moves pos ({x, z}, mutated) by delta ({x, z}) and resolves overlaps with boxes so the
 * circle slides along faces. Sub-steps so a fast mover cannot tunnel through thin boxes.
 * Returns true when any collision occurred.
 */
export function moveCircle(pos, delta, radius, boxes, half) {
  const len = Math.hypot(delta.x, delta.z);
  const steps = Math.max(1, Math.ceil(len / (radius * 0.9)));
  let hit = false;
  for (let s = 0; s < steps; s++) {
    pos.x += delta.x / steps;
    pos.z += delta.z / steps;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of boxes) if (pushOut(pos, radius, b)) hit = true;
    }
  }
  if (half !== undefined) {
    const lim = half - radius;
    if (pos.x < -lim) { pos.x = -lim; hit = true; }
    if (pos.x > lim) { pos.x = lim; hit = true; }
    if (pos.z < -lim) { pos.z = -lim; hit = true; }
    if (pos.z > lim) { pos.z = lim; hit = true; }
  }
  return hit;
}

/** True when the circle at (x, z) overlaps any box. */
export function circleBlocked(x, z, radius, boxes) {
  for (const b of boxes) {
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    if ((x - cx) ** 2 + (z - cz) ** 2 < radius * radius) return true;
  }
  return false;
}
