// Running water (R4, R7): one surface, one material and one draw call for the court's four
// rills, the threshold rill under the arch and the wood's stream. The surface moves the way the
// water flows (ripples and long flow streaks, along COURT.flows, COURT.thresholdFlow and
// MAZE.stream.flow); a turned valve's water is a travelling front, a bright lip with a darker
// body behind, placed by sim.waves.flows so it reaches the bed at `waterArrive`; a shut rill
// drains from the valve end. Wading leaves rings at the knee (a pool of 12) and a small wake,
// both carried downstream. An actors layer: { sync, onEvent, clear, setReducedFlash }. It reads
// sim state only and writes nothing to it; nothing here is remembered across a restore.

import * as THREE from 'three';
import { COURT, MAZE } from '../logic/courtmap.js';
import { COURT_CONFIG } from '../logic/courtconfig.js';
import { daylight, PAL } from './court.js';

const RINGS = 12; // the frame budget's pool; the oldest ring goes when a thirteenth is wanted
const WAKE = RINGS; // the one wake rides in the same instanced mesh, after the rings
const STREAM_HALF = 40; // the stream runs the width of forest.js's ground sheet
const RILL_Y = 0.058; // under the kerb's top (0.07), over the rill's stone
const STREAM_Y = -0.025; // in the dip forest.js cuts for it
const DRAIN_TIME = 0.8; // seconds for a shut rill to empty from the valve end
const ARCH_TIME = 1.5; // seconds for the threshold rill to fill once the roses are red
const LIP_FADE = 0.35; // seconds for the front's lip to settle once the water has landed
const STREAM_GLASS = 0x6fa79a; // the design's two stream tokens: the ripples over the bed
const STREAM_BED = 0x2f4f4a;
const RED_LIP = 0xd8565c; // the front's lip and the ripples' shine, over PAL.wetRed

const LAYERS = new WeakMap(); // one water layer per scene, whoever asks

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const toward = (cur, goal, step) => (cur < goal ? Math.min(goal, cur + step) : Math.max(goal, cur - step));

// What is drawn when the sim on screen is not a Rose Court run (the title's backdrop): dry rills.
const IDLE = Object.freeze({ channels: [false, false, false, false], flows: [0, 0, 0, 0], done: { roses: false } });

/**
 * The six runs of water. `from`, `dir` and `length` are the flow's own (courtmap.js); `half` is
 * half the width, `y` the surface, `speed` how fast its streaks travel, `drift` how fast a ring
 * is carried (metres a second), `ring` the widest a ring may open there.
 */
function runs() {
  const out = COURT.flows.map((fl, i) => {
    const r = COURT.rills[i];
    return { ...fl, half: Math.min(r.w, r.d) / 2 - 0.015, y: RILL_Y, speed: 1.7, drift: 1.1, ring: 0.42, body: PAL.wetRed, lip: RED_LIP };
  });
  const th = COURT.thresholdFlow;
  out.push({ ...th, half: COURT.threshold.d / 2 - 0.015, y: RILL_Y, speed: 1.7, drift: 1.1, ring: 0.42, body: PAL.wetRed, lip: RED_LIP });
  const st = MAZE.stream;
  const east = st.flow.x >= 0 ? 1 : -1;
  out.push({
    from: { x: -east * STREAM_HALF, z: (st.minZ + st.maxZ) / 2 }, dir: { x: east, z: 0 }, length: STREAM_HALF * 2,
    half: (st.maxZ - st.minZ) / 2, y: STREAM_Y, speed: 0.9, drift: 0.7, ring: 0.8, body: STREAM_BED, lip: STREAM_GLASS,
  });
  return out;
}

const ARCH = 4; // index of the threshold rill among the runs
const STREAM = 5;

/** One quad per run in a single geometry: aFlow is (metres along, across -1 to 1, run, length). */
function surfaceGeometry(list) {
  const pos = [];
  const nor = [];
  const col = [];
  const lip = [];
  const flow = [];
  const dir = [];
  const index = [];
  const body = new THREE.Color();
  const shine = new THREE.Color();
  list.forEach((r, i) => {
    body.setHex(r.body);
    shine.setHex(r.lip);
    const px = -r.dir.z; // across the flow
    const pz = r.dir.x;
    const base = pos.length / 3;
    for (const [s, t] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
      pos.push(r.from.x + r.dir.x * r.length * s + px * r.half * t, r.y, r.from.z + r.dir.z * r.length * s + pz * r.half * t);
      nor.push(0, 1, 0);
      col.push(body.r, body.g, body.b);
      lip.push(shine.r, shine.g, shine.b);
      flow.push(r.length * s, t, i, r.length);
      dir.push(r.dir.x, r.dir.z);
    }
    index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aLip', new THREE.Float32BufferAttribute(lip, 3));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 4));
  g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 2));
  g.setIndex(index);
  return g;
}

/**
 * The one water material: a lit, fogged, shadowed standard surface whose colour, shine and
 * normal are moved by two layers of noise travelling downstream. uRun[i] is (front, tail, lip,
 * speed) for run i: water lies between tail and front metres from the run's head.
 */
function surfaceMaterial(uniforms) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.3, metalness: 0.2, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = `attribute vec4 aFlow;\nattribute vec2 aDir;\nattribute vec3 aLip;\nvarying vec4 vFlow;\nvarying vec2 vDir;\nvarying vec3 vLip;\n${sh.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFlow = aFlow;\n  vDir = aDir;\n  vLip = aLip;');
    sh.fragmentShader = `uniform float uTime;
uniform float uGlint;
uniform vec4 uRun[${STREAM + 1}];
varying vec4 vFlow;
varying vec2 vDir;
varying vec3 vLip;
float wHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float wNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wHash( i ), wHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( wHash( i + vec2( 0.0, 1.0 ) ), wHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// Height of the surface: long streaks drawn out along the flow, and ripples the streaks push about.
float wSurf( float u, float t, float k ) {
  float streak = wNoise( vec2( u * 0.42, t * 3.6 + k ) );
  float rip = wNoise( vec2( u * 2.4 + streak * 1.6, t * 2.1 - uTime * 0.4 + k ) );
  return 0.6 * streak + 0.4 * rip;
}
${sh.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>
  vec4 wRun = uRun[ int( vFlow.z + 0.5 ) ];
  float wS = vFlow.x;
  float wT = vFlow.y;
  // A travelling front leads in the middle of the channel and breaks unevenly.
  float wLead = wRun.z * ( 0.3 * ( 1.0 - wT * wT ) + 0.14 * wNoise( vec2( wT * 3.0 + vFlow.z * 5.0, uTime * 4.0 ) ) );
  wLead *= clamp( ( vFlow.w - wRun.x ) / 0.45, 0.0, 1.0 ); // no lead left at the bed: the front lands with waterArrive
  float wFront = wRun.x + wLead;
  if ( wS > wFront || wS < wRun.y - 0.08 * wNoise( vec2( wT * 4.0, uTime * 3.0 ) ) ) discard;
  float wU = wS - uTime * wRun.w;
  float wK = vFlow.z * 3.7;
  float wH = wSurf( wU, wT, wK );
  float wDu = wSurf( wU + 0.12, wT, wK ) - wH;
  float wDt = wSurf( wU, wT + 0.12, wK ) - wH;
  float wMid = smoothstep( 1.0, 0.7, abs( wT ) ); // slower and darker against the bank
  float wHi = smoothstep( 0.5, 0.78, wH ) * wMid;
  float wLip = wRun.z * smoothstep( wFront - 0.7, wFront, wS );
  diffuseColor.rgb = mix( diffuseColor.rgb * ( 0.74 + 0.26 * wMid ), vLip, clamp( 0.6 * wHi + 0.85 * wLip, 0.0, 1.0 ) );`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix( 0.34, 0.07, wHi );')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = normalize( normal + ( viewMatrix * vec4( -( wDu * vDir.x - wDt * vDir.y ) * 2.4, 0.0, -( wDu * vDir.y + wDt * vDir.x ) * 2.4, 0.0 ) ).xyz );`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += vLip * wHi * 0.14; // the ripples still read under the dim wood
  totalEmissiveRadiance += vLip * wLip * uGlint * ( 0.25 + 0.5 * wNoise( vec2( wT * 9.0, uTime * 9.0 ) ) );`);
  };
  m.customProgramCacheKey = () => 'lantern-yard-water';
  return m;
}

/** Rings and the wake: unlit, fogged, drawn over the water. aRing is (life or strength, kind). */
function ringMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    vertexShader: [
      'attribute vec3 aTint;', 'attribute vec2 aRing;', 'varying vec2 vUv;', 'varying vec3 vTint;', 'varying vec2 vRing;',
      '#include <fog_pars_vertex>',
      'void main() {',
      '  vUv = uv;', '  vTint = aTint;', '  vRing = aRing;',
      '  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );',
      '  gl_Position = projectionMatrix * mvPosition;',
      '  #include <fog_vertex>',
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying vec2 vUv;', 'varying vec3 vTint;', 'varying vec2 vRing;',
      '#include <fog_pars_fragment>',
      'float band( float r, float at, float w ) { return 1.0 - smoothstep( 0.0, w, abs( r - at ) ); }',
      'void main() {',
      '  vec2 p = vUv * 2.0 - 1.0;',
      '  float a;',
      '  if ( vRing.y < 0.5 ) {',
      '    // A ring: two crests, the inner one fainter, thinning as it opens.',
      '    float r = length( p );',
      '    float fade = 1.0 - vRing.x;',
      '    a = ( band( r, 0.84, 0.13 ) + 0.55 * band( r, 0.48, 0.1 ) ) * fade * ( 2.0 - fade );',
      '  } else {',
      '    // The wake: two arms opening downstream of the knee, and the slack water between them.',
      '    float x = p.x * 0.5 + 0.5;',
      '    float arm = 1.0 - smoothstep( 0.0, 0.1 + 0.1 * x, abs( abs( p.y ) - 0.85 * x ) );',
      '    float slack = 0.25 * ( 1.0 - smoothstep( 0.0, 0.85 * x + 0.02, abs( p.y ) ) );',
      '    a = ( arm + slack ) * ( 1.0 - x ) * smoothstep( 0.0, 0.1, x ) * vRing.x;',
      '  }',
      '  if ( a < 0.01 ) discard;',
      '  gl_FragColor = vec4( vTint, min( 1.0, a ) * 0.9 );',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '  #include <fog_fragment>',
      '}',
    ].join('\n'),
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
}

/**
 * The water layer for a scene (made once per scene; a second call returns the same layer).
 * cfg is the room config whose light the court's rig is built with.
 */
export function createWater(scene, cfg = COURT_CONFIG) {
  if (LAYERS.has(scene)) return LAYERS.get(scene);
  const rig = daylight(scene, cfg);
  const list = runs();
  const group = new THREE.Group();
  group.name = 'water';
  rig.root.add(group);

  const uniforms = {
    uTime: { value: 0 },
    uGlint: { value: 1 },
    uRun: { value: list.map((r) => new THREE.Vector4(0, 0, 0, r.speed)) },
  };
  const surface = new THREE.Mesh(surfaceGeometry(list), surfaceMaterial(uniforms));
  surface.name = 'running water';
  surface.frustumCulled = false; // one mesh from the court to the stream
  surface.receiveShadow = true;
  group.add(surface);

  // Rings and the wake: one instanced quad lying on the water.
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.rotateX(-Math.PI / 2);
  const tints = new THREE.InstancedBufferAttribute(new Float32Array((RINGS + 1) * 3), 3);
  const kinds = new THREE.InstancedBufferAttribute(new Float32Array((RINGS + 1) * 2), 2);
  quad.setAttribute('aTint', tints);
  quad.setAttribute('aRing', kinds);
  const ringMesh = new THREE.InstancedMesh(quad, ringMaterial(), RINGS + 1);
  ringMesh.name = 'wading rings';
  ringMesh.frustumCulled = false;
  ringMesh.renderOrder = 2;
  ringMesh.visible = false;
  group.add(ringMesh);
  const dummy = new THREE.Object3D();
  const _tint = new THREE.Color();
  const put = (i, x, y, z, sx, sz, yaw) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(sx, 1, sz);
    dummy.updateMatrix();
    ringMesh.setMatrixAt(i, dummy.matrix);
  };
  const hide = (i) => put(i, 0, -30, 0, 0.001, 0.001, 0);
  const rings = [];
  for (let i = 0; i < RINGS; i++) rings.push({ run: -1, x: 0, z: 0, age: 0, life: 0, from: 0, to: 0 });
  for (let i = 0; i <= RINGS; i++) hide(i);
  kinds.setXY(WAKE, 0, 1);

  // Where each run's water lies now (metres from its head), and how bright its lip is.
  const front = list.map(() => 0);
  const tail = list.map(() => 0);
  const lip = list.map(() => 0);
  front[STREAM] = list[STREAM].length; // the stream always runs

  let last = null;
  let lastTime = -1;
  let snap = true;
  let syncedAt = NaN;
  let clock = 0;
  let reduced = false;
  // The warden in the water: which run, the foot that last stepped, where they stood last frame.
  const wade = { run: -1, foot: -1, x: 0, z: 0, idle: 0, wake: 0 };

  /** The run whose water the point stands in now, or -1. */
  function runAt(x, z) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const dx = x - r.from.x;
      const dz = z - r.from.z;
      const s = dx * r.dir.x + dz * r.dir.z;
      const t = -dx * r.dir.z + dz * r.dir.x;
      if (Math.abs(t) <= r.half && s >= tail[i] && s <= front[i] && front[i] > tail[i]) return i;
    }
    return -1;
  }

  /** A ring on run i at (x, z), opening from `from` to `to` metres across over `life` seconds. */
  function ring(i, x, z, from, to, life) {
    const r = list[i];
    let at = rings[0];
    for (const q of rings) {
      if (q.run < 0) { at = q; break; }
      if (q.life - q.age < at.life - at.age) at = q; // else the one nearest its end
    }
    // Kept inside the channel: a ring in a rill opens about its middle.
    const dx = x - r.from.x;
    const dz = z - r.from.z;
    const s = dx * r.dir.x + dz * r.dir.z;
    const size = Math.min(to, r.ring * 2);
    const t = clamp(-dx * r.dir.z + dz * r.dir.x, -(r.half - size / 2), r.half - size / 2);
    at.run = i;
    at.x = r.from.x + r.dir.x * s - r.dir.z * t;
    at.z = r.from.z + r.dir.z * s + r.dir.x * t;
    at.age = 0;
    at.life = life;
    at.from = Math.min(from, size);
    at.to = size;
  }

  function stepRuns(w, dt, flowTime) {
    for (let i = 0; i < ARCH; i++) {
      const r = list[i];
      if (w.channels[i]) {
        // The front is where the flow timer says it is; landed, the lip settles.
        const left = (w.flows && w.flows[i]) || 0;
        front[i] = r.length * (1 - clamp(left / flowTime));
        tail[i] = 0;
        lip[i] = left > 0 ? 1 : snap ? 0 : toward(lip[i], 0, dt / LIP_FADE);
      } else if (front[i] > 0) {
        // Shut: it drains from the valve end, the water already on its way running out ahead.
        tail[i] = snap ? r.length : tail[i] + (dt * r.length) / DRAIN_TIME;
        lip[i] = 0;
        if (tail[i] >= front[i]) { front[i] = 0; tail[i] = 0; }
      }
    }
    const a = list[ARCH];
    const filling = !!(w.done && w.done.roses);
    const goal = filling ? a.length : 0;
    front[ARCH] = snap ? goal : toward(front[ARCH], goal, (dt * a.length) / ARCH_TIME);
    lip[ARCH] = filling && front[ARCH] < goal ? 1 : snap ? 0 : toward(lip[ARCH], 0, dt / LIP_FADE);
    for (let i = 0; i < list.length; i++) uniforms.uRun.value[i].set(front[i], tail[i], lip[i], list[i].speed);
  }

  function stepWading(pl, dt) {
    const i = pl && !pl.dead && pl.y < 0.25 ? runAt(pl.x, pl.z) : -1;
    if (i < 0) {
      wade.run = -1;
      wade.wake = toward(wade.wake, 0, dt * 4);
      return;
    }
    const r = list[i];
    const vx = dt > 0 && wade.run >= 0 ? (pl.x - wade.x) / dt : 0;
    const vz = dt > 0 && wade.run >= 0 ? (pl.z - wade.z) / dt : 0;
    if (wade.run < 0) {
      // In from the bank: the splash's two rings.
      ring(i, pl.x, pl.z, 0.2, 1.3, 1.0);
      ring(i, pl.x, pl.z, 0.1, 0.8, 1.3);
      wade.idle = 0.5;
    } else if (pl.foot !== wade.foot) {
      // Each step lands a ring beside the leg that made it.
      const side = pl.foot ? 0.14 : -0.14;
      ring(i, pl.x + Math.cos(pl.yaw) * side, pl.z - Math.sin(pl.yaw) * side, 0.16, 1.0, 1.1);
      wade.idle = 0.7;
    } else {
      // Standing in it, the water still parts round the knee.
      wade.idle -= dt;
      if (wade.idle <= 0) {
        ring(i, pl.x, pl.z, 0.24, 0.9, 1.4);
        wade.idle = 0.9;
      }
    }
    wade.run = i;
    wade.foot = pl.foot;
    wade.x = pl.x;
    wade.z = pl.z;
    // The wake trails the way the water leaves the knee: the flow, less the warden's own way.
    const wx = r.dir.x * r.drift - vx;
    const wz = r.dir.z * r.drift - vz;
    const rel = Math.hypot(wx, wz);
    wade.wake = toward(wade.wake, clamp(rel / 2.5, 0.35, 1), dt * 5);
    const len = 0.5 + 0.7 * clamp(rel / 4);
    const wide = Math.min(0.9, r.half * 2 - 0.06);
    const ux = rel > 1e-4 ? wx / rel : r.dir.x;
    const uz = rel > 1e-4 ? wz / rel : r.dir.z;
    put(WAKE, pl.x + ux * len * 0.5, r.y + 0.006, pl.z + uz * len * 0.5, len, wide, Math.atan2(-uz, ux));
    _tint.setHex(r.lip);
    tints.setXYZ(WAKE, _tint.r, _tint.g, _tint.b);
  }

  function stepRings(dt) {
    let any = wade.wake > 0.01;
    kinds.setXY(WAKE, wade.wake, 1);
    if (!any) hide(WAKE);
    rings.forEach((q, k) => {
      if (q.run < 0) return;
      const r = list[q.run];
      q.age += dt;
      q.x += r.dir.x * r.drift * dt; // carried downstream
      q.z += r.dir.z * r.drift * dt;
      const s = (q.x - r.from.x) * r.dir.x + (q.z - r.from.z) * r.dir.z;
      const live = q.age < q.life && s < front[q.run] - q.to / 2 && s > tail[q.run];
      if (!live) {
        q.run = -1;
        hide(k);
        return;
      }
      any = true;
      const life = q.age / q.life;
      const size = q.from + (q.to - q.from) * Math.sqrt(life);
      put(k, q.x, r.y + 0.004, q.z, size, size, 0);
      kinds.setXY(k, life, 0);
      _tint.setHex(r.lip);
      tints.setXYZ(k, _tint.r, _tint.g, _tint.b);
    });
    ringMesh.visible = any;
    if (any || ringMesh.userData.dirty) {
      ringMesh.instanceMatrix.needsUpdate = true;
      kinds.needsUpdate = true;
      tints.needsUpdate = true;
    }
    ringMesh.userData.dirty = any;
  }

  function sync(sim, dt, time) {
    if (time === syncedAt) return; // mounted twice: one step a frame all the same
    syncedAt = time;
    const live = !!(sim && sim.cfg && sim.cfg.room === 'court' && sim.waves && sim.waves.done);
    const w = live ? sim.waves : IDLE;
    if (sim !== last || (live && sim.stats && sim.stats.time < lastTime)) snap = true;
    last = sim;
    lastTime = live && sim.stats ? sim.stats.time : -1;
    if (!rig.root.visible) return;
    clock = (clock + dt) % 512; // kept small, so the noise stays fine however long the run
    uniforms.uTime.value = clock;
    uniforms.uGlint.value = reduced ? 0 : 1; // reduced flash stills the front's glint
    if (snap) {
      for (const q of rings) q.run = -1;
      for (let i = 0; i < RINGS; i++) hide(i);
      wade.run = -1;
      wade.wake = 0;
    }
    stepRuns(w, dt, (live && sim.cfg.valveFlow) || COURT_CONFIG.valveFlow);
    stepWading(live ? sim.player : null, dt);
    stepRings(dt);
    snap = false;
  }

  const layer = {
    group,
    sync,
    onEvent() {}, // everything drawn is read from state, so a restore shows what the state says
    clear() { snap = true; },
    setReducedFlash(v) { reduced = !!v; },
  };
  LAYERS.set(scene, layer);
  return layer;
}
