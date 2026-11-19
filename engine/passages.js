// The ways on between the levels (issue #29, logic/journey.js): the yard's way down into the cave,
// and the Nave's way up into the Rose Court. Each opens in a short cut scene as its level is won
// (logic/wayout.js), wherever the rules put it (sim.waves.wayout), and stays: the yard's last foe
// spins off and slams into the concrete, and its blast breaks the floor open over a ramp of rubble
// going down into the dark (the owner, 2026-11-18); the Cantor fires one last blast up at the vault,
// which bores a ragged hole through it, and the rock comes down over about two seconds into the
// heap that is climbed up to it, while daylight pours through the hole. The ramp and the heap are
// real ground (logic/rubble.js). This file draws the places, what makes them (the flash, the shock,
// the slabs and smoke; the bolt, the cracks, the falling rock and dust), the two scenes' cameras and
// the follow's (the view along the path as the warden goes on). The foe itself is actors.js's, the
// Cantor fauna.js's, the ground's tremor main.js's, the sound wayoutcues.js's. The fade at the
// follow's end is main.js's and handover.js's.
//
// Everything is seeded (sculpt.js rng): the same crater, the same cracks, every time. Nothing is
// allocated per frame. A restore, or a skipped scene, shows each place as the scene leaves it.

import * as THREE from 'three';
import * as S from './sculpt.js';
import { MOUTHS, pathOf } from '../logic/journey.js';
import { caveField } from '../logic/cavemap.js';
import { WAYOUT, holeEdge, rimOf, rimDrop, RIM_FALL, sightTop, strikeAt, foeFlightAt, flightApex, vaultShotAt, vaultCrack, shaftLight, holeOpen } from '../logic/wayout.js';
import { FALL, heapAt, pileAt, pileDoneAt, fillOf, fallOf, chunkAt } from '../logic/rubblefall.js';
import { RUBBLE, heightAt, followAt } from '../logic/rubble.js';

const TAU = Math.PI * 2;
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const smooth = (k) => { const t = clamp01(k); return t * t * (3 - 2 * t); };
const mix = (a, b, k) => a + (b - a) * k;
const BASE_FOV = 75;

function glowTexture(inner) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- puffs: soft round billboards, one draw call a set ------------------------------------------

const PUFF_VERT = `
attribute vec4 aPS;
attribute vec4 aCol;
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
#include <fog_pars_vertex>
void main() {
  vUv = position.xy * 2.0;
  vCol = aCol;
  vSeed = float(gl_InstanceID) * 1.37;
  vec4 mvPosition = modelViewMatrix * vec4(aPS.xyz, 1.0);
  mvPosition.xy += position.xy * aPS.w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const PUFF_FRAG = `
uniform float lumps;
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
#include <common>
#include <fog_pars_fragment>
void main() {
  float a = smoothstep(1.0, 0.0, length(vUv));
  vec2 q = vUv * 2.3 + vSeed * vec2(3.1, 1.7);
  float n = 0.5 + 0.5 * sin(q.x + sin(q.y * 1.3)) * cos(q.y * 1.1 - sin(q.x * 0.9));
  a = mix(a * a, a * (0.45 + 0.55 * a) * (0.6 + 0.4 * n), lumps);
  gl_FragColor = vec4(vCol.rgb, vCol.a * a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * n soft round billboards in one mesh: smoke and dust (lumpy, drawn over, fogged with the room)
 * or light (additive, smooth, unfogged). set(i, x, y, z, size, r, g, b, alpha) writes one; an
 * alpha of 0 hides it; commit() sends what was written.
 */
function createPuffs(n, additive) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  const ps = new Float32Array(n * 4);
  const col = new Float32Array(n * 4);
  const aPS = new THREE.InstancedBufferAttribute(ps, 4).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.InstancedBufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPS', aPS);
  geo.setAttribute('aCol', aCol);
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { lumps: { value: additive ? 0 : 1 } }]),
    vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG,
    transparent: true, depthWrite: false, fog: !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = additive ? 3 : 2;
  return {
    mesh,
    set(i, x, y, z, size, r, g, b, a) {
      const k = i * 4;
      ps[k] = x; ps[k + 1] = y; ps[k + 2] = z; ps[k + 3] = size;
      col[k] = r; col[k + 1] = g; col[k + 2] = b; col[k + 3] = a;
    },
    hide(i) { col[i * 4 + 3] = 0; },
    clear() { for (let i = 0; i < n; i++) col[i * 4 + 3] = 0; },
    commit() { aPS.needsUpdate = true; aCol.needsUpdate = true; },
  };
}

// ---- the shaft's beam and the sky through the hole (critic CS-3) ---------------------------------

const BEAM_VERT = `
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  vH = uv.y;
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = `
uniform vec3 color;
uniform float opacity;
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  float face = pow(abs(dot(normalize(vN), normalize(vV))), 2.6); // nothing at its silhouette: a soft edge, no line (the art critic, C7)
  float foot = smoothstep(0.0, 0.3, vH); // its lower end fades out over the heap's top: no line where it meets the rock
  gl_FragColor = vec4(color, opacity * face * foot * mix(0.35, 1.0, vH)); // and thinner toward the floor
  #include <colorspace_fragment>
}`;

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#fff6e4');
  grad.addColorStop(0.45, '#f4f0e2');
  grad.addColorStop(1, '#c9d6dc');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- the scenes' cameras ------------------------------------------------------------------------
// Both stand where the warden stands (so the view is never inside a crate, a wall or rock, and the
// warden knows where the way out is from where they are) and turn to follow what happens; the
// yard's also rises over the crates. A long lens closes the distance instead of travel.

const view = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: BASE_FOV };
const aimA = { yaw: 0, pitch: 0 };
const aimB = { yaw: 0, pitch: 0 };

function aimAt(out, px, py, pz, x, y, z) {
  const dx = x - px; const dy = y - py; const dz = z - pz;
  out.yaw = Math.atan2(-dx, -dz);
  out.pitch = Math.atan2(dy, Math.hypot(dx, dz) || 1e-6);
  return out;
}
/** a turned toward b by k, the short way round. */
function turn(a, b, k) {
  let d = b.yaw - a.yaw;
  d -= Math.round(d / TAU) * TAU;
  a.yaw += d * k;
  a.pitch += (b.pitch - a.pitch) * k;
  return a;
}
function lookFrom(px, py, pz, aim, fov) {
  const c = Math.cos(aim.pitch);
  view.position.set(px, py, pz);
  view.target.set(px - Math.sin(aim.yaw) * c * 10, py + Math.sin(aim.pitch) * 10, pz - Math.cos(aim.yaw) * c * 10);
  view.fov = fov;
  return view;
}
const toRect = (x, z, b) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));

// ---- the yard's way down: a ramp of rubble into the dark under the broken floor -----------------
// (the owner, 2026-11-18: logic/rubble.js is its ground). Everything below is built once in the
// path's own frame (origin at the site, the path's end; +x along the path, start to end; +z its
// left), so a run's site only turns and places it. The yard's ground is one plane and cannot be
// cut, so its shader drops the fragments over the opening (cutGround: the same ragged edge as the
// walls are built on, holeHalf / holeStart / holeEnd), and what is under it is real geometry.

const YL = RUBBLE.length; // the lane, start to end (the black opening)
const YFAR = RUBBLE.length + RUBBLE.back.yard; // the opening's far edge
const PIT = -4.5; // how deep the opening's walls go before its black floor
const YP = Object.freeze({ sign: -1, height: RUBBLE.height, run: RUBBLE.run, length: RUBBLE.length }); // the ramp's slope (rubble.js heightAt)
const GROUND_EPS = 0.03;

/** The opening's half width u metres along the lane: ragged. */
function holeHalf(u) { return RUBBLE.half + 0.1 + 0.08 * Math.sin(2.9 * u + 0.6) + 0.05 * Math.sin(7.3 * u + 2.0); }
/** Its approach edge (u) v across: where the ramp leaves the yard's floor, torn. */
function holeStart(v) { return -0.05 + 0.07 * Math.sin(4.7 * v + 1.0); }
/** Its far edge (u) v across, rounded at the corners (w: the half width there). */
function holeEnd(v, w) { const k = Math.min(1, Math.abs(v) / w); return YFAR + 0.1 - 0.9 + 0.9 * Math.sqrt(1 - k * k) + 0.06 * Math.sin(6.1 * v + 0.3); }

const RAMP_PARS = `
uniform vec4 uRamp;
uniform float uRampOpen;
varying vec3 vRampW;`;
const RAMP_CUT = `
if ( uRampOpen > 0.0 ) {
  vec2 rd = uRamp.zw;
  vec2 rr = vRampW.xz - uRamp.xy;
  float ru = dot( rr, rd );
  float rv = dot( rr, vec2( -rd.y, rd.x ) );
  ru = ${YL.toFixed(3)} + ( ru - ${YL.toFixed(3)} ) / uRampOpen;
  rv = rv / uRampOpen;
  float rw = ${(RUBBLE.half + 0.1).toFixed(3)} + 0.08 * sin( 2.9 * ru + 0.6 ) + 0.05 * sin( 7.3 * ru + 2.0 );
  float rk = min( 1.0, abs( rv ) / rw );
  float rf = ${(YFAR + 0.1 - 0.9).toFixed(3)} + 0.9 * sqrt( 1.0 - rk * rk ) + 0.06 * sin( 6.1 * rv + 0.3 );
  float ra = -0.05 + 0.07 * sin( 4.7 * rv + 1.0 );
  if ( ru > ra && ru < rf && abs( rv ) < rw ) discard;
}`;

/**
 * Cuts the opening out of the yard's floor (its ground, its painted stripes): their programs
 * always carry the cut, off until the ramp is there (uRampOpen 0), so nothing is rebuilt as it opens.
 */
function cutGround(mats, uniforms) {
  for (const mat of mats) {
    if (!mat) continue;
    const before = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (before) before(sh, r);
      sh.uniforms.uRamp = uniforms.uRamp;
      sh.uniforms.uRampOpen = uniforms.uRampOpen;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRampW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRampW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>${RAMP_PARS}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>${RAMP_CUT}`);
    };
    const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
    mat.customProgramCacheKey = () => `${key()}ramp`;
    mat.needsUpdate = true;
  }
}

/** The opening's outline in the path's frame: [u, v] round it, approach edge first, then its left side, its far end, its right side. */
function holeOutline() {
  const pts = [];
  const wA = holeHalf(0);
  for (let i = 0; i <= 8; i++) { const v = -wA + (2 * wA * i) / 8; pts.push([holeStart(v), v]); }
  const sideEnd = YFAR - 0.8;
  for (let i = 1; i <= 24; i++) { const u = (sideEnd * i) / 24; pts.push([u, holeHalf(u)]); }
  const wE = holeHalf(sideEnd);
  for (let i = 1; i < 12; i++) { const a = Math.PI / 2 - (Math.PI * i) / 12; const v = wE * Math.sin(a); pts.push([holeEnd(v, wE), v]); }
  for (let i = 24; i >= 1; i--) { const u = (sideEnd * i) / 24; pts.push([u, -holeHalf(u)]); }
  return pts;
}

/** The rubble beyond the slope's foot, pouring on down into the opening (the follow goes down it into the dark). */
function deepY(u, v) {
  const k = Math.min(1, Math.max(0, (u - YL) / (YFAR - YL)));
  return heightAt(YP, YL) - 2.6 * Math.pow(k, 1.5) + 0.25 * smooth((Math.abs(v) - (RUBBLE.half - 0.25)) / 0.6);
}

/** The ramp's drawn floor at (u, v): the slope, banked with rubble against the trench's sides. */
function rampY(u, v) {
  const base = u <= 0 ? -GROUND_EPS : heightAt(YP, Math.min(u, YL));
  const bank = Math.max(0.2, -base - 0.6) * smooth((Math.abs(v) - (RUBBLE.half - 0.3)) / 0.55); // (at most 0.6 m of wall shows over it)
  return base + bank;
}

const DEBRIS = 26;
const EMBERS = 22;
const SMOKE = 10;
const GROUND = 12;
const BLAST = 3.8; // seconds after the strike the last of the smoke is gone

/**
 * The yard's way down: the floor broken open and a ramp of rubble going down 1.5 m under it to a
 * black opening, torn slabs and loose rubble round the rim, a faint amber breath rising out of the
 * dark (the yard's trail of light: the way). It stands where the run's win put it
 * (sim.waves.wayout: its site is the opening, its heading the ramp's) and shows once that is
 * open; while the scene plays it is made in front of the warden: a flash, a shock running out over
 * the concrete, slabs thrown up that come down round the opening and stay, smoke and dust.
 * ground: the yard's floor materials, cut where the opening is (cutGround).
 */
export function createCrater(parent, ground = []) {
  const group = new THREE.Group();
  group.name = 'yard:crater';
  group.visible = false;
  const rnd = S.rng(51);
  const place = new THREE.Group(); // the opening itself: the ramp, its walls, the dark, the rim, the breath
  group.add(place);
  const uniforms = { uRamp: { value: new THREE.Vector4(0, 0, 1, 0) }, uRampOpen: { value: 0 } };
  cutGround(ground, uniforms);
  const at = (u, v, y, out) => out.set(u - YL, y, v); // the path's frame -> the group's (origin at the end, +x along, +z left)
  const P = new THREE.Vector3();
  const outline = holeOutline();
  const n = outline.length;
  // the outward normal at each outline point (from its neighbours)
  const outN = outline.map((p, i) => {
    const a = outline[(i + n - 1) % n]; const b = outline[(i + 1) % n];
    let tx = b[0] - a[0]; let tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return [-tz, tx]; // (clockwise seen with u to the right and v up: the left of the tangent is out)
  });
  const FILL = new THREE.Color(0x3a4a4c).multiplyScalar(0.15); // the follow's fill: a 0.15 ambient on the ramp and its walls
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, flatShading: true, emissive: FILL, emissiveIntensity: 0 });
  const rampMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true, emissive: FILL, emissiveIntensity: 0 });
  const concrete = new THREE.Color(0x2a302f);
  const wallTone = new THREE.Color(0x3a4a4c); // the trench's broken sides: concrete grey-teal, the yard's own (not a brown pit)
  const scorch = new THREE.Color(0x14100c);
  const tone = new THREE.Color();

  // The trench's walls and the opening's: torn concrete at the top, darkening down to black.
  {
    const pos = []; const col = []; const idx = [];
    for (let i = 0; i < n; i++) {
      const [u, v] = outline[i]; const [ox, oz] = outN[i];
      const pit = u > YL - 0.02;
      const deep = pit ? PIT : rampY(Math.max(0, u), v) - 0.3; // (into the rubble banked against it)
      // five rows: the torn top over the yard's floor, its broken lip, then down to the banked
      // rubble. Down the opening: black just under the broken slab, leaning away under the yard's
      // floor (an opening into the dark, not a wall in the face of the follow that goes down it)
      const rows = pit
        ? [[0.07, GROUND_EPS], [0, -0.12], [-0.03, -0.3], [0.9, -1.4], [2.6, deep]]
        : [[0.07, GROUND_EPS], [0, -0.12], [-0.03, mix(-0.12, deep, 0.35)], [-0.05, mix(-0.12, deep, 0.7)], [-0.06, deep]];
      const k = 0.75 + 0.5 * rnd();
      for (const [push, y] of rows) {
        at(u + ox * push, v + oz * push, y, P);
        pos.push(P.x, P.y, P.z);
        const dim = pit ? (y > -0.2 ? 1 : y > -0.5 ? 0.3 : 0) : Math.max(0.01, 1 + Math.min(0, y) / 1.9); // dark down the trench, black down the opening
        if (y > 0) tone.copy(scorch).multiplyScalar(k);
        else tone.copy(wallTone).multiplyScalar(k * dim * (y < -0.05 ? 0.85 : 1));
        col.push(tone.r, tone.g, tone.b);
      }
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      for (let r = 0; r < 4; r++) {
        const a = i * 5 + r; const b = j * 5 + r;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    place.add(new THREE.Mesh(g, wallMat));
  }
  // The opening's black floor, far down.
  {
    const g = new THREE.PlaneGeometry(YFAR - YL + 4, 2 * (RUBBLE.half + 3)).rotateX(-Math.PI / 2); // (under the walls as they lean away too)
    g.translate((YFAR + YL) / 2 - YL + 1.3, PIT + 0.02, 0);
    place.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x010101, fog: false })));
  }
  // The ramp: its floor of rubble, the stones and the torn slabs on it and round the rim, their rebar.
  {
    const parts = [];
    const NU = 30; const NV = 14; const U0 = -0.75; const VW = RUBBLE.half + 0.5;
    const pos = []; const col = []; const idx = [];
    const warm = new THREE.Color(0x3a2e24);
    for (let i = 0; i <= NU; i++) {
      const u = U0 + ((YL - U0) * i) / NU;
      for (let j = 0; j <= NV; j++) {
        const v = -VW + (2 * VW * j) / NV;
        const lump = u > 0.05 ? 0.035 * (rnd() * 2 - 1) : 0;
        at(u + (i > 0 && i < NU ? (rnd() - 0.5) * 0.08 : 0), v + (j > 0 && j < NV ? (rnd() - 0.5) * 0.08 : 0), rampY(u, v) + lump, P);
        pos.push(P.x, P.y, P.z);
        const depth = 1 + 0.25 * Math.min(0, rampY(u, 0)) / RUBBLE.height; // (the ramp stays the brightest thing down there)
        tone.copy(rnd() < 0.12 ? warm : concrete).multiplyScalar((0.75 + 0.5 * rnd()) * depth);
        col.push(tone.r, tone.g, tone.b);
      }
    }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
      const a = i * (NV + 1) + j; const b = a + NV + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    // and on beyond the slope's foot: the rubble pours on down into the opening, steeper, into the black
    const base = (NU + 1) * (NV + 1);
    const ND = 10;
    for (let i = 1; i <= ND; i++) {
      const u = YL + ((YFAR + 0.1 - YL) * i) / ND;
      for (let j = 0; j <= NV; j++) {
        const v = -VW + (2 * VW * j) / NV;
        const y = deepY(u, v) + 0.05 * (rnd() * 2 - 1);
        at(u + (rnd() - 0.5) * 0.08, v + (j > 0 && j < NV ? (rnd() - 0.5) * 0.08 : 0), y, P);
        pos.push(P.x, P.y, P.z);
        tone.copy(concrete).multiplyScalar((0.75 + 0.5 * rnd()) * Math.max(0.01, 1 + (y + 1.5) / 1.1) * 0.55);
        col.push(tone.r, tone.g, tone.b);
      }
    }
    for (let i = 0; i < ND; i++) for (let j = 0; j < NV; j++) {
      const a = (i === 0 ? NU * (NV + 1) : base + (i - 1) * (NV + 1)) + j; const b = base + i * (NV + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const floor = new THREE.BufferGeometry();
    floor.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    floor.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    floor.setIndex(idx);
    parts.push(floor);
    // stones: most banked against the sides, some on the slope, some spilled out over the lip onto the yard
    const stone = new THREE.IcosahedronGeometry(1, 0).deleteAttribute('uv').deleteAttribute('normal');
    for (let i = 0; i < 96; i++) {
      const spill = i < 14;
      const bank = !spill && i % 5 < 3;
      const u = spill ? -0.9 + rnd() * 0.9 : 0.15 + rnd() * (YL - 0.35);
      const side = rnd() < 0.5 ? -1 : 1;
      const v = spill ? (rnd() * 2 - 1) * (RUBBLE.half + 0.6) : bank ? side * (RUBBLE.half - 0.35 + rnd() * 0.5) : (rnd() * 2 - 1) * (RUBBLE.half - 0.3);
      const s = (bank ? 0.1 + rnd() * 0.16 : 0.05 + rnd() * 0.09) * (spill ? 0.8 : 1);
      const g = stone.clone();
      g.scale(s * (0.8 + rnd() * 0.6), s * (0.45 + rnd() * 0.35), s * (0.8 + rnd() * 0.6));
      g.rotateY(rnd() * TAU).rotateX((rnd() - 0.5) * 0.6);
      const y = spill ? s * 0.25 : rampY(u, v) + s * 0.3;
      at(u, v, y, P);
      g.translate(P.x, P.y, P.z);
      parts.push(S.tint(g, rnd() < 0.15 ? 0x3a2e24 : 0x2a302f, 0.35, i));
    }
    // the floor's own broken slabs, laid down the slope as steps: what says "walk down this" (M1)
    for (let i = 0; i < 8; i++) {
      const u = 0.35 + i * 0.44 + (rnd() - 0.5) * 0.08;
      const run = Math.max(0.05, (heightAt(YP, u - 0.2) - heightAt(YP, u + 0.2)) / 0.4);
      const g = new THREE.BoxGeometry(0.46 + rnd() * 0.06, 0.1, 1.5 + rnd() * 0.5).deleteAttribute('uv');
      g.rotateZ(-Math.atan(run) * 0.6 + (rnd() - 0.5) * 0.08).rotateY((rnd() - 0.5) * 0.18);
      at(u, (rnd() - 0.5) * 0.3, rampY(u, 0) + 0.05, P);
      g.translate(P.x, P.y, P.z);
      parts.push(S.tint(g, 0x56625f, 0.25, 200 + i));
    }
    // the shoulders: a lip of rubble along both sides of the trench, so its edge is seen (N2)
    for (let i = 0; i < 40; i++) {
      const side = i % 2 ? 1 : -1;
      const u = 0.6 + (i >> 1) * ((YFAR - 1.2) / 20) + (rnd() - 0.5) * 0.15;
      const g = stone.clone();
      const sz = 0.14 + rnd() * 0.14;
      g.scale(sz * 1.3, sz * 0.7, sz).rotateY(rnd() * TAU);
      at(u, side * (holeHalf(u) + 0.22 + rnd() * 0.15), sz * 0.3, P);
      g.translate(P.x, P.y, P.z);
      parts.push(S.tint(g, 0x2f3836, 0.35, 300 + i));
    }
    // torn slabs: leaning on the trench's sides, hanging over the opening's far lip, lying broken round the rim
    for (let i = 0; i < 14; i++) {
      const kind = i < 6 ? 'lean' : i < 9 ? 'lip' : 'rim';
      const side = i % 2 ? 1 : -1;
      const w = 0.45 + rnd() * 0.6; const d = 0.35 + rnd() * 0.45;
      const g = new THREE.BoxGeometry(w, 0.12 + rnd() * 0.06, d).deleteAttribute('uv');
      let u; let v; let y;
      if (kind === 'lean') {
        u = 0.6 + rnd() * (YL - 1.2); v = side * (holeHalf(u) - 0.12);
        g.rotateX(-side * (0.55 + rnd() * 0.5)).rotateY((rnd() - 0.5) * 0.5);
        y = rampY(u, v) + 0.18;
      } else if (kind === 'lip') {
        const vv = (rnd() * 2 - 1) * (RUBBLE.half - 0.2);
        v = vv; u = holeEnd(vv, holeHalf(YFAR - 0.8)) + 0.15;
        g.rotateZ(-(0.25 + rnd() * 0.35)).rotateY((rnd() - 0.5) * 0.6);
        y = -0.02;
      } else {
        const p = outline[Math.floor(rnd() * n)]; const o = outN[outline.indexOf(p)];
        const out = 0.35 + rnd() * 0.8;
        u = p[0] + o[0] * out; v = p[1] + o[1] * out;
        g.rotateX((rnd() - 0.5) * 0.5).rotateY(rnd() * TAU).rotateZ((rnd() - 0.5) * 0.4);
        y = 0.08;
      }
      at(u, v, y, P);
      g.translate(P.x, P.y, P.z);
      parts.push(S.tint(g, 0x2a302f, 0.3, 40 + i));
      if (kind !== 'rim' && rnd() < 0.8) {
        // its rebar, bent out of the broken edge
        const bar = new THREE.CylinderGeometry(0.012, 0.012, 0.35 + rnd() * 0.35, 4).deleteAttribute('uv');
        bar.rotateZ(Math.PI / 2 + (rnd() - 0.5) * 0.9).rotateY(rnd() * TAU);
        bar.translate(P.x + (rnd() - 0.5) * 0.3, P.y + 0.05, P.z + (rnd() - 0.5) * 0.3);
        parts.push(S.tint(bar, 0x5a3420, 0.2, 80 + i));
      }
    }
    const merged = S.merge(parts);
    place.add(new THREE.Mesh(merged, rampMat));
  }
  // The rim: scorched where the floor broke, fading out into the concrete (colour and alpha), so it ends nowhere.
  {
    const pos = []; const col = []; const idx = [];
    for (let i = 0; i < n; i++) {
      const [u, v] = outline[i]; const [ox, oz] = outN[i];
      const torn = 0.75 + 0.3 * Math.sin(i * 1.7 + 0.4) + 0.15 * Math.sin(i * 4.3);
      const rows = [[0.02, 0.055 + 0.03 * Math.sin(i * 2.3), 1], [0.35 * torn, 0.03, 0.75], [torn, 0.015, 0]];
      const k = 0.75 + 0.5 * rnd();
      for (const [push, y, a] of rows) {
        at(u + ox * push, v + oz * push, y, P);
        pos.push(P.x, P.y, P.z);
        tone.copy(scorch).lerp(concrete, 1 - a).multiplyScalar(k);
        col.push(tone.r, tone.g, tone.b, a);
      }
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      for (let r = 0; r < 2; r++) { const a = i * 3 + r; const b = j * 3 + r; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    place.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
  }
  // The breath: a faint amber glow out of the black opening (the way).
  const breath = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,179,71,0.5)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); // (unfogged, as the lanterns' halos are: it is the way, and must read across the yard)
  breath.position.set((YFAR - YL) * 0.45, -0.6, 0);
  breath.scale.set(3.4, 3.0, 1);
  place.add(breath);

  // The blast's own pieces: small slabs thrown up and out, which come down round the opening and
  // stay (low, outside it, no collision: the warden walks over them).
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), DEBRIS);
  debris.frustumCulled = false;
  const D = []; // [restX, restZ, sx, sy, sz, yaw, tiltX, tiltZ, hang, peak, spinX, spinZ] in the group's frame
  for (let i = 0; i < DEBRIS; i++) {
    const big = i % 3 === 0;
    const p = outline[Math.floor((i / DEBRIS) * n)]; const o = outN[Math.floor((i / DEBRIS) * n)];
    const out = 0.3 + rnd() * 0.6;
    at(p[0] + o[0] * out, p[1] + o[1] * out, 0, P);
    D.push([
      P.x, P.z,
      (big ? 0.34 : 0.16) + rnd() * 0.2, 0.06 + rnd() * 0.08, (big ? 0.26 : 0.12) + rnd() * 0.16,
      rnd() * TAU, (rnd() - 0.5) * 0.45, (rnd() - 0.5) * 0.45,
      0.6 + rnd() * 0.65, 1.3 + rnd() * rnd() * 4.2, (rnd() - 0.5) * 22, (rnd() - 0.5) * 22,
    ]);
    const k = 0.75 + rnd() * 0.5;
    debris.setColorAt(i, tone.setRGB(0.024 * k, 0.03 * k, 0.029 * k)); // the concrete's own grey-green (0x2a302f)
  }
  group.add(debris);
  // (critic CS-11: no ring of light runs out over the concrete; the ground's dust carries the shock)
  const smoke = createPuffs(SMOKE + GROUND, false);
  const fire = createPuffs(2 + EMBERS, true);
  group.add(smoke.mesh, fire.mesh);
  const SM = []; // [delay, life, rise, driftX, driftZ, offX, offZ]
  for (let i = 0; i < SMOKE; i++) SM.push([i * 0.07, 2.5 + rnd() * 1.1, 3 + rnd() * 3.6, 0.25 + rnd() * 0.3, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.2]);
  const GR = []; // [angle, reach, life]
  for (let i = 0; i < GROUND; i++) GR.push([(i / GROUND) * TAU + rnd() * 0.4, 3.6 + rnd() * 3.6, 1.5 + rnd() * 0.8]);
  const EM = []; // [vx, vy, vz, life, size]
  for (let i = 0; i < EMBERS; i++) {
    const a = rnd() * TAU; const out = 1.5 + rnd() * 5.5;
    EM.push([Math.cos(a) * out, 4.5 + rnd() * 6.5, Math.sin(a) * out, 0.7 + rnd() * 0.8, 0.12 + rnd() * 0.12]);
  }
  parent.add(group);
  // The way's light: the blast's flash, then the amber breath on the ramp, its walls and the slabs.
  // It is always in the yard (dark until the ramp is there), so no program is rebuilt as it comes on.
  const light = new THREE.PointLight(0xffa040, 0, 18, 2);
  parent.add(light);

  const o3 = new THREE.Object3D();
  let reduced = false;
  let clock = -1; // seconds into the scene (it runs on past the scene's end, until the smoke is gone); -1: none playing
  let playing = null; // the scene the clock belongs to
  let settled = false; // the pieces lie where they stay

  function poseDebris(bt) {
    for (let i = 0; i < DEBRIS; i++) {
      const d = D[i];
      const k = bt < 0 ? 0 : Math.min(1, bt / d[8]);
      const r = 0.2 + 0.8 * Math.pow(k, 0.85);
      const restY = d[3] * 0.5 + 0.02;
      o3.position.set(d[0] * r, restY * k + 4 * d[9] * k * (1 - k), d[1] * r);
      o3.rotation.set(d[6] + d[10] * (1 - k), d[5], d[7] + d[11] * (1 - k));
      const s = bt < 0 ? 0 : 1;
      o3.scale.set(d[2] * s, d[3] * s, d[4] * s);
      o3.updateMatrix();
      debris.setMatrixAt(i, o3.matrix);
    }
    debris.instanceMatrix.needsUpdate = true;
  }

  /** The opening as the scene leaves it (and as a restore or a skip finds it). */
  function settle() {
    poseDebris(1e3);
    smoke.clear(); smoke.commit();
    fire.clear(); fire.commit();
    place.scale.setScalar(1);
    settled = true;
  }

  function blast(bt) {
    settled = false;
    const dim = reduced ? 0.3 : 1;
    place.scale.setScalar(0.4 + 0.6 * smooth(bt / 0.12)); // the floor tears open under the flash
    poseDebris(bt);
    // the flash, and the fire's glow under the smoke
    const fk = clamp01(bt / 0.38);
    fire.set(0, 0, 0.9, 0, 6 + 20 * fk, 1, 0.82 + 0.1 * (1 - fk), 0.5 + 0.4 * (1 - fk), dim * (1 - fk) * (1 - fk));
    const gk = clamp01(bt / 2.4);
    fire.set(1, 0, 1.2 + bt * 0.6, 0, 6.5, 1, 0.5, 0.16, 0.5 * dim * (1 - gk) * (1 - gk));
    for (let i = 0; i < EMBERS; i++) {
      const e = EM[i];
      const y = 0.3 + e[1] * bt - 6 * bt * bt;
      const k = bt / e[3];
      if (k >= 1 || y < 0.03) { fire.hide(2 + i); continue; }
      fire.set(2 + i, e[0] * bt, y, e[2] * bt, e[4], 1, 0.75 - 0.4 * k, 0.32 - 0.26 * k, (1 - k) * (1 - k));
    }
    fire.commit();
    // the smoke: a dark column, warm underneath at first, and the concrete's dust along the ground
    for (let i = 0; i < SMOKE; i++) {
      const s = SM[i];
      const a = bt - s[0];
      if (a <= 0 || a >= s[1]) { smoke.hide(i); continue; }
      const up = 1 - Math.exp(-a * 1.4);
      const warm = 1 - clamp01(a / 0.9);
      smoke.set(i, s[5] + s[3] * a, 0.5 + s[2] * up, s[6] + s[4] * a, 1.5 + 2.8 * (1 - Math.exp(-a * 1.2)) + i * 0.1,
        mix(0.075, 0.42, warm), mix(0.095, 0.17, warm), mix(0.1, 0.05, warm),
        0.85 * smooth(a / 0.15) * Math.pow(1 - a / s[1], 1.3));
    }
    for (let i = 0; i < GROUND; i++) {
      const g = GR[i];
      if (bt >= g[2]) { smoke.hide(SMOKE + i); continue; }
      const r = 1.2 + g[1] * (1 - Math.exp(-bt * 2.2));
      smoke.set(SMOKE + i, Math.cos(g[0]) * r, 0.45 + 0.5 * bt, Math.sin(g[0]) * r, 1.2 + 2.4 * (1 - Math.exp(-bt * 1.5)),
        0.2, 0.25, 0.24, 0.55 * smooth(bt / 0.1) * Math.pow(1 - bt / g[2], 1.5));
    }
    smoke.commit();
  }

  // ---- the scene's camera: from the warden's eye, up over the crates. It closes on the foe as its
  // lantern overloads (CS-7: the take-off must read), holds the foe and the site in one frame through
  // the flight (the ground and where it is headed always in view), settles on the opening, and comes
  // home to the warden's eye turned toward it (CS-1: sc.homeYaw / homePitch, the heading play resumes on).
  let camFor = null;
  const cam = { top: 0, fov: BASE_FOV, apex: 0, close: BASE_FOV };
  const flight = {};
  const fovOf = (halfTan) => Math.max(22, Math.min(BASE_FOV, (2 * Math.atan(halfTan)) * 180 / Math.PI));
  function camera(sim, sc) {
    const o = sim.waves.wayout;
    const pl = sim.player;
    const Y = WAYOUT.yard;
    const eyeY = pl.y + sim.cfg.player.eyeHeight;
    if (camFor !== sc) {
      camFor = sc;
      const boxes = sim.boxes || sim.cfg.boxes || [];
      const d = Math.hypot(o.x - pl.x, o.z - pl.z);
      let top = Math.min(eyeY + 4.5, eyeY + 0.9 + 0.12 * d);
      top = Math.max(top, sightTop(pl, o, boxes)); // high enough to see the site over every crate between, as drawn (the winch's drum too)
      cam.top = Math.min(top, eyeY + Y.sight); // wayout.js only picks a yard site this height sees
      cam.fov = fovOf(6 / Math.hypot(d, cam.top));
      cam.close = fovOf(3 / Math.max(0.5, Math.hypot(sc.foe.x - pl.x, sc.foe.z - pl.z))); // the foe about a sixth of the frame
      cam.apex = flightApex(sc.foe, o, boxes);
    }
    const t = sc.t;
    const strike = strikeAt('crater');
    const home = smooth((t - (sc.length - Y.home)) / Y.home);
    const y = eyeY + (cam.top - eyeY) * smooth((t - 0.1) / (strike - 0.1)) * (1 - home);
    const f = foeFlightAt(sc, o, t, flight, cam.apex);
    const air = smooth((t - Y.beat) / 0.3); // out of the close view of the take-off, into the flight's
    const land = smooth((t - (strike - 0.5)) / 0.5); // onto the site as it lands
    const q = air * (0.35 + 0.65 * land); // the aim: on the foe, then a third of the way to the site, then the site
    // the lens for the flight: wide enough for the foe and the site together, with a margin; never tighter than the opening's own
    const fx = f.x - pl.x; const fy = f.y + 1 - y; const fz = f.z - pl.z;
    const sx = o.x - pl.x; const sy = 0.3 - y; const sz = o.z - pl.z;
    const apart = Math.acos(Math.max(-1, Math.min(1, (fx * sx + fy * sy + fz * sz) / ((Math.hypot(fx, fy, fz) || 1) * (Math.hypot(sx, sy, sz) || 1)))));
    const both = Math.max(cam.fov, Math.min(BASE_FOV, 2 * 0.65 * 1.15 * apart * 180 / Math.PI));
    const fov = mix(mix(BASE_FOV, cam.close, smooth(t / 0.3)), both, air);
    aimA.yaw = pl.yaw; aimA.pitch = pl.pitch;
    aimAt(aimB, pl.x, y, pl.z, mix(f.x, o.x, q), mix(f.y + 1, 0.3, q), mix(f.z, o.z, q));
    turn(aimA, aimB, smooth(t / 0.4));
    if (Number.isFinite(sc.homeYaw)) { aimB.yaw = sc.homeYaw; aimB.pitch = sc.homePitch; } else { aimB.yaw = pl.yaw; aimB.pitch = pl.pitch; }
    turn(aimA, aimB, home);
    return lookFrom(pl.x, y, pl.z, aimA, mix(fov, BASE_FOV, home));
  }

  return {
    group, camera, follow: followCamera,
    setReducedFlash(v) { reduced = !!v; },
    update(sim, dt, time) {
      const w = sim && sim.cfg && sim.cfg.room === 'yard' ? sim.waves : null;
      const o = w && w.wayout && w.wayout.kind === 'crater' ? w.wayout : null;
      if (!o) { // no opening in this run (yet): nothing shows, nothing is lit, the floor is whole
        group.visible = false;
        light.intensity = 0;
        uniforms.uRampOpen.value = 0;
        clock = -1; playing = null;
        return;
      }
      const sc = w.scene && w.scene.kind === 'crater' ? w.scene : null;
      if (sc) { clock = sc.t; playing = sc; }
      else if (playing) {
        if (clock < playing.length - 0.11) clock = -1; // skipped: the opening is simply there
        playing = null;
      } else if (clock >= 0) clock += dt;
      const bt = clock < 0 ? -1 : clock - strikeAt('crater');
      if (bt >= BLAST) clock = -1;
      // the path's frame: the site is its end; it turns to the heading (a site kept with none faces -z)
      const hl = Math.hypot(o.dx || 0, o.dz || 0);
      const dx = hl > 1e-9 ? o.dx / hl : 0; const dz = hl > 1e-9 ? o.dz / hl : -1;
      group.position.set(o.x, 0, o.z);
      group.rotation.y = Math.atan2(-dz, dx);
      // the way's light: at the ramp's foot, 0.3 m over its floor, lighting the slope (M1); while the
      // follow plays, a lamp 3 m on down the rubble for the eye to travel toward (S2: the same light)
      const fol = w.scene && w.scene.kind === 'descent' ? w.scene : null;
      const lu = fol ? YL + 0.9 : YL - 0.3;
      light.position.set(o.x + dx * (lu - YL), (fol ? deepY(lu, 0) : heightAt(YP, lu)) + 0.3, o.z + dz * (lu - YL));
      const fill = fol ? smooth(fol.t / 0.3) : 0;
      wallMat.emissiveIntensity = fill; rampMat.emissiveIntensity = fill;
      group.visible = !!o.open;
      if (!o.open) { light.intensity = 0; uniforms.uRampOpen.value = 0; return; }
      const live = clock >= 0 && bt >= 0;
      if (live) blast(bt);
      else if (!settled) settle();
      uniforms.uRamp.value.set(o.x - dx * YL, o.z - dz * YL, dx, dz);
      uniforms.uRampOpen.value = place.scale.x;
      const glow = 0.55 + 0.2 * Math.sin(time * 1.3);
      breath.material.opacity = 0.7 * glow * (live ? smooth((bt - 0.5) / 1.5) : 1);
      const fk = live ? clamp01(bt / 0.45) : 1;
      light.intensity = (live ? 900 * (reduced ? 0.25 : 1) * (1 - fk) * (1 - fk) : 0) + (fol ? 6 : 9) * glow * (live ? smooth(bt / 1.2) : 1);
    },
  };
}

// ---- the follow: the view down the ramp (up the heap) as the warden goes on -----------------------

const followView = {};
/**
 * The rubble's follow (journey.js: scene 'descent' in the yard, 'ascent' in the cave): from the
 * warden's eye on along the path, by rubble.js followAt. Shared by both rooms.
 */
function followCamera(sim, sc) {
  const path = pathOf(sim);
  if (!path || !sc || !sc.from) return null;
  followAt(path, sc.from, sim.cfg.player.eyeHeight, sc.t, followView);
  aimA.yaw = followView.yaw; aimA.pitch = followView.pitch;
  return lookFrom(followView.x, followView.y, followView.z, aimA, BASE_FOV);
}

// ---- the Nave's shaft ---------------------------------------------------------------------------

const PIECES = 30;
const HERO = 4; // the first of them: slabs with real mass, which let go first, from the middle (critic CS-9)
const LIP = 16;
const QUADS = 260; // the cracks' ribbon, at most
const D_CEIL = 8;
const D_VEIL = 10;
const D_FLOOR = 12;
const SPARKS = 16;
const DUST = 6.5; // seconds after the strike the last of the dust is gone
const PINK = new THREE.Color(0xff4f8b);
const DAY = new THREE.Color(0xfff1d0);
const FISSURE = new THREE.Color(0x0b0d10); // a crack in rock is dark (critic CS-4)
const DAYLIGHT = 40; // the shaft's light on the heap and the floor, candela (80 blew the heap's near faces out: the art critic; the pool's glow is its own, unlit)
const LIGHT_Y = 3.3; // the daylight's height over the floor: over the heap's top (1.5 m), under the hole
const RIMLIGHT = 30; // and on the hole's broken lip and the vault round it (critic CS-3)
const CRACK_REACH = 3.2; // metres the cracks run out from the strike

/**
 * The Nave's way up: a hole broken through the vault, a shaft of daylight down through it onto
 * the floor, the motes turning in it, a patch of light where it lands, and the vault's rubble
 * lying round it (low, outside the mouth, no collision). It stands where the run's win put it
 * (sim.waves.wayout) and shows once that is open; while the scene plays the Cantor's last blast
 * goes up to the vault there, the vault cracks, lets go piece by piece from the middle outward and
 * comes down, and the daylight comes on (logic shaftLight). cave: the cave's build (its ceilAt and
 * floorAt are the drawn rock's heights, and its group holds the shaft's one light).
 */
export function createShaft(parent, cave) {
  const m = MOUTHS.cave;
  const C = WAYOUT.cave;
  const group = new THREE.Group();
  group.name = 'cave:shaft';
  group.visible = false;
  // The beam (critic CS-3): light in dusty air, not a cone of glass. Its edges fall away (it is
  // brightest where the eye looks through its middle) and it thins toward the floor.
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(m.r * 0.85, m.r * 1.15, 1, 28, 1, true).translate(0, 0.5, 0),
    new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0xfff1d0) }, opacity: { value: 0.26 } },
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }),
  );
  group.add(beam);
  const pool = new THREE.Mesh( // where the beam lands: on the heap's top
    new THREE.CircleGeometry(m.r * 0.75, 24).rotateX(-Math.PI / 2).translate(0, RUBBLE.height + 0.06, 0),
    new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,244,214,0.9)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  group.add(pool);
  const N = 30;
  const pos = new Float32Array(N * 3);
  const rnd = S.rng(77);
  const seeds = [];
  for (let i = 0; i < N; i++) seeds.push([rnd() * TAU, rnd() * m.r, rnd(), 0.1 + rnd() * 0.25]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // round, soft motes (the art critic, C10: not square specks), as the other dust is drawn
  const motes = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture('rgba(255,255,255,1)'), color: 0xfff6e0, size: 0.06, transparent: true, opacity: 0.45, depthWrite: false, fog: false }));
  motes.frustumCulled = false;
  group.add(motes);

  // The heap (the owner, 2026-11-18; logic/rubble.js is its ground): the fallen rock, built in the
  // path's frame (origin at the site, the path's end, under the hole; +x along the path, start to
  // end; +z its left) and turned to the run's heading. Its lane is the slope the warden climbs; its
  // flanks and its back fall away steeply (the walls rubble.js keeps). It is not raised out of the
  // floor: it is piled (the owner, 2026-11-19; logic/rubblefall.js), from under the hole outward as
  // the rock lands on it, each of its points (and each of its stones, by where it lies) at the
  // pile's height there until the pile is the heap (pileAt), so that FALL.last seconds after the
  // strike it is exactly the heap drawn here.
  const HL = RUBBLE.length; const HB = RUBBLE.back.cave;
  const heapY = heapAt;
  const heap = new THREE.Group();
  heap.visible = false;
  group.add(heap);
  let heapGeo = null; // its merged geometry, and per vertex: where it lies (u, v in the path's frame), the heap's height there, its own height drawn
  let heapU = null; let heapV = null; let heapH = null; let heapBase = null;
  let heapAtT = NaN; // the pile's time it was last posed at
  {
    const rh = S.rng(91);
    const parts = [];
    const anchors = []; // per part: the (u, v) its vertices lie by (null: each vertex by its own place)
    const NU = 34; const NV = 16; const U0 = -0.9; const U1 = HL + HB + 0.9; const VW = RUBBLE.half + RUBBLE.flank + 0.15;
    const pos = []; const col = []; const idx = []; const own = [];
    const c = new THREE.Color();
    for (let i = 0; i <= NU; i++) {
      const u = U0 + ((U1 - U0) * i) / NU;
      for (let j = 0; j <= NV; j++) {
        const v = -VW + (2 * VW * j) / NV;
        own.push(u, v);
        const onLane = Math.abs(v) <= RUBBLE.half && u >= 0 && u <= HL;
        const edge = i === 0 || i === NU || j === 0 || j === NV;
        const y = heapY(u, v) + (edge ? -0.08 : (onLane ? 0.04 : 0.09) * (rh() * 2 - 1));
        pos.push(u - HL + (edge ? 0 : (rh() - 0.5) * 0.1), y, v + (edge ? 0 : (rh() - 0.5) * 0.1));
        const k = (0.7 + 0.6 * rh()) * (onLane ? 1.2 : 1); // the climbed lane a little paler: its rock dust trodden
        c.setRGB(0.026 * k, 0.034 * k, 0.034 * k); // (a cool basalt, toward #2a3a3a in its shade)
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
      const a = i * (NV + 1) + j; const b = a + NV + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    parts.push(g); anchors.push(own);
    const stone = new THREE.IcosahedronGeometry(1, 0).deleteAttribute('uv').deleteAttribute('normal');
    // the heap's flanks ringed with larger boulders: its edge (a wall to the rules) is seen (N2)
    for (let i = 0; i < 5; i++) {
      const u = 0.9 + i * 0.75; const v = (i % 2 ? 1 : -1) * (RUBBLE.half + 0.35);
      const sz = 0.42 + 0.1 * rh();
      const st = stone.clone();
      st.scale(sz * 1.2, sz * 0.8, sz).rotateY(rh() * TAU);
      st.translate(u - HL, heapY(u, v) + sz * 0.35, v);
      parts.push(S.tint(st, new THREE.Color(0.03, 0.036, 0.04).getHex(), 0.3, 500 + i)); anchors.push([u, v]);
    }
    for (let i = 0; i < 84; i++) {
      const flank = i % 3 !== 0;
      const u = flank ? 0.2 + rh() * (HL + HB) : 0.1 + rh() * (HL - 0.2);
      const v = flank ? (rh() < 0.5 ? -1 : 1) * (RUBBLE.half - 0.1 + rh() * RUBBLE.flank) : (rh() * 2 - 1) * (RUBBLE.half - 0.25);
      const s = flank ? 0.14 + rh() * 0.22 : 0.06 + rh() * 0.1;
      const st = stone.clone();
      st.scale(s * (0.8 + rh() * 0.6), s * (0.5 + rh() * 0.4), s * (0.8 + rh() * 0.6)).rotateY(rh() * TAU).rotateX((rh() - 0.5) * 0.7);
      st.translate(u - HL, heapY(u, v) + s * 0.25, v);
      const k = 0.7 + 0.6 * rh();
      parts.push(S.tint(st, new THREE.Color(0.022 * k, 0.025 * k, 0.031 * k).getHex(), 0.3, i)); anchors.push([u, v]);
    }
    heapGeo = S.merge(parts);
    const nv = heapGeo.attributes.position.count;
    heapU = new Float32Array(nv); heapV = new Float32Array(nv); heapH = new Float32Array(nv); heapBase = new Float32Array(nv);
    let at = 0;
    for (let pi = 0; pi < parts.length; pi++) {
      const a = anchors[pi]; const cnt = parts[pi].attributes.position.count;
      for (let q = 0; q < cnt; q++, at++) {
        const u = a.length === 2 ? a[0] : a[q * 2]; const v = a.length === 2 ? a[1] : a[q * 2 + 1];
        heapU[at] = u; heapV[at] = v; heapH[at] = heapY(u, v);
        heapBase[at] = heapGeo.attributes.position.getY(at);
      }
    }
    heapGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    const mesh = new THREE.Mesh(heapGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.06, flatShading: true }));
    mesh.frustumCulled = false; // (its bounds are the finished heap's: it only ever lies within them)
    heap.add(mesh);
  }

  /** The heap as the pile has it bt seconds after the strike (Infinity: the heap, whole). */
  function poseHeap(bt) {
    const b = bt >= FALL.last ? Infinity : bt;
    if (b === heapAtT) return;
    heapAtT = b;
    const arr = heapGeo.attributes.position.array;
    for (let i = 0, n = heapBase.length; i < n; i++) arr[i * 3 + 1] = heapBase[i] + pileAt(heapU[i], heapV[i], b, heapH[i]) - heapH[i];
    heapGeo.attributes.position.needsUpdate = true;
  }

  // The hole: bored through the vault (the shell's fragments inside it are dropped: cave.setHole),
  // a ragged chimney up through the rock (pale near the top, where the day falls on it), the sky
  // at its top, and the broken lip left round it. holeR: the hole's ragged edge, the same curve the
  // shell's cut uses (cave.js uHoleCut).
  const holeR = holeEdge; // (logic/wayout.js: the rim's stalactites are judged against the same edge)
  const CHIMNEY = 3.2; // metres it goes up through the rock over the vault's underside
  const chimney = new THREE.Mesh((() => {
    const SEG = 48; const ROWS = 10;
    const pos = []; const col = []; const idx = [];
    const rc = S.rng(29);
    for (let j = 0; j <= ROWS; j++) {
      const y = j / ROWS;
      for (let i = 0; i <= SEG; i++) {
        const a = (i % SEG) / SEG * TAU;
        const r = m.r * holeR(a) * (j === 0 ? 1 : 0.93 + 0.12 * rc());
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
        // dark green-grey rock at the vault, paler where the day reaches it, but the cave's rock still
        // (the art critic, C7): beds across it and a speckle for a little texture
        const day = Math.pow(y, 1.6);
        const k = (0.7 + 0.6 * rc()) * (0.85 + 0.15 * Math.sin(y * 23 + Math.sin(a * 3) * 2));
        col.push(mix(0.016, 0.13, day) * k, mix(0.022, 0.165, day) * k, mix(0.019, 0.14, day) * k);
      }
    }
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < SEG; i++) {
      const a = j * (SEG + 1) + i; const b = a + SEG + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  })(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  chimney.visible = false;
  group.add(chimney);
  const skyGeo = new THREE.CircleGeometry(1, 18).rotateX(Math.PI / 2); // faces down
  {
    const sp = skyGeo.attributes.position;
    const r2 = S.rng(19);
    const edge = [];
    for (let i = 0; i < 18; i++) edge.push(m.r * (1.42 + 0.12 * r2())); // wider than the chimney's top: it closes it
    for (let i = 1; i < sp.count; i++) { const k = edge[(i - 1) % 18]; sp.setXYZ(i, sp.getX(i) * k, 0, sp.getZ(i) * k); }
  }
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ map: skyTexture(), fog: false, side: THREE.DoubleSide })); // warm at its middle, the sky's cooler grey at its edge: not one blown value (CS-3)
  sky.visible = false;
  group.add(sky);

  // The cracks: a ribbon laid on the vault, drawn from the middle outward as they run.
  const crackPos = new Float32Array(QUADS * 6 * 3);
  const crackGeo = new THREE.BufferGeometry();
  crackGeo.setAttribute('position', new THREE.BufferAttribute(crackPos, 3));
  const cracks = new THREE.Mesh(crackGeo, new THREE.MeshBasicMaterial({ color: 0xff4f8b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
  cracks.frustumCulled = false;
  cracks.visible = false;
  group.add(cracks);
  let quads = 0;

  // The rock: the pieces that fall and lie on the heap (the kept pieces, then the fill the pile
  // buries as it grows: logic fillOf), and the broken lip of the hole. One instanced mesh.
  const FILL = fillOf();
  const FALLEN = PIECES + FILL.length;
  const rockGeo = new THREE.IcosahedronGeometry(0.5, 0);
  // in the cave's own rock (its textured stalactite stone: the art critic, C7), a green-grey basalt
  const rock = new THREE.InstancedMesh(rockGeo, cave.rock.spikeMat, FALLEN + LIP);
  rock.frustumCulled = false;
  group.add(rock);
  const R = []; // per piece: [angle0, r0 (where it hangs), restX, restZ (the group's frame), sx, sy, sz, yaw, tilt, spinX, spinZ, jitter, its seat over the pile, -, -, -, its own angle0, r0, restU, restV, the pile's height under it]
  const PLAN = []; // per piece: its fall (logic fallOf), once placed
  const fallNow = {};
  const r3 = S.rng(23);
  const tone = new THREE.Color();
  for (let i = 0; i < PIECES; i++) {
    const a = r3() * TAU;
    const hero = i < HERO;
    const big = !hero && i % 3 === 0;
    // (x: its length, laid along the ring at rest; z: its width across the ring, so that the big
    // pieces still lie inside r + 0.85: wayout.js WAYOUT.cave edge, pad)
    const sx = hero ? 1.2 + 0.4 * r3() : big ? 0.8 + 0.4 * r3() : 0.26 + 0.2 * r3();
    const sy = hero ? 0.32 + 0.06 * r3() : big ? 0.35 + 0.15 * r3() : 0.15 + 0.1 * r3();
    const sz = hero ? 0.45 + 0.12 * r3() : big ? 0.42 + 0.16 * r3() : 0.22 + 0.2 * r3();
    const a1 = hero ? (i / HERO) * TAU + 0.4 + r3() * 0.6 : a + (r3() - 0.5) * 0.9;
    const bulge = sx > 0.7 ? (sx * sx) / (8 * (m.r + 0.4)) : 0; // a long piece's ends stand further out than its middle
    const r1 = m.r + 0.06 + sz / 2 + r3() * Math.max(0, 0.85 - 0.06 - sz - bulge);
    const slow = hero || big ? 0.35 : 1; // mass turns slowly
    R.push([
      a, hero ? 0.2 + 0.5 * r3() : 0.15 + 1.6 * Math.sqrt(i / (PIECES - 1)), a1, r1, sx, sy, sz,
      hero || big ? -a1 - Math.PI / 2 + (r3() - 0.5) * 0.3 : r3() * TAU, (r3() - 0.5) * (hero || big ? 0.2 : 0.5),
      (r3() - 0.5) * 12 * slow, (r3() - 0.5) * 12 * slow, r3(), 0, 0, 0, 0, 0, 0,
    ]);
    R[i][16] = R[i][0]; R[i][17] = R[i][1]; // where it hangs when no stalactite gives it a place
    // where it comes to rest: on the heap, in the path's frame [u, v] (the slabs with mass on its
    // flanks and its back, where they stand off the climbed lane; the small stones anywhere on it)
    const side = r3() < 0.5 ? -1 : 1;
    const ru = hero ? [2.3, 3.1, HL + 0.35, 1.5][i] : big ? 0.8 + r3() * (HL - 0.6) : r3() * (HL + 0.5);
    const rv = hero ? [1, -1, 0.3, -1][i] * (i === 2 ? 1 : RUBBLE.half + 0.4) : big ? side * (RUBBLE.half + 0.15 + 0.35 * r3()) : (r3() * 2 - 1) * (RUBBLE.half + 0.5);
    R[i].push(ru, rv, heapY(ru, rv));
  }
  // the fill: small stones, each landing on the pile's slope as it grows (where it lies as it lands)
  const rf = S.rng(57);
  for (const c of FILL) {
    const s = 0.12 + 0.16 * rf();
    const p = [rf() * TAU, 0, 0, 0, s * (0.9 + 0.6 * rf()), s * (0.6 + 0.4 * rf()), s * (0.9 + 0.5 * rf()), rf() * TAU, (rf() - 0.5) * 0.5,
      (rf() - 0.5) * 12, (rf() - 0.5) * 12, rf(), 0, 0, 0, 0, 0, 0, c.u, c.v, c.y];
    p[16] = p[0]; p[17] = 0;
    R.push(p);
  }
  const LP = []; // the lip: [angle, r, size, height, yaw]
  const lipY = new Float32Array(LIP); const lipH = new Float32Array(LIP); // (per site: its height, its length down)
  for (let i = 0; i < LIP; i++) { const a = (i / LIP) * TAU + r3() * 0.25; LP.push([a, m.r * 1.04 * (1 + 0.14 * Math.sin(5 * a + 1.3) + 0.07 * Math.sin(11 * a + 0.4) + 0.05 * Math.sin(17 * a + 2.2)) + 0.1 * r3(), 0.42 + r3() * 0.36, r3(), r3() * TAU]); } // (at the hole's ragged edge, holeR below: half in the rock)
  for (let i = 0; i < PIECES + LIP; i++) {
    const k = 0.7 + r3() * 0.6;
    rock.setColorAt(i < PIECES ? i : FALLEN + i - PIECES, tone.setRGB(0.42 * k, 0.5 * k, 0.45 * k)); // the Nave's basalt, as its stalactites are
  }
  for (let i = PIECES; i < FALLEN; i++) { const k = 0.7 + rf() * 0.6; rock.setColorAt(i, tone.setRGB(0.42 * k, 0.5 * k, 0.45 * k)); }

  const dust = createPuffs(D_CEIL + D_VEIL + D_FLOOR, false);
  dust.mesh.material.fog = false; // lit by the blast and the daylight, not by the room: its colour is its light
  const glow = createPuffs(4 + SPARKS, true);
  group.add(dust.mesh, glow.mesh);
  const DC = []; // ceiling burst: [angle, reach, life]
  for (let i = 0; i < D_CEIL; i++) DC.push([(i / D_CEIL) * TAU + r3() * 0.5, 1.4 + r3() * 1.6, 1.3 + r3() * 0.7]);
  const DV = []; // the veil in the shaft: [angle, r, delay, life, size]
  for (let i = 0; i < D_VEIL; i++) DV.push([r3() * TAU, r3() * m.r * 0.7, C.drop + i * 0.14, 3.6 + r3() * 1.6, 1.5 + r3() * 1.2]);
  const SP = []; // sparks off the strike: [vx, vy, vz, life]
  for (let i = 0; i < SPARKS; i++) { const a = r3() * TAU; const v = 0.8 + r3() * 3.2; SP.push([Math.cos(a) * v, -r3() * 2.5, Math.sin(a) * v, 0.45 + r3() * 0.7]); }
  // The blast's streak: its axis along +z, a unit long, stretched from its tail to its head.
  // (critic CS-5: a blast, not a laser line: a thick core in a wide, faint sleeve, one mesh)
  const streak = new THREE.Mesh(
    S.merge([
      S.tint(new THREE.CylinderGeometry(0.16, 0.28, 1, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5).deleteAttribute('uv'), 0xffffff),
      S.tint(new THREE.CylinderGeometry(0.4, 0.5, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5).deleteAttribute('uv'), 0xa0a0a0),
    ]),
    new THREE.MeshBasicMaterial({ color: 0xffa9c8, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }),
  );
  streak.frustumCulled = false;
  streak.visible = false;
  group.add(streak);
  parent.add(group);
  // One light for all of it: the gathering core, the blast as it climbs, the strike, then the
  // daylight on the floor. Always in the cave (dark until then), so no program is rebuilt.
  const light = new THREE.PointLight(0xff4f8b, 0, 15, 1.8);
  parent.add(light);
  // And one for the day on the hole's lip and the vault round it, so the hole sits in the rock (critic CS-3).
  const rimLight = new THREE.PointLight(0xfff1d0, 0, 4, 1.5);
  parent.add(rimLight);
  let dropped = []; // the stalactites whose roots lie inside the hole (critic CS-10, C8): down with the vault
  const setSpikes = (gone) => { for (const h of dropped) cave.dropStalactite(h, gone); };
  // and those just beyond its edge (the art critic, C8): they fall with the vault, a little after it
  // lets go, the further out the later (logic rimDrop), and are gone once into the dust over the heap
  let rimSpikes = []; // { h, over }
  const rimM = new THREE.Matrix4();
  function poseRim(bt) {
    for (const q of rimSpikes) {
      const h = q.h;
      const drop = bt >= 0 ? rimDrop(q.over, bt) : 0;
      if (drop > 0 && h.y - drop < RIM_FALL.gone) { cave.dropStalactite(h, true); continue; }
      if (h.gone) cave.dropStalactite(h, false);
      rimM.copy(h.m);
      rimM.elements[13] -= drop;
      h.mesh.setMatrixAt(h.index, rimM);
      h.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  const o3 = new THREE.Object3D();
  const shot = {};
  let reduced = false;
  let clock = -1;
  let playing = null;
  let settled = false;
  let siteX = NaN; let siteZ = NaN;
  let spikesAt = WAYOUT.cave.drop; // seconds after the strike the stalactites over the hole go (with the first slab)
  const landOrder = []; // the pieces by when they land
  let lid = 7; // the vault's underside over the mouth: its lowest rock there
  let holeY = 99; // the shell is cut above this height
  const order = new Uint16Array(QUADS);
  const reach = new Float32Array(QUADS); // each quad's distance from the middle (the order they are drawn in)
  const scratch = new Float32Array(QUADS * 18);

  /** Lays everything out for a site: the vault's and the floor's heights there decide it all. */
  function place(o) {
    siteX = o.x; siteZ = o.z;
    group.position.set(o.x, 0, o.z);
    lid = Infinity;
    for (let i = 0; i < 25; i++) {
      const a = i * 2.4; const r = m.r * 1.05 * Math.sqrt(i / 24);
      lid = Math.min(lid, cave.ceilAt(o.x + Math.cos(a) * r, o.z + Math.sin(a) * r));
    }
    lid -= 0.05;
    sky.position.y = lid + CHIMNEY; // the day, at the top of the hole bored up through the rock
    beam.scale.y = lid + CHIMNEY;
    chimney.position.y = lid - 0.7;
    chimney.scale.y = CHIMNEY + 0.7;
    holeY = Math.max(2.6, lid - 1.0); // the shell is cut above this (under it: the floor, the heap's top far below)
    rimLight.position.set(o.x, lid - 0.5, o.z);
    // the heap: turned to the run's heading (a site kept with none faces -z)
    const hl = Math.hypot(o.dx || 0, o.dz || 0);
    const hx = hl > 1e-9 ? o.dx / hl : 0; const hz = hl > 1e-9 ? o.dz / hl : -1;
    const theta = Math.atan2(-hz, hx);
    heap.rotation.y = theta;
    // the stalactites over the hole come down with it: each of the first is one of the slabs that falls first
    setSpikes(false);
    poseRim(-1);
    dropped = []; rimSpikes = [];
    for (const h of cave.stalactitesNear(o.x, o.z, m.r * 1.3 + RIM_FALL.rim)) {
      const q = rimOf(h.x - o.x, h.z - o.z, m.r);
      if (q.inside) dropped.push(h);
      else if (q.rim) rimSpikes.push({ h, over: q.over });
    }
    for (let i = 0; i < HERO; i++) {
      const h = dropped[i];
      R[i][0] = h ? Math.atan2(h.z - o.z, h.x - o.x) : R[i][16];
      R[i][1] = h ? Math.hypot(h.x - o.x, h.z - o.z) : R[i][17];
    }
    // the rubble (logic/rubblefall.js): where each piece lies (on the heap: p[2], p[3] its rest in the
    // group's frame, p[12] how far over the pile's face it sits, p[20] the face's height there), when
    // it lands (a kept piece as the pile comes up to the heap under it; the fill on the pile's slope as
    // it grows), and so when it lets go of the vault (a fall's time before), and from where: the hole's
    // rim as the blast has opened it by then, on the side it falls toward (the slabs with mass from
    // where the stalactites over the hole hung)
    const ring = { kind: 'vault' };
    let first = Infinity;
    for (let i = 0; i < FALLEN; i++) {
      const p = R[i];
      const u = p[18] - HL; const v = p[19];
      p[2] = hx * u - hz * v; p[3] = hz * u + hx * v;
      p[12] = p[5] * 0.3;
      const land = i < PIECES ? pileDoneAt(p[18], p[19]) : FILL[i - PIECES].land;
      const c = fallOf(0, lid - 0.1 - p[5] * 0.5, 0, p[2], p[20] + p[12], p[3], land);
      if (i < HERO) { c.x0 = Math.cos(p[0]) * p[1]; c.z0 = Math.sin(p[0]) * p[1]; first = Math.min(first, c.release); }
      else {
        const a = Math.atan2(p[3], p[2]) + (p[11] - 0.5) * 0.8;
        const r = m.r * holeR(a) * holeOpen(ring, strikeAt('vault') + c.release) * (0.72 + 0.22 * p[11]);
        c.x0 = Math.cos(a) * r; c.z0 = Math.sin(a) * r;
      }
      PLAN[i] = c;
      if (i < HERO || (i < PIECES && i % 3 === 0)) p[7] = -theta + (p[11] - 0.5) * 0.5; // the long pieces lie along the heap's flank
    }
    spikesAt = first;
    // the landings, in order: the dust thrown up off the pile is spread over them
    landOrder.length = 0;
    for (let i = 0; i < FALLEN; i++) landOrder.push(i);
    landOrder.sort((a, b) => PLAN[a].land - PLAN[b].land);
    // the lip: rock left hanging round the hole, from just under the sky patch up into the vault
    for (let i = 0; i < LIP; i++) {
      const q = LP[i];
      const top = cave.ceilAt(o.x + Math.cos(q[0]) * q[1], o.z + Math.sin(q[0]) * q[1]);
      lipY[i] = mix(lid - 0.12, top, 0.35 + 0.4 * q[3]);
      lipH[i] = q[2] * 0.9 + (top - lid) * 0.5;
    }
    poseLip(1);
    // the cracks: arms that wander out from the middle and fork, laid just under the rock
    const rc = S.rng(31);
    quads = 0;
    const seg = (x0, z0, x1, z1, w0, w1, dist) => {
      if (quads >= QUADS) return;
      const inHole = (x, z) => Math.hypot(x, z) < m.r * holeR(Math.atan2(z, x)) + 0.12; // (the hole's own: nothing to crack)
      if (inHole(x0, z0) || inHole(x1, z1)) return;
      const rimOff = (x, z) => smooth((Math.hypot(x, z) - m.r * holeR(Math.atan2(z, x))) / 0.7); // (a vein tapers to nothing at the rim)
      w0 *= rimOff(x0, z0); w1 *= rimOff(x1, z1);
      const dx = x1 - x0; const dz = z1 - z0; const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l; const nz = dx / l;
      const y0 = cave.ceilAt(o.x + x0, o.z + z0) - 0.07; const y1 = cave.ceilAt(o.x + x1, o.z + z1) - 0.07;
      const k = quads * 18;
      const put = (j, x, y, z) => { scratch[k + j * 3] = x; scratch[k + j * 3 + 1] = y; scratch[k + j * 3 + 2] = z; };
      put(0, x0 - nx * w0, y0, z0 - nz * w0); put(1, x0 + nx * w0, y0, z0 + nz * w0); put(2, x1 + nx * w1, y1, z1 + nz * w1);
      put(3, x0 - nx * w0, y0, z0 - nz * w0); put(4, x1 + nx * w1, y1, z1 + nz * w1); put(5, x1 - nx * w1, y1, z1 - nz * w1);
      reach[quads] = dist;
      quads++;
    };
    const arm = (x, z, heading, len, w, dist, fork) => {
      const total = len;
      while (len > 0 && quads < QUADS) {
        const step = Math.min(len, 0.3 + rc() * 0.22);
        heading += (rc() - 0.5) * 0.8;
        const nx = x + Math.cos(heading) * step; const nz = z + Math.sin(heading) * step;
        if (caveField(o.x + nx, o.z + nz) < 0.9) return; // not into the wall
        const w1 = Math.max(0.012, w * (len - step) / total);
        seg(x, z, nx, nz, Math.max(0.012, w * len / total), w1, dist);
        if (fork && rc() < 0.34) arm(nx, nz, heading + (rc() < 0.5 ? -1 : 1) * (0.6 + rc() * 0.6), 0.7 + rc() * 1.3, w1 * 0.8, dist + step, false);
        x = nx; z = nz; len -= step; dist += step;
      }
    };
    for (let j = 0; j < 7; j++) arm(0, 0, (j / 7) * TAU + rc() * 0.6, 2.8 + rc() * 1.9, 0.07, 0, true);
    for (let i = 0; i < quads; i++) order[i] = i;
    order.subarray(0, quads).sort((a, b) => reach[a] - reach[b]);
    for (let i = 0; i < quads; i++) crackPos.set(scratch.subarray(order[i] * 18, order[i] * 18 + 18), i * 18);
    for (let i = 0; i < quads; i++) scratch[i] = reach[order[i]]; // (scratch now holds the sorted distances)
    for (let i = 0; i < quads; i++) reach[i] = scratch[i];
    crackGeo.attributes.position.needsUpdate = true;
    settled = false;
  }

  /** How many of the cracks' quads lie within `far` metres of the middle. */
  function quadsWithin(far) {
    let n = 0;
    while (n < quads && reach[n] <= far) n++;
    return n;
  }

  /** The rubble at bt seconds after the strike (a huge bt: where it lies): each piece on the vault, falling, or down on the pile (logic chunkAt). */
  function poseRubble(bt) {
    for (let i = 0; i < FALLEN; i++) {
      const p = R[i];
      const c = chunkAt(PLAN[i], bt, fallNow);
      const k = c.k;
      o3.position.set(c.x, c.y, c.z);
      o3.rotation.set(p[8] + p[9] * (1 - k), p[7], p[8] * 0.6 + p[10] * (1 - k)); // tumbling as it falls, still once down
      const s = c.up ? 0 : 1; // part of the vault until it lets go
      o3.scale.set(p[4] * s, p[5] * s, p[6] * s);
      o3.updateMatrix();
      rock.setMatrixAt(i, o3.matrix);
    }
    rock.instanceMatrix.needsUpdate = true;
  }

  /** The lip's chunks round the hole at `open` of its size (they ring the bore as it opens). */
  function poseLip(open) {
    const k = Math.max(0.15, open);
    for (let i = 0; i < LIP; i++) {
      const q = LP[i];
      o3.position.set(Math.cos(q[0]) * q[1] * k, lipY[i], Math.sin(q[0]) * q[1] * k);
      o3.rotation.set(q[4], q[4] * 2.1, q[4] * 0.7);
      const sk = 0.55 + 0.45 * k;
      o3.scale.set(q[2] * 1.3 * sk, lipH[i] * sk, q[2] * sk);
      o3.updateMatrix();
      rock.setMatrixAt(FALLEN + i, o3.matrix);
    }
    rock.instanceMatrix.needsUpdate = true;
  }

  function showLip(on) {
    rock.count = on ? FALLEN + LIP : FALLEN;
  }

  /** The shaft as the scene leaves it (and as a restore or a skip finds it). */
  function settle() {
    poseRubble(1e3);
    poseLip(1);
    showLip(true);
    dust.clear(); dust.commit();
    glow.clear(); glow.commit();
    streak.visible = false;
    showHole(1);
    heap.visible = true;
    poseHeap(Infinity);
    cracks.visible = true;
    cracks.material.blending = THREE.NormalBlending; // dark fissures in the rock (CS-4)
    cracks.material.color.copy(FISSURE);
    cracks.material.opacity = 0.85;
    crackGeo.setDrawRange(0, quadsWithin(CRACK_REACH) * 6);
    setSpikes(true);
    poseRim(Infinity);
    light.color.copy(DAY);
    light.position.set(siteX, LIGHT_Y, siteZ);
    settled = true;
  }

  /** The hole at `open` (0 to 1) of its size: the shell cut, the chimney and the sky over it. */
  function showHole(open) {
    const on = open > 0.001;
    sky.visible = on; chimney.visible = on;
    sky.scale.setScalar(Math.max(0.001, open));
    chimney.scale.x = chimney.scale.z = Math.max(0.001, open);
    cave.setHole(siteX, siteZ, on ? m.r * open : 0, holeY);
  }

  /** The scene at t seconds in (sc: the scene while it plays, else null: its dust still hanging). */
  function play(sc, o, t, L) {
    settled = false;
    const strike = strikeAt('vault');
    const bt = t - strike;
    const dim = reduced ? 0.35 : 1;
    let pink = 0; // the blast's own light
    let lx = 0; let ly = lid - 0.6; let lz = 0; // where the light is, from the site
    glow.clear();
    streak.visible = false;
    if (sc && bt < 0.3) {
      const s = vaultShotAt(sc, o, t, shot);
      const fx = sc.foe.x - o.x; const fz = sc.foe.z - o.z;
      if (bt < 0) { lx = s.x - o.x; ly = s.y; lz = s.z - o.z; }
      // the core gathering at its chest, then spent as the blast leaves
      const g = s.gather * s.gather * (1 - smooth((t - C.beat) / 0.25));
      if (t >= C.beat && t < C.beat + 0.1) glow.set(0, fx, s.y0, fz, 4, 1, 0.8, 0.9, dim); // the recoil: it flashes as the blast leaves
      else if (g > 0.01) glow.set(0, fx, s.y0, fz, 1.6 + 3.5 * g, 1, 0.42, 0.62, 0.8 * g);
      pink = 90 * g;
      if (s.on || (bt >= 0 && s.tail < 1)) {
        const hx = s.x - o.x; const hz = s.z - o.z;
        if (s.on) {
          glow.set(1, hx, s.y, hz, 1.7, 1, 0.9, 0.95, 1);
          glow.set(2, hx, s.y, hz, 5.2, 1, 0.36, 0.58, 0.7);
          pink = 110;
        }
        const tx = s.tx - o.x; const tz = s.tz - o.z;
        const len = Math.hypot(hx - tx, s.y - s.ty, hz - tz);
        if (len > 0.05) {
          streak.visible = true;
          streak.position.set(tx, s.ty, tz);
          streak.lookAt(siteX + hx, s.y, siteZ + hz);
          streak.scale.set(1, 1, len);
          streak.material.opacity = 0.85 * (1 - smooth(bt / 0.3)); // gone within 0.3 s of the strike: the roof goes, no lasting beam
        }
      }
    }
    if (bt >= 0) {
      // the strike: a flash on the vault, sparks off it, the rock's dust knocked loose
      const fk = clamp01(bt / 0.3);
      if (fk < 1) glow.set(3, 0, lid - 0.25, 0, 3 + 9 * fk, 1, 0.55 + 0.3 * (1 - fk), 0.75, dim * (1 - fk) * (1 - fk));
      pink = Math.max(pink, 230 * dim * (1 - fk) * (1 - fk), 16 * (1 - smooth((bt - 0.3) / 0.6)));
      for (let i = 0; i < SPARKS; i++) {
        const q = SP[i];
        const k = bt / q[3];
        if (k >= 1) continue;
        glow.set(4 + i, q[0] * bt, lid - 0.2 + q[1] * bt - 4.5 * bt * bt, q[2] * bt, 0.13, 1, 0.6 + 0.3 * (1 - k), 0.8, (1 - k) * (1 - k));
      }
    }
    glow.commit();
    // the cracks run out: lit by the strike for its 0.3 s, then what they are, dark fissures in the rock (CS-4)
    const ck = sc ? vaultCrack(sc, t) : 1;
    cracks.visible = bt >= 0;
    if (bt >= 0) {
      crackGeo.setDrawRange(0, quadsWithin(ck * CRACK_REACH) * 6);
      const hot = bt < 0.3;
      cracks.material.blending = hot ? THREE.AdditiveBlending : THREE.NormalBlending;
      cracks.material.color.copy(hot ? PINK : FISSURE);
      cracks.material.opacity = hot ? 0.95 * (1 - smooth((bt - 0.2) / 0.1)) : 0.9 * smooth((bt - 0.3) / 0.12);
    }
    setSpikes(bt >= spikesAt); // the stalactites over the hole go with the first slab: it is one of them
    poseRim(bt); // and those round its edge fall with the vault
    // the hole: bored by the blast as it strikes (a ragged quarter of it at once), then opening from
    // the middle as the pieces let go
    // the hole: bored by the blast as it strikes (0.3 m at once), opening to full over WAYOUT.cave.bore,
    // its rim's chunks ringing it from the strike (logic holeOpen)
    const open = sc ? holeOpen(sc, t) : 1;
    showHole(open);
    poseLip(open);
    showLip(open > 0);
    // the heap: piled by the rock landing on it, from under the hole outward (logic pileAt), whole at FALL.last
    const pb = sc ? bt : Infinity;
    heap.visible = pb > FALL.first;
    if (heap.visible) poseHeap(pb);
    poseRubble(pb);
    // dust: knocked off the vault by the strike, hanging in the shaft, thrown up where the rock lands
    const lit = 0.25 + 0.75 * L;
    for (let i = 0; i < D_CEIL; i++) {
      const q = DC[i];
      if (bt <= 0 || bt >= q[2]) { dust.hide(i); continue; }
      const r = 0.4 + q[1] * (1 - Math.exp(-bt * 2.5));
      const hot = 1 - smooth(bt / 0.5);
      dust.set(i, Math.cos(q[0]) * r, lid - 0.5 - 0.9 * bt, Math.sin(q[0]) * r, 1.3 + 2.6 * (1 - Math.exp(-bt * 2)),
        mix(0.16 + 0.4 * L, 0.7, hot), mix(0.16 + 0.37 * L, 0.2, hot), mix(0.18 + 0.3 * L, 0.36, hot),
        0.8 * smooth(bt / 0.08) * Math.pow(1 - bt / q[2], 1.4));
    }
    for (let i = 0; i < D_VEIL; i++) {
      const q = DV[i];
      const a = bt - q[2];
      if (a <= 0 || a >= q[3]) { dust.hide(D_CEIL + i); continue; }
      const y = Math.max(0.6, lid - 0.5 - (lid - 1.1) * (1 - Math.exp(-a * 0.75)));
      dust.set(D_CEIL + i, Math.cos(q[0] + a * 0.2) * q[1], y, Math.sin(q[0] + a * 0.2) * q[1], q[4] + 0.5 * a,
        0.8 * lit, 0.75 * lit, 0.62 * lit, (0.1 + 0.26 * L) * smooth(a / 0.3) * Math.pow(1 - a / q[3], 1.2));
    }
    for (let i = 0; i < D_FLOOR; i++) {
      const j = landOrder[Math.round((i * (FALLEN - 1)) / (D_FLOOR - 1))]; // spread over the landings, first to last
      const p = R[j]; const c = PLAN[j];
      const a = bt - c.land;
      if (a <= 0 || a >= 1.7) { dust.hide(D_CEIL + D_VEIL + i); continue; }
      const r = 1 + 0.35 * (1 - Math.exp(-a * 2)); // thrown out a little from where it landed on the pile
      dust.set(D_CEIL + D_VEIL + i, p[2] * r, 0.45 + p[20] + 0.55 * a, p[3] * r, 2.0 + 3.0 * (1 - Math.exp(-a * 1.8)),
        0.09 + 0.15 * L, 0.09 + 0.14 * L, 0.1 + 0.12 * L, 0.7 * smooth(a / 0.08) * Math.pow(1 - a / 1.7, 1.4));
    }
    dust.commit();
    // the one light: with the blast, then down into the shaft as the day comes on
    const down = smooth((bt - 0.45) / 0.6);
    light.color.copy(PINK).lerp(DAY, smooth((bt - 0.35) / 0.5));
    light.position.set(siteX + lx * (1 - down), mix(ly, LIGHT_Y, down), siteZ + lz * (1 - down));
    return pink;
  }

  // ---- the scene's camera: the warden's own eye (the cave is a closed shell: it does not travel).
  // It closes on the Cantor as it gathers (CS-5: the wind-up must read), opens to hold the Cantor and
  // its blast in one frame as it fires, goes up to the vault as it is struck, comes down with the rock
  // to the light on the floor, and ends turned toward the shaft (CS-1: sc.homeYaw / homePitch, the
  // heading play resumes on).
  function camera(sim, sc) {
    const o = sim.waves.wayout;
    const pl = sim.player;
    const y = pl.y + sim.cfg.player.eyeHeight;
    const t = sc.t;
    const strike = strikeAt('vault');
    const s = vaultShotAt(sc, o, t, shot);
    const home = smooth((t - (sc.length - C.home)) / C.home);
    const down = smooth((t - strike - C.hold) / 0.95); // (held on the hole C.hold seconds as it opens, the art critic)
    // its chest; as it fires, a point 0.6 of the way from chest to the blast's head; once struck, the vault
    const q = s.k * mix(0.6, 1, smooth((t - strike) / 0.35));
    aimA.yaw = pl.yaw; aimA.pitch = pl.pitch;
    aimAt(aimB, pl.x, y, pl.z, mix(sc.foe.x, o.x, q), mix(s.y0, o.vault, q), mix(sc.foe.z, o.z, q));
    turn(aimA, aimB, smooth(t / 0.45));
    // down with the falling rock to the middle of the shaft: the hole above, the light on the floor
    aimAt(aimB, pl.x, y, pl.z, o.x, 0.4 * o.vault, o.z);
    turn(aimA, aimB, down);
    if (Number.isFinite(sc.homeYaw)) { aimB.yaw = sc.homeYaw; aimB.pitch = sc.homePitch; } else { aimB.yaw = pl.yaw; aimB.pitch = pl.pitch; }
    turn(aimA, aimB, home);
    const near = mix(BASE_FOV, 40, smooth(t / 0.5) * (1 - smooth((t - C.beat) / 0.3))); // in on the Cantor through its beat
    // a longer lens the further the site is, so the vault breaking and the rock falling have their size (CS-9):
    // in on the vault as it cracks, then wide enough for the hole above and the light on the floor together
    const d = Math.hypot(o.x - pl.x, o.z - pl.z);
    const deg = 180 / Math.PI;
    const tight = Math.max(42, Math.min(62, 2 * Math.atan(5 / Math.hypot(d, o.vault - y)) * deg)); // (the hole and its rim whole in frame)
    const whole = Math.max(36, Math.min(BASE_FOV, 1.3 * (Math.atan((o.vault - y) / d) + Math.atan(y / d)) * deg));
    const push = mix(mix(BASE_FOV, tight, smooth((t - strike) / 0.4)), whole, down);
    return lookFrom(pl.x, y, pl.z, aimA, mix(Math.min(near, push), BASE_FOV, home));
  }

  return {
    group, camera, follow: followCamera,
    setReducedFlash(v) { reduced = !!v; },
    update(sim, dt, time) {
      const w = sim && sim.cfg && sim.cfg.room === 'cave' ? sim.waves : null;
      const o = w && w.wayout && w.wayout.kind === 'vault' ? w.wayout : null;
      if (!o) { // no way up in this run (yet)
        group.visible = false;
        light.intensity = 0;
        rimLight.intensity = 0;
        setSpikes(false); // the vault is whole
        poseRim(-1);
        cave.setHole(0, 0, 0, 99);
        clock = -1; playing = null;
        return;
      }
      if (o.x !== siteX || o.z !== siteZ) place(o);
      const sc = w.scene && w.scene.kind === 'vault' ? w.scene : null;
      if (sc) { clock = sc.t; playing = sc; }
      else if (playing) {
        if (clock < playing.length - 0.11) clock = -1; // skipped: the shaft is simply there
        playing = null;
      } else if (clock >= 0) clock += dt;
      if (clock - strikeAt('vault') >= DUST) clock = -1;
      const live = clock >= 0;
      group.visible = live || !!o.open;
      if (!group.visible) { light.intensity = 0; rimLight.intensity = 0; cave.setHole(0, 0, 0, 99); return; }
      const L = live ? (sc ? shaftLight(sc, clock) : 1) : 1;
      let pink = 0;
      if (live) pink = play(sc, o, clock, L);
      else if (!settled) settle();
      // the shaft itself: the beam, the pool on the floor, the motes turning in it
      const shown = L > 0.002;
      beam.visible = shown; pool.visible = shown; motes.visible = shown;
      if (shown) {
        for (let i = 0; i < N; i++) {
          const [a, r, y0, v] = seeds[i];
          const aa = a + time * v;
          pos[i * 3] = Math.cos(aa) * r;
          pos[i * 3 + 1] = (y0 * lid + time * v * 0.6) % lid;
          pos[i * 3 + 2] = Math.sin(aa) * r;
        }
        geo.attributes.position.needsUpdate = true;
        beam.material.uniforms.opacity.value = (0.26 + 0.04 * Math.sin(time * 0.7)) * L;
        pool.material.opacity = L;
        motes.material.opacity = 0.35 * L;
      }
      light.intensity = pink + DAYLIGHT * L;
      rimLight.intensity = RIMLIGHT * L;
    },
  };
}
