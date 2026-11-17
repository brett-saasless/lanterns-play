// The wood's gate creatures and its engine-only dressing: the White Rabbit (the Undertaker), the
// Hatter-at-Arms, the Cheshire Bat, the Smoke Caterpillar, hat-pins (thrown and stuck), the rats
// and the grin. Built with sculpt.js; driven by actors.js the way fauna.js is for the cave.
//
// Every sim field is read through ONE adapter per creature (just below), so a renamed field in
// hybrids.js or enemy.js is a one-line change here. Posing leans on the design's events
// (strikeTell, strike, pinThrow, solid, doused, eats, hit) and on where the enemy actually is;
// state names are only hints.

import * as THREE from 'three';
import * as S from './sculpt.js';
import { MAZE } from '../logic/courtmap.js';

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const smooth = (k) => { const c = clamp(k); return c * c * (3 - 2 * c); };
const lerp = (a, b, k) => a + (b - a) * k;
const approach = (cur, goal, dt, rate) => cur + (goal - cur) * Math.min(1, dt * rate);
const frac = (x) => x - Math.floor(x);
const wrap = (a) => { let r = (a + Math.PI) % TAU; if (r < 0) r += TAU; return r - Math.PI; };
const turn = (cur, goal, dt, rate) => cur + wrap(goal - cur) * Math.min(1, dt * rate);
const headingTo = (dx, dz) => Math.atan2(-dx, -dz);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

// ---- adapters: the only place a sim field is read ---------------------------------------------

const stateOf = (e) => String(e.state || '');

function common(e, c) {
  const st = stateOf(e);
  return {
    x: num(e.x), y: num(e.y), z: num(e.z), facing: num(e.heading), speed: num(e.speedNow),
    hurt: c && c.hp > 1 ? clamp(1 - num(e.hp, c.hp) / c.hp) : 0,
    dead: !!e.dead,
    asleep: /^(asleep|still|sleep|wait)/.test(st), // the rules hold this in e.state only
  };
}

/** True while `who` has the one spoken line (journal.js speak -> sim.waves.line). */
function speaking(sim, who) {
  const line = sim && sim.waves && sim.waves.line;
  return !!line && line.who === who && line.left > 0;
}

/** The Rabbit: where his chair is, whether he is winding up, across the table, or eating. */
function rabbitView(e, sim, cfg) {
  const st = stateOf(e);
  return {
    ...common(e, cfg && cfg.rabbit),
    home: MAZE.rabbit.chair,
    tell: /tell|windup|coil/.test(st),
    lunging: /lunge|leap/.test(st),
    eating: e.eating > 0 || e.eating === true || /eat/.test(st),
    tut: e.tut > 0,
    warned: num(e.warned), // how many of his five warnings he has given (hybrids.js)
    speaking: speaking(sim, 'rabbit'),
  };
}

/** The Hatter: moving between cover, about to throw, kicking. */
function hatterView(e, sim, cfg) {
  const st = stateOf(e);
  return {
    ...common(e, cfg && cfg.hatter),
    drawing: /volley|throw|draw|aim|pin/.test(st),
    tell: /tell|windup/.test(st),
    kicking: st === 'strike', // his only strike is the kick (hybrids.js: tell -> strike 'kick')
  };
}

/** The Bat: solid is true or false when the rules say so on the enemy, null when only events do. */
function batView(e, sim, cfg) {
  const st = stateOf(e);
  const solid = e.solid ?? null; // hybrids.js setSolid() is the only writer
  return {
    ...common(e, cfg && cfg.bat),
    solid: solid == null ? null : !!solid,
    tell: /tell|windup/.test(st),
    swooping: /swoop|dive/.test(st),
  };
}

/** The Caterpillar: doused is true or false when the rules say so, null when only events do. */
function caterpillarView(e, sim, cfg) {
  const st = stateOf(e);
  let doused = e.doused ?? null;
  if (doused == null && /doused|soft|whip|bare/.test(st)) doused = true;
  return {
    ...common(e, cfg && cfg.caterpillar),
    doused: doused == null ? null : !!doused,
    tell: /tell|windup/.test(st),
    whipping: /whip|lash/.test(st),
    pipe: MAZE.caterpillar.pipe,
  };
}

/** Pins in flight: in this room every bolt is a hat-pin. */
function pinsInFlight(sim) {
  return sim && sim.cfg && sim.cfg.room === 'court' && Array.isArray(sim.bolts) ? sim.bolts : [];
}

/** Stuck pins as the rules hold them (already capped), or null if they are only told by event. */
function pinsStuck(sim) {
  const w = sim && sim.waves;
  const list = w && w.pins; // trail.js holds stuck pins in sim.waves.pins (A3)
  return Array.isArray(list) ? list : null;
}

/** True when this creature's gate is marked done, so its body stays through a restore. */
function gateDone(sim, type) {
  const gates = sim && sim.waves && sim.waves.done && sim.waves.done.gates;
  const order = (sim && sim.cfg && sim.cfg.gateCreatures) || ['rabbit', 'hatter', 'bat', 'caterpillar'];
  return !!(gates && gates[order.indexOf(type)]);
}

function playerOf(sim) {
  const p = sim && sim.player;
  return p ? { x: num(p.x), z: num(p.z) } : null;
}

// ---- shared small things ------------------------------------------------------------------------

const _a = V(); const _b = V(); const _c = V(); const _d = V(); const _e = V();
const _q = new THREE.Quaternion();
const _dummy = new THREE.Object3D();
_dummy.rotation.order = 'YXZ';
const _col = new THREE.Color();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

const part = (geo, mat, cast = false) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; return m; };
const hitSize = (ev) => clamp(0.03 + 0.007 * (ev.pellets || 1) + 0.0004 * (ev.damage || 0), 0.04, 0.11);

/** Pulls `hand` in to `max` from `sh` if it is further. */
function reachClamp(sh, hand, max) {
  _e.subVectors(hand, sh);
  const len = _e.length();
  if (len > max) hand.copy(sh).addScaledVector(_e, max / len);
  return hand;
}

/** A wind-up and a strike, timed from the strikeTell and strike events. */
function makeAct() { return { move: '', tellT: -1, tellDur: 0.4, strikeT: -1 }; }
function actEvent(a, ev, tellFor) {
  if (ev.type === 'strikeTell') { a.move = ev.move || a.move; a.tellT = 0; a.tellDur = tellFor(a.move); a.strikeT = -1; return true; }
  if (ev.type === 'strike') { a.move = ev.move || a.move; a.strikeT = 0; a.tellT = -1; return true; }
  return false;
}
function actStep(a, dt, strikeLen) {
  if (a.tellT >= 0) { a.tellT += dt; if (a.tellT > a.tellDur + 0.7) a.tellT = -1; }
  if (a.strikeT >= 0) { a.strikeT += dt; if (a.strikeT > strikeLen) a.strikeT = -1; }
}
const tellOf = (a) => (a.tellT >= 0 ? smooth(a.tellT / a.tellDur) : 0);

/** Distance from point p to the segment a-b. */
function segDist(p, a, b) {
  _d.subVectors(b, a);
  const t = clamp(_e.subVectors(p, a).dot(_d) / Math.max(1e-6, _d.lengthSq()));
  return _e.copy(a).addScaledVector(_d, t).distanceTo(p);
}

/** True when a shot event's line (any pellet) passes within r of the world point p. */
function shotPasses(ev, p, r) {
  if (!ev.from) return false;
  _a.set(ev.from.x, ev.from.y, ev.from.z);
  const lines = ev.pellets && ev.pellets.length ? ev.pellets : [ev];
  for (const l of lines) {
    if (!l.to) continue;
    if (segDist(p, _a, _b.set(l.to.x, l.to.y, l.to.z)) < r) return true;
  }
  return false;
}

/** A hat-pin: point at the origin, shaft back along +Z to a bead. */
function hatPin(len, bead, r = 0.0035, beadR = 0.013) {
  return S.merge([
    S.tint(new THREE.CylinderGeometry(r, r * 0.4, len, 4).rotateX(-Math.PI / 2).translate(0, 0, len / 2), 0xc4c8cc),
    S.tint(new THREE.IcosahedronGeometry(beadR, 0).translate(0, 0, len), bead),
  ]);
}
const BEADS = [0xf3eedf, 0x15131a, 0x8a1a22, 0xc9a227, 0xf3eedf];

/** Sets a pin (authored along +Z) at `at`, its bead pointing along `out`. */
function pinAt(geo, at, out) {
  _q.setFromUnitVectors(_a.set(0, 0, 1), _b.copy(out).normalize());
  return geo.applyQuaternion(_q).translate(at.x, at.y, at.z);
}

// Set by registerBeasts: builds one beaten gate creature's body, settled as it fell.
let bodyMaker = null;

/**
 * layBody(body, sim) -> { g, id, type, dispose() } | null. The body of a beaten gate creature,
 * built already fallen at the place sim.waves.bodies holds for it and added to the scene. For
 * cast.js, which redraws the fallen after a restore (R18). `body` is one entry of
 * sim.waves.bodies ({ id, enemy, x, z }). null when the entry is not a gate creature, or when
 * that creature's own view is still lying where it died (so nothing is ever drawn twice).
 */
export function layBody(body, sim) {
  return bodyMaker ? bodyMaker(body, sim) : null;
}

/** Registers the wood's creature factories and its dressing layer with the actors module. */
export function registerBeasts(actors, scene, opts = {}) {
  const M = S.materials();
  // Ashen copies of the kit's materials: a body keeps its detail when it dies, drained of colour.
  const ash = new Map();
  for (const m of [M.skin, M.cloth, M.gloss, M.metal]) {
    const d = m.clone();
    d.color.set(0x8f8b86);
    d.roughness = Math.max(m.roughness, 0.8);
    d.metalness = 0;
    ash.set(m, d);
  }
  const alive = new Set(); // every view of ours that actors.js still holds
  let lastSim = null;
  let reducedFlash = false;

  /** The live, flash and dead looks for a figure's meshes. */
  function looks(meshes) {
    const base = meshes.map((m) => m.material);
    let mode = 'live';
    return (next) => {
      if (next === mode) return;
      mode = next;
      meshes.forEach((m, i) => { m.material = next === 'flash' ? M.flash : next === 'dead' ? (ash.get(base[i]) || M.dead) : base[i]; });
    };
  }

  /** Remembers scarred meshes as built, and puts them back. */
  function keeper(meshes) {
    const saved = meshes.map((m) => ({ g: m.geometry, p: m.geometry.attributes.position.array.slice(), c: m.geometry.attributes.color.array.slice() }));
    return () => {
      for (const s of saved) {
        s.g.attributes.position.array.set(s.p); s.g.attributes.color.array.set(s.c);
        s.g.attributes.position.needsUpdate = true; s.g.attributes.color.needsUpdate = true;
      }
    };
  }

  // Geometry several views draw at once, and the materials every view borrows: never freed.
  const sharedGeo = new Set();
  const kitMats = new Set([...Object.values(M), ...ash.values()]);
  /** Frees everything under a view's group that the view built for itself: geometry, instance buffers, its own materials. */
  function freeTree(root) {
    root.traverse((m) => {
      if (!m.isMesh && !m.isSprite && !m.isPoints) return;
      if (m.geometry && !m.isSprite && !sharedGeo.has(m.geometry)) m.geometry.dispose();
      if (m.isInstancedMesh) m.dispose();
      if (m.material && !kitMats.has(m.material) && !ash.has(m.material)) m.material.dispose();
    });
  }

  function track(v, type) {
    v.type = type;
    v.gone = false;
    alive.add(v);
    const own = v.dispose;
    v.dispose = () => { alive.delete(v); if (own) own(); freeTree(v.g); };
    return v;
  }

  // ======================================================================================
  // The Undertaker: the White Rabbit, as the owner chose him (mockup variant B), seated at the
  // head of his tea table. Tall, thin and stooped in a long black frock coat with muddy skirts,
  // satin lapels, a grey waistcoat, a stained grey silk cravat and a ruby stickpin; a long
  // narrow skull, lank ears hanging like curtains, long clawed fingers clasped on the cloth
  // round a gold watch, blood at the mouth and down the front. Reads as a mourner at tea. What
  // is off: his eyes are two red pinpricks that give off their own light, and he never blinks.
  // With each warning the head comes lower and the eyes burn a little brighter.
  // Budget: at most 14,000 triangles and 12 draw calls, his two eye sprites included.
  // ======================================================================================
  const UT = { H: 1.07, HIP: 0.75, SIT: -0.1, STOOP: -0.36, UP: 0.4, FORE: 0.4, THIGH: 0.57, SHIN: 0.57, SIZE: 0.29, WARN: 5 };
  const FUR = 0xf3eedf; const FUR2 = 0xb4b1bd; const BLOOD = 0x7a0f14; const GOLD = 0xc9a227; const EMBER = 0xff2a1a;
  const FROCK = 0x15141a; const SATIN = 0x2a2830; const CRAVAT = 0x8a8880; const STAIN = 0x5a2a22;
  const BLOODC = new THREE.Color(BLOOD); const STAINC = new THREE.Color(STAIN);
  const seatFacing = (() => {
    const t = MAZE.rabbit.table; const c = MAZE.rabbit.chair;
    return headingTo((t.minX + t.maxX) / 2 - c.x, (t.minZ + t.maxZ) / 2 - c.z);
  })();
  // How far in front of the chair the table's near edge is, and how high its top.
  const tableEdge = (() => {
    const t = MAZE.rabbit.table; const c = MAZE.rabbit.chair;
    const dx = Math.max(t.minX - c.x, 0, c.x - t.maxX); const dz = Math.max(t.minZ - c.z, 0, c.z - t.maxZ);
    return clamp(Math.hypot(dx, dz), 0.55, 0.9);
  })();
  const tableTop = num(MAZE.rabbit.table.h, 0.8) + 0.012;

  function chairGeometry() {
    const wood = { color: 0x3a2a1e, color2: 0x241810, noise: 0.04, sides: 6, detail: 1, seed: 4 };
    const parts = [];
    for (const sx of [-1, 1]) {
      parts.push(S.skin([{ at: [sx * 0.25, 0, -0.24], r: 0.03 }, { at: [sx * 0.24, 0.58, -0.22], r: 0.035 }], wood));
      parts.push(S.skin([
        { at: [sx * 0.25, 0, 0.3], r: 0.032 }, { at: [sx * 0.24, 0.6, 0.27], r: 0.038 },
        { at: [sx * 0.25, 1.5, 0.33], r: 0.034 }, { at: [sx * 0.27, 2.25, 0.4], r: 0.03 },
      ], { ...wood, detail: 2 }));
      parts.push(S.tint(new THREE.SphereGeometry(0.055, 7, 5).scale(1, 1.4, 1).translate(sx * 0.27, 2.31, 0.4), 0x2c1f16, 0.2));
    }
    parts.push(S.tint(new THREE.BoxGeometry(0.58, 0.07, 0.6).translate(0, 0.6, 0.03), 0x3a2a1e, 0.25, 4));
    parts.push(S.tint(new THREE.BoxGeometry(0.5, 0.05, 0.5).translate(0, 0.655, 0.02), 0x5a1a22, 0.3, 6)); // worn velvet
    [1.0, 1.42, 1.84].forEach((y, i) => {
      parts.push(S.tint(new THREE.BoxGeometry(0.5, 0.11, 0.03).rotateX(-0.07).translate(0, y, 0.3 + 0.045 * i), 0x33241a, 0.25, i));
    });
    parts.push(S.skin([{ at: [-0.27, 2.2, 0.4], r: 0.03 }, { at: [0, 2.3, 0.41], r: 0.045 }, { at: [0.27, 2.2, 0.4], r: 0.03 }], { ...wood, detail: 2 }));
    return S.merge(parts);
  }

  // A lofted body from rings given by height; paint(h, f, colour) with h the height and f the
  // angle round the body (0 the front, + toward the figure's right).
  function loft(rings, o, paint) {
    const n = rings.length;
    const hAt = (u) => { const f = u * (n - 1); const i = Math.min(n - 2, Math.floor(f)); return lerp(rings[i].y, rings[i + 1].y, f - i); };
    return S.skin(rings.map((r) => ({ at: [0, r.y, r.z || 0], r: r.r, color: r.c })), {
      sides: 16, detail: 3, budget: 1500, noise: 0.035, mottle: 0.13, color2: null, side: [1, 0, 0], ...o,
      colorAt: (u, a, c) => paint(hAt(u), wrap(a), c),
    });
  }
  // Blood down a front: thick under the chin, breaking into runs lower down.
  const bleed = (seed, top, bottom, wide, much) => (h, f, c) => {
    if (h > top || h < bottom || Math.abs(f) > wide) return;
    const k = (h - bottom) / (top - bottom);
    const n = S.noise(f * 5 + 3, h * 11, 0, seed) + 0.6 * S.noise(f * 14, h * 5, 2, seed + 4);
    const run = Math.max(0, 1 - Math.abs(S.noise(f * 9, 0.5, 0, seed + 8)) * 5) * 0.6;
    c.lerp(BLOODC, clamp((n * 0.9 + k * 1.1 - 0.55 - Math.abs(f) * 0.7 + run) * 4 * much) * 0.92);
  };

  // A lank ear: up a little from the crown, then over and down past the jaw like a curtain.
  const LANK = [[0, 0, 0, 0.04, 0.03], [0.06, 0.075, 0.07, 0.06, 0.022], [0.125, 0.0, 0.13, 0.068, 0.02], [0.15, -0.2, 0.15, 0.066, 0.018], [0.145, -0.44, 0.13, 0.052, 0.015], [0.13, -0.62, 0.1, 0.02, 0.01]];
  function lankEar(sx, seed) {
    return S.skin(LANK.map((p) => ({ at: [sx * p[0], p[1], p[2]], r: [p[3], p[4]] })), {
      sides: 8, detail: 2, budget: 330, seed, color: FUR, color2: FUR2, noise: 0.07, rough: 0.05, side: [1, 0, 0],
      colorAt: (u, a, c) => {
        if (Math.cos(a) > 0.3 && u > 0.08) c.lerp(_col.set(0x8d6a7a), 0.7 * smooth((Math.cos(a) - 0.3) / 0.4)); // the inside: grey-mauve, no blood left in it
        if (u > 0.9) c.multiplyScalar(0.8);
      },
    });
  }

  /** The Undertaker's head: the finer skull, fangs, whiskers and blood, and eyes that glow. */
  function undertakerHead(seed) {
    const size = UT.SIZE;
    const plan = S.face({
      seed, skin: FUR, eye: EMBER, defects: ['eyesRed', 'noBlink', 'pupilsPin'],
      skull: { wide: 0.76, tall: 1.18, deep: 1.08, taper: 0.85, cheek: -0.14, chin: 0.08, brow: 0.1, noise: 0.04, muzzle: 0.1, socket: 0.05, temple: 0.06 },
      eyes: { lon: 0.46, r: 0.155, lat: 0.15, iris: 0.3, pupil: 0.15, open: 0.42 },
      brow: { color: 0x3a3642, thick: 0.026, tilt: 1.5 },
      nose: { kind: 'button', size: 0.06, lat: -0.2 },
      mouth: { lat: -0.5, width: 0.27, smile: -0.3, lip: 0x4a1218, teeth: 6, toothLen: 0.06, rest: 0.22 },
      cheek: { rosy: 0.35, color: 0x5e4458 }, ears: { kind: 'none' },
    });
    for (const e of plan.eyes) { e.rim = 0x4a0810; e.white = 0x4a1c24; e.bag = true; }
    const at = S.head({ size, face: plan, budget: 400, cast: false }).at; // a probe, for placing things on the surface
    const extras = []; const wet = [];
    for (const sx of [-1, 1]) {
      // The muzzle: a whisker pad under the nose, and the whiskers, thin and drooping.
      const p = at(sx * 0.115, -0.37, -0.02);
      extras.push(S.tint(new THREE.SphereGeometry(0.16 * size, 8, 6).scale(1, 0.7, 0.55).translate(p.x, p.y, p.z), 0xd9d5d2, 0.1, seed + sx));
      for (let k = 0; k < 3; k++) {
        const w0 = at(sx * 0.2, -0.36 + (k - 1) * 0.04, 0.05);
        wet.push(S.skin([{ at: w0, r: 0.003 }, { at: [w0.x + sx * 0.13, w0.y + (k - 1) * 0.035 - 0.01, w0.z], r: 0.0022 }, { at: [w0.x + sx * 0.27, w0.y + (k - 1) * 0.075 - 0.07, w0.z + 0.07], r: 0.001 }],
          { sides: 3, detail: 2, noise: 0, color: 0x9c98a0, shade: 0, caps: 'flat' }));
      }
      // The fangs: two long canines set apart, down over the lower lip, wet at the tips.
      const r0 = at(sx * 0.15, -0.45, 0.05);
      wet.push(S.skin([
        { at: r0, r: 0.052 * size }, { at: [r0.x + sx * 0.003, r0.y - 0.2 * size, r0.z - 0.03 * size], r: 0.04 * size },
        { at: [r0.x + sx * 0.008, r0.y - 0.43 * size, r0.z - 0.035 * size], r: 0.007 * size },
      ], { sides: 6, detail: 2, noise: 0, color: 0xf1ead8, mottle: 0.05, shade: 0.1, caps: ['round', 'flat'], colorAt: (u, a, c) => { if (u > 0.55) c.lerp(BLOODC, 0.8 * smooth((u - 0.55) / 0.3)); } }));
      // Blood from the corner of the mouth, down the chin.
      const j = sx > 0 ? 0 : 1; const lon = j ? 0.26 : 0.2;
      wet.push(S.skin([-0.55, -0.72, -0.9, -1.04 - 0.1 * j].map((lat, i) => ({ at: at(sx * (lon - 0.02 * i), lat, 0.085 - 0.012 * i), r: (0.016 - 0.003 * i) * (j ? 0.7 : 1) })),
        { sides: 5, detail: 2, noise: 0.1, seed: seed + j, color: BLOOD, mottle: 0.2, shade: 0 }));
      // The ears ride the skull, so they swing when the head turns.
      extras.push(lankEar(sx, seed + (sx > 0 ? 0 : 1)).translate(sx * 0.11, 0.49, 0.03));
    }
    const hd = S.head({ size, face: plan, budget: 4000, fine: true, extras, wet });
    // Paint: hollow cheeks and temples, dark sockets, blood at the mouth and on the chin.
    hd.group.updateWorldMatrix(true, true);
    const stain = (m, p, r, hex, strength, dent = 0) => { if (m) S.scar(m, p, r, { hex, strength, dent }); };
    for (const sx of [-1, 1]) {
      stain(hd.skull, at(sx * 0.7, -0.36), 0.5 * size, 0x40384e, 0.8, 0.2);
      stain(hd.skull, at(sx * 1.05, 0.34), 0.42 * size, 0x4e465c, 0.5, 0.16);
      stain(hd.skull, at(sx * 0.46, 0.12), 0.5 * size, 0x1e0e1c, 0.85, 0);
    }
    stain(hd.skull, at(0.06, -0.52, 0.05), 0.34 * size, BLOOD, 0.9);
    stain(hd.skull, at(-0.12, -0.42, 0.1), 0.24 * size, BLOOD, 0.85);
    stain(hd.skull, at(0.2, -0.46, 0.08), 0.2 * size, BLOOD, 0.7);
    stain(hd.jaw, at(0.05, -0.72, 0.05), 0.42 * size, BLOOD, 0.9);
    stain(hd.jaw, at(-0.22, -1.0, 0.05), 0.26 * size, BLOOD, 0.8);
    const glow = S.eyeGlow(hd, { color: EMBER, strength: 0.6, size: 0.26, opacity: 0.5 }); // pinpricks: a small hot point, not a disc
    return { hd, glow };
  }

  /** The gold watch, lying face up, its bow toward +Z; and its chain, off the table's edge. */
  function watchOnCloth() {
    const r = 0.062; const INK = 0x14141a;
    const parts = [
      S.tint(new THREE.CylinderGeometry(r, r, 0.02, 16), GOLD, 0.15),
      S.tint(new THREE.CylinderGeometry(r * 0.84, r * 0.84, 0.025, 16), 0xefe9da),
      S.tint(new THREE.SphereGeometry(0.011, 6, 4).translate(0, 0, r + 0.008), GOLD),
      S.tint(new THREE.TorusGeometry(0.016, 0.0045, 4, 8).rotateX(Math.PI / 2).translate(0, 0, r + 0.03), GOLD),
      S.tint(new THREE.SphereGeometry(0.006, 5, 3).translate(0, 0.016, 0), INK),
      S.tint(new THREE.CircleGeometry(r * 0.3, 7).rotateX(-Math.PI / 2).translate(r * 0.3, 0.0135, r * 0.28), BLOOD), // a thumbprint
    ];
    for (let k = 0; k < 12; k += 1) parts.push(S.tint(new THREE.BoxGeometry(0.004, 0.003, k % 3 ? 0.008 : 0.015).translate(0, 0.013, -r * 0.68).rotateY((k / 12) * TAU), INK));
    parts.push(S.tint(new THREE.BoxGeometry(0.005, 0.003, r * 0.42).translate(0, 0.0145, -r * 0.21).rotateY(-0.2), INK));
    parts.push(S.tint(new THREE.BoxGeometry(0.004, 0.003, r * 0.62).translate(0, 0.015, -r * 0.31).rotateY(1.9), INK));
    const watch = S.merge(parts).rotateY(0.35).translate(0.012, 0.012, 0);
    // The chain: a curl on the cloth, back under his wrists and off the table's edge into his lap.
    const pts = [[0.032, 0.006, 0.088], [0.07, 0.005, 0.105], [0.08, 0.005, 0.13], [0.05, 0.005, 0.15], [0.01, 0.003, 0.16],
      [0.0, -0.02, 0.172], [-0.004, -0.1, 0.178], [0, -0.2, 0.182]];
    const rings = pts.map(([x, y, z]) => ({ at: [x, y, z], r: 0.0055 }));
    const chain = S.skin(rings, { sides: 4, detail: 3, noise: 0, color: GOLD, mottle: 0.35, shade: 0.1, caps: 'flat', profile: (a, u) => 0.72 + 0.5 * Math.abs(Math.sin(u * 150)) });
    return S.merge([watch, chain]);
  }

  function buildRabbit() {
    const seed = 47; const H = UT.H;
    const g = new THREE.Group(); const pose = new THREE.Group(); const body = new THREE.Group();
    pose.position.set(0, UT.HIP, UT.SIT);
    pose.rotation.x = UT.STOOP;
    body.position.set(0, -H, 0);
    pose.add(body); g.add(pose);

    // The frock coat, waistcoat, shirt front and what has run down them.
    const VEST = 0x45444e; const SHIRT = 0xcfc9bd;
    const blood = bleed(seed, H + 0.72, H + 0.34, 0.5, 0.9);
    const torsoParts = [loft([
      { y: H - 0.07, z: 0.03, r: [0.25, 0.21], c: FROCK }, { y: H - 0.02, z: 0.01, r: [0.17, 0.14], c: FROCK }, { y: H + 0.12, r: [0.118, 0.1], c: FROCK },
      { y: H + 0.32, r: [0.112, 0.096], c: FROCK }, { y: H + 0.52, z: 0.02, r: [0.148, 0.116], c: FROCK },
      { y: H + 0.64, z: 0.05, r: [0.172, 0.122], c: FROCK }, { y: H + 0.71, z: 0.035, r: [0.1, 0.09], c: FROCK },
      { y: H + 0.77, z: -0.02, r: 0.05, c: FUR }, { y: H + 0.85, z: -0.07, r: 0.044, c: FUR },
    ], { seed, caps: ['flat', 'round'] }, (h, f, c) => { // the first ring is the coat spread on the seat
      const hh = h - H; const af = Math.abs(f);
      if (hh > 0.26 && hh < 0.7) {
        const vv = (hh - 0.26) * 1.25;
        if (hh > 0.5 && af < (hh - 0.5) * 2.2) c.set(SHIRT);
        else if (af < vv) { c.set(VEST); if (af < 0.05) c.multiplyScalar(0.6); }
        else if (af < vv + 0.2) c.set(SATIN); // the satin lapel
      } else if (hh <= 0.26 && af < 0.05) c.multiplyScalar(0.6);
      blood(h, f, c);
    })];
    // The cravat: grey silk, puffed, and stained.
    torsoParts.push(S.skin([{ at: [0, H + 0.735, -0.045], r: [0.062, 0.034] }, { at: [0, H + 0.67, -0.1], r: [0.082, 0.036] }, { at: [0, H + 0.59, -0.118], r: [0.06, 0.022] }, { at: [0, H + 0.52, -0.122], r: [0.03, 0.012] }],
      { seed, sides: 9, detail: 2, noise: 0.12, color: CRAVAT, side: [1, 0, 0], colorAt: (u, a, c) => { c.multiplyScalar(0.85 + 0.3 * Math.abs(Math.sin(a * 5))); const n = S.noise(a * 2, u * 6, 0, seed); const f = Math.abs(wrap(a - Math.PI)); c.lerp(STAINC, clamp(0.9 - f * 0.7 - u * 0.5 + 0.35 * n) * 0.9); c.lerp(BLOODC, clamp(0.95 - u * 1.5 - f * 0.9 + 0.3 * n) * 0.85); } })); // this spine runs downward, so its front is at PI
    const torso = part(S.merge(torsoParts), M.skin, true);
    // What shines: the ruby stickpin on its gold, two jet buttons, a swag of chain across the waistcoat.
    const trinkets = part(S.merge([
      S.tint(new THREE.SphereGeometry(0.017, 7, 5).translate(0.004, H + 0.655, -0.142), EMBER),
      S.tint(new THREE.TorusGeometry(0.019, 0.004, 4, 9).translate(0.004, H + 0.655, -0.14), GOLD),
      S.tint(new THREE.CylinderGeometry(0.003, 0.002, 0.08, 4).rotateZ(0.5).translate(0.02, H + 0.625, -0.143), GOLD),
      ...[0.06, 0.16].map((y, i) => S.tint(new THREE.SphereGeometry(0.017, 6, 4).translate(0.03, H + y, -0.103), 0x0c0c10, 0.2, i)),
      S.skin([{ at: [-0.075, H + 0.43, -0.098], r: 0.0045 }, { at: [-0.02, H + 0.385, -0.112], r: 0.0045 }, { at: [0.035, H + 0.4, -0.108], r: 0.0045 }, { at: [0.06, H + 0.45, -0.102], r: 0.0045 }],
        { sides: 4, detail: 3, noise: 0, color: GOLD, mottle: 0.35, shade: 0, caps: 'flat', profile: (a, u) => 0.72 + 0.5 * Math.abs(Math.sin(u * 60)) }),
    ]), M.gloss);

    const { hd, glow } = undertakerHead(seed);
    ash.set(glow.material, ash.get(M.gloss));
    hd.pose({ frown: 0.75, brow: -0.35 });
    const neck = new THREE.Group();
    neck.position.set(0, H + 0.82, -0.055);
    neck.add(hd.group);
    body.add(torso, trinkets, neck);

    // The frock's skirts: off the seat either side and behind, muddy at the hem, to the grass.
    const MUD = new THREE.Color(0x3a3228);
    const skirt = S.cloth({
      width: 1, length: 0.7, cols: 14, rows: 6, budget: 340, curve: 3.9, radius: 0.31, flare: 0.14, folds: 6, foldDepth: 0.022, tatter: 0.25, dirt: 0.2, color: FROCK, seed,
      pattern: (u, vv, c) => { if (vv > 0.7) c.lerp(MUD, clamp((vv - 0.7) * 3.3 * (0.5 + 0.5 * S.noise(u * 30, 0, 0, seed)))); },
    });
    skirt.mesh.position.set(0, 0.0, 0.03);
    skirt.mesh.rotation.order = 'YXZ';
    skirt.mesh.rotation.y = Math.PI - 3.9 / 2;
    pose.add(skirt.mesh);

    // Limbs. Skin (one draw): each arm 13 (upper, fore, cuff, palm, four fingers of two, a
    // thumb), then each leg 3. Claws (one draw, gloss): each hand 5, then each foot 3.
    const L = S.limbs(32, { seed, sides: 6, cast: false });
    const C = S.limbs(16, { seed: seed + 1, sides: 5, taper: 0.1, noise: 0.03, material: M.gloss, cast: false });
    for (let s = 0; s < 2; s++) {
      const b = s * 13;
      L.tone(b, FROCK); L.tone(b + 1, FROCK); L.tone(b + 2, 0xd8d2c4); L.tone(b + 3, FUR);
      for (let i = 0; i < 4; i++) { L.tone(b + 4 + i * 2, FUR); L.tone(b + 5 + i * 2, i === 1 || i === 2 ? 0xc79a9c : FUR); }
      L.tone(b + 12, FUR);
      L.tone(26 + s * 3, 0x2a2930); L.tone(27 + s * 3, 0x2a2930); L.tone(28 + s * 3, FUR);
    }
    for (let i = 0; i < 16; i++) C.tone(i, 0x2a1719);
    // What stays at the table when he leaves it: the chair, and the watch on the cloth.
    const seat = new THREE.Group();
    const chair = part(chairGeometry(), M.skin, true);
    const watch = part(watchOnCloth(), M.gloss);
    watch.position.set(0, tableTop, -(tableEdge + 0.16)); // under his fingers: the hands are clasped round it
    seat.add(chair, watch);
    g.add(L.mesh, C.mesh, seat);

    const rig = { root: body, chest: torso, head: hd, cloths: [skirt], seed, rate: 0.13, depth: 1.7 };
    const setLook = looks([torso, trinkets, hd.skull, hd.jaw, hd.features, skirt.mesh, L.mesh, C.mesh]);
    const act = makeAct();
    const LEN1 = [0.08, 0.098, 0.092, 0.072]; const LEN2 = [0.066, 0.08, 0.076, 0.058];
    const sh = V(); const el = V(); const hand = V(); const hip = V(); const knee = V(); const foot = V(); const tmp = V();
    const dir = V(); const nrm = V(); const side = V(); const base = V(); const p1 = V(); const p2 = V(); const p3 = V(); const dd = V();
    const bp = (out, x, y, z) => out.set(x, y, z).applyMatrix4(body.matrix).applyMatrix4(pose.matrix);
    const v = {
      g, age: 0, deathT: -1, eatT: -1, tut: 0, headYaw: 0, fake: 0, away: 0, checkAt: 3, check: 0,
      eye: V(0, 1.6, -5), reach: 0, leap: 0, tutted: false, warn: 0, beat: 0, lastWarned: 0, talk: 0, glowK: 1,
    };

    // One hand at `hand`: the fingers point along `dir` and curl toward `nrm`.
    function placeHand(s, curl, splay, time, live) {
      const b = s * 13; const sx = s ? -1 : 1;
      dir.normalize(); nrm.addScaledVector(dir, -nrm.dot(dir)).normalize(); side.crossVectors(dir, nrm);
      dd.subVectors(el, hand).normalize();
      L.place(b + 2, p1.copy(hand).addScaledVector(dd, 0.012), p2.copy(hand).addScaledVector(dd, 0.07), 0.04);
      L.place(b + 3, p1.copy(hand).addScaledVector(dir, -0.015), p2.copy(hand).addScaledVector(dir, 0.075), 0.03);
      for (let i = 0; i < 4; i++) {
        const off = i - 1.5;
        const c = curl * (1 + 0.12 * off) + live * 0.07 * Math.sin(time * 0.9 + i * 1.3 + sx) + live * 0.1 * Math.max(0, Math.sin(time * 0.6 + i * 2 + sx * 2)) ** 10;
        base.copy(hand).addScaledVector(dir, 0.062).addScaledVector(side, off * 0.019);
        const seg = (k, from, to, len) => to.copy(dir).multiplyScalar(Math.cos(c * k)).addScaledVector(nrm, Math.sin(c * k)).addScaledVector(side, off * splay * 0.45).normalize().multiplyScalar(len).add(from);
        seg(1, base, p1, LEN1[i]); seg(2.1, p1, p2, LEN2[i]); seg(3, p2, p3, 0.062);
        L.place(b + 4 + i * 2, base, p1, 0.0135); L.place(b + 5 + i * 2, p1, p2, 0.0112); C.place(s * 5 + i, p2, p3, 0.0105);
      }
      base.copy(hand).addScaledVector(dir, 0.018).addScaledVector(side, -0.026 * sx);
      dd.copy(dir).multiplyScalar(0.55).addScaledVector(side, -0.6 * sx).addScaledVector(nrm, 0.35 + curl * 0.5).normalize();
      p1.copy(base).addScaledVector(dd, 0.075); p2.copy(p1).addScaledVector(dd.addScaledVector(nrm, 0.4).normalize(), 0.055);
      L.place(b + 12, base, p1, 0.014); C.place(s * 5 + 4, p1, p2, 0.0105);
    }

    // o: lunge, tell, check, fold, stiff, tut, fake, eat (-1 or 0..1), chew, warn (0..1), beat, talk, dead
    function draw(time, o) {
      const lean = o.eat >= 0 ? 0.3 : 0; // over the bowl he pulled to him
      const seated = (1 - o.lunge) * (1 - o.fold);
      pose.position.set(0, UT.HIP + 0.45 * o.lunge + 0.02 * o.tell, UT.SIT - o.fake - 0.05 * o.tell - 0.06 * o.fold);
      pose.rotation.x = (UT.STOOP - 0.1 * o.warn - 0.05 * o.beat) * seated - 1.2 * o.lunge - 0.22 * o.tell * seated - 1.33 * o.fold - lean * seated;
      // His head: hung forward of his shoulders, lower with every warning; it comes up to strike.
      neck.rotation.set(
        (0.3 - 0.26 * o.warn + 0.12 * o.beat) * seated + 0.12 * o.tell + 1.0 * o.lunge - 0.3 * o.check * seated + 0.25 * o.fold + 0.2 * lean,
        v.headYaw * (1 - o.fold) + 0.75 * o.fold + 0.14 * o.tut * Math.sin(time * 38),
        0.45 * o.fold + 0.05 * o.warn * Math.sin(time * 0.6),
      );
      // The skirts hang straight while he sits and when he has folded onto the cloth (his hips
      // have not left the seat); in the air they cling to his legs.
      skirt.mesh.rotation.x = -pose.rotation.x * (1 - o.lunge) * (1 - o.tell * 0.3 * seated);
      skirt.mesh.scale.set(1 - 0.5 * o.lunge, 1, 1 - 0.55 * o.lunge);
      S.breathe(rig, time, { amount: (1 - o.lunge) * (1 - o.fold) * (1 - 0.85 * o.stiff), look: o.dead ? null : v.eye, blink: false, wind: -1.5 * o.lunge });
      hd.pose({
        jaw: Math.max(o.lunge, 0.6 * o.tell, o.chew, o.talk, 0.3 * o.fold), brow: Math.max(-0.5, -0.35 - 0.15 * o.warn - 0.1 * o.tell) + 0.5 * o.stiff, // no lower: below this they cut the eyes
        frown: Math.max(0.75 + 0.25 * o.warn, o.tell, o.lunge) * (1 - o.stiff), blink: o.dead ? 0.35 * o.fold : 0,
        ...(o.dead ? { look: [0, -0.2] } : {}),
      });
      body.updateMatrix(); pose.updateMatrix();

      const edge = -tableEdge; const top = tableTop;
      for (let s = 0; s < 2; s++) {
        const sx = s ? -1 : 1; // 0 is his right
        bp(sh, sx * 0.175, H + 0.62, 0.04);
        // Clasped on the cloth, this side of the watch; the fingers of each hand laid over the other's.
        hand.set(sx * 0.115, top + 0.05, edge - 0.09);
        dir.set(-sx * 0.72, -0.04, -0.7); nrm.set(0.1 * sx, -1, 0.1);
        let curl = 0.42; let splay = 0.3; let live = seated;
        if (o.warn) { hand.x += sx * 0.05 * o.warn; curl += 0.16 * o.warn; } // they come apart a little, and hook
        if (o.tell) { hand.lerp(tmp.set(sx * 0.3, top + 0.06, edge - 0.1), o.tell); dir.lerp(tmp.set(-sx * 0.2, 0.1, -1), o.tell); curl = lerp(curl, 0.75, o.tell); splay = lerp(splay, 0.9, o.tell); }
        if (sx < 0 && o.check) { hand.lerp(tmp.set(-0.02, top + 0.11, edge - 0.14), o.check); curl = lerp(curl, 0.45, o.check); }
        if (sx > 0 && o.eat >= 0) {
          const k = 0.5 - 0.5 * Math.cos(o.eat * TAU);
          hand.copy(tmp.set(0.07, top + 0.12, edge - 0.36).lerp(bp(_a, 0.05, H + 0.94, -0.3), k));
          dir.set(-0.3, 0.2 + 0.6 * k, -0.6 + 1.2 * k); nrm.set(0, -0.6, 0.8); curl = 0.75;
        }
        if (o.lunge) { hand.lerp(bp(tmp, sx * 0.2, H + 1.12, -0.3), o.lunge); dir.lerp(bp(tmp, -sx * 0.1, H + 2, -0.4).sub(bp(_a, 0, H + 1, -0.2)), o.lunge); nrm.lerp(tmp.set(0, -1, 0).applyQuaternion(pose.quaternion), o.lunge); curl = lerp(curl, 0.5, o.lunge); splay = lerp(splay, 1, o.lunge); live = 0; }
        if (o.fold) { hand.lerp(tmp.set(sx * 0.34, top + 0.035, edge - 0.5 - 0.1 * s), o.fold); dir.lerp(tmp.set(sx * 0.2, -0.05, -1), o.fold); curl = lerp(curl, 0.18, o.fold); splay = lerp(splay, 0.7, o.fold); live = 0; }
        reachClamp(sh, hand, (UT.UP + UT.FORE) * 0.98);
        S.ik2(sh, hand, UT.UP, UT.FORE, tmp.set(sx * 0.8, -0.5, 0.45), el);
        L.place(s * 13, sh, el, 0.04);
        L.place(s * 13 + 1, el, hand, 0.034);
        placeHand(s, curl, splay, time + sx, live);

        // Legs: under the table while he sits, trailing when he is in the air; long rabbit feet.
        bp(hip, sx * 0.07, H + 0.02, 0);
        foot.set(sx * 0.11, 0.075, edge + 0.12).lerp(bp(tmp, sx * 0.1, H - 0.95, 0.35), o.lunge);
        reachClamp(hip, foot, (UT.THIGH + UT.SHIN) * 0.98);
        S.ik2(hip, foot, UT.THIGH, UT.SHIN, tmp.set(sx * 0.25, 0.75, -1), knee);
        L.place(26 + s * 3, hip, knee, 0.05);
        L.place(27 + s * 3, knee, foot, 0.04);
        dd.set(sx * 0.035, -0.04, -0.28).lerp(tmp.set(0, -0.26, 0.12), o.lunge);
        p1.copy(foot).addScaledVector(dd, -0.16); p1.y += 0.012 * (1 - o.lunge);
        p2.copy(foot).add(dd);
        L.place(28 + s * 3, p1, p2, 0.05);
        dd.normalize();
        for (let i = 0; i < 3; i++) C.place(10 + s * 3 + i, p1.copy(p2).add(tmp.set((i - 1) * 0.02, 0.004, 0.015)), p3.copy(p2).addScaledVector(dd, 0.065).add(tmp.set((i - 1) * 0.012, -0.02, 0)), 0.011);
      }
      L.commit(); C.commit();
    }

    v.sync = (en, dt, time, eye, cfg, reduced) => {
      const c = (cfg && cfg.rabbit) || {};
      const s = rabbitView(en, lastSim, cfg);
      v.age += dt;
      v.eye.copy(eye);
      if ((s.tell || s.lunging) && act.tellT < 0 && act.strikeT < 0 && !v.hinted) { act.tellT = 0; act.tellDur = c.lungeTell || 0.42; }
      v.hinted = s.tell || s.lunging;
      actStep(act, dt, 0.75);
      const t = act.strikeT;
      const lunge = t < 0 ? 0 : t < 0.16 ? smooth(t / 0.16) : t < 0.3 ? 1 : 1 - smooth((t - 0.3) / 0.45);
      const tell = tellOf(act) * (1 - lunge);
      // Is the rules' rabbit actually crossing the table? If not, the crossing is drawn here.
      const hx = s.x - s.home.x; const hz = s.z - s.home.z;
      v.away = Math.hypot(hx, hz);
      if (t === 0 || (t >= 0 && t < dt * 1.5)) v.reach = clamp(Math.hypot(eye.x - s.home.x, eye.z - s.home.z) - 0.95, 0, c.lungeRange || 4);
      v.fake = v.reach * lunge * (1 - clamp(v.away / 0.3));
      const busy = tell > 0 || lunge > 0 || v.away > 0.3;
      const face = !busy ? seatFacing : v.away > 0.3 && s.speed > 0 ? s.facing : headingTo(eye.x - s.x, eye.z - s.z);
      v.leap = approach(v.leap, s.lunging ? 1 : 0.8 * clamp(v.away - 0.3), dt, 16);
      g.position.set(s.x, s.y, s.z);
      g.rotation.y = turn(g.rotation.y, face, dt, busy ? 22 : 6);
      // The chair and the watch stay where they are.
      const th = g.rotation.y;
      seat.position.set(-hx * Math.cos(th) + hz * Math.sin(th), -s.y, -hx * Math.sin(th) - hz * Math.cos(th));
      seat.rotation.y = seatFacing - th;

      // Eating, the watch, a tut.
      if (s.eating && v.eatT < 0) v.eatT = 0;
      if (v.eatT >= 0) v.eatT += dt;
      const eating = v.eatT >= 0 && v.eatT < (c.eatTime || 3);
      const stiff = v.eatT >= (c.eatTime || 3) ? 1 : 0;
      v.tut = Math.max(0, v.tut - dt / 0.5);
      if (s.tut && !v.tutted) { v.tut = 1; v.checkAt = -0.01; } // he tuts and looks at his watch
      v.tutted = s.tut;
      v.checkAt -= dt;
      if (v.checkAt < -1.7) v.checkAt = 5.5 + 4 * frac(time * 0.37);
      const wantCheck = v.checkAt < 0 && !busy && !eating && !stiff && s.warned < UT.WARN;
      v.check = approach(v.check, wantCheck ? 1 : 0, dt, 5);
      // The warnings: each one lowers the head and feeds the eyes; the moment of each is a small start.
      if (s.warned > v.lastWarned) v.beat = 1;
      v.lastWarned = s.warned;
      v.beat = Math.max(0, v.beat - dt / 0.6);
      v.warn = approach(v.warn, clamp(s.warned / UT.WARN), dt, 3);
      v.talk = approach(v.talk, s.speaking ? 0.12 + 0.3 * Math.abs(Math.sin(time * 8.3)) * (Math.sin(time * 2.9) > -0.6 ? 1 : 0.2) : 0, dt, 18);
      // His head follows you slowly and without a step; only the eyes are quick.
      const want = clamp(wrap(headingTo(eye.x - s.x, eye.z - s.z) - g.rotation.y), -1.2, 1.2);
      v.headYaw = approach(v.headYaw, busy ? 0 : want, dt, busy ? 14 : 2.2);
      // The eyes: brighter with each warning, flaring as he comes; a slow pulse unless flashes are reduced.
      const pulse = reduced ? 0 : 0.07 * Math.sin(time * 1.9) + 0.03 * Math.sin(time * 5.3);
      v.glowK = approach(v.glowK, (1 + 1.1 * v.warn + 0.9 * Math.max(tell, lunge) + (reduced ? 0 : 0.5 * v.beat)) * (stiff ? 0.35 : 1), dt, reduced ? 2 : 8); // eased, never a flash, when flashes are reduced
      glow.set(v.glowK + pulse);
      setLook('live');
      draw(time, {
        lunge: Math.max(lunge, v.leap), tell, check: v.check, fold: 0, stiff, tut: v.tut, fake: v.fake, warn: v.warn, beat: v.beat, talk: v.talk,
        eat: eating ? frac(v.eatT * 1.5) : -1, chew: eating ? 0.25 + 0.25 * Math.sin(v.eatT * 1.5 * TAU + 2.4) : 0, dead: false,
      });
    };
    v.onEvent = (ev) => {
      if (actEvent(act, ev, () => ((lastSim && lastSim.cfg && lastSim.cfg.rabbit && lastSim.cfg.rabbit.lungeTell) || 0.42))) return;
      if (ev.type === 'eats') v.eatT = 0;
    };
    v.onWorld = (ev) => {
      if (ev.type !== 'shot' || v.deathT >= 0) return;
      g.getWorldPosition(_c); _c.y += 1.3;
      if (shotPasses(ev, _c, 1.3)) { v.tut = 1; v.checkAt = -0.01; } // he tuts and looks at his watch
    };
    v.die = () => { v.deathT = 0; };
    // He stops; then he folds onto the cloth, the light goes out of his eyes, and he stays there.
    v.updateDeath = (dt, time) => {
      if (v.gone) return true;
      v.deathT += dt;
      const fold = smooth((v.deathT - 0.55) / 1.1);
      v.glowK = Math.max(0, v.glowK - dt * 0.9);
      glow.set(v.glowK);
      if (v.deathT > 1.2) setLook('dead');
      draw(time, { lunge: 0, tell: 0, check: 0, fold, stiff: 1, tut: 0, fake: 0, warn: v.warn * (1 - fold), beat: 0, talk: 0, eat: -1, chew: 0, dead: true });
      return false;
    };
    v.restore = () => {
      Object.assign(v, { eatT: -1, tut: 0, warn: 0, beat: 0, lastWarned: 0, talk: 0, check: 0, headYaw: 0, glowK: 1 });
      act.tellT = -1; act.strikeT = -1;
      glow.set(1);
      setLook('live');
    };
    v.dispose = () => { ash.delete(glow.material); glow.dispose(); }; // the rest is freed with his group (track)
    draw(0, { lunge: 0, tell: 0, check: 0, fold: 0, stiff: 0, tut: 0, fake: 0, warn: 0, beat: 0, talk: 0, eat: -1, chew: 0, dead: false });
    return track(v, 'rabbit');
  }

  // ======================================================================================
  // The Hatter-at-Arms. Three metres of him with the hat: a charcoal frock coat gone at the
  // hem, a tailor's tape round his neck, a bandolier of pincushions. Reads as a shopkeeper
  // stepping out to serve. What is off: the feet are a bird's, and they clench the turf while he
  // waits; the hat band bristles with pins; his left ear is drawn up and pinned to the brim, and
  // the hat sits crooked because of it. He walks like a pigeon, head first.
  // ======================================================================================
  const HT = { HIP: 1.0, NECK: 1.93, UP: 0.5, FORE: 0.48, THIGH: 0.47, SHIN: 0.46, ANK: 0.15, STRIDE: 0.95 };
  const COAT = 0x2b2a33; const HATC = 0x1d1a24; const BAND = 0xb9b2a0; const TAPE = 0xd9c77a; const ROSE = 0x8a4a55;

  function hatterHat(seed) {
    const yb = 0.53;
    const rnd = S.rng(seed + 3);
    const parts = [
      S.skin([{ at: [0, yb, 0], r: 0.61 }, { at: [0, yb + 0.035, 0], r: 0.59 }], { sides: 16, detail: 1, caps: 'flat', color: HATC, color2: 0x3a3540, noise: 0.05, grain: 2.5, seed, shade: 0.5 }),
      S.skin([
        { at: [0, yb + 0.02, 0], r: 0.36, color: BAND }, { at: [0, yb + 0.14, 0], r: 0.36, color: BAND },
        { at: [0, yb + 0.16, 0], r: 0.365, color: HATC }, { at: [0.02, yb + 0.5, 0.01], r: 0.385, color: HATC },
        { at: [0.05, yb + 0.86, 0.02], r: 0.44, color: HATC },
      ], { sides: 14, detail: 2, budget: 520, caps: ['open', 'flat'], color2: 0x39343f, noise: 0.07, grain: 1.6, mottle: 0.2, seed }),
      S.tint(new THREE.BoxGeometry(0.13, 0.19, 0.008).rotateZ(0.2).rotateY(-0.55).translate(0.2, yb + 0.21, -0.32), 0xe6dfc6, 0.12, 2),
    ];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU + rnd() * 0.2;
      const up = (rnd() - 0.35) * 1.1;
      const at = V(Math.sin(a) * 0.35, yb + 0.05 + rnd() * 0.07, -Math.cos(a) * 0.35);
      parts.push(pinAt(hatPin(0.13 + 0.14 * rnd(), BEADS[i % BEADS.length]), at, V(Math.sin(a) * Math.cos(up), Math.sin(up), -Math.cos(a) * Math.cos(up))));
    }
    const hat = S.merge(parts);
    hat.translate(0, -yb, 0).rotateZ(0.075).translate(0, yb, 0); // dragged down on the pinned side
    return hat;
  }

  function hatterExtras(seed) {
    const SKIN = new THREE.Color(0xdccfb8);
    const ear = S.skin([
      { at: [-0.37, 0.3, 0.0], r: [0.07, 0.03], color: SKIN }, { at: [-0.42, 0.39, 0.0], r: [0.055, 0.014], color: 0xd0a898 },
      { at: [-0.48, 0.475, 0.0], r: [0.045, 0.011], color: 0xb5524a },
    ], { sides: 6, detail: 2, noise: 0.05, seed, side: [0, 0, 1], shade: 0.1, capLen: 0.6 });
    const pin = pinAt(hatPin(0.26, 0xf3eedf, 0.005, 0.02), V(-0.475, 0.36, 0.0), V(0.03, 1, 0));
    const right = S.tint(new THREE.SphereGeometry(1, 8, 6).scale(0.03, 0.08, 0.06).translate(0.385, 0.31, 0.01), 0xd8bfae, 0.08, seed);
    const tufts = [];
    for (let i = 0; i < 5; i++) {
      const a = 0.9 + i * 0.5;
      tufts.push(S.skin([
        { at: [Math.sin(a) * 0.34, 0.47, Math.cos(a) * 0.3 + 0.03], r: 0.04 },
        { at: [Math.sin(a) * 0.45, 0.36 - 0.02 * i, Math.cos(a) * 0.42 + 0.03], r: 0.03 },
        { at: [Math.sin(a) * 0.5, 0.22, Math.cos(a) * 0.47 + 0.05], r: 0.008 },
      ], { sides: 5, detail: 1, color: 0xa9a49a, rough: 0.35, noise: 0.15, seed: seed + i }));
    }
    return [hatterHat(seed), ear, pin, right, ...tufts];
  }

  function hatterTorso(seed) {
    const parts = [S.skin([
      { at: [0, 0.96, 0], r: [0.2, 0.16] }, { at: [0, 1.25, 0], r: [0.17, 0.14] }, { at: [0, 1.6, -0.03], r: [0.25, 0.19] },
      { at: [0, 1.83, 0], r: [0.22, 0.14] }, { at: [0, 1.95, 0], r: 0.075, color: 0xddd6c4 },
    ], {
      sides: 12, detail: 2, budget: 760, seed, color: COAT, noise: 0.05, mottle: 0.16,
      colorAt: (u, a, c) => { if (u < 0.86 && Math.abs(wrap(a)) < 0.5 - 0.35 * u) c.set(0x6b5a2e); }, // the waistcoat
    })];
    // The bandolier: right shoulder to left hip, with three pincushions on the chest.
    const A = V(0.215, 0.36, 0); const B = V(0, 0, -0.222); const C = V(0, 1.46, -0.01);
    const loop = (th, out) => out.copy(C).addScaledVector(A, Math.cos(th)).addScaledVector(B, Math.sin(th) * (Math.sin(th) > 0 ? 1 : 0.86));
    const rings = [];
    for (let i = 0; i <= 12; i++) rings.push({ at: loop((i / 12) * TAU, V()), r: [0.05, 0.014] });
    parts.push(S.skin(rings, { sides: 6, detail: 1, caps: 'open', color: 0x4a3524, noise: 0.03, seed, side: [-0.864, 0.504, 0], shade: 0.1 }));
    const rnd = S.rng(seed + 8);
    [1.05, 1.6, 2.15].forEach((th, i) => {
      const at = loop(th, V());
      at.z -= 0.03;
      parts.push(S.tint(new THREE.SphereGeometry(1, 8, 6).scale(0.065, 0.055, 0.04).translate(at.x, at.y, at.z), ROSE, 0.2, i));
      for (let k = 0; k < 5; k++) {
        parts.push(pinAt(hatPin(0.08 + 0.09 * rnd(), BEADS[(i + k) % BEADS.length], 0.003, 0.011),
          V(at.x + (rnd() - 0.5) * 0.08, at.y + (rnd() - 0.5) * 0.06, at.z - 0.02), V((rnd() - 0.5) * 0.9, (rnd() - 0.3) * 0.9, -1)));
      }
    });
    parts.push(S.tint(new THREE.SphereGeometry(1, 8, 6).scale(0.085, 0.06, 0.05).translate(0, 1.87, -0.12), 0xe6dfc6, 0.1, 5)); // cravat
    parts.push(S.tint(new THREE.BoxGeometry(0.05, 0.5, 0.006).rotateZ(-0.05).translate(0.1, 1.6, -0.215), TAPE, 0.15, 7)); // the tape's short end
    return S.merge(parts);
  }

  function buildHatter() {
    const seed = 47;
    const g = new THREE.Group(); const pose = new THREE.Group(); const body = new THREE.Group();
    pose.position.set(0, HT.HIP, 0);
    body.position.set(0, -HT.HIP, 0);
    pose.add(body); g.add(pose);
    const torso = part(hatterTorso(seed), M.skin, true);
    const hd = S.head({
      size: 0.38, seed, defects: [],
      face: {
        skin: 0xdccfb8, eye: 0x6b7a4a,
        skull: { wide: 0.94, tall: 1.06, taper: 0.38, cheek: 0.05, chin: 0.09 },
        nose: { kind: 'long', size: 0.1, length: 0.36, lat: -0.1 },
        mouth: { width: 0.44, smile: 0.7, lip: 0x9a4a44 }, brow: { color: 0x8d8880, thick: 0.03 },
        cheek: { rosy: 0.5 }, ears: { kind: 'none' },
      },
      extras: hatterExtras(seed),
    });
    const neck = new THREE.Group();
    neck.position.set(0, HT.NECK, 0);
    neck.add(hd.group);
    const coat = S.cloth({ width: 1, length: 0.95, curve: 4.9, radius: 0.19, flare: 0.8, cols: 12, rows: 6, budget: 300, color: COAT, folds: 5, foldDepth: 0.03, tatter: 0.75, dirt: 0.4, seed });
    coat.mesh.position.set(0, 1.27, 0);
    coat.mesh.rotation.y = Math.PI;
    const tape = S.cloth({
      width: 0.05, length: 0.82, cols: 1, rows: 9, color: TAPE, folds: 0, foldDepth: 0, dirt: 0.1, seed: seed + 1,
      pattern: (u, vv, c) => { if (frac(vv * 21) < 0.16) c.multiplyScalar(0.25); },
    });
    tape.mesh.position.set(-0.1, 1.86, -0.2);
    tape.mesh.rotation.x = 0.03;
    body.add(torso, neck, coat.mesh, tape.mesh);

    const limbs = S.limbs(11, { seed, cast: false, taper: 0.62 });
    [0, 1, 3, 4].forEach((i) => limbs.tone(i, COAT));
    [2, 5].forEach((i) => limbs.tone(i, 0xdccfb8));
    [6, 8].forEach((i) => limbs.tone(i, 0x34333d));
    [7, 9].forEach((i) => limbs.tone(i, BAND));
    limbs.tone(10, 0xc4c8cc);
    const clawGeo = S.claw({ fingers: 3, length: 0.36, spread: 0.62, curl: 0.72, r: 0.05, color: 0x9a8650, tip: 0x1a1410, back: true, seed });
    const claws = [part(clawGeo, M.skin, true), part(clawGeo, M.skin, true)];
    g.add(limbs.mesh, ...claws);

    const rig = { root: body, chest: torso, head: hd, cloths: [coat, tape], seed };
    const setLook = looks([torso, hd.skull, hd.jaw, hd.features, coat.mesh, tape.mesh, limbs.mesh, ...claws]);
    const heal = keeper([torso, hd.skull]);
    const hurt = S.wounds({ seed });
    const drops = S.drips(g, 3, 0x7a0f14, seed);
    const act = makeAct();
    const sh = V(); const el = V(); const hand = V(); const hip = V(); const knee = V(); const foot = V(); const tmp = V();
    const bp = (out, x, y, z) => out.set(x, y, z).applyMatrix4(body.matrix).applyMatrix4(pose.matrix);
    const v = {
      g, age: 0, deathT: -1, phase: 0, move: 0, dirX: 0, dirZ: -1, lastX: null, lastZ: 0, reach: 0, throwT: -1, sinceVolley: 0,
      flash: 0, flinch: 0, ping: 0, headYaw: 0, hurt: 0, eye: V(0, 1.6, -5), tell: 0, kick: 0, pinsOut: 0, volleyT: -1,
    };

    function draw(time, o) {
      const step = v.phase * TAU;
      const mv = o.move;
      const kickUp = Math.max(o.tell, o.kick);
      pose.position.set(0.03 * Math.sin(step) * mv - 0.05 * kickUp, HT.HIP + 0.035 * Math.abs(Math.sin(step)) * mv - 0.05 * o.hurt - 0.6 * o.buckle - 0.12 * o.fall, 0.18 * kickUp * (1 - o.kick * 0.5) - 0.3 * o.fall);
      pose.rotation.set(-0.07 * mv + 0.28 * o.tell + 0.42 * o.kick + 0.2 * o.flinch + 0.1 * o.hurt - 1.45 * o.fall, 0.35 * o.reach - 0.75 * o.thrown, 0.06 * Math.sin(step) * mv + 0.07 * o.hurt * Math.sin(time * 0.8));
      // The pigeon walk: the head goes first and the body catches it up.
      neck.position.z = -0.07 * Math.sin(step * 2) * mv;
      neck.rotation.set(0.1 * o.tell - 0.2 * o.kick + 0.12 * o.hurt, v.headYaw * (1 - o.fall) + 0.25 * o.ping * Math.sin(time * 55), 0.3 * o.hurt * o.hurt);
      S.breathe(rig, time, { amount: (o.asleep ? 0.35 : 1) * (1 - o.fall), look: o.dead ? null : v.eye, blink: !o.dead, wind: 0.5 * mv + o.kick });
      hd.pose({ jaw: Math.max(0.5 * o.thrown, 0.7 * o.kick, 0.35 * o.flinch, 0.5 * o.fall), brow: 0.5 * o.reach - 0.4 * o.kick, frown: 0.6 * Math.max(o.tell, o.kick), ...(o.dead ? { blink: 0.8 * o.fall } : {}) });
      body.updateMatrix(); pose.updateMatrix();

      for (let s = 0; s < 2; s++) {
        const sx = s ? -1 : 1; // 0 is his right: the throwing hand and the kicking foot
        bp(sh, sx * 0.24, 1.8, 0);
        const limp = sx < 0 ? o.limp : 0;
        bp(hand, sx * (0.31 + 0.04 * limp), 1.0 + 0.04 * limp, -0.03 + sx * 0.22 * Math.sin(step) * mv * (1 - limp) + 0.05 * limp * Math.sin(time * 1.3));
        if (sx > 0) {
          if (o.reach) hand.lerp(bp(tmp, 0.33, HT.NECK + 0.64, -0.12), o.reach);
          if (o.thrown) hand.lerp(bp(tmp, 0.12, 1.72, -0.86), o.thrown);
        } else if (!limp) hand.lerp(bp(tmp, -0.16, 1.5, -0.24), 0.9 * (1 - mv) * (1 - kickUp)); // a hand on his bandolier
        if (kickUp) hand.lerp(bp(tmp, sx * 0.78, 1.72, 0.12), kickUp * (1 - limp));
        if (o.fall) hand.lerp(tmp.set(sx * 0.4, 0.08, -1.3 - 0.3 * s), o.fall);
        reachClamp(sh, hand, (HT.UP + HT.FORE) * 0.985);
        S.ik2(sh, hand, HT.UP, HT.FORE, tmp.set(sx * 0.7, -0.5, 0.6), el);
        limbs.place(s * 3, sh, el, 0.07);
        limbs.place(s * 3 + 1, el, hand, 0.055);
        _d.subVectors(hand, el).normalize();
        limbs.place(s * 3 + 2, hand, tmp.copy(hand).addScaledVector(_d, 0.13), 0.055);
        if (sx > 0) {
          // The pin he has drawn; before a volley it is held up and glints.
          if (o.reach > 0.6 && o.thrown < 0.3) limbs.place(10, _a.copy(hand).addScaledVector(_d, 0.06), tmp.copy(hand).addScaledVector(_d, 0.06).addScaledVector(UP, 0.26 + 0.1 * (o.glint || 0)), 0.008 + 0.008 * (o.glint || 0));
          else limbs.hide(10);
        }

        // Legs and the claws they end in.
        bp(hip, sx * 0.11, 1.02, 0);
        const c = frac(v.phase + (s ? 0.5 : 0));
        let along; let lift = 0;
        if (c < 0.6) along = 0.5 - c / 0.6;
        else { const sw = (c - 0.6) / 0.4; along = -0.5 + smooth(sw); lift = Math.sin(Math.PI * sw); }
        const drag = sx < 0 && o.hurt > 0.7 ? 0.35 : 1; // one leg drags when he is nearly done
        foot.set(sx * 0.15 + v.dirX * along * HT.STRIDE * mv * drag, HT.ANK + 0.34 * lift * mv * drag, v.dirZ * along * HT.STRIDE * mv * drag + 0.02);
        let toes = -0.55 * lift * mv;
        if (sx > 0 && kickUp) {
          foot.lerp(tmp.set(0.17, 1.0, -0.38), o.tell).lerp(_a.set(0.08, 1.12, -1.28), o.kick);
          toes = lerp(toes, 0.95, o.tell);
          toes = lerp(toes, 0.35, o.kick);
        }
        if (o.buckle) foot.lerp(tmp.set(sx * 0.2, HT.ANK, 0.25), o.buckle);
        reachClamp(hip, foot, (HT.THIGH + HT.SHIN) * 0.99);
        S.ik2(hip, foot, HT.THIGH, HT.SHIN, tmp.set(sx * 0.15, 0.15, -1), knee);
        limbs.place(6 + s * 2, hip, knee, 0.085);
        limbs.place(7 + s * 2, knee, foot, 0.055);
        const cl = claws[s];
        cl.position.copy(foot);
        // Waiting, the claws clench the turf, one and then the other.
        const clench = (1 - mv) * (1 - kickUp) * (1 - o.fall) * Math.max(0, Math.sin(time * 0.9 + s * 2.6)) ** 6;
        cl.rotation.set(toes - 0.14 * clench + 0.9 * o.fall, sx * -0.16, 0);
        cl.scale.set(1 + 0.25 * (sx > 0 ? kickUp : 0), 1, 1 - 0.1 * clench + 0.2 * (sx > 0 ? kickUp : 0));
      }
      limbs.commit();
    }

    v.sync = (en, dt, time, eye, cfg, reduced) => {
      const c = (cfg && cfg.hatter) || {};
      const s = hatterView(en, lastSim, cfg);
      v.age += dt;
      v.eye.copy(eye);
      g.position.set(s.x, s.y, s.z);
      g.rotation.y = s.facing;
      // Which way is he really going? He sidesteps between blocks as often as he walks at you.
      if (v.lastX == null) { v.lastX = s.x; v.lastZ = s.z; }
      const mx = s.x - v.lastX; const mz = s.z - v.lastZ;
      v.lastX = s.x; v.lastZ = s.z;
      const dist = Math.hypot(mx, mz);
      const stepping = dt > 0 && dist > 1e-5 && dist < 0.6;
      if (stepping) {
        const cs = Math.cos(s.facing); const sn = Math.sin(s.facing);
        v.dirX = approach(v.dirX, (mx * cs - mz * sn) / dist, dt, 8);
        v.dirZ = approach(v.dirZ, (mx * sn + mz * cs) / dist, dt, 8);
        v.phase += dist / HT.STRIDE;
      }
      v.move = approach(v.move, stepping && dist / dt > 0.25 ? 1 : 0, dt, 7);

      // The strike event starts the kick; the state starts it too if that event was missed.
      if (s.kicking && !v.wasKicking && act.strikeT < 0) { act.strikeT = 0; act.tellT = -1; }
      v.wasKicking = s.kicking;
      if (s.tell && act.tellT < 0 && act.strikeT < 0 && !v.hinted) { act.tellT = 0; act.tellDur = c.kickTell || 0.4; }
      v.hinted = s.tell;
      actStep(act, dt, 0.5);
      const kt = act.strikeT;
      v.kick = kt < 0 ? 0 : kt < 0.09 ? smooth(kt / 0.09) : 1 - smooth((kt - 0.16) / 0.34);
      v.tell = Math.max(tellOf(act) * (1 - v.kick), 0);
      // The hand goes to the hat band before a volley and between pins.
      v.sinceVolley += dt;
      if (v.throwT >= 0) { v.throwT += dt; if (v.throwT > 0.3) v.throwT = -1; }
      const due = !s.asleep && v.pinsOut > 0 && v.move < 0.3 && v.sinceVolley > (c.volleyInterval || 2.6) - 0.65 && v.sinceVolley < (c.volleyInterval || 2.6) + 1.2;
      const midVolley = v.sinceVolley < (c.pinGap || 0.25) * ((c.volley || 3) - 0.5) && v.pinsOut < (c.volley || 3);
      // The volley's tell (strikeTell 'volley'): for the aim time his hand is at the hatband and the pins glint.
      if (v.volleyT >= 0) { v.volleyT += dt; if (v.volleyT > (c.aimTime || 0.54) + 0.2) v.volleyT = -1; }
      const glint = v.volleyT < 0 ? 0 : reduced ? 0.6 : 0.6 + 0.4 * Math.sin(time * 44);
      limbs.tone(10, glint ? 0xffffff : 0xc4c8cc);
      v.reach = approach(v.reach, (s.drawing || due || midVolley || v.volleyT >= 0) && v.tell === 0 && v.kick === 0 ? 1 : 0, dt, v.volleyT >= 0 ? 24 : 12);
      const thrown = v.throwT < 0 ? 0 : v.throwT < 0.05 ? v.throwT / 0.05 : 1 - smooth((v.throwT - 0.1) / 0.2);

      v.hurt = s.hurt;
      v.flash = Math.max(0, v.flash - dt);
      v.flinch = Math.max(0, v.flinch - dt / 0.3);
      v.ping = Math.max(0, v.ping - dt / 0.35);
      setLook(v.flash > 0 && !reduced ? 'flash' : 'live');
      const want = clamp(wrap(headingTo(eye.x - s.x, eye.z - s.z) - s.facing), -1.1, 1.1);
      v.headYaw = approach(v.headYaw, want, dt, s.asleep ? 1.5 : 5);
      draw(time, {
        move: v.move, tell: v.tell, kick: v.kick, reach: v.reach, thrown, flinch: v.flinch, ping: v.ping, hurt: v.hurt, glint,
        limp: v.hurt > 0.5 ? 1 : 0, buckle: 0, fall: 0, asleep: s.asleep, dead: false,
      });
      g.updateMatrixWorld(true);
      drops.step(dt, v.hurt > 0.3 ? 0.4 + 1.4 * v.hurt : 0, (out) => {
        if (hurt.pick(out)) g.worldToLocal(out); else out.set(0, 1.4, -0.2);
      }, -s.y);
    };
    v.onEvent = (ev) => {
      if (ev.type === 'strikeTell' && ev.move === 'volley') { v.volleyT = 0; return; } // not the kick's wind-up
      if (actEvent(act, ev, () => ((lastSim && lastSim.cfg && lastSim.cfg.hatter && lastSim.cfg.hatter.kickTell) || 0.4))) return;
      if (ev.type === 'pinThrow') {
        if (v.sinceVolley > 1) v.pinsOut = 0;
        if (!v.pinsOut) v.sinceVolley = 0;
        v.pinsOut = (v.pinsOut || 0) + 1;
        v.throwT = 0;
      } else if (ev.type === 'hit') {
        if (ev.zone === 'hat') { v.ping = 1; return; } // the hat takes anything
        v.flash = 0.08; v.flinch = 1;
        g.updateMatrixWorld(true);
        const target = ev.zone === 'head' || ev.y - g.position.y > HT.NECK + 0.05 ? hd.skull : torso;
        hurt.hit(target, ev, hitSize(ev));
        S.scar(target, ev, hitSize(ev) * 2.4, { strength: 0.6, dent: 0.18 });
      }
    };
    v.die = () => { v.deathT = 0; setLook('live'); };
    // His knees go, he pitches onto his face, and the hat stays on.
    v.updateDeath = (dt, time) => {
      if (v.gone) return true;
      v.deathT += dt;
      const buckle = smooth(v.deathT / 0.45); const fall = smooth((v.deathT - 0.35) / 0.6);
      if (v.deathT > 1.1) setLook('dead');
      v.move = 0;
      draw(time, { move: 0, tell: 0, kick: 0, reach: 0, thrown: 0, flinch: 0, ping: 0, hurt: v.hurt, limp: 1, buckle, fall, asleep: false, dead: true });
      drops.step(dt, 0, () => {}, 0);
      return false;
    };
    v.restore = () => { hurt.clear(); heal(); v.hurt = 0; v.pinsOut = 0; v.sinceVolley = 0; v.volleyT = -1; act.tellT = -1; act.strikeT = -1; setLook('live'); };
    v.dispose = () => { hurt.clear(); }; // geometry and the drips' material go with his group (track)
    // Posed at rest once as built: a borrowed build (buildCreature, the castle's figure-mirror) is never
    // synced, and without this his arms and legs are unmade and his claws lie at his feet (issue 24).
    draw(0, { move: 0, tell: 0, kick: 0, reach: 0, thrown: 0, flinch: 0, ping: 0, hurt: 0, limp: 0, buckle: 0, fall: 0, asleep: false, dead: false });
    return track(v, 'hatter');
  }

  // ======================================================================================
  // The Cheshire Bat. Out of the light it is a grin and nothing else, hung in the air like a
  // lamp. In the light it has a body: a fat tabby barrel, all head and belly, hanging by two
  // long thumbs from a pair of wings that meet over it like a coat hanger and beat a little out
  // of step, so the body rocks under them. Too many teeth; one eye that never opens.
  // ======================================================================================
  const BT = { ARM: 0.7, FORE: 0.62, THUMB: 1.0, SPAN: 2.0 };
  const DUN = new THREE.Color(0x86745a); const STRIPE = new THREE.Color(0x241d18); const PALE = new THREE.Color(0xbfae8e);

  function buildBat() {
    const seed = 59;
    const hover = (lastSim && lastSim.cfg && lastSim.cfg.bat && lastSim.cfg.bat.hitY) || 2.2;
    const g = new THREE.Group(); const fly = new THREE.Group(); const bodyG = new THREE.Group();
    fly.add(bodyG); g.add(fly);
    const hd = S.head({
      size: 0.46, seed, defects: ['eyeShut:R', 'noMouth'],
      face: {
        skin: DUN, eye: 0xd0a020,
        skull: { wide: 1.12, tall: 0.92, deep: 1.0, taper: 0.1, cheek: 0.1, chin: 0, brow: 0.03, noise: 0.045 },
        eyes: { lon: 0.42, r: 0.2, lat: 0.22, iris: 0.62, pupil: 0.2, white: 0xe8d9a0 }, brow: { none: true },
        nose: { kind: 'button', size: 0.07, lat: -0.06 }, cheek: { rosy: 0.12 }, ears: { kind: 'point', size: 1.5 },
      },
    });
    const CY = hd.centre.y;
    { // Tabby bars over the back and crown of the skull; the face is left alone.
      const p = hd.skull.geometry.attributes.position; const c = hd.skull.geometry.attributes.color;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
        if (z < -0.12 && y < CY + 0.3) continue;
        if (Math.sin(y * 34 + 1.6 * Math.sin(x * 7) + z * 9) > 0.3) { _col.fromBufferAttribute(c, i).lerp(STRIPE, 0.85); c.setXYZ(i, _col.r, _col.g, _col.b); }
      }
    }
    const belly = part(S.skin([
      { at: [0, 0.22, 0.02], r: 0.3 }, { at: [0, -0.05, 0.04], r: [0.47, 0.44] }, { at: [0, -0.42, 0.05], r: [0.54, 0.52] },
      { at: [0, -0.72, 0.03], r: [0.4, 0.38] }, { at: [0, -0.88, 0], r: 0.16 },
    ], {
      sides: 14, detail: 3, budget: 900, seed, color: DUN, color2: 0x6a5a55, noise: 0.07, rough: 0.07, mottle: 0.16,
      colorAt: (u, a, c) => {
        const f = Math.abs(wrap(a));
        if (f < 0.85 && u > 0.3 && u < 0.92) { c.lerp(PALE, 0.75 * smooth((0.85 - f) / 0.3)); return; }
        if (Math.sin(u * 30 + 1.3 * Math.sin(a * 2 + 1)) > 0.25) c.lerp(STRIPE, 0.85);
      },
    }), M.skin, true);
    const grinGeo = S.grin({ width: 0.86, teeth: 36, smile: 0.5, lip: 0x4a1418, tooth: 0xe9e0c4, sharp: true, seed });
    const ghostGrin = new THREE.MeshBasicMaterial({ vertexColors: true });
    // The grin with a body round it: its own material, so the flare before a swoop can light it.
    const solidGrin = M.gloss.clone();
    solidGrin.emissive.set(0xffe2b0);
    solidGrin.emissiveIntensity = 0;
    ash.set(solidGrin, ash.get(M.gloss));
    const grin = part(grinGeo, ghostGrin);
    grin.position.set(0, CY - 0.22, -0.45);
    grin.rotation.x = -0.12;
    bodyG.add(hd.group, belly, grin);

    const veins = new THREE.Color(0x5a4a44);
    const wings = [1, -1].map((sx, i) => {
      const pivot = new THREE.Group();
      const cl = S.cloth({
        width: BT.SPAN, length: 0.95, cols: 9, rows: 5, budget: 180, color: 0x2a2226, folds: 4, foldDepth: 0.05, tatter: 0.85, dirt: 0.2, seed: seed + i,
        pattern: (u, vv, c) => { if (Math.abs(frac(u * 4 + 0.5) - 0.5) < 0.05 + 0.03 * vv) c.lerp(veins, 0.8); },
      });
      cl.mesh.position.x = sx * BT.SPAN / 2;
      pivot.add(cl.mesh);
      fly.add(pivot);
      return { sx, pivot, cl };
    });
    const limbs = S.limbs(21, { seed, cast: false, taper: 0.55 });
    for (let i = 0; i < 12; i++) limbs.tone(i, i % 6 >= 3 ? 0x9a8f7a : 0x4a3d38);
    limbs.tone(12, 0x4a3d38);
    [13, 14, 15, 16].forEach((i) => limbs.tone(i, i % 2 ? 0x2a2420 : DUN));
    [17, 18, 19, 20].forEach((i) => limbs.tone(i, i % 2 ? DUN : STRIPE));
    fly.add(limbs.mesh);

    // A see-through copy of each material for the moment it gains or loses its body.
    const ghost = new Map();
    for (const m of [M.skin, M.cloth, M.gloss]) { const c = m.clone(); c.transparent = true; c.opacity = 0; ghost.set(m, c); }
    const bodyParts = [hd.skull, hd.features, belly, wings[0].cl.mesh, wings[1].cl.mesh, limbs.mesh];
    const baseMat = bodyParts.map((m) => m.material);
    const casters = [hd.skull, belly];
    const rig = { head: hd, cloths: [wings[0].cl, wings[1].cl], seed, rate: 0.5 };
    const heal = keeper([belly, hd.skull]);
    const hurt = S.wounds({ seed });
    const drops = S.drips(g, 3, 0x7a0f14, seed);
    const act = makeAct();
    const yoke = V(); const elbow = [V(), V()]; const wrist = V(); const tip = V(); const hook = V(); const tmp = V();
    const v = {
      g, age: 0, deathT: -1, solidEv: null, solidK: 0, ripple: 0, widen: 0, flash: 0, flinch: 0, hurt: 0, beat: 0, eye: V(0, 1.6, -5),
      drop: 0, dropV: 0, mode: '', lookAt: 0, glance: 0,
    };
    const relRest = (() => { // how far the body hangs under the yoke with the wings at rest
      const a = 0.15 + 0.35;
      return BT.ARM * Math.sin(a) - Math.sqrt(BT.THUMB ** 2 - (BT.ARM * Math.cos(a) - 0.3) ** 2) - 0.34;
    })();

    function setBody(k, mode) {
      // mode: 'solid' | 'ghost' | 'flash' | 'dead'; k is how much body there is (0 to 1).
      const show = k > 0.02;
      for (const m of bodyParts) m.visible = show;
      for (const m of casters) m.castShadow = k > 0.9;
      const key = k >= 0.99 ? mode : 'ghost';
      if (key === 'ghost') for (const m of ghost.values()) m.opacity = k;
      if (key !== v.mode) {
        v.mode = key;
        bodyParts.forEach((m, i) => { m.material = key === 'ghost' ? ghost.get(baseMat[i]) : key === 'flash' ? M.flash : key === 'dead' ? ash.get(baseMat[i]) : baseMat[i]; });
        grin.material = key === 'ghost' ? ghostGrin : key === 'dead' ? ash.get(M.gloss) : solidGrin;
      }
    }

    function draw(time, o) {
      // o: tell, dive, fold (wings shut: dead), droop (one wing failing), amp
      const ph = v.beat;
      fly.position.set(0, -0.55 * o.dive + 0.25 * o.tell - v.drop, -1.25 * o.dive + 0.35 * o.tell);
      fly.rotation.x = -0.45 * o.dive + 0.3 * o.tell;
      yoke.set(0, hover - relRest + 0.07 * Math.sin(ph) * o.amp, 0.08);
      let sumY = 0; let dY = 0;
      wings.forEach((w, i) => {
        const sx = w.sx;
        const lag = sx > 0 ? 0 : 0.5; // the wings are not quite in step
        let a = 0.15 + 0.5 * Math.sin(ph - lag) * o.amp + 0.75 * o.tell - 0.55 * o.dive;
        if (sx < 0) a -= 0.5 * o.droop;
        a = lerp(a, -1.25, o.fold);
        w.pivot.position.copy(yoke);
        w.pivot.rotation.set(0, sx * (0.5 * o.dive - 0.1), sx * a);
        elbow[i].set(yoke.x + sx * BT.ARM * Math.cos(a + 0.35), yoke.y + BT.ARM * Math.sin(a + 0.35), yoke.z);
        wrist.set(yoke.x + sx * (BT.ARM + BT.FORE) * 0.98 * Math.cos(a), yoke.y + (BT.ARM + BT.FORE) * 0.98 * Math.sin(a), yoke.z - 0.03);
        tip.set(yoke.x + sx * BT.SPAN * Math.cos(a - 0.12), yoke.y + BT.SPAN * Math.sin(a - 0.12), yoke.z + 0.03);
        limbs.place(i * 6, yoke, elbow[i], 0.05);
        limbs.place(i * 6 + 1, elbow[i], wrist, 0.036);
        limbs.place(i * 6 + 2, wrist, tip, 0.024);
        const dx = Math.abs(elbow[i].x) - 0.3;
        const hang = elbow[i].y - Math.sqrt(Math.max(0.01, BT.THUMB ** 2 - dx * dx));
        sumY += hang; dY += sx * hang;
      });
      // The body hangs where the thumbs let it, and rolls when one wing is higher.
      const roll = Math.atan2(dY, 0.6) * (1 - o.fold);
      bodyG.position.set(0.05 * Math.sin(ph * 0.5 + 1) * o.amp, sumY / 2 - 0.34 - CY + 0.25 * o.fold, 0);
      bodyG.rotation.set(0.1 * Math.sin(ph * 0.5) * o.amp + 0.5 * o.fold, v.lookAt, roll);
      bodyG.scale.set(1 + 0.08 * o.fold, 1 - 0.22 * o.fold, 1);
      belly.rotation.z = -0.6 * roll + 0.07 * Math.sin(ph - 1.2) * o.amp; // the belly lags behind the rest
      bodyG.updateMatrix();
      wings.forEach((w, i) => {
        hook.set(w.sx * 0.3, CY + 0.34, 0.05).applyMatrix4(bodyG.matrix);
        tmp.copy(elbow[i]).lerp(hook, 0.55);
        tmp.x += w.sx * 0.05; tmp.z -= 0.06;
        limbs.place(i * 6 + 3, elbow[i], tmp, 0.04);
        limbs.place(i * 6 + 4, tmp, hook, 0.03);
        limbs.place(i * 6 + 5, hook, _a.copy(hook).add(_b.set(-w.sx * 0.08, -0.07, -0.03)), 0.016); // the hook in the scruff
      });
      limbs.place(12, _a.set(-0.09, yoke.y, yoke.z), _b.set(0.09, yoke.y, yoke.z), 0.06);
      for (let s = 0; s < 2; s++) {
        const sx = s ? -1 : 1;
        const sw = 0.08 * Math.sin(ph * 0.5 + s * 2) * o.amp;
        _a.set(sx * 0.17, -0.8, -0.06).applyMatrix4(bodyG.matrix);
        _b.set(sx * 0.19 + sw, -1.02, -0.12).applyMatrix4(bodyG.matrix);
        _c.set(sx * 0.2 + sw, -1.07, -0.24).applyMatrix4(bodyG.matrix);
        limbs.place(13 + s * 2, _a, _b, 0.045);
        limbs.place(14 + s * 2, _b, _c, 0.035);
      }
      _a.set(0, -0.7, 0.33).applyMatrix4(bodyG.matrix);
      for (let k = 0; k < 4; k++) {
        const sw = Math.sin(ph * 0.5 - k * 0.8) * o.amp;
        _b.set(_a.x + 0.1 * sw, _a.y - 0.2 + 0.03 * k, _a.z + 0.07 - 0.05 * k + 0.25 * o.dive);
        limbs.place(17 + k, _a, _b, 0.05 - 0.008 * k);
        _a.copy(_b);
      }
      limbs.commit();
      // The grin: wider each time a shot goes through it. Before every swoop it flares: wide open
      // and bright for the length of the tell (the brightening is dropped under reduced flash).
      const wide = 1 + 0.3 * v.widen + 0.62 * o.tell + 0.05 * Math.sin(time * 1.3);
      const lit = o.tell * (o.bright ?? 0);
      ghostGrin.color.setScalar(1 + 1.7 * lit);
      solidGrin.emissiveIntensity = 0.9 * lit;
      const gape = 1 + 1.6 * o.tell + 0.9 * o.dive * (1 - o.snap) - 0.45 * o.snap - 0.4 * o.fold + 0.5 * v.ripple;
      const alone = lerp(1.3, 1, v.solidK); // with no face round it, it is bigger
      grin.scale.set(wide * alone, Math.max(0.3, gape) * alone, 1);
      grin.rotation.z = 0.08 * Math.sin(time * 0.7 + 1) * (1 - v.solidK); // alone, it hangs a little crooked
    }

    v.sync = (en, dt, time, eye, cfg, reduced) => {
      const c = (cfg && cfg.bat) || {};
      const s = batView(en, lastSim, cfg);
      v.age += dt;
      v.eye.copy(eye);
      g.position.set(s.x, s.y, s.z);
      g.rotation.y = s.facing;
      const solid = s.solid != null ? s.solid : !!v.solidEv;
      v.solidK = approach(v.solidK, solid ? 1 : 0, dt, solid ? 14 : 7);
      if (Math.abs(v.solidK - (solid ? 1 : 0)) < 0.01) v.solidK = solid ? 1 : 0;
      v.ripple = Math.max(0, v.ripple - dt / 0.35);
      v.flash = Math.max(0, v.flash - dt);
      v.flinch = Math.max(0, v.flinch - dt / 0.3);
      v.hurt = s.hurt;
      if ((s.tell || s.swooping) && act.tellT < 0 && act.strikeT < 0 && !v.hinted) { act.tellT = 0; act.tellDur = c.swoopTell || 0.4; }
      v.hinted = s.tell || s.swooping;
      actStep(act, dt, 0.7);
      const t = act.strikeT;
      const dive = t < 0 ? 0 : t < 0.22 ? smooth(t / 0.22) : 1 - smooth((t - 0.3) / 0.4);
      const snap = t < 0 ? 0 : smooth((t - 0.18) / 0.06);
      v.sweep = approach(v.sweep || 0, s.swooping ? 1 : 0, dt, 9);
      const tell = tellOf(act) * (1 - dive) * (1 - v.sweep);
      // A fat thing beats slowly; hurt, it labours and one wing starts to fail.
      v.beat += dt * TAU * (2.1 + 1.2 * tell + 0.9 * v.hurt * Math.abs(Math.sin(time * 1.7)));
      v.glance = Math.max(0, v.glance - dt);
      const want = v.glance > 0 ? v.glanceYaw : clamp(wrap(headingTo(eye.x - s.x, eye.z - s.z) - s.facing), -0.9, 0.9);
      v.lookAt = approach(v.lookAt, want, dt, 4);
      setBody(Math.max(v.solidK, 0.16 * v.ripple), v.flash > 0 && !reduced && v.solidK >= 0.99 ? 'flash' : 'solid');
      S.breathe(rig, time, { amount: 1, look: eye, wind: 0.6 * Math.sin(v.beat - 1.2) + dive });
      hd.pose({ brow: 0, frown: Math.max(tell, dive) });
      draw(time, { tell, bright: reduced ? 0 : 0.8 + 0.2 * Math.sin(time * 31), dive: Math.max(dive, 0.4 * v.sweep), snap, fold: 0, droop: clamp((v.hurt - 0.45) * 3), amp: 1 - 0.3 * tell });
      g.updateMatrixWorld(true);
      drops.step(dt, v.solidK > 0.9 && v.hurt > 0.2 ? 0.5 + 1.5 * v.hurt : 0, (out) => {
        if (hurt.pick(out)) g.worldToLocal(out); else out.set(0, hover - 0.4, 0);
      }, -s.y);
    };
    v.onEvent = (ev) => {
      if (actEvent(act, ev, () => ((lastSim && lastSim.cfg && lastSim.cfg.bat && lastSim.cfg.bat.swoopTell) || 0.4))) return;
      if (ev.type === 'solid') v.solidEv = !!ev.on;
      else if (ev.type === 'hit') {
        if (v.solidK < 0.5) { v.ripple = 1; return; }
        v.flash = 0.08; v.flinch = 1;
        g.updateMatrixWorld(true);
        belly.getWorldPosition(_c);
        const target = ev.y > _c.y + 0.2 ? hd.skull : belly;
        hurt.hit(target, ev, hitSize(ev));
        S.scar(target, ev, hitSize(ev) * 2.4, { strength: 0.6, dent: 0.2 });
      }
    };
    v.onWorld = (ev) => {
      if (v.deathT >= 0) return;
      if (ev.type === 'shot' && v.solidK < 0.5) {
        bodyG.getWorldPosition(_c); _c.y += CY;
        if (shotPasses(ev, _c, 0.75)) { v.ripple = 1; v.widen = Math.min(1, v.widen + 0.34); } // through it, and the grin widens
      } else if (ev.type === 'lanternFall') {
        v.glance = 1.2;
        v.glanceYaw = clamp(wrap(headingTo(ev.x - g.position.x, ev.z - g.position.z) - g.rotation.y), -1.1, 1.1);
      }
    };
    v.die = () => { v.deathT = 0; v.dropV = 0; v.solidK = 1; };
    // The wings shut and it comes down like a sack; the body stays where it fell.
    v.updateDeath = (dt, time) => {
      if (v.gone) return true;
      v.deathT += dt;
      const fold = smooth(v.deathT / 0.35);
      v.dropV += 9.8 * dt;
      v.drop = Math.min(hover - 0.6 + g.position.y, v.drop + v.dropV * dt);
      v.ripple = 0;
      setBody(1, v.deathT > 1 ? 'dead' : 'solid');
      hd.pose({ blink: [0.85 * fold, 1], frown: 0, look: [0, -0.2] });
      draw(time, { tell: 0, dive: 0, snap: 0, fold, droop: 0, amp: 1 - fold });
      drops.step(dt, 0, () => {}, 0);
      return false;
    };
    v.restore = () => { hurt.clear(); heal(); v.solidEv = null; v.solidK = 0; v.widen = 0; v.hurt = 0; act.tellT = -1; act.strikeT = -1; };
    v.dispose = () => { hurt.clear(); for (const m of ghost.values()) m.dispose(); ghostGrin.dispose(); ash.delete(solidGrin); solidGrin.dispose(); belly.geometry.dispose(); grinGeo.dispose(); };
    setBody(0, 'solid');
    return track(v, 'bat');
  }

  // ======================================================================================
  // The Smoke Caterpillar. A great pale grub draped over a toadstool, reared up at the front,
  // in a baby's bonnet, both upper hands on the stem of its pipe. Reads as a fat, placid infant.
  // What is off: the face is a child's and the eyes in it are an old man's, and they never
  // close. A slow wave runs up the body, tail to head, whether it breathes or not.
  // ======================================================================================
  const CT_N = 11;
  const CT_R = [0.13, 0.2, 0.27, 0.33, 0.36, 0.36, 0.34, 0.31, 0.29, 0.26, 0.22];
  const P3 = (list) => list.map((p) => V(p[0], p[1], p[2]));
  const CT = {
    rest: P3([[0.3, 0.12, 1.05], [0.34, 0.62, 0.85], [0.16, 0.86, 0.35], [-0.05, 0.88, -0.12], [-0.05, 1.0, -0.4], [0, 1.2, -0.42], [0, 1.37, -0.32]]),
    soft: P3([[0.3, 0.12, 1.05], [0.34, 0.62, 0.85], [0.16, 0.85, 0.35], [-0.05, 0.86, -0.14], [-0.05, 0.94, -0.5], [0.02, 1.1, -0.63], [0.03, 1.24, -0.62]]),
    rear: P3([[0.3, 0.16, 1.0], [0.34, 0.64, 0.8], [0.14, 0.88, 0.35], [-0.03, 0.94, 0.0], [0, 1.26, -0.1], [0, 1.64, 0.06], [0, 1.92, 0.22]]),
    lash: P3([[0.3, 0.3, 0.9], [0.3, 0.7, 0.62], [0.1, 0.84, 0.15], [0, 0.86, -0.55], [0, 0.84, -1.25], [0, 0.7, -1.95], [0, 0.55, -2.55]]),
    dead: P3([[0.42, 0.06, 1.2], [0.42, 0.3, 0.96], [0.2, 0.62, 0.45], [0, 0.66, -0.12], [0.02, 0.44, -0.75], [0.12, 0.15, -1.15], [0.28, 0.1, -1.5]]),
  };
  const GRUB = new THREE.Color(0xe9e2c8); const GRUB2 = new THREE.Color(0xd9cfae); const BRUISE = new THREE.Color(0x7d744e);

  const grubSegGeo = (() => {
    const parts = [S.skin([{ at: [0, -0.5, 0], r: 0.76 }, { at: [0, -0.2, 0], r: 1 }, { at: [0, 0.2, 0], r: 1 }, { at: [0, 0.5, 0], r: 0.76 }], {
      sides: 12, detail: 2, budget: 320, seed: 71, color: 0xffffff, noise: 0.05, grain: 1.2, mottle: 0.08, shade: 0.25, capLen: 0.5,
      colorAt: (u, a, c) => {
        const side = Math.min(Math.abs(a - Math.PI / 2), Math.abs(a - 1.5 * Math.PI));
        if (side < 0.2 && Math.abs(u - 0.5) < 0.09) c.set(0x3a2f22); // spiracle
        else if (Math.abs(a - Math.PI) < 0.28) c.multiplyScalar(0.86); // the line down the back
        if (u < 0.14 || u > 0.86) c.multiplyScalar(0.72); // the crease
        if (Math.cos(a) > 0.5) c.lerp(_col.set(0xf6e6cf), 0.5); // the belly
      },
    })];
    for (const sx of [-1, 1]) {
      parts.push(S.tint(new THREE.ConeGeometry(0.17, 0.36, 6).rotateX(-Math.PI / 2).rotateY(-sx * 0.5).translate(sx * 0.48, -0.05, -0.92), 0xd6c39c, 0.15, 3));
    }
    return S.merge(parts);
  })();

  sharedGeo.add(grubSegGeo);
  const toadstoolGeo = (() => S.merge([
    S.skin([{ at: [0.05, 0, 0.3], r: 0.3 }, { at: [0, 0.2, 0.3], r: 0.2 }, { at: [-0.03, 0.42, 0.3], r: 0.18 }, { at: [0, 0.5, 0.3], r: 0.24 }], { sides: 9, detail: 2, color: 0xcfc6ad, color2: 0x8d8468, noise: 0.07, seed: 5, caps: 'flat' }),
    S.skin([
      { at: [0, 0.3, 0.3], r: 0.45, color: 0x4a4034 }, { at: [0, 0.36, 0.3], r: 0.95, color: 0x6a5a44 }, { at: [0, 0.45, 0.3], r: 1.03, color: 0x94805c },
      { at: [0, 0.56, 0.3], r: 0.92, color: 0x9d8a66 }, { at: [0, 0.64, 0.3], r: 0.66, color: 0xa8956f }, { at: [0, 0.68, 0.3], r: 0.28, color: 0xa8956f },
    ], { sides: 16, detail: 2, budget: 420, color2: 0x6f6448, noise: 0.05, grain: 2.2, mottle: 0.2, seed: 6, caps: ['flat', 'round'], capLen: 0.1 }),
  ]))();

  function bonnet(size, cy) {
    const WHITE = 0xe6e0d0;
    const shell = new THREE.SphereGeometry(size * 1.09, 14, 9, -0.35, Math.PI + 0.7);
    shell.scale(1.08, 1.05, 1.04).translate(0, cy, 0.01);
    const p = shell.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < cy - size * 0.72) p.setY(i, cy - size * 0.72); // cut level under the ears
    shell.computeVertexNormals();
    const parts = [S.tint(shell, WHITE, 0.12, 3)];
    // The frill round the face, and the bow under the chin.
    const frill = new THREE.TorusGeometry(size * 1.05, size * 0.13, 6, 26, Math.PI * 1.5).rotateZ(-Math.PI * 0.25);
    const fp = frill.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const a = Math.atan2(fp.getY(i), fp.getX(i));
      const k = 1 + 0.05 * Math.sin(a * 16);
      fp.setXYZ(i, fp.getX(i) * k * 1.06, fp.getY(i) * k, fp.getZ(i) + 0.03 * Math.sin(a * 16));
    }
    frill.computeVertexNormals();
    parts.push(S.tint(frill.translate(0, cy, -size * 0.36), 0xf1ecde, 0.1, 4));
    const RIB = 0x7d8a99;
    for (const sx of [-1, 1]) {
      parts.push(S.skin([{ at: [sx * size * 0.7, cy - size * 0.72, -size * 0.36], r: 0.012 }, { at: [sx * size * 0.4, cy - size * 1.02, -size * 0.62], r: 0.012 }, { at: [0, cy - size * 1.1, -size * 0.74], r: 0.012 }], { sides: 4, detail: 2, noise: 0, color: RIB, shade: 0 }));
      parts.push(S.tint(new THREE.SphereGeometry(1, 7, 5).scale(0.075, 0.04, 0.02).rotateZ(sx * 0.5).translate(sx * 0.07, cy - size * 1.1, -size * 0.78), RIB, 0.2, 8));
      parts.push(S.skin([{ at: [sx * 0.02, cy - size * 1.12, -size * 0.78], r: 0.016 }, { at: [sx * 0.05, cy - size * 1.5, -size * 0.74], r: 0.011 }], { sides: 4, detail: 1, noise: 0, color: RIB, shade: 0 }));
    }
    return parts;
  }

  function buildCaterpillar() {
    const seed = 71;
    const g = new THREE.Group();
    const stool = part(toadstoolGeo, M.skin, true);
    const segs = new THREE.InstancedMesh(grubSegGeo, M.skin, CT_N);
    segs.castShadow = true;
    segs.frustumCulled = false;
    const sockets = [];
    for (let i = 0; i < CT_N; i++) { const o = new THREE.Object3D(); g.add(o); sockets.push(o); }
    const size = 0.34;
    const cyGuess = 0.8 * 0.98 * size;
    const hd = S.head({
      size, seed, defects: ['eyesOld', 'noBlink'],
      face: {
        skin: 0xeedccb, eye: 0x9aa3a0,
        skull: { wide: 1.08, tall: 0.98, deep: 0.98, taper: 0.16, cheek: 0.13, chin: 0.02, brow: 0.015, noise: 0.02 },
        eyes: { lon: 0.4, r: 0.22, lat: 0.06 }, brow: { color: 0xb9a48c, thick: 0.02 },
        nose: { kind: 'button', size: 0.085, lat: -0.16 }, mouth: { lat: -0.5, width: 0.27, smile: 0.5, lip: 0xc0605a, teeth: 4, toothLen: 0.05 },
        cheek: { rosy: 0.85 }, ears: { kind: 'none' },
      },
      extras: bonnet(size, cyGuess),
    });
    const neck = new THREE.Group();
    neck.add(hd.group);
    const limbs = S.limbs(12, { seed, cast: false, taper: 0.6 });
    for (let i = 0; i < 12; i++) limbs.tone(i, i % 3 === 2 ? 0xeedccb : GRUB2);
    g.add(stool, segs, neck, limbs.mesh);

    const rig = { head: hd, seed, rate: 0.16 };
    const setLook = looks([segs, hd.skull, hd.jaw, hd.features, limbs.mesh]);
    const heal = keeper([hd.skull]);
    const hurt = S.wounds({ seed, pulp: 0xa8b05a, scab: 0x2a2a14 });
    const drops = S.drips(g, 4, 0xcfd28a, seed);
    const act = makeAct();
    const pts = CT.rest.map((p) => p.clone());
    const nodes = []; for (let i = 0; i <= CT_N; i++) nodes.push(V());
    const defl = new Float32Array(CT_N);
    const sh = V(); const el = V(); const hand = V(); const tmp = V(); const stemA = V(); const stemB = V();
    const v = {
      g, age: 0, deathT: -1, dousedEv: null, soft: 0, startle: 0, flash: 0, flinch: 0, hurt: 0, pleased: 0, eye: V(0, 1.6, -5),
      facing: null, puffAt: 0,
    };
    const cat = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

    function draw(time, o) {
      // o: soft, tell, lash, dead, puff (0..1 through a draw on the pipe, or -1), pipe (Vector3 in g space or null)
      for (let i = 0; i < 7; i++) {
        pts[i].copy(CT.rest[i]).lerp(CT.soft[i], o.soft).lerp(CT.rear[i], o.tell).lerp(CT.lash[i], o.lash).lerp(CT.dead[i], o.dead);
        if (i > 3) pts[i].x += 0.03 * Math.sin(time * 0.5 + i) * (1 - o.dead) + 0.05 * o.soft * Math.sin(time * 0.33 + i * 0.6);
      }
      for (let i = 0; i <= CT_N; i++) {
        const f = (i / CT_N) * 6; const k = Math.min(5, Math.floor(f)); const t = f - k;
        const p0 = pts[Math.max(0, k - 1)]; const p1 = pts[k]; const p2 = pts[k + 1]; const p3 = pts[Math.min(6, k + 2)];
        nodes[i].set(cat(p0.x, p1.x, p2.x, p3.x, t), cat(p0.y, p1.y, p2.y, p3.y, t), cat(p0.z, p1.z, p2.z, p3.z, t));
      }
      const inhale = o.puff >= 0 && o.puff < 0.4 ? Math.sin((o.puff / 0.4) * Math.PI) : 0;
      for (let i = 0; i < CT_N; i++) {
        const so = sockets[i];
        _d.subVectors(nodes[i + 1], nodes[i]);
        const len = Math.max(1e-3, _d.length());
        so.position.copy(nodes[i]).addScaledVector(_d, 0.5);
        so.quaternion.setFromUnitVectors(UP, _d.multiplyScalar(1 / len));
        // The wave runs tail to head and does not care whether it is breathing.
        const wave = 1 + 0.055 * Math.sin(time * 1.15 - i * 0.75) * (1 - o.dead);
        const r = CT_R[i] * wave * (1 + 0.1 * inhale * clamp((i - 5) / 4)) * (1 - 0.4 * defl[i]) * (1 - 0.12 * v.hurt - 0.3 * o.dead) * (1 + 0.1 * o.tell - 0.12 * o.lash);
        so.scale.set(r, len * 1.28, r * (1 - 0.25 * o.dead));
        so.updateMatrix();
        segs.setMatrixAt(i, so.matrix);
        segs.setColorAt(i, _col.copy(i % 2 ? GRUB : GRUB2).lerp(BRUISE, clamp(0.75 * defl[i] + 0.25 * v.hurt)));
      }
      segs.instanceMatrix.needsUpdate = true;
      if (segs.instanceColor) segs.instanceColor.needsUpdate = true;
      // The head rides the last segment, a little more upright than the body under it.
      _d.subVectors(nodes[CT_N], nodes[CT_N - 1]).normalize();
      neck.position.copy(nodes[CT_N]).addScaledVector(_d, -0.06);
      neck.quaternion.setFromUnitVectors(UP, _d).slerp(_q.identity(), 0.55 - 0.3 * o.dead);
      neck.rotateY(v.headYaw || 0);
      neck.rotateX(0.14 * inhale - 0.25 * o.startle);
      neck.updateMatrix();

      // Four small arms off the reared segments. The upper pair hold the pipe stem.
      const mouth = hd.at(0, -0.5, 0.05).applyMatrix4(hd.group.matrix).applyMatrix4(neck.matrix);
      if (o.pipe) { stemA.copy(mouth).lerp(o.pipe, 0.3); stemB.copy(mouth).lerp(o.pipe, 0.58); }
      for (let a = 0; a < 4; a++) {
        const sx = a % 2 ? -1 : 1; const upper = a < 2;
        const so = sockets[upper ? CT_N - 1 : CT_N - 3];
        sh.set(sx * 0.82, 0.1, -0.5).applyMatrix4(so.matrix);
        if (upper) {
          hand.set(sx * 0.6, -0.7, -1.5).applyMatrix4(so.matrix); // fallen to its belly
          if (o.pipe) hand.lerp(tmp.copy(sx > 0 ? stemA : stemB).setX((sx > 0 ? stemA : stemB).x + sx * 0.03), (1 - o.soft) * (1 - o.dead));
        } else {
          const drum = 0.03 * Math.max(0, Math.sin(time * 2.2 + a)) * (1 - o.dead);
          hand.set(sx * 0.32, -0.2 + drum * 3, -1.22 - drum * 2).applyMatrix4(so.matrix);
        }
        if (o.tell || o.lash) hand.lerp(tmp.set(sx * (1.5 + 0.5 * o.lash), 0.9, -0.9).applyMatrix4(so.matrix), Math.max(o.tell, o.lash));
        reachClamp(sh, hand, 0.57);
        S.ik2(sh, hand, 0.3, 0.28, tmp.set(sx, -0.6, 0.2), el);
        limbs.place(a * 3, sh, el, 0.05);
        limbs.place(a * 3 + 1, el, hand, 0.04);
        limbs.place(a * 3 + 2, hand, tmp.copy(hand).add(_a.subVectors(hand, el).normalize().multiplyScalar(0.07)), 0.045);
      }
      limbs.commit();
    }

    v.sync = (en, dt, time, eye, cfg, reduced) => {
      const c = (cfg && cfg.caterpillar) || {};
      const s = caterpillarView(en, lastSim, cfg);
      v.age += dt;
      v.eye.copy(eye);
      const doused = s.doused != null ? s.doused : !!v.dousedEv;
      if (doused && v.soft === 0 && v.startle === 0 && v.age > 0.2) v.startle = 1;
      v.soft = approach(v.soft, doused ? 1 : 0, dt, 1.6);
      if (Math.abs(v.soft - (doused ? 1 : 0)) < 0.005) v.soft = doused ? 1 : 0;
      v.startle = Math.max(0, v.startle - dt / 0.9);
      // Smoking, it faces its pipe; put out, it turns to whoever did it, slowly.
      const toPipe = headingTo(s.pipe.x - s.x, s.pipe.z - s.z);
      const toEye = headingTo(eye.x - s.x, eye.z - s.z);
      if (v.facing == null) v.facing = doused ? toEye : toPipe;
      v.facing = turn(v.facing, doused ? toEye : toPipe, dt, doused ? 1.3 : 4);
      g.position.set(s.x, s.y, s.z);
      g.rotation.y = v.facing;
      g.updateMatrixWorld(true);
      const pipe = doused && v.soft > 0.98 ? null : g.worldToLocal(_c.set(s.pipe.x, num(s.pipe.y, 1.4), s.pipe.z)).clone();
      v.headYaw = approach(v.headYaw || 0, clamp(wrap(toEye - v.facing), -1.2, 1.2) * (doused ? 1 : 0.85), dt, 2.5);

      if ((s.tell || s.whipping) && act.tellT < 0 && act.strikeT < 0 && !v.hinted) { act.tellT = 0; act.tellDur = c.whipTell || 0.8; }
      v.hinted = s.tell || s.whipping;
      actStep(act, dt, 1.4);
      const t = act.strikeT;
      const lash = t < 0 ? 0 : t < 0.14 ? smooth(t / 0.14) : t < 0.34 ? 1 : 1 - smooth((t - 0.34) / 1.0); // out fast, back slowly
      const tell = tellOf(act) * (1 - lash);
      v.hurt = s.hurt;
      v.flash = Math.max(0, v.flash - dt);
      v.flinch = Math.max(0, v.flinch - dt / 0.4);
      v.pleased = Math.max(0, v.pleased - dt / 0.6);
      setLook(v.flash > 0 && !reduced ? 'flash' : 'live');
      const puff = doused ? -1 : frac((time + 1.3) / 5.2) / 0.55;
      S.breathe(rig, time, { amount: 0.6, look: eye });
      hd.pose({
        jaw: Math.max(puff > 0.55 && puff < 1 ? 0.3 * Math.sin(((puff - 0.55) / 0.45) * Math.PI) : 0, 0.8 * v.startle, 0.9 * lash, 0.4 * tell, 0.5 * v.flinch),
        brow: Math.max(0.9 * v.startle, 0.6 * v.pleased) - 0.5 * tell, frown: Math.max(tell, lash, v.soft * 0.35),
      });
      draw(time, { soft: v.soft * (1 - tell) * (1 - lash), tell, lash, dead: 0, puff: puff > 1 ? -1 : puff, startle: v.startle, pipe });
      drops.step(dt, v.hurt > 0.15 ? 0.5 + 1.6 * v.hurt : 0, (out) => {
        if (hurt.pick(out)) g.worldToLocal(out); else out.set(0, 0.9, -0.3);
      }, -s.y);
    };
    v.onEvent = (ev) => {
      if (actEvent(act, ev, () => ((lastSim && lastSim.cfg && lastSim.cfg.caterpillar && lastSim.cfg.caterpillar.whipTell) || 0.8))) return;
      if (ev.type !== 'hit') return;
      v.flash = 0.08; v.flinch = 1;
      g.updateMatrixWorld(true);
      neck.getWorldPosition(_c);
      if (ev.zone === 'head' || ev.y > _c.y + 0.05) {
        hurt.hit(hd.skull, ev, hitSize(ev));
        S.scar(hd.skull, ev, hitSize(ev) * 2.2, { hex: 0x4a4a22, strength: 0.6, dent: 0.15 });
        return;
      }
      // The nearest segment takes it: a wound on its skin, and it goes slack there.
      let best = 0; let bd = Infinity;
      for (let i = 0; i < CT_N; i++) {
        const d = sockets[i].getWorldPosition(_a).distanceToSquared(_b.set(ev.x, ev.y, ev.z));
        if (d < bd) { bd = d; best = i; }
      }
      const so = sockets[best];
      so.worldToLocal(_b.set(ev.x, ev.y, ev.z));
      _a.set(_b.x, 0, _b.z);
      if (_a.lengthSq() < 1e-6) _a.set(0, 0, -1);
      _a.normalize();
      hurt.add(so, _c.copy(_a).multiplyScalar(1.03).setY(clamp(_b.y, -0.3, 0.3)), _a, hitSize(ev) / Math.max(0.1, so.scale.x));
      defl[best] = Math.min(1, defl[best] + 0.3);
      if (best > 0) defl[best - 1] = Math.min(1, defl[best - 1] + 0.1);
      if (best < CT_N - 1) defl[best + 1] = Math.min(1, defl[best + 1] + 0.1);
    };
    v.onWorld = (ev) => {
      if (ev.type === 'doused') v.dousedEv = true;
      else if (ev.type === 'smokeTick') v.pleased = 1;
    };
    v.die = () => { v.deathT = 0; setLook('live'); };
    // It lets go of the toadstool a segment at a time and lies along the ground. The eyes stay open.
    v.updateDeath = (dt, time) => {
      if (v.gone) return true;
      v.deathT += dt;
      const k = smooth(v.deathT / 1.5);
      if (v.deathT > 1.6) setLook('dead');
      hd.pose({ jaw: 0.5 * k, brow: 0.3, frown: 0, blink: 0, look: [0.3, -0.25] });
      draw(time, { soft: v.soft * (1 - k), tell: 0, lash: 0, dead: k, puff: -1, startle: 0, pipe: null });
      drops.step(dt, 0, () => {}, 0);
      return false;
    };
    v.restore = () => { hurt.clear(); heal(); defl.fill(0); v.dousedEv = null; v.soft = 0; v.startle = 0; v.hurt = 0; v.facing = null; act.tellT = -1; act.strikeT = -1; setLook('live'); };
    v.dispose = () => { hurt.clear(); segs.dispose(); };
    // Posed at rest once as built, as the Undertaker is: a borrowed build (buildCreature, the castle's
    // figure-mirror) is never synced, and without this its segments and head sit at the origin (issue 24).
    draw(0, { soft: 0, tell: 0, lash: 0, dead: 0, puff: -1, startle: 0, pipe: null });
    return track(v, 'caterpillar');
  }

  sharedGeo.add(toadstoolGeo);
  actors.register('rabbit', buildRabbit);
  actors.register('hatter', buildHatter);
  actors.register('bat', buildBat);
  actors.register('caterpillar', buildCaterpillar);

  // A body for layBody: the creature's own view, seated where it fell and run to the end of
  // its own death, so the fallen look exactly as they did when they went down.
  const BUILDERS = { rabbit: buildRabbit, hatter: buildHatter, bat: buildBat, caterpillar: buildCaterpillar };
  if (!opts.isolated) bodyMaker = (body, sim) => { // an isolated host (buildCreature) never replaces the court's body maker
    const build = body && BUILDERS[body.enemy];
    if (!build || !sim) return null;
    for (const o of alive) if (o.type === body.enemy && o.deathT >= 0 && !o.gone) return null;
    lastSim = sim;
    const cfg = sim.cfg || {};
    const v = build();
    const heading = body.enemy === 'rabbit' ? seatFacing : frac(num(body.id) * 0.381 + 0.17) * TAU;
    const e = { id: body.id, type: body.enemy, x: num(body.x), y: 0, z: num(body.z), heading, speedNow: 0, hp: 0, state: 'dead', dead: true, solid: true, doused: true };
    v.sync(e, 0, 0, _c.set(e.x - Math.sin(heading) * 4, 1.65, e.z - Math.cos(heading) * 4), cfg, true);
    v.die({}, cfg);
    for (let i = 0; i < 100; i++) v.updateDeath(0.05, 0, true);
    scene.add(v.g);
    return { g: v.g, id: body.id, type: body.enemy, dispose() { scene.remove(v.g); v.dispose(); } };
  };

  if (opts.isolated) return; // a borrowed-builder host needs no pins, rats, leaves or grin: none of them is built

  // ======================================================================================
  // The dressing layer: hat-pins in flight and stuck, the rats, the grin.
  // ======================================================================================

  // ---- pins: one instanced mesh, fixed capacity (security A3) ----
  const PIN_FLIGHT = 12; const PIN_STUCK = 32;
  const pinMesh = new THREE.InstancedMesh(hatPin(0.3, 0xf3eedf, 0.006, 0.022), M.metal, PIN_FLIGHT + PIN_STUCK);
  pinMesh.frustumCulled = false;
  pinMesh.count = 0;
  pinMesh.visible = false;
  scene.add(pinMesh);
  const flying = []; // last frame's pins in flight: { x, y, z, dx, dy, dz }
  for (let i = 0; i < PIN_FLIGHT; i++) flying.push({ on: false, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: -1 });
  const stuck = []; // a ring: the oldest is overwritten
  for (let i = 0; i < PIN_STUCK; i++) stuck.push({ on: false, key: null, x: 0, y: 0, z: 0, dx: 0, dy: -0.3, dz: -1, seen: false });
  let stuckNext = 0;
  const pinKey = (p) => `${num(p.x).toFixed(2)},${num(p.z).toFixed(2)}`; // by place: the event's id is the Hatter's, not the pin's

  function stickPin(p) {
    const key = pinKey(p);
    for (const s of stuck) if (s.on && s.key === key) return s;
    const s = stuck[stuckNext];
    stuckNext = (stuckNext + 1) % PIN_STUCK;
    s.on = true; s.key = key; s.x = num(p.x); s.z = num(p.z);
    // Its angle is the angle it flew at: the nearest pin that was in the air a frame ago.
    let best = null; let bd = 4;
    for (const f of flying) {
      if (!f.on) continue;
      const d = (f.x - s.x) ** 2 + (f.z - s.z) ** 2;
      if (d < bd) { bd = d; best = f; }
    }
    s.y = Number.isFinite(p.y) ? p.y : best ? Math.max(0.03, best.y) : 0.9;
    if (best) { s.dx = best.dx; s.dy = best.dy - 0.12; s.dz = best.dz; } else {
      const a = (s.x * 12.9898 + s.z * 78.233) % TAU;
      s.dx = Math.sin(a); s.dy = -0.35; s.dz = Math.cos(a);
    }
    return s;
  }

  function syncPins(sim) {
    let n = 0;
    const put = (x, y, z, dx, dy, dz, scale) => {
      _dummy.position.set(x, y, z);
      _dummy.quaternion.setFromUnitVectors(_a.set(0, 0, -1), _b.set(dx, dy, dz).normalize());
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      pinMesh.setMatrixAt(n++, _dummy.matrix);
    };
    const bolts = pinsInFlight(sim);
    for (let i = 0; i < PIN_FLIGHT; i++) {
      const b = bolts[i]; const f = flying[i];
      f.on = !!b;
      if (!b) continue;
      f.x = num(b.x); f.y = num(b.y, 1.4); f.z = num(b.z);
      const sp = Math.hypot(num(b.vx), num(b.vy), num(b.vz));
      if (sp > 1e-3) { f.dx = b.vx / sp; f.dy = num(b.vy) / sp; f.dz = b.vz / sp; }
      put(f.x, f.y, f.z, f.dx, f.dy, f.dz, 1.5);
    }
    // Where the rules keep the list, ours follows it: a pin they have dropped is dropped here.
    const list = pinsStuck(sim);
    if (list) {
      for (const s of stuck) s.seen = false;
      for (let i = Math.max(0, list.length - PIN_STUCK); i < list.length; i++) stickPin(list[i]).seen = true;
      for (const s of stuck) if (!s.seen) s.on = false;
    }
    for (const s of stuck) if (s.on) put(s.x + s.dx * 0.05, s.y + s.dy * 0.05, s.z + s.dz * 0.05, s.dx, s.dy, s.dz, 1);
    pinMesh.count = n;
    pinMesh.visible = n > 0;
    if (n) pinMesh.instanceMatrix.needsUpdate = true;
  }

  function clearPins() {
    for (const s of stuck) s.on = false;
    for (const f of flying) f.on = false;
    stuckNext = 0;
    pinMesh.count = 0;
    pinMesh.visible = false;
  }

  // ---- rats: one instanced mesh, at most twelve, in the darker bands ----
  const RATS = 12;
  const RAT_CAP = [0, 0, 4, 8, 12]; // by band: none in the bright first band
  const ratGeo = (() => {
    const HIDE = 0x3a3430;
    const parts = [S.skin([
      { at: [0, 0.032, -0.17], r: 0.008, color: 0x8a6a66 }, { at: [0, 0.045, -0.12], r: [0.024, 0.022] }, { at: [0, 0.052, -0.07], r: [0.03, 0.03] },
      { at: [0, 0.062, 0.02], r: [0.046, 0.05] }, { at: [0, 0.058, 0.1], r: [0.048, 0.046] }, { at: [0, 0.04, 0.155], r: 0.014 },
    ], { sides: 7, detail: 2, budget: 150, seed: 9, color: HIDE, color2: 0x55493f, noise: 0.08, rough: 0.12, mottle: 0.2, side: [1, 0, 0] })];
    parts.push(S.skin([{ at: [0, 0.035, 0.15], r: 0.009 }, { at: [0.02, 0.02, 0.25], r: 0.007 }, { at: [-0.02, 0.014, 0.34], r: 0.005 }, { at: [0.03, 0.012, 0.42], r: 0.002 }], { sides: 4, detail: 2, noise: 0, color: 0x8a6a66, shade: 0, caps: 'flat' }));
    for (const sx of [-1, 1]) {
      parts.push(S.tint(new THREE.SphereGeometry(0.016, 5, 4).scale(1, 1, 0.4).translate(sx * 0.022, 0.076, -0.085), 0x6a5550));
      parts.push(S.tint(new THREE.SphereGeometry(0.014, 4, 3).translate(sx * 0.035, 0.012, -0.03), 0x8a6a66));
      parts.push(S.tint(new THREE.SphereGeometry(0.016, 4, 3).translate(sx * 0.04, 0.012, 0.09), 0x8a6a66));
    }
    return S.merge(parts);
  })();
  const ratMesh = new THREE.InstancedMesh(ratGeo, M.skin, RATS);
  ratMesh.frustumCulled = false;
  ratMesh.count = 0;
  ratMesh.visible = false;
  scene.add(ratMesh);
  const rats = [];
  for (let i = 0; i < RATS; i++) rats.push({ on: false, x: 0, z: 0, hx: 0, hz: -1, speed: 3, gone: 0, len: 6, pauseAt: -1, pause: 0, age: 0, size: 1.5, guide: false });
  let ratTimer = 2;
  const guides = []; // nudge rats waiting to run: { t, x0, z0, x1, z1 }

  function bandAt(z) {
    const row = Math.floor((MAZE.z0 - z) / MAZE.cell);
    for (const b of MAZE.bands) if (row >= b.rows[0] && row <= b.rows[1]) return b.band;
    return 0;
  }

  function startRat(x0, z0, x1, z1, guide) {
    const r = rats.find((q) => !q.on);
    if (!r) return;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.5) return;
    Object.assign(r, {
      on: true, x: x0, z: z0, hx: (x1 - x0) / len, hz: (z1 - z0) / len, len, gone: 0, age: 0, guide,
      speed: guide ? 4.2 : 2.8 + Math.random() * 1.6, size: 1.3 + Math.random() * 0.6,
      pauseAt: !guide && Math.random() < 0.45 ? len * (0.35 + 0.3 * Math.random()) : -1, pause: 0,
    });
  }

  function spawnRat(pl) {
    // Across the path somewhere near the warden: out of one wall of trees and into the other.
    const col = clamp(Math.floor((pl.x - MAZE.x0) / MAZE.cell) + Math.round((Math.random() - 0.5) * 3), 0, MAZE.cols - 1);
    const row = clamp(Math.floor((MAZE.z0 - pl.z) / MAZE.cell) + Math.round((Math.random() - 0.3) * 3), MAZE.bands[1].rows[0], MAZE.bands[3].rows[1]);
    const cx = MAZE.x0 + MAZE.cell * (col + 0.5); const cz = MAZE.z0 - MAZE.cell * (row + 0.5);
    const off = (Math.random() - 0.5) * MAZE.cell * 0.8; const half = MAZE.cell * 0.49; const sgn = Math.random() < 0.5 ? -1 : 1;
    const ns = Math.random() < 0.5;
    const x0 = ns ? cx + off : cx - sgn * half; const z0 = ns ? cz - sgn * half : cz + off;
    const x1 = ns ? cx + off + (Math.random() - 0.5) * 2 : cx + sgn * half; const z1 = ns ? cz + sgn * half : cz + off + (Math.random() - 0.5) * 2;
    if (Math.hypot(x0 - pl.x, z0 - pl.z) < 2.5) return;
    if (Math.hypot(x0 - MAZE.pit.x, z0 - MAZE.pit.z) < MAZE.pit.r + MAZE.cell * 0.6) return; // not over the pit
    startRat(x0, z0, x1, z1, false);
  }

  function syncRats(sim, dt, time, eye) {
    const pl = playerOf(sim);
    if (pl && dt > 0) {
      const band = bandAt(pl.z);
      let live = 0;
      for (const r of rats) if (r.on && !r.guide) live++;
      ratTimer -= dt;
      if (ratTimer <= 0) {
        ratTimer = band >= 2 ? (0.8 + Math.random() * 2.6) / (band - 1) : 1;
        if (live < RAT_CAP[band]) spawnRat(pl);
      }
      for (let i = guides.length - 1; i >= 0; i--) {
        guides[i].t -= dt;
        if (guides[i].t <= 0) { const q = guides[i]; guides.splice(i, 1); startRat(q.x0, q.z0, q.x1, q.z1, true); }
      }
    }
    let n = 0;
    for (const r of rats) {
      if (!r.on) continue;
      r.age += dt;
      let sit = 0;
      if (r.pauseAt >= 0 && r.gone >= r.pauseAt && r.pause < 1.1) {
        // It stops, sits up and looks at you. It wants nothing. Then it goes on.
        r.pause += dt;
        sit = smooth(r.pause / 0.12) * (1 - smooth((r.pause - 0.95) / 0.15));
      } else {
        const burst = 1 + 0.35 * Math.sin(r.age * 9 + r.len);
        r.gone += r.speed * burst * dt;
        r.x += r.hx * r.speed * burst * dt; r.z += r.hz * r.speed * burst * dt;
      }
      if (r.gone >= r.len) { r.on = false; continue; }
      const k = smooth(r.gone / 0.5) * smooth((r.len - r.gone) / 0.5) * r.size;
      const run = 1 - sit;
      let yaw = headingTo(r.hx, r.hz) + 0.12 * Math.sin(r.age * 22) * run;
      if (sit) yaw = turn(yaw, headingTo(eye.x - r.x, eye.z - r.z), sit, 1);
      _dummy.position.set(r.x, 0.012 * Math.abs(Math.sin(r.age * 24)) * run, r.z);
      _dummy.rotation.set(0.95 * sit + 0.08 * Math.sin(r.age * 24) * run, yaw, 0);
      _dummy.scale.set(k, k * (1 + 0.08 * Math.sin(r.age * 24) * run), k * (1 - 0.12 * sit));
      _dummy.updateMatrix();
      ratMesh.setMatrixAt(n++, _dummy.matrix);
    }
    ratMesh.count = n;
    ratMesh.visible = n > 0;
    if (n) ratMesh.instanceMatrix.needsUpdate = true;
  }

  function clearRats() {
    for (const r of rats) r.on = false;
    guides.length = 0;
    ratMesh.count = 0;
    ratMesh.visible = false;
    ratTimer = 2;
  }

  // ---- the grin: the one jump scare. It does nothing but appear. ----
  const scareMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const scare = part(S.grin({ width: 0.82, teeth: 38, smile: 0.62, lip: 0x7a0f14, tooth: 0xefe8d4, sharp: true, seed: 13 }), scareMat);
  scare.visible = false;
  const leafGeo = S.tint(new THREE.CircleGeometry(0.05, 5).scale(1, 0.55, 1), 0x8a7b45, 0.3, 2);
  const leaves = [0, 1].map((i) => { const m = part(leafGeo, M.cloth); m.visible = false; scene.add(m); return { m, t: -1, x: 0, y: 0, z: 0, s: i ? 1 : -1 }; });
  scene.add(scare);
  let scareT = -1;
  const SCARE_LEN = 0.44;

  function startScare(ev, eye) {
    const y = Number.isFinite(ev.y) ? ev.y : 1.6;
    scare.position.set(ev.x, y, ev.z);
    scare.rotation.set(0, headingTo(eye.x - ev.x, eye.z - ev.z), 0.06);
    scareT = 0;
    leaves.forEach((l, i) => { l.t = -1; l.x = ev.x + (i ? 0.22 : -0.18); l.y = y - 0.05 + 0.1 * i; l.z = ev.z + (i ? -0.05 : 0.08); });
  }

  function syncScare(dt, time) {
    if (scareT >= 0) {
      scareT += dt;
      const k = scareT / SCARE_LEN;
      if (k >= 1) {
        scareT = -1;
        scare.visible = false;
        for (const l of leaves) l.t = 0;
      } else {
        scare.visible = true;
        const pop = smooth(k / 0.12);
        scare.scale.set((0.75 + 0.25 * pop) * (1 + 0.28 * k), (0.6 + 0.4 * pop) * (1 + 1.1 * smooth(k / 0.7)) * (1 - 0.8 * smooth((k - 0.86) / 0.14)), 1);
        // The brightening is the flash; with reduced flash it appears and goes without it.
        const bright = reducedFlash ? 1 : 1 + 0.9 * Math.sin(Math.PI * clamp(k / 0.5));
        scareMat.color.setScalar(bright);
      }
    }
    // Two leaves, turning, where it was.
    for (const l of leaves) {
      if (l.t < 0) { l.m.visible = false; continue; }
      l.t += dt;
      const y = Math.max(0.02, l.y - 0.55 * l.t - 0.12 * l.t * l.t);
      const down = y <= 0.021;
      if (l.t > 7) { l.t = -1; l.m.visible = false; continue; }
      l.m.visible = true;
      l.m.position.set(l.x + (down ? 0 : 0.12 * Math.sin(l.t * 2.6 + l.s)), y, l.z + (down ? 0 : 0.1 * Math.cos(l.t * 2.1)));
      if (down) l.m.rotation.set(-Math.PI / 2, 0, l.s * 1.1);
      else l.m.rotation.set(l.t * 3.1 * l.s, l.t * 4.3, l.t * 1.7);
      l.m.scale.setScalar(l.t > 6 ? 7 - l.t : 1);
    }
  }

  function clearScare() {
    scareT = -1;
    scare.visible = false;
    for (const l of leaves) { l.t = -1; l.m.visible = false; }
  }

  const lastEye = V(0, 1.65, 0);
  actors.addLayer({
    setReducedFlash(flag) { reducedFlash = !!flag; },
    onEvent(ev) {
      switch (ev.type) {
        case 'pinStick': stickPin(ev); break;
        case 'grin': startScare(ev, lastEye); break;
        case 'nudge':
          // The Rabbit's nudge: rats run from his glade toward the ingredient not yet found.
          if (/rabbit|salad/i.test(String(ev.puzzle)) && Number.isFinite(ev.x) && Number.isFinite(ev.z)) {
            const gl = MAZE.glades[0];
            const d = Math.hypot(ev.x - gl.x, ev.z - gl.z) || 1;
            for (let i = 0; i < 3; i++) guides.push({ t: i * 0.9, x0: gl.x + (i - 1) * 0.5, z0: gl.z + 1, x1: gl.x + ((ev.x - gl.x) / d) * Math.min(d, 16), z1: gl.z + ((ev.z - gl.z) / d) * Math.min(d, 16) });
          }
          break;
        case 'restored':
          // Everything not marked done is whole again; a body whose gate is not done goes.
          clearPins();
          for (const v of alive) {
            if (v.deathT >= 0 && !gateDone(lastSim, v.type)) v.gone = true;
            else if (v.deathT < 0 && v.restore) v.restore();
          }
          break;
        default:
      }
      if (ev.type === 'shot' || ev.type === 'doused' || ev.type === 'smokeTick' || ev.type === 'lanternFall') {
        for (const v of alive) if (v.onWorld) v.onWorld(ev);
      }
    },
    clear() {
      clearPins();
      clearRats();
      clearScare();
    },
    sync(sim, dt, time, eye) {
      lastSim = sim;
      lastEye.copy(eye);
      if (!sim || !sim.cfg || sim.cfg.room !== 'court') {
        if (pinMesh.visible || ratMesh.visible || scare.visible || leaves[0].m.visible) { clearPins(); clearRats(); clearScare(); }
        return;
      }
      syncPins(sim);
      syncRats(sim, dt, time, eye);
      syncScare(dt, time);
    },
  });
}

// ---- the castle's figure-mirror borrows a forest creature (castle design, Decisions) ----------
let creatureHost = null; // a private registerBeasts: its own scene, materials and views; the court's state is untouched

/**
 * buildCreature(kind, cfg) -> { g, dispose } | null: a fresh, un-parented model of 'rabbit', 'hatter' or
 * 'caterpillar', made by the same builders the court's gate creatures use. It runs them in a private
 * host (registerBeasts with isolated: true), so it never touches the court's body maker, views or scene.
 */
export function buildCreature(kind, cfg = {}) {
  if (kind !== 'rabbit' && kind !== 'hatter' && kind !== 'caterpillar') return null;
  if (!creatureHost) {
    const made = {};
    registerBeasts({ register(type, factory) { made[type] = factory; }, addLayer() {} }, new THREE.Scene(), { isolated: true });
    creatureHost = made;
  }
  const view = creatureHost[kind]({}, cfg);
  return { g: view.g, dispose() { view.dispose(); } };
}
