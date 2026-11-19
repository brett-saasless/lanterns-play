// Every drawn solid thing stands in the collision list (the owner, 2026-11-18: "all solid things
// should be impassible"). The audit (tests/solids.test.js) walked into every floor-standing thing
// each level draws; these are the ones that were drawn but had no box. Each footprint here is the
// size the view draws it at (the file and line it was measured from are beside it) and its place
// is the table the view places it from; where the view placed a thing from its own literals (the
// tea room's chairs, the longcase clock), the view now reads the place from here.
//
// Castle: the tea room's ten chairs and the longcase clock, the gallery's pedestal, the board's
// brass-plate lectern, the crypt's kneeling nun and the March Hare (in the crypt only), the
// mirror room's figure-mirror and its five pieces of jumpy furniture (each where haunts.js has
// it now), the nursery's rocking horse, music-box table and two dust sheets, and the bridge's two
// mid-span piers (from the pit floor only). Rose Court: the four valves, the fallen coping stone
// by the fountain, the toppled pillar and its block by the south hedge, the arch's two piers, the
// throne canopy's four posts, the painter's stool; in the maze, the bat glade's three
// lantern crooks. Pure data and geometry: no DOM, no randomness.

import { aabb } from './courtmap.js';
import { COURT, MAZE } from './courtmap.js';
import {
  TEA, CLOCKS, ZONES, GALLERY_PROPS, BOARD, CRYPT_PROPS, NURSERY, FURNITURE, MIRROR_ROOM, PIT,
} from './keepmap.js';

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};

/**
 * Footprints (metres): w across (local x), d deep (local z), dz the footprint's middle off the
 * place along local z, h tall. r: round things, as a square of side 2r.
 */
export const PROP_FOOT = f({
  chair: { w: 0.47, d: 0.48, dz: 0.005, h: 1.35 }, // keepprops.js chair(): legs at ±0.2, the seat 0.47, the back at z 0.2..0.245
  cabinet: { w: 1.22, d: 0.62, h: 1.42 }, // keepprops.js cabinet(false): 1.1 wide, 0.52 deep, the cornice 0.12 / 0.1 over
  wardrobe: { w: 1.37, d: 0.62, h: 2.22 }, // keepprops.js cabinet(true): 1.25 wide
  settle: { w: 1.55, d: 0.54, h: 1.52 }, // keepprops.js settle(): 1.5 seat, arms at ±0.75, back and front rail
  longcase: { w: 0.66, d: 0.42, h: 2.33 }, // keepprops.js: hood 0.66 x 0.42
  pedestal: { r: 0.25, h: 1.0 }, // keepprops.js: the lathe's foot 0.25
  lectern: { w: 1.0, d: 0.62, dz: 0.1, h: 0.6 }, // keepprops.js: plinth 1.0 x 0.6, top 0.62 deep, 0.1 behind the plate
  hare: { r: 0.3, h: 1.3 },
  horse: { w: 0.48, d: 1.46, h: 1.3 }, // keepprops.js: runners at ±0.2 (feet ±0.24), their arc ±0.73
  musicTable: { r: 0.3, h: 0.7 }, // keepprops.js: the top r 0.3
  sheetA: { w: 1.1, d: 0.77, h: 1.25 }, // keepprops.js sheeted(1.0, 1.25, 0.7): the skirt reaches 1.2 x w and d at the floor
  sheetB: { w: 1.65, d: 0.88, h: 0.85 }, // sheeted(1.5, 0.85, 0.8)
  figureMirror: { w: 0.15, d: 1.46, h: 2.6 }, // castle.js: the frame 0.1 proud of the west wall at x 3.1
  valve: { r: 0.3, h: 1.1 }, // props.js: post r 0.09, the wheel r 0.345 on top
  coping: { w: 1.2, d: 0.7, h: 0.5 }, // court.js: G.box(1.2, 0.4, 0.7), turned 0.5
  pillar: { w: 3.4, d: 1.0, h: 0.86 }, // court.js: the toppled column, r 0.5, 3.4 long
  pillarBlock: { w: 1.2, d: 1.2, h: 0.5 }, // court.js: the block beside it
  archPier: { w: 1.15, d: 1.15, h: 5.2 }, // court.js: the arch's piers
  canopyPost: { r: 0.08, h: 4.3 }, // court.js: gilt posts r 0.07
  stool: { r: 0.22, h: 0.5 }, // court.js: the painter's stool, legs out to 0.2
  crook: { r: 0.08, h: 4.5 }, // forest.js: the bat lanterns' iron crooks, r 0.06
});

/** The AABB of a w x d footprint centred at (x, z) and turned yaw (three.js rotation.y), as a box. */
export function footBox(x, z, foot, yaw = 0, kind = 'prop', extra = {}) {
  if (foot.r) return { ...aabb(x - foot.r, x + foot.r, z - foot.r, z + foot.r, foot.h, kind), ...extra };
  const c = Math.abs(Math.cos(yaw)); const s = Math.abs(Math.sin(yaw));
  const hx = (c * foot.w + s * foot.d) / 2; const hz = (s * foot.w + c * foot.d) / 2;
  const dz = foot.dz || 0;
  const cx = x + Math.sin(yaw) * dz; const cz = z + Math.cos(yaw) * dz;
  return { ...aabb(cx - hx, cx + hx, cz - hz, cz + hz, foot.h, kind), ...extra };
}

// ---- the castle ----------------------------------------------------------------------------

/** The tea room's chairs, as keepprops.js places them: { id, x, z, yaw }. Eight laid places less the skeleton's, the foot, the ghost's, the skeleton's. */
export function teaChairs() {
  const T = TEA.table; const tx = (T.minX + T.maxX) / 2; const tw = T.maxX - T.minX;
  const out = [];
  for (let i = 0; i < 4; i++) {
    for (const sd of [-1, 1]) {
      const x = tx + sd * (tw / 2 - 0.42); const z = T.minZ + 1.1 + i * 1.9;
      const his = Math.hypot(x + sd * 0.72 - TEA.skeleton.x, z - TEA.skeleton.z) < 1.2; // his place has his own chair, drawn back
      if (!his) out.push({ id: `place${i}${sd > 0 ? 'e' : 'w'}`, x: x + sd * 0.5, z, yaw: sd > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
  }
  out.push({ id: 'foot', x: tx + 0.6, z: T.minZ - 0.25, yaw: Math.PI });
  out.push({ id: 'ghost', x: TEA.ghost.x, z: T.maxZ + 0.42, yaw: 0 });
  const watch = CLOCKS.find((c) => c.id === 'pocket');
  out.push({ id: 'skeleton', x: TEA.skeleton.x, z: TEA.skeleton.z, yaw: Math.atan2(TEA.skeleton.x - watch.x, TEA.skeleton.z - watch.z) });
  return out;
}

/** Where the longcase clock stands (keepprops.js draws it 0.3 m off the tea room's door wall). */
export function longcaseAt() {
  const room = ZONES.find((z) => z.id === 'tea').rects[0];
  const c = CLOCKS.find((k) => k.id === 'longcase');
  return { x: c.x, z: room.maxZ - 0.3 };
}

let CASTLE = null;
/** The castle's drawn solids that never move, on their floors (crypt-only ones apart: cryptSolids). */
export function castleSolids() {
  if (CASTLE) return CASTLE;
  const out = [];
  for (const c of teaChairs()) out.push(footBox(c.x, c.z, PROP_FOOT.chair, c.yaw, 'chair', { id: `tea-${c.id}` }));
  const lc = longcaseAt();
  out.push(footBox(lc.x, lc.z, PROP_FOOT.longcase, 0, 'clock', { id: 'longcase' }));
  // the gallery's floor, over the crypt: never a box below it (keep.js onGalleryFloor)
  out.push(footBox(GALLERY_PROPS.pedestal.x, GALLERY_PROPS.pedestal.z, PROP_FOOT.pedestal, 0, 'pedestal', { id: 'pedestal', floor: 'upper' }));
  out.push(footBox(BOARD.plate.x, BOARD.plate.z, PROP_FOOT.lectern, 0, 'lectern', { id: 'lectern' }));
  const fm = MIRROR_ROOM.figureMirror;
  const mirrorWall = ZONES.find((z) => z.id === 'mirror').rects[0].minX;
  out.push({ ...aabb(mirrorWall, mirrorWall + PROP_FOOT.figureMirror.w, fm.z - PROP_FOOT.figureMirror.d / 2, fm.z + PROP_FOOT.figureMirror.d / 2, PROP_FOOT.figureMirror.h, 'mirror'), id: 'figureMirror' });
  out.push(footBox(NURSERY.horse.x, NURSERY.horse.z, PROP_FOOT.horse, 0.6, 'horse', { id: 'horse' }));
  out.push(footBox(NURSERY.musicBox.x, NURSERY.musicBox.z, PROP_FOOT.musicTable, 0, 'table', { id: 'musicBox' }));
  NURSERY.sheets.forEach((s, i) => out.push(footBox(s.x, s.z, i === 0 ? PROP_FOOT.sheetA : PROP_FOOT.sheetB, i * 1.1 + 0.3, 'sheet', { id: `sheet${i}` })));
  CASTLE = f(out);
  return CASTLE;
}

let CRYPT_S = null;
/** In the crypt: the kneeling nun (keepcast.js: x -9.0..-7.87, z -60.36..-59.64) and the March Hare chained by the coffin. */
export function cryptSolids() {
  if (CRYPT_S) return CRYPT_S;
  const n = CRYPT_PROPS.nun;
  CRYPT_S = f([
    { ...aabb(n.x - 0.6, n.x + 0.53, n.z - 0.36, n.z + 0.36, 1.1, 'nun'), id: 'nun' },
    footBox(CRYPT_PROPS.hare.x, CRYPT_PROPS.hare.z, PROP_FOOT.hare, 0, 'hare', { id: 'hare' }),
  ]);
  return CRYPT_S;
}

let PIERS_S = null;
/** The bridge's two mid-span piers on the pit floor (castle.js: a third and two thirds along the deck, the footing 0.7 m wider than the deck plus its margin, 2.3 deep). */
export function pitPiers() {
  if (PIERS_S) return PIERS_S;
  const D = PIT.deck; const len = D.maxZ - D.minZ; const w = D.maxX - D.minX + 1.4;
  PIERS_S = f([1, 2].map((k) => {
    const z = D.minZ + (k * len) / 3;
    return { ...aabb(-w / 2, w / 2, z - 1.15, z + 1.15, 4, 'pier'), id: `midPier${k}` };
  }));
  return PIERS_S;
}

/** The mirror room's jumpy furniture where it stands now (haunts: sim.waves.haunts; place index furniture[i], 0 if none). */
export function furnitureBoxes(haunts) {
  return FURNITURE.map((fu, i) => {
    const k = (haunts && haunts.furniture && haunts.furniture[i]) || 0;
    const pl = fu.places[k] || fu.places[0];
    return footBox(pl.x, pl.z, PROP_FOOT[fu.kind], pl.yaw || 0, 'furniture', { id: fu.id });
  });
}

// ---- the Rose Court and its maze -------------------------------------------------------------

/** The painter's stool (court.js): [-0.85, -0.7] in the easel's own frame. */
export function stoolAt() {
  const E = COURT.easel; const lx = -0.85; const lz = -0.7;
  return { x: E.x + lx * Math.cos(E.yaw) + lz * Math.sin(E.yaw), z: E.z - lx * Math.sin(E.yaw) + lz * Math.cos(E.yaw) };
}

let COURT_S = null;
export function courtSolids() {
  if (COURT_S) return COURT_S;
  const out = [];
  for (const v of COURT.valves) out.push(footBox(v.x, v.z, PROP_FOOT.valve, 0, 'valve', { id: `valve${v.index}` }));
  const fo = COURT.fountain;
  out.push(footBox(fo.x + 3.9, fo.z + 2.4, PROP_FOOT.coping, 0.5, 'stone', { id: 'coping' }));
  out.push(footBox(16.4, 19.75, PROP_FOOT.pillar, 0.03, 'stone', { id: 'toppledPillar' }));
  out.push(footBox(14.3, 19.6, PROP_FOOT.pillarBlock, 0.4, 'stone', { id: 'pillarBlock' }));
  const A = COURT.arch; const pierX = A.width / 2 + 0.6;
  for (const s of [-1, 1]) out.push(footBox(A.x + s * pierX, A.z + 0.15, PROP_FOOT.archPier, 0, 'archPier', { id: `archPier${s < 0 ? 'W' : 'E'}` }));
  // the throne's canopy: its posts at (±2, ±1.6) in the throne's frame, turned a quarter
  const t = COURT.throne;
  for (const [lx, lz] of [[-2, -1.6], [2, -1.6], [-2, 1.6], [2, 1.6]]) out.push(footBox(t.x + lz, t.z - lx, PROP_FOOT.canopyPost, 0, 'post', { id: `canopy${lx}${lz}` }));
  const st = stoolAt();
  out.push(footBox(st.x, st.z, PROP_FOOT.stool, 0, 'stool', { id: 'stool' }));
  COURT_S = f(out);
  return COURT_S;
}

let MAZE_S = null;
export function mazeSolids() {
  if (MAZE_S) return MAZE_S;
  const out = [];
  // (the Rabbit's chair and the Caterpillar's toadstool are their creatures' seats: creatures collide with these boxes too, so a box would push each off its own seat; tests/solids.test.js EXEMPT)
  // (the band-1 stump and the band-3 log are not boxed: the stakes lie on them and E takes them where they lie; tests/solids.test.js EXEMPT)
  for (const [i, l] of MAZE.bat.lanterns.entries()) {
    const px = l.x + (l.x < MAZE.bat.home.x ? -1 : 1) * 0.9;
    out.push(footBox(px, l.z, PROP_FOOT.crook, 0, 'crook', { id: `crook${i}` }));
  }
  MAZE_S = f(out);
  return MAZE_S;
}
