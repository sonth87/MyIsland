import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural low-poly prop geometries with baked vertex colors.
 * Origin is at the base of each prop, +Y up, +Z forward. Use with `vertexColors: true`.
 */

const _c = new THREE.Color();

/**
 * Converts to non-indexed and paints every vertex with `color`.
 * Flat-shaded by default; `smooth` keeps the geometry's own (smooth) normals instead.
 */
export function paint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, smooth = false): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  _c.set(color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) _c.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (!smooth || !g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

/** Level of detail for procedural props: 0 = faceted low poly, 1 = rounder and smooth-shaded. */
export type PropDetail = 0 | 1;

/** Recomputes normals on a non-indexed geometry so every face is flat-shaded. */
export function facet<T extends THREE.BufferGeometry>(geometry: T): T {
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * How a part of a model reacts to the seasons (read by the environment shader through the
 * per-vertex `aSeason` attribute). Parts without it never change.
 */
export const SEASON_KIND = {
  none: 0,
  /** Terrain / bush greens: fresh in spring, deep in summer, straw in autumn, pale in winter. */
  ground: 1,
  /** Broad leaves: green, then yellow / orange / red, then shed. */
  leaf: 2,
  /** Cherry blossom: pink in spring, green in summer, red in autumn, shed in winter. */
  blossom: 3,
  /** Pine needles: always green (a little darker in winter). */
  evergreen: 4,
  /** Terrain under rice fields. */
  paddy: 5,
  /** Rice plants: young, green, golden, then cut. */
  crop: 6,
  /** Grass tufts: green, dry in autumn, short in winter. */
  tuft: 7,
  /** Flowers: bloom from spring to early autumn. */
  flower: 8,
  /** Fallen leaves on the ground: only in autumn. */
  litter: 9,
  /** Ground under cherry trees: petals in spring, grass the rest of the year. */
  grove: 10,
  /** Maple leaves: red-tinged green, crimson in autumn, shed in winter. */
  maple: 11,
} as const;

export type SeasonKind = (typeof SEASON_KIND)[keyof typeof SEASON_KIND];

/**
 * Tags every vertex of `geometry` with a season kind. For leaves, `center` is the point the
 * foliage shrinks towards when it is shed (`'auto'` = centre of the geometry's bounding box).
 */
export function seasonKind(geometry: THREE.BufferGeometry, kind: SeasonKind, center?: THREE.Vector3 | 'auto'): THREE.BufferGeometry {
  const n = geometry.getAttribute('position').count;
  geometry.setAttribute('aSeason', new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1));
  const c = new THREE.Vector3();
  if (center === 'auto') {
    geometry.computeBoundingBox();
    geometry.boundingBox!.getCenter(c);
  } else if (center) {
    c.copy(center);
  }
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  geometry.setAttribute('aCenter', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

const SEASON_ATTRS: Array<[string, number]> = [
  ['aSeason', 1],
  ['aCenter', 3],
];

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Parts that carry season data and parts that don't can be merged: fill in zeros for the latter.
  for (const [name, size] of SEASON_ATTRS) {
    if (!parts.some((p) => p.hasAttribute(name))) continue;
    for (const p of parts) {
      if (!p.hasAttribute(name)) p.setAttribute(name, new THREE.BufferAttribute(new Float32Array(p.getAttribute('position').count * size), size));
    }
  }
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('mergeGeometries failed (attribute mismatch)');
  return merged;
}

export interface TreeColors {
  trunk: THREE.ColorRepresentation;
  leaf: THREE.ColorRepresentation;
  leafLight: THREE.ColorRepresentation;
}

export function broadleafTree(c: TreeColors, detail: PropDetail = 0): THREE.BufferGeometry {
  const smooth = detail > 0;
  const seg = smooth ? 8 : 5;
  const trunk = paint(new THREE.CylinderGeometry(0.12, 0.2, 1.3, seg).translate(0, 0.65, 0), c.trunk, smooth);
  const crown = paint(new THREE.IcosahedronGeometry(0.95, detail).scale(1, 0.85, 1).translate(0, 1.85, 0), c.leaf, smooth);
  const crown2 = paint(
    new THREE.IcosahedronGeometry(0.6, detail).rotateY(0.6).translate(0.45, 2.35, 0.15),
    c.leafLight,
    smooth,
  );
  const crown3 = paint(
    new THREE.IcosahedronGeometry(0.55, detail).rotateX(0.4).translate(-0.4, 1.6, -0.35),
    c.leafLight,
    smooth,
  );
  const parts = [trunk, crown, crown2, crown3];
  if (smooth) {
    parts.push(paint(new THREE.IcosahedronGeometry(0.45, detail).translate(0.2, 1.55, 0.55), c.leaf, smooth));
    parts.push(paint(new THREE.CylinderGeometry(0.04, 0.07, 0.7, 5).rotateZ(-0.9).translate(0.32, 1.35, 0), c.trunk, smooth));
  }
  return merge(parts);
}

export function pineTree(c: TreeColors, detail: PropDetail = 0): THREE.BufferGeometry {
  const smooth = detail > 0;
  const seg = smooth ? 10 : 6;
  const trunk = paint(new THREE.CylinderGeometry(0.1, 0.16, 1.0, smooth ? 8 : 5).translate(0, 0.5, 0), c.trunk, smooth);
  const t1 = paint(new THREE.ConeGeometry(0.95, 1.4, seg).translate(0, 1.4, 0), c.leaf, smooth);
  const t2 = paint(new THREE.ConeGeometry(0.72, 1.2, seg).rotateY(0.5).translate(0, 2.1, 0), c.leaf, smooth);
  const t3 = paint(new THREE.ConeGeometry(0.45, 0.95, seg).rotateY(0.2).translate(0, 2.75, 0), c.leafLight, smooth);
  return merge([trunk, t1, t2, t3]);
}

export function rock(color: THREE.ColorRepresentation, detail: PropDetail = 0): THREE.BufferGeometry {
  return paint(new THREE.DodecahedronGeometry(0.55, detail).scale(1, 0.6, 0.8).translate(0, 0.15, 0), color);
}

export function bush(color: THREE.ColorRepresentation, detail: PropDetail = 0): THREE.BufferGeometry {
  const smooth = detail > 0;
  const a = paint(new THREE.IcosahedronGeometry(0.45, detail).scale(1, 0.75, 1).translate(0, 0.25, 0), color, smooth);
  const b = paint(new THREE.IcosahedronGeometry(0.32, detail).translate(0.35, 0.2, 0.1), color, smooth);
  return merge([a, b]);
}

/** A few thin blades; meant for wind-swayed instancing. */
export function grassTuft(color: THREE.ColorRepresentation, height = 0.42, blades = 3): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    const h = height * (0.75 + 0.25 * Math.cos(i * 2.3));
    parts.push(
      paint(
        new THREE.ConeGeometry(0.045, h, 3)
          .translate(0, h / 2, 0)
          .rotateZ(Math.sin(a) * 0.35)
          .rotateX(Math.cos(a) * 0.35)
          .translate(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06),
        color,
      ),
    );
  }
  return merge(parts);
}

export function flower(head: THREE.ColorRepresentation, stem: THREE.ColorRepresentation): THREE.BufferGeometry {
  const s = paint(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 3).translate(0, 0.16, 0), stem);
  const h = paint(new THREE.IcosahedronGeometry(0.075, 0).translate(0, 0.34, 0), head);
  return merge([s, h]);
}
