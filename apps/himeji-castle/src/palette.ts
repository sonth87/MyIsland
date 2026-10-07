import { Color } from 'three';

/** Himeji Castle colors (sRGB hex). Japanese countryside in spring. */
export const PALETTE = {
  grass: '#86c45a',
  grassDark: '#65a648',
  meadow: '#a6d468',
  forestFloor: '#5d9a45',
  sand: '#e8d6a0',
  dirt: '#cdb488',
  path: '#dccaa0',
  rock: '#a39d90',
  rockDark: '#857f74',
  snowcap: '#eef1f2',
  water: '#4aa6c9',
  ballast: '#8c8680',
  sleeper: '#5a4434',
  rail: '#4b4f57',
  paddy: '#9cc96a',
  paddyWater: '#7fb7a8',
  paddyGold: '#e1bf55',
  trunk: '#6b4a37',
  leaf: '#4f9a3f',
  leafLight: '#6cba4b',
  pine: '#2f7448',
  pineLight: '#3f8c55',
  maple: '#d4553a',
  mapleLight: '#e97d45',
  sakura: '#f4b6c8',
  sakuraLight: '#fbd3df',
  sakuraTrunk: '#5e4038',
  petalGround: '#d9c6b0',
  bush: '#5ca54a',
  plaster: '#f3eee2',
  woodDark: '#4f3628',
  wood: '#8a6446',
  tile: '#4a5260',
  tileGreen: '#5e7470',
  vermilion: '#d24a32',
  stone: '#b9b2a4',
  stoneDark: '#8e877a',
  bridgeRed: '#c2412f',
  pier: '#9a948a',
  cloud: '#f7f5ee',
  outline: '#22302a',
} as const;

export type PaletteKey = keyof typeof PALETTE;

const cache = new Map<PaletteKey, Color>();
export function color(key: PaletteKey): Color {
  let c = cache.get(key);
  if (!c) cache.set(key, (c = new Color(PALETTE[key])));
  return c;
}
