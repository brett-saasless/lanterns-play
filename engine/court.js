// The Rose Court scene, built once from the room config and logic/courtmap.js: the daylight every
// part of the level shares (sky, visible sun, the one shadow map that follows the player, fog
// and exposure that grey with depth into the wood), the hedged garden with its fountain, throne,
// gargoyles and oddities, the outer ground, and the castle on its hill. Also the small geometry
// kit forest.js and props.js build with. The court is one zone: drawn from itself and band 1.
// Polish: the croquet lawn (ragged mown stripes, bent hoops, the peg, balls and mallets left
// lying, grass gone to seed) and the two boxes of earth as six-sided coffins, lids off, heaped
// with grave earth that spills over the side.

import * as THREE from 'three';
import { COURT, MAZE, routeOf, stageAt } from '../logic/courtmap.js';
import { weatherNow } from '../logic/weather.js';
import { SUN_LIGHT, SUN_SEEN, SKY_DITHER, greyAt, depthOf, LEAF_TONES } from '../logic/courtlook.js';
import * as S from './sculpt.js';

const _sky = { rain: 1, cloud: 1, sun: 0 }; // #28: scratch, so the frame allocates nothing

export const PAL = {
  lawn: 0x58b04c, lawnOut: 0x3d8a3c, hedge: 0x2f7a3a, hedgeDead: 0x8a7b45, gravel: 0xe2d6b0,
  roseWhite: 0xf3eedf, scarlet: 0xb3121b, gold: 0xc9a227, wetRed: 0x7a0f14, paint: 0xd3202a,
  stone: 0x8d8a82, stoneDark: 0x4e4b47, stonePale: 0xbdbab0, wood: 0x7b5a3a, rust: 0x8a4b2a,
  soil: 0x2a2018, crate: 0x5c4630, lantern: 0xffc66b, scorch: 0x1a1716, far: 0x6a7080,
};

// Light, sky and fog at the three stations of the level: the court, the wood's edge, the far end.
// Intensities are three r170 units, the block-outs' own; the far end's come from cfg.light.
// C1 (logic/courtlook.js): the light comes from behind the warden at the spawn; the sun is drawn
// ahead of him, where every shadow points.
const SUN_DIR = new THREE.Vector3(...SUN_LIGHT);
const SUN_SHOWN = new THREE.Vector3(...SUN_SEEN);
const COURT_LIGHT = { sun: 2.6, sky: 0.75, exposure: 1.05, fog: 0.004 };
const EDGE_LIGHT = { sun: 2.4, sky: 0.9, exposure: 1.08, fog: 0.006 };
const TONES = {
  sun: [0xfff1cf, 0xffd9a0, 0xc8d0d8], hemi: [0xbfe3ff, 0xfff0d0, 0xd4dce4], floor: [0x5a7a48, 0x4a6a3a, 0x6a6860],
  fog: [0xcfe6f2, 0xffe2b0, 0x87919a], top: [0x2f8fe8, 0x6faee6, 0x77818b], mid: [0x8ec5e8, 0xf3deb4, 0x87919a],
  low: [0xf1f6e4, 0xffe2b0, 0x8d969e],
};
const SHADOW_SIZES = [0, 1024, 2048]; // indexed by shadow level; 0 is off
const SHADOW_HALF = 30; // the box that follows the player, metres each way
const LOW_FPS = 45;
const LOW_FPS_HOLD = 3; // seconds under LOW_FPS before one step down (the cave's rule)
const FAR_PLANE = 440; // the castle is seen from the crater, 280 m off
const SKY_RADIUS = 400;
// After the Caterpillar's gate (#28, logic/weather.js): the cloud parts on a low sun setting in
// the west, ahead and to the left of the warden on the approach. The light comes from higher up
// than the disc shows, so the one shadow map's box still holds the shadows.
export const SET_SUN = new THREE.Vector3(-0.4, 0.19, -0.9).normalize();
export const SET_LIGHT = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
export const SET = { sun: 2.1, sky: 1.2, exposure: 0.98, fog: 0.009, sunHex: 0xffa860, hemiHex: 0xffd2a8, fogHex: 0xd8a27c, discHex: 0xffc27a };
export const TITLE_LOOP = 120; // seconds for the title fly-through of the whole level

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;

export { greyAt, depthOf }; // the greying curve lives in logic/courtlook.js

// ---- the kit ----------------------------------------------------------------------------------

let MATS = null;
/** Shared materials, all vertex-coloured so many parts merge into one draw call. */
export function mats() {
  if (!MATS) {
    MATS = {
      matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.55 }),
      wet: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.3 }),
      leaf: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
      decal: new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
    };
  }
  return MATS;
}

export const G = {
  box: (w, h, d, ws = 1, hs = 1, ds = 1) => new THREE.BoxGeometry(w, h, d, ws, hs, ds),
  cyl: (rt, rb, h, seg = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open),
  ball: (r, w = 10, h = 7) => new THREE.SphereGeometry(r, w, h),
  cone: (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg),
  ico: (r, detail = 1) => new THREE.IcosahedronGeometry(r, detail),
  torus: (R, r, rs = 6, ts = 14, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, rs, ts, arc),
  disc: (r, seg = 20) => new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2),
  plane: (w, d, ws = 1, ds = 1) => new THREE.PlaneGeometry(w, d, ws, ds).rotateX(-Math.PI / 2),
};

/** Pushes a round shape's surface in and out by noise of position, so its seams stay welded. */
export function lump(geo, amount, seed = 0, freq = 1.1) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const l = Math.hypot(x, y, z) || 1;
    const k = amount * S.noise(x * freq, y * freq, z * freq, seed);
    p.setXYZ(i, x + (x / l) * k, y + (y / l) * k, z + (z / l) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** The matrix for a position, a YXZ rotation and a scale (number or [x, y, z]). */
export function matrixOf(at = [0, 0, 0], rot = [0, 0, 0], scale = 1, out = new THREE.Matrix4()) {
  const s = Array.isArray(scale) ? scale : [scale, scale, scale];
  return out.compose(_p.set(at[0], at[1], at[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], 'YXZ')), _s.set(s[0], s[1], s[2]));
}

/**
 * Paints and places one geometry for merging. hex null keeps the colours it has.
 * o: at, rot, scale, vary (mottle 0 to 1), lump (metres), seed.
 */
export function part(geo, hex, o = {}) {
  if (o.lump) lump(geo, o.lump, o.seed || 0, o.freq);
  if (hex != null) S.tint(geo, hex, o.vary == null ? 0.12 : o.vary, o.seed || 0);
  geo.applyMatrix4(matrixOf(o.at, o.rot, o.scale, _m));
  return geo;
}

/** A tapering open tube from a to b (Vector3 or [x, y, z]), for branches, chains and rails. */
export function limb(a, b, r0, r1 = r0, sides = 5) {
  const A = Array.isArray(a) ? new THREE.Vector3(...a) : a;
  const B = Array.isArray(b) ? new THREE.Vector3(...b) : b;
  const d = new THREE.Vector3().subVectors(B, A);
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), sides, 1, true);
  _q.setFromUnitVectors(_up, d.normalize());
  g.applyMatrix4(_m.compose(_p.copy(A).add(B).multiplyScalar(0.5), _q, _s.set(1, 1, 1)));
  return g;
}

/** One mesh from a list of painted parts. */
export function bake(list, material, cast = true, receive = true) {
  if (!list.length) return new THREE.Group();
  const m = new THREE.Mesh(S.merge(list), material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/** An instanced mesh from [{ m: Matrix4, c?: Color }]. */
export function instanced(parent, geo, material, items, cast = false, receive = true) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.m);
    mesh.setColorAt(i, it.c || WHITE);
  });
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}
const WHITE = new THREE.Color(1, 1, 1);

/** A folded bat wing: side -1 or 1, hanging from the origin, `len` long. Front is -Z. */
export function batWing(side, len, hex, seed = 1) {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const g = G.cone(len * 0.22, len * (1 - 0.16 * k), 3).scale(1, 1, 0.16);
    parts.push(part(g, hex, { at: [side * len * 0.1 * k, -len * 0.42 + len * 0.08 * k, len * 0.05 * k], rot: [Math.PI + 0.12, side * (0.5 + 0.25 * k), side * (0.12 + 0.16 * k)], vary: 0.2, seed: seed + k }));
  }
  return S.merge(parts);
}

/** A crouching gargoyle about 1.5 m tall, sitting on y = 0, facing -Z. Stone, with red eyes apart. */
export function gargoyle(seed = 1) {
  const st = PAL.stone;
  const dk = PAL.stoneDark;
  const o = (budget, s) => ({ color: st, color2: dk, seed: seed + s, noise: 0.09, mottle: 0.22, budget });
  const parts = [
    S.skin([{ at: [0, 0.12, 0.25], r: [0.3, 0.24] }, { at: [0, 0.4, 0.12], r: [0.36, 0.32] }, { at: [0, 0.75, -0.08], r: [0.3, 0.27] },
      { at: [0, 1.0, -0.26], r: [0.2, 0.18] }, { at: [0, 1.12, -0.36], r: 0.14 }], o(380, 0)),
    S.skin([{ at: [0, 1.2, -0.3], r: [0.22, 0.2] }, { at: [0, 1.24, -0.48], r: [0.2, 0.17] }, { at: [0, 1.17, -0.66], r: [0.12, 0.09] },
      { at: [0, 1.13, -0.76], r: 0.05 }], o(240, 1)),
  ];
  for (const s of [-1, 1]) {
    parts.push(
      part(G.cone(0.06, 0.32, 5), dk, { at: [s * 0.15, 1.5, -0.3], rot: [0.3, 0, -s * 0.4] }),
      S.skin([{ at: [s * 0.26, 0.85, -0.2], r: 0.09 }, { at: [s * 0.3, 0.45, -0.38], r: 0.075 }, { at: [s * 0.28, 0.06, -0.42], r: 0.07 }], o(110, 3)),
      S.skin([{ at: [s * 0.3, 0.35, 0.2], r: 0.17 }, { at: [s * 0.38, 0.2, -0.1], r: 0.12 }, { at: [s * 0.36, 0.05, -0.3], r: 0.07 }], o(130, 5)),
      part(S.claw({ fingers: 3, length: 0.16, r: 0.025, color: dk, seed }), null, { at: [s * 0.28, 0.05, -0.44] }),
      part(batWing(s, 1.0, dk, seed), null, { at: [s * 0.2, 1.5, 0.12], rot: [0.5, 0, 0] }),
    );
  }
  return {
    body: S.merge(parts),
    eyes: S.merge([-1, 1].map((s) => part(G.ball(0.035, 6, 4), 0xff2a20, { at: [s * 0.09, 1.3, -0.62], vary: 0 }))),
  };
}

// ---- daylight: one per scene, shared by court.js, forest.js and props.js -----------------------

const RIGS = new WeakMap();

/** The level's root group, lights, sky, fog and shadow map. Built on first call for a scene. */
export function daylight(scene, cfg) {
  if (RIGS.has(scene)) return RIGS.get(scene);
  const far = { ...EDGE_LIGHT, ...((cfg && cfg.light) || {}) };
  const root = new THREE.Group();
  root.name = 'court';
  root.visible = false;
  scene.add(root);

  const hemi = new THREE.HemisphereLight(TONES.hemi[0], TONES.floor[0], COURT_LIGHT.sky);
  const sun = new THREE.DirectionalLight(TONES.sun[0], COURT_LIGHT.sun);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 190 });
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.05;
  root.add(hemi, sun, sun.target);

  const fog = new THREE.FogExp2(TONES.fog[0], COURT_LIGHT.fog);
  const background = new THREE.Color(TONES.low[0]);

  // Sky: a dome that rides with the camera, graded by three colours; the sun and its halo on it.
  const sky = new THREE.Group();
  root.add(sky);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(TONES.top[0]) }, mid: { value: new THREE.Color(TONES.mid[0]) }, low: { value: new THREE.Color(TONES.low[0]) },
      cloud: { value: 1 }, sunUp: { value: 0 }, setSun: { value: SET_SUN }, drift: { value: new THREE.Vector2() }, // #28
    },
    vertexShader: 'varying vec3 vDir;\nvoid main() {\n  vDir = position;\n  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n}',
    fragmentShader: [
      'uniform vec3 top;', 'uniform vec3 mid;', 'uniform vec3 low;', 'varying vec3 vDir;',
      'uniform float cloud;', 'uniform float sunUp;', 'uniform vec3 setSun;', 'uniform vec2 drift;',
      'float skyHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }',
      'float skyNoise( vec2 p ) {',
      '  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );',
      '  return mix( mix( skyHash( i ), skyHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( skyHash( i + vec2( 0.0, 1.0 ) ), skyHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );',
      '}',
      'void main() {',
      '  vec3 dir = normalize( vDir );',
      '  float h = dir.y;',
      '  vec3 c = mix( low, mid, smoothstep( 0.0, 0.3, h ) );',
      '  c = mix( c, top, smoothstep( 0.25, 0.95, h ) );',
      '  if ( cloud < 0.999 ) {',
      '    // #28: the overcast breaks; behind it, an evening sky going gold to the low sun.',
      '    float s = max( dot( dir, setSun ), 0.0 );',
      '    vec3 clear = mix( vec3( 0.98, 0.64, 0.36 ), vec3( 0.62, 0.56, 0.66 ), smoothstep( 0.0, 0.3, h ) );',
      '    clear = mix( clear, vec3( 0.25, 0.38, 0.64 ), smoothstep( 0.25, 0.85, h ) );',
      '    clear += vec3( 1.0, 0.5, 0.18 ) * ( 0.55 * pow( s, 6.0 ) + 0.5 * pow( s, 48.0 ) ) * sunUp;',
      '    vec2 q = dir.xz / ( max( h, 0.0 ) + 0.22 ) * 1.4 + drift;',
      '    float n = 0.5 * skyNoise( q ) + 0.25 * skyNoise( q * 2.03 + 3.1 ) + 0.125 * skyNoise( q * 4.1 + 7.7 ) + 0.0625 * skyNoise( q * 8.3 + 1.3 );',
      '    float t = mix( -0.2, 0.6, 1.0 - cloud );',
      '    float lid = smoothstep( t, t + 0.16, n );',
      '    vec3 lit = mix( c, c * 0.55 + vec3( 0.95, 0.52, 0.3 ) * ( 0.25 + 0.6 * pow( s, 2.0 ) ), sunUp );',
      '    c = mix( clear, lit, lid );',
      '  }',
      '  gl_FragColor = vec4( c, 1.0 );',
      '  #include <colorspace_fragment>',
      '  // C9: about one display level of noise, so the long gradient never bands.',
      '  gl_FragColor.rgb += ( skyHash( gl_FragCoord.xy ) - 0.5 ) * ' + (SKY_DITHER * 2).toFixed(6) + ';',
      '}',
    ].join('\n'),
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 24, 12), skyMat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  sky.add(dome);
  const sunAt = SUN_SHOWN.clone().multiplyScalar(SKY_RADIUS * 0.86); // C1: where the shadows point, not where the light is
  const setAt = SET_SUN.clone().multiplyScalar(SKY_RADIUS * 0.86); // #28: where the sun sets
  const discMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8, fog: false, toneMapped: false, transparent: true, depthWrite: false });
  const disc = new THREE.Mesh(new THREE.SphereGeometry(14, 20, 12), discMat);
  disc.position.copy(sunAt);
  sky.add(disc);
  const halos = [[24, 0.3], [40, 0.14], [64, 0.07]].map(([r, op]) => {
    const h = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12), new THREE.MeshBasicMaterial({
      color: 0xffe9a0, transparent: true, opacity: op, fog: false, depthWrite: false, toneMapped: false,
    }));
    h.position.copy(sunAt);
    h.userData.op = op;
    h.userData.hex = 0xffe9a0;
    sky.add(h);
    return h;
  });

  let renderer = null;
  let camera = null;
  let saved = null; // what apply changed on the renderer and camera, put back by hide
  let shadowLevel = 2;
  let lowFor = 0;
  let smoothFps = 60;
  let lastWall = 0;
  let lastRunTime = -1;
  let runAge = 0;
  const A = new THREE.Color();
  const B = new THREE.Color();
  const mix3 = (out, list, w, d) => out.setHex(list[0]).lerp(A.setHex(list[1]), w).lerp(B.setHex(list[2]), d);
  const hazes = []; // far things drawn without scene fog, hazed by hand: { material, court, end }

  const rig = {
    root, sun, hemi, fog, sky, sunDir: SUN_DIR, grey: 0, wood: 0, stage: 0,
    eye: new THREE.Vector3(0, 1.7, COURT.spawn.z),
    get shadowLevel() { return shadowLevel; },
    haze(material, court, end) { hazes.push({ material, court, end }); },
  };

  function applyShadows() {
    const on = shadowLevel > 0;
    if (renderer) renderer.shadowMap.enabled = on && root.visible;
    sun.castShadow = on;
    const size = SHADOW_SIZES[Math.max(1, shadowLevel)];
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }
  }

  /** Sets every light, the fog, the sky and the exposure for how far into the wood the eye is. */
  function grade(w, d, wx = null) {
    rig.wood = w;
    rig.grey = d;
    const blend = (a, b, c) => lerp(lerp(a, b, w), c, d);
    mix3(sun.color, TONES.sun, w, d);
    sun.intensity = blend(COURT_LIGHT.sun, EDGE_LIGHT.sun, far.sun);
    mix3(hemi.color, TONES.hemi, w, d);
    mix3(hemi.groundColor, TONES.floor, w, d);
    hemi.intensity = blend(COURT_LIGHT.sky, EDGE_LIGHT.sky, far.sky);
    mix3(fog.color, TONES.fog, w, d);
    fog.density = blend(COURT_LIGHT.fog, EDGE_LIGHT.fog, far.fog);
    mix3(skyMat.uniforms.top.value, TONES.top, w, d);
    mix3(skyMat.uniforms.mid.value, TONES.mid, w, d);
    mix3(skyMat.uniforms.low.value, TONES.low, w, d);
    background.copy(skyMat.uniforms.low.value);
    discMat.opacity = 1 - 0.93 * d; // overcast: the sun is a pale place in the cloud
    for (const h of halos) h.material.opacity = h.userData.op * (1 - 0.8 * d);
    if (renderer && root.visible) renderer.toneMappingExposure = blend(COURT_LIGHT.exposure, EDGE_LIGHT.exposure, far.exposure);
    clearing(wx);
    for (const hz of hazes) {
      const k = lerp(hz.court, hz.end, Math.max(w * 0.5, d));
      hz.material.color.setScalar(1 - k);
      hz.material.emissive.copy(fog.color).multiplyScalar(k);
    }
  }
  /**
   * #28: the sky after the Caterpillar's gate, over what grade set: the cloud parts in the dome,
   * the low sun shows and warms the light, the fog thins. wx is logic/weather.js's skyOf, or null
   * (and a cover of 1) for the overcast as it always was.
   */
  let sunSet = false;
  let lastSky = null; // the last weather follow() saw, so apply() grades the same sky
  const sunWay = SUN_DIR.clone(); // where the light comes from: follow() places the sun along it
  function clearing(wx) {
    lastSky = wx;
    const cover = wx ? wx.cloud : 1;
    const up = wx ? wx.sun : 0;
    skyMat.uniforms.cloud.value = cover;
    skyMat.uniforms.sunUp.value = up;
    const set = cover < 0.999;
    if (set !== sunSet) {
      sunSet = set;
      disc.position.copy(set ? setAt : sunAt);
      discMat.color.setHex(set ? SET.discHex : 0xfff6c8);
      for (const h of halos) {
        h.position.copy(disc.position);
        h.material.color.setHex(set ? SET.discHex : h.userData.hex);
      }
    }
    if (!set) {
      sunWay.copy(SUN_DIR);
      return;
    }
    const open = 1 - cover;
    discMat.opacity = up;
    for (const h of halos) h.material.opacity = h.userData.op * up * 1.4;
    sun.color.lerp(A.setHex(SET.sunHex), open);
    sun.intensity = lerp(sun.intensity, SET.sun, up);
    hemi.color.lerp(A.setHex(SET.hemiHex), open * 0.7);
    hemi.intensity = lerp(hemi.intensity, SET.sky, open);
    fog.color.lerp(A.setHex(SET.fogHex), open);
    fog.density = lerp(fog.density, SET.fog, open);
    background.lerp(A.setHex(0xf0a46a), open);
    if (renderer && root.visible) renderer.toneMappingExposure = lerp(renderer.toneMappingExposure, SET.exposure, open);
    sunWay.copy(SUN_DIR).lerp(SET_LIGHT, up).normalize();
  }
  grade(0, 0);

  function watchFrameRate(sim) {
    const now = performance.now() / 1000;
    const raw = now - lastWall;
    lastWall = now;
    if (sim.stats.time < lastRunTime) {
      shadowLevel = 2; // a new run: shadows may come back
      lowFor = 0;
      runAge = 0;
      smoothFps = 60;
      applyShadows();
    }
    lastRunTime = sim.stats.time;
    if (raw <= 0 || raw > 0.5 || shadowLevel === 0) return;
    runAge += raw;
    smoothFps += (1 / raw - smoothFps) * 0.05;
    if (runAge < 2) return; // first-use shader compiles are not the frame rate
    lowFor = smoothFps < LOW_FPS ? lowFor + raw : 0;
    if (lowFor >= LOW_FPS_HOLD) {
      shadowLevel -= 1;
      lowFor = 0;
      applyShadows();
    }
  }

  /** Once per frame: finds the eye, moves the sky and the shadow box to it, grades the light. */
  rig.follow = (sim, dt) => {
    if (!camera) camera = scene.children.find((o) => o.isCamera) || null;
    const p = camera ? camera.position : sim && sim.player;
    if (p) rig.eye.set(p.x, camera ? p.y : 1.7, p.z);
    const e = rig.eye;
    rig.stage = stageAt(e.x, e.z);
    sky.position.set(e.x, 0, e.z);
    // The shadow box moves in two-metre steps so its edges do not crawl as the player walks.
    const tx = Math.round(e.x / 2) * 2;
    const tz = Math.round((e.z - 4) / 2) * 2;
    const wx = sim && sim.cfg && sim.cfg.room === 'court' ? weatherNow(sim, _sky) : null;
    const wd = wx && sim.waves && sim.waves.weather && sim.waves.weather.drift;
    if (wd) skyMat.uniforms.drift.value.set(wd[0] + sim.stats.time * 0.012, wd[1] + sim.stats.time * 0.005); // the breaks drift east
    sun.target.position.set(tx, 0, tz);
    grade(clamp((-20 - e.z) / 10), greyAt(e.z), wx);
    sun.position.set(tx + sunWay.x * 90, sunWay.y * 90, tz + sunWay.z * 90);
    if (sim && sim.cfg && sim.cfg.room === 'court' && dt > 0 && sim.status === 'playing') watchFrameRate(sim);
  };

  /** Makes the level the room on screen: fog, sky, tone mapping, the long view and shadows. */
  rig.apply = (r) => {
    if (r) renderer = r;
    if (!camera) camera = scene.children.find((o) => o.isCamera) || null;
    if (!saved) {
      saved = {
        tone: renderer ? renderer.toneMapping : null,
        exposure: renderer ? renderer.toneMappingExposure : 1,
        far: camera ? camera.far : null,
      };
    }
    root.visible = true;
    scene.fog = fog;
    scene.background = background;
    if (renderer) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.setClearColor(background);
    }
    if (camera && camera.far < FAR_PLANE) {
      camera.far = FAR_PLANE;
      camera.updateProjectionMatrix();
    }
    applyShadows();
    grade(rig.wood, rig.grey, lastSky);
  };

  rig.hide = () => {
    root.visible = false;
    if (renderer) {
      renderer.shadowMap.enabled = false;
      if (saved && saved.tone != null) {
        renderer.toneMapping = saved.tone;
        renderer.toneMappingExposure = saved.exposure;
      }
    }
    if (camera && saved && saved.far != null && camera.far !== saved.far) {
      camera.far = saved.far;
      camera.updateProjectionMatrix();
    }
    saved = null;
  };

  RIGS.set(scene, rig);
  return rig;
}

// ---- the court's ground: one painted texture, so nothing is layered and nothing flickers ------

const GROUND = { minX: -24, maxX: 24, minZ: -24, maxZ: 24 };
const LAWN = { minX: 14.2, maxX: 19.3, minZ: 7.2, maxZ: 15.5, peg: [16.7, 11.4] }; // the croquet lawn

/**
 * A six-sided coffin's outline, as [x, z] corners: narrow at the head (-z), widest at the
 * shoulders a third of the way down, tapering to the foot. `inset` draws it in from the boards.
 */
function coffinOutline(len, wide, inset = 0) {
  const zs = -len / 2 + len * 0.3;
  const k = 1 - (2 * inset) / wide;
  const l = len / 2 - inset;
  return [[-0.3 * wide * k, -l], [0.3 * wide * k, -l], [0.5 * wide * k, zs], [0.22 * wide * k, l], [-0.22 * wide * k, l], [-0.5 * wide * k, zs]];
}

/** The outline as a flat slab `thick` deep, in the XY plane (x across, y along, foot at y = 0). */
function coffinSlab(len, wide, thick) {
  const sh = new THREE.Shape();
  coffinOutline(len, wide).forEach(([x, z], i) => (i ? sh.lineTo(x, -z + len / 2) : sh.moveTo(x, -z + len / 2)));
  sh.closePath();
  return new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
}

/**
 * The earth in a coffin: a lumpy mound over the inset outline, its rim at y = 0 and its crown
 * above, with a body-length hollow pressed down the middle. Grave earth, crumbs lighter.
 */
function coffinEarth(len, wide, seed) {
  const out = coffinOutline(len, wide, 0.05);
  const N = 30; // points round each ring
  const RINGS = 6;
  // Walk the outline by arc length.
  const edges = out.map((p, i) => [p, out[(i + 1) % out.length]]);
  const lens = edges.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
  const total = lens.reduce((a, b) => a + b, 0);
  const at = (t) => {
    let d = t * total;
    for (let i = 0; i < edges.length; i++) {
      if (d <= lens[i] || i === edges.length - 1) {
        const k = Math.min(1, d / lens[i]);
        return [edges[i][0][0] + (edges[i][1][0] - edges[i][0][0]) * k, edges[i][0][1] + (edges[i][1][1] - edges[i][0][1]) * k];
      }
      d -= lens[i];
    }
    return out[0];
  };
  const pos = [];
  const col = [];
  const idx = [];
  const dark = new THREE.Color(0x2b2019);
  const crumb = new THREE.Color(0x4a382a);
  const c = new THREE.Color();
  for (let r = 0; r <= RINGS; r++) {
    const k = r / RINGS;
    for (let i = 0; i < N; i++) {
      const [ox, oz] = at(i / N);
      const x = ox * k;
      const z = oz * k - (1 - k) * len * 0.04;
      const mound = 0.2 * (1 - k * k);
      const hollow = 0.15 * Math.exp(-((x / 0.15) ** 2)) * clamp(1.35 - Math.abs(z + len * 0.04) / (len * 0.3));
      const y = mound - hollow * clamp((1 - k) * 2.2) + 0.035 * S.noise(x * 7, seed, z * 7, seed) * clamp((1 - k) * 4);
      pos.push(x, y, z);
      c.copy(dark).lerp(crumb, clamp(0.5 + 0.9 * S.noise(x * 13, 2, z * 13, seed + 3))).multiplyScalar(1 - 0.35 * clamp(hollow * 6));
      col.push(c.r, c.g, c.b);
      if (r < RINGS) {
        const a = r * N + i;
        const b = r * N + ((i + 1) % N);
        idx.push(a, b, a + N, b, b + N, a + N);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function groundTexture(cfg) {
  const size = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const k = size / (GROUND.maxX - GROUND.minX);
  const X = (x) => (x - GROUND.minX) * k;
  const Z = (z) => (z - GROUND.minZ) * k;
  const rect = (x0, x1, z0, z1) => g.fillRect(X(x0), Z(z0), (x1 - x0) * k, (z1 - z0) * k);
  const rnd = S.rng(11);
  const speckle = (n, colors, x0, x1, z0, z1, r = 1.4) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[i % colors.length];
      g.globalAlpha = 0.2 + rnd() * 0.35;
      g.beginPath();
      g.arc(X(lerp(x0, x1, rnd())), Z(lerp(z0, z1, rnd())), 0.5 + rnd() * r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  };
  // Lawn, mown in stripes, darker outside the hedge.
  g.fillStyle = '#3d8a3c';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#58b04c';
  rect(-20, 20, -20, 20);
  g.fillStyle = 'rgba(120,200,96,0.3)';
  for (let x = -20; x < 20; x += 4) rect(x, x + 2, -20, 20);
  speckle(9000, ['#3f8f3f', '#6cc25a', '#4aa046', '#84c860'], -24, 24, -24, 24);
  // The croquet lawn: mown in narrow stripes once, the mower's edges ragged and wandering.
  for (let i = 0; i < 8; i++) {
    const x0 = 14 + i * 0.68;
    g.fillStyle = i % 2 ? 'rgba(168,224,120,0.5)' : 'rgba(40,112,52,0.42)';
    for (let z = 7; z < 15.6; z += 0.22) {
      const wob = 0.09 * Math.sin(z * 1.7 + i * 2.1) + (rnd() - 0.5) * 0.14;
      rect(x0 + wob, x0 + 0.68 + wob + (rnd() - 0.5) * 0.12, z, z + 0.24);
    }
  }
  // Gone to seed: a ragged yellowing patch over the stripes, worn bare round the peg.
  for (let i = 0; i < 260; i++) {
    g.fillStyle = i % 3 ? 'rgba(170,176,84,0.13)' : 'rgba(132,150,70,0.15)';
    g.beginPath();
    g.arc(X(lerp(14, 19.4, rnd())), Z(lerp(7, 15.6, rnd())), (0.3 + rnd() * 0.9) * k, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = 'rgba(104,84,56,0.16)';
    g.beginPath();
    g.arc(X(LAWN.peg[0] + (rnd() - 0.5) * 1.3), Z(LAWN.peg[1] + (rnd() - 0.5) * 1.3), (0.1 + rnd() * 0.3) * k, 0, Math.PI * 2);
    g.fill();
  }
  // Earth round the beds, the gravel walks, the plaza's checker flags, the stone rills.
  for (const z of cfg.surfaces.zones) {
    if (z.minZ < GROUND.minZ - 1 || z.z < GROUND.minZ) continue; // the wood's zones
    if (z.material === 'earth' && z.shape === 'rect') {
      g.fillStyle = '#4a3a2a';
      rect(z.minX, z.maxX, z.minZ, z.maxZ);
      speckle(500, ['#2a2018', '#5c4630', '#3a2c20'], z.minX, z.maxX, z.minZ, z.maxZ, 2);
    } else if (z.material === 'gravel') {
      g.fillStyle = '#e2d6b0';
      rect(z.minX, z.maxX, Math.max(z.minZ, GROUND.minZ), z.maxZ);
      speckle(2600, ['#cdbf96', '#f0e6c6', '#b8aa84', '#d8ccaa'], z.minX, z.maxX, Math.max(z.minZ, GROUND.minZ), z.maxZ, 1.1);
    }
  }
  const pl = COURT.plaza;
  g.save();
  g.beginPath();
  g.arc(X(pl.x), Z(pl.z), pl.r * k, 0, Math.PI * 2);
  g.clip();
  const flag = (pl.r * 2) / 16;
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      g.fillStyle = (i + j) % 2 ? '#3a3d42' : '#ece6d2';
      rect(pl.x - pl.r + i * flag, pl.x - pl.r + (i + 1) * flag, pl.z - pl.r + j * flag, pl.z - pl.r + (j + 1) * flag);
    }
  }
  speckle(1800, ['#8d8a82', '#4e4b47', '#c9c4b2'], -pl.r, pl.r, -pl.r, pl.r, 1.8);
  g.restore();
  g.strokeStyle = '#8d8a82';
  g.lineWidth = 0.28 * k;
  g.beginPath();
  g.arc(X(pl.x), Z(pl.z), pl.r * k, 0, Math.PI * 2);
  g.stroke();
  for (const r of [...COURT.rills, COURT.threshold]) {
    g.fillStyle = '#8d8a82';
    rect(r.minX - 0.12, r.maxX + 0.12, r.minZ - 0.12, r.maxZ + 0.12);
    g.fillStyle = '#4e4b47';
    rect(r.minX, r.maxX, r.minZ, r.maxZ);
  }
  // Scorch round the crater.
  const cr = COURT.crater;
  const grad = g.createRadialGradient(X(cr.x), Z(cr.z), cr.r * k * 0.5, X(cr.x), Z(cr.z), cr.r * k * 3.2);
  grad.addColorStop(0, 'rgba(20,18,16,0.9)');
  grad.addColorStop(1, 'rgba(20,18,16,0)');
  g.fillStyle = grad;
  rect(cr.x - 6, cr.x + 6, cr.z - 6, cr.z + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---- the castle on its hill ---------------------------------------------------------------------

export const CASTLE = { x: 0, z: -262, hillR: 70, hillY: -24, squash: 0.6 };
const hillAt = (x, z) => {
  const q = CASTLE.hillR ** 2 - (x - CASTLE.x) ** 2 - (z - CASTLE.z) ** 2;
  return q > 0 ? CASTLE.hillY + CASTLE.squash * Math.sqrt(q) : -1;
};

function buildCastle(rig) {
  const group = new THREE.Group();
  const stone = [];
  const far = PAL.far;
  const base = hillAt(CASTLE.x, CASTLE.z + 7) - 0.2; // the door sill
  const at = (x, y, z) => [CASTLE.x + x, base + y, CASTLE.z + z];
  stone.push(part(G.ball(CASTLE.hillR, 28, 14), 0x4a6a44, { at: [CASTLE.x, CASTLE.hillY, CASTLE.z], scale: [1, CASTLE.squash, 1], vary: 0.25, freq: 0.05 }));
  stone.push(part(G.box(46, 30, 14), far, { at: at(0, 11, 0), vary: 0.1 }));
  for (let i = 0; i < 12; i++) stone.push(part(G.box(2.2, 2.4, 14.4), far, { at: at(-21 + i * 3.82, 27.2, 0), vary: 0.1 }));
  for (const [x, h, r] of [[-24, 40, 4], [24, 46, 4], [0, 58, 4.6], [-10, 34, 3.2], [13, 32, 3.2]]) {
    stone.push(part(G.cyl(r, r * 1.15, h + 4, 10), far, { at: at(x, h / 2 - 2, x ? 0 : -2), vary: 0.1 }));
    stone.push(part(G.cyl(r * 1.25, r * 1.05, 2.2, 10), far, { at: at(x, h + 1, x ? 0 : -2), vary: 0.1 }));
    stone.push(part(G.cone(r * 1.3, 13, 10), 0x474c5c, { at: at(x, h + 8.5, x ? 0 : -2), vary: 0.1 }));
  }
  // Gatehouse, the dark door and the drawbridge down, with a road to the approach's far end.
  stone.push(part(G.box(12, 15, 3), far, { at: at(0, 7.5, 8) }));
  stone.push(part(G.box(7, 11, 0.6), 0x101012, { at: at(0, 5.5, 9.6), vary: 0 }));
  const bridgeEnd = [CASTLE.x, hillAt(CASTLE.x, CASTLE.z + 24) + 0.2, CASTLE.z + 24];
  const sill = at(0, 0.2, 9.9);
  const span = Math.hypot(bridgeEnd[2] - sill[2], bridgeEnd[1] - sill[1]);
  stone.push(part(G.box(6.4, 0.5, span), PAL.wood, {
    at: [CASTLE.x, (sill[1] + bridgeEnd[1]) / 2, (sill[2] + bridgeEnd[2]) / 2], rot: [Math.atan2(sill[1] - bridgeEnd[1], bridgeEnd[2] - sill[2]), 0, 0],
  }));
  for (const s of [-1, 1]) stone.push(part(limb(at(s * 3, 10.5, 9.8), [bridgeEnd[0] + s * 3, bridgeEnd[1] + 0.3, bridgeEnd[2]], 0.12, 0.12, 4), 0x2a2c33, { vary: 0 }));
  const road = [];
  for (let z = CASTLE.z + 24; z <= CASTLE.z + 57.5; z += 3) road.push(z);
  for (let i = 0; i < road.length - 1; i++) {
    const y0 = Math.max(0, hillAt(CASTLE.x, road[i])) + 0.25;
    const y1 = Math.max(0, hillAt(CASTLE.x, road[i + 1])) + 0.25;
    stone.push(part(G.box(5, 0.3, Math.hypot(3, y1 - y0) + 0.3), 0xa89c80, { at: [CASTLE.x, (y0 + y1) / 2, road[i] + 1.5], rot: [Math.atan2(y0 - y1, 3), 0, 0] }));
  }
  // Drawn without scene fog and hazed by hand, so it reads from the crater and from the approach.
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, fog: false, emissive: 0x000000 });
  rig.haze(mat, 0.5, 0.3);
  const body = bake(stone, mat, false, false);
  group.add(body);
  // One window lit at noon; the rest show as the light fails.
  const lit = bake([part(G.box(1.5, 2.8, 0.5), PAL.lantern, { at: at(0, 40, 2.9), vary: 0 })], new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), false, false);
  const others = [[-24, 28], [24, 34], [-10, 22], [13, 20], [-16, 14], [17, 12], [-5, 16], [6, 18]].map(([x, y]) => part(G.box(1.1, 2.1, 0.5), PAL.lantern, { at: at(x, y, x === -24 || x === 24 ? 4.3 : x === -10 || x === 13 ? 3.6 : 7.2), vary: 0 }));
  const dusk = bake(others, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), false, false);
  group.add(lit, dusk);
  return { group, dusk };
}

// ---- the court -----------------------------------------------------------------------------------

/** Where props.js hangs water on the statue and fills the basin (world space). */
export const FOUNTAIN = { half: 3.0, floorY: 0.5, rimY: 1.05, wingTips: [[-0.42, 2.55, -0.42], [0.42, 2.55, -0.42], [-0.2, 2.4, -0.5], [0.2, 2.4, -0.5]] };

export function buildCourt(scene, cfg) {
  const rig = daylight(scene, cfg);
  const M = mats();
  const rnd = S.rng(7);
  const rr = (a, b) => a + rnd() * (b - a);
  const group = new THREE.Group(); // the garden itself: hidden from band 2 on
  group.name = 'garden';
  rig.root.add(group);
  const far = new THREE.Group(); // outer ground and the castle: always drawn
  rig.root.add(far);

  const solid = []; // matte, casts
  const flat = []; // matte, no shadow cast (ground-hugging things)
  const metal = [];
  const glow = [];
  const boxOf = (kind) => COURT.boxes.filter((b) => b.kind === kind);

  // Ground.
  const ground = new THREE.Mesh(
    G.plane(GROUND.maxX - GROUND.minX, GROUND.maxZ - GROUND.minZ),
    new THREE.MeshStandardMaterial({ map: groundTexture(cfg), roughness: 0.92, metalness: 0 }),
  );
  ground.position.set((GROUND.minX + GROUND.maxX) / 2, 0, (GROUND.minZ + GROUND.maxZ) / 2);
  ground.receiveShadow = true;
  group.add(ground);
  {
    // Outer ground: lawn beyond the hedge, the wood's flanks greying with depth, the far side.
    const outer = [part(G.plane(280, 184), PAL.lawnOut, { at: [0, -0.06, 68], vary: 0 })];
    const tone = new THREE.Color();
    const wood = (z) => tone.setHex(0x4f9a46).lerp(new THREE.Color(0x6a6658), Math.min(1, greyAt(z) * 1.1)).getHex();
    for (let z = MAZE.z0; z > -204; z -= 12) {
      for (const s of [-1, 1]) outer.push(part(G.plane(160, 12), wood(z - 6), { at: [s * 120, -0.06, z - 6], vary: 0 }));
    }
    outer.push(part(G.plane(400, 230), 0x6a6658, { at: [0, -0.06, -204 - 115], vary: 0 }));
    far.add(bake(outer, M.matte, false, true));
  }
  const castle = buildCastle(rig);
  far.add(castle.group);

  // Hedges, clipped, one block in seven dying.
  for (const b of boxOf('hedge')) {
    const along = b.w >= b.d;
    const len = along ? b.w : b.d;
    const n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i < n; i++) {
      const dead = rnd() < 1 / 7;
      const h = dead ? rr(2.5, 2.9) : rr(3.05, 3.4);
      const t = (i + 0.5) / n - 0.5;
      const w = len / n + 0.06;
      const thick = (along ? b.d : b.w) + 0.1;
      solid.push(part(G.box(along ? w : thick, h, along ? thick : w, 2, 2, 2), dead ? PAL.hedgeDead : PAL.hedge, {
        at: [b.x + (along ? t * len : 0), h / 2, b.z + (along ? 0 : t * len)], vary: 0.3, lump: dead ? 0.22 : 0.1, seed: i, freq: 0.9,
      }));
    }
  }
  // The arch into the wood: stone piers and ring, a hedge lintel, a gargoyle on each pier.
  const arch = COURT.arch;
  const pierX = arch.width / 2 + 0.6;
  for (const s of [-1, 1]) {
    solid.push(part(G.box(1.15, 5.2, 1.15), PAL.stone, { at: [arch.x + s * pierX, 2.6, arch.z + 0.15], vary: 0.2, seed: s }));
    solid.push(part(G.box(1.5, 0.3, 1.5), PAL.stonePale, { at: [arch.x + s * pierX, 5.35, arch.z + 0.15] }));
  }
  solid.push(part(G.torus(arch.width / 2 + 0.25, 0.3, 6, 18, Math.PI), PAL.stonePale, { at: [arch.x, 1.2, arch.z + 0.15], vary: 0.2 }));
  solid.push(part(G.box(arch.width + 2.4, 1.6, 4.1, 4, 1, 2), PAL.hedge, { at: [arch.x, 6.1, arch.z - 2], vary: 0.3, lump: 0.12, freq: 0.8 }));
  const garg = [gargoyle(3), gargoyle(8), gargoyle(13), gargoyle(21)];
  const perch = (i, x, y, z, ry, tilt = 0) => {
    solid.push(part(garg[i].body, null, { at: [x, y, z], rot: [0, ry, tilt], scale: 1.15 }));
    glow.push(part(garg[i].eyes, null, { at: [x, y, z], rot: [0, ry, tilt], scale: 1.15 }));
  };
  perch(0, arch.x - pierX, 5.5, arch.z + 0.15, Math.PI - 0.3);
  perch(1, arch.x + pierX, 5.5, arch.z + 0.15, Math.PI + 0.3, 0.05);
  // Two more on broken pillars sunk in the hedge corners, and a pillar toppled along the south hedge.
  for (const [i, x, z, h, ry, tilt] of [[2, -20.6, 20.6, 3.6, -Math.PI / 4, 0], [3, 20.6, -19.2, 4.1, Math.PI * 0.75, -0.07]]) {
    solid.push(part(G.cyl(0.6, 0.72, h, 12), PAL.stone, { at: [x, h / 2, z], vary: 0.25, seed: i }));
    solid.push(part(G.box(1.6, 0.3, 1.6), PAL.stonePale, { at: [x, h + 0.15, z] }));
    perch(i, x, h + 0.3, z, ry, tilt);
  }
  solid.push(part(G.cyl(0.42, 0.5, 3.4, 12), PAL.stone, { at: [16.4, 0.36, 19.75], rot: [0, 0.03, Math.PI / 2 - 0.05], vary: 0.25 }));
  solid.push(part(G.box(1.2, 0.26, 1.2), PAL.stonePale, { at: [14.3, 0.2, 19.6], rot: [0.3, 0.4, 0.5] }));

  // The dry fountain: a round step, a square cracked basin, a pedestal, and the two-faced statue.
  {
    const f = COURT.fountain;
    const fb = boxOf('fountain')[0];
    const half = fb ? fb.w / 2 : 3.2;
    flat.push(part(G.cyl(f.r, f.r + 0.1, 0.14, 40), PAL.stonePale, { at: [f.x, 0.07, f.z], vary: 0.2 }));
    for (const [dx, dz, w, d] of [[0, -1, half * 2, 0.5], [0, 1, half * 2, 0.5], [-1, 0, 0.5, half * 2 - 1], [1, 0, 0.5, half * 2 - 1]]) {
      solid.push(part(G.box(w, 0.95, d, 4, 1, 4), PAL.stone, { at: [f.x + dx * (half - 0.25), 0.6, f.z + dz * (half - 0.25)], vary: 0.25, seed: dx + dz * 2 }));
      solid.push(part(G.box(w + 0.16, 0.12, d + 0.16), PAL.stonePale, { at: [f.x + dx * (half - 0.25), 1.12, f.z + dz * (half - 0.25)] }));
    }
    flat.push(part(G.box(half * 2 - 0.9, 0.1, half * 2 - 0.9), 0xa59c84, { at: [f.x, FOUNTAIN.floorY - 0.05, f.z], vary: 0.3 })); // dry bed
    for (const [x, z, r] of [[-1.4, 0.9, 0.5], [1.1, -1.7, -0.3], [0.4, 1.9, 1.1]]) flat.push(part(G.box(1.7, 0.02, 0.05), PAL.stoneDark, { at: [f.x + x, FOUNTAIN.floorY + 0.01, f.z + z], rot: [0, r, 0], vary: 0 }));
    solid.push(part(G.cyl(0.55, 0.85, 1.5, 12), PAL.stone, { at: [f.x, 1.2, f.z], vary: 0.2 }));
    solid.push(part(G.cyl(1.3, 0.75, 0.3, 16), PAL.stonePale, { at: [f.x, 2.05, f.z], vary: 0.2 }));
    for (let i = 0; i < 4; i++) { // small gargoyle spouts at the pedestal's four faces
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      solid.push(part(S.skin([{ at: [0, 0, 0.1], r: 0.13 }, { at: [0, 0.02, -0.12], r: [0.12, 0.1] }, { at: [0, -0.03, -0.3], r: 0.05 }], { color: PAL.stoneDark, seed: i, budget: 90 }), null, { at: [f.x + Math.sin(a) * 0.8, 1.5, f.z + Math.cos(a) * 0.8], rot: [0, a + Math.PI, 0] }));
    }
    // The statue faces south: a girl in a pinafore. From the north, folded wings.
    const st = PAL.stonePale;
    const girl = [
      S.skin([{ at: [0, 0, 0], r: [0.62, 0.56] }, { at: [0, 0.5, 0], r: [0.5, 0.44] }, { at: [0, 0.95, 0], r: [0.24, 0.2] },
        { at: [0, 1.3, 0], r: [0.27, 0.19] }, { at: [0, 1.52, 0], r: 0.09 }], { color: st, color2: PAL.stone, seed: 4, noise: 0.03, budget: 520, mottle: 0.18, caps: ['flat', 'round'] }),
      S.skin([{ at: [0, 1.55, 0], r: 0.1 }, { at: [0, 1.74, -0.01], r: [0.2, 0.21] }, { at: [0, 1.94, 0], r: [0.19, 0.2] }, { at: [0, 2.06, 0.02], r: 0.1 }], { color: st, seed: 5, noise: 0.02, budget: 300 }),
      part(G.ball(0.13, 8, 6), st, { at: [0, 2.0, 0.2] }), // a bun of hair
      part(G.box(0.44, 0.62, 0.05), st, { at: [0, 0.78, -0.4], rot: [0.16, 0, 0] }), // the pinafore
      part(G.ball(0.035, 6, 4), PAL.stoneDark, { at: [-0.075, 1.8, -0.2], vary: 0 }),
      part(G.ball(0.035, 6, 4), PAL.stoneDark, { at: [0.075, 1.8, -0.2], vary: 0 }),
      part(G.torus(0.06, 0.012, 4, 8, Math.PI), PAL.stoneDark, { at: [0, 1.7, -0.2], rot: [0, 0, Math.PI], vary: 0 }),
    ];
    for (const s of [-1, 1]) {
      girl.push(S.skin([{ at: [s * 0.27, 1.38, 0], r: 0.075 }, { at: [s * 0.33, 1.08, -0.1], r: 0.06 }, { at: [s * 0.1, 0.98, -0.32], r: 0.05 }], { color: st, seed: 6, budget: 100 }));
      girl.push(part(batWing(s, 1.35, PAL.stoneDark, 9), null, { at: [s * 0.16, 1.5, 0.3], rot: [-0.12, 0, 0] }));
    }
    solid.push(part(S.merge(girl), null, { at: [f.x, 2.2, f.z], rot: [0, Math.PI, 0] }));
    // Fallen coping stones.
    solid.push(part(G.box(1.2, 0.4, 0.7), PAL.stone, { at: [f.x + 3.9, 0.3, f.z + 2.4], rot: [0.1, 0.5, 0.08], vary: 0.25 }));
  }

  // Stone kerbs to the rills (the water in them is water.js).
  for (const r of [...COURT.rills, COURT.threshold]) {
    const along = r.w >= r.d;
    for (const s of [-1, 1]) {
      flat.push(part(G.box(along ? r.w : 0.12, 0.07, along ? 0.12 : r.d), PAL.stonePale, { at: [r.x + (along ? 0 : s * (r.w / 2 + 0.06)), 0.035, r.z + (along ? s * (r.d / 2 + 0.06) : 0)], vary: 0.2 }));
    }
  }

  // The empty throne under its canopy, facing the fountain, a heart cut in the back and scratched out.
  {
    const t = COURT.throne;
    const local = [
      part(G.box(4.4, 0.12, 3.6), PAL.stonePale, { at: [0, 0.06, 0] }),
      part(G.box(1.5, 0.75, 1.3), PAL.scarlet, { at: [0, 0.5, 0], vary: 0.2 }),
      part(G.box(1.6, 2.6, 0.28), PAL.scarlet, { at: [0, 1.3, -0.62], vary: 0.2 }),
      part(G.box(0.22, 0.5, 1.3), 0x8a0e15, { at: [-0.7, 1.05, 0] }),
      part(G.box(0.22, 0.5, 1.3), 0x8a0e15, { at: [0.7, 1.05, 0] }),
      part(S.pip('heart', 0.62), 0x5a0a0f, { at: [0, 1.9, -0.47], vary: 0 }),
      part(G.box(4.3, 0.12, 3.5, 6, 1, 4), PAL.scarlet, { at: [0, 4.3, 0], rot: [0, 0, 0.05], vary: 0.25, lump: 0.1 }),
      part(G.box(4.3, 0.5, 0.05, 8, 1, 1), 0x8a0e15, { at: [0, 4.0, 1.75], rot: [0, 0, 0.05], lump: 0.06 }),
    ];
    for (const [a, x, y] of [[0.7, -0.05, 1.95], [-0.6, 0.06, 1.88], [0.2, 0, 1.8], [1.2, -0.02, 1.98]]) local.push(part(G.box(0.62, 0.018, 0.02), 0x2a0608, { at: [x, y, -0.465], rot: [0, 0, a], vary: 0 }));
    solid.push(part(S.merge(local), null, { at: [t.x, 0, t.z], rot: [0, Math.PI / 2, 0] }));
    const gilt = [part(G.cone(0.3, 0.5, 4), PAL.gold, { at: [0, 2.85, -0.62] })];
    [[-2, -1.6], [2, -1.6], [-2, 1.6], [2, 1.6]].forEach(([x, z], i) => gilt.push(part(G.cyl(0.06, 0.07, 4.3, 7), PAL.gold, { at: [x, 2.15, z], rot: [0, 0, i === 3 ? 0.1 : 0] })));
    metal.push(part(S.merge(gilt), null, { at: [t.x, 0, t.z], rot: [0, Math.PI / 2, 0] }));
  }

  // Croquet, gone to seed: rusted hoops, some bent or down, the striped peg, the four balls and
  // two mallets lying where they fell, and the grass standing in seed heads.
  {
    const [px, pz] = LAWN.peg;
    const hoop = (x, z, ry, lean, sunk = 0) => {
      const parts = [G.torus(0.2, 0.016, 5, 10, Math.PI).translate(0, 0.3, 0)];
      for (const sx of [-1, 1]) parts.push(G.cyl(0.016, 0.016, 0.3, 5).translate(sx * 0.2, 0.15, 0));
      metal.push(part(S.merge(parts), 0xcfc8b4, { at: [x, -sunk, z], rot: [lean, ry, 0], vary: 0.45, seed: x }));
    };
    hoop(px - 1.7, pz - 2.9, 0.1, 0);
    hoop(px + 1.6, pz - 2.7, -0.2, 0.5); // leaning
    hoop(px, pz - 1.5, 0.05, 0);
    hoop(px - 0.1, pz + 1.6, 0.3, -1.45); // flat on its face
    hoop(px - 1.8, pz + 2.9, -0.1, 0.25, 0.08);
    hoop(px + 1.7, pz + 3.0, 0.6, 0);
    // The peg: a turned post, its four colour bands faded.
    solid.push(part(G.cyl(0.022, 0.03, 0.5, 8), 0xe8e2d0, { at: [px, 0.25, pz], rot: [0.08, 0, 0.12], vary: 0.2 }));
    const BALLS = [0x2a4a8a, PAL.paint, 0x17181b, 0xd9b23a];
    BALLS.forEach((hex, i) => solid.push(part(G.cyl(0.031, 0.031, 0.045, 8), hex, { at: [px + 0.045 - i * 0.006, 0.44 - i * 0.055, pz - 0.03 + i * 0.004], rot: [0.08, 0, 0.12], vary: 0.25 })));
    [[-0.9, -2.2], [1.25, 0.9], [-2.1, 1.3], [0.5, 3.4]].forEach(([dx, dz], i) => solid.push(part(G.ball(0.095, 10, 7), BALLS[i], { at: [px + dx, 0.09, pz + dz], vary: 0.2, seed: i })));
    const mallet = (x, z, ry, hex) => {
      const local = [
        part(G.cyl(0.016, 0.02, 0.95, 6), PAL.wood, { at: [0.47, 0.06, 0], rot: [0, 0, Math.PI / 2], vary: 0.25 }),
        part(G.cyl(0.055, 0.055, 0.26, 8), 0x9a7a52, { at: [0.95, 0.06, 0], rot: [Math.PI / 2, 0, 0], vary: 0.25 }),
        part(G.cyl(0.057, 0.057, 0.03, 8), hex, { at: [0.95, 0.06, 0.09], rot: [Math.PI / 2, 0, 0], vary: 0.2 }),
        part(G.cyl(0.057, 0.057, 0.03, 8), hex, { at: [0.95, 0.06, -0.09], rot: [Math.PI / 2, 0, 0], vary: 0.2 }),
      ];
      solid.push(part(S.merge(local), null, { at: [x, 0, z], rot: [0, ry, 0] }));
    };
    mallet(px + 0.6, pz - 2.0, 0.6, PAL.paint);
    mallet(px - 1.9, pz + 0.4, -1.9, 0x2a4a8a);
  }
  // Seeding grass: a few blades and a nodding seed head to each tuft, thickest at the lawn's edges.
  const tuftGeo = (() => {
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      parts.push(part(G.cone(0.035, 1, 3).scale(1, 1, 0.35), 0xffffff, { at: [Math.cos(a) * 0.035, 0.5, Math.sin(a) * 0.035], rot: [0.14 * Math.cos(a), a, 0.14 * Math.sin(a)], vary: 0.15 }));
    }
    parts.push(part(limb([0, 0, 0], [0.03, 1.12, 0.02], 0.007, 0.005, 3), 0xf2e6b0, { vary: 0.1 }));
    parts.push(part(G.ico(0.045, 0), 0xf7ecc0, { at: [0.045, 1.2, 0.03], scale: [0.7, 2.6, 0.7], rot: [0, 0, -0.3], vary: 0.2 }));
    return S.merge(parts);
  })();
  const tufts = [];
  for (let i = 0; i < 130; i++) {
    const h = rr(0.25, 0.7);
    const x = rr(LAWN.minX, LAWN.maxX);
    const z = rr(LAWN.minZ, LAWN.maxZ);
    if (Math.hypot(x - LAWN.peg[0], z - LAWN.peg[1]) < 0.7) continue; // worn bare at the peg
    tufts.push({ m: matrixOf([x, 0, z], [rr(-0.15, 0.15), rr(0, 6), rr(-0.15, 0.15)], [1.2, h, 1.2]), c: new THREE.Color(rnd() < 0.45 ? 0xb9b05c : 0x5d9a48) });
  }
  instanced(group, tuftGeo, M.matte, tufts);

  // Boxes of earth: two of the fifty. Six-sided coffins on their bearers, lids off, heaped with
  // grave earth pressed down where something lay, and spilling over one side.
  boxOf('earthbox').forEach((b, i) => {
    const elm = 0x3a2a20;
    const len = b.d - 0.06;
    const wide = b.w - 0.12;
    const baseY = 0.2; // the bearers' height
    const deep = b.h - baseY - 0.18; // the boards; the earth mounds above the rim to the box's top
    const boards = 0.045;
    const local = [];
    const out = coffinOutline(len, wide);
    out.forEach(([x0, z0], k) => {
      const [x1, z1] = out[(k + 1) % out.length];
      const l = Math.hypot(x1 - x0, z1 - z0);
      local.push(part(G.box(l + boards, deep, boards, 2, 1, 1), elm, { at: [(x0 + x1) / 2, baseY + deep / 2, (z0 + z1) / 2], rot: [0, -Math.atan2(z1 - z0, x1 - x0), 0], vary: 0.3, seed: i * 7 + k }));
    });
    local.push(part(coffinSlab(len, wide, boards).rotateX(-Math.PI / 2).translate(0, baseY, len / 2), elm, { vary: 0.3, seed: i })); // the floor
    for (const z of [-len * 0.3, len * 0.3]) local.push(part(G.box(wide + 0.1, baseY, 0.12), 0x2a1f18, { at: [0, baseY / 2, z], vary: 0.3 }));
    local.push(part(coffinEarth(len, wide, 5 + i), null, { at: [0, baseY + deep - 0.03, 0] }));
    // The spill: earth over the rim on one side, a heap below it and crumbs across the grass.
    const side = i === 0 ? 1 : -1;
    const sx = side * (wide * 0.42);
    local.push(part(G.ico(0.2, 1), 0x2b2019, { at: [sx, baseY + deep - 0.02, len * 0.08], scale: [1.1, 0.5, 1.6], lump: 0.07, vary: 0.4, freq: 5, seed: i }));
    local.push(part(G.ico(0.3, 1), 0x2b2019, { at: [sx + side * 0.2, 0.05, len * 0.1], scale: [1.1, 0.55, 1.7], lump: 0.1, vary: 0.45, freq: 4, seed: i + 2 }));
    local.push(part(G.cone(0.2, deep, 6), 0x2b2019, { at: [sx + side * 0.09, baseY + deep * 0.45, len * 0.08], scale: [0.6, 1, 1.5], rot: [0, 0, side * 0.18], lump: 0.05, vary: 0.4, freq: 6 })); // the fall of it down the boards
    for (let k = 0; k < 14; k++) local.push(part(G.ico(rr(0.025, 0.06), 0), k % 3 ? 0x2b2019 : 0x4a382a, { at: [sx + side * rr(0.25, 0.95), 0.03, len * 0.1 + rr(-0.7, 0.7)], rot: [rr(0, 3), rr(0, 3), 0], vary: 0.3 }));
    solid.push(part(S.merge(local), null, { at: [b.x, 0, b.z] }));
    // Brass: three drop handles down each long side.
    for (const s of [-1, 1]) {
      for (const t of [0.2, 0.5, 0.78]) {
        const z = -len / 2 + len * t;
        const hw = t < 0.3 ? lerp(0.3, 0.5, t / 0.3) : lerp(0.5, 0.22, (t - 0.3) / 0.7);
        metal.push(part(G.torus(0.06, 0.011, 4, 8, Math.PI), 0xc9a227, { at: [b.x + s * (hw * wide + 0.035), baseY + deep * 0.62, b.z + z], rot: [0, Math.PI / 2, Math.PI], vary: 0.15 }));
        metal.push(part(G.box(0.012, 0.05, 0.17), 0xc9a227, { at: [b.x + s * (hw * wide + 0.026), baseY + deep * 0.63, b.z + z], vary: 0.15 }));
      }
    }
    // The lid, the same six sides, a brass plate on it: one propped against the north hedge
    // behind its coffin, the other lying south of its coffin (a stake stands in that one).
    const lid = [
      part(coffinSlab(len + 0.06, wide + 0.06, 0.05), elm, { vary: 0.3, seed: 11 + i }),
      part(coffinSlab(len - 0.2, wide - 0.2, 0.012).translate(0, 0.1, 0.05), 0x30221a, { vary: 0.2 }), // the raised panel
    ];
    const plate = part(G.box(0.26, 0.15, 0.008), 0xc9a227, { at: [0, len * 0.66, 0.066], vary: 0.12 });
    if (i === 0) {
      const hedge = -COURT.half; // the north hedge's face
      const lean = [-0.2, 0.06, 0];
      solid.push(part(S.merge(lid), null, { at: [b.x + 0.3, 0, hedge + 0.5], rot: lean }));
      metal.push(part(plate, null, { at: [b.x + 0.3, 0, hedge + 0.5], rot: lean }));
    } else {
      const flat = [-Math.PI / 2, 0.2 + Math.PI / 2, 0];
      const at = [b.x + (len + 0.06) / 2, 0, b.z + b.d / 2 + 0.75];
      solid.push(part(S.merge(lid), null, { at, rot: flat }));
      metal.push(part(plate, null, { at, rot: flat }));
    }
  });

  // Wild garlic by the south hedge: all leaf and star flowers, no bulb.
  {
    const note = COURT.notes.find((n) => n.key === 'garlic') || { x: -8, z: 18.6 };
    for (let i = 0; i < 16; i++) {
      const x = note.x + rr(-2.4, 2.4);
      const z = Math.min(19.5, note.z + rr(-0.5, 0.9));
      for (let k = 0; k < 3; k++) flat.push(part(G.cone(0.07, rr(0.3, 0.5), 3).scale(1, 1, 0.3), 0x3f8f3f, { at: [x + rr(-0.06, 0.06), 0.2, z + rr(-0.06, 0.06)], rot: [rr(-0.5, 0.5), rr(0, 6), rr(-0.5, 0.5)], vary: 0.2 }));
      if (i % 2) {
        flat.push(part(G.cyl(0.008, 0.008, 0.5, 4), 0x5d9a48, { at: [x, 0.25, z] }));
        flat.push(part(G.ico(0.05, 0), 0xf3f0e4, { at: [x, 0.52, z], vary: 0 }));
      }
    }
  }

  // The sundial. Its gnomon casts no shadow of its own: the one it shows is a decal, laid toward the
// drawn sun, the way every real shadow in the court runs (C1).
  const gnomon = [];
  const decals = [];
  for (const b of boxOf('sundial')) {
    solid.push(part(G.cyl(0.3, 0.4, b.h, 10), PAL.stone, { at: [b.x, b.h / 2, b.z], vary: 0.25 }));
    metal.push(part(G.cyl(0.52, 0.52, 0.06, 20), PAL.gold, { at: [b.x, b.h + 0.03, b.z] }));
    const toSun = Math.atan2(SUN_SHOWN.x, SUN_SHOWN.z); // heading of the drawn sun on the ground: the shadow lies toward it
    gnomon.push(part(G.box(0.03, 0.34, 0.5), PAL.gold, { at: [b.x, b.h + 0.2, b.z], rot: [0.6, toSun, 0] }));
    const sx = Math.sin(toSun);
    const sz = Math.cos(toSun);
    decals.push(part(G.plane(0.09, 0.5), 0x0b0b0e, { at: [b.x + sx * 0.25, b.h + 0.064, b.z + sz * 0.25], rot: [0, toSun, 0], vary: 0 }));
    decals.push(part(G.plane(0.2, 2.6), 0x0b0b0e, { at: [b.x + sx * 1.9, 0.012, b.z + sz * 1.9], rot: [0, toSun, 0], vary: 0 }));
  }

  // The two signposts, and no others. North: four arms at one height, each pointing truly at its
  // suit's bed, paint flaking. South: four arms top to bottom, fresh paint, each at a valve.
  const pipOf = (suit) => S.pip(suit.replace(/s$/, ''), 0.22);
  const armOf = (suit, toward, post, y, fresh, k) => {
    const board = fresh ? 0xf6f2e6 : 0xb9b29c;
    const ink = suit === 'hearts' || suit === 'diamonds' ? (fresh ? PAL.paint : 0x8a4a44) : (fresh ? 0x17181b : 0x55524c);
    const local = [
      part(G.box(1.1, 0.3, 0.05), board, { at: [0.75, 0, 0], vary: fresh ? 0.04 : 0.45, seed: k }),
      part(G.box(0.22, 0.22, 0.05), board, { at: [1.3, 0, 0], rot: [0, 0, Math.PI / 4], vary: fresh ? 0.04 : 0.45, seed: k }),
      part(pipOf(suit), ink, { at: [0.72, 0, 0.03], vary: fresh ? 0 : 0.5, seed: k }),
      part(pipOf(suit), ink, { at: [0.72, 0, -0.03], rot: [0, Math.PI, 0], vary: fresh ? 0 : 0.5, seed: k }),
    ];
    return part(S.merge(local), null, { at: [post.x, y, post.z], rot: [0, Math.atan2(-(toward[1] - post.z), toward[0] - post.x), 0] });
  };
  const posts = COURT.signposts;
  solid.push(part(G.cyl(0.07, 0.09, 2.5, 7), 0x6a5a48, { at: [posts.north.x, 1.25, posts.north.z], vary: 0.35 }));
  posts.north.arms.forEach((a, i) => solid.push(armOf(a.suit, a.toward, posts.north, 2.2, false, i)));
  solid.push(part(G.cyl(0.07, 0.09, 2.7, 7), PAL.wood, { at: [posts.south.x, 1.35, posts.south.z] }));
  posts.south.arms.forEach((a, i) => solid.push(armOf(a.suit, a.toward, posts.south, 2.45 - i * 0.42, true, i)));
  solid.push(part(G.ball(0.1, 8, 6), PAL.gold, { at: [posts.south.x, 2.75, posts.south.z] }));

  // A tree with a stopped pocket watch hung in it: a quarter to something, the hour hand gone.
  for (const b of boxOf('tree')) {
    solid.push(part(G.cyl(0.26, 0.42, 3.4, 9), PAL.wood, { at: [b.x, 1.7, b.z], vary: 0.3 }));
    solid.push(part(G.ico(2.1, 2), 0x3f9a45, { at: [b.x, 4.6, b.z], scale: [1, 0.85, 1], lump: 0.3, vary: 0.3, freq: 0.9 }));
    solid.push(part(limb([b.x, 2.9, b.z], [b.x, 2.75, b.z + 0.95], 0.07, 0.03), PAL.wood, {}));
    const wy = 1.75;
    const wz = b.z + 0.9;
    metal.push(part(limb([b.x, 2.76, wz], [b.x, wy + 0.16, wz], 0.006, 0.006, 4), PAL.gold, { vary: 0 }));
    metal.push(part(G.cyl(0.14, 0.14, 0.035, 18), PAL.gold, { at: [b.x, wy, wz], rot: [Math.PI / 2, 0, 0] }));
    metal.push(part(G.torus(0.03, 0.008, 4, 8), PAL.gold, { at: [b.x, wy + 0.165, wz] }));
    glow.push(part(G.cyl(0.115, 0.115, 0.01, 18), 0xf3eedf, { at: [b.x, wy, wz + 0.02], rot: [Math.PI / 2, 0, 0], vary: 0 }));
    glow.push(part(G.box(0.095, 0.012, 0.004), 0x17181b, { at: [b.x - 0.047, wy, wz + 0.028], vary: 0 })); // the minute hand, at nine
  }

  // A door in the west hedge the size of a hatbox.
  {
    const n = COURT.notes.find((q) => q.key === 'door') || { x: -19.6, z: -4 };
    const x = -COURT.half + 0.04;
    solid.push(part(G.box(0.07, 0.62, 0.46), 0x5a3c26, { at: [x, 0.31, n.z], vary: 0.3 }));
    solid.push(part(G.torus(0.23, 0.035, 5, 10, Math.PI), PAL.stonePale, { at: [x + 0.01, 0.6, n.z], rot: [0, Math.PI / 2, 0] }));
    for (const s of [-1, 1]) solid.push(part(G.box(0.1, 0.62, 0.07), PAL.stonePale, { at: [x + 0.01, 0.31, n.z + s * 0.26] }));
    metal.push(part(G.ball(0.025, 6, 5), PAL.gold, { at: [x + 0.05, 0.3, n.z + 0.15] }));
  }

  // A chain staked by the north walk, the collar sprung from the inside.
  {
    const n = COURT.notes.find((q) => q.key === 'chain') || { x: -2.5, z: -15 };
    metal.push(part(G.cyl(0.035, 0.02, 0.7, 6), PAL.rust, { at: [n.x - 0.6, 0.3, n.z - 0.2], rot: [0, 0, 0.15], vary: 0.3 }));
    for (let i = 0; i < 9; i++) metal.push(part(G.torus(0.06, 0.014, 4, 8), PAL.rust, { at: [n.x - 0.55 + i * 0.1, 0.03 + (i === 0 ? 0.25 : 0), n.z - 0.2 + Math.sin(i * 0.9) * 0.08], rot: [i % 2 ? Math.PI / 2 : 0.2, i * 0.3, 0], vary: 0.3 }));
    metal.push(part(G.torus(0.2, 0.03, 5, 14, Math.PI * 1.45), PAL.rust, { at: [n.x + 0.5, 0.04, n.z - 0.05], rot: [Math.PI / 2, 0, 0.6], vary: 0.3 }));
    metal.push(part(G.box(0.1, 0.05, 0.02), PAL.rust, { at: [n.x + 0.72, 0.05, n.z + 0.1], rot: [0, 0.9, 0.3] })); // the hasp, bent outward
  }

  // The crater the warden climbed out of: a scorched rim, a black mouth, smoke.
  const cr = COURT.crater;
  solid.push(part(G.torus(cr.r, 0.55, 7, 20), PAL.scorch, { at: [cr.x, 0.12, cr.z], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.85], lump: 0.16, vary: 0.4, freq: 1.4 }));
  glow.push(part(G.disc(cr.r - 0.2, 18), 0x050505, { at: [cr.x, 0.3, cr.z], vary: 0 }));
  for (let i = 0; i < 9; i++) solid.push(part(G.ico(rr(0.12, 0.3), 0), 0x3a342e, { at: [cr.x + rr(-2.6, 2.6), 0.08, cr.z + rr(-2.3, 2.0)], rot: [rr(0, 3), rr(0, 3), 0], vary: 0.3 }));
  const SMOKE = 10;
  const smokeMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ color: 0x55534f, map: S.puffTexture(), transparent: true, opacity: 0.4, depthWrite: false }), SMOKE); // soft puffs facing the eye, as the Caterpillar's
  smokeMesh.frustumCulled = false;
  group.add(smokeMesh);
  const smokeAt = Array.from({ length: SMOKE }, () => rnd() * 9);

  // Dead leaves on the lawn (the kit's fallen leaf, dull browns). No rings round the pads: the
  // pickups are things lying in the garden, not markers (C4).
  const leaves = [];
  for (let i = 0; i < 130; i++) {
    leaves.push({ m: matrixOf([rr(-19, 19), 0.004, rr(-19, 19)], [rr(-0.15, 0.15), rr(0, 6.283), rr(-0.15, 0.15)], rr(0.7, 1.25)), c: new THREE.Color(LEAF_TONES[i % LEAF_TONES.length]).multiplyScalar(rr(0.85, 1.15)) });
  }
  instanced(group, S.fallenLeaf({ seed: 2 }), M.leaf, leaves, false, false);

  group.add(bake(solid, M.matte), bake(flat, M.matte, false, true), bake(metal, M.metal), bake(glow, M.glow, false, false));
  group.add(bake(gnomon, M.metal, false, false), bake(decals, M.decal, false, true));

  // ---- per frame -------------------------------------------------------------------------------
  const dummy = new THREE.Object3D();
  function update(sim, dt, time) {
    if (!rig.root.visible) return;
    rig.follow(sim, dt);
    group.visible = rig.stage <= 1;
    castle.dusk.visible = rig.grey > 0.45;
    if (!group.visible) return;
    for (let i = 0; i < SMOKE; i++) {
      const o = smokeAt[i];
      const k = ((time * 0.35 + o) % 9) / 9;
      dummy.position.set(cr.x + Math.sin(o * 3 + k * 4) * 0.9, 0.5 + k * 8, cr.z + Math.cos(o) * 0.5 - k * 1.6);
      dummy.rotation.set(0, Math.atan2(rig.eye.x - dummy.position.x, rig.eye.z - dummy.position.z), o, 'YXZ');
      dummy.scale.setScalar((0.35 + k * 1.3) * (1 - k * k * 0.5) * Math.min(1, k * 8));
      dummy.updateMatrix();
      smokeMesh.setMatrixAt(i, dummy.matrix);
    }
    smokeMesh.instanceMatrix.needsUpdate = true;
  }

  // The title's backdrop: a slow walk through the whole level, crater to castle approach.
  const way = [[0, 19], [0, 11], [-6.2, 4], [-6.2, -4], [0, -11], [0, -19], [0, -25]];
  for (let band = 1; band <= 4; band++) for (const p of routeOf(band)) way.push([p.x, p.z]);
  const gate = MAZE.glades[3].gate;
  way.push([gate.x, gate.z - 3], [0, MAZE.approach.endZ], [0, MAZE.approach.tunnel.shutZ + 2.5]); // #29: into the tunnel, short of its shut end
  const curve = new THREE.CatmullRomCurve3(way.map(([x, z]) => new THREE.Vector3(x, 1.85, z)), false, 'catmullrom', 0.12);
  const titlePos = new THREE.Vector3();
  const titleTarget = new THREE.Vector3();
  /** Title backdrop pose: { position, target }. One loop of the whole level takes TITLE_LOOP seconds. */
  function titleCamera(time) {
    const u = (time % TITLE_LOOP) / TITLE_LOOP;
    curve.getPointAt(Math.min(0.985, u * 0.985), titlePos);
    curve.getPointAt(Math.min(1, u * 0.985 + 0.012), titleTarget);
    titlePos.y += Math.sin(time * 0.9) * 0.03;
    titleTarget.y = 1.9;
    return { position: titlePos, target: titleTarget };
  }

  return {
    group: rig.root, garden: group, apply: rig.apply, hide: rig.hide, update, titleCamera, titleLoop: TITLE_LOOP,
    get shadowLevel() { return rig.shadowLevel; },
    get zone() { return rig.stage; },
  };
}
