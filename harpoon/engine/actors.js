// Enemy, bolt, pickup, tracer and spark meshes, pooled and synced from the sim every frame.
// Enemy meshes are looked up by type: the yard's two are built here, other rooms register
// factories (fauna.js does for the cave) and extra layers for their own effects.

import * as THREE from 'three';
import { CONFIG } from '../logic/config.js';
import { PALETTE, radialTexture } from './world.js';
import { registerFauna } from './fauna.js';
import { registerCast } from './cast.js';
import { registerBeasts } from './beasts.js';
import { createProps } from './props.js';
import { COURT_CONFIG } from '../logic/courtconfig.js';
import { WAYOUT, foeFlightAt, flightApex } from '../logic/wayout.js'; // #29: the yard's last foe spins off

const AMBER = new THREE.Color(PALETTE.amber);
const FLARE = new THREE.Color(PALETTE.flare);
const CHALK = new THREE.Color(PALETTE.chalk);
const DARK = new THREE.Color(0x221a12);
const BLACK = new THREE.Color(0x000000);
const SALT = 0xf4f1e6;
const FOXFIRE = 0xb6ff9e;
const FLING_AXIS = new THREE.Vector3();
const FLING_Q = new THREE.Quaternion();
const FLING_TWIST = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const FLING_ARM = new THREE.Vector3();
const FLING_PIVOT = 0.95; // metres above its feet a yard creature tumbles about

export function createActors(scene) {
  const haloTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  const shadowTex = radialTexture('rgba(0,0,0,0.65)', 'rgba(0,0,0,0)');

  const geo = {
    chassis: new THREE.CylinderGeometry(0.26, 0.42, 0.62, 12),
    lid: new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12),
    core: new THREE.IcosahedronGeometry(0.19, 1),
    cage: new THREE.TorusGeometry(0.28, 0.022, 6, 18),
    arm: new THREE.BoxGeometry(0.07, 0.6, 0.13),
    tank: new THREE.SphereGeometry(0.75, 16, 12),
    leg: new THREE.ConeGeometry(0.1, 0.95, 6),
    nozzle: new THREE.CylinderGeometry(0.11, 0.17, 0.6, 10),
    bigCore: new THREE.IcosahedronGeometry(0.24, 1),
    bolt: new THREE.SphereGeometry(0.18, 10, 8),
    shadow: new THREE.PlaneGeometry(1, 1),
    crate: new THREE.BoxGeometry(0.6, 0.38, 0.4),
    band: new THREE.BoxGeometry(0.62, 0.08, 0.42),
    can: new THREE.CylinderGeometry(0.2, 0.2, 0.5, 14),
    crossA: new THREE.BoxGeometry(0.06, 0.24, 0.42),
    crossB: new THREE.BoxGeometry(0.42, 0.24, 0.06),
  };
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const armMat = new THREE.MeshStandardMaterial({ color: 0x4a4f4c, roughness: 0.5, metalness: 0.7 });
  const cageMat = new THREE.MeshStandardMaterial({ color: 0x6b6355, roughness: 0.4, metalness: 0.8 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.6, metalness: 0.5 });

  function halo(color, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTex, color, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.85,
    }));
    s.scale.set(size, size, 1);
    return s;
  }

  function contactShadow(size) {
    const m = new THREE.Mesh(geo.shadow, shadowMat);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(size, size, 1);
    m.position.y = 0.02;
    return m;
  }

  function buildWick() {
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    const shell = new THREE.MeshStandardMaterial({ color: 0x2b302f, roughness: 0.55, metalness: 0.6, emissive: 0x000000, transparent: true });
    const coreMat = new THREE.MeshBasicMaterial({ color: AMBER.clone(), transparent: true });
    const chassis = new THREE.Mesh(geo.chassis, shell);
    chassis.position.y = 1.42;
    const lid = new THREE.Mesh(geo.lid, shell);
    lid.position.y = 1.75;
    const core = new THREE.Mesh(geo.core, coreMat);
    core.position.y = 0.95;
    const cage = new THREE.Mesh(geo.cage, cageMat);
    cage.position.y = 0.95;
    cage.rotation.x = Math.PI / 2;
    const glow = halo(PALETTE.amber, 2.2);
    glow.position.y = 0.95;
    const arms = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.4, 1.5, 0);
      const a = new THREE.Mesh(geo.arm, armMat);
      a.position.y = -0.3;
      pivot.add(a);
      pivot.rotation.z = side * 0.12;
      body.add(pivot);
      return pivot;
    });
    body.add(chassis, lid, core, cage, glow);
    const shadow = contactShadow(1.5);
    g.add(shadow);
    scene.add(g);
    return { g, body, shell, coreMat, core, glow, arms, shadow, type: 'wick' };
  }

  function buildBellows() {
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    const shell = new THREE.MeshStandardMaterial({ color: 0x3b302a, roughness: 0.5, metalness: 0.55, emissive: 0x000000, transparent: true });
    const coreMat = new THREE.MeshBasicMaterial({ color: AMBER.clone(), transparent: true });
    const tank = new THREE.Mesh(geo.tank, shell);
    tank.scale.set(1, 0.7, 1);
    tank.position.y = 1.05;
    const nozzle = new THREE.Mesh(geo.nozzle, shell);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(0, 1.1, -0.85);
    const core = new THREE.Mesh(geo.bigCore, coreMat);
    core.position.set(0, 1.0, -0.62);
    const glow = halo(PALETTE.amber, 2.6);
    glow.position.set(0, 1.0, -0.7);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
      const leg = new THREE.Mesh(geo.leg, legMat);
      leg.position.set(Math.sin(a) * 0.45, 0.42, Math.cos(a) * 0.45);
      leg.rotation.set(Math.cos(a) * -0.35, 0, Math.sin(a) * 0.35);
      leg.rotation.x += Math.PI;
      g.add(leg);
    }
    body.add(tank, nozzle, core, glow);
    const shadow = contactShadow(2.2);
    g.add(shadow);
    scene.add(g);
    return { g, body, shell, coreMat, core, glow, tank, shadow, type: 'bellows' };
  }

  const live = new Map(); // enemy id -> view
  const dying = [];
  // Views whose enemy left the sim without dying (the court's figures, dropped once the warden is
  // through the arch). A view with linger(dt, time, eye) stays where it stood until that returns
  // false, so nothing pops out of sight while it can still be seen.
  const leaving = [];
  // #29: the yard's last foe, taken out of `dying` as the crater's scene starts: it spins off
  // through the air (logic/wayout.js foeFlightAt) and is gone as it hits. { v, heading, apex, out, trail, popped }
  let flung = null;

  // Per-type mesh lookup. A factory takes (enemy, cfg) and returns a view:
  // { g, sync(e, dt, time, eye, cfg, reduced), onEvent(ev), die(ev, cfg), updateDeath(dt, time) -> done, dispose() }.
  const factories = new Map();
  const layers = []; // { sync(sim, dt, time, eye), onEvent(ev), clear(), setReducedFlash(v) }
  let room = 'yard';
  let reduced = false;
  let lastCfg = CONFIG;

  function register(type, factory) {
    factories.set(type, factory);
  }

  function addLayer(layer) {
    layers.push(layer);
    if (layer.setReducedFlash) layer.setReducedFlash(reduced);
  }

  let buildsPerFrame = Infinity; // #29: main.js lowers it to 1 under the hand-over's cover

  function buildView(e, cfg) {
    const factory = factories.get(e.type);
    if (factory) {
      const view = factory(e, cfg);
      scene.add(view.g);
      return { custom: true, view, g: view.g };
    }
    return e.type === 'bellows' ? buildBellows() : buildWick();
  }

  // Bolts
  const boltMat = new THREE.MeshBasicMaterial({ color: PALETTE.flare });
  const boltViews = [];
  function boltView(i) {
    if (!boltViews[i]) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo.bolt, boltMat));
      g.add(halo(PALETTE.flare, 1.4));
      const trail = [halo(PALETTE.flare, 0.9), halo(PALETTE.flare, 0.6)];
      trail.forEach((t) => { t.material.opacity = 0.5; scene.add(t); });
      scene.add(g);
      boltViews[i] = { g, trail };
    }
    return boltViews[i];
  }

  // Pickups
  const pickupViews = new Map();
  const crateMat = new THREE.MeshStandardMaterial({ color: PALETTE.oxide, roughness: 0.6, metalness: 0.4 });
  const amberBand = new THREE.MeshBasicMaterial({ color: PALETTE.amber });
  const canMat = new THREE.MeshStandardMaterial({ color: 0x23423c, roughness: 0.4, metalness: 0.5 });
  const glassMat = new THREE.MeshBasicMaterial({ color: PALETTE.glass });
  const saltMat = new THREE.MeshBasicMaterial({ color: SALT });
  // C4 (the Rose Court and its wood): the pickups are things left lying in a Victorian garden,
  // standing still on the ground: a stoppered stoneware jar of physic with a paper label, and a
  // salt crock with a wooden lid and a chalked band. No halo, no ring: only a faint lantern-warm
  // rim (#FFC66B, low) at the lip, so a searching eye can still find one in the wood's grey.
  const courtKit = {
    jar: new THREE.LatheGeometry([[0, 0], [0.13, 0], [0.155, 0.04], [0.16, 0.16], [0.14, 0.24], [0.075, 0.29], [0.07, 0.33], [0.085, 0.345], [0, 0.345]].map(([x, y]) => new THREE.Vector2(x, y)), 18),
    cork: new THREE.CylinderGeometry(0.055, 0.05, 0.07, 10),
    label: new THREE.CylinderGeometry(0.162, 0.162, 0.09, 18, 1, true, -0.9, 1.8),
    crock: new THREE.LatheGeometry([[0, 0], [0.19, 0], [0.215, 0.05], [0.225, 0.2], [0.2, 0.3], [0.205, 0.32], [0, 0.32]].map(([x, y]) => new THREE.Vector2(x, y)), 20),
    crockLid: new THREE.CylinderGeometry(0.17, 0.2, 0.05, 18),
    knob: new THREE.SphereGeometry(0.035, 8, 6),
    chalk: new THREE.CylinderGeometry(0.227, 0.227, 0.05, 20, 1, true),
    rim: new THREE.TorusGeometry(1, 0.012, 5, 22),
  };
  const ware = new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: 0.55, metalness: 0 }); // salt-glazed stoneware
  const jarWare = new THREE.MeshStandardMaterial({ color: 0x5a6e66, roughness: 0.35, metalness: 0 }); // a dark green glaze
  const corkMat = new THREE.MeshStandardMaterial({ color: 0x9a7a52, roughness: 0.9 });
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.95, side: THREE.DoubleSide });
  const lidMat = new THREE.MeshStandardMaterial({ color: 0x6a5038, roughness: 0.85 });
  const warmRim = new THREE.MeshStandardMaterial({ color: 0x4a3a28, emissive: 0xffc66b, emissiveIntensity: 0.35, roughness: 0.6 });
  function courtPickup(p) {
    const item = new THREE.Group();
    if (p.kind === 'ammo') {
      const lid = new THREE.Mesh(courtKit.crockLid, lidMat); lid.position.y = 0.345;
      const knob = new THREE.Mesh(courtKit.knob, lidMat); knob.position.y = 0.385;
      const band = new THREE.Mesh(courtKit.chalk, paperMat); band.position.y = 0.17;
      const rim = new THREE.Mesh(courtKit.rim, warmRim); rim.rotation.x = Math.PI / 2; rim.scale.setScalar(0.205); rim.position.y = 0.322;
      item.add(new THREE.Mesh(courtKit.crock, ware), lid, knob, band, rim);
    } else {
      const cork = new THREE.Mesh(courtKit.cork, corkMat); cork.position.y = 0.36;
      const label = new THREE.Mesh(courtKit.label, paperMat); label.position.y = 0.13;
      const rim = new THREE.Mesh(courtKit.rim, warmRim); rim.rotation.x = Math.PI / 2; rim.scale.setScalar(0.085); rim.position.y = 0.345;
      item.add(new THREE.Mesh(courtKit.jar, jarWare), cork, label, rim);
    }
    item.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    item.rotation.set(0, (p.id * 2.399) % 6.283, 0);
    item.scale.setScalar(1.35); // big enough to find at a glance, small enough to be a thing in a garden
    return item;
  }

  function buildPickup(p) {
    const g = new THREE.Group();
    if (room === 'court') {
      const item = courtPickup(p);
      g.add(item);
      g.position.set(p.x, p.y || 0, p.z);
      scene.add(g);
      return { g, item, still: true };
    }
    const item = new THREE.Group();
    const cave = room === 'cave'; // in the cave only foxfire and salt glow
    if (p.kind === 'ammo') {
      item.add(new THREE.Mesh(geo.crate, crateMat), new THREE.Mesh(geo.band, cave ? saltMat : amberBand));
      const h = halo(cave ? FOXFIRE : PALETTE.amber, 1.3);
      h.material.opacity = cave ? 0.35 : 0.5;
      item.add(h);
    } else {
      const cross = cave ? saltMat : glassMat;
      item.add(new THREE.Mesh(geo.can, canMat), new THREE.Mesh(geo.crossA, cross), new THREE.Mesh(geo.crossB, cross));
      const h = halo(cave ? FOXFIRE : PALETTE.glass, 1.3);
      h.material.opacity = cave ? 0.35 : 0.5;
      item.add(h);
    }
    item.position.y = 0.45;
    g.add(item, contactShadow(1.1));
    g.position.set(p.x, p.y || 0, p.z); // a drop on a yard crate top lies up there (#21)
    scene.add(g);
    return { g, item };
  }

  // Tracers
  const tracerMat = new THREE.LineBasicMaterial({ color: PALETTE.amber, transparent: true, blending: THREE.AdditiveBlending, fog: false });
  const tracers = [];
  for (let i = 0; i < 8; i++) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geom, tracerMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerNext = 0;

  // Sparks: one Points cloud with a fixed pool.
  const SPARKS = 240;
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: PALETTE.amber, size: 0.09, map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkNext = 0;
  for (let i = 0; i < SPARKS; i++) sparkPos[i * 3 + 1] = -100;

  function sparkBurst(x, y, z, n, speed) {
    for (let k = 0; k < n; k++) {
      const i = sparkNext;
      sparkNext = (sparkNext + 1) % SPARKS;
      sparkPos[i * 3] = x; sparkPos[i * 3 + 1] = y; sparkPos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 0.8 + 0.2;
      sparkVel[i * 3] = Math.cos(a) * speed * u;
      sparkVel[i * 3 + 1] = (Math.random() * 0.8 + 0.4) * speed;
      sparkVel[i * 3 + 2] = Math.sin(a) * speed * u;
      sparkLife[i] = 0.25 + Math.random() * 0.2;
    }
  }

  function tracer(from, to) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % tracers.length;
    const p = t.line.geometry.attributes.position;
    // Start a little in front of the eye so the line reads as leaving the muzzle.
    p.setXYZ(0, from.x + (to.x - from.x) * 0.02, from.y - 0.12 + (to.y - from.y) * 0.02, from.z + (to.z - from.z) * 0.02);
    p.setXYZ(1, to.x, to.y, to.z);
    p.needsUpdate = true;
    t.line.geometry.computeBoundingSphere();
    t.line.visible = true;
    t.life = 0.05;
  }

  function removeView(v) {
    scene.remove(v.g);
    if (v.custom) {
      if (v.view.dispose) v.view.dispose();
      return;
    }
    v.shell.dispose();
    v.coreMat.dispose();
    v.glow.material.dispose();
  }

  function onEvent(ev) {
    switch (ev.type) {
      case 'shot':
        if (ev.pellets && ev.pellets.length > 1) {
          // A blast: the weapon model draws its own tracers; each pellet still chips the rock.
          for (const p of ev.pellets) {
            if (p.kind === 'cover' || p.kind === 'ground') sparkBurst(p.to.x, p.to.y, p.to.z, 3, 2.2);
          }
          break;
        }
        tracer(ev.from, ev.to);
        if (ev.kind === 'cover' || ev.kind === 'ground') sparkBurst(ev.to.x, ev.to.y, ev.to.z, 6, 2.5);
        break;
      case 'hit':
        if (room === 'cave') sparkBurst(ev.x, ev.y, ev.z, 4 + (ev.pellets || 1), 2.4); // salt crystals
        break;
      case 'kill': {
        const v = live.get(ev.id);
        if (v) {
          live.delete(ev.id);
          dying.push({ v, t: 0, id: ev.id });
          if (v.custom) v.view.die(ev, lastCfg);
          else sparkBurst(ev.x, ev.y + 1.0, ev.z, 8, 3.5);
        }
        break;
      }
      case 'boltBurst':
        sparkBurst(ev.x, ev.y, ev.z, 8, 2);
        break;
      case 'sceneStart':
        if (ev.kind === 'crater') fling(ev);
        else if (ev.kind === 'vault' && ev.foe) {
          // the Cantor's last blast: its dying view rears and fires before it folds (fauna.js)
          const d = dying.find((x) => x.id === ev.foe.id);
          if (d && d.v.custom && d.v.view.lastBlast) d.v.view.lastBlast(ev);
        }
        break;
      case 'craterBlast':
        if (!ev.skipped) sparkBurst(ev.x, 0.3, ev.z, 60, 9); // the lantern's last sparks, out of the blast
        break;
      default:
    }
    // Creature tells and reactions go to the view they belong to (by id, or by owner for globs).
    if (ev.type !== 'kill') {
      const v = (ev.id != null && live.get(ev.id)) || (ev.owner != null && live.get(ev.owner));
      if (v && v.custom && v.view.onEvent) v.view.onEvent(ev);
    }
    for (const l of layers) if (l.onEvent) l.onEvent(ev);
  }

  function clear() {
    for (const l of layers) if (l.clear) l.clear();
    for (const v of live.values()) removeView(v);
    live.clear();
    for (const d of dying) removeView(d.v);
    dying.length = 0;
    if (flung) { removeView(flung.v); flung = null; }
    for (const v of leaving) removeView(v);
    leaving.length = 0;
    for (const v of pickupViews.values()) scene.remove(v.g);
    pickupViews.clear();
    for (const t of tracers) { t.line.visible = false; t.life = 0; }
    for (let i = 0; i < SPARKS; i++) { sparkLife[i] = 0; sparkPos[i * 3 + 1] = -100; }
    sparkGeo.attributes.position.needsUpdate = true;
  }

  /** A creature on a yard ladder (#21): leaning into the rungs, a Wick's arms reaching up hand over hand. */
  function climbPose(v, time, e) {
    v.body.rotation.x = 0.3;
    if (v.type === 'wick') {
      const hand = Math.sin(time * 6 + e.id) * 0.4;
      v.arms[0].rotation.z = -2.6 + hand;
      v.arms[1].rotation.z = 2.6 + hand;
      v.body.rotation.y = 0;
    }
  }

  function syncEnemy(e, v, time, eye, cfg) {
    const c = cfg[e.type];
    // Lanterns read through fog at range but must not white out the view at point blank.
    const near = Math.hypot(e.x - eye.x, e.z - eye.z);
    v.glow.material.opacity = Math.max(0.2, Math.min(0.85, (near - 1) / 4));
    const bob = Math.sin(time * 3 + e.id) * 0.08;
    v.g.position.set(e.x, e.y + bob, e.z);
    v.g.rotation.y = e.heading;
    v.body.rotation.x = -0.18 * (e.speedNow / c.speed);
    let tell = 0;
    if (e.state === 'windup') tell = 1 - e.timer / c.windup;
    const flash = e.hitFlash > 0;
    v.shell.emissive.copy(flash ? CHALK : BLACK);
    v.shell.emissiveIntensity = flash ? 0.9 : 0;
    v.coreMat.color.copy(flash ? CHALK : AMBER).lerp(FLARE, flash ? 0 : tell);
    v.glow.material.color.copy(AMBER).lerp(FLARE, tell);
    const swell = 1 + 0.45 * tell;
    v.core.scale.setScalar(swell);
    v.glow.scale.setScalar((v.type === 'wick' ? 2.2 : 2.6) * (1 + 0.5 * tell));
    if (e.climbing) climbPose(v, time, e); // on a yard ladder (#21)
    else if (v.type === 'wick') {
      v.arms[0].rotation.z = -0.12 - 1.3 * tell;
      v.arms[1].rotation.z = 0.12 + 1.3 * tell;
      v.body.rotation.y = Math.sin(time * 1.7 + e.id) * 0.15;
    } else {
      v.tank.scale.set(1 + 0.22 * tell, 0.7 + 0.25 * tell, 1 + 0.22 * tell);
    }
  }

  /**
   * #29: the crater's scene starts: the foe whose fall won the yard is taken over (its view is in
   * `dying`, a frame old; a fresh one of its kind is built if it is not) and flown from the rules'
   * arc until it hits. Its arc clears the crates under it (flightApex).
   */
  function fling(ev) {
    if (flung) removeView(flung.v);
    flung = null;
    const foe = ev.foe;
    if (!foe || !Number.isFinite(foe.x)) return;
    const i = dying.findIndex((d) => d.id === foe.id && !d.v.custom);
    const v = i >= 0 ? dying.splice(i, 1)[0].v : foe.enemy === 'bellows' ? buildBellows() : buildWick();
    v.body.position.y = 0;
    v.body.scale.set(1, 1, 1);
    v.shell.opacity = 1;
    v.coreMat.opacity = 1;
    v.shadow.visible = false;
    flung = { v, heading: v.g.rotation.y, apex: flightApex(foe, ev, lastCfg.boxes || []), out: {}, trail: 0, popped: false };
  }

  /** The flung foe at this frame of the scene: shuddering up as its lantern overloads, then tumbling over. */
  function flyFoe(sim, dt) {
    const w = sim.waves;
    const sc = w && w.scene;
    if (!sc || sc.kind !== 'crater' || sc.struck || !w.wayout) { removeView(flung.v); flung = null; return; }
    const v = flung.v;
    const f = foeFlightAt(sc, w.wayout, sc.t, flung.out, flung.apex);
    const k = f.wind;
    const air = sc.t >= WAYOUT.yard.beat;
    // the lantern overloads: amber to flare to white, the halo swelling, the shell glowing with it
    v.coreMat.color.copy(AMBER).lerp(FLARE, Math.min(1, k * 2)).lerp(CHALK, Math.max(0, k * 2 - 1));
    v.glow.material.color.copy(AMBER).lerp(FLARE, k);
    v.glow.material.opacity = 0.85;
    v.glow.scale.setScalar((v.type === 'wick' ? 2.2 : 2.6) * (1 + 0.3 * k + 0.6 * Math.min(1, f.u * 5)));
    v.core.scale.setScalar(1 + 0.6 * k);
    v.shell.emissive.copy(FLARE);
    v.shell.emissiveIntensity = 0.5 * k;
    if (v.type === 'wick') { v.arms[0].rotation.z = -0.12 - 2.1 * k; v.arms[1].rotation.z = 0.12 + 2.1 * k; }
    else v.tank.scale.set(1 + 0.25 * k, 0.7 + 0.28 * k, 1 + 0.25 * k);
    v.body.rotation.x = 0;
    // tumbling about its middle: end over end across its flight, turning on itself as it goes
    FLING_Q.setFromAxisAngle(FLING_AXIS.set(f.ax, 0, f.az), f.spin);
    FLING_Q.multiply(FLING_TWIST.setFromAxisAngle(UP, flung.heading + f.twist));
    FLING_ARM.set(0, FLING_PIVOT, 0).applyQuaternion(FLING_Q);
    const shudder = air ? 0 : 0.035 * k;
    v.g.position.set(
      f.x - FLING_ARM.x + shudder * Math.sin(sc.t * 97),
      f.y + FLING_PIVOT - FLING_ARM.y,
      f.z - FLING_ARM.z + shudder * Math.sin(sc.t * 83 + 1),
    );
    v.g.quaternion.copy(FLING_Q);
    if (air && !flung.popped) { // it lets go of the ground
      flung.popped = true;
      sparkBurst(sc.foe.x, sc.foe.y + 0.3, sc.foe.z, 16, 4.5);
    }
    flung.trail -= dt;
    if (air && flung.trail <= 0) { // sparks shed along the arc
      flung.trail = 0.035;
      sparkBurst(f.x, f.y + FLING_PIVOT, f.z, 2, 1.4);
    }
  }

  function setRoomLook(name) {
    room = name;
    const salt = room === 'cave' || room === 'court' || room === 'castle'; // the salt gun's white; the yard keeps amber
    tracerMat.color.set(salt ? SALT : PALETTE.amber);
    sparks.material.color.set(salt ? SALT : PALETTE.amber);
  }

  function sync(sim, dt, time, eye) {
    const cfg = sim.cfg || CONFIG;
    lastCfg = cfg;
    if ((cfg.room || 'yard') !== room) setRoomLook(cfg.room || 'yard');
    const seen = new Set();
    let built = 0;
    for (const e of sim.enemies) {
      let v = live.get(e.id);
      if (!v) {
        // #29: a level that starts with a crowd (the Rose Court's) builds them a few a frame, so no
        // one frame carries them all (the hand-over's cover is up while they come)
        if (built >= buildsPerFrame) continue;
        built += 1;
        v = buildView(e, cfg);
        live.set(e.id, v);
      }
      seen.add(e.id);
      if (v.custom) v.view.sync(e, dt, time, eye, cfg, reduced);
      else syncEnemy(e, v, time, eye, cfg);
    }
    for (const [id, v] of live) {
      if (!seen.has(id)) {
        live.delete(id);
        if (v.custom && v.view.linger) leaving.push(v); else removeView(v);
      }
    }
    for (let i = leaving.length - 1; i >= 0; i--) {
      if (!leaving[i].view.linger(dt, time, eye)) { removeView(leaving[i]); leaving.splice(i, 1); }
    }

    if (flung) flyFoe(sim, dt);

    // Death: core dark, drop, flatten, fade in 0.5 s.
    for (let i = dying.length - 1; i >= 0; i--) {
      const d = dying[i];
      d.t += dt;
      if (d.v.custom) {
        if (d.v.view.updateDeath(dt, time, reduced, sim.waves && sim.waves.scene)) { removeView(d.v); dying.splice(i, 1); }
        continue;
      }
      const k = Math.min(1, d.t / 0.5);
      d.v.coreMat.color.copy(AMBER).lerp(DARK, Math.min(1, k * 3));
      d.v.glow.material.opacity = 0.85 * (1 - Math.min(1, k * 2.5));
      d.v.body.position.y = -0.9 * k * k;
      d.v.body.scale.set(1 + 0.3 * k, 1 - 0.65 * k, 1 + 0.3 * k);
      d.v.shell.opacity = 1 - k;
      d.v.coreMat.opacity = 1 - k;
      if (k >= 1) { removeView(d.v); dying.splice(i, 1); }
    }

    // Bolts
    const bolts = sim.bolts || [];
    for (let i = 0; i < Math.max(boltViews.length, bolts.length); i++) {
      const b = bolts[i];
      // Hat-pins ride the bolt list in the court; beasts.js draws those.
      if (!b || b.kind === 'pin') {
        if (boltViews[i]) { boltViews[i].g.visible = false; boltViews[i].trail.forEach((t) => (t.visible = false)); }
        continue;
      }
      const v = boltView(i);
      v.g.visible = true;
      v.g.position.set(b.x, b.y, b.z);
      v.trail.forEach((t, j) => {
        t.visible = true;
        const back = 0.05 * (j + 1);
        t.position.set(b.x - b.vx * back, b.y - b.vy * back, b.z - b.vz * back);
      });
    }

    // Pickups
    const pseen = new Set();
    for (const p of sim.pickups) {
      let v = pickupViews.get(p.id);
      if (!v) { v = buildPickup(p); pickupViews.set(p.id, v); }
      pseen.add(p.id);
      // Cave pickups carry their chamber: ones behind a sealed veil are not drawn.
      v.g.visible = p.chamber == null || !sim.waves || p.chamber >= sim.waves.index;
      if (v.still) continue; // the court's pickups lie still, as things do
      v.item.rotation.y = time * 1.2 + p.id;
      v.item.position.y = 0.45 + Math.sin(time * 2 + p.id) * 0.06;
    }
    for (const [id, v] of pickupViews) {
      if (!pseen.has(id)) { scene.remove(v.g); pickupViews.delete(id); }
    }

    // Tracers and sparks
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    let anySpark = false;
    for (let i = 0; i < SPARKS; i++) {
      if (sparkLife[i] <= 0) continue;
      anySpark = true;
      sparkLife[i] -= dt;
      sparkVel[i * 3 + 1] -= 9 * dt;
      sparkPos[i * 3] += sparkVel[i * 3] * dt;
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      if (sparkLife[i] <= 0) sparkPos[i * 3 + 1] = -100;
    }
    if (anySpark || dt === 0) sparkGeo.attributes.position.needsUpdate = true;

    for (const l of layers) if (l.sync) l.sync(sim, dt, time, eye);
  }

  function setReducedFlash(v) {
    reduced = !!v;
    for (const l of layers) if (l.setReducedFlash) l.setReducedFlash(reduced);
  }

  /** #29: how many new figures one frame may build (Infinity but under the hand-over's cover). */
  function setBuildBudget(n) { buildsPerFrame = n >= 1 ? n : Infinity; }
  const api = { sync, onEvent, clear, register, addLayer, setReducedFlash, setBuildBudget };
  registerFauna(api, scene); // the cave's creatures, globs and pools
  registerCast(api, scene); // the court's guards, gardeners and Renfield
  registerBeasts(api, scene); // the four gate creatures, the rats and the grin
  api.addLayer(createProps(scene, COURT_CONFIG)); // valves, water, beds, items and stakes, drawn from sim state
  return api;
}
