import type { IslandConfig } from './types';

// Placeholder content — replace name/description/POIs with your own memories.
export const SADO: IslandConfig = {
  id: 'sado',
  name: { vi: 'Sado', ja: '佐渡島' },
  region: 'Niigata · Nhật Bản',
  description:
    'Một hành tinh nhỏ dựng lại hòn đảo ngoài khơi Niigata: đồng lúa chín, rừng thông trên núi, làng ven hồ và những con đường mòn quanh co.',
  seed: 'sado-01',
  radius: 40,
  waterOffset: -0.4,
  spawn: { lat: 4, lon: 6 },
  zones: [
    { type: 'rice', lat: 10, lon: 24, radius: 19 },
    { type: 'village', lat: -10, lon: 52, radius: 11 },
    { type: 'mountain', lat: 46, lon: -22, radius: 26, height: 8 },
    { type: 'mountain', lat: -52, lon: 140, radius: 24, height: 7 },
    { type: 'lake', lat: -24, lon: -38, radius: 15 },
    { type: 'lake', lat: 28, lon: 118, radius: 19 },
    { type: 'forest', lat: 68, lon: 100, radius: 30 },
    { type: 'forest', lat: -32, lon: 84, radius: 22 },
    { type: 'forest', lat: -70, lon: -60, radius: 25 },
  ],
  housesPerVillage: 7,
  landmarks: [
    { type: 'torii', lat: 27, lon: -4, yaw: 0.5 },
    { type: 'riceRack', lat: 14, lon: 14, yaw: 0.2 },
    { type: 'riceRack', lat: 4, lon: 30, yaw: 1.4 },
    { type: 'riceRack', lat: 20, lon: 34, yaw: -0.4 },
  ],
};
