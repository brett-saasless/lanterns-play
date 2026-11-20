// The castle's hand lantern in the warden's hand (logic/lantern.js): the shape of the lanterns met
// before the castle (the gate-post lanterns, PAL.lantern, and the Bat's hung ones in props.js: a
// peaked iron cap with a ring, four corner posts, a base plate, the glass box between), held up by
// its ring at the lower right of the view, lit from within, with a faint halo. It swings a little
// behind the look as the warden turns (the light in the room lags the same way, castle.js), and
// sways as they walk. Pose only: the rules fire nothing with it. Four draws: the iron (one merged
// mesh), the glass, the flame, the halo; nothing is made per frame.

import * as THREE from 'three';
import { radialTexture } from './world.js';
import * as S from './sculpt.js';

const GLASS_HEX = 0xffb347; // amber, toward the gate-post lanterns' glass as they read at night (court.js PAL.lantern 0xffc66b)
const IRON = 0x2b2326;
const DOWN = [0.03, -0.035, 0.03]; // the pose in the rig, the glass's middle (the fist is above it, at the ring)
const _swing = { x: 0, z: 0 };

export function createHandLamp() {
  const group = new THREE.Group();
  group.scale.setScalar(0.3); // the owner (SMALL): a hand lantern at the lower right, all of it in frame
  group.position.set(0.04, 0.02, 0); // a little right, its base clear of the screen's bottom edge: all of it in frame, left of the ammo plate
  const holder = new THREE.Group(); // the fist at the ring: the lantern hangs and swings from here
  holder.position.set(DOWN[0], DOWN[1] + 0.2, DOWN[2]);
  group.add(holder);
  const body = new THREE.Group(); // the lantern itself, its glass's middle 0.2 below the ring
  body.position.y = -0.2;
  holder.add(body);

  const box = (w, h, d, x, y, z) => S.tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), IRON);
  const iron = S.merge([
    S.tint(new THREE.ConeGeometry(0.15, 0.1, 4).rotateY(Math.PI / 4).translate(0, 0.19, 0), IRON), // the peaked cap
    box(0.22, 0.022, 0.22, 0, 0.14, 0), // the cap's rim
    box(0.22, 0.03, 0.22, 0, -0.145, 0), // the base plate
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => box(0.018, 0.29, 0.018, x * 0.095, 0, z * 0.095)), // the four posts
    S.tint(new THREE.TorusGeometry(0.035, 0.008, 5, 12).translate(0, 0.27, 0), IRON), // the ring handle
    S.tint(new THREE.CylinderGeometry(0.01, 0.01, 0.04, 5).translate(0, 0.24, 0), IRON), // its stem
  ]);
  const ironMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 });
  const frame = new THREE.Mesh(iron, ironMat);
  // the glass: warm, lit from within (no light reaches the view's pass but its own)
  // the owner (AMBER): the glass toward amber and a shade dimmer, so it reads like the gate lanterns
  const glassMat = new THREE.MeshBasicMaterial({ color: GLASS_HEX, transparent: true, opacity: 0.9, depthWrite: false }); // smoked: the room barely through it
  glassMat.color.multiplyScalar(0.88);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.26, 0.17), glassMat);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xfff1cf });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, 6).translate(0, -0.06, 0), flameMat);
  const haloMat = new THREE.SpriteMaterial({ map: radialTexture('rgba(255,179,71,0.34)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(0.62, 0.62, 1);
  halo.position.y = -0.04;
  body.add(frame, flame, glass, halo);
  glass.renderOrder = 1;
  halo.renderOrder = 2;
  for (const x of [frame, glass, flame, halo]) x.frustumCulled = false;

  let lastYaw = null;
  let lastPitch = 0;
  let walk = 0;
  let reduced = false;

  function cancel() {
    lastYaw = null;
    _swing.x = 0; _swing.z = 0;
    holder.rotation.set(0, 0, 0);
  }

  /** player: its yaw and pitch this frame swing the lantern behind the turn; walking sways it. */
  function update(dt, player) {
    if (!(dt > 0)) return;
    const yaw = player && Number.isFinite(player.yaw) ? player.yaw : 0;
    const pitch = player && Number.isFinite(player.pitch) ? player.pitch : 0;
    if (lastYaw === null) { lastYaw = yaw; lastPitch = pitch; }
    let dy = yaw - lastYaw;
    if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
    const dp = pitch - lastPitch;
    lastYaw = yaw; lastPitch = pitch;
    // the swing: a turn pushes it out the other way, and it settles back (about a tenth of a second)
    const k = 1 - Math.exp(-dt * 8);
    const tz = Math.max(-0.35, Math.min(0.35, (dy / dt) * 0.05));
    const tx = Math.max(-0.25, Math.min(0.25, (-dp / dt) * 0.04));
    _swing.z += (tz - _swing.z) * k;
    _swing.x += (tx - _swing.x) * k;
    walk += dt * (player && player.moving ? 6.5 : 1.2);
    const sway = reduced ? 0 : 0.035;
    holder.rotation.set(_swing.x + sway * 0.5 * Math.sin(walk * 0.5), 0, _swing.z + sway * Math.sin(walk));
    flame.scale.y = reduced ? 1 : 1 + 0.06 * Math.sin(walk * 5.1) + 0.04 * Math.sin(walk * 11.7); // the wick, barely
  }

  return {
    group, update, cancel,
    onEvent() { /* nothing fires: the lantern is only held up */ },
    setReducedFlash(v) { reduced = !!v; },
    setConfig() { /* no numbers needed */ },
    setActive(on) {
      group.visible = !!on;
      if (!on) cancel();
    },
    dispose() {
      iron.dispose(); glass.geometry.dispose(); flame.geometry.dispose();
      ironMat.dispose(); glassMat.dispose(); flameMat.dispose(); haloMat.map.dispose(); haloMat.dispose();
    },
  };
}
