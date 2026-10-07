import * as THREE from 'three';
import { lowpoly, q } from '@g2/engine';

const { paint } = lowpoly;

export interface RoofOptions {
  /** Footprint of the walls under the roof. */
  width: number;
  depth: number;
  /** Ridge height above the eaves. */
  height: number;
  overhang: number;
  /** Tile colour and fascia (eave edge) colour. */
  color: string;
  trim: string;
  /** Soffit (underside) colour. */
  under?: string;
  /** How much the corners turn up. */
  lift?: number;
  /** Irimoya: vertical triangular gables at the ridge ends. */
  gable?: string;
  /** Base height. */
  y?: number;
}

const _c = new THREE.Color();

/** Builds non-indexed triangles with one flat colour per triangle. */
class TriBuilder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: string, shade = 1): void {
    _c.set(color).multiplyScalar(shade);
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      this.col.push(_c.r, _c.g, _c.b);
    }
  }
  /** Quad a-b-c-d; callers list the corners clockwise as seen from the visible side. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: string, shade = 1): void {
    this.tri(a, c, b, color, shade);
    this.tri(a, d, c, color, shade);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

/** Points around a rectangle (counter-clockwise seen from above), `per` per edge, with a corner weight. */
function perimeter(hx: number, hz: number, per: number): Array<{ x: number; z: number; corner: number }> {
  const corners = [
    [hx, hz],
    [-hx, hz],
    [-hx, -hz],
    [hx, -hz],
  ];
  const out: Array<{ x: number; z: number; corner: number }> = [];
  for (let e = 0; e < 4; e++) {
    const [x0, z0] = corners[e];
    const [x1, z1] = corners[(e + 1) % 4];
    for (let k = 0; k < per; k++) {
      const s = k / per;
      out.push({ x: x0 + (x1 - x0) * s, z: z0 + (z1 - z0) * s, corner: Math.max(1 - s, s) ** 8 });
    }
  }
  return out;
}

/**
 * Japanese hipped roof: concave slopes (gentle at the eaves, steep near the ridge), corners
 * that turn up, alternating tile rows, a fascia band, an underside and an optional irimoya gable.
 */
export function japaneseRoof(o: RoofOptions): THREE.BufferGeometry {
  const tb = new TriBuilder();
  const y0 = o.y ?? 0;
  const W = o.width / 2 + o.overhang;
  const D = o.depth / 2 + o.overhang;
  const alongX = W >= D;
  const ridgeX = alongX ? W - D + 0.05 : 0.05;
  const ridgeZ = alongX ? 0.05 : D - W + 0.05;
  // Smoother curve and more tile columns at higher quality.
  const rings = q(4, 6, 9, 12);
  const per = q(3, 4, 12, 18);
  const lift = o.lift ?? 0.3;
  const ring = (t: number) =>
    perimeter(THREE.MathUtils.lerp(W, ridgeX, t), THREE.MathUtils.lerp(D, ridgeZ, t), per).map(
      (p) => new THREE.Vector3(p.x, y0 + o.height * t ** 1.7 + lift * (1 - t) ** 2 * p.corner, p.z),
    );
  const all: THREE.Vector3[][] = [];
  for (let r = 0; r <= rings; r++) all.push(ring(r / rings));
  const n = all[0].length;
  // Tile courses: at higher quality each column alternates shade, which reads as rows of
  // round tiles without adding geometry (and without ink-outline noise).
  const striped = q(0, 0, 1, 1) === 1;
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const shade = striped ? (i % 2 ? 0.74 : 1) * (r % 2 ? 0.95 : 1) : r % 2 ? 0.9 : 1;
      tb.quad(all[r][i], all[r][j], all[r + 1][j], all[r + 1][i], o.color, shade);
    }
  }
  const parts0: THREE.BufferGeometry[] = [];
  // Fascia: a band hanging down from the eave edge.
  const lowRing = all[0].map((p) => p.clone().add(new THREE.Vector3(0, -0.22, 0)));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tb.quad(lowRing[i], lowRing[j], all[0][j], all[0][i], o.trim);
  }
  // Underside: from the fascia back to the wall line.
  const inner = perimeter(o.width / 2, o.depth / 2, per).map((p) => new THREE.Vector3(p.x, y0 - 0.22, p.z));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tb.quad(inner[i], inner[j], lowRing[j], lowRing[i], o.under ?? '#3b3a38');
  }
  // Hip ridges: a raised cap along the four corner lines (where the slopes meet).
  if (q(0, 0, 1, 1)) {
    for (let i = 0; i < n; i += per) {
      for (let r = 0; r < rings; r++) {
        const a = all[r][i];
        const b = all[r + 1][i];
        const len = a.distanceTo(b);
        const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
        parts0.push(paint(new THREE.BoxGeometry(0.14, 0.09, len + 0.02).translate(0, 0.03, -len / 2).applyMatrix4(m).translate(a.x, a.y, a.z), o.color));
      }
    }
  }
  // Ridge cap.
  const top = all[rings];
  const rLen = alongX ? ridgeX : ridgeZ;
  const ridge = new THREE.BoxGeometry(alongX ? rLen * 2 + 0.4 : 0.32, 0.28, alongX ? 0.32 : rLen * 2 + 0.4).translate(0, top[0].y + 0.1, 0);
  // Irimoya gables: vertical triangles at the ridge ends.
  const parts = [tb.build(), paint(ridge, o.color), ...parts0];
  if (q(0, 0, 1, 1)) {
    // Onigawara: decorative end tiles on the ridge.
    const rl = alongX ? rLen + 0.2 : 0;
    const rz = alongX ? 0 : rLen + 0.2;
    for (const sgn of [-1, 1]) {
      parts.push(paint(new THREE.BoxGeometry(0.4, 0.5, 0.4).translate(sgn * rl, top[0].y + 0.3, sgn * rz), o.trim === o.color ? '#3b3f46' : o.color));
    }
  }
  // Only roofs with a real ridge get irimoya gables (on near-square roofs they'd poke through).
  if (o.gable && rLen > 1.5) {
    const tg = 0.55;
    const gy = y0 + o.height * tg ** 1.7;
    const gh = top[0].y - gy;
    const half = THREE.MathUtils.lerp(alongX ? D : W, alongX ? ridgeZ : ridgeX, tg) * 0.8;
    for (const s of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(-half, 0);
      shape.lineTo(half, 0);
      shape.lineTo(0, gh);
      shape.closePath();
      const g = new THREE.ShapeGeometry(shape);
      if (alongX) g.rotateY((s * Math.PI) / 2).translate(s * (rLen + 0.02), gy, 0);
      else g.rotateY(s > 0 ? 0 : Math.PI).translate(0, gy, s * (rLen + 0.02));
      parts.push(paint(g, o.gable));
    }
  }
  return lowpoly.merge(parts);
}

/** Chidori-hafu: a small triangular gable dormer facing +Z, sitting on a roof slope. */
export function dormer(width: number, height: number, depth: number, color: string, face: string): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-width / 2 - 0.25, 0);
  s.lineTo(width / 2 + 0.25, 0);
  s.lineTo(0, height + 0.18);
  s.closePath();
  const roof = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
  const f = new THREE.Shape();
  f.moveTo(-width / 2, 0);
  f.lineTo(width / 2, 0);
  f.lineTo(0, height);
  f.closePath();
  const front = new THREE.ShapeGeometry(f).translate(0, 0.02, depth / 2 + 0.02);
  return lowpoly.merge([paint(roof, color), paint(front, face)]);
}
