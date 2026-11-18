// The Count's death (R15), the payoff of the castle: with the third curtain the sunlight bursts
// him into flames. He burns from the hands inward; pale, smoke-bodied, long-skulled, clawed
// shades, half bat and half man, claw out of his chest, shriek without a sound, and are torn up
// into a whirlwind of smoke and fire and out through the light; then he settles to ash in the
// box, in quiet dawn light with dust turning in it.
//
// Where he is comes from keepcast.js's countPoints (his chest and his two hands, in the world):
// the fire starts at the hands, and the points are latched while he still stands (before the
// whirl), so the whirlwind keeps its height while he sinks under it. Without them, or if he was
// never drawn, a chest 2.45 m over the floor at the box stands in.
//
// This file owns the fire, the smoke whirlwind, the five shades, the ash and the light of the
// burst. The Count himself (keepcast.js) chars and sinks under it, the curtains and their shafts
// are keepprops.js's, the room's dawn key is castle.js's, the scream is keepcues.js's.
//
// Timing is the logic's: count.js's `pyre` scene and PYRE_STAGES (scream 0, burn 1.5, shades 4,
// whirl 6.5, ash 8.5, of 10 s). Everything here is a pure function of the scene clock
// (sim.waves.scene.t): every particle's place is worked out in the vertex shader from that one
// number and a fixed seed, so nothing is simulated, nothing is allocated per frame, a paused
// scene holds still, and a frame at any second of the scene is always the same frame. Once he
// is ash (count.phase 'ash') the clock stands at its end and only the dust keeps turning.
//
// Cost: four draw calls. One instanced mesh of 700 quads (fire 240, smoke 250, embers 120, ash
// and dust 89, the burst's halo 1: so at most 700 alive, far fewer at most times), one
// instanced mesh of the five shades, the whirlwind's funnel, and the ash. No lights are added
// or removed (the room's light count never changes, so no shader is rebuilt in play). Built
// when the castle's shell first draws the Count's room (castle.sees('count')), shown and hidden
// with it, and freed once it is out of sight and the eye is 48 m off, or the room changes; with
// no shell to ask, by the eye's distance alone.
//
// Reduced flash: the dawn burst and the fire ease in instead of bursting, and nothing flickers.

import * as THREE from 'three';
import * as S from './sculpt.js';
import { COUNT_ROOM, UPPER, MIDDLE_CURTAIN } from '../logic/keepmap.js';
import { PYRE_STAGES, SCENE_TUNE } from '../logic/count.js';

const PHANTOM = 0xbfd4e6;
const FIRE = 240; const SMOKE = 250; const EMBERS = 120; const DUST = 89; const QUADS = FIRE + SMOKE + EMBERS + DUST + 1;
const SHADES = 5;
const BUILD_NEAR = 34; const FREE_FAR = 48;
const CHEST = 2.45; // his chest when he stands in the box, over the room's floor: used when keepcast.js's countPoints cannot say
const HAND_OUT = 0.89; const HAND_UP = 0.4; // his hands in the burn pose, from his chest, likewise
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const stageAt = (name, fallback) => { const p = PYRE_STAGES.find((s) => s.stage === name); return p ? p.from : fallback; };

/** The stages the view plays from, in seconds of the scene clock (count.js's PYRE_STAGES). */
export const PYRE_TIMES = Object.freeze({ burn: stageAt('burn', 1.5), shades: stageAt('shades', 4), whirl: stageAt('whirl', 6.5), ash: stageAt('ash', 8.5) });

const GLSL_COMMON = `
uniform float uT; uniform float uTime; uniform float uCalm; uniform float uSettle; uniform vec4 uStage;
uniform vec3 uC; uniform vec3 uLat; uniform vec3 uWin; uniform vec3 uH0; uniform vec3 uH1;
float h1( float n ) { return fract( sin( n * 127.1 ) * 43758.5453 ); }
vec3 bezP1() { return uC + vec3( 0.3, 3.4, 0.0 ); }
vec3 bez( float u ) { vec3 p0 = uC + vec3( 0.0, 0.3, 0.0 ); vec3 p1 = bezP1(); return mix( mix( p0, p1, u ), mix( p1, uWin, u ), u ); }
vec3 bezT( float u ) { vec3 p0 = uC + vec3( 0.0, 0.3, 0.0 ); vec3 p1 = bezP1(); return normalize( 2.0 * ( 1.0 - u ) * ( p1 - p0 ) + 2.0 * u * ( uWin - p1 ) ); }
float funR( float u ) { return 0.2 + 1.05 * pow( sin( 3.14159 * min( 1.0, u * 1.5 ) ), 0.8 ) * ( 1.0 - 0.75 * u ); }
float fireEnv( float t ) {
  float ramp = mix( 1.3, 2.8, uCalm );
  return ( 0.2 * smoothstep( 0.05, mix( 0.7, 1.4, uCalm ), t ) + 0.8 * smoothstep( uStage.x, uStage.x + ramp, t ) ) * ( 1.0 - 0.7 * smoothstep( uStage.z - 0.2, uStage.z + 0.8, t ) ) * ( 1.0 - smoothstep( uStage.z + 0.9, uStage.w, t ) );
}
float whirlEnv( float t ) { return smoothstep( uStage.z - 0.5, uStage.z + 0.5, t ); }
// everything that burns or blows is gone before the scene ends: only ash and dust are left
float goneEnv() { return 1.0 - smoothstep( uStage.w + 0.3, uStage.w + 1.2, uT ); }
float vnoise( vec3 x ) {
  vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  float n = dot( i, vec3( 1.0, 57.0, 113.0 ) );
  return mix( mix( mix( h1( n ), h1( n + 1.0 ), f.x ), mix( h1( n + 57.0 ), h1( n + 58.0 ), f.x ), f.y ),
              mix( mix( h1( n + 113.0 ), h1( n + 114.0 ), f.x ), mix( h1( n + 170.0 ), h1( n + 171.0 ), f.x ), f.y ), f.z );
}`;

/** Fire, smoke, embers, ash, dust and the halo of the burst: every quad placed from the scene clock. */
function fxMaterial(u) {
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: `
attribute vec4 aSeed; attribute float aKind;
varying vec2 vUv; varying vec4 vCol; varying vec2 vMode; varying float vSeed;
${GLSL_COMMON}
void main() {
  vUv = position.xy; vec4 s = aSeed; vSeed = s.x * 40.0;
  vec3 pos = uC; float size = 0.0; vec4 col = vec4( 0.0 ); float add = 1.0; float soft = 0.0; float tall = 1.0;
  float w = whirlEnv( uT );
  if ( aKind < 0.5 ) {
    // fire: it starts at the two hands and works inward to the chest, then takes all of him
    float L = 0.5 + 0.5 * s.x; float ph = fract( uT / L + s.y ); float age = ph * L; float tb = uT - age;
    float F = fireEnv( tb );
    float spread = smoothstep( uStage.x, uStage.y, tb );
    vec3 hand = s.w < 0.5 ? uH0 : uH1;
    float r = h1( s.z * 91.7 + 3.0 );
    vec3 body = uC + uLat * ( h1( s.x * 57.0 ) - 0.5 ) * 0.6 + vec3( 0.0, mix( 0.35, -1.25, ( r - 0.45 ) / 0.55 ), 0.0 ) + cross( uLat, vec3( 0.0, 1.0, 0.0 ) ) * ( h1( s.y * 31.0 ) - 0.5 ) * 0.4;
    vec3 p0 = r < 0.45 ? mix( hand, uC + vec3( 0.0, 0.15, 0.0 ), r / 0.45 ) : body;
    if ( spread * 1.15 < r ) p0 = hand + ( vec3( h1( s.x * 13.0 ), h1( s.y * 17.0 ), h1( s.z * 19.0 ) ) - 0.5 ) * 0.14;
    float rise = age * ( 1.2 + 1.3 * s.x ) * ( 1.0 + 1.6 * w );
    pos = p0 + vec3( sin( age * 9.0 + s.y * 40.0 ) * 0.07, rise, cos( age * 7.0 + s.x * 40.0 ) * 0.07 );
    float a = w * age * 7.0; vec2 d = pos.xz - uC.xz; float ca = cos( a ); float sa = sin( a );
    pos.xz = uC.xz + mat2( ca, -sa, sa, ca ) * d * ( 1.0 + w * age * 0.9 );
    size = step( s.z, F ) * ( 0.3 + 0.36 * h1( s.w * 77.0 ) ) * ( 1.0 - 0.55 * ph ) * smoothstep( 0.0, 0.08, ph );
    float fl = 1.0 + ( 1.0 - uCalm ) * 0.25 * sin( uTime * 23.0 + s.x * 50.0 );
    // K10: orange, laid over what is behind it rather than added to it, so where the tongues pile
    // up on him the burn (the hands, then inward) stays under the clipping point, never a white blob
    vec3 c = mix( vec3( 1.0, 0.6, 0.22 ), vec3( 1.0, 0.3, 0.05 ), smoothstep( 0.0, 0.4, ph ) );
    c = mix( c, vec3( 0.4, 0.05, 0.015 ), smoothstep( 0.4, 1.0, ph ) );
    col = vec4( c * fl, ( 1.0 - ph ) * 0.7 * goneEnv() ); tall = 1.7; add = 0.0;
  } else if ( aKind < 1.5 ) {
    // smoke: a plume while he burns, then the whirlwind, up and out through the middle window
    float L = 2.4 + 0.8 * s.x; float ph = fract( uT / L + s.y ); float tb = uT - ph * L;
    float S = smoothstep( uStage.x - 0.6, uStage.x + 1.0, tb ) * ( 0.4 + 0.6 * whirlEnv( tb + 0.3 ) ) * ( 1.0 - smoothstep( uStage.w - 0.4, uStage.w + 0.8, tb ) );
    S = max( S, 0.14 * smoothstep( 0.1, 0.8, tb ) * ( 1.0 - step( uStage.x, tb ) ) );
    vec3 plume = uC + vec3( ( h1( s.x * 7.0 ) - 0.5 ) * ( 0.3 + ph ), 0.4 + 3.2 * ph, ( h1( s.y * 9.0 ) - 0.5 ) * ( 0.3 + ph ) )
      + vec3( sin( uT * 1.3 + s.x * 20.0 ), 0.0, cos( uT * 1.1 + s.y * 20.0 ) ) * 0.15 * ph;
    vec3 T = bezT( ph ); vec3 N = normalize( cross( T, vec3( 0.0, 0.0, 1.0 ) ) ); vec3 B = cross( T, N );
    float ang = s.x * 6.283 + ph * ( 9.0 + 5.0 * s.w ) + uT * 2.6;
    vec3 curve = bez( ph ) + ( N * cos( ang ) + B * sin( ang ) ) * funR( ph ) * ( 0.55 + 0.45 * h1( s.z * 5.0 ) );
    pos = mix( plume, curve, w );
    size = step( s.z, S ) * mix( 0.55, 1.45, ph ) * ( 0.7 + 0.6 * s.w );
    vec3 c = vec3( 0.095, 0.088, 0.088 ) + vec3( 0.6, 0.22, 0.04 ) * pow( 1.0 - ph, 2.2 ) * ( 0.25 + fireEnv( uT ) )
      + vec3( 0.5, 0.38, 0.12 ) * smoothstep( 0.72, 1.0, ph ) * 0.4 * w;
    col = vec4( c, 0.5 * pow( sin( 3.14159 * ph ), 0.6 ) * goneEnv() ); add = 0.0; soft = 1.0;
  } else if ( aKind < 2.5 ) {
    // embers: sparks off him, then drawn round and up with the smoke
    float L = 1.3 + 1.2 * s.x; float ph = fract( uT / L + s.y ); float tb = uT - ph * L;
    float E = max( fireEnv( tb ) * ( 0.35 + 0.65 * w ), whirlEnv( tb ) * ( 1.0 - smoothstep( uStage.w, uStage.w + 0.8, tb ) ) );
    vec3 up = uC + vec3( ( h1( s.x * 3.0 ) - 0.5 ) * 0.8, -0.6 + 3.2 * ph * ( 1.0 + s.w ), ( h1( s.y * 5.0 ) - 0.5 ) * 0.8 )
      + vec3( sin( ph * 11.0 + s.x * 30.0 ), 0.0, cos( ph * 9.0 + s.y * 30.0 ) ) * 0.2;
    vec3 T = bezT( ph ); vec3 N = normalize( cross( T, vec3( 0.0, 0.0, 1.0 ) ) ); vec3 B = cross( T, N );
    float ang = s.x * 6.283 + ph * 14.0 + uT * 3.5;
    vec3 curve = bez( ph ) + ( N * cos( ang ) + B * sin( ang ) ) * funR( ph ) * ( 0.3 + 0.9 * h1( s.z * 3.0 ) );
    pos = mix( up, curve, w );
    size = step( s.z, E ) * ( 0.035 + 0.04 * s.w );
    col = vec4( vec3( 1.0, 0.55, 0.15 ) * ( 1.6 * ( 1.0 - ph ) + 0.2 ) * ( 0.7 + 0.3 * mix( sin( uTime * 30.0 + s.x * 90.0 ), 1.0, uCalm ) ), goneEnv() );
  } else if ( aKind < 3.5 ) {
    float A = smoothstep( uStage.w - 0.6, uStage.w + 0.8, uT );
    if ( s.w < 0.45 ) {
      // ash: flakes settling into the box
      float L = 2.2 + 1.5 * s.x; float ph = fract( ( uT + uSettle ) / L + s.y );
      pos = uC + vec3( ( h1( s.x * 3.0 ) - 0.5 ) * 1.3 + sin( ph * 6.0 + s.y * 20.0 ) * 0.12, 1.3 - 2.4 * ph, ( h1( s.y * 5.0 ) - 0.5 ) * 2.0 );
      size = 0.035 + 0.03 * s.z;
      col = vec4( vec3( 0.42, 0.4, 0.38 ), 0.7 * A * ( 1.0 - smoothstep( 1.5, 4.0, uSettle ) ) * sin( 3.14159 * ph ) ); add = 0.0;
    } else {
      // dust turning in the dawn, from the windows to the box: all that moves, afterwards
      float tt = uTime * 0.05 + s.y;
      pos = mix( uC + vec3( -1.5, -1.4, 0.0 ), uWin + vec3( -0.5, 0.3, 0.0 ), s.x )
        + vec3( 0.0, ( s.z - 0.5 ) * 2.6 + 0.3 * sin( tt * 6.283 ), ( h1( s.x * 11.0 ) - 0.5 ) * 5.0 + 0.4 * cos( tt * 6.283 + s.x * 9.0 ) );
      size = 0.025 + 0.025 * h1( s.z * 3.0 );
      col = vec4( vec3( 0.95, 0.76, 0.3 ) * 0.6, A * ( 0.5 + 0.5 * sin( uTime * 0.7 + s.x * 40.0 ) ) );
    }
  } else {
    // the burst: the dawn and then the fire, as one soft halo on him
    float burst = uCalm > 0.5
      ? 0.45 * smoothstep( 0.0, 1.5, uT ) * ( 1.0 - smoothstep( 1.5, 4.0, uT ) )
      : 1.5 * exp( -uT * 3.2 ) + 0.9 * exp( -max( 0.0, uT - uStage.x ) * 2.8 ) * step( uStage.x, uT );
    float glow = 0.3 * fireEnv( uT ) * ( 1.0 + ( 1.0 - uCalm ) * 0.12 * sin( uTime * 17.0 ) );
    pos = uC + vec3( 0.0, 0.1, 0.0 ); size = 9.0; soft = 2.0;
    col = vec4( mix( vec3( 1.0, 0.5, 0.16 ), vec3( 1.0, 0.8, 0.5 ), clamp( burst, 0.0, 1.0 ) ), min( 0.4, burst * 0.25 + glow * 0.18 ) * goneEnv() ); // K10: a glow, not a flare
  }
  if ( uT < 0.0 ) size = 0.0;
  vCol = col; vMode = vec2( add, soft );
  vec4 mv = viewMatrix * vec4( pos, 1.0 );
  mv.xy += position.xy * size * vec2( 1.0, tall );
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
varying vec2 vUv; varying vec4 vCol; varying vec2 vMode; varying float vSeed;
float h2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float n2( vec2 x ) { vec2 i = floor( x ); vec2 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f ); return mix( mix( h2( i ), h2( i + vec2( 1, 0 ) ), f.x ), mix( h2( i + vec2( 0, 1 ) ), h2( i + vec2( 1, 1 ) ), f.x ), f.y ); }
void main() {
  float d = length( vUv ) * 2.0;
  float a = vMode.y > 1.5 ? pow( max( 0.0, 1.0 - d ), 4.0 ) : smoothstep( 1.0, 0.15, d );
  if ( vMode.y > 0.5 && vMode.y < 1.5 ) a *= 0.45 + 0.75 * n2( vUv * 3.2 + vSeed );
  a *= vCol.a;
  if ( a < 0.0006 ) discard;
  // K10: encode, then premultiply (three's own order): premultiplying first made every faint
  // layer bright in sRGB, so the fire and the smoke summed to white
  gl_FragColor = vec4( vCol.rgb, 1.0 );
  #include <colorspace_fragment>
  gl_FragColor = vec4( gl_FragColor.rgb * a, a * ( 1.0 - vMode.x ) );
}`,
    transparent: true, depthWrite: false, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

/** The shades: see-through, brightest at their edges, their bodies running like smoke. */
function shadeMaterial(u) {
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: `
attribute vec4 aFx; // alpha, seed, torn (0 to 1), unused
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vDen; varying vec4 vFx;
${GLSL_COMMON}
void main() {
  vec3 p = position; vFx = aFx;
  float lowness = clamp( 0.35 - p.y, 0.0, 1.5 );
  // the body below the ribs is smoke: it runs and wavers; the head thrashes
  p.x += sin( p.y * 5.0 + uT * 9.0 + aFx.y ) * 0.09 * lowness;
  p.z += cos( p.y * 4.0 + uT * 7.0 + aFx.y * 1.7 ) * 0.09 * lowness;
  float hd = smoothstep( 0.3, 0.6, p.y );
  p.x += sin( uT * 13.0 + aFx.y * 3.0 ) * 0.035 * hd;
  vec4 wp = modelMatrix * instanceMatrix * vec4( p, 1.0 );
  vec4 mv = viewMatrix * wp;
  vN = normalize( mat3( viewMatrix * modelMatrix * instanceMatrix ) * normal );
  vV = normalize( -mv.xyz ); vP = position; vDen = color.r;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
uniform vec3 uPale;
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying float vDen; varying vec4 vFx;
${GLSL_COMMON}
void main() {
  float fres = pow( 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) ), 1.6 );
  float n = vnoise( vP * 7.0 + vec3( 0.0, -uT * 1.8, vFx.y ) );
  float a = vDen * ( 0.34 + 0.5 * fres ) * ( 0.6 + 0.5 * n ) * vFx.x; // K10: more body than before, so they read as figures
  a *= 1.0 - smoothstep( 0.2, 1.0, vFx.z + ( n - 0.5 ) * 0.5 ) * 0.85; // torn thin as it goes
  if ( a < 0.004 ) discard;
  // K10: Phantom at a third strength, a little more at the edge (never the white of a scribble);
  // the fire under them warms their undersides
  vec3 c = uPale * ( 0.33 + 0.24 * fres ) + vec3( 0.5, 0.2, 0.05 ) * clamp( 0.3 - vP.y, 0.0, 1.0 ) * fireEnv( uT ) * 0.5;
  gl_FragColor = vec4( c, 1.0 );
  #include <colorspace_fragment>
  gl_FragColor = vec4( gl_FragColor.rgb * a, a ); // encoded, then premultiplied (K10)
}`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexColors: true, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

/** The whirlwind's body: a twisting funnel of smoke with fire in its foot. */
function funnelMaterial(u) {
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: `
attribute vec2 aUA; // along (0 at his chest, 1 at the window), angle round
varying vec2 vUA; varying float vFace;
${GLSL_COMMON}
void main() {
  vUA = aUA; float uu = aUA.x;
  vec3 T = bezT( uu ); vec3 N = normalize( cross( T, vec3( 0.0, 0.0, 1.0 ) ) ); vec3 B = cross( T, N );
  float sway = sin( uT * 3.1 + uu * 7.0 ) * 0.22 * uu * ( 1.0 - uu ) * 4.0;
  float R = funR( uu ) * ( 1.0 + 0.16 * sin( aUA.y * 3.0 + uu * 14.0 - uT * 6.0 ) );
  vec3 rad = N * cos( aUA.y ) + B * sin( aUA.y );
  vec3 p = bez( uu ) + rad * R + N * sway + B * sway * 0.6;
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  vFace = abs( dot( normalize( mat3( viewMatrix ) * rad ), normalize( -mv.xyz ) ) );
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
varying vec2 vUA; varying float vFace;
${GLSL_COMMON}
void main() {
  float env = smoothstep( uStage.z - 0.3, uStage.z + 0.7, uT ) * ( 1.0 - smoothstep( uStage.w - 0.2, uStage.w + 0.9, uT ) );
  float tw = vUA.y * 2.0 + vUA.x * 17.0 - uT * 7.5;
  float streak = 0.5 + 0.5 * sin( tw + 2.5 * vnoise( vec3( vUA.y * 1.5, vUA.x * 9.0 - uT * 2.5, 3.0 ) ) );
  float body = vnoise( vec3( cos( vUA.y ) * 2.0, vUA.x * 11.0 - uT * 3.0, sin( vUA.y ) * 2.0 ) );
  float a = env * ( 0.16 + 0.6 * streak * body ) * smoothstep( 0.0, 0.1, vUA.x ) * ( 1.0 - smoothstep( 0.8, 1.0, vUA.x ) ) * smoothstep( 0.0, 0.55, vFace );
  if ( a < 0.004 ) discard;
  vec3 smoke = vec3( 0.1, 0.092, 0.09 ) * ( 0.35 + 1.0 * body );
  vec3 fire = vec3( 0.95, 0.36, 0.07 ) * pow( 1.0 - vUA.x, 1.4 ) * streak * 0.8 + vec3( 0.6, 0.45, 0.16 ) * smoothstep( 0.6, 1.0, vUA.x ) * 0.35;
  gl_FragColor = vec4( smoke + fire, 1.0 );
  #include <colorspace_fragment>
  gl_FragColor = vec4( gl_FragColor.rgb * a, a ); // encoded, then premultiplied (K10)
}`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

/**
 * One shade, as geometry (vertex colour red is its density): a long skull with the jaw wide, a
 * cage of ribs trailing off into a wisp, and two arms that are half wing, clawed, reaching.
 * Its own up is +Y and its face is +Z.
 */
function shadeGeometry() {
  const parts = [];
  const den = (g, d0, d1 = d0, y0 = -1, y1 = 1) => {
    const p = g.attributes.position; const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const k = clamp((p.getY(i) - y0) / (y1 - y0)); c[i * 3] = lerp(d0, d1, k); c[i * 3 + 1] = 1; c[i * 3 + 2] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  };
  const skin = (rings, o = {}) => S.skin(rings, { sides: 9, detail: 2, noise: 0.06, budget: 260, seed: 5, ...o });
  // the smoke of the body: a wisp, the hollow belly, the ribs, the shoulders, the neck
  den(skin([{ at: [0, -1.25, 0.05], r: 0.012 }, { at: [0.04, -0.85, 0], r: 0.05 }, { at: [-0.02, -0.45, 0.03], r: [0.09, 0.07] }, { at: [0, -0.15, 0], r: [0.18, 0.12] }, { at: [0, 0.1, 0], r: [0.21, 0.12] }, { at: [0, 0.27, 0.03], r: 0.06 }, { at: [0, 0.4, 0.07], r: 0.05 }],
    { sides: 10, detail: 3, budget: 420, profile: (a, u) => 1 + (u > 0.5 && u < 0.8 ? 0.16 * Math.sin(u * 95) : 0) }), 0.1, 1, -1.25, -0.1);
  // the long skull, swept far back, and the snout
  den(skin([{ at: [0, 0.74, -0.52], r: 0.03 }, { at: [0, 0.72, -0.3], r: [0.1, 0.1] }, { at: [0, 0.62, -0.04], r: [0.13, 0.15] }, { at: [0, 0.52, 0.16], r: [0.1, 0.11] }, { at: [0, 0.47, 0.3], r: [0.065, 0.05] }, { at: [0, 0.46, 0.36], r: 0.03 }], { budget: 340, detail: 3 }), 1.25);
  // the jaw, dropped right open
  den(skin([{ at: [0, 0.5, 0.02], r: 0.06 }, { at: [0, 0.33, 0.14], r: [0.07, 0.035] }, { at: [0, 0.22, 0.26], r: [0.045, 0.02] }, { at: [0, 0.2, 0.31], r: 0.012 }], { budget: 140 }), 1.2);
  for (const sd of [-1, 1]) {
    // the sockets' rims, the ears (a bat's), fangs above and below
    den(skin([{ at: [sd * 0.075, 0.6, 0.12], r: 0.04 }, { at: [sd * 0.09, 0.63, 0.15], r: 0.012 }], { budget: 40, sides: 5 }), 2.2);
    den(skin([{ at: [sd * 0.1, 0.7, -0.1], r: [0.05, 0.02] }, { at: [sd * 0.19, 0.92, -0.16], r: [0.045, 0.012] }, { at: [sd * 0.22, 1.06, -0.2], r: 0.006 }], { budget: 60, sides: 5 }), 0.9);
    den(skin([{ at: [sd * 0.04, 0.44, 0.33], r: 0.013 }, { at: [sd * 0.04, 0.37, 0.34], r: 0.003 }], { budget: 24, sides: 4 }), 2.2);
    den(skin([{ at: [sd * 0.03, 0.24, 0.27], r: 0.011 }, { at: [sd * 0.03, 0.3, 0.29], r: 0.003 }], { budget: 24, sides: 4 }), 2.2);
    // the arm: shoulder, elbow, wrist, thrown up and forward
    const sh = [sd * 0.2, 0.12, 0]; const el = [sd * 0.52, 0.3, 0.14]; const wr = [sd * 0.6, 0.72, 0.42];
    den(skin([{ at: sh, r: 0.05 }, { at: el, r: 0.032 }, { at: wr, r: 0.024 }], { budget: 110, sides: 6 }), 1.1);
    // three claws off the wrist, and the long finger that carries the wing
    for (let f = 0; f < 3; f++) {
      const a = (f - 1) * 0.5;
      den(skin([{ at: wr, r: 0.016 }, { at: [wr[0] + sd * Math.sin(a) * 0.13 - sd * 0.04, wr[1] + 0.15, wr[2] + 0.16 + Math.cos(a) * 0.04], r: 0.012 }, { at: [wr[0] + sd * Math.sin(a) * 0.2 - sd * 0.1, wr[1] + 0.1, wr[2] + 0.34], r: 0.002 }], { budget: 40, sides: 4 }), 1.6);
    }
    const tip = [sd * 1.05, 0.25, -0.12]; const mid = [sd * 0.8, -0.3, -0.08]; const low = [sd * 0.34, -0.5, -0.04];
    den(skin([{ at: wr, r: 0.014 }, { at: [sd * 0.9, 0.62, 0.08], r: 0.01 }, { at: tip, r: 0.003 }], { budget: 40, sides: 4 }), 1.2);
    // the membrane: scalloped, between the arm, the long finger and the ribs
    const tri = new THREE.BufferGeometry();
    const P = [sh, el, wr, tip, mid, low, [sd * 0.16, -0.2, 0]];
    const v = []; const add = (a, b, c) => v.push(...P[a], ...P[b], ...P[c]);
    add(0, 1, 5); add(1, 4, 5); add(1, 2, 4); add(2, 3, 4); add(0, 5, 6);
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    tri.computeVertexNormals();
    den(tri, 0.42);
  }
  for (const g of parts) if (!g.attributes.normal) g.computeVertexNormals();
  const out = S.merge(parts);
  for (const g of parts) g.dispose();
  return out;
}

/** The ash: grey-black, lying on the earth in the box in the shape of the man it was. */
function ashGeometry(seed) {
  const nx = 18; const nz = 36; const hx = 0.46; const hz = 1.02;
  const pos = new Float32Array(nx * nz * 3); const col = new Float32Array(nx * nz * 3); const idx = [];
  const bump = (x, z, cx, cz, rx, rz, h) => { const d = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2; return d < 1 ? h * (1 - d) ** 0.6 : 0; };
  const c = new THREE.Color(); const pale = new THREE.Color(0xa3a8b4); const dark = new THREE.Color(0x060607);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = lerp(-hx, hx, i / (nx - 1)); const z = lerp(-hz, hz, j / (nz - 1));
      const rim = Math.min(1, (hx - Math.abs(x)) / 0.08, (hz - Math.abs(z)) / 0.08);
      // a man on his back: the skull, the shoulders and chest, the hips, two legs, two arms a little out from the sides
      const man = Math.max(
        bump(x, z, 0, -0.8, 0.14, 0.15, 0.34), bump(x, z, 0, -0.44, 0.29, 0.19, 0.27), bump(x, z, 0, -0.16, 0.2, 0.24, 0.24), bump(x, z, 0, 0.12, 0.21, 0.15, 0.19),
        bump(x, z, -0.11, 0.52, 0.08, 0.4, 0.16), bump(x, z, 0.11, 0.52, 0.08, 0.4, 0.16), bump(x, z, -0.11, 0.93, 0.07, 0.07, 0.24), bump(x, z, 0.11, 0.93, 0.07, 0.07, 0.24),
        bump(x, z, -0.36, -0.14, 0.055, 0.34, 0.13), bump(x, z, 0.36, -0.14, 0.055, 0.34, 0.13),
      );
      const grit = S.noise(x * 17, 1, z * 17, seed + 2);
      // the drift's edge runs down to the earth; everything of the man stands above the rim
      const h = lerp(-0.09, 0.02 + 0.012 * S.noise(x * 6, 0, z * 6, seed) + man * (0.9 + 0.2 * grit), clamp(rim));
      const k = (j * nx + i) * 3;
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
      // black cinder in the hollows and round him, grey ash on what stands up, a few pale flakes
      c.copy(dark).lerp(pale, smooth(0.03, 0.16, man) * (0.7 + 0.3 * grit));
      if (man < 0.03 && S.noise(x * 34, 2, z * 34, seed + 4) > 0.62) c.lerp(pale, 0.35);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      if (i < nx - 1 && j < nz - 1) { const a = j * nx + i; idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * createPyre(scene, cfg) -> the layer actors.js runs: { sync(sim, dt, time, eye), onEvent(ev),
 * clear(), setReducedFlash(on), counts(), dispose() }. cfg is CASTLE_CONFIG (cfg.scenes.pyre is
 * the scene's length).
 */
export function createPyre(scene, cfg) {
  const total = (cfg && cfg.scenes && Number.isFinite(cfg.scenes.pyre) ? cfg.scenes.pyre : SCENE_TUNE.pyre) || 10;
  // The second by which everything but ash and dust is gone. A scene tuned shorter than this is
  // carried on to it by the view's own clock once the scene ends, so nothing freezes in the air.
  const end = Math.max(total, PYRE_TIMES.ash + 1.3);
  const box = COUNT_ROOM.boxAt; const win = COUNT_ROOM.curtains[MIDDLE_CURTAIN]; // the middle window (#7)
  const C = new THREE.Vector3(box.x, UPPER + CHEST, box.z);
  const WIN = new THREE.Vector3(win.x - 0.5, UPPER + 3.0, win.z);
  const P0 = new THREE.Vector3(); const P1 = new THREE.Vector3();
  const H0 = new THREE.Vector3(); const H1 = new THREE.Vector3();
  const curveFrom = () => { P0.set(C.x, C.y + 0.3, C.z); P1.set(C.x + 0.3, C.y + 3.4, C.z); };
  curveFrom();
  const root = new THREE.Group();
  root.name = 'pyre';
  root.visible = false;
  scene.add(root);

  const uniforms = {
    uT: { value: -1 }, uTime: { value: 0 }, uCalm: { value: 0 }, uSettle: { value: 0 },
    uStage: { value: new THREE.Vector4(PYRE_TIMES.burn, PYRE_TIMES.shades, PYRE_TIMES.whirl, PYRE_TIMES.ash) },
    uC: { value: C }, uH0: { value: H0 }, uH1: { value: H1 }, uLat: { value: new THREE.Vector3(0, 0, 1) }, uWin: { value: WIN }, uPale: { value: new THREE.Color(PHANTOM) },
  };
  let built = null; // { fx, shades, funnel, ash, fxArr }
  let reduced = false;
  let settle = 0; let tNow = -1; let held = -1;
  let clock = 0; // seconds of the game's own time (dt summed): the flicker and the dust run on it, so a pause holds them still
  let tail = -1; // the scene clock carried on past a short scene's end, up to `end`
  // keepcast.js's countPoints ({ live, chest, hands: [right, left] }, world positions), if that module is there
  let points = null; let latched = false;
  import('./keepcast.js').then((m) => { if (m && m.countPoints && m.countPoints.chest && Array.isArray(m.countPoints.hands)) points = m.countPoints; }).catch(() => {});

  // The shell (castle.js's handle), when it has been passed on (setShell) or left on its own
  // group (userData.castle): its sees(zone) says whether the shell is drawing that zone now.
  let shell = null; // passed on by setShell
  let found = null; // found on the scene once, and kept until its group leaves the scene
  let sought = 0; // frames until the scene is searched again (a search walks the whole graph)
  function shellSees(id) {
    let s = shell;
    if (!s) {
      if (found && !(found.group && found.group.parent)) found = null;
      if (!found && --sought < 0) {
        const g = scene.getObjectByName('castle');
        const h = g && g.userData ? g.userData.castle || g.userData.shell : null;
        if (h && typeof h.sees === 'function') found = h; else sought = 120;
      }
      s = found;
    }
    return s && typeof s.sees === 'function' ? !!s.sees(id) : null; // null: no shell to ask
  }

  const _o = new THREE.Object3D(); const _a = new THREE.Vector3(); const _b = new THREE.Vector3(); const _t = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0); const _q = new THREE.Quaternion(); const _q2 = new THREE.Quaternion();
  const bez = (u, out) => { _a.lerpVectors(P0, P1, u); _b.lerpVectors(P1, WIN, u); return out.lerpVectors(_a, _b, u); };
  const bezT = (u, out) => out.subVectors(P1, P0).multiplyScalar(2 * (1 - u)).addScaledVector(_b.subVectors(WIN, P1), 2 * u).normalize();
  const funR = (u) => 0.2 + 1.05 * Math.sin(Math.PI * Math.min(1, u * 1.5)) ** 0.8 * (1 - 0.75 * u);

  function build() {
    const rnd = S.rng(1897);
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(QUADS * 4); const kind = new Float32Array(QUADS);
    for (let i = 0; i < QUADS; i++) {
      kind[i] = i < FIRE ? 0 : i < FIRE + SMOKE ? 1 : i < FIRE + SMOKE + EMBERS ? 2 : i < QUADS - 1 ? 3 : 4;
      for (let j = 0; j < 4; j++) seed[i * 4 + j] = rnd();
    }
    quad.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    quad.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
    quad.instanceCount = QUADS;
    const fx = new THREE.Mesh(quad, fxMaterial(uniforms));
    fx.frustumCulled = false; fx.renderOrder = 6;

    const sg = shadeGeometry();
    const fxArr = new Float32Array(SHADES * 4);
    sg.setAttribute('aFx', new THREE.InstancedBufferAttribute(fxArr, 4).setUsage(THREE.DynamicDrawUsage));
    const shades = new THREE.InstancedMesh(sg, shadeMaterial(uniforms), SHADES);
    shades.frustumCulled = false; shades.renderOrder = 7; shades.visible = false;

    // the funnel: a tube of rings along the same curve the smoke rides, shaped in the shader
    const rings = 40; const round = 18;
    const fpos = new Float32Array((rings + 1) * (round + 1) * 3); const fua = new Float32Array((rings + 1) * (round + 1) * 2); const fidx = [];
    for (let r = 0; r <= rings; r++) {
      for (let k = 0; k <= round; k++) {
        const i = r * (round + 1) + k;
        fua[i * 2] = r / rings; fua[i * 2 + 1] = (k / round) * Math.PI * 2;
        if (r < rings && k < round) fidx.push(i, i + 1, i + round + 1, i + 1, i + round + 2, i + round + 1);
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    fg.setAttribute('aUA', new THREE.BufferAttribute(fua, 2));
    fg.setIndex(fidx);
    const funnel = new THREE.Mesh(fg, funnelMaterial(uniforms));
    funnel.frustumCulled = false; funnel.renderOrder = 5; funnel.visible = false;

    const ash = new THREE.Mesh(ashGeometry(50), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    ash.position.set(box.x, UPPER + COUNT_ROOM.box.h + 0.02, box.z); // its foot at the box's rim (the earth stands just under it), so all of the figure is clear of the boards
    ash.receiveShadow = true; ash.visible = false;

    root.add(ash, funnel, fx, shades);
    built = { fx, shades, funnel, ash, fxArr };
  }

  function free() {
    const b = built; if (!b) return;
    for (const m of [b.fx, b.shades, b.funnel, b.ash]) { root.remove(m); m.geometry.dispose(); m.material.dispose(); }
    b.shades.dispose();
    built = null;
    root.visible = false;
  }

  /** Where each shade is at scene second t: out of his chest, hung there shrieking, torn up and out. */
  function placeShades(t) {
    const b = built;
    let any = false;
    for (let i = 0; i < SHADES; i++) {
      const born = PYRE_TIMES.shades + i * 0.4; const tear = PYRE_TIMES.whirl + i * 0.22;
      const tau = t - born; const k = clamp((t - tear) / 1.5);
      const alive = tau > 0 && k < 1;
      b.fxArr[i * 4] = alive ? smooth(0, 0.35, tau) * (1 - smooth(0.6, 1, k)) : 0;
      b.fxArr[i * 4 + 1] = i * 2.4; b.fxArr[i * 4 + 2] = k;
      if (!alive) { _o.position.set(0, -100, 0); _o.scale.setScalar(0.0001); _o.rotation.set(0, 0, 0); _o.updateMatrix(); b.shades.setMatrixAt(i, _o.matrix); continue; }
      any = true;
      // a fan of five, leaning out of him every way
      const a = (i / SHADES) * Math.PI * 2 + 0.6; const dx = Math.sin(a); const dz = Math.cos(a);
      const e = 1 - (1 - clamp(tau / 0.8)) ** 2;
      const wob = Math.sin(t * 5 + i * 2.1);
      const out = 0.35 * e + 0.55 * smooth(0.5, 1.6, tau) + 0.06 * wob;
      const up = -0.5 + 1.5 * e + 0.45 * smooth(0.6, 2, tau) * (1 + 0.6 * (i % 3)) + 0.07 * Math.sin(t * 4 + i);
      _o.position.set(C.x + dx * out, C.y + up, C.z + dz * out);
      // its own up leans out along the fan and thrashes; it faces outward
      _t.set(dx * (0.45 + 0.2 * wob), 1, dz * (0.45 + 0.2 * Math.sin(t * 6.3 + i))).normalize();
      _q.setFromUnitVectors(_up, _t);
      _q2.setFromAxisAngle(_up, Math.atan2(dx, dz) + 0.35 * Math.sin(t * 3.7 + i * 1.3));
      _o.quaternion.copy(_q).multiply(_q2);
      const s0 = (0.25 + 1.2 * e) * (0.9 + 0.1 * (i % 2));
      _o.scale.set(s0, s0, s0);
      if (k > 0) {
        // torn: dragged up the whirlwind tail first, clawing back at him, stretched thin
        const u = k * k * (0.4 + 0.6 * k);
        bez(u, _a); bezT(u, _t);
        const ang = i * 1.3 + k * 9; const rr = funR(u) * 0.7;
        _b.set(0, 0, 1).cross(_t).normalize(); // N
        _a.addScaledVector(_b, Math.cos(ang) * rr);
        _b.cross(_t); // B (unit: N and T are square)
        _a.addScaledVector(_b, Math.sin(ang) * rr);
        const kk = smooth(0, 0.3, k);
        _o.position.lerp(_a, kk);
        _q.setFromUnitVectors(_up, _t.negate());
        _o.quaternion.slerp(_q.multiply(_q2), kk);
        _o.scale.set(s0 * (1 - 0.6 * k), s0 * (1 + 1.5 * k), s0 * (1 - 0.6 * k));
      }
      _o.updateMatrix();
      b.shades.setMatrixAt(i, _o.matrix);
    }
    b.shades.visible = any;
    if (any) { b.shades.instanceMatrix.needsUpdate = true; b.shades.geometry.attributes.aFx.needsUpdate = true; }
  }

  function sync(sim, dt, time, eye) {
    const w = sim && sim.cfg && sim.cfg.room === 'castle' ? sim.waves : null;
    const cs = w && w.count;
    if (!cs || !eye) { if (built) free(); tNow = -1; tail = -1; return; }
    const seen = shellSees('count');
    const d = Math.hypot(eye.x - box.x, eye.z - box.z);
    if (seen !== null) {
      // the shell decides what is drawn. Built when the Count's room is first seen and kept while
      // the eye is near (a step back through the door hides it, never rebuilds it); freed only out
      // of sight and far away. The clocks run on while it is hidden.
      if (!seen && built && d > FREE_FAR) free();
      if (seen && !built) build();
    } else {
      // no shell to ask: by the eye's distance
      if (!built) { if (d > BUILD_NEAR || eye.y < UPPER - 2.5) return; build(); }
      else if (d > FREE_FAR) { free(); return; }
    }
    // the scene clock, and nothing else
    const sc = w.scene && w.scene.kind === 'pyre' ? w.scene : null;
    let t = -1;
    if (sc) t = Number.isFinite(sc.t) ? sc.t : total - (Number.isFinite(sc.left) ? sc.left : total);
    else if (cs.phase === 'ash' || (w.done && w.done.dawn)) {
      // he is ash: the clock stands at `end`, reached from where the scene left it
      tail = tail < 0 ? (tNow >= 0 && tNow < end ? tNow : end) : Math.min(end, tail + dt);
      t = tail;
    } else if (cs.phase === 'burning') t = held; // between the curtain and the scene's first frame
    if (sc) { held = t; tail = -1; }
    clock += dt;
    const after = t >= end;
    settle = after ? (tNow >= 0 && tNow < end ? 0 : Math.min(8, settle + dt)) : 0;
    if (after && tNow < 0 && dt === 0) settle = 8; // seated straight into the dawn: the ash has long settled
    tNow = t;
    root.visible = !!built && t >= 0 && (seen !== null ? seen : eye.y > UPPER - 2.5);
    if (!root.visible) return;
    t = Math.min(t, end);
    uniforms.uT.value = t; uniforms.uTime.value = clock; uniforms.uCalm.value = reduced ? 1 : 0; uniforms.uSettle.value = settle;
    // where he is: his own chest and hands while he stands (latched before the whirl, so the
    // whirlwind keeps its height while he sinks); else the stand-in, hands either side as the eye sees him
    if (t < PYRE_TIMES.burn * 0.2 && !(points && points.live)) latched = false;
    if (points && points.live && t < PYRE_TIMES.whirl) {
      C.copy(points.chest); H0.copy(points.hands[0]); H1.copy(points.hands[1]);
      const hx = H1.x - H0.x; const hz = H1.z - H0.z; const hl = Math.hypot(hx, hz);
      if (hl > 0.05) uniforms.uLat.value.set(hx / hl, 0, hz / hl);
      latched = true;
      curveFrom();
    } else if (!latched) {
      C.set(box.x, UPPER + CHEST, box.z);
      const lx = eye.z - C.z; const lz = -(eye.x - C.x); const ll = Math.hypot(lx, lz) || 1;
      uniforms.uLat.value.set(lx / ll, 0, lz / ll);
      H0.copy(C).addScaledVector(uniforms.uLat.value, -HAND_OUT).y += HAND_UP;
      H1.copy(C).addScaledVector(uniforms.uLat.value, HAND_OUT).y += HAND_UP;
      curveFrom();
    }
    const b = built;
    b.funnel.visible = t > PYRE_TIMES.whirl - 0.3 && t < PYRE_TIMES.ash + 0.9;
    b.ash.visible = t > PYRE_TIMES.whirl;
    b.ash.scale.set(1, Math.max(0.02, smooth(PYRE_TIMES.whirl, PYRE_TIMES.ash + 0.8, t)), 1);
    placeShades(t);
  }

  /** How many quads the shader draws at scene second t (the same envelopes it uses), for the budget. */
  function aliveAt(t) {
    if (t < 0) return 0;
    const calm = reduced ? 1 : 0;
    const fireEnv = (x) => (0.2 * smooth(0.05, lerp(0.7, 1.4, calm), x) + 0.8 * smooth(PYRE_TIMES.burn, PYRE_TIMES.burn + lerp(1.3, 2.8, calm), x)) * (1 - 0.7 * smooth(PYRE_TIMES.whirl - 0.2, PYRE_TIMES.whirl + 0.8, x)) * (1 - smooth(PYRE_TIMES.whirl + 0.9, PYRE_TIMES.ash, x));
    const whirl = (x) => smooth(PYRE_TIMES.whirl - 0.5, PYRE_TIMES.whirl + 0.5, x);
    const gone = 1 - smooth(PYRE_TIMES.ash + 0.3, PYRE_TIMES.ash + 1.2, t);
    const smoke = Math.max(smooth(PYRE_TIMES.burn - 0.6, PYRE_TIMES.burn + 1, t) * (0.4 + 0.6 * whirl(t + 0.3)) * (1 - smooth(PYRE_TIMES.ash - 0.4, PYRE_TIMES.ash + 0.8, t)), t < PYRE_TIMES.burn ? 0.14 * smooth(0.1, 0.8, t) : 0);
    const ember = Math.max(fireEnv(t) * (0.35 + 0.65 * whirl(t)), whirl(t) * (1 - smooth(PYRE_TIMES.ash, PYRE_TIMES.ash + 0.8, t)));
    const dust = smooth(PYRE_TIMES.ash - 0.6, PYRE_TIMES.ash + 0.8, t);
    return Math.round((FIRE * fireEnv(t) + SMOKE * smoke + EMBERS * ember + 1) * (gone > 0 ? 1 : 0) + DUST * dust);
  }

  const api = {
    group: root, sync,
    /** The shell (castle.js's handle): its sees('count') then decides when the pyre is built, drawn and freed. */
    setShell(s) { shell = s || null; },
    onEvent(ev) { if (ev && ev.type === 'restored') { tNow = -1; held = -1; tail = -1; settle = 0; latched = false; } },
    clear() { tNow = -1; held = -1; tail = -1; settle = 0; latched = false; root.visible = false; },
    setReducedFlash(on) { reduced = !!on; },
    /** { built, t, calls, quads (alive now), shades (drawn now), triangles } for the frame budget. */
    counts() {
      if (!built || !root.visible) return { built: !!built, t: tNow, calls: 0, quads: 0, shades: 0, triangles: 0, latched };
      const b = built; const quads = aliveAt(Math.min(tNow, end));
      let shades = 0; for (let i = 0; i < SHADES; i++) if (b.fxArr[i * 4] > 0) shades++;
      const tri = (m) => m.geometry.index.count / 3;
      return {
        built: true, t: tNow, quads, shades, latched, chest: [C.x, C.y, C.z],
        calls: 1 + (b.shades.visible ? 1 : 0) + (b.funnel.visible ? 1 : 0) + (b.ash.visible ? 1 : 0),
        triangles: QUADS * 2 + (b.shades.visible ? tri(b.shades) * SHADES : 0) + (b.funnel.visible ? tri(b.funnel) : 0) + (b.ash.visible ? tri(b.ash) : 0),
      };
    },
    /** Frees everything and leaves the scene. */
    dispose() { free(); scene.remove(root); },
  };
  root.userData.pyre = api; // found by name on the scene, as keepprops is
  return api;
}
