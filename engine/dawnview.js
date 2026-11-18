// The view out of the Count's windows at dawn (art pass K1, K12; owner Q9: "when the player looks
// out the window they should see a golden sunrise and sunrise lit landscape and some of the
// castle from the upper window's perspective"). The room itself keeps its gold shafts and cast;
// this is only what lies beyond the glass.
//
// One mesh, one draw call: the land falling away from the castle's rise into a misted valley
// with a river, rolling up to ridges that pale into the haze toward the sun; and, below and
// beside the windows, a slate-roofed wing, a stretch of curtain wall with its battlements and two
// towers, all seen from above. Everything is baked into vertex colours from one sun (DAWN_SUN, low
// in the east-south-east, the same sun castle.js's sky draws), so nothing here takes the room's
// lights or fog, and the light count never changes. The colours scale with the dawn (setLevel):
// at 0 the land is a night silhouette; a curtain opened lets in its share.
//
// Pure geometry and arithmetic from fixed seeds: the same land every run.

import * as THREE from 'three';
import * as S from './sculpt.js';

/** The rising sun's direction (unit), low over the eastern horizon: about 5 degrees up, 8 south of east (in the middle window). */
export const DAWN_SUN = Object.freeze(new THREE.Vector3(0.988, 0.087, 0.139).normalize());

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

const SUNLIGHT = [1.0, 0.66, 0.3]; // what the low sun throws
const SKYGOLD = [0.5, 0.34, 0.18]; // the gold of the lit sky, on whatever faces up
const SKYLIGHT = [0.07, 0.085, 0.13]; // the cool fill from the rest of the sky
const HAZE = [1.0, 0.6, 0.27]; // the air toward the sun, and the valley's mist
const NIGHT = new THREE.Color(0.03, 0.035, 0.055);
const WHITE = new THREE.Color(1, 1, 1);

/**
 * The light on a surface at world point p with unit normal n, over its albedo a (r, g, b), as the
 * eye at `from` sees it: low gold sun with a soft wrap, the sky's cool fill, mist in the low
 * ground and haze with distance. Returns [r, g, b] in 0..1 (linear; drawn without tone mapping).
 */
export function dawnShade(a, n, p, from) {
  const sun = DAWN_SUN;
  const lam = clamp((n.x * sun.x + n.y * sun.y + n.z * sun.z + 0.3) / 1.3);
  const up = clamp(n.y * 0.5 + 0.5);
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) c[i] = a[i] * (SUNLIGHT[i] * 1.5 * lam + SKYGOLD[i] * up * up + SKYLIGHT[i] * (0.6 + 0.6 * up));
  const d = Math.hypot(p.x - from.x, p.z - from.z);
  const mist = smooth(-12, -27, p.y) * smooth(20, 45, d) * 0.45; // the valley's mist, gold where the sun gets in
  const haze = 1 - Math.exp(-d / 230); // aerial perspective: the far land pales toward the sun's haze
  const toward = clamp(((p.x - from.x) * sun.x + (p.z - from.z) * sun.z) / (d || 1)); // brighter haze toward the sun
  const hz = 0.72 + 0.28 * toward * toward;
  for (let i = 0; i < 3; i++) {
    c[i] = lerp(c[i], HAZE[i] * 0.8, mist);
    c[i] = lerp(c[i], HAZE[i] * hz, haze * 0.8);
  }
  return c.map((v) => clamp(v));
}

/** The land's height (m) at distance d from the castle's east face and bearing az (radians off due east). */
export function landAt(d, az) {
  const x = d * Math.cos(az); const z = d * Math.sin(az);
  const crag = lerp(-1.5, -27, smooth(9, 42, d)); // the castle's rise falls away into the valley
  const climb = 25 * smooth(70, 190, d); // and the far side climbs toward the ridges
  const roll = 6.5 * S.noise(x * 0.022, 0.5, z * 0.022, 3) * smooth(40, 80, d) + 2.2 * S.noise(x * 0.07, 1.5, z * 0.07, 5) * smooth(30, 60, d);
  const ridge = 6 * Math.max(0, Math.sin(az * 4.2 + 1.1)) * smooth(140, 185, d) + 4 * Math.max(0, Math.sin(az * 7.3 - 0.4)) * smooth(110, 150, d);
  return Math.min(crag + climb + roll + ridge, 2.5);
}

/** The river's bearing at distance d (it winds down the valley); null where there is none. */
function riverAz(d) {
  if (d < 34 || d > 150) return null;
  return 0.32 * Math.sin(d * 0.032 + 0.6) - 0.12;
}

/**
 * buildDawnView({ x, y, z }) -> { mesh, setLevel(k), dispose() }. (x, z): the middle of the
 * Count's east wall's outer face; y: the room's floor. Faces east (+x).
 */
export function buildDawnView(at) {
  const from = new THREE.Vector3(at.x - 1.5, at.y + 1.65, at.z); // the eye the light is baked for
  const parts = [];
  const nv = new THREE.Vector3(); const pv = new THREE.Vector3();
  const bake = (g, albedo, vary = 0.1, seed = 1) => {
    if (g.index) g = g.toNonIndexed();
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    const p = g.attributes.position; const n = g.attributes.normal;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      pv.set(p.getX(i), p.getY(i), p.getZ(i)); nv.set(n.getX(i), n.getY(i), n.getZ(i));
      const k = 1 + vary * S.noise(pv.x * 0.9, pv.y * 0.9, pv.z * 0.9, seed);
      const a = typeof albedo === 'function' ? albedo(pv, nv) : albedo;
      const c = dawnShade([a[0] * k, a[1] * k, a[2] * k], nv, pv, from);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
    return g;
  };

  // ---- the land: a fan of rings out from the castle's east face, out to 190 m ----
  const NR = 64; const NA = 72; const AZ = 1.45;
  const ox = at.x + 0.5; const oz = at.z;
  const pos = new Float32Array(NR * NA * 3); const idx = [];
  for (let r = 0; r < NR; r++) {
    const d = 7 + 183 * (r / (NR - 1)) ** 1.35;
    for (let a = 0; a < NA; a++) {
      const az = -AZ + (2 * AZ * a) / (NA - 1);
      const k = (r * NA + a) * 3;
      pos[k] = ox + d * Math.cos(az); pos[k + 1] = at.y - 5 + landAt(d, az); pos[k + 2] = oz + d * Math.sin(az);
      if (r < NR - 1 && a < NA - 1) { const i = r * NA + a; idx.push(i, i + 1, i + NA, i + 1, i + NA + 1, i + NA); }
    }
  }
  const land = new THREE.BufferGeometry();
  land.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  land.setIndex(idx);
  bake(land, (p, n) => {
    const d = Math.hypot(p.x - ox, p.z - oz); const az = Math.atan2(p.z - oz, p.x - ox);
    const ra = riverAz(d);
    if (ra !== null && Math.abs(az - ra) * d < 1.6 + d * 0.012 && p.y < at.y - 22) return [1.25, 0.95, 0.62]; // the river, the sunrise in it
    const field = S.noise(p.x * 0.06, 0, p.z * 0.06, 9);
    const wood = S.noise(p.x * 0.035, 3, p.z * 0.035, 11) > 0.25;
    const steep = 1 - n.y;
    if (steep > 0.35) return [0.3, 0.26, 0.21]; // bare rock on the crag
    if (wood) return [0.12, 0.14, 0.08];
    return field > 0 ? [0.34, 0.31, 0.15] : [0.26, 0.29, 0.13]; // stubble and late grass, in strips
  }, 0.08, 4);

  // ---- the castle below and beside the windows, seen from above ----
  const STONE = [0.42, 0.42, 0.43]; const SLATE = [0.14, 0.15, 0.18];
  const box = (x0, x1, y0, y1, z0, z1, a, seed) => bake(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), a, 0.12, seed);
  const Y = at.y; const X = at.x + 0.5; const Z = at.z;
  // a wing under the windows: walls, and a hipped slate roof whose ridge runs out to the east
  box(X, X + 15, Y - 11, Y - 4.4, Z - 6, Z + 4, STONE, 2);
  {
    const r0 = X; const r1 = X + 15.3; const ey = Y - 4.4; const ry = Y - 1.6; const za = Z - 6.3; const zb = Z + 4.3; const zm = (za + zb) / 2;
    const h1 = r1 - (zb - za) / 2; // the hip's foot of ridge
    const v = [
      r0, ey, za, h1, ry, zm, r0, ry, zm, r0, ey, za, r1, ey, za, h1, ry, zm, // the north slope
      r0, ry, zm, h1, ry, zm, r0, ey, zb, h1, ry, zm, r1, ey, zb, r0, ey, zb, // the south slope
      r1, ey, za, r1, ey, zb, h1, ry, zm, // the hip, to the sun
    ];
    const roof = new THREE.BufferGeometry();
    roof.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    bake(roof, SLATE, 0.15, 3);
  }
  // the curtain wall: out from the house to the south-east tower, battlements along it
  const wallTop = Y - 2.2;
  const wx0 = X; const wz0 = Z + 7; const wx1 = X + 44.5; const wz1 = Z + 16.5;
  {
    const len = Math.hypot(wx1 - wx0, wz1 - wz0); const ang = Math.atan2(wz1 - wz0, wx1 - wx0);
    const g = new THREE.BoxGeometry(len, wallTop - (Y - 14), 1.6).translate(len / 2, (wallTop + Y - 14) / 2, 0);
    const merl = [];
    for (let s = 0.6; s < len - 0.6; s += 1.8) merl.push(new THREE.BoxGeometry(0.9, 0.9, 0.4).translate(s, wallTop + 0.45, 0.6));
    const all = [g, ...merl].map((q) => q.rotateY(-ang).translate(wx0, 0, wz0));
    for (const q of all) bake(q, STONE, 0.12, 6);
  }
  const tower = (x, z, r, y0, y1, roofH, seed) => {
    bake(new THREE.CylinderGeometry(r, r * 1.06, y1 - y0, 18, 1, true).translate(x, (y0 + y1) / 2, z), STONE, 0.1, seed);
    bake(new THREE.CylinderGeometry(r * 1.14, r * 1.14, 1.2, 18, 1, false).translate(x, y1 + 0.6, z), STONE, 0.08, seed + 1);
    bake(new THREE.ConeGeometry(r * 1.18, roofH, 18).translate(x, y1 + 1.2 + roofH / 2, z), SLATE, 0.1, seed + 2);
    for (const [hy, a] of [[0.45, 2.6], [0.7, 3.4]]) bake(new THREE.BoxGeometry(0.3, 1.4, 0.7).translate(x + Math.cos(a) * r * 1.01, lerp(y0, y1, hy), z + Math.sin(a) * r * 1.01), [0.03, 0.03, 0.04], 0, 1); // dark slits
  };
  tower(wx1 + 1.5, wz1 + 0.5, 3.2, Y - 14, Y + 4.5, 7, 20); // the south-east tower at the wall's end, in the middle window
  tower(X + 11, Z - 22, 3.6, Y - 12, Y + 10, 9, 30); // the north tower, seen past the north window
  box(X, X + 7, Y - 12, Y + 3, Z - 26, Z - 14, STONE, 40); // the house's north range, running out to it
  // a stretch of the outer wall far below, along the edge of the rise
  for (let i = 0; i < 9; i++) {
    const a0 = -0.9 + i * 0.22; const d = 26;
    const x = ox + d * Math.cos(a0); const z = oz + d * Math.sin(a0);
    bake(new THREE.BoxGeometry(1.2, 4.5, 6.2).rotateY(-a0).translate(x, Y - 5 + landAt(d, a0) + 1.6, z), STONE, 0.12, 50 + i);
  }

  const geo = S.merge(parts);
  for (const g of parts) g.dispose();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'castle:dawnView';
  mesh.frustumCulled = false; // it is the whole world east of the room; drawn only with the room
  const _c = new THREE.Color();
  return {
    mesh,
    /** k 0..1: the dawn's level (castle.js dawnLevel). At 0 the land is a night silhouette. */
    setLevel(k) { mat.color.copy(_c.copy(NIGHT).lerp(WHITE, clamp(k))); },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
