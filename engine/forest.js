// The forest maze and the castle approach, drawn from MAZE (logic/courtmap.js): walls of
// instanced bushes, boulders and small trees filling the collision boxes, tall trees at the wall
// junctions and in a belt outside, ground that goes from raked gravel and flower borders to dead
// leaves and branches, the stream, the puddles, drizzle, the gates' frames and each glade's
// furniture. One zone per band plus the approach; the occupied zone and its neighbours are drawn.
// Polish: the border flowers are petalled heads nodding on a stem (the kit's flower); fallen
// branches fork (the kit's branch; nothing lies as a straight pointed stick); white rose petals
// lead to each gate and sparser pale toadstools to the hidden health pads and salt caches, from
// courtmap.js trailMarks(), two instanced meshes per zone; the stream's water is water.js and
// only its dark bed is drawn here.
// The light that greys with depth is the daylight rig in court.js, which this file shares.

import * as THREE from 'three';
import { makeRng } from '../logic/rng.js';
import { weatherNow } from '../logic/weather.js';
import { MAZE, mazeBoxes, deadEnds, stageAt, corridor, routeOf, trailMarks } from '../logic/courtmap.js';
import * as S from './sculpt.js';
import { createTunnelWood, deviceTier } from './tunnelwood.js'; // the walk to the road: its first stretch, seen through the last gate
import { daylight, mats, G, part, limb, bake, instanced, matrixOf, greyAt, PAL, TITLE_LOOP, gateKit } from './court.js';
import { woodGreen, pathTone, floorTone, leafTone, LEAF_TONES } from '../logic/courtlook.js';

const _sky = { rain: 1, cloud: 1, sun: 0 }; // #28: scratch, so the frame allocates nothing

const RAIN = 1500; // drops (the frame budget's cap)
const DRIFT = 36; // leaves in the air
const RINGS = 16; // rain rings on standing water
const WOOD_SEED = 0x2026;
const GROUND_HALF = 40;
const FAR_Z = -204;

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const _c = new THREE.Color();
const _c2 = new THREE.Color();

const inBox = (b, x, z, pad = 0) => x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;

/** How wet the air is at z: 0 until the fourth band is under way, 1 by its glade. */
export const wetAt = (z) => clamp((-140 - z) / 20);

/**
 * The colour of the wood's ground at (x, z) into `out`: the trodden path (always the lightest
 * ground in view) or the darker floor under the walls and beyond them.
 */
export function groundTone(x, z, walled, out = new THREE.Color()) {
  const d = greyAt(z);
  out.setHex(walled ? floorTone(d) : pathTone(d)); // C6, C7: logic/courtlook.js
  const n = 1 + 0.07 * S.noise(x * 0.7, 0, z * 0.7, 3) + 0.04 * S.noise(x * 2.3, 1, z * 2.3, 5);
  return out.multiplyScalar(n);
}

// C6: a tiling grit-and-earth detail map multiplied over the ground's vertex colour, so no stretch
// of path reads as a flat plane (luma sd 4 or more at play distance). Grey, about 0.93 on average.
let GRIT = null;
function gritTexture() {
  if (GRIT) return GRIT;
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  const r = makeRng(0x6a17);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // Tiling noise: sample a torus so the edges meet.
      const a = (x / n) * Math.PI * 2; const b = (y / n) * Math.PI * 2;
      const f = (k, s) => S.noise(Math.cos(a) * k, Math.sin(a) * k + Math.cos(b) * k, Math.sin(b) * k, s);
      const v = 0.93 + 0.05 * f(1.2, 1) + 0.035 * f(3.1, 2) + 0.025 * f(7.3, 3) + 0.03 * (r() - 0.5);
      const i = (y * n + x) * 4;
      const k = Math.round(255 * Math.max(0.78, Math.min(1, v)));
      img.data[i] = k; img.data[i + 1] = k; img.data[i + 2] = Math.round(k * 0.985); img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Grit: small pale stones and dark crumbs.
  for (let i = 0; i < 900; i++) {
    const dark = r() < 0.55;
    g.fillStyle = dark ? `rgba(120,112,100,${0.25 + r() * 0.35})` : `rgba(255,252,244,${0.2 + r() * 0.3})`;
    g.beginPath();
    g.ellipse(r() * n, r() * n, 0.6 + r() * 1.6, 0.5 + r() * 1.1, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  GRIT = new THREE.CanvasTexture(c);
  GRIT.wrapS = GRIT.wrapT = THREE.RepeatWrapping;
  GRIT.colorSpace = THREE.SRGBColorSpace;
  GRIT.anisotropy = 8;
  return GRIT;
}

// A tree one metre tall, clipped and Victorian: a stem and a ball, a cone, or two balls.
// `d` is the zone's greying (C7): its leaves grey with the light, as the sky does.
function victorianTree(kind, d = 0) {
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
function hauntedTree(rnd, kind) {
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

export function buildForest(scene, cfg) {
  const rig = daylight(scene, cfg);
  const M = mats();
  const rng = makeRng(WOOD_SEED);
  const rr = (a, b) => a + rng() * (b - a);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const group = new THREE.Group();
  group.name = 'wood';
  rig.root.add(group);

  const boxes = mazeBoxes();
  // The strip of wall behind the Hatter's stand, rail and card: kept clear of loose bushes and
  // boulders (they would bury the hats) and faced with one clipped hedge instead.
  const HT = MAZE.hatter;
  const DISPLAY = {
    minX: Math.min(HT.stand.minX, ...HT.pegs.map((q) => q.x)) - 1.3, maxX: Math.max(HT.stand.maxX, ...HT.pegs.map((q) => q.x)) + 1.3,
    minZ: HT.stand.minZ - 1.9, maxZ: HT.stand.maxZ + 0.2,
  };
  const walled = (x, z, pad = 0) => boxes.some((b) => inBox(b, x, z, pad));

  // ---- shared geometry ---------------------------------------------------------------------
  const white = 0xffffff;
  const geo = {
    // The clipped hedge block and the Victorian trees are built once per zone, their green greyed
    // to the zone's depth (C7: the objects grey with the light, not just the sky).
    clip: (d) => part(G.box(1.3, 1.6, 1.3, 2, 2, 2), woodGreen(0x3d9444, d), { at: [0, 0.8, 0], lump: 0.09, vary: 0.3, freq: 1.6 }),
    wild: (d) => part(G.ball(1, 6, 4), woodGreen(0x66755a, d), { at: [0, 0.7, 0], lump: 0.22, vary: 0.35, freq: 1.7 }),
    rock: part(G.ico(1, 0), 0xb4b1a8, { at: [0, 0.45, 0], scale: [1, 0.72, 1], lump: 0.2, vary: 0.25, freq: 1.5, seed: 4 }),
    vict: (d) => [0, 1, 2].map((k) => victorianTree(k, d)),
    haunt: [0, 1, 2].map((k) => hauntedTree(rng, k)),
    // A border flower: the rose's petals, smaller, hanging its head on a bent stem. White, so
    // the instance colour is the flower's own (it darkens the stem, which reads as a stem).
    flower: S.merge([
      part(limb([0, 0, 0], [0, 0.13, -0.012], 0.006, 0.005, 4), 0x9fd08a, { vary: 0.2 }),
      part(limb([0, 0.13, -0.012], [0, 0.2, -0.05], 0.005, 0.004, 4), 0x9fd08a, { vary: 0.2 }),
      part(S.flower({ size: 0.075, open: 0.8, petals: 6, color: white, calyx: 0x9fd08a, inner: false, detail: 1, droop: 0.95, seed: 5 }), null, { at: [0, 0.2, -0.05] }),
    ]),
    leaf: S.fallenLeaf({ seed: 3 }), // C7: a lobed, curled dead leaf, not a flat card
    // A fallen branch that forks three times (the kit's): never a straight pointed stick.
    twig: S.branch({ length: 1.25, forks: 3, r: 0.032, color: 0x8a7a66, color2: 0x4e4438, lift: 0.3, seed: 4 }),
    // One fallen rose petal, cupped, lying on the ground; and one pale toadstool.
    petal: (() => {
      // A rose petal's outline: narrow at the base, broad and notched at the tip.
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.bezierCurveTo(0.05, 0.012, 0.062, 0.085, 0.022, 0.105);
      sh.quadraticCurveTo(0, 0.09, -0.022, 0.105);
      sh.bezierCurveTo(-0.062, 0.085, -0.05, 0.012, 0, 0);
      const g = new THREE.ShapeGeometry(sh, 5).rotateX(-Math.PI / 2).translate(0, 0, 0.05);
      const q = g.attributes.position;
      for (let i = 0; i < q.count; i++) q.setY(i, 0.01 + 5 * (q.getX(i) ** 2) + 2.5 * (q.getZ(i) ** 2)); // cupped: the rim lifts
      g.computeVertexNormals();
      return S.tint(g, PAL.roseWhite, 0.08, 2);
    })(),
    toad: S.toadstool({ height: 0.2, cap: 0.105, color: 0xd9d2be, stem: 0x8d8a82, seed: 3 }),
  };

  // ---- zones: bands 1 to 4 and the approach -------------------------------------------------
  const zoneZ = (k) => (k < 5 ? [MAZE.z0 - MAZE.cell * (MAZE.bands[k - 1].rows[1] + 1), MAZE.z0 - MAZE.cell * MAZE.bands[k - 1].rows[0]] : [FAR_Z, MAZE.z0 - MAZE.cell * 19]);
  const zones = [null];
  for (let k = 1; k <= 5; k++) {
    const g = new THREE.Group();
    g.visible = false;
    group.add(g);
    const [minZ, maxZ] = zoneZ(k);
    zones.push({
      index: k, group: g, minZ, maxZ,
      clip: [], wild: [], rock: [], vict: [[], [], []], haunt: [[], [], []], flower: [], leaf: [], twig: [], petal: [], toad: [],
      solid: [], flat: [], glow: [], water: [], decal: [], metal: [], lanterns: [],
    });
  }
  const zoneOf = (z) => zones[clamp(z > MAZE.z0 ? 1 : stageAt(0, z), 1, 5)];

  // ---- ground: one vertex-coloured sheet per zone, dipped for the stream and the pit ----------
  const columns = (step) => {
    const out = [-GROUND_HALF, -36, -32];
    for (let x = -30; x <= 30; x += step) out.push(x);
    out.push(32, 36, GROUND_HALF);
    return out;
  };
  const st = MAZE.stream;
  const pit = MAZE.pit;
  const groundY = (x, z) => {
    let y = 0;
    const sd = Math.min(z - st.minZ, st.maxZ - z);
    if (sd > 0) y -= 0.12 * clamp(sd / 0.5);
    const pd = Math.hypot(x - pit.x, z - pit.z);
    if (pd < pit.r) y -= pd <= pit.r / 2 ? pit.depth : pit.depth * (pit.r - pd) / (pit.r / 2);
    return y;
  };
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, map: gritTexture() });
  for (const zn of zones.slice(1)) {
    const near = boxes.filter((b) => b.maxZ > zn.minZ - 1 && b.minZ < zn.maxZ + 1);
    // A metre grid; half a metre in the zone that holds the pit, so its bowl is round.
    const step = pit.z > zn.minZ && pit.z < zn.maxZ ? 0.5 : 1;
    const xs = columns(step);
    const rows = Math.round((zn.maxZ - zn.minZ) / step) + 1;
    const pos = new Float32Array(xs.length * rows * 3);
    const col = new Float32Array(xs.length * rows * 3);
    const uv = new Float32Array(xs.length * rows * 2);
    const idx = [];
    for (let j = 0; j < rows; j++) {
      const z = zn.maxZ - j * step;
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        const o = (j * xs.length + i) * 3;
        pos[o] = x; pos[o + 1] = groundY(x, z); pos[o + 2] = z;
        uv[(j * xs.length + i) * 2] = x / 2.4; uv[(j * xs.length + i) * 2 + 1] = z / 2.4; // one tile of grit every 2.4 m
        const wall = Math.abs(x) > 28 || near.some((b) => inBox(b, x, z, 0.1));
        groundTone(x, z, wall, _c);
        if (pos[o + 1] < -0.2) _c.multiplyScalar(0.55); // the pit's sides are bare earth
        col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b;
        if (i < xs.length - 1 && j < rows - 1) {
          const a = j * xs.length + i;
          idx.push(a, a + 1, a + xs.length, a + 1, a + xs.length + 1, a + xs.length);
        }
      }
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    gg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    gg.setIndex(idx);
    gg.computeVertexNormals();
    const mesh = new THREE.Mesh(gg, groundMat);
    mesh.receiveShadow = true;
    zn.group.add(mesh);
  }

  // ---- walls: every collision box filled with bushes, boulders and small trees ---------------
  const tint = (hex, lo = 0.8, hi = 1.12) => new THREE.Color(hex).multiplyScalar(rr(lo, hi));
  const treeTint = (d, dying) => {
    const c = new THREE.Color(1, 1, 1).lerp(_c2.setRGB(0.72, 0.76, 0.66), d * 0.8).multiplyScalar(rr(0.82, 1.12));
    return dying ? c.multiply(_c2.setRGB(1.25, 0.95, 0.5)) : c;
  };
  const hauntedChance = (d) => 0.07 + 0.86 * d; // a few grey trees at the start, the odd Victorian one at the end
  function tree(zn, x, z, h, d) {
    const ry = rr(0, 6.283);
    if (rng() < hauntedChance(d)) {
      const k = h < 6 ? (rng() < 0.6 ? 2 : Math.floor(rng() * 2)) : Math.floor(rng() * 2);
      zn.haunt[k].push({ m: matrixOf([x, -0.05, z], [0, ry, 0], [h * rr(0.9, 1.2), h, h * rr(0.9, 1.2)]), c: tint(white, 0.85, 1.15) });
    } else {
      zn.vict[Math.floor(rng() * 3)].push({ m: matrixOf([x, 0, z], [0, ry, 0], [h * rr(0.9, 1.1), h, h * rr(0.9, 1.1)]), c: treeTint(d, rng() < 0.06) });
    }
  }
  boxes.forEach((b, bi) => {
    const nx = Math.max(1, Math.round((b.w - 0.9) / 1.15) + 1);
    const nz = Math.max(1, Math.round((b.d - 0.9) / 1.15) + 1);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = (nx === 1 ? b.x : b.minX + 0.45 + ((b.w - 0.9) * i) / (nx - 1)) + rr(-0.22, 0.22);
        const z = (nz === 1 ? b.z : b.minZ + 0.45 + ((b.d - 0.9) * j) / (nz - 1)) + rr(-0.22, 0.22);
        if (z > MAZE.z0 - 0.4) continue; // the court's own hedge stands here
        if (inBox(DISPLAY, x, z)) continue; // a clipped hedge stands behind the Hatter's display
        let dup = false;
        for (let q = 0; q < bi && !dup; q++) dup = inBox(boxes[q], x, z, -0.25);
        if (dup) continue;
        const zn = zoneOf(z);
        const d = greyAt(z);
        const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
        const roll = rng();
        const trees = (edge ? 0.14 : 0.3) + 0.16 * d; // denser with depth
        if (roll < trees) {
          tree(zn, x, z, rr(3.2, 4.8), d);
          if (rng() < 0.5) zn.wild.push({ m: matrixOf([x + rr(-0.3, 0.3), 0, z + rr(-0.3, 0.3)], [0, rr(0, 6), 0], [rr(0.6, 0.8), rr(0.7, 1), rr(0.6, 0.8)]), c: tint(0xffffff).lerp(_c2.setHex(0x9aa890), 1 - d) });
        } else if (!edge && rng() < 0.4) {
          // the middle of a thick wall is hidden by its edges: leave some of it empty
        } else if (roll < trees + 0.24) {
          const s = rr(0.7, 1.25);
          zn.rock.push({ m: matrixOf([x, 0, z], [rr(-0.2, 0.2), rr(0, 6), rr(-0.2, 0.2)], [s, s * rr(0.8, 1.3), s]), c: tint(white, 0.75, 1.1).lerp(_c2.setHex(0x9c9a94), d * 0.5) });
        } else if (rng() > d * 1.1) {
          const dying = rng() < 1 / 7;
          zn.clip.push({ m: matrixOf([x, 0, z], [0, b.w >= b.d ? 0 : Math.PI / 2, 0], [1, rr(0.95, 1.15), 1]), c: dying ? new THREE.Color(1.9, 1.25, 0.9) : tint(white, 0.85, 1.15) });
        } else {
          const s = rr(0.85, 1.2);
          zn.wild.push({ m: matrixOf([x, 0, z], [rr(-0.2, 0.2), rr(0, 6), rr(-0.2, 0.2)], [s, s * rr(1.05, 1.5), s]), c: tint(white, 0.8, 1.15) });
        }
      }
    }
  });

  // Tall trees: at the wall junctions inside the maze and in a deep belt outside, denser with depth.
  for (let c = 0; c <= MAZE.cols; c++) {
    for (let r = 0; r <= MAZE.rows; r++) {
      const x = MAZE.x0 + c * MAZE.cell;
      const z = MAZE.z0 - r * MAZE.cell;
      const d = greyAt(z);
      if (rng() > 0.22 + 0.68 * d) continue;
      if (!walled(x, z, -0.4) || z > MAZE.z0 - 1) continue; // only where a wall stands to hold it
      if (Math.abs(x) < 6 && r < 4) continue; // the long view from the arch to the castle
      tree(zoneOf(z), x + rr(-0.4, 0.4), z + rr(-0.4, 0.4), rr(9, 17), d);
    }
  }
  for (let i = 0; i < 300; i++) {
    const z = MAZE.z0 - 2 - rng() * 176;
    const d = greyAt(z);
    if (rng() > 0.3 + 0.7 * d) continue;
    const x = (rng() < 0.5 ? -1 : 1) * (31.5 + rng() * rng() * 34);
    tree(zoneOf(z), x, z, rr(10, 19), d);
  }

  // ---- ground cover: flower borders, then dead leaves and fallen branches ---------------------
  const FLOWERS = [0xff6f91, 0xffd166, 0xf8f4e3, 0xb388eb, 0xff9f1c];
  for (const b of boxes) {
    if (b.maxZ > MAZE.z0 - 0.5 || greyAt(b.z) > 0.9) continue;
    const per = 2 * (b.w + b.d) + 2.4;
    for (let s = 0; s < per; s += 0.6) {
      // Walk the box's outline 0.3 m outside it.
      let x; let z;
      const w = b.w + 0.6;
      const dd = b.d + 0.6;
      if (s < w) { x = b.minX - 0.3 + s; z = b.minZ - 0.3; } else if (s < w + dd) { x = b.maxX + 0.3; z = b.minZ - 0.3 + (s - w); } else if (s < 2 * w + dd) { x = b.maxX + 0.3 - (s - w - dd); z = b.maxZ + 0.3; } else { x = b.minX - 0.3; z = b.maxZ + 0.3 - (s - 2 * w - dd); }
      const d = greyAt(z);
      if (rng() < d * 1.6 + 0.1 || Math.abs(x) > 28 || z > MAZE.z0 - 0.3 || z < FAR_Z || walled(x, z)) continue;
      zoneOf(z).flower.push({ m: matrixOf([x + rr(-0.12, 0.12), 0, z + rr(-0.12, 0.12)], [0, rr(0, 6.283), 0], rr(0.9, 1.7)), c: new THREE.Color(pick(FLOWERS)) });
    }
  }
  for (const zn of zones.slice(1)) {
    const d = greyAt((zn.minZ + zn.maxZ) / 2);
    const area = (zn.maxZ - zn.minZ) / 40;
    for (let i = 0; i < 1500 * d * area + 60; i++) {
      const x = rr(-29, 29);
      const z = rr(zn.minZ, zn.maxZ);
      if (rng() > greyAt(z) * 1.3 + 0.03 || (walled(x, z) && rng() < 0.75)) continue;
      if (Math.hypot(x - pit.x, z - pit.z) < pit.r + 0.4) continue; // the mat over the pit is props.js
      zn.leaf.push({ m: matrixOf([x, 0.02 + rng() * 0.02, z], [rr(-0.3, 0.3), rr(0, 6), rr(-0.3, 0.3)], rr(0.8, 1.6)), c: new THREE.Color(leafTone(pick(LEAF_TONES), greyAt(z))).multiplyScalar(rr(0.8, 1.2)) });
    }
    // Litter blown into drifts against the walls' feet, from the first band on (C6: band 1's path
    // has the later bands' litter too), on its own generator so the wood's scatter is as it was.
    const lr = makeRng(0x1eaf + zn.index * 101);
    const drifts = Math.round((zn.index === 1 ? 70 : 30 + 40 * d) * area);
    for (let k = 0; k < drifts; k++) {
      const cx = -26 + lr() * 52;
      const cz = zn.minZ + lr() * (zn.maxZ - zn.minZ);
      if (walled(cx, cz) || !walled(cx, cz, 1.2) || cz > MAZE.z0 - 0.5) continue; // just off a wall's foot
      const n = 5 + Math.floor(lr() * 10);
      for (let i = 0; i < n; i++) {
        const a = lr() * 6.283; const r = 0.7 * Math.sqrt(lr());
        const x = cx + Math.cos(a) * r; const z = cz + Math.sin(a) * r;
        if (Math.hypot(x - pit.x, z - pit.z) < pit.r + 0.4) continue;
        zn.leaf.push({ m: matrixOf([x, 0.004 + i * 0.0015, z], [(lr() - 0.5) * 0.4, lr() * 6.283, (lr() - 0.5) * 0.4], 0.7 + lr() * 0.6), c: new THREE.Color(leafTone(LEAF_TONES[Math.floor(lr() * LEAF_TONES.length)], greyAt(z))).multiplyScalar(0.8 + lr() * 0.35) });
      }
    }
    for (let i = 0; i < 90 * d * area; i++) {
      const x = rr(-28, 28);
      const z = rr(zn.minZ, zn.maxZ);
      if (walled(x, z, 0.2) || Math.hypot(x - pit.x, z - pit.z) < pit.r + 1) continue;
      const sz = rr(0.6, 1.5);
      zn.twig.push({ m: matrixOf([x, 0, z], [0, rr(0, 6.283), 0], [sz, sz * rr(0.9, 1.3), sz]), c: tint(white, 0.7, 1.1) });
    }
  }

  // ---- the trails (R14): white rose petals in loose clusters along each band's way to its gate,
  // and pale toadstools, fewer and lower, off that way to a health pad or a salt cache. The
  // places are data (courtmap.js trailMarks); only the scatter inside a cluster is drawn here.
  {
    const marks = trailMarks();
    for (const trail of marks.petals) {
      const zn = zones[trail.band];
      for (const mk of trail.marks) {
        const r = makeRng(0x9e37 + mk.seed * 31);
        for (let i = 0; i < mk.n; i++) {
          // Loose, never in a line: each petal at its own bearing and distance from the mark.
          const a = (i / mk.n) * 6.283 + r() * 2.2;
          const d = 0.08 + r() * 0.34;
          const s = 0.85 + r() * 0.6;
          zn.petal.push({ m: matrixOf([mk.x + Math.cos(a) * d, 0.012 + r() * 0.01, mk.z + Math.sin(a) * d], [(r() - 0.5) * 0.3, r() * 6.283, (r() - 0.5) * 0.3], s), c: new THREE.Color(1, 1, 1).multiplyScalar(0.9 + r() * 0.14) });
        }
      }
    }
    for (const trail of marks.toadstools) {
      const zn = zones[trail.band];
      for (const mk of trail.marks) {
        const r = makeRng(0x51ed + mk.seed * 17);
        for (let i = 0; i < mk.n; i++) {
          const a = r() * 6.283;
          const d = i === 0 ? r() * 0.12 : 0.1 + r() * 0.1;
          const s = (i === 0 ? 1 : 0.65) * (0.85 + r() * 0.4);
          zn.toad.push({ m: matrixOf([mk.x + Math.cos(a) * d, 0, mk.z + Math.sin(a) * d], [0, r() * 6.283, 0], s), c: new THREE.Color(1, 1, 1).multiplyScalar(1.02 + r() * 0.14) });
        }
      }
    }
  }

  // ---- water: the stream across band 4, the approach's puddles --------------------------------
  // The stream's surface is water.js; here only its dark bed, under that surface.
  zoneOf(st.minZ).flat.push(part(G.plane(GROUND_HALF * 2, st.maxZ - st.minZ - 0.5, 16, 1), 0x2f4f4a, { at: [0, -0.1, (st.minZ + st.maxZ) / 2], vary: 0.25, freq: 0.6 }));
  const puddles = cfg.surfaces.zones.filter((q) => q.shape === 'ellipse' && q.material === 'puddle');
  for (const q of puddles) zoneOf(q.z).decal.push({ wet: part(G.disc(1, 22), 0x55626c, { at: [q.x, 0.014, q.z], scale: [q.rx, 1, q.rz], vary: 0.1, freq: 0.6 }) });

  // ---- gates: stone posts and a lintel across the way, a lantern at each ----------------------
  MAZE.glades.forEach((gl, b) => {
    const zn = zones[b + 1];
    const { x, z } = gl.gate;
    // Stone posts and a lintel, a crest that grows more of a bat the deeper the gate, the lantern
    // on a bracket inside the left post (court.js gateKit: the walk to the road stands a copy too).
    const kit = gateKit(b, x, z, corridor(MAZE.bands[b].rows[1]) / 2 + 0.35);
    zn.solid.push(...kit.solid);
    zn.metal.push(...kit.metal);
    zn.glow.push(...kit.glow);
    zn.lanterns.push(kit.lantern);
  });

  // ---- glades and dead ends --------------------------------------------------------------------
  {
    // The Rabbit's long table, laid. (His chair, the bowl and the menu card are not drawn here.)
    const t = MAZE.rabbit.table;
    const zn = zones[1];
    zn.solid.push(part(G.box(t.w - 0.2, 0.08, t.d - 0.2), PAL.wood, { at: [t.x, t.h - 0.06, t.z] }));
    zn.solid.push(part(G.box(t.w, 0.03, t.d, 10, 1, 3), 0xf4efe2, { at: [t.x, t.h, t.z], vary: 0.06 }));
    for (const s of [-1, 1]) zn.solid.push(part(G.box(t.w, 0.34, 0.02, 12, 1, 1), 0xf4efe2, { at: [t.x, t.h - 0.17, t.z + s * (t.d / 2)], vary: 0.08, lump: 0.02, freq: 3 }));
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) zn.solid.push(part(G.cyl(0.05, 0.04, t.h - 0.1, 6), PAL.wood, { at: [t.x + dx * (t.w / 2 - 0.25), (t.h - 0.1) / 2, t.z + dz * (t.d / 2 - 0.2)] }));
    for (let i = 0; i < 4; i++) {
      const px = t.minX + 0.9 + i * 1.05;
      zn.solid.push(part(G.cyl(0.16, 0.1, 0.02, 12), 0xfdfdf8, { at: [px, t.h + 0.03, t.z + (i % 2 ? 0.3 : -0.3)], vary: 0 }));
      if (i % 2) zn.solid.push(part(G.cyl(0.05, 0.035, 0.09, 8), 0xfdfdf8, { at: [px + 0.3, t.h + 0.06, t.z - 0.2], vary: 0 }));
    }
    zn.metal.push(part(G.cyl(0.03, 0.07, 0.3, 6), PAL.gold, { at: [t.x - 0.4, t.h + 0.16, t.z] }));
  }
  MAZE.hatter.cover.forEach((b, i) => {
    const zn = zones[2];
    if (b.kind === 'hatblock') {
      zn.solid.push(part(G.box(b.w, 0.5, b.d), PAL.crate, { at: [b.x, 0.25, b.z], vary: 0.3, seed: i }));
      zn.solid.push(part(G.cyl(0.2, 0.26, 0.4, 8), PAL.wood, { at: [b.x, 0.7, b.z] }));
      zn.solid.push(part(G.cyl(0.34, 0.3, 0.52, 12), 0xb89868, { at: [b.x, 1.16, b.z], vary: 0.2 })); // the block a hat is shaped on
      zn.solid.push(part(G.cyl(0.56, 0.56, 0.04, 14), 0xb89868, { at: [b.x, 0.92, b.z], vary: 0.2 }));
    } else if (b.kind === 'table') {
      zn.solid.push(part(G.box(b.w, b.h, 0.1), PAL.wood, { at: [b.x, b.h / 2, b.z + b.d / 2 - 0.1], rot: [0.08, 0, 0], vary: 0.3 })); // toppled, top toward the path
      for (const s of [-1, 1]) zn.solid.push(part(G.box(0.09, 0.09, b.d - 0.1), PAL.wood, { at: [b.x + s * (b.w / 2 - 0.12), b.h - 0.2, b.z], vary: 0.3 }));
      for (const s of [-1, 1]) zn.solid.push(part(G.box(0.09, 0.09, b.d - 0.1), PAL.wood, { at: [b.x + s * (b.w / 2 - 0.12), 0.2, b.z], vary: 0.3 }));
    } else {
      zn.solid.push(part(G.cyl(b.w / 2 - 0.06, b.w / 2 + 0.08, b.h, 10), 0x7e7468, { at: [b.x, b.h / 2, b.z], lump: 0.07, vary: 0.35, seed: i, freq: 2 }));
      zn.flat.push(part(G.disc(b.w / 2 - 0.1, 10), 0xb9a988, { at: [b.x, b.h + 0.005, b.z], vary: 0.2 }));
    }
  });
  for (const l of MAZE.bat.lanterns) {
    // An iron crook for each lantern's chain.
    const zn = zones[3];
    const px = l.x + (l.x < MAZE.bat.home.x ? -1 : 1) * 0.9;
    const top = l.chainY + 0.1;
    zn.metal.push(part(limb([px, 0, l.z], [px, top - 0.4, l.z], 0.06, 0.045, 5), 0x2b2326, { vary: 0.2 }));
    zn.metal.push(part(limb([px, top - 0.4, l.z], [(px + l.x) / 2, top + 0.1, l.z], 0.045, 0.035, 5), 0x2b2326, { vary: 0.2 }));
    zn.metal.push(part(limb([(px + l.x) / 2, top + 0.1, l.z], [l.x, top - 0.08, l.z], 0.035, 0.02, 5), 0x2b2326, { vary: 0.2 }));
  }
  {
    // The clipped hedge behind the Hatter's display (props.js draws the stand, rail, card and hats).
    // It ends where the wall it fronts ends, at the near edge of the Hatter's gate opening.
    const gate = MAZE.glades[1].gate;
    const endX = Math.min(DISPLAY.maxX, gate.x - corridor(MAZE.bands[1].rows[1]) / 2);
    const w = endX - DISPLAY.minX;
    const n = Math.round(w / 2);
    for (let i = 0; i < n; i++) {
      const h = rr(2.9, 3.3);
      zones[2].solid.push(part(G.box(w / n + (i < n - 1 ? 0.06 : 0), h, 1.5, 2, 2, 2), woodGreen(0x3d9444, greyAt(HT.stand.minZ)), { at: [DISPLAY.minX + (i + 0.5) * (w / n), h / 2, HT.stand.minZ - 0.95], vary: 0.3, lump: i < n - 1 ? 0.1 : 0.04, seed: i, freq: 0.9 }));
    }
  }
  // The Caterpillar's toadstool is drawn with the creature (beasts.js), as is the Rabbit's chair.
  let shaft = null;
  for (const de of deadEnds()) {
    const zn = zones[de.band];
    if (de.holds === 'stakes' && de.band === 1) {
      zn.solid.push(part(G.cyl(0.42, 0.56, 0.55, 10), 0x7a6248, { at: [de.x, 0.27, de.z], lump: 0.05, vary: 0.35, freq: 2.5 }));
      zn.flat.push(part(G.disc(0.4, 10), 0xc9b48a, { at: [de.x, 0.552, de.z], vary: 0.25 }));
    } else if (de.holds === 'stakes') {
      zn.solid.push(part(G.cyl(0.24, 0.3, 2.2, 8), 0x7e796f, { at: [de.x - de.exit.z * 0.2, 0.24, de.z - 0.5], rot: [0, 0.3, Math.PI / 2], lump: 0.04, vary: 0.35, freq: 2.5 }));
    } else if (de.holds === 'cup') {
      zn.solid.push(part(G.ico(0.55, 1), 0xa8a59e, { at: [de.x, 0.02, de.z], scale: [1, 0.5, 0.85], lump: 0.1, vary: 0.25 })); // a stone in the stream
      zn.solid.push(part(G.cyl(0.24, 0.3, 0.1, 9), 0xa8a59e, { at: [de.x, 0.282, de.z], vary: 0.25, seed: 3 })); // its flat top, where the cup and the note lie
    } else if (de.holds === 'pit') {
      // Brambles in the bottom of the pit, under the leaf mat until it gives way.
      const br = [];
      for (let i = 0; i < 22; i++) {
        const a = rr(0, 6.283);
        const r0 = rr(0, pit.r * 0.55);
        const from = [pit.x + Math.cos(a) * r0, -pit.depth, pit.z + Math.sin(a) * r0];
        const to = [from[0] + rr(-0.7, 0.7), -pit.depth + rr(0.4, 1.1), from[2] + rr(-0.7, 0.7)];
        br.push(part(limb(from, to, 0.03, 0.012, 4), 0x3a2c22, { vary: 0.3 }));
        br.push(part(G.cone(0.02, 0.12, 3), 0x1a1412, { at: to, rot: [rr(0, 3), 0, rr(0, 3)], vary: 0 }));
      }
      zn.flat.push(S.merge(br));
    } else if (de.holds === 'shaft') {
      // A last shaft of sunlight: a leaning cone of bright air and the pool it lays on the ground.
      const r = cfg.bat ? cfg.bat.shaftRadius : 2.5;
      const cone = new THREE.CylinderGeometry(0.5, r, 11, 18, 1, true).translate(0, 5.5, 0);
      cone.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, rig.sunDir.x / rig.sunDir.y, rig.sunDir.z / rig.sunDir.y, 0, 0));
      const beam = S.merge([part(cone, 0xffe6a8, { vary: 0 }), part(G.disc(r, 24), 0xfff0c0, { at: [0, 0.03, 0], vary: 0 })]);
      shaft = new THREE.Mesh(beam, new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }));
      shaft.position.set(de.x, 0, de.z);
      zn.group.add(shaft);
    }
  }
  // C4: no rings round the pads; the pickups are things lying in the wood (actors.js draws them).
  // The owner (2026-11-19): past the last gate the way is the long winding walk to the road
  // (logic/tunnelwalk.js). The level ends just through the gate, where the castle's card is read and
  // the level changes under it; what is seen through the gate before then is the walk's own first
  // stretch, drawn by the walk's code (tunnelwood.js) in the wood's frame, so the castle level's walk
  // takes up exactly where it left off.
  let walkView = null;
  try { walkView = createTunnelWood(zones[5].group, { tier: deviceTier(), frame: 'court', until: 26 }); } catch (err) { console.warn('the walk\'s first stretch not drawn:', err && err.message); }

  // ---- zone meshes -----------------------------------------------------------------------------
  const wetMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.5, transparent: true, opacity: 0.86 });
  const puddleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.04, metalness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const lanternMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  for (const zn of zones.slice(1)) {
    const g = zn.group;
    const zd = greyAt((zn.minZ + zn.maxZ) / 2);
    if (zn.clip.length) instanced(g, geo.clip(zd), M.matte, zn.clip, true);
    const vict = zn.vict.some((l) => l.length) ? geo.vict(zd) : null;
    if (zn.wild.length) instanced(g, geo.wild(zd), M.matte, zn.wild, false);
    instanced(g, geo.rock, M.matte, zn.rock, false);
    zn.vict.forEach((list, i) => list.length && instanced(g, vict[i], M.matte, list, true));
    zn.haunt.forEach((list, i) => instanced(g, geo.haunt[i], M.matte, list, i < 2)); // the small bare ones cast nothing worth a pass
    instanced(g, geo.flower, M.matte, zn.flower, false, false);
    instanced(g, geo.leaf, M.leaf, zn.leaf, false, false);
    instanced(g, geo.twig, M.matte, zn.twig, false, false);
    instanced(g, geo.petal, M.leaf, zn.petal, false, false);
    instanced(g, geo.toad, M.matte, zn.toad, false, false);
    if (zn.solid.length) g.add(bake(zn.solid, M.matte));
    if (zn.flat.length) g.add(bake(zn.flat, M.matte, false, true));
    if (zn.metal.length) g.add(bake(zn.metal, M.metal));
    if (zn.glow.length) g.add(bake(zn.glow, lanternMat, false, false));
    if (zn.water.length) g.add(bake(zn.water, wetMat, false, true));
    const wet = zn.decal.filter((q) => q.wet).map((q) => q.wet);
    const ring = zn.decal.filter((q) => q.ring).map((q) => q.ring);
    if (wet.length) g.add(bake(wet, puddleMat, false, true));
    if (ring.length) g.add(bake(ring, M.decal, false, true));
  }

  // One warm light for the nearest gate lantern (one, always, so no shader ever recompiles).
  const lamp = new THREE.PointLight(PAL.lantern, 0, 12, 1.6);
  lamp.position.set(0, -20, 0);
  group.add(lamp);
  let lampAt = null;

  // ---- drizzle, rain rings and falling leaves (engine-only dressing) ---------------------------
  const rainPos = new Float32Array(RAIN * 6);
  for (let i = 0; i < RAIN; i++) {
    const x = (Math.random() - 0.5) * 44;
    const y = Math.random() * 18;
    const z = (Math.random() - 0.5) * 44;
    rainPos.set([x, y, z, x + 0.02, y + 0.32, z + 0.01], i * 6);
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xe8f2f8, transparent: true, opacity: 0, depthWrite: false });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.visible = false;
  group.add(rain);

  const ringMesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.88, 1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }), RINGS);
  ringMesh.frustumCulled = false;
  ringMesh.visible = false;
  group.add(ringMesh);
  const rings = Array.from({ length: RINGS }, () => ({ x: 0, y: 0, z: 0, t: 9, life: 1, size: 0.3 }));
  for (let i = 0; i < RINGS; i++) ringMesh.setColorAt(i, _c.setRGB(0, 0, 0));
  let ringNext = 0;
  let ringIn = 0;

  const driftMesh = new THREE.InstancedMesh(geo.leaf, M.leaf, DRIFT);
  driftMesh.frustumCulled = false;
  driftMesh.visible = false;
  group.add(driftMesh);
  const drift = Array.from({ length: DRIFT }, (_, i) => ({ x: 0, y: -5, z: 0, o: i * 1.7, v: 0.5 + (i % 5) * 0.12 }));
  for (let i = 0; i < DRIFT; i++) driftMesh.setColorAt(i, _c.setHex(leafTone(LEAF_TONES[i % LEAF_TONES.length], 0.6)));

  const dummy = new THREE.Object3D();
  let zoneNow = -1;
  function setZone(k) {
    zoneNow = k;
    for (const zn of zones.slice(1)) zn.group.visible = Math.abs(zn.index - k) <= 1;
  }
  setZone(0);

  function update(sim, dt, time) {
    if (!rig.root.visible || !group.visible) return;
    const eye = rig.eye;
    if (rig.stage !== zoneNow) setZone(rig.stage);
    if (walkView && zones[5].group.visible) walkView.update(null, time, dt); // the walk's trees through the gate: their wind

    // The gate lantern nearest the eye carries the light; all of them flicker together.
    let best = null;
    let bestD = 40;
    for (const zn of zones.slice(1)) {
      if (!zn.group.visible) continue;
      for (const l of zn.lanterns) {
        const d = Math.hypot(l.x - eye.x, l.z - eye.z);
        if (d < bestD) { bestD = d; best = l; }
      }
    }
    const flick = 0.9 + 0.1 * Math.sin(time * 9.1) * Math.sin(time * 3.7);
    if (best !== lampAt) {
      lamp.intensity -= dt * 60;
      if (lamp.intensity <= 0 || !lampAt) {
        lamp.intensity = 0;
        lampAt = best;
        if (best) lamp.position.set(best.x, best.y - 0.1, best.z + 0.25);
      }
    } else if (best) {
      lamp.intensity += ((4 + 14 * rig.grey) * flick - lamp.intensity) * Math.min(1, dt * 4);
    }
    lanternMat.color.setScalar(0.85 + 0.15 * flick);
    if (shaft) shaft.material.opacity = 0.1 + 0.12 * rig.grey + 0.02 * Math.sin(time * 0.8);

    // Drizzle rides with the eye and thickens toward the last gate; past the Caterpillar's gate
    // it thins to nothing (#28, logic/weather.js).
    const left = weatherNow(sim, _sky).rain;
    const wet = wetAt(eye.z) * left;
    rain.visible = wet > 0.01;
    if (rain.visible) {
      rainMat.opacity = 0.42 * wet;
      rainGeo.setDrawRange(0, Math.ceil(RAIN * Math.min(1, left * 1.5)) * 2); // the last drops are few, not faint
      rain.position.set(eye.x, 0, eye.z);
      if (dt > 0) {
        const fall = dt * 13;
        for (let i = 0; i < RAIN; i++) {
          let y = rainPos[i * 6 + 1] - fall;
          if (y < 0) y += 18;
          rainPos[i * 6 + 1] = y;
          rainPos[i * 6 + 4] = y + 0.32;
        }
        rainGeo.attributes.position.needsUpdate = true;
      }
    }
    ringMesh.visible = wet > 0.05;
    if (ringMesh.visible && dt > 0) {
      ringIn -= dt;
      if (ringIn <= 0) {
        ringIn = 0.05 + 0.2 * (1 - wet);
        const r = rings[ringNext];
        ringNext = (ringNext + 1) % RINGS;
        const q = puddles.length && Math.random() < 0.7 ? puddles[Math.floor(Math.random() * puddles.length)] : null;
        const a = Math.random() * 6.283;
        const k = Math.sqrt(Math.random()) * 0.85;
        if (q) Object.assign(r, { x: q.x + Math.cos(a) * q.rx * k, y: 0.02, z: q.z + Math.sin(a) * q.rz * k });
        else Object.assign(r, { x: eye.x + (Math.random() - 0.5) * 24, y: -0.025, z: st.minZ + 0.2 + Math.random() * (st.maxZ - st.minZ - 0.4) });
        r.t = 0;
        r.life = 0.7 + Math.random() * 0.5;
        r.size = 0.15 + Math.random() * 0.22;
      }
      for (let i = 0; i < RINGS; i++) {
        const r = rings[i];
        if (r.t > r.life) continue;
        r.t += dt;
        const k = clamp(r.t / r.life);
        dummy.position.set(r.x, r.y, r.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.03 + k * r.size);
        dummy.updateMatrix();
        ringMesh.setMatrixAt(i, dummy.matrix);
        ringMesh.setColorAt(i, _c.setScalar(0.3 * (1 - k) * wet));
      }
      ringMesh.instanceMatrix.needsUpdate = true;
      ringMesh.instanceColor.needsUpdate = true;
    }

    // A few leaves coming down, from where the clipping gives out.
    const fallK = rig.stage >= 1 ? clamp(rig.grey * 1.4) : 0;
    driftMesh.visible = fallK > 0.05;
    if (driftMesh.visible) {
      driftMesh.count = Math.max(1, Math.round(DRIFT * fallK));
      for (let i = 0; i < driftMesh.count; i++) {
        const l = drift[i];
        if (dt > 0) l.y -= l.v * dt;
        if (l.y < 0 || Math.hypot(l.x - eye.x, l.z - eye.z) > 16) {
          l.x = eye.x + (Math.random() - 0.5) * 24;
          l.z = eye.z + (Math.random() - 0.5) * 24;
          l.y = l.y < -1 ? Math.random() * 7 : 5 + Math.random() * 3;
        }
        const s = time * 1.3 + l.o;
        dummy.position.set(l.x + Math.sin(s) * 0.35, l.y, l.z + Math.cos(s * 0.8) * 0.35);
        dummy.rotation.set(s * 1.1, s * 0.7, Math.sin(s) * 1.2);
        dummy.scale.setScalar(1.2);
        dummy.updateMatrix();
        driftMesh.setMatrixAt(i, dummy.matrix);
      }
      driftMesh.instanceMatrix.needsUpdate = true;
    }
  }

  function apply(r) {
    group.visible = true;
    rig.apply(r);
  }
  function hide() {
    group.visible = false;
    rig.hide();
  }

  // Title backdrop for the wood alone (the court's titleCamera covers the whole level).
  const way = [[0, MAZE.z0 + 3]];
  for (let band = 1; band <= 4; band++) for (const p of routeOf(band)) way.push([p.x, p.z]);
  way.push([0, MAZE.approach.endZ]);
  const curve = new THREE.CatmullRomCurve3(way.map(([x, z]) => new THREE.Vector3(x, 1.85, z)), false, 'catmullrom', 0.12);
  const titlePos = new THREE.Vector3();
  const titleTarget = new THREE.Vector3();
  function titleCamera(time) {
    const u = ((time % TITLE_LOOP) / TITLE_LOOP) * 0.985;
    curve.getPointAt(u, titlePos);
    curve.getPointAt(Math.min(1, u + 0.012), titleTarget);
    titleTarget.y = 1.9;
    return { position: titlePos, target: titleTarget };
  }

  return {
    group, apply, hide, update, titleCamera, zones,
    get zone() { return zoneNow; },
  };
}
