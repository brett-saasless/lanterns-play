// Which faces of the castle's shell draw the key light's shadow (fix/walk-seam-light). The owner
// (2026-11-19): "around some of the walls such as the window wall in the knight's walk, at the seam of
// the wall, there is a line of bright light that should be the same color as the concrete".
//
// three draws a one-sided material's far faces into a shadow map (shadowSide BackSide), so the
// shadow's surface is the face of a wall turned away from the light. For a fire inside a room that is
// the wall's outer face, a wall's thickness from anything in the room. For a key that shines in from
// outside (the moon through the Knight's Walk's window or the gallery's, a passage's slit, the dawn in
// the Count's windows) it is the wall's inner face, and the floor, a wall shaft or the next wall that
// touches that face lie within the shadow's bias of it: a strip along every such seam took the moon.
// Such a key must cast with the faces turned toward it (the outer faces): 'outer'. Pure: no three.

/** True when (x, z) lies inside one of a zone's rectangles ({ x0, x1, z0, z1 }). */
export function insideRects(rects, x, z) {
  return rects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
}

/**
 * The shell faces that throw a key's shadow: 'outer' when the light stands outside the walled zone it
 * lights (the shell must cast with its near, outer faces), 'inner' (three's default, the far faces)
 * when it stands inside, or when the zone has no shell (the outside, whose rects are empty).
 */
export function shadowFaces(pos, rects) {
  if (!pos || !rects || !rects.length) return 'inner';
  return insideRects(rects, pos[0], pos[2]) ? 'inner' : 'outer';
}

/**
 * How far in front of a shadow's surface a receiver is still lit (metres, along the light's ray), for
 * a spot light's perspective shadow camera (near, far) at distance d and a depth bias (three adds it to
 * the receiver's depth in [0, 1]; negative pulls the receiver toward the light).
 */
export function biasBand(bias, near, far, d) {
  const slope = (far * near) / (d * d * (far - near)); // d(depth) / d(distance) of a perspective depth
  return Math.abs(bias) / slope;
}
