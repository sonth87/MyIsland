import * as THREE from 'three';
import { envMaterial, lowpoly, randRange, type Rng } from '@g2/engine';
import { PALETTE } from '../palette';

interface Cloud {
  pos: THREE.Vector3;
  puffs: Array<{ offset: THREE.Vector3; scale: number }>;
}

const SPAN = 320;
const RAIN_GREY = new THREE.Color('#8e979c');

/** Puffy clouds drifting with the wind over the valley and wrapping around its edges. */
export class FlatClouds {
  readonly mesh: THREE.InstancedMesh;
  cover = 0.3;
  rain = 0;
  daylight = 1;
  private readonly clouds: Cloud[] = [];
  private readonly material: THREE.MeshToonMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(rng: Rng, count = 34) {
    let total = 0;
    for (let i = 0; i < count; i++) {
      const n = 4 + Math.floor(rng() * 5);
      const puffs = [];
      for (let k = 0; k < n; k++) {
        puffs.push({
          offset: new THREE.Vector3((k - (n - 1) / 2) * 4.2 + randRange(rng, -1, 1), randRange(rng, 0, 2.5), randRange(rng, -2.5, 2.5)),
          scale: randRange(rng, 3, 5.5) * (Math.abs(k - (n - 1) / 2) < 1 ? 1.35 : 1),
        });
      }
      this.clouds.push({ pos: new THREE.Vector3(randRange(rng, -SPAN, SPAN), randRange(rng, 62, 92), randRange(rng, -SPAN, SPAN)), puffs });
      total += n;
    }
    this.material = envMaterial({ color: PALETTE.cloud, emissive: PALETTE.cloud, emissiveIntensity: 0.15 }, { snow: false, wet: false });
    this.mesh = new THREE.InstancedMesh(lowpoly.facet(new THREE.IcosahedronGeometry(1, 1)), this.material, total);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  update(dt: number, wind: THREE.Vector3): void {
    const shown = Math.round(5 + this.cover * (this.clouds.length - 5));
    const grow = 1 + this.rain * 0.45;
    let count = 0;
    for (let ci = 0; ci < this.clouds.length; ci++) {
      const c = this.clouds[ci];
      c.pos.x += (wind.x * 6 + 0.6) * dt;
      c.pos.z += (wind.z * 6 + 0.3) * dt;
      if (c.pos.x > SPAN) c.pos.x -= 2 * SPAN;
      if (c.pos.x < -SPAN) c.pos.x += 2 * SPAN;
      if (c.pos.z > SPAN) c.pos.z -= 2 * SPAN;
      if (c.pos.z < -SPAN) c.pos.z += 2 * SPAN;
      if (ci >= shown) continue;
      for (const puff of c.puffs) {
        this.p.copy(puff.offset).multiplyScalar(grow).add(c.pos);
        this.p.y -= this.rain * 14;
        this.s.set(puff.scale, puff.scale * 0.72, puff.scale).multiplyScalar(grow);
        this.m.compose(this.p, this.q, this.s);
        this.mesh.setMatrixAt(count++, this.m);
      }
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.material.color.set(PALETTE.cloud).lerp(RAIN_GREY, this.rain * 0.85);
    this.material.emissive.copy(this.material.color);
    this.material.emissiveIntensity = 0.15 * this.daylight;
  }
}
