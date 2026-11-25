// Salt Bore viewmodel: the warden's second tool. A crate-oxide receiver with the bone-chalk
// tally stripe, a short fat bone-white barrel over a pump sleeve, and a glass hopper jar whose
// salt level is the magazine. Also owns the bore's world-side parts: seven tracers per blast
// and the weak salt-white pilot light (both hang off the world camera when one is given).

import * as THREE from 'three';
import { PALETTE } from './world.js';
import { CAVE, glowTexture } from './cave.js';

const DEG = Math.PI / 180;
const KICK = 0.09; // metres back
const KICK_PITCH = 5 * DEG;
const KICK_TIME = 0.28;
const PUMP_AT = 0.3;
const PUMP_TIME = 0.3;
const TRACER_TIME = 0.06;
const PILOT = 11; // candela, reach 6 m, no shadow
const PILOT_REACH = 6;
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const smooth = (k) => k * k * (3 - 2 * k);

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.translate(128, 64);
  g.scale(2, 1);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(244,241,230,0.85)');
  grad.addColorStop(1, 'rgba(244,241,230,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, 62, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 7; i++) {
    g.rotate((Math.PI * 2) / 7);
    g.beginPath();
    g.moveTo(-5, 0);
    g.lineTo(0, -60);
    g.lineTo(5, 0);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * worldCamera (optional) is the camera of the world scene: tracers are drawn in its scene and
 * the pilot light rides on it. Without it the bore still animates but has neither.
 */
export function createBore(worldCamera) {
  const group = new THREE.Group(); // animated pose: kick, pump dip, reload tip
  const gun = new THREE.Group();
  gun.scale.setScalar(0.72);
  group.add(gun);

  const oxide = new THREE.MeshStandardMaterial({ color: PALETTE.oxide, roughness: 0.55, metalness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f2f, roughness: 0.4, metalness: 0.8 });
  const rust = new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.6, metalness: 0.4 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xd9d4c3, roughness: 0.45, metalness: 0.1 });
  const chalk = new THREE.MeshBasicMaterial({ color: PALETTE.chalk });
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xbfe0d8, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.26, depthWrite: false,
  });
  const saltMat = new THREE.MeshStandardMaterial({ color: CAVE.salt, emissive: CAVE.salt, emissiveIntensity: 0.25, roughness: 0.9 });
  const lampMat = new THREE.MeshBasicMaterial({ color: CAVE.salt });

  const mesh = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };
  const tube = (r0, r1, len, seg) => new THREE.CylinderGeometry(r0, r1, len, seg).rotateX(Math.PI / 2);

  // Receiver and furniture: the same family as the carbine.
  const grip = mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), steel, 0, -0.1, 0.12);
  grip.rotation.x = -0.3;
  gun.add(
    mesh(new THREE.BoxGeometry(0.1, 0.12, 0.3), oxide, 0, 0, 0.02),
    mesh(new THREE.BoxGeometry(0.075, 0.095, 0.15), steel, 0, -0.03, 0.24),
    grip,
    mesh(new THREE.BoxGeometry(0.014, 0.004, 0.2), chalk, 0, 0.062, 0.02), // tally stripe
    mesh(new THREE.BoxGeometry(0.105, 0.03, 0.04), rust, 0, 0, -0.1),
  );

  // Break-open fore end: barrel, muzzle band, pump sleeve on its rod. Hinged under the receiver.
  const fore = new THREE.Group();
  fore.position.set(0, -0.02, -0.13);
  const bore = mesh(new THREE.CircleGeometry(0.03, 16).rotateY(Math.PI), black, 0, 0.045, -0.3012); // 6 cm bore
  const sleeve = mesh(tube(0.03, 0.03, 0.13, 10), rust, 0, -0.012, -0.15);
  fore.add(
    mesh(tube(0.042, 0.042, 0.3, 16), bone, 0, 0.045, -0.15),
    mesh(tube(0.047, 0.047, 0.03, 16), steel, 0, 0.045, -0.285),
    bore,
    mesh(tube(0.008, 0.008, 0.27, 6), steel, 0, -0.012, -0.14),
    sleeve,
  );
  gun.add(fore);

  // Hopper jar on the left side; the salt column is the magazine.
  const JAR = { x: -0.1, y: -0.03, z: 0.02, h: 0.11 };
  const salt = mesh(new THREE.CylinderGeometry(0.033, 0.033, JAR.h - 0.012, 12).translate(0, (JAR.h - 0.012) / 2, 0), saltMat, JAR.x, JAR.y + 0.004, JAR.z);
  const jar = mesh(new THREE.CylinderGeometry(0.04, 0.04, JAR.h, 14), glass, JAR.x, JAR.y + JAR.h / 2, JAR.z);
  jar.renderOrder = 2;
  gun.add(
    mesh(new THREE.BoxGeometry(0.03, 0.02, 0.05), steel, -0.058, 0, JAR.z),
    mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.012, 14), rust, JAR.x, JAR.y + JAR.h + 0.004, JAR.z),
    mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.01, 14), rust, JAR.x, JAR.y - 0.003, JAR.z),
    salt,
    jar,
  );
  const lamp = mesh(new THREE.SphereGeometry(0.012, 8, 6), lampMat, 0.035, 0.068, 0.14); // ready lamp
  gun.add(lamp);

  const flashMat = new THREE.MeshBasicMaterial({
    map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const flash = mesh(new THREE.PlaneGeometry(0.62, 0.36), flashMat, 0, 0.025, -0.47);
  flash.visible = false;
  const dimLamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(64), color: CAVE.salt, transparent: true, opacity: 0.5, depthWrite: false }));
  dimLamp.scale.set(0.1, 0.1, 1);
  dimLamp.position.set(0, 0.025, -0.46);
  dimLamp.visible = false;
  const muzzleLight = new THREE.PointLight(CAVE.salt, 0, 2.5, 2);
  muzzleLight.position.set(0, 0.05, -0.5);
  gun.add(flash, dimLamp, muzzleLight);

  // ---- world side: pilot light and tracers ------------------------------------------------
  const pilot = new THREE.PointLight(CAVE.salt, PILOT, PILOT_REACH, 1.2);
  pilot.position.set(0.12, -0.1, -0.15);
  pilot.visible = false;
  if (worldCamera) worldCamera.add(pilot);
  const tracerMat = new THREE.LineBasicMaterial({
    color: CAVE.salt, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, fog: false, depthWrite: false,
  });
  const tracers = [];
  let tracerRoot = null;
  function ensureTracers(n) {
    if (!tracerRoot) tracerRoot = worldCamera && worldCamera.parent;
    if (!tracerRoot) return false;
    while (tracers.length < n) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geom, tracerMat);
      line.visible = false;
      line.frustumCulled = false;
      tracerRoot.add(line);
      tracers.push(line);
    }
    return true;
  }
  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const start = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  let cfg = { magazine: 6, reloadTime: 1.8 };
  let active = false;
  let reduced = false;
  let sinceShot = 9;
  let flashLeft = 0;
  let tracerLeft = 0;
  let level = 1; // salt shown in the jar, 0..1
  let reloadFrom = -1; // level when the reload began; -1 when not reloading

  function hideTracers() {
    tracerLeft = 0;
    for (const t of tracers) t.visible = false;
  }

  function onEvent(ev) {
    if (ev.type !== 'shot') return;
    sinceShot = 0;
    flashLeft = TRACER_TIME;
    flash.rotation.z = (Math.random() - 0.5) * 0.5;
    flash.scale.setScalar(0.9 + Math.random() * 0.25);
    const pellets = ev.pellets || [{ to: ev.to }];
    if (!ev.from || !ensureTracers(pellets.length)) return;
    // All seven leave the muzzle: a point ahead of the eye, low and to the right.
    dir.set(ev.to.x - ev.from.x, ev.to.y - ev.from.y, ev.to.z - ev.from.z).normalize();
    right.crossVectors(dir, UP).normalize();
    start.set(ev.from.x, ev.from.y, ev.from.z).addScaledVector(dir, 0.6).addScaledVector(right, 0.16);
    start.y -= 0.14;
    tracers.forEach((line, i) => {
      const p = pellets[i];
      line.visible = !!p;
      if (!p) return;
      const a = line.geometry.attributes.position;
      a.setXYZ(0, start.x, start.y, start.z);
      a.setXYZ(1, p.to.x, p.to.y, p.to.z);
      a.needsUpdate = true;
    });
    tracerLeft = TRACER_TIME;
  }

  function cancel() {
    sinceShot = 9;
    flashLeft = 0;
    reloadFrom = -1;
    hideTracers();
  }

  function update(dt, player, weapon) {
    sinceShot += dt;
    flashLeft = Math.max(0, flashLeft - dt);
    if (tracerLeft > 0) {
      tracerLeft -= dt;
      if (tracerLeft <= 0) hideTracers();
    }
    const firing = flashLeft > 0;
    flash.visible = firing && !reduced;
    dimLamp.visible = firing && reduced; // reduced flash: a dim lamp blink
    muzzleLight.intensity = firing && !reduced ? 7 : 0;
    pilot.intensity = PILOT + (firing && !reduced ? 30 : 0); // the blast lights the rock for 60 ms

    const kick = clamp01(1 - sinceShot / KICK_TIME) ** 2;
    const pumpT = (sinceShot - PUMP_AT) / PUMP_TIME;
    const pump = pumpT > 0 && pumpT < 1 ? Math.sin(Math.PI * pumpT) : 0;

    // Reload: breaks open and tips so the jar faces up, refills over the reload, snaps shut.
    let open = 0;
    const mag = cfg.magazine || 1;
    if (weapon.reloading) {
      if (reloadFrom < 0) reloadFrom = weapon.mag / mag;
      const p = clamp01(1 - weapon.reloadLeft / (cfg.reloadTime || 1.8));
      open = smooth(clamp01(p / 0.14)) * (1 - smooth(clamp01((p - 0.88) / 0.12)));
      const full = Math.min(mag, weapon.mag + weapon.reserve) / mag;
      level = reloadFrom + (full - reloadFrom) * clamp01((p - 0.14) / 0.7);
    } else {
      reloadFrom = -1;
      level += (weapon.mag / mag - level) * Math.min(1, dt * 14);
    }
    salt.scale.y = Math.max(0.02, level);
    salt.visible = level > 0.01;
    lampMat.color.set(weapon.reloading ? 0x15140f : CAVE.salt); // dark while reloading

    group.position.set(-0.03 * open, -0.05 * open - 0.012 * pump, KICK * kick + 0.015 * pump);
    group.rotation.set(KICK_PITCH * kick + 0.12 * open, 0.3 * open, -0.45 * open);
    fore.rotation.x = -0.6 * open;
    sleeve.position.z = -0.15 + 0.055 * pump;
  }

  return {
    group, onEvent, update, cancel,
    setReducedFlash(v) { reduced = !!v; },
    /** weaponCfg: the room's cfg.weapon (magazine and reloadTime are read). */
    setConfig(weaponCfg) { if (weaponCfg) cfg = weaponCfg; },
    setActive(on) {
      active = !!on;
      pilot.visible = active;
      if (!active) cancel();
    },
  };
}
