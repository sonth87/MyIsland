import * as THREE from 'three';
import {
  createRng,
  envDepthMaterial,
  envMaterial,
  envNormalMaterial,
  lowpoly,
  randRange,
  SpatialHash,
  treeVariants,
  type Rng,
  type TreeSpecies,
  type TreeVariant,
} from '@g2/engine';
import type { IslandConfig } from '../data/types';
import { color, PALETTE } from '../palette';
import type { DetailPreset } from '../settings/detail';
import { anyTangent, latLonToDir, type PlanetShape, type SurfaceSample } from './PlanetShape';
import { structures, type StructuresResult } from './structures';
import { randomDir, surfaceMatrix } from './surface';

/** A circular obstacle standing on the surface. */
export interface PlanetCollider {
  position: THREE.Vector3;
  radius: number;
  /** Height of the object, and the radius the camera should keep away from (e.g. a tree crown). */
  height: number;
  cameraRadius: number;
}

export interface TreeInstance {
  /** World position of the base. */
  position: THREE.Vector3;
  matrix: THREE.Matrix4;
  scale: number;
  pine: boolean;
  species: TreeSpecies;
  variant: number;
  tint: THREE.Color;
}

/** Procedural tree shapes per species (built once, shared by every detail level). */
const TREE_SPECIES: TreeSpecies[] = ['broadleaf', 'pine', 'sakura', 'maple'];
const TREE_VARIANTS = 3;
/** Engine trees are ~5 units tall; the planet is small, so shrink them. */
const TREE_SIZE = 0.62;

interface Placed {
  matrix: THREE.Matrix4;
  tint: THREE.Color;
}

/** Where everything goes. Computed once; meshes are (re)built from it for any detail level. */
export interface PropLayout {
  structures: StructuresResult;
  trees: TreeInstance[];
  rocks: Placed[];
  bushes: Placed[];
  /** Grass / rice / flowers are generated at the maximum density, in random order; detail uses a prefix. */
  grass: Placed[];
  rice: Placed[];
  flowers: Placed[];
  colliders: SpatialHash<PlanetCollider>;
}

const MAX_GRASS = 12000;
const MAX_RICE = 7000;
const MAX_FLOWERS = 1600;

interface Candidate {
  dir: THREE.Vector3;
  sample: SurfaceSample;
}

/** Rejection-samples up to `count` surface points that pass `accept` and keep `spacing` apart. */
function samplePoints(
  shape: PlanetShape,
  rng: Rng,
  count: number,
  accept: (c: Candidate) => boolean,
  spacing = 0,
  occupied?: SpatialHash<true>,
): Candidate[] {
  const out: Candidate[] = [];
  const attempts = count * 12;
  for (let i = 0; i < attempts && out.length < count; i++) {
    const dir = randomDir(rng);
    const sample = shape.sample(dir);
    const c = { dir, sample };
    if (!accept(c)) continue;
    if (spacing > 0 && occupied) {
      const p = dir.clone().multiplyScalar(sample.height);
      if (occupied.any(p, spacing)) continue;
      occupied.insert(p, true);
    }
    out.push(c);
  }
  return out;
}

export function layoutProps(shape: PlanetShape, cfg: IslandConfig, rng: Rng): PropLayout {
  const colliders = new SpatialHash<PlanetCollider>(4);
  const occupied = new SpatialHash<true>(3);
  const water = shape.waterLevel;
  const tint = (a: number, b: number) => new THREE.Color().setScalar(randRange(rng, a, b));

  const addCollider = (dir: THREE.Vector3, radius: number, height: number, cameraRadius = radius) => {
    const position = dir.clone().multiplyScalar(shape.heightAt(dir));
    colliders.insert(position, { position, radius, height, cameraRadius });
  };

  // Structures first so nature avoids them.
  const built = structures(shape, cfg, rng);
  for (const c of built.colliders) {
    addCollider(c.dir, c.radius, c.height, c.radius + 0.3);
    occupied.insert(c.dir.clone().multiplyScalar(shape.radius), true);
  }

  const onLand = (c: Candidate, margin = 0.45) => c.sample.height > water + margin;

  const trees = samplePoints(
    shape,
    rng,
    520,
    (c) => {
      const w = c.sample.weights;
      if (!onLand(c, 0.55) || w.rice > 0.15 || w.village > 0.6 || w.lake > 0.5) return false;
      if (shape.slopeAt(c.dir) > 0.9) return false;
      const forest = shape.detail(c.dir, 2.2) + w.forest * 1.3 + w.mountain * 0.35;
      return forest > 0.1 || rng() < 0.12;
    },
    1.7,
    occupied,
  ).map((t): TreeInstance => {
    const h = t.sample.height - shape.radius;
    const w = t.sample.weights;
    const pine = w.mountain > 0.25 || h > 3.4 || rng() < 0.18;
    // Cherry trees around the village and the lakes, maples here and there.
    const species: TreeSpecies = pine
      ? 'pine'
      : (w.village > 0.15 || w.lake > 0.15 || w.rice > 0.05) && rng() < 0.7
        ? 'sakura'
        : rng() < 0.12
          ? 'maple'
          : 'broadleaf';
    // Wide size spread (young saplings to old trees), skewed towards medium.
    const scale = (0.55 + rng() ** 0.8 * 0.8) * (pine ? 1.1 : 1);
    const lean = new THREE.Vector3(1 + (rng() - 0.5) * 0.2, 0.85 + rng() * 0.35, 1 + (rng() - 0.5) * 0.2).multiplyScalar(scale * TREE_SIZE);
    const matrix = surfaceMatrix(t.dir, t.sample.height, rng() * Math.PI * 2, lean);
    addCollider(t.dir, 0.32 * scale, 3 * scale, (pine ? 0.6 : 0.85) * scale);
    return {
      position: new THREE.Vector3().setFromMatrixPosition(matrix),
      matrix,
      scale,
      pine,
      species,
      variant: Math.floor(rng() * TREE_VARIANTS),
      tint: tint(0.88, 1.08),
    };
  });

  const rocks = samplePoints(shape, rng, 90, (c) => onLand(c, 0.1) && c.sample.weights.rice < 0.3, 1.2, occupied).map((r) => {
    const s = randRange(rng, 0.6, 1.8);
    addCollider(r.dir, 0.42 * s, 0.6 * s);
    return { matrix: surfaceMatrix(r.dir, r.sample.height, rng() * 6.28, s, new THREE.Matrix4(), 0.15), tint: tint(0.9, 1.05) };
  });

  const bushes = samplePoints(shape, rng, 280, (c) => onLand(c) && c.sample.weights.rice < 0.3, 0.9, occupied).map((b) => ({
    matrix: surfaceMatrix(b.dir, b.sample.height, rng() * 6.28, randRange(rng, 0.7, 1.4)),
    tint: tint(0.85, 1.1),
  }));

  const flat = (c: Candidate, lo: number, hi: number) => ({
    matrix: surfaceMatrix(c.dir, c.sample.height, rng() * 6.28, randRange(rng, lo, hi), new THREE.Matrix4(), 0.02),
    tint: tint(0.8, 1.1),
  });

  const grass = samplePoints(
    shape,
    rng,
    MAX_GRASS,
    (c) => onLand(c, 0.5) && !shape.riceField(c.dir) && c.sample.weights.mountain < 0.6,
  ).map((g) => flat(g, 0.8, 1.5));

  const rice = samplePoints(shape, rng, MAX_RICE, (c) => {
    const f = shape.riceField(c.dir);
    return !!f && !f.path;
  }).map((r) => flat(r, 0.85, 1.2));

  // Red spider lilies along the paddies, white / yellow elsewhere.
  const flowers = samplePoints(shape, rng, MAX_FLOWERS, (c) => onLand(c, 0.5) && c.sample.weights.mountain < 0.5).map((f) => {
    const p = flat(f, 0.8, 1.3);
    if (f.sample.weights.rice > 0.4 || rng() < 0.2) p.tint = color('flowerRed').clone();
    else p.tint = (rng() < 0.6 ? color('flowerWhite') : color('flowerYellow')).clone();
    return p;
  });

  return { structures: built, trees, rocks, bushes, grass, rice, flowers, colliders };
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, items: Placed[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
  mesh.count = items.length;
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.matrix);
    mesh.setColorAt(i, it.tint);
  });
  mesh.computeBoundingSphere();
  return mesh;
}

export interface PropMeshes {
  /** Outlined props. */
  solid: THREE.Group;
  /** Thin swaying things that should not get ink outlines. */
  soft: THREE.Group;
}

/** Builds the instanced meshes for a detail level into the given (emptied) groups. */
export function buildPropMeshes(layout: PropLayout, detail: DetailPreset, out: PropMeshes): void {
  for (const g of [out.solid, out.soft]) {
    for (const child of [...g.children]) {
      if (child instanceof THREE.Mesh && child !== layout.structures.mesh && child !== layout.structures.glow) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
        if (child.customDepthMaterial) child.customDepthMaterial.dispose();
        (child.userData.outlineMaterial as THREE.Material | undefined)?.dispose();
      }
      g.remove(child);
    }
  }
  const d = detail.props;
  out.solid.add(layout.structures.mesh, layout.structures.glow);

  const treeMat = envMaterial({ vertexColors: true }, { sway: 'tree' });
  const treeDepth = envDepthMaterial({ sway: 'tree' });
  // Ink outlines are drawn from a normal pass; give it the same sway so lines follow the trees.
  const treeOutline = envNormalMaterial({ sway: 'tree' });
  const shapes = treeShapes();
  for (const sp of TREE_SPECIES) {
    shapes.get(sp)!.forEach((shape, vi) => {
      const list = layout.trees.filter((t) => t.species === sp && t.variant === vi);
      if (!list.length) return;
      // Low detail: the simple far-away shape; otherwise the full branching tree.
        const mesh = instanced((d > 0 || detail.grass > 0.2 ? shape.high : shape.low).clone(), treeMat, list);
      mesh.customDepthMaterial = treeDepth;
      mesh.userData.outlineMaterial = treeOutline;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      out.solid.add(mesh);
    });
  }

  const propMat = envMaterial({ vertexColors: true });
  const rockMesh = instanced(lowpoly.rock(PALETTE.rock, d), propMat, layout.rocks);
  const bushMesh = instanced(lowpoly.bush(PALETTE.bush, d), envMaterial({ vertexColors: true }, { sway: 'grass', swayScale: 0.12 }), layout.bushes);
  bushMesh.userData.outlineMaterial = envNormalMaterial({ sway: 'grass', swayScale: 0.12 });
  for (const m of [rockMesh, bushMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
    out.solid.add(m);
  }

  const windMat = envMaterial({ vertexColors: true }, { sway: 'grass', push: true });
  const take = <T>(list: T[], fraction: number) => list.slice(0, Math.round(list.length * fraction));
  const soft = [
    instanced(lowpoly.grassTuft(PALETTE.leafLight), windMat, take(layout.grass, detail.grass)),
    instanced(lowpoly.grassTuft(PALETTE.rice, 0.75, 5), windMat, take(layout.rice, detail.rice)),
    instanced(lowpoly.flower('#ffffff', '#ffffff'), windMat, take(layout.flowers, detail.flowers)),
  ];
  for (const m of soft) {
    m.receiveShadow = true;
    out.soft.add(m);
  }
}

/** Spawn direction from config, nudged onto land if needed. */
export function spawnDir(shape: PlanetShape, cfg: IslandConfig): THREE.Vector3 {
  const dir = latLonToDir(cfg.spawn.lat, cfg.spawn.lon);
  const t = anyTangent(dir);
  for (let i = 0; i < 40 && shape.isWater(dir, 0.3); i++) dir.addScaledVector(t, 0.05).normalize();
  return dir;
}

let shapeCache: Map<TreeSpecies, TreeVariant[]> | null = null;
function treeShapes(): Map<TreeSpecies, TreeVariant[]> {
  if (shapeCache) return shapeCache;
  const rng = createRng('isle-trees');
  shapeCache = new Map(TREE_SPECIES.map((sp) => [sp, treeVariants(sp, rng, TREE_VARIANTS)]));
  return shapeCache;
}
