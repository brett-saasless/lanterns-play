// Renderer, camera and the three rooms. The yard is built here from CONFIG and canvas textures
// into one group; the cave comes from cave.js; the Rose Court (court, wood and approach) comes
// from court.js and forest.js; the castle comes from castle.js, loaded on demand (loadCastle).
// setRoom swaps group, fog, lights and the shadow flag.

import * as THREE from 'three';
import { CONFIG } from '../logic/config.js';
import { CAVE_CONFIG } from '../logic/caveconfig.js';
import { COURT_CONFIG } from '../logic/courtconfig.js';
import { buildCave } from './cave.js';
import { buildCourt } from './court.js';
import { warmBusts } from './busts.js';
import { buildForest } from './forest.js';
import { createCrater, createShaft } from './passages.js'; // issue #29: the ways on between the levels

export const PALETTE = {
  teal: 0x16343a, bilge: 0x0b1a1d, concrete: 0x27302f, rust: 0x8a4b2a, oxide: 0x3f5a56,
  amber: 0xffb347, flare: 0xff6a1f, glass: 0x7fd6c2, chalk: 0xe8e2d0, red: 0xe5484d,
};

function canvasTexture(draw, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckle(g, s, n, colors, maxR = 1.6) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length];
    g.globalAlpha = 0.25 + Math.random() * 0.4;
    g.beginPath();
    g.arc(Math.random() * s, Math.random() * s, 0.4 + Math.random() * maxR, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function concreteTexture() {
  return canvasTexture((g, s) => {
    g.fillStyle = '#27302F';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 7; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const r = 20 + Math.random() * 40;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(10,20,22,0.55)');
      grad.addColorStop(1, 'rgba(10,20,22,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    speckle(g, s, 2200, ['#1b2322', '#3a4442', '#313b39', '#151c1b']);
    g.strokeStyle = 'rgba(8,14,14,0.6)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, s, s); // slab joints
  });
}

function hullTexture() {
  return canvasTexture((g, s) => {
    g.fillStyle = '#5b3420';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * s;
      g.fillStyle = Math.random() < 0.5 ? 'rgba(138,75,42,0.45)' : 'rgba(30,18,12,0.35)';
      g.fillRect(x, Math.random() * s * 0.3, 1 + Math.random() * 4, s * (0.3 + Math.random() * 0.7));
    }
    speckle(g, s, 900, ['#8A4B2A', '#2b1a12', '#a0603a']);
    g.fillStyle = 'rgba(15,10,8,0.8)';
    g.fillRect(0, 0, s, 3);
    g.fillRect(0, 0, 3, s);
    g.fillStyle = '#2a1c14';
    for (let x = 12; x < s; x += 22) {
      g.beginPath(); g.arc(x, 10, 3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x, s - 10, 3, 0, Math.PI * 2); g.fill();
    }
  });
}

function crateTexture(label) {
  return canvasTexture((g, s) => {
    g.fillStyle = '#3F5A56';
    g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 32) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x, 0, 4, s); // corrugation
    }
    speckle(g, s, 500, ['#2c403d', '#557571', '#8A4B2A']);
    g.fillStyle = '#8A4B2A';
    g.fillRect(0, s * 0.08, s, s * 0.08);
    g.fillRect(0, s * 0.84, s, s * 0.08);
    g.fillStyle = 'rgba(232,226,208,0.75)';
    g.font = `bold ${s * 0.22}px "Arial Narrow", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, s / 2, s / 2);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 4;
    g.strokeRect(2, 2, s - 4, s - 4);
  });
}

export function radialTexture(inner, outer = 'rgba(0,0,0,0)', size = 128) {
  const t = canvasTexture((g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }, size);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function boxUV(geo, w, h, d, unit) {
  // Scale UVs per face so texture density is constant across sizes.
  const uv = geo.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faces[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * (su / unit), uv.getY(k) * (sv / unit));
    }
  }
  uv.needsUpdate = true;
  return geo;
}

export function buildWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(PALETTE.teal);
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const yardBackground = new THREE.Color(PALETTE.teal);
  const yardFog = new THREE.FogExp2(PALETTE.teal, 0.032);
  scene.background = yardBackground;
  scene.fog = yardFog;

  // Everything the yard owns, lights included, hangs off one group so a room swap is one flag.
  const yard = new THREE.Group();
  yard.name = 'yard';
  scene.add(yard);
  yard.add(new THREE.HemisphereLight(0x6fa3a8, 0x1a2422, 0.9 * Math.PI));
  const sun = new THREE.DirectionalLight(0xbfd8d4, 0.6 * Math.PI);
  sun.position.set(-20, 14, 10);
  yard.add(sun);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const half = CONFIG.arena.half;

  // Ground
  const concrete = concreteTexture();
  concrete.repeat.set(16, 16);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4 * half, 4 * half),
    new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.82, metalness: 0.05 }),
  );
  ground.rotation.x = -Math.PI / 2;
  yard.add(ground);

  // Standing water and steel floor plates, drawn from CONFIG.surfaces (the zones the rules
  // read underfoot), so what is seen is what is heard. Laid flat, a circle's local y is world
  // z, so scaling y by rz / rx gives exactly the zone's ellipse.
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x1d4045, roughness: 0.12, metalness: 0.3, transparent: true, opacity: 0.55 });
  const hull = hullTexture();
  const hullMat = new THREE.MeshStandardMaterial({ map: hull, roughness: 0.75, metalness: 0.35 });
  for (const zone of CONFIG.surfaces.zones) {
    if (zone.shape === 'ellipse' && zone.material === 'puddle') {
      const m = new THREE.Mesh(new THREE.CircleGeometry(zone.rx, 20), waterMat);
      m.rotation.x = -Math.PI / 2;
      m.scale.set(1, zone.rz / zone.rx, 1);
      m.position.set(zone.x, 0.01, zone.z);
      yard.add(m);
    } else if (zone.shape === 'rect' && zone.material === 'plate') {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(zone.maxX - zone.minX, zone.maxZ - zone.minZ), hullMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((zone.minX + zone.maxX) / 2, 0.013, (zone.minZ + zone.maxZ) / 2);
      yard.add(m);
    }
  }

  // Painted lane stripes in bone chalk.
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xbdb7a6, roughness: 0.9, transparent: true, opacity: 0.55 });
  const stripes = [[-18, 0, 0.25, 30], [18, 0, 0.25, 30], [0, 18.5, 26, 0.25], [0, -18.5, 26, 0.25]];
  for (const [x, z, w, d] of stripes) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stripeMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    yard.add(m);
  }
  for (let i = -3; i <= 3; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.6), stripeMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(i * 4, 0.012, 15.5);
    yard.add(m);
  }

  // Walls and cover from CONFIG.boxes.
  const crateMats = ['B7', 'C2', 'A4', 'D9'].map((l) => new THREE.MeshStandardMaterial({ map: crateTexture(l), roughness: 0.7, metalness: 0.3 }));
  const winchMat = new THREE.MeshStandardMaterial({ color: 0x2f3d3b, roughness: 0.6, metalness: 0.5 });
  let crateIdx = 0;
  for (const b of CONFIG.boxes) {
    const geo = b.kind === 'crate'
      ? new THREE.BoxGeometry(b.w, b.h, b.d) // one stencilled label per face
      : boxUV(new THREE.BoxGeometry(b.w, b.h, b.d), b.w, b.h, b.d, b.kind === 'wall' ? 3 : 2.5);
    const mat = b.kind === 'wall' || b.kind === 'rib' ? hullMat : b.kind === 'winch' ? winchMat : crateMats[crateIdx++ % crateMats.length];
    const m = new THREE.Mesh(geo, mat);
    m.position.set(b.x, b.h / 2, b.z);
    yard.add(m);
    if (b.kind === 'winch') {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, b.w * 0.8, 18), hullMat);
      drum.rotation.z = Math.PI / 2;
      drum.position.set(b.x, b.h + 0.6, b.z);
      yard.add(drum);
    }
    if (b.kind === 'rib') {
      // Beached hull rib: curved frames rising over the plate.
      for (let i = -1; i <= 1; i++) {
        const arc = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.14, 6, 16, Math.PI), hullMat);
        arc.position.set(b.x, b.h - 0.6, b.z + i * 2.6);
        arc.rotation.y = Math.PI / 2;
        yard.add(arc);
      }
    }
  }

  buildClimbs(yard); // the ramp and ladders up the tall crates (#21)

  // Wall caps: rust trim along the top edge.
  const capMat = new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.6, metalness: 0.4 });
  for (const b of CONFIG.boxes.filter((x) => x.kind === 'wall')) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.2, 0.25, b.d + 0.2), capMat);
    cap.position.set(b.x, b.h + 0.12, b.z);
    yard.add(cap);
  }

  // Silhouettes beyond the walls: gantry cranes and a hull, for depth in the fog.
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x0f2428 });
  const gantry = (x, z, h, rot) => {
    const g = new THREE.Group();
    for (const dx of [-3, 3]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.8), darkMat);
      leg.position.set(dx, h / 2, 0);
      g.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(16, 1.2, 1.2), darkMat);
    beam.position.set(2, h, 0);
    g.add(beam);
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    yard.add(g);
  };
  gantry(-34, -30, 22, 0.4);
  gantry(36, -26, 18, -0.7);
  gantry(30, 36, 20, 2.2);
  const wreck = new THREE.Mesh(new THREE.BoxGeometry(30, 9, 8), darkMat);
  wreck.position.set(-36, 3, 24);
  wreck.rotation.set(0.05, 0.6, 0.12);
  yard.add(wreck);

  // Pad markings at the four inner corners.
  const padMat = new THREE.MeshBasicMaterial({ color: PALETTE.chalk, transparent: true, opacity: 0.35 });
  for (const p of CONFIG.pads) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 4, 1), padMat);
    ring.rotation.x = -Math.PI / 2;
    ring.rotation.z = Math.PI / 4;
    ring.position.set(p.x, 0.015, p.z);
    yard.add(ring);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // The yard, the cave and the Rose Court exist from boot, so choosing one has no loading state. The Rose Court is one
  // room drawn by two builders: the garden and the castle (court.js) and the maze (forest.js).
  const cave = buildCave(scene, CAVE_CONFIG);
  const court = buildCourt(scene, COURT_CONFIG);
  const forest = buildForest(scene, COURT_CONFIG);
  court.hide();
  forest.hide();
  const crater = createCrater(yard); // #29: the yard's way down, once the last surge is held
  const shaft = createShaft(cave.group, cave); // #29: the Nave's way up, once the Cantor falls
  let room = 'yard';

  // The fourth room is loaded on demand: castle.js (and the mirror pass) are imported here, so a
  // missing or broken castle never stops the yard, the cave and the Rose Court from starting.
  let castle = null;
  let mirror = null;
  let reducedFlash = false; // the setting, kept so a castle loaded later starts with it

  /**
   * The castle is dropped (it failed to load): dispose the mirror and the shell first, then the shared
   * stone cache last (castle.dispose no longer frees it). Leaving the castle for another room is not
   * a drop: the room is hidden and kept, and its marble stays.
   */
  async function dropCastle() {
    if (mirror && typeof mirror.dispose === 'function') mirror.dispose();
    mirror = null;
    if (castle && typeof castle.dispose === 'function') castle.dispose();
    castle = null;
    try {
      const st = await import('./stone.js');
      if (typeof st.disposeStone === 'function') st.disposeStone();
    } catch { /* nothing to free */ }
  }

  /**
   * Builds the castle (castle.js) and the mirror pass (mirror.js) once. Resolves true when the
   * castle can be shown; false (and the three older rooms unharmed) when it cannot be loaded.
   * It also resolves false when the mirror (mirror.js createMirror) is missing.
   */
  async function loadCastle(cfg) {
    if (castle) return true;
    try {
      const mod = await import('./castle.js');
      castle = mod.buildCastle(scene, cfg);
      castle.hide();
      if (castle.setReducedFlash) castle.setReducedFlash(reducedFlash);
    } catch (err) {
      console.error(err);
      await dropCastle(); // free its canvases before any retry
      return false;
    }
    // The glass is not optional: the gallery cannot be solved without it (security A5), so a castle
    // with no mirror is not offered.
    try {
      const m = await import('./mirror.js');
      mirror = typeof m.createMirror === 'function' ? m.createMirror({ renderer, scene, castle, camera }) : null;
    } catch (err) {
      console.warn('mirror not loaded:', err && err.message);
      mirror = null;
    }
    if (!mirror) {
      castle.hide();
      await dropCastle();
      return false;
    }
    return true;
  }

  /** Shows 'yard', 'cave', 'court' or 'castle': group, fog, background, lights and the renderer's shadow flag. */
  function setRoom(name) {
    room = name === 'cave' ? 'cave' : name === 'court' ? 'court' : name === 'castle' && castle ? 'castle' : 'yard';
    if (room !== 'court') {
      court.hide();
      forest.hide();
    }
    if (room !== 'castle' && castle) castle.hide();
    // Leaving the castle frees the glass's render target (mirror.free).
    if (room !== 'castle' && mirror && typeof mirror.free === 'function') mirror.free();
    if (room === 'castle') {
      yard.visible = false;
      cave.hide();
      castle.apply(renderer);
    } else if (room === 'cave') {
      yard.visible = false;
      cave.apply(renderer);
    } else if (room === 'court') {
      yard.visible = false;
      cave.hide();
      court.apply(renderer);
      forest.apply(renderer);
    } else {
      cave.hide();
      yard.visible = true;
      scene.fog = yardFog;
      scene.background = yardBackground;
      renderer.setClearColor(PALETTE.teal);
      renderer.shadowMap.enabled = false; // the yard stays shadow-free
    }
  }

  /** Per-frame room animation (the yard has none). dt: frame dt on the title, sim dt in play. */
  function update(sim, dt, time) {
    if (room === 'yard') crater.update(sim, dt, time);
    if (room === 'cave') shaft.update(sim, dt, time);
    if (room === 'cave') cave.update(sim, dt, time);
    else if (room === 'court') {
      court.update(sim, dt, time);
      forest.update(sim, dt, time);
    } else if (room === 'castle') castle.update(sim, dt, time);
  }

  /**
   * The mirror pass: called once a frame, after update and before the main render, with the
   * camera that is about to draw. The castle's glass redraws its target here while the gallery
   * is occupied; it does nothing in any other room.
   */
  function prerender(cam) {
    if (room === 'castle' && mirror && typeof mirror.render === 'function') mirror.render(cam, castle);
  }

  /** Reduced flash: the castle's fire and torch flicker drops to a slow drift (castle.setReducedFlash). */
  function setReducedFlash(on) {
    reducedFlash = !!on;
    crater.setReducedFlash(reducedFlash); // #29: the blast's flash and the strike's are dimmed
    shaft.setReducedFlash(reducedFlash);
    court.setReducedFlash(reducedFlash); // the easel's head turns at a quarter rate
    if (castle && castle.setReducedFlash) castle.setReducedFlash(reducedFlash);
  }

  /**
   * A scene's camera, or null: { position, target, fov? }. The castle's two (strike, pyre:
   * castle.sceneCamera), and #29's two ways out (passages.js): the yard's crater, the cave's vault.
   */
  function sceneCamera(sim, sc) {
    const o = sim && sim.waves && sim.waves.wayout;
    if (sc && o && sc.kind === 'crater' && room === 'yard') return crater.camera(sim, sc);
    if (sc && o && sc.kind === 'vault' && room === 'cave') return shaft.camera(sim, sc);
    return room === 'castle' && castle ? castle.sceneCamera(sim, sc) : null;
  }

  /** Title backdrop pose for the room on screen: { position, target }, or null for the yard. */
  function titleCamera(time) {
    if (room === 'cave') return cave.titleCamera(time);
    if (room === 'court') return court.titleCamera(time) || forest.titleCamera(time);
    if (room === 'castle') return castle.titleCamera(time);
    return null;
  }

  /**
   * Issue #29: what the scene draws now that main.js has not yet had built, one object per
   * material and kind (mesh, instanced, skinned, coloured): the hand-over builds their programs
   * a few a frame, under the cover of the fade, before the new level is first drawn. `seen`
   * holds the keys already handed out and is added to.
   */
  function extras(name) {
    if (name === 'yard') return [crater.group];
    if (name === 'cave') return [shaft.group];
    const road = name === 'castle' && castle ? castle.group.getObjectByName('castle:road') : null;
    return road ? [road] : [];
  }

  /**
   * Issue #29: builds, in the background, the programs of what a room shows only later and hidden
   * now (the crater, the shaft, the road's boulder, dust and bats), as the room on screen draws
   * them, so the frame a scare or a way on first shows has nothing to build. main.js calls it as
   * a room is entered.
   */
  function warmExtras(cam) {
    for (const g of extras(room)) {
      try { const p = renderer.compileAsync(g, cam, scene); if (p && p.catch) p.catch(() => {}); } catch { /* built when first drawn */ }
    }
  }

  /**
   * The sculpted heads' one shared program, built now against the room on show (its lights, fog
   * and shadows), so the first face that comes into view does not build it (main.js calls it when
   * a level with heads starts: logic/headrooms.js). Resolves true once built.
   */
  function warmHeads(cam) {
    return warmBusts(renderer, cam, scene).done;
  }

  function drawables(seen) {
    const out = [];
    scene.traverseVisible((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const key = mats.map((m) => m.uuid).join() + (o.isInstancedMesh ? 'i' : '') + (o.isSkinnedMesh ? 's' : '') + (o.geometry && o.geometry.attributes.color ? 'c' : '');
      if (seen.has(key)) return;
      seen.add(key);
      out.push(o);
    });
    return out;
  }

  /**
   * Issue #29: frees the GPU side of a room left behind on the journey (its meshes' buffers, its
   * materials' programs and its textures), everything that no other part of the scene still
   * draws with. The scene graph and every source stay: showing the room again (the title, a
   * button) uploads it again. Returns how many resources were freed.
   */
  function free(name) {
    const roots = { yard: [yard], cave: [cave.group], court: [court.group], castle: castle ? [castle.group] : [] }[name] || [];
    if (!roots.length || name === room) return 0;
    const mine = new Set();
    for (const r of roots) r.traverse((o) => mine.add(o));
    const used = new Set();
    const collect = (o, into) => {
      if (o.geometry) into.add(o.geometry);
      for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
        into.add(m);
        for (const v of Object.values(m)) if (v && v.isTexture) into.add(v);
        if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture) into.add(u.value);
      }
    };
    scene.traverse((o) => { if (!mine.has(o)) collect(o, used); });
    const gone = new Set();
    for (const o of mine) collect(o, gone);
    let n = 0;
    for (const r of gone) {
      if (used.has(r) || typeof r.dispose !== 'function') continue;
      r.dispose();
      n += 1;
    }
    return n;
  }

  return {
    renderer, scene, camera, resize, setRoom, setReducedFlash, update, titleCamera, cave, loadCastle, prerender, sceneCamera, free, drawables, warmExtras, warmHeads,
    get room() { return room; },
    get castleReady() { return !!castle; },
    get mirrorReady() { return !!mirror; },
  };
}

/**
 * The yard's ramp and ladders (CONFIG.levels, #21), drawn on the same lines the rules walk: each
 * stair runs straight from its head (the crate's top edge) to its foot on the ground. A ramp is a
 * steel plate on two stringers; a ladder two rails and a rung every 0.26 m of rise. Bars and rungs
 * are two instanced meshes, the ramp plates one more mesh each.
 */
function buildClimbs(group) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x59615f, roughness: 0.5, metalness: 0.7 });
  const bars = [];
  const rungs = [];
  for (const L of CONFIG.levels || []) {
    const s = L.stair;
    const len = s.landing + s.run * s.treads;
    const lat = s.axis === 'x' ? (s.rect.minZ + s.rect.maxZ) / 2 : (s.rect.minX + s.rect.maxX) / 2;
    const half = (s.axis === 'x' ? s.rect.maxZ - s.rect.minZ : s.rect.maxX - s.rect.minX) / 2;
    const at = (along, y, off) => (s.axis === 'x'
      ? new THREE.Vector3(along, y, lat + off)
      : new THREE.Vector3(lat + off, y, along));
    const head = s.head;
    const foot = s.head + s.dir * len;
    const top = s.top; // the top edge's height
    if (s.climb) {
      for (const off of [-half + 0.06, half - 0.06]) bars.push([at(head, top + 0.5, off), at(foot, 0, off), 0.06]);
      for (let k = 1; k <= s.treads; k++) {
        const t = k / (s.treads + 0.5);
        rungs.push([at(head + (foot - head) * t, top * (1 - t), -half + 0.06), at(head + (foot - head) * t, top * (1 - t), half - 0.06)]);
      }
    } else {
      const a = at(head, top, 0);
      const b = at(foot, 0, 0);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.06, a.distanceTo(b)), steel);
      plate.position.copy(a).add(b).multiplyScalar(0.5);
      plate.position.y -= 0.03;
      plate.lookAt(b.x, b.y - 0.03, b.z);
      group.add(plate);
      for (const off of [-half + 0.05, half - 0.05]) bars.push([at(head, top - 0.12, off), at(foot, -0.12, off), 0.1]);
    }
  }
  const o = new THREE.Object3D();
  if (bars.length) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, bars.length);
    bars.forEach(([a, b, w], i) => {
      o.position.copy(a).add(b).multiplyScalar(0.5);
      o.lookAt(b);
      o.scale.set(w, w * 1.6, a.distanceTo(b));
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    group.add(mesh);
  }
  if (rungs.length) {
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), steel, rungs.length);
    rungs.forEach(([a, b], i) => {
      o.position.copy(a).add(b).multiplyScalar(0.5);
      o.lookAt(b);
      o.rotateX(Math.PI / 2); // the cylinder's length is its y
      o.scale.set(1, a.distanceTo(b), 1);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    group.add(mesh);
  }
}
