import type { Vector3 } from 'three';

/** Uniform-grid bucket index for fast neighbour queries in 3D. */
export class SpatialHash<T> {
  private readonly cells = new Map<string, Array<{ p: Vector3; item: T }>>();

  constructor(readonly cellSize: number) {}

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  insert(p: Vector3, item: T): void {
    const s = this.cellSize;
    const k = this.key(Math.floor(p.x / s), Math.floor(p.y / s), Math.floor(p.z / s));
    let bucket = this.cells.get(k);
    if (!bucket) this.cells.set(k, (bucket = []));
    bucket.push({ p, item });
  }

  /** Calls `fn` for every item whose position lies within `radius` of `p`. */
  query(p: Vector3, radius: number, fn: (item: T, position: Vector3) => void): void {
    const s = this.cellSize;
    const r2 = radius * radius;
    const x0 = Math.floor((p.x - radius) / s);
    const x1 = Math.floor((p.x + radius) / s);
    const y0 = Math.floor((p.y - radius) / s);
    const y1 = Math.floor((p.y + radius) / s);
    const z0 = Math.floor((p.z - radius) / s);
    const z1 = Math.floor((p.z + radius) / s);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const bucket = this.cells.get(this.key(x, y, z));
          if (!bucket) continue;
          for (const e of bucket) if (e.p.distanceToSquared(p) <= r2) fn(e.item, e.p);
        }
  }

  /** True if any item lies within `radius` of `p`. */
  any(p: Vector3, radius: number): boolean {
    let found = false;
    this.query(p, radius, () => (found = true));
    return found;
  }
}
