// The Looking-Glass Gallery's mirror: the whole west wall, in real time, on core three (no
// add-on). One render target at the whole drawing buffer (at most 2048 wide, multisampled: art
// pass K6, the one glass in the game must not be the softest thing in it), one camera reflected in the
// wall's plane with its near plane laid on the glass, and three layers:
//   layer 0  seen by the eye and by the glass (the room, the true tiles);
//   layer 1  seen by the eye only (the false tiles, the runner, the sitters in the portraits);
//   layer 2  seen by the glass only (the warden's own figure, the grin, the tall figure).
// It draws what is on the layers and decides nothing: which tile is on which layer is
// keepprops.js's work from gallery.js's isTrue (security A5), and nothing here reads the rules.
//
// The pass runs once a frame, before the frame itself, only while the warden is in the gallery
// and the glass is in view (and once from just outside its doors, so the glass is never
// blank through a doorway). Every other zone is hidden for it and no shadow map is redrawn. If the
// smoothed frame rate stays under 45 for three seconds in the gallery the target halves, and then
// the glass is redrawn every second frame (the cave's step-down pattern). The target is freed
// when the warden is far from the gallery and made again on the way back.

import * as THREE from 'three';
import { GALLERY } from '../logic/keepmap.js';

export const LAYER_BOTH = 0;
export const LAYER_EYE = 1;
export const LAYER_GLASS = 2;
/** What each camera sees: the eye layers 0 and 1, the glass layers 0 and 2. */
export const EYE_MASK = (1 << LAYER_BOTH) | (1 << LAYER_EYE);
export const GLASS_MASK = (1 << LAYER_BOTH) | (1 << LAYER_GLASS);

export const MIRROR_TUNE = Object.freeze({
  scale: 1, // of the drawing buffer (canvas times devicePixelRatio), each way
  maxWidth: 2048,
  samples: 4, // MSAA on the target, so the tiles, the tracery and the warden have no stair-steps
  lowFps: 45,
  lowHold: 3, // seconds under lowFps before a step down
  levels: 3, // 0: full; 1: half; 2: half, every second frame
  near: 14, // metres outside the gallery within which the glass is drawn once, if it never has been
  freeAt: 30, // metres outside at which the target is freed
  far: 70, // the reflected camera's far plane: the gallery is 32 m long
});

/** The target's size for a canvas w by h at a step-down level. */
export function targetSize(w, h, level = 0, tune = MIRROR_TUNE) {
  const k = tune.scale / (level >= 1 ? 2 : 1);
  const width = Math.max(16, Math.min(tune.maxWidth / (level >= 1 ? 2 : 1), Math.round(w * k)));
  return { width, height: Math.max(16, Math.round(width * (h / Math.max(1, w)))) };
}

/** The step-down: state { level, low }; fps is the smoothed rate, dt real seconds. Returns state. */
export function stepDown(state, fps, dt, tune = MIRROR_TUNE) {
  state.low = fps < tune.lowFps ? state.low + dt : 0;
  if (state.low >= tune.lowHold && state.level < tune.levels - 1) {
    state.level += 1;
    state.low = 0;
  }
  return state;
}

/** True on the frames the glass is redrawn at a level (level 2: every second frame). */
export function drawsOn(level, frame) {
  return level < 2 || frame % 2 === 0;
}

const VERT = `
uniform mat4 textureMatrix;
varying vec4 vUv;
void main() {
  vUv = textureMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
const FRAG = `
uniform sampler2D tDiffuse;
uniform vec3 tint;
varying vec4 vUv;
void main() {
  vec4 base = texture2DProj( tDiffuse, vUv );
  gl_FragColor = vec4( base.rgb * tint, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * createMirror({ renderer, scene, castle, camera }) -> { render(camera, castle), free(), dispose(), mesh, stats }.
 * free() drops the render target only (it is made again at the next pass); dispose() removes the glass for good.
 * castle is the shell (castle.js): showOnly(id) hides every zone but the gallery for the pass.
 * The props (keepprops.js) are found by name on the scene and asked the same.
 */
export function createMirror({ renderer, scene, castle, camera }) {
  const G = GALLERY;
  const facing = G.mirrorX <= G.windowX ? 1 : -1; // the glass looks toward the windows
  const planeX = G.mirrorX + facing * 0.03;
  const z0 = G.field.minZ - 1; const z1 = G.field.maxZ + 1;
  const y0 = 0.4; const y1 = 5.6;
  const normal = new THREE.Vector3(facing, 0, 0);
  const centre = new THREE.Vector3(planeX, (y0 + y1) / 2, (z0 + z1) / 2);

  const textureMatrix = new THREE.Matrix4();
  const material = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, textureMatrix: { value: textureMatrix }, tint: { value: new THREE.Color(0.9, 0.94, 0.98) } },
    vertexShader: VERT, fragmentShader: FRAG, fog: false,
  });
  const dull = new THREE.MeshStandardMaterial({ color: 0x1b222a, roughness: 0.15, metalness: 0.9 }); // the glass before it has ever been drawn
  const geometry = new THREE.PlaneGeometry(z1 - z0, y1 - y0);
  const mesh = new THREE.Mesh(geometry, dull);
  mesh.name = 'mirror:glass';
  mesh.position.copy(centre);
  mesh.rotation.y = facing * Math.PI / 2;
  mesh.updateMatrixWorld(true);
  const zone = castle && castle.zones && castle.zones.find((z) => z.id === 'gallery');
  const parent = zone ? zone.group : scene;
  parent.add(mesh);
  const box = new THREE.Box3(new THREE.Vector3(planeX - 0.05, y0, z0), new THREE.Vector3(planeX + 0.05, y1, z1));

  // the eye sees layers 0 and 1; the glass's camera sees 0 and 2
  if (camera) camera.layers.enable(LAYER_EYE);
  const eye2 = new THREE.PerspectiveCamera();
  eye2.layers.mask = GLASS_MASK;
  eye2.matrixAutoUpdate = true;

  let target = null;
  const state = { level: 0, low: 0 };
  let frame = 0;
  let fps = 60;
  let last = 0;
  let drawn = false;
  let failed = false; // set by a pass that threw: said once, and no pass is made after it
  const stats = { passes: 0, calls: 0, triangles: 0, width: 0, height: 0, level: 0, active: false };

  const frustum = new THREE.Frustum();
  const m4 = new THREE.Matrix4();
  const camPos = new THREE.Vector3();
  const view = new THREE.Vector3();
  const look = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const plane = new THREE.Plane();
  const clip = new THREE.Vector4();
  const q = new THREE.Vector4();
  const size = new THREE.Vector2();
  const saved = { target: null, shadows: true, xr: false, calls: 0, tris: 0 };
  let props = null; // keepprops.js's layer, looked up once
  let passed = null; // the shell last passed on to it

  function ensureTarget() {
    renderer.getDrawingBufferSize(size);
    const want = targetSize(size.x, size.y, state.level);
    if (target && target.width === want.width && target.height === want.height) return;
    if (target) target.dispose();
    target = new THREE.WebGLRenderTarget(want.width, want.height, { type: THREE.HalfFloatType, samples: MIRROR_TUNE.samples, depthBuffer: true });
    target.texture.name = 'mirror';
    material.uniforms.tDiffuse.value = target.texture;
    stats.width = want.width; stats.height = want.height;
    drawn = false;
  }
  function freeTarget() {
    if (!target) return;
    target.dispose();
    target = null;
    material.uniforms.tDiffuse.value = null;
    mesh.material = dull;
    drawn = false;
  }

  /** Metres from (x, z) to the gallery's floor rectangle (0 inside it). */
  function outside(x, z) {
    const dx = Math.max(G.rect.minX - x, 0, x - G.rect.maxX);
    const dz = Math.max(G.rect.minZ - z, 0, z - G.rect.maxZ);
    return Math.hypot(dx, dz);
  }

  /** Once a frame, before the frame is drawn, with the camera that is about to draw it. */
  function render(cam, shell = castle) {
    frame += 1;
    stats.active = false;
    // the props' layer: looked up once (and again now and then until it is there), and told which shell is drawing
    if (props && props.group && !props.group.parent) { props = null; passed = null; }
    if (!props && frame % 30 === 1) {
      const o = scene.getObjectByName('keepprops');
      props = o && o.userData.keepprops ? o.userData.keepprops : null;
    }
    if (props && props.setShell && shell !== passed) { props.setShell(shell); passed = shell; }
    if (!cam || failed) return;
    if ((cam.layers.mask & (1 << LAYER_EYE)) === 0) cam.layers.enable(LAYER_EYE);
    camPos.setFromMatrixPosition(cam.matrixWorld);
    const away = outside(camPos.x, camPos.z);
    const inside = away < 0.6 && camPos.y > -0.5; // in the gallery itself, not the crypt beneath
    if (away > MIRROR_TUNE.freeAt) { freeTarget(); last = 0; return; }
    // drawn only while the gallery is occupied; from just outside it, once, so the glass is not blank through a doorway
    if (!inside && !(away < MIRROR_TUNE.near && !drawn)) { last = 0; return; }
    // in front of the glass, and the glass in view
    view.subVectors(centre, camPos);
    if (view.dot(normal) > 0) return;
    frustum.setFromProjectionMatrix(m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    if (!frustum.intersectsBox(box)) { last = 0; return; }

    // the frame rate, while the glass is being drawn in the gallery
    const now = performance.now() / 1000;
    const raw = last ? now - last : 0;
    last = now;
    if (inside && raw > 0 && raw < 0.5) {
      fps += (1 / raw - fps) * 0.05;
      stepDown(state, fps, raw);
    }
    stats.level = state.level;
    if (drawn && !drawsOn(state.level, frame)) return;
    ensureTarget();

    // the camera, reflected in the glass
    view.reflect(normal).negate().add(centre);
    rot.extractRotation(cam.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    tgt.subVectors(centre, look).reflect(normal).negate().add(centre);
    eye2.position.copy(view);
    eye2.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    eye2.lookAt(tgt);
    eye2.fov = cam.fov; eye2.aspect = cam.aspect; eye2.near = cam.near; eye2.far = Math.min(cam.far, MIRROR_TUNE.far);
    eye2.updateProjectionMatrix();
    eye2.updateMatrixWorld();
    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(eye2.projectionMatrix).multiply(eye2.matrixWorldInverse).multiply(mesh.matrixWorld);
    // the near plane laid on the glass, so nothing behind the wall is drawn in front of the room
    plane.setFromNormalAndCoplanarPoint(normal, centre).applyMatrix4(eye2.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = eye2.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1 - 0.003; pm[14] = clip.w;

    // the pass: the gallery alone, no shadow redraw, the glass itself out of it. Whatever happens in
    // it, the zones, the glass, the shadow and XR flags and the bound target are put back.
    saved.target = renderer.getRenderTarget();
    saved.shadows = renderer.shadowMap.autoUpdate;
    saved.xr = renderer.xr.enabled;
    saved.calls = renderer.info.render.calls;
    saved.tris = renderer.info.render.triangles;
    let ok = false;
    try {
      if (shell && shell.showOnly) shell.showOnly('gallery');
      if (props && props.showOnly) props.showOnly('gallery');
      mesh.visible = false;
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, eye2);
      ok = true;
    } catch (err) { // a pass that cannot be drawn is not tried again: the glass goes dull and the frame carries on
      failed = true;
      console.error('mirror: the pass failed; the glass is left dull', err);
    } finally {
      renderer.setRenderTarget(saved.target);
      renderer.shadowMap.autoUpdate = saved.shadows;
      renderer.xr.enabled = saved.xr;
      mesh.visible = true;
      if (props && props.showOnly) props.showOnly(null);
      if (shell && shell.showOnly) shell.showOnly(null);
    }
    if (failed) freeTarget();
    if (!ok) return;
    if (!drawn) { mesh.material = material; drawn = true; }
    stats.active = true;
    stats.passes += 1;
    stats.calls = renderer.info.render.calls - saved.calls;
    stats.triangles = renderer.info.render.triangles - saved.tris;
  }

  /** Frees the render target (the glass goes dull until it is next drawn). For any time the castle is not the room on screen. */
  function free() {
    freeTarget();
    last = 0;
  }

  function dispose() {
    freeTarget();
    parent.remove(mesh);
    geometry.dispose();
    material.dispose();
    dull.dispose();
  }

  return {
    render, free, dispose, mesh, stats,
    /** The camera the glass was last drawn with (layers 0 and 2). */
    get camera() { return eye2; },
    get level() { return state.level; },
    get target() { return target; },
  };
}
