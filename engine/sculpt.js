// The shared sculpting kit for organic bodies: lofted, noise-displaced skins with vertex colour,
// the oversized head with a posable face and its named defects, cloth, wounds and idle motion.
// Also: eyes that glow (eyeGlow), and three plants as plain geometry: a petalled flower head
// (flower), a forked fallen branch (branch), a dead leaf (fallenLeaf) and a toadstool (toadstool).
//
// Conventions: metres, Y up, a figure's front is -Z (as the cave's creatures), so +X is the
// figure's own right. Everything is deterministic for a given seed. No clocks: time is passed in.
//
// A whole small character (about 4,500 triangles, 7 draw calls):
//
//   import * as S from './sculpt.js';
//   const M = S.materials();
//   const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
//   const torso = new THREE.Mesh(S.skin([
//     { at: [0, 0.75, 0], r: [0.24, 0.2], color: 0x1b1b22 }, { at: [0, 1.1, 0], r: [0.3, 0.24] },
//     { at: [0, 1.5, 0], r: [0.27, 0.2] }, { at: [0, 1.72, 0], r: 0.1 },
//   ], { color: 0xb3121b, seed: 7, budget: 500 }), M.skin);
//   const hd = S.head({ size: 0.3, seed: 7, defects: ['eyeLow:L', 'smileWide'] });
//   hd.group.position.set(0, 1.72, 0);
//   const tabard = S.cloth({ width: 0.5, length: 0.7, color: 0xb3121b, trim: 0xc9a227, seed: 7 });
//   tabard.mesh.position.set(0, 1.4, -0.26);
//   const arms = S.limbs(4, { seed: 7 });               // one draw call for all four segments
//   body.add(torso, hd.group, tabard.mesh, arms.mesh);
//   const rig = { root: body, chest: torso, head: hd, cloths: [tabard], seed: 7 };
//   const hurt = S.wounds({ seed: 7 });
//   // per frame:  S.breathe(rig, time, { look: eyeWorldPosition });
//   //             arms.place(0, shoulder, elbow, 0.07); arms.place(1, elbow, hand, 0.06); arms.commit();
//   // on a hit:   hurt.hit(torso, { x: ev.x, y: ev.y, z: ev.z }, 0.06);
//   // posing:     hd.pose({ jaw: 0.6, brow: -0.5 });  hd.group.rotation.y = 0.4;

import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const OUT_Z = V(0, 0, 1);
const TONGUE = new THREE.Color(0x5a1218);
const TAU = Math.PI * 2;
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const toColor = (c) => (c && c.isColor ? c : new THREE.Color(c));
const toVec = (p) => (p.isVector3 ? p : V(p[0], p[1], p[2]));
const hash = (a, b, c) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };
const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
const _a = V(); const _b = V(); const _c = V(); const _d = V(); const _e = V();
const _q = new THREE.Quaternion(); const _q2 = new THREE.Quaternion();
const _col = new THREE.Color();
const _dummy = new THREE.Object3D();
const _m4 = new THREE.Matrix4();

// ---- small tools --------------------------------------------------------------------------

/** rng(seed: number) -> () => number in [0, 1). A seeded generator; same seed, same sequence. */
export function rng(seed = 1) {
  let s = (Math.floor(seed * 2654435761) ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** noise(x, y, z, seed = 0) -> number in [-1, 1]. Smooth value noise, features about 1 unit across. */
export function noise(x, y, z, seed = 0) {
  const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
  let fx = x - xi; let fy = y - yi; let fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const h = (i, j, k) => hash(xi + i + seed * 17.3, yi + j - seed * 5.1, zi + k + seed * 2.7);
  const x00 = lerp(h(0, 0, 0), h(1, 0, 0), fx); const x10 = lerp(h(0, 1, 0), h(1, 1, 0), fx);
  const x01 = lerp(h(0, 0, 1), h(1, 0, 1), fx); const x11 = lerp(h(0, 1, 1), h(1, 1, 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz) * 2 - 1;
}

/**
 * merge(list: BufferGeometry[]) -> BufferGeometry (indexed). Concatenates geometries into one
 * draw call, keeping position, normal and (when every part has it) color. Use it for every part
 * of a figure that does not need to move on its own.
 */
export function merge(list) {
  const parts = list.filter(Boolean);
  for (const g of parts) if (!g.attributes.normal) g.computeVertexNormals();
  const names = ['position', 'normal', 'color'].filter((n) => parts.every((p) => p.attributes[n]));
  let nv = 0; let ni = 0;
  for (const p of parts) { nv += p.attributes.position.count; ni += p.index ? p.index.count : p.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const arr = new Float32Array(nv * 3);
    let o = 0;
    for (const p of parts) { const at = p.attributes[n]; arr.set(at.array.subarray(0, at.count * 3), o); o += at.count * 3; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, 3));
  }
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let io = 0; let vo = 0;
  for (const p of parts) {
    const cnt = p.attributes.position.count;
    if (p.index) { const src = p.index.array; for (let i = 0; i < src.length; i++) idx[io++] = src[i] + vo; }
    else for (let i = 0; i < cnt; i++) idx[io++] = i + vo;
    vo += cnt;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * tint(geo, hex, vary = 0, seed = 0) -> geo. Gives a geometry one vertex colour; `vary` (0 to 1)
 * mottles its brightness with noise so a primitive does not read as flat plastic.
 */
export function tint(geo, hex, vary = 0, seed = 0) {
  const c = toColor(hex); const p = geo.attributes.position;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = vary ? 1 + vary * noise(p.getX(i) * 9, p.getY(i) * 9, p.getZ(i) * 9, seed) : 1;
    arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * materials() -> { skin, cloth, gloss, metal, wound, dead, flash }. The kit's shared materials
 * (made once). skin, cloth (double sided), gloss (eyes, teeth, wet things) and metal use vertex
 * colour. dead and flash are flat: swap a figure's meshes to `dead` when it dies and to `flash`
 * for a hit blink (skip the blink under reduced flash), as fauna.js does.
 */
let MATS = null;
export function materials() {
  if (!MATS) {
    MATS = {
      skin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 }),
      cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
      gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.24, metalness: 0.04 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.75 }),
      wound: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      dead: new THREE.MeshStandardMaterial({ color: 0x77746a, roughness: 0.8, metalness: 0 }),
      flash: new THREE.MeshStandardMaterial({ color: 0xf3eedf, emissive: 0xf3eedf, emissiveIntensity: 0.8, roughness: 0.5 }),
    };
  }
  return MATS;
}

/** count(object3d) -> { meshes, triangles }. Draw calls and triangles under an object, for budgets. */
export function count(obj) {
  const out = { meshes: 0, triangles: 0 };
  obj.traverse((m) => {
    if (!m.isMesh) return;
    const g = m.geometry;
    out.meshes += 1;
    out.triangles += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (m.isInstancedMesh ? m.count : 1);
  });
  return out;
}

// Makes an indexed geometry's faces point away from (cx, cy, cz).
function faceOut(geo, cx = 0, cy = 0, cz = 0) {
  const p = geo.attributes.position; const ix = geo.index.array;
  let s = 0;
  for (let i = 0; i < ix.length; i += 3) {
    _a.fromBufferAttribute(p, ix[i]); _b.fromBufferAttribute(p, ix[i + 1]); _c.fromBufferAttribute(p, ix[i + 2]);
    _d.subVectors(_b, _a).cross(_e.subVectors(_c, _a));
    s += _d.x * ((_a.x + _b.x + _c.x) / 3 - cx) + _d.y * ((_a.y + _b.y + _c.y) / 3 - cy) + _d.z * ((_a.z + _b.z + _c.z) / 3 - cz);
  }
  if (s < 0) for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  return geo;
}

// An indexed grid of rows x cols vertices built by fn(row, col, position, colour).
function grid(rows, cols, fn) {
  const pos = new Float32Array(rows * cols * 3); const col = new Float32Array(rows * cols * 3);
  const idx = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      _col.setRGB(1, 1, 1);
      fn(r, c, _a, _col);
      const i = (r * cols + c) * 3;
      pos[i] = _a.x; pos[i + 1] = _a.y; pos[i + 2] = _a.z;
      col[i] = _col.r; col[i + 1] = _col.g; col[i + 2] = _col.b;
      if (r < rows - 1 && c < cols - 1) {
        const a = r * cols + c; const b = a + 1; const d = a + cols; const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// ---- skin -----------------------------------------------------------------------------------

/**
 * skin(rings, opts) -> BufferGeometry (indexed, with normal and color; userData.triangles).
 * A lofted body or limb: cross-sections along a spine, smoothed, displaced by noise and painted.
 *   rings: [{ at: [x, y, z] | Vector3, r: number | [rSide, rFront], color?: hex }], two or more,
 *          in order along the spine. Colour blends between rings; put two rings close together
 *          for a sharp band (a cuff, a belt).
 *   opts:  sides (10) vertices round; detail (2) rows per ring gap; budget (1500) most triangles,
 *          the kit drops detail then sides to fit; seed (1); noise (0.05) lumpiness as a share of
 *          radius; grain (1.3) lump frequency; rough (0) per-vertex jitter for fur or bark;
 *          color (0xd8b49a) default ring colour; color2 (null) a second colour blotched in;
 *          mottle (0.1) brightness variation; shade (0.3) darkening of undersides;
 *          caps ('round') 'round' | 'flat' | 'open', or [start, end]; capLen (0.8);
 *          side ([1,0,0]) which way rSide points at the first ring;
 *          profile(angle, u) -> radius multiplier (angle 0 is the front, u 0..1 along the spine);
 *          colorAt(u, angle, color) to paint stripes or patches (mutate the THREE.Color).
 */
export function skin(rings, opts = {}) {
  const o = {
    sides: 10, detail: 2, budget: 1500, seed: 1, noise: 0.05, grain: 1.3, rough: 0, color: 0xd8b49a, color2: null,
    mottle: 0.1, shade: 0.3, caps: 'round', capLen: 0.8, side: null, profile: null, colorAt: null, ...opts,
  };
  const src = rings.map((r) => {
    const rr = Array.isArray(r.r) ? r.r : [r.r, r.r];
    return { at: toVec(r.at).clone(), rx: rr[0], rz: rr[1], color: toColor(r.color ?? o.color) };
  });
  const caps = Array.isArray(o.caps) ? o.caps : [o.caps, o.caps];
  const CAPN = 2;
  const round = caps.filter((c) => c === 'round').length; const closed = caps.filter((c) => c !== 'open').length;
  const trisFor = (d, s) => 2 * s * ((src.length - 1) * d + round * CAPN) + closed * s;
  let detail = Math.max(1, o.detail | 0); let sides = Math.max(3, o.sides | 0);
  while (detail > 1 && trisFor(detail, sides) > o.budget) detail--;
  while (sides > 4 && trisFor(detail, sides) > o.budget) sides--;

  // Resample the spine, radii and colours.
  const curve = new THREE.CatmullRomCurve3(src.map((s) => s.at), false, 'catmullrom', 0.5);
  const n = (src.length - 1) * detail + 1;
  const rows = [];
  for (let j = 0; j < n; j++) {
    const f = (j / (n - 1)) * (src.length - 1);
    const i = Math.min(src.length - 2, Math.floor(f)); const w = f - i;
    const p0 = src[Math.max(0, i - 1)]; const p1 = src[i]; const p2 = src[i + 1]; const p3 = src[Math.min(src.length - 1, i + 2)];
    rows.push({
      at: curve.getPoint(j / (n - 1)), u: j / (n - 1),
      rx: Math.max(0, cr(p0.rx, p1.rx, p2.rx, p3.rx, w)), rz: Math.max(0, cr(p0.rz, p1.rz, p2.rz, p3.rz, w)),
      color: p1.color.clone().lerp(p2.color, w),
    });
  }
  // Frames by parallel transport, so a bent limb does not twist.
  let side = o.side ? toVec(o.side).clone() : null;
  let arc = 0; let meanR = 0;
  rows.forEach((row, j) => {
    row.t = V().subVectors(rows[Math.min(n - 1, j + 1)].at, rows[Math.max(0, j - 1)].at).normalize();
    if (!side) side = Math.abs(row.t.x) < 0.9 ? V(1, 0, 0) : V(0, 0, 1);
    side.addScaledVector(row.t, -side.dot(row.t));
    if (side.lengthSq() < 1e-8) side.set(row.t.y, row.t.z, row.t.x).addScaledVector(row.t, -side.dot(row.t));
    side.normalize();
    row.side = side.clone();
    row.fwd = row.t.clone().cross(side);
    if (j) arc += row.at.distanceTo(rows[j - 1].at);
    row.arc = arc;
    meanR += (row.rx + row.rz) / 2 / n;
  });
  meanR = Math.max(1e-4, meanR);
  for (const row of rows) row.along = row.arc / meanR;
  const capRow = (row, sign, k) => {
    const th = (k / (CAPN + 1)) * Math.PI * 0.5; const ra = (row.rx + row.rz) / 2;
    return {
      ...row, at: row.at.clone().addScaledVector(row.t, sign * ra * o.capLen * Math.sin(th)),
      rx: row.rx * Math.cos(th), rz: row.rz * Math.cos(th), along: row.along + (sign * ra * o.capLen * Math.sin(th)) / meanR,
    };
  };
  const all = [];
  if (caps[0] === 'round') for (let k = CAPN; k >= 1; k--) all.push(capRow(rows[0], -1, k));
  all.push(...rows);
  if (caps[1] === 'round') for (let k = 1; k <= CAPN; k++) all.push(capRow(rows[n - 1], 1, k));

  const R = all.length;
  const tips = (caps[0] !== 'open' ? 1 : 0) + (caps[1] !== 'open' ? 1 : 0);
  const nv = R * sides + tips;
  const pos = new Float32Array(nv * 3); const col = new Float32Array(nv * 3);
  const idx = [];
  for (let r = 0; r < R; r++) {
    const row = all[r];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * TAU; const ca = Math.cos(a); const sa = Math.sin(a);
      const qx = ca * o.grain; const qy = row.along * o.grain; const qz = sa * o.grain;
      let m = 1 + o.noise * (noise(qx, qy, qz, o.seed) + 0.5 * noise(qx * 2.3, qy * 2.3, qz * 2.3, o.seed + 11));
      if (o.rough) m += o.rough * (hash(r, k, o.seed) - 0.5);
      if (o.profile) m *= o.profile(a, row.u);
      const i = (r * sides + k) * 3;
      pos[i] = row.at.x + row.fwd.x * row.rz * m * ca + row.side.x * row.rx * m * sa;
      pos[i + 1] = row.at.y + row.fwd.y * row.rz * m * ca + row.side.y * row.rx * m * sa;
      pos[i + 2] = row.at.z + row.fwd.z * row.rz * m * ca + row.side.z * row.rx * m * sa;
      if (r < R - 1) {
        const p = r * sides + k; const q = r * sides + ((k + 1) % sides);
        idx.push(p, p + sides, q, q, p + sides, q + sides);
      }
    }
  }
  let tip = R * sides;
  const tipAt = (row, sign, isRound, into) => {
    const ra = (row.rx + row.rz) / 2;
    _a.copy(row.at); if (isRound) _a.addScaledVector(row.t, sign * ra * o.capLen);
    pos[into * 3] = _a.x; pos[into * 3 + 1] = _a.y; pos[into * 3 + 2] = _a.z;
  };
  let tipA = -1; let tipB = -1;
  if (caps[0] !== 'open') {
    tipA = tip++;
    tipAt(rows[0], -1, caps[0] === 'round', tipA);
    for (let k = 0; k < sides; k++) idx.push(k, (k + 1) % sides, tipA);
  }
  if (caps[1] !== 'open') {
    tipB = tip++;
    tipAt(rows[n - 1], 1, caps[1] === 'round', tipB);
    const base = (R - 1) * sides;
    for (let k = 0; k < sides; k++) idx.push(base + k, tipB, base + ((k + 1) % sides));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nor = g.attributes.normal;
  const c2 = o.color2 != null ? toColor(o.color2) : null;
  const paintV = (i, row, a) => {
    const qx = Math.cos(a) * o.grain; const qy = row.along * o.grain; const qz = Math.sin(a) * o.grain;
    _col.copy(row.color);
    if (c2) _col.lerp(c2, sstep(0.1, 0.6, noise(qx * 0.8 + 31, qy * 0.8, qz * 0.8, o.seed + 5)));
    if (o.colorAt) o.colorAt(row.u, a, _col);
    const k = (1 + o.mottle * noise(qx * 2 + 7, qy * 2, qz * 2, o.seed + 3)) * (1 - o.shade * 0.7 * Math.max(0, -nor.getY(i)));
    col[i * 3] = _col.r * k; col[i * 3 + 1] = _col.g * k; col[i * 3 + 2] = _col.b * k;
  };
  for (let r = 0; r < R; r++) for (let k = 0; k < sides; k++) paintV(r * sides + k, all[r], (k / sides) * TAU);
  if (tipA >= 0) paintV(tipA, all[0], 0);
  if (tipB >= 0) paintV(tipB, all[R - 1], 0);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.userData.triangles = idx.length / 3;
  return g;
}

// ---- limbs ----------------------------------------------------------------------------------

const SEG_R = 0.1;

/**
 * ik2(hip, foot, l1, l2, bend, knee) -> knee. Two-bone joint: writes into `knee` (Vector3) where
 * the middle joint sits between `hip` and `foot` for bone lengths l1 and l2, bending toward `bend`.
 */
export function ik2(hip, foot, l1, l2, bend, knee) {
  _d.subVectors(foot, hip);
  const L = Math.max(1e-3, Math.min(_d.length(), (l1 + l2) * 0.999));
  _d.normalize();
  const ca = clamp((l1 * l1 + L * L - l2 * l2) / (2 * l1 * L), -1, 1);
  const sa = Math.sqrt(1 - ca * ca);
  _e.copy(bend).addScaledVector(_d, -bend.dot(_d));
  if (_e.lengthSq() < 1e-6) _e.set(0, 1, 0);
  _e.normalize();
  return knee.copy(hip).addScaledVector(_d, ca * l1).addScaledVector(_e, sa * l1);
}

/**
 * limbs(count, opts) -> { mesh, place(i, a, b, r), tone(i, hex), hide(i), commit() }.
 * Up to `count` sculpted limb segments (arms, legs, fingers, mitten hands, feet, tails) drawn as
 * ONE instanced mesh. Add `mesh` to the figure's group; each frame call place() for the segments
 * that moved (a, b: Vector3 ends in the group's space; r: thickest radius in metres; the `a` end
 * is the thick one), then commit() once. tone() colours a segment (sleeve, glove, stocking).
 *   opts: taper (0.7) far radius over near; seed (5); sides (7); noise (0.06);
 *         material (materials().skin); cast (true) whether it casts a shadow.
 */
export function limbs(n, opts = {}) {
  const o = { taper: 0.7, seed: 5, sides: 7, noise: 0.06, material: null, cast: true, ...opts };
  const geo = skin([
    { at: [0, -0.5, 0], r: SEG_R * 0.9 }, { at: [0, -0.22, 0], r: SEG_R },
    { at: [0, 0.2, 0], r: SEG_R * lerp(1, o.taper, 0.6) }, { at: [0, 0.5, 0], r: SEG_R * o.taper },
  ], { sides: o.sides, detail: 1, noise: o.noise, seed: o.seed, color: 0xffffff, mottle: 0.12, shade: 0, capLen: 0.6 });
  const mesh = new THREE.InstancedMesh(geo, o.material || materials().skin, n);
  mesh.castShadow = o.cast;
  mesh.frustumCulled = false;
  _m4.makeScale(0, 0, 0);
  _col.setRGB(1, 1, 1);
  for (let i = 0; i < n; i++) { mesh.setMatrixAt(i, _m4); mesh.setColorAt(i, _col); }
  return {
    mesh,
    place(i, a, b, r) {
      _d.subVectors(b, a);
      const len = Math.max(1e-4, _d.length());
      _dummy.position.copy(a).addScaledVector(_d, 0.5);
      _dummy.quaternion.setFromUnitVectors(UP, _d.multiplyScalar(1 / len));
      _dummy.scale.set(r / SEG_R, len, r / SEG_R);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    },
    tone(i, hex) { mesh.setColorAt(i, _col.set(hex)); },
    hide(i) { mesh.setMatrixAt(i, _m4.makeScale(0, 0, 0)); },
    commit() { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; },
  };
}

/**
 * claw(opts) -> BufferGeometry. A hooked, taloned claw reaching along -Z from the origin and
 * curling down: a halberd head, a bird's foot, a hand gone wrong. Merge it or mesh it.
 *   opts: fingers (3); length (0.3); spread (0.5) radians between outer talons; curl (1);
 *         r (0.035) root radius; color (0x4e4b47); tip (0x15110f); back (false) adds a rear toe;
 *         seed (1).
 */
export function claw(opts = {}) {
  const o = { fingers: 3, length: 0.3, spread: 0.5, curl: 1, r: 0.035, color: 0x4e4b47, tip: 0x15110f, back: false, seed: 1, ...opts };
  const base = toColor(o.color); const tipC = toColor(o.tip);
  const talon = (yaw, len, seed) => {
    const rings = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      const out = len * (t - 0.18 * t * t);
      rings.push({
        at: [Math.sin(yaw) * out, len * (0.16 * Math.sin(Math.PI * t) - 0.55 * o.curl * t * t), -Math.cos(yaw) * out],
        r: o.r * (1 - 0.92 * t) + 0.002, color: base.clone().lerp(tipC, t * t),
      });
    }
    return skin(rings, { sides: 5, detail: 2, noise: 0.08, seed, mottle: 0.15, caps: ['round', 'flat'] });
  };
  const parts = [tint(new THREE.SphereGeometry(o.r * 1.7, 7, 5).scale(1, 0.8, 1), base, 0.15, o.seed)];
  for (let i = 0; i < o.fingers; i++) {
    const f = o.fingers > 1 ? i / (o.fingers - 1) - 0.5 : 0;
    parts.push(talon(f * o.spread * 2, o.length * (1 - 0.25 * Math.abs(f)), o.seed + i));
  }
  if (o.back) parts.push(talon(Math.PI, o.length * 0.55, o.seed + 9));
  return merge(parts);
}

/**
 * pip(suit, size = 0.2, hex?) -> BufferGeometry. A flat playing-card suit ('heart', 'diamond',
 * 'club', 'spade') in the XY plane, `size` tall, for cloth({ attach }) or a card body.
 */
export function pip(suit, size = 0.2, hex) {
  const shapes = [];
  const sh = () => { const s = new THREE.Shape(); shapes.push(s); return s; };
  const stem = () => { const s = sh(); s.moveTo(0, -0.05); s.lineTo(0.17, -0.5); s.lineTo(-0.17, -0.5); s.closePath(); };
  if (suit === 'diamond') {
    const s = sh(); s.moveTo(0, -0.5); s.lineTo(0.36, 0); s.lineTo(0, 0.5); s.lineTo(-0.36, 0); s.closePath();
  } else if (suit === 'heart') {
    const s = sh(); s.moveTo(0, -0.5); s.bezierCurveTo(-0.95, 0.05, -0.45, 0.8, 0, 0.3); s.bezierCurveTo(0.45, 0.8, 0.95, 0.05, 0, -0.5);
  } else if (suit === 'spade') {
    const s = sh(); s.moveTo(0, 0.5); s.bezierCurveTo(-0.95, -0.05, -0.45, -0.7, 0, -0.2); s.bezierCurveTo(0.45, -0.7, 0.95, -0.05, 0, 0.5);
    stem();
  } else if (suit === 'club') {
    for (const [x, y] of [[0, 0.24], [-0.23, -0.08], [0.23, -0.08]]) sh().absarc(x, y, 0.21, 0, TAU, false);
    stem();
  } else throw new Error(`sculpt.pip: unknown suit ${suit}`);
  const g = new THREE.ShapeGeometry(shapes, 6);
  g.scale(size, size, size);
  return tint(g, hex ?? (suit === 'heart' || suit === 'diamond' ? 0xb3121b : 0x14141a));
}

// ---- face -----------------------------------------------------------------------------------

// Each defect edits the face plan. `i` is the eye it lands on (0 the figure's left, 1 its right),
// `j` the other one, `s` is -1 for left and +1 for right.
const DEFECT = {
  eyeLow: (p, i, j, s, k) => { p.eyes[i].lat -= 0.17 * k; },
  eyeBig: (p, i) => { p.eyes[i].r *= 1.65; p.eyes[i].lon *= 1.08; },
  eyesClose: (p) => { p.eyes[0].lon = -0.23; p.eyes[1].lon = 0.23; },
  eyesWide: (p) => { p.eyes[0].lon = -0.62; p.eyes[1].lon = 0.62; },
  noPupil: (p, i, j, s, k) => { p.eyes[i].shape = 'none'; p.eyes[i].r *= 1 + 0.3 * (k - 1); },
  pupilsMismatched: (p, i, j) => { p.eyes[i].pupil = 0.4; p.eyes[j].pupil = 0.09; },
  pupilsSlit: (p) => { for (const e of p.eyes) e.shape = 'slit'; },
  pupilsPin: (p) => { for (const e of p.eyes) e.pupil = 0.06; },
  eyeShut: (p, i) => { p.eyes[i].shut = true; },
  eyesRed: (p) => { for (const e of p.eyes) { e.rim = 0xa0141c; e.white = 0xf3d9d2; } },
  eyesOld: (p) => { for (const e of p.eyes) { e.open = 0.42; e.bag = true; e.color = 0x9aa3a0; e.white = 0xe6dfc6; } p.brow.color = 0x9a958c; p.brow.thick *= 0.7; },
  noBlink: (p) => { p.blink.never = true; },
  blinkSideways: (p) => { for (const e of p.eyes) { e.lid = 'side'; e.open = 1.5; } },
  blinkUneven: (p) => { p.blink.uneven = 0.24; },
  smileWide: (p, i, j, s, k) => { p.mouth.width = 0.4 + 0.55 * k; p.mouth.smile = Math.max(p.mouth.smile, Math.min(1.3, 0.8 * k)); },
  mouthCrooked: (p, i, j, s) => { p.mouth.crook = 0.95 * s; },
  noMouth: (p) => { p.mouth.none = true; },
  jawHang: (p) => { p.mouth.rest = Math.max(p.mouth.rest, 0.55); },
  teethMany: (p) => { p.mouth.many = true; p.mouth.rest = Math.max(p.mouth.rest, 0.2); },
  fangsFront: (p) => { p.mouth.fangs = 'front'; },
  fangTips: (p, i, j, s, k) => { p.mouth.fangs = 'tips'; p.mouth.fangLen = k; },
  seam: (p) => { p.seam = true; },
  legInMouth: (p, i, j, s) => { p.mouth.extra = s; },
  headTilt: (p, i, j, s) => { p.tilt = 0.55 * s; },
};

/**
 * DEFECTS: the names a face can pick. Add ':L' or ':R' (the figure's own left or right) to the
 * one-sided ones; left is the default.
 *   eyeLow, eyeBig, noPupil, eyeShut (one eye)  eyesClose, eyesWide, eyesRed (red rims), eyesOld
 *   pupilsMismatched, pupilsSlit, pupilsPin     noBlink, blinkSideways, blinkUneven
 *   smileWide, mouthCrooked, noMouth, jawHang, teethMany, fangsFront (two long front fangs),
 *   fangTips (two small fang tips over the lower lip), legInMouth (something's leg at the corner)
 *   seam (a stitched seam down the face), headTilt (the head rests further over than a neck goes)
 */
export const DEFECTS = Object.freeze(Object.keys(DEFECT));

/**
 * face(opts) -> plan. Resolves a friendly default face (round even eyes, small smile, rosy
 * cheeks) plus named defects into a plain object of numbers that head() builds from. You may edit
 * the plan before passing it to head({ face: plan }). Angles on the head are (lon, lat) in
 * radians: lon 0 is straight ahead, positive toward the figure's right; lat positive is up.
 *   opts: seed (1); skin (0xe6c3a8); eye (0x4f6f8c) iris colour; hair (null) hex for painted hair;
 *         defects: string[] from DEFECTS; defectScale (1) how far each defect goes (2 doubles the
 *         eye offset, the extra smile width and the fang tips, so they read from a few metres);
 *         and optional overrides merged over the defaults BEFORE
 *         the defects: skull { wide, tall, deep, taper, cheek, brow, chin, noise, and for the
 *         finer skull muzzle (0) a swell under the eyes, socket (0) how deep the eyes are sunk,
 *         temple (0) hollows at the temples, each a share of the radius },
 *         eyes { lat, r, iris, pupil, open, white, lon }, brow { color, thick, tilt, none },
 *         nose { kind: 'button' | 'long' | 'none', lat, size, length },
 *         mouth { lat, width, smile, lip, teeth, toothLen, rest }, cheek { rosy, color },
 *         ears { kind: 'round' | 'point' | 'none', size }, blink { period }.
 * Returns { seed, skin, skull, eyes: [left, right], brow, nose, mouth, cheek, ears, hair, seam,
 *   tilt, blink, defects }.
 */
export function face(opts = {}) {
  const eyeOpts = { ...(opts.eyes || {}) };
  const lon = Math.abs(eyeOpts.lon ?? 0.4);
  delete eyeOpts.lon;
  const eye = (s) => ({
    lon: s * lon, lat: 0.1, r: 0.2, iris: 0.5, pupil: 0.24, shape: 'round', color: opts.eye ?? 0x4f6f8c, white: 0xf5f1e8,
    rim: null, open: 0.8, shut: false, lid: 'top', bag: false, ...eyeOpts,
  });
  const plan = {
    seed: opts.seed ?? 1,
    skin: opts.skin ?? 0xe6c3a8,
    skull: { wide: 1, tall: 1.04, deep: 0.96, taper: 0.3, cheek: 0.07, brow: 0.035, chin: 0.05, noise: 0.03, ...opts.skull },
    eyes: [eye(-1), eye(1)],
    brow: { color: 0x3a2a1e, thick: 0.034, tilt: 0, none: false, ...opts.brow },
    nose: { kind: 'button', lat: -0.13, size: 0.12, length: 0.3, ...opts.nose },
    mouth: {
      lat: -0.52, width: 0.4, smile: 0.6, crook: 0, lip: 0xa8483e, teeth: 8, toothLen: 0.075, many: false, fangs: null, fangLen: 1,
      none: false, rest: 0, extra: 0, ...opts.mouth,
    },
    cheek: { rosy: 0.55, color: 0xe2705f, ...opts.cheek },
    ears: { kind: 'round', size: 1, ...opts.ears },
    hair: opts.hair ?? null,
    seam: false,
    tilt: 0,
    blink: { period: 3.6, never: false, uneven: 0, ...opts.blink },
    defects: [...(opts.defects || [])],
  };
  for (const d of plan.defects) {
    const [name, sideName] = String(d).split(':');
    if (!DEFECT[name]) throw new Error(`sculpt.face: unknown defect "${name}"`);
    const i = sideName === 'R' ? 1 : 0;
    DEFECT[name](plan, i, 1 - i, i ? 1 : -1, opts.defectScale ?? 1);
  }
  return plan;
}

/**
 * blinkAt(time, plan, seed = 0) -> [left, right], each 0 (open) to 1 (shut). When a face with
 * this plan blinks, as a pure function of time. breathe() calls it for you.
 */
export function blinkAt(time, plan, seed = 0) {
  const b = plan.blink;
  if (b.never) return [0, 0];
  const one = (t) => {
    const k = Math.floor(t / b.period);
    const start = (0.15 + 0.7 * hash(k, seed, 3.1)) * b.period;
    const x = (t - k * b.period - start) / 0.16;
    return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x);
  };
  const tt = time + seed * 1.37;
  return [one(tt), one(tt - b.uneven)];
}

/**
 * head(opts) -> { group, skull, jaw, features, plan, size, centre, triangles, pose, lookAt, at }.
 * The oversized head: three meshes (skull with everything fixed merged in; the hinged jaw; the
 * eyes, lids and brows, which move by rewriting a few hundred vertices). `group`'s origin is the
 * neck joint, so position it on top of the body and rotate it to turn the head.
 *   opts: size (0.26) head radius in metres, about twice natural; seed; defects: string[];
 *         face: a plan from face(), or face() options; budget (2600, at most 4000) sets how fine
 *         the skull is; fine (false) the finer skull: a third more vertices, bunched over the face,
 *         for a head seen close (use it with skull { muzzle, socket, temple });
 *         extras: BufferGeometry[] with color, in the group's space (a hat, hair, long ears),
 *         merged into the skull mesh; wet: BufferGeometry[] with color, in the group's space
 *         (fangs, whiskers, blood), merged into the gloss `features` mesh so they cost no draw call;
 *         cast (true) whether the skull casts a shadow.
 *   pose({ jaw, look, blink, brow, frown }): any subset. jaw 0 (rest) to 1 (wide open);
 *         look [yaw, pitch] radians for the eyes (+yaw toward the figure's right, +pitch up);
 *         blink 0 to 1 or [left, right]; brow -1 (lowered) to 1 (raised); frown -1 (sad) to 1
 *         (angry). Cheap; does nothing if nothing changed.
 *   lookAt(worldPoint: Vector3, limit = 0.45): turns the EYES (not the head) toward a world point.
 *   at(lon, lat, proud = 0) -> Vector3 in the group's space on the head's surface (proud is a
 *         share of the radius outward): for placing hats, pins, ears, wounds.
 *   centre: Vector3 of the head's middle in the group's space. jaw is null for a face with no mouth.
 */
export function head(opts = {}) {
  const isPlan = opts.face && opts.face.skull && Array.isArray(opts.face.eyes);
  const plan = isPlan ? opts.face : face({ seed: opts.seed, defects: opts.defects, ...(opts.face || {}) });
  const size = opts.size ?? 0.26;
  const budget = Math.min(opts.budget ?? 2600, 4000);
  const fine = !!opts.fine;
  const sk = plan.skull; const m = plan.mouth; const seed = plan.seed;
  const M = materials();
  const CY = 0.8 * sk.tall;
  const skinC = toColor(plan.skin); const rosyC = toColor(plan.cheek.color);
  const darkC = skinC.clone().multiplyScalar(0.45).lerp(new THREE.Color(0x3a1c2a), 0.3);
  const hairC = plan.hair != null ? toColor(plan.hair) : null;
  const rand = rng(seed * 7 + 3);
  const browY = Math.sin((plan.eyes[0].lat + plan.eyes[1].lat) / 2 + 0.32);

  // The skull's surface in head units (radius about 1, centred on the head's middle).
  function shape(lon, lat, proud, out) {
    const cl = Math.cos(lat);
    const dx = Math.sin(lon) * cl; const dy = Math.sin(lat); const dz = -Math.cos(lon) * cl;
    const front = Math.max(0, -dz); const low = Math.max(0, -dy);
    let k = 1 + proud;
    k += sk.cheek * Math.exp(-((Math.abs(dx) - 0.5) ** 2 + (dy + 0.25) ** 2) / 0.06) * front;
    k += sk.brow * Math.exp(-((dy - browY) ** 2) / 0.012) * front * front;
    k += sk.chin * Math.exp(-(dx * dx + (dy + 0.78) ** 2) / 0.05) * front;
    k += sk.noise * (noise(dx * 2.1, dy * 2.1, dz * 2.1, seed) + 0.5 * noise(dx * 5, dy * 5, dz * 5, seed + 3));
    // The finer skull's own shaping (all 0 unless asked for): a muzzle, sunk sockets, hollow temples.
    if (sk.muzzle) k += sk.muzzle * Math.exp(-(dx * dx * 2.4 + (dy + 0.4) ** 2) / 0.085) * front;
    if (sk.socket) for (const e of plan.eyes) k -= sk.socket * Math.exp(-((lon - e.lon) ** 2 + (lat - e.lat) ** 2) / (2.2 * e.r * e.r)) * front;
    if (sk.temple) k -= sk.temple * Math.exp(-((Math.abs(dx) - 0.8) ** 2 + (dy - 0.42) ** 2) / 0.07) * (0.35 + 0.65 * front);
    const tp = 1 - sk.taper * low * low;
    return out.set(dx * sk.wide * tp * k, dy * sk.tall * k, dz * sk.deep * (1 - 0.4 * sk.taper * low * low) * k);
  }
  // A frame on the surface: p the point, u up along the surface, n outward, r = u x n.
  function frame(lon, lat, proud = 0) {
    const p = shape(lon, lat, proud, V());
    const e = 0.02;
    const r0 = shape(lon + e, lat, proud, V()).sub(shape(lon - e, lat, proud, _a));
    const u = shape(lon, lat + e, proud, V()).sub(shape(lon, lat - e, proud, _a)).normalize();
    const nn = V().crossVectors(u, r0).normalize();
    if (nn.dot(p) < 0) nn.negate();
    const r = V().crossVectors(u, nn).normalize();
    return { p, u, n: nn, r, m: new THREE.Matrix4().makeBasis(r, u, nn).setPosition(p) };
  }
  // Sets a primitive (authored x across, y up the face, z outward) onto the surface.
  const place = (geo, lon, lat, proud = 0, roll = 0) => {
    if (roll) geo.rotateZ(roll);
    return geo.applyMatrix4(frame(lon, lat, proud).m);
  };
  const skinAt = (lon, lat, out) => {
    const cl = Math.cos(lat); const dx = Math.sin(lon) * cl; const dy = Math.sin(lat); const dz = -Math.cos(lon) * cl;
    const front = Math.max(0, -dz);
    out.copy(skinC);
    const al = Math.abs(lon);
    out.lerp(rosyC, 0.8 * plan.cheek.rosy * Math.exp(-((al - 0.62) ** 2 + (lat + 0.2) ** 2) / 0.035) * front);
    for (const e of plan.eyes) {
      const d2 = (lon - e.lon) ** 2 + (lat - e.lat) ** 2;
      out.lerp(darkC, 0.32 * Math.exp(-d2 / (2.4 * e.r * e.r)) * front);
    }
    if (hairC && dy > 0.62 - 0.95 * Math.max(0, dz) - 0.25 * (1 - front) + 0.07 * noise(dx * 6, dy * 6, dz * 6, seed + 21)) {
      out.copy(hairC).multiplyScalar(0.8 + 0.35 * hash(Math.round(lon * 40), Math.round(lat * 9), seed));
    }
    return out.multiplyScalar(1 + 0.07 * noise(dx * 4, dy * 4, dz * 4, seed + 9));
  };
  const bake = (geo) => geo.translate(0, CY, 0).scale(size, size, size);

  // ---- skull ----
  // The finer skull spends a third more vertices and bunches them where the face is: longitudes
  // toward the front, latitudes toward the band from brow to chin.
  const cols = fine ? clamp(Math.round(Math.sqrt(budget * 0.3)), 12, 36) : clamp(Math.round(Math.sqrt(budget * 0.22)), 10, 36);
  const lats = Math.max(7, Math.round(cols * (fine ? 0.74 : 0.7)));
  const lonOf = (c) => { const t = (c / cols) * TAU - Math.PI; return fine ? t - 0.42 * Math.sin(t) : t; };
  const latOf = (r) => { const t = Math.PI / 2 - (r / lats) * Math.PI; return fine ? t - 0.17 * Math.sin(2 * t) : t; };
  const skullGeo = (() => {
    const nv = (lats - 1) * cols + 2;
    const pos = new Float32Array(nv * 3); const ll = new Float32Array(nv * 2);
    const idx = [];
    const put = (i, lon, lat) => { shape(lon, lat, 0, _a); pos[i * 3] = _a.x; pos[i * 3 + 1] = _a.y; pos[i * 3 + 2] = _a.z; ll[i * 2] = lon; ll[i * 2 + 1] = lat; };
    put(0, 0, Math.PI / 2);
    for (let r = 1; r < lats; r++) {
      for (let c = 0; c < cols; c++) {
        const i = 1 + (r - 1) * cols + c;
        put(i, lonOf(c), latOf(r));
        const nx = 1 + (r - 1) * cols + ((c + 1) % cols);
        if (r === 1) idx.push(0, i, nx);
        if (r < lats - 1) idx.push(i, i + cols, nx, nx, i + cols, nx + cols);
        else idx.push(i, nv - 1, nx);
      }
    }
    put(nv - 1, 0, -Math.PI / 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    faceOut(g);
    g.computeVertexNormals();
    const col = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      skinAt(ll[i * 2], ll[i * 2 + 1], _col).multiplyScalar(1 - 0.28 * Math.max(0, -g.attributes.normal.getY(i)));
      col[i * 3] = _col.r; col[i * 3 + 1] = _col.g; col[i * 3 + 2] = _col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  })();
  const fixed = [skullGeo];
  const jawParts = [];

  // ---- eyes, lids and brows (the moving mesh) ----
  const moving = []; // { geo, kind, eye }
  const eyeInfo = plan.eyes.map((e, i) => {
    const f = frame(e.lon, e.lat);
    const c = f.p.clone().addScaledVector(f.n, -e.r * 0.55);
    const ef = V(0, 0, -1).lerp(f.n, 0.35).normalize();
    const ey = V(0, 1, 0).addScaledVector(ef, -ef.y).normalize();
    const ex = V().crossVectors(ef, ey);
    // Rim (and bag) on the skull.
    const rimC = e.rim != null ? toColor(e.rim) : darkC;
    fixed.push(place(tint(new THREE.TorusGeometry(e.r * 0.87, e.r * (e.rim != null ? 0.11 : 0.07), 5, 14), rimC), e.lon, e.lat, 0.004));
    if (e.bag) fixed.push(place(tint(new THREE.TorusGeometry(e.r * 1.05, e.r * 0.09, 4, 8, Math.PI).rotateZ(Math.PI), skinC.clone().lerp(darkC, 0.55)), e.lon, e.lat - 0.02, 0.008));
    const cap = (k, ax, ay, n, hexMid, hexEdge, ox = 0, oy = 0) => {
      const g = grid(1, n + 2, (r, j, p, col) => {
        if (j === 0) { p.copy(ef).addScaledVector(ex, ox).addScaledVector(ey, oy); col.set(hexMid); }
        else {
          const a = ((j - 1) / n) * TAU;
          p.copy(ef).addScaledVector(ex, ox + Math.tan(ax) * Math.cos(a)).addScaledVector(ey, oy + Math.tan(ay) * Math.sin(a));
          col.set(hexEdge);
        }
        p.normalize().multiplyScalar(e.r * k).add(c);
      });
      const idx = [];
      for (let j = 1; j <= n; j++) idx.push(0, j, j + 1);
      g.setIndex(idx);
      return faceOut(g, c.x, c.y, c.z);
    };
    moving.push({ geo: tint(new THREE.SphereGeometry(e.r, 10, 8).translate(c.x, c.y, c.z), e.white), kind: 'fixed', eye: i });
    const blank = e.shape === 'none';
    const iris = toColor(blank ? 0xd9dccf : e.color);
    moving.push({ geo: cap(1.012, e.iris, e.iris, 12, iris.clone().multiplyScalar(blank ? 1 : 1.25), iris.clone().multiplyScalar(blank ? 0.85 : 0.55)), kind: 'iris', eye: i });
    if (!blank) {
      const slit = e.shape === 'slit';
      const ax = slit ? e.pupil * 0.3 : e.pupil; const ay = slit ? Math.min(e.iris * 0.96, e.pupil * 1.9) : e.pupil;
      moving.push({ geo: cap(1.024, ax, ay, 10, 0x050406, 0x050406), kind: 'iris', eye: i });
    }
    moving.push({ geo: cap(1.036, 0.08, 0.08, 6, 0xffffff, 0xffffff, -0.3, 0.3), kind: 'fixed', eye: i });
    // The lid: a shell that turns about the eye. Sideways lids come in from the outer corner.
    const roll = e.lid === 'side' ? (i ? -1 : 1) * Math.PI / 2 : 0;
    const lx = ex.clone().multiplyScalar(Math.cos(roll)).addScaledVector(ey, Math.sin(roll));
    const ly = ey.clone().multiplyScalar(Math.cos(roll)).addScaledVector(ex, -Math.sin(roll));
    const lidC = e.lid === 'side' ? new THREE.Color(0xd9c9c2) : skinC.clone().multiplyScalar(0.88);
    const lid = grid(7, 7, (r, j, p, col) => {
      const al = (r / 6) * 2.3; const be = (j / 6 - 0.5) * 2.6;
      p.copy(lx).multiplyScalar(Math.sin(be)).addScaledVector(ly, Math.cos(be) * Math.sin(al)).addScaledVector(ef, Math.cos(be) * Math.cos(al));
      p.multiplyScalar(e.r * 1.07).add(c);
      col.copy(lidC);
      if (r === 0) col.set(0x2a1c16);
    });
    moving.push({ geo: faceOut(lid, c.x, c.y, c.z), kind: 'lid', eye: i });
    // The brow.
    let brow = null;
    if (!plan.brow.none) {
      const bl = e.lat + e.r * 1.05 + 0.13;
      const outer = Math.sign(e.lon) || 1;
      const rings = [-1, 0, 1].map((s) => ({
        at: shape(e.lon + s * 0.24, bl + (s === 0 ? 0.03 : 0) + plan.brow.tilt * 0.09 * s * outer, 0.035, V()),
        r: plan.brow.thick * (s === 0 ? 1.15 : 0.7),
      }));
      moving.push({ geo: skin(rings, { sides: 5, detail: 2, noise: 0.15, seed: seed + i, color: plan.brow.color, mottle: 0.2, shade: 0, capLen: 0.6, side: [0, 1, 0] }), kind: 'brow', eye: i });
      brow = frame(e.lon, bl, 0.035);
    }
    return { e, c, ef, ex, ey, lx, brow, outer: Math.sign(e.lon) || 1 };
  });

  // ---- nose and ears ----
  const nose = plan.nose;
  if (nose.kind === 'button') {
    fixed.push(place(tint(new THREE.SphereGeometry(nose.size, 9, 7), skinC.clone().lerp(rosyC, 0.45), 0.08, seed), 0, nose.lat, nose.size * 0.35));
  } else if (nose.kind === 'long') {
    const f = frame(0, nose.lat, -0.03);
    const tipP = f.p.clone().addScaledVector(f.n, nose.length).addScaledVector(f.u, -nose.length * 0.18);
    fixed.push(skin([
      { at: f.p, r: nose.size }, { at: f.p.clone().lerp(tipP, 0.5).addScaledVector(f.u, nose.length * 0.06), r: nose.size * 0.75 },
      { at: tipP, r: nose.size * 0.5, color: skinC.clone().lerp(rosyC, 0.6) },
    ], { sides: 7, detail: 2, noise: 0.08, seed, color: skinC, caps: ['open', 'round'] }));
  }
  if (plan.ears.kind !== 'none') {
    for (const s of [-1, 1]) {
      const es = plan.ears.size;
      const g = plan.ears.kind === 'point'
        ? new THREE.ConeGeometry(0.14 * es, 0.46 * es, 6).scale(0.45, 1, 1).translate(0, 0.16 * es, 0.05 * es)
        : new THREE.SphereGeometry(1, 8, 6).scale(0.07 * es, 0.2 * es, 0.16 * es);
      fixed.push(place(tint(g, skinC.clone().lerp(rosyC, 0.25), 0.08, seed), s * 1.52, 0.02, 0.03));
    }
  }

  // ---- mouth and jaw ----
  const hw = m.width;
  const mouthLat = (lon) => { const s = lon / hw; return m.lat + m.smile * 0.16 * (s * s - 0.3) + m.crook * 0.1 * s; };
  const hinge = V(0, -0.1, 0.25 * sk.deep);
  if (!m.none) {
    // The dark inside, which the closed jaw covers.
    fixed.push(faceOut(grid(5, 11, (r, j, p, col) => {
      const s = (j / 10) * 2 - 1; const t = r / 4;
      const lon = s * hw * 0.97;
      shape(lon, mouthLat(lon) + 0.012 - t * 0.56 * Math.sqrt(Math.max(0, 1 - 0.9 * s * s)), 0.006, p);
      col.set(0x12040a).lerp(TONGUE, t * t);
    })));
    const lip = (off, proud, rad) => {
      const rings = [];
      for (let j = 0; j <= 8; j++) {
        const s = (j / 8) * 2 - 1; const lon = s * hw * 1.04;
        const thin = 1 - 0.8 * s * s * s * s; // the lips meet and thin out at the corners
        rings.push({ at: shape(lon, mouthLat(clamp(lon, -hw, hw)) + off * thin, proud, V()), r: rad * thin + 0.004 });
      }
      return skin(rings, { sides: 5, detail: 1, noise: 0, color: m.lip, mottle: 0.08, shade: 0.2, capLen: 0.5, side: [0, 1, 0] });
    };
    fixed.push(lip(0.04, 0.02, 0.045));
    jawParts.push(lip(-0.014, 0.047, 0.038));
    // Teeth: the uppers hang from the lip line behind the closed jaw, the lowers ride the jaw.
    const nTeeth = Math.max(2, Math.round(m.teeth * (hw / 0.4) * (m.many ? 1.9 : 1)));
    const toothC = new THREE.Color(m.many ? 0xe3d6ac : 0xefe8d4);
    const tooth = (w, len, sharp, up) => {
      let g;
      if (sharp) g = new THREE.ConeGeometry(w * 0.5, len, 5).rotateZ(Math.PI);
      else {
        g = new THREE.BoxGeometry(w, len, 0.022);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setX(i, p.getX(i) * 0.72);
      }
      if (up) g.rotateZ(Math.PI);
      return tint(g, toothC, 0.1, rand() * 9);
    };
    for (let t = 0; t < nTeeth; t++) {
      const s = ((t + 0.5) / nTeeth) * 2 - 1;
      const lon = s * hw * 0.86;
      const w = ((1.72 * hw) / nTeeth) * 0.78;
      const len = m.toothLen * (m.many ? 0.8 + 0.9 * rand() : 1) * (1 - 0.4 * s * s);
      fixed.push(place(tooth(w, len, m.many && t % 2 === 1, false), lon, mouthLat(lon) - len / 2 + 0.01, 0.02));
      jawParts.push(place(tooth(w * 0.9, 0.05, m.many && t % 2 === 0, true), lon + (m.many ? 0.5 * w : 0), mouthLat(lon) + 0.013, 0.016));
    }
    if (m.fangs === 'front') for (const s of [-1, 1]) fixed.push(place(tooth(0.075, 0.27, true, false), s * 0.065, mouthLat(0) - 0.12, 0.09));
    if (m.fangs === 'tips') for (const s of [-1, 1]) fixed.push(place(tooth(0.05 * Math.sqrt(m.fangLen || 1), 0.12 * (m.fangLen || 1), true, false), s * hw * 0.45, mouthLat(s * hw * 0.45) - 0.045, 0.092));
    if (m.extra) {
      const f = frame(m.extra * hw * 0.88, mouthLat(m.extra * hw * 0.88), 0);
      const p1 = f.p.clone().addScaledVector(f.n, 0.11);
      const p2 = p1.clone().addScaledVector(f.n, 0.07).add(_a.set(m.extra * 0.06, -0.12, 0));
      const p3 = p2.clone().add(_a.set(m.extra * 0.03, -0.1, 0.03));
      fixed.push(skin([{ at: f.p, r: 0.02 }, { at: p1, r: 0.018 }, { at: p2, r: 0.013 }, { at: p3, r: 0.005 }], { sides: 4, detail: 1, noise: 0, color: 0x1a140c, shade: 0, caps: ['open', 'flat'] }));
    }
    // The jaw: a chin shell proud of the skull in the middle and sunk into it at the edges.
    const lw = hw + 0.26;
    // Its top is a dark shelf running back into the head (the floor of the mouth).
    const shell = grid(11, 15, (r, j, p, col) => {
      const s = (j / 14) * 2 - 1; const lon = s * lw;
      const top = mouthLat(clamp(lon, -hw, hw));
      if (r === 0) { shape(lon, top, -0.7, p); col.copy(TONGUE); return; }
      if (r === 1) { shape(lon, top, -0.12, p); col.set(0x1a0508); return; }
      const v = (r - 2) / 8;
      const lat = lerp(top, -1.42, v);
      const edge = (1 - sstep(0.7, 1, Math.abs(s))) * (1 - sstep(0.72, 1, v));
      shape(lon, lat, -0.03 + 0.075 * edge, p);
      skinAt(lon, lat, col).multiplyScalar(1 - 0.2 * v);
    });
    jawParts.unshift(faceOut(shell));
  }

  // ---- seam ----
  if (plan.seam) {
    const rings = [];
    const end = m.none ? -0.9 : m.lat + 0.14;
    for (let j = 0; j <= 9; j++) {
      const t = j / 9; const lon = -0.14 + 0.05 * Math.sin(t * 5 + seed); const lat = lerp(1.15, end, t);
      rings.push({ at: shape(lon, lat, 0.004, V()), r: 0.009 });
      fixed.push(place(tint(new THREE.BoxGeometry(0.12, 0.017, 0.017), 0x2a1a14), lon, lat, 0.012, (rand() - 0.5) * 0.7));
    }
    fixed.push(skin(rings, { sides: 4, detail: 1, noise: 0, color: 0x3a1418, shade: 0, caps: 'flat' }));
  }

  // ---- assemble ----
  const group = new THREE.Group();
  const skullAll = merge(fixed);
  bake(skullAll);
  const skull = new THREE.Mesh(opts.extras && opts.extras.length ? merge([skullAll, ...opts.extras]) : skullAll, M.skin);
  skull.castShadow = opts.cast !== false;
  group.add(skull);

  let jaw = null;
  const jawAt = V(hinge.x, hinge.y + CY, hinge.z).multiplyScalar(size);
  if (jawParts.length) {
    const jg = merge(jawParts);
    jg.translate(-hinge.x, -hinge.y, -hinge.z).scale(size, size, size);
    jaw = new THREE.Mesh(jg, M.skin);
    jaw.position.copy(jawAt);
    group.add(jaw);
  }

  let featGeo = merge(moving.map((p) => p.geo));
  bake(featGeo);
  // Wet things (fangs, whiskers, blood) ride the gloss mesh, after the parts that move.
  if (opts.wet && opts.wet.length) featGeo = merge([featGeo, ...opts.wet]);
  featGeo.userData.dynamic = true;
  const features = new THREE.Mesh(featGeo, M.gloss);
  group.add(features);
  const fpos = featGeo.attributes.position; const fnor = featGeo.attributes.normal;
  const basePos = fpos.array.slice(); const baseNor = fnor.array.slice();
  const spans = [];
  let start = 0;
  for (const p of moving) {
    const cnt = p.geo.attributes.position.count;
    if (p.kind !== 'fixed') spans.push({ start, count: cnt, kind: p.kind, eye: p.eye });
    start += cnt;
  }
  for (const info of eyeInfo) {
    info.c.y += CY; info.c.multiplyScalar(size);
    if (info.brow) { info.brow.p.y += CY; info.brow.p.multiplyScalar(size); }
  }

  const state = { jaw: 0, yaw: 0, pitch: 0, bl: 0, br: 0, brow: 0, frown: 0 };
  let drawn = null;
  function redraw() {
    if (jaw) {
      const open = clamp(m.rest + state.jaw * (1 - m.rest));
      jaw.rotation.x = -0.36 * open;
      jaw.position.y = jawAt.y - 0.03 * size * open;
    }
    const key = [state.yaw, state.pitch, state.bl, state.br, state.brow, state.frown];
    if (drawn && key.every((k, i) => Math.abs(k - drawn[i]) < 1e-3)) return;
    drawn = key;
    for (const sp of spans) {
      const info = eyeInfo[sp.eye];
      let pivot = info.c;
      let lift = 0;
      if (sp.kind === 'iris') {
        _q.setFromAxisAngle(info.ey, -state.yaw).multiply(_q2.setFromAxisAngle(info.ex, state.pitch));
      } else if (sp.kind === 'lid') {
        const b = info.e.shut ? 1 : (sp.eye ? state.br : state.bl);
        _q.setFromAxisAngle(info.lx, lerp(info.e.open, -0.9, b));
      } else {
        pivot = info.brow.p;
        _q.setFromAxisAngle(info.brow.n, -info.outer * state.frown * 0.45);
        lift = state.brow * 0.09 * size;
      }
      for (let i = sp.start; i < sp.start + sp.count; i++) {
        _a.fromArray(basePos, i * 3).sub(pivot).applyQuaternion(_q).add(pivot);
        if (lift) _a.addScaledVector(info.brow.u, lift);
        fpos.setXYZ(i, _a.x, _a.y, _a.z);
        _a.fromArray(baseNor, i * 3).applyQuaternion(_q);
        fnor.setXYZ(i, _a.x, _a.y, _a.z);
      }
    }
    fpos.needsUpdate = true; fnor.needsUpdate = true;
  }
  function pose(p = {}) {
    if (p.jaw != null) state.jaw = clamp(p.jaw);
    if (p.look) { state.yaw = clamp(p.look[0], -0.7, 0.7); state.pitch = clamp(p.look[1], -0.5, 0.5); }
    if (p.blink != null) {
      const b = Array.isArray(p.blink) ? p.blink : [p.blink, p.blink];
      state.bl = clamp(b[0]); state.br = clamp(b[1]);
    }
    if (p.brow != null) state.brow = clamp(p.brow, -1, 1);
    if (p.frown != null) state.frown = clamp(p.frown, -1, 1);
    redraw();
  }
  const eyeMid = eyeInfo[0].c.clone().add(eyeInfo[1].c).multiplyScalar(0.5);
  function lookAt(world, limit = 0.45) {
    group.updateWorldMatrix(true, false);
    group.worldToLocal(_b.copy(world)).sub(eyeMid);
    pose({ look: [clamp(Math.atan2(_b.x, -_b.z), -limit, limit), clamp(Math.atan2(_b.y, Math.hypot(_b.x, _b.z)), -limit, limit)] });
  }
  group.rotation.z = -plan.tilt;
  redraw();
  const tris = (g) => g.index.count / 3;
  return {
    group, skull, jaw, features, plan, size,
    centre: V(0, CY * size, 0),
    triangles: tris(skull.geometry) + (jaw ? tris(jaw.geometry) : 0) + tris(featGeo),
    pose, lookAt,
    at: (lon, lat, proud = 0) => { const p = shape(lon, lat, proud, V()); p.y += CY; return p.multiplyScalar(size); },
  };
}

/**
 * grin(opts) -> BufferGeometry. A mouth with no face: two lips, a dark gap and two rows of teeth,
 * facing -Z, centred on the origin. Use materials().gloss.
 *   opts: width (0.6) metres; teeth (20) per row; smile (0.5) how far the corners lift;
 *         lip (0x7a0f14); tooth (0xefe8d4); sharp (true) pointed teeth; seed (1).
 */
export function grin(opts = {}) {
  const o = { width: 0.6, teeth: 20, smile: 0.5, lip: 0x7a0f14, tooth: 0xefe8d4, sharp: true, seed: 1, ...opts };
  const w = o.width; const rand = rng(o.seed + 40);
  const at = (s, dy, out) => out.set(s * w * 0.5, o.smile * w * 0.3 * s * s + dy * (1 - 0.85 * s * s), 0.22 * w * s * s);
  const gap = w * 0.085;
  const parts = [];
  for (const sgn of [1, -1]) {
    const rings = [];
    for (let j = 0; j <= 10; j++) { const s = (j / 10) * 2 - 1; rings.push({ at: at(s, sgn * gap, V()), r: w * 0.03 * (1 - 0.8 * s * s * s * s) + 0.003 }); }
    parts.push(skin(rings, { sides: 5, detail: 1, noise: 0.04, seed: o.seed, color: o.lip, shade: 0.15, capLen: 0.5, side: [0, 1, 0] }));
    for (let t = 0; t < o.teeth; t++) {
      const s = ((t + 0.5) / o.teeth) * 2 - 1;
      const tw = (w / o.teeth) * 0.8; const len = gap * (0.75 + 0.5 * rand()) * (1 - 0.6 * s * s);
      const g = o.sharp ? new THREE.ConeGeometry(tw * 0.5, len, 4) : new THREE.BoxGeometry(tw, len, tw * 0.5);
      if (sgn > 0) g.rotateZ(Math.PI);
      at(s, sgn * (gap - len / 2), _a);
      g.rotateY(-s * 0.4).translate(_a.x, _a.y, _a.z + 0.004);
      parts.push(tint(g, o.tooth, 0.1, t));
    }
  }
  parts.push(grid(2, 9, (r, j, p, col) => { const s = (j / 8) * 2 - 1; at(s, (r ? -1 : 1) * gap, p); p.z += 0.012; col.set(0x0a0206); }));
  return merge(parts);
}

// ---- cloth ----------------------------------------------------------------------------------

/**
 * cloth(opts) -> { mesh, geometry, sway(time, amount = 1, wind = 0), triangles }.
 * A panel of cloth, one mesh: tabard, skirt, coat tail, cape, playing-card body, hat brim. Its
 * top edge is at the mesh's origin and it hangs down -Y, facing -Z; position and rotate `mesh`.
 * sway() is the idle motion (rewrites the vertices; the top edge stays pinned); breathe() calls it.
 *   opts: width (0.6), widthEnd (= width) for a taper or flare, length (0.8), cols (6), rows (8),
 *         budget (400) triangles;
 *         curve (0) radians the panel wraps round the Y axis: 0 is flat, 2*PI a full skirt;
 *         radius (0.3) and flare (0.25) for a wrapped panel (radius grows by flare down its length);
 *         hang ('down' | 'out'): 'out' lays it flat like a hat brim, running outward from
 *         `radius` for `length`, with droop (0.15);
 *         color (0xb3121b); trim (null) hex for a hem band of trimWidth (0.08);
 *         pattern(u, v, color): paint stripes or checks (u 0..1 across, v 0..1 down);
 *         folds (3) and foldDepth (0.03) for drape; tatter (0..1) a ragged hem; dirt (0.15);
 *         stiff (0..1) how little it sways: 0.9 for a card body or a brim; seed (1);
 *         attach: BufferGeometry[] laid on the panel and moved with it (pips, buttons, braid),
 *         authored flat: x across in metres from the centre, y down from 0 to -length, z proud;
 *         give a panel that carries them few folds (folds: 0 or a small foldDepth);
 *         material (materials().cloth); cast (true).
 */
export function cloth(opts = {}) {
  const o = {
    width: 0.6, widthEnd: null, length: 0.8, cols: 6, rows: 8, budget: 400, curve: 0, radius: 0.3, flare: 0.25, hang: 'down',
    droop: 0.15, color: 0xb3121b, trim: null, trimWidth: 0.08, pattern: null, folds: 3, foldDepth: 0.03, tatter: 0, dirt: 0.15,
    stiff: 0, seed: 1, attach: null, material: null, cast: true, ...opts,
  };
  let cols = Math.max(1, o.cols | 0); let rows = Math.max(1, o.rows | 0);
  while (2 * cols * rows > o.budget && (cols > 2 || rows > 2)) { if (rows >= cols && rows > 2) rows--; else cols--; }
  const base = toColor(o.color); const trim = o.trim != null ? toColor(o.trim) : null;
  const we = (o.widthEnd ?? o.width) / o.width;
  const out = o.hang === 'out';
  const curve = out && !o.curve ? TAU : o.curve;
  // The flat panel: x across, y down, z proud.
  const panel = grid(rows + 1, cols + 1, (r, c, p, col) => {
    const u = c / cols; let v = r / rows;
    if (o.tatter && r === rows) v -= o.tatter * 0.22 * hash(c, o.seed, 4.2);
    p.set((u - 0.5) * o.width, -v * o.length, 0);
    col.copy(base);
    if (trim && v > 1 - o.trimWidth) col.copy(trim);
    if (o.pattern) o.pattern(u, v, col);
    col.multiplyScalar((1 + 0.1 * noise(u * 7, v * 7 * (o.length / o.width), 0, o.seed)) * (1 - o.dirt * v * v * (0.6 + 0.4 * hash(c, r, o.seed))));
  });
  const extra = (o.attach || []).map((g) => {
    const c = g.clone();
    if (!c.attributes.color) tint(c, trim || 0xffffff);
    return c.translate(0, 0, 0.004 + 0.6 * o.foldDepth); // clear of the folds between the panel's vertices
  });
  const geometry = extra.length ? merge([panel, ...extra]) : panel;
  const pos = geometry.attributes.position;
  const nv = pos.count;
  const rest = new Float32Array(nv * 3); const dir = new Float32Array(nv * 3); const wgt = new Float32Array(nv); const pha = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    const x = pos.getX(i); const d = pos.getZ(i);
    const u = x / o.width; const v = clamp(-pos.getY(i) / o.length);
    const fold = o.foldDepth * v * (Math.sin(u * o.folds * TAU + o.seed * 1.7) + 0.4 * noise(u * 9, v * 4, 0, o.seed + 2));
    if (out) {
      const ang = u * curve; const rad = o.radius + v * o.length;
      _a.set(Math.sin(ang) * rad, -o.droop * o.length * v * v + fold + d, -Math.cos(ang) * rad);
      _b.set(0, 1, 0);
    } else if (curve > 1e-3) {
      const ang = u * curve; const rad = o.radius * (1 + o.flare * v) + d + fold;
      _a.set(Math.sin(ang) * rad, pos.getY(i), -Math.cos(ang) * rad);
      _b.set(Math.sin(ang), 0, -Math.cos(ang));
    } else {
      _a.set(x * lerp(1, we, v), pos.getY(i), -(d + fold));
      _b.set(0, 0, -1);
    }
    _a.toArray(rest, i * 3); _b.toArray(dir, i * 3);
    pos.setXYZ(i, _a.x, _a.y, _a.z);
    wgt[i] = (1 - o.stiff) * Math.pow(v, 1.4);
    pha[i] = u * 4 + o.seed;
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, o.material || materials().cloth);
  mesh.castShadow = o.cast;
  const amp = 0.045 * o.length;
  let still = true;
  function sway(time, amount = 1, wind = 0) {
    if (amount === 0 && wind === 0 && still) return;
    still = amount === 0 && wind === 0;
    const arr = pos.array;
    for (let i = 0; i < nv; i++) {
      const s = wgt[i] * (amount * amp * (Math.sin(time * 1.3 + pha[i]) + 0.5 * Math.sin(time * 2.9 + pha[i] * 1.7)) + wind * 0.12 * o.length);
      arr[i * 3] = rest[i * 3] + dir[i * 3] * s;
      arr[i * 3 + 1] = rest[i * 3 + 1] + dir[i * 3 + 1] * s;
      arr[i * 3 + 2] = rest[i * 3 + 2] + dir[i * 3 + 2] * s;
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  geometry.userData.dynamic = true;
  return { mesh, geometry, sway, triangles: geometry.index.count / 3 };
}

// ---- wounds and damage ----------------------------------------------------------------------

/**
 * wounds(opts) -> { hit(mesh, worldPoint, size), add(parent, at, out, size), pick(out), clear(), count() }.
 * A figure's wounds: torn dark patches with wet pulp that stay where they land and move with the
 * part they are on, as in the cave. One instanced mesh per wounded part, so a figure costs one
 * draw call per part hit, not per wound. The oldest wound goes when `max` is reached.
 *   opts: max (9); pulp (0x7a0f14); scab (0x12060a); seed (1).
 *   hit(mesh, worldPoint {x,y,z}, size = 0.06): the usual call from a 'hit' event. Finds the
 *         nearest vertex of `mesh` (a skin, skull or cloth mesh, not limbs) and wounds it there.
 *         Returns false if the mesh cannot take one.
 *   add(parent, at, out, size): a wound at local point `at` facing local unit direction `out`.
 *   pick(out: Vector3) -> out | null: a random wound's WORLD position (for drips), or null.
 *   clear(): removes them all (call on respawn or dispose).
 */
export function wounds(opts = {}) {
  const o = { max: 9, pulp: 0x7a0f14, scab: 0x12060a, seed: 1, ...opts };
  const rand = rng(o.seed + 90);
  const geo = (() => {
    const scab = new THREE.CircleGeometry(1, 10);
    const sp = scab.attributes.position;
    for (let i = 1; i < sp.count; i++) {
      const a = Math.atan2(sp.getY(i), sp.getX(i));
      const k = 0.8 + 0.3 * Math.sin(a * 3 + 0.7 + o.seed) + 0.18 * Math.sin(a * 5 + 2);
      sp.setXY(i, sp.getX(i) * k, sp.getY(i) * k);
    }
    const parts = [tint(scab, o.scab)];
    parts.push(tint(new THREE.SphereGeometry(0.42, 7, 5).scale(1, 0.8, 0.3).translate(0.08, -0.05, 0.02), o.pulp, 0.3, o.seed));
    [0.5, 2.4, 4.3].forEach((a, i) => {
      parts.push(tint(new THREE.BoxGeometry(0.06, 0.45 + 0.3 * (i % 2), 0.02).translate(0, 0.95 + 0.15 * (i % 2), 0).rotateZ(a), o.scab));
    });
    return merge(parts);
  })();
  const pools = new Map(); // parent -> InstancedMesh
  const order = []; // { im, idx }, oldest first
  function drop(rec) {
    const im = rec.im; const last = im.count - 1;
    if (rec.idx !== last) {
      im.getMatrixAt(last, _m4); im.setMatrixAt(rec.idx, _m4);
      const moved = order.find((r) => r.im === im && r.idx === last);
      if (moved) moved.idx = rec.idx;
    }
    im.count = last;
    im.instanceMatrix.needsUpdate = true;
  }
  function add(parent, at, out, size = 0.06) {
    if (order.length >= o.max) drop(order.shift());
    let im = pools.get(parent);
    if (!im) {
      im = new THREE.InstancedMesh(geo, materials().wound, o.max);
      im.count = 0;
      im.frustumCulled = false;
      parent.add(im);
      pools.set(parent, im);
    }
    _dummy.position.copy(at).addScaledVector(out, 0.012);
    _dummy.quaternion.setFromUnitVectors(OUT_Z, out).multiply(_q.setFromAxisAngle(OUT_Z, rand() * TAU));
    _dummy.scale.setScalar(size);
    _dummy.updateMatrix();
    im.setMatrixAt(im.count, _dummy.matrix);
    order.push({ im, idx: im.count });
    im.count += 1;
    im.instanceMatrix.needsUpdate = true;
  }
  function hit(mesh, world, size = 0.06) {
    if (!mesh || !mesh.geometry || mesh.isInstancedMesh) return false;
    const p = mesh.geometry.attributes.position; const nr = mesh.geometry.attributes.normal;
    if (!p || !nr) return false;
    mesh.updateWorldMatrix(true, false);
    mesh.worldToLocal(_b.set(world.x, world.y, world.z));
    let best = 0; let bd = Infinity;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i) - _b.x; const dy = p.getY(i) - _b.y; const dz = p.getZ(i) - _b.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    _c.fromBufferAttribute(nr, best).normalize();
    if (_c.lengthSq() < 0.5) _c.set(0, 0, -1);
    add(mesh, _a.fromBufferAttribute(p, best), _c, size);
    return true;
  }
  function pick(out) {
    if (!order.length) return null;
    const rec = order[Math.floor(rand() * order.length)];
    rec.im.getMatrixAt(rec.idx, _m4);
    rec.im.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(_m4).applyMatrix4(rec.im.matrixWorld);
  }
  function clear() {
    for (const [parent, im] of pools) { parent.remove(im); im.dispose(); }
    pools.clear();
    order.length = 0;
  }
  return { hit, add, pick, clear, count: () => order.length };
}

/**
 * scar(mesh, worldPoint, radius = 0.12, opts) -> number of vertices marked. Damage that shows and
 * stays: darkens the vertex colours of `mesh` round a world point and dents the surface in. The
 * geometry is changed, so the mesh must own it (build one per figure, or clone a shared one).
 * Cloth and the head's moving mesh are stained but not dented.
 *   opts: hex (0x2a0a0e) stain colour; strength (0.7); dent (0.25) depth as a share of radius.
 */
export function scar(mesh, world, radius = 0.12, opts = {}) {
  const o = { hex: 0x2a0a0e, strength: 0.7, dent: 0.25, ...opts };
  const g = mesh.geometry; const p = g.attributes.position; const c = g.attributes.color; const nr = g.attributes.normal;
  if (!p || !c || mesh.isInstancedMesh) return 0;
  mesh.updateWorldMatrix(true, false);
  mesh.worldToLocal(_b.set(world.x, world.y, world.z));
  const stain = toColor(o.hex); const dent = g.userData.dynamic || !nr ? 0 : o.dent * radius;
  let hits = 0;
  for (let i = 0; i < p.count; i++) {
    const d = _a.fromBufferAttribute(p, i).distanceTo(_b);
    if (d > radius) continue;
    const k = 1 - sstep(0.3, 1, d / radius);
    _col.fromBufferAttribute(c, i).lerp(stain, o.strength * k);
    c.setXYZ(i, _col.r, _col.g, _col.b);
    if (dent) p.setXYZ(i, _a.x - nr.getX(i) * dent * k, _a.y - nr.getY(i) * dent * k, _a.z - nr.getZ(i) * dent * k);
    hits++;
  }
  if (hits) { c.needsUpdate = true; if (dent) p.needsUpdate = true; }
  return hits;
}

/**
 * drips(parent, n = 3, hex = 0x7a0f14, seed = 1) -> { mesh, step(dt, rate, pick, floorY) }.
 * Beads that fall from a hurt figure, one instanced mesh added to `parent` (the figure's group).
 *   step(dt, rate, pick, floorY): rate is drops per second per bead (0 stops them); pick(out)
 *   writes a start point in the parent's space (for example from wounds().pick, converted with
 *   parent.worldToLocal); floorY is the floor's height in the parent's space.
 */
export function drips(parent, n = 3, hex = 0x7a0f14, seed = 1) {
  const rand = rng(seed + 60);
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 6, 5), new THREE.MeshBasicMaterial({ color: hex }), n);
  mesh.frustumCulled = false;
  const drops = [];
  for (let i = 0; i < n; i++) { drops.push({ t: rand(), from: V(), on: false }); mesh.setMatrixAt(i, _m4.makeScale(0, 0, 0)); }
  parent.add(mesh);
  function step(dt, rate, pick, floorY = 0) {
    drops.forEach((d, i) => {
      if (rate <= 0 && !d.on) return;
      d.t += dt * Math.max(rate, 0.6);
      if (d.t >= 1) { d.t = 0; d.on = rate > 0; if (d.on) pick(d.from); }
      const fall = d.t / Math.max(rate, 0.6);
      const y = d.from.y - 4.9 * fall * fall;
      if (y < floorY) d.on = false;
      if (d.on) { _dummy.position.set(d.from.x, y, d.from.z); _dummy.scale.set(1, 1 + fall * 3, 1); } else _dummy.scale.set(0, 0, 0);
      _dummy.quaternion.identity();
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, step };
}

// ---- idle motion ----------------------------------------------------------------------------

/**
 * breathe(rig, time, o) -> breath (-1 to 1). The per-frame idle: call it once a frame for every
 * figure in view. Cheap (a few transforms, plus the cloth and eye vertices). `time` is seconds
 * from the caller; the kit keeps no clock.
 *   rig: a plain object you make once per figure and keep:
 *     { root?: Object3D   an INNER body group (not the one you move through the world): shifts weight
 *       chest?: Object3D  the torso mesh: swells and settles
 *       head?: the object head() returned: bobs, nods, blinks, eyes drift or follow
 *       cloths?: the objects cloth() returned: sway
 *       seed?: number (0) so two figures never breathe in step; rate?: breaths per second (0.27);
 *       depth?: (1) how deep it breathes }
 *     Rest transforms are read from the parts on the first call, so pose the figure first.
 *     breathe() owns chest.scale, root.rotation.x/z, head.group.position.y and rotation.x/z; it
 *     leaves head.group.rotation.y to you, for turning the head toward the player.
 *   o: amount (1) scales the body motion; 0 is a statue whose eyes still blink and follow;
 *      look (null) a world Vector3 the eyes follow; without it they drift;
 *      blink (true) false to pose the lids yourself; sway (1) cloth sway; wind (0) cloth push.
 */
export function breathe(rig, time, o = {}) {
  const amt = o.amount ?? 1; const seed = rig.seed ?? 0;
  const ph = time * (rig.rate ?? 0.27) * TAU + seed * 2.3;
  const b = 0.8 * Math.sin(ph) + 0.2 * Math.sin(2 * ph + 0.6);
  let B = rig.rest;
  if (!B) {
    B = rig.rest = {};
    if (rig.chest) B.chest = rig.chest.scale.clone();
    if (rig.root) B.root = rig.root.rotation.clone();
    if (rig.head) { B.headY = rig.head.group.position.y; B.head = rig.head.group.rotation.clone(); }
  }
  if (rig.chest) {
    const k = (rig.depth ?? 1) * amt * b;
    rig.chest.scale.set(B.chest.x * (1 + 0.02 * k), B.chest.y * (1 + 0.008 * k), B.chest.z * (1 + 0.035 * k));
  }
  if (rig.root) {
    rig.root.rotation.z = B.root.z + 0.014 * amt * Math.sin(time * 0.43 + seed * 1.3);
    rig.root.rotation.x = B.root.x + 0.008 * amt * Math.sin(time * 0.29 + seed * 2.9);
  }
  const hd = rig.head;
  if (hd) {
    hd.group.position.y = B.headY + 0.012 * hd.size * amt * b;
    hd.group.rotation.x = B.head.x + 0.025 * amt * Math.sin(time * 0.37 + seed * 2.1) - 0.01 * amt * b;
    hd.group.rotation.z = B.head.z + 0.02 * amt * Math.sin(time * 0.23 + seed * 0.7);
    if (o.look) hd.lookAt(o.look);
    else hd.pose({ look: [0.14 * Math.sin(time * 0.31 + seed) + 0.05 * Math.sin(time * 1.7 + seed * 3), 0.05 * Math.sin(time * 0.47 + seed * 3)] });
    if (o.blink !== false) hd.pose({ blink: blinkAt(time, hd.plan, seed) });
  }
  if (rig.cloths) for (const c of rig.cloths) c.sway(time + seed, (o.sway ?? 1) * (0.35 + 0.65 * amt), o.wind ?? 0);
  return b;
}

// ---- glowing eyes ---------------------------------------------------------------------------

let GLOW_TEX = null;
// A soft round falloff, made in code (no canvas, so the kit still loads without a document).
function glowTexture() {
  if (GLOW_TEX) return GLOW_TEX;
  const n = 32; const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - (n - 1) / 2, y - (n - 1) / 2) / (n / 2);
      const k = clamp(1 - d); const a = 0.85 * k * k * k + 0.15 * k;
      const i = (y * n + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = Math.round(255 * a);
    }
  }
  GLOW_TEX = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  GLOW_TEX.magFilter = THREE.LinearFilter; GLOW_TEX.minFilter = THREE.LinearFilter;
  GLOW_TEX.needsUpdate = true;
  return GLOW_TEX;
}

let PUFF_TEX = null;
/**
 * puffTexture() -> DataTexture. One soft, ragged-edged puff of smoke (white, its alpha falling off
 * from the middle), shared. Put it on a camera-facing plane or sprite with depthWrite off.
 */
export function puffTexture() {
  if (PUFF_TEX) return PUFF_TEX;
  const n = 64; const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x - (n - 1) / 2) / (n / 2); const dy = (y - (n - 1) / 2) / (n / 2);
      const a0 = Math.atan2(dy, dx);
      const edge = 0.78 + 0.12 * noise(Math.cos(a0) * 1.6, Math.sin(a0) * 1.6, 0, 7) + 0.06 * noise(dx * 4, dy * 4, 1, 7);
      const k = clamp(1 - Math.hypot(dx, dy) / edge);
      const a = k * k * (3 - 2 * k) * (0.85 + 0.15 * noise(dx * 6, dy * 6, 2, 7));
      const i = (y * n + x) * 4;
      const v = Math.round(255 * (0.9 + 0.1 * k));
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = Math.round(255 * clamp(a));
    }
  }
  PUFF_TEX = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  PUFF_TEX.magFilter = THREE.LinearFilter; PUFF_TEX.minFilter = THREE.LinearFilter;
  PUFF_TEX.needsUpdate = true;
  return PUFF_TEX;
}

/**
 * eyeGlow(head, opts) -> { material, sprites, set(level), dispose() }. Eyes that give off light:
 * a patch to the gloss shader, so the iris colour of the head's `features` mesh is also emitted
 * (the whites, lids and teeth are left alone, and so is anything of the same hue at under half
 * the iris's brightness, such as blood), plus ONE additive sprite in front of each eye for
 * the bloom. Costs no draw call for the patch and one per eye for the sprites. The patched
 * material is this head's own: it replaces head.features.material, and `material` is what to put
 * back after a flash or a death swap.
 *   head: the object head() returned (pass eyes of a strong single hue, e.g. face({ eye: 0xff2a1a })).
 *   opts: color (the first eye's iris colour); strength (0.5) how much of the iris is emitted;
 *         size (0.5) sprite width as a share of the head's size; opacity (0.4) of the sprite;
 *         proud (0.12) how far in front of the eye the sprite floats, as a share of the radius.
 *   set(level): 0 dark, 1 as built, up to about 2.5 for a flare. Cheap; call it every frame if
 *         you pulse it (and hold it steady under reduced flash).
 */
export function eyeGlow(hd, opts = {}) {
  const o = { color: null, strength: 0.5, size: 0.5, opacity: 0.4, proud: 0.12, ...opts };
  const hue = toColor(o.color ?? hd.plan.eyes[0].color).clone();
  const level = { value: o.strength };
  const dir = { value: V(hue.r, hue.g, hue.b).normalize() };
  const bright = { value: Math.max(1e-3, Math.hypot(hue.r, hue.g, hue.b)) };
  const material = materials().gloss.clone();
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = level; sh.uniforms.uGlowHue = dir; sh.uniforms.uGlowBright = bright;
    sh.fragmentShader = `uniform float uGlow;\nuniform vec3 uGlowHue;\nuniform float uGlowBright;\n${sh.fragmentShader}`.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    #ifdef USE_COLOR
      { vec3 vc = vColor.rgb; float len = length(vc);
        float like = 1.0 - smoothstep(0.1, 0.32, distance(vc / max(len, 1e-4), uGlowHue));
        totalEmissiveRadiance += vc * like * smoothstep(0.42, 0.6, len / uGlowBright) * uGlow; }
    #endif`);
  };
  material.customProgramCacheKey = () => 'sculpt-eye-glow';
  hd.features.material = material;
  const spriteMat = new THREE.SpriteMaterial({ map: glowTexture(), color: hue, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: o.opacity, fog: false });
  const sprites = hd.plan.eyes.filter((e) => !e.shut).map((e) => {
    const s = new THREE.Sprite(spriteMat);
    s.position.copy(hd.at(e.lon, e.lat, o.proud));
    s.scale.setScalar(o.size * hd.size);
    hd.group.add(s);
    return s;
  });
  let drawn = 1;
  function set(k) {
    if (Math.abs(k - drawn) < 1e-3) return;
    drawn = k;
    level.value = o.strength * k;
    spriteMat.opacity = Math.min(1, o.opacity * k);
    const sc = o.size * hd.size * (0.7 + 0.3 * Math.min(k, 3));
    for (const s of sprites) { s.scale.setScalar(sc); s.visible = k > 0.01; }
  }
  function dispose() {
    for (const s of sprites) hd.group.remove(s);
    spriteMat.dispose(); material.dispose();
  }
  return { material, sprites, set, dispose };
}

// ---- plants ---------------------------------------------------------------------------------

// Gives a sheet a back: the same faces again, wound the other way, so any material shows both sides.
function bothSides(geo) {
  const back = geo.clone();
  const ix = back.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  geo.computeVertexNormals(); back.computeVertexNormals();
  return merge([geo, back]);
}

/**
 * flower(opts) -> BufferGeometry (indexed, with normal and color). A petalled flower head: a
 * whorl of petals (and a tighter inner whorl) on a green calyx, its base at the origin, opening
 * up +Y. One geometry for a Mesh or an InstancedMesh; both sides of every petal are drawn, so
 * materials().skin will do. A rose, or with `droop` a maze flower hanging its head.
 *   opts: petals (7) in the outer whorl; size (0.07) radius in metres when fully open;
 *         open (0) 0 a shut bud to 1 full blown (a shut head is narrower and a little shorter);
 *         color (0xf3eedf) petal colour, darkening toward `heart` (default: color, 30% darker) at
 *         the base. Pass 0xffffff and tint by instance or material colour to change it live;
 *         calyx (0x4a5d3a) hex, or null for none; inner (true) the inner whorl; detail (2) 1 to 3,
 *         about 210, 300 or 740 triangles (150, 205 or 485 with inner: false); cup (0.5) how cupped each petal is; droop (0) radians
 *         the whole head nods toward -Z; seed (1);
 *         whorls (null): [[count, scale, tiltShut, tiltOpen], ...] from the outside in, in place of
 *         the outer and inner whorl (a rose: three or four, the inner ones staying upright);
 *         morph (false): true also stores the fully open shape as morph target 0 (position and
 *         normal), so mesh.morphTargetInfluences[0] = k opens the head from `open` to 1 (on an
 *         InstancedMesh: setMorphAt). Build with open: 0 for a rose that blooms.
 */
export function flower(opts = {}) {
  const o = { petals: 7, size: 0.07, open: 0, color: 0xf3eedf, heart: null, calyx: 0x4a5d3a, inner: true, detail: 2, cup: 0.5, droop: 0, seed: 1, morph: false, ...opts };
  const n = Math.max(3, o.petals | 0); const d = clamp(o.detail | 0, 1, 3);
  const rows = d + 2; const cols = d === 3 ? 5 : 3;
  const base = toColor(o.color); const heart = o.heart != null ? toColor(o.heart) : base.clone().multiplyScalar(0.7);
  const S = o.size; const y0 = o.calyx != null ? S * 0.3 : 0;
  const p = V();
  function build(open) {
    const parts = [];
    const whorl = (count, scale, tiltShut, tiltOpen, turn, wseed) => {
      for (let i = 0; i < count; i++) {
        const az = (i / count) * TAU + turn + 0.25 * (hash(i, wseed, 1.7) - 0.5);
        const len = S * scale * (1.05 + 0.2 * (hash(i, wseed, 5.3) - 0.5)) * lerp(0.92, 1, open);
        const tilt = lerp(tiltShut, tiltOpen, open) * (1 + 0.18 * (hash(i, wseed, 9.1) - 0.5));
        const k0 = i / count; // outer petals stand a hair proud of the next
        const sheet = grid(rows, cols, (r, c, out, col) => {
          const u = (c / (cols - 1)) * 2 - 1;
          const vv = r / (rows - 1);
          const v = vv - 0.16 * u * u * sstep(0.6, 1, vv); // the tip is round: its corners sit lower
          // Along the petal: it leaves the base nearly upright and leans out further toward the tip,
          // where an open one curls back.
          let rad = S * 0.1 * scale; let y = y0;
          const steps = 6;
          for (let k = 0; k < steps; k++) {
            const t = ((k + 0.5) / steps) * v;
            const th = tilt * (0.3 + 0.7 * t) + 0.75 * open * t * t * t;
            rad += (len * v / steps) * Math.sin(th); y += (len * v / steps) * Math.cos(th);
          }
          const w = S * scale * 0.6 * lerp(0.28, 1, sstep(0, 0.5, vv)) * lerp(1, 0.62, sstep(0.72, 1, vv)) * lerp(0.82, 1, open);
          const wrap = az + (1 - open) * 0.55 * v; // a shut bud's petals lap round one another
          const inward = o.cup * w * u * u * lerp(1.15, 0.55, open);
          const ca = Math.cos(wrap); const sa = Math.sin(wrap);
          p.set(sa * (rad - inward) + ca * u * w, y + 0.012 * S * noise(u * 2, v * 3, i, wseed), -ca * (rad - inward) + sa * u * w);
          if (o.whorls && open < 1) {
            // A rose's bud: each petal wrapped round the axis (its width an arc, not a flat sheet),
            // a teardrop that swells and closes to a point, the outer petals lapping the inner.
            const ba = az + u * (Math.PI / count) * 1.35;
            const br = S * 0.46 * scale * (0.45 + 1.1 * vv - 1.25 * vv * vv) + 0.006 * S * k0;
            const by = y0 + S * scale * 0.72 * vv;
            const bud = _d.set(Math.sin(ba) * br, by, -Math.cos(ba) * br);
            p.lerp(bud, 1 - sstep(0, 1, open));
          }
          out.copy(p);
          col.copy(heart).lerp(base, sstep(0.05, 0.55, v)).multiplyScalar(0.94 + 0.1 * hash(i, r * 7 + c, wseed) - 0.1 * u * u);
        });
        parts.push(bothSides(sheet));
      }
    };
    if (o.whorls) o.whorls.forEach(([count, scale, shut, opened], k) => whorl(count, scale, shut, opened, o.seed + 0.45 * k + (k % 2) * 0.3, o.seed + 31 * k));
    else {
      whorl(n, 1, 0.16, 1.02, o.seed, o.seed);
      if (o.inner) whorl(Math.max(3, Math.ceil(n / 2)), 0.68, 0.06, 0.5, o.seed + 0.6, o.seed + 31);
    }
    if (o.calyx != null) {
      parts.push(tint(new THREE.ConeGeometry(S * 0.2, S * 0.36, 6, 1, true).rotateX(Math.PI).translate(0, S * 0.18, 0), o.calyx, 0.2, o.seed));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + o.seed; const out = lerp(0.2, 0.75, open);
        const g = new THREE.ConeGeometry(S * 0.075, S * 0.42, 3).translate(0, S * 0.21, 0).rotateX(-out).rotateY(-a).translate(Math.sin(a) * S * 0.13, S * 0.28, -Math.cos(a) * S * 0.13);
        parts.push(tint(g, o.calyx, 0.25, o.seed + i));
      }
    }
    const g = merge(parts);
    if (o.droop) g.rotateX(-o.droop);
    g.computeBoundingSphere();
    return g;
  }
  const geo = build(clamp(o.open));
  if (o.morph) {
    const full = build(1);
    geo.morphAttributes.position = [full.attributes.position];
    geo.morphAttributes.normal = [full.attributes.normal];
    geo.morphTargetsRelative = false;
    geo.boundingSphere.radius = Math.max(geo.boundingSphere.radius, full.boundingSphere.radius) * 1.05;
  }
  geo.userData.triangles = geo.index.count / 3;
  return geo;
}

/**
 * branch(opts) -> BufferGeometry (indexed, with normal and color). A fallen branch that forks:
 * it lies on the ground from the origin along -Z, bent, splitting two to four times into lesser
 * limbs, every end broken off blunt or itself forked. Never a straight pointed stick. Scale,
 * turn and instance it freely.
 *   opts: length (1.2) metres along the main limb; forks (3) 2 to 4; r (0.028) radius at the
 *         butt; color (0x4a3a2c) and color2 (0x2a2018) bark; twigs (true) a short twig on each
 *         side limb; lift (0.35) how far the limbs rise off the ground, 0 flat; seed (1).
 *         About 240 (two forks) to 480 (four) triangles.
 */
export function branch(opts = {}) {
  const o = { length: 1.2, forks: 3, r: 0.028, color: 0x4a3a2c, color2: 0x2a2018, twigs: true, lift: 0.35, seed: 1, ...opts };
  const forks = clamp(Math.round(o.forks), 2, 4);
  const rand = rng(o.seed * 13 + 5);
  const parts = [];
  // One limb: from `from` along `dir` for `len`, radius r0 thinning to no less than 45% (a blunt end).
  const limb = (from, dir, len, r0, seed, endCap = 'flat') => {
    const rings = []; const at = from.clone(); const dd = dir.clone().normalize();
    const side = V(-dd.z, 0, dd.x);
    const bend = (rand() - 0.5) * 0.5;
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      rings.push({ at: at.clone(), r: r0 * (1 - 0.5 * t) });
      dd.addScaledVector(side, bend * 0.4).normalize();
      at.addScaledVector(dd, len / 3);
      at.y = Math.max(r0 * 0.6, at.y + (rand() - 0.5) * r0);
    }
    parts.push(skin(rings, { sides: 5, detail: 1, noise: 0.12, rough: 0.12, seed, color: o.color, color2: o.color2, mottle: 0.22, shade: 0.35, caps: ['flat', endCap], capLen: 0.25 }));
    return { end: rings[3].at, dir: dd.clone(), r: r0 * 0.5, pts: rings.map((q) => q.at) };
  };
  const seg = o.length / (forks + 0.6);
  let from = V(0, o.r, 0); let dir = V((rand() - 0.5) * 0.3, 0, -1); let r = o.r; let sgn = rand() < 0.5 ? -1 : 1;
  for (let f = 0; f < forks; f++) {
    const main = limb(from, dir, seg * (0.85 + 0.3 * rand()), r, o.seed + f);
    const last = f === forks - 1;
    // The side limb leaves at the fork; at the last fork the main limb itself splits in two.
    const ang = sgn * (0.5 + 0.45 * rand());
    const sd = V(main.dir.x * Math.cos(ang) - main.dir.z * Math.sin(ang), o.lift * (0.3 + 0.7 * rand()), main.dir.x * Math.sin(ang) + main.dir.z * Math.cos(ang));
    const sideLimb = limb(main.end, sd, seg * (0.55 + 0.4 * rand()) * (last ? 0.8 : 1), main.r * 0.95, o.seed + 20 + f);
    if (o.twigs && !last) {
      const ta = -sgn * (0.6 + 0.3 * rand());
      const td = V(sideLimb.dir.x * Math.cos(ta) - sideLimb.dir.z * Math.sin(ta), 0.2 * o.lift, sideLimb.dir.x * Math.sin(ta) + sideLimb.dir.z * Math.cos(ta));
      limb(sideLimb.pts[2], td, seg * 0.3, sideLimb.r * 0.9, o.seed + 40 + f);
    }
    if (last) {
      const a2 = -sgn * (0.35 + 0.3 * rand());
      const d2 = V(main.dir.x * Math.cos(a2) - main.dir.z * Math.sin(a2), o.lift * 0.4 * rand(), main.dir.x * Math.sin(a2) + main.dir.z * Math.cos(a2));
      limb(main.end, d2, seg * 0.6, main.r * 0.95, o.seed + 60);
    }
    from = main.end; dir = main.dir; r = Math.max(o.r * 0.42, main.r * 1.25); sgn = -sgn;
    dir.x += (rand() - 0.5) * 0.35; dir.y = 0; dir.normalize();
  }
  const geo = merge(parts);
  geo.computeBoundingSphere();
  geo.userData.triangles = geo.index.count / 3;
  geo.userData.forks = forks;
  return geo;
}

/**
 * fallenLeaf(opts) -> BufferGeometry (indexed, with normal and color). One dead leaf lying on the
 * ground: a pointed blade folded along its midrib, its edges curled up and the tip lifted, lying
 * along +Z with its stem end at the origin. Pale and neutral (about white), so an instance colour
 * gives it its brown; the midrib and the rim are darker. One-sided and light: 12 triangles at the
 * default, since the wood lays thousands (give it a DoubleSide material).
 *   opts: length (0.16) metres; width (0.55) as a share of the length; rows (4) along it, more for
 *         a close-up; curl (0.22) how far the edges lift; twist (0.15); seed (1).
 */
export function fallenLeaf(opts = {}) {
  const o = { length: 0.16, width: 0.55, rows: 4, curl: 0.22, twist: 0.15, seed: 1, ...opts };
  const L = o.length; const rows = Math.max(3, o.rows | 0); const cols = 3;
  const g = grid(rows, cols, (r, c, out, col) => {
    const t = r / (rows - 1); const u = c - 1;
    // Outline: a short stem end, widest a little past the middle, drawn to a point.
    const w = r === 0 ? 0.12 : r === rows - 1 ? 0 : Math.sin(Math.PI * Math.min(1, t * 1.08)) ** 0.7;
    const x = u * w * L * o.width * 0.5;
    const z = t * L;
    // Folded at the midrib, the edges curling up, the tip lifting, the blade twisting.
    const y = L * (o.curl * Math.abs(u) * w + 0.07 * t * t + 0.025 * noise(u * 2, t * 3, 0, o.seed)) + o.twist * x * (t - 0.5);
    out.set(x, y + 0.003, z);
    const k = u === 0 ? 0.8 : 1 - 0.12 * sstep(0.7, 1, t);
    col.setRGB(k, k * 0.97, k * 0.92);
  });
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * toadstool(opts) -> BufferGeometry (indexed, with normal and color). A small pale toadstool,
 * its foot at the origin, standing up +Y: a leaning stem, a domed cap with a darker underside.
 * One geometry for an InstancedMesh; vary it by instance scale and turn, or by seed.
 *   opts: height (0.08) metres; cap (0.045) cap radius; color (0xd9d2be) the cap; stem
 *         (0x8d8a82); gills (default: stem, darker); lean (0.18) how far the cap sits off the
 *         foot, as a share of the height; flat (0.5) 0 a tall bell to 1 a flat plate; sides (8);
 *         seed (1). About 110 triangles.
 */
export function toadstool(opts = {}) {
  const o = { height: 0.08, cap: 0.045, color: 0xd9d2be, stem: 0x8d8a82, gills: null, lean: 0.18, flat: 0.5, sides: 8, seed: 1, ...opts };
  const H = o.height; const R = o.cap;
  const a = hash(o.seed, 3.3, 1.1) * TAU;
  const top = V(Math.cos(a) * o.lean * H, H * 0.86, Math.sin(a) * o.lean * H);
  const sr = Math.max(0.004, R * 0.2);
  const parts = [skin([
    { at: [0, 0, 0], r: sr * 1.45 }, { at: [top.x * 0.3, H * 0.3, top.z * 0.3], r: sr }, { at: [top.x * 0.8, H * 0.65, top.z * 0.8], r: sr * 0.85 }, { at: top, r: sr * 0.9 },
  ], { sides: 5, detail: 1, noise: 0.1, seed: o.seed, color: o.stem, mottle: 0.15, shade: 0.2, caps: ['flat', 'open'] })];
  const dome = lerp(0.75, 0.3, clamp(o.flat)) * R * 1.6;
  const gills = o.gills != null ? toColor(o.gills) : toColor(o.stem).clone().multiplyScalar(0.62);
  const capC = toColor(o.color);
  // The cap as a lathe: underside from the stem out to the rim, then over the top.
  const prof = [[sr * 0.9, -0.02 * R], [R * 0.55, -0.1 * R], [R * 0.98, -0.02 * R], [R, 0.06 * R], [R * 0.8, 0.45 * dome], [R * 0.45, 0.85 * dome], [0.001, dome]];
  const cap = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), Math.max(5, o.sides | 0));
  const cp = cap.attributes.position; const col = new Float32Array(cp.count * 3);
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i); const y = cp.getY(i); const z = cp.getZ(i);
    const k = 1 + 0.1 * noise(x * 60, y * 60, z * 60, o.seed);
    cp.setXYZ(i, x * k, y, z * k);
    _col.copy(y < 0.03 * R ? gills : capC).multiplyScalar(0.9 + 0.16 * noise(x * 90, 1, z * 90, o.seed + 2));
    col[i * 3] = _col.r; col[i * 3 + 1] = _col.g; col[i * 3 + 2] = _col.b;
  }
  cap.setAttribute('color', new THREE.BufferAttribute(col, 3));
  cap.computeVertexNormals();
  cap.rotateZ(-Math.cos(a) * o.lean * 0.9).rotateX(Math.sin(a) * o.lean * 0.9).translate(top.x, top.y, top.z);
  parts.push(cap);
  const geo = merge(parts);
  geo.computeBoundingSphere();
  geo.userData.triangles = geo.index.count / 3;
  return geo;
}
