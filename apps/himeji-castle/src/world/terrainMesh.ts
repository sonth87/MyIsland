import * as THREE from 'three';
import { createNoise, createRng, envMaterial, SEASON_KIND } from '@g2/engine';
import { color } from '../palette';
import { paddyCell } from './paddies';
import { CASTLE_TOP_RADIUS, gridValue, groveWeight, HALF, VILLAGE_RADIUS, WATER_Y, type ValleyData } from './ValleyGen';

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Season kind of the triangle that `terrainColor` last coloured (greens follow the seasons). */
let lastKind: number = SEASON_KIND.none;

/** Flat color for one terrain triangle at (x, y, z); sets `lastKind`. */
function terrainColor(v: ValleyData, x: number, y: number, z: number, slope: number, n: number, out: THREE.Color): THREE.Color {
  lastKind = SEASON_KIND.none;
  const rd = gridValue(v.riverDist, x, z);
  const td = gridValue(v.railDist, x, z);
  if (y < WATER_Y + 1.1 && rd < 16) return out.copy(color('sand'));
  if (td < 2.6) {
    // Track bed (only where the track sits on the ground).
    const k = v.rail.index.nearest(x, z, 4);
    if (k.index >= 0 && !v.rail.bridge[k.index]) return out.copy(color('ballast'));
  }
  const cell = paddyCell(v, x, z);
  if (cell) {
    if (cell.bund) return out.copy(color('dirt'));
    // Wet mud under the water, stubble and crops.
    return out.set('#6a5d3f');
  }
  const dv = Math.hypot(x - v.village.x, z - v.village.z);
  if (dv < VILLAGE_RADIUS - 2) return out.copy(n > 0.1 ? color('path') : color('dirt'));
  const dc = Math.hypot(x - v.castle.x, z - v.castle.z);
  if (dc < CASTLE_TOP_RADIUS - 1) return out.copy(color('path'));
  if (y > 36) return out.copy(slope > 0.6 ? color('rock') : color('snowcap'));
  if (slope > 0.95) return out.copy(slope > 1.4 ? color('rockDark') : color('rock'));
  lastKind = SEASON_KIND.ground;
  if (y > 24) return out.copy(n > 0 ? color('pine') : color('grassDark'));
  if (slope > 0.6) return out.copy(color('grassDark'));
  // Fallen petals carpet the ground under the cherry trees (in spring).
  if (groveWeight(v, x, z) * (0.6 + n) > 0.55) {
    lastKind = SEASON_KIND.grove;
    return out.copy(n > 0.2 ? color('petalGround') : color('meadow')).lerp(color('sakuraLight'), 0.25);
  }
  return out.copy(n > 0.35 ? color('meadow') : n < -0.3 ? color('grassDark') : color('grass'));
}

/** Faceted terrain (one color per triangle) and the water plane. */
export function buildTerrain(v: ValleyData, segments: number): { ground: THREE.Mesh; water: THREE.Mesh } {
  const noise = createNoise(createRng(`${v.seed}:colors`));
  const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, segments, segments).rotateX(-Math.PI / 2).toNonIndexed();
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, v.heightAt(pos.getX(i), pos.getZ(i)));
  const colors = new Float32Array(pos.count * 3);
  const kinds = new Float32Array(pos.count);
  const c = new THREE.Color();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    d.fromBufferAttribute(pos, i + 2);
    nrm.crossVectors(b.clone().sub(a), d.clone().sub(a)).normalize();
    const slope = Math.sqrt(Math.max(0, 1 - nrm.y * nrm.y)) / Math.max(0.05, Math.abs(nrm.y));
    const cx = (a.x + b.x + d.x) / 3;
    const cy = (a.y + b.y + d.y) / 3;
    const cz = (a.z + b.z + d.z) / 3;
    const nz = noise.noise(cx * 0.03, 0, cz * 0.03);
    terrainColor(v, cx, cy, cz, slope, nz, c).multiplyScalar(0.96 + hash2(cx, cz) * 0.08);
    for (let k = 0; k < 3; k++) {
      c.toArray(colors, (i + k) * 3);
      kinds[i + k] = lastKind;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSeason', new THREE.BufferAttribute(kinds, 1));
  geo.setAttribute('aCenter', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  // Double-sided so that from inside a tunnel the hill above is solid, not see-through.
  const ground = new THREE.Mesh(geo, envMaterial({ vertexColors: true, side: THREE.DoubleSide }, { season: true }));
  ground.name = 'ground';
  ground.receiveShadow = true;
  ground.castShadow = true;

  // Water plane with a per-vertex depth, so the shader can colour shallows, deeps and foam.
  const wGeo = new THREE.PlaneGeometry(HALF * 2.2, HALF * 2.2, 240, 240).rotateX(-Math.PI / 2);
  const wp = wGeo.getAttribute('position');
  const depth = new Float32Array(wp.count);
  for (let i = 0; i < wp.count; i++) depth[i] = WATER_Y - v.heightAt(wp.getX(i), wp.getZ(i));
  wGeo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  const water = new THREE.Mesh(wGeo, envMaterial({ color: color('water') }, { water: true, snow: false, wet: false, ice: true }));
  water.name = 'water';
  water.position.y = WATER_Y;
  water.receiveShadow = true;
  return { ground, water };
}
