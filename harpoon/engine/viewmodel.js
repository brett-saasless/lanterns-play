// Weapon viewmodels, drawn in their own pass so they never clip into walls: the Rivet Carbine
// (built here), the Salt Bore (bore.js) and the Stake Crossbow (crossbow.js). setWeapon picks
// which one is in the warden's hands; in the Rose Court a `swap` event lowers one and raises
// the other over the room's swap time.

import * as THREE from 'three';
import { PALETTE, radialTexture } from './world.js';
import { createBore } from './bore.js';
import { createCrossbow } from './crossbow.js';
import { createHalberd } from './halberd.js';
import { createTinCup } from './tincup.js';
import { createBraid } from './braid.js';
import { createHandLamp } from './handlamp.js'; // the castle's hand lantern (logic/lantern.js)
import { drawnTool } from './hud.js'; // the pure rule for which tool is drawn (R22), kept where Node can test it

const TOOLS = ['bore', 'crossbow', 'halberd', 'cup', 'garlic', 'lantern']; // the tools with a model of their own; anything else is the carbine

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.25, 'rgba(255,179,71,0.9)');
  grad.addColorStop(1, 'rgba(255,106,31,0)');
  g.fillStyle = grad;
  for (let i = 0; i < 5; i++) {
    g.rotate((Math.PI * 2) / 5);
    g.beginPath();
    g.moveTo(-9, 0);
    g.lineTo(0, -62);
    g.lineTo(9, 0);
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, 26, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** worldCamera (optional): the world scene's camera, for the bore's tracers and pilot light. */
export function createViewmodel(aspect, worldCamera) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, aspect, 0.01, 10);
  const yardLights = new THREE.Group();
  yardLights.add(new THREE.HemisphereLight(0x8fb8bc, 0x1a2422, 1.4 * Math.PI));
  const key = new THREE.DirectionalLight(0xbfd8d4, 0.8 * Math.PI);
  key.position.set(-1, 2, 1);
  yardLights.add(key);
  // Underground the tool is lit by the cave's green and its own pilot lamp, and little else.
  const caveLights = new THREE.Group();
  caveLights.add(new THREE.HemisphereLight(0x8fbfa0, 0x05070a, 0.5 * Math.PI));
  const lampKey = new THREE.DirectionalLight(0xf4f1e6, 0.45 * Math.PI);
  lampKey.position.set(0.6, 1.2, 1.5);
  caveLights.add(lampKey);
  caveLights.visible = false;
  // In the Rose Court's daylight: a warm sky and a high sun.
  const courtLights = new THREE.Group();
  courtLights.add(new THREE.HemisphereLight(0xcfe4f5, 0x6a5a3a, 1.3 * Math.PI));
  const sunKey = new THREE.DirectionalLight(0xfff0d0, 1.0 * Math.PI);
  sunKey.position.set(0.5, 2, 1);
  courtLights.add(sunKey);
  courtLights.visible = false;
  // In the castle: cold moon from a window and a dim, warm fill from the torches.
  const castleLights = new THREE.Group();
  castleLights.add(new THREE.HemisphereLight(0x8d9bc0, 0x2a1d18, 0.8 * Math.PI));
  const castleKey = new THREE.DirectionalLight(0xffd9a8, 0.7 * Math.PI);
  castleKey.position.set(0.6, 1.4, 1.2);
  castleLights.add(castleKey);
  castleLights.visible = false;
  scene.add(yardLights, caveLights, courtLights, castleLights);
  const muzzleLight = new THREE.PointLight(PALETTE.amber, 0, 2.5, 2);
  muzzleLight.position.set(0.25, -0.15, -0.9);
  scene.add(muzzleLight);

  const oxide = new THREE.MeshStandardMaterial({ color: PALETTE.oxide, roughness: 0.55, metalness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f2f, roughness: 0.4, metalness: 0.8 });
  const rust = new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.6, metalness: 0.4 });
  const chalk = new THREE.MeshBasicMaterial({ color: PALETTE.chalk });
  const lampMat = new THREE.MeshBasicMaterial({ color: PALETTE.amber });

  const rig = new THREE.Group(); // animated pose
  const gun = new THREE.Group();
  rig.add(gun);
  scene.add(rig);
  const base = new THREE.Vector3(0.2, -0.2, -0.5);
  rig.position.copy(base);
  gun.scale.setScalar(0.72);

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.36), oxide);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.14), steel);
  stock.position.set(0, -0.025, 0.24);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), steel);
  grip.position.set(0, -0.1, 0.1);
  grip.rotation.x = -0.3;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.34, 10), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.01, -0.34);
  const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.2), steel);
  shroud.position.set(0, 0.01, -0.27);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.03, 0.05), rust);
  band.position.set(0, 0.0, -0.12);
  const tally = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.22), chalk);
  tally.position.set(0, 0.057, -0.02);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 16), rust);
  drum.rotation.z = Math.PI / 2;
  const drumHolder = new THREE.Group();
  drumHolder.position.set(0, -0.09, -0.06);
  drumHolder.add(drum);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), lampMat);
  lamp.position.set(0.03, 0.06, 0.15);
  gun.add(receiver, stock, grip, barrel, shroud, band, tally, drumHolder, lamp);

  const flashMat = new THREE.MeshBasicMaterial({
    map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), flashMat);
  flash.position.set(0, 0.01, -0.54);
  flash.visible = false;
  gun.add(flash);
  const dimLamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,179,71,0.6)'), transparent: true, depthWrite: false }));
  dimLamp.scale.set(0.08, 0.08, 1);
  dimLamp.position.set(0, 0.01, -0.53);
  dimLamp.visible = false;
  gun.add(dimLamp);

  let kick = 0; // 0..1, decays over 120 ms
  let flashLeft = 0;
  let reloadT = -1;
  let walkPhase = 0;
  let sprintBlend = 0;
  let reduced = false;
  // sea-1-dock-art D9: on a view under 400 px tall the seat drops and shrinks (about 0.85 scale)
  // so the harpoon and the carbine in hand clear the weapon plate's rectangle. The touch smoke
  // measures the clearance at 667x320 and 844x390; this is the mechanism, tuned to clear by a
  // margin - the owner's eye and the smoke's own measurement are the final word on the exact drop.
  const SHORT_VIEW_PX = 400;
  const SHORT_SCALE = 0.85;
  const SHORT_DROP = 0.1; // metres, added to the seat's own y (further from the weapon plate above)
  let seatScale = 1;
  let seatDrop = 0;

  const bore = createBore(worldCamera);
  bore.group.visible = false;
  rig.add(bore.group);
  const crossbow = createCrossbow(worldCamera);
  crossbow.group.visible = false;
  rig.add(crossbow.group);
  const halberd = createHalberd(worldCamera);
  halberd.group.visible = false;
  rig.add(halberd.group);
  const cup = createTinCup(worldCamera);
  cup.group.visible = false;
  rig.add(cup.group);
  // The castle's garlic (#9): wielded on Q like the rest, held up while the rules say so.
  const garlic = createBraid();
  garlic.group.visible = false;
  rig.add(garlic.group);
  // The castle's hand lantern: held up by its ring; its light in the room is castle.js's borrowed pool light.
  const lantern = createHandLamp();
  lantern.group.visible = false;
  rig.add(lantern.group);
  const tools = { bore, crossbow, halberd, cup, garlic, lantern };
  let weaponName = 'carbine';
  let lighting = 'yard'; // which light group the tools are seen by: yard, cave or court
  let specs = null; // the room's weapons table (court only) and its swap time
  let swapTime = 0.4;
  let swapLeft = 0;
  let swapTo = null;

  function onEvent(ev) {
    if (ev.type === 'swap') {
      startSwap(ev.weapon);
      return;
    }
    if (swapTo) return; // a swap is lowering the old tool: its events (they carry no weapon name) belong to neither
    if (tools[weaponName]) {
      tools[weaponName].onEvent(ev);
      return;
    }
    if (ev.type === 'shot') {
      kick = 1;
      flashLeft = 0.06;
      flash.rotation.z = Math.random() * Math.PI * 2;
      flash.scale.setScalar(0.85 + Math.random() * 0.3);
    } else if (ev.type === 'reloadStart') {
      reloadT = 0;
    } else if (ev.type === 'reloadDone') {
      reloadT = -1;
    }
  }

  function cancel() {
    reloadT = -1;
    kick = 0;
    flashLeft = 0;
    swapLeft = 0;
    swapTo = null;
    for (const t of Object.values(tools)) t.cancel();
  }

  /**
   * 'carbine', 'bore', 'crossbow', 'halberd', 'cup', 'garlic' or 'lantern'. weaponCfg is that weapon's spec (the tools
   * read magazine, reloadTime and the like). room (optional) picks the light the tool is seen by:
   * 'cave' (its own green), 'court' (daylight), 'castle' (moon and torches) or anything else (the yard's teal).
   */
  function setWeapon(name, weaponCfg, room = name === 'bore' ? 'cave' : 'yard') {
    lighting = room;
    weaponName = TOOLS.includes(name) ? name : 'carbine';
    applyWeapon(weaponName, weaponCfg);
    cancel();
    flash.visible = false;
    dimLamp.visible = false;
    muzzleLight.intensity = 0;
  }

  function applyWeapon(name, weaponCfg) {
    const prev = weaponName;
    weaponName = name;
    if (prev !== name && tools[prev]) tools[prev].cancel(); // the outgoing tool drops any pose in progress
    const isBore = name === 'bore';
    gun.visible = !tools[name];
    for (const [k, t] of Object.entries(tools)) t.group.visible = k === name;
    yardLights.visible = lighting === 'yard';
    caveLights.visible = lighting === 'cave';
    courtLights.visible = lighting === 'court';
    castleLights.visible = lighting === 'castle';
    if (tools[name]) tools[name].setConfig(weaponCfg || (specs && specs[name]));
    // The salt gun's pilot light is the cave's; in daylight it would only add a light to the world.
    bore.setActive(isBore && lighting === 'cave');
    for (const k of ['crossbow', 'halberd', 'cup', 'garlic', 'lantern']) tools[k].setActive(k === name);
  }

  /** The court's weapons table and swap time, so a `swap` event can seat either tool. */
  function setSpecs(weapons, time) {
    specs = weapons || null;
    swapTime = time > 0 ? time : 0.4;
  }

  function startSwap(name) {
    if (!tools[name]) return;
    if (name === weaponName && !swapTo) return;
    swapTo = name;
    swapLeft = swapTime;
  }

  // On a ladder (the yard's crates, #21) the tool drops out of view: both hands are on the rungs.
  let climbK = 0;
  function climbDip(dt, player) {
    climbK += ((player.climbing ? 1 : 0) - climbK) * Math.min(1, dt * 10);
    return climbK * 0.3;
  }

  function walkBob(dt, player) {
    const moving = player.moving && player.grounded;
    walkPhase += dt * (player.sprinting ? 13 : 9) * (moving ? 1 : 0);
    sprintBlend += ((player.sprinting && moving ? 1 : 0) - sprintBlend) * Math.min(1, dt * 8);
    const bobAmt = moving ? (player.sprinting ? 0.022 : 0.012) : 0.003;
    return { bx: Math.sin(walkPhase) * bobAmt, by: -Math.abs(Math.cos(walkPhase)) * bobAmt };
  }

  /**
   * sim (optional): handed to the tool, so the cup can read its fill. In the court the tool drawn
   * is always the one in sim.weapon (R22): `swap` only times the lower-and-raise, so after Q, a
   * pickup, a restore or Try again the model and the plate agree.
   */
  function update(dt, player, weapon, sim) {
    // sea-1-dock R6: slung (dock.js seatTitle/arrive) - no carbine viewmodel shows in hand.
    // R6 item 2: nor while the glass is up - both hands are on the telescope, not the weapon.
    rig.visible = !(sim && sim.waves && (sim.waves.kit === 'slung' || (sim.waves.glass && sim.waves.glass.up)));
    if (!rig.visible) return;
    rig.scale.setScalar(seatScale); // D9: the short-viewport seat shrink, every tool alike
    const held = weapon && weapon.name ? (TOOLS.includes(weapon.name) ? weapon.name : 'carbine') : null;
    if (held && (lighting === 'court' || lighting === 'castle')) {
      const d = drawnTool(held, weaponName, swapLeft, swapTo);
      swapTo = d.swapTo;
      if (d.apply) {
        applyWeapon(d.apply); // no swap playing and the wrong tool drawn: seat the right one at once
        cancel();
      }
    }
    // A swap: the old tool drops out of view for the first half, the new one comes up for the second.
    let swapDip = 0;
    let swapping = false;
    if (swapLeft > 0) {
      swapLeft = Math.max(0, swapLeft - dt);
      const k = 1 - swapLeft / swapTime;
      swapDip = Math.sin(Math.PI * k) * 0.35;
      if (swapTo && k >= 0.5) {
        applyWeapon(swapTo);
        swapTo = null;
      }
      swapping = swapTo !== null;
    }
    if (tools[weaponName]) {
      // The rig carries the walk; the tool poses itself (kick, pump, draw, reload) inside it.
      const { bx, by } = walkBob(dt, player);
      rig.position.set(base.x + bx + sprintBlend * 0.04, base.y + by - sprintBlend * 0.08 + (player.grounded ? 0 : -0.02) - swapDip - climbDip(dt, player) - seatDrop, base.z);
      rig.rotation.set(-sprintBlend * 0.25, sprintBlend * 0.5, sprintBlend * 0.15);
      if (!swapping) tools[weaponName].update(dt, player, weapon, sim);
      return;
    }
    kick = Math.max(0, kick - dt / 0.12);
    flashLeft = Math.max(0, flashLeft - dt);
    const showFlash = flashLeft > 0;
    flash.visible = showFlash && !reduced;
    dimLamp.visible = showFlash && reduced;
    muzzleLight.intensity = showFlash && !reduced ? 6 : 0;

    if (weapon.reloading && reloadT < 0) reloadT = 0;
    if (!weapon.reloading) reloadT = -1;
    let dip = 0;
    let roll = 0;
    let drumDrop = 0;
    if (reloadT >= 0) {
      reloadT += dt;
      const k = Math.min(1, reloadT / 1.4);
      const s = Math.sin(k * Math.PI);
      dip = s * 0.1;
      roll = s * 0.6;
      drumDrop = Math.sin(Math.min(1, k * 1.3) * Math.PI) * 0.12;
    }
    lampMat.color.set(weapon.reloading ? 0x2a1d10 : PALETTE.amber);

    const { bx, by } = walkBob(dt, player);

    rig.position.set(
      base.x + bx + sprintBlend * 0.04,
      base.y + by - dip - sprintBlend * 0.08 + (player.grounded ? 0 : -0.02) - climbDip(dt, player) - seatDrop,
      base.z + kick * 0.04,
    );
    rig.rotation.set(kick * 0.035 - sprintBlend * 0.25, sprintBlend * 0.5, -roll + sprintBlend * 0.15);
    drumHolder.position.y = -0.09 - drumDrop;
  }

  return {
    scene, camera, onEvent, update, cancel, setWeapon,
    get weapon() { return weaponName; },
    setSpecs,
    /**
     * Builds the programs for tools by name (each shown for one draw into a pixel, under the room's lights,
     * then put back), so the first time one is drawn costs no frame: the castle's lantern as the castle starts.
     */
    warm(renderer, names) {
      if (!renderer || !renderer.render) return false;
      // shown as it will be drawn: the named tool alone (another tool's own light, the salt gun's pilot lamp, would
      // change the lights the program is built for)
      const all = [gun, ...Object.values(tools).map((t) => t.group)];
      const seen = all.map((o) => o.visible);
      all.forEach((o) => { o.visible = false; });
      names.forEach((n) => { if (tools[n]) tools[n].group.visible = true; });
      // drawn, not compiled: three's compile() counts the room's hidden light groups too, so its programs
      // are not the ones a frame asks for. One draw into a single pixel (the next frame clears it) builds them.
      const scissor = renderer.getScissorTest();
      let ok = true;
      try {
        renderer.setScissorTest(true);
        renderer.setScissor(0, 0, 1, 1);
        renderer.render(scene, camera);
      } catch (e) {
        ok = false;
        console.debug('viewmodel warm: built when first drawn instead', e); // best effort, but said
      } finally {
        renderer.setScissorTest(scissor);
        all.forEach((o, i) => { o.visible = seen[i]; });
      }
      return ok;
    },
    setReducedFlash(v) { reduced = v; for (const t of Object.values(tools)) t.setReducedFlash(v); },
    /** height (optional, CSS px): under SHORT_VIEW_PX (400) the seat drops and shrinks (D9). */
    resize(aspect, height) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      const short = Number.isFinite(height) && height < SHORT_VIEW_PX;
      seatScale = short ? SHORT_SCALE : 1;
      seatDrop = short ? SHORT_DROP : 0;
    },
  };
}
