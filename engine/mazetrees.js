// The maze's simple trees (forest.js draws its walls with them; tunnelwood.js draws the walk's far
// trees with the same ones, so a far tree on the walk is the maze's own): one metre tall, scaled up
// per instance. Moved here unchanged from forest.js so both can share them.

import * as THREE from 'three';
import { G, part, limb } from './court.js';
import { woodGreen } from '../logic/courtlook.js';
import * as S from './sculpt.js';

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

// A tree one metre tall, gnarled and bare: a wandering trunk, forked limbs, a rag or two of leaf.
export function hauntedTree(rnd, kind) {
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
        if (rnd() < 0.3) parts.push(part(G.ico(0.085, 0), 0x7c8a5a, { at: [e.x, e.y, e.z], scale: [1, 0.6, 1], vary: 0.3 }));
      }
    }
    p = q;
    r *= 0.74;
  }
  return S.merge(parts);
}
