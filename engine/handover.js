// The hand-over between two levels (issue #29) without a freeze or a cut. One full-screen quad
// drawn over the frame (one draw call while it shows, none otherwise):
//   fade(hex, k)       a flat colour at strength k: the dark of the yard's crater as the warden
//                      goes down into it, the daylight of the Nave's shaft going up (journey.js k)
//   arrive(hex, secs)  the same colour at full, clearing over secs as the next level comes up
// While main.js is still building the new level's programs it holds the cover at full (update
// with dt 0), and play goes on beneath it.

import * as THREE from 'three';

export function createHandover(renderer) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Vector3() }, alpha: { value: 0 } },
    vertexShader: 'varying vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = vec4( position.xy, 0.0, 1.0 );\n}',
    fragmentShader: [
      'uniform vec3 color;', 'uniform float alpha;', 'varying vec2 vUv;',
      'void main() {',
      '  gl_FragColor = vec4( color, alpha );',
      '}',
    ].join('\n'),
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  let alpha = 0;
  let clear = 0; // seconds over which the overlay clears (arrive); 0: held by fade()
  let mode = 'none';

  const rgb = (hex) => mat.uniforms.color.value.set(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

  return {
    /** A flat colour over the view at strength k (0 to 1), held until changed. */
    fade(hex, k) {
      if (mode === 'arrive') return; // a clearing overlay runs its course first
      mode = k > 0.002 ? 'fade' : 'none';
      rgb(hex);
      alpha = Math.max(0, Math.min(1, k));
      clear = 0;
    },
    /** The colour at full, clearing over `secs` as the new level comes up. */
    arrive(hex, secs) {
      mode = 'arrive';
      rgb(hex);
      alpha = 1;
      clear = secs;
    },
    /** dt: the frame's seconds (wall time); 0 holds the cover where it is. */
    update(dt) {
      if (mode === 'arrive' && clear > 0) {
        alpha = Math.max(0, alpha - dt / clear);
        if (alpha <= 0) { mode = 'none'; clear = 0; }
      }
      // ease: slow at the start, so the first frames of the new level are mostly the old one
      mat.uniforms.alpha.value = mode === 'fade' ? alpha : alpha * alpha * (3 - 2 * alpha);
    },
    /** Draws the overlay over whatever is on screen, if it shows. */
    render() {
      if (mode === 'none' || mat.uniforms.alpha.value <= 0.002) return;
      renderer.render(scene, cam);
    },
    /** Drops whatever shows (a new run, back to the title). */
    reset() {
      mode = 'none';
      alpha = 0;
      clear = 0;
      mat.uniforms.alpha.value = 0;
    },
    get showing() { return mode !== 'none'; },
    get mode() { return mode; },
  };
}
