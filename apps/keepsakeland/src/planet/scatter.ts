import * as THREE from 'three';
import {
  createRng,
  envDepthMaterial,
  getQuality,
  envMaterial,
  envNormalMaterial,
  foliage,
  foliageMaterials,
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

const WHITE = new THREE.Color(1, 1, 1);

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
  /** Fallen leaves under the trees (autumn only). */
  litter: Placed[];
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
  spacing: number | ((c: Candidate) => number) = 0,
  occupied?: SpatialHash<true>,
): Candidate[] {
  const out: Candidate[] = [];
  const attempts = count * 16;
  for (let i = 0; i < attempts && out.length < count; i++) {
    const dir = randomDir(rng);
    const sample = shape.sample(dir);
    const c = { dir, sample };
    if (!accept(c)) continue;
    const reqSpacing = typeof spacing === 'function' ? spacing(c) : spacing;
    if (reqSpacing > 0 && occupied) {
      const p = dir.clone().multiplyScalar(sample.height);
      if (occupied.any(p, reqSpacing)) continue;
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
    950,
    (c) => {
      const w = c.sample.weights;
      if (!onLand(c, 0.5) || w.rice > 0.16 || w.village > 0.55 || w.lake > 0.45) return false;
      if (shape.slopeAt(c.dir) > 0.95) return false;
      const forest = shape.detail(c.dir, 2.2) + w.forest * 1.4 + w.mountain * 0.35;
      return forest > 0.05 || rng() < 0.2;
    },
    (c) => {
      const w = c.sample.weights;
      const forestFactor = Math.min(1, Math.max(0, w.forest * 1.5 + shape.detail(c.dir, 2.2) * 0.5));
      // In forest: closer together (~1.15m - 1.25m); outside forest: more open (~1.7m)
      return 1.15 + (1 - forestFactor) * 0.55;
    },
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
    addCollider(t.dir, 0.28 * scale, 3 * scale, (pine ? 0.55 : 0.75) * scale);
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

  // Fallen leaves under deciduous trees (shown only in autumn); a separate random stream keeps the rest unchanged.
  const lrng = createRng(`${cfg.seed}:litter`);
  const litter: Placed[] = [];
  const _t1 = new THREE.Vector3();
  const _t2 = new THREE.Vector3();
  const _d = new THREE.Vector3();
  for (const t of trees) {
    if (t.species === 'pine') continue;
    const up = _d.copy(t.position).normalize();
    anyTangent(up, _t1);
    _t2.crossVectors(up, _t1);
    const count = Math.round(4 + lrng() * 4 * t.scale);
    for (let k = 0; k < count; k++) {
      const a = lrng() * Math.PI * 2;
      const r = (0.5 + lrng() * 1.8) * t.scale * TREE_SIZE * 1.6;
      const dir = t.position.clone().addScaledVector(_t1, Math.cos(a) * r).addScaledVector(_t2, Math.sin(a) * r).normalize();
      if (shape.isWater(dir, 0.25)) continue;
      const sc = 0.55 + lrng() * 0.45;
      litter.push({ matrix: surfaceMatrix(dir, shape.heightAt(dir), lrng() * 6.28, new THREE.Vector3(sc, 1, sc), new THREE.Matrix4(), -0.03), tint: tint(0.85, 1.15) });
    }
  }

  return { structures: built, trees, rocks, bushes, grass, rice, flowers, litter, colliders };
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

  const treeMat = envMaterial({ vertexColors: true }, { sway: 'tree', season: true });
  const treeDepth = envDepthMaterial({ sway: 'tree', season: true });
  // Ink outlines are drawn from a normal pass; give it the same sway (and shed leaves) so lines follow the trees.
  const treeOutline = envNormalMaterial({ sway: 'tree', season: true });
  const shapes = treeShapes();
  // High / ultra: leaf-card trees, bushes and plants (see engine `foliage`).
  const leafy = getQuality() >= 2;
  const treeFoliage = leafy ? foliageMaterials({ sway: 'tree', season: true }) : null;
  for (const sp of TREE_SPECIES) {
    shapes.get(sp)!.forEach((shape, vi) => {
      const list = layout.trees.filter((t) => t.species === sp && t.variant === vi);
      if (!list.length) return;
      // Low detail: the simple far-away shape; otherwise the full branching tree.
      const geometry = (d > 0 || detail.grass > 0.2 ? shape.high : shape.low).clone();
      const f = shape.foliage && treeFoliage && geometry.hasAttribute('uv') ? treeFoliage : null;
      const mesh = instanced(geometry, f ? f.material : treeMat, list);
      mesh.customDepthMaterial = f ? f.depth : treeDepth;
      mesh.userData.outlineMaterial = f ? f.outline : treeOutline;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      out.solid.add(mesh);
    });
  }

  const propMat = envMaterial({ vertexColors: true });
  const rockMesh = instanced(lowpoly.rock(PALETTE.rock, d), propMat, layout.rocks);
  const K = lowpoly.SEASON_KIND;
  const kind = lowpoly.seasonKind;
  const bushFoliage = leafy ? foliageMaterials({ sway: 'grass', swayScale: 0.12, season: true }) : null;
  const bushMesh = bushFoliage
    ? instanced(foliage.fluffyBush(PALETTE.bush), bushFoliage.material, layout.bushes)
    : instanced(kind(lowpoly.bush(PALETTE.bush, d), K.ground), envMaterial({ vertexColors: true }, { sway: 'grass', swayScale: 0.12, season: true }), layout.bushes);
  if (bushFoliage) bushMesh.customDepthMaterial = bushFoliage.depth;
  bushMesh.userData.outlineMaterial = bushFoliage ? bushFoliage.outline : envNormalMaterial({ sway: 'grass', swayScale: 0.12, season: true });
  for (const m of [rockMesh, bushMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
    out.solid.add(m);
  }

  const windMat = envMaterial({ vertexColors: true }, { sway: 'grass', push: true, season: true });
  const take = <T>(list: T[], fraction: number) => list.slice(0, Math.round(list.length * fraction));
  const leaf = new THREE.CircleGeometry(0.17, 5).rotateX(-Math.PI / 2).scale(1, 1, 1.5);
  const leafMat = leafy ? foliageMaterials({ sway: 'grass', push: true, season: true }).material : null;
  const flowers = take(layout.flowers, detail.flowers);
  const plant = leafMat ? foliage.flowerPlant(PALETTE.leaf) : null;
  const soft = [
    leafMat
      ? instanced(kind(foliage.grassClump(PALETTE.leafLight, 0.4), K.tuft), leafMat, take(layout.grass, detail.grass))
      : instanced(kind(lowpoly.grassTuft(PALETTE.leafLight), K.tuft), windMat, take(layout.grass, detail.grass)),
    instanced(kind(lowpoly.grassTuft(PALETTE.rice, 0.75, 5), K.crop), windMat, take(layout.rice, detail.rice)),
    ...(plant && leafMat
      ? [
          // Stems keep their own green; only the flower heads take the instance colour.
          instanced(plant.stems, leafMat, flowers.map((f) => ({ ...f, tint: WHITE }))),
          instanced(plant.heads, leafMat, flowers),
        ]
      : [instanced(kind(lowpoly.flower('#ffffff', '#ffffff'), K.flower), windMat, flowers)]),
    // Fallen leaves: only in autumn (the shader hides them the rest of the year).
    instanced(
      kind(lowpoly.paint(leaf, '#c8843a'), K.litter),
      envMaterial({ vertexColors: true, side: THREE.DoubleSide }, { season: true, snow: false }),
      take(layout.litter, detail.grass),
    ),
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

// Tree shapes depend on the model quality, so they are cached per quality level.
const shapeCache = new Map<number, Map<TreeSpecies, TreeVariant[]>>();
function treeShapes(): Map<TreeSpecies, TreeVariant[]> {
  const quality = getQuality();
  let shapes = shapeCache.get(quality);
  if (!shapes) {
    const rng = createRng('isle-trees');
    shapes = new Map(TREE_SPECIES.map((sp) => [sp, treeVariants(sp, rng, TREE_VARIANTS)]));
    shapeCache.set(quality, shapes);
  }
  return shapes;
}
