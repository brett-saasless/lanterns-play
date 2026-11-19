// Cave creatures and hazards: Lurch (an armoured beetle), Weeper (a walking stalk), Cantor,
// globs with their landing markers, and pools. Built from primitives with shared geometries
// and materials. Poses are driven by entity state (e.state, e.timer, e.stun, e.speedNow, e.y)
// and by sim events; a hit leaves a wound where it landed, and damage shows as it mounts.

import * as THREE from 'three';
import { CAVE, mergeGeometries, tint, glowTexture } from './cave.js';
import { createWater } from './water.js';
import { WAYOUT } from '../logic/wayout.js'; // #29: the Cantor's last blast
import { SONG_NOTES } from '../logic/cantorsong.js'; // the Cantor's song: a ring off its head with each note

const HIDE = CAVE.indigo;
const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _d = V(0, 0, 0);
const _p = V(0, 0, 0);
const _q = new THREE.Quaternion();
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const smooth = (k) => k * k * (3 - 2 * k);
const approach = (cur, goal, dt, rate) => cur + (goal - cur) * Math.min(1, dt * rate);
const frac = (x) => x - Math.floor(x);

// One limb segment: a capsule 1 long on Y. Placed between two points by scale and rotation.
const SEG_R = 0.12;
function segmentGeometry(hex) {
  return tint(new THREE.CapsuleGeometry(SEG_R, 1 - 2 * SEG_R, 3, 8), hex);
}

function placeSeg(obj, a, b, r) {
  _d.subVectors(b, a);
  const len = Math.max(1e-4, _d.length());
  obj.position.copy(a).addScaledVector(_d, 0.5);
  obj.quaternion.setFromUnitVectors(UP, _d.multiplyScalar(1 / len));
  obj.scale.set(r / SEG_R, len, r / SEG_R);
}

/** A static limb segment as geometry, for merging into a body. */
function capsuleBetween(a, b, r, hex) {
  const g = segmentGeometry(hex);
  _d.subVectors(b, a);
  const len = _d.length();
  g.scale(r / SEG_R, len, r / SEG_R);
  g.applyQuaternion(_q.setFromUnitVectors(UP, _d.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Two-bone joint: where the knee sits between hip and foot, bending toward `bend`. */
function ik2(hip, foot, l1, l2, bend, knee) {
  _d.subVectors(foot, hip);
  const L = Math.max(1e-3, Math.min(_d.length(), (l1 + l2) * 0.999));
  _d.normalize();
  const ca = Math.max(-1, Math.min(1, (l1 * l1 + L * L - l2 * l2) / (2 * l1 * L)));
  const sa = Math.sqrt(1 - ca * ca);
  _p.copy(bend).addScaledVector(_d, -bend.dot(_d));
  if (_p.lengthSq() < 1e-6) _p.set(0, 1, 0);
  _p.normalize();
  knee.copy(hip).addScaledVector(_d, ca * l1).addScaledVector(_p, sa * l1);
}

function markerTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.save();
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2);
  g.clip();
  g.strokeStyle = 'rgba(255,79,139,0.5)';
  g.lineWidth = 3;
  for (let x = -s; x < s * 2; x += 13) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + s, s);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = 'rgba(255,79,139,1)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 5, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function poolTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const blob = (x, y, r, col) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, col);
    grad.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(s / 2, s / 2, s * 0.46, 'rgba(255,79,139,0.75)');
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * s * 0.36;
    blob(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 10 + Math.random() * 26, Math.random() < 0.5 ? 'rgba(255,150,185,0.55)' : 'rgba(150,20,70,0.6)');
  }
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + Math.random() * 0.2;
    const d = s * (0.37 + Math.random() * 0.07);
    blob(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 9 + Math.random() * 12, 'rgba(255,79,139,0.9)');
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Registers the cave's creature factories and its hazard layer with the actors module. */
export function registerFauna(actors, scene) {
  // The running water of the Rose Court and its wood (water.js) is mounted here, the one actors
  // hook this module owns; it is a layer like any other and draws only in the court's rig.
  actors.addLayer(createWater(scene));
  // ---- shared materials ------------------------------------------------------------------
  const flesh = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.18 });
  const blinkMat = new THREE.MeshStandardMaterial({ color: CAVE.bone, emissive: CAVE.bone, emissiveIntensity: 0.85, roughness: 0.5 });
  const deadMat = new THREE.MeshStandardMaterial({ color: 0x77746a, roughness: 0.75, metalness: 0 });
  const pinkMat = new THREE.MeshBasicMaterial({ color: CAVE.pink });
  const sacMat = new THREE.MeshStandardMaterial({
    color: 0x4a3a6a, emissive: CAVE.pink, emissiveIntensity: 0.06, roughness: 0.12, metalness: 0,
    transparent: true, opacity: 0.5, depthWrite: false,
  });
  const glow = glowTexture();
  const pinkHalo = new THREE.SpriteMaterial({
    map: glow, color: CAVE.pink, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8,
  });

  const segGeo = segmentGeometry(HIDE);
  const coreGeo = new THREE.SphereGeometry(0.1, 10, 8);

  function setMat(v, mat) {
    if (v.mat === mat) return;
    v.mat = mat;
    for (const m of v.parts) m.material = mat;
  }

  function caster(geo, mat = flesh) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    return m;
  }

  // ---- wounds ------------------------------------------------------------------------------
  // A wound is a torn dark patch with wet pulp showing and cracks running out of it. It is
  // unlit, so the pulp glows faintly in the dark. It faces +Z and is scaled to the blast.
  const woundGeo = (() => {
    const scab = new THREE.CircleGeometry(1, 10);
    const sp = scab.attributes.position;
    for (let i = 1; i < sp.count; i++) {
      const a = Math.atan2(sp.getY(i), sp.getX(i));
      const k = 0.8 + 0.3 * Math.sin(a * 3 + 0.7) + 0.18 * Math.sin(a * 5 + 2);
      sp.setXY(i, sp.getX(i) * k, sp.getY(i) * k);
    }
    const parts = [tint(scab, 0x07050a)];
    const pulp = new THREE.SphereGeometry(0.42, 7, 5);
    pulp.scale(1, 0.8, 0.3);
    pulp.translate(0.08, -0.05, 0.02);
    parts.push(tint(pulp, 0x8e2450));
    [0.5, 2.4, 4.3].forEach((a, i) => {
      const crack = new THREE.BoxGeometry(0.06, 0.45 + 0.3 * (i % 2), 0.02);
      crack.translate(0, 0.95 + 0.15 * (i % 2), 0);
      crack.rotateZ(a);
      parts.push(tint(crack, 0x07050a));
    });
    return mergeGeometries(parts);
  })();
  const woundMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const FRONT = V(0, 0, 1);
  const MAX_WOUNDS = 9;
  /** Puts a wound on `parent` at local point `at`, facing local direction `out`. */
  function addWound(v, parent, at, out, size) {
    let m = v.wounds.length >= MAX_WOUNDS ? v.wounds.shift() : null;
    if (m) m.parent.remove(m);
    else m = new THREE.Mesh(woundGeo, woundMat);
    m.position.copy(at).addScaledVector(out, 0.012);
    m.quaternion.setFromUnitVectors(FRONT, out);
    m.rotateZ(Math.random() * 6.283);
    m.scale.setScalar(size);
    parent.add(m);
    v.wounds.push(m);
    return m;
  }
  // Ichor beads that fall from a hurt creature.
  const ichorGeo = new THREE.SphereGeometry(0.02, 6, 5);
  function ichorDrops(g, n) {
    const drops = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(ichorGeo, pinkMat);
      m.visible = false;
      g.add(m);
      drops.push({ m, t: Math.random(), from: V(0, 0, 0) });
    }
    return drops;
  }
  /** rate: drops per second per bead; pick(out) writes a start point in g-space. floorY: local floor. */
  function stepIchor(drops, dt, rate, pick, floorY) {
    for (const d of drops) {
      if (rate <= 0 && !d.m.visible) continue;
      d.t += dt * Math.max(rate, 0.6);
      if (d.t >= 1) {
        d.t = 0;
        d.m.visible = rate > 0;
        if (rate > 0) pick(d.from);
      }
      if (!d.m.visible) continue;
      const fall = d.t / Math.max(rate, 0.6); // seconds since release
      const y = d.from.y - 4.9 * fall * fall;
      d.m.position.set(d.from.x, y, d.from.z);
      d.m.scale.set(1, 1 + fall * 3, 1);
      if (y < floorY) d.m.visible = false;
    }
  }

  // ======================================================================================
  // Lurch: a cave beetle the size of a dog. Overlapping armour plates over a soft body, six
  // jointed legs, antennae, mandibles. The armour is old: worn pale at the edges, pitted,
  // chipped. It scuttles on alternating tripods, gathers itself, and pounces through the air.
  // ======================================================================================
  const CHITIN = new THREE.Color(0x1b1f30);
  const WORN = new THREE.Color(0x7d7767);
  const RUST = new THREE.Color(0x4b2d22);
  const LICHEN = new THREE.Color(0x35503f);
  const hsh = (a, b, c) => {
    const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  // Pitted, scratched armour surface, shared by every plate.
  const armourTex = (() => {
    const s = 128;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 420; i++) {
      g.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.5})`;
      g.beginPath();
      g.arc(Math.random() * s, Math.random() * s, 0.5 + Math.random() * 1.8, 0, 6.3);
      g.fill();
    }
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.2 + Math.random() * 0.4})`;
      g.lineWidth = 0.5 + Math.random();
      const x = Math.random() * s;
      const y = Math.random() * s;
      const a = Math.random() * 6.3;
      const l = 6 + Math.random() * 30;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();
  const armour = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.5, metalness: 0.3, bumpMap: armourTex, bumpScale: 1.4, side: THREE.DoubleSide,
  });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0608, emissive: CAVE.pink, emissiveIntensity: 0.5, roughness: 0.1 });

  /**
   * One armour plate: a domed shell (w wide, h high, len front to back, centred on its own
   * origin) with a keel, a raised lip at the back, dents, and weathering painted per vertex.
   */
  function plateGeometry(w, h, len, seed, notch = 0) {
    const g = new THREE.SphereGeometry(1, 16, 7, 0, Math.PI * 2, 0, Math.PI * 0.56);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i);
      let y = p.getY(i);
      let z = p.getZ(i);
      const rim = 1 - Math.max(0, Math.min(1, (y + 0.18) / 0.5)); // 1 at the skirt
      const back = Math.max(0, Math.min(1, (z - 0.45) / 0.5)); // 1 at the trailing edge
      y += 0.07 * Math.exp(-(x * x) / 0.02) * (1 - rim); // keel
      const lip = 1 + 0.07 * back;
      x *= lip; y *= 1 + 0.1 * back;
      const dent = hsh(Math.round(x * 4), Math.round(z * 4), seed) > 0.8 ? -0.03 : 0;
      y += dent;
      // A chip bitten out of the skirt on one side.
      if (notch && Math.sign(x) === notch && rim > 0.55 && Math.abs(z - 0.1) < 0.45) y += 0.16 * (rim - 0.55) * 2;
      p.setXYZ(i, x * w, y * h, z * len);
      // Paint: dark chitin, worn pale along the skirt, the lip and the keel; rust and lichen in patches.
      const n1 = hsh(Math.round(x * 6), Math.round(z * 6), seed + 3);
      const n2 = hsh(Math.round(x * 2.5), Math.round(y * 2.5 + z * 2.5), seed + 9);
      const wear = Math.min(1, 0.75 * Math.pow(Math.max(rim, back), 2.2) + (n1 > 0.83 ? 0.55 : 0) + 0.25 * Math.exp(-(x * x) / 0.01) * (1 - rim));
      c.copy(CHITIN).multiplyScalar(0.85 + 0.3 * n2);
      if (n2 > 0.8) c.lerp(RUST, 0.3);
      else if (n2 < 0.12) c.lerp(LICHEN, 0.25);
      c.lerp(WORN, wear * 0.7);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  // Abdomen plates front to back: [z of the plate's centre, half width, height, half length].
  const TERGITES = [
    [0.0, 0.37, 0.27, 0.19],
    [0.2, 0.4, 0.3, 0.19],
    [0.39, 0.38, 0.28, 0.18],
    [0.56, 0.31, 0.22, 0.16],
    [0.7, 0.2, 0.15, 0.13],
  ];
  const tergiteGeos = [0, 1].map((variant) => TERGITES.map(([, w, h, len], i) => plateGeometry(w, h, len, 11 + i * 7 + variant * 40, (i + variant) % 3 === 1 ? (variant ? 1 : -1) : 0)));
  const shieldGeos = [0, 1].map((variant) => {
    // Pronotum: the big shield behind the head, with a blunt boss on each shoulder.
    const parts = [plateGeometry(0.4, 0.3, 0.27, 5 + variant * 13, variant ? -1 : 0)];
    for (const sx of [-1, 1]) {
      const boss = new THREE.ConeGeometry(0.07, sx > 0 && variant ? 0.08 : 0.2, 6); // one horn is snapped short
      boss.rotateZ(-sx * 0.9);
      boss.translate(sx * 0.3, 0.17, -0.08);
      parts.push(tint(boss, 0x6c6759));
    }
    return mergeGeometries(parts);
  });
  const headGeo = (() => {
    const parts = [plateGeometry(0.23, 0.16, 0.2, 71)];
    const jaw = new THREE.SphereGeometry(1, 8, 5);
    jaw.scale(0.16, 0.07, 0.15);
    jaw.translate(0, -0.03, -0.03);
    parts.push(tint(jaw, 0x11131d));
    return mergeGeometries(parts);
  })();
  const bellyGeo = (() => {
    const b = new THREE.SphereGeometry(1, 12, 8);
    b.scale(0.31, 0.17, 0.62);
    b.translate(0, -0.01, 0.2);
    return b;
  })();
  // A mandible: a hooked blade that swings in the horizontal plane about its root.
  const mandibleGeo = (() => {
    const t = new THREE.TorusGeometry(0.12, 0.026, 5, 9, 1.9);
    t.rotateX(Math.PI / 2);
    t.scale(1, 0.8, 1.25);
    const p = t.attributes.position;
    for (let i = 0; i < p.count; i++) { // taper to a point
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const k = 1 - 0.75 * Math.max(0, Math.min(1, a / 1.9));
      p.setY(i, p.getY(i) * k);
    }
    t.translate(-0.12, 0, 0);
    t.computeVertexNormals();
    return tint(t, 0x3f3c36);
  })();
  const eyeGeo = new THREE.SphereGeometry(0.028, 7, 5);
  // A leg segment 1 long on Y like the capsule, but shaped: swollen at the near joint, tapering
  // to the far one, with a row of spines down the outside. Radius SEG_R at its thickest.
  function limbGeometry(hex, taper, spines) {
    const prof = [[0, -0.5], [0.7, -0.48], [1, -0.4], [0.95, -0.2], [0.75, 0.15], [taper, 0.42], [taper * 0.9, 0.48], [0, 0.5]];
    const g = new THREE.LatheGeometry(prof.map((q) => new THREE.Vector2(q[0] * SEG_R, q[1])), 7);
    const parts = [tint(g, hex)];
    for (let i = 0; i < spines; i++) {
      const sp = new THREE.ConeGeometry(SEG_R * 0.3, SEG_R * 1.5, 4);
      sp.rotateZ(-1.1);
      sp.translate(SEG_R * 0.9, -0.2 + i * (0.55 / Math.max(1, spines - 1)), 0);
      parts.push(tint(sp, 0x6c6759));
    }
    return mergeGeometries(parts);
  }
  const femurGeo = limbGeometry(0x1e2233, 0.6, 0);
  const tibiaGeo = limbGeometry(0x262a3b, 0.42, 3);
  const tarsusGeo = segmentGeometry(0x6c6759);
  const shardGeo = plateGeometry(0.2, 0.12, 0.12, 99);
  const LURCH_STRIDE = 0.5;
  const STANCE = 0.6; // share of a stride a foot spends planted
  const BODY_Y = 0.27;
  // Alternating tripods: front-left, mid-right, rear-left step together, then the other three.
  // Short stout legs held close under the plates, the rear pair longest (they drive the pounce).
  const LURCH_LEGS = [-1, 1].flatMap((sx) => [
    { sx, hip: V(sx * 0.24, -0.08, -0.3), rest: V(sx * 0.5, 0, -0.52), l1: 0.27, l2: 0.35, r: 0.055, phase: sx < 0 ? 0 : 0.5, tuck: V(sx * 0.28, -0.2, -0.1) },
    { sx, hip: V(sx * 0.3, -0.08, -0.03), rest: V(sx * 0.6, 0, 0.02), l1: 0.28, l2: 0.36, r: 0.058, phase: sx < 0 ? 0.5 : 0, tuck: V(sx * 0.34, -0.22, 0.3) },
    { sx, hip: V(sx * 0.26, -0.08, 0.24), rest: V(sx * 0.52, 0, 0.6), l1: 0.33, l2: 0.43, r: 0.066, phase: sx < 0 ? 0 : 0.5, tuck: V(sx * 0.28, -0.16, 0.8) },
  ]);
  const _f = V(0, 0, 0);
  const _t = V(0, 0, 0);

  function poseLurch(v, time, o) {
    const ph = v.phase * Math.PI * 2;
    const mv = o.move;
    const body = v.body;
    const pant = Math.sin(time * (1.6 + 5.5 * o.wind) * Math.PI + v.seed); // breath
    body.position.set(
      0.025 * Math.sin(ph) * mv,
      BODY_Y - 0.14 * o.coil - 0.2 * o.wind - 0.05 * o.curl + 0.035 * Math.abs(Math.sin(ph)) * mv + 0.012 * pant * (1 - o.curl),
      0.03 * Math.sin(ph * 2) * mv + 0.12 * o.coil,
    );
    // Coil: front down, rear up. In the air: nose follows the arc. Curl: over onto its back.
    body.rotation.set(
      -0.3 * o.coil + o.pitch + 0.5 * o.flinch + 0.07 * o.wind,
      0.06 * Math.sin(ph) * mv,
      0.07 * Math.sin(ph) * mv + 2.75 * o.curl * v.rollDir,
    );
    body.position.y += 0.32 * Math.sin(Math.min(1, o.curl) * Math.PI) + 0.1 * o.curl; // it tips over, then lies on its plates
    body.scale.set(1 + 0.06 * o.wind, 1 - 0.1 * o.wind, 1);
    body.updateMatrix();

    // Armour: a ripple runs down the plates with each stride, they pump with each breath, lift
    // when it gathers to pounce (the soft body glows through the gaps) and stay askew if cracked.
    v.plates.forEach((pl, i) => {
      const flex = 0.05 * Math.sin(ph * 2 - i * 0.9) * mv + 0.035 * pant * (0.3 + o.wind);
      const lift = (0.15 + 0.04 * i) * o.open + 0.3 * o.curl * (i / 4);
      pl.g.rotation.set(-(flex + lift) - (pl.cracked ? 0.14 : 0), pl.cracked ? pl.skew * 0.5 : 0, pl.cracked ? pl.skew : 0);
      pl.g.position.y = pl.y + (pl.cracked ? 0.03 : 0);
    });
    v.shield.rotation.x = 0.12 * o.open + 0.04 * pant * o.wind;
    v.head.rotation.set(0.25 * o.coil - 0.3 * o.wind + 0.08 * Math.sin(time * 2.3 + v.seed) * (1 - o.curl) + 0.5 * o.curl, 0.16 * Math.sin(time * 1.1 + v.seed * 2) * (1 - o.coil) * (1 - o.curl), 0);
    // Mandibles: an idle chew, wide when it means to bite.
    // A pack chitters (R9): the jaws rattle while it gathers on the ring, hardest as it coils to rush.
    const chitter = 0.2 * (o.chitter || 0) * (0.5 + 0.5 * Math.sin(time * 38 + v.seed * 3));
    const gape = 0.12 + 0.1 * Math.sin(time * 7 + v.seed) * (1 - o.open) + 0.75 * o.open - 0.1 * o.curl + chitter;
    v.jaws[0].rotation.y = gape;
    v.jaws[1].rotation.y = -gape;
    v.under.emissiveIntensity = (0.06 + 0.7 * o.open) * (1 - o.curl) * (o.reduced ? 1 : 0.9 + 0.1 * Math.sin(time * 24));
    v.glow.visible = o.open > 0.05;
    v.glow.scale.setScalar(Math.max(0.01, o.open * 0.9));

    // Antennae: three joints each, feeling ahead in turn; swept back in the air, limp when spent.
    v.feelers.forEach((fl, i) => {
      const s = i ? 1 : -1;
      const sweep = Math.sin(time * 3.1 + i * 2.2 + v.seed) * 0.35 + Math.sin(time * 7.7 + i) * 0.08;
      const back = 0.9 * o.air + 0.5 * o.coil;
      const droop = 0.5 * o.wind + 0.9 * o.curl;
      const yaw = s * (0.55 + 0.25 * sweep) + s * back * 0.8;
      const up = 0.5 + 0.25 * Math.sin(time * 2.3 + i * 1.3 + v.seed) - droop - 0.2 * back;
      _a.copy(fl.root).applyMatrix4(v.head.matrixWorld).applyMatrix4(v.gInv);
      let px = _a.x;
      let py = _a.y;
      let pz = _a.z;
      for (let k = 0; k < fl.segs.length; k++) {
        const bend = up - k * (0.35 + 0.25 * droop) + 0.12 * Math.sin(time * 9 + k + i * 3) * (1 - o.curl);
        const y2 = yaw + s * k * 0.18 * (1 + sweep);
        const len = fl.len[k];
        const dzl = -Math.cos(bend) * Math.cos(y2 * (1 - back)) + back * 0.9;
        _b.set(px + Math.sin(y2) * Math.cos(bend) * len, py + Math.sin(bend) * len, pz + dzl * len);
        _a.set(px, py, pz);
        placeSeg(fl.segs[k], _a, _b, 0.008 - 0.002 * k);
        px = _b.x; py = _b.y; pz = _b.z;
      }
    });

    // Legs. On the ground each foot is planted and the body walks over it; in the air they
    // fold back against the belly; dead, they draw up over the body.
    v.legs.forEach((leg, i) => {
      const def = leg.def;
      const c = frac(v.phase + def.phase);
      let fz;
      let fy = 0;
      if (c < STANCE) {
        fz = LURCH_STRIDE * (c / STANCE - 0.5);
      } else {
        const s = (c - STANCE) / (1 - STANCE);
        fz = LURCH_STRIDE * (0.5 - s);
        fy = Math.sin(Math.PI * s) * 0.11;
      }
      const limp = leg.lame ? 0.35 : 1;
      const spread = 1 - 0.22 * o.coil + 0.3 * o.wind + 0.18 * o.flinch;
      _f.set(
        def.rest.x * spread + Math.sin(time * 61 + i * 2.1) * 0.012 * o.tremble,
        fy * mv * limp + 0.2 * o.flinch * (0.5 + 0.5 * Math.sin(time * 30 + i * 2)),
        def.rest.z * (1 - 0.15 * o.coil) + fz * mv * limp + (leg.lame ? 0.12 : 0) + 0.1 * o.coil,
      );
      // Tucked pose, in the body's own frame so it follows the tumble.
      _t.copy(def.tuck);
      if (o.curl > 0) _t.set(def.sx * 0.15, -0.3 + 0.07 * Math.sin(time * 16 + i * 2) * (1 - o.curl), def.hip.z * 0.8).lerp(def.tuck, 1 - o.curl);
      _t.applyMatrix4(body.matrix);
      const loose = Math.max(o.air, o.curl);
      leg.foot.copy(_f).lerp(_t, loose);
      leg.hip.copy(def.hip).applyMatrix4(body.matrix);
      leg.bend.set(def.sx * 0.6, 1 - 2 * o.curl, 0).applyQuaternion(body.quaternion);
      ik2(leg.hip, leg.foot, def.l1, def.l2, leg.bend, leg.knee);
      placeSeg(leg.up, leg.hip, leg.knee, def.r);
      placeSeg(leg.lo, leg.knee, leg.foot, def.r * 0.8);
      // The foot: a short clawed toe lying on the ground, pointing away from the body.
      _b.set(leg.foot.x + def.sx * 0.09 * (1 - loose), leg.foot.y - 0.01 * (1 - loose) + 0.05 * loose, leg.foot.z - 0.07);
      placeSeg(leg.toe, leg.foot, _b, 0.018);
    });
  }

  function buildLurch(e) {
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    const variant = e.id % 2;
    const seed = frac(e.id * 0.618) * 6.283;
    // The soft body under the plates: dark until it gathers to pounce, then it glows through the gaps.
    const under = new THREE.MeshStandardMaterial({ color: 0x2a0f1e, emissive: CAVE.pink, emissiveIntensity: 0.06, roughness: 0.35 });
    const belly = caster(bellyGeo, under);
    body.add(belly);
    const armourParts = [];
    const plates = TERGITES.map(([z, w, h, len], i) => {
      const pg = new THREE.Group(); // hinged at the plate's leading edge
      pg.position.set(0, -0.02, z - len * 0.8);
      const m = caster(tergiteGeos[variant][i]);
      m.material = armour;
      m.position.set(0, 0, len * 0.8);
      pg.add(m);
      body.add(pg);
      armourParts.push(m);
      return { g: pg, m, y: -0.02, w, h, len, cracked: false, lost: false, skew: (i % 2 ? 1 : -1) * (0.14 + 0.1 * frac(e.id * 0.37 + i)) };
    });
    const shield = caster(shieldGeos[variant]);
    shield.material = armour;
    shield.position.set(0, -0.01, -0.3);
    const head = new THREE.Group();
    head.position.set(0, -0.06, -0.6);
    const skull = caster(headGeo);
    skull.material = armour;
    head.add(skull);
    const jaws = [-1, 1].map((sx) => {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.1, -0.04, -0.15);
      const m = caster(mandibleGeo);
      m.material = armour;
      m.scale.set(sx > 0 ? 1 : -1, 1, -1); // reach forward, hook inward
      pivot.add(m);
      head.add(pivot);
      armourParts.push(m);
      return pivot;
    });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(sx * 0.16, 0.05, -0.09);
      head.add(eye);
    }
    const halo = new THREE.Sprite(pinkHalo);
    halo.position.set(0, 0.25, 0.35);
    body.add(shield, head, halo);
    armourParts.push(shield, skull);
    const feelers = [-1, 1].map((sx, i) => {
      const broken = variant === i; // one antenna is snapped off short
      const len = broken ? [0.2, 0.1] : [0.22, 0.2, 0.17];
      const segs = len.map(() => {
        const m = new THREE.Mesh(tarsusGeo, armour);
        g.add(m);
        armourParts.push(m);
        return m;
      });
      return { root: V(sx * 0.07, 0.07, -0.14), segs, len };
    });
    const legs = LURCH_LEGS.map((def) => {
      const up = caster(femurGeo);
      const lo = caster(tibiaGeo);
      const toe = new THREE.Mesh(tarsusGeo, armour);
      up.material = armour; lo.material = armour;
      g.add(up, lo, toe);
      armourParts.push(up, lo, toe);
      return { def, up, lo, toe, foot: V(0, 0, 0), knee: V(0, 0, 0), hip: V(0, 0, 0), bend: V(0, 1, 0), lame: false };
    });
    const shard = new THREE.Mesh(shardGeo, armour);
    shard.visible = false;
    g.add(shard);
    const v = {
      g, body, plates, shield, head, jaws, feelers, legs, under, glow: halo, shard, parts: armourParts, mat: armour,
      wounds: [], drops: ichorDrops(g, 3), gInv: new THREE.Matrix4(), seed, rollDir: variant ? 1 : -1,
      phase: frac(e.id * 0.37), age: 0, coil: 0, air: 0, wind: 0, flinch: 0, move: 0, blink: 0, open: 0, deathT: 0,
      pitch: 0, lastY: 0, hurt: 0, chitter: 0, shardT: -1, shardV: V(0, 0, 0), land: 0,
    };
    const pose = (time, o) => {
      g.updateMatrixWorld(true);
      v.gInv.copy(g.matrixWorld).invert();
      poseLurch(v, time, o);
    };
    v.sync = (en, dt, time, eye, cfg, reduced) => {
      v.age += dt;
      const st = en.state;
      const stunned = en.stun > 0 || st === 'flinch';
      const aloft = en.y > 0.02 || st === 'leap';
      v.coil = approach(v.coil, st === 'coil' && !stunned ? 1 : 0, dt, 12);
      v.air = approach(v.air, aloft ? 1 : 0, dt, aloft ? 18 : 26);
      v.wind = approach(v.wind, st === 'winded' ? 1 : 0, dt, st === 'winded' ? 22 : 5); // slams down, gets up slowly
      v.flinch = approach(v.flinch, stunned ? 1 : 0, dt, 18);
      // Seen as well as heard: gathering with its pack, and the shared coil of the rush.
      v.chitter = approach(v.chitter, stunned ? 0 : en.rush && st === 'coil' ? 1 : en.pack ? 0.45 : 0, dt, 10);
      const walking = en.speedNow > 0.05 && !aloft;
      if (walking) v.phase += (en.speedNow * dt) / LURCH_STRIDE; // stride matched to ground speed
      v.move = approach(v.move, walking ? 1 : 0, dt, 10);
      // Nose up as it rises, down as it falls.
      const vy = dt > 0 ? (en.y - v.lastY) / dt : 0;
      v.lastY = en.y;
      v.pitch = approach(v.pitch, aloft ? Math.max(-0.5, Math.min(0.5, vy * 0.11)) : 0, dt, 14);
      g.position.set(en.x, en.y, en.z);
      g.rotation.y = en.heading;
      g.scale.setScalar(0.35 + 0.65 * smooth(clamp01(v.age / 0.45))); // squeezes out of its pore
      v.blink = Math.max(0, v.blink - dt);
      setMat(v, v.blink > 0 && !reduced ? blinkMat : armour); // reduced flash: no pale blink
      v.open = Math.max(v.coil, v.air * 0.8);
      // Damage shows: a plate cracks askew, then one is blown off and a leg goes lame.
      const hp = clamp01(en.hp / cfg.lurch.hp);
      v.hurt = 1 - hp;
      if (hp < 0.7 && !plates[1 + (en.id % 2)].cracked) plates[1 + (en.id % 2)].cracked = true;
      if (hp < 0.4 && !v.lostPlate) {
        const pl = plates[2 + ((en.id + 1) % 2)];
        v.lostPlate = pl;
        pl.lost = true;
        pl.m.visible = false;
        legs[(en.id % 3) + (variant ? 3 : 0)].lame = true;
        // The plate spins away.
        shard.visible = true;
        shard.position.set(0, BODY_Y + 0.25, pl.g.position.z);
        v.shardV.set(variant ? 1.6 : -1.6, 2.6, 0.8);
        v.shardT = 0;
      }
      if (v.shardT >= 0) {
        v.shardT += dt;
        v.shardV.y -= 9.8 * dt;
        shard.position.addScaledVector(v.shardV, dt);
        shard.rotation.x += dt * 9; shard.rotation.z += dt * 6;
        if (shard.position.y < 0.03) { shard.position.y = 0.03; v.shardV.set(0, 0, 0); shard.rotation.set(0.2, shard.rotation.y, 0.1); v.shardT = -1; }
      }
      pose(time, {
        coil: v.coil, air: v.air, wind: v.wind, flinch: v.flinch, curl: 0, open: v.open, tremble: v.coil,
        move: v.move, pitch: v.pitch, chitter: v.chitter, reduced,
      });
      stepIchor(v.drops, dt, v.hurt > 0.25 ? 0.5 + 1.6 * v.hurt : 0, (out) => {
        const w = v.wounds.length ? v.wounds[Math.floor(Math.random() * v.wounds.length)] : null;
        if (w) w.getWorldPosition(out).applyMatrix4(v.gInv);
        else out.set(0, BODY_Y, 0.2);
      }, -en.y);
    };
    v.onEvent = (ev) => {
      if (ev.type !== 'hit') return;
      v.blink = 0.08;
      // Find the plate under the blast and tear it there.
      g.updateMatrixWorld(true);
      let best = null;
      let bestD = Infinity;
      for (const pl of [...plates, { g: shield, m: shield, w: 0.4, h: 0.3, len: 0.27, isShield: true }]) {
        if (pl.lost) continue;
        _c.set(ev.x, ev.y, ev.z);
        pl.m.worldToLocal(_c);
        const d = _c.length();
        if (d < bestD) { bestD = d; best = pl; _w.copy(_c); }
      }
      if (!best) return;
      // Project the hit onto the plate's dome.
      _h.set(_w.x / best.w, Math.max(0.12, _w.y / best.h), _w.z / best.len).normalize();
      _a.set(_h.x * best.w, _h.y * best.h, _h.z * best.len);
      _b.set(_h.x / best.w, _h.y / best.h, _h.z / best.len).normalize();
      addWound(v, best.m, _a, _b, 0.03 + 0.007 * (ev.pellets || 1));
    };
    v.die = () => {
      v.deathT = 0;
      setMat(v, deadMat);
      for (const d of v.drops) d.m.visible = false;
    };
    // It rolls onto its back, the legs kick and draw up, the glow drains; then it sinks.
    v.updateDeath = (dt, time, reduced) => {
      v.deathT += dt;
      const k = smooth(clamp01(v.deathT / 0.9));
      const f = 1 - k;
      g.position.y = Math.max(0, g.position.y - dt * 4); // out of the air if it died there
      pose(time, { coil: v.coil * f, air: v.air * f, wind: v.wind * f, flinch: v.flinch * f, curl: k, open: v.open * f, tremble: 0, move: 0, pitch: v.pitch * f, reduced });
      if (v.deathT > 1.5) g.position.y = -0.7 * ((v.deathT - 1.5) / 0.6);
      return v.deathT > 2.1;
    };
    v.dispose = () => under.dispose();
    return v;
  }

  // ======================================================================================
  // Weeper: a bent stalk that walks on its roots, a sac hanging off one side. The sac is what
  // lobs, and what a shot hurts most; the stalk is tougher. It shuffles one root at a time.
  // ======================================================================================
  const STALK = [V(0, 0, 0), V(0.05, 0.45, 0.08), V(0.16, 0.9, 0.12), V(0.2, 1.35, 0.02), V(0.1, 1.75, -0.15), V(-0.05, 2.0, -0.3)];
  const STALK_R = [0.17, 0.15, 0.13, 0.11, 0.09, 0.07];
  const SAC_AT = V(-0.3, 1.58, -0.36); // in stalk space; the stalk pivot sits 0.2 m up
  const BARK = 0x1c2233;
  const weeperStalkGeo = (() => {
    const parts = [];
    for (let i = 0; i < STALK.length - 1; i++) {
      parts.push(capsuleBetween(STALK[i], STALK[i + 1], (STALK_R[i] + STALK_R[i + 1]) / 2, HIDE));
      // Growth nodes: a swollen collar and a scar where a frond once was.
      const ring = new THREE.SphereGeometry(STALK_R[i + 1] * 1.22, 9, 6);
      ring.scale(1, 0.42, 1);
      ring.rotateZ(i * 0.21 - 0.3);
      ring.translate(STALK[i + 1].x, STALK[i + 1].y, STALK[i + 1].z);
      parts.push(tint(ring, 0x2a3044));
      const a = i * 2.4;
      const bud = new THREE.SphereGeometry(STALK_R[i] * 0.45, 6, 5);
      bud.translate(STALK[i].x + Math.cos(a) * STALK_R[i] * 0.9, STALK[i].y + 0.22, STALK[i].z + Math.sin(a) * STALK_R[i] * 0.9);
      parts.push(tint(bud, 0x2b3246));
    }
    parts.push(capsuleBetween(STALK[5], V(SAC_AT.x + 0.04, SAC_AT.y + 0.27, SAC_AT.z), 0.035, HIDE));
    // Veins from the stalk down over the sac.
    for (const a of [0.4, 2.3, 4.4]) {
      parts.push(capsuleBetween(
        V(SAC_AT.x + 0.04, SAC_AT.y + 0.3, SAC_AT.z),
        V(SAC_AT.x + Math.cos(a) * 0.3, SAC_AT.y + 0.05, SAC_AT.z + Math.sin(a) * 0.3), 0.012, 0x3a4156,
      ));
    }
    return mergeGeometries(parts);
  })();
  // The root crown: a knotted bole with hair roots; the walking roots join it.
  const weeperCrownGeo = (() => {
    const knob = new THREE.SphereGeometry(0.23, 9, 7);
    knob.scale(1, 0.8, 1);
    knob.translate(0, 0.24, 0);
    const parts = [tint(knob, BARK)];
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9 + 0.3;
      const l = 0.2 + 0.12 * (i % 3);
      parts.push(capsuleBetween(V(Math.cos(a) * 0.15, 0.16, Math.sin(a) * 0.15), V(Math.cos(a) * (0.2 + l), 0.01, Math.sin(a) * (0.2 + l)), 0.017, BARK));
    }
    return mergeGeometries(parts);
  })();
  const rootGeo = limbGeometry(BARK, 0.62, 0);
  const rootTipGeo = limbGeometry(BARK, 0.15, 0);
  const sacGeo = new THREE.SphereGeometry(0.3, 14, 10);
  // Root bole a seated Weeper stands on; it goes when the Weeper does.
  const boleGeo = tint(new THREE.CylinderGeometry(0.2, 0.5, 1, 7).translate(0, -0.5, 0), 0x1b202b);
  // Four walking roots, none alike: angle round the crown (0 = its right, clockwise from above
  // toward its back), reach, thickness, and when in the shuffle each one moves.
  const ROOTS = [
    { a: -0.75, reach: 0.74, l1: 0.42, l2: 0.46, r: 0.1, phase: 0 },
    { a: 0.5, reach: 0.6, l1: 0.36, l2: 0.38, r: 0.08, phase: 0.4 },
    { a: 1.7, reach: 0.7, l1: 0.4, l2: 0.44, r: 0.09, phase: 0.8 },
    { a: 2.9, reach: 0.78, l1: 0.44, l2: 0.48, r: 0.095, phase: 0.2 },
    { a: -2.2, reach: 0.56, l1: 0.34, l2: 0.36, r: 0.075, phase: 0.6 },
  ];
  const ROOT_STRIDE = 0.55;
  const ROOT_SWING = 0.22; // share of the shuffle each root spends in the air

  function poseWeeper(v, time, o) {
    v.pivot.rotation.set(o.lean, 0, o.sway);
    v.pivot.position.set(o.shiftX, 0.2 + o.bob, o.shiftZ);
    const s = (1 + 0.38 * o.charge - 0.25 * o.slack - 0.75 * o.fall) * (1 - 0.22 * o.leak);
    v.sac.scale.set(s, s * (1 + 0.35 * o.slack + 0.3 * o.leak), s);
    v.sac.position.set(SAC_AT.x, SAC_AT.y - 0.12 * o.slack - 0.06 * o.leak, SAC_AT.z);
    v.core.position.copy(v.sac.position);
    v.core.scale.setScalar(Math.max(0.01, (0.45 + 1.6 * o.charge) * (1 - o.fall) * (o.reduced ? 1 : 1 + 0.1 * o.charge * Math.sin(time * 26))));
    v.glow.position.copy(v.sac.position);
    v.glow.scale.setScalar(Math.max(0.01, (0.3 + 1.3 * o.charge) * (1 - o.fall)));

    // Roots: each is planted while the body moves over it, then lifts, reaches and plants again,
    // one after another. dirX/dirZ is the way it is travelling, in its own frame.
    v.roots.forEach((rt, i) => {
      const def = rt.def;
      const c = frac(v.phase + def.phase);
      let along;
      let lift = 0;
      if (c < 1 - ROOT_SWING) {
        along = 0.5 - c / (1 - ROOT_SWING); // planted: slides from ahead to behind
      } else {
        const sw = (c - (1 - ROOT_SWING)) / ROOT_SWING;
        along = -0.5 + smooth(sw);
        lift = Math.sin(Math.PI * sw) * (0.09 + 0.04 * (i % 2));
      }
      const drag = rt.limp ? 0.3 : 1;
      const grip = 1 - 0.45 * o.fall + 0.1 * o.charge; // braces as it swells, lets go when it dies
      const wr = 0.02 * Math.sin(time * 1.3 + i * 1.9) * (1 - o.move); // idle: the tips feel about
      rt.foot.set(
        Math.cos(def.a) * def.reach * grip + o.dirX * along * ROOT_STRIDE * o.move * drag + wr,
        lift * o.move * drag + 0.02,
        Math.sin(def.a) * def.reach * grip + o.dirZ * along * ROOT_STRIDE * o.move * drag + wr,
      );
      rt.hip.set(Math.cos(def.a) * 0.14 + o.shiftX, 0.2 + o.bob, Math.sin(def.a) * 0.14 + o.shiftZ);
      rt.bend.set(Math.cos(def.a + 0.6), 0.55, Math.sin(def.a + 0.6)); // roots sprawl and kink sideways, they do not stand on knees
      ik2(rt.hip, rt.foot, def.l1, def.l2, rt.bend, rt.knee);
      placeSeg(rt.up, rt.hip, rt.knee, def.r);
      placeSeg(rt.lo, rt.knee, rt.foot, def.r * 0.62);
      // The tip trails on the ground, curling the way the root points.
      _b.set(rt.foot.x + Math.cos(def.a + 0.5) * 0.3, 0.012 + lift * o.move * 0.5, rt.foot.z + Math.sin(def.a + 0.5) * 0.3);
      placeSeg(rt.tip, rt.foot, _b, def.r * 0.4);
    });
  }

  function buildWeeper(e) {
    const g = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.position.y = 0.2;
    const stalk = caster(weeperStalkGeo);
    const crown = caster(weeperCrownGeo);
    const bole = caster(boleGeo);
    const sac = caster(sacGeo, sacMat);
    const core = new THREE.Mesh(coreGeo, pinkMat);
    const halo = new THREE.Sprite(pinkHalo);
    pivot.add(stalk, sac, core, halo);
    g.add(pivot, crown, bole);
    const rootParts = [];
    const roots = ROOTS.map((def) => {
      const up = caster(rootGeo);
      const lo = caster(rootGeo);
      const tip = caster(rootTipGeo);
      g.add(up, lo, tip);
      rootParts.push(up, lo, tip);
      return { def, up, lo, tip, foot: V(0, 0, 0), knee: V(0, 0, 0), hip: V(0, 0, 0), bend: V(0, 1, 0), limp: false };
    });
    const v = {
      g, pivot, sac, core, glow: halo, bole, roots, parts: [stalk, crown, bole, ...rootParts], mat: flesh,
      wounds: [], drops: ichorDrops(g, 4), gInv: new THREE.Matrix4(),
      age: 0, charge: 0, whip: 0, slack: 0, flinch: 0, blink: 0, deathT: 0, lean: 0, seatedSpawn: !!e.seated,
      phase: frac(e.id * 0.41), move: 0, lastX: e.x, lastZ: e.z, dirX: 0, dirZ: -1, leak: 0, hurt: 0, sacHits: 0,
    };
    v.sync = (en, dt, time, eye, cfg, reduced) => {
      v.age += dt;
      const stunned = en.stun > 0 || en.state === 'flinch';
      const swell = en.state === 'swell' && !stunned ? clamp01(1 - en.timer / cfg.weeper.swellTime) : 0;
      v.charge = approach(v.charge, swell, dt, 20);
      v.whip = Math.max(0, v.whip - dt);
      v.slack = Math.max(0, v.slack - dt / 1.6);
      v.flinch = approach(v.flinch, stunned ? 1 : 0, dt, 16);
      g.position.set(en.x, en.y, en.z);
      g.rotation.y = en.heading;
      const born = smooth(clamp01(v.age / (v.seatedSpawn ? 0.9 : 0.45)));
      if (v.seatedSpawn) g.scale.set(0.5 + 0.5 * born, Math.max(0.02, born), 0.5 + 0.5 * born); // unfurls on its ledge
      else g.scale.setScalar(0.35 + 0.65 * born);
      bole.visible = !!en.seated && en.y > 0.05;
      bole.scale.y = Math.max(0.05, en.y);
      v.blink = Math.max(0, v.blink - dt);
      setMat(v, v.blink > 0 && !reduced ? blinkMat : flesh); // reduced flash: no pale blink

      // Which way is it actually travelling? (It backs away from the player as readily as it
      // closes in.) Ground motion this frame, turned into its own frame, drives the shuffle.
      const mx = en.x - v.lastX;
      const mz = en.z - v.lastZ;
      v.lastX = en.x; v.lastZ = en.z;
      const dist = Math.hypot(mx, mz);
      const stepping = dt > 0 && dist > 1e-5 && dist < 0.5 && en.speedNow > 0.05;
      if (stepping) {
        const cs = Math.cos(en.heading);
        const sn = Math.sin(en.heading);
        const lx = (mx * cs - mz * sn) / dist;
        const lz = (mx * sn + mz * cs) / dist;
        v.dirX = approach(v.dirX, lx, dt, 8);
        v.dirZ = approach(v.dirZ, lz, dt, 8);
        v.phase += dist / ROOT_STRIDE;
      }
      v.move = approach(v.move, stepping ? 1 : 0, dt, 6);

      // Hurt: the stalk sags, the sac leaks and shrinks, a root drags.
      const hp = clamp01(en.hp / cfg.weeper.hp);
      v.hurt = 1 - hp;
      v.leak = approach(v.leak, Math.min(1, v.sacHits * 0.34), dt, 3);
      if (hp < 0.45 && !roots[1].limp) roots[1].limp = true;

      // Leans back a little as the sac fills, whips forward on release. The body rocks over
      // whichever root is carrying it.
      const whip = v.whip > 0 ? Math.sin(Math.PI * (1 - v.whip / 0.35)) : 0;
      v.lean = 0.13 * v.charge + 0.5 * v.flinch - 0.4 * whip + 0.16 * v.hurt;
      const step = v.phase * Math.PI * 2;
      const sway = Math.sin(time * 1.7 + en.id) * 0.04 + v.move * 0.09 * Math.sin(step * 2) + 0.1 * v.hurt * Math.sin(time * 0.9 + en.id);
      g.updateMatrixWorld(true);
      v.gInv.copy(g.matrixWorld).invert();
      poseWeeper(v, time, {
        lean: v.lean + v.move * 0.05 * Math.sin(step * 2 + 1), sway, charge: v.charge, slack: v.slack, fall: 0, leak: v.leak,
        move: v.move, dirX: v.dirX, dirZ: v.dirZ, bob: v.move * 0.03 * Math.abs(Math.sin(step * 2)),
        shiftX: v.move * 0.04 * Math.sin(step), shiftZ: v.move * 0.03 * Math.cos(step * 2), reduced,
      });
      // It drips constantly; faster, and from its wounds, once it is hurt.
      stepIchor(v.drops, dt, 0.85 + 1.5 * v.hurt, (out) => {
        const w = v.wounds.length && Math.random() < 0.7 ? v.wounds[Math.floor(Math.random() * v.wounds.length)] : null;
        if (w) w.getWorldPosition(out).applyMatrix4(v.gInv);
        else sac.getWorldPosition(out).applyMatrix4(v.gInv).y -= 0.3;
      }, -en.y);
    };
    v.onEvent = (ev) => {
      if (ev.type === 'globLaunch') { v.whip = 0.35; v.slack = 1; }
      if (ev.type !== 'hit') return;
      v.blink = 0.08;
      g.updateMatrixWorld(true);
      _c.set(ev.x, ev.y, ev.z);
      pivot.worldToLocal(_c);
      const size = 0.03 + 0.007 * (ev.pellets || 1);
      if (ev.zone === 'sac') {
        // A tear in the sac wall, on the side the shot came from.
        v.sacHits += 1;
        _b.subVectors(_c, sac.position);
        if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1);
        _b.normalize();
        _a.copy(_b).multiplyScalar(0.3);
        addWound(v, sac, _a, _b, size * 1.2);
        return;
      }
      // A gash in the stalk: the nearest point on its spine, out to the bark.
      let bestD = Infinity;
      let rad = 0.12;
      for (let i = 0; i < STALK.length - 1; i++) {
        _d.subVectors(STALK[i + 1], STALK[i]);
        const t = clamp01(_p.subVectors(_c, STALK[i]).dot(_d) / _d.lengthSq());
        _p.copy(STALK[i]).addScaledVector(_d, t);
        const d = _p.distanceTo(_c);
        if (d < bestD) { bestD = d; _w.copy(_p); rad = STALK_R[i] + (STALK_R[i + 1] - STALK_R[i]) * t; }
      }
      _b.subVectors(_c, _w);
      _b.y *= 0.2;
      if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1);
      _b.normalize();
      _a.copy(_w).addScaledVector(_b, rad);
      addWound(v, pivot, _a, _b, size);
    };
    v.die = () => {
      v.deathT = 0;
      setMat(v, deadMat);
      for (const d of v.drops) d.m.visible = false;
    };
    v.updateDeath = (dt, time, reduced) => {
      v.deathT += dt;
      const k = smooth(clamp01(v.deathT / 0.8));
      poseWeeper(v, time, {
        lean: v.lean + (1.45 - v.lean) * k, sway: 0.25 * k, charge: v.charge * (1 - k), slack: k, fall: k, leak: v.leak,
        move: 0, dirX: 0, dirZ: -1, bob: -0.1 * k, shiftX: 0, shiftZ: 0, reduced,
      });
      if (v.deathT > 0.8) g.position.y -= dt * 1.6;
      return v.deathT > 1.4;
    };
    return v;
  }

  // ======================================================================================
  // The Cantor: leaning column of vertebra rings, one long right arm, restless small arms
  // on the left, an empty ring for a head, a rib lattice that parts over a pink core.
  // ======================================================================================
  const spine = (t) => V(-0.3 * Math.pow(t, 1.5), 2.8 * t, -0.5 * t * t);
  const girth = (t) => 0.6 - 0.3 * t;
  const CHEST = spine(0.62);
  const SHOULDER = spine(0.86).add(V(0.5, 0, 0));
  const ARM = { l1: 1.7, l2: 1.6, l3: 1.2 }; // 4.5 m
  const ARM_STRIDE = 2.0;
  const HAND_RAISED = V(2.4, 3.3, 0.6);
  const cantorColumnGeo = (() => {
    const parts = [];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = spine(t);
      if (i < N) parts.push(capsuleBetween(p, spine((i + 1) / N), girth(t + 0.5 / N) * 0.85, HIDE));
      const ring = new THREE.TorusGeometry(girth(t) * 1.03, 0.055, 5, 14);
      ring.rotateX(Math.PI / 2);
      ring.rotateZ(0.09 * Math.sin(i * 1.7));
      ring.rotateX(-0.35 * t);
      ring.translate(p.x, p.y, p.z);
      parts.push(tint(ring, CAVE.bone));
    }
    const skirt = new THREE.SphereGeometry(1, 12, 8);
    skirt.scale(1.0, 0.38, 1.25);
    skirt.translate(0.05, 0.2, 0.35);
    parts.push(tint(skirt, HIDE));
    const lump = new THREE.SphereGeometry(0.3, 8, 6);
    lump.translate(SHOULDER.x - 0.05, SHOULDER.y, SHOULDER.z);
    parts.push(tint(lump, HIDE));
    return mergeGeometries(parts);
  })();
  const cantorHeadGeo = tint(new THREE.TorusGeometry(0.34, 0.1, 8, 18), CAVE.bone);
  const ribSet = (heights, start) => mergeGeometries(heights.map((h) => {
    const rib = new THREE.TorusGeometry(0.78 * (1 - 0.44 * Math.abs(h)), 0.035, 5, 12, 1.75);
    rib.rotateZ(start);
    rib.rotateX(-Math.PI / 2);
    rib.scale(1, 1, 1.12);
    rib.translate(0, h, 0);
    return tint(rib, CAVE.bone);
  }));
  const ribsRightGeo = ribSet([-0.5, -0.25, 0, 0.25, 0.5], -0.3);
  const ribsLeftGeo = ribSet([-0.42, -0.14, 0.16, 0.47], Math.PI - 1.45); // one short, unevenly spaced
  const cantorCoreGeo = new THREE.SphereGeometry(0.2, 12, 10);
  const SMALL_ARMS = [0.5, 0.6, 0.7, 0.78].map((t, i) => ({
    at: spine(t).add(V(-girth(t) * 0.9, 0, -0.05)), rate: 1.3 + 0.4 * i, seed: i * 1.9,
  }));
  const _a = V(0, 0, 0);
  const _b = V(0, 0, 0);
  const _c = V(0, 0, 0);
  const _w = V(0, 0, 0);
  const _h = V(0, 0, 0);
  const _sh = V(0, 0, 0);
  const _el = V(0, 0, 0);
  const ARM_BEND = V(0.4, 1, 0.25);
  const segDummy = new THREE.Object3D();

  // The song (cantorsong.js): while it sings, a faint ring of pale-teal light leaves the ring of its
  // head with each note and widens as it fades, a soft glow in the ring swells with the note, and a
  // few motes of dust turn about it. Subtle up close, readable across the Nave (the art critic, C6:
  // the cave's teal, peaking at 0.35, widening to about 1.9 m so it shows from 15 m). Reduced flash:
  // every other note only, slower, and dimmer, with no swell. Built only for the Cantor.
  const SING_RINGS = SONG_NOTES.length;
  const singRingGeo = new THREE.RingGeometry(0.92, 1, 40); // in the head ring's own plane (XY)
  const singMotesN = 14;
  const singGlow = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9fe8c8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  function buildSongFx() {
    const group = new THREE.Group();
    group.visible = false;
    const rings = [];
    for (let i = 0; i < SING_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x9fe8c8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const m = new THREE.Mesh(singRingGeo, mat);
      m.visible = false;
      group.add(m);
      rings.push(m);
    }
    const glowS = new THREE.Sprite(singGlow);
    glowS.scale.setScalar(0.9);
    group.add(glowS);
    const pos = new Float32Array(singMotesN * 3);
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const motes = new THREE.Points(mg, new THREE.PointsMaterial({ map: glowTexture(), color: 0xbff2da, size: 0.07, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    motes.frustumCulled = false;
    group.add(motes);
    const seeds = [];
    for (let i = 0; i < singMotesN; i++) seeds.push([i * 2.399, 0.35 + 0.45 * frac(i * 0.618), 0.4 + 0.5 * frac(i * 0.37), frac(i * 0.73) - 0.5]);
    let fade = 0;
    return {
      group,
      /** sing: seconds into the bout (cantorsong.js boss.sing), or -1. */
      update(sing, dt, time, reduced) {
        const on = sing >= 0;
        fade = approach(fade, on ? 1 : 0, dt, on ? 6 : 2.5);
        group.visible = fade > 0.01;
        if (!group.visible) return;
        let swell = 0;
        for (let k = 0; k < SING_RINGS; k++) {
          const n = SONG_NOTES[k];
          const r = rings[k];
          const life = reduced ? 1.6 : 1.1;
          const u = on ? (sing - n.at) / life : -1;
          const shown = u >= 0 && u < 1 && (!reduced || k % 2 === 0);
          r.visible = shown;
          if (shown) {
            r.scale.setScalar(0.4 + (reduced ? 0.9 : 1.5) * smooth(u));
            r.material.opacity = (reduced ? 0.18 : 0.35) * (1 - u) * Math.min(1, u * 8) * fade;
          }
          if (on && sing >= n.at && sing < n.at + n.dur) swell = Math.sin(Math.PI * clamp01((sing - n.at) / n.dur));
        }
        singGlow.opacity = (reduced ? 0.06 : 0.06 + 0.12 * swell) * fade;
        // dust motes: a slow turn about the ring, rising a little and settling
        for (let i = 0; i < singMotesN; i++) {
          const [a0, rad, rate, h] = seeds[i];
          const a = a0 + time * rate * (reduced ? 0.5 : 1);
          pos[i * 3] = Math.cos(a) * rad;
          pos[i * 3 + 1] = Math.sin(a) * rad * 0.9 + h * 0.3;
          pos[i * 3 + 2] = 0.12 * Math.sin(a * 1.7 + i);
        }
        mg.attributes.position.needsUpdate = true;
        motes.material.opacity = (reduced ? 0.35 : 0.55) * fade;
      },
      hide() { fade = 0; group.visible = false; },
    };
  }

  function poseCantor(v, time, o) {
    const torso = v.torso;
    torso.position.set(o.shake * Math.sin(time * 75) * 0.06, 0, o.surge);
    torso.rotation.set(o.pitch, o.twist, o.shake * Math.sin(time * 63) * 0.03);
    torso.scale.set(1 + 0.2 * o.fold, (1 - 0.1 * o.sag) * (1 - 0.62 * o.fold), 1 + 0.2 * o.fold);
    torso.updateMatrix();
    v.ribsR.rotation.y = -o.part * 1.05;
    v.ribsL.rotation.y = o.part * 0.95;
    const coreK = o.part * (1 - o.fold);
    v.core.visible = coreK > 0.02;
    v.glow.visible = coreK > 0.02;
    v.core.scale.setScalar(Math.max(0.01, coreK * (o.reduced ? 1 : 0.92 + 0.08 * Math.sin(time * 9))));
    v.glow.scale.setScalar(Math.max(0.01, 2.6 * coreK));
    v.head.rotation.set(-0.25 - 0.5 * o.sag + 0.8 * o.call - 0.9 * o.fold, 0.1, 0.2);
    v.head.scale.setScalar(1 + 0.22 * o.call);

    // Small arms: never still while it lives.
    if (!o.frozen) {
      SMALL_ARMS.forEach((arm, i) => {
        const yaw = -1.1 + 0.6 * Math.sin(time * arm.rate + arm.seed) - 0.5 * o.flare;
        const pitch = 0.45 * Math.sin(time * (arm.rate + 0.6) + arm.seed * 2) + 0.5 * o.flare;
        _a.copy(arm.at);
        _b.set(-Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)).multiplyScalar(0.42).add(_a);
        const yaw2 = yaw + 0.9 * Math.sin(time * (arm.rate + 1) + arm.seed * 3);
        const pitch2 = pitch - 0.6 + 0.5 * Math.sin(time * (arm.rate + 1.4) + arm.seed);
        _c.set(-Math.cos(pitch2) * Math.cos(yaw2), Math.sin(pitch2), Math.cos(pitch2) * Math.sin(yaw2)).multiplyScalar(0.36).add(_b);
        placeSeg(segDummy, _a, _b, 0.05);
        segDummy.updateMatrix();
        v.smallArms.setMatrixAt(i * 2, segDummy.matrix);
        placeSeg(segDummy, _b, _c, 0.038);
        segDummy.updateMatrix();
        v.smallArms.setMatrixAt(i * 2 + 1, segDummy.matrix);
      });
      v.smallArms.instanceMatrix.needsUpdate = true;
    }

    // The long arm: shoulder, elbow, wrist, hand. The forearm stands over a planted hand and
    // lies along the arm when the hand is raised.
    _sh.copy(SHOULDER).applyMatrix4(torso.matrix);
    _h.copy(v.hand);
    _d.subVectors(_h, _sh).normalize();
    const low = clamp01(1.3 - _h.y);
    _w.copy(_d).multiplyScalar(-1).lerp(_p.set(0, 0.94, 0.34), low).normalize().multiplyScalar(ARM.l3).add(_h);
    const reach = (ARM.l1 + ARM.l2) * 0.999;
    if (_w.distanceTo(_sh) > reach) {
      _c.subVectors(_h, _w).normalize();
      _w.sub(_sh).normalize().multiplyScalar(reach).add(_sh);
      _h.copy(_w).addScaledVector(_c, ARM.l3);
    }
    ik2(_sh, _w, ARM.l1, ARM.l2, ARM_BEND, _el);
    placeSeg(v.arm[0], _sh, _el, 0.14);
    placeSeg(v.arm[1], _el, _w, 0.115);
    placeSeg(v.arm[2], _w, _h, 0.09);
  }

  function buildCantor(e) {
    const g = new THREE.Group();
    const torso = new THREE.Group();
    g.add(torso);
    const column = caster(cantorColumnGeo);
    const head = caster(cantorHeadGeo);
    const top = spine(1);
    head.position.set(top.x - 0.02, top.y + 0.4, top.z - 0.12);
    const ribsR = new THREE.Group();
    const ribsL = new THREE.Group();
    ribsR.position.copy(CHEST);
    ribsL.position.copy(CHEST);
    const ribMeshR = caster(ribsRightGeo);
    const ribMeshL = caster(ribsLeftGeo);
    ribsR.add(ribMeshR);
    ribsL.add(ribMeshL);
    const core = new THREE.Mesh(cantorCoreGeo, pinkMat);
    core.position.set(CHEST.x, CHEST.y, CHEST.z - 0.55);
    const halo = new THREE.Sprite(pinkHalo);
    halo.position.copy(core.position);
    const smallArms = new THREE.InstancedMesh(segGeo, flesh, SMALL_ARMS.length * 2);
    smallArms.castShadow = true;
    smallArms.frustumCulled = false;
    torso.add(column, head, ribsR, ribsL, core, halo, smallArms);
    const arm = [caster(segGeo), caster(segGeo), caster(segGeo)];
    g.add(...arm);
    const songFx = buildSongFx();
    head.add(songFx.group); // in the head ring's plane, so the rings leave its mouth
    const v = {
      g, torso, head, ribsR, ribsL, core, glow: halo, smallArms, arm, mat: flesh,
      parts: [column, head, ribMeshR, ribMeshL, smallArms, ...arm],
      hand: V(0.9, 0, -2.2), age: 0, phase: 0, open: 0, shed: 0, twist: 0, pitch: 0, move: 0,
      call: 0, shudder: 0, whip: 0, blink: 0, deathT: 0, beat: 1.2, pitch0: 0, part: 0,
    };
    const goal = V(0, 0, 0);
    v.sync = (en, dt, time, eye, cfg, reduced) => {
      const c = cfg.cantor;
      const st = en.state;
      v.age += dt;
      g.position.set(en.x, en.y, en.z);
      g.rotation.y = en.heading;
      g.scale.set(1, Math.max(0.05, smooth(clamp01(v.age / 1.2))), 1); // rises out of the floor
      v.blink = Math.max(0, v.blink - dt);
      setMat(v, v.blink > 0 && !reduced ? blinkMat : flesh); // reduced flash: no pale blink

      const wind = st === 'sweep' ? smooth(clamp01(1 - en.timer / c.sweepWindup)) : 0;
      const swinging = st === 'swing';
      v.open = approach(v.open, st === 'open' ? 1 : 0, dt, st === 'open' ? 9 : 5);
      v.shed = approach(v.shed, st === 'shed' ? clamp01(1 - en.timer / c.shedTime) : 0, dt, 12);
      v.call = Math.max(0, v.call - dt / 0.9);
      v.shudder = Math.max(0, v.shudder - dt);
      v.whip = Math.max(0, v.whip - dt);
      const dragging = st === 'drag' && en.speedNow > 0.05;
      if (dragging) v.phase += (en.speedNow * dt) / ARM_STRIDE;
      v.move = approach(v.move, dragging ? 1 : 0, dt, 6);
      const cyc = frac(v.phase);

      let twistGoal = 0;
      if (st === 'sweep') {
        // Wind-up: the arm goes up and back over 0.9 s.
        v.hand.lerp(HAND_RAISED, Math.min(1, dt * 6));
        twistGoal = -0.45 * wind;
      } else if (swinging) {
        // Swing: through the locked arc in swingTime, fastest at the hit moment, a little past the end.
        const u = clamp01(en.timer / c.swingTime);
        const h = clamp01(c.swingHitAt / c.swingTime) || 0.5;
        const ease = u < h ? 0.55 * (u / h) ** 2 : 0.55 + 0.53 * (1 - (1 - (u - h) / (1 - h)) ** 2);
        const theta = c.sweepArc / 2 - c.sweepArc * ease;
        const R = Math.min(c.sweepReach - 0.6, 4.7);
        goal.set(Math.sin(theta) * R, 0.75 + 0.6 * (1 - ease), -Math.cos(theta) * R);
        v.hand.copy(HAND_RAISED).lerp(goal, smooth(clamp01(u / 0.3)));
        twistGoal = -0.45 + 0.95 * ease;
      } else if (st === 'open') {
        // Spent: the arm lies where the swing left it.
        const theta = -0.56 * c.sweepArc;
        const R = Math.min(c.sweepReach - 0.6, 4.7) * 0.85;
        goal.set(Math.sin(theta) * R, 0.1, -Math.cos(theta) * R);
        v.hand.lerp(goal, Math.min(1, dt * 8));
        twistGoal = 0.35;
      } else if (st === 'shed') {
        goal.set(1.7, 0.1, -0.7);
        v.hand.lerp(goal, Math.min(1, dt * 6));
      } else {
        // Drag: plant ahead, haul the body up to the hand, lift, reach again.
        if (cyc < 0.7) goal.set(0.9, 0, -2.9 + ARM_STRIDE * cyc);
        else {
          const s = (cyc - 0.7) / 0.3;
          goal.set(0.9 + 0.3 * Math.sin(Math.PI * s), 0.7 * Math.sin(Math.PI * s), -1.5 - 1.4 * s);
        }
        v.hand.lerp(goal, Math.min(1, dt * 10));
      }
      v.twist = approach(v.twist, twistGoal, dt, swinging ? 30 : 8);
      const whip = v.whip > 0 ? Math.sin(Math.PI * (1 - v.whip / 0.3)) : 0;
      v.pitch = -0.1 * Math.sin(cyc * Math.PI * 2) * v.move - 0.38 * v.open + 0.28 * v.shed - 0.45 * whip + 0.12 * wind;
      v.part = Math.max(v.open, 0.22 * v.shed, 0.15 * wind);
      poseCantor(v, time, {
        pitch: v.pitch, twist: v.twist, surge: 0.16 * Math.sin(cyc * Math.PI * 2) * v.move,
        sag: v.open, fold: 0, part: v.part, call: smooth(clamp01(v.call)), flare: v.shed,
        shake: clamp01(v.shudder / 0.3), frozen: false, reduced,
      });
      songFx.update(en.sing == null ? -1 : en.sing, dt, time, reduced);
    };
    v.onEvent = (ev) => {
      if (ev.type === 'hit') v.blink = 0.08;
      else if (ev.type === 'bossSwingHit') v.shudder = ev.hit ? 0.38 : 0.22; // the hit moment: the hide shudders
      else if (ev.type === 'bossCall') v.call = 1;
      else if (ev.type === 'globLaunch') v.whip = 0.3;
    };
    v.die = (ev, cfg) => {
      songFx.hide();
      v.deathT = 0;
      v.beat = (cfg && cfg.winBeat) || 1.2;
      v.pitch0 = v.pitch;
      v.blast = null;
      setMat(v, deadMat);
    };
    /**
     * #29: its last blast (the cave's way-out scene, logic/wayout.js). Dying, it rears toward the
     * place the vault will break: the torso turns and leans back, the ribs part all the way, the
     * core gathers, the long arm goes up along the aim; at WAYOUT.cave.beat the blast leaves (the
     * bolt is passages.js's) and it is spent: then it folds, as it always did. ev: sceneStart.
     */
    v.lastBlast = (ev) => {
      const th = g.rotation.y;
      const dx = ev.x - g.position.x; const dz = ev.z - g.position.z;
      const lx = dx * Math.cos(th) - dz * Math.sin(th); // the site, in its own frame (it faces -z)
      const lz = dx * Math.sin(th) + dz * Math.cos(th);
      const rise = 5; // the vault over its chest, about
      const len = Math.hypot(lx, rise, lz) || 1;
      v.blast = {
        t: 0, spent: false, pitch0: v.pitch, twist0: v.twist, part0: v.part,
        twist: Math.max(-1.3, Math.min(1.3, Math.atan2(-lx, -lz))),
        hand: V(0.4 + (lx / len) * 3.3, 2.2 + (rise / len) * 3.3, -0.2 + (lz / len) * 3.3),
      };
      setMat(v, flesh); // not grey yet: it has one thing left to do
    };
    // Folds in on itself over the win beat and stays where it fell (after its last blast, if it has one).
    v.updateDeath = (dt, time, reduced, scene) => {
      const B = v.blast;
      if (B && !B.spent) {
        const beat = WAYOUT.cave.beat;
        if (scene && scene.kind === 'vault') B.t = scene.t;
        else B.t = beat + 1; // the scene was skipped: spent at once
        if (B.t < beat + 0.1) {
          const k = smooth(clamp01(B.t / beat));
          v.hand.lerp(B.hand, Math.min(1, dt * 7));
          poseCantor(v, time, {
            pitch: B.pitch0 + (0.32 - B.pitch0) * k, twist: B.twist0 + (B.twist - B.twist0) * k, surge: 0, sag: 0,
            fold: 0, part: B.part0 + (1 - B.part0) * k, call: k, flare: k, shake: reduced ? 0.3 * k : k, frozen: false, reduced,
          });
          v.core.scale.multiplyScalar(1 + 1.2 * k); // the core gathers
          v.glow.scale.multiplyScalar(1 + 1.1 * k);
          return false;
        }
        B.spent = true;
        v.deathT = 0;
        v.pitch0 = 0.32; v.twist = B.twist; v.open = 0; v.part = 1;
        setMat(v, deadMat);
      }
      v.deathT += dt;
      const k = smooth(clamp01(v.deathT / v.beat));
      goal.set(0.5, 0.1, -0.9);
      v.hand.lerp(goal, Math.min(1, dt * 4));
      poseCantor(v, time, {
        pitch: v.pitch0 + (-1.1 - v.pitch0) * k, twist: v.twist * (1 - k), surge: 0, sag: v.open * (1 - k),
        fold: k, part: v.part * (1 - k), call: 0, flare: 0, shake: 0, frozen: true, reduced,
      });
      if (B) { v.core.visible = false; v.glow.visible = false; } // spent: the core is dark
      return false;
    };
    return v;
  }

  actors.register('lurch', buildLurch);
  actors.register('weeper', buildWeeper);
  actors.register('cantor', buildCantor);

  // ======================================================================================
  // Hazards layer: globs on their drawn arc, hatched landing rings, pools, steam on a hit.
  // ======================================================================================
  let reducedFlash = false;
  const globGeo = new THREE.SphereGeometry(0.16, 10, 8);
  const flatGeo = new THREE.PlaneGeometry(2, 2);
  flatGeo.rotateX(-Math.PI / 2);
  const markerMat = new THREE.MeshBasicMaterial({ map: markerTexture(), transparent: true, depthWrite: false });
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, opacity: 0.85 });
  const globs = new Map();
  const pools = new Map();
  const fading = [];

  function arcPoint(gl, u, cfg, out) {
    // Parabola from the launch point to the ground whose apex clears the launch by arcHeight.
    const a = gl.from.y;
    const H = cfg.glob.arcHeight;
    const s = 8 * a + 16 * H;
    const h = (s + Math.sqrt(Math.max(0, s * s - 64 * a * a))) / 32;
    return out.set(
      gl.from.x + (gl.to.x - gl.from.x) * u,
      a * (1 - u) + 4 * h * u * (1 - u),
      gl.from.z + (gl.to.z - gl.from.z) * u,
    );
  }

  function buildGlob() {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(globGeo, pinkMat);
    ball.castShadow = true;
    const halo = new THREE.Sprite(pinkHalo);
    halo.scale.set(1.1, 1.1, 1);
    g.add(ball, halo);
    const trail = [0.65, 0.4].map((s) => {
      const t = new THREE.Sprite(pinkHalo);
      t.scale.set(s, s, 1);
      scene.add(t);
      return t;
    });
    const marker = new THREE.Mesh(flatGeo, markerMat);
    scene.add(g, marker);
    return { g, trail, marker };
  }

  function dropGlob(v) {
    scene.remove(v.g, v.marker, ...v.trail);
  }

  function buildPool(p) {
    const a = new THREE.Mesh(flatGeo, poolMat);
    const b = new THREE.Mesh(flatGeo, poolMat);
    a.position.set(p.x, 0.022, p.z);
    b.position.set(p.x, 0.028, p.z);
    a.rotation.y = Math.random() * 6;
    scene.add(a, b);
    return { a, b, grow: 0, radius: p.radius, spin: Math.random() < 0.5 ? 1 : -1 };
  }

  // Short-lived sprites: landing bursts (pink) and steam off a salted hide (pale).
  const puffs = [];
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    scene.add(s);
    puffs.push({ s, t: 0, life: 0, from: 0, to: 0, rise: 0, peak: 0 });
  }
  let puffNext = 0;
  function puff(x, y, z, color, additive, from, to, life, rise, peak) {
    const p = puffs[puffNext];
    puffNext = (puffNext + 1) % puffs.length;
    p.s.material.color.set(color);
    p.s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.s.position.set(x, y, z);
    p.s.visible = true;
    Object.assign(p, { t: 0, life, from, to, rise, peak });
  }

  const MOTES = 48;
  const motePos = new Float32Array(MOTES * 3).fill(-100);
  const moteLife = new Float32Array(MOTES);
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: CAVE.pink, size: 0.07, map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  motes.frustumCulled = false;
  scene.add(motes);
  let moteNext = 0;

  let roomIsCave = false;
  actors.addLayer({
    setReducedFlash(v) { reducedFlash = v; },
    onEvent(ev) {
      if (ev.type === 'globLand') {
        // Reduced flash: no burst, the pool simply fades in.
        if (!reducedFlash) puff(ev.x, 0.25, ev.z, CAVE.pink, true, 0.8, ev.radius * 2.4, 0.22, 0, 0.7);
      } else if (ev.type === 'hit' && roomIsCave) {
        puff(ev.x, ev.y, ev.z, 0xcfd8d0, false, 0.25, 0.9, 0.5, 0.7, 0.3); // pale steam off salted hide
      }
    },
    clear() {
      for (const v of globs.values()) dropGlob(v);
      globs.clear();
      for (const v of pools.values()) scene.remove(v.a, v.b);
      pools.clear();
      for (const f of fading) scene.remove(f.a, f.b);
      fading.length = 0;
      for (const p of puffs) { p.s.visible = false; p.life = 0; }
      motePos.fill(-100);
      moteLife.fill(0);
      moteGeo.attributes.position.needsUpdate = true;
    },
    sync(sim, dt, time) {
      const cfg = sim.cfg;
      roomIsCave = !!cfg && cfg.room === 'cave';
      const simGlobs = sim.globs || [];
      const simPools = sim.pools || [];

      const seen = new Set();
      for (const gl of simGlobs) {
        let v = globs.get(gl.id);
        if (!v) {
          v = buildGlob();
          globs.set(gl.id, v);
          v.marker.position.set(gl.to.x, 0.035, gl.to.z);
          v.marker.scale.setScalar(cfg.glob.radius);
        }
        seen.add(gl.id);
        const u = clamp01(gl.t / gl.flight);
        arcPoint(gl, u, cfg, v.g.position);
        v.trail.forEach((t, j) => arcPoint(gl, Math.max(0, u - 0.035 * (j + 1)), cfg, t.position));
        v.marker.rotation.y = time * 0.5;
      }
      for (const [id, v] of globs) {
        if (!seen.has(id)) { dropGlob(v); globs.delete(id); }
      }

      const pseen = new Set();
      for (const p of simPools) {
        let v = pools.get(p.id);
        if (!v) {
          v = buildPool(p);
          pools.set(p.id, v);
        }
        pseen.add(p.id);
        v.grow = Math.min(1, v.grow + dt / (reducedFlash ? 0.6 : 0.25));
        const end = Math.min(1, p.life / 0.5); // shrinks as it goes inert
        const s = p.radius * smooth(v.grow) * (0.6 + 0.4 * end);
        v.a.scale.setScalar(s);
        v.b.scale.setScalar(s * 0.82);
        v.a.rotation.y += dt * 0.25 * v.spin; // the rim curdles
        v.b.rotation.y -= dt * 0.4 * v.spin;
        if (dt > 0 && Math.random() < dt * 7) {
          const i = moteNext;
          moteNext = (moteNext + 1) % MOTES;
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * p.radius * 0.9;
          motePos[i * 3] = p.x + Math.cos(a) * r;
          motePos[i * 3 + 1] = 0.05;
          motePos[i * 3 + 2] = p.z + Math.sin(a) * r;
          moteLife[i] = 1.2;
        }
      }
      for (const [id, v] of pools) {
        if (!pseen.has(id)) {
          pools.delete(id);
          fading.push({ a: v.a, b: v.b, t: 0, s: v.a.scale.x });
        }
      }
      for (let i = fading.length - 1; i >= 0; i--) {
        const f = fading[i];
        f.t += dt;
        const k = 1 - clamp01(f.t / 0.3);
        f.a.scale.setScalar(Math.max(0.001, f.s * k));
        f.b.scale.setScalar(Math.max(0.001, f.s * 0.82 * k));
        if (k <= 0) { scene.remove(f.a, f.b); fading.splice(i, 1); }
      }

      let anyMote = false;
      for (let i = 0; i < MOTES; i++) {
        if (moteLife[i] <= 0) continue;
        anyMote = true;
        moteLife[i] -= dt;
        motePos[i * 3 + 1] += dt * 0.55;
        if (moteLife[i] <= 0) motePos[i * 3 + 1] = -100;
      }
      if (anyMote) moteGeo.attributes.position.needsUpdate = true;

      for (const p of puffs) {
        if (p.life <= 0) continue;
        p.t += dt;
        const k = clamp01(p.t / p.life);
        const s = p.from + (p.to - p.from) * k;
        p.s.scale.set(s, s, 1);
        p.s.position.y += p.rise * dt;
        p.s.material.opacity = p.peak * (1 - k);
        if (k >= 1) { p.s.visible = false; p.life = 0; }
      }
    },
  });
}
