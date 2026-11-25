// The things the warden acts on in the Rose Court level, drawn from sim state every frame so a
// restored checkpoint shows exactly what the state says: valve wheels, the rose beds, the
// fountain's water, the briar across the arch, the crossbow on the throne, stakes wherever they
// lie, the garlic and carrot patches, the Rabbit's bowl, the pit's leaf mat, the Bat's lanterns,
// the tin cup, the Caterpillar's pipe and its smoke, and the four gates' leaves. (The water in
// the rills is water.js.) Polish: roses with petals that open (one instanced mesh of heads per
// bed over the shared bushes, each head opening by its own morph weight); the bed's flush once
// its water has landed, timed by sim.waves.flows (a bed losing water closes and fades white);
// halberds lying where guards fell (sim.waves.dropped); the Hatter's display (stand, pegs, card
// and five tagged hats, the words on one canvas texture made here); the note under the cup.
// An actors layer: { sync, onEvent, clear, setReducedFlash, scene }. Events only add one-shot
// motion (a splash, splinters, a swaying chain); nothing here is remembered across a restore,
// and nothing here writes the sim.

import * as THREE from 'three';
import { COURT, MAZE, corridor, stageAt } from '../logic/courtmap.js';
import { FEEDS } from '../logic/roses.js';
import { HATS } from '../logic/hats.js';
import { TAGS, READS } from '../logic/script.js';
import * as S from './sculpt.js';
import { daylight, mats, G, part, limb, bake, PAL, FOUNTAIN } from './court.js';
import { groundTone } from './forest.js';
import { LANTERN_LIGHT, poolAt } from '../logic/courtlook.js';

const SMOKE = 40; // puffs over the Caterpillar's glade (the frame budget's cap)
const MOTES = 28; // one-shot droplets, splinters and leaves
const DRIPS = 8;
const STAKES = 14;
const HALF_PAINTED = 1; // the Hearts bed
const ROSES = 12; // heads on each of a bed's five bushes
const BED_TIME = 2; // seconds for a bed to flush red from the roots up (cfg.bedFlush)
const FLOW_TIME = 1.5; // seconds for the water to run down a rill (cfg.valveFlow)
const HAT_LIFT = 0.16; // each hat sits on a short block, so its tag hangs clear of the shelf
const HALBERDS = 4; // dropped halberds drawn (the court has two guards)
const NO_FLOWS = Object.freeze([0, 0, 0, 0]);
const NO_PEGS = Object.freeze([null, null, null, null, null]);
const FEEDER = FEEDS.map((_, bed) => FEEDS.indexOf(bed)); // the valve whose rill feeds each bed
const IRON = 0x2b2326;

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const toward = (cur, goal, step) => (cur < goal ? Math.min(goal, cur + step) : Math.max(goal, cur - step));
const _c = new THREE.Color();
const _white = new THREE.Color(PAL.roseWhite);
const _red = new THREE.Color(PAL.wetRed).multiplyScalar(2.2); // the petals shade themselves: lifted to read as wet red
const _paint = new THREE.Color(PAL.paint);

// What is drawn when the sim on screen is not a Rose Court run (the title's backdrop).
const IDLE = Object.freeze({
  valves: [false, false, false, false], beds: [false, false, false, false], channels: [false, false, false, false],
  done: { roses: false, gates: [false, false, false, false], pitOpen: false },
  items: { garlic: 0, carrot: 0, cup: 'none' }, loot: null, stakes: [], bodies: [], phase: 'still',
  flows: NO_FLOWS, dropped: [], hats: { pegs: NO_PEGS }, scene: null,
});

const smooth = (k) => k * k * (3 - 2 * k);

/** One geometry from parts that each carry position, normal, color and uv (S.merge drops uv). */
function mergeMapped(list) {
  const geo = S.merge(list);
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    uv.set(g.attributes.uv.array.subarray(0, g.attributes.position.count * 2), o);
    o += g.attributes.position.count * 2;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/**
 * The Hatter's words, drawn once: the five price tags (script.js TAGS, by hats.js HATS order)
 * and the card on the stand (READS.hatCard), on one canvas. Returns { texture, tag[5], card,
 * blank }, each a [u0, v0, u1, v1] rectangle; blank is plain white for unlettered parts.
 */
function hatTexture() {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  const rect = (x, y, w, h) => [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H];
  const serif = 'Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const tag = HATS.map((hat, i) => {
    const x = 4 + i * 204;
    const words = TAGS[hat.key] || '';
    const cut = words.lastIndexOf(' '); // the price is the last word
    g.fillStyle = '#efe6cc';
    g.fillRect(x, 4, 196, 128);
    g.strokeStyle = '#3a2c20';
    g.lineWidth = 3;
    g.strokeRect(x + 5, 9, 186, 118);
    g.fillStyle = '#2a2018';
    g.font = `italic 26px ${serif}`;
    g.fillText(words.slice(0, cut), x + 98, 42);
    g.font = `bold 50px ${serif}`;
    g.fillText(words.slice(cut + 1), x + 98, 92);
    return rect(x, 4, 196, 128);
  });
  // The card: its own words, wrapped to the card's width.
  g.fillStyle = '#f3eedf';
  g.fillRect(4, 148, 560, 300);
  g.strokeStyle = '#3a2c20';
  g.lineWidth = 4;
  g.strokeRect(14, 158, 540, 280);
  g.fillStyle = '#2a2018';
  g.font = `bold 34px ${serif}`;
  const lines = [];
  let line = '';
  for (const word of READS.hatCard.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > 500) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => g.fillText(l, 284, 298 + (i - (lines.length - 1) / 2) * 44));
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, tag, card: rect(4, 148, 560, 300), blank: rect(700, 300, 200, 150) };
}

export function createProps(scene, cfg) {
  const rig = daylight(scene, cfg);
  const M = mats();
  const rnd = S.rng(31);
  const rr = (a, b) => a + rnd() * (b - a);
  const group = new THREE.Group();
  group.name = 'props';
  rig.root.add(group);
  const stages = [0, 1, 2, 3, 4, 5].map(() => {
    const g = new THREE.Group();
    group.add(g);
    return { group: g, solid: [], flat: [], metal: [] };
  });
  const dummy = new THREE.Object3D();
  const put = (mesh, i, x, y, z, sx = 1, sy = sx, sz = sx, ry = 0, rx = 0, rz = 0) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, ry, rz, 'YXZ');
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };
  const inst = (parent, geo, material, n, cast = false) => {
    const m = new THREE.InstancedMesh(geo, material, n);
    m.frustumCulled = false;
    m.castShadow = cast;
    m.receiveShadow = true;
    for (let i = 0; i < n; i++) {
      put(m, i, 0, -30, 0, 0.001);
      m.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    parent.add(m);
    return m;
  };
  const lootIndex = (key) => cfg.loot.findIndex((l) => l.key === key);
  const lootAt = (key) => cfg.loot[lootIndex(key)] || null;

  // ---- the court: beds, valves, rills, fountain, briar, crossbow -------------------------------
  const s0 = stages[0];
  const redMat = new THREE.MeshStandardMaterial({ color: PAL.wetRed, roughness: 0.08, metalness: 0.25, emissive: 0x000000 });
  const bushes = [];
  const blooms = [];
  COURT.beds.forEach((b, bi) => {
    // A stone-edged planter, a suit plaque on its inner face, five clipped bushes of roses.
    s0.solid.push(part(G.box(b.size, 0.42, b.size), PAL.stone, { at: [b.x, 0.21, b.z], vary: 0.25, seed: bi }));
    s0.flat.push(part(G.box(b.size - 0.5, 0.06, b.size - 0.5, 4, 1, 4), PAL.soil, { at: [b.x, 0.43, b.z], vary: 0.3, lump: 0.04 }));
    const ink = b.suit === 'hearts' || b.suit === 'diamonds' ? PAL.paint : 0x17181b;
    const inX = -Math.sign(b.x);
    const inZ = -Math.sign(b.z);
    s0.solid.push(part(G.box(0.62, 0.62, 0.06), 0xf3eedf, { at: [b.x, 0.78, b.z + inZ * (b.size / 2 + 0.03)], vary: 0.05 }));
    s0.solid.push(part(S.pip(b.suit.replace(/s$/, ''), 0.4), ink, { at: [b.x, 0.78, b.z + inZ * (b.size / 2 + 0.065)], rot: [0, inZ > 0 ? 0 : Math.PI, 0], vary: 0 }));
    s0.solid.push(part(G.box(0.06, 0.62, 0.62), 0xf3eedf, { at: [b.x + inX * (b.size / 2 + 0.03), 0.78, b.z], vary: 0.05 }));
    s0.solid.push(part(S.pip(b.suit.replace(/s$/, ''), 0.4), ink, { at: [b.x + inX * (b.size / 2 + 0.065), 0.78, b.z], rot: [0, inX * Math.PI / 2, 0], vary: 0 }));
    for (let i = 0; i < 5; i++) {
      const bx = b.x + (i === 4 ? 0 : (i % 2 ? 1 : -1) * 1.5) + rr(-0.25, 0.25);
      const bz = b.z + (i === 4 ? 0 : (i < 2 ? 1 : -1) * 1.5) + rr(-0.25, 0.25);
      const r = rr(0.85, 1.05);
      bushes.push({ bed: bi, x: bx, z: bz, r });
      for (let k = 0; k < ROSES; k++) {
        // Most heads on the side of the bush that faces out of the bed, where they are seen.
        const out = Math.atan2(bz - b.z, bx - b.x);
        const a = i === 4 || k % 3 === 0 ? rr(0, 6.283) : out + rr(-1.7, 1.7);
        const e = rr(0.05, 1.2);
        const x = bx + Math.cos(a) * Math.cos(e) * r;
        blooms.push({
          bed: bi, x, z: bz + Math.sin(a) * Math.cos(e) * r, h: Math.sin(e), up: 0.45 + r * 0.8 + Math.sin(e) * r * 0.8 - 0.03,
          nx: Math.cos(a) * Math.cos(e), nz: Math.sin(a) * Math.cos(e),
          painted: bi === HALF_PAINTED && x > b.x, s: rr(0.17, 0.24),
        });
      }
    }
  });
  // C3: each bush is four leafy lobes, not one faceted ball.
  const bushGeo = S.merge([[0.36, 0.1, 0.12], [-0.34, 0.05, 0.2], [0.05, 0.02, -0.38], [-0.02, 0.32, 0.02]].map(([x, y, z], k) => part(G.ball(0.64 - 0.04 * k, 11, 8), PAL.hedge, { at: [x, y, z], lump: 0.1, vary: 0.45, freq: 5.5, seed: k })));
  const bushMesh = inst(s0.group, bushGeo, M.matte, bushes.length, true);
  // Roses: a whorl of petals on a calyx, shut and white when dry; watered, they open (the
  // kit's morph target, weighted per head), redden from the roots up, stand a little taller
  // and glisten. One instanced mesh of heads per bed (the budget allows two), over the bushes.
  // C3: three whorls of cupped petals round a calyx: shut, a tight bud the sepals clasp; open, a
  // cup whose outer petals spread and inner ones stay upright, as a rose's do.
  const roseGeo = S.flower({ size: 1, open: 0, color: 0xffffff, heart: 0xc8c4bc, detail: 2, morph: true, cup: 0.85, seed: 3,
    whorls: [[6, 0.95, 0.1, 1.1], [5, 0.78, 0.04, 0.62], [4, 0.58, 0.0, 0.26]] });
  const _up = new THREE.Vector3(0, 1, 0);
  const _dir = new THREE.Vector3();
  const _spin = new THREE.Quaternion();
  const _pos = new THREE.Vector3();
  const _scl = new THREE.Vector3();
  const _mat = new THREE.Matrix4();
  const roseBeds = COURT.beds.map((b, bi) => {
    const list = blooms.filter((q) => q.bed === bi);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
    return { material, list, mesh: inst(s0.group, roseGeo, material, list.length) };
  });
  const roseOpen = new THREE.Mesh(roseGeo); // never drawn: carries one head's morph weight to setMorphAt
  for (const b of blooms) {
    // Each head looks out of its bush and up, turned about its own stem.
    _dir.set(b.nx, b.h * 0.6 + 0.75, b.nz).normalize(); // tipped well up, so an open head shows its face from eye height
    b.q = new THREE.Quaternion().setFromUnitVectors(_up, _dir).multiply(_spin.setFromAxisAngle(_up, rr(0, 6.283)));
  }
  const bedLevel = [0, 0, 0, 0];
  let bedDrawn = [-1, -1, -1, -1];
  function drawBeds() {
    if (bedLevel.every((v, i) => Math.abs(v - bedDrawn[i]) < 0.002)) return;
    bedDrawn = [...bedLevel];
    bushes.forEach((b, i) => put(bushMesh, i, b.x, 0.45 + b.r * 0.8 * (1 + 0.1 * bedLevel[b.bed]), b.z, b.r, b.r * 0.85 * (1 + 0.1 * bedLevel[b.bed]), b.r));
    bushMesh.instanceMatrix.needsUpdate = true;
    roseBeds.forEach((bed, bi) => {
      const lv = bedLevel[bi];
      bed.material.roughness = 0.62 - 0.22 * lv; // a watered rose glistens (C3: a sheen, not glass)
      // A little light of its own, so a head holds its colour in shade (an open one shows its
      // underside from below). The red comes in only as the flush ends, so mid-flush the bed's
      // colour is each head's own and the flush is seen to climb from the roots.
      bed.material.emissive.copy(_white).multiplyScalar(0.1 * (1 - lv)).add(_c.copy(_red).multiplyScalar(0.4 * lv ** 4));
      bed.list.forEach((b, i) => {
        const k = clamp(lv * 1.7 - b.h * 0.7); // the lowest blooms turn first
        const s = b.s * (1 + 0.25 * k);
        bed.mesh.setMatrixAt(i, _mat.compose(_pos.set(b.x, b.up * (1 + 0.1 * lv), b.z), b.q, _scl.set(s, s, s)));
        bed.mesh.setColorAt(i, _c.copy(b.painted ? _paint : _white).lerp(_red, k));
        roseOpen.morphTargetInfluences[0] = 0.9 * smooth(k); // a shut bud to a full-blown head: the state is told by shape too
        bed.mesh.setMorphAt(i, roseOpen);
      });
      bed.mesh.instanceMatrix.needsUpdate = true;
      bed.mesh.instanceColor.needsUpdate = true;
      bed.mesh.morphTexture.needsUpdate = true;
    });
  }

  // Valves: a standpipe at each bed's inner corner, a pipe to the head of its rill, a scarlet wheel.
  const heads = COURT.rills.map((r, i) => {
    const v = COURT.valves[i];
    const along = r.w >= r.d;
    const a = along ? { x: r.minX, z: r.z } : { x: r.x, z: r.minZ };
    const b = along ? { x: r.maxX, z: r.z } : { x: r.x, z: r.maxZ };
    const first = Math.hypot(a.x - v.x, a.z - v.z) <= Math.hypot(b.x - v.x, b.z - v.z);
    return { along, from: first ? a : b, to: first ? b : a, len: along ? r.w : r.d, wide: along ? r.d : r.w };
  });
  COURT.valves.forEach((v, i) => {
    s0.metal.push(part(G.cyl(0.07, 0.09, 0.95, 8), PAL.rust, { at: [v.x, 0.47, v.z], vary: 0.35, seed: i }));
    s0.metal.push(part(G.cyl(0.13, 0.13, 0.08, 8), PAL.rust, { at: [v.x, 0.04, v.z], vary: 0.35 }));
    const h = heads[i].from;
    s0.metal.push(part(limb([v.x, 0.12, v.z], [h.x, 0.1, h.z], 0.05, 0.05, 6), PAL.rust, { vary: 0.35 }));
    s0.metal.push(part(G.cyl(0.08, 0.08, 0.2, 8), PAL.rust, { at: [h.x, 0.1, h.z], vary: 0.3 }));
  });
  const wheelGeo = S.merge([
    part(G.torus(0.3, 0.045, 6, 16), PAL.scarlet, { rot: [Math.PI / 2, 0, 0], vary: 0.15 }),
    part(G.box(0.58, 0.035, 0.05), PAL.scarlet, {}), part(G.box(0.05, 0.035, 0.58), PAL.scarlet, {}),
    part(G.cyl(0.06, 0.06, 0.07, 8), PAL.gold, {}),
  ]);
  const wheelMesh = inst(s0.group, wheelGeo, M.metal, 4, true);
  const valveOpen = [0, 0, 0, 0];
  const valveShake = [0, 0, 0, 0];

  // The water in the rills is water.js (one surface for rills, threshold and stream). Here the
  // flow timer only times the bed: it opens once its water has landed (waterArrive).
  const flowTime = cfg.valveFlow || FLOW_TIME;
  const flushTime = cfg.bedFlush || BED_TIME;
  /** How far down rill i the state says the water's front is: 0 at the valve, 1 at the bed. */
  const frontOf = (w, i) => (w.channels[i] ? 1 - clamp(((w.flows || NO_FLOWS)[i] || 0) / flowTime) : 0);

  const pool = new THREE.Mesh(G.plane(FOUNTAIN.half * 2 - 0.5, FOUNTAIN.half * 2 - 0.5), redMat);
  pool.position.set(COURT.fountain.x, FOUNTAIN.floorY, COURT.fountain.z);
  pool.receiveShadow = true;
  pool.visible = false;
  s0.group.add(pool);
  let poolLevel = 0;
  let flash = 0;
  let reduced = false;

  // The briar that closes the arch: two tangles that draw back to the piers when the roses are red.
  const briar = [-1, 1].map((side) => {
    const parts = [];
    const b = COURT.briar;
    const half = b.w / 2;
    for (let i = 0; i < 26; i++) {
      let p = new THREE.Vector3(rr(0.1, half), 0, rr(-0.35, 0.35));
      for (let k = 0; k < 4; k++) {
        const q = new THREE.Vector3(clamp(p.x + rr(-0.9, 0.9), 0, half + 0.1), Math.min(b.h + 0.4, p.y + rr(0.5, 1.0)), rr(-0.4, 0.4));
        parts.push(part(limb([side * p.x, p.y, p.z], [side * q.x, q.y, q.z], 0.045 - k * 0.008, 0.035 - k * 0.008, 4), k % 2 ? 0x3a4a2c : 0x4a3a28, { vary: 0.3 }));
        if (k % 2) parts.push(part(G.cone(0.03, 0.16, 3), 0x1a1412, { at: [side * q.x, q.y, q.z], rot: [rr(0, 3), 0, rr(0, 3)], vary: 0 }));
        else if (rnd() < 0.4) parts.push(part(G.ico(0.1, 0), PAL.roseWhite, { at: [side * q.x, q.y, q.z], vary: 0.1 }));
        p = q;
      }
    }
    const m = bake(parts, M.matte);
    m.position.set(b.x, 0, b.z);
    s0.group.add(m);
    return { m, side, half };
  });
  let briarOpen = 0;

  // The crossbow across the arms of the throne, one stake on the string and two beside it.
  const bow = (() => {
    const t = COURT.throne;
    const wood = 0x6a4a30;
    const local = [
      part(G.box(0.07, 0.06, 0.78), wood, { vary: 0.25 }),
      part(G.torus(0.42, 0.022, 5, 12, Math.PI * 0.7), 0x3a3a40, { at: [0, 0.02, -0.02], rot: [Math.PI / 2, 0, Math.PI * 0.15], vary: 0.1 }),
      part(limb([-0.375, 0.02, 0.19], [0.375, 0.02, 0.19], 0.004, 0.004, 3), 0xe8e2d0, { vary: 0 }),
      part(G.cyl(0.012, 0.004, 0.5, 5), 0xd8c49a, { at: [0, 0.055, 0.02], rot: [Math.PI / 2, 0, 0], vary: 0.1 }),
      part(G.cyl(0.014, 0.004, 0.55, 5), 0xd8c49a, { at: [0.28, 0.0, 0.3], rot: [Math.PI / 2, 0.5, 0], vary: 0.1 }),
      part(G.cyl(0.014, 0.004, 0.55, 5), 0xd8c49a, { at: [0.36, 0.0, 0.26], rot: [Math.PI / 2, 0.3, 0], vary: 0.1 }),
    ];
    const m = bake([part(S.merge(local), null, { at: [t.x + 0.25, 1.34, t.z], rot: [0, 0.12, 0], scale: 1.5 })], M.matte);
    s0.group.add(m);
    return m;
  })();

  // ---- stakes: found ones where they wait, fired ones where they stopped -------------------------
  const stakeGeo = (worn) => {
    const parts = [part(G.cyl(0.018, 0.018, 0.5, 6), 0xffffff, { at: [0, 0.37, 0], vary: 0.15 }), part(G.cone(0.018, 0.12, 6), 0xffffff, { at: [0, 0.06, 0], rot: [Math.PI, 0, 0], vary: 0.1 })];
    if (worn) parts.push(part(G.box(0.006, 0.26, 0.05), 0x2a2018, { at: [0, 0.5, 0], vary: 0 })); // split along the grain
    return S.merge(parts);
  };
  const freshMesh = inst(group, stakeGeo(false), M.matte, STAKES, true);
  const wornMesh = inst(group, stakeGeo(true), M.matte, STAKES, true);
  const FRESH = new THREE.Color(0xd8c49a);
  const WORN = new THREE.Color(0x8a745a);
  const waiting = []; // found stakes: [loot key, x, y, z, tilt x, tilt z]
  const lid = lootAt('lidStake');
  if (lid) waiting.push(['lidStake', lid.x, 0.05, lid.z, 0.35, 0.2]);
  const stump = lootAt('stump');
  if (stump) for (let i = 0; i < (stump.count || 3); i++) waiting.push(['stump', stump.x + (i - 1) * 0.16, 0.5, stump.z + (i % 2) * 0.12 - 0.05, 0.25 * (i - 1), 0.3 - 0.25 * i]);
  const bundle = lootAt('bundle');
  if (bundle) for (let i = 0; i < (bundle.count || 3); i++) waiting.push(['bundle', bundle.x - 0.2 + i * 0.05, 0.52 + (i === 1 ? 0.035 : 0), bundle.z - 0.5 + (i - 1) * 0.04, Math.PI / 2, 0.1 * i]);
  if (bundle) stages[3].flat.push(part(G.torus(0.05, 0.012, 4, 8), 0xb9a988, { at: [bundle.x - 0.15, 0.53, bundle.z - 0.2], rot: [0, Math.PI / 2, 0] }));

  // ---- the four gates: two iron leaves each, swung back when their creature is dead ---------------
  const leafGeo = (() => {
    const parts = [part(G.box(1, 0.07, 0.05), IRON, { at: [0.5, 0.3, 0], vary: 0.1 }), part(G.box(1, 0.07, 0.05), IRON, { at: [0.5, 2.9, 0], vary: 0.1 }), part(G.box(0.07, 3.5, 0.07), IRON, { at: [0.035, 1.75, 0], vary: 0.1 })];
    for (let i = 1; i <= 5; i++) {
      const x = i / 5 - 0.04;
      const h = 3.3 + 0.35 * Math.sin((i / 5) * Math.PI * 0.5);
      parts.push(part(G.box(0.035, h, 0.035), IRON, { at: [x, h / 2, 0], vary: 0.1 }));
      parts.push(part(G.cone(0.05, 0.22, 4), IRON, { at: [x, h + 0.1, 0], vary: 0.1 }));
    }
    return S.merge(parts);
  })();
  const gateMesh = inst(group, leafGeo, M.metal, 8, true);
  const gateOpen = [0, 0, 0, 0];
  const gateDrawn = [-1, -1, -1, -1];
  const gates = MAZE.glades.map((gl, b) => ({ x: gl.gate.x, z: gl.gate.z, half: corridor(MAZE.bands[b].rows[1]) / 2 + 0.08 }));
  function drawGates() {
    gates.forEach((g, b) => {
      if (Math.abs(gateDrawn[b] - gateOpen[b]) < 0.001) return;
      gateDrawn[b] = gateOpen[b];
      const e = gateOpen[b] * gateOpen[b] * (3 - 2 * gateOpen[b]) * 1.5;
      put(gateMesh, b * 2, g.x - g.half, 0, g.z, g.half, 1, 1, e);
      put(gateMesh, b * 2 + 1, g.x + g.half, 0, g.z, g.half, 1, 1, Math.PI - e);
      gateMesh.instanceMatrix.needsUpdate = true;
    });
  }

  // ---- the wood's finds: garlic, carrots, the bowl, the pit's mat, lanterns, cup, pipe ----------
  const patches = [];
  for (const l of cfg.loot) {
    if (!l.patch) continue;
    const st = stages[l.stage];
    const ripe = [];
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4;
      const r = 0.25 + (i % 4) * 0.28;
      const x = l.x + Math.cos(a) * r;
      const z = l.z + Math.sin(a) * r;
      if (l.kind === 'garlic') {
        for (let k = 0; k < 3; k++) st.flat.push(part(G.cone(0.06, rr(0.32, 0.55), 3).scale(1, 1, 0.3), 0x3f8f3f, { at: [x + rr(-0.05, 0.05), 0.2, z + rr(-0.05, 0.05)], rot: [rr(-0.45, 0.45), rr(0, 6), rr(-0.45, 0.45)], vary: 0.2 }));
        if (i % 2 === 0) ripe.push(part(G.ico(0.085, 1), 0xf3f0e4, { at: [x, 0.05, z], scale: [1, 0.9, 1], lump: 0.012, freq: 14, vary: 0.08 }));
      } else {
        for (let k = 0; k < 4; k++) st.flat.push(part(G.cone(0.05, rr(0.22, 0.4), 4).scale(1, 1, 0.4), 0x4aa046, { at: [x + rr(-0.05, 0.05), 0.16, z + rr(-0.05, 0.05)], rot: [rr(-0.6, 0.6), rr(0, 6), rr(-0.6, 0.6)], vary: 0.2 }));
        if (i % 2 === 0) ripe.push(part(G.cone(0.045, 0.12, 6), 0xff8a1c, { at: [x, 0.03, z], rot: [Math.PI, 0, 0], vary: 0.1 }));
      }
    }
    st.flat.push(part(G.disc(1.2, 12), 0x3a2c20, { at: [l.x, 0.016, l.z], vary: 0.3 }));
    const m = bake(ripe, M.matte, false, true);
    st.group.add(m);
    patches.push({ kind: l.kind, gives: l.gives, mesh: m });
  }

  // The Rabbit's salad bowl at the far end of his table, and the menu card on its stand.
  const tableY = MAZE.rabbit.table.h + 0.03;
  const bowl = bake([
    part(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xfdfdf8, { at: [0, 0.2, 0], vary: 0.04 }),
    part(G.torus(0.2, 0.012, 4, 14), 0xfdfdf8, { at: [0, 0.2, 0], rot: [Math.PI / 2, 0, 0], vary: 0 }),
    part(G.cyl(0.09, 0.1, 0.03, 10), 0xfdfdf8, { at: [0, 0.015, 0], vary: 0 }),
  ], M.leaf);
  const salad = bake([
    part(G.ico(0.15, 1), 0x5d9a48, { at: [0, 0.14, 0], scale: [1, 0.5, 1], lump: 0.03, freq: 9, vary: 0.25 }),
    part(G.ico(0.04, 0), 0xf3f0e4, { at: [0.05, 0.2, 0.03], vary: 0 }), part(G.ico(0.035, 0), 0xf3f0e4, { at: [-0.06, 0.19, -0.04], vary: 0 }),
    part(G.cyl(0.02, 0.008, 0.12, 5), 0xff8a1c, { at: [-0.02, 0.2, 0.06], rot: [1.3, 0.4, 0], vary: 0 }), part(G.cyl(0.02, 0.008, 0.12, 5), 0xff8a1c, { at: [0.06, 0.2, -0.05], rot: [1.3, 2.1, 0], vary: 0 }),
  ], M.matte, false, false);
  bowl.add(salad);
  stages[1].group.add(bowl);
  let bowlSlide = 0;
  {
    const c = MAZE.rabbit.card;
    stages[1].solid.push(part(G.cyl(0.02, 0.03, 0.95, 5), PAL.wood, { at: [c.x, 0.47, c.z] }));
    stages[1].solid.push(part(G.box(0.3, 0.4, 0.015), 0xf6f2e6, { at: [c.x, 1.05, c.z], rot: [-0.25, 0, 0], vary: 0.05 }));
    for (let i = 0; i < 4; i++) stages[1].solid.push(part(G.box(0.2 - (i % 2) * 0.05, 0.012, 0.004), 0x3a2c20, { at: [c.x, 1.15 - i * 0.07, c.z + 0.012 + i * 0.018], rot: [-0.25, 0, 0], vary: 0 }));
  }

  // The leaf mat over the bramble pit: the same ground as any dead end until it gives way.
  const pit = MAZE.pit;
  const mat = (() => {
    const g = new THREE.CircleGeometry(pit.r + 0.25, 28, 0, Math.PI * 2).rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      groundTone(pit.x + p.getX(i), pit.z + p.getZ(i), false, _c);
      col.set([_c.r, _c.g, _c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const parts = [g];
    const LEAVES = [0x9a6a3a, 0x7c5a34, 0xa87a40, 0x6e5636];
    for (let i = 0; i < 70; i++) {
      const a = rr(0, 6.283);
      const r = Math.sqrt(rnd()) * (pit.r + 0.2);
      parts.push(part(G.plane(0.2, 0.13), LEAVES[i % 4], { at: [Math.cos(a) * r, 0.012 + rnd() * 0.01, Math.sin(a) * r], rot: [rr(-0.2, 0.2), rr(0, 6), rr(-0.2, 0.2)], scale: rr(0.9, 1.6), vary: 0.2 }));
    }
    const m = bake(parts, M.leaf, false, true);
    m.position.set(pit.x, 0.004, pit.z);
    stages[2].group.add(m);
    return m;
  })();
  let pitOpen = 0;

  // The Bat's three lanterns on their chains.
  const lamps = MAZE.bat.lanterns.map((l, i) => ({ ...l, i, at: l.y, v: 0, glow: 1, sway: 0, state: 'hung', left: 0 }));
  const s3 = stages[3].group;
  const frameMesh = inst(s3, S.merge([
    part(G.cone(0.2, 0.16, 4), IRON, { at: [0, 0.2, 0], vary: 0.1 }), part(G.box(0.24, 0.03, 0.24), IRON, { at: [0, -0.16, 0], vary: 0.1 }),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => part(G.box(0.02, 0.3, 0.02), IRON, { at: [x * 0.1, 0, z * 0.1], vary: 0 })),
    part(G.torus(0.04, 0.01, 4, 8), IRON, { at: [0, 0.3, 0], vary: 0 }),
  ]), M.metal, lamps.length, true);
  const glassMesh = inst(s3, G.box(0.19, 0.28, 0.19), new THREE.MeshBasicMaterial({ color: 0xffffff }), lamps.length);
  const chainMesh = inst(s3, G.cyl(0.012, 0.012, 1, 4).translate(0, -0.5, 0), new THREE.MeshStandardMaterial({ color: IRON, roughness: 0.5, metalness: 0.6 }), lamps.length);
  // C5: the pool fades from its middle to nothing at the lantern radius (logic/courtlook.js
  // poolAt), a glow on the litter rather than a flat disc of light.
  const poolGeo = new THREE.RingGeometry(0, 1, 28, 8).rotateX(-Math.PI / 2);
  {
    const q = poolGeo.attributes.position;
    const col = new Float32Array(q.count * 3);
    for (let i = 0; i < q.count; i++) col.fill(poolAt(Math.hypot(q.getX(i), q.getZ(i))) / poolAt(0), i * 3, i * 3 + 3);
    poolGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const poolMesh = inst(s3, poolGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), lamps.length);
  const lampLights = lamps.map(() => {
    const l = new THREE.PointLight(PAL.lantern, 0, LANTERN_LIGHT.distance, LANTERN_LIGHT.decay); // C5: inverse-square, to 6 m
    l.position.set(0, -20, 0);
    group.add(l); // always in the scene, so the light count never changes
    return l;
  });
  const LANTERN = new THREE.Color(PAL.lantern);
  const lanternR = cfg.bat ? cfg.bat.lanternRadius : 4;
  const lanternTime = cfg.bat ? cfg.bat.lanternTime : 20;

  // The tin cup on its stone in the stream.
  const cupAt = lootAt('cup');
  const cup = bake([
    part(G.cyl(0.07, 0.055, 0.12, 10, true), 0xb8bcc0, { at: [0, 0.06, 0], vary: 0.2 }), part(G.disc(0.055, 10), 0x8a8e92, { at: [0, 0.004, 0], vary: 0.1 }),
    part(G.torus(0.035, 0.008, 4, 8, Math.PI), 0xb8bcc0, { at: [0.07, 0.06, 0], rot: [0, 0, -Math.PI / 2], vary: 0.1 }),
  ], new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide }));
  if (cupAt) cup.position.set(cupAt.x, 0.335, cupAt.z);
  stages[4].group.add(cup);
  // The note under the cup (R24): a folded paper on the stone, its corners showing round the
  // cup until the cup is taken.
  {
    const n = MAZE.cupNote;
    const turn = 0.5;
    stages[4].flat.push(part(G.box(0.24, 0.004, 0.17), 0xe8e2d0, { at: [n.x + 0.02, 0.334, n.z + 0.01], rot: [0, turn, 0], vary: 0.06 }));
    stages[4].flat.push(part(G.box(0.24, 0.003, 0.004), 0xb9b29c, { at: [n.x + 0.02, 0.3365, n.z + 0.01], rot: [0, turn, 0], vary: 0 })); // the fold
    for (let i = 0; i < 5; i++) {
      const off = -0.06 + i * 0.03;
      stages[4].flat.push(part(G.box(0.19 - (i % 3) * 0.03, 0.002, 0.006), 0x3a2c20, { at: [n.x + 0.02 + Math.sin(turn) * off, 0.337, n.z + 0.01 + Math.cos(turn) * off], rot: [0, turn, 0], vary: 0 }));
    }
  }

  // The Caterpillar's long clay pipe, the coal in its bowl, and the smoke that lies over the glade.
  const pipe = MAZE.caterpillar.pipe;
  const home = MAZE.caterpillar.home;
  stages[4].solid.push(part(limb([pipe.x, pipe.y - 0.05, pipe.z], [home.x - 0.25, pipe.y + 0.12, home.z], 0.022, 0.014, 6), 0xe8dfd0, { vary: 0.1 }));
  stages[4].solid.push(part(G.cyl(0.085, 0.06, 0.17, 10), 0xe8dfd0, { at: [pipe.x, pipe.y, pipe.z], vary: 0.1 }));
  const ember = new THREE.Mesh(G.disc(0.07, 10), new THREE.MeshBasicMaterial({ color: 0xff6a1f }));
  ember.position.set(pipe.x, pipe.y + 0.09, pipe.z);
  stages[4].group.add(ember);
  const smokeR = cfg.caterpillar ? cfg.caterpillar.smokeRadius : 7;
  const clearTime = cfg.caterpillar ? cfg.caterpillar.clearTime : 2;
  // C8: soft camera-facing puffs with a ragged radial falloff (the kit's puffTexture), drifting
  // slowly round the glade; never solid blobs.
  const smokeMesh = inst(stages[4].group, new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ color: 0x8e8a98, map: S.puffTexture(), transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }), SMOKE);
  const puffs = Array.from({ length: SMOKE }, (_, i) => ({ a: rr(0, 6.283), r: Math.sqrt((i + 0.5) / SMOKE) * smokeR * 0.95, y: rr(0.3, 2.0), s: rr(1.1, 2.3), o: rr(0, 9), w: rr(0.05, 0.16) * (rnd() < 0.5 ? -1 : 1) }));
  let smoke = 1;
  let smokeLift = 0;

  // ---- halberds lying where guards fell (sim.waves.dropped), until one is taken ----------------
  const halberdMesh = (() => {
    const ash = 0x5a4632;
    const steel = 0x9aa3ab;
    // Lying along +X, the head at the far end, the blade flat on the grass.
    const blade = new THREE.Shape();
    blade.moveTo(0, 0.02); blade.lineTo(0.3, 0.02); blade.quadraticCurveTo(0.36, 0.2, 0.26, 0.3); blade.quadraticCurveTo(0.14, 0.2, 0.02, 0.24); blade.lineTo(0, 0.02);
    const hook = new THREE.Shape();
    hook.moveTo(0.06, -0.02); hook.lineTo(0.22, -0.02); hook.lineTo(0.2, -0.17); hook.quadraticCurveTo(0.14, -0.08, 0.06, -0.06); hook.lineTo(0.06, -0.02);
    const flatOf = (shape) => S.tint(new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0.78, 0.022, 0), steel, 0.2, 2);
    return inst(s0.group, S.merge([
      part(G.cyl(0.02, 0.023, 2.1, 6), ash, { at: [0, 0.028, 0], rot: [0, 0, Math.PI / 2], vary: 0.3 }),
      part(G.cyl(0.026, 0.026, 0.34, 6), steel, { at: [0.95, 0.028, 0], rot: [0, 0, Math.PI / 2], vary: 0.15 }), // the socket
      part(G.cone(0.03, 0.36, 4), steel, { at: [1.28, 0.028, 0], rot: [0, 0, -Math.PI / 2], scale: [1, 1, 0.5], vary: 0.15 }), // the top spike
      part(G.cyl(0.028, 0.02, 0.08, 6), steel, { at: [-1.07, 0.028, 0], rot: [0, 0, Math.PI / 2], vary: 0.15 }), // the butt cap
      flatOf(blade), flatOf(hook),
    ]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide }), HALBERDS, true);
  })();

  // ---- the Hatter's display (R19): a deal stand and its shelf, a rail of five turned pegs, the
  // card, and five hats of plainly different shapes, each with its price tag on the brim ---------
  const hatWords = hatTexture();
  const hatMat = new THREE.MeshStandardMaterial({ map: hatWords.texture, vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide });
  /** Gives every vertex of an unlettered part the canvas's blank patch. */
  const plain = (geo) => {
    const n = geo.attributes.position.count;
    const uv = new Float32Array(n * 2);
    const u = (hatWords.blank[0] + hatWords.blank[2]) / 2;
    const v = (hatWords.blank[1] + hatWords.blank[3]) / 2;
    for (let i = 0; i < n; i++) uv.set([u, v], i * 2);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  };
  /** An upright lettered card w by h, facing +Z, showing rectangle `r` of the canvas. */
  const lettered = (w, h, r, o) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
    return part(g, 0xffffff, { vary: 0, ...o });
  };
  const HT = MAZE.hatter;
  const shelfY = HT.stand.h; // the shelf's top
  const pegY = HT.pegs[0].y;
  {
    const st = HT.stand;
    const deal = 0xc9a878;
    const dark = 0x8a6a44;
    const fixed = [
      plain(part(G.box(st.w, 0.05, st.d), deal, { at: [st.x, shelfY - 0.025, st.z], vary: 0.25, seed: 2 })),
      plain(part(G.box(st.w - 0.2, 0.04, st.d - 0.1), deal, { at: [st.x, 0.3, st.z], vary: 0.25, seed: 3 })),
      plain(part(G.box(st.w - 0.1, 0.5, 0.03), deal, { at: [st.x, shelfY + 0.25, st.minZ + 0.03], vary: 0.25, seed: 4 })), // the back board
    ];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) fixed.push(plain(part(G.box(0.07, shelfY - 0.05, 0.07), dark, { at: [st.x + sx * (st.w / 2 - 0.08), (shelfY - 0.05) / 2, st.z + sz * (st.d / 2 - 0.07)], vary: 0.25 })));
    // The rail: a board on two posts along the hedge, a turned peg and its knob for each place.
    const x0 = Math.min(...HT.pegs.map((q) => q.x)) - 0.4;
    const x1 = Math.max(...HT.pegs.map((q) => q.x)) + 0.4;
    const railZ = HT.pegs[0].z - 0.14;
    fixed.push(plain(part(G.box(x1 - x0, 0.16, 0.035), deal, { at: [(x0 + x1) / 2, pegY, railZ], vary: 0.25, seed: 5 })));
    for (const x of [x0 + 0.12, x1 - 0.12]) fixed.push(plain(part(G.box(0.08, pegY + 0.1, 0.06), dark, { at: [x, (pegY + 0.1) / 2, railZ - 0.03], vary: 0.25 })));
    for (const q of HT.pegs) {
      fixed.push(plain(part(G.cyl(0.016, 0.022, 0.15, 8), dark, { at: [q.x, q.y, railZ + 0.09], rot: [Math.PI / 2, 0, 0], vary: 0.2 })));
      fixed.push(plain(part(G.ball(0.03, 8, 6), dark, { at: [q.x, q.y, railZ + 0.17], vary: 0.2 })));
    }
    // The card, on a small easel at the end of the stand.
    const cd = HT.card;
    fixed.push(plain(part(G.box(0.05, cd.y + 0.02, 0.05), dark, { at: [cd.x, (cd.y + 0.02) / 2, cd.z - 0.05], vary: 0.25 })));
    fixed.push(plain(part(G.box(0.5, 0.3, 0.012), 0xe8e2d0, { at: [cd.x, cd.y + 0.16, cd.z - 0.012], rot: [-0.22, 0, 0], vary: 0.05 })));
    fixed.push(lettered(0.46, 0.25, hatWords.card, { at: [cd.x, cd.y + 0.16, cd.z - 0.003], rot: [-0.22, 0, 0] }));
    const m = new THREE.Mesh(mergeMapped(fixed), hatMat);
    m.castShadow = true;
    m.receiveShadow = true;
    stages[2].group.add(m);
  }
  // The five hats, brim centre at the origin, by shelf place (hats.js HATS): a bowler, a flat
  // cap, a tall silk hat, a straw boater and a wide slouch hat with a feather.
  const hatShapes = [
    () => [ // 7/6: the bowler
      part(new THREE.SphereGeometry(0.105, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), 0x2a2420, { at: [0, 0.01, 0], scale: [1, 1.05, 1.12], vary: 0.12 }),
      part(G.torus(0.135, 0.016, 5, 18), 0x2a2420, { at: [0, 0.012, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1.1], vary: 0.12 }),
      part(G.cyl(0.108, 0.108, 0.02, 14, true), 0x4a3a30, { at: [0, 0.03, 0], scale: [1, 1, 1.12], vary: 0.05 }),
    ],
    () => [ // 2/6: the flat cap
      part(new THREE.SphereGeometry(0.125, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x8a7a58, { at: [0, 0, -0.01], scale: [1, 0.42, 1.15], vary: 0.3, seed: 5 }),
      part(G.cyl(0.11, 0.11, 0.008, 12), 0x6a5c40, { at: [0, 0.004, 0.1], scale: [0.9, 1, 0.7], vary: 0.2 }), // the peak
      part(G.ball(0.014, 6, 4), 0x6a5c40, { at: [0, 0.054, -0.01], vary: 0 }),
    ],
    () => [ // 12/6: the tall silk hat
      part(G.cyl(0.1, 0.092, 0.24, 16), 0x15141a, { at: [0, 0.125, 0], vary: 0.08 }),
      part(G.cyl(0.165, 0.165, 0.012, 18), 0x15141a, { at: [0, 0.006, 0], scale: [1, 1, 1.08], vary: 0.08 }),
      part(G.cyl(0.095, 0.095, 0.035, 16, true), 0x5a2a22, { at: [0, 0.03, 0], vary: 0.05 }),
    ],
    () => [ // 5/-: the straw boater
      part(G.cyl(0.1, 0.1, 0.075, 16), 0xd9c27a, { at: [0, 0.045, 0], vary: 0.18, seed: 7 }),
      part(G.cyl(0.17, 0.17, 0.01, 18), 0xd9c27a, { at: [0, 0.005, 0], vary: 0.18, seed: 8 }),
      part(G.cyl(0.102, 0.102, 0.03, 16, true), 0x26324a, { at: [0, 0.028, 0], vary: 0.05 }),
    ],
    () => [ // 10/6: the slouch hat and its feather
      part(G.cyl(0.07, 0.1, 0.13, 12), 0x4a5a3a, { at: [0, 0.07, 0], scale: [1, 1, 1.15], vary: 0.2, seed: 9 }),
      part(G.cyl(0.2, 0.2, 0.012, 18), 0x4a5a3a, { at: [0, 0.008, 0], rot: [0.06, 0, 0.14], scale: [1, 1, 1.05], vary: 0.2, lump: 0.012, freq: 9 }),
      part(G.cone(0.028, 0.3, 4), 0xb3121b, { at: [-0.1, 0.16, -0.02], rot: [0.5, 0, 0.5], scale: [1, 1, 0.3], vary: 0.2 }),
    ],
  ];
  const hats = HATS.map((hat, i) => {
    const parts = hatShapes[i]().map(plain);
    // The tag hangs off the brim on a thread, facing the glade.
    parts.push(plain(part(G.box(0.004, 0.06, 0.004), 0xe8e2d0, { at: [0.13, -0.02, 0.1], vary: 0 })));
    parts.push(lettered(0.15, 0.098, hatWords.tag[i], { at: [0.13, -0.095, 0.103], rot: [0.12, 0, 0.06] }));
    const mesh = new THREE.Mesh(mergeMapped(parts), hatMat);
    mesh.castShadow = true;
    const home = HT.hats[i];
    mesh.position.set(home.x, shelfY + HAT_LIFT, home.z + 0.05);
    stages[2].group.add(mesh);
    return { mesh, peg: -2, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, rock: 0, tumble: 0, tilt: 0 };
  });
  /** Where hat i rests: on the shelf (peg < 0; raised so its tag hangs clear), or on peg `peg`. */
  function hatRest(i, peg, out) {
    if (peg < 0) return out.set(HT.hats[i].x, shelfY + HAT_LIFT, HT.hats[i].z + 0.05);
    return out.set(HT.pegs[peg].x, pegY + 0.03, HT.pegs[peg].z + 0.1);
  }
  // Each shelf place has a short block the hat sits on, so the tag can hang in front of it.
  {
    const blocks = HT.hats.map((h, i) => part(G.cyl(0.07, 0.085, HAT_LIFT, 10), 0xb89868, { at: [h.x, shelfY + HAT_LIFT / 2, h.z + 0.05], vary: 0.2, seed: i }));
    stages[2].solid.push(...blocks);
  }

  // ---- one-shots: droplets, splinters, leaves, and the drops that fall from the statue's wings --
  const moteMesh = inst(group, G.ico(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), MOTES);
  const motes = Array.from({ length: MOTES }, () => ({ x: 0, y: -30, z: 0, vx: 0, vy: 0, vz: 0, life: 0, s: 0.02, floor: 0 }));
  let moteNext = 0;
  function burst(x, y, z, n, hex, speed = 1.6, size = 0.025, floor = 0) {
    for (let i = 0; i < n; i++) {
      const m = motes[moteNext];
      moteMesh.setColorAt(moteNext, _c.setHex(hex));
      moteNext = (moteNext + 1) % MOTES;
      const a = Math.random() * 6.283;
      const h = speed * (0.3 + Math.random() * 0.7);
      Object.assign(m, { x, y, z, vx: Math.cos(a) * h, vz: Math.sin(a) * h, vy: speed * (0.6 + Math.random()), life: 0.9, s: size * (0.6 + Math.random() * 0.8), floor });
    }
    moteMesh.instanceColor.needsUpdate = true;
  }
  const dripMesh = inst(s0.group, G.ico(1, 1), redMat, DRIPS);
  const drips = Array.from({ length: DRIPS }, (_, i) => ({ t: -i * 0.37, y: 0, src: null }));
  let weep = null; // { x, z, left }: a valve wheel weeping one red drop at a time (the roses' nudge)

  // ---- bake each stage's fixed parts ---------------------------------------------------------------
  for (const st of stages) {
    if (st.solid.length) st.group.add(bake(st.solid, M.matte));
    if (st.flat.length) st.group.add(bake(st.flat, M.matte, false, true));
    if (st.metal.length) st.group.add(bake(st.metal, M.metal));
  }

  // ---- per frame ---------------------------------------------------------------------------------
  let last = null; // the sim last drawn
  let lastTime = -1;
  let snap = true; // jump to the state instead of easing (a new run, a restore)

  function findEnemy(sim, type) {
    return sim && sim.enemies ? sim.enemies.find((e) => e.type === type && !e.dead) || null : null;
  }

  function sync(sim, dt, time, eye) {
    const live = !!(sim && sim.cfg && sim.cfg.room === 'court' && sim.waves && sim.waves.done);
    const w = live ? sim.waves : IDLE;
    if (sim !== last || (live && sim.stats && sim.stats.time < lastTime)) snap = true;
    last = sim;
    lastTime = live && sim.stats ? sim.stats.time : -1;
    if (!rig.root.visible) return;
    const at = eye || rig.eye;
    const here = stageAt(at.x, at.z);
    stages.forEach((st, k) => { st.group.visible = Math.abs(k - here) <= 1; });
    const ease = (cur, goal, seconds) => (snap ? goal : toward(cur, goal, dt / seconds));

    // Valves, rills, beds, fountain, briar.
    for (let i = 0; i < 4; i++) {
      valveOpen[i] = ease(valveOpen[i], w.valves[i] ? 1 : 0, w.valves[i] ? 0.9 : 0.35); // a slam is quick
      valveShake[i] = Math.max(0, valveShake[i] - dt);
      const v = COURT.valves[i];
      put(wheelMesh, i, v.x, 0.98 + 0.01 * Math.sin(valveShake[i] * 60) * valveShake[i], v.z, 1, 1, 1, valveOpen[i] * Math.PI * 3);
      // The bed: opens and reddens once its water has landed; closes and pales when it is cut.
      const fed = !!w.beds[i] && !((w.flows || NO_FLOWS)[FEEDER[i]] > 0);
      bedLevel[i] = ease(bedLevel[i], fed ? 1 : 0, flushTime);
    }
    wheelMesh.instanceMatrix.needsUpdate = true;
    drawBeds();
    poolLevel = ease(poolLevel, w.done.roses ? 1 : 0, 4);
    pool.visible = poolLevel > 0.01;
    pool.position.y = FOUNTAIN.floorY + 0.02 + (FOUNTAIN.rimY - 0.16 - FOUNTAIN.floorY) * poolLevel;
    flash = Math.max(0, flash - dt * 1.6);
    redMat.emissive.setRGB(0.5 * flash, 0.06 * flash, 0.05 * flash);
    briarOpen = ease(briarOpen, w.done.roses ? 1 : 0, 2.2);
    for (const b of briar) {
      const e = briarOpen * briarOpen * (3 - 2 * briarOpen);
      b.m.scale.set(1 - 0.9 * e, 1 - 0.25 * e, 1);
      b.m.position.x = COURT.briar.x + b.side * b.half * 0.98 * e;
      b.m.visible = here <= 1;
    }
    const lootTaken = (key) => {
      const i = lootIndex(key);
      return i < 0 || !!(w.loot && w.loot[i] && w.loot[i].taken);
    };
    bow.visible = !lootTaken('crossbow');

    // Drops from the statue's wings once the fountain runs; one at a time from a weeping wheel.
    if (weep) {
      weep.left -= dt;
      if (weep.left <= 0 || w.done.roses) weep = null;
    }
    drips.forEach((d, i) => {
      const src = w.done.roses ? FOUNTAIN.wingTips[i % FOUNTAIN.wingTips.length] : (weep && i === 0 ? [weep.x + 0.2, 0.9, weep.z] : null);
      d.t += dt * (w.done.roses ? 1.1 : 0.45);
      if (d.t >= 1 || (!d.src && src && d.t >= 0)) { d.t = 0; d.src = src; }
      if (!d.src || d.t < 0) { put(dripMesh, i, 0, -30, 0, 0.001); return; }
      const hang = Math.min(1, d.t / 0.45);
      const fall = Math.max(0, d.t - 0.45);
      const y = d.src[1] - 0.03 * hang - 4.9 * fall * fall * 4;
      const floor = w.done.roses ? pool.position.y : 0.03;
      if (y < floor) { d.src = null; put(dripMesh, i, 0, -30, 0, 0.001); return; }
      put(dripMesh, i, COURT.fountain.x * (w.done.roses ? 1 : 0) + d.src[0], y, COURT.fountain.z * (w.done.roses ? 1 : 0) + d.src[2], 0.012 + 0.012 * hang, (0.012 + 0.012 * hang) * (1 + fall * 5));
    });
    dripMesh.instanceMatrix.needsUpdate = true;

    // Stakes: found ones not yet taken, then every fired one where the state says it lies.
    let nf = 0;
    let nw = 0;
    const stake = (worn, x, y, z, rx, rz, ry = 0) => {
      const mesh = worn ? wornMesh : freshMesh;
      const i = worn ? nw++ : nf++;
      if (i >= STAKES) return;
      put(mesh, i, x, y, z, 1, 1, 1, ry, rx, rz);
      mesh.setColorAt(i, worn ? WORN : FRESH);
    };
    for (const [key, x, y, z, rx, rz] of waiting) if (!lootTaken(key)) stake(false, x, y, z, rx, rz);
    for (const s of w.stakes || []) {
      const h = (s.id * 2.399) % 6.283; // a turn that is the stake's own
      if (s.state === 'lodged') {
        // In a live figure: drawn where it struck, by the record's own position (cast.js draws none).
        stake(s.worn, s.x, Math.max(0, s.y - 0.1), s.z, 1.25, 0, h);
      } else if (s.state === 'body') stake(s.worn, s.x, Math.max(0.02, s.y - 0.25), s.z, 0.5, 0.25, h);
      else stake(s.worn, s.x, Math.max(0, s.y - 0.12), s.z, s.y > 0.3 ? 1.2 : 0.4, 0.15, h);
    }
    for (let i = nf; i < STAKES; i++) put(freshMesh, i, 0, -30, 0, 0.001);
    for (let i = nw; i < STAKES; i++) put(wornMesh, i, 0, -30, 0, 0.001);
    for (const m of [freshMesh, wornMesh]) {
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }

    // Gates.
    for (let b = 0; b < 4; b++) gateOpen[b] = ease(gateOpen[b], w.done.gates[b] ? 1 : 0, 1.6);
    drawGates();

    // Patches show their bulbs and roots while there is something to pick.
    for (const p of patches) p.mesh.visible = (w.items[p.kind] || 0) < p.gives;

    // The bowl: empty at the far end; mixed, he pulls it to him.
    const rabbit = findEnemy(sim, 'rabbit');
    const fed = live && ((rabbit && rabbit.fed) || w.done.gates[0]);
    bowlSlide = ease(bowlSlide, fed ? 1 : 0, 0.7);
    const bw = MAZE.rabbit.bowl;
    bowl.position.set(bw.x + (MAZE.rabbit.chair.x + 1.1 - bw.x) * bowlSlide, tableY, bw.z);
    salad.visible = !!(rabbit && rabbit.fed);

    // The pit's mat drops in, and stays in.
    pitOpen = ease(pitOpen, w.done.pitOpen ? 1 : 0, 0.35);
    mat.visible = pitOpen < 0.999;
    mat.position.y = 0.004 - pit.depth * pitOpen * pitOpen;
    mat.scale.setScalar(1 - 0.45 * pitOpen);

    // Lanterns: hung and lit; shot down, a pool of light for as long as the oil lasts; then dark.
    const bat = findEnemy(sim, 'bat');
    lamps.forEach((l, i) => {
      const s = bat && Array.isArray(bat.lanterns) ? bat.lanterns[i] : null;
      if (s) l.state = s.down > 0 ? 'down' : s.spent ? 'spent' : 'hung';
      else if (l.state === 'down') {
        l.left -= dt;
        if (l.left <= 0) l.state = 'spent';
      }
      if (l.state === 'hung') { l.at = l.y; l.v = 0; } else if (snap) l.at = 0.19;
      else if (l.at > 0.19) {
        l.v += 9.8 * dt;
        l.at = Math.max(0.19, l.at - l.v * dt);
      }
      l.glow = ease(l.glow, l.state === 'spent' ? 0 : 1, 0.8);
      l.sway = Math.max(0, l.sway - dt);
      const sw = l.state === 'hung' ? Math.sin(time * 3.1 + i) * (0.02 + 0.2 * Math.min(1, l.sway)) : 0;
      const fl = l.glow * (0.9 + 0.1 * Math.sin(time * 11 + i * 2) * Math.sin(time * 4.3 + i));
      const lx = l.x + sw * (l.chainY - l.y);
      put(frameMesh, i, lx, l.at, l.z, 1, 1, 1, i, 0, l.state === 'hung' ? -sw : 0.35);
      put(glassMesh, i, lx, l.at, l.z, 1, 1, 1, i, 0, l.state === 'hung' ? -sw : 0.35);
      glassMesh.setColorAt(i, _c.copy(LANTERN).multiplyScalar(0.12 + 0.88 * fl));
      const len = l.state === 'hung' ? l.chainY - l.y - 0.3 : (l.chainY - l.y) * 0.4; // a cut chain keeps its upper links
      put(chainMesh, i, l.x, l.chainY, l.z, 1, len, 1, 0, 0, l.state === 'hung' ? -sw : Math.sin(time * 2 + i) * 0.08);
      const lit = l.state === 'down' && l.at <= 0.2 ? fl : 0;
      put(poolMesh, i, l.x, 0.02, l.z, lit > 0 ? lanternR : 0.001);
      poolMesh.setColorAt(i, _c.copy(LANTERN).multiplyScalar(poolAt(0) * lit));
      lampLights[i].position.set(lx, l.at + (l.state === 'hung' ? 0.25 : LANTERN_LIGHT.lift), l.z); // C5: a fallen one's light sits above its glass, so the floor beside it is lit, not blown
      lampLights[i].intensity = stages[3].group.visible ? (l.state === 'down' ? LANTERN_LIGHT.down : LANTERN_LIGHT.hung) * fl : 0;
    });
    for (const m of [frameMesh, glassMesh, chainMesh, poolMesh]) m.instanceMatrix.needsUpdate = true;
    glassMesh.instanceColor.needsUpdate = true;
    poolMesh.instanceColor.needsUpdate = true;

    // The cup stays on its stone until it is taken.
    cup.visible = !lootTaken('cup');

    // Dropped halberds: where each guard fell, turned its own way, until taken.
    let nh = 0;
    for (const d of w.dropped || []) {
      if (d.taken || nh >= HALBERDS) continue;
      put(halberdMesh, nh++, d.x, 0, d.z, 1, 1, 1, ((d.id || 0) * 2.399 + 0.7) % 6.283);
    }
    for (let i = nh; i < HALBERDS; i++) put(halberdMesh, i, 0, -30, 0, 0.001);
    halberdMesh.instanceMatrix.needsUpdate = true;

    // The hats: on the shelf or on the peg the state names; a set hat hops across, a fallen
    // row tumbles back, and the hinted one rocks where it sits.
    if (stages[2].group.visible) {
      const pegs = (w.hats && w.hats.pegs) || NO_PEGS;
      hats.forEach((h, i) => {
        const peg = pegs.indexOf(i);
        if (peg !== h.peg) {
          h.from.copy(h.mesh.position);
          hatRest(i, peg, h.to);
          h.t = snap || h.peg === -2 ? 1 : 0;
          h.peg = peg;
          if (peg >= 0) h.rock = 0;
        }
        if (snap) { h.t = 1; h.rock = 0; h.tumble = 0; }
        h.t = Math.min(1, h.t + dt / 0.45);
        const k = smooth(h.t);
        h.mesh.position.lerpVectors(h.from, h.to, k);
        h.mesh.position.y += 0.3 * Math.sin(Math.PI * k) * (h.t < 1 ? 1 : 0);
        h.rock = Math.max(0, h.rock - dt);
        if (h.t >= 1) h.tumble = 0;
        const rock = h.rock > 0 ? Math.sin(time * 9) * 0.22 * Math.min(1, h.rock) : 0;
        // On a peg the hat hangs tipped out from the rail, its crown toward the glade; in the air a fallen one turns over.
        h.tilt = ease(h.tilt, h.peg >= 0 ? 0.5 : 0, 0.45);
        h.mesh.rotation.set(h.tilt + h.tumble * Math.sin(Math.PI * k) * 2.2, 0, rock);
      });
    }

    // Smoke while the pipe is lit: over the whole glade, thinning in two seconds once doused.
    const cat = findEnemy(sim, 'caterpillar');
    const lit = !w.done.gates[3] && !(cat && cat.doused);
    // While the Caterpillar lives its own smoke value (1, then down to 0 over clearTime once
    // doused) is the density, so the smoke and his untouchable spell end together.
    const ruled = cat && !w.done.gates[3] && typeof cat.smoke === 'number' && cat.state !== 'still';
    smoke = ruled && !snap ? Math.min(cat.smoke, ease(smoke, cat.smoke, 1.5)) : ease(smoke, lit ? 1 : 0, lit ? 1.5 : clearTime);
    smokeLift = lit ? 0 : Math.min(3, smokeLift + dt * 1.2);
    ember.visible = lit;
    ember.material.color.setRGB(1, 0.3 + 0.15 * Math.sin(time * 5), 0.08);
    smokeMesh.visible = smoke > 0.01;
    if (smokeMesh.visible) {
      puffs.forEach((p, i) => {
        const a = p.a + time * p.w;
        const bob = Math.sin(time * 0.6 + p.o) * 0.25;
        const px = home.x + Math.cos(a) * p.r; const pz = home.z + Math.sin(a) * p.r;
        const face = Math.atan2(at.x - px, at.z - pz); // turned to the eye
        const sz = p.s * smoke * (1 + 0.12 * Math.sin(time * 0.4 + p.o));
        put(smokeMesh, i, px, p.y + bob + smokeLift, pz, sz, sz * 0.75, sz, face, 0, p.o);
      });
      smokeMesh.instanceMatrix.needsUpdate = true;
    }

    // One-shots.
    for (let i = 0; i < MOTES; i++) {
      const m = motes[i];
      if (m.life <= 0) { put(moteMesh, i, 0, -30, 0, 0.001); continue; }
      m.life -= dt;
      m.vy -= 9.8 * dt;
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
      if (m.y < m.floor) m.life = 0;
      put(moteMesh, i, m.x, m.y, m.z, m.s);
    }
    moteMesh.instanceMatrix.needsUpdate = true;
    snap = false;
  }

  function onEvent(ev) {
    const sim = last;
    switch (ev.type) {
      case 'restored':
        clear();
        break;
      case 'valveTurn':
        burst(ev.x, 0.2, ev.z, 5, PAL.wetRed, 1.2);
        break;
      case 'valveSlam':
        if (ev.index >= 0 && ev.index < 4) valveShake[ev.index] = 0.5;
        break;
      case 'rosesSolved':
        if (!reduced) flash = 1;
        burst(COURT.fountain.x, FOUNTAIN.rimY + 1.2, COURT.fountain.z, 10, PAL.wetRed, 2.2, 0.03, FOUNTAIN.floorY);
        break;
      case 'nudge': {
        const fallen = sim && sim.waves && (sim.waves.bodies || []).some((b) => b.enemy === 'gardener');
        if (ev.puzzle === 'roses' && sim && sim.waves && sim.waves.phase !== 'still' && !fallen) weep = { x: ev.x, z: ev.z, left: 40 };
        if (ev.puzzle === 'bat') for (const l of lamps) if (l.state === 'hung') l.sway = 6;
        if (ev.puzzle === 'hats' && hats[ev.hat]) hats[ev.hat].rock = 4; // the cheapest hat on the shelf rocks
        break;
      }
      case 'stakeBreak':
        burst(ev.x, (ev.y || 0) + 0.3, ev.z, 8, 0x8a745a, 1.3, 0.02);
        break;
      case 'itemTake':
        if (ev.item === 'garlic' || ev.item === 'carrot') burst(ev.x, 0.1, ev.z, 5, 0x3a2c20, 1.1, 0.02);
        break;
      case 'itemUse':
        if (ev.item === 'cup') burst(ev.x, ev.at === 'pipe' ? MAZE.caterpillar.pipe.y : 0.05, ev.z, 7, ev.at === 'pipe' ? 0xe8e2d0 : 0x9fc4d8, 1.4, 0.02);
        break;
      case 'lanternFall': {
        const l = lamps[ev.index];
        if (l && l.state === 'hung') {
          l.state = 'down';
          l.left = lanternTime;
          l.v = 0;
        }
        break;
      }
      case 'doused':
        burst(MAZE.caterpillar.pipe.x, MAZE.caterpillar.pipe.y + 0.1, MAZE.caterpillar.pipe.z, 8, 0xe8e2d0, 1.0, 0.03);
        break;
      case 'pitFall':
        burst(ev.x, 0.1, ev.z, 10, 0x7c5a34, 1.8, 0.04, -MAZE.pit.depth);
        break;
      case 'gateOpen':
        burst(ev.x, 2.6, ev.z, 5, 0x8a4b2a, 0.8, 0.015);
        break;
      case 'waterArrive': {
        // The water lands at the bed: a small splash at the rill's far end.
        const r = heads[ev.index];
        if (r) burst(r.to.x, 0.08, r.to.z, 6, PAL.wetRed, 1.3, 0.022);
        break;
      }
      case 'halberdDrop':
        burst(ev.x, 0.06, ev.z, 4, 0x6a8a4a, 0.9, 0.018);
        break;
      case 'hatsFall':
        for (const h of hats) h.tumble = 1;
        break;
      case 'hatsSolved': {
        const p = MAZE.hatter.pegs[2];
        burst(p.x, p.y + 0.2, p.z + 0.1, 6, 0xe8e2d0, 0.9, 0.014);
        break;
      }
      default:
    }
  }

  /** Forgets every one-shot and eased value: the next sync draws the state as it stands. */
  function clear() {
    snap = true;
    weep = null;
    flash = 0;
    smokeLift = 0;
    for (const m of motes) m.life = 0;
    for (const d of drips) d.src = null;
    for (let i = 0; i < 4; i++) valveShake[i] = 0;
    for (const l of lamps) Object.assign(l, { state: 'hung', left: 0, v: 0, sway: 0, at: l.y });
    for (const h of hats) Object.assign(h, { rock: 0, tumble: 0 });
  }

  /**
   * What the bloom scene's camera needs, read from the state and never written: null when no
   * scene plays, else { kind, index, bed, from, to, front, head, flush, bedAt }. from and to are
   * the ends of the rill the turned valve feeds ({ x, z }, valve end first), head how far the
   * water has run (0 to 1) and front where that is; bedAt is the bed it runs to ({ x, z, size })
   * and flush how far that bed has opened and reddened (0 to 1) as drawn this frame.
   */
  function sceneView(sim) {
    const sc = sim && sim.waves && sim.waves.scene;
    const r = sc ? heads[sc.index] : null;
    if (!r) return null;
    const bed = FEEDS[sc.index];
    const head = frontOf(sim.waves, sc.index);
    const b = COURT.beds[bed];
    return {
      kind: sc.kind, index: sc.index, bed,
      from: { x: r.from.x, z: r.from.z }, to: { x: r.to.x, z: r.to.z }, head,
      front: { x: r.from.x + (r.to.x - r.from.x) * head, z: r.from.z + (r.to.z - r.from.z) * head },
      flush: bedLevel[bed], bedAt: { x: b.x, z: b.z, size: b.size },
    };
  }

  function setReducedFlash(v) {
    reduced = !!v;
  }

  return { group, sync, onEvent, clear, setReducedFlash, scene: sceneView };
}
