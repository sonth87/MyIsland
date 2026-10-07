import * as THREE from 'three';
import { envMaterial, lowpoly, randRange, type Rng, type System } from '@g2/engine';
import { color } from '../palette';
import { anyTangent } from '../planet/PlanetShape';

interface Cloud {
  axis: THREE.Vector3;
  base: THREE.Vector3;
  angle: number;
  speed: number;
  altitude: number;
  puffs: Array<{ offset: THREE.Vector3; scale: number }>;
  /** Index of the first puff instance. */
  first: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const RAIN_GREY = new THREE.Color('#8e979c');

/**
 * Puffy clouds orbiting the planet; all puffs share one InstancedMesh.
 * Cover decides how many are shown, wind how fast they travel, rain how grey they get.
 */
export class Clouds implements System {
  readonly mesh: THREE.InstancedMesh;
  cover = 0.3;
  wind = 0.3;
  rain = 0;
  /** 0 night … 1 day at the viewer: keeps clouds from glowing at night. */
  daylight = 1;
  private readonly clouds: Cloud[] = [];
  private readonly material: THREE.MeshToonMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qa = new THREE.Quaternion();
  private readonly center = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(radius: number, rng: Rng, count = 40) {
    let total = 0;
    for (let i = 0; i < count; i++) {
      const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      const puffs = [];
      const n = 3 + Math.floor(rng() * 4);
      for (let k = 0; k < n; k++) {
        puffs.push({
          offset: new THREE.Vector3((k - (n - 1) / 2) * 1.3 + randRange(rng, -0.3, 0.3), randRange(rng, 0, 0.6), randRange(rng, -0.6, 0.6)),
          scale: randRange(rng, 0.9, 1.6) * (k === Math.floor(n / 2) ? 1.3 : 1),
        });
      }
      this.clouds.push({
        axis,
        base: anyTangent(axis),
        angle: rng() * Math.PI * 2,
        speed: randRange(rng, 0.006, 0.02) * (rng() < 0.5 ? -1 : 1),
        altitude: radius + randRange(rng, 10, 17),
        puffs,
        first: total,
      });
      total += n;
    }
    this.material = envMaterial({ color: color('cloud'), emissive: color('cloud'), emissiveIntensity: 0.12 }, { snow: false, wet: false });
    this.mesh = new THREE.InstancedMesh(lowpoly.facet(new THREE.IcosahedronGeometry(1, 1)), this.material, total);
    this.mesh.name = 'clouds';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.update(0);
  }

  update(dt: number): void {
    const shown = Math.round(4 + this.cover * (this.clouds.length - 4));
    const speedK = 0.4 + this.wind * 3.5;
    let count = 0;
    for (let ci = 0; ci < this.clouds.length; ci++) {
      const c = this.clouds[ci];
      c.angle += c.speed * speedK * dt;
      if (ci >= shown) continue;
      this.center.copy(c.base).applyAxisAngle(c.axis, c.angle);
      this.q.setFromUnitVectors(UP, this.center).multiply(this.qa.setFromAxisAngle(UP, c.angle));
      // Rain clouds hang lower and get bigger.
      this.center.multiplyScalar(c.altitude - this.rain * 3);
      const grow = 1 + this.rain * 0.5;
      for (const puff of c.puffs) {
        this.p.copy(puff.offset).multiplyScalar(grow).applyQuaternion(this.q).add(this.center);
        this.s.set(puff.scale, puff.scale * 0.8, puff.scale).multiplyScalar(grow);
        this.m.compose(this.p, this.q, this.s);
        this.mesh.setMatrixAt(count++, this.m);
      }
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.material.color.copy(color('cloud')).lerp(RAIN_GREY, this.rain * 0.85);
    this.material.emissive.copy(this.material.color);
    this.material.emissiveIntensity = 0.15 * this.daylight;
  }
}
