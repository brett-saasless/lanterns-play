// Ray tests: slab test against cover boxes, sphere test against enemies; nearest wins.
// A hit volume may carry mult 0 (armour: struck, but no damage). A creature with
// e.intangible set (the Rabbit, the Bat out of light, the Caterpillar in its smoke) is not
// there for a shot at all: the ray passes where it is. A friendly figure (e.friendly: the plot
// gardeners and the hunter, security A6) is checked first, before anything else is read from
// it, and is never there for any weapon: bolts and salt pass through it (castShot), and the
// halberd's swing and the cup's splash never find it (arcTargets).

/** Distance along the ray (dir normalised) to the box, or Infinity. */
export function rayBox(o, d, b) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [o.x, d.x, b.minX, b.maxX],
    [o.y, d.y, b.minY, b.maxY],
    [o.z, d.z, b.minZ, b.maxZ],
  ];
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < lo || oo > hi) return Infinity;
      continue;
    }
    let t1 = (lo - oo) / dd;
    let t2 = (hi - oo) / dd;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** Distance along the ray to the sphere surface, or Infinity. */
export function raySphere(o, d, c, r) {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t = -b - s;
  if (t >= 0) return t;
  return -b + s >= 0 ? 0 : Infinity;
}

/** Sphere a shot can hit for an enemy, from its config entry. */
export function enemySphere(e, cfg) {
  const c = cfg[e.type];
  return { x: e.x, y: e.y + c.hitY, z: e.z, r: c.hitRadius };
}

/**
 * Casts one hitscan shot. Returns { kind: 'enemy' | 'cover' | 'ground' | 'none', t, point, enemy }.
 * An enemy hit also carries mult (damage share of the volume struck; 0 for armour) and zone
 * (its name, or null). Intangible enemies are skipped.
 * enemies carry { x, y, z, type }; cfg supplies hit volumes. cfg.ceilings (cave only) stop
 * shots like cover and are not in boxes, because collision is XZ-only.
 */
export function castShot(origin, dir, range, boxes, enemies, cfg) {
  let best = { kind: 'none', t: range, enemy: null };
  for (const b of boxes) {
    const t = rayBox(origin, dir, b);
    if (t < best.t) best = { kind: 'cover', t, enemy: null };
  }
  for (const b of cfg.ceilings || []) {
    const t = rayBox(origin, dir, b);
    if (t < best.t) best = { kind: 'cover', t, enemy: null };
  }
  if (dir.y < -1e-6) {
    const t = -origin.y / dir.y;
    if (t >= 0 && t < best.t) best = { kind: 'ground', t, enemy: null };
  }
  for (const e of enemies) {
    if (e.friendly || e.dead || e.intangible) continue;
    const zones = cfg[e.type].hitZones;
    if (zones) {
      // Several volumes in the enemy's own frame, turned by its heading; the nearest one wins.
      const cs = Math.cos(e.heading || 0);
      const sn = Math.sin(e.heading || 0);
      for (const zn of zones) {
        const c = { x: e.x + zn.x * cs + zn.z * sn, y: e.y + zn.y, z: e.z - zn.x * sn + zn.z * cs };
        const t = raySphere(origin, dir, c, zn.r);
        if (t < best.t) best = { kind: 'enemy', t, enemy: e, mult: zn.mult, zone: zn.name };
      }
      continue;
    }
    const s = enemySphere(e, cfg);
    const t = raySphere(origin, dir, s, s.r);
    if (t < best.t) best = { kind: 'enemy', t, enemy: e, mult: 1, zone: null };
  }
  best.point = {
    x: origin.x + dir.x * best.t,
    y: origin.y + dir.y * best.t,
    z: origin.z + dir.z * best.t,
  };
  return best;
}

/** True when nothing in boxes blocks the straight segment a to b. */
export function lineOfSight(a, b, boxes) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const d = { x: dx / len, y: dy / len, z: dz / len };
  for (const box of boxes) if (rayBox(a, d, box) < len) return false;
  return true;
}

/**
 * The creatures a close blow or a thrown splash reaches: every enemy not friendly, dead or
 * intangible whose body circle comes within reach of (from.x, from.z), whose centre lies within
 * halfAngle (radians) of the facing dir ({x, z}), and which `from` can see: no box of `boxes`
 * cuts the line from `from` (its y the height the blow or splash leaves at, 1 m if absent) to
 * the creature at that height (capped at its hitY), so a hedge, wall or closed gate between
 * stops the halberd and the cup. Nearest first. Friendlies are skipped before anything else is
 * read from them (security A6). sim.js's inFront asks this for the halberd's swing (90 to
 * everything in a 50 degree half-arc within 2.4 m) and the cup's splash (5 m, a 25 degree
 * half-cone), passing sim.boxes.
 */
export function arcTargets(from, dir, reach, halfAngle, enemies, cfg, boxes = []) {
  const len = Math.hypot(dir.x, dir.z) || 1;
  const fx = dir.x / len;
  const fz = dir.z / len;
  const cosMax = Math.cos(halfAngle);
  const fy = Number.isFinite(from.y) ? from.y : 1;
  const eye = { x: from.x, y: fy, z: from.z };
  const out = [];
  for (const e of enemies) {
    if (!e || e.friendly || e.dead || e.intangible) continue;
    const c = cfg[e.type] || {};
    const r = c.radius || 0;
    const dx = e.x - from.x;
    const dz = e.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d - r > reach) continue;
    if (d > 1e-6 && (dx * fx + dz * fz) / d < cosMax) continue;
    const ty = (e.y || 0) + Math.min(fy, Number.isFinite(c.hitY) ? c.hitY : fy);
    if (boxes.length && !lineOfSight(eye, { x: e.x, y: ty, z: e.z }, boxes)) continue;
    out.push({ e, d });
  }
  out.sort((a, b) => a.d - b.d || a.e.id - b.e.id);
  return out.map((o) => o.e);
}
