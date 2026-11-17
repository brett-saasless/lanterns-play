// Stake crossbow viewmodel: the warden's third tool in the Rose Court, as bore.js is for the salt
// gun. A short wooden tiller with a brass-bound prod, a string that is drawn back over the 2.2 s
// the rules call a reload, and one white stake on the rail (paler and notched when it is a worn
// one). It also owns its world-side part: a stake in flight, drawn from the muzzle to where the
// shot ended for a tenth of a second (the rules are hitscan; the slowness is the draw).

import * as THREE from 'three';

const KICK = 0.07; // metres back
const KICK_TIME = 0.22;
const FLIGHT_TIME = 0.1;
const RELAXED = -0.16; // the nock's z with the string at rest
const DRAWN = 0.1; // and drawn
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const smooth = (k) => k * k * (3 - 2 * k);

/** worldCamera (optional): the world scene's camera; the flight is drawn in its scene. */
export function createCrossbow(worldCamera) {
  const group = new THREE.Group(); // animated pose: kick and the draw's tip
  const gun = new THREE.Group();
  gun.scale.setScalar(0.8);
  group.add(gun);

  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.7, metalness: 0.05 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x3f2b1a, roughness: 0.75, metalness: 0.05 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.4, metalness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f2f, roughness: 0.4, metalness: 0.8 });
  const stakeMat = new THREE.MeshStandardMaterial({ color: 0xe6dcc0, roughness: 0.6, metalness: 0 });
  const wornMat = new THREE.MeshStandardMaterial({ color: 0xb4a98a, roughness: 0.85, metalness: 0 });
  const stringMat = new THREE.LineBasicMaterial({ color: 0xe8e2d0 });

  const mesh = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };

  // Tiller: stock, rail, trigger housing, a brass band and the foot stirrup at the front.
  const grip = mesh(new THREE.BoxGeometry(0.045, 0.1, 0.05), darkWood, 0, -0.085, 0.14);
  grip.rotation.x = -0.25;
  gun.add(
    mesh(new THREE.BoxGeometry(0.06, 0.07, 0.3), wood, 0, -0.01, 0.2),
    mesh(new THREE.BoxGeometry(0.05, 0.045, 0.52), wood, 0, 0.012, -0.1),
    mesh(new THREE.BoxGeometry(0.036, 0.012, 0.46), steel, 0, 0.04, -0.1), // the flight groove
    mesh(new THREE.BoxGeometry(0.056, 0.05, 0.08), steel, 0, -0.03, 0.06),
    mesh(new THREE.BoxGeometry(0.058, 0.052, 0.03), brass, 0, 0.012, -0.28),
    mesh(new THREE.BoxGeometry(0.058, 0.052, 0.03), brass, 0, -0.01, 0.34),
    grip,
  );
  const stirrup = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 5, 12), steel);
  stirrup.position.set(0, 0.012, -0.36);
  gun.add(stirrup);

  // Prod: two limbs swept back from the front of the rail, a brass cap on each tip.
  const prod = new THREE.Group();
  prod.position.set(0, 0.03, -0.3);
  gun.add(prod);
  const limbs = [-1, 1].map((side) => {
    const pivot = new THREE.Group(); // flexes as the string is drawn
    const limb = mesh(new THREE.BoxGeometry(0.2, 0.014, 0.028), wood, side * 0.1, 0, 0);
    const cap = mesh(new THREE.BoxGeometry(0.02, 0.02, 0.034), brass, side * 0.205, 0, 0);
    pivot.add(limb, cap);
    pivot.rotation.y = -side * 0.22; // swept back
    prod.add(pivot);
    return { side, pivot };
  });

  // String: tip, nock, tip. The nock rides the rail back as the string is drawn.
  const strGeo = new THREE.BufferGeometry();
  strGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  const str = new THREE.Line(strGeo, stringMat);
  str.frustumCulled = false;
  gun.add(str);
  const nock = mesh(new THREE.BoxGeometry(0.014, 0.014, 0.02), steel, 0, 0.03, RELAXED);
  gun.add(nock);

  // The stake on the rail: a thin cone with a point to the front; the notch is a dark wedge.
  const stake = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.3, 6).rotateX(Math.PI / 2), stakeMat);
  const point = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.07, 6).rotateX(-Math.PI / 2), stakeMat);
  point.position.z = -0.185;
  const notch = mesh(new THREE.BoxGeometry(0.012, 0.006, 0.02), darkWood, 0, 0.008, -0.02);
  notch.visible = false;
  stake.add(shaft, point, notch);
  stake.position.set(0, 0.052, -0.12);
  gun.add(stake);

  // ---- world side: the stake in flight --------------------------------------------------------
  const flight = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 5).rotateX(Math.PI / 2), stakeMat);
  flight.visible = false;
  flight.frustumCulled = false;
  let flightRoot = null;
  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const FWD = new THREE.Vector3(0, 0, 1);

  let cfg = { magazine: 1, reloadTime: 2.2 };
  let sinceShot = 9;
  let flightLeft = 0;
  let nockZ = RELAXED;
  let loadedWorn = false;

  function setString(z) {
    nockZ = z;
    nock.position.z = z;
    const a = strGeo.attributes.position;
    // the tips sit at the limbs' ends, swept back; the string runs tip to nock to tip
    const tip = 0.205 * Math.cos(0.22);
    const tipZ = -0.3 + 0.205 * Math.sin(0.22);
    a.setXYZ(0, -tip, 0.03, tipZ);
    a.setXYZ(1, 0, 0.03, z);
    a.setXYZ(2, tip, 0.03, tipZ);
    a.needsUpdate = true;
    for (const l of limbs) l.pivot.rotation.y = -l.side * (0.22 + 0.25 * clamp01((z - RELAXED) / (DRAWN - RELAXED)));
    stake.position.z = z - 0.01;
  }
  setString(RELAXED);

  function onEvent(ev) {
    if (ev.type !== 'shot') return;
    sinceShot = 0;
    if (!flightRoot) flightRoot = worldCamera && worldCamera.parent;
    if (!ev.from || !ev.to || !flightRoot) return;
    if (!flight.parent) flightRoot.add(flight);
    dir.set(ev.to.x - ev.from.x, ev.to.y - ev.from.y, ev.to.z - ev.from.z);
    const len = dir.length();
    if (len < 0.5) return;
    dir.normalize();
    right.crossVectors(dir, UP).normalize();
    // from just ahead of the eye, low and to the right, to where the stake stopped
    const sx = ev.from.x + dir.x * 0.6 + right.x * 0.1;
    const sy = ev.from.y + dir.y * 0.6 - 0.12;
    const sz = ev.from.z + dir.z * 0.6 + right.z * 0.1;
    mid.set((sx + ev.to.x) / 2, (sy + ev.to.y) / 2, (sz + ev.to.z) / 2);
    flight.position.copy(mid);
    flight.quaternion.setFromUnitVectors(FWD, dir.set(ev.to.x - sx, ev.to.y - sy, ev.to.z - sz).normalize());
    flight.scale.set(1, 1, Math.hypot(ev.to.x - sx, ev.to.y - sy, ev.to.z - sz));
    flight.visible = true;
    flightLeft = FLIGHT_TIME;
  }

  function cancel() {
    sinceShot = 9;
    flightLeft = 0;
    flight.visible = false;
    setString(RELAXED);
  }

  function update(dt, player, weapon) {
    sinceShot += dt;
    if (flightLeft > 0) {
      flightLeft -= dt;
      if (flightLeft <= 0) flight.visible = false;
    }
    // The draw is the reload: the nock rides back over reloadTime, then the stake is on the string.
    let p = 0;
    if (weapon.reloading) p = clamp01(1 - weapon.reloadLeft / (cfg.reloadTime || 2.2));
    else if (weapon.mag > 0) p = 1;
    setString(RELAXED + (DRAWN - RELAXED) * smooth(p));
    const loaded = weapon.mag > 0 || (weapon.reloading && p > 0.85);
    stake.visible = loaded;
    if (weapon.loadedWorn !== loadedWorn) loadedWorn = !!weapon.loadedWorn;
    const worn = loadedWorn && weapon.mag > 0;
    for (const m of [shaft, point]) m.material = worn ? wornMat : stakeMat;
    notch.visible = worn;

    const kick = clamp01(1 - sinceShot / KICK_TIME) ** 2;
    const tip = weapon.reloading ? Math.sin(Math.PI * p) * 0.5 : 0; // tips down to brace the stirrup
    group.position.set(0, -0.03 * tip, KICK * kick);
    group.rotation.set(0.06 * kick + 0.22 * tip, 0, 0);
  }

  return {
    group, onEvent, update, cancel,
    setReducedFlash() { /* no flash to reduce */ },
    /** weaponCfg: the crossbow's spec (reloadTime is read). */
    setConfig(weaponCfg) { if (weaponCfg) cfg = weaponCfg; },
    setActive(on) {
      group.visible = !!on;
      if (!on) cancel();
    },
    get nock() { return nockZ; },
  };
}
