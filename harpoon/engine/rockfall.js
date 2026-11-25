// The Cantor's song brings the Nave's loose stalactites down (logic/cantorsong.js): this draws them.
// Reads sim.waves.song and never writes it. Five instanced meshes hold all the rock, whatever has
// fallen: the stalactites in cave.js's two shapes (hanging, working loose, falling), the broken
// stumps left on the vault with a pale dust stain round each, and the rubble piles on the floor
// (seen only: the rules give them no collision). Five more carry the warning at each of the (at
// most three) stones coming down: a dark shadow growing on the floor, a soft pale-teal glow over
// the same ground that brightens through the last half second, a wide pale-teal ring at the stone's
// reach (self-lit: it reads on a dark floor and on the pools), a pale glint on the loosening stone,
// and grit off the vault. No light is added (the cave's light budget is fixed: the glow is
// additive); nothing is allocated per frame.
//
// Motion (the owner reads it; the art critic, C1, C2, C11): working loose for warn - fall seconds
// (0.8 s: a tremble, a glint and grit falling), then let go: it falls the drawn vault's height to the
// floor in `fall` (0.6 s) under a gravity fitted to that height (its tip lands at the impact, as the
// rules strike), tipping up to about 25 degrees as it goes. The floor's warning grows over the whole
// 1.4 s and brightens through its last half second.

import * as THREE from 'three';
import { glowTexture } from './cave.js';
import { HANGING, LOOSENING, FALLING, DOWN } from '../logic/cantorsong.js';
import { WAYOUT, strikeAt, rimOf, rimDrop, RIM_FALL, holeOpen, holeEdge } from '../logic/wayout.js';
import { MOUTHS, pathOf } from '../logic/journey.js';
import { laneFloor } from '../logic/rubble.js';

const TIP = 25 * Math.PI / 180; // the most a falling stone tips over before it lands
const TEAL = new THREE.Color(0x9fe8c8); // the cave's own pale teal (the singing rings', the foxfire's kin)
const smooth = (k) => { const u = Math.max(0, Math.min(1, k)); return u * u * (3 - 2 * u); };

/** A broken stump: the stalactite's own root (cave.js profile) snapped off in long, uneven teeth. */
function stumpGeometry() {
  const S = 9;
  const rows = [[1.1, 0.05], [0.72, -0.07], [0.53, -0.16]];
  const pos = [];
  const ring = (r, y, a) => [Math.cos(a) * r, y, Math.sin(a) * r];
  const teeth = [];
  for (let i = 0; i < S; i++) {
    const hi = i % 2 === 0;
    const jag = 0.5 + 0.5 * Math.sin(i * 2.7 + 0.6);
    // the long teeth reach down past a third of the old stone; the short ones barely below the break
    teeth.push(ring(hi ? 0.24 + 0.08 * jag : 0.44, hi ? -0.36 - 0.16 * jag : -0.2 - 0.04 * jag, ((i + 0.5 * jag - 0.25) / S) * Math.PI * 2));
  }
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...b, ...d, ...c);
  for (let k = 0; k < rows.length - 1; k++) {
    for (let i = 0; i < S; i++) {
      const a0 = (i / S) * Math.PI * 2;
      const a1 = ((i + 1) / S) * Math.PI * 2;
      quad(ring(rows[k][0], rows[k][1], a0), ring(rows[k][0], rows[k][1], a1), ring(rows[k + 1][0], rows[k + 1][1], a0), ring(rows[k + 1][0], rows[k + 1][1], a1));
    }
  }
  const last = rows[rows.length - 1];
  for (let i = 0; i < S; i++) {
    const a0 = (i / S) * Math.PI * 2;
    const a1 = ((i + 1) / S) * Math.PI * 2;
    quad(ring(last[0], last[1], a0), ring(last[0], last[1], a1), teeth[i], teeth[(i + 1) % S]);
  }
  // the broken face: a shallow, uneven cone up into the stump from the teeth, turned to the floor (it catches the light from below)
  const core = [0.04, -0.17, -0.03];
  for (let i = 0; i < S; i++) pos.push(...teeth[(i + 1) % S], ...teeth[i], ...core);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals(); // faceted: every face its own
  return g;
}

/** A small pile of broken rock about 0.9 m across and 0.25 m high: a few angular shards, merged (fresh breaks, not water-worn). */
function pileGeometry() {
  const parts = [[0, 0.06, 0, 0.17, 0.13], [0.22, 0.04, 0.08, 0.12, 0.09], [-0.18, 0.03, 0.14, 0.11, 0.08],
    [0.05, 0.03, -0.24, 0.1, 0.07], [-0.12, 0.02, -0.12, 0.08, 0.06], [0.3, 0.015, -0.16, 0.06, 0.05], [-0.33, 0.015, -0.05, 0.06, 0.04]];
  const pos = [];
  const nor = [];
  const m = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  // one shard: a twenty-sided chunk knocked out of true, its faces flat
  const src = new THREE.IcosahedronGeometry(1, 0);
  const sp = src.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    v.fromBufferAttribute(sp, i);
    const k = 0.75 + 0.45 * (0.5 + 0.5 * Math.sin(v.x * 5.1 + v.y * 3.7 + v.z * 2.3));
    sp.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  src.computeVertexNormals();
  const P = src.attributes.position;
  const N = src.attributes.normal;
  parts.forEach(([x, y, z, r, h], k) => {
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(k * 1.3, k * 2.1, k * 0.7)), new THREE.Vector3(r, h, r * 0.9));
    nm.getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/** A round canvas texture: `stops` [[at, 'rgba(...)'], ...] from the middle out. */
function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [k, col] of stops) grad.addColorStop(k, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The dust stain round a stump: a pale smear on the vault, longer one way than the other, soft and broken at its edge. */
function stainTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const a = i * 2.399963;
    const d = 6 + 34 * ((i * 0.618) % 1);
    const x = 64 + Math.cos(a) * d * 0.55;
    const y = 64 + Math.sin(a) * d;
    const r = 10 + 16 * ((i * 0.37) % 1);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.22)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * cave: buildCave's handle (its rock, ceilAt, floorAt, zone). cfg: the cave's (its song's
 * stalactites and timings). Returns { group, update(sim, dt, time), setReducedFlash(on) }.
 */
export function createRockfall(cave, cfg) {
  const c = cfg.song;
  const list = c.stalactites;
  const n = list.length;
  const group = new THREE.Group();
  group.name = 'cave:rockfall';
  cave.group.add(group);
  const { spikeGeos, spikeMat, waterY } = cave.rock;

  // Where each hangs in the drawn rock: its shape's mesh and its place in it, its turn and tilt, its
  // tone (the old ones' pale lantern green to dark), and the axis it tips over on as it falls.
  const counts = [0, 0];
  const at = list.map((s, i) => {
    const root = cave.ceilAt(s.x, s.z);
    const floor = cave.floorAt(s.x, s.z);
    const a = i * 2.399963;
    const k = s.tone;
    const shape = s.shape || 0;
    return {
      x: s.x, z: s.z, root, floor, len: s.len, r: s.r, shape, slot: counts[shape]++, rx: s.rx || 0, rz: s.rz || 0,
      ry: a % (Math.PI * 2), tx: Math.cos(a * 1.7), tz: Math.sin(a * 1.7), k, tone: new THREE.Color(k * 0.9, k, k * 0.98),
    };
  });
  const dummy = new THREE.Object3D();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const mesh = (geo, mat, count) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    m.frustumCulled = false;
    m.receiveShadow = true;
    m.castShadow = false; // (the critic, C4: no shadow cast from one onto the next)
    group.add(m);
    return m;
  };
  const hangs = [mesh(spikeGeos[0], spikeMat, counts[0]), mesh(spikeGeos[1], spikeMat, counts[1])];
  // the stumps' fresh break: a pale, faintly self-lit stone of its own (the critic, C5: it catches what light
  // there is, where the weathered vault round it does not), flat-faced so each tooth reads
  const stumps = mesh(stumpGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, emissive: 0x2a3430, flatShading: true }), n);
  const piles = mesh(pileGeometry(), spikeMat, n);
  const stainGeo = new THREE.CircleGeometry(1, 20).rotateX(Math.PI / 2); // facing down, from under the vault
  const stains = mesh(stainGeo, new THREE.MeshBasicMaterial({ map: stainTexture(), color: 0xd4dccb, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), n);
  stains.receiveShadow = false;
  // the break is fresh: the stump's and the pile's rock much paler than the weathered vault's
  const fresh = new THREE.Color();
  at.forEach((p, i) => {
    hangs[p.shape].setColorAt(p.slot, p.tone);
    stumps.setColorAt(i, fresh.setRGB(0.42, 0.47, 0.43).multiplyScalar(0.75 + 0.35 * p.k));
    piles.setColorAt(i, fresh.copy(p.tone).multiplyScalar(1.6));
  });
  const setHang = (p, m) => hangs[p.shape].setMatrixAt(p.slot, m);

  const hangAt = (p) => {
    dummy.position.set(p.x, p.root + 0.12, p.z);
    dummy.rotation.set(p.rx, p.ry, p.rz);
    dummy.scale.set(p.r, p.len + 0.12, p.r);
    dummy.updateMatrix();
    return dummy.matrix;
  };
  // a stump: the root and its teeth, about a hand to a forearm long whatever the stone was
  const stumpAt = (p) => {
    dummy.position.set(p.x, p.root + 0.12, p.z);
    dummy.rotation.set(p.rx, p.ry, p.rz);
    dummy.scale.set(p.r * 1.25, Math.min(0.95, Math.max(0.7, p.len * 0.5 + 0.3)), p.r * 1.25);
    dummy.updateMatrix();
    return dummy.matrix;
  };
  const stainAt = (p) => {
    dummy.position.set(p.x, p.root - 0.03, p.z);
    dummy.rotation.set(0, p.ry * 2.3, 0);
    dummy.scale.set(0.45, 1, 0.45);
    dummy.updateMatrix();
    return dummy.matrix;
  };

  // The warning, one each for the (at most three) coming down at once.
  const SLOTS = 3;
  const flat = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const shadow = new THREE.InstancedMesh(flat, new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(0,0,0,0.78)'], [0.7, 'rgba(0,0,0,0.6)'], [1, 'rgba(0,0,0,0)']]),
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }), SLOTS);
  shadow.frustumCulled = false;
  group.add(shadow);
  // the soft glow over the ground it will strike: additive, so it shows on the dark floor and the black pools
  const disc = new THREE.InstancedMesh(flat, new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(255,255,255,0.75)'], [0.6, 'rgba(255,255,255,0.45)'], [0.9, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3,
  }), SLOTS);
  disc.frustumCulled = false;
  group.add(disc);
  // the ring at its reach: a band about 0.15 m wide at the 1.1 m radius
  const rimGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
  // one rim each for the warnings (0 .. SLOTS-1), and one each after them for the ring of dust a landing throws out
  const rim = new THREE.InstancedMesh(rimGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), SLOTS * 2);
  rim.frustumCulled = false;
  group.add(rim);
  const tone = new THREE.Color();
  for (let k = 0; k < SLOTS; k++) { shadow.setMatrixAt(k, ZERO); disc.setMatrixAt(k, ZERO); disc.setColorAt(k, tone.setRGB(0, 0, 0)); }
  for (let k = 0; k < SLOTS * 2; k++) { rim.setMatrixAt(k, ZERO); rim.setColorAt(k, tone.setRGB(0, 0, 0)); }
  const RING_LIFE = 0.55; // seconds the landing's ring of dust takes to spread and fade
  const rings = [];
  for (let k = 0; k < SLOTS; k++) rings.push({ x: 0, y: 0, z: 0, t: RING_LIFE });
  let ringNext = 0;
  // the glint: a chip of fresh rock catching the light where the loosening stone meets the vault
  const glintPos = new Float32Array(SLOTS * 3).fill(-50);
  const glintGeo = new THREE.BufferGeometry();
  glintGeo.setAttribute('position', new THREE.BufferAttribute(glintPos, 3));
  const glintMat = new THREE.PointsMaterial({ map: glowTexture(), color: 0xe6fff2, size: 0.45, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const glint = new THREE.Points(glintGeo, glintMat);
  glint.frustumCulled = false;
  group.add(glint);

  // Dust: grit trickling off the vault as a stone works loose, a puff where it lets go, a burst where it lands.
  const MOTES = 200;
  const mpos = new Float32Array(MOTES * 3).fill(-50);
  const mvel = new Float32Array(MOTES * 3);
  const mlife = new Float32Array(MOTES);
  const mfloor = new Float32Array(MOTES);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(mpos, 3));
  // grit catching what light there is: additive and pale, so it reads against the dark vault (a glow, not a light)
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xeef6ec, size: 0.12, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.frustumCulled = false;
  group.add(dust);
  let mnext = 0;
  function mote(x, y, z, vx, vy, vz, life, floor) {
    const i = mnext;
    mnext = (mnext + 1) % MOTES;
    mpos[i * 3] = x; mpos[i * 3 + 1] = y; mpos[i * 3 + 2] = z;
    mvel[i * 3] = vx; mvel[i * 3 + 1] = vy; mvel[i * 3 + 2] = vz;
    mlife[i] = life; mfloor[i] = floor;
  }

  // What each instance shows now: -1 not yet drawn, else the state it was drawn in (the falling redraw each frame).
  const drawn = new Int8Array(n).fill(-1);
  const prev = new Int8Array(n).fill(HANGING);
  // The way up: 1 the vault's rock gone with the hole, 2 its rubble under the heap; 4 a rim stone falling with the vault
  const hidden = new Uint8Array(n);
  const over = new Float32Array(n); // a rim stone's distance beyond the hole's edge
  const inside = new Float32Array(n).fill(Infinity); // a stone inside the edge: how far from the middle (gone as the bore reaches it)
  let lastSong = null;
  const mask = { x: NaN, z: NaN, phase: -1 }; // the way out the mask was made for, and its phase
  let reduced = false;
  let trickle = 0;

  /**
   * The hole and the heap: what of the loose rock the way up takes. A stone whose root lies inside
   * the hole's ragged edge goes as the bore reaches it; one just beyond the edge falls with the vault
   * (logic rimDrop, as passages.js drops the old ones); the heap buries the piles under it.
   */
  function maskOf(sim) {
    const w = sim.waves;
    const o = w && w.wayout && w.wayout.kind === 'vault' ? w.wayout : null;
    const sc = w && w.scene && w.scene.kind === 'vault' ? w.scene : null;
    // phase: 0 none, 1 the scene playing, 3 the scene over
    const phase = !o ? 0 : sc ? 1 : 3;
    if (phase === mask.phase && (!o || (o.x === mask.x && o.z === mask.z))) return false;
    mask.phase = phase; mask.x = o ? o.x : NaN; mask.z = o ? o.z : NaN;
    hidden.fill(0);
    inside.fill(Infinity);
    if (!o) return true;
    const r = MOUTHS.cave.r;
    const path = phase === 3 ? pathOf(sim) : null;
    for (let i = 0; i < n; i++) {
      const p = at[i];
      const q = rimOf(p.x - o.x, p.z - o.z, r);
      if (q.inside) { inside[i] = Math.hypot(p.x - o.x, p.z - o.z); if (phase === 3) hidden[i] |= 1; }
      else if (q.rim) { over[i] = q.over; hidden[i] |= phase === 3 ? 1 : 4; }
      if (Math.hypot(p.x - o.x, p.z - o.z) <= r + WAYOUT.cave.clear + 0.4 || (path && (laneFloor(path, p.x, p.z) != null
        || laneFloor(path, p.x + 0.9, p.z) != null || laneFloor(path, p.x - 0.9, p.z) != null
        || laneFloor(path, p.x, p.z + 0.9) != null || laneFloor(path, p.x, p.z - 0.9) != null))) hidden[i] |= 2;
    }
    return true;
  }

  function draw(i, st) {
    const p = at[i];
    const h = hidden[i];
    setHang(p, st <= LOOSENING && !(h & 1) ? hangAt(p) : ZERO);
    stumps.setMatrixAt(i, st >= FALLING && !(h & 1) ? stumpAt(p) : ZERO);
    stains.setMatrixAt(i, st >= FALLING && !(h & 1) ? stainAt(p) : ZERO);
    piles.setMatrixAt(i, st === DOWN && !(h & 2) ? pileAt(p) : ZERO);
    drawn[i] = st;
  }
  function pileAt(p) {
    dummy.position.set(p.x, p.floor - 0.02, p.z);
    dummy.rotation.set(0, p.ry * 1.7, 0);
    const k = Math.max(0.8, Math.min(1.35, p.len));
    dummy.scale.set(k, k, k);
    dummy.updateMatrix();
    return dummy.matrix;
  }

  /** During the way-up scene: the stones round the hole go as the bore reaches them, or fall with the vault. */
  function poseHole(sim) {
    const w = sim.waves;
    const sc = w.scene;
    const o = w.wayout;
    const bt = sc.t - strikeAt('vault');
    const open = holeOpen(sc, sc.t) * MOUTHS.cave.r;
    let dirty = false;
    for (let i = 0; i < n; i++) {
      const p = at[i];
      const st = drawn[i];
      if (inside[i] < Infinity) {
        // gone once the bore's edge has passed it (the edge's own ragged reach there)
        const gone = bt >= 0 && open * holeEdge(Math.atan2(p.z - o.z, p.x - o.x)) >= inside[i] - RIM_FALL.inside;
        const want = gone ? 1 : 0;
        if ((hidden[i] & 1) !== want) { hidden[i] = (hidden[i] & ~1) | want; draw(i, st < 0 ? HANGING : st); dirty = true; }
      } else if (hidden[i] & 4) {
        const drop = bt >= 0 ? rimDrop(over[i], bt) : 0;
        if (st > LOOSENING) continue;
        if (drop > 0 && p.root - drop < RIM_FALL.gone) { setHang(p, ZERO); dirty = true; continue; }
        dummy.position.set(p.x, p.root + 0.12 - drop, p.z);
        dummy.rotation.set(p.rx + 0.4 * Math.min(1, drop / 4) * p.tx, p.ry, p.rz + 0.4 * Math.min(1, drop / 4) * p.tz);
        dummy.scale.set(p.r, p.len + 0.12, p.r);
        dummy.updateMatrix();
        setHang(p, dummy.matrix);
        dirty = true;
      }
    }
    return dirty;
  }

  function update(sim, dt, time) {
    const song = sim && sim.cfg && sim.cfg.room === 'cave' && sim.waves ? sim.waves.song : null;
    // Only the Nave and the tunnel into it see the loose rock.
    group.visible = cave.zone >= 3;
    let dirty = false;
    if (song !== lastSong) { lastSong = song; drawn.fill(-1); prev.fill(HANGING); mask.phase = -1; }
    if (sim && maskOf(sim)) drawn.fill(-1);
    const state = song ? song.state : null;
    for (let i = 0; i < n; i++) {
      const st = state ? state[i] : HANGING;
      if (st === DOWN && prev[i] !== DOWN && prev[i] !== HANGING && dt > 0) landed(at[i]);
      prev[i] = st;
      if (drawn[i] === st && st !== LOOSENING && st !== FALLING) continue;
      draw(i, st);
      dirty = true;
    }
    if (mask.phase === 1 && poseHole(sim)) dirty = true;
    // The stones coming down now: the tremble and glint, the fall, and each one's warning on the floor.
    const lead = c.warn - c.fall;
    for (let k = 0; k < SLOTS; k++) {
      const d = song && song.drops[k];
      if (!d || d.i < 0) {
        shadow.setMatrixAt(k, ZERO); disc.setMatrixAt(k, ZERO); rim.setMatrixAt(k, ZERO);
        glintPos[k * 3 + 1] = -50;
        continue;
      }
      const p = at[d.i];
      const h = hidden[d.i];
      const tf = d.t - lead;
      if (tf < 0) {
        // working loose: a tremble on its root, a pale chip glinting where it parts from the vault, grit off the vault
        const w = (reduced ? 0.012 : 0.025) * Math.sin(time * 47 + k);
        dummy.position.set(p.x, p.root + 0.12, p.z);
        dummy.rotation.set(p.rx + w * p.tx, p.ry, p.rz + w * p.tz);
        dummy.scale.set(p.r, p.len + 0.12, p.r);
        dummy.updateMatrix();
        if (!(h & 1)) setHang(p, dummy.matrix);
        glintPos[k * 3] = p.x + p.r * 0.5 * p.tx; glintPos[k * 3 + 1] = p.root - 0.08; glintPos[k * 3 + 2] = p.z + p.r * 0.5 * p.tz;
        trickle += dt * 55;
        while (trickle >= 1 && dt > 0) {
          trickle -= 1;
          const a = Math.random() * Math.PI * 2;
          const rr = Math.random() * p.r * 1.2;
          mote(p.x + Math.cos(a) * rr, p.root - 0.05 - Math.random() * 0.3, p.z + Math.sin(a) * rr, 0, -0.5 - Math.random() * 0.9, 0, 1.8, Math.max(p.floor, waterY));
        }
      } else {
        glintPos[k * 3 + 1] = -50;
        if (!(h & 1)) {
          // falling: the tip reaches the floor at the impact, tipping as it goes
          const g = (2 * Math.max(0.5, p.root - p.len - p.floor)) / (c.fall * c.fall);
          const u = Math.min(1, tf / c.fall);
          const drop = 0.5 * g * tf * tf;
          const tip = TIP * u * u;
          dummy.position.set(p.x, p.root + 0.12 - drop, p.z);
          dummy.rotation.set(p.rx + tip * p.tx, p.ry, p.rz + tip * p.tz);
          dummy.scale.set(p.r, p.len + 0.12, p.r);
          dummy.updateMatrix();
          setHang(p, dummy.matrix);
          // grit streaming off it as it falls: the line of its fall reads even where the rock is dark
          if (dt > 0) {
            const v = g * tf;
            for (let m = 0; m < (reduced ? 1 : 3); m++) {
              const y0 = p.root + 0.12 - drop - Math.random() * p.len * 0.8;
              mote(p.x + (Math.random() - 0.5) * p.r, y0, p.z + (Math.random() - 0.5) * p.r, 0, -v * 0.35, 0, 0.45, Math.max(p.floor, waterY));
            }
          }
          if (prev[d.i] === FALLING && tf < dt + 1e-6 && dt > 0) {
            for (let m = 0; m < 10; m++) { const a = m * 0.628; mote(p.x + Math.cos(a) * p.r, p.root - 0.1, p.z + Math.sin(a) * p.r, Math.cos(a) * 0.5, -0.2, Math.sin(a) * 0.5, 1.2, Math.max(p.floor, waterY)); }
          }
        }
      }
      // the floor: a dark shadow and a soft pale-teal glow growing from a small spot to the stone's
      // reach over the whole warning, inside the ring at its reach; the glow and the ring brighten
      // through the last half second (the ring to 0.45 and more)
      const s = smooth(d.t / c.warn);
      const late = smooth((d.t - (c.warn - 0.5)) / 0.5);
      const R = 0.25 + (c.radius - 0.25) * s;
      const y = Math.max(p.floor, waterY) + 0.02;
      dummy.position.set(p.x, y, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(R, 1, R);
      dummy.updateMatrix();
      shadow.setMatrixAt(k, dummy.matrix);
      dummy.position.y = y + 0.004;
      dummy.updateMatrix();
      disc.setMatrixAt(k, dummy.matrix);
      const pulse = reduced ? 1 : 0.88 + 0.12 * Math.sin(time * 9);
      const gd = (0.05 + 0.1 * s + (reduced ? 0.12 : 0.2) * late) * pulse;
      disc.setColorAt(k, tone.copy(TEAL).multiplyScalar(gd));
      dummy.position.y = y + 0.008;
      dummy.scale.set(c.radius, 1, c.radius);
      dummy.updateMatrix();
      rim.setMatrixAt(k, dummy.matrix);
      const f = (0.16 + 0.1 * s + (reduced ? 0.22 : 0.3) * late) * smooth(d.t / 0.25) * pulse;
      rim.setColorAt(k, tone.copy(TEAL).multiplyScalar(f));
      dirty = true;
    }
    // the glint twinkles while any stone works loose (steady under reduced flash)
    glintMat.opacity = reduced ? 0.55 : 0.55 + 0.35 * Math.abs(Math.sin(time * 11));
    glintGeo.attributes.position.needsUpdate = true;
    if (dirty) {
      hangs[0].instanceMatrix.needsUpdate = true;
      hangs[1].instanceMatrix.needsUpdate = true;
      stumps.instanceMatrix.needsUpdate = true;
      stains.instanceMatrix.needsUpdate = true;
      piles.instanceMatrix.needsUpdate = true;
    }
    // the landings' rings of dust, spreading out low over the floor and fading
    for (let k = 0; k < SLOTS; k++) {
      const q = rings[k];
      if (q.t >= RING_LIFE) { rim.setMatrixAt(SLOTS + k, ZERO); continue; }
      q.t += dt;
      const u = Math.min(1, q.t / RING_LIFE);
      const R = c.radius * (0.6 + 1.1 * smooth(u));
      dummy.position.set(q.x, q.y + 0.04, q.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(R, 1, R);
      dummy.updateMatrix();
      rim.setMatrixAt(SLOTS + k, dummy.matrix);
      const f = (reduced ? 0.12 : 0.28) * (1 - u);
      rim.setColorAt(SLOTS + k, tone.setRGB(f, f * 0.97, f * 0.9));
    }
    shadow.instanceMatrix.needsUpdate = true;
    disc.instanceMatrix.needsUpdate = true;
    disc.instanceColor.needsUpdate = true;
    rim.instanceMatrix.needsUpdate = true;
    rim.instanceColor.needsUpdate = true;
    // dust: falls, settles, fades out by being put away
    if (dt > 0) {
      for (let i = 0; i < MOTES; i++) {
        if (mlife[i] <= 0) continue;
        mlife[i] -= dt;
        mvel[i * 3 + 1] -= 2.2 * dt; // grit drifts down slower than the stone (air)
        mpos[i * 3] += mvel[i * 3] * dt; mpos[i * 3 + 1] += mvel[i * 3 + 1] * dt; mpos[i * 3 + 2] += mvel[i * 3 + 2] * dt;
        mvel[i * 3] *= 1 - 1.5 * dt; mvel[i * 3 + 2] *= 1 - 1.5 * dt;
        if (mpos[i * 3 + 1] < mfloor[i]) { mpos[i * 3 + 1] = mfloor[i]; mvel[i * 3 + 1] = 0; }
        if (mlife[i] <= 0) mpos[i * 3 + 1] = -50;
      }
      dustGeo.attributes.position.needsUpdate = true;
    }
  }

  /** It lands: a burst of dust low and outward, and a ring of it over the floor. */
  function landed(p) {
    const y = Math.max(p.floor, waterY) + 0.05;
    const q = rings[ringNext];
    ringNext = (ringNext + 1) % SLOTS;
    q.x = p.x; q.y = y; q.z = p.z; q.t = 0;
    const N = reduced ? 12 : 30;
    for (let m = 0; m < N; m++) {
      const a = (m / N) * Math.PI * 2 + Math.random() * 0.3;
      const s = 0.8 + Math.random() * 1.4;
      mote(p.x, y, p.z, Math.cos(a) * s, 0.6 + Math.random() * 1.6, Math.sin(a) * s, 0.9 + Math.random() * 0.6, y - 0.04);
    }
  }

  return { group, update, setReducedFlash(on) { reduced = !!on; } };
}
