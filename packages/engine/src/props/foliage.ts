import * as THREE from 'three';
import { envDepthMaterial, envMaterial, envNormalMaterial, type EnvOptions } from '../env/envShader';
import { createRng, type Rng } from '../world/rng';
import { merge, paint, SEASON_KIND, seasonKind, type SeasonKind } from './lowpoly';

/**
 * "Fluffy" foliage for the high detail levels: leaves, needles and grass are drawn as many
 * alpha-cut cards textured from one procedural atlas (painted on a canvas at runtime, so there
 * are still no asset files). Cards carry crown-shaped normals, so a canopy lights as one soft
 * volume instead of a pile of facets; the vertex colour tints the grey atlas (and the season
 * shader recolours it as usual).
 */

const SIZE = 1024;

export interface AtlasRegion {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const px = (x: number, y: number, w: number, h: number): AtlasRegion & { x: number; y: number; w: number; h: number } => ({
  x,
  y,
  w,
  h,
  // A small inset keeps the mipmaps of neighbouring cells apart.
  u0: (x + 3) / SIZE,
  u1: (x + w - 3) / SIZE,
  v0: 1 - (y + h - 3) / SIZE,
  v1: 1 - (y + 3) / SIZE,
});

/** Atlas cells (canvas pixels; flipY maps the top of the canvas to v = 1). */
export const ATLAS = {
  leaf: px(0, 0, 256, 256),
  blossom: px(256, 0, 256, 256),
  maple: px(512, 0, 256, 256),
  bamboo: px(768, 0, 256, 256),
  /** Fir spray: base on the left, tip on the right (2:1). */
  fir: px(0, 256, 512, 256),
  grass: px(512, 256, 256, 256),
  flowerTop: px(768, 256, 256, 256),
  /** Fern frond: base on the left (2:1). */
  fern: px(0, 512, 512, 256),
  bush: px(512, 512, 256, 256),
  flowerSide: px(768, 512, 256, 256),
  /** Fully opaque white: wood and other solid parts sample here. */
  solid: px(0, 768, 128, 128),
};

export type AtlasCell = (typeof ATLAS)[keyof typeof ATLAS];

// ---------------------------------------------------------------- atlas painting

const grey = (t: number, a = 1) => {
  const v = Math.round(Math.max(0, Math.min(1, t)) * 255);
  return `rgba(${v},${v},${v},${a})`;
};

type Ctx = CanvasRenderingContext2D;

/** A pointed leaf from (0,0) along +x, with a midrib and a lighter upper half. */
function leafShape(ctx: Ctx, x: number, y: number, len: number, wid: number, angle: number, tone: number, round = 0.45): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * round, -wid, len, 0);
  ctx.quadraticCurveTo(len * round, wid, 0, 0);
  ctx.fillStyle = grey(tone);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * round, -wid, len, 0);
  ctx.closePath();
  ctx.fillStyle = grey(Math.min(1, tone * 1.1));
  ctx.fill();
  ctx.strokeStyle = grey(tone * 0.72);
  ctx.lineWidth = Math.max(1, wid * 0.12);
  ctx.beginPath();
  ctx.moveTo(len * 0.04, 0);
  ctx.lineTo(len * 0.86, 0);
  ctx.stroke();
  ctx.restore();
}

function twig(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, tone: number): void {
  ctx.strokeStyle = grey(tone);
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** A round spray of leaves (birch-like): a few twigs from the centre, leaves pointing outwards. */
function paintLeafSpray(ctx: Ctx, c: AtlasCell, rng: Rng, o: { count: number; len: [number, number]; ratio: number; round: number }): void {
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const R = c.w / 2 - 10;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + rng() * 0.5;
    twig(ctx, cx, cy, cx + Math.cos(a) * R * 0.7, cy + Math.sin(a) * R * 0.7, 2.5, 0.45);
  }
  for (let i = 0; i < o.count; i++) {
    const r = Math.sqrt(rng()) * R * 0.78;
    const a = rng() * Math.PI * 2;
    const len = o.len[0] + rng() * (o.len[1] - o.len[0]);
    const reach = Math.min(len, R - r);
    if (reach < o.len[0] * 0.6) continue;
    const dir = a + (rng() - 0.5) * 1.2;
    leafShape(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, reach, reach * o.ratio, dir, 0.62 + rng() * 0.38, o.round);
  }
}

function paintBlossom(ctx: Ctx, c: AtlasCell, rng: Rng): void {
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const R = c.w / 2 - 14;
  for (let k = 0; k < 5; k++) {
    const a = rng() * Math.PI * 2;
    twig(ctx, cx, cy, cx + Math.cos(a) * R * 0.75, cy + Math.sin(a) * R * 0.75, 2.5, 0.6);
  }
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * R * 0.6;
    leafShape(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 24, 9, a, 0.7 + rng() * 0.1);
  }
  for (let i = 0; i < 34; i++) {
    const r = Math.sqrt(rng()) * (R - 12);
    const a = rng() * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const pr = 7 + rng() * 4;
    const tone = 0.86 + rng() * 0.14;
    const rot = rng() * Math.PI;
    for (let p = 0; p < 5; p++) {
      const pa = rot + (p / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(pa) * pr * 0.85, y + Math.sin(pa) * pr * 0.85, pr * 0.75, pr * 0.6, pa, 0, Math.PI * 2);
      ctx.fillStyle = grey(tone - (p % 2) * 0.05);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, pr * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = grey(0.72);
    ctx.fill();
  }
}

function paintMaple(ctx: Ctx, c: AtlasCell, rng: Rng): void {
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const R = c.w / 2 - 12;
  for (let i = 0; i < 18; i++) {
    const r = Math.sqrt(rng()) * (R - 26);
    const a = rng() * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const s = 20 + rng() * 9;
    const rot = a + Math.PI / 2 + (rng() - 0.5);
    ctx.beginPath();
    for (let k = 0; k <= 20; k++) {
      // Five pointed lobes (the lower two smaller), deep notches between them.
      const t = (k / 20) * Math.PI * 2;
      const lobe = k % 4 === 0 ? 1 : k % 2 === 0 ? 0.42 : 0.68;
      const low = Math.abs(Math.sin(t / 2)) < 0.35 ? 0.75 : 1;
      const rr = s * lobe * (k % 4 === 0 ? low : 1);
      const px2 = x + Math.cos(t + rot) * rr;
      const py2 = y + Math.sin(t + rot) * rr;
      if (k === 0) ctx.moveTo(px2, py2);
      else ctx.lineTo(px2, py2);
    }
    ctx.closePath();
    ctx.fillStyle = grey(0.62 + rng() * 0.38);
    ctx.fill();
    ctx.strokeStyle = grey(0.5);
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 5; k++) {
      const t = (k / 5) * Math.PI * 2 + rot;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(t) * s * 0.8, y + Math.sin(t) * s * 0.8);
      ctx.stroke();
    }
  }
}

/** A feathery fir spray: a stem with side shoots, everything densely covered in needles. */
function paintFir(ctx: Ctx, c: AtlasCell, rng: Rng): void {
  const y0 = c.y + c.h / 2;
  const x0 = c.x + 8;
  const L = c.w - 18;
  const halfW = (s: number) => (c.h / 2 - 10) * Math.pow(Math.sin(Math.min(1, (1 - s) * 1.15) * Math.PI * 0.5), 0.8) * (0.45 + 0.55 * Math.min(1, s * 4));
  const needle = (x: number, y: number, ang: number, len: number) => {
    ctx.strokeStyle = grey(0.55 + rng() * 0.45);
    ctx.lineWidth = 2.6 + rng() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  // Side shoots, alternating, angled towards the tip.
  for (let s = 0.04, side = 1; s < 0.9; s += 0.055, side = -side) {
    const bx = x0 + s * L;
    const w = halfW(s);
    const ang = side * (0.75 + rng() * 0.2);
    const len = w / Math.sin(Math.abs(ang)) * 0.95;
    const ex = bx + Math.cos(ang) * len;
    const ey = y0 + Math.sin(ang) * len;
    twig(ctx, bx, y0, ex, ey, 2, 0.4);
    for (let t = 0.05; t < 1; t += 0.06) {
      const nx = bx + (ex - bx) * t;
      const ny = y0 + (ey - y0) * t;
      const nl = 9 + (1 - t) * 10;
      needle(nx, ny, ang - 0.9, nl);
      needle(nx, ny, ang + 0.9, nl);
    }
  }
  twig(ctx, x0, y0, x0 + L, y0, 4, 0.38);
  for (let s = 0; s < 1; s += 0.012) {
    const nl = 10 + halfW(s) * 0.25;
    needle(x0 + s * L, y0, -0.7 - rng() * 0.4, nl);
    needle(x0 + s * L, y0, 0.7 + rng() * 0.4, nl);
  }
}

function paintFern(ctx: Ctx, c: AtlasCell, rng: Rng): void {
  const y0 = c.y + c.h / 2;
  const x0 = c.x + 8;
  const L = c.w - 18;
  twig(ctx, x0, y0, x0 + L, y0, 4, 0.45);
  for (let s = 0.06; s < 0.97; s += 0.045) {
    const w = (c.h / 2 - 12) * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.7);
    for (const side of [-1, 1]) {
      const ang = side * (1.15 - s * 0.35);
      const bx = x0 + s * L;
      // A pinna: a chain of rounded lobes getting smaller towards its tip.
      const n = Math.max(2, Math.round(w / 9));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const lx = bx + Math.cos(ang) * w * t;
        const ly = y0 + Math.sin(ang) * w * t;
        ctx.beginPath();
        ctx.ellipse(lx, ly, 6.5 * (1 - t * 0.5), 9.5 * (1 - t * 0.5), ang, 0, Math.PI * 2);
        ctx.fillStyle = grey(0.65 + rng() * 0.35);
        ctx.fill();
      }
    }
  }
}

function paintGrass(ctx: Ctx, c: AtlasCell, rng: Rng): void {
  const base = c.y + c.h - 6;
  for (let i = 0; i < 22; i++) {
    const bx = c.x + c.w * (0.2 + rng() * 0.6);
    const h = c.h * (0.5 + rng() * 0.45);
    const lean = (rng() - 0.5) * c.w * 0.55;
    const w = 5 + rng() * 5;
    const tx = Math.max(c.x + 8, Math.min(c.x + c.w - 8, bx + lean));
    const ty = base - h;
    const mx = bx + lean * 0.3;
    const my = base - h * 0.55;
    ctx.beginPath();
    ctx.moveTo(bx - w, base);
    ctx.quadraticCurveTo(mx - w * 0.6, my, tx, ty);
    ctx.quadraticCurveTo(mx + w * 0.6, my, bx + w, base);
    ctx.closePath();
    const tone = 0.62 + rng() * 0.38;
    ctx.fillStyle = grey(tone);
    ctx.fill();
    ctx.strokeStyle = grey(tone * 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, base);
    ctx.quadraticCurveTo(mx, my, tx, ty);
    ctx.stroke();
  }
}

/** A flower seen from above: petals around a darker centre. */
function paintFlowerTop(ctx: Ctx, c: AtlasCell, rng: Rng): void {
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const R = c.w / 2 - 12;
  for (const layer of [0, 1]) {
    const n = layer ? 7 : 9;
    for (let p = 0; p < n; p++) {
      const a = (p / n) * Math.PI * 2 + layer * 0.3 + (rng() - 0.5) * 0.15;
      const len = R * (layer ? 0.72 : 1);
      leafShape(ctx, cx, cy, len, len * 0.26, a, layer ? 0.98 : 0.86, 0.6);
    }
  }
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = grey(0.32);
  ctx.fill();
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * R * 0.18;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = grey(0.62);
    ctx.fill();
  }
}

/** A flower head from the side: a cup of petals opening upwards. */
function paintFlowerSide(ctx: Ctx, c: AtlasCell, rng: Rng): void {
  const cx = c.x + c.w / 2;
  const by = c.y + c.h * 0.78;
  const R = c.w * 0.42;
  for (let p = 0; p < 9; p++) {
    const a = -Math.PI / 2 + (p / 8 - 0.5) * 2.6 + (rng() - 0.5) * 0.1;
    leafShape(ctx, cx, by, R * (0.75 + 0.25 * Math.cos(a + Math.PI / 2)), R * 0.24, a, 0.84 + rng() * 0.16, 0.6);
  }
  ctx.beginPath();
  ctx.ellipse(cx, by, R * 0.2, R * 0.13, 0, 0, Math.PI * 2);
  ctx.fillStyle = grey(0.4);
  ctx.fill();
}

/**
 * Pixels of a level as uploadable data. Fully transparent pixels get a light grey instead of
 * black, so texture filtering doesn't draw a dark fringe around every leaf.
 */
function levelData(cv: HTMLCanvasElement, alphaBoost: number): ImageData {
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) {
      d[i] = d[i + 1] = d[i + 2] = 205;
    } else {
      d[i + 3] = Math.min(255, d[i + 3] * alphaBoost);
    }
  }
  return img;
}

/**
 * The full mipmap chain, level by level, boosting alpha in the smaller levels so thin leaves
 * don't fade out into nothing in the distance (alpha-tested foliage otherwise thins out fast).
 */
function coverageMipmaps(base: HTMLCanvasElement): ImageData[] {
  const levels: ImageData[] = [levelData(base, 1)];
  let prev = base;
  for (let size = SIZE / 2, k = 1; size >= 1; size /= 2, k++) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(prev, 0, 0, size, size);
    levels.push(levelData(cv, 1 + 0.32 * Math.min(k, 4)));
    prev = cv;
  }
  return levels;
}

let atlas: THREE.Texture | null = null;

/** The shared foliage atlas (painted on first use). */
export function foliageAtlas(): THREE.Texture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const rng = createRng('foliage-atlas');
  paintLeafSpray(ctx, ATLAS.leaf, rng, { count: 46, len: [30, 44], ratio: 0.36, round: 0.45 });
  paintBlossom(ctx, ATLAS.blossom, rng);
  paintMaple(ctx, ATLAS.maple, rng);
  paintLeafSpray(ctx, ATLAS.bamboo, rng, { count: 26, len: [60, 96], ratio: 0.13, round: 0.35 });
  paintFir(ctx, ATLAS.fir, rng);
  paintGrass(ctx, ATLAS.grass, rng);
  paintFlowerTop(ctx, ATLAS.flowerTop, rng);
  paintFern(ctx, ATLAS.fern, rng);
  paintLeafSpray(ctx, ATLAS.bush, rng, { count: 60, len: [22, 32], ratio: 0.5, round: 0.5 });
  paintFlowerSide(ctx, ATLAS.flowerSide, rng);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(ATLAS.solid.x, ATLAS.solid.y, ATLAS.solid.w, ATLAS.solid.h);

  const mipmaps = coverageMipmaps(canvas);
  const tex = new THREE.Texture(mipmaps[0]);
  tex.mipmaps = mipmaps;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  // Grey levels are used as plain multipliers of the vertex colour.
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  atlas = tex;
  return tex;
}

// ---------------------------------------------------------------- materials

export interface FoliageMaterials {
  material: THREE.MeshToonMaterial;
  depth: THREE.MeshDepthMaterial;
  outline: THREE.MeshNormalMaterial;
}

/** Colour, shadow and outline materials for alpha-cut foliage with the given environment options. */
export function foliageMaterials(options: EnvOptions = {}): FoliageMaterials {
  const map = foliageAtlas();
  const o = { ...options, foliage: true };
  return {
    material: envMaterial({ vertexColors: true, map, alphaTest: 0.5, side: THREE.DoubleSide }, o),
    depth: envDepthMaterial(o, { map, alphaTest: 0.5, side: THREE.DoubleSide }),
    outline: envNormalMaterial(o, map),
  };
}

// ---------------------------------------------------------------- geometry helpers

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** Gives a solid (painted, uv-less) part uvs in the opaque atlas cell, so it can share the foliage material. */
export function solidUv(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const uv = new Float32Array(n * 2);
  const u = (ATLAS.solid.u0 + ATLAS.solid.u1) / 2;
  const v = (ATLAS.solid.v0 + ATLAS.solid.v1) / 2;
  for (let i = 0; i < n; i++) {
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * A card w×h in its XY plane (u along +X, v along +Y), centred unless `fromLeft` (then the left
 * edge sits at the origin, for sprays that grow out of a branch). Non-indexed, uvs in `cell`.
 */
export function card(cell: AtlasRegion, w: number, h: number, segX = 1, fromLeft = false, flipU = false): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, segX, 1);
  if (fromLeft) g.translate(w / 2, 0, 0);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = flipU ? 1 - uv.getX(i) : uv.getX(i);
    uv.setXY(i, cell.u0 + u * (cell.u1 - cell.u0), cell.v0 + uv.getY(i) * (cell.v1 - cell.v0));
  }
  return g.toNonIndexed();
}

/** Orients a card so its face looks along `facing`, turned by `roll` around that direction. */
export function orientCard(g: THREE.BufferGeometry, facing: THREE.Vector3, roll: number, at: THREE.Vector3): THREE.BufferGeometry {
  _q.setFromUnitVectors(Z, _n.copy(facing).normalize());
  _q2.setFromAxisAngle(_n, roll);
  return g.applyQuaternion(_q2.multiply(_q)).translate(at.x, at.y, at.z);
}

/**
 * Colours and normals for a finished card, per vertex: `normal(p, out)` writes the normal and
 * `shade(p)` returns a brightness multiplier for `color`.
 */
export function shadeCard(
  g: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  normal: (p: THREE.Vector3, out: THREE.Vector3) => void,
  shade: (p: THREE.Vector3) => number,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const base = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    _v.fromBufferAttribute(pos, i);
    normal(_v, _n);
    _n.normalize().toArray(normals, i * 3);
    _c.copy(base).multiplyScalar(shade(_v)).toArray(colors, i * 3);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

export function randomUnit(rng: Rng, out = new THREE.Vector3()): THREE.Vector3 {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}

export interface ClusterOptions {
  center: THREE.Vector3;
  radius: number;
  cards: number;
  size: number;
  cell: AtlasRegion;
  colors: string[];
  /** The whole crown, for shading (inner leaves darker) and the shared normal field. */
  crown: { center: THREE.Vector3; radius: number };
  kind: SeasonKind;
  /** Vertical squash of the cluster (1 = round). */
  squash?: number;
  /** Colour for the leaves on top of the crown (lighter, e.g. sun-bleached blossoms). */
  topColor?: string;
  /** How much darker the leaves deep inside the crown are (0..1). */
  depthShade?: number;
}

/**
 * A ball of leaf cards. Normals blend the direction from the crown centre with the direction
 * from the cluster centre, so the crown reads as a soft volume with lumps; leaves inside the
 * crown are darker, the ones on top a little lighter.
 */
export function leafCluster(out: THREE.BufferGeometry[], rng: Rng, o: ClusterOptions): void {
  const squash = o.squash ?? 0.85;
  const ds = o.depthShade ?? 0.55;
  const dir = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  for (let i = 0; i < o.cards; i++) {
    randomUnit(rng, dir);
    dir.y = dir.y * squash + 0.12;
    p.copy(o.center).addScaledVector(dir, o.radius * (0.3 + 0.7 * Math.sqrt(rng())));
    facing.copy(dir).multiplyScalar(0.7).add(randomUnit(rng, tmp)).normalize();
    const s = o.size * (0.75 + rng() * 0.5);
    const g = orientCard(card(o.cell, s, s, 1, false, rng() < 0.5), facing, rng() * Math.PI * 2, p);
    const top = o.topColor && p.y > o.crown.center.y + o.crown.radius * 0.25 && rng() < 0.7;
    const color = top ? o.topColor! : o.colors[Math.floor(rng() * o.colors.length)];
    const tone = 0.9 + rng() * 0.2;
    const cc = o.crown.center;
    const cr = o.crown.radius;
    const lc = o.center;
    const lr = o.radius;
    shadeCard(
      g,
      color,
      (v, n) => n.set((v.x - cc.x) / cr + ((v.x - lc.x) / lr) * 0.55, (v.y - cc.y) / cr + ((v.y - lc.y) / lr) * 0.55 + 0.15, (v.z - cc.z) / cr + ((v.z - lc.z) / lr) * 0.55),
      (v) => {
        const d = Math.min(1, v.distanceTo(cc) / cr);
        return tone * (1.05 - ds + ds * d + 0.12 * Math.max(-1, Math.min(1, (v.y - cc.y) / cr)));
      },
    );
    out.push(seasonKind(g, o.kind, lc));
  }
}

/**
 * A spray card for conifers and ferns: a strip from the origin along +X (`segs` segments) that
 * starts horizontal (face up) and droops quadratically, then is rolled around its own axis.
 */
export function sprayCard(cell: AtlasRegion, length: number, width: number, segs: number, droop: number, roll: number): THREE.BufferGeometry {
  const g = card(cell, length, width, segs, true).rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getX(i) / length;
    pos.setY(i, pos.getY(i) - droop * t * t * length);
  }
  return g.rotateX(roll);
}

/** Turns a spray built along +X so it points along azimuth `az`, pitched up by `pitch`. */
export function aimSpray(g: THREE.BufferGeometry, az: number, pitch: number, at: THREE.Vector3): THREE.BufferGeometry {
  return g.rotateZ(pitch).rotateY(-az).translate(at.x, at.y, at.z);
}

// ---------------------------------------------------------------- ground plants

/** A clump of grass blades: crossed cards whose normals lean up, darker at the roots. */
export function grassClump(color: THREE.ColorRepresentation, height = 0.6, rng: Rng = createRng('grass-clump')): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 4;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI + rng() * 0.4;
    const h = height * (0.75 + rng() * 0.35);
    const w = height * (0.9 + rng() * 0.3);
    const off = new THREE.Vector3((rng() - 0.5) * 0.12, h / 2, (rng() - 0.5) * 0.12);
    const g = card(ATLAS.grass, w, h, 1, false, rng() < 0.5).rotateY(az).translate(off.x, off.y, off.z);
    shadeCard(
      g,
      color,
      (v, nn) => nn.set(v.x * 0.6, 1, v.z * 0.6),
      (v) => 0.55 + 0.55 * Math.min(1, v.y / height),
    );
    parts.push(g);
  }
  return merge(parts);
}

/**
 * A small flowering plant: green stems and leaves (`stems`, shown all year except winter) and
 * flower heads (`heads`, white so an instance colour tints them; bloom from spring to autumn).
 * Both share the same origin, so the same instance matrices place them together.
 */
export function flowerPlant(stemColor: THREE.ColorRepresentation, rng: Rng = createRng('flower-plant')): { stems: THREE.BufferGeometry; heads: THREE.BufferGeometry } {
  const stems: THREE.BufferGeometry[] = [];
  const heads: THREE.BufferGeometry[] = [];
  const count = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = 0.04 + rng() * 0.16;
    const h = 0.3 + rng() * 0.22;
    const base = new THREE.Vector3(Math.cos(a) * r * 0.4, 0, Math.sin(a) * r * 0.4);
    const top = new THREE.Vector3(Math.cos(a) * r, h, Math.sin(a) * r);
    const stem = new THREE.CylinderGeometry(0.008, 0.012, h, 3).translate(0, h / 2, 0);
    _q.setFromUnitVectors(UP, _v.subVectors(top, base).normalize());
    stems.push(solidUv(paint(stem.applyQuaternion(_q).translate(base.x, 0, base.z), stemColor)));
    const s = 0.11 + rng() * 0.05;
    const tilt = 0.25 + rng() * 0.35;
    const topCard = card(ATLAS.flowerTop, s, s).rotateX(-Math.PI / 2 + tilt).rotateY(a).translate(top.x, top.y + 0.01, top.z);
    const side1 = card(ATLAS.flowerSide, s, s).translate(0, s * 0.25, 0).rotateY(a).translate(top.x, top.y, top.z);
    const side2 = card(ATLAS.flowerSide, s, s).translate(0, s * 0.25, 0).rotateY(a + Math.PI / 2).translate(top.x, top.y, top.z);
    for (const g of [topCard, side1, side2]) {
      heads.push(shadeCard(g, '#ffffff', (_p, nn) => nn.set(0, 1, 0), () => 1));
    }
  }
  // A rosette of leaves at the foot.
  for (let i = 0; i < 4; i++) {
    const az = (i / 4) * Math.PI * 2 + rng();
    const g = aimSpray(sprayCard(ATLAS.grass, 0.22, 0.2, 2, 0.4, 0), az, 0.9, new THREE.Vector3());
    stems.push(shadeCard(g, stemColor, (v, nn) => nn.set(v.x, 1, v.z), (v) => 0.7 + v.y * 1.5));
  }
  return {
    stems: seasonKind(merge(stems), SEASON_KIND.tuft),
    heads: seasonKind(merge(heads), SEASON_KIND.flower),
  };
}

/** A leafy bush: a few overlapping balls of leaf cards resting on the ground. */
export function fluffyBush(color: THREE.ColorRepresentation, rng: Rng = createRng('bush')): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hex = `#${new THREE.Color(color).getHexString()}`;
  const crown = { center: new THREE.Vector3(0, 0.3, 0), radius: 0.62 };
  const balls = [
    { c: new THREE.Vector3(0, 0.34, 0), r: 0.42 },
    { c: new THREE.Vector3(0.3, 0.26, 0.1), r: 0.32 },
    { c: new THREE.Vector3(-0.22, 0.24, -0.2), r: 0.3 },
  ];
  for (const b of balls) {
    leafCluster(parts, rng, { center: b.c, radius: b.r, cards: 16, size: 0.42, cell: ATLAS.bush, colors: [hex], crown, kind: SEASON_KIND.ground, squash: 0.8 });
  }
  return merge(parts);
}

/** A fern: arching fronds from one crown, lying lower towards the outside. */
export function fernClump(color: THREE.ColorRepresentation, rng: Rng = createRng('fern')): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 7 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const len = 0.55 + rng() * 0.3;
    const g = aimSpray(sprayCard(ATLAS.fern, len, len * 0.5, 4, 0.7 + rng() * 0.3, (rng() - 0.5) * 0.5), az, 0.75 + rng() * 0.35, new THREE.Vector3(0, 0.03, 0));
    shadeCard(
      g,
      color,
      (v, nn) => nn.set(v.x * 0.5, 1, v.z * 0.5),
      (v) => 0.6 + 0.5 * Math.min(1, Math.hypot(v.x, v.z) / len),
    );
    parts.push(g);
  }
  return seasonKind(merge(parts), SEASON_KIND.tuft);
}
