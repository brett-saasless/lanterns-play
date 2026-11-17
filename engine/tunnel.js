// The way between the wood and the road (issue #29, G29a, the owner: "a short tunnel of trees and
// brambles"). One builder for both ends, so they match: the wood's end runs into one (forest.js,
// on the approach, closed at the far end), the road's foot opens out of the other (roadview.js,
// closed behind the warden). Inside, the view is shut in: no castle, no sun, only a little sky
// through breaks in the roof (N3, the owner: the wood's sky in its tunnel, the road foot's in the
// road's), so the level can change under the castle's card with nothing to show the seam. In the
// mood of the road: wrong and too still, dark and close. Dead trunks crowding in from both sides
// and leaning over, limbs bent across the roof, brambles knotted through all of it, a shell of dark
// growth behind, and leaf-black litter on the floor. Drawing only: nothing here can hurt, and
// nothing is a rule (the court's thicket boxes and the road's rects hold the warden in it).
//
// Two draw calls: the growth (one merged mesh) and the shell.

import * as THREE from 'three';
import * as S from './sculpt.js';

/** The tunnel both ends share (DEFAULTS TAKEN, #29 G29a). Metres. */
export const TUNNEL = Object.freeze({ width: 4.2, height: 3.1, shell: 0.9 });

const BARK = 0x221d18;
const BRAMBLE = 0x2b1e18;
const SHELL = 0x0e0d0b;
const LITTER = 0x1a1612;
const _o = new THREE.Color();

/** A bent tube through `pts` (local [x, y, z] arrays), radius r, tinted hex. */
function strand(pts, r, hex, seed) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const g = new THREE.TubeGeometry(curve, Math.max(4, pts.length * 3), r, 3, false);
  g.deleteAttribute('uv');
  return S.tint(g, hex, 0.25, seed);
}

/**
 * buildTunnel({ length, seed, ground, openNear, openFar }) -> THREE.Group, in the tunnel's own
 * frame: its near mouth at z = 0, running back along -z for `length`, centred on x = 0, the floor
 * at ground(x, z) (local metres; the group is then placed and turned by the caller). openNear /
 * openFar: whether that end is a mouth (open) or shut by the growth. mouthHex: the colour of the ground
 * outside the near mouth (the court's earth, the road's dirt): the floor grades from it into the
 * tunnel's litter across the mouth (the owner: "make a color transition from the entrance floor
 * to the tunnel floor").
 */
export function buildTunnel({ length, seed = 1, ground = () => 0, openNear = true, openFar = false, mouthHex = null }) {
  const rnd = S.rng(seed);
  const W = TUNNEL.width / 2;
  const H = TUNNEL.height;
  const parts = [];
  const lean = (sd, y, k) => sd * (W + 0.35 - k * y); // a wall that crowds in as it rises

  // Dead trunks along both walls, close together, leaning in over the way.
  for (const sd of [-1, 1]) {
    for (let z = -0.3; z > -length - 0.4; z -= 0.75 + rnd() * 0.7) {
      const x = sd * (W + 0.25 + rnd() * 0.7);
      const h = 3.6 + rnd() * 2.6;
      const tilt = (0.22 + rnd() * 0.3) * -sd; // the top in toward the middle
      const g = new THREE.CylinderGeometry(0.06 + rnd() * 0.05, 0.14 + rnd() * 0.12, h, 6, 4).translate(0, h / 2, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { // crooked
        const t = p.getY(i) / h;
        p.setX(i, p.getX(i) + Math.sin(t * 4.1 + z) * 0.14 * t);
        p.setZ(i, p.getZ(i) + Math.cos(t * 3.3 + x) * 0.12 * t);
      }
      g.deleteAttribute('uv');
      g.rotateZ(tilt).rotateY((rnd() - 0.5) * 0.3).translate(x, ground(x, z) - 0.15, z);
      parts.push(S.tint(g, BARK, 0.3, seed + z));
    }
  }
  // Limbs bent over the roof from wall to wall, low enough to close it in.
  for (let z = -0.6; z > -length; z -= 0.9 + rnd() * 0.8) {
    const sd = rnd() < 0.5 ? -1 : 1;
    const dz = (rnd() - 0.5) * 1.4;
    const y0 = ground(sd * (W + 0.3), z);
    const y1 = ground(-sd * (W + 0.3), z + dz);
    const pts = [
      [sd * (W + 0.35), y0 + 1.2 + rnd(), z],
      [sd * (W * 0.55), y0 + H - 0.1 + rnd() * 0.3, z + dz * 0.3],
      [-sd * W * 0.2, Math.max(y0, y1) + H + 0.05 + rnd() * 0.3, z + dz * 0.6],
      [-sd * (W + 0.4), y1 + 1.6 + rnd() * 0.8, z + dz],
    ];
    parts.push(strand(pts, 0.04 + rnd() * 0.05, BARK, seed + 40 + z));
  }
  // Brambles knotted through the walls and the roof, thick at the shut end(s).
  const shut = (z) => (!openFar ? Math.max(0, 1 - (z + length) / 2.5) : 0) + (!openNear ? Math.max(0, 1 + z / 2.5) : 0);
  const n = Math.round(length * 14);
  for (let i = 0; i < n; i++) {
    const z0 = -rnd() * length;
    const a0 = Math.PI * (0.05 + rnd() * 0.9); // round the arch: 0 one wall foot, PI the other
    const pts = [];
    let a = a0; let z = z0;
    const r0 = 1.02 + rnd() * 0.25;
    for (let k = 0; k < 5; k++) {
      a += (rnd() - 0.5) * 0.7;
      z += (rnd() - 0.5) * 1.1;
      const zz = Math.max(-length - 0.2, Math.min(0.2, z));
      const rr = r0 + (rnd() - 0.5) * 0.25;
      const x = Math.cos(a) * W * rr;
      pts.push([x, ground(x, zz) + Math.sin(a) * H * rr * 0.95 + 0.1, zz]);
    }
    parts.push(strand(pts, 0.012 + rnd() * 0.016, BRAMBLE, seed + 90 + i));
  }
  // The shut end: a wall of brambles and dead wood across it.
  for (const [open, zEnd] of [[openFar, -length], [openNear, 0]]) {
    if (open) continue;
    for (let i = 0; i < 70; i++) {
      const x0 = (rnd() - 0.5) * 2.2 * W;
      const pts = [];
      for (let k = 0; k < 4; k++) {
        const x = x0 + (rnd() - 0.5) * 1.6;
        pts.push([x, ground(x, zEnd) + rnd() * H * 1.05, zEnd + (rnd() - 0.5) * 0.7]);
      }
      parts.push(strand(pts, 0.015 + rnd() * 0.03, rnd() < 0.3 ? BARK : BRAMBLE, seed + 300 + i));
    }
  }
  // Leaf-black litter on the floor, sitting on it. At an open near mouth with a mouthHex it runs
  // out 3 m past the mouth and grades from the ground outside into the litter over 4.5 m, so the
  // floor changes colour across the threshold instead of at a hard edge.
  {
    const grade = openNear && mouthHex != null;
    const z0 = grade ? 3 : openNear ? -0.5 : 0.3;
    const z1 = -length + (openFar ? 0.5 : -0.3);
    const nx = 9; const nz = Math.max(2, Math.ceil((z0 - z1) / 0.5) + 1);
    const pos = []; const col = []; const idx = [];
    const c = new THREE.Color(); const out = new THREE.Color(grade ? mouthHex : LITTER);
    for (let j = 0; j < nz; j++) {
      const z = z0 - (z0 - z1) * (j / (nz - 1));
      for (let i = 0; i < nx; i++) {
        const x = (W + 0.7) * (2 * (i / (nx - 1)) - 1); // out under the walls' feet
        pos.push(x, ground(x, z) + 0.06, z);
        const n = 0.8 + 0.4 * S.noise(x * 1.7, 0, z * 1.7, seed);
        c.setHex(LITTER).multiplyScalar(n);
        if (grade) {
          // outside the mouth the ground's own colour, shading into the litter by 1.5 m inside;
          // past the walls' line the outside colour holds, so the strip's sides do not show
          const k = Math.max(Math.min(1, Math.max(0, (z + 1.5) / 4.5)), z > -0.5 ? Math.min(1, Math.max(0, (Math.abs(x) - W + 0.2) / 0.9)) : 0);
          c.lerp(_o.copy(out).multiplyScalar(0.9 + 0.2 * n), k * k * (3 - 2 * k));
        }
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i; const b = a + 1; const cc = a + nx; const d = cc + 1;
        idx.push(a, b, cc, b, d, cc);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  }
  const growth = new THREE.Mesh(S.merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  growth.name = 'tunnel:growth';

  // The shell: a lumpy half-tube of dark growth just outside the walls and the roof, a ragged
  // lip at each mouth: only a little sky shows from inside, through the breaks in its roof (N3).
  const shell = (() => {
    const na = 14; const nzs = Math.max(2, Math.ceil(length / 0.6) + 1);
    const pos = []; const col = []; const idx = [];
    const c = new THREE.Color();
    for (let j = 0; j < nzs; j++) {
      const t = j / (nzs - 1);
      for (let i = 0; i <= na; i++) {
        const a = Math.PI * (i / na);
        const lip = (j === 0 && openNear) || (j === nzs - 1 && openFar) ? 0.5 * S.noise(i * 0.7, 3, j, seed) : 0;
        const z = -t * length + (j === 0 ? 0.15 + lip : 0) - (j === nzs - 1 ? 0.15 - lip : 0);
        const bump = 1 + 0.12 * S.noise(i * 0.9, j * 0.7, 1, seed + 5);
        const x = Math.cos(a) * (W + TUNNEL.shell) * bump;
        pos.push(x, ground(x, z) - 0.3 + Math.sin(a) * (H + TUNNEL.shell * 0.7) * bump, z);
        c.setHex(SHELL).multiplyScalar(0.8 + 0.3 * S.noise(i, j, 2, seed));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < nzs - 1; j++) {
      for (let i = 0; i < na; i++) {
        // #29 (N3, the owner): the roof broken here and there, so a little sky shows through the
        // brambles: the wood's sky in its tunnel, the road's in the road's (each in its own scene)
        const roof = i >= 4 && i < na - 4 && j > 1 && j < nzs - 3;
        if (roof && S.noise(i * 0.8, 7, j * 0.9, seed + 11) > 0.25) continue;
        const a = j * (na + 1) + i; const b = a + 1; const cc = a + na + 1; const d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    }
    // the shut end(s): a cap of the same
    for (const [open, j] of [[openFar, nzs - 1], [openNear, 0]]) {
      if (open) continue;
      const z = j === 0 ? 0.3 : -length - 0.3;
      const base = pos.length / 3;
      pos.push(0, ground(0, z) - 0.3, z);
      col.push(0.03, 0.028, 0.024);
      for (let i = 0; i <= na; i++) {
        const k = (j * (na + 1) + i) * 3;
        pos.push(pos[k], pos[k + 1], z);
        col.push(col[k], col[k + 1], col[k + 2]);
      }
      for (let i = 0; i < na; i++) idx.push(base, base + 1 + i, base + 2 + i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
    m.name = 'tunnel:shell';
    return m;
  })();

  const group = new THREE.Group();
  group.name = 'tunnel';
  for (const m of [growth, shell]) { m.castShadow = false; m.receiveShadow = false; group.add(m); }
  return group;
}
