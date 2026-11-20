// The maze's simple trees (forest.js draws its walls with them; tunnelwood.js draws the walk's far
// trees with the same ones, so a far tree on the walk is the maze's own): one metre tall, scaled up
// per instance. Moved here unchanged from forest.js so both can share them.

import * as THREE from 'three';
import { G, part, limb } from './court.js';
import { woodGreen } from '../logic/courtlook.js';
import * as S from './sculpt.js';
import { FAR_CONE, FAR_CONE_BLOBS } from '../logic/treelod.js';

// A tree one metre tall, clipped and Victorian: a stem and a ball, a cone, or two balls.
// `d` is the zone's greying (C7): its leaves grey with the light, as the sky does.
export function victorianTree(kind, d = 0) {
  const parts = [part(G.cyl(0.035, 0.05, 0.5, 6), 0x7a5a3c, { at: [0, 0.25, 0], vary: 0.2 })];
  const leaf = woodGreen([0x57b04e, 0x3f9a45, 0x6ab650][kind], d);
  if (kind === 0) parts.push(part(G.ico(0.3, 1), leaf, { at: [0, 0.68, 0], lump: 0.035, vary: 0.25, freq: 6 }));
  else if (kind === 1) parts.push(part(G.cone(0.24, 0.75, 9), leaf, { at: [0, 0.66, 0], vary: 0.25 }));
  else {
    parts.push(part(G.ico(0.26, 1), leaf, { at: [0, 0.6, 0], scale: [1, 0.8, 1], lump: 0.03, vary: 0.25, freq: 6 }));
    parts.push(part(G.ico(0.17, 0), leaf, { at: [0, 0.87, 0], vary: 0.25 }));
  }
  return S.merge(parts);
}

// The walk's far leafy tree (the owner, 2026-11-19: "add some blobs to the far off trees, as cones
// only they are a bit stark"): the maze's cone tree, its crown roughened with a few of the maze's own
// leaf blobs (the bare tree's rag of leaf, G.ico detail 0, flattened a little), in the cone's leaf
// colour a shade either way, set half into the cone's flanks and over its tip so the crown reads as
// an irregular leafy mass. One geometry: the stem's vertices still come first (tunnelwood.js), and
// the blobs stay inside the plain cone's height and bulge only a little past its reach (a ragged
// edge), and the instance is sized from the plain cone, so it stands as tall and wide as its tree
// exactly as before (logic/treelod.js
// FAR_CONE_BLOBS: where they sit).
export function farConeTree() {
  const base = victorianTree(1, 0);
  const leaf = woodGreen(0x3f9a45, 0);
  const { y0, h, r: r0 } = FAR_CONE; // the cone (victorianTree kind 1)
  const parts = [base];
  FAR_CONE_BLOBS.forEach(([t, a, r, out], i) => {
    const y = y0 + h * t; const rc = r0 * (1 - t) * out;
    const shade = [0.92, 1.06, 0.98, 1.1, 0.95, 1.03, 1.0][i % 7];
    parts.push(part(G.ico(r, 0), leaf, { at: [Math.cos(a) * rc, Math.min(y, y0 + h - r * 0.7), Math.sin(a) * rc], scale: [1, 0.78, 1], vary: 0.25, seed: i }));
    const c = parts[parts.length - 1].attributes.color;
    for (let k = 0; k < c.count; k++) c.setXYZ(k, c.getX(k) * shade, c.getY(k) * shade, c.getZ(k) * shade);
  });
  return S.merge(parts);
}

// A tree one metre tall, gnarled and bare: a wandering trunk, forked limbs, a rag or two of leaf.
// opts.ragAt (the walk's far bare tree): where a rag sits along its limb, 0 at the fork to 1 at the
// limb's end (the maze's 1); below 1 it hangs a little under the limb, in the crown rather than
// off the tips, where (scaled to a walk tree's 15 m) it read as a nest floating in the sky.
export function hauntedTree(rnd, kind, opts = {}) {
  const ragAt = opts.ragAt ?? 1;
  const small = kind === 2;
  const parts = [];
  const bark = [0x9a968c, 0x8a857c, 0x7e796f][kind];
  const seg = small ? 3 : 5;
  let p = new THREE.Vector3();
  let r = small ? 0.075 : 0.062;
  const dir = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < seg; i++) {
    dir.x += (rnd() - 0.5) * 0.7;
    dir.z += (rnd() - 0.5) * 0.7;
    dir.y = 1;
    dir.normalize();
    const q = p.clone().addScaledVector(dir, 1 / seg);
    parts.push(part(limb(p, q, r, r * 0.74, 5), bark, { vary: 0.3, seed: i }));
    if (i >= (small ? 1 : 2)) {
      for (let b = 0; b < 2; b++) {
        const bd = new THREE.Vector3(rnd() - 0.5, 0.25 + rnd() * 0.5, rnd() - 0.5).normalize();
        const bl = 0.22 + rnd() * 0.22;
        const e = q.clone().addScaledVector(bd, bl);
        parts.push(part(limb(q, e, r * 0.5, r * 0.12, 3), bark, { vary: 0.3 }));
        const e2 = e.clone().addScaledVector(new THREE.Vector3(bd.x + (rnd() - 0.5), -0.2, bd.z + (rnd() - 0.5)).normalize(), bl * 0.55);
        if (!small) parts.push(part(limb(e, e2, r * 0.14, r * 0.03, 3), bark, { vary: 0.3 }));
        if (rnd() < 0.3) {
          const at = ragAt >= 1 ? e : q.clone().lerp(e, ragAt);
          parts.push(part(G.ico(0.085, 0), 0x7c8a5a, { at: [at.x, at.y - (ragAt >= 1 ? 0 : 0.03), at.z], scale: [1, 0.6, 1], vary: 0.3 }));
        }
      }
    }
    p = q;
    r *= 0.74;
  }
  return S.merge(parts);
}
