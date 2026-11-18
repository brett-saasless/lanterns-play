// The castle's things, drawn from sim state every frame so a restored checkpoint shows exactly
// what the state says: the tea room's five clocks (minute hands at a quarter to, the hour hand
// where the rules put it, a right clock ticking, all five shivering as they strike) and its set
// table (a rotting boar's head with flies, wilted flowers, mouldy bread, a steaming turkey, two
// candelabras, the spilled and broken wine bottle); the gallery's sixty marble tiles and its red
// runner; the crypt's boxes of earth and its closed coffin; the brass plate by the board; the
// mirror room's five pieces of furniture, its salt box and the figure-mirror; the nursery's cot,
// its self-rocking horse, the music box and the dust sheets; the Count's box of earth and his
// three curtains (the tangled cord, the chained bar and padlock, the three hem nails); the dried
// garlic braid on its nail with the scratched words; and the places the good things hide.
//
// Security A5 (the view side). A tile's layer comes from gallery.js's isTrue(tile) and from
// nothing else: tileLayers() below is the one place it is asked, and the floor is laid from it
// on build, on every tileBreak and on restored. A true tile is on layer 0 (the eye and the
// glass both see it), a false tile on layer 1 (the eye only), a gone tile on neither. The
// runner is on layer 1; the grin is on layer 2 (the glass only) over the square the rules name
// (sim.waves.hints.gallery.grin, which keep.js takes from nextTrue). This file never reads the
// true-path table in keepmap.js.
//
// Places are keepmap.js's, numbers are the config's, words are script.js's. Each zone's things
// are built when the zone comes into range (the zone the warden is in and the zones through its
// doors) and freed when it leaves it. An actors layer: { sync, onEvent, clear, setReducedFlash }.
// Events only add one-shot motion (shards, chips); nothing here writes the sim.

import * as THREE from 'three';
import * as S from './sculpt.js';
import * as ST from './stone.js';
import {
  ZONES, DOORS, UPPER, zoneAt, tileRect, GALLERY, HALL, CLOCKS, TEA, GALLERY_PROPS, CRYPT, CRYPT_PROPS, BOARD,
  MIRROR_ROOM, FURNITURE, NURSERY, COUNT_ROOM, COUNTWAY,
} from '../logic/keepmap.js';
import { isTrue, TILE_COUNT } from '../logic/gallery.js';
import { CLOCK_RULES, CLOCK_NAMES, faceOf, createClocks } from '../logic/clocks.js';
import { createCount, poseOf, triumphStage } from '../logic/count.js';
import { READS, ENTRIES } from '../logic/script.js';

/** The three layers (design, Decisions): seen by both cameras, by the eye only, by the glass only. */
export const LAYER_BOTH = 0;
export const LAYER_EYE = 1;
export const LAYER_GLASS = 2;

/** What is fixed to a layer whatever the state (A5): mirror.js draws these and decides nothing. */
export const FIXED_LAYERS = Object.freeze({
  runner: LAYER_EYE, sitters: LAYER_EYE, reflection: LAYER_GLASS, tall: LAYER_GLASS, grin: LAYER_GLASS,
});

/**
 * A5: each tile's layer, from isTrue alone: LAYER_BOTH for a true tile, LAYER_EYE for a false
 * one, -1 for a tile that is gone. tiles is sim.waves.tiles ({ gone[60] }).
 */
export function tileLayers(tiles) {
  const out = new Array(TILE_COUNT);
  const gone = (tiles && tiles.gone) || [];
  for (let i = 0; i < TILE_COUNT; i++) out[i] = gone[i] ? -1 : isTrue(i) ? LAYER_BOTH : LAYER_EYE;
  return out;
}

/** What each camera is shown of the floor: eye (every tile present), glass (the present true ones), eyeOnly. */
export function tileSets(tiles) {
  const eye = []; const glass = []; const eyeOnly = [];
  tileLayers(tiles).forEach((l, i) => {
    if (l < 0) return;
    eye.push(i);
    (l === LAYER_BOTH ? glass : eyeOnly).push(i);
  });
  return { eye, glass, eyeOnly };
}

/** The floor's four meshes: black and white marble, once on the layer both cameras see and once on the eye's alone. */
export const TILE_MESHES = Object.freeze([
  Object.freeze({ layer: LAYER_BOTH, dark: true }), Object.freeze({ layer: LAYER_BOTH, dark: false }),
  Object.freeze({ layer: LAYER_EYE, dark: true }), Object.freeze({ layer: LAYER_EYE, dark: false }),
]);

/**
 * A5: lays the floor. The one routine that puts a tile's instance into a mesh, and it takes the
 * tile's layer from tileLayers (isTrue) alone. meshes: one per TILE_MESHES entry, each
 * { userData: { layer, dark, ids[] }, count }; runner: { userData: { ids[] }, count }, a length
 * of carpet for each apron span and for each column C tile still there. put(mesh, index, x, z)
 * writes that instance's place. A gone tile is put into no mesh.
 */
export function layFloor(tiles, meshes, runner, put) {
  const layers = tileLayers(tiles); // the one place a layer is asked for
  const sq = GALLERY.tile;
  for (const m of meshes) { m.count = 0; m.userData.ids.length = 0; }
  runner.count = 0; runner.userData.ids.length = 0;
  const runnerX = GALLERY.field.minX + (GALLERY.runnerCol + 0.5) * sq;
  for (let z = GALLERY.rect.maxZ - sq / 2 - 0.25; z > GALLERY.field.maxZ; z -= sq) { put(runner, runner.count++, runnerX, z); runner.userData.ids.push(-1); }
  for (let z = GALLERY.field.minZ - sq / 2; z > GALLERY.rect.minZ + sq / 2 - 0.25; z -= sq) { put(runner, runner.count++, runnerX, z); runner.userData.ids.push(-1); }
  for (let i = 0; i < TILE_COUNT; i++) {
    const layer = layers[i];
    if (layer < 0) continue;
    const r = tileRect(i);
    const dark = (r.col + r.row) % 2 === 0;
    let m = null;
    for (const q of meshes) if (q.userData.layer === layer && q.userData.dark === dark) m = q;
    put(m, m.count++, r.x, r.z);
    m.userData.ids.push(i);
    if (r.col === GALLERY.runnerCol) { put(runner, runner.count++, r.x, r.z); runner.userData.ids.push(i); }
  }
}

/** The floor as the meshes hold it: which tiles are in the meshes of each layer (sorted), and the runner's. */
export function floorReport(meshes, runner) {
  const on = (layer) => {
    const out = [];
    for (const m of meshes) if (m.userData.layer === layer) for (let k = 0; k < m.count; k++) out.push(m.userData.ids[k]);
    return out.sort((a, b) => a - b);
  };
  const glass = on(LAYER_BOTH); const eyeOnly = on(LAYER_EYE);
  return { glass, eyeOnly, eye: [...glass, ...eyeOnly].sort((a, b) => a - b), runnerSpans: runner.count, runnerTiles: runner.userData.ids.slice(0, runner.count).filter((v) => v >= 0) };
}

/** The tile the grin hangs over, as the rules hold it (keep.js sets it from nextTrue), or null. */
export function grinTile(waves) {
  const g = waves && waves.hints && waves.hints.gallery;
  return g && Number.isInteger(g.grin) && g.grin >= 0 && g.grin < TILE_COUNT ? g.grin : null;
}

const HUE = ST.STONE;
const OAK = 0x2c1d15;
const OAK_LIGHT = 0x4a3222;
const IRON = 0x24252a;
const BRASS = 0xa8843e;
const BONE = 0xd8cfb8;
const VELVET = 0x3d080d;
const TAU = Math.PI * 2;
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };
const toward = (cur, goal, step) => (cur < goal ? Math.min(goal, cur + step) : Math.max(goal, cur - step));

// ---- geometry tools: every part is a tinted geometry tagged with the material it bakes into ----

const part = (m, g) => ({ m, g });
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

function box(m, w, h, d, x, y, z, hex, ry = 0, vary = 0.1, rx = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(_m.makeRotationFromEuler(_e.set(rx, ry, rz, 'YXZ')));
  g.translate(x, y, z);
  return part(m, S.tint(g, hex, vary, x * 1.3 + z));
}
function cyl(m, rTop, rBot, h, x, y, z, hex, seg = 10, vary = 0.1) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  g.translate(x, y + h / 2, z);
  return part(m, S.tint(g, hex, vary, x - z));
}
function ball(m, r, x, y, z, hex, sx = 1, sy = 1, sz = 1, vary = 0.12, seg = 10) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2));
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return part(m, S.tint(g, hex, vary, x + z * 2));
}
function lathe(m, pts, x, y, z, hex, seg = 12, vary = 0.1) {
  const g = new THREE.LatheGeometry(pts.map(([r, yy]) => new THREE.Vector2(Math.max(0.0005, r), yy)), seg);
  g.translate(x, y, z);
  return part(m, S.tint(g, hex, vary, x * 2 - z));
}
/** A rod from a to b ([x, y, z] each). */
function rod(m, a, b, r, hex, seg = 6) {
  const va = new THREE.Vector3(...a); const vb = new THREE.Vector3(...b);
  const d = new THREE.Vector3().subVectors(vb, va);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg);
  g.applyMatrix4(_m.compose(va.add(vb).multiplyScalar(0.5), _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), _s.set(1, 1, 1)));
  return part(m, S.tint(g, hex, 0.1, a[0] + a[2]));
}
/** Turns and moves a list of parts (built about the origin) into place. */
function place(parts, x, y, z, ry = 0, scale = 1) {
  _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(0, ry, 0)), _s.set(scale, scale, scale));
  for (const p of parts) p.g.applyMatrix4(_m);
  return parts;
}

/** Position, normal and uv kept (S.merge keeps colour and drops uv): for the few drawn faces. */
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
/** A flat face w by h, facing +z about the origin, mapped to the rectangle (u0, v0)-(u1, v1) of its texture. */
function face(w, h, u0 = 0, v0 = 0, u1 = 1, v1 = 1, round = false) {
  const g = round ? new THREE.CircleGeometry(w / 2, 28) : new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(u0, u1, uv.getX(i)), lerp(v0, v1, uv.getY(i)));
  return g;
}
function moved(g, x, y, z, ry = 0, rx = 0) {
  g.applyMatrix4(_m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, 0, 'YXZ')), _s.set(1, 1, 1)));
  return g;
}

function drawn(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function wrapText(g, text, maxW) {
  const lines = []; let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > maxW) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// ---- drawn faces ----------------------------------------------------------------------------

// One enamel dial, twelve Roman hours, the maker's ring; the hands are geometry.
function dialTexture() {
  return drawn(256, 256, (g, w) => {
    const r = w / 2;
    g.fillStyle = '#0d0b09'; g.fillRect(0, 0, w, w);
    const grad = g.createRadialGradient(r, r * 0.9, r * 0.1, r, r, r);
    grad.addColorStop(0, '#efe7d2'); grad.addColorStop(0.85, '#d9cfb4'); grad.addColorStop(1, '#a89c7c');
    g.fillStyle = grad;
    g.beginPath(); g.arc(r, r, r - 3, 0, TAU); g.fill();
    g.strokeStyle = '#1a1612'; g.lineWidth = 3;
    g.beginPath(); g.arc(r, r, r - 12, 0, TAU); g.stroke();
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(r, r, r - 46, 0, TAU); g.stroke();
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU; const big = i % 5 === 0;
      g.lineWidth = big ? 3 : 1;
      g.beginPath();
      g.moveTo(r + Math.sin(a) * (r - 12), r - Math.cos(a) * (r - 12));
      g.lineTo(r + Math.sin(a) * (r - (big ? 22 : 17)), r - Math.cos(a) * (r - (big ? 22 : 17)));
      g.stroke();
    }
    const NUM = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    g.fillStyle = '#14110d'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 21px Georgia, "Times New Roman", serif';
    NUM.forEach((n, i) => {
      const a = (i / 12) * TAU;
      g.save();
      g.translate(r + Math.sin(a) * (r - 34), r - Math.cos(a) * (r - 34));
      g.rotate(a);
      g.fillText(n, 0, 0);
      g.restore();
    });
    // crazing: the enamel is old
    const rand = S.rng(12);
    g.strokeStyle = 'rgba(60,48,30,0.25)'; g.lineWidth = 0.7;
    for (let i = 0; i < 9; i++) {
      let x = r + (rand() - 0.5) * r; let y = r + (rand() - 0.5) * r;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (rand() - 0.5) * 36; y += (rand() - 0.5) * 36; g.lineTo(x, y); }
      g.stroke();
    }
  });
}

// ---- the tea room's faces made readable (issues #16, #17, #18) ---------------------------------

// The top of the tea room's chimneypiece shelf (castle.js builds it to this height). The mantel
// clock stands here, in the fire's glow (#17).
const MANTEL_TOP = TEA.mantelTop;

// The pocket watch, held up (#18): its dial turned to the door end of the table (+z), tilted to an
// eye looking down at a seated man's hand from a pace or two away, and a third bigger than it was.
const POCKET_SHOW = Object.freeze({ face2: -0.35, tilt: -0.75, k: 1.35 });

/** The enamel of every dial gives back a little light of its own, so dark hands read on it (#17, #18). */
function litDialMaterial(dial) {
  return new THREE.MeshStandardMaterial({ map: dial, roughness: 0.35, metalness: 0, emissive: 0xffffff, emissiveMap: dial, emissiveIntensity: 0.28 });
}

/** One claw score in the flags (#16): a pale fan of torn stone, and the dark groove down it. */
function gougeScore(rand, a, gx, gz) {
  const w = 0.04 + rand() * 0.035; const l = 0.3 + rand() * 0.4; const turn = -a + Math.PI / 2 + (rand() - 0.5) * 0.5;
  const rim = new THREE.PlaneGeometry(w * 2.2, l * 1.06);
  rim.rotateX(-Math.PI / 2).rotateY(turn).translate(gx, 0.005, gz);
  const groove = new THREE.PlaneGeometry(w * 0.7, l);
  groove.rotateX(-Math.PI / 2).rotateY(turn).translate(gx, 0.007, gz);
  return [part('decal', S.tint(rim, 0xb9b2a4, 0.15)), part('decal', S.tint(groove, 0x0b0b0d, 0.2))];
}

// Words cut into stone with a nail: pale, uneven strokes.
function scratchTexture(text) {
  return drawn(512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = 'italic 40px Georgia, "Times New Roman", serif';
    const lines = wrapText(g, text, w - 50);
    const rand = S.rng(77);
    const lh = 52; let y = (h - lines.length * lh) / 2 + lh * 0.7;
    for (const ln of lines) {
      let x = 22 + rand() * 14;
      for (const ch of ln) {
        g.save();
        g.translate(x, y + (rand() - 0.5) * 6);
        g.rotate((rand() - 0.5) * 0.14);
        g.fillStyle = 'rgba(20,22,24,0.55)'; g.fillText(ch, 1.5, 2);
        g.fillStyle = `rgba(214,217,220,${0.75 + rand() * 0.25})`; g.fillText(ch, 0, 0);
        g.restore();
        x += g.measureText(ch).width + (rand() - 0.3) * 1.5;
      }
      y += lh;
    }
    g.strokeStyle = 'rgba(210,214,218,0.5)'; g.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) { const sx = rand() * w; const sy = rand() * h; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + (rand() - 0.5) * 60, sy + (rand() - 0.5) * 16); g.stroke(); }
  });
}

// The brass plate by the board: engraved capitals, black-filled.
function plateTexture(text) {
  return drawn(512, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#b08a44'); grad.addColorStop(0.5, '#c9a55a'); grad.addColorStop(1, '#8e6c30');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3b2a10'; g.lineWidth = 5; g.strokeRect(12, 12, w - 24, h - 24);
    g.lineWidth = 1.5; g.strokeRect(22, 22, w - 44, h - 44);
    for (const [x, y] of [[32, 32], [w - 32, 32], [32, h - 32], [w - 32, h - 32]]) { g.fillStyle = '#5a431c'; g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill(); }
    g.fillStyle = '#17110a'; g.textAlign = 'center';
    const sentences = text.split('. ').map((s2, i, a) => (i < a.length - 1 ? `${s2}.` : s2));
    g.font = 'bold 34px Georgia, "Times New Roman", serif';
    g.fillText(sentences[0], w / 2, 74);
    g.font = '24px Georgia, "Times New Roman", serif';
    let y = 116;
    for (const s2 of sentences.slice(1)) for (const ln of wrapText(g, s2, w - 90)) { g.fillText(ln, w / 2, y); y += 34; }
  });
}

// Issue #8: the card tacked up by the Count's door. Ink on old card, in a quick hand.
function noteTexture(text) {
  return drawn(512, 384, (g, w, h) => {
    g.fillStyle = '#d9cba6'; g.fillRect(0, 0, w, h);
    const rand = S.rng(83);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(90,64,30,${rand() * 0.07})`; g.fillRect(rand() * w, rand() * h, 2 + rand() * 6, 1 + rand() * 3); }
    g.strokeStyle = 'rgba(70,48,20,0.35)'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#2a1d10';
    g.font = 'italic 25px Georgia, "Times New Roman", serif';
    let y = 44;
    for (const ln of wrapText(g, text, w - 56)) { g.fillText(ln, 26 + rand() * 4, y); y += 31; }
  });
}

function runnerTexture() {
  const t = drawn(256, 256, (g, w, h) => {
    g.fillStyle = '#6a0d12'; g.fillRect(0, 0, w, h);
    for (const x of [0, w - 24]) { g.fillStyle = '#0c0a0c'; g.fillRect(x, 0, 24, h); }
    for (const x of [29, w - 33]) { g.fillStyle = '#7c6432'; g.fillRect(x, 0, 4, h); }
    g.fillStyle = 'rgba(22,6,8,0.55)';
    for (const y of [0, h / 2]) { g.beginPath(); g.moveTo(w / 2, y + 12); g.lineTo(w / 2 + 40, y + h / 4); g.lineTo(w / 2, y + h / 2 - 12); g.lineTo(w / 2 - 40, y + h / 4); g.closePath(); g.fill(); }
    const img = g.getImageData(0, 0, w, h); const d = img.data; const rand = S.rng(9);
    for (let i = 0; i < d.length; i += 4) { const k = 0.9 + rand() * 0.2; d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; }
    g.putImageData(img, 0, 0);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Old glass: ripples for the figure-mirror's bump.
function rippleTexture() {
  const t = drawn(128, 256, (g, w, h) => {
    const img = g.createImageData(w, h); const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = 128 + 70 * Math.sin(y * 0.11 + 2.2 * Math.sin(x * 0.07)) + 40 * S.noise(x * 0.06, y * 0.03, 0, 4);
        const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = clamp(v, 0, 255); d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function glowTexture() {
  return drawn(64, 64, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.45)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, w);
  });
}

// ---- the things -------------------------------------------------------------------------------

// A box of earth: a plain six-sided plank box, iron-strapped, heaped over its rim with dark
// earth and spilling it. Built about the origin, its length along z, standing on y 0. It must
// never read as anything else, so the earth stands proud of the rim and lies on the floor round it.
function coffinHalf(z, len, wid) { // half-width of the six-sided outline at z (the shoulder a third down)
  const k = (z + len / 2) / len; // 0 at the head, 1 at the foot
  return (wid / 2) * (k < 0.3 ? lerp(0.62, 1, k / 0.3) : lerp(1, 0.6, (k - 0.3) / 0.7));
}
function coffinWalls(len, wid, h, y0, t, hex, m = 'wood') {
  const out = [];
  const pts = [[-len / 2, 0.62], [-len / 2 + len * 0.3, 1], [len / 2, 0.6]];
  for (const sd of [-1, 1]) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = sd * pts[i][1] * wid / 2; const az = pts[i][0]; const bx2 = sd * pts[i + 1][1] * wid / 2; const bz = pts[i + 1][0];
      const L = Math.hypot(bx2 - ax, bz - az);
      // planks: three boards high, each its own tone
      for (let b = 0; b < 3; b++) {
        out.push(box(m, t, h / 3 - 0.008, L + t, (ax + bx2) / 2, y0 + (b + 0.5) * h / 3, (az + bz) / 2, hex, Math.atan2(bx2 - ax, bz - az), 0.22));
      }
    }
  }
  out.push(box(m, wid * 0.62 * 2 / 2 + t, h, t, 0, y0 + h / 2, -len / 2, hex, 0, 0.2));
  out.push(box(m, wid * 0.6 + t, h, t, 0, y0 + h / 2, len / 2, hex, 0, 0.2));
  return out;
}
function coffinSheet(len, wid, y, heap, hex, seed, m = 'board', inset = 0.03) { // 'board': seen from both sides (a lid is)
  const g = new THREE.PlaneGeometry(1, len - inset * 2, 8, 16);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i); const u = p.getX(i) * 2; // -1..1 across
    const half = coffinHalf(z, len, wid) - inset;
    const dome = heap ? heap * (1 - u * u) * (1 - (2 * z / len) ** 2 * 0.7) + heap * 0.55 * S.noise(u * 2.1, z * 4.3, 0, seed) : 0;
    p.setXYZ(i, u * half, y + dome, z);
  }
  g.computeVertexNormals();
  return part(m, S.tint(g, hex, heap ? 0.45 : 0.15, seed));
}
function earthBox(len, wid, h, seed = 1, lean = true) {
  const rand = S.rng(seed);
  const parts = [...coffinWalls(len, wid, h, 0, 0.045, 0x6a5d4c)];
  parts.push(coffinSheet(len, wid, 0.02, 0, 0x2e241a, seed)); // the floor of the box
  parts.push(coffinSheet(len, wid, h - 0.04, 0.2, 0x1f1711, seed, 'earth', 0.05)); // earth, heaped over the rim
  for (const k of [-0.3, 0.12, 0.42]) { // iron straps
    const half = coffinHalf(k * len, len, wid) + 0.03;
    for (const sd of [-1, 1]) parts.push(box('metal', 0.012, h, 0.07, sd * half, h / 2, k * len, IRON, 0, 0.2));
  }
  for (const sd of [-1, 1]) parts.push(...[-0.25, 0.25].map((k) => rod('metal', [sd * (coffinHalf(k * len, len, wid) + 0.05), h * 0.62, k * len - 0.09], [sd * (coffinHalf(k * len, len, wid) + 0.05), h * 0.62, k * len + 0.09], 0.014, IRON)));
  // clods and a skirt of spilled earth round the foot
  for (let i = 0; i < 16; i++) {
    const a = rand() * TAU; const zz = Math.sin(a) * (len / 2 + 0.12 + rand() * 0.2); const xx = Math.cos(a) * (wid / 2 + 0.1 + rand() * 0.2);
    const r = 0.03 + rand() * 0.07;
    parts.push(ball('earth', r, xx, r * 0.4, zz, 0x1f1711, 1.5, 0.6, 1.3, 0.4, 6));
  }
  for (let i = 0; i < 5; i++) { // earth run over the rim
    const zz = (rand() - 0.5) * len * 0.7; const sd = rand() < 0.5 ? -1 : 1;
    parts.push(ball('earth', 0.11, sd * (coffinHalf(zz, len, wid) + 0.01), h - 0.02, zz, 0x1f1711, 0.8, 0.5, 1.6, 0.4, 6), ball('earth', 0.1, sd * (coffinHalf(zz, len, wid) + 0.1), 0.05, zz, 0x1f1711, 1.2, 0.5, 1.8, 0.4, 6));
  }
  if (lean) { // its lid, off and leaning: nothing is shut in here
    const lid = [coffinSheet(len, wid, 0, 0, 0x5c5041, seed + 3), coffinSheet(len, wid, 0.035, 0, 0x6a5d4c, seed + 4)];
    for (const p of lid) { p.g.applyMatrix4(_m.makeRotationFromEuler(_e.set(0, 0, -1.25))); p.g.translate(wid / 2 + 0.2, wid * 0.47, 0.1); }
    parts.push(...lid);
  }
  return parts;
}

// A candelabra: a turned gilt stem, three arms, three candles burnt to different lengths.
function candelabra(flames) {
  const parts = [lathe('metal', [[0.11, 0], [0.12, 0.015], [0.05, 0.05], [0.022, 0.09], [0.03, 0.2], [0.018, 0.24], [0.022, 0.36], [0.04, 0.4], [0.016, 0.44]], 0, 0, 0, BRASS, 16, 0.2)];
  const cups = [[0, 0.5, 0], [-0.17, 0.42, 0], [0.17, 0.42, 0]];
  for (const [x] of cups.slice(1)) {
    for (let i = 0; i < 6; i++) { // a curved arm
      const a0 = (i / 6) * Math.PI * 0.5; const a1 = ((i + 1) / 6) * Math.PI * 0.5;
      parts.push(rod('metal', [x * Math.sin(a0), 0.4 - 0.06 * Math.sin(a0 * 2), 0], [x * Math.sin(a1), 0.4 - 0.06 * Math.sin(a1 * 2) + (i === 5 ? 0.02 : 0), 0], 0.009, BRASS, 5));
    }
  }
  parts.push(rod('metal', [0, 0.42, 0], [0, 0.5, 0], 0.01, BRASS, 5));
  cups.forEach(([x, y], i) => {
    parts.push(lathe('metal', [[0.012, 0], [0.034, 0.012], [0.03, 0.024]], x, y, 0, BRASS, 8));
    const h = [0.17, 0.11, 0.14][i];
    parts.push(cyl('wax', 0.013, 0.014, h, x, y + 0.02, 0, 0xe6dcc0, 7, 0.06));
    parts.push(ball('wax', 0.016, x + 0.012, y + 0.02 + h * 0.75, 0.004, 0xe6dcc0, 0.6, 1.8, 0.6, 0.05, 6)); // a run of wax
    flames.push([x, y + 0.02 + h + 0.035, 0]);
  });
  return parts;
}

// A chair: tall carved back, stuffed seat gone the Queen's red.
function chair() {
  const parts = [];
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2]]) parts.push(box('polish', 0.045, 0.46, 0.045, x, 0.23, z, OAK, 0, 0.2));
  for (const x of [-0.2, 0.2]) parts.push(box('polish', 0.045, 1.25, 0.045, x, 0.625, 0.2, OAK, 0, 0.2, 0.05));
  parts.push(box('polish', 0.47, 0.05, 0.47, 0, 0.46, 0, OAK, 0, 0.2));
  parts.push(box('cloth', 0.4, 0.05, 0.4, 0, 0.5, -0.01, 0x5a0c10, 0, 0.25));
  parts.push(box('polish', 0.4, 0.1, 0.03, 0, 1.2, 0.23, OAK, 0, 0.2, 0.05));
  parts.push(box('polish', 0.4, 0.06, 0.03, 0, 0.72, 0.205, OAK, 0, 0.2, 0.05));
  for (const x of [-0.12, 0, 0.12]) parts.push(box('polish', 0.05, 0.44, 0.02, x, 0.96, 0.218, OAK_LIGHT, 0, 0.2, 0.05));
  for (const x of [-0.2, 0.2]) parts.push(lathe('polish', [[0.012, 0], [0.03, 0.03], [0.012, 0.07], [0.004, 0.1]], x, 1.25, 0.232, OAK, 6));
  parts.push(box('polish', 0.4, 0.03, 0.03, 0, 0.16, -0.2, OAK, 0, 0.2), box('polish', 0.03, 0.03, 0.4, -0.2, 0.2, 0, OAK, 0, 0.2), box('polish', 0.03, 0.03, 0.4, 0.2, 0.2, 0, OAK, 0, 0.2));
  return parts;
}
// A press cupboard: two panelled doors, a cornice, bun feet. Its front faces -z.
function cabinet(tall = false) {
  const w = tall ? 1.25 : 1.1; const h = tall ? 2.15 : 1.35; const d = 0.52;
  const parts = [box('polish', w, h - 0.12, d, 0, 0.12 + (h - 0.12) / 2, 0, OAK, 0, 0.2)];
  parts.push(box('polish', w + 0.12, 0.07, d + 0.1, 0, h + 0.035, 0, OAK_LIGHT, 0, 0.2), box('polish', w + 0.06, 0.05, d + 0.05, 0, 0.145, 0, OAK_LIGHT, 0, 0.2));
  if (tall) for (let i = 0; i < 7; i++) { const a = (i / 6) * Math.PI; parts.push(box('polish', 0.2, 0.05, 0.06, -Math.cos(a) * w * 0.42, h + 0.07 + Math.sin(a) * 0.16, -d / 2, OAK_LIGHT, 0, 0.2, 0, -Math.cos(a) * 0.5)); }
  for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) for (const z of [-d / 2 + 0.08, d / 2 - 0.08]) parts.push(ball('polish', 0.07, x, 0.06, z, OAK, 1, 0.85, 1, 0.1, 8));
  for (const sd of [-1, 1]) {
    const dw = w / 2 - 0.05;
    for (const [y0, y1] of tall ? [[0.3, 1.05], [1.15, 2.0]] : [[0.3, 1.22]]) {
      parts.push(box('polish', dw - 0.1, y1 - y0, 0.02, sd * w / 4, (y0 + y1) / 2, -d / 2 - 0.008, OAK_LIGHT, 0, 0.25));
      parts.push(box('polish', dw - 0.24, y1 - y0 - 0.16, 0.02, sd * w / 4, (y0 + y1) / 2, -d / 2 - 0.02, OAK, 0, 0.25));
    }
    parts.push(ball('metal', 0.022, sd * 0.05, tall ? 1.1 : 0.78, -d / 2 - 0.035, BRASS, 1, 1, 1, 0.1, 8));
  }
  return parts;
}
// A settle: a high-backed bench with arms.
function settle() {
  const parts = [box('polish', 1.5, 0.06, 0.5, 0, 0.44, 0, OAK, 0, 0.2), box('polish', 1.5, 1.0, 0.05, 0, 0.9, 0.25, OAK, 0, 0.22), box('cloth', 1.36, 0.06, 0.42, 0, 0.5, -0.02, HUE.red, 0, 0.25)];
  for (const sd of [-1, 1]) {
    parts.push(box('polish', 0.05, 0.72, 0.52, sd * 0.75, 0.36, 0, OAK, 0, 0.2), box('polish', 0.07, 0.05, 0.52, sd * 0.75, 0.74, 0, OAK_LIGHT, 0, 0.2));
    parts.push(lathe('polish', [[0.02, 0], [0.045, 0.04], [0.02, 0.09], [0.005, 0.12]], sd * 0.72, 1.4, 0.25, OAK, 6));
  }
  for (const x of [-0.5, 0, 0.5]) parts.push(box('polish', 0.36, 0.6, 0.02, x, 1.02, 0.218, OAK_LIGHT, 0, 0.25));
  parts.push(box('polish', 1.5, 0.3, 0.04, 0, 0.26, -0.22, OAK, 0, 0.2));
  return parts;
}

// A dust sheet over something: a lumpy shape with a skirt that reaches the floor in folds.
function sheeted(w, h, d, seed) {
  const g = new THREE.SphereGeometry(1, 22, 14);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const ux = p.getX(i); const uy = p.getY(i); const uz = p.getZ(i);
    const a = Math.atan2(uz, ux);
    const sq = lerp(1, 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))), 0.5); // squared shoulders
    let rr; let y;
    if (uy >= 0) { // the thing underneath
      rr = Math.hypot(ux, uz);
      y = h * 0.45 + uy * h * 0.55 * (1 + 0.1 * S.noise(ux * 2, uz * 2, 0, seed));
    } else { // the skirt: straight down, flaring, in folds, to the floor
      const t = -uy;
      rr = 1 + 0.2 * t + 0.07 * t * Math.sin(a * 9 + seed);
      y = h * 0.45 * (1 - t);
    }
    p.setXYZ(i, Math.cos(a) * rr * sq * w / 2, Math.max(0.005, y), Math.sin(a) * rr * sq * d / 2);
  }
  g.computeVertexNormals();
  return part('cloth', S.tint(g, 0xc9c5b8, 0.16, seed));
}

// A tonic: a small green bottle, corked, with a paper label.
function tonic() {
  return [
    lathe('polish', [[0.0, 0], [0.045, 0.004], [0.048, 0.1], [0.04, 0.125], [0.016, 0.15], [0.015, 0.19], [0.02, 0.195]], 0, 0, 0, 0x2f6b4a, 10, 0.1),
    cyl('wood', 0.014, 0.016, 0.03, 0, 0.19, 0, 0xb08a5a, 7),
    cyl('wax', 0.0495, 0.0495, 0.05, 0, 0.035, 0, 0xe2d8bc, 10, 0.05),
  ];
}

// A stake: squared ash, one end whittled to a long clean point. Never a branch, never a chair leg.
function stake(len = 0.62) {
  const g = new THREE.CylinderGeometry(0.017, 0.017, len * 0.72, 4);
  g.translate(0, len * 0.36, 0);
  const tip = new THREE.ConeGeometry(0.017, len * 0.28, 4);
  tip.translate(0, len * 0.86, 0);
  return [part('wood', S.tint(g, 0xcdb88a, 0.14, len)), part('wood', S.tint(tip, 0xe6d6ae, 0.08, len))];
}

// ---- the layer ----------------------------------------------------------------------------------

const RANGE = (() => { // each zone's range: itself and the zones through its doors
  const m = new Map(ZONES.map((z) => [z.id, new Set([z.id])]));
  for (const d of DOORS) { m.get(d.zones[0]).add(d.zones[1]); m.get(d.zones[1]).add(d.zones[0]); }
  return m;
})();

/** The figure-mirror's glass, as much of it as a creature may fill: width and height in metres (issue 24). */
export const FIGURE_GLASS = Object.freeze({ w: 1.15, h: 2.25 });

/**
 * How the figure-mirror stands a borrowed creature (issue 24). beasts.js builds each with its front
 * on its own -z, so it is turned by the map's yaw (which faces the room) and never by the stand-in's
 * turn; it is scaled down, never up, to fit FIGURE_GLASS; centred across the glass; feet on the
 * floor; its depth centred on the holder, so the pressed-flat model stays between the glass and its
 * backing. box: the model's bounds as built ({ min, max } of x, y, z). Returns { yaw, scale, x, y, z }:
 * the offsets, in the holder's frame, that centre it and stand it on the floor.
 */
export function foeFit(box, fm = MIRROR_ROOM.figureMirror, glass = FIGURE_GLASS) {
  const w = box.max.x - box.min.x;
  const h = box.max.y - box.min.y;
  const scale = Math.min(1, glass.h / Math.max(h, 1e-6), glass.w / Math.max(w, 1e-6));
  return { yaw: fm.yaw, scale, x: -((box.min.x + box.max.x) / 2) * scale, y: -box.min.y * scale, z: -((box.min.z + box.max.z) / 2) * scale };
}

export function createKeepprops(scene, cfg, opts = {}) {
  let creatureFailed = false; // a builder that threw has been said once
  let creature = typeof opts.creature === 'function' ? opts.creature : null; // (kind, cfg) -> { g, dispose }: a shipped forest creature's model
  const root = new THREE.Group();
  root.name = 'keepprops';
  root.visible = false;
  scene.add(root);

  // ---- materials, shared by every zone and kept for the life of the layer ----
  const M = {
    wood: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }),
    board: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide }),
    polish: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.06 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.78 }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    wax: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, emissive: 0x2a2014, emissiveIntensity: 0.5 }),
    earth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true }),
    food: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: THREE.DoubleSide }), // what is laid on the table: see below
    decal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, transparent: true, opacity: 0.85, depthWrite: false }),
    lit: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false }), // flames' cores, the seams of dawn, eyes
    shaft: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
  };
  // The table is the one thing in the tea room that must read from the doorway, and the room's lights are the
  // shell's: what lies on the cloth gives back a share of its own colour, as if the candles stood closer.
  M.food.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.45;');
  };
  M.food.customProgramCacheKey = () => 'keepprops-food';
  const glow = glowTexture();
  const haloMat = new THREE.PointsMaterial({ map: glow, color: HUE.fire, size: 0.34, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false, toneMapped: false });
  const steamMat = new THREE.PointsMaterial({ map: glow, color: 0xcfd6dc, size: 0.7, transparent: true, opacity: 0.4, depthWrite: false, sizeAttenuation: true });
  const flyMat = new THREE.PointsMaterial({ color: 0x050505, size: 0.034, sizeAttenuation: true });
  const shared = [...Object.values(M), haloMat, steamMat, flyMat];
  let reduced = false;

  /** Bakes tagged parts into one mesh per material under `group`. */
  function bake(group, parts, cast = true) {
    const by = {};
    for (const p of parts) (by[p.m] || (by[p.m] = [])).push(p.g);
    const out = {};
    for (const [m, list] of Object.entries(by)) {
      const mesh = new THREE.Mesh(S.merge(list), M[m]);
      const solid = m !== 'decal' && m !== 'lit';
      mesh.castShadow = cast && solid;
      mesh.receiveShadow = solid;
      group.add(mesh);
      out[m] = mesh;
      for (const g of list) g.dispose();
    }
    return out;
  }
  /** A group of its own (something that moves), baked. */
  function mover(parent, parts, x = 0, y = 0, z = 0, ry = 0, cast = true) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    bake(g, parts, cast);
    parent.add(g);
    return g;
  }
  function points(parent, list, mat) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(list.flat(), 3));
    const p = new THREE.Points(geo, mat);
    p.frustumCulled = false;
    parent.add(p);
    return p;
  }
  const lootTaken = (w, key) => {
    const i = cfg.loot ? cfg.loot.findIndex((l) => l.key === key) : -1;
    return i < 0 || !!(w.loot && w.loot[i] && w.loot[i].taken);
  };

  // ---- the hall: the braid, the scratched words, the curtain with a tonic behind it ---------------

  function buildHall() {
    const group = new THREE.Group();
    const parts = [];
    const wallX = ZONES.find((z) => z.id === 'hall').rects[0].minX;
    const b = HALL.braid;
    // the nail, driven in at a slant
    parts.push(rod('metal', [wallX, 1.86, b.z], [wallX + 0.09, 1.9, b.z], 0.008, IRON), ball('metal', 0.016, wallX + 0.09, 1.9, b.z, IRON, 1, 1, 1, 0.1, 6));
    // the braid: dry plaited stalks, nine papery heads down it, a loop over the nail
    const braid = [];
    for (let i = 0; i < 14; i++) {
      const y0 = -i * 0.04; const y1 = -(i + 1) * 0.04;
      for (const ph of [0, 2.1, 4.2]) braid.push(rod('wood', [0.018 * Math.sin(i * 1.3 + ph), y0, 0.018 * Math.cos(i * 1.3 + ph)], [0.018 * Math.sin((i + 1) * 1.3 + ph), y1, 0.018 * Math.cos((i + 1) * 1.3 + ph)], 0.006, 0x9c8a5c, 4));
    }
    braid.push(rod('wood', [0, 0, 0], [-0.03, 0.05, 0], 0.005, 0x9c8a5c, 4), rod('wood', [0, 0, 0], [0.02, 0.05, 0.01], 0.005, 0x9c8a5c, 4));
    for (let i = 0; i < 9; i++) {
      const sd = i % 2 ? 1 : -1; const y = -0.09 - i * 0.055; const zz = sd * (0.032 + (i % 3) * 0.006);
      braid.push(lathe('wax', [[0.004, -0.034], [0.026, -0.02], [0.034, 0], [0.026, 0.02], [0.008, 0.036], [0.003, 0.05]], 0.03 + (i % 2) * 0.012, y, zz, 0xded3b6, 7, 0.14));
      braid.push(ball('wood', 0.008, 0.03 + (i % 2) * 0.012, y - 0.036, zz, 0x6b5a3c, 1, 0.6, 1, 0.2, 5)); // the root end
    }
    const braidG = mover(group, braid, wallX + 0.085, 1.88, b.z, 0, false);
    // the words, scratched in the stone beside it
    const scratch = scratchTexture(READS.garlicScratch);
    const scratchMat = new THREE.MeshStandardMaterial({ map: scratch, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const sm = new THREE.Mesh(moved(face(0.96, 0.48), wallX + 0.012, 1.55, HALL.scratch.z - 0.48, Math.PI / 2), scratchMat);
    group.add(sm);
    // the curtain across an alcove on the east wall: it stops short of the floor, and glass glints under it
    const c = HALL.curtain; const eastX = ZONES.find((z) => z.id === 'hall').rects[0].maxX;
    const cx = Math.min(c.x, eastX) - 0.62;
    parts.push(rod('metal', [cx, 2.55, c.z - 0.95], [cx, 2.55, c.z + 0.95], 0.016, BRASS));
    for (const dz of [-0.95, 0.95]) parts.push(rod('metal', [cx, 2.55, c.z + dz], [eastX, 2.55, c.z + dz], 0.012, BRASS), ball('metal', 0.035, cx, 2.55, c.z + dz * 1.03, BRASS, 1, 1, 1, 0.1, 8));
    for (let i = 0; i < 9; i++) parts.push(part('metal', S.tint(new THREE.TorusGeometry(0.026, 0.005, 5, 10).rotateY(Math.PI / 2).translate(cx, 2.53, c.z - 0.8 + i * 0.2), BRASS, 0.1)));
    const sheet = new THREE.PlaneGeometry(1.8, 2.25, 36, 6);
    const p = sheet.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i); const v = p.getY(i);
      p.setXYZ(i, u * 0.92, v, 0.055 * Math.sin(u * 17.5) * (1.1 - v / 2.6) + 0.02 * S.noise(u * 3, v * 2, 0, 3));
    }
    sheet.computeVertexNormals();
    parts.push(part('cloth', S.tint(moved(sheet, cx, 1.4, c.z, -Math.PI / 2), VELVET, 0.3, 5)));
    bake(group, parts);
    return {
      group,
      tick(sim, w) { braidG.visible = !lootTaken(w, 'braid'); },
      free() { scratch.dispose(); scratchMat.dispose(); },
    };
  }

  // ---- Tea for the Dead: five clocks and the set table -----------------------------------------

  function buildTea() {
    const group = new THREE.Group();
    const parts = [];
    const rules = { ...CLOCK_RULES, ...(cfg.clocks || {}) };
    const dial = dialTexture();
    const dialMat = litDialMaterial(dial);
    const dials = [];
    const clocks = []; // { hand, turn, swing(group), kind }
    const room = ZONES.find((z) => z.id === 'tea').rects[0];

    /** One clock's works: a dial of radius r facing +z at (x, y, z) turned ry; returns its hour hand. */
    function works(i, r, x, y, z, ry, rx = 0, bold = 1) {
      const q = new THREE.Group();
      q.position.set(x, y, z);
      q.rotation.set(rx, ry, 0, 'YXZ');
      group.add(q);
      q.updateMatrix();
      dials.push(face(r * 2, r * 2, 0, 0, 1, 1, true).applyMatrix4(q.matrix));
      // the minute hand: at a quarter to, for good (G5)
      const min = [box('metal', r * 0.045 * bold, r * 0.86, 0.004, 0, r * 0.36, 0.008, 0x0c0c0e, 0, 0), ball('metal', r * 0.07 * bold, 0, 0, 0.011, BRASS, 1, 1, 0.5, 0, 8)];
      const a = -TAU * faceOf(1, rules).minuteTurn;
      for (const p of min) { p.g.applyMatrix4(_m.makeRotationZ(a)); p.g.applyMatrix4(q.matrix); parts.push(p); }
      // the hour hand: short, with a spade end
      const hand = mover(q, [box('metal', r * 0.07 * bold, r * 0.52, 0.004, 0, r * 0.2, 0.005, 0x0c0c0e, 0, 0), ball('metal', r * 0.085 * bold, 0, r * 0.4, 0.005, 0x0c0c0e, 1, 1.5, 0.3, 0, 6)], 0, 0, 0, 0, false);
      clocks[i] = { hand, turn: null, swing: null, kind: CLOCK_NAMES[i] };
      return q;
    }
    const at = (id) => CLOCKS.find((c) => c.id === id);

    // The longcase clock, by the door: hood, trunk with a glazed door, the pendulum behind it.
    {
      const c = at('longcase'); const z0 = room.maxZ - 0.3;
      const body = [
        box('polish', 0.56, 0.5, 0.34, 0, 0.25, 0, OAK, 0, 0.2), box('polish', 0.62, 0.06, 0.4, 0, 0.03, 0, OAK_LIGHT, 0, 0.2),
        box('polish', 0.4, 1.05, 0.05, 0, 1.03, 0.115, OAK, 0, 0.2), box('polish', 0.05, 1.05, 0.26, -0.2, 1.03, 0, OAK, 0, 0.2), box('polish', 0.05, 1.05, 0.26, 0.2, 1.03, 0, OAK, 0, 0.2),
        box('polish', 0.4, 0.14, 0.05, 0, 0.57, -0.12, OAK, 0, 0.2), box('polish', 0.4, 0.2, 0.05, 0, 1.46, -0.12, OAK, 0, 0.2),
        box('polish', 0.6, 0.56, 0.36, 0, 1.84, 0, OAK, 0, 0.2), box('polish', 0.66, 0.05, 0.42, 0, 1.56, 0, OAK_LIGHT, 0, 0.2), box('polish', 0.66, 0.05, 0.42, 0, 2.13, 0, OAK_LIGHT, 0, 0.2),
        lathe('metal', [[0.03, 0], [0.045, 0.04], [0.015, 0.08], [0.03, 0.12], [0.004, 0.18]], 0, 2.15, 0, BRASS, 8),
      ];
      for (const sd of [-1, 1]) body.push(cyl('polish', 0.022, 0.022, 0.46, sd * 0.27, 1.6, -0.17, OAK_LIGHT, 8), lathe('metal', [[0.02, 0], [0.03, 0.03], [0.004, 0.09]], sd * 0.27, 2.15, 0, BRASS, 6));
      parts.push(...place(body, c.x, 0, z0, 0));
      works(0, 0.2, c.x, 1.84, z0 - 0.185, Math.PI);
      const pend = mover(group, [rod('metal', [0, 0, 0], [0, -0.78, 0], 0.006, BRASS), part('metal', S.tint(new THREE.CylinderGeometry(0.075, 0.075, 0.014, 18).rotateX(Math.PI / 2).translate(0, -0.8, 0), BRASS, 0.15))], c.x, 1.5, z0 - 0.05, 0, false);
      clocks[0].swing = pend; clocks[0].amp = 0.16;
    }
    // The mantel clock, on the fireplace: an arched case with a little pendulum in a window.
    {
      const c = at('mantel'); const my = MANTEL_TOP; // on the chimneypiece's shelf, not in its mouth (#17)
      const body = [box('polish', 0.36, 0.06, 0.2, 0, 0.03, 0, OAK_LIGHT, 0, 0.2), box('polish', 0.3, 0.34, 0.16, 0, 0.23, 0, 0x1a1210, 0, 0.2)];
      body.push(part('polish', S.tint(new THREE.CylinderGeometry(0.15, 0.15, 0.16, 18, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0.4, 0), 0x1a1210, 0.2)));
      for (const sd of [-1, 1]) body.push(cyl('metal', 0.012, 0.012, 0.3, sd * 0.165, 0.06, 0.07, BRASS, 6), ball('metal', 0.02, sd * 0.13, 0.015, 0.07, BRASS, 1, 0.6, 1, 0.1, 6));
      parts.push(...place(body, c.x - 0.1, my, c.z, Math.PI / 2));
      works(1, 0.115, c.x - 0.1 + 0.083, my + 0.38, c.z, Math.PI / 2);
      const pend = mover(group, [rod('metal', [0, 0, 0], [0, -0.1, 0], 0.003, BRASS, 4), ball('metal', 0.022, 0, -0.11, 0, BRASS, 1, 1, 0.4, 0.1, 8)], c.x - 0.1 + 0.084, my + 0.24, c.z, Math.PI / 2, false);
      clocks[1].swing = pend; clocks[1].amp = 0.35;
    }
    // The carriage clock, on the table in front of the ghost: brass pillars, a handle, the balance on top.
    {
      const c = at('carriage'); const ty = TEA.table.h + 0.022;
      const body = [box('metal', 0.19, 0.02, 0.15, 0, 0.01, 0, BRASS, 0, 0.15), box('metal', 0.19, 0.02, 0.15, 0, 0.25, 0, BRASS, 0, 0.15), box('polish', 0.15, 0.22, 0.11, 0, 0.13, -0.004, 0x15120f, 0, 0.1)];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) body.push(cyl('metal', 0.009, 0.009, 0.23, sx * 0.082, 0.015, sz * 0.062, BRASS, 6));
      for (let i = 0; i < 6; i++) { const a0 = (i / 6) * Math.PI; const a1 = ((i + 1) / 6) * Math.PI; body.push(rod('metal', [-0.06 * Math.cos(a0), 0.26 + 0.05 * Math.sin(a0), 0], [-0.06 * Math.cos(a1), 0.26 + 0.05 * Math.sin(a1), 0], 0.006, BRASS, 5)); }
      parts.push(...place(body, c.x, ty, c.z, 0));
      works(2, 0.066, c.x, ty + 0.135, c.z + 0.053, 0);
      const bal = mover(group, [part('metal', S.tint(new THREE.TorusGeometry(0.024, 0.004, 5, 14).rotateX(Math.PI / 2), BRASS, 0.1)), box('metal', 0.048, 0.003, 0.005, 0, 0, 0, BRASS, 0, 0)], c.x, ty + 0.268, c.z + 0.03, 0, false);
      clocks[2].swing = bal; clocks[2].amp = 2.2; clocks[2].axis = 'y'; clocks[2].rate = 2.5;
    }
    // The pocket watch, in the skeleton's hand: open hunter case, tilted up to be read from the table's end.
    {
      // it lies in the skeleton's upturned palm (keepcast.js: his hand reaches 0.62 m from his seat toward the watch)
      const c = at('pocket'); const sk = TEA.skeleton;
      const dl = Math.hypot(c.x - sk.x, c.z - sk.z) || 1;
      const wx = sk.x + ((c.x - sk.x) / dl) * 0.62; const wz = sk.z + ((c.z - sk.z) / dl) * 0.62; const ty = 0.9;
      const { face2, tilt, k } = POCKET_SHOW; // held up to the warden coming down the table from the door (#18)
      const body = [part('metal', S.tint(new THREE.CylinderGeometry(0.075 * k, 0.07 * k, 0.022, 20).rotateX(Math.PI / 2).translate(0, 0, -0.012), BRASS, 0.12)), part('metal', S.tint(new THREE.TorusGeometry(0.016 * k, 0.004 * k, 5, 10).translate(0, 0.092 * k, -0.012), BRASS, 0.1)), cyl('metal', 0.008 * k, 0.008 * k, 0.02, 0, 0.072 * k, -0.012, BRASS, 6)];
      // the lid, sprung open
      body.push(part('metal', S.tint(new THREE.CylinderGeometry(0.075 * k, 0.075 * k, 0.006, 20).rotateX(Math.PI / 2 - 1.2).translate(0, -0.1 * k, 0.05 * k), BRASS, 0.12)));
      for (const p of body) p.g.applyMatrix4(_m.makeRotationX(tilt));
      parts.push(...place(body, wx, ty, wz, face2));
      works(3, 0.064 * k, wx, ty, wz, face2, tilt, 1.8);
      const sec = mover(clocks[3].hand.parent, [box('metal', 0.003 * k, 0.02 * k, 0.002, 0, 0.008 * k, 0.006, 0x7a1a14, 0, 0)], 0, -0.03 * k, 0, 0, false);
      clocks[3].swing = sec; clocks[3].amp = 0; clocks[3].axis = 'z'; clocks[3].sweep = true;
    }
    // The wall clock, beside the werewolf and just outside its reach: an octagon dial over a pendulum box.
    {
      const c = at('wall'); const wx = room.maxX;
      const body = [part('polish', S.tint(new THREE.CylinderGeometry(0.27, 0.27, 0.07, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8), OAK, 0.2)), box('polish', 0.24, 0.42, 0.07, 0, -0.42, 0, OAK, 0, 0.2), box('polish', 0.3, 0.04, 0.09, 0, -0.64, 0, OAK_LIGHT, 0, 0.2)];
      parts.push(...place(body, wx - 0.04, 1.85, c.z, -Math.PI / 2));
      works(4, 0.2, wx - 0.08, 1.85, c.z, -Math.PI / 2);
      const pend = mover(group, [rod('metal', [0, 0, 0], [0, -0.3, 0], 0.004, BRASS, 4), part('metal', S.tint(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 14).rotateX(Math.PI / 2).translate(0, -0.32, 0), BRASS, 0.15))], wx - 0.085, 1.62, c.z, -Math.PI / 2, false);
      clocks[4].swing = pend; clocks[4].amp = 0.28;
    }
    group.add(new THREE.Mesh(mergeMapped(dials), dialMat));
    for (const g of dials) g.dispose();

    // ---- the table, laid for guests
    const T = TEA.table; const tx = (T.minX + T.maxX) / 2; const tz = (T.minZ + T.maxZ) / 2; const tw = T.maxX - T.minX; const tl = T.maxZ - T.minZ; const th = T.h;
    parts.push(box('polish', tw, 0.07, tl, tx, th - 0.035, tz, OAK, 0, 0.22));
    for (const dz of [-tl / 2 + 0.9, 0, tl / 2 - 0.9]) {
      parts.push(box('polish', tw - 0.9, 0.12, 0.12, tx, 0.36, tz + dz, OAK, 0, 0.2));
      for (const sd of [-1, 1]) parts.push(lathe('polish', [[0.11, 0], [0.12, 0.04], [0.06, 0.1], [0.09, 0.3], [0.05, 0.45], [0.08, 0.62], [0.06, 0.73]], tx + sd * (tw / 2 - 0.45), 0, tz + dz, OAK, 10, 0.2));
    }
    parts.push(box('polish', 0.1, 0.1, tl - 1.6, tx, 0.36, tz, OAK, 0, 0.2));
    // a linen runner down the middle, hanging over both ends, gone grey
    parts.push(box('food', 1.5, 0.012, tl + 0.02, tx, th + 0.006, tz, 0x8f8a7c, 0, 0.2));
    for (const sd of [-1, 1]) parts.push(box('food', 1.5, 0.4, 0.012, tx, th - 0.19, tz + sd * (tl / 2 + 0.012), 0x8f8a7c, 0, 0.2));
    const ty = th + 0.012;
    // eight places: plate, goblet, knife; and chairs, two drawn back for the ghost and the skeleton
    const seats = [];
    for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) seats.push({ x: tx + sd * (tw / 2 - 0.42), z: T.minZ + 1.1 + i * 1.9, sd });
    for (const st of seats) {
      parts.push(lathe('wax', [[0.0, 0.004], [0.09, 0.004], [0.14, 0.02], [0.145, 0.024]], st.x, ty, st.z, 0xd8d2c2, 14, 0.08));
      parts.push(lathe('metal', [[0.035, 0], [0.008, 0.02], [0.008, 0.08], [0.036, 0.11], [0.04, 0.17]], st.x - st.sd * 0.05, ty, st.z - 0.26, 0x8a8a84, 10, 0.2));
      parts.push(box('metal', 0.02, 0.004, 0.2, st.x, ty + 0.003, st.z + 0.2, 0x9a9a94, 0.1, 0.1));
      // the place the skeleton sits at has his chair instead, drawn back, exactly where the rules seat him
      const his = Math.hypot(st.x + st.sd * 0.72 - TEA.skeleton.x, st.z - TEA.skeleton.z) < 1.2;
      if (!his) parts.push(...place(chair(), st.x + st.sd * 0.5, 0, st.z, st.sd > 0 ? Math.PI / 2 : -Math.PI / 2));
    }
    parts.push(...place(chair(), tx + 0.6, 0, T.minZ - 0.25, Math.PI)); // the foot of the table, empty
    // the two that are sat in (keepcast.js seats its figures on these): the ghost's at the head, the skeleton's turned to his watch
    parts.push(...place(chair(), TEA.ghost.x, 0, T.maxZ + 0.42, 0));
    parts.push(...place(chair(), TEA.skeleton.x, 0, TEA.skeleton.z, Math.atan2(TEA.skeleton.x - CLOCKS[3].x, TEA.skeleton.z - CLOCKS[3].z)));

    // the boar's head: weeks old, grey-green, sunk, on a pewter charger, an apple gone black in its jaw
    const flies = [];
    let flyAt = null;
    let steamAt = null;
    {
      const bx2 = tx - 0.3; const bz = tz + 1.9; const hd = [];
      hd.push(lathe('metal', [[0, 0.004], [0.27, 0.004], [0.36, 0.03], [0.37, 0.036]], 0, 0, 0, 0x77786f, 18, 0.2));
      const HIDE = 0x4b4a3a; const DARK = 0x2c2b22;
      hd.push(ball('wood', 0.17, 0, 0.16, 0.1, HIDE, 1.05, 0.88, 1, 0.6, 14)); // the skull, sunk on the neck's stump
      hd.push(ball('wood', 0.15, 0, 0.1, 0.2, DARK, 1.1, 0.6, 0.6, 0.5, 10));
      hd.push(part('wood', S.tint(new THREE.CylinderGeometry(0.062, 0.125, 0.3, 12).rotateX(-Math.PI / 2).translate(0, 0.115, -0.13), HIDE, 0.6))); // the long snout
      hd.push(part('wood', S.tint(new THREE.CylinderGeometry(0.066, 0.066, 0.025, 12).rotateX(Math.PI / 2).translate(0, 0.115, -0.29), 0x322a26, 0.3))); // the disc of the nose
      for (const sd of [-1, 1]) {
        hd.push(ball('wood', 0.012, sd * 0.024, 0.118, -0.305, 0x0c0a09, 1, 1.4, 0.6, 0, 6)); // nostrils
        hd.push(part('wax', S.tint(new THREE.ConeGeometry(0.02, 0.15, 7).rotateX(-0.35).rotateZ(-sd * 0.45).translate(sd * 0.085, 0.16, -0.2), 0xd6ccae, 0.12))); // tusks
        hd.push(part('wood', S.tint(new THREE.ConeGeometry(0.065, 0.14, 4).scale(1, 1, 0.35).rotateX(0.5).rotateZ(-sd * 1.0).translate(sd * 0.16, 0.3, 0.1), DARK, 0.5))); // ears, fallen sideways
        hd.push(ball('wood', 0.026, sd * 0.115, 0.215, -0.02, 0x0c0b09, 1, 0.55, 1, 0, 6)); // sockets
        hd.push(ball('wax', 0.02, sd * 0.12, 0.15, 0.02, 0xaab89a, 1.4, 0.5, 1.6, 0.3, 5)); // mould under the eye
      }
      for (let i = 0; i < 8; i++) hd.push(part('wood', S.tint(new THREE.ConeGeometry(0.014, 0.07, 4).rotateX(0.5).translate(0, 0.3 - i * 0.004, 0.2 - i * 0.045), 0x17150f, 0.3))); // the ridge of bristle
      hd.push(ball('wood', 0.05, 0, 0.068, -0.3, 0x15100c, 1, 0.9, 1, 0.3, 8)); // the apple in its jaw, gone black
      for (let i = 0; i < 9; i++) { const a = i * 0.7; hd.push(ball('wax', 0.014, Math.cos(a) * (0.11 + (i % 3) * 0.025), 0.27 - (i % 4) * 0.035, 0.1 + Math.sin(a) * 0.09, 0xaab89a, 1.3, 0.45, 1.3, 0.3, 5)); } // mould
      for (let i = 0; i < 7; i++) hd.push(part('decal', S.tint(new THREE.CircleGeometry(0.05 + (i % 3) * 0.03, 9).rotateX(-Math.PI / 2).translate(Math.cos(i * 0.9) * 0.24, 0.04 + i * 0.0004, Math.sin(i * 0.9) * 0.24), 0x1c170e, 0.3))); // what has run out of it
      for (const p of hd) if (p.m !== 'decal' && p.m !== 'metal') p.m = 'food';
      parts.push(...place(hd, bx2, ty, bz, Math.PI + 0.45, 2.3));
      for (let i = 0; i < 22; i++) flies.push([bx2, ty + 0.3, bz]);
      flyAt = { x: bx2, y: ty + 0.6, z: bz };
    }
    // the flowers: a vase of stems gone over, heads hanging, petals on the cloth
    {
      const fx = tx + 0.25; const fz = tz - 0.1; const v = [lathe('polish', [[0.05, 0], [0.085, 0.06], [0.07, 0.17], [0.03, 0.24], [0.045, 0.3]], 0, 0, 0, 0x3a4a5a, 12, 0.15)];
      const rand = S.rng(17);
      for (let i = 0; i < 13; i++) {
        const a = (i / 13) * TAU + rand(); const out = 0.07 + rand() * 0.07; const top = 0.4 + rand() * 0.1;
        const elbow = [Math.cos(a) * out, top, Math.sin(a) * out]; const end = [Math.cos(a) * out * 2.1, top - 0.07 - rand() * 0.08, Math.sin(a) * out * 2.1];
        v.push(rod('wood', [Math.cos(a) * 0.02, 0.27, Math.sin(a) * 0.02], elbow, 0.0028, 0x35361f, 4), rod('wood', elbow, end, 0.0024, 0x35361f, 4));
        // a head gone over: a dark knot, a few petals still on it
        v.push(ball('cloth', 0.017, end[0], end[1] - 0.012, end[2], i % 3 ? 0x33150f : 0x4a3520, 1, 1.25, 1, 0.3, 6));
        for (let k = 0; k < 3; k++) v.push(part('cloth', S.tint(new THREE.CircleGeometry(0.012, 5).rotateX(0.6 + k).rotateY(a + k * 2.1).translate(end[0] + 0.012 * Math.cos(k * 2.1), end[1] - 0.026, end[2] + 0.012 * Math.sin(k * 2.1)), 0x3d1c14, 0.3)));
        if (i % 2) v.push(part('cloth', S.tint(new THREE.PlaneGeometry(0.035, 0.012).rotateX(-0.9).rotateY(a).translate(elbow[0] * 0.8, top * 0.82, elbow[2] * 0.8), 0x35361f, 0.2)));
      }
      for (let i = 0; i < 14; i++) { const a = rand() * TAU; const d = 0.1 + rand() * 0.25; v.push(part('cloth', S.tint(new THREE.CircleGeometry(0.011, 5).rotateX(-Math.PI / 2).rotateY(rand() * 3).translate(Math.cos(a) * d, 0.003, Math.sin(a) * d), 0x3d1c14, 0.3))); }
      parts.push(...place(v, fx, ty, fz, 0, 1.5));
    }
    // the bread: a round loaf on a board, torn, furred blue-green
    {
      const b = [box('wood', 0.42, 0.02, 0.28, 0, 0.01, 0, 0x6e5234, 0.2, 0.2), ball('wood', 0.12, 0, 0.075, 0, 0x8a6a3e, 1.15, 0.62, 1, 0.3, 12), ball('wood', 0.07, 0.17, 0.05, 0.05, 0x9c8256, 1, 0.6, 0.9, 0.3, 8)];
      const rand = S.rng(23);
      for (let i = 0; i < 16; i++) { const a = rand() * TAU; const r = rand() * 0.11; b.push(ball('wax', 0.018 + rand() * 0.016, Math.cos(a) * r * 1.15, 0.075 + 0.07 * Math.sqrt(Math.max(0, 1 - (r / 0.12) ** 2)), Math.sin(a) * r, i % 3 ? 0x6f8f86 : 0xb9c9b4, 1, 0.35, 1, 0.3, 5)); }
      b.push(box('metal', 0.02, 0.004, 0.26, -0.14, 0.024, 0.02, 0x9a9a94, 0.6, 0.1));
      for (const p of b) if (p.m !== 'metal') p.m = 'food';
      parts.push(...place(b, tx - 0.35, ty, tz - 1.2, 0.3, 2.2));
    }
    // the turkey: just dressed, golden, on a white dish with greens; it steams
    const steam = [];
    {
      const kx = tx + 0.1; const kz = tz - 2.9; const k = [lathe('wax', [[0, 0.004], [0.24, 0.004], [0.36, 0.03], [0.37, 0.036]], 0, 0, 0, 0xe8e4d8, 18, 0.05)];
      k.push(ball('polish', 0.19, 0, 0.16, 0, 0x8f5220, 1, 0.78, 1.32, 0.3, 16));
      k.push(ball('polish', 0.1, 0, 0.26, -0.05, 0x9c6026, 1.3, 0.6, 1.5, 0.3, 12)); // the breast
      for (const sd of [-1, 1]) {
        k.push(ball('polish', 0.075, sd * 0.17, 0.14, 0.13, 0x7c4517, 0.9, 0.9, 1.5, 0.2, 9));
        k.push(rod('wax', [sd * 0.18, 0.15, 0.22], [sd * 0.2, 0.2, 0.34], 0.012, 0xe8dcc0, 5), ball('wax', 0.022, sd * 0.2, 0.205, 0.345, 0xf3ecd8, 1, 1, 1, 0.05, 6)); // frilled drumstick ends
        k.push(ball('polish', 0.05, sd * 0.19, 0.17, -0.1, 0x7c4517, 0.7, 0.6, 1.6, 0.2, 8)); // wings
      }
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; k.push(ball('cloth', 0.04, Math.cos(a) * 0.29, 0.035, Math.sin(a) * 0.3, i % 2 ? 0x4f7a2c : 0x6a9a3a, 1.2, 0.4, 1, 0.3, 5)); }
      for (const p of k) p.m = 'food';
      parts.push(...place(k, kx, ty, kz, -0.2, 2.3));
      for (let i = 0; i < 16; i++) steam.push([kx, ty + 0.3, kz]);
      steamAt = { x: kx, y: ty + 0.7, z: kz };
    }
    // the two candelabras: their flames light the room
    const flames = [];
    for (const c of TEA.candelabras) {
      const fl = [];
      parts.push(...place(candelabra(fl), c.x, ty, c.z, c.x * 1.7, 1.6));
      const cs = Math.cos(c.x * 1.7); const sn = Math.sin(c.x * 1.7);
      for (const [x, y, z] of fl) flames.push([c.x + 1.6 * (x * cs + z * sn), ty + 1.6 * y, c.z + 1.6 * (-x * sn + z * cs)]);
    }
    for (const [x, y, z] of flames) parts.push(part('lit', S.tint(new THREE.SphereGeometry(0.018, 10, 8).scale(1, 2.6, 1).translate(x, y, z), 0xffd9a0, 0)));
    const halos = points(group, flames, haloMat);
    // the wine bottle: on its side, the neck broken off, the wine long since run across the cloth and dried
    {
      const b = TEA.bottle; const w = [];
      w.push(part('polish', S.tint(new THREE.LatheGeometry([[0.0, 0], [0.04, 0.004], [0.042, 0.17], [0.034, 0.2], [0.03, 0.205]].map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)), 10).rotateZ(Math.PI / 2).translate(0.1, 0.042, 0), 0x16321f, 0.15)));
      w.push(part('polish', S.tint(new THREE.CylinderGeometry(0.012, 0.016, 0.09, 8).rotateZ(1.3).rotateY(0.9).translate(-0.24, 0.016, 0.12), 0x16321f, 0.15))); // the neck, apart
      const rand = S.rng(31);
      for (let i = 0; i < 9; i++) w.push(part('polish', S.tint(new THREE.TetrahedronGeometry(0.012 + rand() * 0.014).rotateX(rand() * 3).translate(-0.12 - rand() * 0.16, 0.008, (rand() - 0.5) * 0.2), 0x1f4a2c, 0.2))); // shards
      for (let i = 0; i < 8; i++) { const d = 0.08 + i * 0.05; w.push(part('decal', S.tint(new THREE.CircleGeometry(0.1 - i * 0.008 + rand() * 0.03, 10).rotateX(-Math.PI / 2).translate(-d, 0.002 + i * 0.0003, (rand() - 0.5) * 0.09 + i * 0.012), 0x3a060b, 0.25))); }
      w.push(part('decal', S.tint(new THREE.PlaneGeometry(0.05, 0.3).translate(0, -0.15, 0).rotateY(Math.PI / 2).translate(-0.5, 0, 0.1), 0x3a060b, 0.25))); // where it ran over the edge
      const edge = b.x >= tx ? T.maxX : T.minX;
      parts.push(...place(w, edge - Math.sign(edge - tx) * 0.5, ty, b.z, edge > tx ? Math.PI : 0));
    }
    // the sideboard, one drawer standing ajar with salt in it
    {
      const s = TEA.sideboard; const sx = (s.minX + s.maxX) / 2; const sz = (s.minZ + s.maxZ) / 2; const sw = s.maxX - s.minX; const sl = s.maxZ - s.minZ;
      parts.push(box('polish', sw - 0.06, s.h - 0.14, sl, sx - 0.03, 0.12 + (s.h - 0.14) / 2, sz, OAK, 0, 0.2), box('polish', sw + 0.04, 0.05, sl + 0.08, sx, s.h - 0.025, sz, OAK_LIGHT, 0, 0.2));
      for (const dz of [-sl / 2 + 0.1, sl / 2 - 0.1]) for (const dx of [-0.35, 0.3]) parts.push(ball('polish', 0.06, sx + dx, 0.06, sz + dz, OAK, 1, 1, 1, 0.1, 8));
      const drawerZ = clamp(TEA.drawer.z, s.minZ + 0.45, s.maxZ - 0.45);
      for (const [dz, out] of [[drawerZ - sz, 0.42], [drawerZ - sz + (drawerZ > sz ? -0.95 : 0.95), 0]]) {
        parts.push(box('polish', 0.03, 0.2, 0.8, s.maxX - 0.01 + out, 0.74, sz + dz, OAK_LIGHT, 0, 0.25));
        parts.push(ball('metal', 0.02, s.maxX + 0.02 + out, 0.74, sz + dz, BRASS, 1, 1, 1, 0.1, 6));
        if (out) {
          parts.push(box('wood', out, 0.015, 0.76, s.maxX + out / 2, 0.65, sz + dz, 0x5a422c, 0, 0.2));
          for (const sd of [-1, 1]) parts.push(box('wood', out, 0.17, 0.015, s.maxX + out / 2, 0.73, sz + dz + sd * 0.38, 0x5a422c, 0, 0.2));
        }
      }
      for (const dz of [-0.9, 0.9]) parts.push(box('polish', 0.02, 0.5, 0.6, s.maxX - 0.005, 0.37, sz + dz * 0.75, OAK_LIGHT, 0, 0.25));
    }
    // the gouges: a ring of claw scores in the flags round the logic's centre (TEA.werewolf.gouge), at the arm's reach
    {
      const gc = TEA.werewolf.gouge; const reach = (cfg.werewolf && cfg.werewolf.reach) || 1.8;
      const rand = S.rng(41);
      for (let i = 0; i < 44; i++) {
        const a = (i / 44) * TAU + (rand() - 0.5) * 0.08;
        const r = reach * (0.9 + rand() * 0.1);
        const gx = gc.x + Math.cos(a) * r; const gz = gc.z + Math.sin(a) * r;
        if (gx > room.maxX - 0.05 || gx < room.minX + 0.05 || gz > room.maxZ - 0.05 || gz < room.minZ + 0.05) continue; // the wall stands there
        parts.push(...gougeScore(rand, a, gx, gz)); // raked toward the middle (#16: pale torn stone round a dark groove)
      }
    }
    bake(group, parts);
    const fliesP = points(group, flies, flyMat);
    const steamP = points(group, steam, steamMat);

    function tick(sim, w, dt, time) {
      const cl = w.clocks || IDLE.clocks;
      const strike = w.scene && w.scene.kind === 'strike';
      for (let i = 0; i < clocks.length; i++) {
        const c = clocks[i];
        const h = cl.hours[i] || rules.stopped[i];
        const goal = faceOf(h, rules).hourTurn;
        if (c.turn == null || dt === 0) c.turn = goal;
        else { // the hand goes on clockwise to its hour
          let d = goal - c.turn; d -= Math.floor(d);
          if (d > 0.999 || d < 0.001) c.turn = goal; else c.turn += Math.min(d, dt * 0.5);
          c.turn -= Math.floor(c.turn);
        }
        const shiver = strike && !reduced ? 0.05 * Math.sin(time * 61 + i * 2) : strike ? 0.02 * Math.sin(time * 6 + i) : 0;
        c.hand.rotation.z = -TAU * c.turn + shiver;
        const right = h === rules.right;
        c.run = toward(c.run || 0, right ? 1 : 0, dt * 2);
        if (c.sweep) c.swing.rotation.z = right ? -Math.floor(time) * (TAU / 60) : c.swing.rotation.z; // the seconds dial steps
        else if (c.axis === 'y') c.swing.rotation.y = c.run * c.amp * Math.sin(time * TAU * (c.rate || 1));
        else c.swing.rotation.z = c.run * c.amp * Math.sin(time * Math.PI) + (1 - c.run) * 0.03; // one beat a second
      }
      const fp = fliesP.geometry.attributes.position;
      for (let i = 0; i < fp.count; i++) {
        const t = time * (reduced ? 0.6 : 1.7) + i * 5.1; const r = 0.3 + 0.2 * Math.sin(i * 2.3 + time * 0.7);
        fp.setXYZ(i, flyAt.x + Math.cos(t * 1.3 + i) * r, flyAt.y + 0.2 * Math.sin(t * 2.1 + i * 1.7) + 0.06 * Math.sin(t * 7.3), flyAt.z + Math.sin(t * 1.1 + i * 0.6) * r);
      }
      fp.needsUpdate = true;
      const sp = steamP.geometry.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        const k = ((time * 0.22 + i / sp.count) % 1);
        sp.setXYZ(i, steamAt.x + 0.16 * Math.sin(i * 2.4 + k * 3) * (0.4 + k), steamAt.y + k * 1.3, steamAt.z + 0.16 * Math.cos(i * 1.9 + k * 2.2) * (0.4 + k));
      }
      sp.needsUpdate = true;
      haloMat.opacity = reduced ? 0.8 : 0.72 + 0.1 * Math.sin(time * 11.3) + 0.06 * Math.sin(time * 27.1);
      void halos;
    }
    return { group, tick, free() { dial.dispose(); dialMat.dispose(); } };
  }

  // ---- the Looking-Glass Gallery: sixty tiles, the runner, the grin; and the crypt beneath ---------

  function buildGallery() {
    const group = new THREE.Group();
    const parts = [];
    const sq = GALLERY.tile;
    // A tile: a marble slab on the stone lattice, its top at the floor, a hair's joint all round.
    const slab = new THREE.BoxGeometry(sq - 0.03, 0.09, sq - 0.03);
    slab.translate(0, -0.045, 0);
    ST.paint(slab, 0xffffff, { vary: 0 });
    // Four instanced meshes: black and white marble, each once on the layer both cameras see and
    // once on the layer only the eye sees. A tile's instance is in exactly one of them, or in none.
    const meshes = TILE_MESHES.map(({ layer, dark }) => {
      const m = new THREE.InstancedMesh(slab, ST.stoneMaterial(dark ? 'marbleDark' : 'marbleLight'), TILE_COUNT / 2);
      m.layers.set(layer);
      m.receiveShadow = true;
      m.castShadow = false;
      m.frustumCulled = false;
      m.count = 0;
      m.userData = { layer, dark, ids: [] };
      group.add(m);
      return m;
    });
    // The runner, down column C from wall to wall: the eye only (layer 1). A length of it goes with its tile.
    const runnerMap = runnerTexture();
    const runnerMat = new THREE.MeshStandardMaterial({ map: runnerMap, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const strip = new THREE.PlaneGeometry(1.5, sq);
    strip.rotateX(-Math.PI / 2);
    const runner = new THREE.InstancedMesh(strip, runnerMat, GALLERY.rows + 4);
    runner.layers.set(FIXED_LAYERS.runner);
    runner.receiveShadow = true;
    runner.frustumCulled = false;
    runner.userData.ids = [];
    group.add(runner);
    // the grin: a mouth with no face, in the glass only (layer 2), turned to the glass
    const grinGeo = S.grin({ width: 0.95, teeth: 18, smile: 0.62, lip: 0x9a1a22, tooth: 0xf4efdc, seed: 5 });
    grinGeo.rotateY(GALLERY.mirrorX < GALLERY.windowX ? Math.PI / 2 : -Math.PI / 2);
    const grinMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.95 });
    const grin = new THREE.Mesh(grinGeo, grinMat);
    grin.layers.set(FIXED_LAYERS.grin);
    grin.visible = false;
    grin.userData.tile = null;
    group.add(grin);
    // shards: a false tile's go with it (the eye only); a true tile's chips are seen by both
    const shardGeo = new THREE.TetrahedronGeometry(0.09);
    S.tint(shardGeo, 0xffffff, 0);
    const shardMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.05 });
    const shards = [LAYER_EYE, LAYER_BOTH].map((layer) => {
      const m = new THREE.InstancedMesh(shardGeo, shardMat, layer === LAYER_EYE ? 28 : 10);
      m.layers.set(layer);
      m.count = 0;
      m.frustumCulled = false;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3).fill(1), 3);
      m.userData.live = [];
      group.add(m);
      return m;
    });
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();

    const laid = new Uint8Array(TILE_COUNT); // gone[], as the floor was last laid
    const put = (m, k, x, z) => {
      dummy.position.set(x, m === runner ? 0.004 : 0, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      m.setMatrixAt(k, dummy.matrix);
    };
    /** A5: lays the floor through layFloor (isTrue and nothing else). */
    function lay(tiles) {
      layFloor(tiles, meshes, runner, put);
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
      runner.instanceMatrix.needsUpdate = true;
      const gone = (tiles && tiles.gone) || [];
      for (let i = 0; i < TILE_COUNT; i++) laid[i] = gone[i] ? 1 : 0;
    }
    function stale(tiles) {
      const gone = (tiles && tiles.gone) || [];
      for (let i = 0; i < TILE_COUNT; i++) if ((gone[i] ? 1 : 0) !== laid[i]) return true;
      return false;
    }
    lay(IDLE.tiles);

    function burst(tile, n, layer, speed) {
      const m = shards[layer === LAYER_EYE ? 0 : 1];
      const r = tileRect(tile);
      const dark = (r.col + r.row) % 2 === 0;
      const rand = S.rng(tile * 7 + n);
      for (let i = 0; i < n; i++) {
        if (m.userData.live.length >= m.instanceMatrix.count) m.userData.live.shift();
        m.userData.live.push({
          x: r.x + (rand() - 0.5) * (n > 6 ? 1.7 : 0.3), y: 0.02, z: r.z + (rand() - 0.5) * (n > 6 ? 1.7 : 0.3),
          vx: (rand() - 0.5) * speed, vy: n > 6 ? rand() * 1.2 : 1.5 + rand() * 1.5, vz: (rand() - 0.5) * speed,
          spin: rand() * 9, s: n > 6 ? 0.8 + rand() * 1.8 : 0.3 + rand() * 0.3, t: 0, dark,
        });
      }
    }
    function stepShards(dt) {
      for (const m of shards) {
        const live = m.userData.live;
        for (let i = live.length - 1; i >= 0; i--) {
          const s2 = live[i];
          s2.t += dt; s2.vy -= 9.8 * dt;
          s2.x += s2.vx * dt; s2.y += s2.vy * dt; s2.z += s2.vz * dt;
          if (s2.y < CRYPT.floor - 0.5 || s2.t > 2.2 || (m.layers.mask === 1 && s2.y < 0.01 && s2.vy < 0 && s2.t > 0.4)) live.splice(i, 1);
        }
        m.count = live.length;
        live.forEach((s2, i) => {
          dummy.position.set(s2.x, s2.y, s2.z); dummy.rotation.set(s2.spin * s2.t, s2.spin * 0.7 * s2.t, 0); dummy.scale.setScalar(s2.s); dummy.updateMatrix();
          m.setMatrixAt(i, dummy.matrix);
          m.setColorAt(i, tint.setHex(s2.dark ? 0x24252b : HUE.marbleLight));
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }

    // the pedestal at the far end, a tonic on it
    const ped = GALLERY_PROPS.pedestal;
    parts.push(lathe('wax', [[0.24, 0], [0.25, 0.06], [0.16, 0.1], [0.13, 0.16], [0.12, 0.84], [0.15, 0.9], [0.2, 0.94], [0.2, 1.0]], ped.x, 0, ped.z, HUE.marbleLight, 14, 0.06));
    const pedTonic = mover(group, tonic(), ped.x, 1.0, ped.z);
    // ---- the crypt: three boxes of earth, one closed coffin, a tonic under the stair
    const cy = CRYPT.floor;
    CRYPT.props.forEach((b, i) => {
      const len = b.maxZ - b.minZ; const wid = b.maxX - b.minX; const x = (b.minX + b.maxX) / 2; const z = (b.minZ + b.maxZ) / 2;
      if (b.id === 'coffin' || b.kind === 'coffin' || b.h === 1.0) {
        // the closed coffin: lid on and nailed, black cloth rotted off the boards, a blank plate. It sounds empty.
        const c = [...coffinWalls(len - 0.1, wid - 0.1, b.h - 0.3, 0.22, 0.04, 0x1d1714, 'polish'), coffinSheet(len - 0.04, wid - 0.04, b.h - 0.07, 0, 0x231b17, 3, 'polish', 0), coffinSheet(len - 0.04, wid - 0.04, b.h - 0.02, 0.03, 0x1d1714, 4, 'polish', 0.04)];
        for (const dz of [-len * 0.3, len * 0.3]) c.push(box('wood', wid - 0.3, 0.22, 0.12, 0, 0.11, dz, 0x3a2e24, 0, 0.2)); // trestles
        for (let k = 0; k < 10; k++) { const zz = -len / 2 + 0.2 + (k % 5) * (len - 0.4) / 4; const sd = k < 5 ? -1 : 1; c.push(ball('metal', 0.012, sd * (coffinHalf(zz, len - 0.1, wid - 0.1) - 0.03), b.h - 0.015, zz, 0x8a8a84, 1, 0.5, 1, 0, 5)); }
        c.push(box('metal', 0.2, 0.004, 0.13, 0, b.h + 0.012, -len * 0.12, BRASS, 0, 0.2));
        for (const sd of [-1, 1]) for (const dz of [-0.4, 0.4]) c.push(rod('metal', [sd * (wid / 2 - 0.06), 0.62, dz - 0.1], [sd * (wid / 2 - 0.06), 0.62, dz + 0.1], 0.012, BRASS));
        parts.push(...place(c, x, cy, z, 0));
      } else {
        parts.push(...place(earthBox(len - 0.12, wid - 0.12, b.h - 0.38, 5 + i, i !== 1), x, cy, z, 0));
      }
    });
    const us = CRYPT_PROPS.underStair;
    parts.push(box('wood', 0.4, 0.3, 0.4, us.x, cy + 0.15, us.z, 0x4a3a2a, 0.2, 0.25));
    const cryptTonic = mover(group, tonic(), us.x, cy + 0.3, us.z);
    bake(group, parts);

    function tick(sim, w, dt, time) {
      const tiles = w.tiles || IDLE.tiles;
      if (stale(tiles)) lay(tiles); // a seat or a load with no event: still through layFloor
      stepShards(dt);
      pedTonic.visible = !lootTaken(w, 'pedestal');
      cryptTonic.visible = !lootTaken(w, 'cryptTonic');
      const t = grinTile(w);
      grin.visible = t != null && !w.under;
      grin.userData.tile = grin.visible ? t : null;
      if (grin.visible) {
        const r = tileRect(t);
        grin.position.set(r.x, 1.55 + (reduced ? 0 : 0.05 * Math.sin(time * 1.7)), r.z);
        grinMat.opacity = reduced ? 0.95 : 0.8 + 0.15 * Math.sin(time * 2.3);
      }
    }
    function event(ev, w) {
      if (ev.type === 'tileBreak') {
        lay((w && w.tiles) || IDLE.tiles);
        burst(ev.tile, 16, LAYER_EYE, 1.2);
      } else if (ev.type === 'tileShot' && isTrue(ev.tile)) burst(ev.tile, 5, LAYER_BOTH, 2.2);
      else if (ev.type === 'restored') {
        lay((w && w.tiles) || IDLE.tiles);
        for (const m of shards) { m.userData.live.length = 0; m.count = 0; }
      }
    }
    /** What is actually on each layer now, read back from the meshes (the smoke and the checks). */
    function report() {
      const f = floorReport(meshes, runner);
      const masked = meshes.every((m) => m.layers.mask === (1 << m.userData.layer)); // each mesh really is on the layer it is laid for
      return {
        glass: f.glass, eyeOnly: f.eyeOnly, eye: f.eye, masked,
        runner: { mask: runner.layers.mask, spans: f.runnerSpans, tiles: f.runnerTiles, own: runner.visible },
        grin: { mask: grin.layers.mask, visible: grin.visible, tile: grin.userData.tile },
      };
    }
    return {
      group, tick, event, report,
      free() { slab.dispose(); strip.dispose(); runnerMap.dispose(); runnerMat.dispose(); grinMat.dispose(); shardMat.dispose(); },
    };
  }

  // ---- the Knight's Walk: the brass plate at the near edge ---------------------------------------

  function buildWalk() {
    const group = new THREE.Group();
    const p = BOARD.plate;
    const text = READS.boardPlate || (ENTRIES.boardPlate && ENTRIES.boardPlate.text) || '';
    const map = plateTexture(text);
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.38, metalness: 0.7 });
    const parts = [];
    // a low stone lectern, its top sloped to be read standing
    parts.push(box('wax', 0.9, 0.5, 0.5, p.x, 0.25, p.z + 0.1, HUE.ashlar, 0, 0.2), box('wax', 1.0, 0.06, 0.6, p.x, 0.03, p.z + 0.1, HUE.ashlar, 0, 0.2));
    parts.push(box('wax', 0.9, 0.08, 0.62, p.x, 0.56, p.z + 0.1, HUE.ashlar, 0, 0.2, 0.5));
    bake(group, parts);
    const plate = new THREE.Mesh(moved(face(0.76, 0.38), p.x, 0.615, p.z + 0.1, 0, -Math.PI / 2 + 0.5), mat);
    group.add(plate);
    return { group, free() { map.dispose(); mat.dispose(); } };
  }

  // ---- the mirror room: salt box, five pieces of furniture, the figure-mirror ----------------------

  function buildMirrorRoom() {
    const group = new THREE.Group();
    const parts = [];
    const y = UPPER;
    const T = MIRROR_ROOM.table; const tx = (T.minX + T.maxX) / 2; const tz = (T.minZ + T.maxZ) / 2;
    parts.push(box('polish', T.maxX - T.minX, 0.05, T.maxZ - T.minZ, tx, y + T.h - 0.025, tz, OAK, 0, 0.2));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(lathe('polish', [[0.05, 0], [0.03, 0.06], [0.05, 0.3], [0.03, 0.5], [0.045, T.h - 0.05]], tx + sx * ((T.maxX - T.minX) / 2 - 0.09), y, tz + sz * ((T.maxZ - T.minZ) / 2 - 0.09), OAK, 8, 0.2));
    // the salt box: a hinged deal box, lid up, heaped white
    const sb = MIRROR_ROOM.saltBox; const sy = y + T.h; const sz0 = clamp(sb.z, T.minZ + 0.2, T.maxZ - 0.2);
    parts.push(box('wood', 0.34, 0.02, 0.24, sb.x, sy + 0.01, sz0, 0x8a6a44, 0, 0.2));
    for (const sd of [-1, 1]) parts.push(box('wood', 0.34, 0.16, 0.018, sb.x, sy + 0.08, sz0 + sd * 0.12, 0x8a6a44, 0, 0.25), box('wood', 0.018, 0.16, 0.24, sb.x + sd * 0.17, sy + 0.08, sz0, 0x8a6a44, 0, 0.25));
    parts.push(box('wood', 0.36, 0.018, 0.26, sb.x, sy + 0.29, sz0 - 0.16, 0x7a5c3a, 0, 0.25, 1.25));
    const salt = mover(group, [ball('wax', 0.15, 0, 0, 0, 0xf2f1ea, 1.05, 0.42, 0.72, 0.12, 10)], sb.x, sy + 0.13, sz0, 0, false);
    // the five pieces: each where the rules have put it
    const pieces = FURNITURE.map((f) => {
      const build = f.kind === 'chair' ? chair() : f.kind === 'cabinet' ? cabinet(false) : f.kind === 'wardrobe' ? cabinet(true) : settle();
      const g = mover(group, build, 0, y, 0, 0);
      return { g, f, at: -1 };
    });
    // the figure-mirror: a tall gilt frame gone out of true, old rippled glass, and something standing in it
    const fm = MIRROR_ROOM.figureMirror;
    const ripple = rippleTexture();
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x3d4a50, roughness: 0.18, metalness: 0.85, bumpMap: ripple, bumpScale: 1.4, transparent: true, opacity: 0.5, depthWrite: false });
    const fr = [box('wood', 1.3, 2.4, 0.03, 0, 1.3, -0.07, 0x07090b, 0, 0)];
    for (let i = 0; i < 12; i++) { // the frame: each length a little off the last
      const k = i / 12; const yy = 0.16 + k * 2.3;
      for (const sd of [-1, 1]) fr.push(box('metal', 0.11, 0.21, 0.09, sd * (0.65 + 0.025 * Math.sin(k * 9 + sd)), yy + 0.1, 0, HUE.gilt, 0, 0.3, 0, sd * 0.05 * Math.sin(k * 7)));
    }
    fr.push(box('metal', 1.46, 0.13, 0.1, 0, 0.12, 0, HUE.gilt, 0, 0.3), box('metal', 1.46, 0.13, 0.1, 0, 2.52, 0, HUE.gilt, 0, 0.3, 0, 0.02));
    for (let i = 0; i < 7; i++) { const a = (i / 6) * Math.PI; fr.push(ball('metal', 0.07, -Math.cos(a) * 0.5, 2.6 + Math.sin(a) * 0.2, 0, HUE.gilt, 1, 1, 0.6, 0.3, 7)); }
    parts.push(...place(fr, fm.x - 0.2, y, fm.z, Math.PI / 2));
    const glass = new THREE.Mesh(moved(face(1.22, 2.3), fm.x - 0.16, y + 1.32, fm.z, Math.PI / 2), glassMat);
    glass.renderOrder = 2;
    group.add(glass);
    // What stands in it: one of the three forest creatures, never the warden. Only the one showing is
    // built. With a creature builder (opts.creature or setCreature: the shipped model's factory) it is
    // that model, pressed flat behind the glass; without one, a pale flat figure of the same creature.
    const dark = 0x56666c;
    const eyes = (list) => [...list.map(([x, yy, z]) => ball('lit', 0.026, x, yy, z, 0xe6f2ff, 1.5, 0.55, 1, 0, 6)),
      ball('wood', 0.1, 0, list[0][1] - 0.11, list[0][2] + 0.02, 0x050607, 1.25, 0.22, 0.6, 0, 8)];
    const FIGURES = {
      rabbit: () => [ball('cloth', 0.2, 0, 0.62, 0, dark, 1, 2.0, 1), ball('cloth', 0.17, 0, 1.2, 0, dark, 0.85, 1.3, 1),
        ...[-1, 1].map((sd) => ball('cloth', 0.06, sd * 0.09, 1.72, 0, dark, 1, 4.6, 1)), ...[-1, 1].map((sd) => ball('cloth', 0.07, sd * 0.3, 0.7, 0, dark, 1, 3.6, 1)), ...eyes([[-0.07, 1.25, 0.2], [0.07, 1.25, 0.2]])],
      hatter: () => [ball('cloth', 0.24, 0, 0.8, 0, dark, 1.1, 2.6, 1), ball('cloth', 0.15, 0, 1.56, 0, dark, 1, 1.2, 1), cyl('cloth', 0.2, 0.17, 0.42, 0, 1.72, 0, dark, 12), cyl('cloth', 0.34, 0.34, 0.03, 0, 1.7, 0, dark, 14),
        ...[-1, 1].map((sd) => ball('cloth', 0.06, sd * 0.36, 0.95, 0, dark, 1, 5, 1)), ...eyes([[-0.055, 1.58, 0.16], [0.055, 1.58, 0.16]])],
      caterpillar: () => [...[0, 1, 2, 3, 4, 5].map((i) => ball('cloth', 0.2 - i * 0.012, 0.1 * Math.sin(i * 0.9), 0.2 + i * 0.27, 0, dark, 1.1, 0.85, 1)),
        ...[0, 1, 2, 3].flatMap((i) => [-1, 1].map((sd) => rod('cloth', [sd * 0.16, 0.5 + i * 0.27, 0], [sd * 0.34, 0.44 + i * 0.27, 0], 0.016, dark, 4))), ...eyes([[-0.06, 1.6, 0.18], [0.06, 1.6, 0.18]])],
    };
    let foe = null; // { kind, g, free }: the one creature this mirror costs
    /** A new builder: whatever is on show is built again with it. */
    function refoe() {
      const kind = foe ? foe.kind : null;
      dropFoe();
      showFoe(kind);
    }
    function dropFoe() {
      if (!foe) return;
      group.remove(foe.g);
      foe.free();
      foe = null;
    }
    function showFoe(kind) {
      if ((foe ? foe.kind : null) === (kind || null)) return;
      dropFoe();
      if (!kind || !FIGURES[kind]) return;
      let view = null;
      try { view = creature ? creature(kind, cfg) : null; } catch (err) {
        view = null;
        if (!creatureFailed) { creatureFailed = true; console.error('keepprops: the creature builder threw; the figure-mirror shows its stand-in', err); }
      }
      if (view && view.g) { // the shipped model: stood where the reflection would be, turned to the room, pressed flat
        // Issue 24: its front is its -z, so it takes the map's yaw (the stand-in's turn faced it to the
        // wall, and showed only its back and its chair), and it is fitted to the glass (foeFit).
        view.g.position.set(0, 0, 0);
        view.g.rotation.set(0, 0, 0);
        view.g.updateMatrixWorld(true);
        const fit = foeFit(new THREE.Box3().setFromObject(view.g));
        const sized = new THREE.Group();
        sized.scale.setScalar(fit.scale);
        sized.position.set(fit.x, fit.y, fit.z);
        sized.add(view.g);
        const holder = new THREE.Group();
        holder.position.set(fm.x - 0.235, y, fm.z);
        holder.rotation.y = fit.yaw;
        holder.scale.set(1, 1, 0.1);
        holder.add(sized);
        group.add(holder);
        foe = { kind, g: holder, model: 'creature', free() { sized.remove(view.g); if (view.dispose) view.dispose(); } };
        return;
      }
      const list = FIGURES[kind]();
      for (const p of list) p.g.scale(1, 1, 0.1);
      const g = mover(group, list, fm.x - 0.235, y + 0.22, fm.z, Math.PI / 2, false);
      foe = { kind, g, model: 'stand-in', free() { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); } };
    }
    bake(group, parts);

    function tick(sim, w, dt, time) {
      const h = w.haunts;
      pieces.forEach((pc, i) => {
        const k = (h && h.furniture && h.furniture[i]) || 0;
        if (k === pc.at) return;
        const pl = pc.f.places[k] || pc.f.places[0];
        pc.g.position.set(pl.x, y, pl.z);
        pc.g.rotation.y = pl.yaw || 0;
        pc.at = k;
      });
      salt.visible = !w.stock || w.stock.salt !== false;
      showFoe(h && h.atMirror ? h.foe : null);
      if (foe) foe.g.rotation.z = reduced ? 0 : 0.03 * Math.sin(time * 0.9); // it sways; the warden did not
    }
    /** What stands in the figure-mirror now (the smoke reads it): { kind, model, visible, meshes } or null. */
    function figure() {
      if (!foe) return null;
      let meshes = 0; let shown = true;
      foe.g.traverse((o) => { if (o.isMesh && o.visible) meshes++; });
      for (let o = foe.g; o; o = o.parent) if (!o.visible) shown = false;
      return { kind: foe.kind, model: foe.model, visible: shown && meshes > 0, meshes };
    }
    return { group, tick, refoe, figure, free() { dropFoe(); ripple.dispose(); glassMat.dispose(); } };
  }

  // ---- the nursery: cot and stakes, the horse, the music box, the dust sheets ----------------------

  function buildNursery() {
    const group = new THREE.Group();
    const parts = [];
    const y = UPPER;
    const C = NURSERY.cot; const cx = (C.minX + C.maxX) / 2; const cz = (C.minZ + C.maxZ) / 2; const cw = C.maxX - C.minX - 0.5; const cl = C.maxZ - C.minZ - 0.1;
    // the cot: white-painted iron, brass knobs, every bar straight, the bedding squared
    const WHITE = 0xd9d6cc;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(cyl('polish', 0.02, 0.02, C.h + 0.25, cx + sx * cw / 2, y, cz + sz * cl / 2, WHITE, 8), ball('metal', 0.035, cx + sx * cw / 2, y + C.h + 0.27, cz + sz * cl / 2, BRASS, 1, 1, 1, 0.1, 8));
    for (const hh of [0.3, C.h]) {
      for (const sx of [-1, 1]) parts.push(rod('polish', [cx + sx * cw / 2, y + hh, cz - cl / 2], [cx + sx * cw / 2, y + hh, cz + cl / 2], 0.013, WHITE));
      for (const sz of [-1, 1]) parts.push(rod('polish', [cx - cw / 2, y + hh, cz + sz * cl / 2], [cx + cw / 2, y + hh, cz + sz * cl / 2], 0.013, WHITE));
    }
    for (let i = 1; i < 14; i++) for (const sx of [-1, 1]) parts.push(rod('polish', [cx + sx * cw / 2, y + 0.3, cz - cl / 2 + (i / 14) * cl], [cx + sx * cw / 2, y + C.h, cz - cl / 2 + (i / 14) * cl], 0.007, WHITE, 4));
    for (let i = 1; i < 8; i++) for (const sz of [-1, 1]) parts.push(rod('polish', [cx - cw / 2 + (i / 8) * cw, y + 0.3, cz + sz * cl / 2], [cx - cw / 2 + (i / 8) * cw, y + C.h, cz + sz * cl / 2], 0.007, WHITE, 4));
    parts.push(box('cloth', cw - 0.04, 0.12, cl - 0.04, cx, y + 0.38, cz, 0xcfcabb, 0, 0.1), ball('cloth', 0.16, cx, y + 0.47, cz - cl / 2 + 0.26, 0xdedacd, 1.6, 0.4, 1, 0.08, 10));
    parts.push(box('cloth', cw - 0.02, 0.03, cl * 0.55, cx, y + 0.455, cz + cl * 0.2, 0x7d8a96, 0, 0.14));
    // the bundle: six stakes, tied twice, laid on the blanket at the near side
    const bz = clamp(NURSERY.bundle.z, C.minZ + 0.25, C.maxZ - 0.25);
    const bundle = [];
    for (let i = 0; i < 6; i++) {
      const st = stake(0.62); const ox = [0, 0.036, -0.036, 0.018, -0.018, 0][i]; const oy = [0, 0, 0, 0.032, 0.032, 0.064][i];
      for (const p of st) { p.g.rotateZ(Math.PI / 2).translate(0.31, 0.02 + oy, ox); bundle.push(p); }
    }
    for (const dx of [-0.16, 0.14]) bundle.push(part('cloth', S.tint(new THREE.TorusGeometry(0.058, 0.007, 5, 12).rotateY(Math.PI / 2).translate(dx, 0.046, 0), 0x8a7a54, 0.2)));
    const bundleG = mover(group, bundle, cx, y + 0.47, bz, 0.12);
    // the crossbow under the bundle, for a warden who came without one
    const bow = [box('wood', 0.5, 0.035, 0.045, 0, 0.02, 0, 0x4a3222, 0, 0.2), box('metal', 0.03, 0.02, 0.56, 0.2, 0.03, 0, IRON, 0, 0.2, 0, 0), rod('cloth', [0.2, 0.03, -0.28], [0.02, 0.03, 0], 0.003, 0xcfc8b0, 3), rod('cloth', [0.2, 0.03, 0.28], [0.02, 0.03, 0], 0.003, 0xcfc8b0, 3)];
    const bowG = mover(group, bow, cx - 0.05, y + 0.47, bz + 0.16, 0.3);
    // the horse: a dapple-grey rocker on bow runners, red saddle, one glass eye that has seen the room empty
    const H = NURSERY.horse;
    const hp = [];
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 10; i++) { // the runners: an arc under it
        const a0 = -0.62 + (i / 10) * 1.24; const a1 = -0.62 + ((i + 1) / 10) * 1.24; const R = 1.25;
        hp.push(rod('polish', [sd * 0.2, R - R * Math.cos(a0), R * Math.sin(a0)], [sd * 0.2, R - R * Math.cos(a1), R * Math.sin(a1)], 0.024, 0x6e1a1c, 6));
      }
      for (const [lz, fz] of [[-0.3, -0.5], [0.3, 0.5]]) hp.push(rod('polish', [sd * 0.11, 0.62, lz], [sd * 0.2, 0.12, fz], 0.035, 0xb9b6ac, 6), ball('polish', 0.04, sd * 0.2, 0.1, fz, 0x1a1a1c, 1, 0.8, 1.3, 0.1, 6));
      hp.push(part('polish', S.tint(new THREE.ConeGeometry(0.03, 0.09, 5).translate(sd * 0.05, 1.29, -0.56), 0xb9b6ac, 0.2)));
      hp.push(ball('lit', 0.014, sd * 0.062, 1.17, -0.63, 0x20242a, 1, 1, 1, 0, 6));
    }
    for (const fz of [-0.5, 0.5]) hp.push(rod('polish', [-0.2, 0.1, fz], [0.2, 0.1, fz], 0.02, 0x6e1a1c, 6));
    hp.push(ball('polish', 0.22, 0, 0.72, 0, 0xbfbcb2, 0.82, 0.86, 1.75, 0.45, 12));
    hp.push(rod('polish', [0, 0.82, -0.3], [0, 1.12, -0.5], 0.09, 0xbfbcb2, 8), ball('polish', 0.1, 0, 1.15, -0.6, 0xbfbcb2, 0.8, 0.9, 1.7, 0.4, 10));
    for (let i = 0; i < 7; i++) hp.push(ball('cloth', 0.04, 0, 1.24 - i * 0.065, -0.5 + i * 0.035, 0x18181a, 0.5, 1.2, 1, 0.1, 5)); // the mane
    hp.push(rod('cloth', [0, 0.78, 0.38], [0, 0.42, 0.56], 0.03, 0x18181a, 5));
    hp.push(box('cloth', 0.3, 0.05, 0.34, 0, 0.92, 0.02, HUE.red, 0, 0.2), box('cloth', 0.37, 0.24, 0.26, 0, 0.8, 0.02, HUE.red, 0, 0.2));
    const horse = mover(group, hp, H.x, y, H.z, 0.6);
    // the music box, on a child's table: lid up, a brass cylinder, a small figure on a pin
    const mb = NURSERY.musicBox;
    parts.push(cyl('polish', 0.3, 0.3, 0.03, mb.x, y + 0.5, mb.z, OAK_LIGHT, 14), lathe('polish', [[0.16, 0], [0.04, 0.05], [0.05, 0.3], [0.03, 0.5]], mb.x, y, mb.z, OAK_LIGHT, 10));
    parts.push(box('polish', 0.22, 0.09, 0.16, mb.x, y + 0.575, mb.z, 0x3a1416, 0, 0.2), box('polish', 0.22, 0.012, 0.16, mb.x, y + 0.7, mb.z - 0.075, 0x3a1416, 0, 0.2, 1.35));
    parts.push(box('metal', 0.2, 0.004, 0.14, mb.x, y + 0.622, mb.z, BRASS, 0, 0.2));
    const dancer = mover(group, [cyl('metal', 0.002, 0.002, 0.03, 0, 0, 0, BRASS, 4), part('wax', S.tint(new THREE.ConeGeometry(0.022, 0.035, 8).translate(0, 0.045, 0), 0xe6dccb, 0.1)), ball('wax', 0.009, 0, 0.075, 0, 0xe6dccb, 1, 1, 1, 0, 6), rod('wax', [-0.02, 0.066, 0], [0.02, 0.07, 0], 0.003, 0xe6dccb, 4)], mb.x + 0.04, y + 0.624, mb.z, 0, false);
    const drum = mover(group, [part('metal', S.tint(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 10).rotateZ(Math.PI / 2), BRASS, 0.3))], mb.x - 0.03, y + 0.634, mb.z + 0.03, 0, false);
    // the dust sheets: whatever they cover has not been wanted for a long time
    NURSERY.sheets.forEach((s, i) => {
      const sh = i === 0 ? sheeted(1.0, 1.25, 0.7, 3) : sheeted(1.5, 0.85, 0.8, 8);
      sh.g.rotateY(i * 1.1 + 0.3).translate(s.x, y, s.z);
      parts.push(sh);
    });
    bake(group, parts);

    let rock = 1; let phase = 0;
    function tick(sim, w, dt, time) {
      const h = w.haunts;
      const rocking = !h || !h.horse || h.horse.rocking;
      rock = toward(rock, rocking ? 1 : 0, dt * (rocking ? 0.6 : 5)); // it stops the moment it is looked at
      phase += dt * 3.3 * rock;
      horse.rotation.x = 0.2 * rock * Math.sin(phase);
      const playing = h && h.box && h.box.left > 0;
      if (playing) { dancer.rotation.y += dt * 2.4; drum.rotation.x += dt * 1.6; }
      bundleG.visible = !w.stock || w.stock.stakes !== false;
      const i = cfg.loot ? cfg.loot.findIndex((l) => l.key === 'crossbow') : -1;
      const entry = i >= 0 && w.loot ? w.loot[i] : null;
      bowG.visible = !!entry && !entry.taken && !!(sim && sim.weapons && !(sim.weapons.crossbow || (Array.isArray(sim.weapons) && sim.weapons.some((q) => q && (q.name === 'crossbow' || q.key === 'crossbow')))));
      void time;
    }
    return { group, tick, free() {} };
  }

  // ---- the Count's room: the box of earth, three curtains three ways ------------------------------

  function buildCount() {
    const group = new THREE.Group();
    const parts = [];
    const y = UPPER;
    const tune = cfg.count || {};
    const B = COUNT_ROOM.box; const bx2 = (B.minX + B.maxX) / 2; const bz = (B.minZ + B.maxZ) / 2; const bl = B.maxZ - B.minZ; const bw = B.maxX - B.minX;
    // the box: the fiftieth, bigger than the crypt's, its earth to the rim; its lid on, until he lifts it
    parts.push(...place(earthBox(bl, bw, B.h - 0.06, 50, false), bx2, y, bz, 0));
    const lidParts = [coffinSheet(bl + 0.06, bw + 0.06, 0, 0, 0x3d2f22, 51, 'board', 0), coffinSheet(bl + 0.06, bw + 0.06, 0.05, 0, 0x4a3a2a, 52, 'board', 0)];
    for (const k of [-0.3, 0.12, 0.42]) lidParts.push(box('metal', coffinHalf(k * bl, bl, bw) * 2 + 0.06, 0.012, 0.07, 0, 0.058, k * bl, IRON, 0, 0.2));
    // hinged along its east edge, the windows' side: thrown back it stands behind the box from the room (and from the
    // death scene's camera, which holds on the box from the west), so what is in the box is never hidden by it
    for (const p of lidParts) p.g.translate(-(bw / 2 + 0.03), 0, 0);
    const lid = mover(group, lidParts, bx2 + bw / 2 + 0.03, y + B.h - 0.03, bz);
    // the three curtains
    const eastX = COUNT_ROOM.rect.maxX;
    const W = 2.7; const Hh = 4.7; const y0 = y + 0.12;
    const halfGeo = (() => { // one half: hung from x = 0 (its outer edge) to x = W / 2, in folds
      const g = new THREE.PlaneGeometry(W / 2, Hh, 22, 8);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) + W / 4; const v = p.getY(i) + Hh / 2;
        p.setXYZ(i, u, v, 0.07 * Math.sin(u * 16) * (0.6 + 0.4 * (1 - v / Hh)) + 0.025 * S.noise(u * 3, v * 1.5, 0, 6));
      }
      g.computeVertexNormals();
      return S.tint(g, VELVET, 0.3, 4);
    })();
    const curtains = COUNT_ROOM.curtains.map((c, i) => {
      const cg = new THREE.Group();
      cg.position.set(eastX - 0.34, y0, c.z);
      cg.rotation.y = -Math.PI / 2; // local +x runs toward +z, local +z faces the room (west)
      group.add(cg);
      const halves = [-1, 1].map((sd) => {
        const m = new THREE.Mesh(halfGeo, M.cloth);
        m.position.x = sd * W / 2;
        m.scale.x = -sd;
        m.castShadow = true;
        cg.add(m);
        return m;
      });
      // a pelmet and its pole
      parts.push(box('cloth', 0.26, 0.34, W + 0.3, eastX - 0.2, y0 + Hh + 0.1, c.z, 0x2a0508, 0, 0.3), rod('metal', [eastX - 0.3, y0 + Hh - 0.02, c.z - W / 2 - 0.12], [eastX - 0.3, y0 + Hh - 0.02, c.z + W / 2 + 0.12], 0.02, BRASS));
      // the seam of dawn: a thin gold line where the two halves meet, and along the hem
      const seam = mover(group, [box('lit', 0.012, Hh - 0.1, 0.03, 0, Hh / 2, 0, HUE.dawn, 0, 0), box('lit', 0.012, 0.02, W - 0.2, 0, -0.03, 0, HUE.dawn, 0, 0)], eastX - 0.45, y0, c.z, 0, false);
      // behind it (art pass K1): the window itself, with the sunrise and the land beyond it
      // (castle.js, dawnview.js), no flat gold pane; and the shaft it throws across the box
      // the shaft, where it lies: a pool of gold on the boards from the sill to past the box, fading as it goes
      const sg = new THREE.BufferGeometry();
      const far = bx2 - 2.6; const N = 10;
      const pos = []; const col = []; const gold = new THREE.Color(HUE.dawn);
      const edge = (t) => { const x = lerp(eastX - 0.25, far, t); const zc = lerp(c.z, bz + (c.z - bz) * 0.3, t); const half = lerp(0.85, 1.5, t); return [x, zc - half, zc + half, (1 - t) ** 1.4]; };
      for (let k = 0; k < N; k++) {
        const [xa, za0, za1, ka] = edge(k / N); const [xb, zb0, zb1, kb] = edge((k + 1) / N);
        pos.push(xa, y + 0.05, za0, xa, y + 0.05, za1, xb, y + 0.05, zb1, xa, y + 0.05, za0, xb, y + 0.05, zb1, xb, y + 0.05, zb0);
        for (const q of [ka, ka, kb, ka, kb, kb]) col.push(gold.r * q, gold.g * q, gold.b * q);
      }
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const shaft = new THREE.Mesh(sg, M.shaft);
      shaft.renderOrder = 3;
      group.add(shaft);
      return { c, cg, halves, seam, shaft, open: null, i };
    });
    // 0: the cord, tangled on its cleat
    const c0 = COUNT_ROOM.curtains[0];
    parts.push(box('metal', 0.03, 0.16, 0.05, eastX - 0.03, y + 1.25, c0.cord.z, BRASS, 0, 0.2), rod('metal', [eastX - 0.02, y + 1.3, c0.cord.z], [eastX - 0.12, y + 1.34, c0.cord.z], 0.012, BRASS), rod('metal', [eastX - 0.02, y + 1.2, c0.cord.z], [eastX - 0.12, y + 1.16, c0.cord.z], 0.012, BRASS));
    const cordLine = mover(group, [rod('cloth', [0, 0, 0], [0, -(Hh - 1.55), 0], 0.018, 0xc9b88a, 5)], eastX - 0.12, y0 + Hh - 0.05, c0.cord.z, 0, false);
    const tangle = [];
    { const rand = S.rng(61); let px = 0; let py = 0; let pz = 0;
      for (let i = 0; i < 46; i++) { const nx = (rand() - 0.5) * 0.24; const ny = (rand() - 0.5) * 0.3; const nz = (rand() - 0.5) * 0.2; tangle.push(rod('cloth', [px, py, pz], [nx, ny, nz], 0.011, 0xc9b88a, 4)); px = nx; py = ny; pz = nz; }
      tangle.push(lathe('cloth', [[0.0, -0.2], [0.035, -0.17], [0.02, -0.06], [0.012, 0]], 0, -0.16, 0, 0x7a0f14, 8)); }
    const tangleG = mover(group, tangle, eastX - 0.2, y + 1.27, c0.cord.z, 0, false);
    const TANGLE = 1.7;
    // 1: the bar across it, chained, and the padlock
    const c1 = COUNT_ROOM.curtains[1]; const ly = y + c1.lock.y;
    const bar = [rod('metal', [0, 0, -W / 2 - 0.25], [0, 0, W / 2 + 0.25], 0.04, 0x3a3b40, 8)];
    for (const sd of [-1, 1]) bar.push(box('metal', 0.1, 0.16, 0.08, 0.06, 0, sd * (W / 2 + 0.22), IRON, 0, 0.2));
    for (let i = 0; i < 26; i++) { // a chain wound round the bar and through the staples
      const zz = -W / 2 + (i / 25) * W; const a = i * 1.9;
      bar.push(part('metal', S.tint(new THREE.TorusGeometry(0.045, 0.011, 5, 8).rotateX(i % 2 ? 0 : Math.PI / 2).rotateZ(a).translate(-0.02 + 0.04 * Math.sin(a), 0.045 * Math.cos(a), zz), 0x6a6c74, 0.25)));
    }
    const barG = mover(group, bar, eastX - 0.5, ly, c1.z);
    const lock = [box('metal', 0.07, 0.15, 0.17, 0, -0.1, 0, HUE.gilt, 0, 0.25), box('metal', 0.075, 0.03, 0.18, 0, -0.03, 0, BRASS, 0, 0.2), ball('metal', 0.016, -0.04, -0.11, 0, IRON, 1, 1.6, 1, 0, 6)];
    lock.push(part('metal', S.tint(new THREE.TorusGeometry(0.055, 0.014, 6, 12, Math.PI).rotateY(Math.PI / 2).translate(0, -0.02, 0), 0x8a8a84, 0.15)));
    const lockG = mover(group, lock, Math.min(c1.lock.x, eastX - 0.5) - 0.07, ly + 0.08, c1.lock.z);
    // 2: three nails through the hem into the boards
    const c2 = COUNT_ROOM.curtains[2];
    const nails = c2.nails.map((n) => mover(group, [
      part('metal', S.tint(new THREE.CylinderGeometry(0.014, 0.006, 0.2, 4).rotateZ(Math.PI / 2).translate(0.06, 0, 0), IRON, 0.2)),
      part('metal', S.tint(new THREE.CylinderGeometry(0.075, 0.075, 0.022, 4).rotateZ(Math.PI / 2).rotateX(Math.PI / 4), 0x8a8c94, 0.2)),
    ], Math.min(n.x, eastX - 0.42) - 0.02, y + n.y, n.z, 0, false));
    parts.push(box('polish', 0.1, 0.5, W + 0.5, eastX - 0.36, y + 0.25, c2.z, OAK, 0, 0.2)); // the skirting board the hem is nailed to
    bake(group, parts);
    const glints = dawnGlints(group, lockG, nails);

    function tick(sim, w, dt, time) {
      const c = w.count && Array.isArray(w.count.open) ? w.count : IDLE.count;
      for (const cu of curtains) {
        const goal = c.open[cu.i] ? 1 : 0;
        cu.open = cu.open == null || dt === 0 ? goal : toward(cu.open, goal, dt / 0.7);
        const k = smooth(cu.open);
        for (const h of cu.halves) h.scale.x = -Math.sign(h.position.x) * lerp(1, 0.17, k);
        cu.seam.visible = k < 0.05;
        cu.seam.scale.x = reduced ? 1 : 1 + 0.6 * Math.sin(time * 1.3 + cu.i * 2);
        cu.shaft.visible = k > 0.05;
      }
      M.shaft.opacity = 0.5 * Math.max(...curtains.map((cu) => smooth(cu.open)));
      // the cord: the tangle pays out as it is pulled
      const pulled = c.open[0] ? 1 : clamp((c.cord || 0) / (tune.cord || 4));
      tangleG.scale.setScalar(TANGLE * lerp(1, 0.25, pulled));
      tangleG.position.y = y + 1.27 - pulled * 0.5;
      cordLine.scale.y = lerp(1, 1.2, pulled);
      // the bar: down once the lock gives; the lock jumps at each blast
      const dmg = clamp((c.lock || 0) / (tune.lock || 120));
      barG.position.y = toward(barG.position.y, c.open[1] ? y + 0.06 : ly, dt * 6);
      barG.rotation.x = c.open[1] ? 0.12 : 0;
      lockG.visible = !c.open[1];
      lockG.rotation.z = dmg * 0.5;
      lockG.rotation.x = dmg * 0.3 * Math.sin(dmg * 9);
      nails.forEach((n, i) => { n.visible = !(c.nails && c.nails[i]) && !c.open[2]; });
      glints.tick(c, time);
      // Issue #20: in the triumph the dawn fills the room, the shafts brightening as the light comes up.
      const sc = w.scene && triumphStage(w.scene) ? w.scene : null;
      if (sc) M.shaft.opacity = Math.max(M.shaft.opacity, 0.5 + 0.35 * smooth(clamp(sc.t / 2.5)));
      // the lid: shut on him; then it lifts as he rises, and stays thrown back
      // thrown back it lies nearly flat beyond the east edge, below the rim's sight lines from anywhere in the room
      const LID_BACK = 2.9;
      let part2 = 0; let pose = 'box';
      try { if (sim && sim.cfg && w.count && w.game) ({ part: part2, pose } = poseOf(sim)); else if (c.phase === 'ash') pose = 'ash'; } catch { /* a state not yet whole */ }
      const goal = pose === 'box' ? 0 : pose === 'lid' ? 0.12 + part2 * 1.3 : pose === 'hand' ? 0.55 + (part2 - 0.25) * 2.2 : LID_BACK;
      lid.rotation.z = lid.userData.set && dt > 0 ? toward(lid.rotation.z, -goal, dt * 1.2) : -goal;
      lid.userData.set = true;
    }
    return { group, tick, free() { halfGeo.dispose(); glints.free(); } };
  }

  /**
   * Issue #8: the dawn catches the padlock and each hem nail still in, a small gold glint that
   * comes and goes, so the two side curtains' ways read from across the room. One draw call
   * (points); a glint goes with its lock or nail.
   */
  function dawnGlints(group, lockG, nails) {
    const at = [lockG, ...nails].map((o) => [o.position.x - 0.09, o.position.y + (o === lockG ? -0.08 : 0), o.position.z]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(at.flat(), 3));
    const mat = new THREE.PointsMaterial({ color: HUE.dawn, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, fog: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    group.add(pts);
    const pos = geo.attributes.position;
    const shown = at.map(() => true);
    return {
      tick(c, time) { // no allocation per frame
        const live = c.phase !== 'ash' && c.phase !== 'burning';
        let dirty = false;
        let any = false;
        for (let k = 0; k < at.length; k++) {
          const on = live && (k === 0 ? !c.open[1] : !c.open[2] && !(c.nails && c.nails[k - 1]));
          any = any || on;
          if (on === shown[k]) continue;
          shown[k] = on;
          pos.setXYZ(k, at[k][0], on ? at[k][1] : -100, at[k][2]);
          dirty = true;
        }
        if (dirty) pos.needsUpdate = true;
        pts.visible = any;
        mat.size = reduced ? 0.08 : 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(time * 2.3));
      },
      free() { geo.dispose(); mat.dispose(); },
    };
  }

  // ---- issue #8: the passage to the Count's door, and the card tacked up in it --------------------

  function buildCountway() {
    const group = new THREE.Group();
    const n = COUNTWAY.note;
    const text = READS.curtainNote || (ENTRIES.curtainNote && ENTRIES.curtainNote.text) || '';
    const map = noteTexture(text);
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0 });
    const card = new THREE.Mesh(moved(face(0.44, 0.33), n.x + 0.02, UPPER + n.y, n.z, Math.PI / 2), mat);
    group.add(card);
    bake(group, [box('metal', 0.02, 0.025, 0.025, n.x + 0.03, UPPER + n.y + 0.14, n.z, IRON, 0, 0.2)]); // the tack
    return { group, free() { map.dispose(); mat.dispose(); } };
  }

  // ---- zones: built in range, freed out of it ---------------------------------------------------

  const IDLE = { tiles: { gone: new Array(TILE_COUNT).fill(false) }, clocks: createClocks((cfg.clocks && cfg.clocks.stopped) || CLOCK_RULES.stopped), count: createCount(null), haunts: null, stock: null, loot: null, hints: null };
  const BUILDERS = { hall: buildHall, tea: buildTea, gallery: buildGallery, walk: buildWalk, mirror: buildMirrorRoom, nursery: buildNursery, count: buildCount,
    countway: buildCountway }; // countway: issue #8's card
  const built = new Map(); // zone id -> { group, tick, event, free, report }
  let zoneNow = 'approach';
  let only = null;
  let castleRoot = null;
  let lastW = IDLE;
  let eyeCam = null;

  function load(id) {
    if (built.has(id) || !BUILDERS[id]) return;
    const set = BUILDERS[id]();
    set.group.name = `keepprops:${id}`;
    root.add(set.group);
    built.set(id, set);
  }
  function unload(id) {
    const set = built.get(id);
    if (!set) return;
    root.remove(set.group);
    const seen = new Set();
    set.group.traverse((o) => { if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } if (o.isInstancedMesh) o.dispose(); });
    if (set.free) set.free();
    built.delete(id);
  }
  const IDS = Object.keys(BUILDERS);
  // Without the shell's word: each zone's own range, worked out once (the zone and the zones through its doors).
  const IN_RANGE = new Map([...RANGE].map(([zone, set]) => [zone, IDS.filter((id) => set.has(id))]));
  const NONE = [];
  let shell = null; // castle.js's handle, when mirror.js has passed it on: sees(id) says which zones are on screen

  /** True when zone id's things should be built and drawn now. */
  function wanted(id) {
    if (shell && typeof shell.sees === 'function') return !!shell.sees(id);
    return (IN_RANGE.get(zoneNow) || NONE).includes(id);
  }

  function sync(sim, dt, time, eye) {
    if (!castleRoot || !castleRoot.parent) castleRoot = scene.getObjectByName('castle') || null;
    if (shell && shell.group && !shell.group.parent) shell = null; // the castle was dropped; the next one is passed on again
    if (!eyeCam) { // the eye sees layer 1 (the false tiles, the runner) whether or not the glass is there
      eyeCam = scene.children.find((o) => o.isCamera) || null;
      if (eyeCam) eyeCam.layers.enable(LAYER_EYE);
    }
    const inRun = !!(sim && sim.cfg && sim.cfg.room === 'castle' && sim.waves);
    root.visible = castleRoot ? castleRoot.visible : inRun;
    if (!root.visible) {
      if (built.size) for (const id of IDS) unload(id); // the castle is not the room on screen: nothing is kept
      return;
    }
    const w = inRun ? sim.waves : IDLE;
    lastW = w;
    const inScene = inRun && w.scene;
    const px = inRun && !inScene ? sim.player.x : eye ? eye.x : 0;
    const pz = inRun && !inScene ? sim.player.z : eye ? eye.z : 40;
    const z = zoneAt(px, pz);
    if (z) zoneNow = z;
    for (const id of IDS) { if (wanted(id)) load(id); else unload(id); }
    for (const [id, set] of built) {
      set.group.visible = !only || id === only;
      if (set.tick) set.tick(inRun ? sim : null, w, dt, time);
    }
  }

  function onEvent(ev) {
    if (!ev) return;
    if (ev.type === 'tileBreak' || ev.type === 'tileShot' || ev.type === 'restored') {
      const g = built.get('gallery');
      if (g) g.event(ev, lastW);
    }
  }

  function clear() {
    for (const id of IDS) unload(id);
    lastW = IDLE;
  }

  function dispose() {
    clear();
    for (const m of shared) m.dispose();
    glow.dispose();
    scene.remove(root);
  }

  const api = {
    sync, onEvent, clear, dispose,
    setReducedFlash(v) { reduced = !!v; },
    /** For the mirror pass: show one zone's things alone (by id), or null to put them back. */
    showOnly(id) {
      only = id || null;
      for (const [zid, set] of built) set.group.visible = !only || zid === only;
    },
    /** The shell (castle.js's handle): its sees(id) then decides which zones' things are built and drawn. mirror.js passes it on. */
    setShell(s) { shell = s || null; },
    /** The shipped forest creature's builder for the figure-mirror: (kind, cfg) -> { g, dispose }. */
    setCreature(fn) {
      creature = typeof fn === 'function' ? fn : null;
      creatureFailed = false;
      const m = built.get('mirror');
      if (m && m.refoe) m.refoe(); // a stand-in already on show gives way at once
    },
    /** The figure-mirror's creature as the meshes hold it (see buildMirrorRoom's figure), or null. */
    figure() { const m = built.get('mirror'); return m && m.figure ? m.figure() : null; },
    /** The gallery floor as the meshes hold it: { glass, eyeOnly, eye, runner, grin }, or null when it is not built. */
    report() { const g = built.get('gallery'); return g ? g.report() : null; },
    /** Draw calls and triangles of each built zone's things. */
    counts() {
      const out = {};
      for (const [id, set] of built) {
        let calls = 0; let tris = 0;
        set.group.traverse((m) => {
          if (!(m.isMesh || m.isPoints) || !m.visible) return;
          if (m.isInstancedMesh && m.count === 0) return;
          calls += 1;
          const g = m.geometry;
          if (m.isMesh) tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (m.isInstancedMesh ? m.count : 1);
        });
        out[id] = { calls, triangles: Math.round(tris) };
      }
      return out;
    },
    get zone() { return zoneNow; },
    group: root,
  };
  root.userData.keepprops = api;
  return api;
}
