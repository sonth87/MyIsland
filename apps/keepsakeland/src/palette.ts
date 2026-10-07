import { Color } from 'three';

/** Single source of truth for colors. Materials and vertex colors read from here. */
export const PALETTE = {
  sky: '#78c4b8',
  grass: '#7cbf55',
  grassDark: '#5c9f45',
  meadow: '#9ccf63',
  dirt: '#cdb98d',
  path: '#d9c79c',
  sand: '#ead9a6',
  rock: '#aaa59a',
  rockDark: '#8b877e',
  rice: '#e3c158',
  riceDark: '#cfa944',
  water: '#4cb3c4',
  trunk: '#6e4c3a',
  leaf: '#4f9a3f',
  leafLight: '#6cb84d',
  pine: '#3b7a48',
  pineLight: '#4f9256',
  bush: '#5ea84a',
  cloud: '#f6f4ec',
  wall: '#f0e7d3',
  wood: '#8a6446',
  roof: '#b4503b',
  roofAlt: '#4f6b8a',
  torii: '#d2452f',
  dark: '#2a2f38',
  skin: '#f2d3b8',
  hair: '#1f1f26',
  shirt: '#eef0ea',
  pants: '#2c3653',
  outline: '#1f2b2b',
  flowerRed: '#d8382c',
  flowerWhite: '#f4f1e8',
  flowerYellow: '#efc94a',
} as const;

export type PaletteKey = keyof typeof PALETTE;

const cache = new Map<PaletteKey, Color>();
/** Linear-space Color for a palette entry (shared instance, do not mutate). */
export function color(key: PaletteKey): Color {
  let c = cache.get(key);
  if (!c) cache.set(key, (c = new Color(PALETTE[key])));
  return c;
}
