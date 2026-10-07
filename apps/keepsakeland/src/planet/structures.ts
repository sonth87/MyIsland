import * as THREE from 'three';
import { envMaterial, lowpoly, randRange, type Rng } from '@g2/engine';
import type { IslandConfig } from '../data/types';
import { PALETTE } from '../palette';
import { latLonToDir, type PlanetShape } from './PlanetShape';
import { localSurfaceDir, surfaceMatrix, yawFacing } from './surface';

const { paint, merge } = lowpoly;

export interface StructureCollider {
  dir: THREE.Vector3;
  radius: number;
  height: number;
}

/** A spot to sit; the character faces local +Z of the bench. */
export interface Bench {
  dir: THREE.Vector3;
  /** World-space facing direction (tangent). */
  facing: THREE.Vector3;
  position: THREE.Vector3;
}

export interface Lantern {
  /** World position of the light (top of the lantern). */
  light: THREE.Vector3;
}

export interface StructuresResult {
  mesh: THREE.Mesh;
  /** Windows and lantern fireboxes: glow at night. */
  glow: THREE.Mesh;
  colliders: StructureCollider[];
  benches: Bench[];
  lanterns: Lantern[];
}

interface Parts {
  solid: THREE.BufferGeometry[];
  glow: THREE.BufferGeometry[];
}

function house(roof: string): Parts {
  const walls = paint(new THREE.BoxGeometry(2.4, 1.5, 2).translate(0, 0.75, 0), PALETTE.wall);
  // Triangular prism roof: a 3-sided cylinder lying along X.
  const roofGeo = paint(
    new THREE.CylinderGeometry(1.45, 1.45, 2.8, 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 6).scale(1, 0.62, 1).translate(0, 1.95, 0),
    roof,
  );
  const door = paint(new THREE.BoxGeometry(0.55, 0.9, 0.08).translate(0.5, 0.45, 1.02), PALETTE.wood);
  const base = paint(new THREE.BoxGeometry(2.6, 0.2, 2.2).translate(0, 0.0, 0), PALETTE.rockDark);
  const glow = [
    paint(new THREE.BoxGeometry(0.5, 0.4, 0.06).translate(-0.6, 0.85, 1.02), PALETTE.dark),
    paint(new THREE.BoxGeometry(0.5, 0.4, 0.06).translate(0.4, 0.85, -1.02), PALETTE.dark),
    paint(new THREE.BoxGeometry(0.06, 0.4, 0.5).translate(1.22, 0.85, 0), PALETTE.dark),
  ];
  return { solid: [walls, roofGeo, door, base], glow };
}

function torii(): Parts {
  const solid = [
    new THREE.CylinderGeometry(0.13, 0.15, 2.6, 6).translate(-1.1, 1.3, 0),
    new THREE.CylinderGeometry(0.13, 0.15, 2.6, 6).translate(1.1, 1.3, 0),
    new THREE.BoxGeometry(3.2, 0.2, 0.3).translate(0, 2.65, 0),
    new THREE.BoxGeometry(2.6, 0.14, 0.2).translate(0, 2.2, 0),
  ].map((g) => paint(g, PALETTE.torii));
  solid.push(paint(new THREE.BoxGeometry(3.4, 0.1, 0.36).translate(0, 2.8, 0), PALETTE.dark));
  return { solid, glow: [] };
}

/** Hasa: wooden rack for drying rice sheaves. */
function riceRack(): Parts {
  const solid: THREE.BufferGeometry[] = [];
  for (const x of [-1.6, 0, 1.6]) solid.push(paint(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 4).translate(x, 0.75, 0), PALETTE.wood));
  solid.push(paint(new THREE.BoxGeometry(3.6, 0.06, 0.06).translate(0, 1.4, 0), PALETTE.wood));
  solid.push(paint(new THREE.BoxGeometry(3.4, 0.7, 0.3).translate(0, 0.95, 0), PALETTE.riceDark));
  return { solid, glow: [] };
}

/** Stone tōrō lantern; the firebox glows at night. Light sits at y≈0.95. */
function lantern(): Parts {
  const stone = PALETTE.rock;
  const solid = [
    paint(new THREE.CylinderGeometry(0.28, 0.32, 0.12, 6).translate(0, 0.06, 0), stone),
    paint(new THREE.CylinderGeometry(0.09, 0.11, 0.6, 6).translate(0, 0.42, 0), stone),
    paint(new THREE.CylinderGeometry(0.24, 0.2, 0.08, 6).translate(0, 0.76, 0), stone),
    paint(new THREE.ConeGeometry(0.36, 0.26, 6).translate(0, 1.2, 0), PALETTE.rockDark),
    paint(new THREE.IcosahedronGeometry(0.06, 0).translate(0, 1.36, 0), PALETTE.rockDark),
  ];
  const glow = [paint(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 6).translate(0, 0.95, 0), PALETTE.dark)];
  return { solid, glow };
}

function bench(): Parts {
  const wood = PALETTE.wood;
  const solid = [
    paint(new THREE.BoxGeometry(1.5, 0.08, 0.45).translate(0, 0.45, 0), wood),
    paint(new THREE.BoxGeometry(1.5, 0.3, 0.06).translate(0, 0.72, -0.22).rotateX(-0.12), wood),
  ];
  for (const x of [-0.62, 0.62]) solid.push(paint(new THREE.BoxGeometry(0.08, 0.45, 0.4).translate(x, 0.22, 0), PALETTE.rockDark));
  return { solid, glow: [] };
}

/** Builds every hand-placed and automatically placed structure into two merged meshes. */
export function structures(shape: PlanetShape, cfg: IslandConfig, rng: Rng): StructuresResult {
  const solid: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const colliders: StructureCollider[] = [];
  const benches: Bench[] = [];
  const lanterns: Lantern[] = [];
  const m = new THREE.Matrix4();

  const place = (parts: Parts, dir: THREE.Vector3, yaw: number, sink = 0.15) => {
    surfaceMatrix(dir, shape.heightAt(dir), yaw, 1, m, sink);
    for (const g of parts.solid) solid.push(g.applyMatrix4(m));
    for (const g of parts.glow) glow.push(g.applyMatrix4(m));
  };
  const placeLantern = (dir: THREE.Vector3) => {
    if (shape.isWater(dir, 0.3)) return;
    place(lantern(), dir, rng() * Math.PI, 0.05);
    lanterns.push({ light: dir.clone().multiplyScalar(shape.heightAt(dir) + 0.9) });
    colliders.push({ dir: dir.clone(), radius: 0.3, height: 1.4 });
  };

  // Houses scattered inside each village zone, with a lantern by some of the doors.
  for (const zone of shape.zones.filter((z) => z.type === 'village')) {
    const placed: THREE.Vector3[] = [];
    for (let i = 0; i < 80 && placed.length < cfg.housesPerVillage; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * zone.radiusRad * 0.55 * shape.radius;
      const dir = zone.dir
        .clone()
        .multiplyScalar(shape.radius)
        .addScaledVector(zone.tangent, Math.cos(a) * r)
        .addScaledVector(zone.bitangent, Math.sin(a) * r)
        .normalize();
      if (shape.isWater(dir, 0.6) || shape.slopeAt(dir) > 0.5) continue;
      if (placed.some((p) => p.angleTo(dir) * shape.radius < 5)) continue;
      placed.push(dir);
      const yaw = rng() * Math.PI * 2;
      place(house(rng() < 0.7 ? PALETTE.roof : PALETTE.roofAlt), dir, yaw);
      colliders.push({ dir, radius: 1.6, height: 3 });
      if (placed.length % 2 === 1) placeLantern(localSurfaceDir(dir, shape.radius, yaw, 1.3, 1.9));
    }
  }

  for (const l of cfg.landmarks) {
    const dir = latLonToDir(l.lat, l.lon);
    if (l.type === 'torii') {
      place(torii(), dir, l.yaw);
      for (const x of [-1.1, 1.1]) colliders.push({ dir: localSurfaceDir(dir, shape.radius, l.yaw, x, 0), radius: 0.3, height: 2.8 });
      for (const x of [-1.9, 1.9]) placeLantern(localSurfaceDir(dir, shape.radius, l.yaw, x, 1.6));
    } else {
      place(riceRack(), dir, l.yaw + randRange(rng, -0.1, 0.1));
      for (const x of [-1.3, 0, 1.3]) {
        colliders.push({ dir: localSurfaceDir(dir, shape.radius, l.yaw, x, 0), radius: 0.55, height: 1.5 });
      }
    }
  }

  // A bench on the shore of every lake, facing the water, with a lantern beside it.
  const tangent = new THREE.Vector3();
  for (const zone of shape.zones.filter((z) => z.type === 'lake')) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + 0.3;
      let found: THREE.Vector3 | null = null;
      for (let f = 0.75; f <= 1.3 && !found; f += 0.05) {
        const r = zone.radiusRad * f * shape.radius;
        const dir = zone.dir
          .clone()
          .multiplyScalar(shape.radius)
          .addScaledVector(zone.tangent, Math.cos(a) * r)
          .addScaledVector(zone.bitangent, Math.sin(a) * r)
          .normalize();
        const h = shape.heightAt(dir) - shape.waterLevel;
        if (h > 0.45 && h < 1.6 && shape.slopeAt(dir) < 0.35) found = dir;
      }
      if (!found) continue;
      tangent.copy(zone.dir).addScaledVector(found, -zone.dir.dot(found)).normalize();
      const yaw = yawFacing(found, tangent);
      place(bench(), found, yaw, 0.05);
      benches.push({
        dir: found,
        facing: tangent.clone(),
        position: found.clone().multiplyScalar(shape.heightAt(found)),
      });
      colliders.push({ dir: found.clone(), radius: 0.55, height: 0.8 });
      placeLantern(localSurfaceDir(found, shape.radius, yaw, 1.4, -0.3));
      break;
    }
  }

  const empty = () => new THREE.BufferGeometry();
  const mesh = new THREE.Mesh(solid.length ? merge(solid) : empty(), envMaterial({ vertexColors: true }));
  mesh.name = 'structures';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const glowMesh = new THREE.Mesh(
    glow.length ? merge(glow) : empty(),
    envMaterial({ vertexColors: true }, { glow: true, snow: false, wet: false }),
  );
  glowMesh.name = 'windows';
  return { mesh, glow: glowMesh, colliders, benches, lanterns };
}
