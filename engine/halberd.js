// Halberd viewmodel (R8): the claw halberd a fallen guard leaves, in the warden's hands as
// crossbow.js is for the stake crossbow. Slow and heavy, short in the reach: it is hauled back
// over the shoulder for the rules' wind-up (read from weapon.windup, so a cancelled heave simply
// comes back down), brought down and through on `swing`, shoved forward for the push, and is a
// long moment coming back to rest. It carries no ammunition and shows none. Two draws: dull wood, wet head.

import * as THREE from 'three';
import * as S from './sculpt.js';

const GOLD = 0xc9a227; // the guards' old gold, wet red and stone (cast.js)
const WET = 0x7a0f14;
const STONE = 0x8d8a82;
const SEED = 7;
const GRIP = 0.55; // metres up the pole from its butt to the leading hand

const CHOP = 0.09; // seconds from over the shoulder to the bottom of the blow
const HOLD = 0.34; // the blow stays down, shoved forward, until this long after it landed
const RECOVER = 0.6; // and is this long coming back up to rest
const SHOVE_TIME = 0.25;
const LOWER = 0.2; // a heave that is called off comes back down over this long

// Poses of the pole in the rig: [x, y, z, rotX, rotY, rotZ]. rotX tips the head forward (negative)
// or back over the shoulder (positive).
const REST = [0.17, -0.2, 0.02, -0.98, 0.1, 0.03];
const RAISED = [0.2, -0.12, 0.1, -0.34, 0.0, -0.1];
const STRUCK = [-0.07, -0.25, -0.16, -1.72, 0.2, 0.5];

const clamp01 = (k) => Math.max(0, Math.min(1, k));
const smooth = (k) => k * k * (3 - 2 * k);

/**
 * The guards' halberd (cast.js halberdGeometry) at half its length: grip at the origin, head up
 * +Y, claws along -Z. Two parts, so the wood can be dull and the head wet: { wood, head }.
 */
function halberdGeometry() {
  const collar = (y, r) => S.tint(new THREE.TorusGeometry(r, 0.008, 5, 10).rotateX(Math.PI / 2).translate(0, y, 0), GOLD, 0.2, y);
  const wood = S.merge([
    S.skin([{ at: [0, 0, 0], r: 0.017 }, { at: [0.005, 0.5, 0], r: 0.015 }, { at: [-0.004, 1.05, 0.002], r: 0.014 }, { at: [0, 1.5, 0], r: 0.014 }],
      { seed: SEED, sides: 6, detail: 2, budget: 150, color: 0x4a3524, color2: 0x2a1d14, noise: 0.06, mottle: 0.22 }),
    // a grip of wound cord where the leading hand goes
    S.skin([{ at: [0, GRIP - 0.09, 0], r: 0.019, color: 0x1c1512 }, { at: [0, GRIP + 0.09, 0], r: 0.019, color: 0x2a1f18 }],
      { seed: SEED + 3, sides: 6, detail: 3, noise: 0.12, grain: 6, caps: 'flat' }),
  ]);
  const head = S.merge([
    // three long fingers, hooked, the nails wet
    S.claw({ fingers: 3, length: 0.36, spread: 0.42, curl: 1.3, r: 0.038, color: 0x5e5a54, tip: WET, seed: SEED }).translate(0, 1.5, -0.008),
    S.skin([{ at: [0, 1.49, 0.005], r: 0.023, color: STONE }, { at: [0.006, 1.6, 0.006], r: 0.012, color: 0x6a6860 }, { at: [0, 1.72, 0.005], r: 0.002, color: 0x2a2624 }],
      { seed: SEED + 2, sides: 5, detail: 2, noise: 0.08, caps: ['open', 'flat'] }),
    collar(1.43, 0.022), collar(1.37, 0.02), collar(0.015, 0.019),
    S.skin([{ at: [0.015, 1.4, 0.005], r: 0.014, color: WET }, { at: [0.038, 1.32, 0.01], r: 0.023, color: WET }, { at: [0.035, 1.23, 0.008], r: 0.006, color: 0x4a0a0e }],
      { seed: SEED + 5, sides: 6, detail: 2, rough: 0.3, noise: 0.1, shade: 0.2 }),
  ]);
  return { wood: wood.translate(0, -GRIP, 0), head: head.translate(0, -GRIP, 0) };
}

/** worldCamera is accepted for the same call shape as createCrossbow; the halberd has no world-side part. */
export function createHalberd(worldCamera) { // eslint-disable-line no-unused-vars
  const group = new THREE.Group(); // animated pose
  const geo = halberdGeometry();
  const M = S.materials();
  const pole = new THREE.Mesh(geo.wood, M.skin); // dull wood and cord
  const head = new THREE.Mesh(geo.head, M.gloss); // wet claws, stone, gold
  pole.frustumCulled = false;
  head.frustumCulled = false;
  group.add(pole, head);

  let cfg = { windup: 0.45, fireInterval: 1.5 };
  let mode = 'rest'; // 'rest' | 'heave' | 'strike' | 'lower'
  let raise = 0; // 0 at rest .. 1 hauled back over the shoulder
  let strike = -1; // seconds since the blow landed; -1 when none is playing
  let landed = false; // the blow met something: a harder shove and a shudder
  let lowerT = 0;
  let raiseFrom = 0;
  const cur = REST.slice(); // the pose last set (before any shove or shudder)
  const from = REST.slice(); // where a heave, or a heave called off, started from

  const blend = (a, b, k) => { for (let i = 0; i < 6; i++) cur[i] = a[i] + k * (b[i] - a[i]); };
  function apply(shove = 0, shudder = 0) {
    group.position.set(cur[0], cur[1], cur[2] - shove);
    group.rotation.set(cur[3], cur[4], cur[5] + shudder);
  }
  const leave = () => { for (let i = 0; i < 6; i++) from[i] = cur[i]; };

  function onEvent(ev) {
    if (ev.type !== 'swing') return;
    mode = 'strike';
    strike = 0;
    raise = 1;
    landed = Array.isArray(ev.hits) && ev.hits.length > 0;
  }

  function cancel() {
    mode = 'rest';
    raise = 0;
    strike = -1;
    landed = false;
    blend(REST, REST, 0);
    apply();
  }

  function update(dt, player, weapon) {
    const left = weapon && weapon.windup > 0 ? weapon.windup : 0;
    if (left > 0) {
      // The heave: slow off the mark, as a heavy thing is. It starts from wherever the pole is,
      // so one begun before the last blow has come back to rest does not snap.
      if (mode !== 'heave') { mode = 'heave'; strike = -1; leave(); }
      raise = smooth(clamp01(1 - left / (cfg.windup || 0.45)));
      blend(from, RAISED, raise);
      apply();
      return;
    }
    if (mode === 'heave') { mode = 'lower'; lowerT = 0; raiseFrom = raise; leave(); } // called off
    if (mode === 'strike') {
      strike += dt;
      const fall = clamp01(strike / CHOP);
      const back = smooth(clamp01((strike - HOLD) / RECOVER));
      const up = 1 - fall * fall;
      const down = fall * fall * (1 - back);
      for (let i = 0; i < 6; i++) cur[i] = REST[i] + up * (RAISED[i] - REST[i]) + down * (STRUCK[i] - REST[i]);
      const shove = Math.sin(Math.PI * clamp01((strike - CHOP * 0.5) / SHOVE_TIME)) * (landed ? 0.14 : 0.05);
      const shudder = landed && strike > CHOP ? Math.sin(strike * 70) * 0.035 * clamp01(1 - (strike - CHOP) / 0.22) : 0;
      apply(shove, shudder);
      if (back >= 1) cancel();
      return;
    }
    if (mode === 'lower') {
      lowerT += dt;
      const k = smooth(clamp01(lowerT / LOWER));
      blend(from, REST, k);
      raise = raiseFrom * (1 - k);
      if (k >= 1) mode = 'rest';
      apply();
      return;
    }
    blend(REST, REST, 0);
    apply();
  }

  apply();

  return {
    group, onEvent, update, cancel,
    setReducedFlash() { /* no flash to reduce */ },
    /** weaponCfg: the halberd's spec (windup is read). */
    setConfig(weaponCfg) { if (weaponCfg) cfg = weaponCfg; },
    setActive(on) {
      group.visible = !!on;
      if (!on) cancel();
    },
    /** 0 at rest to 1 hauled back; and whether a blow is playing. */
    get raise() { return raise; },
    get striking() { return mode === 'strike'; },
  };
}
