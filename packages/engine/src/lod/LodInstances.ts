import * as THREE from 'three';

export interface LodItem {
  /** World position used for distance tests. */
  position: THREE.Vector3;
  matrix: THREE.Matrix4;
  color?: THREE.Color;
}

export interface LodLevel {
  geometry: THREE.BufferGeometry;
  /** Items farther than this (world units, before the global scale) use the next level. */
  maxDistance: number;
}

export interface LodOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  customDepthMaterial?: THREE.Material;
  outlineMaterial?: THREE.Material;
}


/**
 * Distance-based level of detail and draw distance for many copies of one object.
 * Every few metres of camera movement, each item is written into the instanced mesh of the
 * level that matches its distance (detailed near, simple far) or dropped beyond the view
 * distance. Draw calls stay at one per level, whatever the number of items.
 */
export class LodInstances {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[];
  private readonly last = new THREE.Vector3(Infinity, 0, 0);
  private lastView = -1;
  private lastScale = -1;

  constructor(
    private readonly levels: LodLevel[],
    material: THREE.Material,
    private readonly items: LodItem[],
    options: LodOptions = {},
  ) {
    this.meshes = levels.map((lv) => {
      const mesh = new THREE.InstancedMesh(lv.geometry, material, Math.max(1, items.length));
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = options.castShadow ?? false;
      mesh.receiveShadow = options.receiveShadow ?? true;
      if (options.customDepthMaterial) mesh.customDepthMaterial = options.customDepthMaterial;
      if (options.outlineMaterial) mesh.userData.outlineMaterial = options.outlineMaterial;
      if (items.some((it) => it.color)) mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(mesh);
      return mesh;
    });
  }

  get size(): number {
    return this.items.length;
  }

  /**
   * Re-sorts the items when the camera moved more than `step` or the settings changed.
   * `lodScale` stretches the level distances (e.g. bigger when seen from far away).
   */
  update(camera: THREE.Vector3, viewDistance: number, lodScale = 1, step = 4): void {
    if (
      this.last.distanceToSquared(camera) < step * step &&
      viewDistance === this.lastView &&
      lodScale === this.lastScale
    ) {
      return;
    }
    this.last.copy(camera);
    this.lastView = viewDistance;
    this.lastScale = lodScale;
    const counts = this.meshes.map(() => 0);
    const view2 = viewDistance * viewDistance;
    const limits = this.levels.map((lv) => (lv.maxDistance * lodScale) ** 2);
    for (const it of this.items) {
      const d2 = it.position.distanceToSquared(camera);
      if (d2 > view2) continue;
      let level = 0;
      while (level < limits.length - 1 && d2 > limits[level]) level++;
      if (d2 > limits[level]) continue;
      const mesh = this.meshes[level];
      const i = counts[level]++;
      mesh.setMatrixAt(i, it.matrix);
      if (it.color) mesh.setColorAt(i, it.color);
    }
    this.meshes.forEach((mesh, k) => {
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }

  }
}
