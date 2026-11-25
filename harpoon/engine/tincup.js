// Tin cup viewmodel (R23): a dented tin cup held up by its handle, as crossbow.js is for the
// stake crossbow. Its water is the rules' one fill, sim.waves.items.cup: shown to the brim when
// that reads 'full', a dark empty tin otherwise. `splashThrow` flings it forward and a splash of
// running water leaves it for the place the rules say it reached; `empty` (the fire button with
// nothing in it) turns it over and taps it out. Two draws in hand (cup, water), one for the splash.

import * as THREE from 'three';
import { radialTexture } from './world.js';

const DEG = Math.PI / 180;
const THROW_OUT = 0.11; // seconds for the arm to go forward
const THROW_HOLD = 0.26; // held out until this long after the throw
const THROW_BACK = 0.34; // and this long coming back
const TAP_TIME = 0.46; // an empty cup turned over and tapped
const FILL_TIME = 0.35; // the water rising when it is filled
const SPLASH_TIME = 0.85; // the water in the air and then gone
const DROPS = 90;
const R_TOP = 0.047;
const R_FOOT = 0.04;
const TALL = 0.092;
const BRIM = 0.03; // the water's surface, above the cup's middle

// Poses of the cup in the rig: [x, y, z, rotX, rotY, rotZ]. rotX tips the mouth to the eye
// (positive) or forward and over (negative).
const HELD = [-0.03, 0.07, 0.06, 0.5, -0.5, -0.1];
const THROWN = [-0.06, 0.15, -0.2, -1.25, -0.5, -0.1];
const TIPPED = [-0.04, 0.11, 0.0, -2.05, -0.5, -0.1];
const SCOOP = [-0.03, 0.0, 0.03, 0.75, -0.5, -0.1];

const clamp01 = (k) => Math.max(0, Math.min(1, k));
const smooth = (k) => k * k * (3 - 2 * k);

/** One vertex colour for a part, mottled so the tin reads as worn. */
function paint(geo, hex, vary = 0) {
  const c = new THREE.Color(hex);
  const p = geo.attributes.position;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = 1 + vary * Math.sin(p.getX(i) * 190 + p.getY(i) * 130 + p.getZ(i) * 170);
    arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Parts into one geometry (position, normal, colour), so the cup is a single draw. */
function join(parts) {
  let nv = 0; let ni = 0;
  for (const p of parts) { nv += p.attributes.position.count; ni += p.index.count; }
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const arr = new Float32Array(nv * 3);
    let o = 0;
    for (const p of parts) { arr.set(p.attributes[name].array.subarray(0, p.attributes[name].count * 3), o); o += p.attributes[name].count * 3; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  const idx = new Uint16Array(ni);
  let io = 0; let vo = 0;
  for (const p of parts) {
    for (let i = 0; i < p.index.count; i++) idx[io++] = p.index.array[i] + vo;
    vo += p.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function cupGeometry() {
  const TIN = 0xaab0ae;
  // a dent in one side, pressed into the outer wall and its lining alike
  const dent = (geo) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const d = Math.exp(-(((a - 2.2) / 0.45) ** 2) - ((p.getY(i) + 0.01) / 0.03) ** 2) * 0.007;
      const r = Math.hypot(p.getX(i), p.getZ(i));
      p.setX(i, p.getX(i) * (1 - d / r));
      p.setZ(i, p.getZ(i) * (1 - d / r));
    }
    geo.computeVertexNormals();
    return geo;
  };
  const wall = paint(dent(new THREE.CylinderGeometry(R_TOP, R_FOOT, TALL, 18, 3, true)), TIN, 0.09);
  const inside = paint(dent(new THREE.CylinderGeometry(R_TOP - 0.002, R_FOOT - 0.002, TALL - 0.004, 18, 3, true)), 0x3d4443, 0.05);
  const floor = paint(new THREE.CircleGeometry(R_FOOT - 0.002, 18).rotateX(-Math.PI / 2).translate(0, -TALL / 2 + 0.004, 0), 0x2c3231);
  const foot = paint(new THREE.CircleGeometry(R_FOOT, 18).rotateX(Math.PI / 2).translate(0, -TALL / 2, 0), 0x6f7674);
  const rim = paint(new THREE.TorusGeometry(R_TOP, 0.0035, 5, 18).rotateX(Math.PI / 2).translate(0, TALL / 2, 0), 0xc9cecb, 0.04);
  const seam = paint(new THREE.TorusGeometry(R_FOOT + 0.001, 0.0025, 4, 18).rotateX(Math.PI / 2).translate(0, -TALL / 2 + 0.003, 0), 0x7d8482);
  // the handle: a strap bent in a half ring off the +X side
  const handle = paint(new THREE.TorusGeometry(0.03, 0.006, 5, 10, Math.PI).scale(1, 1, 1.6).rotateZ(-Math.PI / 2).translate(R_TOP - 0.004, 0.002, 0), 0x8f9694, 0.06);
  return join([wall, inside, floor, foot, rim, seam, handle]);
}

/** worldCamera (optional): the world scene's camera; the splash is drawn in its scene. */
export function createTinCup(worldCamera) {
  const group = new THREE.Group(); // animated pose
  const tin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.55, side: THREE.DoubleSide });
  const cup = new THREE.Mesh(cupGeometry(), tin);
  cup.frustumCulled = false;
  group.add(cup);

  // The water: a bright disc at the brim that rocks a little, as running water just dipped would.
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x7fc4de, emissive: 0x1f6f8c, emissiveIntensity: 0.5, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.92,
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2), waterMat);
  water.visible = false;
  group.add(water);

  // ---- the splash: one cloud of drops from the cup to where the throw reached -------------------
  const dropGeo = new THREE.BufferGeometry();
  const dropPos = new Float32Array(DROPS * 3);
  dropGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
  const dropMat = new THREE.PointsMaterial({
    map: radialTexture('rgba(226,244,250,1)', 'rgba(150,205,225,0)', 64), color: 0xffffff, size: 0.2,
    transparent: true, depthWrite: false, sizeAttenuation: true,
  });
  const drops = new THREE.Points(dropGeo, dropMat);
  drops.visible = false;
  drops.frustumCulled = false;
  // each drop's own way: how far across the cone, how far out, how high, how late and how long
  let s = 20231;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const plan = Array.from({ length: DROPS }, () => ({ across: rnd() * 2 - 1, out: 0.4 + 0.6 * rnd(), lift: 0.15 + 0.4 * rnd(), late: rnd() * 0.18, time: 0.3 + 0.12 * rnd() }));
  const from = new THREE.Vector3();
  const eye = new THREE.Vector3();
  let aimX = 0; let aimZ = -1; let reachLen = 5; let floorY = -1.2;

  let cfg = { reach: 5, cone: 25 };
  let full = false;
  let seen = false; // the fill has been read at least once (the first reading snaps, no scoop)
  let level = 0; // 0 dry .. 1 to the brim
  let throwT = -1;
  let tapT = -1;
  let fillT = -1;
  let splashT = -1;
  let clock = 0;
  let adrift = false; // the splash is finishing on its own after the cup was put away
  let adriftAt = 0;

  function pose(a, b, k, dy = 0) {
    const at = (i) => a[i] + k * (b[i] - a[i]);
    group.position.set(at(0), at(1) + dy, at(2));
    group.rotation.set(at(3), at(4), at(5));
  }

  function setLevel(k) {
    level = k;
    water.visible = k > 0.02;
    if (!water.visible) return;
    const y = -TALL / 2 + 0.008 + (BRIM + TALL / 2 - 0.008) * k;
    const r = R_FOOT + (R_TOP - R_FOOT) * ((y + TALL / 2) / TALL) - 0.003;
    water.position.y = y;
    water.scale.set(r, 1, r);
  }

  /** The drops' root and the line they fly: the world when there is one, else the hand's own scene. */
  function startSplash(ev) {
    let root = worldCamera && worldCamera.parent;
    const inWorld = !!root && Number.isFinite(ev.x) && Number.isFinite(ev.z);
    if (inWorld) {
      worldCamera.getWorldPosition(eye);
      const dx = ev.x - eye.x; const dz = ev.z - eye.z;
      reachLen = Math.hypot(dx, dz) || cfg.reach || 5;
      aimX = dx / reachLen; aimZ = dz / reachLen;
      // from just ahead of the eye, low and to the right, where the cup is
      from.set(eye.x + aimX * 0.8 - aimZ * 0.14, eye.y - 0.14, eye.z + aimZ * 0.8 + aimX * 0.14);
      floorY = eye.y - 1.25;
    } else {
      root = group;
      while (root.parent) root = root.parent;
      if (root === group) return; // not in a scene: nothing to throw it into
      reachLen = cfg.reach || 5;
      aimX = 0; aimZ = -1;
      from.set(0.16, -0.14, -0.8);
      floorY = -1.25;
    }
    if (drops.parent !== root) root.add(drops);
    adrift = false;
    splashT = 0;
    placeDrops();
    drops.visible = true;
  }

  function placeDrops() {
    const half = (cfg.cone || 25) * DEG * 0.9;
    for (let i = 0; i < DROPS; i++) {
      const d = plan[i];
      if (splashT < d.late) { // not yet out of the cup: parked out of sight, so no pale ball hangs at the rim
        dropPos[i * 3] = from.x; dropPos[i * 3 + 1] = from.y - 1000; dropPos[i * 3 + 2] = from.z;
        continue;
      }
      const u = clamp01((splashT - d.late) / d.time);
      const a = d.across * half;
      const cx = aimX * Math.cos(a) - aimZ * Math.sin(a);
      const cz = aimZ * Math.cos(a) + aimX * Math.sin(a);
      const far = reachLen * d.out * u;
      dropPos[i * 3] = from.x + cx * far;
      dropPos[i * 3 + 1] = from.y + (floorY + 0.35 * (1 - d.out) - from.y) * u * u + d.lift * 4 * u * (1 - u);
      dropPos[i * 3 + 2] = from.z + cz * far;
    }
    dropGeo.attributes.position.needsUpdate = true;
    dropMat.opacity = 0.78 * clamp01(splashT / 0.05) * (1 - smooth(clamp01((splashT - 0.5) / (SPLASH_TIME - 0.5))));
  }

  function onEvent(ev) {
    if (ev.type === 'splashThrow') {
      throwT = 0;
      tapT = -1;
      fillT = -1;
      startSplash(ev);
    } else if (ev.type === 'restored') {
      seen = false; // a checkpoint came back: the next reading of the fill snaps, no dip
      fillT = -1;
    } else if (ev.type === 'empty') {
      if (throwT < 0 && tapT < 0) tapT = 0; // held down, `empty` repeats: one tap plays out first
    }
  }

  function endSplash() {
    splashT = -1;
    adrift = false;
    drops.visible = false;
  }

  // Put away mid-throw (a swap): update stops being called, so water already in the air flies
  // on by the wall clock from its own draw, and is gone when it lands.
  drops.onBeforeRender = () => {
    if (!adrift || splashT < 0) return;
    const now = performance.now();
    splashT += Math.min(0.05, (now - adriftAt) / 1000);
    adriftAt = now;
    if (splashT >= SPLASH_TIME) endSplash();
    else placeDrops();
  };

  function cancel() {
    throwT = -1;
    tapT = -1;
    fillT = -1;
    endSplash();
    seen = false; // the next reading of the fill snaps
    setLevel(full ? 1 : 0);
    pose(HELD, HELD, 0);
  }

  /**
   * sim (optional fourth argument): the fill is read from sim.waves.items.cup every frame. When
   * no sim is handed in, the last known fill stands (see setFull).
   */
  function update(dt, player, weapon, sim) {
    clock += dt;
    const items = sim && sim.waves && sim.waves.items;
    if (items) setFull(items.cup === 'full');

    if (splashT >= 0) {
      adrift = false;
      splashT += dt;
      if (splashT >= SPLASH_TIME) endSplash();
      else placeDrops();
    }

    // The water: gone at once when thrown, risen over a moment when dipped.
    if (fillT >= 0) {
      fillT += dt;
      if (fillT >= FILL_TIME) fillT = -1;
    }
    setLevel(full ? (fillT >= 0 ? smooth(clamp01(fillT / FILL_TIME)) : 1) : 0);
    if (water.visible) {
      const walk = player && player.moving ? 0.09 : 0.03;
      water.rotation.set(Math.sin(clock * 5.3) * walk, 0, Math.cos(clock * 4.1) * walk);
    }

    if (throwT >= 0) {
      throwT += dt;
      const out = clamp01(throwT / THROW_OUT);
      const back = smooth(clamp01((throwT - THROW_HOLD) / THROW_BACK));
      pose(HELD, THROWN, (1 - (1 - out) * (1 - out)) * (1 - back));
      if (back >= 1) throwT = -1;
    } else if (tapT >= 0) {
      tapT += dt;
      const k = tapT / TAP_TIME;
      const over = smooth(clamp01(k / 0.25)) * (1 - smooth(clamp01((k - 0.72) / 0.28)));
      // two short knocks while it is upside down: nothing comes out
      const knock = k > 0.25 && k < 0.72 ? -Math.abs(Math.sin(((k - 0.25) / 0.47) * Math.PI * 2)) * 0.022 : 0;
      pose(HELD, TIPPED, over, knock);
      if (k >= 1) tapT = -1;
    } else if (fillT >= 0) {
      pose(HELD, SCOOP, Math.sin(Math.PI * clamp01(fillT / FILL_TIME)));
    } else {
      pose(HELD, HELD, 0);
    }
  }

  function setFull(v) {
    const now = !!v;
    if (seen && now && !full) fillT = 0; // dipped at running water
    if (!now) fillT = -1;
    full = now;
    seen = true;
  }

  pose(HELD, HELD, 0);

  return {
    group, onEvent, update, cancel,
    setReducedFlash() { /* no flash to reduce */ },
    /** weaponCfg: the cup's spec (reach and cone shape the splash). */
    setConfig(weaponCfg) { if (weaponCfg) cfg = weaponCfg; },
    setActive(on) {
      group.visible = !!on;
      if (on) return;
      const flying = splashT;
      cancel();
      if (flying >= 0) { splashT = flying; adrift = true; adriftAt = performance.now(); drops.visible = true; }
    },
    /** For a caller that cannot hand the sim to update: the fill, true when sim.waves.items.cup is 'full'. */
    setFull,
    get full() { return full; },
    get level() { return level; },
  };
}
