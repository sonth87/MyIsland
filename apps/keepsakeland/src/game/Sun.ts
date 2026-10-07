import * as THREE from 'three';

/**
 * The sun's directional light. Its direction comes from the world clock; its shadow camera
 * only covers the area around `center` (the player while walking, the whole planet from orbit).
 */
export class Sun {
  readonly light: THREE.DirectionalLight;
  private extent = 0;

  constructor(color: THREE.ColorRepresentation, intensity: number) {
    this.light = new THREE.DirectionalLight(color, intensity);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.04;
  }

  setShadowMapSize(size: number): void {
    if (this.light.shadow.mapSize.x === size) return;
    this.light.shadow.mapSize.set(size, size);
    this.light.shadow.map?.dispose();
    this.light.shadow.map = null;
  }

  update(direction: THREE.Vector3, center: THREE.Vector3, extent: number): void {
    const dist = extent * 2.5;
    this.light.position.copy(center).addScaledVector(direction, dist);
    this.light.target.position.copy(center);
    this.light.target.updateMatrixWorld();

    if (Math.abs(extent - this.extent) > 1e-3) {
      this.extent = extent;
      const cam = this.light.shadow.camera;
      cam.left = cam.bottom = -extent;
      cam.right = cam.top = extent;
      cam.near = 0.5;
      cam.far = dist * 2;
      cam.updateProjectionMatrix();
    }
  }
}
