// The ways on between the levels (issue #29, logic/journey.js): the yard's crater, the way down
// into the cave, and the Nave's shaft of daylight, the way up into the Rose Court. Each opens in a
// short cut scene as its level is won (logic/wayout.js), wherever the rules put it
// (sim.waves.wayout), and stays: the yard's last foe spins off and slams into the concrete, and
// its blast leaves the crater; the Cantor fires one last blast up at the vault, which cracks and
// comes down, and daylight pours through the hole. This file draws the places, what makes them
// (the flash, the shock, the slabs and smoke; the bolt, the cracks, the falling rock and dust) and
// the two scenes' cameras. The foe itself is actors.js's, the Cantor fauna.js's, the ground's
// tremor main.js's, the sound wayoutcues.js's. The view's dip into the dark (or lift into the
// light) as the warden goes through, and its fade, are main.js's and handover.js's.
//
// Everything is seeded (sculpt.js rng): the same crater, the same cracks, every time. Nothing is
// allocated per frame. A restore, or a skipped scene, shows each place as the scene leaves it.

import * as THREE from 'three';
import * as S from './sculpt.js';
import { MOUTHS } from '../logic/journey.js';
import { caveField } from '../logic/cavemap.js';
import { WAYOUT, sightTop, strikeAt, foeFlightAt, flightApex, vaultShotAt, vaultCrack, vaultDropAt, shaftLight } from '../logic/wayout.js';

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

// ---- the crater's pit: a disc that draws the hole under it (critic CS-8) -------------------------

const PIT_VERT = `
varying vec3 vWorld;
varying vec3 vCentre;
varying float vScale;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vCentre = modelMatrix[3].xyz;
  vScale = length(modelMatrix[0].xyz);
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const PIT_FRAG = `
uniform float radius;
uniform float depth;
uniform vec3 lip;
uniform vec3 wall;
uniform vec3 pit;
varying vec3 vWorld;
varying vec3 vCentre;
varying float vScale;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec3 v = normalize(vWorld - cameraPosition);
  vec2 p = vWorld.xz - vCentre.xz;
  float R = radius * vScale;
  vec3 col = lip; // the broken top of the lip, under the rim's torn edge
  if (length(p) < R && v.y < -0.001) {
    float a = dot(v.xz, v.xz);
    float b = dot(p, v.xz);
    float c = dot(p, p) - R * R;
    float toWall = a > 1e-6 ? (-b + sqrt(max(b * b - a * c, 0.0))) / a : 1e9;
    float h = toWall * -v.y / depth; // how far down the wall the eye's ray meets it (over 1: it reaches the bottom first)
    vec2 hit = p + v.xz * toWall;
    float grain = 0.82 + 0.18 * sin(atan(hit.y, hit.x) * 13.0 + h * 5.0);
    col = h < 1.0 ? mix(mix(lip, wall, smoothstep(0.0, 0.3, h)) * grain, pit, smoothstep(0.3, 1.0, h)) : pit;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

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
  float face = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); // nothing at its silhouette: no edge
  gl_FragColor = vec4(color, opacity * face * mix(0.35, 1.0, vH)); // and thinner toward the floor
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

// ---- the yard's crater --------------------------------------------------------------------------

const DEBRIS = 26;
const EMBERS = 22;
const SMOKE = 10;
const GROUND = 12;
const BLAST = 3.8; // seconds after the strike the last of the smoke is gone

/**
 * The yard's crater: a black hole through the concrete, its rim torn and scorched, broken slabs
 * tipped round it, and a faint amber breath rising out of it (the yard's trail of light: the way).
 * It stands where the run's win put it (sim.waves.wayout) and shows once that is open; while the
 * scene plays it is made in front of the warden: a flash, a shock running out over the concrete,
 * slabs thrown up that come down round the hole and stay, smoke and dust.
 */
export function createCrater(parent) {
  const m = MOUTHS.yard;
  const group = new THREE.Group();
  group.name = 'yard:crater';
  group.visible = false;
  const rnd = S.rng(51);
  const place = new THREE.Group(); // the crater itself: the hole, the rim, the slabs, the breath
  group.add(place);
  // The hole (critic CS-8): not a flat black disc but a pit with a wall. The yard's ground is one
  // plane and cannot be cut, so the disc's own shader looks down through itself: for each pixel it
  // follows the eye's ray into a pit m.r * 0.96 across and 1.2 m deep, and draws the broken lip, the
  // wall darkening as it goes down, or the dark at the bottom. One draw call, exact parallax.
  const hole = new THREE.Mesh(new THREE.CircleGeometry(m.r * 1.14, 32).rotateX(-Math.PI / 2).translate(0, 0.025, 0), new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      radius: { value: m.r * 0.96 }, depth: { value: 1.2 },
      lip: { value: new THREE.Color(0x272d2b) }, wall: { value: new THREE.Color(0x101413) }, pit: { value: new THREE.Color(0x020303) },
    }]),
    vertexShader: PIT_VERT, fragmentShader: PIT_FRAG, fog: true,
  }));
  place.add(hole);
  // The rim: torn inside and out, lifted to a lip at the mouth, scorched there and fading out into
  // the concrete (colour and alpha), so it ends nowhere. Its outer edge stays within r + 1.85
  // (WAYOUT.yard.clear).
  const RIM = 1.05; // the rim's width before its outer edge is torn (x 1.26 at the most: r + 1.84)
  const rim = new THREE.RingGeometry(m.r, m.r + RIM, 40, 3).rotateX(-Math.PI / 2).deleteAttribute('uv');
  const p = rim.attributes.position;
  const rimCol = new Float32Array(p.count * 4);
  const scorch = new THREE.Color(0x14100c); const concrete = new THREE.Color(0x2a302f);
  const rn = S.rng(7);
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const u = (Math.hypot(p.getX(i), p.getZ(i)) - m.r) / RIM; // 0 at the mouth, 1 at the outer edge
    const torn = 0.18 * Math.sin(a * 5 + 1.3) + 0.08 * Math.sin(a * 11);
    const k = u < 0.02 ? 1 + 0.12 * Math.sin(a * 7) : 1 + torn * u * u;
    const y = u < 0.02 ? 0.15 + 0.03 * Math.sin(a * 9 + 0.7) : u < 0.4 ? 0.06 : 0.02; // a torn lip, 0.12 to 0.18 m up at the mouth
    p.setXYZ(i, p.getX(i) * k, y, p.getZ(i) * k);
    const tone = 0.75 + 0.5 * rn();
    const c = Math.min(1, u * 1.15);
    rimCol[i * 4] = mix(scorch.r, concrete.r, c) * tone;
    rimCol[i * 4 + 1] = mix(scorch.g, concrete.g, c) * tone;
    rimCol[i * 4 + 2] = mix(scorch.b, concrete.b, c) * tone;
    rimCol[i * 4 + 3] = 1 - smooth((u - 0.45) / 0.55);
  }
  rim.setAttribute('color', new THREE.BufferAttribute(rimCol, 4));
  rim.computeVertexNormals();
  place.add(new THREE.Mesh(rim, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, transparent: true, depthWrite: false })));
  const slabs = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + rnd() * 0.4;
    const r = m.r + 0.3 + rnd() * 0.9;
    const g = new THREE.BoxGeometry(0.5 + rnd() * 0.7, 0.14, 0.4 + rnd() * 0.6);
    g.rotateX((rnd() - 0.5) * 0.9).rotateY(a).rotateZ((rnd() - 0.5) * 0.7);
    g.translate(Math.cos(a) * r, 0.1, Math.sin(a) * r);
    slabs.push(S.tint(g.deleteAttribute('uv'), 0x2a302f, 0.3, i));
  }
  const slabMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  place.add(new THREE.Mesh(S.merge(slabs), slabMat));
  const breath = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,179,71,0.55)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); // (unfogged, as the lanterns' halos are: it is the way, and must read across the yard)
  breath.position.set(0, 1.4, 0);
  breath.scale.set(4.5, 3.6, 1);
  place.add(breath);

  // The blast's own pieces: small slabs thrown up and out, which come down round the mouth and stay
  // (low, outside the mouth, no collision: the warden walks over them).
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), DEBRIS);
  debris.frustumCulled = false;
  const D = []; // [angle, restR, sx, sy, sz, yaw, tiltX, tiltZ, hang, peak, spinX, spinZ]
  const tone = new THREE.Color();
  for (let i = 0; i < DEBRIS; i++) {
    const big = i % 3 === 0;
    D.push([
      (i / DEBRIS) * TAU + rnd() * 0.5, m.r + 0.28 + rnd() * 0.62,
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
  // The crater's light: the blast's flash, then the amber breath on the rim and the slabs. It is
  // always in the yard (dark until the crater is there), so no program is rebuilt as it comes on.
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
      const r = d[1] * (0.2 + 0.8 * Math.pow(k, 0.85));
      const restY = d[3] * 0.5 + 0.02;
      o3.position.set(Math.cos(d[0]) * r, restY * k + 4 * d[9] * k * (1 - k), Math.sin(d[0]) * r);
      o3.rotation.set(d[6] + d[10] * (1 - k), d[5], d[7] + d[11] * (1 - k));
      const s = bt < 0 ? 0 : 1;
      o3.scale.set(d[2] * s, d[3] * s, d[4] * s);
      o3.updateMatrix();
      debris.setMatrixAt(i, o3.matrix);
    }
    debris.instanceMatrix.needsUpdate = true;
  }

  /** The crater as the scene leaves it (and as a restore or a skip finds it). */
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
    place.scale.setScalar(0.4 + 0.6 * smooth(bt / 0.12)); // the hole tears open under the flash
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
  // the flight (the ground and where it is headed always in view), settles on the crater, and comes
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
    // the lens for the flight: wide enough for the foe and the site together, with a margin; never tighter than the crater's own
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
    group, camera,
    setReducedFlash(v) { reduced = !!v; },
    update(sim, dt, time) {
      const w = sim && sim.cfg && sim.cfg.room === 'yard' ? sim.waves : null;
      const o = w && w.wayout && w.wayout.kind === 'crater' ? w.wayout : null;
      if (!o) { // no crater in this run (yet): nothing shows, nothing is lit
        group.visible = false;
        light.intensity = 0;
        clock = -1; playing = null;
        return;
      }
      const sc = w.scene && w.scene.kind === 'crater' ? w.scene : null;
      if (sc) { clock = sc.t; playing = sc; }
      else if (playing) {
        if (clock < playing.length - 0.11) clock = -1; // skipped: the crater is simply there
        playing = null;
      } else if (clock >= 0) clock += dt;
      const bt = clock < 0 ? -1 : clock - strikeAt('crater');
      if (bt >= BLAST) clock = -1;
      group.position.set(o.x, 0, o.z);
      light.position.set(o.x, 1.1, o.z);
      group.visible = !!o.open;
      if (!o.open) { light.intensity = 0; return; }
      const live = clock >= 0 && bt >= 0;
      if (live) blast(bt);
      else if (!settled) settle();
      const glow = 0.55 + 0.2 * Math.sin(time * 1.3);
      breath.material.opacity = glow * (live ? smooth((bt - 0.5) / 1.5) : 1);
      const fk = live ? clamp01(bt / 0.45) : 1;
      light.intensity = (live ? 900 * (reduced ? 0.25 : 1) * (1 - fk) * (1 - fk) : 0) + 26 * glow * (live ? smooth(bt / 1.2) : 1);
    },
  };
}

// ---- the Nave's shaft ---------------------------------------------------------------------------

const RUBBLE = 30;
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
const DAYLIGHT = 80; // the shaft's light on the floor and the rubble, candela
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
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(m.r * 1.3, 24).rotateX(-Math.PI / 2).translate(0, 0.04, 0),
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
  const motes = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff6e0, size: 0.03, transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
  motes.frustumCulled = false;
  group.add(motes);

  // The hole: the sky seen through it (a ragged bright patch just under the vault's lowest rock
  // there), and the broken edge left round it.
  const skyGeo = new THREE.CircleGeometry(1, 18).rotateX(Math.PI / 2); // faces down
  {
    const sp = skyGeo.attributes.position;
    const r2 = S.rng(19);
    const edge = [];
    for (let i = 0; i < 18; i++) edge.push(m.r * (0.8 + 0.22 * r2()));
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

  // The rock: the pieces that fall and lie round the mouth, and the broken lip of the hole.
  const rockGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const rock = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.06, flatShading: true }), RUBBLE + LIP);
  rock.frustumCulled = false;
  group.add(rock);
  const R = []; // per piece: [angle0, r0, angle1, r1, sx, sy, sz, yaw, tilt, spinX, spinZ, jitter] and, once placed, [..., restY, startY, drop, fall, its own angle0, r0]
  const r3 = S.rng(23);
  const tone = new THREE.Color();
  for (let i = 0; i < RUBBLE; i++) {
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
      a, hero ? 0.2 + 0.5 * r3() : 0.15 + 1.6 * Math.sqrt(i / (RUBBLE - 1)), a1, r1, sx, sy, sz,
      hero || big ? -a1 - Math.PI / 2 + (r3() - 0.5) * 0.3 : r3() * TAU, (r3() - 0.5) * (hero || big ? 0.2 : 0.5),
      (r3() - 0.5) * 12 * slow, (r3() - 0.5) * 12 * slow, r3(), 0, 0, 0, 0, 0, 0,
    ]);
    R[i][16] = R[i][0]; R[i][17] = R[i][1]; // where it hangs when no stalactite gives it a place
  }
  const LP = []; // the lip: [angle, r, size, height, yaw]
  for (let i = 0; i < LIP; i++) LP.push([(i / LIP) * TAU + r3() * 0.25, m.r * (0.96 + 0.2 * r3()), 0.42 + r3() * 0.36, r3(), r3() * TAU]);
  for (let i = 0; i < RUBBLE + LIP; i++) {
    const k = 0.7 + r3() * 0.6;
    rock.setColorAt(i, tone.setRGB(0.02 * k, 0.024 * k, 0.031 * k)); // the Nave's basalt
  }

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
  let dropped = []; // the stalactites that hung over the hole (critic CS-10): down with the vault
  const setSpikes = (gone) => { for (const h of dropped) cave.dropStalactite(h, gone); };

  const o3 = new THREE.Object3D();
  const shot = {};
  let reduced = false;
  let clock = -1;
  let playing = null;
  let settled = false;
  let siteX = NaN; let siteZ = NaN;
  let lid = 7; // the sky patch's height: just under the lowest rock of the vault over the mouth
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
    sky.position.y = lid;
    beam.scale.y = lid;
    rimLight.position.set(o.x, lid - 0.5, o.z);
    // the stalactites over the hole come down with it: each of the first is one of the slabs that falls first
    setSpikes(false);
    dropped = cave.stalactitesNear(o.x, o.z, m.r + 0.9); // (the critic asked r + 0.5: the ones just outside still hang across the hole from below)
    for (let i = 0; i < HERO; i++) {
      const h = dropped[i];
      R[i][0] = h ? Math.atan2(h.z - o.z, h.x - o.x) : R[i][16];
      R[i][1] = h ? Math.hypot(h.x - o.x, h.z - o.z) : R[i][17];
    }
    // the rubble: where each piece hangs, when it lets go, how long it falls, where it lies
    for (let i = 0; i < RUBBLE; i++) {
      const p = R[i];
      p[12] = cave.floorAt(o.x + Math.cos(p[2]) * p[3], o.z + Math.sin(p[2]) * p[3]) + p[5] * 0.3;
      p[13] = lid - 0.1 - p[5] * 0.5;
      p[14] = vaultDropAt(i, RUBBLE, p[11]);
      p[15] = Math.sqrt((2 * (p[13] - p[12])) / C.gravity);
    }
    // the lip: rock left hanging round the hole, from just under the sky patch up into the vault
    for (let i = 0; i < LIP; i++) {
      const q = LP[i];
      const x = Math.cos(q[0]) * q[1]; const z = Math.sin(q[0]) * q[1];
      const top = cave.ceilAt(o.x + x, o.z + z);
      o3.position.set(x, mix(lid - 0.12, top, 0.35 + 0.4 * q[3]), z);
      o3.rotation.set(q[4], q[4] * 2.1, q[4] * 0.7);
      o3.scale.set(q[2] * 1.3, q[2] * 0.9 + (top - lid) * 0.5, q[2]);
      o3.updateMatrix();
      rock.setMatrixAt(RUBBLE + i, o3.matrix);
    }
    // the cracks: arms that wander out from the middle and fork, laid just under the rock
    const rc = S.rng(31);
    quads = 0;
    const seg = (x0, z0, x1, z1, w0, w1, dist) => {
      if (quads >= QUADS) return;
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

  /** The rubble at bt seconds after the strike (a huge bt: where it lies). */
  function poseRubble(bt) {
    for (let i = 0; i < RUBBLE; i++) {
      const p = R[i];
      const tau = bt - p[14];
      const k = tau <= 0 ? 0 : Math.min(1, tau / p[15]);
      const y = k >= 1 ? p[12] : p[13] - 0.5 * C.gravity * tau * tau;
      o3.position.set(mix(Math.cos(p[0]) * p[1], Math.cos(p[2]) * p[3], k), y, mix(Math.sin(p[0]) * p[1], Math.sin(p[2]) * p[3], k));
      o3.rotation.set(p[8] + p[9] * (1 - k), p[7], p[8] * 0.6 + p[10] * (1 - k));
      const s = tau <= 0 ? 0 : 1; // part of the vault until it lets go
      o3.scale.set(p[4] * s, p[5] * s, p[6] * s);
      o3.updateMatrix();
      rock.setMatrixAt(i, o3.matrix);
    }
    rock.instanceMatrix.needsUpdate = true;
  }

  function showLip(on) {
    rock.count = on ? RUBBLE + LIP : RUBBLE;
  }

  /** The shaft as the scene leaves it (and as a restore or a skip finds it). */
  function settle() {
    poseRubble(1e3);
    showLip(true);
    dust.clear(); dust.commit();
    glow.clear(); glow.commit();
    streak.visible = false;
    sky.visible = true;
    sky.scale.setScalar(1);
    cracks.visible = true;
    cracks.material.blending = THREE.NormalBlending; // dark fissures in the rock (CS-4)
    cracks.material.color.copy(FISSURE);
    cracks.material.opacity = 0.85;
    crackGeo.setDrawRange(0, quadsWithin(CRACK_REACH) * 6);
    setSpikes(true);
    light.color.copy(DAY);
    light.position.set(siteX, 2.6, siteZ);
    settled = true;
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
          streak.material.opacity = 0.85;
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
    setSpikes(bt >= C.drop); // the stalactites over the hole go with the first pieces
    // the hole opens from the middle as the pieces let go
    const open = smooth((bt - C.drop + 0.05) / (C.dropSpan + 0.25));
    sky.visible = open > 0;
    sky.scale.setScalar(0.12 + 0.88 * open);
    showLip(open > 0.55);
    poseRubble(bt);
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
      const p = R[(i * 5) % RUBBLE];
      const a = bt - p[14] - p[15];
      if (a <= 0 || a >= 1.7) { dust.hide(D_CEIL + D_VEIL + i); continue; }
      const r = p[3] + 0.9 * (1 - Math.exp(-a * 2));
      dust.set(D_CEIL + D_VEIL + i, Math.cos(p[2]) * r, 0.45 + 0.55 * a, Math.sin(p[2]) * r, 2.0 + 3.0 * (1 - Math.exp(-a * 1.8)),
        0.09 + 0.15 * L, 0.09 + 0.14 * L, 0.1 + 0.12 * L, 0.7 * smooth(a / 0.08) * Math.pow(1 - a / 1.7, 1.4));
    }
    dust.commit();
    // the one light: with the blast, then down into the shaft as the day comes on
    const down = smooth((bt - 0.45) / 0.6);
    light.color.copy(PINK).lerp(DAY, smooth((bt - 0.35) / 0.5));
    light.position.set(siteX + lx * (1 - down), mix(ly, 2.6, down), siteZ + lz * (1 - down));
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
    const down = smooth((t - strike - C.drop - 0.25) / 0.95);
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
    const tight = Math.max(30, Math.min(58, 2 * Math.atan(4 / Math.hypot(d, o.vault - y)) * deg));
    const whole = Math.max(36, Math.min(BASE_FOV, 1.3 * (Math.atan((o.vault - y) / d) + Math.atan(y / d)) * deg));
    const push = mix(mix(BASE_FOV, tight, smooth((t - strike) / 0.4)), whole, down);
    return lookFrom(pl.x, y, pl.z, aimA, mix(Math.min(near, push), BASE_FOV, home));
  }

  return {
    group, camera,
    setReducedFlash(v) { reduced = !!v; },
    update(sim, dt, time) {
      const w = sim && sim.cfg && sim.cfg.room === 'cave' ? sim.waves : null;
      const o = w && w.wayout && w.wayout.kind === 'vault' ? w.wayout : null;
      if (!o) { // no way up in this run (yet)
        group.visible = false;
        light.intensity = 0;
        rimLight.intensity = 0;
        setSpikes(false); // the vault is whole
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
      if (!group.visible) { light.intensity = 0; rimLight.intensity = 0; return; }
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
