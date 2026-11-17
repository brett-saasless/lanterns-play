// Garlic viewmodel (#9): the dried braid wielded like the other tools (crossbow.js, tincup.js).
// Down, it hangs from the warden's fist at the right of the view; while the rules hold it up
// (weapon.raise > 0, sentries.js raiseGarlic) it is thrust up and out before the face, then
// lowered. It spends nothing and throws nothing, so this is pose only. Three draws: the twine,
// the bulbs (one instanced mesh) and their papery tips (one instanced mesh).

import * as THREE from 'three';

const BULBS = 6;
const UP_TIME = 0.12; // seconds to come up
const DOWN_TIME = 0.22; // and to go down again

// Poses in the rig: [x, y, z, rotX, rotY, rotZ].
const DOWN = [0.02, -0.06, 0.02, 0.35, 0.2, -0.15];
const UP = [-0.12, 0.12, -0.12, -0.25, 0.1, 0.12];

const smooth = (k) => k * k * (3 - 2 * k);
const at = [0, 0, 0, 0, 0, 0]; // the pose this frame, reused (no allocation per frame)

export function createBraid() {
  const group = new THREE.Group();
  const holder = new THREE.Group(); // the fist: everything hangs from here
  group.scale.setScalar(0.75); // a hand's braid, not a wreath across the view
  group.add(holder);
  const dry = new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 0.95, metalness: 0 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe9e1cc, roughness: 0.8, metalness: 0 });
  const twine = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.34, 6), dry);
  twine.position.y = -0.15;
  holder.add(twine);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.036, 8, 6), skin, BULBS);
  const tips = new THREE.InstancedMesh(new THREE.ConeGeometry(0.012, 0.03, 5), dry, BULBS);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 0.85, 1);
  for (let i = 0; i < BULBS; i++) {
    const p = new THREE.Vector3(Math.sin(i * 2.1) * 0.03, -0.29 + i * 0.05, Math.cos(i * 2.1) * 0.025);
    bulbs.setMatrixAt(i, m.compose(p, q, one));
    tips.setMatrixAt(i, m.compose(p.clone().add(new THREE.Vector3(0, 0.04, 0)), q, new THREE.Vector3(1, 1, 1)));
  }
  bulbs.instanceMatrix.needsUpdate = true;
  tips.instanceMatrix.needsUpdate = true;
  holder.add(bulbs, tips);
  for (const x of [twine, bulbs, tips]) x.frustumCulled = false;

  let k = 0; // 0 down, 1 held up
  let sway = 0;

  function pose(at) {
    holder.position.set(at[0], at[1], at[2]);
    holder.rotation.set(at[3], at[4], at[5]);
  }
  pose(DOWN);

  function cancel() {
    k = 0;
    pose(DOWN);
  }

  /** weapon: the garlic in hand; raise > 0 while the rules hold it up. */
  function update(dt, player, weapon) {
    const up = !!(weapon && weapon.raise > 0);
    k = Math.max(0, Math.min(1, k + (up ? dt / UP_TIME : -dt / DOWN_TIME)));
    sway += dt * (player && player.moving ? 6 : 1.5);
    const e = smooth(k);
    for (let i = 0; i < 6; i++) at[i] = DOWN[i] + (UP[i] - DOWN[i]) * e;
    pose(at);
    holder.rotation.z += 0.04 * Math.sin(sway) * (1 - e); // the braid swings a little at the side
  }

  return {
    group, update, cancel,
    onEvent() { /* the pose follows weapon.raise; garlicUp is heard, not drawn */ },
    setReducedFlash() { /* no flash */ },
    setConfig() { /* no numbers needed: the rules time the raise */ },
    setActive(on) {
      group.visible = !!on;
      if (!on) cancel();
    },
    get raised() { return k; },
  };
}
