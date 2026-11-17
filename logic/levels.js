// Two-level places, shared by the castle and the yard: a rect where a lower and an upper surface
// share the plan, a stair joining them, optional low steps, and where the upper surface is solid.
// The castle's pit and crypt are such places (keepmap.js LOWER: the deck over the pit, the
// gallery over the crypt); the yard's climbable crates are the same shape turned over (config.js
// levels: the ground, the crate top as the deck, the ramp or ladder as the stair, the small box
// as a step). levelAt is the one resolver both call: the floor is the highest surface at or
// under y + stepUp. Pure; no state is kept.

/** The height a warden (or a creature) may step up without a jump (a castle tread is 0.25). */
export const STEP_UP = 0.3;

const EPS = 1e-6;

const inRect = (r, x, z) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

/**
 * A stair as data: rect, the axis it runs along, the head (the coordinate of its top edge),
 * dir (the way it goes down: -1 toward lower coordinates), landing (metres of the top tread),
 * then treads of `run` metres each, `rise` lower each. The first tread is the landing.
 * A smooth stair (smooth: true: a ramp, or a ladder) is level with `top` across its landing,
 * then falls `rise` every `run` metres continuously, to `top - treads * rise` at its foot.
 */
export function stairHeight(s, x, z) {
  const along = s.axis === 'x' ? x : z;
  const m = Math.max(0, s.dir < 0 ? (s.head - along) : (along - s.head)); // metres from the head
  if (s.smooth) return s.top - Math.min(Math.max(0, m - s.landing) / s.run, s.treads) * s.rise;
  const k = m < s.landing ? 0 : 1 + Math.floor((m - s.landing) / s.run);
  return s.top - Math.min(k + 1, s.treads) * s.rise;
}

/**
 * The floor at (x, z) for feet at y in the first entry of `entries` whose rect holds the point:
 * { entry, floor, under, on, above }, or null outside them all. Surfaces: the entry's lower
 * `floor`, its stair where the point is on it, any `steps` ({ rect, h }) under it, and its `top`
 * where upperSolid(entry, x, z, state) says the upper surface is there. floor is the highest of
 * them at or under y + stepUp (else the lower floor); on names it ('floor', 'stair', 'step',
 * 'top'). under is entry.id while the floor is below the top. above is the lowest surface
 * standing higher than the reach, for an entry marked solid (solid below its surfaces, as a
 * crate is: a mover may not walk into it), else -Infinity.
 */
export function levelAt(entries, x, z, y, stepUp, upperSolid, state = null) {
  for (const L of entries) {
    if (!inRect(L.rect, x, z)) continue;
    let floor = L.floor;
    let on = 'floor';
    let above = Infinity;
    const surface = (h, name) => {
      if (h <= y + stepUp) {
        if (h > floor) { floor = h; on = name; }
      } else if (L.solid && h < above) {
        above = h;
      }
    };
    if (L.stair && inRect(L.stair.rect, x, z)) surface(stairHeight(L.stair, x, z), 'stair');
    for (const s of L.steps || []) if (inRect(s.rect, x, z)) surface(s.h, 'step');
    if (upperSolid(L, x, z, state)) surface(L.top, 'top');
    const under = floor < L.top - EPS ? L.id : null;
    return { entry: L, floor, under, on, above: above === Infinity ? -Infinity : above };
  }
  return null;
}
