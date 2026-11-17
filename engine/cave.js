// The cave scene: fog, far lights and their one shadow map, and a rock shell grown from the
// cave field (logic/cavemap.js): one continuous skin of floor, leaning walls and domed ceiling
// with bedding ledges, scree, rock columns, stalactites, fungus, standing water, drips and
// veils. Built once from the room config; dressing is drawn for the occupied zone and its
// neighbours. The rock face follows the field's zero line, just outside the collision cells.

import * as THREE from 'three';
import { makeRng } from '../logic/rng.js';
import { caveField, ceilingAt, spaceIndexAt, noise2, noise3, BOUNDS, placePools, bowlAt, CAVE_SEED } from '../logic/cavemap.js';

export const CAVE = {
  trench: 0x05070a, basalt: 0x161b21, indigo: 0x232a44, bone: 0xb9b4a2,
  foxfire: 0xb6ff9e, pink: 0xff4f8b, salt: 0xf4f1e6,
};

// Light levels (three r170 physical units), kept together for tuning.
const HEMI = 0.15 * Math.PI;
const FAR_LIGHT = 70; // spot candela
const FAR_REACH = 38;
const FUNGUS_LIGHT = 9;
const FUNGUS_REACH = 9;
const SHADOW_SIZES = [0, 512, 1024]; // indexed by shadow level; 0 is off
const LOW_FPS = 45;
const LOW_FPS_HOLD = 3; // seconds under LOW_FPS before one step down

/** Concatenates geometries (made non-indexed) keeping the attributes they all share. */
export function mergeGeometries(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = ['position', 'normal', 'uv', 'color'].filter((n) => parts.every((p) => p.attributes[n]));
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = parts[0].attributes[n].itemSize;
    const total = parts.reduce((s, p) => s + p.attributes[n].count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const p of parts) {
      arr.set(p.attributes[n].array, o);
      o += p.attributes[n].count * size;
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

/** Gives a geometry one flat vertex colour (for the shared vertex-coloured materials). */
export function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

/** Soft round sprite texture, white centre to clear edge. */
export function glowTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Tiling canvas noise: every blob is drawn at its wrapped positions so the edges match.
function noiseCanvas(rng, size, base, blobs) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (const b of blobs) {
    for (let i = 0; i < b.n; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const r = b.min + rng() * (b.max - b.min);
      const col = b.colors[Math.floor(rng() * b.colors.length)];
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
          const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          grad.addColorStop(0, col);
          grad.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
          g.fillStyle = grad;
          g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Rock is textured by world position, so instanced boxes of any size share one noise field.
function worldUV(mat, scale) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      {
        vec4 wuvP = vec4( position, 1.0 );
        vec3 wuvN = normal;
        #ifdef USE_INSTANCING
          wuvP = instanceMatrix * wuvP;
          wuvN = mat3( instanceMatrix ) * wuvN;
        #endif
        wuvP = modelMatrix * wuvP;
        wuvN = abs( normalize( mat3( modelMatrix ) * wuvN ) );
        vec2 wuv = wuvN.y > 0.6 ? wuvP.xz : ( wuvN.x > wuvN.z ? wuvP.zy : wuvP.xy );
        #ifdef USE_MAP
          vMapUv = wuv * ${scale.toFixed(3)};
        #endif
        #ifdef USE_BUMPMAP
          vBumpMapUv = wuv * ${scale.toFixed(3)};
        #endif
      }`);
  };
  mat.customProgramCacheKey = () => `wuv${scale}`;
  return mat;
}


const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Rock skin: colour and bump are sampled along all three world axes and blended by the
// surface normal, so the texture never stretches or shows a seam where a wall turns.
function triplanar(mat, scale) {
  const S = scale.toFixed(3);
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvTriNor = mat3( modelMatrix ) * objectNormal;');
    const pars = THREE.ShaderChunk.bumpmap_pars_fragment.replace(
      /vec2 dHdxy_fwd\(\) \{[\s\S]*?return vec2\( dBx, dBy \);\s*\}/,
      `vec2 dHdxy_fwd() {
        float Hll = bumpScale * triTex( bumpMap, vTriPos ).x;
        float dBx = bumpScale * triTex( bumpMap, vTriPos + dFdx( vTriPos ) ).x - Hll;
        float dBy = bumpScale * triTex( bumpMap, vTriPos + dFdy( vTriPos ) ).x - Hll;
        return vec2( dBx, dBy );
      }`,
    );
    if (!pars.includes('triTex')) console.warn('cave: bump chunk changed; rock bump falls back to plain UVs');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTriPos;
        varying vec3 vTriNor;
        vec4 triTex( sampler2D t, vec3 p ) {
          vec3 w = pow( abs( normalize( vTriNor ) ), vec3( 4.0 ) );
          w /= ( w.x + w.y + w.z );
          return texture2D( t, p.zy * ${S} ) * w.x + texture2D( t, p.xz * ${S} ) * w.y + texture2D( t, p.xy * ${S} ) * w.z;
        }`)
      .replace('#include <bumpmap_pars_fragment>', pars)
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n diffuseColor *= triTex( map, vTriPos );\n#endif');
  };
  mat.customProgramCacheKey = () => `tri${S}`;
  return mat;
}

function boulderGeometry(rng) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const a = rng() * 6;
  const b = rng() * 6;
  const c = rng() * 6;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Deterministic in position, so the duplicated face vertices stay welded. Peak 1.35.
    const k = 1 + 0.16 * Math.sin(v.x * 3.1 + a) * Math.cos(v.y * 2.7 + b)
      + 0.12 * Math.sin(v.z * 4.3 + c) + 0.07 * Math.sin((v.x + v.y + v.z) * 7.1);
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  // Rounded, water-worn: the normal is the direction from the centre, bent by the lumps.
  g.computeVertexNormals();
  const nr = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    nr.setXYZ(i, v.x * 0.75 + nr.getX(i) * 0.25, v.y * 0.75 + nr.getY(i) * 0.25, v.z * 0.75 + nr.getZ(i) * 0.25);
  }
  return g;
}

/** A lathe profile [[radius, y, brightness], ...] turned into vertex-coloured geometry. */
function latheGeometry(profile, segments, color, wobble = 0, phiLength = Math.PI * 2) {
  const g = new THREE.LatheGeometry(profile.map((q) => new THREE.Vector2(q[0], q[1])), segments, 0, phiLength);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const base = new THREE.Color(color);
  const rows = profile.length;
  for (let i = 0; i < p.count; i++) {
    const k = profile[i % rows][2];
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const w = 1 + wobble * (Math.sin(a * 3 + rows) * 0.6 + Math.sin(a * 5 + 1.7) * 0.4);
    p.setX(i, x * w);
    p.setZ(i, z * w);
    col[i * 3] = base.r * k; col[i * 3 + 1] = base.g * k; col[i * 3 + 2] = base.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// A mushroom stem 1 tall that bends 0.15 to +X as it rises, dark at the foot, pale at the cap.
function stemGeometry() {
  const rings = 6;
  const sides = 6;
  const pos = [];
  const col = [];
  const idx = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const rad = 0.1 * (1.5 - 0.8 * Math.min(1, t * 3) + 0.3 * t * t);
    const cx = 0.15 * t * t + 0.03 * Math.sin(t * 5);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * rad, t, Math.sin(a) * rad);
      const b = 0.05 + 0.3 * t * t;
      col.push(b * 0.7, b, b * 0.8);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let k = 0; k < sides; k++) {
      const a = r * sides + k;
      const b = r * sides + ((k + 1) % sides);
      idx.push(a, a + sides, b, b, a + sides, b + sides);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Veil frame: a lumpy arch grown round the tunnel mouth, standing on y = 0.
function rimGeometry(width, height) {
  const pts = [];
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * Math.PI;
    const c = Math.cos(a);
    pts.push(new THREE.Vector3(
      Math.sign(c) * Math.pow(Math.abs(c), 0.45) * (width / 2),
      Math.pow(Math.sin(a), 0.5) * height,
      0,
    ));
  }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.1, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.035 * noise3(p.getX(i) * 2.3, p.getY(i) * 2.3, 5.5);
    p.setXYZ(i, p.getX(i) + k, p.getY(i) + k, p.getZ(i) + k * 2);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Collects triangles for a rock skin. Each is wound to face `toward`; the finished geometry has
 * normals smoothed across shared corners (so a grid of quads does not read as masonry) and
 * texture coordinates projected along each face's steepest axis.
 */
function skinBuilder(uvScale) {
  const pos = [];
  const col = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const n = new THREE.Vector3();
  return {
    tri(p, q, r, toward, color) {
      a.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      b.set(r[0] - p[0], r[1] - p[1], r[2] - p[2]);
      n.crossVectors(a, b);
      const flip = n.x * toward[0] + n.y * toward[1] + n.z * toward[2] < 0;
      for (const v of flip ? [p, r, q] : [p, q, r]) {
        pos.push(v[0], v[1], v[2]);
        const c = color(v);
        col.push(c.r, c.g, c.b);
      }
    },
    build() {
      const count = pos.length / 3;
      const nor = new Float32Array(pos.length);
      const uv = new Float32Array(count * 2);
      const sums = new Map();
      const key = (i) => `${Math.round(pos[i * 3] * 500)},${Math.round(pos[i * 3 + 1] * 500)},${Math.round(pos[i * 3 + 2] * 500)}`;
      const keys = new Array(count);
      for (let t = 0; t < count; t += 3) {
        a.set(pos[t * 3 + 3] - pos[t * 3], pos[t * 3 + 4] - pos[t * 3 + 1], pos[t * 3 + 5] - pos[t * 3 + 2]);
        b.set(pos[t * 3 + 6] - pos[t * 3], pos[t * 3 + 7] - pos[t * 3 + 1], pos[t * 3 + 8] - pos[t * 3 + 2]);
        n.crossVectors(a, b); // length = twice the area, so big faces weigh more
        const ax = Math.abs(n.x);
        const ay = Math.abs(n.y);
        const az = Math.abs(n.z);
        for (let i = t; i < t + 3; i++) {
          const x = pos[i * 3];
          const y = pos[i * 3 + 1];
          const z = pos[i * 3 + 2];
          if (ay > 0.6 * Math.hypot(ax, ay, az)) { uv[i * 2] = x * uvScale; uv[i * 2 + 1] = z * uvScale; }
          else if (ax > az) { uv[i * 2] = z * uvScale; uv[i * 2 + 1] = y * uvScale; }
          else { uv[i * 2] = x * uvScale; uv[i * 2 + 1] = y * uvScale; }
          keys[i] = key(i);
          const sum = sums.get(keys[i]);
          if (sum) sum.add(n);
          else sums.set(keys[i], n.clone());
        }
      }
      for (let i = 0; i < count; i++) {
        const v = sums.get(keys[i]);
        const l = v.length() || 1;
        nor[i * 3] = v.x / l; nor[i * 3 + 1] = v.y / l; nor[i * 3 + 2] = v.z / l;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      return g;
    },
  };
}

export function buildCave(scene, cfg) {
  const rng = makeRng(CAVE_SEED);
  const rr = (a, b) => a + rng() * (b - a);
  // Pool placement is the generator's first consumer. The pools themselves are cfg.surfaces
  // (placed by the same function when the config was built); running it again here on this
  // generator advances it by exactly the draws placement took, so everything placed after
  // stays where it always was. tests/surfaces.test.js pins both.
  placePools(rng, cfg); // pool-placement-advance
  const dummy = new THREE.Object3D();
  const mat4 = (x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, ry, rz);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };
  const rockTone = (lo = 0.72, hi = 1.15) => {
    const f = rr(lo, hi);
    return new THREE.Color(f * 0.95, f, f * 1.12);
  };

  const group = new THREE.Group();
  group.name = 'cave';
  group.visible = false;
  scene.add(group);
  const fog = new THREE.FogExp2(CAVE.trench, 0.045);
  const background = new THREE.Color(CAVE.trench);
  group.add(new THREE.HemisphereLight(0x4d6f64, CAVE.trench, HEMI));

  const spaces = cfg.spaces;
  const zoneOf = (s) => (s.kind === 'passage' ? s.chamber * 2 + 1 : s.chamber * 2);
  const zoneCount = cfg.chambers.length * 2 - 1;
  const zoneIdAt = (x, z) => zoneOf(spaces[spaceIndexAt(x, z)]);

  // ---- the field on a lattice, and the surfaces read off it --------------------------------
  const ST = 0.25;
  const LX = Math.round((BOUNDS.maxX - BOUNDS.minX) / ST) + 1;
  const LZ = Math.round((BOUNDS.maxZ - BOUNDS.minZ) / ST) + 1;
  const F = new Float32Array(LX * LZ);
  for (let j = 0; j < LZ; j++) {
    for (let i = 0; i < LX; i++) F[j * LX + i] = caveField(BOUNDS.minX + i * ST, BOUNDS.minZ + j * ST);
  }
  const lx = (i) => BOUNDS.minX + i * ST;
  const lz = (j) => BOUNDS.minZ + j * ST;

  /** Unit vector pointing from the rock into the open cave at (x, z). */
  function inward(x, z, h = 0.15) {
    const gx = caveField(x + h, z) - caveField(x - h, z);
    const gz = caveField(x, z + h) - caveField(x, z - h);
    const l = Math.hypot(gx, gz) || 1;
    return { x: gx / l, z: gz / l };
  }

  /** Height of the drawn ceiling: the logic ceiling, domed down toward the walls, roughened. */
  function ceilY(x, z, f) {
    const H = ceilingAt(x, z);
    const drop = 0.3 * (H - 2.7);
    return H + 0.38 - drop * (1 - smoothstep(0, 3.2, f))
      + 0.2 * noise2(x * 0.35 + 40, z * 0.35) + 0.08 * noise2(x * 1.3, z * 1.3 + 11);
  }

  // Standing water sits in shallow bowls in the floor (cfg.surfaces, see logic/cavemap.js);
  // the shore is wherever the rock dips under the water line, so no pool is a circle.
  const WATER_Y = -0.045;
  const pools = cfg.surfaces.zones
    .filter((q) => q.shape === 'bowl')
    .map((q) => ({ x: q.x, z: q.z, r: q.r, zone: zoneOf({ kind: 'chamber', chamber: q.chamber }) }));
  const bowl = (x, z) => bowlAt(pools, x, z);
  const clearOf = (x, z, list, d) => list.every((q) => Math.hypot(q.x - x, q.z - z) > d + (q.r || 0));
  const columns = cfg.boxes.filter((b) => b.kind === 'pillar' || b.kind === 'lowPillar');
  function floorY(x, z, f) {
    const edge = f < 1 ? 0.3 * (1 - f) * (1 - f) : 0; // scree banks up against the walls
    return -0.022 + 0.02 * noise2(x * 0.8, z * 0.8 + 20) + 0.012 * noise2(x * 2.7 + 8, z * 2.7)
      + Math.min(1.2, edge) - 0.085 * bowl(x, z);
  }

  // Pores: holes in the rock face nearest each spawn point.
  const pores = cfg.pores.map((p) => {
    let x = p.x;
    let z = p.z;
    for (let i = 0; i < 60 && caveField(x, z) > 0; i++) {
      const n = inward(x, z);
      x -= n.x * 0.08;
      z -= n.z * 0.08;
    }
    const n = inward(x, z);
    return { ...p, wx: x, wz: z, nx: n.x, nz: n.z };
  });

  /** How far the rock face stands in from the field's zero line at height y (metres). */
  function wallOffset(x, z, y, top) {
    const foot = y < 0.6 ? 0.45 * (1 - y / 0.6) ** 2 : 0;
    const t = Math.max(0, Math.min(1, (y - 2.0) / Math.max(0.5, top - 2.0)));
    const lean = (top < 3.9 ? 0.45 : Math.min(1.6, 0.28 * top)) * Math.pow(t, 2.2);
    // Bedding: the rock is layered, and harder beds stand out as ledges at gently tilted heights.
    const bed = y * (0.9 + 0.25 * noise2(x * 0.07 + 3, z * 0.07)) + 0.9 * noise2(x * 0.16, z * 0.16) + 0.13 * x + 0.06 * z;
    const tri = Math.abs(bed - Math.floor(bed) - 0.5) * 2;
    let off = foot + lean + 0.22 * noise3(x * 0.5, y * 0.75, z * 0.5) + 0.09 * noise3(x * 1.15 + 9, y * 1.6, z * 1.15)
      + 0.075 * smoothstep(0.3, 0.9, tri) * (0.4 + 0.6 * smoothstep(-0.3, 0.4, noise3(x * 0.3, y * 0.3 + 9, z * 0.3)));
    for (const p of pores) {
      const d = Math.hypot(x - p.wx, z - p.wz);
      if (d > 1.3) continue;
      const k = smoothstep(1.3, 0.6, d) * smoothstep(1.7, 1.0, Math.abs(y - 0.62));
      off = off * (1 - k) - 0.2 * k; // a hollow round the pore's mouth
    }
    return off;
  }

  /** The colour of the rock at a point: cool basalt, wet near the floor, stained in beds. */
  const tone = new THREE.Color();
  function rockColor(x, y, z, wet) {
    let t = 0.86 + 0.2 * noise3(x * 0.4, y * 0.4, z * 0.4) + 0.08 * noise3(x * 2.1, y * 2.1, z * 2.1);
    const bed = y * (0.9 + 0.25 * noise2(x * 0.07 + 3, z * 0.07)) + 0.9 * noise2(x * 0.16, z * 0.16) + 0.13 * x + 0.06 * z;
    const band = smoothstep(0.3, 0.9, Math.abs(bed - Math.floor(bed) - 0.5) * 2);
    t *= 1 + 0.16 * band; // the proud beds are paler
    t *= 1 - 0.3 * wet;
    const stain = smoothstep(0.15, 0.6, noise2(x * 0.13 + 50, z * 0.13)); // rust seeping down
    const lime = smoothstep(0.25, 0.7, noise3(x * 0.2, y * 0.5 + 30, z * 0.2)); // calcite wash
    tone.setRGB(
      t * (0.95 + 0.2 * stain + 0.1 * lime),
      t * (1 + 0.02 * stain + 0.12 * lime),
      t * (1.12 - 0.22 * stain + 0.06 * lime),
    );
    return tone;
  }

  // ---- materials and geometries (all shared) ---------------------------------------------
  const rockMap = noiseCanvas(rng, 256, '#1d232c', [
    { n: 26, min: 30, max: 80, colors: ['rgba(10,12,17,0.55)', 'rgba(35,42,68,0.6)', 'rgba(22,27,33,0.6)'] },
    { n: 260, min: 3, max: 10, colors: ['rgba(8,10,14,0.5)', 'rgba(58,68,104,0.4)', 'rgba(70,80,84,0.3)'] },
    { n: 500, min: 0.6, max: 2, colors: ['rgba(5,7,10,0.6)', 'rgba(90,100,112,0.25)'] },
  ]);
  rockMap.colorSpace = THREE.SRGBColorSpace;
  const rockBump = noiseCanvas(rng, 256, '#808080', [
    { n: 30, min: 24, max: 70, colors: ['rgba(255,255,255,0.5)', 'rgba(0,0,0,0.5)'] },
    { n: 320, min: 3, max: 9, colors: ['rgba(255,255,255,0.45)', 'rgba(0,0,0,0.5)'] },
    { n: 500, min: 0.8, max: 2.2, colors: ['rgba(255,255,255,0.3)', 'rgba(0,0,0,0.35)'] },
  ]);
  const rockMat = worldUV(new THREE.MeshStandardMaterial({
    map: rockMap, bumpMap: rockBump, bumpScale: 1.6, roughness: 0.34, metalness: 0.08, flatShading: true,
  }), 0.4);
  // The shell and the columns carry their colour per vertex.
  const shellMat = triplanar(new THREE.MeshStandardMaterial({
    map: rockMap, bumpMap: rockBump, bumpScale: 1.6, roughness: 0.36, metalness: 0.08,
    vertexColors: true, side: THREE.DoubleSide,
  }), 0.4);
  const spikeMat = worldUV(new THREE.MeshStandardMaterial({
    map: rockMap, bumpMap: rockBump, bumpScale: 1.6, roughness: 0.5, metalness: 0.05,
  }), 0.4);
  const floorMat = worldUV(new THREE.MeshStandardMaterial({
    map: rockMap, bumpMap: rockBump, bumpScale: 1.1, roughness: 0.27, metalness: 0.1, color: 0x9da2ac, vertexColors: true,
  }), 0.33);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x04080a, roughness: 0.06, metalness: 0.7, transparent: true, opacity: 0.82, depthWrite: false,
  });
  const fungusMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const glowMat = new THREE.MeshBasicMaterial({ color: CAVE.foxfire });
  const veilMat = new THREE.MeshStandardMaterial({
    color: 0x34315a, emissive: 0x1c1a3a, emissiveIntensity: 0.55, roughness: 0.28, metalness: 0.1, side: THREE.DoubleSide,
  });
  const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const padMat = new THREE.MeshBasicMaterial({ color: CAVE.foxfire, transparent: true, opacity: 0.4, depthWrite: false });
  const glow = glowTexture();
  const haloMat = new THREE.PointsMaterial({
    map: glow, color: CAVE.foxfire, size: 1.7, transparent: true, opacity: 0.2,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });

  const boulderGeo = boulderGeometry(rng);
  // Stalactite: tip at y = -1, root at y = 0, drawn as a ringed carrot rather than a cone.
  const spikeGeos = [
    [[0, -1], [0.07, -0.86], [0.17, -0.62], [0.3, -0.4], [0.5, -0.2], [0.72, -0.07], [1.15, 0.05]],
    [[0, -1], [0.11, -0.9], [0.16, -0.66], [0.33, -0.5], [0.4, -0.27], [0.75, -0.12], [1.2, 0.05]],
  ].map((prof) => {
    const g = latheGeometry(prof.map((q) => [q[0], q[1], 1]), 7, 0xffffff, 0.12);
    g.deleteAttribute('color');
    return g;
  });
  const FOX = CAVE.foxfire;
  // Caps: dim over the crown, bright at the rim, brightest on the gills underneath.
  const capGeos = [
    // domed, the rim rolled under, gills glowing below
    [[0, 0.78, 0.2], [0.3, 0.74, 0.22], [0.62, 0.58, 0.3], [0.88, 0.32, 0.5], [1.0, 0.06, 0.95], [0.97, -0.05, 1.15], [0.82, -0.06, 1.4], [0.5, 0.06, 1.2], [0.14, 0.14, 0.7], [0, 0.14, 0.5]],
    // old and opened flat, the rim split and turned up so the gills show
    [[0, 0.2, 0.2], [0.35, 0.24, 0.24], [0.75, 0.3, 0.4], [1.0, 0.42, 0.9], [1.04, 0.36, 1.2], [0.75, 0.14, 1.4], [0.35, 0.02, 1.1], [0.12, -0.03, 0.7], [0, -0.03, 0.5]],
    // young, still a closed bell
    [[0, 1.15, 0.26], [0.2, 1.08, 0.28], [0.42, 0.8, 0.36], [0.55, 0.4, 0.55], [0.6, 0.05, 0.95], [0.52, -0.03, 1.2], [0.22, 0.05, 0.8], [0, 0.05, 0.5]],
  ].map((prof) => latheGeometry(prof, 11, FOX, 0.09));
  const stemGeo = stemGeometry();
  // Bracket fungus: half a shelf, flat side to the wall (it grows toward +X), zoned in rings.
  const shelfGeo = latheGeometry(
    [[0, 0.16, 0.25], [0.3, 0.15, 0.4], [0.55, 0.11, 0.28], [0.8, 0.06, 0.5], [1, 0, 1], [0.9, -0.05, 1.2], [0.5, -0.12, 1.0], [0, -0.16, 0.7]],
    9, FOX, 0.06, Math.PI,
  );
  const waterGeo = new THREE.CircleGeometry(1, 36);
  waterGeo.rotateX(-Math.PI / 2);
  const padGeo = new THREE.RingGeometry(0.82, 0.96, 28);
  padGeo.rotateX(-Math.PI / 2);
  // A pore's mouth: a ragged gash, taller than it is wide.
  const poreDiscGeo = new THREE.CircleGeometry(0.62, 22);
  {
    const p = poreDiscGeo.attributes.position;
    for (let i = 1; i < p.count; i++) {
      const a = Math.atan2(p.getY(i), p.getX(i));
      const k = 0.95 + 0.22 * Math.sin(a * 3 + 1) + 0.12 * Math.sin(a * 7 + 2.3);
      p.setXY(i, p.getX(i) * k * 0.85, p.getY(i) * k * 1.12);
    }
  }

  function instanced(parent, geo, mat, items, { cast = false, receive = false } = {}) {
    if (!items.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((it, i) => {
      m.setMatrixAt(i, it.m);
      if (it.c) m.setColorAt(i, it.c);
    });
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.computeBoundingSphere();
    parent.add(m);
    return m;
  }

  // ---- shell: floor, walls and ceiling as one skin (always drawn) -------------------------
  const contour = []; // midpoints of the rock face at floor level, for the dressing below
  {
    // Floor: every 0.25 m cell that is in or near the cave.
    const fPos = [];
    const fCol = [];
    const fIdx = [];
    const fMap = new Int32Array(LX * LZ).fill(-1);
    const fVert = (i, j) => {
      const c = j * LX + i;
      if (fMap[c] >= 0) return fMap[c];
      const x = lx(i);
      const z = lz(j);
      const y = floorY(x, z, F[c]);
      fMap[c] = fPos.length / 3;
      fPos.push(x, y, z);
      const col = rockColor(x, 0, z, 0.25 + 0.75 * bowl(x, z));
      fCol.push(col.r, col.g, col.b);
      return fMap[c];
    };
    for (let j = 0; j < LZ - 1; j++) {
      for (let i = 0; i < LX - 1; i++) {
        if (Math.max(F[j * LX + i], F[j * LX + i + 1], F[(j + 1) * LX + i], F[(j + 1) * LX + i + 1]) < -0.7) continue;
        const a = fVert(i, j);
        const b = fVert(i + 1, j);
        const c = fVert(i, j + 1);
        const d = fVert(i + 1, j + 1);
        fIdx.push(a, c, b, b, c, d);
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(fCol, 3));
    fg.setIndex(fIdx);
    fg.computeVertexNormals();
    const floor = new THREE.Mesh(fg, floorMat);
    floor.receiveShadow = true;
    group.add(floor);

    // Ceiling (0.5 m cells) and walls share one skin.
    const skin = skinBuilder(0.4);
    const DOWN = [0, -1, 0];
    const dry = (v) => rockColor(v[0], v[1], v[2], 0);
    const damp = (v) => rockColor(v[0], v[1], v[2], v[1] < 0.45 ? 1 - Math.max(0, v[1]) / 0.45 : 0);
    for (let j = 0; j < LZ - 2; j += 2) {
      for (let i = 0; i < LX - 2; i += 2) {
        const f = [F[j * LX + i], F[j * LX + i + 2], F[(j + 2) * LX + i], F[(j + 2) * LX + i + 2]];
        if (Math.max(...f) < -1.6) continue;
        const q = [[i, j, f[0]], [i + 2, j, f[1]], [i, j + 2, f[2]], [i + 2, j + 2, f[3]]]
          .map(([a, b, ff]) => [lx(a), ceilY(lx(a), lz(b), ff), lz(b)]);
        // Alternate the diagonal so the facets do not line up in rows.
        if (((i + j) >> 1) % 2) { skin.tri(q[0], q[1], q[2], DOWN, dry); skin.tri(q[1], q[3], q[2], DOWN, dry); } else { skin.tri(q[0], q[1], q[3], DOWN, dry); skin.tri(q[0], q[3], q[2], DOWN, dry); }
      }
    }

    // Walls: march the zero line of the field, then raise each piece of it in rings that
    // bank out at the foot, step in and out along the beds, and lean in to meet the ceiling.
    const RINGS = 26;
    const column = (x, z) => {
      // A wide baseline: the lean must follow the sweep of the wall, not every dimple in it,
      // or neighbouring strips splay apart and the face pleats.
      const n = inward(x, z, 1.1);
      const top = ceilY(x, z, 0) + 0.6;
      const out = [];
      for (let k = 0; k <= RINGS; k++) {
        const y = -0.25 + (top + 0.25) * (k / RINGS);
        const off = wallOffset(x, z, Math.max(0, y), top - 0.6);
        out.push([x + n.x * off, y, z + n.z * off]);
      }
      return out;
    };
    const cross = (i0, j0, i1, j1) => {
      const a = F[j0 * LX + i0];
      const b = F[j1 * LX + i1];
      const t = a / (a - b);
      return [lx(i0) + (lx(i1) - lx(i0)) * t, lz(j0) + (lz(j1) - lz(j0)) * t];
    };
    const segment = (p, q) => {
      const A = column(p[0], p[1]);
      const B = column(q[0], q[1]);
      const mx = (p[0] + q[0]) / 2;
      const mz = (p[1] + q[1]) / 2;
      const n = inward(mx, mz, 1.1);
      const into = [n.x, 0.15, n.z];
      for (let k = 0; k < RINGS; k++) {
        if (k % 2) { skin.tri(A[k], B[k], A[k + 1], into, damp); skin.tri(B[k], B[k + 1], A[k + 1], into, damp); } else { skin.tri(A[k], B[k], B[k + 1], into, damp); skin.tri(A[k], B[k + 1], A[k + 1], into, damp); }
      }
      contour.push({ x: mx, z: mz, nx: n.x, nz: n.z, zone: zoneIdAt(mx + n.x * 0.5, mz + n.z * 0.5) });
    };
    for (let j = 0; j < LZ - 2; j += 2) {
      for (let i = 0; i < LX - 2; i += 2) {
        const c = [[i, j], [i + 2, j], [i + 2, j + 2], [i, j + 2]];
        const inside = c.map(([a, b]) => F[b * LX + a] > 0);
        const hits = [];
        for (let e = 0; e < 4; e++) {
          const n = (e + 1) % 4;
          if (inside[e] !== inside[n]) hits.push(cross(c[e][0], c[e][1], c[n][0], c[n][1]));
        }
        if (hits.length === 2) segment(hits[0], hits[1]);
        else if (hits.length === 4) {
          // Saddle: join the crossings either side of each inside corner.
          if (inside[0]) { segment(hits[3], hits[0]); segment(hits[1], hits[2]); } else { segment(hits[0], hits[1]); segment(hits[2], hits[3]); }
        }
      }
    }
    const shell = new THREE.Mesh(skin.build(), shellMat);
    shell.receiveShadow = true;
    group.add(shell);
  }

  // ---- zones: chamber 0, passage 0, chamber 1, passage 1, chamber 2 -----------------------
  const zones = [];
  for (let i = 0; i < zoneCount; i++) {
    const g = new THREE.Group();
    g.visible = false;
    group.add(g);
    zones.push({
      index: i, chamber: i >> 1, passage: i % 2 === 1, group: g,
      rocks: [], spikes: [[], []], caps: [[], [], []], stems: [], shelves: [], halos: [],
      water: [], pads: [], poreDiscs: [], spots: [], lights: [], drip: [], columns: [],
    });
  }

  const veilAt = cfg.veils.map((v) => ({ x: v.box.x, z: v.box.z }));
  const poreAt = pores.map((p) => ({ x: p.wx, z: p.wz }));
  /** Contour points picked at random so that no two lie within `gap` metres of each other. */
  function scatter(gap, chance, avoid = []) {
    const out = [];
    const order = contour.map((c, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const i of order) {
      const c = contour[i];
      if (rng() > chance) continue;
      if (!clearOf(c.x, c.z, out, gap) || avoid.some(([list, d]) => !clearOf(c.x, c.z, list, d))) continue;
      out.push(c);
    }
    return out;
  }
  const wallPoint = (c, y) => {
    const off = wallOffset(c.x, c.z, y, ceilY(c.x, c.z, 0));
    return { x: c.x + c.nx * off, z: c.z + c.nz * off };
  };

  // Scree: fallen blocks banked against the foot of the walls, a few of them large.
  for (const c of scatter(0.9, 0.75, [[poreAt, 1.2], [veilAt, 1.6]])) {
    const zn = zones[c.zone];
    const big = rng() < 0.12;
    const n = big ? 1 : Math.floor(rr(1, 4));
    for (let k = 0; k < n; k++) {
      const r = big ? rr(0.45, 0.8) : rr(0.1, 0.34);
      const d = big ? rr(0.0, 0.15) : rr(0.2, 0.6);
      const along = rr(-0.5, 0.5);
      zn.rocks.push({
        m: mat4(c.x + c.nx * d - c.nz * along, r * rr(0.15, 0.45), c.z + c.nz * d + c.nx * along, r, r * rr(0.6, 1), r * rr(0.8, 1.2), rr(0, 6), rr(0, 6)),
        c: rockTone(0.6, 1.05),
      });
    }
  }
  // Stalagmites stand where the wall meets the floor, out of the walking line.
  for (const c of scatter(2.6, 0.6, [[poreAt, 1.4], [veilAt, 2.2]])) {
    const zn = zones[c.zone];
    const h = rr(0.25, zn.passage ? 0.5 : 0.95);
    const r = h * rr(0.16, 0.3) + 0.05;
    zn.spikes[rng() < 0.5 ? 0 : 1].push({
      m: mat4(c.x + c.nx * 0.28, -0.05, c.z + c.nz * 0.28, r, h, r, rr(0, 6), Math.PI + rr(-0.08, 0.08)), c: rockTone(0.85, 1.25),
    });
  }

  // Stalactites hang in clusters; the ones over water are where the drips fall from.
  function stalactites(zn, x, z, count, spread, dripChance, onWater) {
    for (let k = 0; k < count; k++) {
      const a = rr(0, 6.283);
      const d = Math.sqrt(rng()) * spread;
      const sx = x + Math.cos(a) * d;
      const sz = z + Math.sin(a) * d;
      const f = caveField(sx, sz);
      if (f < 0.2) continue;
      const cy = ceilY(sx, sz, f);
      const len = Math.min((0.15 + 1.7 * rng() ** 2.2) * (k === 0 ? 1.3 : 0.8), cy - 3.05); // a jump clears every tip
      if (len < 0.1) continue;
      const r = len * rr(0.1, 0.24) + rr(0.04, 0.09);
      zn.spikes[rng() < 0.5 ? 0 : 1].push({ m: mat4(sx, cy + 0.12, sz, r, len + 0.12, r, rr(0, 6), rr(-0.07, 0.07), rr(-0.07, 0.07)), c: rockTone(0.8, 1.2), hang: { x: sx, z: sz, y: cy, len, r } });
      if (rng() < dripChance) {
        const wet = onWater && bowl(sx, sz) > 0.45;
        zn.drip.push({ x: sx, y: cy - len, z: sz, floor: wet ? WATER_Y : floorY(sx, sz, f) + 0.01, water: wet });
      }
    }
  }
  for (const q of pools) stalactites(zones[q.zone], q.x, q.z, Math.round(3 + q.r * 2), q.r * 0.7, 0.8, true);
  for (const s of spaces) {
    const zn = zones[zoneOf(s)];
    const area = (s.maxX - s.minX) * (s.maxZ - s.minZ);
    const n = s.kind === 'chamber' ? area / 9 : area / 14;
    for (let i = 0; i < n; i++) {
      const x = rr(s.minX, s.maxX);
      const z = rr(s.minZ, s.maxZ);
      if (caveField(x, z) < 0.3 || spaces[spaceIndexAt(x, z)] !== s) continue;
      stalactites(zn, x, z, Math.floor(rr(1, 5)), rr(0.2, 0.7), 0.12, false);
    }
    // A low tunnel has no room for more than nubs, but it still drips.
    if (s.kind === 'passage') {
      for (let i = 0; i < 40 && zn.drip.length < 3; i++) {
        const x = rr(s.minX, s.maxX);
        const z = rr(s.minZ, s.maxZ);
        const f = caveField(x, z);
        if (f < 0.8 || spaces[spaceIndexAt(x, z)] !== s) continue;
        zn.drip.push({ x, y: ceilY(x, z, f) - 0.05, z, floor: floorY(x, z, f) + 0.01, water: false });
      }
    }
  }
  for (const q of pools) zones[q.zone].water.push({ m: mat4(q.x, WATER_Y, q.z, q.r * 1.45, 1, q.r * 1.45) });

  // Fungus: colonies where the wall meets the floor. Stemmed caps of mixed age crowd the
  // damp foot of the rock, brackets climb the face above them.
  const fungusTone = () => {
    const b = rr(0.5, 1);
    const hue = rng();
    return new THREE.Color(b * (hue < 0.2 ? 0.75 : 1), b, b * (hue > 0.8 ? 1.25 : hue < 0.2 ? 0.7 : 1));
  };
  function mushroom(zn, x, z, capR, h, tone) {
    const f = caveField(x, z);
    const y = floorY(x, z, f) - 0.01;
    const ry = rr(0, 6.283);
    const sxz = capR * rr(1.9, 2.6); // stem about a fifth of the cap across
    zn.stems.push({ m: mat4(x, y, z, sxz, h, sxz, ry), c: tone });
    // The stem bends 0.15 * sxz toward its own +X; the cap sits on the tip, tipped the same way.
    const tx = x + Math.cos(ry) * 0.15 * sxz;
    const tz = z - Math.sin(ry) * 0.15 * sxz;
    const kind = h < capR * 1.6 ? 1 : capR < 0.07 ? 2 : rng() < 0.7 ? 0 : 1;
    zn.caps[kind].push({ m: mat4(tx, y + h - capR * 0.12, tz, capR, capR * rr(0.95, 1.3), capR * rr(0.9, 1.1), ry, rr(-0.12, 0.12), -rr(0.1, 0.45)), c: tone });
  }
  const colonyGap = (zone) => (zones[zone].passage ? 4.5 : 3.6);
  const colonies = [];
  for (const c of scatter(3.4, 1, [[poreAt, 1.5], [veilAt, 2.4]])) {
    if (!clearOf(c.x, c.z, colonies, colonyGap(c.zone))) continue;
    colonies.push(c);
    const zn = zones[c.zone];
    const tone = fungusTone();
    const vary = () => tone.clone().multiplyScalar(rr(0.6, 1.15));
    const grand = !zn.passage && rng() < 0.3;
    // Two or three tufts; in each, a few tall fruit ringed by small ones.
    const tufts = Math.floor(rr(2, 4.5));
    for (let t = 0; t < tufts; t++) {
      const along = rr(-0.9, 0.9);
      const out = rr(0.12, 0.5);
      const cx = c.x + c.nx * out - c.nz * along;
      const cz = c.z + c.nz * out + c.nx * along;
      const n = Math.floor(rr(4, 10));
      for (let k = 0; k < n; k++) {
        const lead = k < 2;
        const d = lead ? rr(0, 0.07) : rr(0.05, 0.3);
        const a = rr(0, 6.283);
        const capR = lead ? rr(0.07, grand ? 0.24 : 0.14) : rr(0.022, 0.06);
        const h = lead ? capR * rr(1.5, 3.1) : capR * rr(1.2, 3);
        mushroom(zn, cx + Math.cos(a) * d, cz + Math.sin(a) * d, capR, h, vary());
      }
    }
    // Brackets in a loose stair up the rock.
    const shelves = Math.floor(rr(2, 6));
    let y = rr(0.5, 0.8);
    for (let k = 0; k < shelves && y < 2.0; k++) {
      const along = rr(-0.5, 0.5);
      const at = { ...c, x: c.x - c.nz * along, z: c.z + c.nx * along };
      const w = wallPoint(at, y);
      const r = rr(0.07, 0.2);
      zn.shelves.push({
        m: mat4(w.x - c.nx * 0.03, y, w.z - c.nz * 0.03, r * rr(0.7, 1), r * rr(0.5, 0.9), r, Math.atan2(-c.nz, c.nx) + rr(-0.3, 0.3), rr(-0.15, 0.15), rr(-0.25, 0.1)),
        c: vary(),
      });
      y += rr(0.12, 0.42);
    }
    zn.halos.push(c.x + c.nx * 0.3, 0.3, c.z + c.nz * 0.3);
    zn.spots.push({ x: c.x + c.nx * 0.9, y: 0.9, z: c.z + c.nz * 0.9 });
  }
  // Strays: single small fruit along the foot of the walls between the colonies.
  for (const c of scatter(1.1, 0.5, [[poreAt, 1.2], [veilAt, 1.8], [colonies, 1.6]])) {
    const capR = rr(0.02, 0.05);
    mushroom(zones[c.zone], c.x + c.nx * rr(0.15, 0.4), c.z + c.nz * rr(0.15, 0.4), capR, capR * rr(1.5, 3.5), fungusTone().multiplyScalar(0.7));
  }

  // Pores: a black mouth in a hollow of the rock, lipped with rubble.
  for (const p of pores) {
    const zn = zones[p.chamber * 2];
    const ry = Math.atan2(p.nx, p.nz); // the disc's face (+Z) looks into the room
    zn.poreDiscs.push({ m: mat4(p.wx + p.nx * 0.02, 0.62, p.wz + p.nz * 0.02, 1.05, 0.9, 1, ry) });
    // Rubble it has pushed out: heaped unevenly under and beside the gash, not round it.
    const lumps = Math.floor(rr(4, 7));
    for (let k = 0; k < lumps; k++) {
      const a = -Math.PI / 2 + rr(-1.9, 1.9) * rr(0.4, 1);
      const side = Math.cos(a) * rr(0.6, 0.95);
      const r = rr(0.1, 0.34);
      zn.rocks.push({
        m: mat4(p.wx + p.nx * rr(0.05, 0.3) - p.nz * side, Math.max(0.04, 0.55 + Math.sin(a) * 0.6), p.wz + p.nz * rr(0.05, 0.3) + p.nx * side, r, r * rr(0.6, 1), r * rr(0.8, 1.3), rr(0, 6), rr(0, 6)),
        c: rockTone(0.55, 0.9),
      });
    }
  }

  // Columns: where stalactite met stalagmite. Waisted, fluted with flowstone, never square,
  // and wide enough to cover the collision box they stand for.
  for (const b of columns) {
    const zn = zones[zoneIdAt(b.x, b.z)];
    const low = b.kind === 'lowPillar';
    const top = low ? b.h + 0.08 : ceilY(b.x, b.z, caveField(b.x, b.z)) + 0.3;
    const half = b.w / 2;
    const rings = low ? 7 : 16;
    const sides = 16;
    const ph = rr(0, 6);
    const ring = [];
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const y = top * t;
      const row = [];
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const cs = Math.cos(a);
        const sn = Math.sin(a);
        const sq = 1 / Math.pow(cs ** 4 + sn ** 4, 0.25); // a rounded square, to cover the box
        let rad;
        if (low) rad = half * (0.55 + 0.5 * sq) * Math.sqrt(Math.max(0.02, 1 - 0.85 * t ** 2.4)) * (1 + 0.5 * Math.exp(-y / 0.25));
        else rad = half * (0.5 + 0.5 * sq) * (1.02 + 0.5 * Math.exp(-y / 0.45) + 0.4 * Math.exp(-(top - y) / 0.7) - 0.1 * Math.sin(Math.PI * t));
        rad *= 1 + 0.1 * noise3(b.x + cs * 1.3, y * 0.8, b.z + sn * 1.3) + 0.035 * Math.sin(a * 9 + ph + y * 0.6);
        row.push([b.x + cs * rad, y - 0.05, b.z + sn * rad]);
      }
      ring.push(row);
    }
    const skin = skinBuilder(0.4);
    const paint = (q) => {
      const c = rockColor(q[0], q[1], q[2], q[1] < 0.3 ? 0.6 : 0);
      return c.setRGB(c.r * 1.12, c.g * 1.12, c.b * 1.08);
    };
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < sides; k++) {
        const n = (k + 1) % sides;
        const out = [ring[r][k][0] - b.x, 0, ring[r][k][2] - b.z];
        skin.tri(ring[r][k], ring[r + 1][k], ring[r][n], out, paint);
        skin.tri(ring[r][n], ring[r + 1][k], ring[r + 1][n], out, paint);
      }
    }
    if (low) {
      for (let k = 0; k < sides; k++) skin.tri(ring[rings][k], [b.x, top, b.z], ring[rings][(k + 1) % sides], [0, 1, 0], paint);
    }
    const g = skin.build();
    zn.columns.push(g);
  }

  for (const p of cfg.pads) {
    const zn = zones[p.chamber * 2];
    zn.pads.push({ m: mat4(p.x, 0.02, p.z, 1, 1, 1) });
  }

  // ---- far lights: one spot per chamber, low at the exit end, aimed back at the entrance --
  const veilOf = (chamber, role) => cfg.veils.find((v) => v.chamber === chamber && v.role === role);
  const farLights = cfg.chambers.map((ch, c) => {
    const own = spaces.filter((s) => s.kind === 'chamber' && s.chamber === c);
    const minX = Math.min(...own.map((s) => s.minX));
    const maxX = Math.max(...own.map((s) => s.maxX));
    const minZ = Math.min(...own.map((s) => s.minZ));
    const maxZ = Math.max(...own.map((s) => s.maxZ));
    const exit = veilOf(c, 'exit');
    const entry = veilOf(c, 'entry');
    const from = exit ? { x: exit.box.x, z: exit.box.z + 1.6 } : { x: (minX + maxX) / 2, z: minZ + 2.2 };
    const to = entry ? { x: entry.box.x, z: entry.box.z } : { x: cfg.player.spawn.x, z: maxZ };
    const spot = new THREE.SpotLight(CAVE.foxfire, 0, FAR_REACH, 1.08, 0.75, 1);
    spot.position.set(from.x, 2.5, from.z);
    spot.target.position.set(to.x, 0.6, to.z);
    spot.castShadow = false;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.camera.near = 0.6;
    spot.shadow.camera.far = FAR_REACH;
    spot.shadow.bias = -0.0015;
    spot.shadow.normalBias = 0.04;
    group.add(spot, spot.target);
    // The light itself: a foxfire mass above the way out.
    const zn = zones[c * 2];
    const blob = new THREE.Mesh(boulderGeo, glowMat);
    blob.position.set(from.x, 2.62, from.z);
    blob.scale.set(0.3, 0.22, 0.3);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: CAVE.foxfire, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.55,
    }));
    halo.position.copy(blob.position);
    halo.scale.set(3.4, 3.4, 1);
    zn.group.add(blob, halo);
    zn.far = { x: from.x, z: from.z };
    return { spot, level: 0 };
  });

  // Up to three fungus lights per chamber, taken from one pool of three so the light count
  // (and so the compiled shaders) never changes between chambers.
  for (const zn of zones) {
    if (zn.passage || !zn.spots.length) continue;
    const picked = [];
    const far = zn.far || zn.spots[0];
    const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    while (picked.length < 3 && picked.length < zn.spots.length) {
      let best = null;
      let bestD = -1;
      for (const s of zn.spots) {
        if (picked.includes(s)) continue;
        const d = Math.min(dist(s, far), ...picked.map((p) => dist(s, p)));
        if (d > bestD) { bestD = d; best = s; }
      }
      picked.push(best);
    }
    zn.lights = picked.map((s) => ({ ...s, level: FUNGUS_LIGHT }));
  }
  for (const zn of zones) {
    if (!zn.passage) continue;
    const own = zn.spots[Math.floor(zn.spots.length / 2)];
    const near = (other) => {
      if (!other || !other.lights.length || !own) return null;
      return other.lights.reduce((a, b) => (Math.hypot(a.x - own.x, a.z - own.z) < Math.hypot(b.x - own.x, b.z - own.z) ? a : b));
    };
    zn.lights = [own && { ...own, level: FUNGUS_LIGHT * 0.8 }, near(zones[zn.index - 1]), near(zones[zn.index + 1])].filter(Boolean);
  }
  const fungusLights = [0, 1, 2].map(() => {
    const l = new THREE.PointLight(CAVE.foxfire, 0, FUNGUS_REACH, 1.4);
    l.position.set(0, -20, 0);
    group.add(l);
    return { l, at: null };
  });

  // ---- zone meshes -----------------------------------------------------------------------
  const hanging = []; // every stalactite: { x, z, y (its root on the vault), len, r, mesh, index, m (its matrix), gone }
  const noSpike = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const zn of zones) {
    const g = zn.group;
    instanced(g, boulderGeo, spikeMat, zn.rocks, { receive: true });
    zn.spikes.forEach((list, i) => {
      const mesh = instanced(g, spikeGeos[i], spikeMat, list);
      // #29 (CS-10): the stalactites, by where they hang: the vault's hole takes down the ones over it
      list.forEach((it, index) => { if (it.hang) hanging.push({ ...it.hang, mesh, index, m: it.m, gone: false }); });
    });
    zn.caps.forEach((list, i) => instanced(g, capGeos[i], fungusMat, list));
    instanced(g, stemGeo, fungusMat, zn.stems);
    instanced(g, shelfGeo, fungusMat, zn.shelves);
    instanced(g, waterGeo, waterMat, zn.water, { receive: true });
    instanced(g, padGeo, padMat, zn.pads);
    instanced(g, poreDiscGeo, voidMat, zn.poreDiscs);
    if (zn.columns.length) {
      const m = new THREE.Mesh(mergeGeometries(zn.columns), shellMat);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    if (zn.halos.length) {
      const hg = new THREE.BufferGeometry();
      hg.setAttribute('position', new THREE.Float32BufferAttribute(zn.halos, 3));
      g.add(new THREE.Points(hg, haloMat));
    }
  }

  // ---- veils: two layers of flattened cones that fold back along the passage -------------
  const PETALS = 13;
  const petalGeo = new THREE.ConeGeometry(1, 1, 8, 1, true);
  petalGeo.translate(0, 0.5, 0);
  const veilMesh = new THREE.InstancedMesh(petalGeo, veilMat, cfg.veils.length * PETALS * 2);
  veilMesh.frustumCulled = false;
  veilMesh.receiveShadow = true;
  group.add(veilMesh);
  const darkRim = new THREE.Color(0x0b0d14);
  const greenRim = new THREE.Color(CAVE.foxfire);
  const veils = cfg.veils.map((v, i) => {
    const b = v.box;
    const width = b.w; // the box overlaps the rock by 0.5 m each side, and so does the membrane
    const height = (v.height || 3) + 0.5;
    const side = v.side || -1; // fold toward the passage
    const zone = v.zone != null ? v.zone : v.chamber * 2;
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x0b0d14, emissive: CAVE.foxfire, emissiveIntensity: 0, roughness: 0.35 });
    const rim = new THREE.Mesh(rimGeometry(width - 0.5, height - 0.25), rimMat);
    rim.position.set(b.x, 0, b.z);
    group.add(rim);
    const petals = [];
    for (let layer = 0; layer < 2; layer++) {
      for (let k = 0; k < PETALS; k++) {
        const a = ((k + layer * 0.5) / PETALS) * Math.PI * 2;
        // Base points on the mouth's frame (an ellipse clamped to the rectangle).
        const bx = Math.max(-width / 2 + 0.05, Math.min(width / 2 - 0.05, Math.cos(a) * width * 0.68));
        const by = Math.max(0.03, Math.min(height - 0.05, height / 2 + Math.sin(a) * height * 0.78));
        const dx = -bx;
        const dy = height / 2 - by;
        petals.push({
          bx, by, phi: Math.atan2(-dx, dy), len: Math.hypot(dx, dy) * 1.2,
          wide: rr(1.1, 1.35) * (width / 4), off: (layer ? -0.1 : 0.1) * side, lag: rr(0, 0.25),
        });
      }
    }
    return { v, index: i, b, side, zone, rim, rimMat, petals, open: v.role === 'exit' ? 0 : 1, drawn: -1 };
  });
  const qz = new THREE.Quaternion();
  const qx = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0);
  const AZ = new THREE.Vector3(0, 0, 1);
  function drawVeil(vl) {
    if (Math.abs(vl.drawn - vl.open) < 0.0005) return;
    vl.drawn = vl.open;
    vl.petals.forEach((p, k) => {
      const o = Math.max(0, Math.min(1, (vl.open - p.lag * 0.5) / (1 - p.lag * 0.5)));
      const e = o * o * (3 - 2 * o);
      qz.setFromAxisAngle(AZ, p.phi);
      qx.setFromAxisAngle(AX, vl.side * e * Math.PI / 2);
      dummy.position.set(vl.b.x + p.bx, p.by, vl.b.z + p.off * (1 - e));
      dummy.quaternion.copy(qz).multiply(qx);
      dummy.scale.set(p.wide, p.len * (1 - 0.6 * e), 0.09);
      dummy.updateMatrix();
      veilMesh.setMatrixAt(vl.index * PETALS * 2 + k, dummy.matrix);
    });
    veilMesh.instanceMatrix.needsUpdate = true;
    vl.rimMat.emissiveIntensity = 1.6 * vl.open;
    vl.rimMat.color.copy(darkRim).lerp(greenRim, vl.open * 0.6);
  }
  veils.forEach(drawVeil);

  // ---- drips: a bead swells on a stalactite tip, lets go, falls, and breaks on the floor --
  const DRIPS = 20;
  // A teardrop: round below, drawn out above.
  const dropGeo = latheGeometry([[0, 1.9, 1], [0.25, 1.2, 1], [0.7, 0.45, 1], [1, -0.1, 1], [0.8, -0.7, 1], [0.4, -0.95, 1], [0, -1, 1]], 8, 0xffffff);
  dropGeo.deleteAttribute('color');
  const wetMat = new THREE.MeshStandardMaterial({
    color: 0xcfeee2, emissive: 0x6fae98, emissiveIntensity: 0.55, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.8,
  });
  const dripMesh = new THREE.InstancedMesh(dropGeo, wetMat, DRIPS);
  dripMesh.frustumCulled = false;
  group.add(dripMesh);
  const drips = [];
  for (let i = 0; i < DRIPS; i++) drips.push({ src: null, phase: 'wait', t: rr(0, 3), grow: 1, y: 0, v: 0 });
  // Spray thrown up where a drop lands.
  const SPRAY = 48;
  const sprayMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 4), wetMat, SPRAY);
  sprayMesh.frustumCulled = false;
  group.add(sprayMesh);
  const spray = [];
  for (let i = 0; i < SPRAY; i++) spray.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, life: 0, floor: 0 });
  let sprayNext = 0;
  const RINGS = 16;
  const ringGeo = new THREE.RingGeometry(0.9, 1, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMesh = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }), RINGS);
  ringMesh.frustumCulled = false;
  group.add(ringMesh);
  const rings = [];
  const ringTone = new THREE.Color();
  for (let i = 0; i < RINGS; i++) {
    rings.push({ x: 0, y: 0, z: 0, t: 9, life: 1, size: 1, gain: 0 });
    ringMesh.setColorAt(i, ringTone.setRGB(0, 0, 0));
  }
  let ringNext = 0;
  function ripple(x, y, z, delay, life, size, gain) {
    const r = rings[ringNext];
    ringNext = (ringNext + 1) % RINGS;
    Object.assign(r, { x, y, z, t: -delay, life, size, gain });
  }

  function stepDrips(dt, zone) {
    for (let i = 0; i < DRIPS; i++) {
      const d = drips[i];
      let sx = 0.001;
      let sy = 0.001;
      if (d.phase === 'wait') {
        d.t -= dt;
        if (d.t <= 0) {
          // Mostly the room we are in, sometimes a neighbour, so a tunnel mouth is not dry.
          const zn = zones[Math.max(0, Math.min(zoneCount - 1, zone + (Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) : 0)))];
          if (zn.drip.length) {
            d.src = zn.drip[Math.floor(Math.random() * zn.drip.length)];
            d.phase = 'form';
            d.grow = 0.7 + Math.random() * 1.8;
            d.t = 0;
          } else {
            d.t = 1;
          }
        }
      } else if (d.phase === 'form') {
        // The bead fattens on the tip, sags, then necks off.
        d.t += dt;
        const k = Math.min(1, d.t / d.grow);
        sx = 0.008 + 0.014 * k;
        sy = sx * (0.9 + 0.7 * k * k);
        d.y = d.src.y - sy * 0.8;
        if (k >= 1) { d.phase = 'fall'; d.v = 0; }
      } else {
        d.v += 9.8 * dt;
        d.y -= d.v * dt;
        sx = 0.019;
        sy = 0.019 * (1 + Math.min(1.6, d.v * 0.16));
        if (d.y <= d.src.floor) {
          const s = d.src;
          if (s.water) {
            ripple(s.x, WATER_Y + 0.004, s.z, 0, 1.9, 0.85, 0.16);
            ripple(s.x, WATER_Y + 0.004, s.z, 0.22, 1.7, 0.6, 0.1);
            ripple(s.x, WATER_Y + 0.004, s.z, 0.45, 1.5, 0.4, 0.06);
          } else {
            ripple(s.x, s.floor + 0.01, s.z, 0, 0.5, 0.2, 0.09); // a wet slap on bare rock
          }
          const n = s.water ? 5 : 3;
          for (let k = 0; k < n; k++) {
            const p = spray[sprayNext];
            sprayNext = (sprayNext + 1) % SPRAY;
            const a = Math.random() * Math.PI * 2;
            const h = 0.25 + Math.random() * 0.5;
            Object.assign(p, {
              x: s.x, y: s.floor + 0.02, z: s.z, vx: Math.cos(a) * h, vz: Math.sin(a) * h,
              vy: 0.9 + Math.random() * (s.water ? 1.1 : 0.6), life: 0.6, floor: s.floor,
            });
          }
          d.phase = 'wait';
          d.t = 0.5 + Math.random() * 4;
        }
      }
      if (d.src) dummy.position.set(d.src.x, d.y, d.src.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(sx, sy, sx);
      dummy.updateMatrix();
      dripMesh.setMatrixAt(i, dummy.matrix);
    }
    dripMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < SPRAY; i++) {
      const p = spray[i];
      let s = 0.001;
      if (p.life > 0) {
        p.life -= dt;
        p.vy -= 9.8 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < p.floor) p.life = 0;
        else s = 0.008;
      }
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      sprayMesh.setMatrixAt(i, dummy.matrix);
    }
    sprayMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < RINGS; i++) {
      const r = rings[i];
      if (r.t > r.life) continue;
      r.t += dt;
      const k = Math.max(0, Math.min(1, r.t / r.life));
      const s = r.t < 0 ? 0.001 : 0.05 + k * r.size;
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(s, 1, s);
      dummy.updateMatrix();
      ringMesh.setMatrixAt(i, dummy.matrix);
      const f = r.t < 0 ? 0 : r.gain * (1 - k);
      ringMesh.setColorAt(i, ringTone.setRGB(f * 0.7, f, f * 0.8));
    }
    ringMesh.instanceMatrix.needsUpdate = true;
    ringMesh.instanceColor.needsUpdate = true;
  }

  // ---- per-frame state --------------------------------------------------------------------
  let renderer = null;
  let camera = null;
  let zoneNow = 0;
  let caster = -1;
  let shadowLevel = 2;
  let lowFor = 0;
  let smoothFps = 60;
  let lastWall = 0;
  let lastRunTime = -1;
  let runAge = 0;

  function zoneAt(x, z) {
    return caveField(x, z) > -1 ? zoneIdAt(x, z) : -1;
  }
  function applyShadows() {
    const on = shadowLevel > 0;
    if (renderer) renderer.shadowMap.enabled = on && group.visible;
    farLights.forEach((f, c) => {
      const cast = on && c === caster;
      if (f.spot.castShadow !== cast) f.spot.castShadow = cast;
      const size = SHADOW_SIZES[Math.max(1, shadowLevel)];
      if (f.spot.shadow.mapSize.x !== size) {
        f.spot.shadow.mapSize.set(size, size);
        if (f.spot.shadow.map) {
          f.spot.shadow.map.dispose();
          f.spot.shadow.map = null;
        }
      }
    });
  }

  function setZone(z) {
    zoneNow = z;
    zones.forEach((zn, i) => { zn.group.visible = Math.abs(i - z) <= 1; });
    for (const vl of veils) vl.rim.visible = Math.abs(vl.zone - z) <= 1 || Math.abs(vl.v.chamber * 2 - z) <= 1;
    caster = z % 2 ? (z + 1) / 2 : z / 2;
    applyShadows();
  }
  setZone(0);

  /** Makes the cave the room on screen. Pass the renderer once so the shadow flag can follow. */
  function apply(r) {
    if (r) {
      renderer = r;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    group.visible = true;
    scene.fog = fog;
    scene.background = background;
    if (renderer) renderer.setClearColor(CAVE.trench);
    applyShadows();
  }

  function hide() {
    group.visible = false;
    if (renderer) renderer.shadowMap.enabled = false;
  }

  function watchFrameRate(sim) {
    const now = performance.now() / 1000;
    const raw = now - lastWall;
    lastWall = now;
    if (sim.stats.time < lastRunTime) {
      // A new run: shadows may come back, and the veils snap to their starting state.
      shadowLevel = 2;
      lowFor = 0;
      runAge = 0;
      smoothFps = 60;
      applyShadows();
      for (const vl of veils) vl.open = -1;
    }
    lastRunTime = sim.stats.time;
    if (raw <= 0 || raw > 0.5 || shadowLevel === 0) return;
    runAge += raw;
    smoothFps += (1 / raw - smoothFps) * 0.05;
    if (runAge < 2) return; // first-use shader compiles are not the frame rate
    lowFor = smoothFps < LOW_FPS ? lowFor + raw : 0;
    if (lowFor >= LOW_FPS_HOLD) {
      shadowLevel -= 1;
      lowFor = 0;
      applyShadows();
    }
  }

  /**
   * Once per frame while the cave is on screen. dt is the animation step: the frame dt on the
   * title, the sim dt in play (0 while paused, which freezes the cave with the game).
   */
  function update(sim, dt, time) {
    if (!group.visible) return;
    const inCave = !!(sim && sim.cfg && sim.cfg.room === 'cave');
    if (!camera) camera = scene.children.find((o) => o.isCamera) || null;
    const eye = camera ? camera.position : sim.player;
    const z = zoneAt(eye.x, eye.z);
    if (z >= 0 && z !== zoneNow) setZone(z);
    if (inCave && dt > 0 && sim.status === 'playing') watchFrameRate(sim);

    // Far lights: the occupied chamber's, or both ends of a passage.
    farLights.forEach((f, c) => {
      const lit = Math.abs(c * 2 - zoneNow) <= 1 ? 1 : 0;
      f.level += (lit - f.level) * Math.min(1, dt * 2.5);
      f.spot.intensity = FAR_LIGHT * f.level * (0.96 + 0.04 * Math.sin(time * 1.3 + c * 2));
    });
    // Fungus lights: fade out, move, fade in.
    const want = zones[zoneNow].lights;
    fungusLights.forEach((fl, i) => {
      const target = want[i] || null;
      if (fl.at !== target) {
        fl.l.intensity -= dt * FUNGUS_LIGHT * 4;
        if (fl.l.intensity <= 0 || !fl.at) {
          fl.l.intensity = 0;
          fl.at = target;
          if (target) fl.l.position.set(target.x, target.y, target.z);
        }
      } else if (target) {
        const lv = target.level * (0.9 + 0.1 * Math.sin(time * 0.9 + i * 2.1));
        fl.l.intensity += (lv - fl.l.intensity) * Math.min(1, dt * 3);
      }
    });

    // Veils follow the sim; outside a cave run they hold their starting state.
    const closed = inCave && sim.waves && sim.waves.veilsClosed;
    for (const vl of veils) {
      const shut = closed ? closed[vl.index] : vl.v.role === 'exit';
      const goal = shut ? 0 : 1;
      if (vl.open < 0) vl.open = goal;
      else if (vl.open !== goal) vl.open = goal > vl.open ? Math.min(goal, vl.open + dt / 1.2) : Math.max(goal, vl.open - dt / 0.7);
      drawVeil(vl);
    }
    if (dt > 0) stepDrips(dt, zoneNow);
    haloMat.opacity = 0.17 + 0.04 * Math.sin(time * 0.7);
  }

  const titlePos = new THREE.Vector3();
  const titleTarget = new THREE.Vector3();
  /** Title backdrop: a slow drift down chamber 1 toward its mouth. Returns { position, target }. */
  function titleCamera(time) {
    const first = spaces[0];
    const exit = veilOf(0, 'exit');
    const depth = first.maxZ - first.minZ;
    const k = 0.5 - 0.5 * Math.cos(time * 0.07);
    titlePos.set(
      (first.minX + first.maxX) / 2 + Math.sin(time * 0.05) * 2.2,
      1.9 + Math.sin(time * 0.11) * 0.15,
      first.maxZ - 1.5 - k * depth * 0.35,
    );
    titleTarget.set(exit ? exit.box.x : 0, 1.3, exit ? exit.box.z : first.minZ);
    return { position: titlePos, target: titleTarget };
  }

  return {
    group, apply, hide, update, titleCamera,
    // #29: the drawn rock's heights at a place (the shaft's hole, cracks and rubble are laid on them)
    ceilAt: (x, z) => ceilY(x, z, caveField(x, z)),
    /** #29 (CS-10): the stalactites whose roots lie within `rad` of (x, z): [{ x, z, y, len, r }] with drop(i, gone) to take one down (or put it back). */
    stalactitesNear(x, z, rad) { return hanging.filter((h) => Math.hypot(h.x - x, h.z - z) <= rad); },
    dropStalactite(h, gone) {
      if (!h || h.gone === !!gone) return;
      h.gone = !!gone;
      h.mesh.setMatrixAt(h.index, gone ? noSpike : h.m);
      h.mesh.instanceMatrix.needsUpdate = true;
    },
    floorAt: (x, z) => floorY(x, z, caveField(x, z)),
    get shadowLevel() { return shadowLevel; },
    get zone() { return zoneNow; },
  };
}
