import * as THREE from 'three';
import { envMaterial } from '@g2/engine';
import { color } from '../palette';
import type { PlanetShape } from './PlanetShape';
import { buildPlanetGeometry } from './terrainGeometry';

export { buildPlanetGeometry, terrainColor } from './terrainGeometry';

export interface PlanetMeshes {
  ground: THREE.Mesh;
  water: THREE.Mesh;
}

export function createPlanetMeshes(shape: PlanetShape, resolution = 72, smooth = false): PlanetMeshes {
  const ground = new THREE.Mesh(buildPlanetGeometry(shape, resolution, smooth), envMaterial({ vertexColors: true }));
  ground.name = 'ground';
  ground.receiveShadow = true;
  ground.castShadow = true;

  // Water sphere with per-vertex depth: shallow turquoise, deep blue, foam at the shore.
  const wGeo = new THREE.IcosahedronGeometry(shape.waterLevel, 48);
  const wp = wGeo.getAttribute('position');
  const depth = new Float32Array(wp.count);
  const d = new THREE.Vector3();
  for (let i = 0; i < wp.count; i++) depth[i] = shape.waterLevel - shape.heightAt(d.fromBufferAttribute(wp, i).normalize());
  wGeo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  const water = new THREE.Mesh(wGeo, envMaterial({ color: color('water') }, { water: true, snow: false, wet: false, ice: true }));
  water.name = 'water';
  water.receiveShadow = true;
  return { ground, water };
}
