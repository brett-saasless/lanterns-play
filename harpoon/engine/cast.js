// The Rose Court's cast: the two Guards with their claw halberds, the three Card Gardeners with
// their brushes, and Renfield at his table with his dish; and the wood's two kinds of friend,
// the frightened gardeners crouched at the vegetable plots and the dying hunter. Built with
// sculpt.js and registered with actors.js the way fauna.js registers the cave: a factory per
// enemy type and one layer. The layer also lays the bodies of beaten gate creatures back down
// from sim.waves.bodies after a restore (the bodies themselves are built by beasts.js).

import * as THREE from 'three';
import * as S from './sculpt.js';
import { COURT, MAZE, stageAt } from '../logic/courtmap.js';
import { CAVE } from './cave.js';
import { layBody } from './beasts.js';

// ---- adapters ---------------------------------------------------------------------------------
// The ONLY places this file reads the sim. Everything below poses from what these return, so a
// renamed rules field is a one-line change here.

function standing(e, c, court) {
  return {
    x: e.x, y: e.y, z: e.z,
    facing: e.heading,
    speed: e.speedNow || 0,
    // Each figure stands until it alone is called (roses.js marks e.called; the rules then take
    // it out of 'still' and say so with a wakeOne event). Nothing harms it while it stands.
    still: e.state === 'still',
    called: !!e.called,
    tell: e.state === 'tell' && c.tell > 0 ? clamp(1 - e.timer / c.tell) : 0, // wind-up, 0 to 1
    tellTime: c.tell,
    stunned: e.stun > 0 || e.state === 'stunned', // a flinch, or the cup's splash
    hurt: clamp(1 - e.hp / c.hp), // 0 whole, 1 at its last
    glance: e.glance > 0, // a shot while still: the head stays over-turned while the rules say so
  };
}

/** A Guard's sim enemy, as the figure needs it. */
function guardView(e, cfg, court) {
  return standing(e, cfg.guard, court);
}

/** A Card Gardener's sim enemy, as the figure needs it. */
function gardenerView(e, cfg, court) {
  return standing(e, cfg.gardener, court);
}

/** Renfield has no sim enemy: he reads the one spoken line. */
function renfieldView(sim) {
  const line = sim.waves && sim.waves.line;
  const on = !!line && line.who === 'renfield' && line.left > 0;
  return { speaking: on, key: on ? line.key : null };
}

/** A friendly figure (a plot gardener or the hunter): where it sits, ducking, speaking. */
function friendView(e, sim) {
  const line = sim && sim.waves && sim.waves.line;
  const on = !!line && line.left > 0;
  let speaking = false;
  if (on && e.type === 'hunter') speaking = line.who === 'hunter';
  else if (on && line.who === 'gardener') speaking = /carrot/i.test(String(line.key)) === (e.holds === 'carrot'); // talk.js: gardenerCarrot, gardenerGarlic
  return { x: e.x, y: e.y || 0, z: e.z, facing: e.heading || 0, duck: e.duck > 0, speaking };
}

const GATE = ['rabbit', 'hatter', 'bat', 'caterpillar'];

/**
 * The bodies of beaten gate creatures the rules keep (trail.js sim.waves.bodies:
 * [{ id, enemy, x, z }]), written into `out`. A creature that is seated again alive has none.
 */
function gateBodies(sim, out) {
  out.length = 0;
  const w = sim && sim.waves;
  if (!sim || !sim.cfg || sim.cfg.room !== 'court' || !w || !Array.isArray(w.bodies) || !w.bodies.length) return out;
  const gate = sim.cfg.gateCreatures || GATE;
  for (const b of w.bodies) {
    if (!gate.includes(b.enemy)) continue;
    if ((sim.enemies || []).some((e) => e.type === b.enemy && !e.dead)) continue;
    out.push(b);
  }
  return out;
}

/** The level state every figure shares. */
function courtView(sim) {
  const w = sim.waves || {};
  return {
    here: !!sim.cfg && sim.cfg.room === 'court',
    stage: w.index || 0,
    phase: w.phase,
    lineTime: (sim.cfg && sim.cfg.lineTime) || 4,
    yaw: sim.player ? sim.player.yaw : null, // the warden looks along (-sin yaw, -cos yaw)
  };
}

// ---- small tools ------------------------------------------------------------------------------

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };
const approach = (cur, goal, dt, rate) => cur + (goal - cur) * Math.min(1, dt * rate);
const frac = (x) => x - Math.floor(x);
const wrap = (a) => a - TAU * Math.round(a / TAU);
const _a = V(); const _b = V(); const _c = V(); const _d = V(); const _e = V(); const _f = V();
const _x = V(); const _y = V(); const _z = V(); const _t = V(); const _u = V();
const _m = new THREE.Matrix4();
const _col = new THREE.Color();

const SCARLET = 0xb3121b; // Beefeater scarlet
const GOLD = 0xc9a227; // old gold
const WET = 0x7a0f14; // wet red: darker than paint
const ROSE = 0xf3eedf; // rose white
const INK = 0x14141a;
const STONE = 0x8d8a82;
const FAR = 75; // metres past which a figure is not drawn or posed
const WAKE_T = 0.7; // seconds a figure's waking shout and start take

const WETC = new THREE.Color(WET);
const MILDEW = new THREE.Color(0x5d6b4c);
const FOXED = new THREE.Color(0xbfae84);
const PAINT = new THREE.Color(0xa3141c);

function nearestIndex(list, x, z) {
  let best = 0; let bd = Infinity;
  list.forEach((p, i) => { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = i; } });
  return best;
}

/** A phase that holds, then ticks on: n ticks a cycle. The clockwork in a toy soldier's walk. */
function tick(ph, n, hold) {
  const f = frac(ph * n);
  return (Math.floor(ph * n) + smooth((f - hold) / (1 - hold))) / n;
}

/** Sets obj at `butt` with its +Y along `dir` and its -Z as near `fwd` as that allows. */
function aim(obj, butt, dir, fwd) {
  _y.copy(dir).normalize();
  _z.copy(fwd).multiplyScalar(-1).addScaledVector(_y, _y.dot(fwd));
  if (_z.lengthSq() < 1e-6) { _z.set(1, 0, 0).addScaledVector(_y, -_y.x); }
  _z.normalize();
  _x.crossVectors(_y, _z);
  obj.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
  obj.position.copy(butt);
}

/** Upper arm, forearm and a small mitten at instances i, i+1, i+2. Pulls `hand` back into reach. */
function placeArm(L, i, sh, hand, l1, l2, bend, r, elbow) {
  _t.subVectors(hand, sh);
  const d = _t.length(); const max = (l1 + l2) * 0.985;
  if (d > max) hand.copy(sh).addScaledVector(_t, max / d);
  S.ik2(sh, hand, l1, l2, bend, elbow);
  L.place(i, sh, elbow, r);
  L.place(i + 1, elbow, hand, r * 0.82);
  _t.subVectors(hand, elbow).normalize();
  _u.copy(hand).addScaledVector(_t, r * 2);
  L.place(i + 2, hand, _u, r * 1.12);
}

/** Thigh, shin and a small foot at instances i, i+1, i+2. `toe` is the unit way the foot points. */
function placeLeg(L, i, hip, ankle, l1, l2, bend, r, toe, knee) {
  _t.subVectors(ankle, hip);
  const d = _t.length(); const max = (l1 + l2) * 0.985;
  if (d > max) ankle.copy(hip).addScaledVector(_t, max / d);
  S.ik2(hip, ankle, l1, l2, bend, knee);
  L.place(i, hip, knee, r);
  L.place(i + 1, knee, ankle, r * 0.76);
  _t.copy(ankle).addScaledVector(toe, -r * 0.5);
  _u.copy(ankle).addScaledVector(toe, r * 2.5);
  L.place(i + 2, _t, _u, r * 0.86);
}

function mixHold(out, a, b, k) {
  out.grip.lerpVectors(a.grip, b.grip, k);
  out.dir.lerpVectors(a.dir, b.dir, k).normalize();
  out.fwd.lerpVectors(a.fwd, b.fwd, k);
  return out;
}
const hold = (grip, dir, fwd) => ({ grip: V(...grip), dir: V(...dir).normalize(), fwd: V(...fwd) });

/** Remembers a mesh's vertices so scars can be taken back off it. */
function keeper(mesh) {
  let pos = null; let col = null;
  return {
    save() {
      if (pos) return;
      pos = mesh.geometry.attributes.position.array.slice();
      col = mesh.geometry.attributes.color.array.slice();
    },
    restore() {
      if (!pos) return;
      const g = mesh.geometry;
      g.attributes.position.array.set(pos); g.attributes.color.array.set(col);
      g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
      pos = null; col = null;
    },
  };
}

function disposeTree(root) {
  root.traverse((m) => {
    if (!m.isMesh && !m.isPoints) return;
    m.geometry.dispose();
    if (m.isInstancedMesh) m.dispose();
  });
}

// ---- salt off lacquer ---------------------------------------------------------------------------
// Grains that scatter off a figure nothing can harm yet, and off a wound when one lands.

function createGrains(scene) {
  const N = 140;
  const pos = new Float32Array(N * 3).fill(-100); const vel = new Float32Array(N * 3); const life = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xf4f1e6, size: 0.045, transparent: true, opacity: 0.9, depthWrite: false }));
  pts.frustumCulled = false;
  pts.visible = false;
  scene.add(pts);
  let next = 0; let live = 0;
  return {
    /** n grains off (x, y, z), thrown back along (dx, dz), the way the shot came. */
    burst(x, y, z, dx, dz, n, speed) {
      for (let k = 0; k < n; k++) {
        const i = next; next = (next + 1) % N;
        const a = Math.random() * TAU; const u = 0.3 + 0.7 * Math.random();
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        vel[i * 3] = (dx * 0.8 + Math.cos(a) * 0.7) * speed * u;
        vel[i * 3 + 1] = (0.2 + Math.random()) * speed * 0.7;
        vel[i * 3 + 2] = (dz * 0.8 + Math.sin(a) * 0.7) * speed * u;
        life[i] = 0.35 + Math.random() * 0.35;
      }
      live = 1; pts.visible = true;
    },
    step(dt) {
      if (!live) return;
      live = 0;
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        vel[i * 3 + 1] -= 7 * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (life[i] <= 0 || pos[i * 3 + 1] < 0) { life[i] = 0; pos[i * 3 + 1] = -100; } else live = 1;
      }
      geo.attributes.position.needsUpdate = true;
      pts.visible = !!live;
    },
    clear() {
      life.fill(0);
      for (let i = 0; i < N; i++) pos[i * 3 + 1] = -100;
      geo.attributes.position.needsUpdate = true;
      pts.visible = false; live = 0;
    },
  };
}

// ---- what every court figure shares -------------------------------------------------------------

/**
 * The parts of a view that do not depend on the body: materials for the hit blink and the dead,
 * wounds and scars, the head that follows the warden, and putting it all back.
 *   parts: [{ m, base }] meshes that blink and go grey; marks: meshes that take scars.
 */
function figure(v, ctx, parts, marks) {
  const M = S.materials();
  /** Left behind at the arch: stand where it stood until the warden is past drawing distance. */
  v.linger = (dt, time, eye) => !v.dead && Math.hypot(eye.x - v.g.position.x, eye.z - v.g.position.z) < FAR;
  const keeps = new Map(marks.map((m) => [m, keeper(m)]));
  v.hurtMarks = S.wounds({ seed: v.seed, max: 9 });
  v.mat = null;
  v.setMat = (name) => {
    if (v.mat === name) return;
    v.mat = name;
    for (const p of parts) p.m.material = name ? M[name] : p.base;
  };
  /** A blast lands: salt off lacquer while it stands still, a wound once it is awake. */
  v.struck = (ev, mesh) => {
    const dx = v.eye.x - ev.x; const dz = v.eye.z - ev.z; const len = Math.hypot(dx, dz) || 1;
    const n = ev.pellets || 1;
    if (v.still) {
      ctx.grains.burst(ev.x, ev.y, ev.z, dx / len, dz / len, 5 + 3 * n, 2.6);
      v.over = Math.min(1, v.over + 0.4); // and the head comes round a little further
      return false;
    }
    v.flash = 0.08;
    v.jolt = 1;
    ctx.grains.burst(ev.x, ev.y, ev.z, dx / len, dz / len, 2 + n, 1.8);
    v.g.updateMatrixWorld(true);
    v.hurtMarks.hit(mesh, ev, 0.04 + 0.009 * n);
    if (n >= 3 && keeps.has(mesh)) { keeps.get(mesh).save(); S.scar(mesh, ev, 0.1 + 0.012 * n, { dent: 0.18 }); }
    return true;
  };
  /** Which way the head should turn, in the body's frame, to face the warden. */
  v.bearing = (eye) => {
    const dx = eye.x - v.g.position.x; const dz = eye.z - v.g.position.z;
    const c = Math.cos(v.face); const s = Math.sin(v.face);
    return Math.atan2(-(dx * c - dz * s), -(dx * s + dz * c));
  };
  v.turnHead = (s, eye, dt) => {
    const th = v.bearing(eye);
    v.snap = Math.max(0, v.snap - dt);
    let goal; let rate;
    if (s.still && !s.glance) v.over = approach(v.over, 0, dt, 2); // the glance ends: the head settles back
    if (s.still) { goal = clamp(th, -2.9, 2.9) * v.over; rate = 6; } // only when salted, and then too far
    else if (v.snap > 0) { goal = clamp(th, -2.7, 2.7); rate = 45; } // the wake: its head, at once
    else { goal = clamp(th, -1.1, 1.1); rate = 9; }
    v.yaw = approach(v.yaw, goal, dt, rate);
    v.head.group.rotation.y = v.yaw;
  };
  // This one figure wakes (its wakeOne event): the head snaps round, it starts, and it shouts.
  v.wake = () => { v.snap = 0.6; v.pointAt = null; v.wakeT = WAKE_T; v.jolt = 1; };
  /** How far through its waking shout it is, 0 to 1 and back; also catches a wake whose event was missed. */
  v.waking = (s, dt) => {
    if (v.wasStill === true && !s.still && v.wakeT <= 0 && v.snap <= 0) v.wake();
    v.wasStill = s.still;
    v.wakeT = Math.max(0, v.wakeT - dt);
    return v.wakeT > 0 ? Math.sin(Math.PI * clamp(1 - v.wakeT / WAKE_T)) : 0;
  };
  v.unmark = () => {
    v.hurtMarks.clear();
    for (const k of keeps.values()) k.restore();
  };
  ctx.cast.add(v);
}

// ---- Guards ---------------------------------------------------------------------------------------

const GUARDS = [
  // west: eyes set at different heights; a smile a little too wide
  { seed: 7, defects: ['eyeLow:L', 'smileWide'], eye: 0x4f6f8c, hatLean: -0.05, snapped: 1 },
  // east: one eye with no pupil; two small fang tips on the lower lip
  { seed: 12, defects: ['noPupil:R', 'fangTips'], eye: 0x5b7a4f, hatLean: 0.06, snapped: 2 },
];
// The coat's cross-sections: [y, half width, half depth].
const COAT = [[0.96, 0.26, 0.22], [1.1, 0.3, 0.25], [1.14, 0.31, 0.26], [1.5, 0.37, 0.3], [1.84, 0.34, 0.25], [2.03, 0.22, 0.18], [2.13, 0.12, 0.12]];
function coatAt(y) {
  for (let i = 0; i < COAT.length - 1; i++) {
    const a = COAT[i]; const b = COAT[i + 1];
    if (y <= b[0]) { const k = clamp((y - a[0]) / (b[0] - a[0])); return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  }
  return [0.12, 0.12];
}
const G_SH = [V(0.36, 1.96, 0), V(-0.36, 1.96, 0)]; // 0 is the figure's own right
const G_HIP = [V(0.14, 1.0, 0), V(-0.14, 1.0, 0)];
const G_ARM = [0.5, 0.52]; // a little longer than arms are
const G_LEG = [0.5, 0.52];
const G_STRIDE = 1.5;
const G_STANCE = 0.55;
const HAL_R = 1.25; const HAL_L = 0.8; // where each hand holds the shaft, metres from the butt
const HAL = {
  rest: hold([0.5, 1.25, -0.06], [0, 1, 0], [0, 0, -1]),
  carry: hold([0.47, 1.32, -0.2], [0.03, 1, -0.14], [0, 0, -1]),
  tell: hold([0.3, 2.25, 0], [0.15, 0.7, 0.7], [0, -0.7, -0.7]),
  strike: hold([0.2, 1.45, -0.55], [-0.1, 0.05, -1], [0, -1, 0]),
};
const G_STRIKE = 0.5; // seconds the chop and its recovery take

function guardCoat(spec) {
  const seed = spec.seed;
  const parts = [S.skin(COAT.map(([y, rx, rz], i) => ({
    at: [0, y, 0], r: [rx, rz], color: i < 2 ? INK : i === COAT.length - 1 ? ROSE : SCARLET,
  })), {
    seed, sides: 11, detail: 2, budget: 460, noise: 0.045, mottle: 0.16, color2: 0x8a0d15,
    // Left out in the garden too long: mildew has taken one shoulder.
    colorAt: (u, a, c) => {
      const k = smooth((u - 0.5) / 0.2) * smooth((-Math.sin(a) + 0.2) / 0.5) * (0.6 + 0.4 * S.noise(u * 9, a * 2, 0, seed));
      if (u < 0.92) c.lerp(MILDEW, 0.85 * k);
    },
  })];
  // Gold frogging across the chest. One cord has snapped and hangs.
  [1.28, 1.44, 1.6, 1.76].forEach((y, n) => {
    const [rx, rz] = coatAt(y); const rings = [];
    const broken = n === spec.snapped;
    for (let k = -2; k <= (broken ? 0 : 2); k++) {
      const a = (k / 2) * 0.95;
      rings.push({ at: [Math.sin(a) * rx * 1.07, y + 0.012 * Math.cos(k * 1.5), -Math.cos(a) * rz * 1.07], r: 0.017 });
    }
    if (broken) rings.push({ at: [0.05, y - 0.09, -rz * 1.1], r: 0.015 }, { at: [0.07, y - 0.2, -rz * 1.08], r: 0.012 });
    parts.push(S.skin(rings, { sides: 5, detail: 1, noise: 0.1, seed: seed + n, color: GOLD, mottle: 0.25, shade: 0.1, capLen: 1.2 }));
    if (!broken) parts.push(S.tint(new THREE.IcosahedronGeometry(0.03, 0).translate(0, y, -rz * 1.1), GOLD, 0.2, n));
  });
  for (const sx of [-1, 1]) {
    parts.push(S.tint(new THREE.SphereGeometry(0.1, 8, 6).scale(1.2, 0.45, 1).translate(sx * 0.35, 2.0, 0), GOLD, 0.2, seed + sx));
  }
  // A ruff, pleated.
  const ruff = new THREE.TorusGeometry(0.17, 0.062, 6, 16).rotateX(Math.PI / 2).scale(1, 0.75, 1);
  const rp = ruff.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const k = 1 + 0.13 * Math.sin(Math.atan2(rp.getZ(i), rp.getX(i)) * 10);
    rp.setXYZ(i, rp.getX(i) * k, rp.getY(i), rp.getZ(i) * k);
  }
  ruff.computeVertexNormals();
  parts.push(S.tint(ruff.translate(0, 2.12, 0), 0xe6dfcb, 0.12, seed));
  return S.merge(parts);
}

function guardHat(spec) {
  const seed = spec.seed; const L = spec.hatLean;
  const parts = [
    S.skin([
      { at: [0, 0.5, 0.02], r: 0.345, color: GOLD }, { at: [0, 0.57, 0.02], r: 0.34, color: GOLD },
      { at: [0, 0.59, 0.02], r: 0.335 }, { at: [L * 0.6, 0.9, 0.03], r: 0.32 }, { at: [L * 2.2, 1.26, 0.05], r: 0.305 },
    ], { seed, sides: 12, detail: 2, budget: 330, caps: ['open', 'round'], capLen: 0.3, color: INK, color2: 0x3b3027, noise: 0.05, rough: 0.035, mottle: 0.22, shade: 0.1 }),
    S.tint(new THREE.TorusGeometry(0.37, 0.034, 5, 16).rotateX(Math.PI / 2).scale(1, 0.5, 1).translate(0, 0.5, 0.02), INK, 0.25, seed),
    // The badge: a gold heart, scratched out deep.
    S.pip('heart', 0.2, GOLD).rotateY(Math.PI).translate(0, 0.84, -0.318),
    S.tint(new THREE.BoxGeometry(0.27, 0.022, 0.012).rotateZ(0.62).translate(0, 0.84, -0.324), 0x15110f),
  ];
  return parts;
}

function halberdGeometry(seed) {
  const collar = (y, r) => S.tint(new THREE.TorusGeometry(r, 0.016, 5, 10).rotateX(Math.PI / 2).translate(0, y, 0), GOLD, 0.2, y);
  return S.merge([
    S.skin([{ at: [0, 0, 0], r: 0.03 }, { at: [0.012, 1.0, 0], r: 0.027 }, { at: [-0.008, 2.1, 0.004], r: 0.026 }, { at: [0, 3.0, 0], r: 0.025 }],
      { seed, sides: 6, detail: 2, budget: 150, color: 0x4a3524, color2: 0x2a1d14, noise: 0.06, mottle: 0.22 }),
    // The head: three long fingers, hooked, the nails wet.
    S.claw({ fingers: 3, length: 0.72, spread: 0.42, curl: 1.3, r: 0.075, color: 0x5e5a54, tip: WET, seed }).translate(0, 3.0, -0.015),
    S.skin([{ at: [0, 2.98, 0.01], r: 0.045, color: STONE }, { at: [0.012, 3.2, 0.012], r: 0.024, color: 0x6a6860 }, { at: [0, 3.44, 0.01], r: 0.004, color: 0x2a2624 }],
      { seed: seed + 2, sides: 5, detail: 2, noise: 0.08, caps: ['open', 'flat'] }),
    collar(2.86, 0.043), collar(2.74, 0.04), collar(0.03, 0.036),
    S.skin([{ at: [0.03, 2.8, 0.01], r: 0.028, color: WET }, { at: [0.075, 2.64, 0.02], r: 0.046, color: WET }, { at: [0.07, 2.46, 0.015], r: 0.012, color: 0x4a0a0e }],
      { seed: seed + 5, sides: 6, detail: 2, rough: 0.3, noise: 0.1, shade: 0.2 }),
  ]);
}

function buildGuard(e, cfg, ctx) {
  const spec = GUARDS[nearestIndex(COURT.guards, e.x, e.z) % GUARDS.length];
  const seed = spec.seed;
  const M = S.materials();
  const g = new THREE.Group(); const pose = new THREE.Group(); const body = new THREE.Group();
  g.add(pose); pose.add(body);

  const torso = new THREE.Mesh(guardCoat(spec), M.skin);
  torso.castShadow = true;
  const hd = S.head({
    size: 0.36, seed, defects: spec.defects, budget: 1500, extras: guardHat(spec),
    // C2: each guard's wrong thing at twice the strength, so it reads at 8 m, not only at 4.
    face: { skin: 0xf2d6bd, eye: spec.eye, cheek: { rosy: 0.85 }, skull: { wide: 1.04, tall: 1.0, taper: 0.22 }, ears: { size: 0.9 }, defectScale: 2 },
  });
  hd.group.position.set(0, 2.13, 0.01);
  // The coat's skirt: scarlet, gold at the hem, and darker and wetter the lower it hangs.
  const skirt = S.cloth({
    curve: TAU, radius: 0.31, flare: 0.5, length: 0.56, cols: 14, rows: 5, budget: 300, color: SCARLET, trim: GOLD, trimWidth: 0.1,
    folds: 7, foldDepth: 0.035, tatter: 0.6, dirt: 0.3, seed,
    pattern: (u, v, c) => { if (v > 0.35 && v < 0.9) c.lerp(WETC, smooth((v - 0.35) / 0.3)).multiplyScalar(1 - 0.35 * smooth((v - 0.5) / 0.3)); },
  });
  skirt.mesh.position.set(0, 1.16, 0);
  body.add(torso, hd.group, skirt.mesh);

  const L = S.limbs(12, { seed, sides: 5, taper: 0.72 });
  [0, 1, 3, 4, 6, 9].forEach((i) => L.tone(i, SCARLET)); // sleeves and breeches
  [2, 5].forEach((i) => L.tone(i, 0xe9e2cf)); // gloves
  [7, 10].forEach((i) => L.tone(i, 0xd9d2bf)); // stockings, greying
  [8, 11].forEach((i) => L.tone(i, INK));
  const hal = new THREE.Mesh(halberdGeometry(seed), M.gloss);
  hal.castShadow = true;
  g.add(L.mesh, hal);

  const rig = { root: body, chest: torso, head: hd, cloths: [skirt], seed, rate: 0.22 };
  const v = {
    g, kind: 'guard', seed, head: hd, eye: V(), type: 'guard',
    face: e.heading || 0, first: true, yaw: 0, over: 0, snap: 0, still: true, dead: false, gone: false,
    phase: frac(seed * 0.37), move: 0, awake: 0, tellAmt: 0, tellOn: false, tellClock: 0, tellDur: 0.7,
    strikeT: 0, flash: 0, jolt: 0, flinch: 0, hurt: 0, deathT: 0, drips: null, pointAt: null, wakeT: 0, wasStill: null,
  };
  figure(v, ctx, [
    { m: torso, base: M.skin }, { m: hd.skull, base: M.skin }, { m: hd.features, base: M.gloss }, { m: L.mesh, base: M.skin },
    { m: skirt.mesh, base: M.cloth }, ...(hd.jaw ? [{ m: hd.jaw, base: M.skin }] : []),
  ], [torso, hd.skull]);

  const mat = new THREE.Matrix4();
  const cur = hold([0, 0, 0], [0, 1, 0], [0, 0, -1]); const base = hold([0, 0, 0], [0, 1, 0], [0, 0, -1]);
  const sh = [V(), V()]; const hip = [V(), V()]; const hand = [V(), V()]; const foot = [V(), V()];
  const elbow = V(); const knee = V(); const butt = V(); const toe = V(); const bendA = V(); const bendL = V();

  // o: mv, ph, awake, tell, chop, recover, jolt, hurt, fall, stamp (the waking stamp of the butt), flinch
  function poseGuard(o) {
    const step = o.ph * TAU;
    const lunge = o.chop * (1 - o.recover);
    pose.position.set(0, -0.035 * o.mv * Math.abs(Math.sin(step)) + 0.3 * o.fall, 0);
    pose.rotation.set(
      -0.05 * o.mv + 0.13 * o.tell * (1 - o.chop) - 0.3 * lunge + 0.08 * o.jolt + 0.2 * (o.flinch || 0) + (Math.PI / 2) * o.fall,
      (-0.4 * o.tell * (1 - o.chop) + 0.45 * lunge) * (1 - o.fall),
      0.035 * o.mv * Math.sin(step) + 0.07 * smooth((o.hurt - 0.35) / 0.3) * (1 - o.fall),
    );
    pose.updateMatrix(); body.updateMatrix();
    mat.multiplyMatrices(pose.matrix, body.matrix);

    // The halberd: upright at his side, carried, back over the shoulder for the tell, down and through.
    mixHold(base, HAL.rest, HAL.carry, o.awake);
    if (o.chop > 0) mixHold(cur, HAL.tell, HAL.strike, o.chop);
    else mixHold(cur, base, HAL.tell, o.tell);
    if (o.recover > 0) mixHold(cur, cur, base, o.recover);
    cur.grip.applyMatrix4(mat); cur.dir.transformDirection(mat); cur.fwd.transformDirection(mat);
    cur.grip.y += 0.03 * o.mv * Math.sin(step * 2) + 0.17 * (o.stamp || 0); // lifted, and brought down on the stones
    butt.copy(cur.grip).addScaledVector(cur.dir, -HAL_R);
    if (o.fall > 0) {
      // It leaves his hand and lies down beside him.
      const k = smooth(o.fall * 1.3);
      cur.dir.lerp(_a.set(0.97, 0.02, 0.24), k).normalize();
      butt.lerp(_a.set(0.45, 0.04, -0.1), k);
    }
    if (butt.y < 0.02) butt.y = 0.02;
    aim(hal, butt, cur.dir, cur.fwd);

    // Arms. The left hand comes to the shaft for the tell and the chop; a hurt guard's hangs.
    const two = Math.max(o.tell, o.chop > 0 ? 1 - o.recover : 0) * (o.hurt > 0.6 ? 0 : 1) * (1 - o.fall);
    for (let i = 0; i < 2; i++) sh[i].copy(G_SH[i]).applyMatrix4(mat);
    hand[0].copy(butt).addScaledVector(cur.dir, HAL_R);
    if (o.fall > 0) hand[0].lerp(_a.set(0.44, 1.02, 0.02).applyMatrix4(mat), smooth(o.fall * 2));
    _a.set(-0.44, 1.0 + 0.02 * o.mv * Math.sin(step), 0.02 + 0.2 * o.mv * Math.sin(step)).applyMatrix4(mat);
    hand[1].copy(butt).addScaledVector(cur.dir, HAL_L).lerp(_a, 1 - two);
    for (let i = 0; i < 2; i++) {
      bendA.set(i ? -0.25 : 0.25, -0.3, 1).transformDirection(mat);
      placeArm(L, i * 3, sh[i], hand[i], G_ARM[0], G_ARM[1], bendA, 0.074, elbow);
    }

    // Legs: a toy's march, the feet planted while the body goes over them.
    toe.set(0, -0.12, -1).normalize().transformDirection(mat);
    bendL.set(0, 0.1, -1).transformDirection(mat);
    for (let i = 0; i < 2; i++) {
      const c = frac(o.ph + i * 0.5);
      const T = G_STRIDE * G_STANCE; let fz; let fy = 0;
      if (c < G_STANCE) fz = (c / G_STANCE - 0.5) * T;
      else { const s = (c - G_STANCE) / (1 - G_STANCE); fz = (0.5 - smooth(s)) * T; fy = Math.sin(Math.PI * s) * 0.2; }
      const lame = o.hurt > 0.5 && i === 1 ? 0.35 : 1; // one leg drags once he is badly hurt
      foot[i].set(G_HIP[i].x * 1.05, 0.065 + fy * o.mv * lame, fz * o.mv * lame + (lame < 1 ? 0.12 * o.mv : 0));
      if (o.fall > 0) foot[i].lerp(_a.set(G_HIP[i].x, 0.065, 0).applyMatrix4(mat), Math.min(1, o.fall * 3));
      hip[i].copy(G_HIP[i]).applyMatrix4(mat);
      placeLeg(L, 6 + i * 3, hip[i], foot[i], G_LEG[0], G_LEG[1], bendL, 0.082, toe, knee);
    }
    L.commit();
  }

  v.sync = (en, dt, time, eye, cfg2, reduced) => {
    const s = guardView(en, cfg2, ctx.court);
    v.eye.copy(eye);
    v.tellDur = s.tellTime;
    g.position.set(s.x, s.y, s.z);
    if (v.first) { v.face = s.facing; v.first = false; }
    // Heads first, then the bodies come round.
    v.face += wrap(s.facing - v.face) * Math.min(1, dt * (s.still ? 30 : v.snap > 0.3 ? 0 : 7));
    g.rotation.y = v.face;
    g.visible = Math.hypot(eye.x - s.x, eye.z - s.z) < FAR;
    v.still = s.still;
    if (!g.visible) return;

    const walking = s.speed > 0.05 && !s.still;
    if (walking) v.phase += (s.speed * dt) / G_STRIDE;
    v.move = approach(v.move, walking ? 1 : 0, dt, 8);
    v.awake = approach(v.awake, s.still ? 0 : 1, dt, 3);
    v.hurt = s.hurt;
    v.jolt = Math.max(0, v.jolt - dt * 5);
    v.flash = Math.max(0, v.flash - dt);
    v.flinch = approach(v.flinch, s.stunned ? 1 : 0, dt, 14);
    const shout = v.waking(s, dt); // he wakes alone: a start, the butt of the halberd on the stones, a bark
    if (s.stunned) v.tellOn = false;
    if (v.tellOn) { v.tellClock += dt; if (v.tellClock > v.tellDur + 0.4) v.tellOn = false; }
    const tell = Math.max(s.tell, v.tellOn ? clamp(v.tellClock / v.tellDur) : 0);
    v.tellAmt = approach(v.tellAmt, smooth(tell), dt, 22);
    v.strikeT = Math.max(0, v.strikeT - dt);
    const u = v.strikeT > 0 ? 1 - v.strikeT / G_STRIKE : 0;
    const chop = v.strikeT > 0 ? smooth(u / 0.25) : 0;
    const recover = v.strikeT > 0 ? smooth((u - 0.55) / 0.45) : 0;

    v.turnHead(s, eye, dt);
    // A statue while still: only the eyes. Awake he breathes like anyone.
    S.breathe(rig, time, { amount: v.awake, look: eye, sway: s.still ? 0 : 1 + 2 * v.move });
    // Clockwork: the stride holds and ticks on, worse as he is hurt. The head never bobs.
    const hk = 0.35 + 0.3 * v.hurt;
    poseGuard({
      mv: v.move, ph: v.phase + (tick(v.phase, 8, 0.5) - v.phase) * hk, awake: v.awake, tell: chop > 0 ? 1 : v.tellAmt,
      chop, recover, jolt: v.jolt, hurt: v.hurt, fall: 0, flinch: v.flinch,
      stamp: v.wakeT > 0 ? Math.sin(Math.PI * clamp((1 - v.wakeT / WAKE_T) * 2.4)) : 0,
    });
    hd.group.position.y -= pose.position.y; // level, whatever the legs are doing
    hd.group.rotation.z += 0.5 * v.tellAmt * (1 - recover) * (seed % 2 ? 1 : -1); // it cocks its head to strike
    hd.group.rotation.z += 0.12 * v.flinch * Math.sin(time * 21); // water in its eyes
    hd.pose({ jaw: Math.max(0.85 * Math.max(v.tellAmt, chop) * (1 - recover), 0.9 * shout) });
    v.setMat(v.flash > 0 && !reduced ? 'flash' : null);

    if (v.hurt > 0.3 && !v.drips) v.drips = S.drips(g, 3, WET, seed);
    if (v.drips) {
      v.drips.step(dt, v.hurt > 0.3 ? 0.4 + 1.4 * v.hurt : 0, (out) => {
        if (v.hurtMarks.pick(out)) g.worldToLocal(out); else out.set(0, 1.4, -0.2);
      }, 0);
    }
  };
  v.onEvent = (ev) => {
    if (ev.type === 'hit') v.struck(ev, ev.zone === 'head' ? hd.skull : torso);
    else if (ev.type === 'strikeTell') { v.tellOn = true; v.tellClock = 0; }
    else if (ev.type === 'strike') { v.tellOn = false; v.strikeT = G_STRIKE; }
    else if (ev.type === 'wakeOne') v.wake();
  };
  v.restore = () => {
    if (v.dead) { v.gone = true; return; }
    v.unmark();
    Object.assign(v, { yaw: 0, over: 0, snap: 0, move: 0, awake: 0, tellAmt: 0, tellOn: false, strikeT: 0, flash: 0, jolt: 0, flinch: 0, wakeT: 0, wasStill: null, first: true });
    hd.pose({ jaw: 0 });
  };
  v.die = () => {
    v.dead = true; v.deathT = 0;
    v.setMat('dead');
    for (let i = 0; i < 12; i++) L.tone(i, 0xffffff); // the colour goes out of him
    if (v.drips) v.drips.mesh.visible = false;
    hd.pose({ jaw: 0.25, blink: 0 });
  };
  // He goes over backwards all of a piece, as a toy does, and the halberd lies down beside him.
  v.updateDeath = (dt) => {
    if (v.gone) return true;
    if (v.deathT > 1.4) return false; // lies where he fell, for the stake to be pulled from
    v.deathT += dt;
    const t = v.deathT / 0.75;
    const k = t < 1 ? t * t : 1 - 0.05 * Math.sin(Math.PI * clamp((v.deathT - 0.75) / 0.3));
    poseGuard({ mv: 0, ph: v.phase, awake: v.awake, tell: 0, chop: 0, recover: 0, jolt: 0, hurt: 0, fall: clamp(k) });
    if (v.deathT > 1.4) for (const m of [torso, hd.skull, L.mesh, skirt.mesh, hal]) m.castShadow = false;
    return false;
  };
  v.dispose = () => {
    ctx.cast.delete(v);
    v.hurtMarks.clear();
    if (v.drips) v.drips.mesh.material.dispose();
    disposeTree(g);
  };
  poseGuard({ mv: 0, ph: v.phase, awake: 0, tell: 0, chop: 0, recover: 0, jolt: 0, hurt: 0, fall: 0 });
  return v;
}

// ---- Card Gardeners -------------------------------------------------------------------------------

const BRUSH_H = 0.5; // where the right hand holds the brush, metres from its butt
const BRUSH_RUN = hold([0.5, 1.3, -0.15], [0.1, 0.9, 0.42], [0, 0, -1]);
const BRUSH_TELL = hold([0.62, 1.75, 0.15], [0.55, 0.45, 0.7], [0, 0, -1]);
const BRUSH_SLAP = hold([0.15, 1.35, -0.5], [-0.75, 0.1, -0.65], [0, 0, -1]);
const GARDENERS = [
  // club: slit pupils; the head tilted further than a neck goes. Caught high in the stroke.
  { suit: 'club', seed: 21, defects: ['pupilsSlit', 'headTilt:R'], ink: INK, shoe: SCARLET, eye: 0x9aa23a,
    pips: [[0, -0.36, 0.3, 0], [0, -0.94, 0.3, 1]],
    brush: hold([0.52, 1.75, -0.3], [-0.15, 0.55, -0.82], [0, 0, -1]), left: V(-0.56, 1.15, -0.3), crouch: 0 },
  // diamond: one eye much too large; the mouth set crooked. Bent to a low rose.
  { suit: 'diamond', seed: 34, defects: ['eyeBig:L', 'mouthCrooked:R'], ink: SCARLET, shoe: INK, eye: 0x4f6f8c,
    pips: [[-0.24, -0.3, 0.19, 0], [0.24, -0.3, 0.19, 0], [0, -0.65, 0.19, 0], [-0.24, -1.0, 0.19, 1], [0.24, -1.0, 0.19, 1]],
    brush: hold([0.45, 1.12, -0.45], [-0.1, -0.25, -0.96], [0, 0, -1]), left: V(-0.5, 0.95, -0.06), crouch: 0.16 },
  // spade: eyes too close together; no mouth at all. Reaching up, a finger where the mouth is not.
  { suit: 'spade', seed: 47, defects: ['eyesClose', 'noMouth'], ink: INK, shoe: SCARLET, eye: 0x3d3a36,
    pips: [[-0.24, -0.26, 0.17, 0], [0.24, -0.26, 0.17, 0], [0, -0.45, 0.17, 0], [-0.24, -0.65, 0.17, 0], [0.24, -0.65, 0.17, 0], [-0.24, -1.04, 0.17, 1], [0.24, -1.04, 0.17, 1]],
    brush: hold([0.4, 2.18, -0.15], [0, 0.85, -0.5], [0, 0, -1]), left: V(-0.1, 1.84, -0.42), crouch: 0 },
];
const C_SH = [V(0.44, 1.6, 0), V(-0.44, 1.6, 0)];
const C_HIP = [V(0.2, 0.5, 0), V(-0.2, 0.5, 0)];
const C_ARM = [0.52, 0.52];
const C_LEG = [0.26, 0.26]; // far too short for how fast they go
const C_STRIDE = 0.62;
const C_STRIKE = 0.34;
const CARD_W = 0.92; const CARD_L = 1.3; const CARD_TOP = 1.72;

function brushGeometry(seed) {
  return S.merge([
    S.skin([{ at: [0, 0, 0], r: 0.02 }, { at: [0.006, 0.6, 0], r: 0.023 }, { at: [0, 1.22, 0], r: 0.026 }],
      { seed, sides: 6, detail: 2, budget: 110, color: 0x8a7b45, color2: 0x5a4a2a, noise: 0.05, mottle: 0.2 }),
    S.skin([{ at: [0, 1.2, 0], r: [0.05, 0.03], color: 0x6a6860 }, { at: [0, 1.3, 0], r: [0.075, 0.034], color: 0x8d8a82 }],
      { seed, sides: 7, detail: 1, noise: 0.03, caps: 'flat' }),
    // Bristles, loaded: rose white at the root, red where they have been in the pot.
    S.skin([{ at: [0, 1.3, 0], r: [0.078, 0.036], color: 0xd8cfb6 }, { at: [0.004, 1.42, 0], r: [0.085, 0.04], color: PAINT }, { at: [0.012, 1.56, 0.004], r: [0.05, 0.02], color: PAINT }],
      { seed: seed + 1, sides: 8, detail: 2, rough: 0.28, noise: 0.08, shade: 0.15, caps: ['open', 'round'], capLen: 0.5 }),
    // One drop that has been about to fall for a long time.
    S.skin([{ at: [0.03, 1.5, -0.02], r: 0.008, color: PAINT }, { at: [0.035, 1.46, -0.05], r: 0.012, color: PAINT }, { at: [0.035, 1.42, -0.06], r: 0.02, color: WET }],
      { seed, sides: 5, detail: 1, noise: 0 }),
  ]);
}

function cardBack() {
  const g = new THREE.PlaneGeometry(CARD_W * 0.94, CARD_L * 0.96, 6, 10).translate(0, -CARD_L / 2, -0.05);
  const p = g.attributes.position; const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const ix = i % 7; const iy = Math.floor(i / 7);
    _col.set((ix + iy) % 2 ? WET : 0xd9d0b8).multiplyScalar(0.85 + 0.2 * S.noise(ix, iy, 0, 4));
    col[i * 3] = _col.r; col[i * 3 + 1] = _col.g; col[i * 3 + 2] = _col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function gardenerHat(spec, size) {
  const cy = 0.8 * size;
  const straw = 0xc9b36a;
  const parts = [
    S.skin([{ at: [0, 0.5, 0.05], r: 0.235, color: spec.ink }, { at: [0, 0.55, 0.05], r: 0.23, color: spec.ink }, { at: [0, 0.565, 0.05], r: 0.225 }, { at: [0.01, 0.67, 0.05], r: 0.215 }],
      { seed: spec.seed, sides: 10, detail: 1, budget: 150, caps: ['open', 'flat'], color: straw, color2: 0x8a7b45, noise: 0.05, rough: 0.03, mottle: 0.25 }),
    S.tint(new THREE.TorusGeometry(0.31, 0.04, 4, 16).rotateX(Math.PI / 2).scale(1, 0.3, 1).translate(0, 0.5, 0.05), straw, 0.3, spec.seed),
  ].map((p) => p.translate(0, -cy, 0).rotateX(0.24).translate(0, cy, 0)); // pushed back off the brow
  parts.push(S.tint(new THREE.TorusGeometry(0.1, 0.045, 5, 10).rotateX(Math.PI / 2).translate(0, 0.0, 0), spec.ink, 0.2, spec.seed));
  return parts;
}

function buildGardener(e, cfg, ctx) {
  const spec = GARDENERS[nearestIndex(COURT.gardeners, e.x, e.z) % GARDENERS.length];
  const seed = spec.seed;
  const M = S.materials();
  const g = new THREE.Group(); const pose = new THREE.Group(); const body = new THREE.Group();
  g.add(pose); pose.add(body);

  // The body is the card: foxed at the edges, splashed where the brush hand works, a lattice behind.
  const attach = [cardBack()];
  for (const [x, y, size, flip] of spec.pips) {
    const p = S.pip(spec.suit, size);
    if (flip) p.rotateZ(Math.PI);
    attach.push(p.translate(x, y, 0));
  }
  attach.push(S.pip(spec.suit, 0.085).translate(-0.37, -0.12, 0), S.pip(spec.suit, 0.085).rotateZ(Math.PI).translate(0.37, -CARD_L + 0.12, 0));
  const card = S.cloth({
    width: CARD_W, length: CARD_L, cols: 8, rows: 11, budget: 200, color: ROSE, folds: 1, foldDepth: 0.03, tatter: 0.22, dirt: 0.22,
    stiff: 0.8, seed, attach,
    pattern: (u, v, c) => {
      const edge = Math.min(u, 1 - u, v, 1 - v);
      c.lerp(FOXED, 0.7 * (1 - smooth(edge / 0.14)));
      const sp = S.noise(u * 5, v * 6, 0, seed);
      if (u < 0.45 && v > 0.5 && sp > 0.38) c.lerp(PAINT, 0.9); // u runs toward the figure's own left
    },
  });
  card.mesh.position.set(0, CARD_TOP, 0);
  const size = 0.33;
  const hd = S.head({
    size, seed, defects: spec.defects, budget: 1500, extras: gardenerHat(spec, size),
    face: { skin: 0xf1e2cd, eye: spec.eye, cheek: { rosy: 0.6 }, skull: { wide: 1.05, tall: 1.0, taper: 0.16, chin: 0.03 }, nose: { size: 0.1 }, ears: { size: 0.85 }, brow: { thick: 0.028 } },
  });
  hd.group.position.set(0, CARD_TOP + 0.02, 0);
  body.add(card.mesh, hd.group);

  const L = S.limbs(12, { seed, sides: 5, taper: 0.7, cast: false });
  [0, 1, 3, 4, 6, 7, 9, 10].forEach((i) => L.tone(i, spec.ink));
  [2, 5].forEach((i) => L.tone(i, 0xe9e2cf));
  [8, 11].forEach((i) => L.tone(i, spec.shoe));
  const brush = new THREE.Mesh(brushGeometry(seed), M.skin);
  g.add(L.mesh, brush);

  const rig = { root: body, head: hd, cloths: [card], seed, rate: 0.31 };
  const v = {
    g, kind: 'gardener', seed, head: hd, eye: V(), type: 'gardener',
    face: e.heading || 0, first: true, yaw: 0, over: 0, snap: 0, still: true, dead: false, gone: false,
    phase: frac(seed * 0.37), move: 0, awake: 0, tellAmt: 0, tellOn: false, tellClock: 0, tellDur: 0.35,
    strikeT: 0, flash: 0, jolt: 0, flinch: 0, hurt: 0, deathT: 0, wind: 0, wakeT: 0, wasStill: null,
    pointAt: null, pointK: 0, pointWait: 0, brushYaw: 0.5 + frac(seed * 0.71), brushGoal: null,
  };
  figure(v, ctx, [
    { m: card.mesh, base: M.cloth }, { m: hd.skull, base: M.skin }, { m: hd.features, base: M.gloss }, { m: L.mesh, base: M.skin },
    ...(hd.jaw ? [{ m: hd.jaw, base: M.skin }] : []),
  ], [card.mesh, hd.skull]);

  const mat = new THREE.Matrix4();
  const cur = hold([0, 0, 0], [0, 1, 0], [0, 0, -1]); const base = hold([0, 0, 0], [0, 1, 0], [0, 0, -1]);
  const pointing = hold([0, 0, 0], [0, 1, 0], [0, 0, -1]);
  const sh = [V(), V()]; const hip = [V(), V()]; const hand = [V(), V()]; const foot = [V(), V()];
  const elbow = V(); const knee = V(); const butt = V(); const toe = V(); const bendA = V(); const bendL = V();

  /** Where (x, z) lies in the figure's own frame. */
  function localOf(x, z, out) {
    const dx = x - g.position.x; const dz = z - g.position.z;
    const c = Math.cos(v.face); const s = Math.sin(v.face);
    return out.set(dx * c - dz * s, 0, dx * s + dz * c);
  }

  // o: mv, ph, awake, tell, chop, recover, jolt, flinch, point, fall
  function poseGardener(o) {
    const step = o.ph * TAU;
    const slap = o.chop * (1 - o.recover);
    const low = spec.crouch * (1 - o.awake);
    pose.position.set(0, 0.015 * o.mv * Math.abs(Math.sin(step)) - low + 0.05 * o.fall, 0);
    pose.rotation.set(
      -0.17 * o.mv - 0.5 * low + 0.3 * o.flinch + 0.1 * o.jolt + 0.12 * o.tell * (1 - o.chop) - 0.22 * slap + (Math.PI / 2) * o.fall,
      (-0.5 * o.tell * (1 - o.chop) + 0.8 * slap) * (1 - o.fall),
      0.05 * o.mv * Math.sin(step) * (1 - o.fall),
    );
    pose.updateMatrix(); body.updateMatrix();
    mat.multiplyMatrices(pose.matrix, body.matrix);

    // The brush: frozen in its stroke, pointing if it has been asked to, shouldered at a run.
    mixHold(base, spec.brush, pointing, o.point);
    mixHold(base, base, BRUSH_RUN, o.awake);
    if (o.chop > 0) mixHold(cur, BRUSH_TELL, BRUSH_SLAP, o.chop);
    else mixHold(cur, base, BRUSH_TELL, o.tell);
    if (o.recover > 0) mixHold(cur, cur, base, o.recover);
    cur.grip.applyMatrix4(mat); cur.dir.transformDirection(mat); cur.fwd.transformDirection(mat);
    butt.copy(cur.grip).addScaledVector(cur.dir, -BRUSH_H);
    if (o.fall > 0) {
      const k = smooth(o.fall * 1.2);
      cur.dir.lerp(_a.set(Math.cos(v.brushYaw), 0, Math.sin(v.brushYaw)), k).normalize();
      butt.lerp(_a.set(0.75, 0.035, 0.45), k);
      cur.fwd.set(0, 1, 0);
    }
    aim(brush, butt, cur.dir, cur.fwd);

    for (let i = 0; i < 2; i++) sh[i].copy(C_SH[i]).applyMatrix4(mat);
    hand[0].copy(butt).addScaledVector(cur.dir, BRUSH_H);
    // The free arm: held as it was caught, pumping at a run, flung wide for the slap.
    _a.copy(spec.left).lerp(_b.set(-0.5, 1.15 + 0.14 * Math.sin(step), -0.2 - 0.3 * Math.sin(step)), o.awake);
    _a.lerp(_b.set(-0.8, 1.55, 0.2), Math.max(o.tell * (1 - o.chop), o.flinch));
    hand[1].copy(_a).applyMatrix4(mat);
    if (o.fall > 0) {
      const k = smooth(o.fall * 1.5);
      hand[0].lerp(_a.set(0.95, 1.4, -0.02).applyMatrix4(mat), k);
      hand[1].lerp(_a.set(-0.9, 1.2, -0.02).applyMatrix4(mat), k);
    }
    for (let i = 0; i < 2; i++) {
      bendA.set(i ? -0.6 : 0.6, -0.6, 0.5).transformDirection(mat);
      placeArm(L, i * 3, sh[i], hand[i], C_ARM[0], C_ARM[1], bendA, 0.046, elbow);
    }

    // Legs: little ones, going like a beetle's.
    toe.set(0, -0.1, -1).normalize().transformDirection(mat);
    bendL.set(0, 0.2, -1).transformDirection(mat);
    for (let i = 0; i < 2; i++) {
      const c = frac(o.ph + i * 0.5);
      const T = C_STRIDE * 0.5; let fz; let fy = 0;
      if (c < 0.5) fz = (c / 0.5 - 0.5) * T;
      else { const s = (c - 0.5) / 0.5; fz = (0.5 - s) * T; fy = Math.sin(Math.PI * s) * 0.09; }
      foot[i].set(C_HIP[i].x * 1.1, 0.045 + fy * o.mv, fz * o.mv - 0.5 * low);
      if (o.fall > 0) foot[i].lerp(_a.set(C_HIP[i].x * 1.2, 0.02, -0.02).applyMatrix4(mat), Math.min(1, o.fall * 3));
      hip[i].copy(C_HIP[i]).applyMatrix4(mat);
      placeLeg(L, 6 + i * 3, hip[i], foot[i], C_LEG[0], C_LEG[1], bendL, 0.05, toe, knee);
    }
    L.commit();
  }

  /** The brush is asked to point at (x, z): raised if the figure stands, on the ground if it has fallen. */
  v.point = (x, z) => {
    v.pointAt = { x, z }; v.pointWait = 0;
    if (v.dead) { localOf(x, z, _a); v.brushGoal = Math.atan2(_a.z - 0.45, _a.x - 0.75); }
  };

  v.sync = (en, dt, time, eye, cfg2, reduced) => {
    const s = gardenerView(en, cfg2, ctx.court);
    v.eye.copy(eye);
    v.tellDur = s.tellTime;
    g.position.set(s.x, s.y, s.z);
    if (v.first) { v.face = s.facing; v.first = false; }
    v.face += wrap(s.facing - v.face) * Math.min(1, dt * (s.still ? 30 : v.snap > 0.3 ? 0 : 11));
    g.rotation.y = v.face;
    g.visible = Math.hypot(eye.x - s.x, eye.z - s.z) < FAR;
    v.still = s.still;
    if (!g.visible) return;

    const running = s.speed > 0.05 && !s.still;
    if (running) v.phase += (s.speed * dt) / C_STRIDE;
    v.move = approach(v.move, running ? 1 : 0, dt, 12);
    v.awake = approach(v.awake, s.still ? 0 : 1, dt, 5);
    v.hurt = s.hurt;
    v.jolt = Math.max(0, v.jolt - dt * 5);
    v.flash = Math.max(0, v.flash - dt);
    const shout = v.waking(s, dt); // it wakes alone: a start, a riffle of card, a yelp
    v.flinch = approach(v.flinch, s.stunned ? 1 : 0.75 * shout, dt, 16);
    if (s.stunned) v.tellOn = false;
    if (v.tellOn) { v.tellClock += dt; if (v.tellClock > v.tellDur + 0.4) v.tellOn = false; }
    const tell = Math.max(s.tell, v.tellOn ? clamp(v.tellClock / v.tellDur) : 0);
    v.tellAmt = approach(v.tellAmt, smooth(tell), dt, 30);
    v.strikeT = Math.max(0, v.strikeT - dt);
    const u = v.strikeT > 0 ? 1 - v.strikeT / C_STRIKE : 0;
    const chop = v.strikeT > 0 ? smooth(u / 0.3) : 0;
    const recover = v.strikeT > 0 ? smooth((u - 0.6) / 0.4) : 0;

    // The hint: while it stands still the raised brush is found pointing at the next valve. It
    // moves when the warden is not looking; watched for long enough, it creeps.
    if (v.pointAt && s.still) {
      localOf(v.pointAt.x, v.pointAt.z, _a).normalize();
      if (Math.abs(_a.z) < 0.3) _a.z = -0.3;
      _a.normalize();
      pointing.dir.set(_a.x, -0.04, _a.z).normalize();
      pointing.grip.copy(C_SH[0]).addScaledVector(pointing.dir, 0.62);
      pointing.grip.y -= 0.04;
      if (v.pointK < 1) {
        v.pointWait += dt;
        const yaw = ctx.court ? ctx.court.yaw : null;
        _b.set(s.x - eye.x, 0, s.z - eye.z).normalize();
        const watched = yaw != null && (-Math.sin(yaw) * _b.x - Math.cos(yaw) * _b.z) > 0.45;
        if (!watched) v.pointK = 1;
        else if (v.pointWait > 6) v.pointK = Math.min(1, v.pointK + dt / 3);
      }
    } else if (!s.still) { v.pointAt = null; v.pointK = 0; }
    if (!v.pointAt) v.pointK = 0;

    v.turnHead(s, eye, dt);
    v.wind = approach(v.wind, -0.9 * v.move - 2.2 * v.flinch - 1.2 * v.jolt + 2.4 * shout * Math.sin(time * 47), dt, shout > 0 ? 40 : 14); // the card bows as it runs, and riffles as it wakes
    S.breathe(rig, time, { amount: v.awake, look: eye, sway: s.still ? 0 : 1 + 3 * v.move, wind: s.still ? 0 : v.wind });
    poseGardener({
      mv: v.move, ph: v.phase, awake: v.awake, tell: chop > 0 ? 1 : v.tellAmt, chop, recover, jolt: v.jolt, flinch: v.flinch,
      point: smooth(v.pointK) * (1 - v.awake), fall: 0,
    });
    hd.group.position.y -= pose.position.y * 0.6;
    if (hd.jaw) hd.pose({ jaw: Math.max(0.6 * Math.max(v.tellAmt, chop) * (1 - recover), 0.8 * shout) });
    v.setMat(v.flash > 0 && !reduced ? 'flash' : null);
  };
  v.onEvent = (ev) => {
    if (ev.type === 'hit') v.struck(ev, ev.zone === 'head' ? hd.skull : card.mesh);
    else if (ev.type === 'strikeTell') { v.tellOn = true; v.tellClock = 0; }
    else if (ev.type === 'strike') { v.tellOn = false; v.strikeT = C_STRIKE; }
    else if (ev.type === 'wakeOne') v.wake();
  };
  v.restore = () => {
    if (v.dead) { v.gone = true; return; }
    v.unmark();
    Object.assign(v, {
      yaw: 0, over: 0, snap: 0, move: 0, awake: 0, tellAmt: 0, tellOn: false, strikeT: 0, flash: 0, jolt: 0, flinch: 0, wind: 0,
      wakeT: 0, wasStill: null, pointAt: null, pointK: 0, first: true,
    });
    if (hd.jaw) hd.pose({ jaw: 0 });
  };
  v.die = () => {
    v.dead = true; v.deathT = 0; v.pointAt = null;
    v.setMat('dead');
    for (let i = 0; i < 12; i++) L.tone(i, 0xffffff);
    hd.pose({ blink: 0 });
  };
  // The card goes over on its back and curls, and the brush lands beside it. The brush stays a
  // brush: later it may turn on the ground to point.
  v.updateDeath = (dt, time) => {
    if (v.gone) return true;
    if (v.brushGoal != null) {
      const d = wrap(v.brushGoal - v.brushYaw);
      v.brushYaw += Math.sign(d) * Math.min(Math.abs(d), dt * 0.9);
      if (Math.abs(d) < 1e-3) v.brushGoal = null;
    } else if (v.deathT > 1.1) return false;
    v.deathT += dt;
    const k = smooth(v.deathT / 0.6);
    card.sway(time, 0, -11 * k);
    hd.group.position.set(0, CARD_TOP + 0.02, -0.26 * k);
    hd.group.rotation.x = -0.5 * k;
    poseGardener({ mv: 0, ph: v.phase, awake: v.awake, tell: 0, chop: 0, recover: 0, jolt: 0, flinch: 0, point: 0, fall: k });
    if (v.deathT > 1.1) { card.mesh.castShadow = false; hd.skull.castShadow = false; }
    return false;
  };
  v.dispose = () => {
    ctx.cast.delete(v);
    v.hurtMarks.clear();
    disposeTree(g);
  };
  poseGardener({ mv: 0, ph: v.phase, awake: 0, tell: 0, chop: 0, recover: 0, jolt: 0, flinch: 0, point: 0, fall: 0 });
  return v;
}

// ---- Renfield and his table -----------------------------------------------------------------------
// He sits at the origin of his own group facing -Z; the table's middle is 1.7 m in front of him.

const TABLE_Z = -1.7;
const DISH = V(0, 0.86, -1.02);
const R_SH = [V(0.24, 1.5, -0.2), V(-0.24, 1.5, -0.2)];
const R_ARM = [0.45, 0.46]; // long, for a clerk
const EAT = 5.4; // seconds a mouthful takes

function lathe(points, segs, hex, vary, seed) {
  return S.tint(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segs), hex, vary, seed);
}

function furniture() {
  const wood = 0x3a2a1e; const china = 0xe9e4d6;
  const post = (a, b, r, seed) => S.skin([{ at: a, r }, { at: [(a[0] + b[0]) / 2 + 0.008, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], r: r * 0.85 }, { at: b, r: r * 0.9 }],
    { seed, sides: 6, detail: 1, color: wood, color2: 0x241812, noise: 0.07, mottle: 0.2 });
  const parts = [];
  // The chair: high backed, its finials two small horns.
  for (const sx of [-1, 1]) {
    parts.push(post([sx * 0.29, 0, -0.27], [sx * 0.27, 0.6, -0.25], 0.036, 3 + sx));
    parts.push(post([sx * 0.3, 0, 0.3], [sx * 0.3, 1.66, 0.38], 0.04, 5 + sx));
    parts.push(S.tint(new THREE.ConeGeometry(0.045, 0.2, 6).rotateZ(-sx * 0.35).translate(sx * 0.32, 1.76, 0.38), 0x8a7430, 0.2, sx));
  }
  parts.push(S.tint(new THREE.BoxGeometry(0.64, 0.07, 0.62).translate(0, 0.6, 0.02), wood, 0.25, 1));
  parts.push(S.tint(new THREE.SphereGeometry(1, 10, 6).scale(0.29, 0.06, 0.28).translate(0, 0.65, 0.02), WET, 0.25, 2));
  for (const y of [0.95, 1.25]) parts.push(post([-0.3, y, 0.34], [0.3, y, 0.34], 0.026, y * 10));
  parts.push(S.skin([{ at: [-0.31, 1.6, 0.375], r: 0.035 }, { at: [0, 1.72, 0.39], r: 0.05 }, { at: [0.31, 1.6, 0.375], r: 0.035 }],
    { seed: 9, sides: 6, detail: 2, color: wood, color2: 0x241812, noise: 0.08, mottle: 0.2 }));
  // The table: a stone foot, a round top under linen.
  parts.push(lathe([[0, 0], [0.4, 0], [0.36, 0.06], [0.13, 0.14], [0.11, 0.6], [0.2, 0.76], [0.98, 0.78]], 12, 0x6a6860, 0.2, 4).translate(0, 0, TABLE_Z));
  parts.push(S.tint(new THREE.CylinderGeometry(1.0, 1.0, 0.05, 22).translate(0, 0.805, TABLE_Z), ROSE, 0.1, 6));
  // The dish, with a gold rim; cup, saucer and a note under it; the pot.
  parts.push(lathe([[0, 0.012], [0.09, 0.014], [0.16, 0.03], [0.2, 0.05], [0.215, 0.047], [0.17, 0.02], [0.1, 0], [0, 0]], 14, china, 0.06, 7).translate(DISH.x, 0.832, DISH.z));
  parts.push(S.tint(new THREE.TorusGeometry(0.207, 0.006, 4, 16).rotateX(Math.PI / 2).translate(DISH.x, 0.881, DISH.z), GOLD));
  const cup = [0.44, 0.832, -1.3];
  parts.push(lathe([[0, 0.008], [0.07, 0.01], [0.11, 0.022], [0.115, 0.018], [0.06, 0], [0, 0]], 10, china, 0.06, 8).translate(...cup));
  parts.push(lathe([[0, 0.02], [0.03, 0.02], [0.05, 0.05], [0.058, 0.1], [0.05, 0.1], [0.042, 0.05], [0.02, 0.03], [0, 0.03]], 9, china, 0.06, 9).translate(...cup));
  parts.push(S.tint(new THREE.CircleGeometry(0.044, 9).rotateX(-Math.PI / 2).translate(cup[0], cup[1] + 0.088, cup[2]), 0x4a1c12));
  parts.push(S.tint(new THREE.TorusGeometry(0.026, 0.006, 4, 8, Math.PI).rotateZ(-Math.PI / 2).translate(cup[0] + 0.055, cup[1] + 0.066, cup[2]), china));
  parts.push(S.tint(new THREE.PlaneGeometry(0.15, 0.1).rotateX(-Math.PI / 2).rotateY(0.5).translate(cup[0] + 0.1, cup[1] + 0.004, cup[2] + 0.07), 0xe8e2d0, 0.08, 3));
  const pot = [-0.48, 0.832, -1.52];
  parts.push(lathe([[0, 0], [0.09, 0], [0.14, 0.06], [0.15, 0.13], [0.11, 0.2], [0.05, 0.22], [0.03, 0.25], [0, 0.26]], 11, china, 0.07, 11).translate(...pot));
  parts.push(S.skin([{ at: [pot[0] + 0.13, pot[1] + 0.08, pot[2]], r: 0.03 }, { at: [pot[0] + 0.22, pot[1] + 0.13, pot[2]], r: 0.02 }, { at: [pot[0] + 0.27, pot[1] + 0.21, pot[2]], r: 0.014 }],
    { sides: 6, detail: 1, color: china, noise: 0.03, mottle: 0.05 }));
  parts.push(S.tint(new THREE.TorusGeometry(0.06, 0.012, 4, 8, Math.PI).rotateZ(Math.PI / 2).translate(pot[0] - 0.13, pot[1] + 0.12, pot[2]), china));
  return S.merge(parts);
}

// The cave bugs' own colours (fauna.js paints the Lurch's shell with these): dark chitin worn
// pale along the edges, lichen in it, and the cave's foxfire for the glow.
const BUG_CHITIN = new THREE.Color(0x1b1f30); const BUG_WORN = new THREE.Color(0x7d7767); const BUG_LICHEN = new THREE.Color(0x35503f);
const FOXFIRE = new THREE.Color(CAVE.foxfire);

function bugGeometry() {
  const shell = new THREE.SphereGeometry(1, 6, 4).scale(0.02, 0.013, 0.03);
  const p = shell.attributes.position; const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    // Chitin in front, worn at the skirt; behind, the foxfire it was eaten for.
    const rim = 1 - clamp((p.getY(i) + 0.013) / 0.02);
    _col.copy(BUG_CHITIN).lerp(BUG_LICHEN, 0.45 * clamp(0.5 + S.noise(p.getX(i) * 90, p.getY(i) * 90, p.getZ(i) * 90, 6))).lerp(BUG_WORN, 0.5 * rim * rim);
    _col.lerp(FOXFIRE, smooth((p.getZ(i) + 0.004) / 0.02));
    col[i * 3] = _col.r; col[i * 3 + 1] = _col.g; col[i * 3 + 2] = _col.b;
  }
  shell.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const parts = [shell];
  for (const z of [-0.013, 0, 0.012]) parts.push(S.tint(new THREE.BoxGeometry(0.075, 0.003, 0.004).translate(0, -0.006, z), 0x0c0d14));
  return S.merge(parts);
}

function buildRenfield(ctx) {
  const M = S.materials();
  const seed = 59;
  const g = new THREE.Group(); const pose = new THREE.Group(); const body = new THREE.Group();
  g.add(pose); pose.add(body);
  g.position.set(COURT.renfield.x, 0, COURT.renfield.z);
  g.rotation.y = Math.atan2(-(COURT.renfield.table.x - COURT.renfield.x), -(COURT.renfield.table.z - COURT.renfield.z));

  const table = new THREE.Mesh(furniture(), M.skin);
  table.castShadow = true;
  const linen = S.cloth({
    curve: TAU, radius: 1.0, flare: 0.05, length: 0.44, cols: 18, rows: 4, budget: 150, color: ROSE, folds: 9, foldDepth: 0.045,
    tatter: 0.3, dirt: 0.3, seed, cast: false,
    pattern: (u, v, c) => { if (S.noise(u * 14, v * 3, 0, 8) > 0.5) c.lerp(WETC, 0.5 * v); },
  });
  linen.mesh.position.set(0, 0.83, TABLE_Z);

  // A thin man folded over his plate: coat the colour of old ledgers, a high collar.
  const coat = 0x3f4a42;
  const torso = new THREE.Mesh(S.merge([
    S.skin([
      { at: [0, 0.7, 0.06], r: [0.2, 0.17], color: 0x25272a }, { at: [0, 0.95, 0.02], r: [0.19, 0.15] },
      { at: [0, 1.3, -0.1], r: [0.235, 0.17] }, { at: [0, 1.52, -0.2], r: [0.2, 0.13] }, { at: [0, 1.64, -0.245], r: 0.075, color: ROSE },
    ], {
      seed, sides: 11, detail: 3, budget: 560, color: coat, color2: 0x2e352f, noise: 0.05, mottle: 0.15,
      colorAt: (u, a, c) => { if (Math.abs(a) < 0.42 * (u - 0.25) || Math.abs(a - TAU) < 0.42 * (u - 0.25)) c.set(u > 0.5 ? 0xd9d2bf : 0x4a2a2e); },
    }),
    S.tint(new THREE.TorusGeometry(0.085, 0.03, 5, 12).rotateX(Math.PI / 2 + 0.3).scale(1, 1.5, 1).translate(0, 1.66, -0.25), 0xe6dfcb, 0.08, seed),
  ]), M.skin);
  torso.castShadow = true;
  const hd = S.head({
    size: 0.3, seed, defects: ['pupilsPin', 'legInMouth:R'], budget: 1500,
    face: {
      skin: 0xd9cfba, eye: 0x9aa9a4, hair: 0x26221e, cheek: { rosy: 0.12 },
      skull: { wide: 0.93, tall: 1.12, taper: 0.46, cheek: -0.03, brow: 0.05, chin: 0.07 },
      nose: { kind: 'long', size: 0.085, length: 0.3 }, ears: { size: 1.15 }, brow: { thick: 0.026, color: 0x26221e },
      mouth: { width: 0.33, smile: 0.4, lip: 0x8e5a52 }, eyes: { r: 0.19 },
    },
  });
  hd.group.position.set(0, 1.66, -0.25);
  hd.group.rotation.x = -0.24; // bent to the dish
  // The napkin, tucked. It has been tucked a long time.
  const napkin = S.cloth({
    width: 0.3, widthEnd: 0.46, length: 0.46, cols: 4, rows: 5, budget: 60, color: ROSE, folds: 2, foldDepth: 0.02, dirt: 0.1, tatter: 0.1,
    seed, cast: false,
    pattern: (u, v, c) => { if (S.noise(u * 5, v * 5, 0, 3) > 0.6) c.lerp(WETC, 0.55); },
  });
  napkin.mesh.position.set(0, 1.6, -0.345);
  napkin.mesh.rotation.x = 0.1;
  body.add(torso, hd.group, napkin.mesh);

  // 0-2 right arm, 3-5 left arm, 6 fork, 7 knife, 8-13 legs.
  const L = S.limbs(14, { seed, sides: 6, taper: 0.74, cast: false });
  [0, 1, 3, 4].forEach((i) => L.tone(i, coat));
  [2, 5].forEach((i) => L.tone(i, 0xd9cfba));
  [6, 7].forEach((i) => L.tone(i, 0xc4c6c0));
  [8, 9, 11, 12].forEach((i) => L.tone(i, 0x25272a));
  [10, 13].forEach((i) => L.tone(i, INK));
  // Bugs: 0-4 on the dish (two still walking), 5 on the fork, 6-11 the flies. Unlit, so the tails glow.
  const bugMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const bugs = new THREE.InstancedMesh(bugGeometry(), bugMat, 12);
  bugs.frustumCulled = false;
  for (let i = 0; i < 12; i++) bugs.setColorAt(i, _col.set(i < 6 ? 0xffffff : 0x35453a)); // the flies: the same green, gone dull
  g.add(table, linen.mesh, L.mesh, bugs);

  const rig = { root: body, chest: torso, head: hd, cloths: [napkin, linen], seed, rate: 0.2, depth: 0.7 };
  const mouthLocal = hd.at(0, hd.plan.mouth.lat, 0.25);
  const dummy = new THREE.Object3D();
  const mat = new THREE.Matrix4(); const sh = [V(), V()]; const hand = [V(), V()]; const elbow = V(); const knee = V();
  const tip = V(); const fdir = V(); const mouth = V(); const bend = V(); const toe = V(0, -0.1, -1).normalize();
  const hip = V(); const ankle = V();
  const r = { g, talk: 0, key: null, yaw: 0, flick: 0, lean: 0, clock: frac(seed * 0.3) * EAT, bites: 0, lastK: 0 };

  function bug(i, x, y, z, yaw, scale, roll = 0) {
    dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, roll); dummy.scale.setScalar(scale);
    dummy.updateMatrix(); bugs.setMatrixAt(i, dummy.matrix);
  }

  r.update = (dt, time, eye, view) => {
    r.talk = Math.max(0, r.talk - dt);
    const talking = view.speaking || r.talk > 0;
    if (!talking) r.clock += dt;
    const k = frac(r.clock / EAT);
    if (k < r.lastK) r.bites += 1;
    r.lastK = k;
    // A mouthful: down to the dish, up to the mouth, a bite, a chew far too quick, and then
    // nothing at all for a moment, not even breath.
    const down = smooth(k / 0.2) * (1 - smooth((k - 0.22) / 0.2));
    const up = smooth((k - 0.24) / 0.2) * (1 - smooth((k - 0.5) / 0.1));
    const chew = k > 0.48 && k < 0.8 && !talking ? 1 : 0;
    const frozen = k >= 0.8 && !talking;
    const dab = r.bites % 3 === 2 && !talking ? smooth((k - 0.8) / 0.06) * (1 - smooth((k - 0.93) / 0.06)) : 0;
    r.flick = Math.max(0, r.flick - dt / 0.9);
    r.lean = approach(r.lean, r.key === 'warm' && talking ? 1 : 0, dt, 2);

    // He turns to whoever he is talking to; otherwise the head stays with the dish and only the eyes come.
    const dx = eye.x - g.position.x; const dz = eye.z - g.position.z;
    const c = Math.cos(g.rotation.y); const s = Math.sin(g.rotation.y);
    const th = Math.atan2(-(dx * c - dz * s), -(dx * s + dz * c));
    r.yaw = approach(r.yaw, clamp(th, -1.35, 1.35) * (talking ? 1 : 0.22), dt, talking ? 5 : 2);
    hd.group.rotation.y = r.yaw;
    pose.rotation.set(-0.07 * down - 0.05 * up - 0.1 * r.lean, 0.25 * r.yaw * r.lean, 0);
    S.breathe(rig, time, { amount: frozen ? 0 : 1, look: eye, sway: 0.5 });
    hd.group.rotation.x += talking ? 0.2 : -0.1 * up;
    let jaw = 0;
    if (talking) jaw = Math.sin(time * 2.3) + Math.sin(time * 3.7) > -0.7 ? 0.18 + 0.3 * Math.abs(Math.sin(time * 9.5)) : 0.05;
    else if (chew) jaw = 0.16 + 0.14 * Math.sin(time * TAU * 9);
    else jaw = 0.75 * smooth((k - 0.36) / 0.08) * (1 - smooth((k - 0.46) / 0.04));
    hd.pose({ jaw, brow: talking ? 0.5 : 0 });

    g.updateMatrixWorld(true);
    pose.updateMatrix(); body.updateMatrix();
    mat.multiplyMatrices(pose.matrix, body.matrix);
    g.worldToLocal(hd.group.localToWorld(mouth.copy(mouthLocal)));

    // The fork: its tip goes dish to mouth; the hand follows a fork's length behind.
    tip.set(0.16, 1.04, -0.9).lerp(_a.set(DISH.x + 0.05, DISH.y + 0.015, DISH.z + 0.04), down).lerp(_a.copy(mouth).add(_b.set(0.01, -0.01, -0.03)), up);
    fdir.set(0.1, -0.75, -0.6).lerp(_a.set(-0.25, 0.25, 0.9), up).normalize();
    for (let i = 0; i < 2; i++) sh[i].copy(R_SH[i]).applyMatrix4(mat);
    hand[0].copy(tip).addScaledVector(fdir, -0.2);
    // The other hand: a fist on the cloth with the knife upright in it; up to dab; up to flick salt away.
    hand[1].set(-0.3, 0.93, -0.84).lerp(_a.copy(mouth).add(_b.set(-0.06, -0.02, -0.07)), dab);
    hand[1].lerp(_a.set(-0.16, 1.5, -0.34).applyMatrix4(mat), Math.sin(Math.PI * clamp(r.flick)));
    for (let i = 0; i < 2; i++) {
      bend.set(i ? -0.4 : 0.4, -0.6, 0.6);
      placeArm(L, i * 3, sh[i], hand[i], R_ARM[0], R_ARM[1], bend, 0.05, elbow);
    }
    L.place(6, hand[0], _a.copy(hand[0]).addScaledVector(fdir, 0.21), 0.011);
    L.place(7, hand[1], _a.copy(hand[1]).add(_b.set(0.01 - 0.1 * dab, 0.25, -0.02 - 0.1 * dab)), 0.012);
    for (let i = 0; i < 2; i++) {
      const sx = i ? -1 : 1;
      hip.set(sx * 0.11, 0.7, 0.0).applyMatrix4(mat); ankle.set(sx * 0.14, 0.07, -0.58);
      bend.set(0, 1, -0.6);
      placeLeg(L, 8 + i * 3, hip, ankle, 0.52, 0.56, bend, 0.07, toe, knee);
    }
    L.commit();

    // What is on the dish, what is on the fork, and the flies.
    const t = time;
    bug(0, DISH.x + 0.1 * Math.cos(t * 0.5), DISH.y, DISH.z + 0.1 * Math.sin(t * 0.5), -t * 0.5, 1);
    const t2 = Math.floor(t * 0.7) + smooth(frac(t * 0.7) * 2); // this one goes in starts
    bug(1, DISH.x + 0.05 * Math.cos(-t2 * 1.3 + 2), DISH.y - 0.008, DISH.z + 0.05 * Math.sin(-t2 * 1.3 + 2), t2 * 1.3 + 1, 0.85);
    bug(2, DISH.x - 0.07, DISH.y - 0.004, DISH.z - 0.09, 0.7, 1, Math.PI);
    bug(3, DISH.x + 0.12, DISH.y + 0.006, DISH.z - 0.07, 2.4, 0.9, Math.PI + 0.3 * Math.sin(t * 13));
    bug(4, DISH.x - 0.02, DISH.y - 0.01, DISH.z + 0.02, 4, 1.1);
    const held = k > 0.2 && k < 0.47 && !talking ? 1 : 0;
    bug(5, tip.x, tip.y + 0.004, tip.z, 1 + 14 * t * held, held);
    for (let i = 6; i < 12; i++) {
      const w = 2.2 + 0.7 * i; const a = t * w + i * 2.1; const rad = 0.14 + 0.05 * (i % 3) + 0.05 * Math.sin(t * 1.9 + i);
      bug(i, DISH.x + Math.cos(a) * rad, DISH.y + 0.13 + 0.07 * Math.sin(t * 3.1 + i * 1.7), DISH.z + Math.sin(a) * rad * 0.8, -a, 0.45);
    }
    bugs.instanceMatrix.needsUpdate = true;
  };
  /** A line starts. He stops eating to say it. */
  r.say = (key, seconds) => {
    r.key = key; r.talk = seconds;
    if (key === 'salt') r.flick = 1;
  };
  /** Does a shot from `from` to `to` pass him? Writes the nearest point into `out`. */
  r.grazed = (from, to, out) => {
    _a.set(to.x - from.x, to.y - from.y, to.z - from.z);
    _b.set(g.position.x - from.x, 1.25 - from.y, g.position.z - from.z);
    const tt = clamp(_b.dot(_a) / (_a.lengthSq() || 1));
    out.set(from.x, from.y, from.z).addScaledVector(_a, tt);
    return out.distanceTo(_c.set(g.position.x, 1.25, g.position.z)) < 0.75;
  };
  r.reset = () => { Object.assign(r, { talk: 0, key: null, yaw: 0, flick: 0, lean: 0 }); };
  r.dispose = () => { bugMat.dispose(); disposeTree(g); };
  return r;
}

// ---- the plot gardeners (R11) ------------------------------------------------------------------------
// The shipped Card Gardener, crouched at a vegetable plot: brush dropped, shaking, its face
// behind both hands with one eye showing. Friendly: the rules never let anything harm it. It
// ducks when a shot comes near (e.duck) and lowers its hands a little to speak.

const PLOTTERS = [
  { suit: 'heart', seed: 63, defects: ['eyesWide'], ink: SCARLET, shoe: INK, eye: 0x6b7a4a, pips: [[0, -0.36, 0.28, 0], [0, -0.94, 0.28, 1]] },
  { suit: 'heart', seed: 78, defects: ['pupilsPin'], ink: SCARLET, shoe: INK, eye: 0x4f6f8c, pips: [[0, -0.3, 0.2, 0], [0, -0.65, 0.2, 0], [0, -1.0, 0.2, 1]] },
  { suit: 'heart', seed: 91, defects: ['blinkUneven'], ink: SCARLET, shoe: INK, eye: 0x7a5a3a, pips: [[-0.22, -0.32, 0.19, 0], [0.22, -0.32, 0.19, 0], [-0.22, -0.98, 0.19, 1], [0.22, -0.98, 0.19, 1]] },
];
const NEAR = 45; // metres past which a friendly figure is not drawn or posed: the wood's sightlines are short
/** A friend is drawn only from inside its own zone, and only near. */
const inZone = (s, eye) => stageAt(eye.x, eye.z) === stageAt(s.x, s.z) && Math.hypot(eye.x - s.x, eye.z - s.z) < NEAR;

function buildPlotGardener(e, cfg, ctx) {
  const spec = PLOTTERS[nearestIndex(MAZE.plots || [e], e.x, e.z) % PLOTTERS.length];
  const seed = spec.seed;
  const M = S.materials();
  const g = new THREE.Group(); const pose = new THREE.Group(); const body = new THREE.Group();
  g.add(pose); pose.add(body);

  const attach = [cardBack()];
  for (const [x, y, size, flip] of spec.pips) {
    const p = S.pip(spec.suit, size);
    if (flip) p.rotateZ(Math.PI);
    attach.push(p.translate(x, y, 0));
  }
  attach.push(S.pip(spec.suit, 0.085).translate(-0.37, -0.12, 0), S.pip(spec.suit, 0.085).rotateZ(Math.PI).translate(0.37, -CARD_L + 0.12, 0));
  const EARTH = new THREE.Color(0x4a382a);
  const card = S.cloth({
    width: CARD_W, length: CARD_L, cols: 8, rows: 11, budget: 200, color: ROSE, folds: 1, foldDepth: 0.03, tatter: 0.22, dirt: 0.25,
    stiff: 0.8, seed, attach, cast: false,
    pattern: (u, vv, c) => {
      c.lerp(FOXED, 0.7 * (1 - smooth(Math.min(u, 1 - u, vv, 1 - vv) / 0.14)));
      if (vv > 0.72) c.lerp(EARTH, 0.6 * smooth((vv - 0.72) / 0.25) * (0.5 + 0.5 * S.noise(u * 9, vv * 5, 0, seed))); // it has knelt in the bed
    },
  });
  card.mesh.position.set(0, CARD_TOP, 0);
  const size = 0.33;
  const hd = S.head({
    size, seed, defects: spec.defects, budget: 1500, extras: gardenerHat(spec, size), cast: false,
    face: { skin: 0xf1e2cd, eye: spec.eye, cheek: { rosy: 0.25 }, skull: { wide: 1.05, tall: 1.0, taper: 0.16, chin: 0.03 }, nose: { size: 0.1 }, ears: { size: 0.85 }, brow: { thick: 0.028, tilt: -1.2 }, mouth: { smile: -0.5, width: 0.3 } },
  });
  hd.group.position.set(0, CARD_TOP + 0.02, 0);
  body.add(card.mesh, hd.group);
  const L = S.limbs(12, { seed, sides: 5, taper: 0.7, cast: false });
  [0, 1, 3, 4, 6, 7, 9, 10].forEach((i) => L.tone(i, spec.ink));
  [2, 5].forEach((i) => L.tone(i, 0xe9e2cf));
  [8, 11].forEach((i) => L.tone(i, spec.shoe));
  // The brush, dropped where it stood.
  const brush = new THREE.Mesh(brushGeometry(seed), M.skin);
  aim(brush, _a.set(0.55, 0.035, -0.75), _b.set(0.5, 0, 0.86), _c.set(0, 1, 0));
  g.add(L.mesh, brush);

  const rig = { root: body, head: hd, cloths: [card], seed, rate: 0.5, depth: 1.4 }; // it breathes fast
  const mat = new THREE.Matrix4();
  const sh = [V(), V()]; const hip = [V(), V()]; const hand = [V(), V()]; const foot = [V(), V()];
  const elbow = V(); const knee = V(); const toe = V(); const bendA = V(); const bendL = V();
  const look = V(e.x, 1.6, e.z);
  const v = {
    g, kind: 'plotGardener', type: 'plotGardener', seed, head: hd, yaw: 0, duck: 0, talk: 0, jaw: 0, dead: false, gone: false,
  };

  // o: duck (0..1), talk (0..1), time
  function crouch(time, o) {
    const low = 0.52 + 0.1 * o.duck;
    // It shakes: a fine tremor all the time, worse when something goes off near it.
    const tremor = (0.004 + 0.008 * o.duck) * (Math.sin(time * 31 + seed) + 0.6 * Math.sin(time * 47 + seed * 2));
    pose.position.set(tremor, -low, 0.05);
    pose.rotation.set(-0.4 - 0.16 * o.duck + 0.1 * o.talk, 0, 0.6 * tremor);
    hd.group.rotation.y = v.yaw;
    S.breathe(rig, time, { amount: 1, look, sway: 2.5, wind: 6 * tremor });
    hd.group.rotation.x += -0.2 - 0.4 * o.duck + 0.18 * o.talk; // chin down, behind its hands
    hd.pose({ brow: 0.9, frown: -0.7, jaw: v.jaw });
    pose.updateMatrix(); body.updateMatrix(); hd.group.updateMatrix();
    mat.multiplyMatrices(pose.matrix, body.matrix);
    _m.multiplyMatrices(mat, hd.group.matrix); // the head's frame, for hands that go where the face goes

    // Both hands over the face; its own right eye is left showing. Ducked, they go over the hat.
    const drop = 0.13 * o.talk;
    hand[0].set(0.1, 0.58 * size - drop, -1.02 * size).lerp(_a.set(0.2, 1.7 * size, -0.45 * size), o.duck).applyMatrix4(_m);
    hand[1].set(-0.125, 1.06 * size - drop, -1.0 * size).lerp(_a.set(-0.2, 1.72 * size, -0.4 * size), o.duck).applyMatrix4(_m);
    _b.set(0, 1, 0).transformDirection(_m); // up the face
    for (let i = 0; i < 2; i++) {
      sh[i].copy(C_SH[i]).applyMatrix4(mat);
      bendA.set(i ? -0.9 : 0.9, -0.5, 0.15).transformDirection(mat);
      placeArm(L, i * 3, sh[i], _c.copy(hand[i]).addScaledVector(_b, -0.08), C_ARM[0], C_ARM[1], bendA, 0.046, elbow);
      // The hand itself: held flat and broad against the face.
      L.place(i * 3 + 2, _d.copy(hand[i]).addScaledVector(_b, -0.1), _e.copy(hand[i]).addScaledVector(_b, 0.1), 0.1);
    }
    // Knees up under the card, feet together.
    toe.set(0, -0.1, -1).normalize();
    bendL.set(0, 0.5, -1);
    for (let i = 0; i < 2; i++) {
      hip[i].copy(C_HIP[i]).applyMatrix4(mat);
      foot[i].set(C_HIP[i].x * 0.9, 0.045, -0.3);
      placeLeg(L, 6 + i * 3, hip[i], foot[i], C_LEG[0], C_LEG[1], bendL, 0.05, toe, knee);
    }
    L.commit();
  }

  v.sync = (en, dt, time, eye) => {
    const s = friendView(en, ctx.sim);
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = s.facing;
    g.visible = inZone(s, eye);
    if (!g.visible) return;
    look.copy(eye);
    v.duck = approach(v.duck, s.duck ? 1 : 0, dt, s.duck ? 22 : 3);
    v.talk = approach(v.talk, s.speaking ? 1 : 0, dt, 6);
    v.jaw = approach(v.jaw, s.speaking ? 0.15 + 0.35 * Math.abs(Math.sin(time * 9.1)) * (Math.sin(time * 3.3) > -0.5 ? 1 : 0.2) : 0, dt, 20);
    // The head comes round to the warden, but never far: it does not want to look.
    const dx = eye.x - s.x; const dz = eye.z - s.z;
    const c = Math.cos(s.facing); const sn = Math.sin(s.facing);
    const th = Math.atan2(-(dx * c - dz * sn), -(dx * sn + dz * c));
    v.yaw = approach(v.yaw, clamp(th, -0.7, 0.7) * (1 - v.duck), dt, 3);
    crouch(time, { duck: v.duck, talk: v.talk });
  };
  v.onEvent = () => {};
  v.restore = () => { v.duck = 0; v.talk = 0; v.jaw = 0; v.yaw = 0; };
  v.die = () => { v.dead = true; }; // the rules never ask; a friendly figure cannot be harmed
  v.updateDeath = () => true;
  v.dispose = () => { ctx.cast.delete(v); disposeTree(g); };
  ctx.cast.add(v);
  crouch(0, { duck: 0, talk: 0 });
  return v;
}

// ---- the dying hunter (R20) --------------------------------------------------------------------------
// He sits on the ground at the origin of his own group facing -Z, his back to the tree behind
// him: slumped, a lantern-maker's hat over his brow (the lamp on its bracket long out), an
// empty bolt belt across his chest, one hand lying open. Two small wounds at the neck. He does
// not move; he lifts his head a little to speak. Friendly: nothing can harm him.

const H_OIL = 0x4a4338; const H_LEATHER = 0x3a2a1e; const H_SKIN = 0xcabba6; const H_BRASS = 0x8a7436;

function hunterHat(size, seed) {
  const cy = 0.8 * 1.04 * size; const y0 = cy + 0.3 * size; const FELT = 0x2b2620;
  const parts = [
    // A soft crown, sunk on one side, and a brim wide enough to keep sparks off the neck.
    S.skin([{ at: [0, y0, 0.01], r: size * 1.0, color: H_LEATHER }, { at: [0, y0 + 0.04, 0.01], r: size * 0.98, color: H_LEATHER }, { at: [0.01, y0 + 0.06, 0.01], r: size * 0.96 }, { at: [0.03, y0 + 0.15, 0.02], r: size * 0.84 }, { at: [0.05, y0 + 0.2, 0.03], r: size * 0.5 }],
      { seed, sides: 11, detail: 2, budget: 300, caps: ['open', 'round'], capLen: 0.25, color: FELT, color2: 0x3b342c, noise: 0.07, rough: 0.03, mottle: 0.25 }),
    S.tint(new THREE.TorusGeometry(size * 1.16, size * 0.17, 4, 16).rotateX(Math.PI / 2).scale(1, 0.22, 1.06).translate(0, y0 + 0.005, 0), FELT, 0.3, seed),
    // The lamp bracket on the front of the band: a brass hook, a small cold lantern, a stub of wax.
    S.tint(new THREE.BoxGeometry(0.035, 0.07, 0.012).translate(0, y0 + 0.07, -size * 0.99), H_BRASS, 0.25, 1),
    S.tint(new THREE.CylinderGeometry(0.03, 0.036, 0.06, 6).translate(0, y0 + 0.085, -size * 1.07), H_BRASS, 0.3, 2),
    S.tint(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 6).translate(0, y0 + 0.088, -size * 1.07), 0x1a1612, 0.2, 3),
    S.tint(new THREE.ConeGeometry(0.034, 0.03, 6).translate(0, y0 + 0.13, -size * 1.07), H_BRASS, 0.3, 4),
    S.tint(new THREE.CylinderGeometry(0.008, 0.01, 0.022, 5).translate(0, y0 + 0.066, -size * 1.07), 0xd8cfae, 0.1, 5),
  ];
  // Pulled down over the brow.
  return parts.map((p) => p.translate(0, -cy, 0).rotateX(-0.1).translate(0, cy - 0.02, -0.01));
}

function hunterTorso(seed) {
  const SHIRT = new THREE.Color(0x7d766a); const WETR = new THREE.Color(WET);
  const parts = [S.skin([
    { at: [0, 0.1, 0.02], r: [0.21, 0.18], color: 0x2c2823 }, { at: [0, 0.3, 0.07], r: [0.22, 0.18] }, { at: [0.015, 0.52, 0.15], r: [0.235, 0.175] },
    { at: [0.03, 0.72, 0.22], r: [0.22, 0.15] }, { at: [0.04, 0.84, 0.24], r: [0.13, 0.11] }, { at: [0.045, 0.9, 0.235], r: 0.07, color: H_SKIN },
  ], {
    seed, sides: 12, detail: 3, budget: 700, color: H_OIL, color2: 0x39342b, noise: 0.05, mottle: 0.18, side: [1, 0, 0],
    colorAt: (u, a, c) => {
      const f = wrap(a);
      if (u > 0.2 && u < 0.86 && Math.abs(f) < 0.26) c.copy(SHIRT).multiplyScalar(0.8 + 0.2 * S.noise(u * 8, f * 4, 0, seed)); // the coat hangs open
      // What ran down from his neck, on his own left.
      const run = S.noise(f * 6 + 2, u * 5, 0, seed + 4);
      if (u > 0.3 && f < 0.3 && f > -1.1) c.lerp(WETR, clamp((u - 0.35) * 2.2 + 0.5 * run - Math.abs(f + 0.4) * 0.9) * 0.85);
    },
  })];
  // The bolt belt, shoulder to hip, and its loops: every one empty.
  const A = V(0.225, 0.34, 0.07); const B = V(0, 0.0, -0.19); const C = V(0.015, 0.5, 0.13);
  const loop = (th, out) => out.copy(C).addScaledVector(A, Math.cos(th)).addScaledVector(B, Math.sin(th) * (Math.sin(th) > 0 ? 1 : 0.85));
  const rings = [];
  for (let i = 0; i <= 12; i++) rings.push({ at: loop((i / 12) * TAU, V()), r: [0.045, 0.013] });
  parts.push(S.skin(rings, { sides: 6, detail: 1, caps: 'open', color: H_LEATHER, noise: 0.03, seed, side: [-0.84, 0.54, 0], shade: 0.1 }));
  for (let k = 0; k < 6; k++) {
    const at = loop(0.75 + k * 0.33, V());
    parts.push(S.tint(new THREE.TorusGeometry(0.017, 0.006, 4, 7).rotateX(Math.PI / 2).rotateZ(0.55).translate(at.x, at.y, at.z - 0.022), 0x241a12, 0.2, k));
  }
  return S.merge(parts);
}

function buildHunter(e, cfg, ctx) {
  const seed = 83;
  const M = S.materials();
  const g = new THREE.Group();
  const torso = new THREE.Mesh(hunterTorso(seed), M.skin);
  const size = 0.27;
  const plan = S.face({
    seed, skin: H_SKIN, eye: 0x7d8a8c, hair: 0x4d463c, defects: ['eyesOld'],
    skull: { wide: 0.97, tall: 1.04, taper: 0.4, cheek: -0.03, chin: 0.08, brow: 0.05 },
    nose: { kind: 'long', size: 0.09, length: 0.24 }, mouth: { width: 0.34, smile: -0.25, lip: 0x8a6a66, rest: 0.12 },
    cheek: { rosy: 0.08 }, ears: { size: 0.9 }, brow: { color: 0x4d463c, thick: 0.03 },
  });
  const at = S.head({ size, face: plan, budget: 300, cast: false }).at;
  // Two small wounds low on the neck's left side, and what has run from them.
  const wet = [];
  for (const k of [0, 1]) {
    const p = V(-0.058 + 0.004 * k, 0.012 - 0.03 * k, -0.035 - 0.012 * k);
    wet.push(S.tint(new THREE.SphereGeometry(0.009, 5, 4).translate(p.x, p.y, p.z), 0x2a0608));
    wet.push(S.skin([{ at: p, r: 0.006 }, { at: [p.x - 0.006, p.y - 0.05, p.z - 0.004], r: 0.005 }, { at: [p.x - 0.004, p.y - 0.1, p.z - 0.012], r: 0.003 }], { sides: 4, detail: 1, noise: 0, color: WET, shade: 0, caps: 'flat' }));
  }
  const hd = S.head({ size, face: plan, budget: 1700, extras: hunterHat(size, seed), wet, cast: false });
  hd.group.updateWorldMatrix(true, true);
  S.scar(hd.skull, at(-0.75, -0.2), 0.4 * size, { hex: 0x8d94a0, strength: 0.4, dent: 0 }); // gone grey under the cheek
  S.scar(hd.skull, at(0.75, -0.2), 0.4 * size, { hex: 0x8d94a0, strength: 0.4, dent: 0 });
  const neck = new THREE.Group();
  neck.position.set(0.045, 0.9, 0.235);
  neck.add(hd.group);
  g.add(torso, neck);

  // 0-2 right arm, 3-5 left arm, 6-11 legs, 12-16 the open hand's fingers and thumb.
  const L = S.limbs(17, { seed, sides: 6, taper: 0.74, cast: false });
  [0, 1, 3, 4].forEach((i) => L.tone(i, H_OIL));
  [2, 5, 12, 13, 14, 15, 16].forEach((i) => L.tone(i, H_SKIN));
  [6, 7, 9, 10].forEach((i) => L.tone(i, 0x2c2823));
  [8, 11].forEach((i) => L.tone(i, H_LEATHER));
  g.add(L.mesh);

  const rig = { chest: torso, head: hd, seed, rate: 0.19, depth: 0.6 };
  const sh = V(); const hand = V(); const elbow = V(); const knee = V(); const hip = V(); const ankle = V(); const toe = V(); const bend = V();
  const look = V(e.x, 1.6, e.z);
  const v = { g, kind: 'hunter', type: 'hunter', seed, head: hd, talk: 0, jaw: 0, yaw: 0, dead: false, gone: false };

  function slump(time, o) {
    // Breath: shallow, and now and then one that does not come.
    const held = Math.sin(time * 0.23 + 1) > 0.82 ? 0.15 : 1;
    neck.rotation.set(-0.3 + 0.24 * o.talk, 0.18 * (1 - o.talk) + v.yaw * o.talk, 0.26 * (1 - 0.6 * o.talk));
    S.breathe(rig, time, { amount: held, look: o.talk > 0.3 ? look : null, blink: false });
    hd.pose({ blink: 0.62 - 0.4 * o.talk, jaw: v.jaw, brow: -0.2, frown: -0.5, ...(o.talk > 0.3 ? {} : { look: [0.1, -0.35] }) });
    // His right hand is pressed under his ribs; the left lies open on the ground beside him.
    sh.set(0.25, 0.76, 0.2); hand.set(0.07, 0.36, -0.13);
    placeArm(L, 0, sh, hand, 0.34, 0.32, bend.set(0.9, -0.5, 0.1), 0.06, elbow);
    sh.set(-0.2, 0.76, 0.22); hand.set(-0.45, 0.045, -0.12);
    placeArm(L, 3, sh, hand, 0.34, 0.32, bend.set(-0.8, 0.1, 0.6), 0.06, elbow);
    for (let i = 0; i < 4; i++) {
      // Fingers, lying a little curled, palm up.
      _a.set(hand.x - 0.02 - 0.012 * i, 0.04, hand.z - 0.05 + 0.03 * i);
      _b.set(_a.x - 0.075 + 0.01 * i, 0.05 + 0.02 * Math.sin(i * 1.3) + 0.004 * Math.sin(time * 0.7 + i), _a.z - 0.06 + 0.012 * i);
      L.place(12 + i, _a, _b, 0.016);
    }
    L.place(16, _a.set(hand.x + 0.01, 0.045, hand.z - 0.06), _b.set(hand.x + 0.03, 0.06, hand.z - 0.13), 0.018);
    for (let i = 0; i < 2; i++) {
      const sx = i ? -1 : 1;
      hip.set(sx * 0.12, 0.13, -0.08); ankle.set(sx * (0.2 + 0.08 * i), 0.07, -0.98 + 0.12 * i);
      toe.set(sx * 0.45, 0.75, -0.5).normalize(); // boots fallen outward
      placeLeg(L, 6 + i * 3, hip, ankle, 0.47, 0.47, bend.set(sx * 0.3, 1, -0.2), 0.085, toe, knee);
    }
    L.commit();
  }

  v.sync = (en, dt, time, eye) => {
    const s = friendView(en, ctx.sim);
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = s.facing;
    g.visible = inZone(s, eye);
    if (!g.visible) return;
    look.copy(eye);
    v.talk = approach(v.talk, s.speaking ? 1 : 0, dt, 2.5);
    v.jaw = approach(v.jaw, s.speaking ? 0.1 + 0.3 * Math.abs(Math.sin(time * 6.3)) * (Math.sin(time * 2.1) > -0.3 ? 1 : 0.15) : 0, dt, 14);
    const dx = eye.x - s.x; const dz = eye.z - s.z;
    const c = Math.cos(s.facing); const sn = Math.sin(s.facing);
    v.yaw = approach(v.yaw, clamp(Math.atan2(-(dx * c - dz * sn), -(dx * sn + dz * c)), -0.6, 0.6), dt, 2);
    slump(time, { talk: v.talk });
  };
  v.onEvent = () => {};
  v.restore = () => { v.talk = 0; v.jaw = 0; v.yaw = 0; };
  v.die = () => { v.dead = true; }; // the rules never ask
  v.updateDeath = () => true;
  v.dispose = () => { ctx.cast.delete(v); disposeTree(g); };
  ctx.cast.add(v);
  slump(0, { talk: 0 });
  return v;
}

// ---- registration -----------------------------------------------------------------------------------

/** Registers the court's figure factories and Renfield's layer with the actors module. */
export function registerCast(actors, scene) {
  const ctx = { cast: new Set(), court: null, sim: null, grains: createGrains(scene), eye: V() };
  let renfield = null;

  actors.register('guard', (e, cfg) => buildGuard(e, cfg, ctx));
  actors.register('gardener', (e, cfg) => buildGardener(e, cfg, ctx));
  actors.register('plotGardener', (e, cfg) => buildPlotGardener(e, cfg, ctx));
  actors.register('hunter', (e, cfg) => buildHunter(e, cfg, ctx));

  // The fallen (R18). After a death every view is cleared, so the bodies of beaten gate
  // creatures are laid again from sim.waves.bodies: on every `restored`, and whenever the
  // rules hold a body that nothing is drawing (a run begun past a gate).
  const laid = []; // { g, id, type, dispose }
  const fallen = [];
  let relay = false;
  function dropLaid() {
    for (const b of laid) b.dispose();
    laid.length = 0;
  }
  function layBodies(sim, eye) {
    if (relay) { dropLaid(); relay = false; }
    const bodies = gateBodies(sim, fallen);
    if (!bodies.length && !laid.length) return;
    for (let i = laid.length - 1; i >= 0; i--) {
      if (!bodies.some((b) => b.enemy === laid[i].type)) { laid[i].dispose(); laid.splice(i, 1); } // by kind: a body laid at home has no id
    }
    for (const b of bodies) {
      if (laid.some((l) => l.type === b.enemy)) continue;
      const body = layBody(b, sim); // null while the creature's own view still lies where it died
      if (body) laid.push(body);
    }
    for (const b of laid) b.g.visible = Math.hypot(eye.x - b.g.position.x, eye.z - b.g.position.z) < FAR;
  }

  function nudge(ev) {
    if (ev.puzzle !== 'roses') return;
    const all = [...ctx.cast].filter((v) => v.kind === 'gardener' && !v.gone);
    const standing = all.filter((v) => !v.dead && v.still);
    const pool = standing.length ? standing : all.filter((v) => v.dead);
    let best = null; let bd = Infinity;
    for (const v of pool) {
      const d = Math.hypot(v.g.position.x - ctx.eye.x, v.g.position.z - ctx.eye.z);
      if (d < bd) { bd = d; best = v; }
    }
    if (best) best.point(ev.x, ev.z);
  }

  function shot(ev) {
    if (!renfield || !renfield.g.visible || !ev.from) return;
    const ends = ev.pellets && ev.pellets.length ? ev.pellets.map((p) => p.to) : [ev.to];
    let n = 0;
    for (const to of ends) {
      if (to && renfield.grazed(ev.from, to, _d)) { n += 1; _e.copy(_d); }
    }
    if (!n) return;
    const dx = ev.from.x - _e.x; const dz = ev.from.z - _e.z; const len = Math.hypot(dx, dz) || 1;
    ctx.grains.burst(_e.x, _e.y, _e.z, dx / len, dz / len, 5 + 3 * n, 2.4);
  }

  actors.addLayer({
    onEvent(ev) {
      switch (ev.type) {
        // No figure wakes on `wake` any more: each wakes alone, on its own wakeOne (its view's onEvent).
        case 'restored':
          for (const v of [...ctx.cast]) v.restore();
          if (renfield) renfield.reset();
          ctx.grains.clear();
          relay = true; // the fallen are laid again from sim.waves.bodies on the next frame
          break;
        case 'nudge': nudge(ev); break;
        case 'speak': if (renfield && ev.who === 'renfield') renfield.say(ev.key, ctx.court ? ctx.court.lineTime : 4); break;
        case 'shot': shot(ev); break;
        default:
      }
    },
    clear() {
      ctx.grains.clear();
      ctx.court = null;
      ctx.sim = null;
      dropLaid();
      if (renfield) { renfield.g.visible = false; renfield.reset(); }
    },
    sync(sim, dt, time, eye) {
      const court = courtView(sim);
      ctx.court = court;
      ctx.sim = sim;
      ctx.eye.copy(eye);
      ctx.grains.step(dt);
      layBodies(sim, eye);
      const show = court.here && court.stage <= 1;
      if (show && !renfield) { renfield = buildRenfield(ctx); scene.add(renfield.g); }
      if (!renfield) return;
      renfield.g.visible = show && Math.hypot(eye.x - renfield.g.position.x, eye.z - renfield.g.position.z) < FAR;
      if (renfield.g.visible) renfield.update(dt, time, eye, renfieldView(sim));
    },
  });
}
