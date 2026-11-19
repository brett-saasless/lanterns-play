// The castle's shell, zone by zone: the exterior (the great house, twin gate towers, the open
// drawbridge with no rails over the dry pit), the hall and the first corridor, the tea room, the
// gallery over its crypt, the Knight's Walk, the stairs, the mirror room, the nursery and the
// Count's room. Also the light, which never holds still where there is flame and never moves
// where there is only the moon; the windows, the moon and the stars; which zones are drawn; the
// title fly-through; and the cameras of the two scenes. Stone comes from stone.js.
//
// Kept rooms are whole, vaulted or beamed, with a fire and a rug. The passages between are run
// down: open joints, damp at the foot of the wall, fallen mortar, a torch, a tattered red banner
// with a black bat-winged heart, and a carved fanged grin over the arch.
//
// Draw calls: each zone is a handful of merged meshes (stone, floor, fittings, cloth, glass,
// flames, glows); only the occupied zone and the zones through its doors are drawn. One spot
// light with the one shadow map is the zone's key (moon or fire); five point lights are shared
// out among the nearest flames. The light count never changes, so no shader is rebuilt in play.

import * as THREE from 'three';
import * as S from './sculpt.js';
import { glowTexture } from './cave.js';
import * as ST from './stone.js';
import * as KM from '../logic/keepmap.js';
import * as KEEP from '../logic/keep.js';
import { LEAF, SWING, doorHeight, leafFrameOf, leafPose, swingToward, IRON_GATE } from '../logic/doorleaves.js'; // the leaves' make and swing, shared with the collision (keep.js)
import { createRoadView } from './roadview.js'; // issue #29: the road up from the wood, and its evening
import { cutawayAt, CUTAWAY } from '../logic/cutaway.js'; // the werewolf cutaway: its run beat plays on the real front
import { buildDawnView, DAWN_SUN } from './dawnview.js'; // art pass K1: the sunrise out of the Count's windows
import { nightSky, SKY } from '../logic/nightsky.js'; // fix/wives-window: the moon and stars seen through a passage's slit
import { SIGHT } from '../logic/sightlines.js'; // fix/doorway-sky: which zones are in sight of which

const HUE = ST.STONE;
const INSET = 0; // walls stand just outside a zone's clear floor, as keepmap.js builds them
const WALL_T = KM.WALL.t;
const TAU = Math.PI * 2;
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };
const LOW_FPS = 45;
const LOW_FPS_HOLD = 3;
const SHADOW_SIZES = [0, 1024, 2048];
const POOL = 5; // point lights shared among the flames
const CRYPT_AMBIENT = 2.6; // the crypt's air after a fall: lighter than it was (1.4), under the tea room's 3.2 (#22)
const FIRELIGHT = 0xd8c8bc; // what a flame throws (art pass K4, owner Q11 'orange flames, cool stone'): a pale, nearly neutral light under the flame's own orange, so the stone is lit, not warmed
const FIRE_SHARE = 0.85; // K4: the flames' light at about 70% of what the cream light gave, so the stone keeps its cool cast and nothing clips
const PASSAGE_FIRE = 1.2; // K2: a passage's torches keep their old strength: they and the moon slit are all its light
// K3 (owner Q5, colder and darker upward): on the upper storey the moon-silver air takes over the
// stone and the fires' share of it falls, so the dawn gold is the only warmth up there
const COLD = { fire: 0.45, hemi: 0x8aa2b6, ground: 0x4a5668, hemiK: 3.2 };
export const TITLE_LOOP = 96; // seconds for one pass of the title fly-through


// ---- the plan ---------------------------------------------------------------------------------
// Read from logic/keepmap.js (zones, doors, the pit, the crypt, the board, the stairs, where the
// windows and the props stand), so what is drawn is what the rules walk on. This file adds only
// what the rules do not hold: how high a room is, what its ceiling is, and the house's outside.

const toR = (r) => ({ x0: r.minX, x1: r.maxX, z0: r.minZ, z1: r.maxZ });
const WIN = (rect, side, c, w, h, sill, more = {}) => ({ rect, side, c, w, h, sill, ...more });
const PASSAGE = { kind: 'passage', h: 3.0, ceil: { kind: 'vault', rise: 0.8, bay: 4 }, floor: 'flagWorn' };
// K2: where each passage's moon slit is cut: [rect, wall, along], on a stretch with no torch, across
// from the wives' painting and the banners the torches had to leave dark
const SLIT = (rect, side, c) => [WIN(rect, side, c, 0.5, 1.7, 1.1, { rise: 0.25, lights: 1, slit: true })];

function makePlan() {
  const zones = [
    { id: 'outside', kind: 'outside', y: 0, h: 0, rects: [], from: ['approach', 'bridge', 'forecourt'] },
    { id: 'hall', kind: 'room', h: 5, ceil: { kind: 'vault', rise: 3, along: 'z', bays: 3 }, floor: 'flag' },
    { id: 'cor1', ...PASSAGE, windows: SLIT(1, 's', 8.4) },
    { id: 'tea', kind: 'room', h: 6, ceil: { kind: 'beams', n: 7 }, floor: 'flag',
      windows: KM.WINDOWS.tea.map((w) => WIN(0, 'e', w.z, 1.5, 3.8, 1.3)) },
    { id: 'cor2', ...PASSAGE, windows: SLIT(1, 's', 3.5) },
    { id: 'gallery', kind: 'room', h: 6, ceil: { kind: 'vault', rise: 3.6, along: 'z', bays: 8 }, floor: 'marbleDark',
      windows: KM.WINDOWS.gallery.map((w) => WIN(0, 'e', w.z, 1.7, 4.6, 0.9)) },
    { id: 'cor3', ...PASSAGE, windows: SLIT(1, 's', 7.5) },
    { id: 'walk', kind: 'room', h: 6.5, ceil: { kind: 'vault', rise: 5, along: 'x', bays: 5 }, floor: 'flag',
      windows: KM.WINDOWS.walk.map((w) => WIN(0, 'e', w.z, 10, 9.6, 1.4, { rise: 4.2, lights: 4 })) },
    { id: 'stairs', kind: 'room', h: 9.2, ceil: { kind: 'slab' }, floor: 'flag' },
    { id: 'landing', kind: 'room', h: 4.2, ceil: { kind: 'slab' }, floor: 'flag' },
    { id: 'mirror', kind: 'room', h: 5, ceil: { kind: 'beams', n: 7 }, floor: 'flag' },
    { id: 'passage', ...PASSAGE },
    { id: 'nursery', kind: 'room', h: 4.4, ceil: { kind: 'beams', n: 5 }, floor: 'flag',
      windows: KM.WINDOWS.nursery.map((w) => WIN(0, 'w', w.z, 1.4, 3.2, 1.1)) },
    { id: 'countway', ...PASSAGE, windows: SLIT(0, 'e', -148.6) },
    { id: 'count', kind: 'room', h: 6, ceil: { kind: 'beams', n: 8 }, floor: 'flag',
      windows: KM.COUNT_ROOM.curtains.map((c) => WIN(0, 'e', c.z, 1.8, 4.2, 0.9, { lights: 1 })) }, // K12: one light each, so the dawn is one clear field
  ];
  for (const z of zones) {
    if (z.from) continue;
    const src = KM.ZONES.find((q) => q.id === z.id);
    z.y = src.y;
    z.rects = src.rects.map(toR);
  }
  const mine = (id) => (zones.some((z) => z.id === id) ? id : 'outside');
  const doors = KM.DOORS.map((d) => {
    const r = d.rect;
    const axis = (r.maxX - r.minX) >= (r.maxZ - r.minZ) ? 'x' : 'z'; // the way its wall runs
    const lo = axis === 'x' ? r.minZ : r.minX; const hi = axis === 'x' ? r.maxZ : r.maxX;
    const a = axis === 'x' ? r.minX : r.minZ; const b = axis === 'x' ? r.maxX : r.maxZ;
    const y = Math.max(...d.zones.map((id) => KM.ZONES.find((q) => q.id === id).y));
    return { id: d.id, key: d.key, zones: d.zones.map(mine), axis, lo, hi, mid: (lo + hi) / 2, c: (a + b) / 2, w: b - a, h: doorHeight(d), y, swing: SWING[d.id] };
  });
  // the head of the stairs opens straight onto the landing: an arch with no depth and no leaf
  const st = KM.STAIRS.rect;
  doors.push({ id: 'stairTop', key: null, zones: ['stairs', 'landing'], axis: 'x', lo: st.minZ, hi: st.minZ, mid: st.minZ, c: (st.minX + st.maxX) / 2, w: st.maxX - st.minX, h: 3.0, y: KM.UPPER });
  // a passage as wide as its door runs on to the middle of the door's depth; the room beyond cuts the arch
  for (const d of doors) {
    for (const id of d.zones) {
      const z = zones.find((q) => q.id === id);
      for (const r of z.rects) {
        const [a0, a1, lo, hi] = d.axis === 'x' ? ['x0', 'x1', 'z0', 'z1'] : ['z0', 'z1', 'x0', 'x1'];
        if (Math.abs(r[a0] - (d.c - d.w / 2)) > 1e-6 || Math.abs(r[a1] - (d.c + d.w / 2)) > 1e-6) continue;
        if (Math.abs(r[lo] - d.hi) < 1e-6) r[lo] = d.mid;
        else if (Math.abs(r[hi] - d.lo) < 1e-6) r[hi] = d.mid;
      }
    }
  }
  const P = KM.PIT; const B = KM.BOARD.rect;
  return {
    zones,
    doors,
    // straight sight lines through two or more doorways: beyond its neighbours a zone shows these.
    // fix/doorway-sky: worked out from the plan (logic/sightlines.js), no longer a list by hand that
    // missed some (from the passage's end the mirror room's far doors were holes onto the sky)
    sees: Object.entries(SIGHT).flatMap(([a, ids]) => ids.map((b) => [mine(a), mine(b)])).filter(([a, b]) => a !== b),
    outside: {
      // south: the road's hillside (roadview.js, #29) begins at the approach's parapet
      half: 80, south: 44.75, north: -62, front: 0.5, frontHalf: 36, frontH: 14,
      approach: toR(KM.ZONES.find((z) => z.id === 'approach').rects[0]),
      pit: { ...toR(P.rect), y: P.floor }, bridge: toR(P.deck), pitStair: P.stair,
      forecourt: toR(KM.ZONES.find((z) => z.id === 'forecourt').rects[0]),
      towers: [
        { x: -8.7, z: -3.6, r: 4, h: 24, roof: 10 }, { x: 8.7, z: -3.6, r: 4, h: 24, roof: 10 },
        { x: -36, z: -1.5, r: 3.2, h: 17, roof: 7 }, { x: 36, z: -1.5, r: 3.2, h: 17, roof: 7 },
        { x: -15, z: -9.5, r: 2.3, h: 35, roof: 9 }, { x: 15, z: -9.5, r: 2.3, h: 35, roof: 9 },
        { x: -25, z: -26, r: 3.3, h: 44, roof: 13 },
      ],
      masses: [
        { x0: -13, x1: 13, z0: -40, z1: -9, y0: 11, y1: 31, roof: 9 },
        { x0: -32, x1: -13, z0: -36, z1: -6.5, y0: 9, y1: 21, roof: 6 },
        { x0: 13, x1: 32, z0: -36, z1: -6.5, y0: 9, y1: 21, roof: 6 },
      ],
      moon: [0.828, 0.407, 0.386], // low in the east-south-east: it rakes the front and fills the east windows
    },
    gallery: { field: toR(KM.GALLERY.field), stair: KM.CRYPT.stair, rails: KM.CRYPT.rails, cryptY: KM.CRYPT.floor, mirrorH: KM.GALLERY.mirrorH || 5.4 },
    board: { x0: B.minX, z1: B.maxZ, sq: KM.BOARD.square },
    stairs: { z0: KM.STAIRS.foot, run: KM.STAIRS.run * KM.STAIRS.treads, rise: KM.STAIRS.rise * KM.STAIRS.treads, n: KM.STAIRS.treads },
    // the title fly-through: over the bridge, in at the door, and on through the house
    fly: [
      [0, 8, 82], [-4, 6, 62], [3, 3.6, 46], [0, 2.6, 30], [0, 2.4, 10], [0, 2.3, 0], [0, 2.6, -5], [0, 2.1, -9], [0, 2.0, -13], [1.5, 2, -15],
      [12, 2, -15], [21, 2, -15.2], [22, 2, -19], [22, 2.1, -24], [21, 2.8, -29], [17, 3, -35], [15, 2.2, -40], [15, 2, -43.5], [13.5, 2, -45],
      [0, 2, -45], [-7.5, 2, -45.2], [-8, 2, -48], [-8, 2.1, -50.5], [-6, 3, -58], [-4, 3.4, -70], [-5, 2.6, -80], [-5, 2.1, -83], [-5, 2, -89],
      [-3.5, 2, -91], [8, 2, -91], [12.5, 2, -91.3], [13, 2.1, -93], [12, 4.6, -100], [14, 4.6, -110], [13, 2.2, -117.5], [13, 3.4, -120],
      [13, 6.9, -127.5], [13, 7.1, -131.5], [13, 7.2, -139], [13, 7, -146.5], [13, 7, -150.5], [13, 7.6, -157], [19, 7.4, -161],
    ],
  };
}
const PLAN = makePlan();
const WALK_STAGE = KM.ZONES.find((z) => z.id === 'walk').stage; // #27: the horizon glows from here on
export const CASTLE_PLAN = PLAN;

// ---- small geometry tools -----------------------------------------------------------------------

const box = (x, y, z, w, h, d, hex, ry = 0, vary = 0.1) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.deleteAttribute('uv');
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return S.tint(g, hex, vary, x + z);
};
const cyl = (x, y, z, r0, r1, h, hex, seg = 10, vary = 0.1) => {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg);
  g.deleteAttribute('uv');
  g.translate(x, y + h / 2, z);
  return S.tint(g, hex, vary, x - z);
};
const cone = (x, y, z, r, h, hex, seg = 12) => {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.deleteAttribute('uv');
  g.translate(x, y + h / 2, z);
  return S.tint(g, hex, 0.12, x * 3 + z);
};
const _up = new THREE.Vector3(0, 1, 0);
const rod = (a, b, r, hex) => {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), 5, 1, true);
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()), new THREE.Vector3(1, 1, 1)));
  return S.tint(g, hex, 0.15, a.x + a.z);
};
const flat = (x0, x1, z0, z1, y, hex = 0xffffff, up = true) => {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.deleteAttribute('uv');
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return ST.paint(g, hex, { vary: 0 });
};

// A plane with its own texture coordinates (a rug carries a drawn pattern).
function mapped(x0, x1, z0, z1, y, ru = 1, rv = 1, turn = false, v0 = 0) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i); const v = uv.getY(i);
    uv.setXY(i, (turn ? v : u) * ru, (turn ? u : v) * rv + v0);
  }
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return g;
}

function mergeMapped(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    const total = parts.reduce((s, p) => s + p.attributes[name].count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const p of parts) { arr.set(p.attributes[name].array, o); o += p.attributes[name].count * size; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

// ---- drawn cloth and glass ----------------------------------------------------------------------

function drawn(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function weave(g, w, h, seed, amount = 0.1) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const rand = S.rng(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const k = 1 + amount * (rand() - 0.5) * 2 + ((x + y) % 2 ? 0.035 : -0.035);
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
  g.putImageData(img, 0, 0);
}

// A room's rug, drawn to the shape it will lie in so nothing on it is stretched.
function rugTexture(aspect) {
  const w = 640; const h = Math.round(w / aspect);
  return drawn(w, h, (g) => {
    g.fillStyle = '#09080a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#4e0a0e';
    g.fillRect(16, 16, w - 32, h - 32);
    g.strokeStyle = '#6f5a2e'; g.lineWidth = 3;
    g.strokeRect(24, 24, w - 48, h - 48);
    g.strokeStyle = '#09080a'; g.lineWidth = 8;
    g.strokeRect(38, 38, w - 76, h - 76);
    g.strokeStyle = '#6f5a2e'; g.lineWidth = 1.5;
    g.strokeRect(47, 47, w - 94, h - 94);
    // the field: a lattice of dark lozenges
    g.save();
    g.beginPath(); g.rect(50, 50, w - 100, h - 100); g.clip();
    g.strokeStyle = 'rgba(14,4,6,0.6)'; g.lineWidth = 2;
    for (let k = -h; k < w + h; k += 30) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke();
      g.beginPath(); g.moveTo(k, h); g.lineTo(k + h, 0); g.stroke();
    }
    g.restore();
    // a tracery lozenge in the middle with a quatrefoil cut in it, and a small quatrefoil in each corner
    const foil = (cx, cy, q, fill) => {
      g.fillStyle = fill; g.strokeStyle = '#6f5a2e'; g.lineWidth = Math.max(1.2, q * 0.07);
      g.beginPath();
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { g.moveTo(cx + dx * q * 0.62 + q * 0.6, cy + dy * q * 0.62); g.arc(cx + dx * q * 0.62, cy + dy * q * 0.62, q * 0.6, 0, TAU); }
      g.stroke();
      g.fill();
      g.beginPath(); g.moveTo(cx - q * 0.3, cy); g.lineTo(cx, cy - q * 0.3); g.lineTo(cx + q * 0.3, cy); g.lineTo(cx, cy + q * 0.3); g.closePath();
      g.fillStyle = '#6f5a2e'; g.fill();
    };
    const m = Math.min(w, h) * 0.34;
    for (const k of [1, 0.84]) {
      g.fillStyle = k === 1 ? '#5c0c11' : '#4e0a0e';
      g.beginPath(); g.moveTo(w / 2 - m * 1.25 * k, h / 2); g.lineTo(w / 2, h / 2 - m * k); g.lineTo(w / 2 + m * 1.25 * k, h / 2); g.lineTo(w / 2, h / 2 + m * k); g.closePath(); g.fill();
      g.strokeStyle = '#6f5a2e'; g.lineWidth = k === 1 ? 2.5 : 1.2; g.stroke();
    }
    foil(w / 2, h / 2, m * 0.42, '#09080a');
    for (const [cx, cy] of [[84, 84], [w - 84, 84], [84, h - 84], [w - 84, h - 84]]) foil(cx, cy, 13, '#09080a');
    weave(g, w, h, 5, 0.14);
  });
}

function glassTexture() {
  // Leaded quarries: dark cames on a cold pane.
  return drawn(128, 128, (g, w, h) => {
    g.fillStyle = '#31425e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#05070b'; g.lineWidth = 3;
    for (let k = -h; k <= w + h; k += 32) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h / 2, h); g.stroke();
      g.beginPath(); g.moveTo(k, h); g.lineTo(k + h / 2, 0); g.stroke();
    }
  }, true);
}

function moonTexture() {
  return drawn(256, 256, (g, w) => {
    const r = w / 2;
    const grad = g.createRadialGradient(r, r, r * 0.2, r, r, r);
    grad.addColorStop(0, '#f4f7fb');
    grad.addColorStop(0.92, '#d5deea');
    grad.addColorStop(0.98, 'rgba(201,211,224,0.6)');
    grad.addColorStop(1, 'rgba(201,211,224,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
    const rand = S.rng(31);
    g.globalCompositeOperation = 'source-atop';
    // #29 (A17): soft, low-contrast markings, blurred maria rather than storybook blots
    g.filter = 'blur(7px)';
    for (let i = 0; i < 26; i++) {
      const a = rand() * TAU; const d = rand() * r * 0.8; const s = 8 + rand() * 34;
      g.fillStyle = `rgba(150,160,176,${(0.1 + rand() * 0.22) * 0.45})`;
      g.beginPath(); g.ellipse(r + Math.cos(a) * d, r + Math.sin(a) * d, s, s * (0.6 + rand() * 0.5), rand() * 3, 0, TAU); g.fill();
    }
    g.filter = 'none';
  });
}

// ---- flames -------------------------------------------------------------------------------------

// Collects flame tongues into one geometry. Each vertex knows its flame's phase, how far up the
// tongue it is and the tongue's size, and the material's vertex stage does the moving.
function flameBuilder() {
  const pos = []; const col = []; const aux = [];
  const base = new THREE.Color(); const tipC = new THREE.Color();
  return {
    add(x, y, z, size, phase = x * 3.1 + z * 1.7) {
      const rings = 6; const sides = 6;
      const ring = (k) => {
        const u = k / rings;
        return { u, r: size * 0.3 * Math.sin(Math.PI * Math.pow(u, 0.62)) * (1 - 0.35 * u) + (k === 0 ? size * 0.05 : 0), y: u * size * 1.25 };
      };
      const colour = (u) => {
        // K4 (owner Q11): orange flames, a #FFB060 core to a #FF8A3C body and a red tip. Drawn
        // over what is behind them, not added to it, so a flame against lit stone stays orange
        // and never clips to white
        if (u < 0.25) return base.setRGB(0.55, 0.2, 0.05).lerp(tipC.setRGB(1.0, 0.45, 0.13), u / 0.25);
        if (u < 0.6) return base.setRGB(1.0, 0.45, 0.13).lerp(tipC.setRGB(1.0, 0.25, 0.045), (u - 0.25) / 0.35);
        return base.setRGB(1.0, 0.25, 0.045).lerp(tipC.setRGB(0.55, 0.06, 0.005), (u - 0.6) / 0.4);
      };
      const put = (rg, s) => {
        const a = (s / sides) * TAU;
        pos.push(x + Math.cos(a) * rg.r, y + rg.y, z + Math.sin(a) * rg.r);
        const c = colour(rg.u);
        col.push(c.r, c.g, c.b, rg.u < 0.55 ? 0.92 : 0.92 * (1 - (rg.u - 0.55) / 0.45) ** 1.5); // the tip thins to nothing
        aux.push(phase, rg.u, size);
      };
      for (let k = 0; k < rings; k++) {
        const a = ring(k); const b = ring(k + 1);
        for (let s = 0; s < sides; s++) {
          put(a, s); put(b, s); put(a, s + 1);
          put(a, s + 1); put(b, s); put(b, s + 1);
        }
      }
    },
    get empty() { return pos.length === 0; },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
      g.setAttribute('aFlame', new THREE.Float32BufferAttribute(aux, 3));
      return g;
    },
  };
}

// ---- the build ----------------------------------------------------------------------------------

export function buildCastle(scene, cfg) {
  const root = new THREE.Group();
  root.name = 'castle';
  root.visible = false;
  scene.add(root);

  const fog = new THREE.FogExp2(HUE.night, 0.012);
  const background = new THREE.Color(HUE.night);

  // ---- materials (all shared) ----
  const fitMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12 });
  const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
  const rugMats = new Map();
  const rugMatFor = (aspect) => {
    const key = Math.round(aspect * 4) / 4;
    if (!rugMats.has(key)) rugMats.set(key, new THREE.MeshStandardMaterial({ map: rugTexture(key), color: 0xb07070, // K14: darker, so the hearth light leaves it dried red, not salmon
       roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    return rugMats.get(key);
  };
  const glassMat = new THREE.MeshStandardMaterial({
    map: glassTexture(), color: 0x8fa6c8, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide,
  });
  const dawnGlass = glassMat.clone(); // K1: the Count's windows, which clear as the dawn comes up so the view shows
  const litMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }); // lit windows seen from outside
  const windowMats = [0, 1, 2, 3].map(() => litMat.clone()); // #29: the front's windows in four sets (finish)
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x080b12, fog: false });
  // fix/wives-window: the night through a passage's moon slit, drawn once (logic/nightsky.js) and shared
  // by the four slits. Untoned, so its brightest pixel is the moon's core (SKY.cap) at any exposure
  const skyTex = new THREE.DataTexture(nightSky({ bottomUp: true }), SKY.w, SKY.h, THREE.RGBAFormat);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  skyTex.magFilter = THREE.LinearFilter; skyTex.minFilter = THREE.LinearMipmapLinearFilter; skyTex.generateMipmaps = true;
  skyTex.needsUpdate = true;
  const slitSkyMat = new THREE.MeshBasicMaterial({ map: skyTex, fog: true, toneMapped: false });
  // K9: the far crags graded into the night air: under the horizon's sky by about 15 values and in
  // its hue, not the near roofs' black (the road's evening grades them with the roofs, as before)
  const RIDGE = 0x1a2234;
  const ridgeMat = new THREE.MeshBasicMaterial({ color: RIDGE, fog: false, toneMapped: false }); // drawn as the grade it is
  const flameTime = { value: 0 };
  const flameCalm = { value: 0 };
  const flameMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide, // K4: normal blending (see flameBuilder)
  });
  flameMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = flameTime;
    sh.uniforms.uCalm = flameCalm;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFlame;\nuniform float uTime;\nuniform float uCalm;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float ph = aFlame.x; float up = aFlame.y; float sz = aFlame.z;
        float t = uTime * mix( 1.0, 0.12, uCalm );
        transformed.x += sz * up * up * ( 0.2 * sin( t * 9.0 + ph + up * 5.0 ) + 0.1 * sin( t * 23.0 + ph * 1.7 ) );
        transformed.z += sz * up * up * ( 0.18 * cos( t * 7.3 + ph * 2.1 + up * 4.0 ) + 0.09 * sin( t * 19.0 + ph ) );
        transformed.y += sz * up * ( 0.16 * sin( t * 13.0 + ph * 3.0 ) + 0.08 * sin( t * 31.0 + ph ) );
      }`);
  };
  flameMat.customProgramCacheKey = () => 'castle-flame';
  const haloMat = new THREE.PointsMaterial({
    map: glowTexture(), color: HUE.fire, size: 1.5, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false,
  });

  // A baked pool of candlelight (the tea room's exit candle): additive, vertex-coloured fans on the floor and the
  // wall, no texture and no real light. Its opacity is the flame's flicker (update), so the pool breathes with it.
  const glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const GLOW_WARM = [1.0, 0.56, 0.22];

  // ---- zones ----
  const zones = PLAN.zones.map((z, i) => ({
    ...z, index: i, group: new THREE.Group(), neighbours: new Set(),
    stone: [], worn: [], floorParts: {}, fit: [], cloth: [], rug: [], glass: [], lit: [], dark: [], ridge: [], glow: [], sky: [],
    flames: flameBuilder(), halos: [], fires: [], leaves: [],
  }));
  const byId = Object.fromEntries(zones.map((z) => [z.id, z]));
  for (const z of zones) {
    z.group.name = `castle:${z.id}`;
    root.add(z.group);
  }
  for (const d of PLAN.doors) {
    byId[d.zones[0]].neighbours.add(d.zones[1]);
    byId[d.zones[1]].neighbours.add(d.zones[0]);
  }
  for (const [a, b] of PLAN.sees) {
    byId[a].neighbours.add(b);
    byId[b].neighbours.add(a);
  }
  const wallList = (z) => (z.kind === 'passage' ? z.worn : z.stone);
  const floorOf = (z, kind) => (z.floorParts[kind] || (z.floorParts[kind] = []));

  // ---- fittings shared by every zone ----

  /** A flame that gives light: where it burns and how strong (1 = a torch). */
  function fire(z, x, y, zz, power, size, lx = x, lz = zz) {
    z.flames.add(x, y, zz, size);
    z.halos.push(x, y + size * 0.5, zz);
    // (lx, lz): where its light is thrown from. K4: a wall flame's light stands out from the wall, so
    // the stone right behind the flame is not burnt to white under it and the pool is softer
    z.fires.push({ x: lx, y: y + size * 0.6, z: lz, power, seed: x * 1.3 + zz * 0.7, cold: coldZone(z), passage: z.kind === 'passage' });
  }

  /** A torch in an iron bracket on a wall face at (x, z), burning `out` from it along n. */
  function torch(z, x, zz, n, y = 2.3) {
    const ox = x + n[0] * 0.28; const oz = zz + n[1] * 0.28;
    const ry = Math.atan2(n[0], n[1]);
    z.fit.push(box(x + n[0] * 0.14, y - 0.05, zz + n[1] * 0.14, 0.05, 0.05, 0.3, 0x14110f, ry, 0.05));
    z.fit.push(box(x + n[0] * 0.02, y - 0.05, zz + n[1] * 0.02, 0.16, 0.34, 0.03, 0x14110f, ry, 0.05));
    z.fit.push(cyl(ox, y - 0.32, oz, 0.035, 0.055, 0.5, 0x2a1c12, 6));
    z.fit.push(cyl(ox, y + 0.16, oz, 0.07, 0.085, 0.1, 0x100d0b, 8));
    fire(z, ox, y + 0.2, oz, 1, 0.42, x + n[0] * 0.8, zz + n[1] * 0.8);
  }

  /** A candle on a small sconce. */
  function sconce(z, x, zz, n, y = 2.0, power = 0.45) {
    const ox = x + n[0] * 0.16; const oz = zz + n[1] * 0.16;
    const ry = Math.atan2(n[0], n[1]);
    z.fit.push(box(x + n[0] * 0.08, y, zz + n[1] * 0.08, 0.03, 0.03, 0.18, 0x6b5326, ry, 0.05));
    z.fit.push(cyl(ox, y, oz, 0.06, 0.045, 0.03, 0x8a6d36, 8));
    z.fit.push(cyl(ox, y + 0.03, oz, 0.022, 0.02, 0.16, 0xd8d0b8, 6, 0.03));
    fire(z, ox, y + 0.19, oz, power, 0.13, x + n[0] * 0.55, zz + n[1] * 0.55);
  }

  /** A carved chimneypiece on a wall, with logs burning in it. Returns where the fire is. */
  function hearth(z, x, zz, n, w = 2.6, h = 2.2, more = {}) {
    const fp = ST.fireplace({ w, h, ...more });
    const from = [x - n[1] * 2, zz + n[0] * 2]; // any run whose left is n
    const to = [x + n[1] * 2, zz - n[0] * 2];
    const m = ST.wallMatrix(from, to);
    // wallMatrix puts wall-space x = 0 at `from`; shift so x = 0 is the chimneypiece's centre
    m.multiply(new THREE.Matrix4().makeTranslation(2, 0, 0));
    m.premultiply(new THREE.Matrix4().makeTranslation(0, z.y, 0));
    z.stone.push(fp.stone.applyMatrix4(m));
    const at = new THREE.Vector3(fp.fire[0], fp.fire[1], fp.fire[2]).applyMatrix4(m);
    const along = [n[1], -n[0]];
    for (let i = -1; i <= 1; i++) {
      const lx = at.x + along[0] * i * 0.24; const lz = at.z + along[1] * i * 0.24;
      const log = new THREE.CylinderGeometry(0.07, 0.085, fp.mouth.w * 0.62, 7);
      log.deleteAttribute('uv');
      log.rotateZ(Math.PI / 2).rotateY(Math.atan2(n[0], n[1]) + i * 0.25);
      log.translate(lx, at.y - 0.12 + (i === 0 ? 0.1 : 0), lz);
      z.fit.push(S.tint(log, i === 0 ? 0x3a1408 : 0x1a0f0a, 0.4, i));
    }
    const span = fp.mouth.w * 0.3;
    for (let i = 0; i < 6; i++) {
      const k = (i / 5) * 2 - 1;
      z.flames.add(at.x + along[0] * k * span, at.y - 0.04, at.z + along[1] * k * span + n[1] * 0.02 * i, 0.34 + 0.3 * (1 - Math.abs(k)) + 0.08 * (i % 2), i * 2.3 + x);
    }
    z.halos.push(at.x + n[0] * 0.2, at.y + 0.3, at.z + n[1] * 0.2);
    // the fire's own glow on its chimneypiece and the floor before it (the key light throws the shadows)
    // K4: up and out from the mouth, so it pools on the floor and leaves no white slab on the hearth stone
    z.fires.push({ x: at.x + n[0] * 1.4, y: at.y + 1.45, z: at.z + n[1] * 1.4, power: 1.3, seed: x + zz, cold: coldZone(z) });
    return { x: at.x, y: at.y + 0.35, z: at.z, n };
  }

  /** The key light for a room with a fire: a spot at the hearth's mouth, thrown across the room. */
  function fireKey(h, reach, power = 150, cold = false) {
    // K4: thrown from a little out of the mouth and up, with a soft edge, so the hearth's jambs
    // and slab cut no hard white wedge on the floor; K3: weaker on the cold upper storey
    return {
      kind: 'fire', pos: [h.x + h.n[0] * 0.9, h.y + 0.7, h.z + h.n[1] * 0.9],
      target: [h.x + h.n[0] * reach, h.y - 0.9, h.z + h.n[1] * reach],
      intensity: power * FIRE_SHARE * (cold ? COLD.fire : 1), angle: 1.25, penumbra: 1, decay: 1.6, distance: reach * 3.2, color: FIRELIGHT, seed: h.x + h.z,
    };
  }
  /** True for a zone on the upper storey (K3: the cold rooms). */
  function coldZone(z) { return z.y >= KM.UPPER - 0.01; }

  /** Oak beams under a flat ceiling. */
  function beams(z, r, y, alongX, n) {
    const x0 = r.x0 + INSET; const x1 = r.x1 - INSET; const z0 = r.z0 + INSET; const z1 = r.z1 - INSET;
    z.stone.push(flat(x0, x1, z0, z1, y, 0x9a9da2, false));
    const wood = 0x2b1d14;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      if (alongX) z.fit.push(box((x0 + x1) / 2, y - 0.2, lerp(z0 + 0.25, z1 - 0.25, k), x1 - x0, 0.4, 0.34, wood));
      else z.fit.push(box(lerp(x0 + 0.25, x1 - 0.25, k), y - 0.2, (z0 + z1) / 2, 0.34, 0.4, z1 - z0, wood));
    }
    // two tie beams the other way, and a stone corbel under each end of each beam
    for (const k of [1 / 3, 2 / 3]) {
      if (alongX) z.fit.push(box(lerp(x0, x1, k), y - 0.5, (z0 + z1) / 2, 0.42, 0.3, z1 - z0, wood));
      else z.fit.push(box((x0 + x1) / 2, y - 0.5, lerp(z0, z1, k), x1 - x0, 0.3, 0.42, wood));
    }
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      for (const end of [0, 1]) {
        if (alongX) z.stone.push(ST.block(end ? x1 - 0.14 : x0 + 0.14, y - 0.72, lerp(z0 + 0.25, z1 - 0.25, k), 0.28, 0.34, 0.3, 0xe9ebee));
        else z.stone.push(ST.block(lerp(x0 + 0.25, x1 - 0.25, k), y - 0.72, end ? z1 - 0.14 : z0 + 0.14, 0.3, 0.34, 0.28, 0xe9ebee));
      }
    }
  }

  /** A tattered red banner with the black winged heart, hung flat on a wall face. */
  function banner(z, x, zz, n, y, seed) {
    const heart = (u, v, c) => {
      const px = (u - 0.5) * 2.6; const py = (0.4 - v) * 5.6;
      const hx = px * 1.05; const hy = py * 1.05 + 0.15;
      const k = hx * hx + hy * hy - 1;
      const inHeart = k * k * k - hx * hx * hy * hy * hy < 0;
      const ax = Math.abs(px);
      const t = (ax - 0.75) / 0.5; // 0 at the heart's shoulder, 1 at the wing tip
      const wing = t > 0 && t < 1 && py < 1.0 - 0.25 * t && py > 0.25 + 0.3 * Math.abs(Math.sin(t * 9.4)) + 0.2 * t;
      if (inHeart || wing) c.setHex(0x0a0809);
      else if (u < 0.06 || u > 0.94) c.setHex(0x1a0a0b);
    };
    const c = S.cloth({ width: 1.15, length: 2.5, cols: 26, rows: 40, budget: 4400, color: 0x560b10, pattern: heart, folds: 2, foldDepth: 0.03, tatter: 0.75, dirt: 0.4, seed, cast: false });
    const g = c.geometry;
    g.rotateY(Math.atan2(n[0], n[1]) + Math.PI); // the panel faces -Z; turn its face along n
    g.translate(x + n[0] * 0.09, y, zz + n[1] * 0.09);
    z.cloth.push(g);
    z.fit.push(box(x + n[0] * 0.07, y + 0.03, zz + n[1] * 0.07, KM.WALL_ART.banner.w, 0.05, 0.05, 0x14110f, Math.atan2(n[0], n[1])));
  }

  /** A carved grin with fangs, cut in stone over an arch: the Cat's, with the Count's teeth. */
  function grinStone(z, x, y, zz, n, width = 1.3, seed = 3) {
    const g = S.grin({ width, teeth: 16, smile: 0.62, lip: 0xb9bdc2, tooth: 0xe2e4e6, sharp: true, seed });
    const fangs = [-1, 1].map((sd) => {
      const f = new THREE.ConeGeometry(width * 0.035, width * 0.2, 5);
      f.rotateZ(Math.PI);
      f.translate(sd * width * 0.17, -width * 0.04, -0.01);
      return S.tint(f, 0xe9eaec, 0.05, sd);
    });
    const all = S.merge([g, ...fangs]);
    all.scale(1, 1, 0.5);
    all.rotateY(Math.atan2(n[0], n[1]) + Math.PI);
    all.translate(x + n[0] * 0.07, y, zz + n[1] * 0.07);
    wallList(z).push(all);
  }

  // ---- the shell of a zone, from its rectangles ----

  const SIDES = [
    { side: 'n', axis: 'x', n: [0, 1], at: (r) => r.z0, lo: (r) => r.x0, hi: (r) => r.x1, opp: 's' },
    { side: 's', axis: 'x', n: [0, -1], at: (r) => r.z1, lo: (r) => r.x0, hi: (r) => r.x1, opp: 'n' },
    { side: 'w', axis: 'z', n: [1, 0], at: (r) => r.x0, lo: (r) => r.z0, hi: (r) => r.z1, opp: 'e' },
    { side: 'e', axis: 'z', n: [-1, 0], at: (r) => r.x1, lo: (r) => r.z0, hi: (r) => r.z1, opp: 'w' },
  ];
  const sideOf = (s) => SIDES.find((q) => q.side === s);
  const pointOn = (sd, c, at) => (sd.axis === 'x' ? [c, at] : [at, c]);

  /** A point on the inner face of one wall of a rectangle, and the wall's inward normal. */
  function onFace(r, side, c) {
    const sd = sideOf(side);
    const p = pointOn(sd, c, sd.at(r) + (sd.axis === 'x' ? sd.n[1] : sd.n[0]) * INSET);
    return { x: p[0], z: p[1], n: sd.n };
  }

  // The run of a wall whose left hand is its inward normal, so wall space z points into the room.
  function runOf(sd, at, lo, hi) {
    const forward = sd.side === 'n' || sd.side === 'e';
    return forward ? [pointOn(sd, lo, at), pointOn(sd, hi, at)] : [pointOn(sd, hi, at), pointOn(sd, lo, at)];
  }

  function shell(z, o = {}) {
    const y0 = o.y == null ? z.y : o.y;
    const h = o.h == null ? z.h : o.h;
    const ceil = o.ceil === undefined ? z.ceil : o.ceil;
    const rise = ceil && ceil.rise ? ceil.rise : 0;
    const top = y0 + h + rise + 0.25;
    const list = o.list || wallList(z);
    const passage = z.kind === 'passage' && !o.list;
    z.rects.forEach((r, ri) => {
      for (const sd of SIDES) {
        const at = sd.at(r);
        // parts of this side that open into another rectangle of the same zone
        const open = [];
        z.rects.forEach((q, qi) => {
          if (qi === ri) return;
          const other = sideOf(sd.opp);
          if (Math.abs(other.at(q) - at) > 1e-6) return;
          const lo = Math.max(sd.lo(r), other.lo(q)); const hi = Math.min(sd.hi(r), other.hi(q));
          if (hi - lo > 1e-6) open.push({ lo, hi, first: ri < qi });
        });
        open.sort((a, b) => a.lo - b.lo);
        const solid = [];
        let cur = sd.lo(r);
        for (const g of open) {
          if (g.lo - cur > 1e-6) solid.push({ lo: cur, hi: g.lo, extHi: true, extLo: cur !== sd.lo(r) });
          cur = g.hi;
        }
        if (sd.hi(r) - cur > 1e-6) solid.push({ lo: cur, hi: sd.hi(r), extLo: cur !== sd.lo(r), extHi: false });
        const sign = sd.axis === 'x' ? sd.n[1] : sd.n[0];
        for (const seg of solid) {
          const lo = seg.lo - (seg.extLo ? INSET : 0); const hi = seg.hi + (seg.extHi ? INSET : 0);
          if (!o.plain && PLAN.doors.some((d) => d.zones.includes(z.id) && d.axis === sd.axis && Math.abs(d.mid - at) < 1e-6 && Math.abs(d.c - (lo + hi) / 2) < 1e-6 && d.w >= hi - lo - 1e-6)) continue;
          const ops = [];
          const cases = [];
          if (!o.plain) {
            for (const d of PLAN.doors) {
              if (!d.zones.includes(z.id) || d.axis !== sd.axis || d.c < lo || d.c > hi) continue;
              if (Math.abs(d.lo - at) > 1e-6 && Math.abs(d.hi - at) > 1e-6) continue;
              ops.push({ c: d.c, w: d.w, h: d.h, y: d.y - y0, rise: d.w * 0.5, door: d });
            }
            for (const w of z.windows || []) {
              if (w.rect !== ri || w.side !== sd.side || w.c < lo || w.c > hi) continue;
              ops.push({ c: w.c, w: w.w, h: w.h, y: w.sill, rise: w.rise == null ? w.w * 0.75 : w.rise, window: w });
            }
          }
          const t = ops.some((q) => q.window) ? 1.0 : WALL_T;
          const [from, to] = runOf(sd, at + sign * (INSET - t / 2), lo, hi);
          const [f0, f1] = runOf(sd, at, lo, hi);
          const pos = (c) => (sd.side === 'n' || sd.side === 'e' ? c - lo : hi - c);
          const openings = ops.map((q) => ({ at: pos(q.c), w: q.w, h: q.h, y: q.y, rise: q.rise }));
          // the wall is footed 0.05 m under the floor so no light slips in at its foot
          const cut = openings.map((q) => (q.y > 0.001 ? { ...q, y: q.y + 0.05 } : { ...q, h: q.h + 0.05 }));
          list.push(ST.wall({ from, to, y0: y0 - 0.05, y1: top, t, openings: cut, seed: ri * 7 + at }));
          for (let k = 0; k < ops.length; k++) {
            const q = ops[k]; const op = openings[k];
            const sur = ST.surround({ ...op, y: 0 }, { profile: q.window ? ST.PROFILE.bead : passage ? ST.PROFILE.plain : ST.PROFILE.door, hex: 0xf1f3f5 });
            list.push(ST.onWall(sur, f0, f1, INSET, y0 + (op.y || 0)));
            if (q.window) cases.push({ q, op });
            else {
              const back = ST.surround({ ...op, at: (hi - lo) - op.at, y: 0 }, { profile: ST.PROFILE.plain, hex: 0xf1f3f5 });
              list.push(ST.onWall(back, f1, f0, t - INSET, y0 + (op.y || 0)));
            }
          }
          for (const { q, op } of cases) windowFill(z, q, op, from, to, y0, list);
        }
        // a diaphragm arch where two runs of a passage meet, the carved grin over it
        for (const g of open) {
          if (!g.first || o.plain) continue;
          const wdt = g.hi - g.lo;
          const [from, to] = runOf(sd, at, g.lo, g.hi);
          const aw = wdt - 0.02;
          list.push(ST.wall({ from, to, y0, y1: top, t: 0.5, openings: [{ at: wdt / 2, w: aw, h: h - 0.05, rise: Math.min(1.0, h * 0.3) }] }));
          for (const face of [1, -1]) {
            const a = face > 0 ? from : to; const b = face > 0 ? to : from;
            list.push(ST.onWall(ST.surround({ at: wdt / 2, w: aw, h: h - 0.05, rise: Math.min(1.0, h * 0.3) }, { profile: ST.PROFILE.plain }), a, b, 0.25, y0));
          }
        }
      }
      // the ceiling
      if (ceil && ceil.kind === 'vault') {
        const alongZ = ceil.along ? ceil.along === 'z' : (r.z1 - r.z0) >= (r.x1 - r.x0);
        const len = alongZ ? r.z1 - r.z0 : r.x1 - r.x0;
        list.push(ST.vault({
          x0: r.x0 + (alongZ ? INSET : 0), x1: r.x1 - (alongZ ? INSET : 0), z0: r.z0 + (alongZ ? 0 : INSET), z1: r.z1 - (alongZ ? 0 : INSET),
          spring: y0 + h, rise, along: alongZ ? 'z' : 'x', bays: ceil.bays || Math.max(1, Math.round(len / (ceil.bay || 4))),
          hex: passage ? 0xb9bcc0 : 0xd9dce0,
        }));
      } else if (ceil && ceil.kind === 'beams') {
        beams(z, r, y0 + h, ceil.along === 'x', ceil.n || 6);
      } else if (ceil && ceil.kind === 'slab') {
        list.push(flat(r.x0, r.x1, r.z0, r.z1, y0 + h, 0x8a8d92, false));
      }
      if (!o.noFloor) floorOf(z, z.floor || 'flag').push(flat(r.x0, r.x1, r.z0, r.z1, y0));
    });
  }

  /** What stands in a window: stone tracery in the middle of the wall's thickness, and the glass. */
  function windowFill(z, q, op, from, to, y0, list) {
    const w = q.w; const hh = q.h; const rise = q.rise;
    const spring = hh - rise;
    const parts = [];
    const lights = q.window.lights || (w > 3 ? 4 : 2);
    const lw = w / lights;
    if (q.window.slit) { slitFill(z, q, op, from, to, y0); return; } // K2: an open slit, no tracery, no glass
    // mullions to the springing, a sub-arch over each light, and an eye in the head
    for (let i = 1; i < lights; i++) parts.push(ST.block(-w / 2 + i * lw, 0, 0, 0.11, spring + rise * (i === lights / 2 ? 0.55 : 0.2), 0.16, 0xf1f3f5));
    for (let i = 0; i < lights && lights > 1; i++) {
      const sub = ST.surround({ at: -w / 2 + (i + 0.5) * lw, w: lw - 0.1, h: lw * 0.62, y: spring - lw * 0.1, rise: lw * 0.62 }, { profile: [[0, -0.07], [0.08, -0.07], [0.08, 0.07], [0, 0.07], [0, -0.07]] });
      // only the arch of it: the jambs are the mullions
      parts.push(sub);
    }
    if (lights > 1) { // a one-light window (the Count's) is a plain lancet: no eye in its head
      const eyeR = Math.min(w * 0.17, rise * 0.3);
      const eye = new THREE.TorusGeometry(eyeR, 0.05, 5, 16);
      eye.deleteAttribute('uv');
      eye.translate(0, spring + rise * 0.52, 0);
      parts.push(ST.paint(eye, 0xf1f3f5));
    }
    if (hh > 5) parts.push(ST.block(0, spring * 0.5, 0, w, 0.12, 0.16, 0xf1f3f5)); // a transom on a great window
    const g = S.merge(parts);
    g.translate(op.at, y0 + (op.y || 0), 0);
    g.applyMatrix4(ST.wallMatrix(from, to));
    list.push(g);
    // glass: the opening's outline as one pane
    const shape = new THREE.Shape();
    const arch = ST.archPoints(w, rise, 8);
    shape.moveTo(-w / 2, 0);
    shape.lineTo(-w / 2, spring);
    for (const [ax, ay] of arch) shape.lineTo(ax, spring + ay);
    shape.lineTo(w / 2, 0);
    shape.closePath();
    const pane = new THREE.ShapeGeometry(shape, 1);
    const uv = pane.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.2, uv.getY(i) * 2.2);
    pane.translate(op.at, y0 + (op.y || 0), 0.1);
    pane.applyMatrix4(ST.wallMatrix(from, to));
    z.glass.push(pane);
  }

  /**
   * K2: a passage's moon slit. The opening stays open to the night, and the zone's key light is the
   * moon through it (buildPassage): one spot already in the fixed set, no light added.
   * fix/wives-window: its outer end shows the night (the moon in a starry sky, the slit's bars in
   * silhouette: logic/nightsky.js) where a pale panel was, so light comes in but nothing is white.
   */
  function slitFill(z, q, op, from, to, y0) {
    const w = q.w; const hh = q.h;
    const g = new THREE.PlaneGeometry(w + 0.1, hh + 0.1); // 0.6 m by 1.8 m: the sky raster's 1 by 3
    g.translate(op.at, y0 + (op.y || 0) + hh / 2, -0.45); // wall space z (+ into the room): at the outer face
    g.applyMatrix4(ST.wallMatrix(from, to));
    z.sky.push(g);
  }

  // ---- doors ----

  // Only a door the rules can shut has leaves; the rest are open arches.
  const doors = PLAN.doors.filter((d) => d.key).map((d) => {
    // logic/doorleaves.js is the one description of the leaves (keep.js stands the same leaves in the collision)
    const src = KM.doorOf(d.id);
    const F = leafFrameOf(src);
    const south = F.south;
    const owner = byId[d.zones[south ? 0 : 1]];
    const dz = F.hz; // flush with the face of the room they open into
    const lw = F.half;
    const h = F.leafH; // the leaves stop under the arch; a fixed board fills its head
    const parts = [];
    const n = Math.round(lw / 0.22);
    for (let i = 0; i < n; i++) parts.push(box((i + 0.5) * (lw / n), h / 2, 0, lw / n - 2 * LEAF.seam, h, LEAF.board, 0x2d1f15, 0, 0.3));
    // the iron straps stop 3 mm short of the meeting edge, as the boards do: the shut pair meet on a
    // 6 mm seam, with no strap ends lying face to face (shimmer), and a leaf swinging to clears the
    // other's corner (logic/cutaway.js LEAF)
    for (const yy of [0.35, h * 0.5, h - 0.35]) parts.push(box(F.length / 2, yy, 0, F.length, 0.09, LEAF.strap, 0x121010, 0, 0.1));
    const R = LEAF.ring;
    parts.push(box(lw - (R.from + R.to) / 2, h * R.y, 0, R.w, R.h, R.d, 0x8a6d36, 0, 0.1));
    const geo = S.merge(parts);
    const made = [0, 1].map((i) => {
      const hinge = new THREE.Group();
      hinge.name = `castle:door-${d.id}-${i === 0 ? 'west' : 'east'}`;
      let g = geo;
      if (i === 1) {
        g = geo.clone().scale(-1, 1, 1);
        g.index.array.reverse();
      }
      const m = new THREE.Mesh(g, fitMat);
      m.castShadow = true;
      m.receiveShadow = true;
      hinge.add(m);
      const pose = leafPose(src, i, 0);
      hinge.position.set(pose.hx, pose.y, pose.hz);
      owner.group.add(hinge);
      return { hinge, sign: (i === 0 ? 1 : -1) * (south ? -1 : 1) };
    });
    owner.fit.push(box(d.c, d.y + h + (d.h - h) / 2, dz, d.w, d.h - h, 0.07, 0x2d1f15, 0, 0.3));
    return { d, src, made, open: 1 };
  });

  // What the rules say about a door, read from the run's state; with no run (the title) all stand open.
  function doorOpen(d, sim) {
    const w = sim && sim.cfg && sim.cfg.room === 'castle' && sim.waves;
    if (!w || !d.key) return true;
    if (typeof KEEP.doorOpen === 'function' && w.done) return KEEP.doorOpen(w, d); // the rules' own answer
    const done = w.done || {};
    if (d.key === 'garlic') return !!(w.items && w.items.garlic > 0); // the rule keep.js keeps (security A7)
    return !!done[d.key];
  }

  // ---- the zones ----
  const keys = {}; // zone id -> its key light
  let dawnView = null; // K1: the view out of the Count's windows (built with the room)
  const surfaces = cfg && cfg.surfaces ? cfg.surfaces.zones.filter((q) => q.shape === 'rect') : [];
  const inZone = (z, x, zz) => z.rects.some((r) => x >= r.x0 - 0.01 && x <= r.x1 + 0.01 && zz >= r.z0 - 0.01 && zz <= r.z1 + 0.01);

  /** Rugs lie where the rules say carpet is underfoot (cfg.surfaces), so what is seen is what is heard. */
  function rugsOf(z) {
    for (const q of surfaces) {
      if (q.material !== 'rug' || !inZone(z, (q.minX + q.maxX) / 2, (q.minZ + q.maxZ) / 2)) continue;
      const turn = (q.maxZ - q.minZ) > (q.maxX - q.minX);
      z.rug.push(mapped(q.minX, q.maxX, q.minZ, q.maxZ, z.y + 0.012, 1, 1, turn));
      z.rugAspect = turn ? (q.maxZ - q.minZ) / (q.maxX - q.minX) : (q.maxX - q.minX) / (q.maxZ - q.minZ);
    }
  }

  /** A stair from keepmap's data (a landing, then treads), as solid blocks standing on floorY. */
  function stairBlocks(st, floorY, list) {
    const r = st.rect;
    for (let k = 0; k < st.treads; k++) {
      const top = st.top - (k + 1) * st.rise;
      if (top - floorY < 0.01) break;
      const m0 = k === 0 ? 0 : st.landing + (k - 1) * st.run;
      const len = k === 0 ? st.landing : st.run;
      const a = st.head + st.dir * (m0 + len / 2);
      if (st.axis === 'z') list.push(ST.block((r.minX + r.maxX) / 2, floorY, a, r.maxX - r.minX, top - floorY, len, 0xffffff, 0.08));
      else list.push(ST.block(a, floorY, (r.minZ + r.maxZ) / 2, len, top - floorY, r.maxZ - r.minZ, 0xffffff, 0.08));
    }
  }

  buildOutside(byId.outside);
  buildHall(byId.hall);
  for (const id of ['cor1', 'cor2', 'cor3', 'passage', 'countway']) buildPassage(byId[id]);
  buildTea(byId.tea);
  buildGallery(byId.gallery);
  buildWalk(byId.walk);
  buildStairs(byId.stairs);
  buildLanding(byId.landing);
  buildMirror(byId.mirror);
  buildNursery(byId.nursery);
  buildCount(byId.count);

  function buildHall(z) {
    const r = z.rects[0];
    shell(z);
    const hz = r.z0 + 2.2; // clear of the braid and the scratched words further along this wall
    for (const zz of [r.z0, r.z0 + (r.z1 - r.z0) / 3, r.z0 + (2 * (r.z1 - r.z0)) / 3, r.z1]) {
      for (const sd of [-1, 1]) {
        if (sd < 0 && Math.abs(zz - hz) < 1.6) continue; // the chimney breast takes this rib
        const col = ST.column({ h: z.h, r: 0.16, half: true });
        col.rotateY(sd > 0 ? Math.PI / 2 : -Math.PI / 2);
        z.stone.push(col.translate(sd > 0 ? r.x1 : r.x0, z.y, zz));
      }
    }
    const f = onFace(r, 'w', hz);
    const h = hearth(z, f.x, f.z, f.n, 2.0, 2.0);
    keys.hall = fireKey(h, 6, 120);
    rugsOf(z);
    for (const sx of [-2.6, 2.6]) { const p = onFace(r, 'n', sx); torch(z, p.x, p.z, p.n, 2.5); }
    z.ambient = 4.2; // K4: a cooler fill under the paler fire, so the hall's stone keeps its ashlar grey
  }

  function buildPassage(z) {
    shell(z);
    let k = 0;
    z.rects.forEach((r, ri) => {
      const alongZ = (r.z1 - r.z0) >= (r.x1 - r.x0);
      const len = alongZ ? r.z1 - r.z0 : r.x1 - r.x0;
      const sides = alongZ ? ['w', 'e'] : ['n', 's'];
      const lo = alongZ ? r.z0 : r.x0;
      // torches: one in a short leg, one every 7 m in a long run, on alternate walls
      const n = Math.max(1, Math.round(len / 7));
      for (let i = 0; i < n; i++) {
        const c = lo + (len * (i + 0.5)) / n;
        const p = onFace(r, sides[(k++) % 2], c);
        if (clearOfThings(p.x, p.z)) torch(z, p.x, p.z, p.n, z.y + 2.15);
      }
      // fallen mortar along both feet
      for (const sdn of sides) {
        const a = onFace(r, sdn, lo + 0.2); const b = onFace(r, sdn, lo + len - 0.2);
        const flip = sdn === 'w' || sdn === 's'; // rubble() lies to the left of its run
        z.worn.push(ST.rubble({ from: flip ? [b.x, b.z] : [a.x, a.z], to: flip ? [a.x, a.z] : [b.x, b.z], n: Math.round(len * 2.2), seed: ri * 5 + k + z.index, y: z.y, out: 0.2 }));
      }
    });
    // the Queen's banner gone over to the Count, where the plan hangs one
    KM.CORRIDOR.banners.forEach((b, i) => {
      const r = z.rects.find((q) => b.x >= q.x0 && b.x <= q.x1 && b.z >= q.z0 - 0.3 && b.z <= q.z1 + 0.3);
      if (!r) return;
      const north = Math.abs(b.z - r.z0) < Math.abs(b.z - r.z1);
      banner(z, b.x, north ? r.z0 : r.z1, north ? [0, 1] : [0, -1], z.y + z.h - 0.05, i + 3);
    });
    // K2: the moon through the slit is the passage's key: thrown down across the floor to the
    // far wall's foot, through the slit's own shadow, so it lands as a slit of silver
    for (const w of z.windows || []) {
      if (!w.slit) continue;
      const f = onFace(z.rects[w.rect], w.side, w.c);
      const midY = z.y + w.sill + w.h / 2;
      keys[z.id] = {
        kind: 'moon', pos: [f.x - f.n[0] * 4.6, midY + 3.6, f.z - f.n[1] * 4.6], target: [f.x + f.n[0] * 1.6, z.y, f.z + f.n[1] * 1.6],
        intensity: 9, angle: 0.5, penumbra: 0.5, decay: 0, distance: 0, color: HUE.moon, // fix/wives-window: the light through the slit is kept as it was (the owner)
      };
    }
    // the carved grin over the arch into the room ahead
    KM.CORRIDOR.grins.forEach((g, i) => {
      const d = PLAN.doors.find((q) => q.axis === 'x' && q.zones.includes(z.id) && Math.abs(q.c - g.x) < 1.5 && Math.abs(q.mid - g.z) < 1.5);
      if (d) grinStone(z, d.c, z.y + d.h + 0.3, d.mid, [0, 1], 1.0, i + 2);
    });
    z.ambient = 2.1;
  }

  // Wall space the plan gives to something else: the wives' painting, a banner.
  function clearOfThings(x, zz) {
    const taken = [KM.CORRIDOR.painting, ...KM.CORRIDOR.banners];
    return taken.every((q) => Math.hypot(q.x - x, q.z - zz) > 2.2);
  }

  function buildTea(z) {
    const r = z.rects[0];
    shell(z);
    const fb = KM.TEA.fireplace;
    const f = onFace(r, 'w', (fb.minZ + fb.maxZ) / 2);
    const h = hearth(z, f.x, f.z, f.n, fb.maxZ - fb.minZ, KM.TEA.mantelTop - 0.18); // the shelf (stone.js: two steps, 0.18) tops out at TEA.mantelTop
    keys.tea = fireKey(h, 12, 260);
    rugsOf(z);
    // the table's two candelabras give light here; their flames are the props'
    for (const c of KM.TEA.candelabras) z.fires.push({ x: c.x, y: z.y + 1.7, z: c.z, power: 0.7, seed: c.x });
    { const p = onFace(r, 's', r.x0 + 3.6); sconce(z, p.x, p.z, p.n, 2.3); }
    teaGougeLight(z, r);
    exitCandle(z, r);
    z.ambient = 3.2;
  }

  // The owner: a candle (once dim, now as bright as the table's candles) near the tea room's exit door, so that corner is a bit more visible. A short candle in a
  // brass saucer on a low shelf on the door wall (keepmap TEA.exitCandle). The room's five flames already fill the
  // light pool, so this one gets no real light: its flame and halo ride the shared flame and halo draws, and its
  // light is one small additive glow (a half-disc on the floor before the shelf, an ellipse up the wall), 1 draw call.
  function exitCandle(z, r) {
    const c = KM.TEA.exitCandle; const sh = c.shelf;
    z.fit.push(box(c.x, sh.top - 0.02, r.z0 + sh.d / 2, sh.w, 0.04, sh.d, 0x5a4026, 0, 0.15));
    for (const dx of [-1, 1]) z.fit.push(box(c.x + dx * (sh.w / 2 - 0.05), sh.top - 0.1, r.z0 + sh.d / 2 - 0.02, 0.03, 0.12, sh.d - 0.04, 0x3a2a1a, 0, 0.1));
    z.fit.push(cyl(c.x, c.y, c.z, 0.075, 0.05, 0.015, 0x8a6d36, 10)); // the saucer
    z.fit.push(cyl(c.x, c.y + 0.015, c.z, 0.02, 0.021, 0.1, 0xd8d0b8, 7, 0.03)); // the candle, a stub
    z.flames.add(c.x, c.y + 0.115, c.z, 0.07, c.x * 1.7); // a small flame
    z.halos.push(c.x, c.y + 0.16, c.z);
    // the glow: bright at the flame, nothing at the rim. Floor: a half-disc (the wall cuts it), at the flag's height.
    const SEG = 14; const pos = []; const col = []; const idx = [];
    const k = c.power; // strength of the pool, the same number as the candelabras' (the test holds them equal)
    // two rings (a soft shoulder, then nothing) so the pool has no hard-looking edge
    const RINGS = [[0.45, 0.3], [1, 0]]; // [radius fraction, share of the centre's strength]
    const fan = (cx, cy, cz, point, strength) => { // point(a, f) -> [x, y, z]: the rim at fraction f of the full radius, a in 0..1
      const base = pos.length / 3;
      pos.push(cx, cy, cz); col.push(GLOW_WARM[0] * strength, GLOW_WARM[1] * strength, GLOW_WARM[2] * strength);
      for (const [f, share] of RINGS) {
        for (let i = 0; i <= SEG; i++) { pos.push(...point(i / SEG, f)); col.push(GLOW_WARM[0] * strength * share, GLOW_WARM[1] * strength * share, GLOW_WARM[2] * strength * share); }
      }
      const ring = SEG + 1;
      for (let i = 0; i < SEG; i++) idx.push(base, base + 1 + i, base + 2 + i);
      for (let i = 0; i < SEG; i++) idx.push(base + 1 + i, base + 1 + ring + i, base + 2 + i, base + 2 + i, base + 1 + ring + i, base + 2 + ring + i);
    };
    const wallZ = r.z0 + 0.012; const RF = 2.3;
    fan(c.x, z.y + 0.03, wallZ + 0.2, (a, f) => [c.x + Math.cos(Math.PI * a) * RF * f, z.y + 0.03, wallZ + Math.sin(Math.PI * a) * RF * f], 0.36 * k);
    fan(c.x + 0.2, c.y + 0.1, wallZ, (a, f) => [c.x + 0.2 + Math.cos(Math.PI * 2 * a) * 0.75 * f, c.y + 0.1 + Math.sin(Math.PI * 2 * a) * 1.2 * f, wallZ], 0.5 * k);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    z.glow.push(g);
  }

  // Issue #16: the werewolf's side of the tea room. The door wall's east sconce moves to the east
  // wall beside the painting, a little stronger, so the claw marks round the gouge centre read from
  // the door; the room keeps five flames, so all five always have a light from the pool.
  function teaGougeLight(z, r) {
    const p = onFace(r, 'e', KM.TEA.werewolf.gouge.z - 2.3);
    sconce(z, p.x, p.z, p.n, 2.2, 0.9);
  }

  // Issues #11 and #22: the crypt after a fall. A torch on the entrance wall half-way up the crypt
  // stair (its flame stays under the gallery floor, so it is one of the crypt's lights), so the way
  // back up is seen from anywhere below; a candle on the east wall over the coffin and the Hare, so
  // the far end reads; and the crypt's own air lighter (CRYPT_AMBIENT). Four flames below, five lights.
  function cryptLights(z, r, st, cy) {
    // on the lower half of the flight, mounted clear of the warden's head (tread + 2.3) and still with
    // its flame under the gallery floor (y < 0): x -4, tread at -3.25, flame at about -0.5
    const x = st.rect.minX + (st.rect.maxX - st.rect.minX) * 0.2;
    const p = onFace(r, 's', x);
    torch(z, p.x, p.z, p.n, KM.stairHeight(st, x, (st.rect.minZ + st.rect.maxZ) / 2) + 2.3);
    const c = onFace(r, 'e', KM.CRYPT_PROPS.coffin.z);
    sconce(z, c.x, c.z, c.n, cy + 1.9, 0.9);
  }

  function buildGallery(z) {
    const r = z.rects[0];
    const G = PLAN.gallery;
    const st = G.stair.rect;
    shell(z, { noFloor: true });
    // the floor: marble aprons at both ends (a mouth for the crypt stair in the first), and a stone
    // lattice for the sixty tiles to lie on, so the crypt shows wherever one has gone
    const sq = 2;
    const chequer = (x0, x1, z0, z1) => {
      for (let i = 0; r.x0 + i * sq < x1; i++) {
        for (let j = 0; r.z1 - j * sq > z0; j++) {
          const ax = Math.max(x0, r.x0 + i * sq); const bx = Math.min(x1, r.x0 + (i + 1) * sq);
          const bz = Math.min(z1, r.z1 - j * sq); const az = Math.max(z0, r.z1 - (j + 1) * sq);
          if (bx - ax < 1e-6 || bz - az < 1e-6) continue;
          floorOf(z, (i + j) % 2 === 0 ? 'marbleDark' : 'marbleLight').push(flat(ax, bx, az, bz, z.y));
        }
      }
    };
    chequer(r.x0, r.x1, G.field.z1, st.minZ);
    chequer(r.x0, st.minX, st.minZ, r.z1);
    chequer(r.x0, r.x1, r.z0, G.field.z0);
    const fl = G.field;
    for (let x = r.x0; x <= r.x1 + 1e-6; x += sq) z.worn.push(ST.block(x, z.y - 0.42, (fl.z0 + fl.z1) / 2, 0.24, 0.4, fl.z1 - fl.z0, 0xcfd2d6));
    for (let zz = fl.z0; zz <= fl.z1 + 1e-6; zz += sq) z.worn.push(ST.block((r.x0 + r.x1) / 2, z.y - 0.42, zz, r.x1 - r.x0, 0.4, 0.24, 0xcfd2d6));
    // (the red runner is keepprops.js's, tile by tile, so it breaks where a tile has gone)
    // the mirror's gilt frame on the west wall (the glass itself is mirror.js)
    const mx = r.x0 + 0.06; const gilt = HUE.gilt; const mh = G.mirrorH;
    const m0 = r.z0 + 0.5; const m1 = r.z1 - 0.5;
    z.fit.push(box(mx, z.y + 0.2, (m0 + m1) / 2, 0.12, 0.3, m1 - m0, gilt, 0, 0.2));
    z.fit.push(box(mx, z.y + mh + 0.3, (m0 + m1) / 2, 0.12, 0.34, m1 - m0, gilt, 0, 0.2));
    for (const zz of [m0, m1]) z.fit.push(box(mx, z.y + mh / 2 + 0.25, zz, 0.12, mh + 0.4, 0.3, gilt, 0, 0.2));
    for (let i = 0; i <= 15; i++) z.fit.push(cone(mx, z.y + mh + 0.46, lerp(m0, m1, i / 15), 0.11, 0.3, gilt, 4));
    // a small fire at the entrance end, torches on the piers between the windows
    // on the entrance apron, clear of the stair's mouth and of the tiles (keepmap's box, where it has one)
    const gh = KM.HEARTHS && KM.HEARTHS.gallery;
    const f = onFace(r, 'e', gh ? gh.z : -53.4);
    // shallow, and its hearth stone no wider than itself: the stair's mouth beside it must stay open
    const gw = gh ? gh.maxZ - gh.minZ : 1.2;
    hearth(z, f.x, f.z, f.n, gw, 2.0, { d: gh ? gh.maxX - gh.minX : 0.3, slabW: gw, slabD: 0.6 });
    for (const t of KM.GALLERY_PROPS.torches) { const p = onFace(r, 'e', t.z); sconce(z, p.x, p.z, p.n, z.y + 2.3); }
    // the stairwell's rails on the gallery floor
    for (const b of G.rails) z.stone.push(ST.block((b.minX + b.maxX) / 2, z.y, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, 1.0, b.maxZ - b.minZ, 0xf1f3f5), ST.block((b.minX + b.maxX) / 2, z.y + 1.0, (b.minZ + b.maxZ) / 2, b.maxX - b.minX + 0.1, 0.1, b.maxZ - b.minZ + 0.1, 0xf1f3f5));
    // the moon through the east windows: the steady light
    keys.gallery = {
      kind: 'moon', pos: [r.x1 + 42, z.y + 21, (r.z0 + r.z1) / 2 + 12], target: [r.x0 + 2, z.y, (r.z0 + r.z1) / 2],
      intensity: 9, angle: 0.5, penumbra: 0.2, decay: 0, distance: 0, color: HUE.moon,
    };
    // ---- the crypt beneath: same footprint, floor 4 m down, run-down stone
    const cy = G.cryptY;
    shell(z, { y: cy, h: -cy - 0.3, ceil: null, list: z.worn, plain: true, noFloor: true });
    floorOf(z, 'rock').push(flat(r.x0, r.x1, r.z0, r.z1, cy));
    // under the aprons the crypt has a stone ceiling, open over the stair
    z.worn.push(flat(r.x0, r.x1, G.field.z1, st.minZ, -0.3, 0x8a8d92, false), flat(r.x0, st.minX, st.minZ, r.z1, -0.3, 0x8a8d92, false), flat(r.x0, r.x1, r.z0, G.field.z0, -0.3, 0x8a8d92, false));
    stairBlocks(G.stair, cy, z.worn);
    for (const tz of [fl.z0 + 6, fl.z1 - 7]) { const p = onFace(r, 'w', tz); torch(z, p.x, p.z, p.n, cy + 2.1); }
    cryptLights(z, r, G.stair, cy);
    z.ambient = 4.5;
    z.cryptAmbient = CRYPT_AMBIENT;
  }

  function buildWalk(z) {
    const r = z.rects[0];
    const B = PLAN.board;
    shell(z);
    // the board: sixty-four squares of polished marble let into the flags, a dark fillet round it
    for (let f = 0; f < 8; f++) {
      for (let rk = 0; rk < 8; rk++) {
        const x = B.x0 + f * B.sq; const zz = B.z1 - (rk + 1) * B.sq;
        floorOf(z, (f + rk) % 2 === 0 ? 'marbleDark' : 'marbleLight').push(flat(x, x + B.sq, zz, zz + B.sq, z.y + 0.012));
      }
    }
    const e = 0.22; const side = 8 * B.sq;
    const bd = floorOf(z, 'marbleDark');
    bd.push(flat(B.x0 - e, B.x0 + side + e, B.z1, B.z1 + e, z.y + 0.012), flat(B.x0 - e, B.x0 + side + e, B.z1 - side - e, B.z1 - side, z.y + 0.012));
    bd.push(flat(B.x0 - e, B.x0, B.z1 - side, B.z1, z.y + 0.012), flat(B.x0 + side, B.x0 + side + e, B.z1 - side, B.z1, z.y + 0.012));
    // wall shafts under the ribs, and nothing else: bare stone, no flame
    const bays = z.ceil.bays;
    for (let i = 0; i <= bays; i++) {
      const x = lerp(r.x0, r.x1, i / bays);
      for (const sd of [-1, 1]) {
        const col = ST.column({ h: z.h, r: 0.2, half: true });
        col.rotateY(sd > 0 ? 0 : Math.PI);
        z.stone.push(col.translate(x, z.y, sd > 0 ? r.z1 : r.z0));
      }
    }
    // the moon through the great east window, and only the moon
    const w = z.windows[0];
    keys.walk = {
      kind: 'moon', pos: [r.x1 + 46, z.y + 19.5, w.c + 9], target: [B.x0 + side * 0.45, z.y, B.z1 - side / 2],
      intensity: 10, angle: 0.34, penumbra: 0.25, decay: 0, distance: 0, color: HUE.moon,
    };
    z.ambient = 5.0;
    z.still = true;
  }

  function buildStairs(z) {
    const r = z.rects[0];
    const s = PLAN.stairs;
    shell(z, { noFloor: true });
    floorOf(z, 'flag').push(flat(r.x0, r.x1, s.z0, r.z1, z.y));
    z.stone.push(ST.steps({ x: (r.x0 + r.x1) / 2, z: s.z0, dir: [0, -1], w: r.x1 - r.x0, n: s.n, rise: s.rise, run: s.run, y: z.y }));
    for (const [side, k] of [['w', 0.25], ['e', 0.7]]) {
      const c = s.z0 - s.run * k;
      const p = onFace(r, side, c);
      torch(z, p.x, p.z, p.n, z.y + s.rise * k + 2.3);
    }
    z.ambient = 2.3;
  }

  function buildLanding(z) {
    const r = z.rects[0];
    shell(z);
    for (const c of [r.x0 + 0.9, r.x1 - 0.9]) { const p = onFace(r, 'n', c); torch(z, p.x, p.z, p.n, z.y + 2.3); }
    z.ambient = 2.3;
  }

  function buildMirror(z) {
    const r = z.rects[0];
    shell(z);
    const f = onFace(r, 'n', r.x1 - 5);
    const h = hearth(z, f.x, f.z, f.n, 2.4, 2.3);
    keys.mirror = fireKey(h, 10, 220, true);
    rugsOf(z);
    for (const [side, c] of [['e', r.z0 + 4.8], ['w', r.z1 - 1.5]]) { const p = onFace(r, side, c); sconce(z, p.x, p.z, p.n, z.y + 2.6); }
    z.ambient = 3.2;
  }

  function buildNursery(z) {
    const r = z.rects[0];
    shell(z);
    const f = onFace(r, 'e', (r.z0 + r.z1) / 2 - 0.5);
    const h = hearth(z, f.x, f.z, f.n, 1.8, 1.9);
    keys.nursery = fireKey(h, 8, 150, true);
    rugsOf(z);
    z.ambient = 3.2;
  }

  function buildCount(z) {
    const r = z.rects[0];
    shell(z);
    const f = onFace(r, 'w', KM.COUNT_ROOM.boxAt.z);
    const h = hearth(z, f.x, f.z, f.n, 3.0, 2.5);
    keys.count = fireKey(h, 14, 170, true);
    rugsOf(z);
    for (const c of [r.x0 + 4, r.x1 - 4]) { const p = onFace(r, 'n', c); sconce(z, p.x, p.z, p.n, z.y + 2.2); }
    // dawn, when it comes, comes through the three east windows
    const mid = (r.z0 + r.z1) / 2;
    keys.dawn = {
      kind: 'dawn', pos: [r.x1 + 40, z.y + 9, mid], target: [(r.x0 + r.x1) / 2, z.y, mid],
      intensity: 4.2, angle: 0.36, penumbra: 0.3, decay: 0, distance: 0, color: HUE.dawn,
    };
    // K1: and beyond the glass, the sunrise over the land, and the castle below (dawnview.js)
    dawnView = buildDawnView({ x: r.x1 + 1, y: z.y, z: mid });
    z.group.add(dawnView.mesh);
    z.ambient = 2.8;
  }

  // ---- the exterior ----

  function buildOutside(z) {
    const X = PLAN.outside;
    const P = X.pit; const B = X.bridge; const F = X.forecourt; const A = X.approach;
    const stone = z.stone; const worn = z.worn;
    const rock = floorOf(z, 'rock');
    // the ground: the approach and the moor beyond it, the banks either side of the pit, the forecourt's flags
    rock.push(flat(-X.half, X.half, P.z1, X.south, 0));
    rock.push(flat(-X.half, P.x0, F.z0, P.z1, 0), flat(P.x1, X.half, F.z0, P.z1, 0));
    rock.push(flat(-X.half, -X.frontHalf, X.north, F.z0, 0), flat(X.frontHalf, X.half, X.north, F.z0, 0));
    rock.push(flat(P.x0, F.x0, F.z0, F.z1, 0), flat(F.x1, P.x1, F.z0, F.z1, 0));
    floorOf(z, 'flag').push(flat(F.x0, F.x1, F.z0, F.z1, 0));
    // the pit: dry, walled in old stone, a stair up its west side to the approach end
    rock.push(flat(P.x0, P.x1, P.z0, P.z1, P.y));
    const pitWall = (from, to) => worn.push(ST.wall({ from, to, y0: P.y, y1: 0, t: 0.8 }));
    pitWall([P.x0 - 0.4, P.z0], [P.x0 - 0.4, P.z1]);
    pitWall([P.x1 + 0.4, P.z1], [P.x1 + 0.4, P.z0]);
    pitWall([P.x0, P.z1 + 0.4], [P.x1, P.z1 + 0.4]);
    pitWall([P.x1, P.z0 - 0.4], [P.x0, P.z0 - 0.4]);
    stairBlocks(X.pitStair, P.y, worn);
    worn.push(ST.rubble({ from: [P.x0 + 3, P.z0 + 1], to: [P.x1 - 1, P.z0 + 1], n: 40, seed: 3, y: P.y, out: 6 }));
    worn.push(ST.rubble({ from: [P.x1 - 1, P.z1 - 1], to: [P.x0 + 3, P.z1 - 1], n: 40, seed: 4, y: P.y, out: 6 }));
    // a low parapet marks where the ground may be walked: round the approach and along the pit's
    // long sides (the bridge itself has no rail), with a shut iron gate where the warden came in
    const parapet = (a, b) => {
      stone.push(ST.wall({ from: a, to: b, y1: 1.05, t: WALL_T }));
      const dx = b[0] - a[0]; const dz = b[1] - a[1];
      stone.push(ST.block((a[0] + b[0]) / 2, 1.05, (a[1] + b[1]) / 2, Math.abs(dx) + (dz ? 0.66 : 0), 0.12, Math.abs(dz) + (dx ? 0.66 : 0), 0xf1f3f5));
    };
    const h2 = WALL_T / 2;
    parapet([P.x0 - h2, P.z0], [P.x0 - h2, A.z1 + WALL_T]);
    parapet([P.x1 + h2, A.z1 + WALL_T], [P.x1 + h2, P.z0]);
    parapet([A.x0, A.z1 + h2], [-1.9, A.z1 + h2]);
    parapet([1.9, A.z1 + h2], [A.x1, A.z1 + h2]);
    for (const sd of [-1, 1]) {
      stone.push(ST.block(sd * 1.9, 0, A.z1 + h2, 0.8, 3.0, 0.8, 0xffffff), ST.block(sd * 1.9, 3.0, A.z1 + h2, 1.0, 0.16, 1.0, 0xf1f3f5));
      stone.push(S.tint(new THREE.ConeGeometry(0.6, 0.7, 4).deleteAttribute('uv').rotateY(Math.PI / 4).translate(sd * 1.9, 3.5, A.z1 + h2), 0xe9ebee, 0.1));
    }
    // the iron gate stands open (#29: the warden comes in by it, up the road): a leaf swung back
    // against the parapet's outer face either side
    for (const sd of [-1, 1]) {
      const G = IRON_GATE; // logic/doorleaves.js: tests/doorleaves.test.js holds it outside the road's walls
      const gz = A.z1 + WALL_T + G.off;
      const last = G.bars - 1;
      for (let i = 0; i <= last; i++) {
        const gx = sd * (G.x0 + i * G.pitch);
        z.fit.push(box(gx, 1.35 - 0.02 * (last - i), gz, G.bar, 2.7 - 0.04 * (last - i), G.bar, 0x0e0d0c, 0.78, 0.05));
        z.fit.push(cone(gx, 2.7 - 0.04 * (last - i), gz, 0.035, 0.18, 0x0e0d0c, 4));
      }
      for (const yy of [0.3, 2.1]) z.fit.push(box(sd * G.rail.x, yy, gz, G.rail.w, 0.06, G.rail.d, 0x0e0d0c, 0, 0.05));
    }
    // the bridge: a timber deck with no rails, on two stone piers
    const len = B.z1 - B.z0;
    const planks = Math.round(len / 0.26);
    const rand = S.rng(17);
    for (let i = 0; i < planks; i++) {
      const pz = B.z0 + (i + 0.5) * (len / planks);
      z.fit.push(box((rand() - 0.5) * 0.08, -0.065 + (rand() - 0.5) * 0.01, pz, B.x1 - B.x0 + (rand() - 0.5) * 0.14, 0.12, len / planks - 0.016, 0x3b2a1c, (rand() - 0.5) * 0.012, 0.3));
    }
    for (const sx of [B.x0 + 0.5, 0, B.x1 - 0.5]) z.fit.push(box(sx, -0.31, (B.z0 + B.z1) / 2, 0.34, 0.36, len, 0x241810, 0, 0.2));
    for (const pz of [B.z0 + len / 3, B.z0 + (2 * len) / 3]) {
      worn.push(ST.block(0, P.y, pz, B.x1 - B.x0 + 0.6, -P.y - 0.5, 1.5, 0xd9dbde));
      worn.push(ST.block(0, P.y, pz, B.x1 - B.x0 + 1.4, 0.5, 2.3, 0xd9dbde));
    }
    // it is a drawbridge, and down: two lifting piers stand in the pit at its castle end, a chain
    // from the head of each to the deck's far corner, and the hinge beam it turns on. No rails.
    const pierH = 7;
    const piers = KM.PIERS || [{ x: -3.1, z: B.z0 + 0.5 }, { x: 3.1, z: B.z0 + 0.5 }]; // keepmap's boxes, where it has them
    for (const pr of piers) {
      const sd = Math.sign(pr.x); const px = pr.x; const pz = pr.z;
      stone.push(ST.block(px, P.y, pz, 1.0, pierH - P.y, 1.0, 0xffffff));
      stone.push(ST.block(px, pierH, pz, 1.24, 0.22, 1.24, 0xf1f3f5));
      stone.push(S.tint(new THREE.ConeGeometry(0.8, 0.9, 4).deleteAttribute('uv').rotateY(Math.PI / 4).translate(px, pierH + 0.67, pz), 0xe9ebee, 0.1));
      // the chain runs taut from the pier's head to an iron bracket 0.3 m outside the deck's far
      // corner: steep, and wide of the deck, so it is never a rail
      const ax = sd * (B.x1 + 0.3); const az = B.z1 - 0.3;
      z.fit.push(box(px - sd * 0.2, pierH - 0.5, pz + 0.45, 0.3, 0.18, 0.5, 0x14110f, 0, 0.05));
      z.fit.push(box(sd * (B.x1 + 0.14), -0.03, az, 0.5, 0.1, 0.16, 0x14110f, 0, 0.05), box(ax, 0.04, az, 0.12, 0.2, 0.12, 0x14110f, 0, 0.05));
      let last = null;
      for (let i = 0; i <= 14; i++) {
        const k = i / 14;
        const pt = new THREE.Vector3(lerp(px - sd * 0.2, ax, k), lerp(pierH - 0.5, 0.12, k) - 0.12 * Math.sin(k * Math.PI), lerp(pz + 0.6, az, k));
        if (last) z.fit.push(rod(last, pt, 0.065, 0x16140f));
        last = pt;
      }
    }
    z.fit.push(S.tint(new THREE.CylinderGeometry(0.15, 0.15, 7.2, 8).deleteAttribute('uv').rotateZ(Math.PI / 2).translate(0, -0.17, B.z0 + 0.12), 0x241810, 0.2, 3));
    // the forecourt: battlemented side walls, a brazier on each, and the eight pieces of cover
    for (const sd of [-1, 1]) {
      const wx = sd * (F.x1 + h2);
      stone.push(ST.wall({ from: [wx, F.z1], to: [wx, F.z0], y1: 5, t: WALL_T }));
      stone.push(ST.battlements([wx, F.z1], [wx, F.z0], 5, WALL_T + 0.1, 1.0, 0.9, 0.8));
      torch(z, sd * F.x1, (F.z0 + F.z1) / 2 + 1, [-sd, 0], 2.7);
      torch(z, sd * 2.7, X.front, [0, 1], 2.9);
    }
    for (const c of KM.COVER) {
      const w = c.maxX - c.minX; const d = c.maxZ - c.minZ; const hh = c.maxY || 1.5;
      stone.push(ST.block(c.x, 0, c.z, w, 0.22, d, 0xeef0f2), ST.block(c.x, 0.22, c.z, w - 0.14, hh - 0.44, d - 0.14, 0xffffff), ST.block(c.x, hh - 0.22, c.z, w, 0.22, d, 0xeef0f2));
      for (const fz of [c.minZ + 0.07, c.maxZ - 0.07]) stone.push(ST.surround({ at: 0, w: w - 0.6, h: hh - 0.7, rise: 0.25 }, { profile: ST.PROFILE.bead }).rotateY(fz < c.z ? Math.PI : 0).translate(c.x, 0.3, fz));
    }
    // ---- the house: a front wall with the door, twin gate towers, the wings, the keep behind
    const fz = X.front; // the face of the front wall
    const door = PLAN.doors[0];
    const fw = X.frontHalf;
    const big = { at: fw + door.c, w: door.w, h: door.h, rise: door.w * 0.5 };
    stone.push(ST.wall({ from: [-fw, fz - h2], to: [fw, fz - h2], y1: X.frontH, t: WALL_T, openings: [big] }));
    stone.push(ST.onWall(ST.surround(big, { profile: ST.PROFILE.door.map(([a, b]) => [a * 2.2, b * 2.2]) }), [-fw, fz], [fw, fz], 0));
    grinStone(z, door.c, door.h + 1.3, fz, [0, 1], 2.6, 5);
    stone.push(ST.course([-fw, fz], [fw, fz], X.frontH - 1.6, 0, { profile: ST.PROFILE.string.map(([a, b]) => [a * 3, b * 2.4]) }));
    stone.push(ST.battlements([-fw, fz - h2], [fw, fz - h2], X.frontH, 0.7, 1.3, 1.2, 1.0));
    // the raised portcullis: its spikes show under the arch
    for (let i = -4; i <= 4; i++) z.fit.push(box(door.c + i * 0.33, door.h - 0.55 - Math.abs(i) * 0.06, fz - 0.1, 0.07, 1.0, 0.07, 0x121010, 0.78, 0.1));
    // the great window over the door and a row of slits, lit from within
    const lit = (x, y, w, h, zz = fz + 0.03, warm = 1) => {
      const g = new THREE.PlaneGeometry(w, h);
      g.deleteAttribute('uv');
      g.translate(x, y + h / 2, zz);
      const c = new THREE.Color(HUE.fire).multiplyScalar(0.3 + 0.25 * warm);
      const col = new Float32Array(12);
      for (let i = 0; i < 4; i++) { const k = i < 2 ? 0.5 : 1.25; col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      z.lit.push(g);
    };
    const lancet = (x, y, w, h, zz = fz) => {
      stone.push(ST.surround({ at: 0, w, h, rise: w * 0.8 }, { profile: ST.PROFILE.bead.map(([p, q]) => [p * 1.6, q * 1.6]) }).translate(x, y, zz));
      lit(x, y, w, h * 0.86, zz + 0.03, 0.4 + 0.6 * Math.abs(Math.sin(x * 1.7 + y)));
    };
    lancet(0, door.h + 2.6, 2.4, 4.4);
    for (const sx of [-1, 1]) for (const k of [0, 1, 2]) lancet(sx * (15 + k * 5.5), 6.5, 1.0, 3.4);
    // towers, round, corbelled and capped
    const tower = (x, zz, rad, h, roofH) => {
      stone.push(ST.paint(new THREE.CylinderGeometry(rad, rad * 1.06, h, 20, 1, true).deleteAttribute('uv').translate(x, h / 2, zz), 0xffffff, { vary: 0.1, seed: x }));
      stone.push(ST.paint(new THREE.CylinderGeometry(rad * 1.14, rad, 1.0, 20, 1, true).deleteAttribute('uv').translate(x, h + 0.5, zz), 0xeef0f2, { vary: 0.08 }));
      stone.push(ST.paint(new THREE.CylinderGeometry(rad * 1.14, rad * 1.14, 1.4, 20, 1, true).deleteAttribute('uv').translate(x, h + 1.7, zz), 0xffffff, { vary: 0.1 }));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        stone.push(ST.block(x + Math.cos(a) * rad * 1.1, h + 2.4, zz + Math.sin(a) * rad * 1.1, 0.9, 0.9, 0.5, 0xf4f5f6));
      }
      z.dark.push(new THREE.ConeGeometry(rad * 1.02, roofH, 16).deleteAttribute('uv').deleteAttribute('normal').translate(x, h + 2.2 + roofH / 2, zz));
      z.fit.push(cyl(x, h + 2.2 + roofH - 0.2, zz, 0.05, 0.02, 2.4, 0x14110f, 5));
      for (const [hy, a] of [[h * 0.42, 0.25], [h * 0.68, -0.3], [h * 0.86, 0.1]]) lit(x + Math.sin(a) * rad, hy, 0.5, 2.0, zz + Math.cos(a) * rad + 0.06, 0.5);
    };
    for (const t of X.towers) tower(t.x, t.z, t.r, t.h, t.roof);
    // behind and above: the keep and its wings, begun above the eye line so nothing of them
    // stands in the rooms that can be seen from the forecourt
    for (const m of X.masses) {
      const g = new THREE.BoxGeometry(m.x1 - m.x0, m.y1 - m.y0, m.z1 - m.z0);
      g.deleteAttribute('uv');
      g.translate((m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2, (m.z0 + m.z1) / 2);
      stone.push(ST.paint(g, 0xf2f3f5, { vary: 0.1, seed: m.x0 }));
      stone.push(ST.battlements([m.x0, m.z1 - 0.3], [m.x1, m.z1 - 0.3], m.y1, 0.6, 1.2, 1.1, 0.9));
      // a steep slate roof
      const w = m.x1 - m.x0; const d = m.z1 - m.z0 - 1.2;
      const rg = new THREE.CylinderGeometry(0.01, w * Math.SQRT1_2, m.roof, 4, 1);
      rg.deleteAttribute('uv'); rg.deleteAttribute('normal');
      rg.rotateY(Math.PI / 4).scale(1, 1, d / w).translate((m.x0 + m.x1) / 2, m.y1 + m.roof / 2, (m.z0 + m.z1) / 2 - 0.6);
      z.dark.push(rg);
      const n = Math.max(2, Math.round(w / 5));
      for (let i = 0; i < n; i++) {
        const x = lerp(m.x0, m.x1, (i + 0.5) / n);
        for (let y = Math.max(m.y0 + 1.5, X.frontH + 1); y + 5 < m.y1; y += 7.5) lancet(x, y, 1.1, 4.2, m.z1);
      }
    }
    // the far walls that close the view at either end
    for (const sd of [-1, 1]) stone.push(ST.wall({ from: [sd * fw, fz], to: [sd * fw, fz - 60], y1: X.frontH - 2, t: 0.8 }));
    // crags on the horizon, a ring of them, black against the sky
    const rr = S.rng(77);
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU + rr() * 0.08;
      const rad = 124 + rr() * 30;
      const hh = 6 + rr() * 22 * (0.3 + 0.7 * Math.abs(Math.sin(a * 1.5 + 1)));
      const g = new THREE.ConeGeometry(9 + rr() * 13, hh, 5);
      g.deleteAttribute('uv'); g.deleteAttribute('normal');
      g.rotateY(rr() * 3).translate(Math.cos(a) * rad, hh / 2 - 1.5, Math.sin(a) * rad - 30);
      if (Math.sin(a) * rad - 30 > 40) { g.dispose(); continue; } // #29: the south is the road's hillside now
      z.ridge.push(g);
    }
    // the moon over the whole approach
    keys.outside = {
      kind: 'moon', pos: [X.moon[0] * 95, X.moon[1] * 95, 18 + X.moon[2] * 95], target: [0, 0, 18],
      intensity: 7, angle: 0.4, penumbra: 0.15, decay: 0, distance: 0, color: HUE.moon,
    };
    z.ambient = 2.2;
    z.outside = true;
  }

  // ---- finish each zone: a few merged meshes ----

  function finish(z) {
    const add = (m, cast = true, receive = true) => { m.castShadow = cast; m.receiveShadow = receive; z.group.add(m); return m; };
    if (z.stone.length) add(new THREE.Mesh(S.merge(z.stone), ST.stoneMaterial('ashlar', { floorY: z.y })));
    if (z.worn.length) add(new THREE.Mesh(S.merge(z.worn), ST.stoneMaterial('worn', { floorY: z.id === 'gallery' ? PLAN.gallery.cryptY : z.outside ? PLAN.outside.pit.y : z.y })));
    for (const [kind, parts] of Object.entries(z.floorParts)) add(new THREE.Mesh(S.merge(parts), ST.stoneMaterial(kind)), false);
    if (z.fit.length) add(new THREE.Mesh(S.merge(z.fit), fitMat));
    if (z.cloth.length) add(new THREE.Mesh(S.merge(z.cloth), clothMat), false);
    if (z.rug.length) add(new THREE.Mesh(mergeMapped(z.rug), rugMatFor(z.rugAspect || 1.5)), false);
    if (z.lit.length && z.outside) {
      // #29: the front's windows in four sets, so on the road they come on a few at a time as the
      // sun goes (roadview.js); all lit in the courtyard, as they always were
      for (let k = 0; k < 4; k++) {
        const set = z.lit.filter((g, i) => ((i * 7 + 3) % 4) === k);
        if (set.length) add(new THREE.Mesh(S.merge(set), windowMats[k]), false, false);
      }
    } else if (z.lit.length) add(new THREE.Mesh(S.merge(z.lit), litMat), false, false);
    if (z.sky.length) add(new THREE.Mesh(mergeMapped(z.sky), slitSkyMat), false, false); // the night through the slits
    if (z.dark.length) add(new THREE.Mesh(S.merge(z.dark.map((g) => { g.computeVertexNormals(); return S.tint(g, 0xffffff); })), darkMat), true, false);
    if (z.ridge.length) add(new THREE.Mesh(S.merge(z.ridge.map((g) => { g.computeVertexNormals(); return S.tint(g, 0xffffff); })), ridgeMat), false, false);
    if (z.glass.length) {
      const m = add(new THREE.Mesh(mergeMapped(z.glass), z.id === 'count' ? dawnGlass : glassMat), false, false);
      m.renderOrder = 2;
    }
    if (z.glow.length) {
      const m = add(new THREE.Mesh(z.glow.length === 1 ? z.glow[0] : S.merge(z.glow), glowMat), false, false);
      m.renderOrder = 3;
    }
    if (!z.flames.empty) {
      const m = add(new THREE.Mesh(z.flames.build(), flameMat), false, false);
      m.renderOrder = 3;
      m.frustumCulled = false;
      const pts = new THREE.BufferGeometry();
      pts.setAttribute('position', new THREE.Float32BufferAttribute(z.halos, 3));
      const halo = new THREE.Points(pts, haloMat);
      halo.renderOrder = 4;
      z.group.add(halo);
    }
    z.stone = z.worn = z.fit = z.cloth = z.rug = z.glass = z.lit = z.dark = z.ridge = z.glow = z.sky = null;
    z.floorParts = null;
    z.group.visible = false;
  }
  // the floor runs on under every doorway (the half of its depth no passage already covers)
  for (const d of KM.DOORS) {
    const r = d.rect;
    const pd = PLAN.doors.find((q) => q.id === d.id);
    const z = byId[pd.zones[1]];
    for (const half of [0, 1]) {
      const cut = pd.axis === 'x'
        ? { x0: r.minX, x1: r.maxX, z0: half ? pd.mid : r.minZ, z1: half ? r.maxZ : pd.mid }
        : { x0: half ? pd.mid : r.minX, x1: half ? r.maxX : pd.mid, z0: r.minZ, z1: r.maxZ };
      const cx = (cut.x0 + cut.x1) / 2; const cz = (cut.z0 + cut.z1) / 2;
      const covered = zones.some((q) => q.rects.some((qr) => cx > qr.x0 && cx < qr.x1 && cz > qr.z0 && cz < qr.z1));
      if (!covered) floorOf(z, z.kind === 'passage' ? 'flagWorn' : 'flag').push(flat(cut.x0, cut.x1, cut.z0, cut.z1, pd.y));
    }
    // fix/doorway-sky: a sub-floor 2 cm down under the whole threshold and half a metre into each
    // room, so the hairline seams where the floors of two zones and the doorway's own meet show
    // stone, never the sky under the house (merged into the floor's own mesh: no draw call)
    const m = 0.5;
    floorOf(z, z.kind === 'passage' ? 'flagWorn' : 'flag').push(flat(r.minX - m, r.maxX + m, r.minZ - m, r.maxZ + m, pd.y - 0.02));
  }
  // and the same under the seam where two runs of one passage meet (the passage's dog-leg to the nursery)
  for (const z of zones) {
    if (z.kind === 'outside' || z.id === 'stairs') continue;
    z.rects.forEach((r, i) => z.rects.forEach((q, j) => {
      if (j <= i) return;
      const xs = [Math.max(r.x0, q.x0), Math.min(r.x1, q.x1)]; const zs = [Math.max(r.z0, q.z0), Math.min(r.z1, q.z1)];
      const touchZ = Math.abs(xs[1] - xs[0]) > 1e-6 && Math.abs(zs[1] - zs[0]) < 1e-6; // the shared edge runs along x
      const touchX = Math.abs(zs[1] - zs[0]) > 1e-6 && Math.abs(xs[1] - xs[0]) < 1e-6;
      if (!touchZ && !touchX) return;
      const m = 0.5;
      floorOf(z, z.kind === 'passage' ? 'flagWorn' : 'flag').push(touchZ
        ? flat(xs[0], xs[1], zs[0] - m, zs[0] + m, z.y - 0.02)
        : flat(xs[0] - m, xs[0] + m, zs[0], zs[1], z.y - 0.02));
    }));
  }
  zones.forEach(finish);

  // ---- end caps (fix/doorway-sky) ----
  // A passage as wide as its door has no end wall of its own there (shell() leaves it out: the room
  // beyond's wall, with the door cut in it, closes it). Seen from a zone that draws the passage but not
  // the room beyond (the Count's room looking down the stairs, whose foot opens onto the walk), that
  // end was a hole the passage's full height onto the sky. Each such end gets the room beyond's wall
  // over the door's width, door cut and all, in the passage's own group, drawn only while the room
  // beyond is not (show()), so the two never stand in the same place at once.
  const caps = [];
  for (const d of PLAN.doors) {
    for (const aId of d.zones) {
      const a = byId[aId];
      const bId = d.zones.find((id) => id !== aId);
      const b = byId[bId];
      if (!a || !b || a.kind === 'outside' || b.kind === 'outside') continue;
      const along = d.axis === 'x' ? ['x0', 'x1', 'z0', 'z1'] : ['z0', 'z1', 'x0', 'x1'];
      const open = a.rects.some((r) => Math.abs(r[along[0]] - (d.c - d.w / 2)) < 1e-6 && Math.abs(r[along[1]] - (d.c + d.w / 2)) < 1e-6
        && (Math.abs(r[along[2]] - d.mid) < 1e-6 || Math.abs(r[along[3]] - d.mid) < 1e-6));
      if (!open) continue;
      // the room beyond's face on the door: its rect's edge at the door, its wall standing outward from it
      let edge = null;
      for (const r of b.rects) {
        if (d.c < r[along[0]] - 1e-6 || d.c > r[along[1]] + 1e-6) continue;
        for (const k of [along[2], along[3]]) if (Math.abs(r[k] - d.lo) < 1e-6 || Math.abs(r[k] - d.hi) < 1e-6) edge = r[k];
      }
      if (edge === null) continue;
      const aMid = a.rects.reduce((s, r) => s + (r[along[2]] + r[along[3]]) / 2, 0) / a.rects.length;
      const at = edge + Math.sign(aMid - edge) * WALL_T / 2;
      const lo = d.c - d.w / 2 - WALL_T; const hi = d.c + d.w / 2 + WALL_T;
      const from = d.axis === 'x' ? [lo, at] : [at, lo]; const to = d.axis === 'x' ? [hi, at] : [at, hi];
      const y0 = b.y;
      const rise = a.ceil && a.ceil.rise ? a.ceil.rise : 0;
      const op = { at: d.c - lo, w: d.w, h: d.h, y: d.y - y0, rise: d.w * 0.5 };
      const cut = op.y > 0.001 ? { ...op, y: op.y + 0.05 } : { ...op, h: op.h + 0.05 };
      const g = ST.wall({ from, to, y0: y0 - 0.05, y1: Math.max(a.y + a.h + rise + 0.25, d.y + d.h + 0.3), t: WALL_T, openings: [cut], seed: 91 });
      const kind = b.kind === 'passage' ? 'worn' : 'ashlar';
      const m = new THREE.Mesh(g, ST.stoneMaterial(kind, { floorY: b.y }));
      m.name = `castle:cap-${d.id}-${a.id}`;
      m.castShadow = true; m.receiveShadow = true;
      a.group.add(m);
      caps.push({ mesh: m, beyond: b });
    }
  }

  // ---- sky: a dome that rides with the eye, the stars on it, the moon ----
  const sky = new THREE.Group();
  root.add(sky);
  const moonDir = new THREE.Vector3(...PLAN.outside.moon).normalize();
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      moon: { value: moonDir.clone() }, dawn: { value: 0 }, glow: { value: 0 }, dusk: { value: 0 }, sunDir: { value: new THREE.Vector3(0, -1, 0) },
      sunUp: { value: DAWN_SUN.clone() }, // K1: the rising sun over the Count's windows (dawnview.js lights the land from it)
      // #29 (the colour script): the road's evening sky, set by roadview.js from logic/roadlight.js
      uZenith: { value: new THREE.Color() }, uAhead: { value: new THREE.Color() }, uBehind: { value: new THREE.Color() },
      uBelt: { value: new THREE.Color() }, uBeltK: { value: 0 }, uShadowBand: { value: new THREE.Color() }, uShadowTop: { value: 0 },
      uSunGlow: { value: new THREE.Color() },
    },
    vertexShader: 'varying vec3 vDir;\nvoid main() {\n  vDir = position;\n  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n}',
    fragmentShader: [
      'uniform vec3 moon;', 'uniform float dawn;', 'uniform float glow;', 'uniform float dusk;', 'uniform vec3 sunDir;', 'uniform vec3 sunUp;', 'varying vec3 vDir;',
      'uniform vec3 uZenith;', 'uniform vec3 uAhead;', 'uniform vec3 uBehind;', 'uniform vec3 uBelt;', 'uniform float uBeltK;',
      'uniform vec3 uShadowBand;', 'uniform float uShadowTop;', 'uniform vec3 uSunGlow;',
      'void main() {',
      '  vec3 d = normalize( vDir );',
      '  vec3 top = vec3( 0.006, 0.010, 0.022 );',
      '  vec3 low = vec3( 0.022, 0.036, 0.070 );',
      '  vec3 c = mix( low, top, smoothstep( -0.05, 0.6, d.y ) );',
      '  c = mix( c, vec3( 0.004, 0.006, 0.012 ), smoothstep( -0.02, -0.25, d.y ) );',
      '  float m = max( dot( d, moon ), 0.0 );',
      '  c += vec3( 0.10, 0.13, 0.18 ) * pow( m, 24.0 ) + vec3( 0.03, 0.04, 0.06 ) * pow( m, 3.0 );',
      // #27: before dawn, from the Knight's Walk on: an ember line on the eastern horizon and the
      // night just above it greying to deep blue. No sun, and far under the Count's room's dawn.
      '  float eastward = smoothstep( -0.2, 0.85, d.x );',
      '  c += glow * eastward * smoothstep( 0.30, -0.01, d.y ) * smoothstep( -0.06, 0.015, d.y ) * vec3( 0.30, 0.10, 0.035 );',
      '  c += glow * eastward * smoothstep( 0.6, 0.05, d.y ) * smoothstep( -0.06, 0.05, d.y ) * vec3( 0.018, 0.026, 0.05 );',
      // #29, the colour script: on the road, an evening sky built as structure, not one gradient.
      // The horizon is warm on the sun's side (behind the climb, SSW) and cooler ahead (the
      // anti-solar side, over the castle); the zenith over both. Ahead, the Earth's shadow rises
      // from the horizon as the sun sinks, the dusty Belt of Venus just above it. All the colours
      // come from roadview.js (logic/roadlight.js keyframes); dusk 0 is the castle's own night.
      '  if ( dusk > 0.001 ) {',
      '    vec2 hz = normalize( d.xz + vec2( 1e-5 ) );',
      '    vec2 sz = normalize( sunDir.xz + vec2( 1e-5 ) );',
      '    float side = dot( hz, sz ) * 0.5 + 0.5;',
      '    vec3 ev = mix( uAhead, uBehind, smoothstep( 0.1, 1.0, side ) );',
      '    ev = mix( ev, uZenith, smoothstep( 0.0, 0.8, d.y ) );',
      '    float anti = smoothstep( 0.6, 0.05, side );',
      '    float el = degrees( asin( clamp( d.y, -1.0, 1.0 ) ) );',
      '    float band = anti * step( 0.01, uShadowTop ) * smoothstep( uShadowTop + 1.5, uShadowTop - 1.5, el ) * smoothstep( -4.0, 0.0, el );',
      '    ev = mix( ev, uShadowBand, band * 0.9 );',
      '    float belt = anti * uBeltK * exp( -pow( ( el - uShadowTop - 6.0 ) / 5.0, 2.0 ) );',
      '    ev = mix( ev, uBelt, clamp( belt, 0.0, 1.0 ) * 0.85 );',
      '    float s = max( dot( d, sunDir ), 0.0 );',
      '    ev += uSunGlow * ( 0.25 * pow( s, 6.0 ) + 0.2 * pow( s, 48.0 ) );',
      '    ev = mix( ev, uAhead * 0.3, smoothstep( 0.0, -0.22, d.y ) );',
      '    c = mix( c, ev, dusk );',
      '  }',
      // K1: the dawn as a sky, not a fill: pale gold at the horizon rising to a pale blue-gold, the
      // sun low in the east-south-east with its glow, and thin streaks of cloud lit from beneath
      '  if ( dawn > 0.001 ) {',
      '    float el = d.y;',
      '    vec3 ds = mix( vec3( 1.0, 0.6, 0.24 ), vec3( 1.0, 0.7, 0.38 ), smoothstep( 0.0, 0.12, el ) );',
      '    ds = mix( ds, vec3( 0.62, 0.6, 0.6 ), smoothstep( 0.12, 0.4, el ) );',
      '    ds = mix( ds, vec3( 0.24, 0.36, 0.62 ), smoothstep( 0.38, 0.95, el ) );',
      '    ds = mix( ds, vec3( 0.86, 0.66, 0.42 ), smoothstep( 0.0, -0.12, el ) );',
      '    float s = max( dot( d, sunUp ), 0.0 );',
      '    ds += vec3( 1.0, 0.45, 0.12 ) * 0.22 * pow( s, 5.0 ) + vec3( 1.0, 0.75, 0.4 ) * 0.3 * pow( s, 90.0 );',
      '    float az = atan( d.z, d.x );',
      '    float band = smoothstep( 0.025, 0.06, el ) * smoothstep( 0.26, 0.11, el );',
      '    float streak = ( 0.5 + 0.5 * sin( az * 19.0 + 2.2 * sin( az * 6.0 ) + el * 30.0 ) ) * ( 0.5 + 0.5 * sin( el * 75.0 + az * 3.0 ) );',
      '    float cl = band * smoothstep( 0.45, 0.85, streak );',
      '    ds = mix( ds, vec3( 1.0, 0.56, 0.36 ) * ( 0.85 + 0.3 * pow( s, 3.0 ) ), cl * 0.6 );',
      '    ds = mix( ds, vec3( 1.0, 0.98, 0.9 ), smoothstep( 0.99955, 0.9998, s ) );',
      '    c = mix( c, ds, dawn );',
      '  }',
      '  gl_FragColor = vec4( c, 1.0 );',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(170, 24, 14), skyMat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  sky.add(dome);
  {
    const rand = S.rng(404);
    const n = 1500;
    const pos = new Float32Array(n * 3); const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = rand() * 0.98 + 0.02; const a = rand() * TAU; const rr = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * rr * 165; pos[i * 3 + 1] = y * 165; pos[i * 3 + 2] = Math.sin(a) * rr * 165;
      const b = Math.pow(rand(), 3) * 0.9 + 0.12; const t = rand();
      col[i * 3] = b * (0.8 + 0.2 * t); col[i * 3 + 1] = b * 0.9; col[i * 3 + 2] = b * (1.0 - 0.15 * t);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const starMat = new THREE.PointsMaterial({ vertexColors: true, size: 1.7, sizeAttenuation: false, fog: false, depthWrite: false, transparent: true });
    const stars = new THREE.Points(g, starMat);
    stars.renderOrder = -9;
    stars.frustumCulled = false;
    sky.add(stars);
    sky.userData.starMat = starMat;
  }
  const moonMat = new THREE.MeshBasicMaterial({ map: moonTexture(), transparent: true, fog: false, depthWrite: false, toneMapped: false });
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), moonMat);
  moon.position.copy(moonDir).multiplyScalar(160);
  moon.lookAt(0, 0, 0);
  moon.renderOrder = -8;
  sky.add(moon);
  const moonHalo = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshBasicMaterial({
    map: glowTexture(), color: HUE.moon, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, fog: false, depthWrite: false,
  }));
  moonHalo.position.copy(moonDir).multiplyScalar(162);
  moonHalo.lookAt(0, 0, 0);
  moonHalo.renderOrder = -8;
  sky.add(moonHalo);

  // ---- lights: a fixed set, moved and faded, never added or removed ----
  const hemi = new THREE.HemisphereLight(0x6f86b4, 0x45536f, 0.4);
  root.add(hemi);
  const fill = new THREE.DirectionalLight(HUE.moon, 0); // the open night's soft second light; dark indoors
  fill.position.set(-0.5, 0.6, 0.8);
  root.add(fill, fill.target);
  const key = new THREE.SpotLight(HUE.moon, 0, 0, 0.5, 0.2, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  root.add(key, key.target);
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const l = new THREE.PointLight(FIRELIGHT, 0, 16, 1.7);
    root.add(l);
    pool.push({ l, at: null, level: 0 });
  }
  const keyState = { spec: null, level: 0 };
  // #29: the road up from the wood, and the evening on it (built after the sky and the lights it steers)
  const roadView = createRoadView(root, {
    fill, hemi, fog, background, skyMat, sky, starMat: sky.userData.starMat, moonMat, moonHalo: moonHalo.material, key, getRenderer: () => renderer,
    // #29 (the colour script): the sky's moon and halo to place, the crags' and roofs' material, the
    // front's window sets, and the outside's stone (the castle's silhouette treatment on the road)
    moon, moonHaloMesh: moonHalo, moonDir, darkMat, windowMats,
    castleStone: [ST.stoneMaterial('ashlar', { floorY: 0 }), ST.stoneMaterial('worn', { floorY: PLAN.outside.pit.y }), fitMat],
  });

  let renderer = null;
  let camera = null;
  let saved = null;
  let shadowLevel = 2;
  let lowFor = 0;
  let smoothFps = 60;
  let lastWall = 0;
  let age = 0;
  let zoneNow = 0;
  let lowerNow = false;
  let reduced = false;
  let only = null; // a zone id the mirror pass asked to see alone
  let dawnLevel = 0;
  let glowLevel = 0; // #27: the horizon's glow before dawn, 0 to 1
  const eye = new THREE.Vector3(0, 1.7, 40);

  function applyShadows() {
    const on = shadowLevel > 0;
    if (renderer) renderer.shadowMap.enabled = on && root.visible;
    const size = SHADOW_SIZES[Math.max(1, shadowLevel)];
    if (key.shadow.mapSize.x !== size) {
      key.shadow.mapSize.set(size, size);
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    }
  }

  /** Makes the castle the room on screen: fog, night sky, tone mapping, shadows. */
  function apply(r) {
    if (r) renderer = r;
    if (!camera) camera = scene.children.find((o) => o.isCamera) || null;
    if (!saved && renderer) saved = { tone: renderer.toneMapping, exposure: renderer.toneMappingExposure };
    root.visible = true;
    scene.fog = fog;
    scene.background = background;
    if (renderer) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.setClearColor(HUE.night);
    }
    shadowLevel = 2;
    lowFor = 0;
    age = 0;
    applyShadows();
    show();
  }

  function hide() {
    root.visible = false;
    if (renderer) {
      renderer.shadowMap.enabled = false;
      if (saved) { renderer.toneMapping = saved.tone; renderer.toneMappingExposure = saved.exposure; }
    }
    saved = null;
  }

  /** The index of the zone a point is in (keepmap's answer); the zone before it inside a wall. */
  function zoneAt(x, z, last = zoneNow) {
    const id = KM.zoneAt(x, z);
    if (id && byId[id]) return byId[id].index;
    if (id || z > PLAN.outside.front) return 0;
    return last;
  }

  const visibleIds = []; // the zones drawn now: the occupied one, its neighbours, its sight lines
  function show() {
    const cur = zones[zoneNow];
    visibleIds.length = 0;
    for (const z of zones) {
      z.group.visible = only ? z.id === only : (z === cur || cur.neighbours.has(z.id));
      if (z.group.visible) visibleIds.push(z.id);
    }
    for (const c of caps) c.mesh.visible = !c.beyond.group.visible; // fix/doorway-sky: a passage's open end closed while the room beyond is not drawn
    sky.visible = true;
  }
  const shellOf = (id) => (byId[id] ? id : id === 'crypt' ? 'gallery' : 'outside'); // a keepmap zone id -> the shell's

  function watchFrameRate(dt) {
    const now = performance.now() / 1000;
    const raw = now - lastWall;
    lastWall = now;
    if (raw <= 0 || raw > 0.5 || shadowLevel === 0 || dt <= 0) return;
    age += raw;
    smoothFps += (1 / raw - smoothFps) * 0.05;
    if (age < 3) return; // first-use shader compiles are not the frame rate
    lowFor = smoothFps < LOW_FPS ? lowFor + raw : 0;
    if (lowFor >= LOW_FPS_HOLD) {
      shadowLevel -= 1;
      lowFor = 0;
      applyShadows();
    }
  }

  // Two rates at once and a slow swell, so a flame never settles; under reduced flash, a slow drift.
  function flicker(time, seed) {
    if (reduced) return 1 + 0.05 * Math.sin(time * 0.7 + seed);
    return 1 + 0.15 * Math.sin(time * 11.3 + seed) + 0.09 * Math.sin(time * 27.1 + seed * 2.3) + 0.07 * Math.sin(time * 2.9 + seed * 0.7);
  }

  // K5: the flames keep the full flicker (the halo and the flame meshes); the room's light swings only about +/-8%,
  // so the hall stops pumping. The full flicker's peak swing is 0.31.
  const LIGHT_SWING = 0.08 / 0.31;
  function lightFlicker(time, seed) {
    return reduced ? flicker(time, seed) : 1 + LIGHT_SWING * (flicker(time, seed) - 1);
  }

  let hiddenForCut = false; // the shell hidden under the werewolf cutaway's climb
  const filmOut = {}; // cutawayAt's answer, reused every frame
  const frontDoor = doors.find((dr) => dr.d.id === 'front');
  const _cand = [];
  const byDistance = (a, b) => a.d - b.d;
  let stamp = 0;
  /** Once a frame. sim may be null (the title). */
  function update(sim, dt, time) {
    if (!root.visible) return;
    if (!camera) camera = scene.children.find((o) => o.isCamera) || null;
    const inRun = sim && sim.cfg && sim.cfg.room === 'castle';
    if (camera) eye.copy(camera.position);
    else if (inRun) eye.set(sim.player.x, (sim.player.y || 0) + 1.7, sim.player.z);
    // the warden's own place decides the zone in play (a scene camera may leave the room)
    const px = inRun && !(sim.waves && sim.waves.scene) ? sim.player.x : eye.x;
    const pz = inRun && !(sim.waves && sim.waves.scene) ? sim.player.z : eye.z;
    const was = zoneNow;
    zoneNow = zoneAt(px, pz);
    const cur = zones[zoneNow];
    const under = inRun && sim.waves ? sim.waves.under : null;
    lowerNow = under === 'crypt' || under === 'pit' || (cur.id === 'gallery' && eye.y < cur.y - 0.4);
    // the werewolf cutaway: over the climb to the face the castle is not drawn (its towers never on
    // the skyline); its run beat is played on the castle's real front (the owner, 2026-11-18), the
    // shell drawn as the warden would see it there, the camera kept tight (logic/cutaway.js)
    const sc = inRun && sim.waves && sim.waves.scene && sim.waves.scene.kind === 'cutaway' ? sim.waves.scene : null;
    const film = sc ? cutawayAt(sc.t || 0, sc, filmOut) : null;
    const cutting = !!film && !film.front;
    if (was !== zoneNow || dt === 0 || cutting !== hiddenForCut) show();
    if (cutting) for (const z of zones) z.group.visible = false;
    hiddenForCut = cutting;
    watchFrameRate(dt);
    flameTime.value = time;
    flameCalm.value = reduced ? 1 : 0;
    sky.position.copy(eye);

    // doors
    for (let i = 0; i < doors.length; i++) {
      const dr = doors[i];
      // in a run the swing is the rules' own (keep.js w.leaves: the leaves are solid where they are
      // drawn); with no run (the title) the view eases them itself, at the same pace
      const ruled = inRun && sim.waves && sim.waves.leaves ? sim.waves.leaves[dr.d.id] : undefined;
      const goal = doorOpen(dr.d, sim) ? 1 : 0;
      if (typeof ruled === 'number') dr.open = ruled;
      else dr.open = dt > 0 ? swingToward(dr.open, goal, dt) : goal;
      dr.made[0].hinge.rotation.y = leafPose(dr.src, 0, dr.open).rotY;
      dr.made[1].hinge.rotation.y = leafPose(dr.src, 1, dr.open).rotY;
    }
    // the film's front door: its two leaves where the film has them (west, east), the door's own
    // state (dr.open, the rules' answer) untouched, so after the film it stands exactly as it did
    if (film && film.front && frontDoor) {
      frontDoor.made[0].hinge.rotation.y = frontDoor.made[0].sign * film.door[0];
      frontDoor.made[1].hinge.rotation.y = frontDoor.made[1].sign * film.door[1];
    }

    // dawn in the Count's room: one part for each open curtain, all of it once he is ash
    const w = inRun ? sim.waves : null;
    let dawn = 0;
    if (w && cur.id === 'count') {
      let open = 0;
      if (w.count && w.count.open) for (let i = 0; i < w.count.open.length; i++) if (w.count.open[i]) open += 1;
      dawn = w.done && w.done.dawn ? 1 : open / 3 * 0.75;
    }
    dawnLevel += (dawn - dawnLevel) * Math.min(1, dt * 1.2);
    if (dt === 0) dawnLevel = dawn;
    skyMat.uniforms.dawn.value = dawnLevel;
    // #27: the first glow of dawn, from the Knight's Walk (stage 4) on, coming up over seconds
    const glow = w && w.index >= WALK_STAGE ? 1 : 0;
    glowLevel = dt === 0 || !inRun ? glow : glowLevel + (glow - glowLevel) * Math.min(1, dt * 0.35);
    skyMat.uniforms.glow.value = glowLevel;
    sky.userData.starMat.opacity = Math.max(0, 1 - dawnLevel - 0.12 * glowLevel);
    moonMat.opacity = 1 - 0.7 * dawnLevel;

    // the key light: fade out, move, fade in
    let want = keys[cur.id] || null;
    if (cur.id === 'count' && dawnLevel > 0.5) want = keys.dawn;
    if (lowerNow && cur.id === 'gallery') want = null;
    const k = Math.min(1, dt * 2.6);
    if (keyState.spec !== want) {
      keyState.level -= dt * 3;
      if (keyState.level <= 0 || !keyState.spec || dt === 0) {
        keyState.level = dt === 0 ? 1 : 0;
        keyState.spec = want;
        if (want) {
          key.position.set(want.pos[0], want.pos[1], want.pos[2]);
          key.target.position.set(want.target[0], want.target[1], want.target[2]);
          key.target.updateMatrixWorld();
          key.color.setHex(want.color);
          key.angle = want.angle; key.penumbra = want.penumbra; key.decay = want.decay; key.distance = want.distance;
          const far = Math.hypot(want.pos[0] - want.target[0], want.pos[1] - want.target[1], want.pos[2] - want.target[2]);
          key.shadow.camera.near = want.kind === 'fire' ? 0.3 : Math.max(1, far * 0.35);
          key.shadow.camera.far = want.kind === 'fire' ? want.distance : far * 1.5;
          key.shadow.camera.updateProjectionMatrix();
        }
      }
    } else if (want) keyState.level += (1 - keyState.level) * k;
    const ks = keyState.spec;
    key.intensity = ks ? ks.intensity * clamp(keyState.level) * (ks.kind === 'fire' ? lightFlicker(time, ks.seed || 0) : 1) : 0;
    if (ks && ks.kind === 'fire' && !reduced) {
      // the fire's shadows breathe: the light itself shifts a hand's breadth
      key.position.set(ks.pos[0] + 0.05 * Math.sin(time * 7.1), ks.pos[1] + 0.06 * Math.sin(time * 9.7 + 1), ks.pos[2] + 0.05 * Math.sin(time * 5.3 + 2));
    }

    // the flames' light: the nearest five in the zones on screen
    _cand.length = 0;
    for (let zi = 0; zi < zones.length; zi++) {
      const z = zones[zi];
      if (!z.group.visible) continue;
      // a flame in the next zone lights this one only from close by: these lights cast no shadow,
      // and the Knight's Walk takes no flame's light at all
      if (z !== cur && cur.still) continue;
      for (let fi = 0; fi < z.fires.length; fi++) {
        const f = z.fires[fi];
        if (z.id === 'gallery' && (f.y < z.y) !== lowerNow) continue;
        if (z !== cur && (f.x - eye.x) ** 2 + (f.z - eye.z) ** 2 > 36) continue;
        // the occupied zone's flames first, a strong one before a weak one
        f.d = ((f.x - eye.x) ** 2 + (f.z - eye.z) ** 2 + 4) / (f.power * f.power) + (z === cur ? 0 : 1e5);
        _cand.push(f);
      }
    }
    _cand.sort(byDistance);
    stamp += 1;
    const picked = Math.min(POOL, _cand.length);
    for (let i = 0; i < picked; i++) _cand[i].stamp = stamp; // this frame's chosen flames
    for (let i = 0; i < POOL; i++) {
      const s = pool[i];
      if (s.at && s.at.stamp !== stamp) {
        s.level -= dt * 3.5;
        if (s.level <= 0 || dt === 0) { s.at = null; s.level = 0; }
      }
    }
    for (let i = 0; i < picked; i++) {
      const f = _cand[i];
      let held = false; let free = null;
      for (let j = 0; j < POOL; j++) {
        if (pool[j].at === f) held = true;
        else if (!pool[j].at && !free) free = pool[j];
      }
      if (held || !free) continue;
      free.at = f; free.level = dt === 0 ? 1 : 0;
      free.l.position.set(f.x, f.y, f.z);
    }
    // the werewolf film's castle front: the torches' pools up, so the fire reads against the dusk (the art critic)
    const filmTorch = film && film.front ? CUTAWAY.sun.torch : 1;
    for (let i = 0; i < POOL; i++) {
      const s = pool[i];
      if (s.at && s.at.stamp === stamp) s.level = Math.min(1, s.level + dt * 2.5);
      // K4: the flames' share; a passage's torches keep more of it, the pools that make a passage readable (K2)
      s.l.intensity = s.at ? 12 * (s.at.passage ? PASSAGE_FIRE : FIRE_SHARE) * (s.at.cold ? COLD.fire : 1) * s.at.power * clamp(s.level) * lightFlicker(time, s.at.seed) * filmTorch : 0;
    }
    glowMat.opacity = lightFlicker(time, 4.7); // the exit candle's pool breathes with its flame (slow drift under reduced flash)
    haloMat.opacity = 0.26 * (reduced ? 1 : 0.9 + 0.1 * Math.sin(time * 9.1) + 0.06 * Math.sin(time * 23.3));

    // the air of the zone: how much the night itself lights, how thick the dark is
    const amb = (lowerNow && cur.cryptAmbient != null ? cur.cryptAmbient : cur.ambient == null ? 0.2 : cur.ambient);
    const mixK = dt === 0 ? 1 : Math.min(1, dt * 2);
    const cold = coldZone(cur); // K3: the upper storey's air is moon-silver
    // (the moon-silver lift gives way as the dawn comes, so the Count's room takes the gold cast it always had: no flood)
    hemi.intensity += (amb * (cold ? lerp(COLD.hemiK, 1, clamp(dawnLevel * 2)) : 1) * (1 + 0.6 * dawnLevel) - hemi.intensity) * mixK;
    hemi.color.setHex(0x6f86b4);
    if (cold) hemi.color.setHex(COLD.hemi);
    hemi.color.lerp(_gold, dawnLevel * 0.8);
    dawnGlass.opacity = 0.42 - 0.39 * dawnLevel; // K1: the glass clears as the sun comes up, so it lays no veil on the view
    if (dawnView) dawnView.setLevel(dawnLevel);
    fill.intensity += ((cur.outside ? 1.1 : 0) - fill.intensity) * mixK;
    fog.density += ((cur.outside ? 0.0055 : 0.022) - fog.density) * mixK;
    fog.color.setHex(HUE.night).lerp(_gold, dawnLevel * 0.25);
    background.copy(fog.color);
    fill.position.set(-0.5, 0.6, 0.8); // the night's own fill: the road steers it below (#29)
    fill.color.setHex(HUE.moon);
    hemi.groundColor.setHex(0x45536f);
    roadView.update(sim, dt, time, !!inRun, !!cur.outside, eye); // #29: on the road the evening has the last word
    if (cold) hemi.groundColor.setHex(COLD.ground);
    // K9: the crags sit a grade over the roofs' black, in the night sky's hue (on the road, over its evening grade)
    ridgeMat.color.copy(darkMat.color).add(_ridgeLift);
  }
  const _gold = new THREE.Color(HUE.dawn);
  const _ridgeLift = new THREE.Color(RIDGE).sub(new THREE.Color(0x080b12));

  // ---- the title fly-through: over the bridge, in at the door and through every room ----
  const path = new THREE.CatmullRomCurve3(PLAN.fly.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal', 0.5);
  const titlePos = new THREE.Vector3();
  const titleTarget = new THREE.Vector3();
  function titleCamera(time) {
    const u = ((time % TITLE_LOOP) + TITLE_LOOP) % TITLE_LOOP / TITLE_LOOP;
    // linger outside: the first fifth of the loop covers the approach
    const k = u < 0.22 ? (u / 0.22) * 0.12 : 0.12 + ((u - 0.22) / 0.78) * 0.88;
    path.getPointAt(clamp(k, 0, 0.985), titlePos);
    path.getPointAt(clamp(k + 0.015, 0, 1), titleTarget);
    titlePos.y += 0.06 * Math.sin(time * 0.5);
    return { position: titlePos, target: titleTarget };
  }

  // ---- the two scenes ----
  const scenePos = new THREE.Vector3();
  const sceneTarget = new THREE.Vector3();
  /**
   * The camera for a scene: { position, target }, or null for a kind this room does not own.
   * strike: the view leaves the warden and looks down the tea room, clocks, table and far door.
   * pyre: the view turns to the box of earth and holds, closing slowly, and ends on the windows.
   */
  function sceneCamera(sim, sc) {
    if (!sc) return null;
    const kind = sc.kind;
    const total = sc.total || (kind === 'pyre' ? 10 : 6);
    const t = sc.t != null ? sc.t : sc.left != null ? total - sc.left : 0;
    const q = clamp(t / total);
    if (kind === 'strike') {
      const r = byId.tea.rects[0];
      const cx = (r.x0 + r.x1) / 2; const cz = (r.z0 + r.z1) / 2;
      const a = lerp(-0.5, 0.35, smooth(q));
      scenePos.set(cx + Math.sin(a) * 7.5, byId.tea.y + lerp(4.4, 3.2, smooth(q)), r.z1 - 2.2 - 1.5 * smooth(q));
      sceneTarget.set(cx, byId.tea.y + 1.3, lerp(cz, r.z0 + 0.5, smooth(Math.max(0, q - 0.55) / 0.45)));
      return { position: scenePos, target: sceneTarget };
    }
    if (kind === 'pyre') {
      // K10: close on him while he burns (he stands about half the frame's height), then crane up
      // with the whirlwind from 5 s so the shades go out through the dawn in frame, then settle on
      // the ash in the still gold. A longer lens than the warden's.
      const y = byId.count.y;
      const bx = KM.COUNT_ROOM.boxAt.x; const bz = KM.COUNT_ROOM.boxAt.z;
      const win = KM.COUNT_ROOM.curtains[KM.MIDDLE_CURTAIN];
      const pl = sim && sim.player;
      const side = pl && pl.z > bz ? 1 : -1; // from the warden's side of the room
      const push = smooth(t / 5);
      const crane = smooth((t - 4.2) / 3.0);
      const settle = smooth((t - 8.3) / 1.5);
      scenePos.set(lerp(bx - 4.3, bx - 3.8, push), y + lerp(1.85, 2.0, push), bz + side * lerp(3.1, 2.7, push));
      scenePos.x = lerp(scenePos.x, bx - 5.2, crane); scenePos.y = lerp(scenePos.y, y + 3.4, crane); scenePos.z = lerp(scenePos.z, bz + side * 3.8, crane);
      sceneTarget.set(bx, y + lerp(2.15, 2.25, push), bz);
      sceneTarget.x = lerp(sceneTarget.x, win.x - 4, crane); sceneTarget.y = lerp(sceneTarget.y, y + 3.9, crane); sceneTarget.z = lerp(sceneTarget.z, win.z, crane);
      sceneTarget.x = lerp(sceneTarget.x, bx + 1.5, settle); sceneTarget.y = lerp(sceneTarget.y, y + 1.0, settle); sceneTarget.z = lerp(sceneTarget.z, bz, settle);
      return { position: scenePos, target: sceneTarget, fov: lerp(48, 62, crane) };
    }
    if (kind === 'triumph') return triumphCamera(sim, sc);
    if (kind === 'cutaway') return roadView.sceneCamera(sim, sc); // the werewolf cutaway, on the road and the castle's front
    return null;
  }

  /**
   * Issue #20, the triumph: from the warden's own eyes (the warden is only ever seen in the glass),
   * standing in the middle window's light. The look turns and rises to
   * the window full of dawn, and holds there, a little lifted, while THE END comes up. The look
   * starts from where the warden faced, so there is no cut from the warden's eye.
   */
  function triumphCamera(sim, sc) {
    const y = byId.count.y;
    const r = byId.count.rects[0];
    const pl = sim && sim.player;
    const win = KM.COUNT_ROOM.curtains[KM.MIDDLE_CURTAIN];
    const px = pl && Number.isFinite(pl.x) ? pl.x : win.x - 2; const pz = pl && Number.isFinite(pl.z) ? pl.z : win.z;
    const t = sc.t != null ? sc.t : (sc.total || 8) - (sc.left || 0);
    // The look starts where the warden was looking (no cut), level, from the warden's eye.
    const yaw = pl && Number.isFinite(pl.yaw) ? pl.yaw : -Math.PI / 2;
    const eyeY = y + 1.65;
    // K12: the warden goes up to the middle window and the look rises into it, square on, so by
    // THE END (4 s) the window's sky and the sunrise over the land fill most of the frame
    const go = smooth(clamp(t / 4.2));
    const lift = smooth(clamp((t - 0.6) / 4.6));
    const sill = r.x1 - 1.3; // close to the window's inner face, so its light fills the frame
    scenePos.set(lerp(px, sill, go), lerp(eyeY, y + 1.75, go), lerp(pz, win.z, go));
    sceneTarget.set(lerp(px - Math.sin(yaw) * 4, r.x1 + 6, go), lerp(eyeY, y + 1.75 + 6 * 0.17, lift), lerp(pz - Math.cos(yaw) * 4, win.z, go));
    return { position: scenePos, target: sceneTarget, fov: lerp(75, 50, smooth(clamp(t / 4.6))) };
  }

  /** Draw calls (meshes) and triangles each zone adds when it is on screen. */
  function counts() {
    const out = {};
    for (const z of zones) {
      let calls = 0; let tris = 0;
      z.group.traverse((m) => {
        if (!m.isMesh && !m.isPoints) return;
        calls += 1;
        const g = m.geometry;
        if (m.isMesh) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      });
      out[z.id] = { calls, triangles: Math.round(tris), neighbours: [...z.neighbours] };
    }
    return out;
  }

  /**
   * Drops the castle for good: off the scene, its geometries, its own textures and materials and the
   * shadow map freed. The stone maps and materials are a cache shared with every view that calls
   * stoneMaterial (the props' marble), so they are left: call stone.js disposeStone() once, after
   * every such view has been disposed.
   */
  function dispose() {
    hide();
    scene.remove(root);
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.userData.stone) continue; // the shared stone cache: other views may still be drawing with it
        for (const k of ['map', 'bumpMap', 'alphaMap']) if (m[k]) m[k].dispose();
        m.dispose();
      }
    });
    for (const m of rugMats.values()) { m.map.dispose(); m.dispose(); }
    rugMats.clear();
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    root.userData.castle = null;
  }

  const handle = {
    group: root, apply, hide, update, titleCamera, sceneCamera, counts, zoneAt, dispose,
    /** The shell's zone ids on screen now (the occupied zone, the zones one door away, its sight lines). */
    get visible() { return visibleIds; },
    /** True when the zone a keepmap zone id belongs to is on screen ('pit' and 'crypt' go with their upper floors). */
    sees(id) { return visibleIds.includes(shellOf(id)); },
    plan: PLAN,
    zones: zones.map((z) => ({ id: z.id, group: z.group })),
    /** Reduced flash: fire and torch flicker drops to a slow drift. */
    setReducedFlash(on) { reduced = !!on; },
    /** For the mirror pass: draw one zone alone (by id), or pass null to put the zones back. */
    showOnly(id) { only = id || null; show(); },
    get zone() { return zones[zoneNow].id; },
    get lower() { return lowerNow; },
    get shadowLevel() { return shadowLevel; },
    get moon() { return moonDir; },
  };
  root.userData.castle = handle; // the cast and the props find the shell here (castle.sees, castle.visible)
  return handle;
}
