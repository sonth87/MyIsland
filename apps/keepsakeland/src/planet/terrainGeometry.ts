import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { color } from '../palette';
import type { PlanetShape } from './PlanetShape';

/** Cube faces: [normal, u axis, v axis]. */
const FACES: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [
  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
  [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
];

/** Maps a point on the unit cube to the unit sphere with fairly even cell sizes. */
function spherify(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const x2 = p.x * p.x;
  const y2 = p.y * p.y;
  const z2 = p.z * p.z;
  return out.set(
    p.x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3),
    p.y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3),
    p.z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3),
  );
}

function hash3(v: THREE.Vector3): number {
  const s = Math.sin(v.x * 127.1 + v.y * 311.7 + v.z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

const _sand = new THREE.Color();

/** Flat color for one terrain triangle. */
export function terrainColor(shape: PlanetShape, dir: THREE.Vector3, normal: THREE.Vector3, out: THREE.Color): THREE.Color {
  const s = shape.sample(dir);
  const h = s.height - shape.radius;
  const water = shape.waterLevel - shape.radius;
  const flatness = normal.dot(dir);
  const n = shape.detail(dir);

  const field = shape.riceField(dir);
  if (h < water + 0.15) {
    out.copy(color('sand'));
  } else if (h < water + 0.3) {
    out.copy(_sand.copy(color('sand')).lerp(color('meadow'), 0.5));
  } else if (field) {
    out.copy(field.path ? color('grass') : field.cell % 3 === 0 ? color('riceDark') : color('rice'));
  } else if (s.weights.mountain > 0.2 && (h > 6.5 || flatness < 0.72)) {
    out.copy(flatness < 0.62 ? color('rockDark') : color('rock'));
  } else if (s.weights.village > 0.65) {
    out.copy(n > 0.25 ? color('dirt') : color('meadow'));
  } else if (flatness < 0.86) {
    out.copy(color('grassDark'));
  } else {
    out.copy(n > 0.35 ? color('meadow') : n < -0.35 ? color('grassDark') : color('grass'));
  }
  return out.multiplyScalar(0.97 + hash3(dir) * 0.06);
}

/** Cube-sphere terrain: one flat color per triangle (faceted), or interpolated colors and normals when `smooth`. */
export function buildPlanetGeometry(shape: PlanetShape, resolution = 72, smooth = false): THREE.BufferGeometry {
  if (smooth) return buildSmoothGeometry(shape, resolution);
  const N = resolution;
  const positions: number[] = [];
  const colors: number[] = [];
  const grid: THREE.Vector3[] = [];
  const cube = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const c = new THREE.Color();

  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3) => {
    normal.crossVectors(e1.subVectors(b, a), e2.subVectors(d, a)).normalize();
    centroid.copy(a).add(b).add(d).divideScalar(3);
    if (normal.dot(centroid) < 0) {
      [b, d] = [d, b];
      normal.negate();
    }
    const cdir = centroid.normalize();
    terrainColor(shape, cdir, normal, c);
    for (const p of [a, b, d]) {
      positions.push(p.x, p.y, p.z);
      colors.push(c.r, c.g, c.b);
    }
  };

  for (const [faceN, u, v] of FACES) {
    grid.length = 0;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        cube
          .copy(faceN)
          .addScaledVector(u, (2 * i) / N - 1)
          .addScaledVector(v, (2 * j) / N - 1);
        spherify(cube, dir).normalize();
        grid.push(dir.clone().multiplyScalar(shape.heightAt(dir)));
      }
    }
    const idx = (i: number, j: number) => grid[j * (N + 1) + i];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = idx(i, j);
        const b = idx(i + 1, j);
        const cc = idx(i + 1, j + 1);
        const d = idx(i, j + 1);
        // Alternate the diagonal so the facets look less regular.
        if ((i + j) % 2 === 0) {
          pushTri(a, b, cc);
          pushTri(a, cc, d);
        } else {
          pushTri(a, b, d);
          pushTri(b, cc, d);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Shared-vertex version: vertices are merged across cube faces so normals are smooth everywhere. */
function buildSmoothGeometry(shape: PlanetShape, N: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const cube = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let base = 0;
  for (const [faceN, u, v] of FACES) {
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        cube
          .copy(faceN)
          .addScaledVector(u, (2 * i) / N - 1)
          .addScaledVector(v, (2 * j) / N - 1);
        spherify(cube, dir).normalize();
        const h = shape.heightAt(dir);
        positions.push(dir.x * h, dir.y * h, dir.z * h);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = base + j * (N + 1) + i;
        const b = a + 1;
        const d = a + N + 1;
        const c = d + 1;
        indices.push(a, b, c, a, c, d);
      }
    }
    base += (N + 1) * (N + 1);
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo = mergeVertices(geo, 1e-3);
  // Make every triangle face outwards (cube faces have mixed winding).
  const idx = geo.index!;
  const pos = geo.getAttribute('position');
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const pc = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    pa.fromBufferAttribute(pos, idx.getX(t));
    pb.fromBufferAttribute(pos, idx.getX(t + 1));
    pc.fromBufferAttribute(pos, idx.getX(t + 2));
    n.crossVectors(pb.sub(pa), pc.sub(pa));
    if (n.dot(pa) < 0) {
      const tmp = idx.getX(t + 1);
      idx.setX(t + 1, idx.getX(t + 2));
      idx.setX(t + 2, tmp);
    }
  }
  geo.computeVertexNormals();

  const normals = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    dir.fromBufferAttribute(pos, i).normalize();
    n.fromBufferAttribute(normals, i);
    terrainColor(shape, dir, n, c).toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
}
