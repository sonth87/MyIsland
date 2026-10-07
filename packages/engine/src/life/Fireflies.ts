import * as THREE from 'three';
import type { Surface } from '../env/Surface';
import type { Rng } from '../world/rng';

const vertex = /* glsl */ `
attribute float aPhase;
uniform float uTime;
uniform float uScale;
uniform float uStrength;
varying float vGlow;
void main() {
  // Each one blinks on its own rhythm: slow swell, short dark gap.
  float s = sin(uTime * (1.1 + fract(aPhase * 7.0) * 0.9) + aPhase * 40.0);
  vGlow = smoothstep(-0.2, 0.7, s) * uStrength;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uScale * (0.7 + 0.5 * vGlow) / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const fragment = /* glsl */ `
varying float vGlow;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(1.0 - d, 0.0), 2.4) * vGlow;
  if (a < 0.01) discard;
  vec3 col = mix(vec3(0.62, 1.0, 0.28), vec3(1.0, 0.95, 0.55), pow(max(1.0 - d, 0.0), 3.0));
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}`;

const _p = new THREE.Vector3();
const _g = new THREE.Vector3();
const _up = new THREE.Vector3();
const _ui = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();

/**
 * Fireflies drifting low over the ground near the viewer on warm nights. They wander
 * slowly, blink independently and are re-seeded on the far side when the viewer walks away.
 */
export class Fireflies {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly pos: Float32Array;
  private readonly ground: Float32Array;
  private readonly height: Float32Array;
  private readonly phase: Float32Array;
  private time = 0;
  private cursor = 0;
  private active: number;

  constructor(
    private readonly surface: Surface,
    private readonly rng: Rng,
    private readonly count = 120,
    private readonly radius = 26,
  ) {
    this.active = count;
    this.pos = new Float32Array(count * 3);
    this.ground = new Float32Array(count);
    this.height = new Float32Array(count);
    this.phase = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(this.phase, 1));
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uScale: { value: 500 }, uStrength: { value: 0 } },
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.name = 'fireflies';
    this.points.frustumCulled = false;
    for (let i = 0; i < count; i++) this.phase[i] = rng();
    this.points.visible = false;
  }

  /** Fraction (0..1) of the swarm that is out. */
  setAmount(a: number): void {
    this.active = Math.round(this.count * a);
    this.points.geometry.setDrawRange(0, this.active);
  }

  /**
   * `strength` 0..1 (night × warm season) fades them in; `pixelScale` is the point size in
   * pixels at one metre (renderer pixel ratio × viewport height / camera tan-fov).
   */
  update(dt: number, focus: THREE.Vector3, strength: number, pixelScale: number): void {
    this.points.visible = strength > 0.02;
    if (!this.points.visible) return;
    this.time += dt;
    const u = this.points.material.uniforms;
    u.uTime.value = this.time;
    u.uStrength.value = strength;
    u.uScale.value = pixelScale * 0.09;

    // Refresh a slice of the ground heights each frame (terrain lookups can be costly).
    const slice = Math.max(1, Math.ceil(this.active / 10));
    for (let k = 0; k < slice; k++) {
      const i = this.cursor++ % this.active;
      this.place(i, focus, false);
    }
    const r2 = this.radius * this.radius;
    for (let i = 0; i < this.active; i++) {
      const j = i * 3;
      _p.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      const ph = this.phase[i] * 40;
      // Slow figure-of-eight drift.
      _p.x += Math.sin(this.time * 0.5 + ph) * 0.5 * dt;
      _p.z += Math.cos(this.time * 0.43 + ph * 1.3) * 0.5 * dt;
      this.height[i] += Math.sin(this.time * 0.7 + ph * 0.7) * 0.25 * dt;
      this.height[i] = THREE.MathUtils.clamp(this.height[i], 0.5, 3.2);
      if (_p.distanceToSquared(focus) > r2) {
        this.place(i, focus, true);
        continue;
      }
      // Hover `height` above the ground along the local up (a sphere has a different up everywhere).
      this.surface.up(_p, _ui);
      _p.addScaledVector(_ui, this.ground[i] + this.height[i] - _p.dot(_ui));
      this.pos[j] = _p.x;
      this.pos[j + 1] = _p.y;
      this.pos[j + 2] = _p.z;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  /** Puts firefly `i` somewhere around `focus` (re-seeding it) or refreshes its ground height. */
  private place(i: number, focus: THREE.Vector3, reseed: boolean): void {
    const j = i * 3;
    if (reseed || this.pos[j] === 0) {
      const a = this.rng() * Math.PI * 2;
      const r = Math.sqrt(this.rng()) * this.radius * 0.95;
      this.surface.up(focus, _up);
      _t1.set(1, 0, 0);
      if (Math.abs(_up.x) > 0.9) _t1.set(0, 0, 1);
      _t1.cross(_up).normalize();
      _t2.crossVectors(_up, _t1);
      _p.copy(focus).addScaledVector(_t1, Math.cos(a) * r).addScaledVector(_t2, Math.sin(a) * r);
      this.height[i] = 0.6 + this.rng() * 2.2;
    } else {
      _p.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
    }
    this.surface.ground(_p, _g);
    this.surface.up(_g, _ui);
    this.ground[i] = _g.dot(_ui);
    if (reseed || this.pos[j] === 0) {
      _p.copy(_g).addScaledVector(_ui, this.height[i]);
      this.pos[j] = _p.x;
      this.pos[j + 1] = _p.y;
      this.pos[j + 2] = _p.z;
    }
  }
}
