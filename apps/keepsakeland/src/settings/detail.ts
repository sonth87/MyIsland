import type { lowpoly } from '@g2/engine';
import type { DetailLevel } from './Settings';

export interface DetailPreset {
  label: string;
  description: string;
  /** Terrain cells per cube face edge. */
  terrainRes: number;
  /** Smooth (interpolated) terrain shading instead of flat facets. */
  smoothTerrain: boolean;
  props: lowpoly.PropDetail;
  /** Fractions of the maximum grass / rice / flower counts. */
  grass: number;
  rice: number;
  flowers: number;
  shadowMap: number;
  maxPixelRatio: number;
  /** Rain / snow particle budget multiplier. */
  particles: number;
}

export const DETAIL: Record<DetailLevel, DetailPreset> = {
  low: {
    label: 'Thấp',
    description: 'Góc cạnh rõ, ít cỏ, bóng đổ thô. Nhẹ nhất, hợp với điện thoại cũ.',
    terrainRes: 44,
    smoothTerrain: false,
    props: 0,
    grass: 0.15,
    rice: 0.4,
    flowers: 0.35,
    shadowMap: 1024,
    maxPixelRatio: 1,
    particles: 0.4,
  },
  medium: {
    label: 'Vừa',
    description: 'Low poly cổ điển: mặt phẳng góc cạnh, mật độ cỏ vừa phải.',
    terrainRes: 72,
    smoothTerrain: false,
    props: 0,
    grass: 0.35,
    rice: 0.6,
    flowers: 0.55,
    shadowMap: 2048,
    maxPixelRatio: 1.5,
    particles: 0.7,
  },
  high: {
    label: 'Cao',
    description: 'Địa hình mịn hơn, tán cây tròn, cỏ dày. Cần máy khá.',
    terrainRes: 110,
    smoothTerrain: true,
    props: 1,
    grass: 0.65,
    rice: 0.85,
    flowers: 0.8,
    shadowMap: 2048,
    maxPixelRatio: 2,
    particles: 1,
  },
  ultra: {
    label: 'Rất cao',
    description: 'Bề mặt trơn mịn, cỏ và hoa dày đặc, bóng đổ sắc nét. Nặng nhất.',
    terrainRes: 150,
    smoothTerrain: true,
    props: 1,
    grass: 1,
    rice: 1,
    flowers: 1,
    shadowMap: 4096,
    maxPixelRatio: 2,
    particles: 1.25,
  },
};
