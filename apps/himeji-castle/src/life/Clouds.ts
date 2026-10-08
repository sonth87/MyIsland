import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { envMaterial, envNormalMaterial, randRange, type Rng } from '@g2/engine';
import { PALETTE } from '../palette';

interface CloudInstance {
  pos: THREE.Vector3;
  baseScale: THREE.Vector3;
  q: THREE.Quaternion;
  templateIdx: number;
}

const SPAN = 320;
const RAIN_GREY = new THREE.Color('#8e979c');

function buildPuff(
  r: number,
  squashY: number,
  tx: number,
  ty: number,
  tz: number,
  rng: Rng,
  flattenBottom = true,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 0); // 20 faces = crisp low poly facets
  const sx = 1 + (rng() - 0.5) * 0.12;
  const sy = squashY * (1 + (rng() - 0.5) * 0.08);
  const sz = 1 + (rng() - 0.5) * 0.12;
  g.scale(sx, sy, sz);

  g.rotateY(rng() * Math.PI * 2);
  g.rotateX((rng() - 0.5) * 0.35);
  g.rotateZ((rng() - 0.5) * 0.35);

  g.translate(tx, ty, tz);

  if (flattenBottom) {
    const pos = g.getAttribute('position');
    const threshold = ty - r * sy * 0.28;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < threshold) {
        pos.setY(i, threshold + (y - threshold) * 0.15);
      }
    }
    pos.needsUpdate = true;
  }
  return g;
}

/**
 * Creates 5 distinct procedural low-poly cloud archetypes:
 * 0: Mega Thunderhead (Width ~100-130)
 * 1: Grand Cumulus (Width ~65-85)
 * 2: Wind Stratus (Width ~55-75, elongated)
 * 3: Medium Puffy (Width ~35-50)
 * 4: Small Cloudlet (Width ~20-30)
 */
function createCloudTemplates(rng: Rng): THREE.BufferGeometry[] {
  // --- Template 0: Mega Thunderhead ---
  const puffs0: THREE.BufferGeometry[] = [
    // Flat Base Layer
    buildPuff(18, 0.54, 0, 8, 0, rng, true),
    buildPuff(15, 0.54, -22, 7, 3, rng, true),
    buildPuff(16, 0.54, 23, 7.5, -2, rng, true),
    buildPuff(13, 0.54, -4, 6.5, 14, rng, true),
    buildPuff(14, 0.54, 3, 7, -15, rng, true),
    // Towers
    buildPuff(16, 0.65, -8, 22, -2, rng, false),
    buildPuff(14, 0.65, 12, 19, 4, rng, false),
    buildPuff(12, 0.6, -18, 17, -8, rng, false),
    buildPuff(11, 0.6, 4, 15, 10, rng, false),
    // Flanks
    buildPuff(11, 0.5, -38, 5.5, 2, rng, true),
    buildPuff(12, 0.5, 39, 6, -3, rng, true),
    buildPuff(8, 0.45, 52, 4.5, 0, rng, true),
    // Satellite Droplets
    buildPuff(3.2, 0.8, -48, 9, 5, rng, false),
    buildPuff(3.8, 0.8, 32, 22, 10, rng, false),
    buildPuff(2.5, 0.8, 59, 6, -4, rng, false),
  ];

  // --- Template 1: Grand Cumulus ---
  const puffs1: THREE.BufferGeometry[] = [
    buildPuff(13, 0.55, 0, 6.5, 0, rng, true),
    buildPuff(11, 0.55, -15, 5.5, 2, rng, true),
    buildPuff(11.5, 0.55, 16, 6, -2, rng, true),
    buildPuff(9, 0.55, 0, 5, 9, rng, true),
    buildPuff(12, 0.68, 2, 16, 1, rng, false),
    buildPuff(9.5, 0.65, -10, 13, -3, rng, false),
    buildPuff(9, 0.62, 12, 12.5, 3, rng, false),
    buildPuff(7.5, 0.5, -26, 4, 1, rng, true),
    buildPuff(8, 0.5, 27, 4.5, -1, rng, true),
    buildPuff(2.6, 0.8, -33, 6, 3, rng, false),
    buildPuff(2.2, 0.8, 22, 17, 5, rng, false),
  ];

  // --- Template 2: Wind Stratus (Elongated) ---
  const puffs2: THREE.BufferGeometry[] = [
    buildPuff(10, 0.48, -6, 4.5, 0, rng, true),
    buildPuff(9.5, 0.48, 8, 4.5, -1, rng, true),
    buildPuff(8.5, 0.48, -19, 4, 1, rng, true),
    buildPuff(8, 0.48, 21, 4, -2, rng, true),
    buildPuff(7.5, 0.55, -2, 9, 0, rng, false),
    buildPuff(6, 0.42, -30, 3, 0, rng, true),
    buildPuff(6, 0.42, 32, 3, -1, rng, true),
    buildPuff(2.0, 0.8, 40, 4, 0, rng, false),
  ];

  // --- Template 3: Medium Puffy Cumulus ---
  const puffs3: THREE.BufferGeometry[] = [
    buildPuff(9, 0.58, 0, 5, 0, rng, true),
    buildPuff(7.5, 0.58, -9, 4.5, 1, rng, true),
    buildPuff(8, 0.58, 10, 4.8, -1, rng, true),
    buildPuff(8, 0.68, 1, 11.5, 0, rng, false),
    buildPuff(6, 0.6, -6, 9, -2, rng, false),
    buildPuff(5, 0.52, -16, 3.5, 0, rng, true),
    buildPuff(5.5, 0.52, 17, 3.8, 1, rng, true),
    buildPuff(1.8, 0.8, 22, 6, 2, rng, false),
  ];

  // --- Template 4: Small Cloudlet ---
  const puffs4: THREE.BufferGeometry[] = [
    buildPuff(5.5, 0.55, 0, 3, 0, rng, true),
    buildPuff(4.2, 0.52, -5.5, 2.5, 0.5, rng, true),
    buildPuff(4.5, 0.52, 5.8, 2.7, -0.5, rng, true),
    buildPuff(4, 0.6, 0.5, 6, 0, rng, false),
    buildPuff(1.4, 0.8, 10, 4, 1, rng, false),
  ];

  const puffGroups = [puffs0, puffs1, puffs2, puffs3, puffs4];
  return puffGroups.map((puffs) => {
    const merged = mergeGeometries(puffs);
    const nonIndexed = merged.toNonIndexed();
    nonIndexed.computeVertexNormals();
    return nonIndexed;
  });
}

/** Puffy clouds drifting with the wind over the valley and wrapping around its edges. */
export class FlatClouds {
  readonly mesh: THREE.Group;
  cover = 0.3;
  rain = 0;
  daylight = 1;

  private readonly instances: CloudInstance[] = [];
  private readonly instancedMeshes: THREE.InstancedMesh[] = [];
  private readonly material: THREE.MeshToonMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  private readonly rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
    this.material = envMaterial(
      { color: PALETTE.cloud, emissive: PALETTE.cloud, emissiveIntensity: 0.15 },
      { snow: false, wet: false },
    );
    this.mesh = new THREE.Group();
    this.refreshModel();
  }

  refreshModel(): void {
    const rng = this.rng;

    // Clear previous children and geometries
    for (const im of this.instancedMeshes) {
      im.geometry.dispose();
      this.mesh.remove(im);
    }
    this.instancedMeshes.length = 0;
    this.instances.length = 0;

    const templates = createCloudTemplates(rng);

    // Counts per template: 5 Mega, 9 Grand, 8 Stratus, 12 Medium, 8 Small (total 42 clouds)
    const countsPerTemplate = [5, 9, 8, 12, 8];

    for (let t = 0; t < templates.length; t++) {
      const im = new THREE.InstancedMesh(templates[t], this.material, countsPerTemplate[t]);
      im.frustumCulled = false;
      im.castShadow = true;
      im.userData.outlineMaterial = envNormalMaterial({ noInk: true });
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.instancedMeshes.push(im);
      this.mesh.add(im);
    }

    // Populate cloud instances with alternating templates across the sky
    const templateOrder: number[] = [];
    for (let t = 0; t < countsPerTemplate.length; t++) {
      for (let i = 0; i < countsPerTemplate[t]; i++) {
        templateOrder.push(t);
      }
    }

    // Shuffle the order so cloud sizes alternate randomly across the sky
    for (let i = templateOrder.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = templateOrder[i];
      templateOrder[i] = templateOrder[j];
      templateOrder[j] = tmp;
    }

    for (let idx = 0; idx < templateOrder.length; idx++) {
      const t = templateOrder[idx];
      let scaleMult = 1.0;
      let y = 60;

      // Distribute heights across multiple distinct layers (52 to 82) so they are neither
      // too high nor trapped on a single plane, while safely clearing village buildings:
      // - Lower layer (52 - 62): low stratus and small drifting cloudlets skimming above mountain passes
      // - Mid layer (62 - 72): medium and large cumulus floating over the valley
      // - Upper layer (72 - 82): grand and mega thunderheads towering above
      if (t === 0) {
        // Mega Thunderheads: 72 - 82
        y = randRange(rng, 72, 82);
        scaleMult = randRange(rng, 0.95, 1.3);
      } else if (t === 1) {
        // Grand Cumulus: staggered across 65 - 76
        y = randRange(rng, 65, 76);
        scaleMult = randRange(rng, 0.9, 1.25);
      } else if (t === 2) {
        // Stratus Wind Clouds: low-to-mid aerodynamic flow across 52 - 65
        y = randRange(rng, 52, 65);
        scaleMult = randRange(rng, 0.85, 1.25);
      } else if (t === 3) {
        // Medium Puffy: wide spread across 55 - 70
        y = randRange(rng, 55, 70);
        scaleMult = randRange(rng, 0.85, 1.2);
      } else {
        // Small Cloudlets: floating freely between 52 - 74
        y = randRange(rng, 52, 74);
        scaleMult = randRange(rng, 0.8, 1.2);
      }

      // Flip along X and Z for silhouette variety
      const flipX = rng() > 0.5 ? -1 : 1;
      const flipZ = rng() > 0.5 ? -1 : 1;
      const baseScale = new THREE.Vector3(flipX * scaleMult, scaleMult, flipZ * scaleMult);

      // Slight yaw tilt
      const yaw = randRange(rng, -0.15, 0.15);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

      // Mix clouds across the valley center and the outer mountains
      const spreadX = idx % 2 === 0 ? randRange(rng, -190, 190) : randRange(rng, -SPAN, SPAN);
      const spreadZ = idx % 2 === 0 ? randRange(rng, -190, 190) : randRange(rng, -SPAN, SPAN);
      const pos = new THREE.Vector3(spreadX, y, spreadZ);

      this.instances.push({
        pos,
        baseScale,
        q,
        templateIdx: t,
      });
    }
  }

  update(dt: number, wind: THREE.Vector3): void {
    const shown = Math.round(5 + this.cover * (this.instances.length - 5));
    const grow = 1 + this.rain * 0.45;

    // Track active instances count for each template
    const templateCounts = [0, 0, 0, 0, 0];

    for (let ci = 0; ci < this.instances.length; ci++) {
      const c = this.instances[ci];
      c.pos.x += (wind.x * 6 + 0.6) * dt;
      c.pos.z += (wind.z * 6 + 0.3) * dt;

      if (c.pos.x > SPAN) c.pos.x -= 2 * SPAN;
      if (c.pos.x < -SPAN) c.pos.x += 2 * SPAN;
      if (c.pos.z > SPAN) c.pos.z -= 2 * SPAN;
      if (c.pos.z < -SPAN) c.pos.z += 2 * SPAN;

      if (ci >= shown) continue;

      this.p.copy(c.pos);
      this.p.y -= this.rain * 14;
      this.s.copy(c.baseScale).multiplyScalar(grow);

      this.m.compose(this.p, c.q, this.s);
      const im = this.instancedMeshes[c.templateIdx];
      const localIdx = templateCounts[c.templateIdx]++;
      im.setMatrixAt(localIdx, this.m);
    }

    for (let t = 0; t < this.instancedMeshes.length; t++) {
      const im = this.instancedMeshes[t];
      im.count = templateCounts[t];
      im.instanceMatrix.needsUpdate = true;
    }

    this.material.color.set(PALETTE.cloud).lerp(RAIN_GREY, this.rain * 0.85);
    this.material.emissive.copy(this.material.color);
    this.material.emissiveIntensity = 0.15 * this.daylight;
  }
}

