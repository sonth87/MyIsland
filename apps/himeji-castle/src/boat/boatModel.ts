import * as THREE from 'three';
import { lowpoly, q } from '@g2/engine';

const { paint, merge } = lowpoly;

const STERN = -2.4;
const BOW = 3.0;
const WHITE = '#f4f2ec';
const RED = '#c8402f';
const BOTTOM = '#2f4a6b';
const TEAK = '#a8805a';
const CREAM = '#f1e7d6';
const DARK = '#2a2c31';
const CHROME = '#c9cdd2';

/** Half-beam at the gunwale. Full width aft, rounding into the bow. */
function beam(z: number): number {
  if (z < 0.3) return 1.1;
  const t = (z - 0.3) / (BOW - 0.3);
  return 1.1 * Math.pow(Math.max(0, Math.cos((t * Math.PI) / 2)), 0.75);
}
/** Gunwale height: rises a little towards the bow (sheer). */
function sheer(z: number): number {
  return 0.66 + Math.max(0, z - 0.3) ** 2 * 0.035;
}
/** Keel depth: a deep V aft that sweeps up to the stem. */
function keel(z: number): number {
  const t = Math.max(0, (z - 0.8) / (BOW - 0.8));
  return -0.42 + t * t * 0.95;
}

/**
 * Speedboat hull lofted from cross-sections: flared topsides with a red sheer stripe, a dark
 * anti-fouling bottom below the waterline (so it clearly floats), a V bottom and a flat transom.
 */
function hull(): THREE.BufferGeometry {
  const sections = q(9, 13, 20, 28);
  const around = q(4, 6, 8, 11); // points from gunwale to keel on one side
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const ring = (z: number) => {
    const w = beam(z);
    const top = sheer(z);
    const k = keel(z);
    const pts: THREE.Vector3[] = [];
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i <= around; i++) {
        const t = s < 0 ? i / around : 1 - i / around; // port: top→keel, starboard: keel→top
        // Rounded bilge: x stays wide then tucks in near the keel.
        const x = s * w * Math.cos(t * t * (Math.PI / 2) * 0.98);
        const y = THREE.MathUtils.lerp(top, k, Math.pow(t, 1.6));
        if (s > 0 && i === 0) continue; // keel point shared
        pts.push(new THREE.Vector3(x, y, z));
      }
    }
    return pts;
  };
  const colorAt = (y: number, top: number) => (y > top - 0.2 ? RED : y > 0.0 ? WHITE : BOTTOM);
  const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, color: string) => {
    c.set(color);
    for (const p of [a, b, d]) {
      pos.push(p.x, p.y, p.z);
      col.push(c.r, c.g, c.b);
    }
  };
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= sections; i++) rings.push(ring(STERN + ((BOW - 0.02 - STERN) * i) / sections));
  for (let r = 0; r < sections; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    for (let i = 0; i < A.length - 1; i++) {
      const top = sheer(A[i].z);
      const color = colorAt((A[i].y + A[i + 1].y) / 2, top);
      // Outward-facing winding.
      tri(A[i], A[i + 1], B[i + 1], color);
      tri(A[i], B[i + 1], B[i], color);
    }
  }
  // Bow tip: close the last ring to a point.
  const last = rings[sections];
  const tip = new THREE.Vector3(0, sheer(BOW) - 0.05, BOW + 0.05);
  for (let i = 0; i < last.length - 1; i++) tri(last[i], last[i + 1], tip, colorAt(last[i].y, sheer(BOW)));
  // Transom.
  const st = rings[0];
  for (let i = 1; i < st.length - 1; i++) tri(st[0], st[i + 1], st[i], st[i].y > 0 ? WHITE : BOTTOM);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Flat polygon following the gunwale between z0 and z1 at height y (inset by `inset`). */
function deckPlate(z0: number, z1: number, y: (z: number) => number, inset: number, color: string): THREE.BufferGeometry {
  const n = q(6, 10, 16, 22);
  const pos: number[] = [];
  const c = new THREE.Color(color);
  const col: number[] = [];
  for (let i = 0; i < n; i++) {
    const za = z0 + ((z1 - z0) * i) / n;
    const zb = z0 + ((z1 - z0) * (i + 1)) / n;
    const wa = Math.max(0.01, beam(za) - inset);
    const wb = Math.max(0.01, beam(zb) - inset);
    const quad = [
      [-wa, y(za), za],
      [wa, y(za), za],
      [wb, y(zb), zb],
      [-wb, y(zb), zb],
    ];
    for (const k of [0, 2, 1, 0, 3, 2]) {
      pos.push(...quad[k]);
      col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

const rbox = (w: number, h: number, d: number, color: string, x: number, y: number, z: number, r = 0.06) => {
  if (q(0, 0, 1, 1) === 0) return paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
  // Rounded box: a box with its edges softened by a capsule-ish scale trick.
  const g = new THREE.BoxGeometry(w - 2 * r, h, d - 2 * r);
  const parts = [paint(g.translate(x, y, z), color)];
  parts.push(paint(new THREE.BoxGeometry(w, h - 2 * r, d - 2 * r).translate(x, y, z), color));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(paint(new THREE.CylinderGeometry(r, r, h - 2 * r, 6).translate(x + sx * (w / 2 - r), y, z + sz * (d / 2 - r)), color));
  return merge(parts);
};

function seat(x: number, z: number): THREE.BufferGeometry {
  const parts = [
    rbox(0.56, 0.16, 0.52, CREAM, x, 0.5, z),
    rbox(0.56, 0.42, 0.12, CREAM, x, 0.75, z - 0.24).rotateX(0),
    paint(new THREE.BoxGeometry(0.58, 0.05, 0.54).translate(x, 0.43, z), RED),
    paint(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 6).translate(x, 0.32, z), CHROME),
  ];
  return merge(parts);
}

function outboard(x: number): THREE.BufferGeometry {
  const seg = q(6, 8, 12, 16);
  const parts = [
    // Cowling: rounded top.
    paint(new THREE.CapsuleGeometry(0.17, 0.22, 3, seg).scale(1, 1, 1.25).translate(x, 0.78, -2.62), WHITE),
    paint(new THREE.CylinderGeometry(0.175, 0.175, 0.06, seg).scale(1, 1, 1.25).translate(x, 0.66, -2.62), DARK),
    // Mid section and leg down to the propeller.
    paint(new THREE.BoxGeometry(0.16, 0.42, 0.22).translate(x, 0.38, -2.64), DARK),
    paint(new THREE.BoxGeometry(0.08, 0.5, 0.16).translate(x, -0.05, -2.66), DARK),
    paint(new THREE.CylinderGeometry(0.06, 0.05, 0.3, seg).rotateX(Math.PI / 2).translate(x, -0.28, -2.62), DARK),
  ];
  if (q(0, 0, 1, 1)) {
    for (let b = 0; b < 3; b++) {
      parts.push(paint(new THREE.BoxGeometry(0.03, 0.2, 0.06).rotateZ((b * Math.PI * 2) / 3).translate(x, -0.28, -2.8), CHROME));
    }
  }
  return merge(parts);
}

/** Speedboat facing +Z, origin at the waterline. Detail follows the global quality. */
export function boatGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    hull(),
    // Cockpit floor (teak) and white foredeck.
    deckPlate(STERN + 0.08, 0.45, () => 0.32, 0.12, TEAK),
    deckPlate(0.45, BOW - 0.05, (z) => sheer(z) - 0.01, 0.0, WHITE),
    // Gunwale cap along the cockpit.
    ...[-1, 1].map((s) => paint(new THREE.BoxGeometry(0.12, 0.05, 2.9).translate(s * 1.05, 0.68, -0.95), WHITE)),
    seat(-0.42, -0.35),
    seat(0.42, -0.35),
    rbox(1.9, 0.18, 0.55, CREAM, 0, 0.5, -1.85),
    rbox(1.9, 0.36, 0.12, CREAM, 0, 0.72, -2.1),
    // Console with dashboard and steering wheel.
    rbox(0.78, 0.55, 0.42, WHITE, -0.42, 0.62, 0.3),
    paint(new THREE.BoxGeometry(0.72, 0.06, 0.4).rotateX(0.35).translate(-0.42, 0.93, 0.28), '#2f3540'),
    paint(new THREE.TorusGeometry(0.15, 0.025, 5, q(8, 10, 16, 20)).rotateX(-0.9).translate(-0.42, 1.0, 0.08), DARK),
    paint(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 5).rotateX(-0.9).translate(-0.42, 0.93, 0.15), DARK),
    rbox(0.78, 0.55, 0.42, WHITE, 0.42, 0.62, 0.3),
    // Windshield: a curved band of tinted panels.
    ...windshield(),
    outboard(-0.38),
    outboard(0.38),
  ];
  if (q(0, 0, 1, 1)) {
    // Bow rails, cleats, nav light, fenders.
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let z = 1.0; z <= BOW - 0.3; z += 0.35) pts.push(new THREE.Vector3(s * (beam(z) - 0.1), sheer(z) + 0.22, z));
      for (let i = 0; i < pts.length; i++) {
        parts.push(paint(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 4).translate(pts[i].x, pts[i].y - 0.11, pts[i].z), CHROME));
        if (i > 0) {
          const a = pts[i - 1];
          const b = pts[i];
          const len = a.distanceTo(b);
          const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
          const rail = new THREE.CylinderGeometry(0.018, 0.018, len, 4).rotateX(Math.PI / 2).applyMatrix4(m).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
          parts.push(paint(rail, CHROME));
        }
      }
      parts.push(paint(new THREE.CapsuleGeometry(0.07, 0.25, 2, 6).translate(s * 1.13, 0.35, -1.0), '#e9e6de'));
      parts.push(paint(new THREE.BoxGeometry(0.06, 0.04, 0.2).translate(s * 0.9, 0.7, -2.2), CHROME));
    }
    parts.push(paint(new THREE.SphereGeometry(0.05, 6, 4).translate(0, sheer(BOW) + 0.06, BOW - 0.25), '#f0e070'));
    parts.push(paint(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 4).translate(0, 1.2, -2.25), CHROME));
  }
  return merge(parts);
}

function windshield(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const n = q(3, 5, 9, 13);
  const r = 1.05;
  for (let i = 0; i < n; i++) {
    const a0 = -0.95 + (1.9 * i) / n;
    const a1 = -0.95 + (1.9 * (i + 1)) / n;
    const p0 = new THREE.Vector3(Math.sin(a0) * r, 0, 0.62 + (Math.cos(a0) - 1) * 0.55);
    const p1 = new THREE.Vector3(Math.sin(a1) * r, 0, 0.62 + (Math.cos(a1) - 1) * 0.55);
    const len = p0.distanceTo(p1);
    const ang = Math.atan2(p1.z - p0.z, p1.x - p0.x);
    out.push(paint(new THREE.BoxGeometry(len, 0.42, 0.03).rotateX(-0.35).rotateY(-ang).translate((p0.x + p1.x) / 2, 1.05, (p0.z + p1.z) / 2), '#8fbfd0'));
    out.push(paint(new THREE.BoxGeometry(len + 0.01, 0.04, 0.05).rotateY(-ang).translate((p0.x + p1.x) / 2, 1.25, (p0.z + p1.z) / 2 - 0.07), '#2f3540'));
  }
  return out;
}
