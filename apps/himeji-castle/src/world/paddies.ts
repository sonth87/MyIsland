import * as THREE from 'three';
import { envMaterial, LodInstances, lowpoly, q, type LodItem } from '@g2/engine';
import { PADDY_RADIUS, type ValleyData } from './ValleyGen';

/** Size of one paddy field (m). */
export const FIELD = 7;
/** Width of the earthen bunds between fields. */
const BUND = 0.55;

export type Stage = 'flooded' | 'green' | 'ripe';

export interface PaddyCell {
  /** Field indices. */
  i: number;
  j: number;
  /** Position inside the field, 0..1. */
  fx: number;
  fz: number;
  stage: Stage;
  /** True on the bund (the raised path around a field). */
  bund: boolean;
}

function hash(i: number, j: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Which field a point belongs to and what grows there; null outside the paddies. */
export function paddyCell(v: ValleyData, x: number, z: number): PaddyCell | null {
  if (!v.isPaddy(x, z)) return null;
  const gx = (x - v.paddy.x) / FIELD;
  const gz = (z - v.paddy.z) / FIELD;
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const h = hash(i, j);
  // Neighbouring fields at different stages, like a real patchwork in late summer.
  const stage: Stage = h < 0.22 ? 'flooded' : h < 0.55 ? 'green' : 'ripe';
  const b = BUND / FIELD / 2;
  return { i, j, fx, fz, stage, bund: fx < b || fx > 1 - b || fz < b || fz > 1 - b };
}

const STAGE_COLOR: Record<Stage, string> = { flooded: '#8fd06a', green: '#6cbd4c', ripe: '#ecc455' };

/** A clump of rice: thin leaves, plus drooping grain heads on ripe plants. */
function clump(stage: Stage): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blades = stage === 'flooded' ? 3 : q(5, 6, 8, 10);
  const h = stage === 'flooded' ? 0.28 : stage === 'green' ? 0.75 : 0.95;
  const c = STAGE_COLOR[stage];
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2;
    const tilt = 0.18 + (b % 2) * 0.12;
    parts.push(
      lowpoly.paint(
        new THREE.ConeGeometry(0.035, h * (0.8 + (b % 3) * 0.1), 3).translate(0, (h * (0.8 + (b % 3) * 0.1)) / 2, 0).rotateZ(Math.sin(a) * tilt).rotateX(Math.cos(a) * tilt),
        c,
      ),
    );
  }
  if (stage === 'ripe') {
    // Heavy heads bending over.
    for (let b = 0; b < q(2, 3, 4, 5); b++) {
      const a = (b / 3) * Math.PI * 2;
      parts.push(lowpoly.paint(new THREE.CapsuleGeometry(0.035, 0.18, 2, 4).rotateZ(1.1).translate(0.12, h * 0.95, 0).rotateY(a), '#d7a63c'));
    }
  }
  return lowpoly.merge(parts);
}

/**
 * Rice paddies: raised earthen bunds around every field, shallow sky-reflecting water in
 * the flooded and growing fields, and rice planted in neat rows at three growth stages.
 */
export function buildPaddies(v: ValleyData, density: number): { group: THREE.Group; rice: THREE.Group; lods: LodInstances[]; water: THREE.Mesh } {
  const group = new THREE.Group();
  group.name = 'paddies';
  const P = v.paddy;
  const R = PADDY_RADIUS;
  const span = Math.ceil(R / FIELD) + 1;

  // Bunds: a low ridge along every field edge that lies inside the paddies.
  const bunds: THREE.BufferGeometry[] = [];
  const seg = 1.2;
  for (const axis of ['x', 'z'] as const) {
    for (let line = -span; line <= span; line++) {
      for (let s = -span * FIELD; s < span * FIELD; s += seg) {
        const x = axis === 'x' ? P.x + s + seg / 2 : P.x + line * FIELD;
        const z = axis === 'x' ? P.z + line * FIELD : P.z + s + seg / 2;
        if (!v.isPaddy(x, z)) continue;
        const y = v.heightAt(x, z);
        const g = new THREE.BoxGeometry(axis === 'x' ? seg + 0.02 : BUND, 0.32, axis === 'x' ? BUND : seg + 0.02).translate(x, y + 0.06, z);
        bunds.push(lowpoly.paint(g, '#a58d62'));
        if (q(0, 0, 1, 1) && (s * 7) % 3 < 1) {
          // Tufts of grass on the bund.
          bunds.push(lowpoly.paint(new THREE.ConeGeometry(0.08, 0.3, 3).translate(x, y + 0.35, z), '#6fae4a'));
        }
      }
    }
  }
  const bundMesh = new THREE.Mesh(lowpoly.merge(bunds), envMaterial({ vertexColors: true }));
  bundMesh.receiveShadow = true;
  bundMesh.castShadow = true;
  group.add(bundMesh);

  // Water: one sheet over the paddies (hidden under the ripe, drained fields by the mud colour).
  const wGeo = new THREE.PlaneGeometry(R * 2 + 4, R * 2 + 4, 40, 40).rotateX(-Math.PI / 2);
  const pos = wGeo.getAttribute('position');
  const depth = new Float32Array(pos.count);
  const keep: number[] = [];
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k) + P.x;
    const z = pos.getZ(k) + P.z;
    pos.setXYZ(k, x, v.heightAt(x, z) + 0.12, z);
    depth[k] = 1.3; // muddy, mid-tone water rather than bright shallows
  }
  wGeo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  // Drop triangles outside the flooded / growing fields.
  const idx = wGeo.index!;
  for (let t = 0; t < idx.count; t += 3) {
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      cx += pos.getX(idx.getX(t + k)) / 3;
      cz += pos.getZ(idx.getX(t + k)) / 3;
    }
    const c = paddyCell(v, cx, cz);
    if (c && c.stage !== 'ripe' && !c.bund) keep.push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
  }
  wGeo.setIndex(keep);
  // See-through, so the dark mud and the young rice show and the water reads as a paddy, not a pool.
  const water = new THREE.Mesh(wGeo, envMaterial({ color: '#7fb7a8', transparent: true, opacity: 0.55, depthWrite: false }, { water: true, snow: false, wet: false, ice: true }));
  water.receiveShadow = true;
  group.add(water);

  // Rice in rows.
  const lods: LodInstances[] = [];
  // Kept apart so the ink outline (which would darken thin blades) can skip it.
  const rice = new THREE.Group();
  const spacing = 0.46 / Math.sqrt(Math.max(0.3, density));
  const byStage: Record<Stage, LodItem[]> = { flooded: [], green: [], ripe: [] };
  const m = new THREE.Matrix4();
  const qy = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let x = P.x - R; x < P.x + R; x += spacing) {
    for (let z = P.z - R; z < P.z + R; z += spacing) {
      const c = paddyCell(v, x, z);
      if (!c || c.bund) continue;
      if (c.stage === 'flooded' && hash(Math.round(x * 10), Math.round(z * 10)) < 0.35) continue;
      const jitter = hash(Math.round(x * 13), Math.round(z * 7));
      const p = new THREE.Vector3(x + (jitter - 0.5) * 0.08, v.heightAt(x, z) + (c.stage === 'ripe' ? 0 : 0.05), z);
      const s = 0.85 + jitter * 0.3;
      byStage[c.stage].push({
        position: p,
        matrix: m.compose(p, qy.setFromAxisAngle(up, jitter * 6.28), new THREE.Vector3(s, s, s)).clone(),
        color: new THREE.Color().setScalar(0.88 + jitter * 0.2),
      });
    }
  }
  const mat = envMaterial({ vertexColors: true }, { sway: 'grass' });
  for (const stage of ['flooded', 'green', 'ripe'] as Stage[]) {
    const lod = new LodInstances([{ geometry: clump(stage), maxDistance: stage === 'flooded' ? 70 : 110 }], mat, byStage[stage]);
    lods.push(lod);
    rice.add(lod.group);
  }
  return { group, rice, lods, water };
}
