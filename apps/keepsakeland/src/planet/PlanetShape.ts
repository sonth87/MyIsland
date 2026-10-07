import { MathUtils, Vector3 } from 'three';
import { createNoise, createRng, type NoiseSet, type Surface } from '@g2/engine';
import type { IslandConfig, ZoneConfig, ZoneType } from '../data/types';

export interface Zone extends ZoneConfig {
  dir: Vector3;
  tangent: Vector3;
  bitangent: Vector3;
  radiusRad: number;
}

export interface SurfaceSample {
  /** Distance from planet center. */
  height: number;
  /** Max influence (0..1) of each zone type at this point. */
  weights: Record<ZoneType, number>;
}

export interface RiceField {
  path: boolean;
  cell: number;
}

const FIELD_SIZE = 3.4;
const FIELD_PATH = 0.14;

export function latLonToDir(lat: number, lon: number, out = new Vector3()): Vector3 {
  const la = lat * MathUtils.DEG2RAD;
  const lo = lon * MathUtils.DEG2RAD;
  return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo));
}

/** Any unit vector perpendicular to `dir`. */
export function anyTangent(dir: Vector3, out = new Vector3()): Vector3 {
  out.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.9) out.set(1, 0, 0);
  return out.cross(dir).normalize();
}

const _t1 = new Vector3();
const _t2 = new Vector3();
const _p = new Vector3();

/**
 * The analytic shape of the planet. `heightAt(dir)` is the single source of truth used to
 * build the mesh, keep the player grounded and place props — so they always agree.
 */
export class PlanetShape {
  readonly radius: number;
  readonly waterLevel: number;
  readonly zones: Zone[];
  private readonly n: NoiseSet;

  constructor(cfg: IslandConfig) {
    this.radius = cfg.radius;
    this.waterLevel = cfg.radius + cfg.waterOffset;
    this.n = createNoise(createRng(cfg.seed));
    this.zones = cfg.zones.map((z) => {
      const dir = latLonToDir(z.lat, z.lon);
      const tangent = anyTangent(dir);
      return {
        ...z,
        dir,
        tangent,
        bitangent: dir.clone().cross(tangent).normalize(),
        radiusRad: z.radius * MathUtils.DEG2RAD,
      };
    });
  }

  zoneWeight(dir: Vector3, z: Zone): number {
    const angle = Math.acos(MathUtils.clamp(dir.dot(z.dir), -1, 1));
    return 1 - MathUtils.smoothstep(angle, z.radiusRad * 0.55, z.radiusRad);
  }

  heightAt(dir: Vector3): number {
    return this.radius + this.elevation(dir, null);
  }

  sample(dir: Vector3): SurfaceSample {
    const weights: Record<ZoneType, number> = { rice: 0, mountain: 0, lake: 0, village: 0, forest: 0 };
    return { height: this.radius + this.elevation(dir, weights), weights };
  }

  isWater(dir: Vector3, margin = 0): boolean {
    return this.heightAt(dir) < this.waterLevel + margin;
  }

  /** Rise over run of the terrain around `dir` (0 = flat). */
  slopeAt(dir: Vector3, step = 0.5): number {
    anyTangent(dir, _t1);
    _t2.copy(dir).cross(_t1);
    const h0 = this.heightAt(dir);
    const r = this.radius;
    const h1 = this.heightAt(_p.copy(dir).multiplyScalar(r).addScaledVector(_t1, step).normalize());
    const h2 = this.heightAt(_p.copy(dir).multiplyScalar(r).addScaledVector(_t2, step).normalize());
    return Math.hypot(h1 - h0, h2 - h0) / step;
  }

  /** Small-scale noise in [-1, 1] for color variation. */
  detail(dir: Vector3, scale = 8): number {
    return this.n.noise(dir.x * scale, dir.y * scale, dir.z * scale);
  }

  /** Paddy grid inside rice zones (null outside). Shared by terrain colors and crop placement. */
  riceField(dir: Vector3): RiceField | null {
    for (const z of this.zones) {
      if (z.type !== 'rice' || this.zoneWeight(dir, z) < 0.6) continue;
      const a = (dir.dot(z.tangent) * this.radius) / FIELD_SIZE;
      const b = (dir.dot(z.bitangent) * this.radius) / FIELD_SIZE;
      const fa = a - Math.floor(a);
      const fb = b - Math.floor(b);
      const path = fa < FIELD_PATH || fb < FIELD_PATH;
      const cell = (Math.imul(Math.floor(a), 73856093) ^ Math.imul(Math.floor(b), 19349663)) >>> 0;
      return { path, cell };
    }
    return null;
  }

  private elevation(dir: Vector3, weights: Record<ZoneType, number> | null): number {
    const { fbm, ridged, noise } = this.n;
    const { x, y, z } = dir;
    let h = 0.8 + fbm(x * 1.4, y * 1.4, z * 1.4) * 2.4 + noise(x * 7, y * 7, z * 7) * 0.18;

    for (const zone of this.zones) {
      const w = this.zoneWeight(dir, zone);
      if (weights) weights[zone.type] = Math.max(weights[zone.type], w);
      if (w <= 0) continue;
      switch (zone.type) {
        case 'mountain': {
          // Peaked profile (not the plateau the soft zone weight would give).
          const angle = Math.acos(MathUtils.clamp(dir.dot(zone.dir), -1, 1));
          const peak = Math.pow(Math.max(0, 1 - angle / zone.radiusRad), 1.6);
          h += peak * (zone.height ?? 7) * (0.55 + 0.6 * ridged(x * 3.5, y * 3.5, z * 3.5));
          break;
        }
        case 'lake':
          h = MathUtils.lerp(h, -2.6, w);
          break;
        case 'rice':
          h = MathUtils.lerp(h, 0.45, w);
          break;
        case 'village':
          h = MathUtils.lerp(h, 0.9, w);
          break;
        case 'forest':
          break;
      }
    }
    return h;
  }
}

const _sd = new Vector3();

/** The planet as a `Surface` for the shared environment effects (rain, snow, leaves, wind). */
export function planetSurface(shape: PlanetShape): Surface {
  return {
    up: (p, out) => out.copy(p).normalize(),
    ground: (p, out) => {
      out.copy(p).normalize();
      return out.multiplyScalar(Math.max(shape.heightAt(out), shape.waterLevel));
    },
    isWater: (p) => shape.isWater(_sd.copy(p).normalize()),
  };
}
