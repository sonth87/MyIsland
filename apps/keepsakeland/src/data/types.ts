export type ZoneType = 'rice' | 'mountain' | 'lake' | 'village' | 'forest';

export interface ZoneConfig {
  type: ZoneType;
  lat: number;
  lon: number;
  /** Angular radius in degrees. */
  radius: number;
  /** Mountain peak height (world units). */
  height?: number;
}

export interface LandmarkConfig {
  type: 'torii' | 'riceRack';
  lat: number;
  lon: number;
  /** Rotation around the local up axis, radians. */
  yaw: number;
}

export interface IslandConfig {
  id: string;
  name: { vi: string; ja: string };
  region: string;
  description: string;
  seed: string;
  radius: number;
  /** Water level relative to `radius`. */
  waterOffset: number;
  spawn: { lat: number; lon: number };
  zones: ZoneConfig[];
  /** Houses placed automatically inside village zones. */
  housesPerVillage: number;
  landmarks: LandmarkConfig[];
}
