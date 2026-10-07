import * as THREE from 'three';
import { MathUtils } from 'three';

const c = (hex: string) => new THREE.Color(hex);

const COLORS = {
  dayZenith: c('#5cb8c8'),
  dayHorizon: c('#c4e8dc'),
  twZenith: c('#5a6aa0'),
  twHorizon: c('#f4ae7c'),
  twGlow: c('#ff8650'),
  nightZenith: c('#0a1230'),
  nightHorizon: c('#1d2b52'),
  overcastDay: c('#a6b5b4'),
  overcastNight: c('#161d2b'),
  spaceDay: c('#78c4b8'),
  spaceTwilight: c('#4a5a86'),
  spaceNight: c('#0f1933'),
};

export interface SkyState {
  /** 0 = deep night, 1 = full day, at the focus point. */
  day: number;
  /** Twilight intensity (dawn / dusk), 0..1. */
  twilight: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  space: THREE.Color;
}

/** Sky colors for a local sun height (dot(up, sunDir)) and cloud cover. Shared by the sky dome and fog. */
export function skyState(sunHeight: number, overcast: number, out: SkyState): SkyState {
  const day = MathUtils.smoothstep(sunHeight, -0.14, 0.22);
  const tw = Math.exp(-(((sunHeight - 0.02) / 0.14) ** 2));
  out.day = day;
  out.twilight = tw;
  out.zenith.lerpColors(COLORS.nightZenith, COLORS.dayZenith, day).lerp(COLORS.twZenith, tw * 0.55);
  out.horizon.lerpColors(COLORS.nightHorizon, COLORS.dayHorizon, day).lerp(COLORS.twHorizon, tw * 0.7);
  const grey = _grey.lerpColors(COLORS.overcastNight, COLORS.overcastDay, Math.max(day, tw * 0.5));
  out.zenith.lerp(grey, overcast * 0.75);
  out.horizon.lerp(grey, overcast * 0.6);
  out.space.lerpColors(COLORS.spaceNight, COLORS.spaceDay, day).lerp(COLORS.spaceTwilight, tw * 0.45);
  out.space.lerp(grey, overcast * 0.35);
  return out;
}
const _grey = new THREE.Color();

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // at the far plane
}`;

const skyFragment = /* glsl */ `
uniform vec3 uRefUp;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSpace;
uniform vec3 uGlow;
uniform float uDay;
uniform float uTwilight;
uniform float uOvercast;
uniform float uAltitude;
uniform float uFlash;
uniform float uTime;
varying vec3 vDir;

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

float stars(vec3 d) {
  vec3 p = d * 140.0;
  vec3 cell = floor(p);
  float h = hash(cell);
  if (h < 0.965) return 0.0;
  float r = length(fract(p) - 0.5);
  float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
  return smoothstep(0.16, 0.0, r) * tw * (h - 0.965) / 0.035;
}

void main() {
  vec3 d = normalize(vDir);
  float e = dot(d, uRefUp);
  vec3 col = mix(uHorizon, uZenith, smoothstep(-0.02, 0.55, e));
  col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.4, e));

  // Warm glow on the sun's side of the horizon at dawn / dusk.
  float sh = dot(uRefUp, uSunDir);
  vec3 sunFlat = uSunDir - uRefUp * sh;
  vec3 dFlat = d - uRefUp * e;
  float toward = (length(sunFlat) > 1e-4 && length(dFlat) > 1e-4) ? max(dot(normalize(sunFlat), normalize(dFlat)), 0.0) : 0.0;
  col = mix(col, uGlow, uTwilight * pow(toward, 3.0) * (1.0 - smoothstep(0.0, 0.45, abs(e))) * (1.0 - uOvercast * 0.7));

  float sd = dot(d, uSunDir);
  float clear = 1.0 - uOvercast * 0.85;
  col += vec3(1.0, 0.93, 0.78) * smoothstep(0.9988, 0.9993, sd) * clear * 1.4;
  col += vec3(1.0, 0.82, 0.6) * pow(max(sd, 0.0), 80.0) * 0.45 * clear;

  float md = dot(d, uMoonDir);
  float night = 1.0 - uDay;
  col += vec3(0.93, 0.95, 1.0) * smoothstep(0.9993, 0.9996, md) * (0.35 + 0.65 * night) * clear;
  col += vec3(0.6, 0.7, 0.95) * pow(max(md, 0.0), 120.0) * 0.25 * night * clear;

  float starAmount = night * (1.0 - uOvercast) * smoothstep(-0.05, 0.15, e);
  col += vec3(stars(d)) * starAmount;

  // Seen from orbit: flat "space" backdrop (teal by day, navy at night) with stars.
  vec3 space = uSpace + vec3(stars(d)) * night * (1.0 - uOvercast * 0.5) * 0.9;
  col = mix(col, space, uAltitude);
  col += vec3(0.8, 0.85, 1.0) * uFlash * 0.5;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const atmoVertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const atmoFragment = /* glsl */ `
uniform vec3 uSunDir;
uniform float uOpacity;
uniform float uOvercast;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec3 v = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - abs(dot(v, vNormalW)), 2.5);
  float sh = dot(normalize(vWorld), uSunDir);
  float day = smoothstep(-0.2, 0.25, sh);
  float tw = exp(-pow((sh - 0.0) / 0.18, 2.0));
  vec3 col = mix(vec3(0.12, 0.18, 0.4), vec3(0.75, 0.95, 0.92), day);
  col = mix(col, vec3(1.0, 0.6, 0.38), tw * 0.8);
  col = mix(col, vec3(0.7), uOvercast * 0.4);
  gl_FragColor = vec4(col, rim * uOpacity * (0.35 + 0.65 * max(day, tw)));
  #include <colorspace_fragment>
}`;

export function haloTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Sky dome (gradient, sun & moon discs, stars), a thin atmosphere rim around the planet,
 * and small sun / moon bodies orbiting the planet that are only shown from orbit.
 */
export class Sky {
  readonly group = new THREE.Group();
  /** Objects that must not get ink outlines. */
  readonly noOutline: THREE.Object3D[] = [];
  readonly state: SkyState = {
    day: 1,
    twilight: 0,
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    space: new THREE.Color(),
  };
  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly atmo: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  private readonly sunBody: THREE.Group | null = null;
  private readonly moonBody: THREE.Group | null = null;
  private readonly bodyMaterials: THREE.Material[] = [];
  private readonly orbit: number;

  /** With `planetRadius`, also adds the atmosphere rim and orbiting sun / moon seen from space. */
  constructor(planetRadius?: number) {
    this.orbit = (planetRadius ?? 0) * 2.3;
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: {
          uRefUp: { value: new THREE.Vector3(0, 1, 0) },
          uSunDir: { value: new THREE.Vector3(1, 0, 0) },
          uMoonDir: { value: new THREE.Vector3(-1, 0, 0) },
          uZenith: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uSpace: { value: new THREE.Color() },
          uGlow: { value: COLORS.twGlow.clone() },
          uDay: { value: 1 },
          uTwilight: { value: 0 },
          uOvercast: { value: 0 },
          uAltitude: { value: 1 },
          uFlash: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.dome.name = 'sky';
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.group.add(this.dome);
    this.noOutline.push(this.dome);
    if (planetRadius === undefined) return;

    this.atmo = new THREE.Mesh(
      new THREE.SphereGeometry(planetRadius * 1.1, 64, 32),
      new THREE.ShaderMaterial({
        uniforms: { uSunDir: { value: new THREE.Vector3() }, uOpacity: { value: 1 }, uOvercast: { value: 0 } },
        vertexShader: atmoVertex,
        fragmentShader: atmoFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.atmo.name = 'atmosphere';

    const halo = haloTexture();
    const body = (radius: number, color: string, haloColor: string, haloSize: number) => {
      const g = new THREE.Group();
      const ballMat = new THREE.MeshBasicMaterial({ color, transparent: true, fog: false });
      const haloMat = new THREE.SpriteMaterial({
        map: halo,
        color: haloColor,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const sprite = new THREE.Sprite(haloMat);
      sprite.scale.setScalar(haloSize);
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 2), ballMat), sprite);
      this.bodyMaterials.push(ballMat, haloMat);
      return g;
    };
    this.sunBody = body(planetRadius * 0.11, '#ffe9a8', '#ffcf70', planetRadius * 0.9);
    this.moonBody = body(planetRadius * 0.07, '#e8ecf5', '#9fb4e8', planetRadius * 0.45);

    this.group.add(this.atmo, this.sunBody, this.moonBody);
    this.noOutline.push(this.atmo, this.sunBody, this.moonBody);
  }

  update(params: {
    camera: THREE.PerspectiveCamera;
    refUp: THREE.Vector3;
    sunDir: THREE.Vector3;
    moonDir: THREE.Vector3;
    overcast: number;
    altitude: number;
    flash: number;
    time: number;
  }): SkyState {
    const { camera, refUp, sunDir, moonDir, overcast, altitude } = params;
    const st = skyState(refUp.dot(sunDir), overcast, this.state);

    const u = this.dome.material.uniforms;
    u.uRefUp.value.copy(refUp);
    u.uSunDir.value.copy(sunDir);
    u.uMoonDir.value.copy(moonDir);
    u.uZenith.value.copy(st.zenith);
    u.uHorizon.value.copy(st.horizon);
    u.uSpace.value.copy(st.space);
    u.uDay.value = st.day;
    u.uTwilight.value = st.twilight;
    u.uOvercast.value = overcast;
    u.uAltitude.value = altitude;
    u.uFlash.value = params.flash;
    u.uTime.value = params.time;
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(camera.far * 0.9);

    if (!this.atmo || !this.sunBody || !this.moonBody) return st;
    const a = this.atmo.material.uniforms;
    a.uSunDir.value.copy(sunDir);
    a.uOpacity.value = altitude;
    a.uOvercast.value = overcast;
    this.atmo.visible = altitude > 0.01;

    this.sunBody.position.copy(sunDir).multiplyScalar(this.orbit);
    this.moonBody.position.copy(moonDir).multiplyScalar(this.orbit * 0.85);
    const bodies = MathUtils.smoothstep(altitude, 0.4, 0.9);
    for (const m of this.bodyMaterials) m.opacity = bodies;
    this.sunBody.visible = this.moonBody.visible = bodies > 0.01;
    return st;
  }
}
