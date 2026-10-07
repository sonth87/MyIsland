/// <reference lib="webworker" />
import type { IslandConfig } from '../data/types';
import { PlanetShape } from './PlanetShape';
import { buildPlanetGeometry } from './terrainGeometry';

export interface TerrainRequest {
  id: number;
  cfg: IslandConfig;
  resolution: number;
  smooth: boolean;
}

export interface TerrainResponse {
  id: number;
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  index: Uint32Array | null;
}

// Builds terrain geometry off the main thread so changing the detail level doesn't freeze the game.
self.onmessage = (e: MessageEvent<TerrainRequest>) => {
  const { id, cfg, resolution, smooth } = e.data;
  const geo = buildPlanetGeometry(new PlanetShape(cfg), resolution, smooth);
  const arr = (name: string) => geo.getAttribute(name).array as Float32Array;
  const index = geo.index ? Uint32Array.from(geo.index.array) : null;
  const res: TerrainResponse = { id, position: arr('position'), normal: arr('normal'), color: arr('color'), index };
  const transfer: Transferable[] = [res.position.buffer, res.normal.buffer, res.color.buffer];
  if (index) transfer.push(index.buffer);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, transfer);
};
