import * as THREE from 'three';
import { toonGradient } from '../render/toon';

const linear = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b);

/**
 * Uniforms shared by every environment-aware material. There is one object for the whole
 * scene; `Environment` writes it once per frame and all materials see the change.
 */
export const ENV = {
  uSunDir: { value: new THREE.Vector3(1, 0, 0) },
  uMoonDir: { value: new THREE.Vector3(-1, 0, 0) },
  uTime: { value: 0 },
  /** Wind is the tangent field cross(uWindAxis, up): a smooth "rotation" around the planet. */
  uWindAxis: { value: new THREE.Vector3(0, 1, 0) },
  /** Current wind strength incl. gusts, 0..~1.2. */
  uWind: { value: 0.3 },
  uSnow: { value: 0 },
  /** How frozen the water looks, 0..1 (snow settled on it, or winter). */
  uIce: { value: 0 },
  /** Season weights: spring, summer, autumn, winter (sum 1). */
  uSeasonW: { value: new THREE.Vector4(1, 0, 0, 0) },
  uWet: { value: 0 },
  uOvercast: { value: 0 },
  uFlash: { value: 0 },
  /** Up to 4 characters that push grass aside: xyz = position, w = radius (0 = unused). */
  uPushers: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
  /** Tree shake: xyz = tree base position, w = start time. */
  uImpulse: { value: new THREE.Vector4(0, 0, 0, -100) },
  uSkyAmbient: { value: linear(0.3, 0.34, 0.33) },
  uGroundAmbient: { value: linear(0.19, 0.2, 0.15) },
  uNightAmbient: { value: linear(0.03, 0.042, 0.1) },
  uTwilightAmbient: { value: linear(0.24, 0.1, 0.07) },
  uTwilightSun: { value: new THREE.Color('#ff9257') },
  uMoonColor: { value: linear(0.07, 0.09, 0.17) },
  uSnowColor: { value: new THREE.Color('#f3f6fa') },
  uIceColor: { value: new THREE.Color('#cfe8ee') },
  uGlowColor: { value: new THREE.Color('#ffc46b') },
  uWaterShallow: { value: new THREE.Color('#86dcd2') },
  uWaterDeep: { value: new THREE.Color('#2f86b8') },
  uWaterFoam: { value: new THREE.Color('#f2fbfb') },
  /** 0..1: how much wave motion, reflection and sun glitter the water gets (from the detail level). */
  uWaterQuality: { value: 0.33 },
  /** Sky colour the water reflects at grazing angles (environments keep it in sync with the sky). */
  uSkyTint: { value: new THREE.Color('#b9e2e6') },
  /** 1 = ink outlines on vegetation (trees, bushes, foliage), 0 = none (other objects keep theirs). */
  uVegetationInk: { value: 1 },
};

export type SwayKind = 'grass' | 'tree';

let flatWorld = false;

/**
 * 'planet': "up" is the direction from the world origin (a spherical planet centred at 0).
 * 'flat': "up" is +Y everywhere. Call once at startup, before any material compiles.
 */
export function setEnvWorld(kind: 'planet' | 'flat'): void {
  flatWorld = kind === 'flat';
}

const UP_MACRO = /* glsl */ `
#ifdef ENV_FLAT
  #define ENV_UP(p) vec3(0.0, 1.0, 0.0)
#else
  #define ENV_UP(p) normalize(p)
#endif
`;

export interface EnvOptions {
  /** Vertex wind sway: grass bends from its base, trees keep a stiff trunk and flutter their crown. */
  sway?: SwayKind;
  swayScale?: number;
  /** Bend away from nearby characters (grass, crops). */
  push?: boolean;
  /** Snow settles on up-facing surfaces. Default true. */
  snow?: boolean;
  /** Darken when it rains. Default true. */
  wet?: boolean;
  /** Turns icy when snow has settled (water). */
  ice?: boolean;
  /** Emissive at night (windows, lanterns). */
  glow?: boolean;
  /**
   * Stylised water: colour by depth (needs a per-vertex `aDepth` attribute = water depth),
   * foam along the shore and drifting light patches.
   */
  water?: boolean;
  /**
   * Reacts to the seasons: needs the per-vertex `aSeason` / `aCenter` attributes
   * (see `lowpoly.seasonKind`). Colours change, leaves are shed, crops grow and are cut.
   */
  season?: boolean;
  /**
   * Alpha-cut leaf cards (double-sided): lit with the geometry's own (crown-shaped) normals on
   * both sides, and cut out by the texture alpha in the shadow and outline passes too.
   */
  foliage?: boolean;
  /** Fish: the body (along +Z, head forward) undulates, more towards the tail. */
  swim?: boolean;
}


const glslColor = (hex: string) => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

/** Season colours (linear) baked into the shader source. */
const SEASON_GLSL = /* glsl */ `
#ifdef ENV_SEASON
attribute float aSeason;
attribute vec3 aCenter;
uniform vec4 uSeasonW;

const vec3 SE_YELLOW = ${glslColor('#e8c13c')};
const vec3 SE_ORANGE = ${glslColor('#e07b2e')};
const vec3 SE_RED = ${glslColor('#c63a2a')};
const vec3 SE_BROWN = ${glslColor('#a8703a')};
const vec3 SE_LEAF_SPRING = ${glslColor('#8fd35a')};
const vec3 SE_LEAF_SUMMER = ${glslColor('#3f9a3a')};
const vec3 SE_LEAF_DRY = ${glslColor('#9a7a52')};
const vec3 SE_GRASS_AUTUMN = ${glslColor('#c9a844')};
const vec3 SE_GRASS_WINTER = ${glslColor('#c9d2d6')};
const vec3 SE_GROVE_GRASS = ${glslColor('#6bb04a')};
const vec3 SE_PADDY_SPRING = ${glslColor('#9bbf62')};
const vec3 SE_PADDY_SUMMER = ${glslColor('#6cb04a')};
const vec3 SE_PADDY_WINTER = ${glslColor('#d4cfc0')};
const vec3 SE_CROP_SPRING = ${glslColor('#80d058')};
const vec3 SE_CROP_SUMMER = ${glslColor('#4fae3e')};
const vec3 SE_CROP_WINTER = ${glslColor('#cdb97c')};

float seHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

/** A number in 0..1 that is fixed for each tree / plant (from where its instance sits). */
float seRandom(float salt) {
  #ifdef USE_INSTANCING
    vec3 o = (modelMatrix * instanceMatrix)[3].xyz;
  #else
    vec3 o = modelMatrix[3].xyz;
  #endif
  return seHash(o * (1.0 + salt * 0.37) + salt * 3.1);
}

/** 1 while rnd is below level, easing to 0 just above it (so things go one by one, not all at once). */
float seKeep(float rnd, float level) { return 1.0 - smoothstep(level - 0.12, level, rnd * 0.8 + 0.1); }

vec3 seAutumn(float r, float lum, float redBias) {
  r = clamp(r + redBias, 0.0, 0.999);
  vec3 col = r < 0.27 ? SE_YELLOW : (r < 0.58 ? SE_ORANGE : (r < 0.93 ? SE_RED : SE_BROWN));
  return col * (0.62 + lum * 1.35);
}

vec3 seGround(vec3 c, float lum) {
  vec4 w = uSeasonW;
  vec3 sp = c * vec3(1.06, 1.1, 0.9);
  vec3 su = c * vec3(0.8, 0.98, 0.76);
  vec3 au = mix(c, SE_GRASS_AUTUMN * (0.5 + lum * 1.5), 0.82);
  vec3 wi = mix(c, SE_GRASS_WINTER * (0.7 + lum * 0.6), 0.9);
  return sp * w.x + su * w.y + au * w.z + wi * w.w;
}

/** The colour of a tagged vertex in the current season. */
vec3 seColor(float kind, vec3 c, float rnd) {
  vec4 w = uSeasonW;
  float lum = dot(c, vec3(0.30, 0.59, 0.11));
  int k = int(kind + 0.5);
  if (k == 1 || k == 7) return seGround(c, lum);
  if (k == 2) {
    vec3 sp = SE_LEAF_SPRING * (0.55 + lum * 1.5);
    vec3 su = SE_LEAF_SUMMER * (0.5 + lum * 1.5);
    vec3 au = seAutumn(rnd, lum, 0.0);
    vec3 wi = SE_LEAF_DRY * (0.6 + lum);
    return sp * w.x + su * w.y + au * w.z + wi * w.w;
  }
  if (k == 3) {
    vec3 su = SE_LEAF_SUMMER * (0.5 + lum * 0.9);
    vec3 au = seAutumn(rnd, lum * 0.8, 0.3);
    vec3 wi = SE_LEAF_DRY * (0.6 + lum);
    return c * w.x + su * w.y + au * w.z + wi * w.w;
  }
  if (k == 11) {
    vec3 sp = mix(SE_LEAF_SPRING, SE_RED, 0.28) * (0.55 + lum * 1.2);
    vec3 su = mix(SE_LEAF_SUMMER, SE_BROWN, 0.12) * (0.5 + lum * 1.2);
    vec3 au = mix(SE_RED, SE_ORANGE, 0.55 * rnd) * (0.75 + lum * 0.9);
    vec3 wi = SE_LEAF_DRY * (0.6 + lum);
    return sp * w.x + su * w.y + au * w.z + wi * w.w;
  }
  if (k == 4) return c * (vec3(1.05, 1.1, 1.0) * w.x + vec3(1.0) * w.y + vec3(0.96, 0.95, 0.9) * w.z + vec3(0.82, 0.9, 0.96) * w.w);
  if (k == 5) {
    float v = 0.8 + c.r * 0.5;
    return SE_PADDY_SPRING * v * w.x + SE_PADDY_SUMMER * v * w.y + c * w.z + SE_PADDY_WINTER * w.w;
  }
  if (k == 6) {
    float v = 0.85 + lum * 0.5;
    return SE_CROP_SPRING * v * w.x + SE_CROP_SUMMER * v * w.y + c * w.z + SE_CROP_WINTER * v * w.w;
  }
  if (k == 9) return seAutumn(rnd, 0.42, 0.0);
  if (k == 10) return c * w.x + seGround(SE_GROVE_GRASS, 0.32) * (1.0 - w.x);
  return c;
}

/** Shape changes: leaves are shed towards their centre, crops grow, grass dies back. */
vec3 seShape(float kind, vec3 p, float rnd) {
  vec4 w = uSeasonW;
  int k = int(kind + 0.5);
  if (k == 2 || k == 3 || k == 11) {
    float shed = w.z * 0.3 + w.w * 1.05;
    return aCenter + (p - aCenter) * seKeep(rnd, 1.0 - shed);
  }
  if (k == 7) return p * (1.0 - w.w * (0.7 + 0.2 * rnd) - w.z * 0.08);
  if (k == 6) return p * dot(w, vec4(0.55, 0.9, 1.0, 0.12));
  if (k == 8) return p * seKeep(rnd, dot(w, vec4(1.0, 1.0, 0.3, 0.0)));
  if (k == 9) return p * seKeep(rnd, w.z);
  return p;
}
#endif
`;

const VERTEX_HEADER = UP_MACRO + SEASON_GLSL + /* glsl */ `
uniform float uTime;
uniform vec3 uWindAxis;
uniform float uWind;
uniform vec4 uPushers[4];
uniform vec4 uImpulse;
varying vec3 vEnvWorld;
#ifdef ENV_WATER
  attribute float aDepth;
  varying float vDepth;
  uniform float uWaterQuality;
#endif
`;

const SWAY_VERTEX = /* glsl */ `
#include <begin_vertex>
#ifdef ENV_SEASON
  transformed = seShape(aSeason, transformed, seRandom(0.0));
#endif
#ifdef ENV_WATER
{
  // Gentle swell: a few crossing sine waves, damped near the shore, stronger with quality.
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  float sw = sin(dot(wp, vec3(0.31, 0.07, 0.22)) + uTime * 1.3) * 0.55
           + sin(dot(wp, vec3(-0.17, 0.11, 0.39)) * 1.4 + uTime * 1.8) * 0.3
           + sin(dot(wp, vec3(0.53, -0.21, -0.12)) * 2.1 + uTime * 2.6) * 0.15;
  transformed += ENV_UP(position) * sw * 0.09 * uWaterQuality * clamp(aDepth * 1.5, 0.0, 1.0);
}
#endif
#ifdef ENV_SWIM
{
  #ifdef USE_INSTANCING
    float swPhase = dot((modelMatrix * instanceMatrix)[3].xyz, vec3(1.7, 2.3, 1.1));
  #else
    float swPhase = 0.0;
  #endif
  float swTail = clamp((0.18 - position.z) / 0.5, 0.0, 1.0);
  transformed.x += sin(position.z * 11.0 - uTime * 16.0 + swPhase) * 0.075 * swTail * swTail;
}
#endif
#if defined(ENV_SWAY) || defined(ENV_PUSH)
  #ifdef USE_INSTANCING
    mat4 envInst = modelMatrix * instanceMatrix;
  #else
    mat4 envInst = modelMatrix;
  #endif
  vec3 envOrigin = envInst[3].xyz;
  vec3 envUpW = ENV_UP(envOrigin);
  // transpose(R*s) = s*R^-1: fine for directions we normalize afterwards.
  mat3 envToLocal = transpose(mat3(envInst));
  float envH = max(position.y, 0.0);
#endif
#ifdef ENV_SWAY
  vec3 envWindW = cross(uWindAxis, envUpW);
  float envPhase = dot(envOrigin, vec3(0.37, 0.29, 0.33));
  // Gust fronts travel along the wind direction.
  float envGust = 0.55 + 0.45 * sin(uTime * 1.3 - dot(envOrigin, envWindW) * 0.35 + envPhase * 0.1);
  float envW = uWind * envGust;
  vec3 envWindL = envToLocal * envWindW;
  float envLen = length(envWindL);
  envWindL = envLen > 1e-5 ? envWindL / envLen : vec3(0.0);
  vec3 envSideL = cross(vec3(0.0, 1.0, 0.0), envWindL);
  #if ENV_SWAY == 1
    float envBend = envH * envH * (0.15 + envW * 1.7) * ENV_SWAY_SCALE;
    float envFlutter = sin(uTime * 6.5 + envPhase * 3.0 + envH * 3.0) * (0.02 + envW * 0.08) * envH;
    transformed += envWindL * envBend * (0.65 + 0.35 * sin(uTime * 2.1 + envPhase)) + envSideL * envFlutter;
    transformed.y -= envBend * envBend * 0.4;
  #else
    float envK = envH / 3.0;
    float envBend = envK * envK * (0.03 + envW * 0.3) * ENV_SWAY_SCALE;
    transformed += envWindL * envBend * (0.7 + 0.3 * sin(uTime * 1.7 + envPhase));
    float envLeaf = step(1.05, envH) * (0.15 + envW) * ENV_SWAY_SCALE;
    transformed += vec3(
      sin(uTime * 8.0 + dot(position, vec3(12.9, 7.1, 9.7))),
      0.5 * sin(uTime * 9.3 + dot(position, vec3(5.3, 11.7, 3.1))),
      cos(uTime * 7.1 + dot(position, vec3(8.1, 4.3, 13.3)))
    ) * 0.03 * envLeaf;
    // Shaken by a character: a decaying wobble on the tree whose base matches uImpulse.
    float envAge = uTime - uImpulse.w;
    float envHit = step(distance(envOrigin, uImpulse.xyz), 0.75) * step(0.0, envAge) * exp(-envAge * 2.2);
    transformed.x += envHit * sin(envAge * 21.0) * 0.5 * envK * envK;
    transformed.z += envHit * cos(envAge * 16.0) * 0.35 * envK * envK;
  #endif
#endif
#ifdef ENV_PUSH
  for (int i = 0; i < 4; i++) {
    vec4 pu = uPushers[i];
    if (pu.w <= 0.0) continue;
    vec3 d = envOrigin - pu.xyz;
    float f = 1.0 - smoothstep(pu.w * 0.25, pu.w, length(d));
    if (f <= 0.0) continue;
    vec3 dl = envToLocal * (d - envUpW * dot(d, envUpW));
    float dll = length(dl);
    dl = dll > 1e-5 ? dl / dll : vec3(1.0, 0.0, 0.0);
    transformed += dl * f * envH * 0.9;
    transformed.y -= f * envH * 0.45;
  }
#endif
`;

const COLOR_VERTEX = /* glsl */ `
#include <color_vertex>
#if defined(ENV_SEASON) && defined(USE_COLOR)
  vColor.rgb = seColor(aSeason, vColor.rgb, seRandom(1.0));
#endif
`;

const WORLD_VERTEX = /* glsl */ `
#include <project_vertex>
{
  vec4 envWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    envWp = instanceMatrix * envWp;
  #endif
  vEnvWorld = (modelMatrix * envWp).xyz;
  #ifdef ENV_WATER
    vDepth = aDepth;
  #endif
}
`;

const FRAGMENT_HEADER = UP_MACRO + /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uSnow;
uniform float uIce;
uniform float uWet;
uniform float uOvercast;
uniform float uFlash;
uniform vec3 uSkyAmbient;
uniform vec3 uGroundAmbient;
uniform vec3 uNightAmbient;
uniform vec3 uTwilightAmbient;
uniform vec3 uTwilightSun;
uniform vec3 uMoonColor;
uniform vec3 uSnowColor;
uniform vec3 uIceColor;
uniform vec3 uGlowColor;
varying vec3 vEnvWorld;
float envHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
#ifdef ENV_WATER
  varying float vDepth;
  uniform float uTime;
  uniform vec3 uWaterShallow;
  uniform vec3 uWaterDeep;
  uniform vec3 uWaterFoam;
  uniform float uWaterQuality;
  uniform vec3 uSkyTint;
  float envNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(envHash(i), envHash(i + vec3(1, 0, 0)), f.x), mix(envHash(i + vec3(0, 1, 0)), envHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(envHash(i + vec3(0, 0, 1)), envHash(i + vec3(1, 0, 1)), f.x), mix(envHash(i + vec3(0, 1, 1)), envHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
#endif
`;

/**
 * Toon direct light measured against the *local* ground: `dot(N,L) - dot(up,L)`.
 * Flat ground is fully lit at any sun height, slopes and object sides facing away get darker
 * bands. Night/day is handled separately by a smooth falloff on the local sun height, so the
 * planet never shows hard concentric light rings.
 */
const TOON_LIGHTS = /* glsl */ `
varying vec3 vViewPosition;
struct ToonMaterial { vec3 diffuseColor; };
float envBand(float x) {
  return 0.42 + 0.28 * smoothstep(-0.66, -0.58, x) + 0.3 * smoothstep(-0.26, -0.18, x);
}
void RE_Direct_Toon(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal,
    const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material,
    inout ReflectedLight reflectedLight) {
  vec3 upView = normalize((viewMatrix * vec4(ENV_UP(vEnvWorld), 0.0)).xyz);
  float rel = dot(geometryNormal, directLight.direction) - dot(upView, directLight.direction);
  reflectedLight.directDiffuse += envBand(rel) * directLight.color * BRDF_Lambert(material.diffuseColor);
}
void RE_IndirectDiffuse_Toon(const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal,
    const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material,
    inout ReflectedLight reflectedLight) {}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;

const SURFACE_FRAGMENT = /* glsl */ `
#include <normal_fragment_maps>
#ifdef ENV_FOLIAGE
  // Both sides of a leaf card take the crown's normal (no flip), so the canopy shades as one volume.
  normal = normalize(vNormal);
#endif
vec3 envUp = ENV_UP(vEnvWorld);
float envSunH = dot(envUp, uSunDir);
float envDay = smoothstep(-0.12, 0.24, envSunH);
float envTw = exp(-pow((envSunH - 0.03) / 0.13, 2.0));
vec3 envWN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
float envFacing = dot(envWN, envUp);
#ifdef ENV_WATER
{
  float d = max(vDepth, 0.0);
  vec3 q = vEnvWorld * 0.16 + vec3(uTime * 0.05, uTime * 0.02, uTime * 0.03);
  float n = envNoise(q) * 0.65 + envNoise(q * 2.7 + 7.0) * 0.35;
  vec3 w = mix(uWaterShallow, uWaterDeep, smoothstep(0.0, 2.8, d + (n - 0.5) * 0.6));
  // Light patches drifting on the surface.
  w = mix(w, uWaterShallow * 1.2 + 0.06, smoothstep(0.6, 0.66, n) * 0.4);
  // Foam where the water gets shallow, with a ragged edge.
  float foam = 1.0 - smoothstep(0.04, 0.3 + n * 0.3, d);

  // Ripple normal from the gradient of two scrolling noise layers.
  float wq = uWaterQuality;
  vec3 rq = vEnvWorld * (0.7 + wq * 0.5) + vec3(uTime * 0.35, uTime * 0.1, -uTime * 0.27);
  float e = 0.15;
  float r0 = envNoise(rq) + envNoise(rq * 2.3 + 3.0) * 0.5;
  float rx = envNoise(rq + vec3(e, 0.0, 0.0)) + envNoise((rq + vec3(e, 0.0, 0.0)) * 2.3 + 3.0) * 0.5;
  float rz = envNoise(rq + vec3(0.0, 0.0, e)) + envNoise((rq + vec3(0.0, 0.0, e)) * 2.3 + 3.0) * 0.5;
  vec3 tilt = vec3(r0 - rx, 0.0, r0 - rz) * (0.9 + wq * 1.2);
  tilt -= envUp * dot(tilt, envUp);
  vec3 wn = normalize(envUp + tilt);
  vec3 wv = normalize(cameraPosition - vEnvWorld);

  // Sky reflection at grazing angles.
  float fres = pow(1.0 - max(dot(wv, wn), 0.0), 3.0);
  w = mix(w, uSkyTint, fres * (0.25 + 0.45 * wq) * (1.0 - foam));
  w = mix(w, uWaterFoam, foam * 0.92);
  diffuseColor.rgb = w;

  // Sun highlight and glitter, moon path at night.
  vec3 rs = reflect(-uSunDir, wn);
  float sunDot = max(dot(rs, wv), 0.0);
  float spec = pow(sunDot, mix(70.0, 320.0, wq)) * (0.5 + 1.6 * wq);
  float glit = step(0.985 - 0.035 * wq, envNoise(vEnvWorld * 4.0 + vec3(0.0, uTime * 2.0, 0.0))) * pow(sunDot, 12.0) * (0.4 + 1.6 * wq);
  float sunVis = smoothstep(-0.02, 0.15, dot(envUp, uSunDir)) * (1.0 - 0.85 * uOvercast) * (1.0 - foam);
  vec3 sunCol = mix(vec3(1.0, 0.96, 0.85), uTwilightSun, envTw);
  totalEmissiveRadiance += sunCol * (spec + glit) * sunVis;
  vec3 rm = reflect(-uMoonDir, wn);
  float moonSpec = pow(max(dot(rm, wv), 0.0), 90.0) * (1.0 - envDay) * smoothstep(0.0, 0.2, dot(envUp, uMoonDir)) * (1.0 - uOvercast);
  totalEmissiveRadiance += vec3(0.55, 0.62, 0.8) * moonSpec * (0.4 + 0.8 * wq);
}
#endif
#ifdef ENV_SNOW
{
  float n = envHash(floor(vEnvWorld * 1.7));
  float cover = clamp(uSnow * 1.7 - n * 0.7, 0.0, 1.0) * smoothstep(0.35, 0.75, envFacing);
  diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, cover);
}
#endif
#ifdef ENV_WET
  diffuseColor.rgb *= 1.0 - 0.28 * uWet * smoothstep(0.2, 0.7, envFacing);
#endif
#ifdef ENV_ICE
  diffuseColor.rgb = mix(diffuseColor.rgb, uIceColor, uIce);
#endif
#ifdef ENV_GLOW
  totalEmissiveRadiance += uGlowColor * (1.0 - smoothstep(-0.05, 0.18, envSunH)) * 1.4;
#endif
`;

const OUTGOING = 'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;';

const OUTGOING_ENV = /* glsl */ `
float envSunFade = smoothstep(-0.06, 0.2, envSunH) * (1.0 - 0.7 * uOvercast);
vec3 envSunTint = mix(vec3(1.0), uTwilightSun, envTw * 0.85);
vec3 envAmbDay = mix(uGroundAmbient, uSkyAmbient, 0.5 + 0.5 * envFacing);
vec3 envAmb = mix(uNightAmbient * (0.75 + 0.25 * envFacing), envAmbDay, smoothstep(-0.22, 0.12, envSunH));
envAmb += uTwilightAmbient * envTw;
envAmb *= 1.0 - 0.25 * uOvercast * envDay;
envAmb += vec3(0.05) * uOvercast * envDay;
vec3 envMoonView = normalize((viewMatrix * vec4(uMoonDir, 0.0)).xyz);
float envMoonLit = smoothstep(0.05, 0.25, dot(normal, envMoonView)) * smoothstep(-0.1, 0.3, dot(envUp, uMoonDir));
vec3 envMoon = uMoonColor * envMoonLit * (1.0 - envDay) * (1.0 - 0.6 * uOvercast);
vec3 outgoingLight = reflectedLight.directDiffuse * envSunTint * envSunFade
  + diffuseColor.rgb * (envAmb + envMoon + vec3(uFlash))
  + totalEmissiveRadiance;
`;

function defines(o: EnvOptions): Record<string, string | number> {
  const d: Record<string, string | number> = {};
  if (flatWorld) d.ENV_FLAT = '';
  if (o.sway) {
    d.ENV_SWAY = o.sway === 'grass' ? 1 : 2;
    d.ENV_SWAY_SCALE = (o.swayScale ?? 1).toFixed(3);
  }
  if (o.push) d.ENV_PUSH = '';
  if (o.snow !== false) d.ENV_SNOW = '';
  if (o.wet !== false) d.ENV_WET = '';
  if (o.ice) d.ENV_ICE = '';
  if (o.glow) d.ENV_GLOW = '';
  if (o.water) d.ENV_WATER = '';
  if (o.season) d.ENV_SEASON = '';
  if (o.foliage) d.ENV_FOLIAGE = '';
  if (o.swim) d.ENV_SWIM = '';
  return d;
}

function bindUniforms(shader: THREE.WebGLProgramParametersWithUniforms): void {
  for (const [k, u] of Object.entries(ENV)) shader.uniforms[k] = u;
}

function patchVertex(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader =
    VERTEX_HEADER +
    shader.vertexShader
      .replace('#include <color_vertex>', COLOR_VERTEX)
      .replace('#include <begin_vertex>', SWAY_VERTEX)
      .replace('#include <project_vertex>', WORLD_VERTEX);
}

/** Makes a toon material respond to the shared environment (sun/moon, weather, wind). */
export function patchEnv<T extends THREE.MeshToonMaterial>(mat: T, options: EnvOptions = {}): T {
  mat.defines = { ...mat.defines, ...defines(options) };
  mat.onBeforeCompile = (shader) => {
    bindUniforms(shader);
    patchVertex(shader);
    shader.fragmentShader = (FRAGMENT_HEADER + shader.fragmentShader)
      .replace('#include <lights_toon_pars_fragment>', TOON_LIGHTS)
      .replace('#include <normal_fragment_maps>', SURFACE_FRAGMENT)
      .replace(OUTGOING, OUTGOING_ENV);
  };
  const key = `env:${JSON.stringify(mat.defines)}`;
  mat.customProgramCacheKey = () => key;
  return mat;
}

export function envMaterial(params: THREE.MeshToonMaterialParameters = {}, options: EnvOptions = {}): THREE.MeshToonMaterial {
  return patchEnv(new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...params }), options);
}

/**
 * Shadow-map material that applies the same wind sway, so swaying shadows match their casters.
 * Pass `map` + `alphaTest` (and `side`) for alpha-cut foliage so leaves cast dappled shadows.
 */
export function envDepthMaterial(options: EnvOptions, params: THREE.MeshDepthMaterialParameters = {}): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, ...params });
  mat.defines = { ...defines({ ...options, snow: false, wet: false }) };
  mat.onBeforeCompile = (shader) => {
    bindUniforms(shader);
    patchVertex(shader);
  };
  const key = `env-depth:${JSON.stringify(mat.defines)}`;
  mat.customProgramCacheKey = () => key;
  return mat;
}

/**
 * Normal material for the ink-outline pass with the same wind sway, so outlines move with
 * swaying trees instead of staying behind. Assign to `mesh.userData.outlineMaterial`.
 */
export function envNormalMaterial(options: EnvOptions, alphaMap?: THREE.Texture): THREE.MeshNormalMaterial {
  const mat = new THREE.MeshNormalMaterial();
  mat.defines = { ...defines({ ...options, snow: false, wet: false }) };
  if (alphaMap) {
    // Cut the leaf cards out of the outline pass too, or every card would draw a square.
    mat.defines.USE_UV = '';
    mat.side = THREE.DoubleSide;
  }
  mat.onBeforeCompile = (shader) => {
    bindUniforms(shader);
    patchVertex(shader);
    // Vegetation writes an "ink allowed" mask into alpha, which the outline pass reads, so its
    // lines can be switched off without losing the outlines of buildings behind the trees.
    shader.fragmentShader = ('uniform float uVegetationInk;\n' + shader.fragmentShader).replace(
      'gl_FragColor.a = 1.0;',
      `#ifdef ENV_SEASON
        gl_FragColor.a = uVegetationInk;
      #else
        gl_FragColor.a = 1.0;
      #endif`,
    );
    if (alphaMap) {
      // Each leaf card is drawn at the depth of its cluster's centre in this pass: lines then
      // follow the crown's silhouette and its lumps (or a conifer's tiers), not every card.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <logdepthbuf_vertex>',
        `#if defined(ENV_FOLIAGE) && defined(ENV_SEASON)
        if (aSeason > 0.5) {
          #ifdef USE_INSTANCING
            vec4 envCc = modelViewMatrix * instanceMatrix * vec4(aCenter, 1.0);
          #else
            vec4 envCc = modelViewMatrix * vec4(aCenter, 1.0);
          #endif
          mvPosition.z = mix(mvPosition.z, envCc.z, 0.95);
          gl_Position = projectionMatrix * mvPosition;
        }
        #endif
        #include <logdepthbuf_vertex>`,
      );
      shader.uniforms.uCutout = { value: alphaMap };
      shader.fragmentShader = ('uniform sampler2D uCutout;\n' + shader.fragmentShader).replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // A blurred (low mip) cutout: clusters read as solid blobs here, so the ink follows the
        // outer shape of the foliage rather than circling every small gap between leaves.
        if (texture2D(uCutout, vUv, 2.0).a < 0.5) discard;
        #ifdef ENV_FOLIAGE
          normal = normalize(vNormal);
        #endif`,
      );
    }
  };
  const key = `env-normal:${JSON.stringify(mat.defines)}`;
  mat.customProgramCacheKey = () => key;
  return mat;
}
