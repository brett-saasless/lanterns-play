// The walk from the Caterpillar's gate to the road (logic/tunnelwalk.js), dressed with the owner's
// approved sample (scratchpad hatter-wood-sample.html, "The Hatter's Wood (band 2)"): its bark,
// leaf-spray and rock textures, its sculpted fluted trunks and sinuous limbs, its crossed-arch
// foliage cards, its fractal oak, maple and pine blueprints, its multi-stemmed bushes, its faceted
// mossy boulders, its fine tapered grass, its species wind and its greying to the wood's evening
// light, ported here with the same numbers (Math.random replaced by a seeded generator). Only the
// walk uses this code: the wood and the road keep their own.
//
// Along the walk the wood turns into the road (blendAt): the leaves thin and dry and the green
// goes out of them, bare dead trees take over, the bushes and the grass thin and dry, and the light,
// the fog and the sky go from the wood's at the gate (court.js woodGateLight) to the road foot's
// (roadlight.js, which roadview.js has just set). In the last stretch (openAt) the trees stand back,
// so the road's own first view fills the way ahead. The Tweedles lie dead halfway (tweedles.js).
//
// Cost (logic/tunnelwalk.js TIERS): every kind is ONE instanced mesh for the whole walk (trunks,
// limbs, leaf cards from one 512 px atlas, bush stems, boulders, grass), plus one static mesh (the
// ground, the gate behind the start and the Tweedles), and the far trees' two (below): 8 draw calls
// on the phone tier, 11 on the desktop's. Nothing casts a shadow, nothing is transparent (alpha-tested cards), no light is added.
// Only the chunks near the eye are alive (windowAt): their instances are expanded a few at a time,
// inside a few milliseconds a frame, into a fixed pool of buffers made at build, and written
// together into the meshes when the window moves, so memory stays flat and no frame allocates.
//
// The trees (the owner, 2026-11-19: "the trees in the tunnel should still be drawn, even if the user
// isn't close to them"): every tree of the walk is drawn from anywhere, at every distance. Near the
// eye (logic/treelod.js planLod: a band round it in every direction, and always the two nearest in
// view) it is the full sculpted tree, expanded into a pool of tree slots of its own; everywhere else
// it is the maze's simple tree (mazetrees.js: the cone tree for a leafy one, the bare tree for a bare
// one), standing where it stands, as tall and as wide as its crown and in its colour: two more
// instanced meshes, every tree in one or the other. A few trees a frame are filled in, nearest first.
// Nothing of the walk fades out with distance any more; past HIDE metres off the walk only the
// bushes, boulders and grass are left out (a few pixels in the haze by then).

import * as THREE from 'three';
import * as S from './sculpt.js';
import {
  TUNNEL, placements, CHUNK, CHUNKS, chunkOf, windowAt, maxAlive, placeAt, pointAt, nearest, blendAt, TWEEDLES, tunnelTier,
} from '../logic/tunnelwalk.js';
import { buildTweedles } from './tweedles.js';
import { mats } from './court.js';
import { victorianTree, hauntedTree } from './mazetrees.js';
import { TREE_LOD, lodState, planLod } from '../logic/treelod.js';

let TIER = null;
/**
 * This device's tier, chosen once (logic/tunnelwalk.js tunnelTier): the same test touchui.js uses
 * to start in touch mode (a coarse pointer), or a small screen. The browser smoke may set
 * window.__smokeTunnelTier ('phone' | 'desktop') before the page loads to see the other tier.
 */
export function deviceTier() {
  if (TIER) return TIER;
  let coarse = false; let minSide = Infinity; let override = null;
  try { coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; } catch { coarse = false; }
  try { minSide = Math.min(screen.width, screen.height); } catch { minSide = Infinity; }
  try { override = globalThis.__smokeTunnelTier || null; } catch { override = null; }
  TIER = tunnelTier({ coarse, minSide, override });
  return TIER;
}

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
/** A second, independent 0..1 from a placement's tone (its own number: nothing drawn from a generator). */
const hashOf = (t, k) => { const v = Math.sin(t * k + 1.7) * 43758.5453; return v - Math.floor(v); };
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const S_MIN = -TUNNEL.back;
const PATH_HALF = TUNNEL.half + 0.15;
// (PATH_HALF: the sample's: the open width below the canopy)
// Past HIDE metres off the walk its bushes, boulders and grass are not drawn (up the road they are a
// few pixels in the haze or behind the hill by then); its trees and its ground always are.
const HIDE = 110;
// The far trees' colour against their full trees' (the cone is solid where the crown is open cards
// and sky): set on the stills so the swap at the band's edge is not a jump in tone.
const FAR_TONE = 0.7;
// The approved sample's light (hatter-wood-sample.html: FogExp2 0xc8d0d8 0.017, hemisphere 0xc8d0d8 over
// 0x6a6860 at 1.05, sun 0xe8e6e0), which the walk's first third leans toward (SAMPLE_K at the gate) with
// its exposure SAMPLE_EXPOSURE higher, before it turns to the road's.
const SAMPLE_LIGHT = {
  fog: new THREE.Color(0xc8d0d8), hemi: new THREE.Color(0xc8d0d8), ground: new THREE.Color(0x6a6860), sun: new THREE.Color(0xe8e6e0),
  hemiI: 1.05, fogD: 0.017,
};
const SAMPLE_K = 0.8;
const SAMPLE_EXPOSURE = 0.45;

// ---- 1. the sample's textures (section 3), drawn with a seeded generator -------------------------

// The sample (three r160) never set a colour space on its canvas textures, so they were sampled as
// linear data (NoColorSpace): lighter and flatter than the same canvas decoded as sRGB. That is the
// look the owner approved, so the walk keeps it, on purpose and said so here (the wood's own textures,
// court.js and forest.js, are sRGB). Decoding these as sRGB would darken every albedo texel (mid
// grey 0.5 reads as 0.21): see the CHANGELOG; the art pass may revisit it.
const SAMPLE_SPACE = THREE.NoColorSpace;

function barkSet(rand, baseHex, darkHex, lightHex, furrowScale, hasLenticels, maps) {
  const size = 256;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const albedo = mk(); const bump = maps ? mk() : null; const rough = maps ? mk() : null;
  const a = albedo.getContext('2d');
  const b = bump ? bump.getContext('2d') : null; const r = rough ? rough.getContext('2d') : null;
  a.fillStyle = baseHex; a.fillRect(0, 0, size, size);
  if (b) { b.fillStyle = '#808080'; b.fillRect(0, 0, size, size); r.fillStyle = '#dcdcdc'; r.fillRect(0, 0, size, size); }
  for (let i = 0; i < 2400; i++) {
    const deep = rand() > 0.52;
    a.fillStyle = deep ? darkHex : lightHex;
    const x = rand() * size; const y = rand() * size;
    const w = (1.5 + rand() * 4.5) * furrowScale; const h = (28 + rand() * 115) * furrowScale;
    const tilt = (rand() - 0.5) * 0.14;
    a.save(); a.translate(x, y); a.rotate(tilt); a.fillRect(-w * 0.5, -h * 0.5, w, h); a.restore();
    if (b) {
      b.fillStyle = deep ? 'rgba(26, 26, 26, 0.55)' : 'rgba(225, 225, 225, 0.45)';
      r.fillStyle = deep ? 'rgba(252, 252, 252, 0.5)' : 'rgba(175, 175, 175, 0.4)';
      b.save(); b.translate(x, y); b.rotate(tilt); b.fillRect(-w * 0.5, -h * 0.5, w, h); b.restore();
      r.fillRect(x - w * 0.5, y - h * 0.5, w, h);
    }
  }
  for (let k = 0; k < 160; k++) {
    let fx = rand() * size; let fy = rand() * size;
    const segs = 7 + Math.floor(rand() * 8);
    const lw = (1.2 + rand() * 2.4) * furrowScale;
    const ctxs = b ? [a, b, r] : [a];
    a.strokeStyle = darkHex;
    if (b) { b.strokeStyle = 'rgba(12, 12, 12, 0.82)'; r.strokeStyle = 'rgba(255, 255, 255, 0.7)'; }
    for (const c of ctxs) { c.lineWidth = lw; c.beginPath(); c.moveTo(fx, fy); }
    for (let s = 0; s < segs; s++) {
      fx += (rand() - 0.5) * 9 * furrowScale;
      fy += (12 + rand() * 18) * furrowScale;
      for (const c of ctxs) c.lineTo(fx, fy);
    }
    for (const c of ctxs) c.stroke();
  }
  if (hasLenticels) {
    for (let l = 0; l < 420; l++) {
      const lx = rand() * size; const ly = rand() * size; const lw = 6 + rand() * 18; const lh = 1.2 + rand() * 1.8;
      a.fillStyle = 'rgba(32, 26, 22, 0.58)'; a.fillRect(lx, ly, lw, lh);
      if (b) { b.fillStyle = 'rgba(45, 45, 45, 0.65)'; b.fillRect(lx, ly, lw, lh); }
    }
  }
  for (let m = 0; m < 75; m++) {
    const mx = rand() * size; const my = rand() * size; const mr = 3 + rand() * 9;
    a.fillStyle = rand() > 0.35 ? 'rgba(104, 124, 82, 0.34)' : 'rgba(156, 148, 124, 0.28)';
    a.beginPath(); a.arc(mx, my, mr, 0, TAU); a.fill();
    if (b) { b.fillStyle = 'rgba(175, 175, 175, 0.3)'; b.beginPath(); b.arc(mx, my, mr, 0, TAU); b.fill(); }
  }
  const out = [albedo, bump, rough].map((c) => {
    if (!c) return null;
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 3); t.anisotropy = 8;
    t.colorSpace = SAMPLE_SPACE;
    return t;
  });
  return { albedoMap: out[0], bumpMap: out[1], roughnessMap: out[2] };
}

// The four leaf sprays, each as the sample drew it (a 512-unit design on a 256 px canvas, so each
// shows its upper-left quarter, as approved), side by side in one 512 px atlas: oak, maple, pine, bush.
function drawOak(ctx) {
  ctx.strokeStyle = '#4e3c28'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(256, 495); ctx.quadraticCurveTo(250, 280, 256, 85); ctx.stroke();
  const leaf = (cx, cy, scale, angle, toneShift) => {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle); ctx.scale(scale, scale);
    ctx.strokeStyle = '#5a4a2d'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(0, -10); ctx.stroke();
    const grad = ctx.createLinearGradient(0, 0, 0, -155);
    grad.addColorStop(0, toneShift > 0 ? '#69853b' : '#567532');
    grad.addColorStop(0.6, toneShift > 0 ? '#7fa046' : '#6b8e3d');
    grad.addColorStop(1, '#94b554');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(0, -8);
    ctx.bezierCurveTo(18, -14, 34, -26, 28, -40); ctx.bezierCurveTo(22, -50, 12, -48, 16, -58);
    ctx.bezierCurveTo(24, -68, 48, -78, 42, -96); ctx.bezierCurveTo(36, -110, 18, -106, 20, -118);
    ctx.bezierCurveTo(24, -128, 36, -138, 22, -150); ctx.bezierCurveTo(10, -162, -10, -162, -22, -150);
    ctx.bezierCurveTo(-36, -138, -24, -128, -20, -118); ctx.bezierCurveTo(-18, -106, -36, -110, -42, -96);
    ctx.bezierCurveTo(-48, -78, -24, -68, -16, -58); ctx.bezierCurveTo(-12, -48, -22, -50, -28, -40);
    ctx.bezierCurveTo(-34, -26, -18, -14, 0, -8);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(42, 62, 22, 0.45)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(175, 198, 110, 0.55)'; ctx.lineWidth = 2.2; ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(0, -148);
    ctx.moveTo(0, -34); ctx.lineTo(24, -40); ctx.moveTo(0, -76); ctx.lineTo(36, -92); ctx.moveTo(0, -122); ctx.lineTo(20, -142);
    ctx.moveTo(0, -34); ctx.lineTo(-24, -40); ctx.moveTo(0, -76); ctx.lineTo(-36, -92); ctx.moveTo(0, -122); ctx.lineTo(-20, -142);
    ctx.stroke(); ctx.restore();
  };
  [[256, 420, 0.92, -0.78, 0], [256, 415, 0.92, 0.76, 1], [254, 330, 1.05, -0.62, 1], [258, 325, 1.05, 0.64, 0],
    [255, 240, 1.08, -0.45, 0], [257, 235, 1.08, 0.48, 1], [256, 165, 0.96, -0.22, 1], [256, 150, 1.02, 0.14, 0]].forEach((l) => leaf(...l));
}
function drawMaple(ctx) {
  ctx.strokeStyle = '#6b3e2e'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(256, 495); ctx.lineTo(256, 95); ctx.stroke();
  const leaf = (cx, cy, scale, angle, bright) => {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle); ctx.scale(scale, scale);
    ctx.strokeStyle = '#8b4a32'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(0, 16); ctx.lineTo(0, -18); ctx.stroke();
    const grad = ctx.createRadialGradient(0, -78, 8, 0, -78, 88);
    grad.addColorStop(0, bright ? '#a3b852' : '#859e40'); grad.addColorStop(0.7, bright ? '#8da642' : '#708a34'); grad.addColorStop(1, '#68802e');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(0, -18);
    for (const [x, y] of [[24, -14], [44, -26], [34, -40], [68, -56], [54, -68], [64, -80], [30, -82], [36, -112], [20, -118], [0, -152],
      [-20, -118], [-36, -112], [-30, -82], [-64, -80], [-54, -68], [-68, -56], [-34, -40], [-44, -26], [-24, -14]]) ctx.lineTo(x, y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(55, 68, 22, 0.45)'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.strokeStyle = 'rgba(210, 215, 135, 0.55)'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(0, -18); ctx.lineTo(0, -144); ctx.moveTo(0, -24); ctx.lineTo(60, -76); ctx.moveTo(0, -24); ctx.lineTo(-60, -76);
    ctx.moveTo(0, -20); ctx.lineTo(38, -26); ctx.moveTo(0, -20); ctx.lineTo(-38, -26);
    ctx.stroke(); ctx.restore();
  };
  [[256, 415, 0.90, -0.82, false], [256, 415, 0.90, 0.82, true], [256, 315, 1.05, -0.68, true], [256, 315, 1.05, 0.68, false],
    [256, 215, 1.02, -0.52, false], [256, 215, 1.02, 0.52, true], [256, 145, 0.98, 0.04, true]].forEach((p) => leaf(...p));
}
function drawPine(ctx, rand) {
  const shoots = [{ x0: 256, y0: 495, x1: 256, y1: 55 }, { x0: 256, y0: 360, x1: 115, y1: 215 }, { x0: 256, y0: 345, x1: 398, y1: 205 },
    { x0: 256, y0: 245, x1: 135, y1: 115 }, { x0: 256, y0: 235, x1: 378, y1: 110 }];
  ctx.strokeStyle = '#4e3524'; ctx.lineCap = 'round';
  shoots.forEach((s, idx) => {
    ctx.strokeStyle = '#4e3524';
    ctx.lineWidth = idx === 0 ? 7 : 4.5;
    ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); ctx.stroke();
    const steps = idx === 0 ? 58 : 34;
    const base = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = lerp(s.x0, s.x1, t); const py = lerp(s.y0, s.y1, t);
      for (const side of [-1, 1]) {
        for (let n = 0; n < 3; n++) {
          const ang = base + (0.35 + rand() * 0.62) * side;
          const len = (42 + rand() * 34) * (1.0 - t * 0.28);
          const shade = rand();
          ctx.strokeStyle = shade < 0.35 ? '#1d3c23' : shade < 0.78 ? '#2b5231' : '#3f6e3e';
          ctx.lineWidth = 2.4;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len); ctx.stroke();
        }
      }
    }
  });
}
function drawShrub(ctx, rand) {
  ctx.strokeStyle = '#4e3b28'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(256, 495); ctx.quadraticCurveTo(252, 320, 256, 90); ctx.moveTo(255, 360); ctx.quadraticCurveTo(185, 290, 135, 215);
  ctx.moveTo(256, 330); ctx.quadraticCurveTo(325, 260, 378, 190); ctx.stroke();
  const leaf = (cx, cy, scale, angle, tint) => {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle); ctx.scale(scale, scale);
    const grad = ctx.createLinearGradient(0, 0, 0, -110);
    grad.addColorStop(0, tint ? '#486b2c' : '#3d5e24'); grad.addColorStop(0.65, tint ? '#658c3c' : '#547831'); grad.addColorStop(1, '#7ea34a');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(0, 0);
    for (const [x, y] of [[24, -18], [20, -24], [34, -42], [28, -48], [32, -68], [24, -74], [18, -92], [0, -112],
      [-18, -92], [-24, -74], [-32, -68], [-28, -48], [-34, -42], [-20, -24], [-24, -18]]) ctx.lineTo(x, y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(170, 198, 108, 0.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -104); ctx.stroke();
    ctx.restore();
  };
  [[256, 430, 0.85, -0.85, false], [256, 425, 0.85, 0.85, true], [195, 290, 0.82, -1.05, true], [160, 245, 0.78, -0.55, false],
    [135, 215, 0.75, -0.25, true], [315, 265, 0.82, 1.02, false], [352, 222, 0.78, 0.52, true], [378, 190, 0.75, 0.22, false],
    [255, 285, 0.92, -0.62, true], [257, 275, 0.92, 0.64, false], [255, 195, 0.88, -0.45, false], [257, 185, 0.88, 0.48, true],
    [256, 115, 0.84, 0.04, true]].forEach((lp) => leaf(...lp));
  for (const [bx, by] of [[235, 315], [278, 240], [210, 265]]) {
    for (let k = 0; k < 4; k++) {
      const ox = bx + (rand() - 0.5) * 18; const oy = by + (rand() - 0.5) * 18;
      ctx.fillStyle = '#9e2622'; ctx.beginPath(); ctx.arc(ox, oy, 5.5, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,210,200,0.65)'; ctx.beginPath(); ctx.arc(ox - 1.8, oy - 1.8, 1.8, 0, TAU); ctx.fill();
    }
  }
}
/** The atlas tile of each spray: [u, v] offsets of its quarter (v up, as the texture is flipped). */
const TILE = { oak: [0, 0.5], maple: [0.5, 0.5], pine: [0, 0], shrub: [0.5, 0] };
function leafAtlas(rand) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 512);
  const at = [[0, 0, drawOak], [256, 0, drawMaple], [0, 256, drawPine], [256, 256, drawShrub]];
  for (const [ox, oy, draw] of at) {
    ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, 256, 256); ctx.clip(); ctx.translate(ox, oy);
    draw(ctx, rand);
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = SAMPLE_SPACE;
  return t;
}
function rockSet(rand, maps) {
  const size = 256;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const albedo = mk(); const bump = maps ? mk() : null; const rough = maps ? mk() : null;
  const a = albedo.getContext('2d'); const b = bump && bump.getContext('2d'); const r = rough && rough.getContext('2d');
  a.fillStyle = '#73706a'; a.fillRect(0, 0, size, size);
  if (b) { b.fillStyle = '#808080'; b.fillRect(0, 0, size, size); r.fillStyle = '#d4d4d4'; r.fillRect(0, 0, size, size); }
  for (let i = 0; i < 9500; i++) {
    const x = rand() * size; const y = rand() * size; const rr = 1 + rand() * 3.5; const tone = rand();
    const [ca, cb, cr] = tone < 0.35 ? ['rgba(42, 40, 38, 0.55)', 'rgba(45, 45, 45, 0.45)', 'rgba(245, 245, 245, 0.4)']
      : tone < 0.75 ? ['rgba(138, 134, 126, 0.48)', 'rgba(205, 205, 205, 0.42)', 'rgba(185, 185, 185, 0.4)']
        : ['rgba(176, 170, 158, 0.42)', 'rgba(235, 235, 235, 0.38)', 'rgba(145, 145, 145, 0.35)'];
    a.fillStyle = ca; a.fillRect(x, y, rr, rr);
    if (b) { b.fillStyle = cb; b.fillRect(x, y, rr, rr); r.fillStyle = cr; r.fillRect(x, y, rr, rr); }
  }
  for (let k = 0; k < 65; k++) {
    let cx = rand() * size; let cy = rand() * size;
    a.strokeStyle = 'rgba(30, 28, 26, 0.65)'; a.lineWidth = 1.2 + rand() * 2.2;
    const bw = 2.0 + rand() * 2.5;
    if (b) { b.strokeStyle = 'rgba(18, 18, 18, 0.85)'; b.lineWidth = bw; b.beginPath(); b.moveTo(cx, cy); }
    a.beginPath(); a.moveTo(cx, cy);
    const segs = 5 + Math.floor(rand() * 6);
    for (let s = 0; s < segs; s++) {
      cx += (rand() - 0.5) * 44; cy += (rand() - 0.5) * 44;
      a.lineTo(cx, cy); if (b) b.lineTo(cx, cy);
    }
    a.stroke(); if (b) b.stroke();
  }
  for (let l = 0; l < 110; l++) {
    const lx = rand() * size; const ly = rand() * size; const lr = 4 + rand() * 14;
    a.fillStyle = rand() > 0.4 ? 'rgba(128, 142, 108, 0.38)' : 'rgba(158, 146, 104, 0.32)';
    a.beginPath(); a.arc(lx, ly, lr, 0, TAU); a.fill();
    if (b) { b.fillStyle = 'rgba(170, 170, 170, 0.35)'; b.beginPath(); b.arc(lx, ly, lr, 0, TAU); b.fill(); }
  }
  const out = [albedo, bump, rough].map((c) => {
    if (!c) return null;
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); t.anisotropy = 8;
    t.colorSpace = SAMPLE_SPACE;
    return t;
  });
  return { albedoMap: out[0], bumpMap: out[1], roughnessMap: out[2] };
}

// ---- 2. the sample's geometries (section 4), at the tier's detail -------------------------------

function sculptedWood({ radialSegs = 12, heightSegs = 8, topRadius = 0.62, bottomRadius = 1.0, rootFlare = 0.0, fluteCount = 5, bendAmt = 0.06, barkRidgeAmt = 0.055, seed = 1.0 }) {
  const geo = new THREE.CylinderGeometry(topRadius, bottomRadius, 1.0, radialSegs, heightSegs, false);
  geo.translate(0, 0.5, 0);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const moss = new THREE.Color().setHSL(0.25, 0.48, 0.28);
  const phaseA = seed * 3.17; const phaseB = seed * 5.41;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i); const y = pos.getY(i); let z = pos.getZ(i);
    const theta = Math.atan2(z, x);
    const flareEnv = Math.pow(Math.max(0, 1.0 - y * 2.4), 2.2);
    const fluteWave = 0.55 + 0.45 * Math.cos(theta * fluteCount + Math.sin(y * 5.0 + phaseA) * 0.7);
    const buttressScale = 1.0 + rootFlare * flareEnv * fluteWave;
    const twistTheta = theta + y * 0.65;
    const ridge = Math.sin(twistTheta * 7.0 + phaseA) * 0.55 + Math.cos(twistTheta * 13.0 - y * 6.0 + phaseB) * 0.45;
    const knot = Math.sin(y * 9.0 + phaseB) * Math.cos(theta * 3.0 + phaseA);
    const radialMod = buttressScale * (1.0 + barkRidgeAmt * ridge + barkRidgeAmt * 0.45 * knot);
    x *= radialMod; z *= radialMod;
    const archEnv = Math.sin(y * Math.PI);
    x += (Math.sin(y * Math.PI * 1.15 + phaseA) - Math.sin(phaseA) * (1.0 - y)) * bendAmt * (0.35 + 0.65 * archEnv);
    z += (Math.cos(y * Math.PI * 1.05 + phaseB) - Math.cos(phaseB) * (1.0 - y)) * bendAmt * 0.85 * (0.35 + 0.65 * archEnv);
    pos.setXYZ(i, x, y, z);
    const baseMoss = Math.pow(Math.max(0, 1.0 - y * 2.8), 1.8) * 0.42;
    const ao = clamp(0.88 + ridge * 0.14, 0.68, 1.12);
    col.setRGB(ao, ao * 0.99, ao * 0.96);
    if (baseMoss > 0.02) col.lerp(moss, baseMoss);
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function foliageCard(segs) {
  const angles = [0, Math.PI / 3, -Math.PI / 3];
  const tilts = [0.18, -0.22, 0.24];
  const parts = angles.map((rotY, idx) => {
    const card = new THREE.PlaneGeometry(1.0, 1.0, segs, segs);
    card.translate(0, 0.45, 0);
    const p = card.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i); const x = p.getX(i);
      p.setZ(i, p.getZ(i) - Math.pow(Math.max(0, y), 1.6) * 0.16 - Math.abs(x) * 0.08);
    }
    card.rotateX(tilts[idx]); card.rotateY(rotY);
    card.computeVertexNormals();
    return card;
  });
  const merged = new THREE.BufferGeometry();
  const pos = []; const nor = []; const uv = []; const idx = [];
  let off = 0;
  for (const c of parts) {
    const P = c.attributes.position; const Nn = c.attributes.normal; const U = c.attributes.uv;
    for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i)); uv.push(U.getX(i), U.getY(i)); }
    for (let i = 0; i < c.index.count; i++) idx.push(c.index.getX(i) + off);
    off += P.count;
    c.dispose();
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  merged.setIndex(idx);
  return merged;
}

function boulderGeo(seed, detail) {
  const geo = new THREE.IcosahedronGeometry(1.0, detail);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3(); const dir = new THREE.Vector3(); const col = new THREE.Color(); const mossCol = new THREE.Color();
  const planes = [];
  for (let p = 0; p < 7; p++) {
    const a1 = seed * 1.7 + p * 2.39996; const a2 = Math.sin(seed * 3.1 + p * 1.9) * 0.85;
    planes.push({ normal: new THREE.Vector3(Math.cos(a1) * Math.cos(a2), Math.sin(a2), Math.sin(a1) * Math.cos(a2)).normalize(), dist: 0.72 + (Math.sin(seed + p * 4.1) * 0.5 + 0.5) * 0.24 });
  }
  const hn = (x, y, z) => Math.sin(x * 3.1 + seed) * Math.cos(y * 2.9 - seed * 0.7) * Math.sin(z * 3.3 + seed * 1.3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    dir.copy(v).normalize();
    let radius = 1.0 + hn(dir.x * 1.4, dir.y * 1.4, dir.z * 1.4) * 0.24 + hn(dir.x * 3.2 + 4.1, dir.y * 3.2, dir.z * 3.2 - 2.3) * 0.11
      + Math.abs(hn(dir.x * 6.5, dir.y * 6.5, dir.z * 6.5)) * -0.06;
    for (const pl of planes) { const proj = dir.dot(pl.normal) * radius; if (proj > pl.dist) radius *= pl.dist / proj; }
    v.copy(dir).multiplyScalar(radius);
    v.y *= 0.76;
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.35;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const norm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i); const ny = norm.getY(i);
    const mossNoise = Math.sin(pos.getX(i) * 4.5 + seed) * Math.cos(pos.getZ(i) * 4.5 - seed) * 0.5 + 0.5;
    const mossAmount = clamp((ny - 0.32) * 1.45 * (0.55 + mossNoise * 0.65), 0, 0.85);
    const base = clamp(0.72 + (py + 0.4) * 0.35, 0.55, 1.05);
    col.setRGB(base, base * 0.99, base * 0.96);
    if (mossAmount > 0.05) col.lerp(mossCol.setHSL(0.24 + mossNoise * 0.04, 0.52, 0.25 + mossNoise * 0.08), mossAmount);
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function grassGeo(segments) {
  const baseWidth = 0.048; const height = 0.95;
  const positions = []; const colors = []; const indices = [];
  const root = new THREE.Color(0x284718); const tip = new THREE.Color(0x88b844); const c = new THREE.Color();
  for (let s = 0; s <= segments; s++) {
    const t = s / segments; const y = t * height;
    const w = baseWidth * Math.pow(1.0 - t, 1.35) * 0.5;
    const zc = Math.pow(t, 2.1) * 0.22;
    c.copy(root).lerp(tip, t);
    positions.push(-w, y, zc, w, y, zc);
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    if (s < segments) { const row = s * 2; indices.push(row, row + 1, row + 2, row + 1, row + 3, row + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ---- 3. the sample's wind (section 5): one shared clock; each instance's sway from its species ----

const WIND = { uTime: { value: 0 }, uWind: { value: 0.15 }, uBase: { value: TUNNEL.floor } };
// (the far fade, a dither on every material from 60 to 110 m off the walk, is gone: the trees are
// always drawn, the far ones as the maze's, and only the small dressing is left out past HIDE)
// The road's land lift (roadview.js groundLift, barkLift: an extra light on the land and the dead wood
// alone, already scaled down by the wood's share of the light where the eye is): the walk takes the
// same, so its last stretch is lit as the road it turns into. 'ground' on the ground and the grass,
// 'bark' on the trees, the bushes and the boulders. Zero in the wood's level (the court's frame).
const LIFT = { ground: { value: new THREE.Color(0, 0, 0) }, bark: { value: new THREE.Color(0, 0, 0) } };
/**
 * The land's lift (`lift`: 'ground' | 'bark') on any of the walk's materials. frag(shader): more of
 * the fragment shader (the static mesh's).
 */
function fadeOn(material, key, vertex = null, lift = null, frag = null) {
  material.onBeforeCompile = (shader) => {
    if (vertex) vertex(shader);
    let fs = shader.fragmentShader;
    if (lift) {
      shader.uniforms.uLift = LIFT[lift];
      fs = `uniform vec3 uLift;\n${fs}`.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * uLift;');
    }
    shader.fragmentShader = fs;
    if (frag) frag(shader);
  };
  material.customProgramCacheKey = () => key;
  return material;
}
// aSway (per instance): the species' share of the sample's broad sway (oak and maple 1, pine 0.45,
// bush stems 0.25, bare dead wood 0.8); the leaf cards' and the grass's own flutter is as the sample's.
function windOn(material, mode) {
  return fadeOn(material, `tunnel-wind-${mode}`, (shader) => {
    shader.uniforms.uTime = WIND.uTime;
    shader.uniforms.uWind = WIND.uWind;
    shader.uniforms.uBase = WIND.uBase;
    const leaf = mode === 'leaf';
    shader.vertexShader = `uniform float uTime;\nuniform float uWind;\nuniform float uBase;\n${mode === 'grass' ? '' : 'attribute float aSway;\n'}${leaf ? 'attribute vec2 aTile;\n' : ''}${shader.vertexShader}`
      .replace('#include <uv_vertex>', leaf ? '#include <uv_vertex>\n  vMapUv = vMapUv * 0.5 + aTile;' : '#include <uv_vertex>')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 windRest = transformed;
        vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        wp.y -= uBase;
        float phase = wp.x * 0.18 + wp.z * 0.14;
        float gust = sin(uTime * 0.85 + phase) * 0.65 + sin(uTime * 1.9 + phase * 1.7) * 0.35;
        ${mode === 'wood' ? `
          float hFactor = clamp(wp.y * 0.045, 0.0, 1.2) * aSway;
          transformed.x += gust * 0.22 * hFactor * position.y;
          transformed.z += cos(uTime * 0.78 + phase) * 0.18 * hFactor * position.y;` : ''}
        ${leaf ? `
          float hFactor = clamp(wp.y * 0.05, 0.1, 1.3) * aSway;
          float flutter = sin(uTime * 6.2 + wp.x * 3.1 + wp.y * 2.7 + position.x * 8.0) * 0.065;
          float tipMask = clamp(position.y + 0.15, 0.0, 1.0);
          transformed.x += gust * 0.28 * hFactor + flutter * tipMask;
          transformed.z += cos(uTime * 0.8 + phase) * 0.22 * hFactor + flutter * 0.8 * tipMask;
          transformed.y += cos(uTime * 5.4 + wp.z * 3.5) * 0.03 * tipMask;` : ''}
        ${mode === 'grass' ? `
          float bladeTip = pow(clamp(position.y, 0.0, 1.0), 1.6);
          float wave = sin(uTime * 2.3 + wp.x * 0.24 + wp.z * 0.18) * 0.22 + sin(uTime * 4.4 + wp.x * 0.65 - wp.z * 0.55) * 0.08;
          transformed.x += wave * bladeTip;
          transformed.z += cos(uTime * 2.0 + wp.z * 0.22) * 0.12 * bladeTip;` : ''}
        transformed = mix(windRest, transformed, uWind);`);
  }, mode === 'grass' ? 'ground' : 'bark');
}

// ---- 4. the sample's blueprints (section 6), seeded ---------------------------------------------

function oakBp(r, depth, maxDepth, matrix, length, radius, trunks, branches, leaves) {
  const b = matrix.clone().multiply(new THREE.Matrix4().makeScale(radius, length, radius));
  (depth === 0 ? trunks : branches).push(b);
  const tip = matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, length * 0.94, 0));
  if (depth < maxDepth) {
    const n = depth === 0 ? 4 : depth === 1 ? 3 : r() > 0.35 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const c = tip.clone();
      const yaw = (TAU / n) * i + (r() - 0.5) * 0.85;
      const pitch = depth === 0 ? 0.48 + r() * 0.32 : 0.38 + r() * 0.38;
      c.multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeRotationZ(pitch)).multiply(new THREE.Matrix4().makeRotationX((r() - 0.5) * 0.35));
      oakBp(r, depth + 1, maxDepth, c, length * (depth === 0 ? 0.72 + r() * 0.14 : 0.68 + r() * 0.14), radius * (depth === 0 ? 0.56 : 0.62), trunks, branches, leaves);
    }
  }
  if (depth >= maxDepth - 1) {
    const count = depth === maxDepth ? 7 : 3;
    for (let i = 0; i < count; i++) {
      const l = tip.clone();
      l.multiply(new THREE.Matrix4().makeTranslation((r() - 0.5) * 2.1, (r() - 0.35) * 1.6, (r() - 0.5) * 2.1));
      l.multiply(new THREE.Matrix4().makeRotationY(r() * TAU)).multiply(new THREE.Matrix4().makeRotationX((r() - 0.5) * 1.1)).multiply(new THREE.Matrix4().makeRotationZ((r() - 0.5) * 1.1));
      const s = 2.1 + r() * 1.25;
      leaves.push(l.multiply(new THREE.Matrix4().makeScale(s, s, s)));
    }
  }
}
function mapleBp(r, depth, maxDepth, matrix, length, radius, trunks, branches, leaves) {
  const b = matrix.clone().multiply(new THREE.Matrix4().makeScale(radius, length, radius));
  (depth === 0 ? trunks : branches).push(b);
  const tip = matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, length * 0.95, 0));
  if (depth < maxDepth) {
    const n = depth === 0 ? 3 : r() > 0.3 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const c = tip.clone();
      const yaw = (TAU / n) * i + (r() - 0.5) * 0.65;
      const pitch = depth === 0 ? 0.26 + r() * 0.22 : 0.30 + r() * 0.28;
      c.multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeRotationZ(pitch));
      mapleBp(r, depth + 1, maxDepth, c, length * (0.69 + r() * 0.13), radius * 0.58, trunks, branches, leaves);
    }
  }
  if (depth >= maxDepth - 1) {
    const count = depth === maxDepth ? 7 : 3;
    for (let i = 0; i < count; i++) {
      const l = tip.clone();
      l.multiply(new THREE.Matrix4().makeTranslation((r() - 0.5) * 1.9, (r() - 0.3) * 1.7, (r() - 0.5) * 1.9));
      l.multiply(new THREE.Matrix4().makeRotationY(r() * TAU)).multiply(new THREE.Matrix4().makeRotationX((r() - 0.5) * 1.0)).multiply(new THREE.Matrix4().makeRotationZ((r() - 0.5) * 1.0));
      const s = 1.95 + r() * 1.15;
      leaves.push(l.multiply(new THREE.Matrix4().makeScale(s, s, s)));
    }
  }
}
function pineBp(r, totalHeight, trunks, branches, needles) {
  const segs = 10; const segH = totalHeight / segs;
  for (let s = 0; s < segs; s++) {
    const t = s / segs;
    const rad = lerp(0.72, 0.045, Math.pow(t, 0.88)) * (s === 0 ? 1.24 : 1.0);
    const m = new THREE.Matrix4().makeTranslation(0, s * segH, 0).multiply(new THREE.Matrix4().makeRotationY(s * 0.42)).multiply(new THREE.Matrix4().makeScale(rad, segH * 1.04, rad));
    (s === 0 ? trunks : branches).push(m);
  }
  const tiers = 15;
  for (let tier = 0; tier < tiers; tier++) {
    const tierT = tier / (tiers - 1);
    const h = totalHeight * (0.24 + tierT * 0.73);
    const profile = Math.pow(1.0 - tierT * 0.86, 0.85);
    const pLen = 4.6 * profile + 0.55; const pRad = 0.16 * profile + 0.03;
    const per = tierT > 0.82 ? 4 : 6;
    const droop = lerp(1.48, 0.78, tierT);
    for (let b = 0; b < per; b++) {
      const yaw = (TAU / per) * b + tier * 0.65 + (r() - 0.5) * 0.25;
      const o = new THREE.Matrix4().makeTranslation(0, h, 0).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeRotationZ(droop));
      branches.push(o.clone().multiply(new THREE.Matrix4().makeScale(pRad, pLen, pRad)));
      const forks = pLen > 2.2 ? 3 : 2;
      for (let fk = 1; fk <= forks; fk++) {
        const dr = fk / (forks + 0.4);
        const fb = o.clone().multiply(new THREE.Matrix4().makeTranslation(0, pLen * dr, 0));
        for (const side of [-1, 1]) {
          const fm = fb.clone().multiply(new THREE.Matrix4().makeRotationY(side * (0.55 + r() * 0.22))).multiply(new THREE.Matrix4().makeRotationZ(0.28 + r() * 0.18));
          const fLen = pLen * (0.48 - dr * 0.18); const fRad = pRad * 0.62;
          branches.push(fm.clone().multiply(new THREE.Matrix4().makeScale(fRad, fLen, fRad)));
          if (fLen > 0.9) {
            for (const ts of [-1, 1]) {
              const tm = fm.clone().multiply(new THREE.Matrix4().makeTranslation(0, fLen * 0.58, 0)).multiply(new THREE.Matrix4().makeRotationY(ts * 0.52)).multiply(new THREE.Matrix4().makeRotationZ(0.2));
              const tLen = fLen * 0.46; const tRad = fRad * 0.6;
              branches.push(tm.clone().multiply(new THREE.Matrix4().makeScale(tRad, tLen, tRad)));
              needles.push(tm.clone().multiply(new THREE.Matrix4().makeTranslation(0, tLen * 0.55, 0)).multiply(new THREE.Matrix4().makeRotationY(r() * Math.PI)).multiply(new THREE.Matrix4().makeScale(1.15, 1.15, 1.15)));
            }
          }
          for (let ns = 0; ns < 2; ns++) {
            needles.push(fm.clone().multiply(new THREE.Matrix4().makeTranslation(0, fLen * (0.45 + ns * 0.48), 0)).multiply(new THREE.Matrix4().makeRotationY(r() * TAU))
              .multiply(new THREE.Matrix4().makeRotationX((r() - 0.5) * 0.5)).multiply(new THREE.Matrix4().makeScale(1.38, 1.38, 1.38)));
          }
        }
      }
      needles.push(o.clone().multiply(new THREE.Matrix4().makeTranslation(0, pLen * 0.92, 0)).multiply(new THREE.Matrix4().makeRotationY(r() * TAU)).multiply(new THREE.Matrix4().makeScale(1.48, 1.48, 1.48)));
    }
  }
  for (let top = 0; top < 4; top++) {
    needles.push(new THREE.Matrix4().makeTranslation(0, totalHeight * (0.93 + top * 0.025), 0).multiply(new THREE.Matrix4().makeRotationY(top * 1.1)).multiply(new THREE.Matrix4().makeScale(1.15 - top * 0.15, 1.25, 1.15 - top * 0.15)));
  }
}
function shrubBp(r, archType, branches, leaves) {
  const stemCount = archType === 0 ? 7 : 9; const maxDepth = 2;
  const grow = (depth, mat, len, rad) => {
    branches.push(mat.clone().multiply(new THREE.Matrix4().makeScale(rad, len, rad)));
    const tip = mat.clone().multiply(new THREE.Matrix4().makeTranslation(0, len * 0.94, 0));
    if (depth < maxDepth) {
      const forks = depth === 0 ? 3 : 2;
      for (let fk = 0; fk < forks; fk++) {
        const c = tip.clone();
        const yaw = (TAU / forks) * fk + (r() - 0.5) * 0.9;
        const pitch = archType === 0 ? 0.32 + r() * 0.35 : 0.48 + r() * 0.42;
        c.multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeRotationZ(pitch));
        grow(depth + 1, c, len * (0.68 + r() * 0.16), rad * 0.64);
      }
    }
    if (depth >= 1) {
      const clusters = depth === maxDepth ? 5 : 2;
      for (let k = 0; k < clusters; k++) {
        const l = tip.clone();
        l.multiply(new THREE.Matrix4().makeTranslation((r() - 0.5) * 0.65, (r() - 0.3) * 0.55, (r() - 0.5) * 0.65));
        l.multiply(new THREE.Matrix4().makeRotationY(r() * TAU)).multiply(new THREE.Matrix4().makeRotationX((r() - 0.5) * 0.95)).multiply(new THREE.Matrix4().makeRotationZ((r() - 0.5) * 0.95));
        const s = 0.82 + r() * 0.45;
        leaves.push(l.multiply(new THREE.Matrix4().makeScale(s, s, s)));
      }
    }
  };
  for (let s = 0; s < stemCount; s++) {
    const yaw = (TAU / stemCount) * s + (r() - 0.5) * 0.45;
    const lean = archType === 0 ? 0.28 + r() * 0.42 : 0.58 + r() * 0.52;
    const root = new THREE.Matrix4().makeTranslation((r() - 0.5) * 0.22, -0.05, (r() - 0.5) * 0.22).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeRotationZ(lean));
    grow(0, root, archType === 0 ? 0.85 + r() * 0.35 : 0.68 + r() * 0.32, 0.055 + r() * 0.02);
  }
}
/** The sample's thinning: keep a share of the cards and grow the survivors, so a crown keeps its mass. */
function thin(arr, keep, grow) {
  const out = []; let acc = 0;
  for (const m of arr) {
    acc += keep;
    if (acc >= 1) { acc -= 1; out.push(grow === 1 ? m : m.clone().multiply(new THREE.Matrix4().makeScale(grow, grow, grow))); }
  }
  return out;
}
const packed = (list) => { const a = new Float32Array(list.length * 16); list.forEach((m, i) => a.set(m.elements, i * 16)); return a; };
/**
 * How big a blueprint stands, in its own frame: { h, r } its top and its crown's reach from the
 * trunk (the leaf cards' for a leafy tree, the limbs' tips for a bare one; the 85th of each, so a
 * stray limb does not make its far tree fat).
 */
function extentOf(v) {
  const ys = []; const rs = []; const bare = [];
  const each = (arr, fn) => { for (let i = 0; i < arr.length; i += 16) fn(arr, i); };
  const tip = (a, i) => { const x = a[i + 12] + a[i + 4] * 0.94; const y = a[i + 13] + a[i + 5] * 0.94; const z = a[i + 14] + a[i + 6] * 0.94; ys.push(y); bare.push(Math.hypot(x, z)); };
  if (v.trunks) each(v.trunks, tip);
  each(v.branches, tip);
  each(v.leaves, (a, i) => { const s = Math.hypot(a[i], a[i + 1], a[i + 2]) * 0.5; ys.push(a[i + 13] + s); rs.push(Math.hypot(a[i + 12], a[i + 14]) + s); });
  const p85 = (l) => { if (!l.length) return 0; const s = [...l].sort((a, b) => a - b); return s[Math.floor(s.length * 0.85)]; };
  return { h: ys.length ? Math.max(...ys) * 0.95 : 1, r: p85(rs), rBare: p85(bare) };
}
/** The mean colour (0..1, as the walk's textures are sampled: raw) of a square of a canvas; alpha: only its opaque texels. */
function meanOf(canvas, x, y, size, alpha) {
  const d = canvas.getContext('2d').getImageData(x, y, size, size).data;
  const s = [0, 0, 0]; let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (alpha && d[i + 3] < 107) continue; // (the cards' alpha test, 0.42)
    s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n += 1;
  }
  return s.map((v) => v / Math.max(1, n) / 255);
}

// ---- the static mesh's own shading: the floor's grit, pebbles and wheel marks, the light over the Tweedles
// aWalk (per vertex, staticMesh): the ground's (u, s, 1); the Tweedles' (u, s, 2); anything else 0. On
// the ground: fine grit and scattered pebbles over the whole floor, and the road's two wheel ruts,
// faint from the gate, as dark as the road's own over the last 15 m, so the floor runs into the road's
// without a seam. Where the canopy is open over the Tweedles (tunnelwood.js keeps its leaves off),
// a patch of light: the ground round them and the brothers themselves lit a little from above.
const twMid = TWEEDLES.reduce((a, t) => ({ x: a.x + t.x / TWEEDLES.length, z: a.z + t.z / TWEEDLES.length }), { x: 0, z: 0 });
const twAt = nearest(twMid.x, twMid.z, {});
const GAP_R = 4.6; // the canopy's opening over them, metres round their middle
const PATCH = {
  uPatchAt: { value: new THREE.Vector2(twAt.u, twAt.s) },
  uPatch: { value: new THREE.Color(1.0, 0.94, 0.82) }, // the open sky's light on them, warm
  uPatchK: { value: new THREE.Vector2(0.7, 0.16) }, // (on the ground round them, on the brothers)
  uRutEnd: { value: TUNNEL.length },
  uGroundK: { value: new THREE.Vector2(0.45, 0.85) }, // the floor's tone at the gate (x) and the mouth (y): see staticFrag
};
function staticVertex(shader) {
  shader.vertexShader = `attribute vec3 aWalk;\nvarying vec3 vWalk;\n${shader.vertexShader}`
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWalk = aWalk;');
}
function staticFrag(shader) {
  Object.assign(shader.uniforms, PATCH);
  shader.fragmentShader = `varying vec3 vWalk;\nuniform vec2 uPatchAt;\nuniform vec3 uPatch;\nuniform vec2 uPatchK;\nuniform float uRutEnd;\nuniform vec2 uGroundK;
float tunnelHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n${shader.fragmentShader}`
    .replace('#include <color_fragment>', `#include <color_fragment>
  float tunnelGround = 1.0 - step(0.5, abs(vWalk.z - 1.0));
  if (tunnelGround > 0.5) {
    float ua = abs(vWalk.x);
    float trod = 1.0 - smoothstep(1.8, 3.2, ua);
    vec2 cell = vWalk.xy * 4.5;
    vec2 id = floor(cell); vec2 fr = fract(cell) - 0.5;
    vec2 jit = vec2(tunnelHash(id + 3.1), tunnelHash(id + 7.7)) - 0.5;
    float peb = step(0.7, tunnelHash(id)) * smoothstep(0.17, 0.08, length(fr - jit * 0.45));
    diffuseColor.rgb *= 1.0 + peb * (tunnelHash(id + 1.3) - 0.45) * 0.45 * (0.4 + 0.6 * trod);
    diffuseColor.rgb *= 0.96 + 0.08 * tunnelHash(floor(vWalk.xy * vec2(31.0, 17.0))) * trod;
    // the floor lies level, square to the low sun, where the road climbs away from it: toned down along
    // the way (the blend) so it meets the road at the mouth as bright as the road is, from the sample's pale path at the gate
    diffuseColor.rgb *= mix(mix(uGroundK.x, uGroundK.y, smoothstep(0.0, uRutEnd, vWalk.y)), 1.0, smoothstep(10.5, 14.5, ua)); // (the edge: the hill's own, as lit)
    float side = vWalk.x < 0.0 ? 1.7 : 0.0;
    float rc = 0.75 + 0.06 * sin(vWalk.y * 0.19 + side) + 0.03 * sin(vWalk.y * 0.53 + side * 2.0);
    float rw = 0.17 + 0.03 * sin(vWalk.y * 0.31 + side);
    float rut = 1.0 - smoothstep(0.0, 1.0, abs(ua - rc) / rw);
    float rk = mix(0.3, 0.95, smoothstep(uRutEnd - 15.0, uRutEnd, vWalk.y)) * (0.8 + 0.2 * sin(vWalk.y * 0.11 + side));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.53, 0.5, 0.47), rut * rk);
  }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float tunnelPatch = uPatchK.x * tunnelGround * (1.0 - smoothstep(1.0, 4.5, length((vWalk.xy - uPatchAt) * vec2(1.0, 0.7)))) + uPatchK.y * step(1.5, vWalk.z);
  totalEmissiveRadiance += diffuseColor.rgb * uPatch * tunnelPatch;`);
}

// ---- the kit: textures, geometry, materials and blueprints, made once per tier ----------------------

const KITS = new Map();
function kitFor(tier) {
  if (KITS.has(tier.name)) return KITS.get(tier.name);
  const rand = S.rng(0x2026);
  const bark = barkSet(rand, '#4a3a2b', 'rgba(18, 12, 7, 0.88)', 'rgba(98, 82, 64, 0.62)', 1.25, false, tier.maps);
  const atlas = leafAtlas(rand);
  const rock = rockSet(rand, tier.maps);
  const [ts, th] = tier.trunkSegs; const [bs, bh] = tier.branchSegs; const [ss, sh] = tier.shrubSegs;
  const geo = {
    trunk: sculptedWood({ radialSegs: ts, heightSegs: th, topRadius: 0.62, bottomRadius: 1.04, rootFlare: 0.52, fluteCount: 6, bendAmt: 0.085, barkRidgeAmt: 0.068, seed: 2.4 }),
    branch: sculptedWood({ radialSegs: bs, heightSegs: bh, topRadius: 0.58, bottomRadius: 1.0, rootFlare: 0.14, fluteCount: 4, bendAmt: 0.095, barkRidgeAmt: 0.048, seed: 5.9 }),
    stem: sculptedWood({ radialSegs: ss, heightSegs: sh, topRadius: 0.54, bottomRadius: 1.0, rootFlare: 0.18, fluteCount: 4, bendAmt: 0.13, barkRidgeAmt: 0.045, seed: 8.3 }),
    card: foliageCard(tier.cardSegs),
    rocks: [1.13, 4.79, 9.41].slice(0, tier.rocks).map((sd) => boulderGeo(sd, tier.rockDetail)),
    grass: grassGeo(tier.bladeSegs),
  };
  const wood = windOn(new THREE.MeshStandardMaterial({ map: bark.albedoMap, bumpMap: bark.bumpMap, bumpScale: 0.09, roughnessMap: bark.roughnessMap, roughness: 0.94, vertexColors: true }), 'wood');
  const leaf = windOn(new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.68 }), 'leaf');
  const rockMat = fadeOn(new THREE.MeshStandardMaterial({ map: rock.albedoMap, bumpMap: rock.bumpMap, bumpScale: 0.085, roughnessMap: rock.roughnessMap, roughness: 0.92, metalness: 0.04, vertexColors: true }), 'tunnel-rock', null, 'bark');
  const grassMat = windOn(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.72 }), 'grass');
  const statMat = fadeOn(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), 'tunnel-static', staticVertex, 'ground', staticFrag);
  // three variants of each species, as the sample precomputes; the phone's fewer branch levels
  const r = S.rng(0x2027);
  const bp = { oak: [], maple: [], pine: [], shrub: [] };
  for (let i = 0; i < 3; i++) {
    const ot = []; const ob = []; const ol = [];
    oakBp(r, 0, tier.depth, new THREE.Matrix4(), 4.8 + r() * 0.7, 0.95, ot, ob, ol);
    bp.oak.push({ trunks: packed(ot), branches: packed(ob), leaves: packed(thin(ol, tier.leafKeep * 1.19, tier.leafGrow)) });
    const mt = []; const mb = []; const ml = [];
    mapleBp(r, 0, tier.depth, new THREE.Matrix4(), 5.4 + r() * 0.8, 0.75, mt, mb, ml);
    bp.maple.push({ trunks: packed(mt), branches: packed(mb), leaves: packed(thin(ml, tier.leafKeep * 1.19, tier.leafGrow)) });
    if (tier.pine) {
      const pt = []; const pb = []; const pn = [];
      pineBp(r, 16.5 + r() * 4.5, pt, pb, pn);
      bp.pine.push({ trunks: packed(pt), branches: packed(thin(pb, 0.45, 1)), leaves: packed(thin(pn, 0.35, 1.55)) });
    }
    const sb = []; const sl = [];
    shrubBp(r, i % 2, sb, sl);
    bp.shrub.push({ branches: packed(thin(sb, 0.6, 1)), leaves: packed(thin(sl, 0.4, 1.45)) });
  }
  // how big each blueprint stands (its far tree is made as tall and as wide)
  for (const list of Object.values(bp)) for (const v of list) v.ext = extentOf(v);
  // the far trees: the maze's own (mazetrees.js), in the maze's matte material with the walk's land
  // lift; and the average colour each texture lays over its tree, so a far tree is its tree's colour
  const far = {
    cone: victorianTree(1, 0), bare: hauntedTree(S.rng(0x51ee), 0),
    stemN: new THREE.CylinderGeometry(0.035, 0.05, 0.5, 6, 1, false).attributes.position.count, // (the cone tree's stem: its first vertices, mazetrees.js)
    mat: fadeOn(mats().matte.clone(), 'tunnel-far', null, 'bark'),
  };
  for (const k of ['cone', 'bare']) {
    const g = far[k]; g.computeBoundingBox();
    const bb = g.boundingBox;
    far[`${k}H`] = bb.max.y;
    far[`${k}R`] = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
    // the vertex colour of its crown (the cone above the stem) or its wood: what the instance colour multiplies
    const p = g.attributes.position; const c = g.attributes.color; const sum = [0, 0, 0]; let n = 0;
    for (let i = 0; i < p.count; i++) if (k === 'bare' || i >= far.stemN) { sum[0] += c.getX(i); sum[1] += c.getY(i); sum[2] += c.getZ(i); n += 1; }
    far[`${k}Tint`] = sum.map((v) => v / Math.max(1, n));
  }
  far.atlas = Object.fromEntries(Object.entries(TILE).map(([sp, t]) => [sp, meanOf(atlas.image, t[0] * 512, (0.5 - t[1]) * 512, 256, true)]));
  far.bark = meanOf(bark.albedoMap.image, 0, 0, 256, false);
  // the cone tree's own colours made relative, so one instance colour (its crown's) paints it: the
  // cone's keep the maze's variation about 1, the stem's are the walk's bark over its leaves (a
  // typical oak's), so the stem is the bark's colour under any crown
  {
    const lc = grey(new THREE.Color().setHSL(0.225, 0.5, 0.52)); const bc = grey(new THREE.Color().setHSL(0.08, 0.24, 0.63));
    const stem = [bc.r * far.bark[0] / (lc.r * far.atlas.oak[0]), bc.g * far.bark[1] / (lc.g * far.atlas.oak[1]), bc.b * far.bark[2] / (lc.b * far.atlas.oak[2])];
    const g = far.cone; const p = g.attributes.position; const c = g.attributes.color; const t = far.coneTint;
    for (let i = 0; i < p.count; i++) {
      if (i >= far.stemN) c.setXYZ(i, c.getX(i) / t[0], c.getY(i) / t[1], c.getZ(i) / t[2]);
      else c.setXYZ(i, stem[0], stem[1], stem[2]);
    }
    far.coneTint = [1, 1, 1];
  }
  const kit = { tier, geo, far, mats: { wood, leaf, rock: rockMat, grass: grassMat, stat: statMat, far: far.mat }, bp, textures: [bark.albedoMap, bark.bumpMap, bark.roughnessMap, atlas, rock.albedoMap, rock.bumpMap, rock.roughnessMap].filter(Boolean) };
  KITS.set(tier.name, kit);
  return kit;
}

// ---- 5. colour: the sample's tones, greyed as the sample greys them (band 2), then turned to the
// road's dead palette by the blend ----------------------------------------------------------------

const WOOD_GREY = new THREE.Color(0x6a6658);
const DEAD_LEAF = new THREE.Color(0x6b5a40); // dry leaf, the road's earth in it
const DEAD_BARK = new THREE.Color(0xb3aa9c); // under the bark texture: the road's weathered silver-grey (roadview 0x5a5249 untextured)
const DRY = new THREE.Color(1.55, 0.95, 0.85); // over the grass's green: the road's dead grass
/** The sample's band-2 greying (keep half the chroma, x 0.86, toward the wood's grey by 0.12), in place. */
function grey(c) {
  const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  c.setRGB(l + (c.r - l) * 0.5, l + (c.g - l) * 0.5, l + (c.b - l) * 0.5).multiplyScalar(0.86).lerp(WOOD_GREY, 0.12);
  return c;
}

// ---- 6. building ------------------------------------------------------------------------------------

/**
 * createTunnelWood(parent, opts) -> { group, update(eye, time, dt), light(parts, eye, renderer), stats() }.
 *   opts.tier: a TIERS entry (logic/tunnelwalk.js tunnelTier). opts.frame: 'castle' (the walk itself,
 *   streamed) or 'court' (the wood's view through the gate: s 0 to opts.until, built at once, placed
 *   in the wood's frame). opts.ground: (x, z) -> the hill under the walk's verges (castle). opts.dirt,
 *   opts.verge: the road foot's earth colours the ground grades into. opts.wood: court.js
 *   woodGateLight() (the wood's light at the gate, for the light's blend).
 */
export function createTunnelWood(parent, opts = {}) {
  const tier = opts.tier;
  const kit = kitFor(tier);
  const court = opts.frame === 'court';
  const sFrom = court ? -0.3 : -Infinity;
  const sTo = court ? (opts.until ?? 24) : Infinity;
  const P = placements(tier);
  const outer = new THREE.Group();
  outer.name = court ? 'tunnelwood:court' : 'tunnelwood';
  parent.add(outer);
  const root = new THREE.Group(); // castle coordinates inside
  outer.add(root);
  if (court) {
    // the wood's frame: the walk's start at the gate's face, its first stretch due north, the floor at 0
    outer.position.set(TUNNEL.gate.x, -TUNNEL.floor, TUNNEL.gate.face);
    outer.rotation.y = -TUNNEL.turn;
    root.position.set(-pointAt(0, {}).x, 0, -pointAt(0, {}).z);
  }

  // which placements each chunk holds (the walk's trees are not the chunks': they have their own level
  // of detail, below; the court's fixed view keeps them in its chunks, all full)
  const lodOn = !court;
  const byChunk = Array.from({ length: CHUNKS }, () => ({ trees: [], shrubs: [], boulders: [], grass: [] }));
  for (const k of ['trees', 'shrubs', 'boulders', 'grass']) {
    if (k === 'trees' && lodOn) continue;
    for (const q of P[k]) if (q.s >= sFrom && q.s <= sTo) byChunk[q.chunk][k].push(q);
  }
  const TREES = lodOn ? P.trees : [];
  const NT = TREES.length;
  const LOD = TREE_LOD[tier.name] || TREE_LOD.desktop;
  const SLOTS = lodOn ? Math.min(NT, LOD.maxFull) : 0;

  // the kinds, each one instanced mesh: [name, geometry, material, aux floats]
  const stemsApart = tier.name !== 'phone';
  const KINDS = [
    ['trunk', kit.geo.trunk, kit.mats.wood, 1],
    ['branch', kit.geo.branch, kit.mats.wood, 1],
    ['leaf', kit.geo.card, kit.mats.leaf, 3],
    ...(stemsApart ? [['stem', kit.geo.stem, kit.mats.wood, 1]] : []),
    ...kit.geo.rocks.map((g, i) => [`rock${i}`, g, kit.mats.rock, 0]),
    ['grass', kit.geo.grass, kit.mats.grass, 0],
  ];
  const K = {};
  KINDS.forEach(([name], i) => { K[name] = i; });
  const stemKind = stemsApart ? K.stem : K.branch;

  // the most instances of each kind one chunk can hold (unclipped), for the pool's buffers
  const count16 = (a) => a.length / 16;
  const chunkMax = KINDS.map(() => 0);
  const chunkCounts = byChunk.map((c) => {
    const n = KINDS.map(() => 0);
    for (const t of c.trees) {
      const b = kit.bp[t.species][0];
      const big = kit.bp[t.species].reduce((m, v) => Math.max(m, count16(v.branches) + count16(v.leaves)), 0);
      n[K.trunk] += count16(b.trunks); n[K.branch] += big; if (!t.bare) n[K.leaf] += big;
    }
    for (let i = 0; i < c.shrubs.length; i++) {
      const big = kit.bp.shrub.reduce((m, v) => Math.max(m, count16(v.branches) + count16(v.leaves)), 0);
      n[stemKind] += big; n[K.leaf] += big;
    }
    for (const b of c.boulders) n[K[`rock${b.variant}`]] += 1;
    n[K.grass] += c.grass.length;
    n.forEach((v, i) => { chunkMax[i] = Math.max(chunkMax[i], v); });
    return n;
  });
  // the court's view is a fixed few chunks (the gate's face to `until`); the walk's a window of them
  const courtFrom = chunkOf(Math.max(0, sFrom));
  const courtTo = chunkOf(Math.min(TUNNEL.length, sTo));
  const alive = court ? courtTo - courtFrom + 1 : maxAlive(tier);
  // the most of each kind one full tree can hold (its biggest blueprint), for the tree slots
  const treeMax = KINDS.map(() => 0);
  if (lodOn) {
    for (const list of [kit.bp.oak, kit.bp.maple, kit.bp.pine]) {
      for (const v of list) {
        treeMax[K.trunk] = Math.max(treeMax[K.trunk], count16(v.trunks));
        treeMax[K.branch] = Math.max(treeMax[K.branch], count16(v.branches));
        treeMax[K.leaf] = Math.max(treeMax[K.leaf], count16(v.leaves));
      }
    }
  }
  const capacity = KINDS.map((_, i) => {
    let best = 0;
    for (let c = 0; c < CHUNKS; c++) {
      let sum = 0;
      for (let k = c; k < Math.min(CHUNKS, c + alive); k++) sum += chunkCounts[k][i];
      best = Math.max(best, sum);
    }
    return Math.max(1, best + SLOTS * treeMax[i]);
  });
  const meshes = KINDS.map(([name, g0, m, aux], i) => {
    const g = aux ? g0.clone() : g0; // its own copy for the per-instance sway and atlas tile (a second frame has its own)
    const im = new THREE.InstancedMesh(g, m, capacity[i]);
    im.name = `tunnel:${name}`;
    im.count = 0;
    im.castShadow = false;
    im.receiveShadow = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.setColorAt(0, WOOD_GREY); // makes instanceColor
    im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    if (aux === 1) g.setAttribute('aSway', new THREE.InstancedBufferAttribute(new Float32Array(capacity[i]), 1));
    if (aux === 3) {
      g.setAttribute('aSway', new THREE.InstancedBufferAttribute(new Float32Array(capacity[i]), 1));
      g.setAttribute('aTile', new THREE.InstancedBufferAttribute(new Float32Array(capacity[i] * 2), 2));
    }
    im.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    root.add(im);
    return im;
  });

  // the pool: alive + 2 slots, each with a buffer per kind sized for the fullest chunk
  const POOL = court ? alive : alive + 2;
  const pool = Array.from({ length: POOL }, () => ({
    chunk: -1, ready: false, used: false,
    n: KINDS.map(() => 0),
    m: KINDS.map((_, i) => new Float32Array(Math.max(1, chunkMax[i]) * 16)),
    c: KINDS.map((_, i) => new Float32Array(Math.max(1, chunkMax[i]) * 3)),
    a: KINDS.map(([, , , aux], i) => (aux ? new Float32Array(Math.max(1, chunkMax[i]) * aux) : null)),
  }));
  // the tree slots: one full tree each, buffers sized for the biggest (the walk's frame only)
  const slots = Array.from({ length: SLOTS }, () => ({
    tree: -1, n: KINDS.map(() => 0),
    m: KINDS.map((_, i) => (treeMax[i] ? new Float32Array(treeMax[i] * 16) : null)),
    c: KINDS.map((_, i) => (treeMax[i] ? new Float32Array(treeMax[i] * 3) : null)),
    a: KINDS.map(([, , , aux], i) => (treeMax[i] && aux ? new Float32Array(treeMax[i] * aux) : null)),
  }));
  const slotOfTree = new Int32Array(NT).fill(-1);

  // scratch (no allocation once built)
  const _M = new THREE.Matrix4(); const _W = new THREE.Matrix4(); const _L = new THREE.Matrix4();
  const _T = new THREE.Matrix4(); const _R = new THREE.Matrix4();
  const _v = new THREE.Vector3(); const _q = new THREE.Quaternion(); const _e = new THREE.Euler(); const _sc = new THREE.Vector3();
  const _c = new THREE.Color();
  const _n = {}; const _p = {};
  const FLOOR = TUNNEL.floor;

  /** The sample's clearing (intrudes): does reach r at world (x, y, z) stand on the clear floor below the canopy? */
  function intrudes(x, y, z, r, hint) {
    if (y - FLOOR > 5.2) return false;
    nearest(x, z, _n, hint);
    if (_n.s < 0) return _n.s > TUNNEL.gate.s && Math.abs(_n.u) - r < TUNNEL.gate.half; // the gate's own way
    if (_n.s > TUNNEL.length + 1) return false;
    return Math.abs(_n.u) - r < PATH_HALF;
  }
  function keep(e, wood, hint) {
    if (wood) {
      const r = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[8], e[9], e[10])) * 0.9;
      const tx = e[12] + e[4] * 0.94; const ty = e[13] + e[5] * 0.94; const tz = e[14] + e[6] * 0.94;
      return !(intrudes(e[12], e[13], e[14], r, hint) || intrudes(tx, ty, tz, r, hint) || intrudes((e[12] + tx) / 2, (e[13] + ty) / 2, (e[14] + tz) / 2, r, hint));
    }
    const r = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[8], e[9], e[10])) * 0.95;
    if (intrudes(e[12], e[13], e[14], r, hint)) return false;
    // the canopy open over the Tweedles: they lie in a patch of the sky's light
    if ((e[12] - twMid.x) ** 2 + (e[14] - twMid.z) ** 2 < GAP_R * GAP_R) return false;
    // just behind the start: the gate's opening kept clear of leaves, so the wood is seen through it
    if (e[13] - FLOOR < 7.5) {
      nearest(e[12], e[14], _n, hint);
      if (_n.s < 1 && _n.s > TUNNEL.gate.s - 12 && Math.abs(_n.u) < TUNNEL.gate.half + 1.2) {
        if (_n.s > TUNNEL.gate.s - 6 && e[13] - FLOOR < 5) return false; // (the opening itself, below its lintel)
        if (hashOf(e[12] * 3.1 + e[14], 17.3) < 0.7) return false; // (thinned beyond it)
      }
    }
    return true;
  }
  function push(slot, kind, mat, col, sway, tile) {
    const i = slot.n[kind];
    if (!slot.m[kind] || i * 16 >= slot.m[kind].length) return;
    slot.m[kind].set(mat.elements, i * 16);
    slot.c[kind][i * 3] = col.r; slot.c[kind][i * 3 + 1] = col.g; slot.c[kind][i * 3 + 2] = col.b;
    const a = slot.a[kind];
    if (a) {
      if (tile) { a[i * 3] = sway; a[i * 3 + 1] = tile[0]; a[i * 3 + 2] = tile[1]; } else a[i] = sway;
    }
    slot.n[kind] = i + 1;
  }
  /** The placement's matrix: on the floor, turned, leaning (bare trees lean in over the way, as the road's do), scaled. */
  /** How far the ground sheet (staticMesh) stands above the floor at (s, u, x, z): off its outer edge it runs into the hill. */
  function rise(s, u, x, z) {
    const off = Math.abs(u);
    if (off <= 3) return 0;
    let y = 0.18 * smooth((off - 3) / 6) * (0.6 + 0.4 * S.noise(x * 0.3, 0, z * 0.3, 5));
    if (opts.ground && off > 9) y = lerp(y, opts.ground(x, z) + 0.03 - FLOOR, smooth((off - 9) / 6));
    if (s > TUNNEL.length - 3) y = lerp(y, -0.01, smooth((s - (TUNNEL.length - 3)) / 3));
    return y;
  }
  function placeM(q, dy, vary = false) {
    _M.makeTranslation(q.x, FLOOR + dy + (Math.abs(q.u) > 9 ? rise(q.s, q.u, q.x, q.z) : 0), q.z);
    if (q.lean) { // the top tilted toward the centreline (up x toward is the axis)
      pointAt(q.s, _p);
      const sg = q.u > 0 ? 1 : -1;
      const tx = sg * _p.dz; const tz = -sg * _p.dx;
      _M.multiply(_L.makeRotationAxis(_v.set(tz, 0, -tx), q.lean));
    }
    _M.multiply(_R.makeRotationY(q.rot));
    if (vary) { // each tree its own build: taller and slimmer, or shorter and stouter (from its tone: no draw from the chunk's generator)
      const h = hashOf(q.tone, 7919.13);
      _M.multiply(_L.makeScale(q.scale * (1.12 - 0.24 * h), q.scale * (0.86 + 0.34 * h), q.scale * (1.12 - 0.24 * hashOf(q.tone, 104.7) * h)));
    } else _M.multiply(_L.makeScale(q.scale, q.scale, q.scale));
    return _M;
  }

  // one chunk's expansion, a placement at a time, inside the frame's budget (job state, no closures)
  function treeInto(slot, q, r) {
    const b = blendAt(q.s);
    const list = kit.bp[q.species];
    const bp = list[Math.floor(q.tone * 997) % list.length];
    const M = placeM(q, -0.15, true);
    const els = M.elements;
    const tone = q.tone;
    const sway = q.bare ? 0.8 : q.species === 'pine' ? 0.45 : 1;
    // each tree its own bark: lighter or darker, warmer or greyer (so no two neighbours read as copies)
    const hv = hashOf(tone, 3571.7); const hh = hashOf(tone, 613.3);
    // bark: the sample's per-species tones, greyed; bare dead wood the road's silver-grey
    const barkTone = (lift) => {
      if (q.species === 'oak') _c.setHSL(0.08 + (hh - 0.5) * 0.04, 0.24 - (lift ? 0.02 : 0), 0.56 + tone * 0.14 + (lift ? 0.02 : 0));
      else if (q.species === 'maple') _c.setHSL(0.07 + (hh - 0.5) * 0.04, 0.15, 0.62 + tone * 0.14);
      else _c.setHSL(0.05, 0.28, 0.54 + tone * 0.14);
      grey(_c).multiplyScalar(0.8 + 0.4 * hv);
      return q.bare ? _c.lerp(DEAD_BARK, 0.55 + 0.45 * b) : _c;
    };
    for (const [arr, kind] of [[bp.trunks, K.trunk], [bp.branches, K.branch]]) {
      const n = arr.length / 16;
      for (let i = 0; i < n; i++) {
        _L.fromArray(arr, i * 16);
        _W.multiplyMatrices(M, _L);
        if (!keep(_W.elements, true, q.s)) continue;
        push(slot, kind, _W, barkTone(kind === K.branch), sway);
      }
    }
    if (q.bare) return;
    // leaves: the sample's colour variation, greyed; then fewer and drier with the blend
    const leafKeep = (1 - 0.62 * b) * (q.screen ? 0.45 : 1); // (the outer screen: a silhouette, fewer cards)
    const tile = TILE[q.species];
    const n = bp.leaves.length / 16;
    for (let i = 0; i < n; i++) {
      const j = r();
      const j2 = r(); const j3 = r(); const j4 = r();
      if (r() > leafKeep) continue;
      _L.fromArray(bp.leaves, i * 16);
      _W.multiplyMatrices(M, _L);
      if (!keep(_W.elements, false, q.s)) continue;
      if (q.species === 'oak') {
        if (j < 0.55) _c.setHSL(0.24 + j2 * 0.04, 0.45 + j3 * 0.15, 0.46 + j4 * 0.14);
        else if (j < 0.85) _c.setHSL(0.20 + j2 * 0.03, 0.52, 0.52 + j3 * 0.12);
        else _c.setHSL(0.11 + j2 * 0.04, 0.55, 0.48 + j3 * 0.10);
      } else if (q.species === 'maple') {
        if (tone < 0.48) _c.setHSL(0.22 + j2 * 0.05, 0.52, 0.48 + j3 * 0.16);
        else if (tone < 0.78) _c.setHSL(0.11 + j2 * 0.05, 0.74, 0.52 + j3 * 0.14);
        else _c.setHSL(0.03 + j2 * 0.06, 0.78, 0.48 + j3 * 0.14);
      } else if (j < 0.65) _c.setHSL(0.32 + j2 * 0.05, 0.42, 0.42 + j3 * 0.14);
      else _c.setHSL(0.27 + j2 * 0.04, 0.48, 0.50 + j3 * 0.12);
      grey(_c).lerp(DEAD_LEAF, 0.75 * smooth(b * 1.15)).multiplyScalar(0.88 + 0.24 * hh);
      push(slot, K.leaf, _W, _c, sway, tile);
    }
    void els;
  }
  function shrubInto(slot, q, r) {
    const b = blendAt(q.s);
    const bp = kit.bp.shrub[Math.floor(q.tone * 991) % kit.bp.shrub.length];
    const M = placeM(q, -0.05);
    const nb = bp.branches.length / 16;
    for (let i = 0; i < nb; i++) {
      _L.fromArray(bp.branches, i * 16);
      _W.multiplyMatrices(M, _L);
      if (!keep(_W.elements, true, q.s)) continue;
      grey(_c.setHSL(0.08, 0.25, 0.56 + q.tone * 0.14));
      push(slot, stemKind, _W, _c, 0.25);
    }
    const nl = bp.leaves.length / 16;
    const leafKeep = 1 - 0.5 * b;
    for (let i = 0; i < nl; i++) {
      const j2 = r(); const j3 = r();
      if (r() > leafKeep) continue;
      _L.fromArray(bp.leaves, i * 16);
      _W.multiplyMatrices(M, _L);
      if (!keep(_W.elements, false, q.s)) continue;
      if (q.tone < 0.55) _c.setHSL(0.24 + j2 * 0.04, 0.48, 0.45 + j3 * 0.14);
      else if (q.tone < 0.82) _c.setHSL(0.28 + j2 * 0.05, 0.36, 0.48 + j3 * 0.14);
      else _c.setHSL(0.14 + j2 * 0.05, 0.52, 0.46 + j3 * 0.12);
      grey(_c).lerp(DEAD_LEAF, 0.7 * smooth(b * 1.15));
      push(slot, K.leaf, _W, _c, 0.45, TILE.shrub);
    }
  }
  function boulderInto(slot, q, r) {
    const sx = q.scale * (0.85 + r() * 0.35); const sy = q.scale * q.squash; const sz = q.scale * (0.85 + r() * 0.35);
    _W.compose(_v.set(q.x, FLOOR - sy * 0.14 + (Math.abs(q.u) > 9 ? rise(q.s, q.u, q.x, q.z) : 0), q.z), _q.setFromEuler(_e.set((r() - 0.5) * 0.25, q.rot, (r() - 0.5) * 0.25)), _sc.set(sx, sy, sz));
    if (q.tone < 0.55) _c.setHSL(0.10, 0.08, 0.68 + r() * 0.18);
    else if (q.tone < 0.82) _c.setHSL(0.08, 0.16, 0.64 + r() * 0.16);
    else _c.setHSL(0.24, 0.18, 0.58 + r() * 0.14);
    push(slot, K[`rock${q.variant}`], _W, grey(_c), 0);
  }
  function grassInto(slot, q, r) {
    placeAt(q.s, q.u, _p);
    const clump = Math.sin(_p.x * 0.09) * Math.cos(_p.z * 0.09) * 0.5 + 0.5;
    const micro = Math.sin(_p.x * 0.45 + _p.z * 0.35) * 0.5 + 0.5;
    const hs = (0.45 + clump * 0.65 + micro * 0.35) * (0.7 + r() * 0.6);
    const ws = 0.75 + r() * 0.55;
    _W.compose(_v.set(_p.x, FLOOR - 0.02 + (Math.abs(q.u) > 9 ? rise(q.s, q.u, _p.x, _p.z) : 0), _p.z), _q.setFromEuler(_e.set((r() - 0.5) * 0.25, r() * TAU, (r() - 0.5) * 0.25)), _sc.set(ws, hs, ws));
    const g = r(); const j2 = r(); const j3 = r();
    if (g < 0.75) _c.setHSL(0.23 + j2 * 0.05, 0.52, 0.75 + j3 * 0.35);
    else if (g < 0.96) _c.setHSL(0.15 + j2 * 0.04, 0.55, 0.85 + j3 * 0.25);
    else _c.setHSL(0.12 + j2 * 0.03, 0.85, 1.15);
    grey(_c);
    const b = blendAt(q.s);
    if (b > 0) { const k = smooth(b * 1.1); _c.r *= lerp(1, DRY.r, k); _c.g *= lerp(1, DRY.g, k); _c.b *= lerp(1, DRY.b, k); }
    push(slot, K.grass, _W, _c, 0);
  }

  // jobs: one chunk at a time, resumable
  const job = { slot: null, list: 0, i: 0, rnd: null };
  const LISTS = ['trees', 'shrubs', 'boulders', 'grass'];
  const INTO = [treeInto, shrubInto, boulderInto, grassInto];
  function startJob(slot, chunk) {
    slot.chunk = chunk; slot.ready = false; slot.used = true;
    for (let i = 0; i < KINDS.length; i++) slot.n[i] = 0;
    job.slot = slot; job.list = 0; job.i = 0; job.rnd = S.rng(0x7a11 + chunk * 131); // the same chunk the same every time
  }
  /** Works on the current job until deadline (performance.now() ms); true when it is done. */
  function work(deadline) {
    const slot = job.slot;
    if (!slot) return true;
    const src = byChunk[slot.chunk];
    while (job.list < LISTS.length) {
      const arr = src[LISTS[job.list]];
      while (job.i < arr.length) {
        INTO[job.list](slot, arr[job.i], job.rnd);
        job.i += 1;
        if ((job.i & 7) === 0 && performance.now() > deadline) return false;
      }
      job.list += 1; job.i = 0;
    }
    slot.ready = true;
    job.slot = null;
    return true;
  }

  // the window: which chunks should be alive; the meshes hold exactly those once they are all ready
  const want = { from: -1, to: -1 };
  let shown = { from: -2, to: -2 };
  let eyeS = court ? 0 : TUNNEL.length;
  function slotOf(chunk) { for (const s of pool) if (s.used && s.chunk === chunk) return s; return null; }
  function freeSlot(from, to) {
    for (const s of pool) if (!s.used) return s;
    for (const s of pool) if (s.chunk < from || s.chunk > to) { if (job.slot === s) job.slot = null; s.used = false; return s; }
    return null;
  }
  // where each kind's chunk instances end in its mesh: the full trees follow them
  const chunkEnd = KINDS.map(() => 0);
  const chunkBound = new THREE.Sphere(new THREE.Vector3(), 1);
  const treeBound = new THREE.Sphere(new THREE.Vector3(), 1);
  /** Copies the alive chunks' instances into the meshes (once per window change: a copy, no allocation), then the full trees after them. */
  function commit(from, to) {
    let s0 = Infinity; let s1 = -Infinity;
    for (let k = 0; k < KINDS.length; k++) {
      const im = meshes[k];
      const M = im.instanceMatrix.array; const C = im.instanceColor.array;
      const g = im.geometry;
      const sway = g.attributes.aSway ? g.attributes.aSway.array : null;
      const tile = g.attributes.aTile ? g.attributes.aTile.array : null;
      const aux = KINDS[k][3];
      let o = 0;
      for (let c = from; c <= to && from >= 0; c++) {
        const s = slotOf(c);
        if (!s || !s.ready) continue;
        const n = Math.min(s.n[k], capacity[k] - SLOTS * treeMax[k] - o);
        const sm = s.m[k]; const sc = s.c[k]; const sa = s.a[k];
        for (let i = 0; i < n * 16; i++) M[o * 16 + i] = sm[i];
        for (let i = 0; i < n * 3; i++) C[o * 3 + i] = sc[i];
        if (sa && sway) {
          for (let i = 0; i < n; i++) {
            sway[o + i] = sa[i * aux];
            if (tile) { tile[(o + i) * 2] = sa[i * aux + 1]; tile[(o + i) * 2 + 1] = sa[i * aux + 2]; }
          }
        }
        o += n;
      }
      chunkEnd[k] = o;
      im.count = o;
    }
    // the bound: the alive stretch's centreline, padded for the crowns
    if (from >= 0) {
      s0 = S_MIN + from * CHUNK; s1 = S_MIN + (to + 1) * CHUNK;
      pointAt((s0 + s1) / 2, _p);
      let rad = 0;
      for (let s = s0; s <= s1; s += 2) { pointAt(s, _n); rad = Math.max(rad, Math.hypot(_n.x - _p.x, _n.z - _p.z)); }
      chunkBound.center.set(_p.x, FLOOR + 6, _p.z); chunkBound.radius = rad + 24;
    } else chunkBound.makeEmpty();
    shown.from = from; shown.to = to;
    writeTrees(true);
  }
  /**
   * Writes the full trees into the meshes after the chunks' instances (all: the chunks' were just
   * written, so the whole buffer goes up; otherwise only the trees' part of it). No allocation.
   */
  function writeTrees(all) {
    let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
    for (let t = 0; t < SLOTS; t++) {
      const sl = slots[t];
      if (sl.tree < 0) continue;
      const q = TREES[sl.tree];
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z);
    }
    if (x0 <= x1) { treeBound.center.set((x0 + x1) / 2, FLOOR + 6, (z0 + z1) / 2); treeBound.radius = Math.hypot(x1 - x0, z1 - z0) / 2 + 16; } else treeBound.makeEmpty();
    for (let k = 0; k < KINDS.length; k++) {
      const im = meshes[k];
      const g = im.geometry;
      const sway = g.attributes.aSway ? g.attributes.aSway.array : null;
      const tile = g.attributes.aTile ? g.attributes.aTile.array : null;
      const aux = KINDS[k][3];
      const o0 = chunkEnd[k];
      let o = o0;
      if (treeMax[k]) {
        const M = im.instanceMatrix.array; const C = im.instanceColor.array;
        for (let t = 0; t < SLOTS; t++) {
          const sl = slots[t];
          if (sl.tree < 0) continue;
          const n = Math.min(sl.n[k], capacity[k] - o);
          const sm = sl.m[k]; const sc = sl.c[k]; const sa = sl.a[k];
          for (let i = 0; i < n * 16; i++) M[o * 16 + i] = sm[i];
          for (let i = 0; i < n * 3; i++) C[o * 3 + i] = sc[i];
          if (sa && sway) {
            for (let i = 0; i < n; i++) {
              sway[o + i] = sa[i * aux];
              if (tile) { tile[(o + i) * 2] = sa[i * aux + 1]; tile[(o + i) * 2 + 1] = sa[i * aux + 2]; }
            }
          }
          o += n;
        }
      } else if (!all) continue;
      im.count = o;
      im.visible = o > 0;
      const a = all ? 0 : o0;
      const len = Math.max(1, o - a);
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(a * 16, len * 16); im.instanceMatrix.needsUpdate = true;
      im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(a * 3, len * 3); im.instanceColor.needsUpdate = true;
      if (sway) { g.attributes.aSway.clearUpdateRanges(); g.attributes.aSway.addUpdateRange(a, len); g.attributes.aSway.needsUpdate = true; }
      if (tile) { g.attributes.aTile.clearUpdateRanges(); g.attributes.aTile.addUpdateRange(a * 2, len * 2); g.attributes.aTile.needsUpdate = true; }
      // the bound: the alive chunks and the full trees
      const bs = im.boundingSphere;
      bs.copy(chunkBound);
      if (treeMax[k] && o > o0) { if (bs.isEmpty()) bs.copy(treeBound); else bs.union(treeBound); }
      if (bs.isEmpty()) bs.set(_v.set(0, FLOOR, 0), 1);
    }
  }
  /** The chunks for an eye at s, made at once (a seat, the court's view): under a card or at build. */
  function fill(from, to) {
    for (let c = from; c <= to && from >= 0; c++) {
      if (slotOf(c) && slotOf(c).ready) continue;
      const s = slotOf(c) || freeSlot(from, to);
      if (!s) continue;
      startJob(s, c);
      work(Infinity);
    }
    commit(from, to);
  }

  // ---- the trees' level of detail: full in the tree slots, far as the maze's trees -----------------
  // Each tree's far tree, made once: on its full tree's base, turned and leaning as it is, as tall as
  // its crown's top and as wide as its reach, in its leaves' colour (or its bark's, bare) as its
  // textures lay them; the instance colour is that over the maze tree's own vertex colour.
  const farMeshes = [];
  const farM = new Float32Array(NT * 16); const farC = new Float32Array(NT * 3); const farKind = new Uint8Array(NT);
  const lod = lodOn ? lodState(NT) : null;
  const farN = [0, 0];
  const eyeL = { x: 0, z: 0, fx: 0, fz: -1 };
  const trand = { s: 1 };
  /** A generator reseeded per tree (no closure a frame): mulberry32. */
  const tr = () => {
    trand.s = (trand.s + 0x6d2b79f5) | 0;
    let t = trand.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (lodOn) {
    const F = kit.far;
    for (let i = 0; i < NT; i++) {
      const q = TREES[i];
      const list = kit.bp[q.species];
      const bp = list[Math.floor(q.tone * 997) % list.length];
      const M = placeM(q, -0.15, true);
      const bare = !!q.bare;
      farKind[i] = bare ? 1 : 0;
      const ex = bp.ext;
      // (the cone a little narrower than the crown's reach: the crown is open cards, the cone solid;
      // the bare tree as the maze stands it, about as wide as tall, a little slimmer than its reach)
      const sy = ex.h / (bare ? F.bareH : F.coneH);
      const sxz = bare ? sy * 0.75 : (ex.r / F.coneR) * 0.65;
      _W.multiplyMatrices(M, _L.makeScale(sxz, sy, sxz));
      farM.set(_W.elements, i * 16);
      // its colour: the middle of its leaves' (as treeInto paints them, the middle of each spread) or its bark's
      const b = blendAt(q.s);
      const hh = hashOf(q.tone, 613.3); const hv = hashOf(q.tone, 3571.7);
      let tex; let base;
      if (bare) {
        if (q.species === 'oak') _c.setHSL(0.08 + (hh - 0.5) * 0.04, 0.24, 0.56 + q.tone * 0.14);
        else _c.setHSL(0.07 + (hh - 0.5) * 0.04, 0.15, 0.62 + q.tone * 0.14);
        grey(_c).multiplyScalar(0.8 + 0.4 * hv).lerp(DEAD_BARK, 0.55 + 0.45 * b);
        tex = F.bark; base = F.bareTint;
      } else {
        if (q.species === 'oak') _c.setHSL(0.225, 0.5, 0.52);
        else if (q.species === 'maple') { if (q.tone < 0.48) _c.setHSL(0.245, 0.52, 0.56); else if (q.tone < 0.78) _c.setHSL(0.135, 0.74, 0.59); else _c.setHSL(0.06, 0.78, 0.55); }
        else _c.setHSL(0.33, 0.44, 0.49);
        grey(_c).lerp(DEAD_LEAF, 0.75 * smooth(b * 1.15)).multiplyScalar(0.88 + 0.24 * hh);
        tex = F.atlas[q.species] || F.atlas.oak; base = F.coneTint;
      }
      farC[i * 3] = _c.r * tex[0] / Math.max(0.02, base[0]) * FAR_TONE;
      farC[i * 3 + 1] = _c.g * tex[1] / Math.max(0.02, base[1]) * FAR_TONE;
      farC[i * 3 + 2] = _c.b * tex[2] / Math.max(0.02, base[2]) * FAR_TONE;
    }
    const nOf = (k) => { let n = 0; for (let i = 0; i < NT; i++) n += farKind[i] === k ? 1 : 0; return n; };
    [['far:cone', F.cone, 0], ['far:bare', F.bare, 1]].forEach(([name, g, k]) => {
      const im = new THREE.InstancedMesh(g, kit.mats.far, Math.max(1, nOf(k)));
      im.name = `tunnel:${name}`;
      im.count = 0;
      im.castShadow = false; im.receiveShadow = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, WOOD_GREY);
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      // the bound: the whole walk (every far tree in it)
      let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
      for (const q of TREES) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
      im.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, FLOOR + 8, (z0 + z1) / 2), Math.hypot(x1 - x0, z1 - z0) / 2 + 24);
      im.frustumCulled = true;
      root.add(im);
      farMeshes[k] = im;
    });
  }
  /** Every tree not full into its far mesh (a few hundred floats: whenever one changes). */
  function writeFar() {
    const o = farN; o[0] = 0; o[1] = 0;
    for (let i = 0; i < NT; i++) {
      if (lod.full[i]) continue;
      const k = farKind[i]; const im = farMeshes[k];
      const A = im.instanceMatrix.array;
      for (let j = 0; j < 16; j++) A[o[k] * 16 + j] = farM[i * 16 + j];
      im.instanceColor.array[o[k] * 3] = farC[i * 3]; im.instanceColor.array[o[k] * 3 + 1] = farC[i * 3 + 1]; im.instanceColor.array[o[k] * 3 + 2] = farC[i * 3 + 2];
      o[k] += 1;
    }
    for (let k = 0; k < 2; k++) {
      const im = farMeshes[k];
      im.count = o[k]; im.visible = o[k] > 0;
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, Math.max(16, o[k] * 16)); im.instanceMatrix.needsUpdate = true;
      im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(0, Math.max(3, o[k] * 3)); im.instanceColor.needsUpdate = true;
    }
  }
  /** Fills tree i into a free slot (its full tree, the same every time it is made). */
  function fillTree(i) {
    let t = 0;
    while (t < SLOTS && slots[t].tree >= 0) t += 1;
    if (t >= SLOTS) return false;
    const sl = slots[t];
    for (let k = 0; k < KINDS.length; k++) sl.n[k] = 0;
    trand.s = 0x7a11 + i * 7919;
    treeInto(sl, TREES[i], tr);
    sl.tree = i; slotOfTree[i] = t;
    return true;
  }
  function freeTree(i) {
    const t = slotOfTree[i];
    if (t >= 0) { slots[t].tree = -1; slotOfTree[i] = -1; }
  }
  /** The trees' plan for an eye (x, z) looking along yaw (null: along the walk); cap Infinity: all at once. */
  function planTrees(x, z, yaw, cap) {
    eyeL.x = x; eyeL.z = z;
    if (yaw != null && Number.isFinite(yaw)) { eyeL.fx = -Math.sin(yaw); eyeL.fz = -Math.cos(yaw); }
    planLod(TREES, eyeL, LOD, lod, cap);
    if (!lod.nPromote && !lod.nDemote) return false;
    for (let k = 0; k < lod.nDemote; k++) freeTree(lod.demote[k]);
    for (let k = 0; k < lod.nPromote; k++) if (!fillTree(lod.promote[k])) lod.full[lod.promote[k]] = 0;
    swaps += lod.nPromote + lod.nDemote;
    return true;
  }
  let swaps = 0;

  // ---- the static mesh: the ground, the gate behind the start, the Tweedles (castle frame only) ----
  if (!court) root.add(staticMesh(kit, opts));
  if (court) {
    want.from = courtFrom; want.to = courtTo;
    fill(courtFrom, courtTo);
  } else {
    windowAt(eyeS, tier, want);
    pointAt(eyeS, _p);
    planTrees(_p.x, _p.z, Math.atan2(-_p.dx, -_p.dz), Infinity);
    writeFar();
    fill(want.from, want.to);
  }

  let lastNear = TUNNEL.length;
  const lastEye = { x: NaN, z: NaN };
  /**
   * Once a frame: the wind's clock, the trees' level of detail and the window. eye: the camera's place
   * (castle coordinates); yaw: where it looks (sim yaw; null: keeps the last). Expands at most `budget`
   * ms of a chunk a frame (a seat jumps: fill() then, under the card) and LOD.cap trees.
   */
  function update(eye, time, dt, budgetMs = 3, yaw = null) {
    WIND.uTime.value = time;
    if (court) { LIFT.ground.value.setRGB(0, 0, 0); LIFT.bark.value.setRGB(0, 0, 0); return; } // (the court's view: always whole, the wood's light alone)
    if (!eye) return;
    nearest(eye.x, eye.z, _n, lastNear);
    // the trees: every one drawn, full near the eye (a jump of more than 8 m is a seat: all at once)
    const jump = !(Math.hypot(eye.x - lastEye.x, eye.z - lastEye.z) < 8);
    lastEye.x = eye.x; lastEye.z = eye.z;
    const changed = planTrees(eye.x, eye.z, yaw, jump ? Infinity : LOD.cap);
    // far off the walk (up the road, the approach) its bushes, boulders and grass are left out
    const off = Math.max(Math.abs(_n.u), _n.s - TUNNEL.length, -TUNNEL.back - _n.s);
    if (Math.abs(_n.u) > 40 || _n.s > TUNNEL.length + 30) { // off the walk (the road, the castle): its mouth
      eyeS = TUNNEL.length;
    } else eyeS = clamp(_n.s, S_MIN, TUNNEL.length);
    lastNear = eyeS;
    if (off > HIDE) { want.from = -1; want.to = -1; } else windowAt(eyeS, tier, want);
    if (want.from === shown.from && want.to === shown.to) {
      if (changed) { writeFar(); writeTrees(false); }
      return;
    }
    if (changed) writeFar();
    if (want.from < 0 || want.from > shown.to || want.to < shown.from) { fill(want.from, want.to); return; } // a seat (under a card): all at once
    if (changed) writeTrees(false);
    // what to make next: the nearest missing chunk, ahead first
    const t0 = performance.now();
    const deadline = t0 + budgetMs;
    while (performance.now() < deadline) {
      if (job.slot) { if (!work(deadline)) return; continue; }
      let next = -1;
      const at = Math.floor((eyeS - S_MIN) / CHUNK);
      for (let d = 0; d <= CHUNKS && next < 0; d++) {
        for (let k = 0; k < 2; k++) { // ahead first, then behind (no array a frame)
          const c = k === 0 ? at + d : at - d;
          if (c < want.from || c > want.to) continue;
          const s = slotOf(c);
          if (!s || !s.ready) { next = c; break; }
        }
      }
      if (next < 0) { commit(want.from, want.to); return; }
      const s = slotOf(next) || freeSlot(want.from, want.to);
      if (!s) return;
      startJob(s, next);
    }
  }

  /** Seats the eye somewhere new (a seat under a card): its window and its near trees made at once. */
  function seat(eye, yaw = null) {
    if (court || !eye) return;
    nearest(eye.x, eye.z, _n);
    eyeS = clamp(_n.s, S_MIN, TUNNEL.length);
    lastNear = eyeS;
    lastEye.x = eye.x; lastEye.z = eye.z;
    if (planTrees(eye.x, eye.z, yaw, Infinity)) writeFar();
    windowAt(eyeS, tier, want);
    fill(want.from, want.to);
  }

  // ---- the light: the wood's at the gate to the road foot's at the mouth --------------------------
  const W = opts.wood || null;
  const _k = new THREE.Color();
  const _fogT = new THREE.Color(); const _hemiT = new THREE.Color(); const _gndT = new THREE.Color(); const _sunT = new THREE.Color();
  const _d = new THREE.Vector3();
  let lightS = TUNNEL.length;
  /**
   * After roadview.js has set the road's light (on the road's foot, dark 0): in the walk, pulls it
   * back toward the wood's at the gate by 1 - blendAt(s) of the eye. parts: castle.js's lights, fog,
   * sky. No allocation.
   */
  function light(parts, eye, renderer) {
    if (court || !W || !eye) return 0;
    nearest(eye.x, eye.z, _n, lightS);
    if (Math.abs(_n.u) > 40 || _n.s > TUNNEL.length) { lightS = TUNNEL.length; return 0; }
    lightS = clamp(_n.s, S_MIN, TUNNEL.length);
    const w = 1 - blendAt(lightS);
    if (w <= 0) return 0;
    // the first third starts as the owner's approved sample does (its grey haze, its sky-grey fill, a
    // brighter exposure), then turns to the wood's evening light at the gate and on to the road's
    const k = SAMPLE_K * (1 - smooth(lightS / (TUNNEL.length * 0.42)));
    _fogT.copy(W.fog).lerp(SAMPLE_LIGHT.fog, k);
    _hemiT.copy(W.hemi).lerp(SAMPLE_LIGHT.hemi, k);
    _gndT.copy(W.ground).lerp(SAMPLE_LIGHT.ground, k);
    _sunT.copy(W.sun).lerp(SAMPLE_LIGHT.sun, k);
    parts.fill.color.lerp(_sunT, w);
    parts.fill.intensity = lerp(parts.fill.intensity, W.sunI, w);
    _d.copy(parts.fill.position).normalize().lerp(W.sunDir, w).normalize().multiplyScalar(100);
    parts.fill.position.copy(_d);
    parts.hemi.color.lerp(_hemiT, w);
    parts.hemi.groundColor.lerp(_gndT, w);
    parts.hemi.intensity = lerp(parts.hemi.intensity, lerp(W.hemiI, SAMPLE_LIGHT.hemiI, k), w);
    parts.fog.color.lerp(_fogT, w);
    parts.fog.density = lerp(parts.fog.density, lerp(W.fogD, SAMPLE_LIGHT.fogD, k), w);
    parts.background.copy(parts.fog.color);
    const sm = parts.skyMat.uniforms;
    if (sm.uZenith) {
      sm.uZenith.value.lerp(W.skyTop, w);
      sm.uAhead.value.lerp(W.skyMid, w);
      sm.uBehind.value.lerp(W.skyLow, w);
      if (sm.uBelt) sm.uBelt.value.lerp(W.skyMid, w);
      if (sm.uShadowBand) sm.uShadowBand.value.lerp(W.skyMid, w);
      if (sm.sunDir) sm.sunDir.value.lerp(W.sunSeen, w).normalize();
    }
    if (renderer) renderer.toneMappingExposure = lerp(renderer.toneMappingExposure, W.exposure * (1 + SAMPLE_EXPOSURE * k), w);
    void _k;
    return w;
  }
  /** The road's land lift this frame (roadview.js, already scaled down by the wood's share): onto the walk's ground and wood. */
  function lift(ground, bark) {
    LIFT.ground.value.copy(ground);
    LIFT.bark.value.copy(bark);
  }

  function stats() {
    let tris = 0; let calls = 0; let inst = 0; let bytes = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const g = o.geometry;
      const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
      const n = o.isInstancedMesh ? o.count : 1;
      if (n <= 0) return;
      calls += 1; tris += t * n; inst += o.isInstancedMesh ? n : 0;
    });
    for (const im of [...meshes, ...farMeshes]) {
      bytes += im.instanceMatrix.array.byteLength + im.instanceColor.array.byteLength;
      for (const k of ['aSway', 'aTile']) if (im.geometry.attributes[k]) bytes += im.geometry.attributes[k].array.byteLength;
    }
    const geoBytes = (g) => Object.values(g.attributes).reduce((a, at) => a + at.array.byteLength, 0) + (g.index ? g.index.array.byteLength : 0);
    const gset = new Set();
    root.traverse((o) => { if (o.isMesh) gset.add(o.geometry); });
    for (const g of gset) bytes += geoBytes(g);
    const tex = kit.textures.reduce((a, t) => a + t.image.width * t.image.height * 4 * 1.33, 0);
    const poolBytes = [...pool, ...slots].reduce((a, s) => a + [...s.m, ...s.c, ...s.a].reduce((x, v) => x + (v ? v.byteLength : 0), 0), 0);
    // the trees: every one full or far, always all of them
    let full = 0;
    for (const sl of slots) if (sl.tree >= 0) full += 1;
    const far = farMeshes.reduce((a, im) => a + (im.visible ? im.count : 0), 0);
    const trees = lodOn ? {
      total: NT, full, far, drawn: full + far, near: LOD.near, nearBare: LOD.nearBare, swaps,
      // the triangles: of the full trees (leafy and bare apart), and of the far ones
      fullTris: (() => { const o = { leafy: 0, bare: 0 }; for (const sl of slots) { if (sl.tree < 0) continue; let t = 0; meshes.forEach((im, k) => { const g = im.geometry; t += sl.n[k] * (g.index ? g.index.count : g.attributes.position.count) / 3; }); o[TREES[sl.tree].bare ? 'bare' : 'leafy'] += t; } return o; })(),
      farTris: farMeshes.reduce((a, im) => a + (im.visible ? im.count * im.geometry.index.count / 3 : 0), 0),
    } : null;
    const kinds = [...meshes, ...farMeshes].map((im) => { const g = im.geometry; return [im.name.slice(7), im.count, Math.round(im.count * (g.index ? g.index.count : g.attributes.position.count) / 3)]; });
    const l3 = (c) => +(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b).toFixed(3);
    return { tier: tier.name, lift: [l3(LIFT.ground.value), l3(LIFT.bark.value)], kinds, calls, tris: Math.round(tris), instances: inst, eyeS: +eyeS.toFixed(1), window: [shown.from, shown.to], trees, gpuMB: +((bytes + tex) / 1048576).toFixed(1), poolMB: +(poolBytes / 1048576).toFixed(1), capacity };
  }

  /**
   * Frees what this walk holds on the GPU: its instanced meshes' instance buffers and their own
   * geometry copies (per-instance sway and atlas tile), and the static mesh's geometry, and takes it
   * out of the scene. The kit (textures, shared geometry, materials) stays for the other frame.
   */
  function dispose() {
    for (const im of meshes) {
      im.dispose(); // the instance matrix and colour buffers
      if (im.geometry.attributes.aSway) im.geometry.dispose(); // (its own copy; the plain ones are the kit's)
    }
    root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) o.geometry.dispose(); });
    for (const im of farMeshes) im.dispose(); // (their geometry and material are the kit's)
    for (const s of pool) { s.used = false; s.ready = false; }
    for (const sl of slots) sl.tree = -1;
    outer.removeFromParent();
  }

  outer.userData.tunnel = { stats, tier: tier.name, dispose };
  return { group: outer, update, seat, light, lift, stats, dispose };
}

/** The ground under the walk, the Caterpillar's gate behind its start, and the Tweedles: one mesh. */
function staticMesh(kit, opts) {
  const parts = [];
  const L = TUNNEL.length;
  const woodPath = new THREE.Color(opts.woodPath ?? 0xa39680); const woodFloor = new THREE.Color(opts.woodFloor ?? 0x5a5a46);
  const dirt = new THREE.Color(opts.dirt ?? 0x625646); const verge = new THREE.Color(opts.verge ?? 0x403d31);
  const c = new THREE.Color(); const c2 = new THREE.Color();
  const p = {};
  // the ground: a strip 30 m wide along the walk, trodden in the middle, the wood's floor grading to the
  // road's earth; its outer 4 m go to the hill's own colour, so its edge is lost in the land round it
  const us = [-15, -13, -11, -8, -6, -4.5, -3.4, -2.6, -2, -1.4, -0.7, 0, 0.7, 1.4, 2, 2.6, 3.4, 4.5, 6, 8, 11, 13, 15];
  const ss = []; for (let s = -TUNNEL.back; s <= L + 1e-6; s += 1) ss.push(s);
  const pos = new Float32Array(us.length * ss.length * 3); const col = new Float32Array(us.length * ss.length * 3);
  const walkUV = new Float32Array(us.length * ss.length * 3);
  const idx = [];
  ss.forEach((s, j) => {
    const b = blendAt(s);
    const mouth = smooth((s - (L - 15)) / 15); // the last 15 m: the road's own earth
    us.forEach((u, i) => {
      placeAt(s, u, p);
      const o = (j * us.length + i) * 3;
      const off = Math.abs(u);
      let y = TUNNEL.floor + (off > 3 ? 0.18 * smooth((off - 3) / 6) * (0.6 + 0.4 * S.noise(p.x * 0.3, 0, p.z * 0.3, 5)) : 0);
      if (opts.ground && off > 9) y = lerp(y, opts.ground(p.x, p.z) + 0.03, smooth((off - 9) / 6)); // into the hill at the strip's edge
      if (s > L - 3) y = lerp(y, TUNNEL.floor - 0.01, smooth((s - (L - 3)) / 3)); // flush with the road at the mouth
      pos[o] = p.x; pos[o + 1] = y; pos[o + 2] = p.z;
      walkUV[o] = u; walkUV[o + 1] = s; walkUV[o + 2] = 1;
      const trod = 1 - smooth((off - 1.2) / 1.1);
      c.copy(woodFloor).lerp(c2.copy(woodPath), trod * 0.92); // the sample's floor and trodden path
      c2.copy(verge).lerp(dirt, trod);
      c.lerp(c2, Math.max(b, mouth));
      // (by the gate, lifted toward the wood's own path as it reads under the court's sun and its grit map)
      c.multiplyScalar(lerp(1.3, 1, smooth(b * 2.5)) * (1 + 0.1 * S.noise(p.x * 1.7, 0, p.z * 1.7, 3) + 0.06 * S.noise(p.x * 5.3, 1, p.z * 4.7, 7)));
      c.lerp(c2.copy(verge).multiplyScalar(0.85 + 0.25 * S.noise(p.x * 0.3, 4, p.z * 0.3, 11)), smooth((off - 10.5) / 4)); // the edge: the hill's mottled dead grass (roadsurface.js does the same)
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      if (i < us.length - 1 && j < ss.length - 1) { const a = j * us.length + i; idx.push(a, a + 1, a + us.length, a + 1, a + us.length + 1, a + us.length); } // (wound to face up: u runs to the right of the way, s along it)
    });
  });
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  gg.setIndex(idx);
  gg.computeVertexNormals();
  parts.push(gg);
  const kinds = [[gg.attributes.position.count, null]];
  // the Caterpillar's gate (court.js gateKit, the wood's own) behind the start, in the walk's frame: its
  // stone darkened and tinted to the wood's light and haze (it was lit as the court's sunlit gate)
  if (opts.gate) {
    const g = opts.gate();
    const gc = g.attributes.color; const haze = new THREE.Color(opts.gateHaze ?? 0x4a4038);
    for (let i = 0; i < gc.count; i++) {
      c.setRGB(gc.getX(i), gc.getY(i), gc.getZ(i)).multiplyScalar(0.26).lerp(haze, 0.35);
      gc.setXYZ(i, c.r, c.g, c.b);
    }
    pointAt(TUNNEL.gate.s, p);
    g.rotateY(Math.atan2(-p.dx, -p.dz)); // its way along the walk
    g.translate(p.x, TUNNEL.floor, p.z);
    parts.push(g);
    kinds.push([g.attributes.position.count, 0]);
  }
  // the Tweedles
  const tw = buildTweedles({ seed: 1865 });
  for (const b of TWEEDLES) {
    const g = tw[b.name].clone();
    g.rotateY(b.headYaw);
    g.translate(b.x, TUNNEL.floor, b.z);
    parts.push(g);
    kinds.push([g.attributes.position.count, 2]);
  }
  const merged = S.merge(parts);
  // aWalk: the ground's own (u, s, 1), the Tweedles' 2 (the light on them), the gate's 0
  const aw = new Float32Array(merged.attributes.position.count * 3);
  aw.set(walkUV, 0);
  let v = kinds[0][0];
  for (let k = 1; k < kinds.length; k++) {
    const [n, kind] = kinds[k];
    for (let i = 0; i < n; i++) aw[(v + i) * 3 + 2] = kind;
    v += n;
  }
  merged.setAttribute('aWalk', new THREE.BufferAttribute(aw, 3));
  const mesh = new THREE.Mesh(merged, kit.mats.stat);
  mesh.name = 'tunnel:static';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
