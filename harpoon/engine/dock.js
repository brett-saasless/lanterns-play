// sea-1-dock: the fifth room's scene (docs/features/sea-1-dock/02-design.md, Components). REDUCED
// FIDELITY, by the owner's own decision after task 3's scope was sized against the castle's own
// engine files (castle.js, keepcast.js, cast.js, sculpt.js, stone.js: 2300-3200 lines each): flat
// palette-colour materials straight from dockmap.js's own boxes and zones, no canvas textures, no
// hatch-line engraving method, no sculpted cast, no telescope mask shader, no water shader. The
// goal is a room that loads, lights, and can be walked and smoke-tested end to end, not the
// design's full visual bar - see sea1-build-report.md for exactly what that leaves undone.
//
// Art fix pass (owner's R5 picks, sea1-art-findings.json), still reduced fidelity - no textures,
// no sculpted cast, no particle or shader work:
// B1 five amber pool lights at named flame sites, the hemisphere fill dropped a stop; B2 the hull
// lightened with a rail strip; C1/C2 the tavern gets a ceiling, three lamps and a built bar/spike;
// C3 the try-works flame moved onto the deck and recoloured; C4 two placeholder landmarks at the
// coin's own bearings; C6 the deck lifted clear of the hull so the two no longer coincide; C7
// brass held back for the tiller (the binnacle's part of the hybrid ledger) alone; C8 a lit door,
// sign, poster and gangway lantern for wayfinding; C5/B10/C10 the dawn clock now warms the low sun
// only (fog and sky hold at fog-grey, as dawn.js's own doc comment says), with one shadow-casting
// light handed from the gangway lantern to the low sun at signing on; B6 the scare's stage closed
// overhead and framed with piles; B7 (cheap stand-in, not the full-fidelity creature) a plain
// spindle that rises, rolls and sinks under an arc-white light; B8/B9 the harbour slides away from
// the ship during cast-off, and the open-sea backdrop is large enough that its edge never shows.

import * as THREE from 'three';
import { dockWalls, dockProps, PLACES, WATER, DECK, DECK_Y, UNDER_PIER, GANGWAY, ZONES, TAVERN_DOOR, LAY_SPOTS } from '../logic/dockmap.js';
import { skyOf } from '../logic/dawn.js';
import { glowAt } from './dockart.js';
import { makeRng } from '../logic/rng.js';

// Flat palette colours (UI direction, Palette) - no canvas textures this pass.
const LAMP_BLACK = 0x14110f;
const TAR_BROWN = 0x3b2a1e;
const WHALEBONE = 0xe6ddc6;
const OIL_AMBER = 0xe8a040;
const BOTTLE_GREEN = 0x0e2a26;
const VERNE_BRASS = 0xb08a3c;
const ARC_WHITE = 0xcfe9ff;
const PLATE_PAPER = 0xd9cfb8;
const HULL_LIFT = 0x2a221c; // art critique B2: lighter than lamp-black, so the hull reads as a shape, not a hole

function box(geom, mat, x, y, z) {
  const m = new THREE.Mesh(geom, mat);
  m.position.set(x, y, z);
  return m;
}

/** One box from dockmap.js's own shape (minX/maxX/minZ/maxZ/h, y offset for a raised floor). */
function fromAabb(b, mat, yOffset = 0) {
  return box(new THREE.BoxGeometry(b.w, b.h, b.d), mat, b.x, yOffset + b.h / 2, b.z);
}

const LAY_TEXT = { lay90: ['90th', 'lay'], lay300: ['300th', 'lay'], lay777: ['777th', 'lay'] };

/**
 * sea-1-dock-art C2 (UI direction, "Lay tickets"): a plate-paper slip, ruled double border in
 * lamp-black, the approved text, a wavy script line and a punched hole. Seeded (logic/rng.js) so
 * the same key always cuts the same ticket. 256x416 px (the ticket's own 0.16 x 0.26 m aspect).
 */
function ticketTexture(key, seed) {
  const W = 256; const H = 416;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rng = makeRng(seed >>> 0);
  g.fillStyle = '#d9cfb8'; // plate paper (PLATE_PAPER)
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#14110f'; // lamp-black ink (LAMP_BLACK)
  const m = 16;
  g.lineWidth = 4;
  g.strokeRect(m, m, W - 2 * m, H - 2 * m);
  g.lineWidth = 1.5;
  g.strokeRect(m + 7, m + 7, W - 2 * m - 14, H - 2 * m - 14); // the ruled double border
  g.fillStyle = '#14110f';
  g.textAlign = 'center';
  // numerals 0.09 m tall on a 0.26 m plate (H px): about H * 0.09/0.26 =~ 0.346*H
  const numPx = Math.round(H * (0.09 / 0.26));
  g.font = `bold ${numPx}px Georgia, serif`;
  const [num, word] = LAY_TEXT[key] || [key, ''];
  g.fillText(num, W / 2, H * 0.4);
  g.font = `${Math.round(numPx * 0.6)}px Georgia, serif`;
  g.fillText(word, W / 2, H * 0.4 + numPx * 0.75);
  // one line of script, a wavy stroke (no real text - the house rule: every shown line is owner-approved and this adds none)
  g.beginPath();
  const sy = H * 0.62;
  for (let x = m + 24; x <= W - m - 24; x += 6) {
    const y = sy + Math.sin((x + seed) * 0.22) * 5 + (rng() - 0.5) * 2;
    if (x === m + 24) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.lineWidth = 2;
  g.stroke();
  // the punched hole, with the brass spike through it (the spike itself is drawn separately)
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(W / 2, m + 22, 7, 0, Math.PI * 2);
  g.fill();
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A point light plus a small emissive head, so the lantern is a visible object as well as a light (no texture, no sprite). */
function lantern(group, x, y, z, { intensity = 1.5, range = 8, radius = 0.1, castShadow = false } = {}) {
  const light = new THREE.PointLight(OIL_AMBER, intensity * Math.PI, range, 2);
  light.position.set(x, y, z);
  light.castShadow = castShadow;
  group.add(light);
  const head = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), new THREE.MeshStandardMaterial({ color: OIL_AMBER, emissive: OIL_AMBER, emissiveIntensity: 1.6, roughness: 0.4 }));
  head.position.set(x, y, z);
  head.userData.fixed = true; // never reparented under the harbour (art critique B8): stays with its own light
  group.add(head);
  return light;
}

/** Art critique C4: a landmark at bearing `azDeg` (the same frame as cfg.glass.marks' az, 0 = north/-z) from the mast, at `dist` metres. */
function landmark(group, mast, azDeg, dist, build) {
  const rad = (azDeg * Math.PI) / 180;
  const x = mast.x + dist * Math.sin(rad);
  const z = mast.z - dist * Math.cos(rad);
  build(x, z);
}

export function buildDock(scene, cfg) {
  const group = new THREE.Group();
  group.name = 'dock';
  group.visible = false;
  scene.add(group);

  const fogColor = (cfg.dawn && cfg.dawn.fogColor) || PLATE_PAPER;
  const fog = new THREE.FogExp2(fogColor, (cfg.dawn && cfg.dawn.fog && cfg.dawn.fog.arrive) || 0.03);
  const background = new THREE.Color(fogColor);

  // art critique B1: the fill dropped about a stop so the lanterns (below), not the sky, carry the light.
  group.add(new THREE.HemisphereLight(0xcfd0c8, 0x14110f, 0.4 * Math.PI));
  // art critique B10/C10: a low, long key (about 11 degrees of elevation from the bow's quarter),
  // handed the one shadow budget once signed on (updateShadowCaster below).
  const low = new THREE.DirectionalLight(0xe8dfc0, 0.5 * Math.PI);
  low.position.set(-42, 8, 18);
  low.target.position.set(9, DECK_Y, -15);
  group.add(low);
  group.add(low.target);
  low.shadow.mapSize.set(1024, 1024);
  Object.assign(low.shadow.camera, { left: -26, right: 26, top: 20, bottom: -26, near: 1, far: 90 });

  // art critique B1: five amber pool lights at named flame sites (dockmap.js PLACES), the gangway's
  // own the shadow spot before signing on (Decisions, Numbers: "Light").
  const gangwayLantern = lantern(group, PLACES.gangwayFoot.x, 3.4, PLACES.gangwayFoot.z, { intensity: 1.6, range: 9, castShadow: true });
  lantern(group, PLACES.tavernDoor.x, 2.8, PLACES.tavernDoor.z - 0.3, { intensity: 1.4, range: 7 });
  lantern(group, 0, 3.2, -18, { intensity: 1.5, range: 9 });
  lantern(group, PLACES.chandlerWindow.x, 2.6, PLACES.chandlerWindow.z, { intensity: 1.2, range: 6 });
  lantern(group, 0, 3.0, 10, { intensity: 1.3, range: 8 });

  // P2: Verne's other shop-window piece (R25, the hybrid ledger's own 'helmet' row) - a brass
  // diving helmet resting on the chandler's sill (dockmap.js's 'chandlerSill' box), alongside
  // the lantern above and the sill's own geometry (the dockProps loop below).
  const helmetMat = new THREE.MeshStandardMaterial({ color: VERNE_BRASS, roughness: 0.45, metalness: 0.65 });
  const chandlerSill = dockProps().find((p) => p.kind === 'chandlerSill');
  group.add(box(new THREE.SphereGeometry(0.22, 10, 8), helmetMat, chandlerSill.x, chandlerSill.maxY + 0.22, chandlerSill.z));
  group.add(box(new THREE.CylinderGeometry(0.2, 0.24, 0.12, 10), helmetMat, chandlerSill.x, chandlerSill.maxY + 0.06, chandlerSill.z));

  // Ground: one plane per zone rect (quay+pier merged, the tavern its own - ZONES, dockmap.js).
  const groundMat = new THREE.MeshStandardMaterial({ color: TAR_BROWN, roughness: 0.9 });
  const tavernMat = new THREE.MeshStandardMaterial({ color: LAMP_BLACK, roughness: 0.85 });
  for (const zn of ZONES) {
    for (const r of zn.rects) {
      const m = box(new THREE.PlaneGeometry(r.maxX - r.minX, r.maxZ - r.minZ), zn.id === 'tavern' ? tavernMat : groundMat, (r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);
      m.rotation.x = -Math.PI / 2;
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // The under-pier stage, a floor below (dockmap.js UNDER_PIER: floor -2.4, the pier's own
  // planking the top over it - the castle's pit-under-bridge trick, reduced to two flat planes).
  const stageMat = new THREE.MeshStandardMaterial({ color: BOTTLE_GREEN, roughness: 0.6 });
  const stage = box(new THREE.PlaneGeometry(UNDER_PIER.rect.maxX - UNDER_PIER.rect.minX, UNDER_PIER.rect.maxZ - UNDER_PIER.rect.minZ), stageMat, (UNDER_PIER.rect.minX + UNDER_PIER.rect.maxX) / 2, UNDER_PIER.floor, (UNDER_PIER.rect.minZ + UNDER_PIER.rect.maxZ) / 2);
  stage.rotation.x = -Math.PI / 2;
  group.add(stage); // the pier's own planking stands at UNDER_PIER.top (0): the quay/pier zone plane above already draws it

  // art critique B6: the quay/pier plane above is single-sided, so its underside showed fog-grey
  // sky through the stage - an explicit underside plane closes it, and pile rows frame the view.
  const underCeilMat = new THREE.MeshStandardMaterial({ color: TAR_BROWN, roughness: 0.9 });
  const underCeil = box(new THREE.PlaneGeometry(UNDER_PIER.rect.maxX - UNDER_PIER.rect.minX, UNDER_PIER.rect.maxZ - UNDER_PIER.rect.minZ), underCeilMat, (UNDER_PIER.rect.minX + UNDER_PIER.rect.maxX) / 2, UNDER_PIER.top - 0.05, (UNDER_PIER.rect.minZ + UNDER_PIER.rect.maxZ) / 2);
  underCeil.rotation.x = Math.PI / 2; // facing down
  group.add(underCeil);
  const pileMat = new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.95 });
  for (let z = UNDER_PIER.rect.minZ + 1.5; z < UNDER_PIER.rect.maxZ - 1; z += 2.5) {
    for (const x of [UNDER_PIER.rect.minX + 0.3, UNDER_PIER.rect.maxX - 0.3]) {
      const pile = box(new THREE.CylinderGeometry(0.18, 0.2, UNDER_PIER.top - UNDER_PIER.floor, 8), pileMat, x, (UNDER_PIER.top + UNDER_PIER.floor) / 2, z);
      group.add(pile);
    }
  }
  const scareLight = new THREE.PointLight(OIL_AMBER, 0.6 * Math.PI, 6, 2);
  scareLight.position.set(-1, UNDER_PIER.floor + 1.6, -18);
  group.add(scareLight);
  // R6 item 5: the piles (every 2.5 m) left gaps wide enough for the fog's own bright colour to
  // show through from any angle, and the corridor's two open ends showed it outright. Four flat,
  // unlit (fog-dark, not fog-coloured) backdrop planes just outside the stage's footprint close
  // every one of those gaps cheaply - no light cost, nothing moved, the piles untouched.
  const backdropMat = new THREE.MeshBasicMaterial({ color: 0x100b08, side: THREE.DoubleSide });
  const underH = UNDER_PIER.top - UNDER_PIER.floor;
  const underMidY = (UNDER_PIER.top + UNDER_PIER.floor) / 2;
  const underCenterX = (UNDER_PIER.rect.minX + UNDER_PIER.rect.maxX) / 2;
  const underCenterZ = (UNDER_PIER.rect.minZ + UNDER_PIER.rect.maxZ) / 2;
  const underW = UNDER_PIER.rect.maxX - UNDER_PIER.rect.minX;
  const underL = UNDER_PIER.rect.maxZ - UNDER_PIER.rect.minZ;
  for (const x of [UNDER_PIER.rect.minX - 0.15, UNDER_PIER.rect.maxX + 0.15]) {
    const side = box(new THREE.PlaneGeometry(underL, underH), backdropMat, x, underMidY, underCenterZ);
    side.rotation.y = Math.PI / 2;
    group.add(side);
  }
  for (const z of [UNDER_PIER.rect.minZ - 0.15, UNDER_PIER.rect.maxZ + 0.15]) group.add(box(new THREE.PlaneGeometry(underW, underH), backdropMat, underCenterX, underMidY, z));

  // The Pequod's deck (dockmap.js DECK: floor 0 at the waterline, top DECK_Y, the gangway's ramp
  // the one way up) - a raised plane, a box hull below it, and the gangway as a ramped box.
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x8c826e, roughness: 0.8 }); // art critique C6: held back from full whalebone so it stays grey and quiet
  const hullMat = new THREE.MeshStandardMaterial({ color: HULL_LIFT, roughness: 0.7, metalness: 0.2 });
  const railMat2 = new THREE.MeshStandardMaterial({ color: WHALEBONE, roughness: 0.7 });
  const deckPlane = box(new THREE.PlaneGeometry(DECK.rect.maxX - DECK.rect.minX, DECK.rect.maxZ - DECK.rect.minZ), deckMat, (DECK.rect.minX + DECK.rect.maxX) / 2, DECK_Y, (DECK.rect.minZ + DECK.rect.maxZ) / 2);
  deckPlane.rotation.x = -Math.PI / 2;
  deckPlane.receiveShadow = true;
  group.add(deckPlane);
  // art critique C6: the hull's top held 0.02 m below the deck plane - no longer coplanar (no z-fight), and the hull reads as a hull, not the deck's own underside.
  group.add(box(new THREE.BoxGeometry(DECK.rect.maxX - DECK.rect.minX, DECK_Y - 0.02, DECK.rect.maxZ - DECK.rect.minZ), hullMat, (DECK.rect.minX + DECK.rect.maxX) / 2, (DECK_Y - 0.02) / 2, (DECK.rect.minZ + DECK.rect.maxZ) / 2));
  // art critique B2: a whalebone rail strip along both long gunwales, so the hull silhouette reads as a ship.
  for (const x of [DECK.rect.minX + 0.08, DECK.rect.maxX - 0.08]) {
    group.add(box(new THREE.BoxGeometry(0.16, 0.22, DECK.rect.maxZ - DECK.rect.minZ), railMat2, x, DECK_Y + 0.11, (DECK.rect.minZ + DECK.rect.maxZ) / 2));
  }
  const ramp = box(new THREE.BoxGeometry(GANGWAY.rect.maxX - GANGWAY.rect.minX, 0.2, GANGWAY.rect.maxZ - GANGWAY.rect.minZ), deckMat, (GANGWAY.rect.minX + GANGWAY.rect.maxX) / 2, DECK_Y / 2, (GANGWAY.rect.minZ + GANGWAY.rect.maxZ) / 2);
  ramp.rotation.x = -0.45; // a visible rise toward the deck; the logic's own stair spec is the real slope
  group.add(ramp);
  // The mast: a simple pole, placed on the deck at its base (PLACES.mast).
  const mastMat = new THREE.MeshStandardMaterial({ color: TAR_BROWN, roughness: 0.85 });
  const mast = box(new THREE.CylinderGeometry(0.22, 0.3, 12, 8), mastMat, PLACES.mast.x, DECK_Y + 6, PLACES.mast.z);
  mast.castShadow = true;
  group.add(mast);

  // Walls and props from dockmap.js's own boxes - one flat-coloured mesh per box, by kind.
  const wallMat = new THREE.MeshStandardMaterial({ color: TAR_BROWN, roughness: 0.85 });
  const railMat = new THREE.MeshStandardMaterial({ color: WHALEBONE, roughness: 0.7 });
  for (const b of dockWalls()) group.add(fromAabb(b, b.kind === 'rail' ? railMat : wallMat));
  // art critique C7: brass held back for the tiller (the binnacle's own part of the hybrid ledger)
  // alone, so it still reads as an intrusion there; everything else is a lifted tar brown.
  const propMat = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.9 });
  const tillerMat = new THREE.MeshStandardMaterial({ color: VERNE_BRASS, roughness: 0.5, metalness: 0.6 });
  // art critique C3: the try-works box itself carries the flame's own warmth (its light is fixed below).
  const tryworksMat = new THREE.MeshStandardMaterial({ color: TAR_BROWN, emissive: OIL_AMBER, emissiveIntensity: 0.9, roughness: 0.7 });
  let tryworksMesh = null; // R6 item 2: hidden while the glass is up - it covers the telescope's lower third
  for (const b of dockProps()) {
    const onDeck = b.x >= DECK.rect.minX && b.x <= DECK.rect.maxX && b.z >= DECK.rect.minZ && b.z <= DECK.rect.maxZ;
    const mat = b.kind === 'tiller' ? tillerMat : b.kind === 'tryworks' ? tryworksMat : propMat;
    const mesh = fromAabb(b, mat, onDeck ? DECK_Y : 0);
    if (b.kind === 'tryworks') tryworksMesh = mesh;
    group.add(mesh);
  }

  // art critique C8: a lit door, two windows, a sign and a poster on the tavern facade, and a
  // lantern post at the gangway foot - wayfinding for two stations with no figure built this pass.
  const doorMat = new THREE.MeshStandardMaterial({ color: LAMP_BLACK, roughness: 0.8 });
  const windowMat = new THREE.MeshStandardMaterial({ color: OIL_AMBER, emissive: OIL_AMBER, emissiveIntensity: 1.2 });
  const signMat = new THREE.MeshStandardMaterial({ color: TAR_BROWN, roughness: 0.8 });
  // R6 item 4 (C2): double-sided - the three lay tickets below are flat planes with no rotation
  // (local normal +Z), so from the bar's front (the player stands at lower z, looking toward +z)
  // a single-sided material showed their backface and culled them to nothing.
  const posterMat = new THREE.MeshStandardMaterial({ color: PLATE_PAPER, roughness: 0.6, side: THREE.DoubleSide });
  const tavernFrontX = TAVERN_DOOR.rect.minX - 0.05;
  group.add(box(new THREE.BoxGeometry(0.1, 2.2, 1.2), doorMat, tavernFrontX, 1.1, (TAVERN_DOOR.rect.minZ + TAVERN_DOOR.rect.maxZ) / 2));
  for (const dz of [-2.4, 2.4]) group.add(box(new THREE.BoxGeometry(0.08, 1.0, 0.8), windowMat, tavernFrontX, 2.0, (TAVERN_DOOR.rect.minZ + TAVERN_DOOR.rect.maxZ) / 2 + dz));
  group.add(box(new THREE.BoxGeometry(0.15, 0.6, 1.0), signMat, tavernFrontX - 0.3, 3.0, (TAVERN_DOOR.rect.minZ + TAVERN_DOOR.rect.maxZ) / 2));
  group.add(box(new THREE.BoxGeometry(0.05, 0.9, 0.6), posterMat, tavernFrontX + 0.06, 1.4, PLACES.posterWall.z));
  const lampPostMat = new THREE.MeshStandardMaterial({ color: LAMP_BLACK, roughness: 0.8 });
  group.add(box(new THREE.BoxGeometry(0.12, 3.0, 0.12), lampPostMat, PLACES.gangwayFoot.x + 1.2, 1.5, PLACES.gangwayFoot.z + 0.6));

  // art critique C1, C2: a ceiling, three lamps and a built bar/spike for the tavern, so the
  // second proof (R6, the lay ticket) is legible and the room reads as a lit interior, not an
  // open, roofless box under the dock's own fog sky.
  const tavernRect = ZONES.find((z) => z.id === 'tavern').rects[0];
  const ceilingMat = new THREE.MeshStandardMaterial({ color: TAR_BROWN, roughness: 0.9 });
  const ceiling = box(new THREE.PlaneGeometry(tavernRect.maxX - tavernRect.minX, tavernRect.maxZ - tavernRect.minZ), ceilingMat, (tavernRect.minX + tavernRect.maxX) / 2, 3.2, (tavernRect.minZ + tavernRect.maxZ) / 2);
  ceiling.rotation.x = Math.PI / 2;
  group.add(ceiling);
  lantern(group, -24, 1.3, -1, { intensity: 1.3, range: 6 }); // the hearth
  lantern(group, PLACES.layTicketSpike.x, 2.0, PLACES.layTicketSpike.z, { intensity: 1.1, range: 6 }); // the bar
  lantern(group, -18, 2.0, 5, { intensity: 0.9, range: 5 }); // a table
  const hearthMat = new THREE.MeshStandardMaterial({ color: TAR_BROWN, emissive: OIL_AMBER, emissiveIntensity: 0.8 });
  group.add(box(new THREE.BoxGeometry(0.4, 1.0, 1.6), hearthMat, -24.2, 0.5, -1));
  const barMat = new THREE.MeshStandardMaterial({ color: TAR_BROWN, roughness: 0.85 });
  group.add(box(new THREE.BoxGeometry(3, 1.05, 0.6), barMat, PLACES.layTicketSpike.x, 0.52, PLACES.layTicketSpike.z + 0.6));
  group.add(box(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), tillerMat, PLACES.layTicketSpike.x, 1.25, PLACES.layTicketSpike.z));
  // sea-1-dock-art C2: ticket proportions and ink (UI direction, "Lay tickets") - 0.16 x 0.26 m,
  // ink in lamp-black (ruled double border, the approved text, a script line, a punched hole),
  // skewed a few degrees each way on the spike, at the design's own LAY_SPOTS (dockmap.js), in
  // place of the three oversized blank grey slabs the critique found.
  LAY_SPOTS.forEach((spot, i) => {
    const tex = ticketTexture(spot.key, 1000 + i);
    const ticketMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide });
    const ticket = box(new THREE.PlaneGeometry(0.16, 0.26), ticketMat, spot.x, 1.3, spot.z - 0.03);
    ticket.rotation.z = ((i - 1) * 3 * Math.PI) / 180; // skewed a few degrees each way
    group.add(ticket);
  });
  const jawMat = new THREE.MeshStandardMaterial({ color: WHALEBONE, roughness: 0.7 });
  for (const dx of [-1.6, 1.6]) group.add(box(new THREE.BoxGeometry(0.2, 2.4, 0.2), jawMat, PLACES.layTicketSpike.x + dx, 1.2, PLACES.layTicketSpike.z + 0.6));

  // art critique C4: two landmarks at the coin's own bearings (cfg.glass.marks), so the sightline
  // puzzle has something to sight even without the telescope mask. The try-works (built above,
  // PLACES.tryworks) already stands at bearing 0 - the flame mark - unchanged.
  const marks = cfg.glass && cfg.glass.marks;
  const lighthouseMat = new THREE.MeshStandardMaterial({ color: PLATE_PAPER, roughness: 0.6 });
  const lighthouseTop = new THREE.MeshStandardMaterial({ color: OIL_AMBER, emissive: OIL_AMBER, emissiveIntensity: 1.5 });
  const churchMat = new THREE.MeshStandardMaterial({ color: TAR_BROWN, roughness: 0.8 });
  const vaneMat = new THREE.MeshStandardMaterial({ color: VERNE_BRASS, roughness: 0.5, metalness: 0.6 });
  if (marks) {
    landmark(group, PLACES.mast, marks.tower.az, 90, (x, z) => {
      group.add(box(new THREE.CylinderGeometry(1.2, 1.6, 16, 10), lighthouseMat, x, DECK_Y + 8, z));
      group.add(box(new THREE.ConeGeometry(1.4, 1.5, 10), lighthouseTop, x, DECK_Y + 16.75, z));
    });
    landmark(group, PLACES.mast, marks.cock.az, 80, (x, z) => {
      group.add(box(new THREE.BoxGeometry(3, 14, 3), churchMat, x, DECK_Y + 7, z));
      group.add(box(new THREE.BoxGeometry(0.8, 0.12, 0.12), vaneMat, x, DECK_Y + 14.8, z));
    });
  }

  // Water: flat bottle-green planes (WATER rects, dockmap.js) - no shader, no reflection.
  const waterMat = new THREE.MeshStandardMaterial({ color: BOTTLE_GREEN, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85 });
  for (const r of WATER) {
    const m = box(new THREE.PlaneGeometry(r.maxX - r.minX, r.maxZ - r.minZ), waterMat, (r.minX + r.maxX) / 2, -0.05, (r.minZ + r.maxZ) / 2);
    m.rotation.x = -Math.PI / 2;
    group.add(m);
  }
  // art critique B9: the real water rects stop well short of the fog's own reach, so their far
  // edge showed sky beneath it. One big backdrop plane, visual only (WATER's own rects, used by
  // inWater, are untouched), well past where fog hides it.
  const backdropWaterMat = new THREE.MeshStandardMaterial({ color: BOTTLE_GREEN, roughness: 0.2, metalness: 0.1 });
  const backdropWater = box(new THREE.PlaneGeometry(1200, 1200), backdropWaterMat, 0, -0.08, -300);
  backdropWater.rotation.x = -Math.PI / 2;
  group.add(backdropWater);

  // The telescope collar and the try-works' own flame glow (R9), and (P3) the binnacle's other
  // two named instruments (R19): a compass face set into its top, and a depth-gauge dial on its
  // forward face, both brass-trimmed, alongside the existing tiller box and electric lamp.
  // art critique C3: the flame light moved up onto the deck (it was 1.9 m under it, inside the
  // hull) and recoloured to oil amber, so it actually lights the deck and reads as a mark aloft.
  const flame = new THREE.PointLight(OIL_AMBER, 1.2 * Math.PI, 12, 2);
  flame.position.set(PLACES.tryworks.x, DECK_Y + 1.3, PLACES.tryworks.z);
  group.add(flame);
  const binnacleGlow = new THREE.PointLight(ARC_WHITE, 0.5 * Math.PI, 6, 2);
  binnacleGlow.position.set(PLACES.tiller.x, DECK_Y + 1.1, PLACES.tiller.z);
  group.add(binnacleGlow);
  const tillerBox = dockProps().find((p) => p.kind === 'tiller');
  const tillerTop = DECK_Y + tillerBox.maxY;
  const compassFaceMat = new THREE.MeshStandardMaterial({ color: PLATE_PAPER, roughness: 0.5 });
  group.add(box(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 16), tillerMat, tillerBox.x, tillerTop + 0.02, tillerBox.z)); // the compass's brass rim, set into the binnacle's top
  group.add(box(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 16), compassFaceMat, tillerBox.x, tillerTop + 0.05, tillerBox.z)); // the compass's own pale face
  const gaugeFaceMat = new THREE.MeshStandardMaterial({ color: ARC_WHITE, emissive: ARC_WHITE, emissiveIntensity: 0.3, roughness: 0.4 });
  const gaugeRim = box(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 12), tillerMat, tillerBox.x, tillerTop - 0.35, tillerBox.maxZ + 0.03);
  gaugeRim.rotation.x = Math.PI / 2; // the depth gauge's brass rim, on the binnacle's forward (player-facing) side
  group.add(gaugeRim);
  const gaugeFace = box(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 12), gaugeFaceMat, tillerBox.x, tillerTop - 0.35, tillerBox.maxZ + 0.055);
  gaugeFace.rotation.x = Math.PI / 2; // the depth gauge's own dial face
  group.add(gaugeFace);

  // art critique B7 (cheap stand-in, not the full-fidelity creature, owner R5 Q3a): a plain
  // lamp-black spindle that rises, rolls and holds, then sinks, under an arc-white light, timed
  // off sim.waves.scare exactly as the design's surfaceTime - not a shock built with no subject.
  const scareMat = new THREE.MeshStandardMaterial({ color: LAMP_BLACK, roughness: 0.4, metalness: 0.3 });
  const scareBody = box(new THREE.CapsuleGeometry(0.55, 6, 4, 8), scareMat, PLACES.burstSpot.x, -3, PLACES.burstSpot.z);
  scareBody.rotation.z = Math.PI / 2;
  scareBody.visible = false;
  group.add(scareBody);
  const scareGlow = new THREE.PointLight(ARC_WHITE, 0, 8, 2);
  scareGlow.position.set(PLACES.burstSpot.x, -1.2, PLACES.burstSpot.z);
  group.add(scareGlow);

  // art critique B8, B9: everything the harbour owns (the quay, the wharf street, the tavern, the
  // pier and its rails, the wayfinding lights, the water) is not yet attached directly to `group`
  // above for these three things - reparent them under one node so cast-off can slide the harbour
  // away from the still, level ship without moving the ship itself. Collected by object identity,
  // not rebuilt, so nothing above needs to know about this.
  const shipLocal = new Set([deckPlane, ramp, mast]);
  const harbour = new THREE.Group();
  harbour.name = 'dock:harbour';
  group.add(harbour);
  for (const child of [...group.children]) {
    if (child === harbour || child.isLight || child.userData.fixed || shipLocal.has(child)) continue;
    if (child.position.z <= DECK.rect.minZ - 0.5 || (child.position.x < DECK.rect.minX - 0.5)) { harbour.add(child); }
  }

  function apply(renderer) {
    group.visible = true;
    scene.fog = fog;
    scene.background = background;
    renderer.setClearColor(fogColor);
    renderer.shadowMap.enabled = true; // art critique C10: one shadow light (the gangway lantern, then the low sun)
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  function hide() { group.visible = false; harbour.position.set(0, 0, 0); scareBody.visible = false; scareGlow.intensity = 0; }

  const CASTOFF_RAMP_S = 1.5; // eases 0 to CASTOFF_SPEED over this long, then holds
  const CASTOFF_SPEED = 0.6; // m/s, the design's own castOff.shipSpeed (dockconfig.js)
  let reducedFlash = false;

  // The fog thins and the sky lightens as dawn.js's clock advances (sim.waves.dawn, 0 to 1), read
  // through dawn.js's own skyOf(k, cfg) - the piecewise-linear fog density across all four
  // breakpoints (arrive/signedOn/nailed/castOff), not a cruder two-point blend - plus the low
  // sun's colour and strength easing toward cfg.dawn.firstSun.
  function update(sim) {
    if (!sim || !sim.waves || typeof sim.waves.dawn !== 'number') return;
    const { fogDensity, sky } = skyOf(sim.waves.dawn, cfg);
    fog.density = fogDensity;
    // art critique C5: fog and background used to lerp toward first-sun too, flooding the whole
    // sky amber before the coin's own beat and leaving nothing for it to catch. They now hold at
    // the one fog-grey value throughout (dawn.js's own doc comment); only the low key warms.
    low.color.setHex(sky.color);
    low.intensity = sky.strength * 0.5 * Math.PI;

    // R6 item 2: the orange try-works box sat 7 m ahead on the flame bearing (az 0), right where
    // the telescope looks by default - close enough, at the glass's narrow 30 deg fov, to cover
    // the lower third of the view. Hidden only while the glass is actually up.
    if (tryworksMesh) tryworksMesh.visible = !(sim.waves.glass && sim.waves.glass.up);

    // art critique C10/B10: the one shadow light is the gangway lantern before signing on, the
    // low sun after - never both, and never neither while there is light to cast one from.
    const signedOn = sim.waves.stage >= 2;
    gangwayLantern.castShadow = !signedOn;
    low.castShadow = signedOn;

    // art critique B7: the scare's cheap stand-in, timed off sim.waves.scare exactly (the
    // design's 1.0 s delay then 1.6 s on the surface), not a fixed animation of its own.
    const sc = sim.waves.scare;
    const surfaceTime = (cfg.scare && cfg.scare.surfaceTime) || 1.6;
    if (sc && sc.armed && !sc.played && sc.surfaceT > 0) {
      const t = Math.max(0, Math.min(surfaceTime, surfaceTime - sc.surfaceT));
      const riseEnd = 0.3; const rollEnd = surfaceTime - 0.3;
      let y; let roll;
      if (t < riseEnd) { y = -3 + (3 - 1.7) * (t / riseEnd); roll = 0; }
      else if (t < rollEnd) { y = -1.7; roll = ((t - riseEnd) / Math.max(0.001, rollEnd - riseEnd)) * (20 * Math.PI / 180); }
      else { const u = (t - rollEnd) / Math.max(0.001, surfaceTime - rollEnd); y = -1.7 - (3 - 1.7) * u; roll = 20 * Math.PI / 180; }
      // P5: the burst's x/z were placed off the warden at arming time (dock.js's stepScare), not dockmap.js's fixed burstSpot.
      scareBody.position.x = sc.x;
      scareBody.position.z = sc.z;
      scareGlow.position.x = sc.x;
      scareGlow.position.z = sc.z;
      scareBody.visible = true;
      scareBody.position.y = y;
      scareBody.rotation.x = roll;
      // Security A1/A2/A3 (architect review, 2026-11-24): the peak and its ramp are no longer a
      // literal here - dockart.js's glowAt is the one place either flash's peak is read from.
      scareGlow.intensity = glowAt('scare', t, reducedFlash) * Math.PI;
    } else {
      scareBody.visible = false;
      scareGlow.intensity = 0;
    }

    // art critique B8, B9: the harbour slides away from the still, level ship through the
    // cast-off scene - the design's own 0.6 m/s (dockconfig.js castOff.shipSpeed), eased in over
    // 1.5 s, so "the wharf slides away" actually happens (it read as 0 m/s before this fix). Keyed
    // off the scene's own clock (sim.waves.scene.t), not a counter of this function's own: a held
    // or skipped scene still shows the right distance for its t.
    const scene_ = sim.waves.scene;
    if (scene_ && scene_.kind === 'castoff') {
      const t = scene_.t || 0;
      const dist = t < CASTOFF_RAMP_S
        ? (CASTOFF_SPEED / (2 * CASTOFF_RAMP_S)) * t * t
        : (CASTOFF_SPEED / (2 * CASTOFF_RAMP_S)) * CASTOFF_RAMP_S * CASTOFF_RAMP_S + CASTOFF_SPEED * (t - CASTOFF_RAMP_S);
      harbour.position.z = -dist;
    } else if (sim.waves.stage < 4) {
      harbour.position.z = 0; // a fresh run, or before cast-off starts: the harbour is home
    }
  }
  function setReducedFlash(v) { reducedFlash = !!v; }

  return { group, apply, hide, update, setReducedFlash };
}
