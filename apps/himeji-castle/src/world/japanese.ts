import * as THREE from 'three';
import { lowpoly, q, type Rng } from '@g2/engine';
import { PALETTE } from '../palette';
import { japaneseRoof } from './roofs';

/**
 * Procedural Japanese buildings. Every builder returns painted, non-indexed geometry in local
 * space (origin at ground level, +Z = front) split into `solid` and `glow` (paper windows and
 * lantern lights that light up at night).
 */
export interface Parts {
  solid: THREE.BufferGeometry[];
  glow: THREE.BufferGeometry[];
}

const { paint } = lowpoly;

export function box(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  return paint(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), color);
}

/** Gable roof: ridge along X. */
export function gableRoof(width: number, depth: number, height: number, color: string, y: number, z = 0): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-depth / 2, 0);
  s.lineTo(depth / 2, 0);
  s.lineTo(0, height);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
  g.translate(0, 0, -width / 2).rotateY(Math.PI / 2).translate(0, y, z);
  return paint(g, color);
}

/** Hipped (four-sided) roof with a square-ish base `width` × `depth`. */
export function hipRoof(width: number, depth: number, height: number, color: string, y: number): THREE.BufferGeometry {
  return paint(
    new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).scale(width, height, depth).translate(0, y + height / 2, 0),
    color,
  );
}

const ROOF_TILES = ['#4a5260', '#55606e', '#5e6b66', '#6b5a52', '#4f5a6b'];

export function machiya(rng: Rng): Parts {
  const roofColor = ROOF_TILES[Math.floor(rng() * ROOF_TILES.length)];
  const w = 5.5 + rng() * 2;
  const d = 6 + rng() * 2;
  const two = rng() < 0.45;
  const solid: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  solid.push(box(w + 0.3, 0.35, d + 0.3, PALETTE.stoneDark));
  // Ground floor: dark wood lattice front, plaster sides.
  solid.push(box(w, 2.4, d, PALETTE.plaster, 0, 0.35));
  solid.push(box(w + 0.02, 1.3, d + 0.02, PALETTE.woodDark, 0, 0.35));
  for (let x = -w / 2 + 0.4; x < w / 2; x += 0.45) solid.push(box(0.08, 1.9, 0.1, PALETTE.woodDark, x, 0.45, d / 2 + 0.03));
  glow.push(box(w * 0.55, 0.9, 0.06, PALETTE.plaster, -w * 0.12, 1.35, d / 2 + 0.01));
  solid.push(box(1.2, 1.9, 0.08, PALETTE.wood, w * 0.32, 0.35, d / 2 + 0.03));
  // Small front eave (hisashi).
  solid.push(gableRoof(w + 0.6, 1.4, 0.35, PALETTE.tile, 2.75, d / 2 + 0.35));
  let top = 2.75;
  if (two) {
    solid.push(box(w * 0.92, 1.7, d * 0.9, PALETTE.plaster, 0, 2.75));
    glow.push(box(w * 0.4, 0.6, 0.06, PALETTE.plaster, 0, 3.3, (d * 0.9) / 2 + 0.01));
    for (const x of [-w * 0.46, w * 0.46]) solid.push(box(0.15, 1.7, d * 0.9, PALETTE.woodDark, x, 2.75));
    top = 4.45;
  }
  solid.push(japaneseRoof({ width: w, depth: d, height: 1.7, overhang: 0.7, color: roofColor, trim: PALETTE.woodDark, under: '#5a4434', lift: 0.18, y: top }));
  if (q(0, 0, 1, 1)) {
    // Noren curtain over the door, a rain barrel, potted plants and a hanging sign.
    solid.push(box(1.1, 0.55, 0.04, ['#2f4a6b', '#7a3b55', '#3f6e5a'][Math.floor(w * 10) % 3], w * 0.32, 1.65, d / 2 + 0.12));
    solid.push(paint(new THREE.CylinderGeometry(0.28, 0.25, 0.6, 10).translate(-w / 2 + 0.4, 0.65, d / 2 + 0.45), PALETTE.wood));
    for (const k of [0, 1]) {
      solid.push(paint(new THREE.CylinderGeometry(0.16, 0.12, 0.25, 8).translate(-w * 0.1 + k * 0.45, 0.47, d / 2 + 0.35), '#9a5a3c'));
      solid.push(paint(new THREE.IcosahedronGeometry(0.22, 0).translate(-w * 0.1 + k * 0.45, 0.75, d / 2 + 0.35), PALETTE.bush));
    }
    solid.push(box(0.12, 0.9, 0.5, PALETTE.wood, w / 2 - 0.3, 1.8, d / 2 + 0.35));
  }
  return { solid, glow };
}

export function pagoda(): Parts {
  const solid: THREE.BufferGeometry[] = [box(7.6, 0.9, 7.6, PALETTE.stone)];
  const glow: THREE.BufferGeometry[] = [];
  let y = 0.9;
  for (let i = 0; i < 5; i++) {
    const s = 5.0 - i * 0.5;
    const h = i === 0 ? 2.5 : 1.7;
    solid.push(box(s, h, s, PALETTE.vermilion, 0, y));
    solid.push(box(s * 0.62, h * 0.6, s + 0.04, PALETTE.plaster, 0, y + h * 0.18));
    solid.push(box(s + 0.04, h * 0.6, s * 0.62, PALETTE.plaster, 0, y + h * 0.18));
    if (i === 0) glow.push(box(1.4, 1.5, s + 0.06, PALETTE.plaster, 0, y + 0.2));
    y += h;
    solid.push(
      japaneseRoof({ width: s, depth: s, height: 0.9, overhang: 1.5 - i * 0.08, color: PALETTE.tile, trim: PALETTE.woodDark, under: '#7a3a2c', lift: 0.45, y }),
    );
    y += 0.5;
  }
  solid.push(paint(new THREE.CylinderGeometry(0.1, 0.16, 4.4, 6).translate(0, y + 2.2, 0), '#5f6670'));
  for (let k = 0; k < 7; k++) {
    solid.push(paint(new THREE.TorusGeometry(0.34 - k * 0.02, 0.06, 4, 10).rotateX(Math.PI / 2).translate(0, y + 0.7 + k * 0.45, 0), '#5f6670'));
  }
  return { solid, glow };
}

/** Torii with a kasagi (top beam) whose ends sweep upwards. */
export function torii(scale = 1): Parts {
  const v = PALETTE.vermilion;
  const solid = [
    paint(new THREE.CylinderGeometry(0.22, 0.27, 4.4, 10).translate(-1.9, 2.2, 0), v),
    paint(new THREE.CylinderGeometry(0.22, 0.27, 4.4, 10).translate(1.9, 2.2, 0), v),
    paint(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 10).translate(-1.9, 0.25, 0), '#2a2a2a'),
    paint(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 10).translate(1.9, 0.25, 0), '#2a2a2a'),
    box(4.8, 0.26, 0.3, v, 0, 3.55),
    box(0.3, 0.75, 0.22, v, 0, 3.8),
  ];
  // Kasagi: segmented beam rising towards its tips, black cap on top.
  const seg = 8;
  for (let i = 0; i < seg; i++) {
    const x0 = -3.1 + (6.2 * i) / seg;
    const x1 = -3.1 + (6.2 * (i + 1)) / seg;
    const y0 = 4.35 + 0.06 * ((x0 / 3.1) ** 4) * 6;
    const y1 = 4.35 + 0.06 * ((x1 / 3.1) ** 4) * 6;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    solid.push(paint(new THREE.BoxGeometry(len + 0.02, 0.34, 0.5).rotateZ(ang).translate((x0 + x1) / 2, (y0 + y1) / 2, 0), v));
    solid.push(paint(new THREE.BoxGeometry(len + 0.02, 0.16, 0.6).rotateZ(ang).translate((x0 + x1) / 2, (y0 + y1) / 2 + 0.24, 0), '#25262b'));
  }
  if (scale !== 1) for (const g of solid) g.scale(scale, scale, scale);
  return { solid, glow: [] };
}

export function shrine(): Parts {
  const solid: THREE.BufferGeometry[] = [box(9, 1, 8, PALETTE.stone)];
  for (const x of [-3, -1, 1, 3]) for (const z of [-2.6, 2.6]) {
    solid.push(paint(new THREE.CylinderGeometry(0.16, 0.16, 3, 8).translate(x, 2.5, z), PALETTE.vermilion));
  }
  solid.push(box(6.2, 2.6, 4.2, PALETTE.wood, 0, 1));
  solid.push(box(6.8, 0.3, 6, PALETTE.woodDark, 0, 3.9));
  solid.push(japaneseRoof({ width: 7, depth: 6, height: 2.6, overhang: 1.6, color: PALETTE.tileGreen, trim: PALETTE.woodDark, lift: 0.45, gable: PALETTE.woodDark, y: 4.2 }));
  for (let k = 0; k < 4; k++) solid.push(box(0.9, 0.5, 0.5, PALETTE.wood, -1.6 + k * 1.05, 1, 4.2));
  const glow = [box(2.4, 1.4, 0.06, PALETTE.plaster, 0, 1.6, 2.12)];
  return { solid, glow };
}

/**
 * Tea house: raised on a wooden deck with a railing, timber frame with shoji panels
 * (paper with a dark lattice) that glow at night, and a dark hipped roof with deep eaves.
 */
export function teaHouse(rng: Rng): Parts {
  const w = 6 + rng() * 2;
  const d = 5 + rng() * 1.5;
  const solid: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const deck = 0.7;
  // Stilts and deck (engawa) wider than the room.
  for (const x of [-w / 2 - 0.6, 0, w / 2 + 0.6]) for (const z of [-d / 2 - 0.6, d / 2 + 0.6]) solid.push(box(0.22, deck, 0.22, PALETTE.woodDark, x, 0, z));
  solid.push(box(w + 1.6, 0.18, d + 1.6, PALETTE.wood, 0, deck));
  // Railing on three sides of the deck.
  for (const [len, x, z, rot] of [
    [w + 1.6, 0, -d / 2 - 0.75, false],
    [d + 1.6, -w / 2 - 0.75, 0, true],
    [d + 1.6, w / 2 + 0.75, 0, true],
  ] as const) {
    const rail = new THREE.BoxGeometry(rot ? 0.08 : len, 0.08, rot ? len : 0.08).translate(x, deck + 0.75, z);
    solid.push(paint(rail, PALETTE.woodDark));
    const posts = Math.round(len / 0.9);
    for (let i = 0; i <= posts; i++) {
      const o = -len / 2 + (len * i) / posts;
      solid.push(box(0.07, 0.75, 0.07, PALETTE.woodDark, rot ? x : o, deck + 0.05, rot ? o : z));
    }
  }
  // Steps at the front.
  for (let k = 0; k < 3; k++) solid.push(box(1.6, 0.22, 0.45, PALETTE.stoneDark, 0, k * 0.22, d / 2 + 1.2 - k * 0.4));
  // Walls: timber posts with shoji panels between them.
  const wallH = 2.4;
  const y0 = deck + 0.18;
  solid.push(box(w, 0.3, d, PALETTE.woodDark, 0, y0));
  for (const [len, axis, off] of [
    [w, 'x', d / 2],
    [w, 'x', -d / 2],
    [d, 'z', w / 2],
    [d, 'z', -w / 2],
  ] as const) {
    const panels = Math.max(2, Math.round(len / 1.1));
    for (let i = 0; i <= panels; i++) {
      const o = -len / 2 + (len * i) / panels;
      solid.push(axis === 'x' ? box(0.14, wallH, 0.14, '#5a3626', o, y0, off) : box(0.14, wallH, 0.14, '#5a3626', off, y0, o));
    }
    // Paper panels (glow) with a lattice grid on top.
    const paper = axis === 'x' ? new THREE.BoxGeometry(len, wallH - 0.4, 0.05) : new THREE.BoxGeometry(0.05, wallH - 0.4, len);
    glow.push(paint(paper.translate(axis === 'x' ? 0 : off, y0 + 0.3 + (wallH - 0.4) / 2, axis === 'x' ? off : 0), PALETTE.plaster));
    for (let r = 1; r < 4; r++) {
      const ly = y0 + 0.3 + ((wallH - 0.4) * r) / 4;
      const bar = axis === 'x' ? new THREE.BoxGeometry(len, 0.04, 0.09) : new THREE.BoxGeometry(0.09, 0.04, len);
      solid.push(paint(bar.translate(axis === 'x' ? 0 : off, ly, axis === 'x' ? off : 0), '#5a3626'));
    }
    for (let i = 0; i < panels * 2; i++) {
      const o = -len / 2 + (len * (i + 0.5)) / (panels * 2);
      const bar = axis === 'x' ? new THREE.BoxGeometry(0.04, wallH - 0.4, 0.09) : new THREE.BoxGeometry(0.09, wallH - 0.4, 0.04);
      solid.push(paint(bar.translate(axis === 'x' ? o : off, y0 + 0.3 + (wallH - 0.4) / 2, axis === 'x' ? off : o), '#5a3626'));
    }
  }
  solid.push(box(w + 0.2, 0.25, d + 0.2, PALETTE.woodDark, 0, y0 + wallH));
  solid.push(japaneseRoof({ width: w, depth: d, height: 1.9, overhang: 1.7, color: '#3f4650', trim: '#2c2f35', under: '#6b4a37', lift: 0.3, y: y0 + wallH + 0.25 }));
  return { solid, glow };
}

/** Minka farmhouse with a thick thatched roof. */
export function minka(rng: Rng): Parts {
  const w = 8 + rng() * 2;
  const d = 6 + rng() * 1.5;
  const solid: THREE.BufferGeometry[] = [box(w + 0.4, 0.4, d + 0.4, PALETTE.stoneDark)];
  solid.push(box(w, 2.4, d, PALETTE.plaster, 0, 0.4));
  for (const x of [-w / 2, -w / 6, w / 6, w / 2]) solid.push(box(0.2, 2.4, 0.2, PALETTE.woodDark, x, 0.4, d / 2));
  solid.push(box(w + 0.02, 0.18, d + 0.02, PALETTE.woodDark, 0, 1.4));
  solid.push(box(1.5, 1.9, 0.08, PALETTE.wood, w / 4, 0.4, d / 2 + 0.03));
  const glow = [box(w * 0.3, 0.8, 0.06, PALETTE.plaster, -w / 5, 1.4, d / 2 + 0.01)];
  solid.push(japaneseRoof({ width: w, depth: d, height: 3.4, overhang: 0.9, color: '#b49663', trim: '#8a7046', under: '#6b5638', lift: 0.05, gable: '#5a4432', y: 2.8 }));
  return { solid, glow };
}

/** Flat stepping stone. */
export function steppingStone(rng: Rng): THREE.BufferGeometry {
  return paint(new THREE.CylinderGeometry(0.45 + rng() * 0.2, 0.5 + rng() * 0.2, 0.18, 7).scale(1, 1, 0.8 + rng() * 0.3).translate(0, 0.05, 0), PALETTE.stone);
}

/** Stone tōrō lantern; the firebox glows at night. Light sits at y≈1.3. */
export function lantern(): Parts {
  const stone = PALETTE.stone;
  const solid = [
    paint(new THREE.CylinderGeometry(0.42, 0.48, 0.18, 6).translate(0, 0.09, 0), stone),
    paint(new THREE.CylinderGeometry(0.13, 0.16, 0.85, 6).translate(0, 0.6, 0), stone),
    paint(new THREE.CylinderGeometry(0.36, 0.3, 0.12, 6).translate(0, 1.08, 0), stone),
    paint(new THREE.ConeGeometry(0.55, 0.38, 6).translate(0, 1.7, 0), PALETTE.stoneDark),
    paint(new THREE.IcosahedronGeometry(0.09, 0).translate(0, 1.93, 0), PALETTE.stoneDark),
  ];
  const glow = [paint(new THREE.CylinderGeometry(0.25, 0.25, 0.42, 6).translate(0, 1.35, 0), PALETTE.plaster)];
  return { solid, glow };
}

/** Station platform along +Z (length `len`), canopy and a bench. Track runs along -X side. */
export function station(len: number): Parts {
  // Platform top at y = 0.35, edge (with a yellow safety line) on the track side (-X).
  const solid: THREE.BufferGeometry[] = [box(4.2, 0.9, len, PALETTE.stone, 0, -0.55)];
  solid.push(box(0.18, 0.02, len, '#e8c34a', -1.75, 0.35));
  for (let z = -len / 2 + 3; z <= len / 2 - 3; z += 6) {
    solid.push(box(0.2, 3, 0.2, PALETTE.woodDark, 0.8, 0.35, z));
  }
  // Canopy ridge runs along the platform (+Z).
  solid.push(gableRoof(len * 0.7, 4.6, 1.0, PALETTE.tile, 3.35).rotateY(Math.PI / 2).translate(0.3, 0, 0));
  solid.push(box(1.8, 0.45, 0.45, PALETTE.wood, 1.2, 0.35, 2));
  solid.push(box(0.12, 1.2, 1.6, PALETTE.woodDark, 1.7, 1.7, -4));
  solid.push(box(0.08, 0.6, 1.4, PALETTE.plaster, 1.64, 2.1, -4));
  const glow = [box(0.4, 0.4, 0.4, PALETTE.plaster, 0.8, 2.9, -len / 4), box(0.4, 0.4, 0.4, PALETTE.plaster, 0.8, 2.9, len / 4)];
  return { solid, glow };
}

/** Taiko-bashi: arched vermilion footbridge spanning `len` along local X. */
export function footbridge(len: number, rise: number): Parts {
  const solid: THREE.BufferGeometry[] = [];
  const seg = 18;
  const arc = (t: number) => Math.sin(t * Math.PI) * rise;
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg;
    const t1 = (i + 1) / seg;
    const x0 = (t0 - 0.5) * len;
    const x1 = (t1 - 0.5) * len;
    const y0 = arc(t0);
    const y1 = arc(t1);
    const l = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const deck = new THREE.BoxGeometry(l + 0.05, 0.22, 2.4).rotateZ(ang).translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
    solid.push(paint(deck, PALETTE.wood));
    for (const z of [-1.15, 1.15]) {
      const rail = new THREE.BoxGeometry(l + 0.05, 0.12, 0.12).rotateZ(ang).translate((x0 + x1) / 2, (y0 + y1) / 2 + 0.95, z);
      solid.push(paint(rail, PALETTE.vermilion));
      if (i % 3 === 0) {
        solid.push(paint(new THREE.BoxGeometry(0.16, 1.0, 0.16).translate(x0, y0 + 0.5, z), PALETTE.vermilion));
      }
    }
  }
  for (const x of [-len * 0.3, len * 0.3]) {
    for (const z of [-0.9, 0.9]) {
      solid.push(paint(new THREE.CylinderGeometry(0.18, 0.2, 4, 6).translate(x, arc(x / len + 0.5) - 2, z), PALETTE.vermilion));
    }
  }
  return { solid, glow: [] };
}
