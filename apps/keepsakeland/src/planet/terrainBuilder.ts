import * as THREE from 'three';
import type { IslandConfig } from '../data/types';
import type { TerrainRequest, TerrainResponse } from './terrain.worker';

/** Builds terrain geometry in a Web Worker; only the latest request resolves. */
export class TerrainBuilder {
  private readonly worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 0;
  private pending: { id: number; resolve: (g: THREE.BufferGeometry | null) => void } | null = null;

  constructor(private readonly cfg: IslandConfig) {
    this.worker.onmessage = (e: MessageEvent<TerrainResponse>) => {
      const r = e.data;
      if (!this.pending || this.pending.id !== r.id) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(r.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(r.normal, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(r.color, 3));
      geo.setAttribute('aSeason', new THREE.BufferAttribute(r.season, 1));
      if (r.index) geo.setIndex(new THREE.BufferAttribute(r.index, 1));
      geo.computeBoundingSphere();
      this.pending.resolve(geo);
      this.pending = null;
    };
  }

  /** Resolves with the geometry, or null if a newer request superseded this one. */
  build(resolution: number, smooth: boolean): Promise<THREE.BufferGeometry | null> {
    this.pending?.resolve(null);
    const id = ++this.nextId;
    const req: TerrainRequest = { id, cfg: this.cfg, resolution, smooth };
    return new Promise((resolve) => {
      this.pending = { id, resolve };
      this.worker.postMessage(req);
    });
  }
}
