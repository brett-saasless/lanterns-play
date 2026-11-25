// sea-1-dock-art (docs/features/sea-1-dock-art/02-design.md, Components): the yard's east stack
// and its dressing, the tumble, the dust, the blast glow and the heap at rest - lifted out of
// world.js (R6, backlog A7 and "A1 polish") so that file shrinks, per the design's own Decisions.
// Security A1 (architect review, 2026-11-24): this module now carries its own flash (the blast
// glow, FLASH.breach in dockart.js) and must be in world.js's reduced-flash fan-out - see
// setReducedFlash below and world.js's own.

import * as THREE from 'three';
import { WAYOUT } from '../logic/wayout.js';
import { makeRng } from '../logic/rng.js';
import { glowAt } from './dockart.js';

const STRIKE = WAYOUT.breach.beat + WAYOUT.breach.flight; // 1.75 s: the blast itself
const TUMBLE_S = WAYOUT.breach.flight; // 1.15 s: pieces land by STRIKE + TUMBLE_S = 2.9 s (design)
const DUST_S = WAYOUT.breach.dust; // 3.0 s: the dust clears
const SEED = 20261124; // fixed: the same seed always cuts the same debris field

// Pieces per footprint (the two debris boxes either side of the lane), fixed regardless of
// device: 4 boards + the dressing's own cask/crate pair = 12 total across both footprints on
// the full count; a phone-tier split (the design's "7 on the phone") is left for a device that
// actually reaches a tier decision into the yard's own builder - noted in the build report as a
// scoped-down deviation, since the yard has no tier concept today (unlike the dock room).
const PER_FOOTPRINT_BOARDS = 4;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (k) => { const t = clamp01(k); return t * t * (3 - 2 * t); };

/**
 * `yard`: the group to add meshes to. `CONFIG`: the yard's config (CONFIG.boxes for the stack,
 * CONFIG.breachDebris for the two footprints, CONFIG.arena.half). `boxUV` (optional): the
 * shared UV-mapping helper world.js's own walls use, so the stack keeps one texture family with
 * the rest of the east wall.
 */
export function buildBreach(yard, CONFIG, { boxUV } = {}) {
  const stack = CONFIG.boxes.find((b) => b.kind === 'stack');
  const stackMat = new THREE.MeshStandardMaterial({ color: 0x6b2f22, roughness: 0.65, metalness: 0.35 });
  let stackMesh = null;
  if (stack) {
    const geo = boxUV ? boxUV(new THREE.BoxGeometry(stack.w, stack.h, stack.d), stack.w, stack.h, stack.d, 3) : new THREE.BoxGeometry(stack.w, stack.h, stack.d);
    stackMesh = new THREE.Mesh(geo, stackMat);
    stackMesh.position.set(stack.x, stack.h / 2, stack.z);
    yard.add(stackMesh);
  }

  // ---- the harbour seen through the gap once it opens (lifted unchanged from world.js) --------
  const gapX = (stack && stack.x) || CONFIG.arena.half + 0.6;
  const backdropMat = new THREE.MeshBasicMaterial({ color: 0x8a908c }); // fog grey, unlit: a value step, not a lit wall
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), backdropMat);
  backdrop.rotation.y = -Math.PI / 2;
  backdrop.position.set(gapX + 18, 4, 0);
  yard.add(backdrop);
  const gapLight = new THREE.PointLight(0xb8c4c8, 0.7 * Math.PI, 20, 2);
  gapLight.position.set(gapX + 3, 3, 0);
  yard.add(gapLight);
  const mastMat = new THREE.MeshBasicMaterial({ color: 0x14110f });
  const lanternMat = new THREE.MeshBasicMaterial({ color: 0xe8a040 });
  for (const [dz, h, dist] of [[-4, 11, 14], [3, 9, 20], [-1, 13, 26]]) {
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.25, h, 0.25), mastMat);
    mast.position.set(gapX + dist, h / 2, dz);
    yard.add(mast);
  }
  for (const [dz, dist] of [[-2.5, 10], [1.5, 16], [3.5, 22]]) {
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lanternMat);
    lantern.position.set(gapX + dist, 2.4, dz);
    yard.add(lantern);
  }

  // ---- the dust fade plane (lifted unchanged; WAYOUT.breach.dust replaces the old local copy) ---
  const fadeMat = new THREE.MeshBasicMaterial({ color: 0x8a908c, transparent: true, opacity: 0 });
  const dustFade = new THREE.Mesh(new THREE.PlaneGeometry(7, 5.2), fadeMat);
  dustFade.rotation.y = -Math.PI / 2;
  dustFade.position.set(gapX + 0.3, 2.8, 0);
  yard.add(dustFade);

  // ---- the blast glow (R6, Security A1): FLASH.breach in dockart.js, through glowAt only -------
  const blastGlow = new THREE.PointLight(0xe8a040, 0, 10, 2); // oil amber (UI direction, The breach)
  blastGlow.position.set(gapX - 0.5, (stack && stack.h * 0.6) || 2, 0);
  yard.add(blastGlow);

  // ---- the tumble field and the heap at rest: one instanced box batch, one instanced cask batch
  // (Budget table, "The yard at the breach": tumbling pieces 2 instanced, heap 2 - the same two
  // batches serve both phases, animated while flying and held still once landed). "Highest at the
  // wall and falling toward the lane" (UI direction, The breach): each footprint's pieces step
  // down in height as they approach the lane's own z edge.
  const footprints = CONFIG.breachDebris || [];
  const rng = makeRng(SEED);
  const boxPieces = []; // { startX, startY, startZ, land:{x,y,z,rotX,rotY,rotZ}, scale:{x,y,z}, arcH, delay }
  const caskPieces = [];
  for (const fp of footprints) {
    const towardLane = fp.z > 0 ? -1 : 1; // the lane sits at |z| < lane/2, nearer z=0
    for (let i = 0; i < PER_FOOTPRINT_BOARDS; i++) {
      const t = (i + 0.5) / PER_FOOTPRINT_BOARDS; // 0 at the wall's far edge, 1 toward the lane
      const z = fp.z - towardLane * (fp.d / 2) * (1 - 2 * t) * -1; // far edge at t=0, lane edge at t=1
      const h = Math.max(0.25, fp.h * (1 - 0.55 * t) * (0.7 + rng() * 0.3));
      const x = fp.minX + rng() * fp.w * 0.7 + fp.w * 0.15;
      boxPieces.push({
        startX: (stack && stack.x) || fp.x, startY: (stack && stack.h) || fp.h, startZ: (stack && stack.z) || fp.z,
        land: { x, y: h / 2, z, rotX: (rng() - 0.5) * 0.5, rotY: rng() * Math.PI * 2, rotZ: (rng() - 0.5) * 0.6 },
        scale: { x: 0.55 + rng() * 0.5, y: h, z: 0.55 + rng() * 0.5 },
        arcH: 1.2 + rng() * 1.6,
        delay: rng() * 0.15,
      });
    }
    // the dressing's own cask (critique A5): once part of a fixed decoration at the stack's own
    // height ("floating" once the stack hid, backlog "A1 polish"), now a tumble piece that lands
    // and stays, inside this footprint, never in the lane.
    const cx = fp.minX + rng() * fp.w * 0.6 + fp.w * 0.2;
    const cz = fp.z + towardLane * (fp.d * 0.3);
    caskPieces.push({
      startX: (stack && stack.x) || fp.x, startY: (stack && stack.h) || fp.h, startZ: (stack && stack.z) || fp.z,
      land: { x: cx, y: 0.3, z: cz, rotX: Math.PI / 2 + (rng() - 0.5) * 0.4, rotY: rng() * Math.PI * 2, rotZ: 0 },
      scale: { x: 1, y: 1, z: 1 },
      arcH: 1.6 + rng() * 1.2,
      delay: rng() * 0.1,
    });
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.9 });
  const boxInstanced = new THREE.InstancedMesh(boxGeo, boxMat, Math.max(1, boxPieces.length));
  boxInstanced.count = boxPieces.length;
  yard.add(boxInstanced);

  const caskGeo = new THREE.CylinderGeometry(0.4, 0.4, 1, 10);
  const caskMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.85 });
  const caskInstanced = new THREE.InstancedMesh(caskGeo, caskMat, Math.max(1, caskPieces.length));
  caskInstanced.count = caskPieces.length;
  yard.add(caskInstanced);

  const o3 = new THREE.Object3D();
  /** bt: seconds since the strike, or < 0 (not yet struck: hidden) or >= TUMBLE_S (at rest). */
  function poseField(batch, instanced, bt) {
    for (let i = 0; i < batch.length; i++) {
      const p = batch[i];
      const k = bt < 0 ? 0 : clamp01((bt - p.delay) / Math.max(0.05, TUMBLE_S - p.delay));
      const ease = smooth(k);
      const x = p.startX + (p.land.x - p.startX) * ease;
      const z = p.startZ + (p.land.z - p.startZ) * ease;
      const arc = p.arcH * 4 * ease * (1 - ease); // a parabola: 0 at both ends, p.arcH at the middle
      const y = p.startY + (p.land.y - p.startY) * ease + arc;
      o3.position.set(x, bt < 0 ? -50 : Math.max(p.land.y * 0.5, y), z);
      o3.rotation.set(p.land.rotX * ease, p.land.rotY * ease, p.land.rotZ * ease);
      o3.scale.set(p.scale.x, p.scale.y, p.scale.z);
      o3.updateMatrix();
      instanced.setMatrixAt(i, o3.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
  }

  function settleField(batch, instanced) {
    for (let i = 0; i < batch.length; i++) {
      const p = batch[i];
      o3.position.set(p.land.x, p.land.y, p.land.z);
      o3.rotation.set(p.land.rotX, p.land.rotY, p.land.rotZ);
      o3.scale.set(p.scale.x, p.scale.y, p.scale.z);
      o3.updateMatrix();
      instanced.setMatrixAt(i, o3.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
  }

  function hideField(batch, instanced) {
    for (let i = 0; i < batch.length; i++) {
      o3.position.set(0, -50, 0);
      o3.scale.set(0.001, 0.001, 0.001);
      o3.updateMatrix();
      instanced.setMatrixAt(i, o3.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
  }

  hideField(boxPieces, boxInstanced);
  hideField(caskPieces, caskInstanced);

  let reduced = false;
  let dustT = null; // seconds since the strike, or null while not fading
  let settled = false;

  function update(sim, dt) {
    if (!stackMesh) return;
    const w = sim && sim.waves;
    const open = !!(w && w.wayout && w.wayout.kind === 'breach' && w.wayout.open);
    stackMesh.visible = !open;
    const inBreachScene = !!(w && w.scene && w.scene.kind === 'breach');
    const bt = inBreachScene ? (w.scene.t || 0) - STRIKE : open ? Infinity : -Infinity;

    if (bt >= 0 && bt < TUMBLE_S) {
      poseField(boxPieces, boxInstanced, bt);
      poseField(caskPieces, caskInstanced, bt);
      settled = false;
    } else if (open) {
      if (!settled) { settleField(boxPieces, boxInstanced); settleField(caskPieces, caskInstanced); settled = true; }
    } else {
      hideField(boxPieces, boxInstanced);
      hideField(caskPieces, caskInstanced);
      settled = false;
    }

    if (open && inBreachScene && dustT === null) dustT = 0;
    if (!inBreachScene && !open) dustT = null; // a fresh run: start clear again
    if (dustT !== null) {
      dustT += Math.max(0, dt || 0);
      fadeMat.opacity = Math.max(0, 1 - dustT / DUST_S);
      if (dustT >= DUST_S) dustT = DUST_S;
    } else {
      fadeMat.opacity = 0;
    }

    // Security A1/A2/A3: the glow is read only through glowAt, never a literal.
    blastGlow.intensity = bt >= 0 && Number.isFinite(bt) ? glowAt('breach', bt, reduced) * Math.PI : 0;
  }

  return {
    update,
    setReducedFlash(v) { reduced = !!v; },
  };
}
