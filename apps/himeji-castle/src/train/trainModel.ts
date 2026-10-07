import * as THREE from 'three';
import { lowpoly, q } from '@g2/engine';

const { paint, merge } = lowpoly;

const BLACK = '#25262b';
const RED = '#b8352b';
const RED_DARK = '#8f2a23';
const GOLD = '#d9b44a';
const STEEL = '#5b5e66';
const BRASS = '#c9a046';

export interface CarModel {
  group: THREE.Group;
  length: number;
  wheels: THREE.Object3D[];
  wheelRadius: number;
  /** Called with the wheel rotation angle each frame (moves coupling rods). */
  onWheel?: (angle: number) => void;
}

const box = (w: number, h: number, d: number, c: string, x = 0, y = 0, z = 0) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
/** Cylinder lying along Z. */
const cylZ = (r0: number, r1: number, len: number, c: string, x: number, y: number, z: number, seg = q(10, 14, 22, 30)) =>
  paint(new THREE.CylinderGeometry(r0, r1, len, seg).rotateX(Math.PI / 2).translate(x, y, z), c);
/** Upright solid of revolution from (radius, height) pairs. */
const lathe = (profile: Array<[number, number]>, c: string, x: number, y: number, z: number) =>
  paint(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), q(8, 12, 18, 24)).translate(x, y, z), c);
/** Thin rod between two points. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, c: string): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 5).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  return paint(g.translate(a.x, a.y, a.z), c);
}

/** Wheel facing ±X with tyre, spokes (at high quality) and a counterweight. */
function wheel(r: number, color: string, counterweight = false): THREE.BufferGeometry {
  const seg = q(12, 16, 24, 32);
  const parts = [
    paint(new THREE.CylinderGeometry(r, r, 0.14, seg).rotateZ(Math.PI / 2), BLACK),
    paint(new THREE.CylinderGeometry(r * 1.06, r * 1.06, 0.06, seg).rotateZ(Math.PI / 2).translate(-0.07, 0, 0), STEEL),
  ];
  if (q(0, 0, 1, 1)) {
    parts.push(paint(new THREE.TorusGeometry(r * 0.86, r * 0.09, 4, seg).rotateY(Math.PI / 2).translate(0.075, 0, 0), color));
    const spokes = q(6, 8, 10, 12);
    for (let i = 0; i < spokes; i++) {
      parts.push(paint(new THREE.BoxGeometry(0.05, r * 0.82, r * 0.11).translate(0.075, r * 0.41, 0).rotateX((i / spokes) * Math.PI * 2), color));
    }
    parts.push(paint(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.18, 10).rotateZ(Math.PI / 2).translate(0.03, 0, 0), color));
    if (counterweight) parts.push(paint(new THREE.CylinderGeometry(r * 0.7, r * 0.7, 0.05, 10, 1, false, 0, Math.PI * 0.6).rotateZ(Math.PI / 2).translate(0.09, 0, 0), color));
  } else {
    parts.push(paint(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.16, seg).rotateZ(Math.PI / 2), color));
    parts.push(paint(new THREE.BoxGeometry(0.18, r * 1.7, 0.12), BLACK));
  }
  return merge(parts);
}

function addWheels(g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, r: number, zs: number[], out: THREE.Object3D[]): void {
  for (const x of [-0.82, 0.82]) {
    for (const z of zs) {
      const w = new THREE.Mesh(geo, mat);
      w.position.set(x, r, z);
      if (x < 0) w.rotation.y = Math.PI; // spokes face outwards on both sides
      w.castShadow = true;
      g.add(w);
      out.push(w);
    }
  }
}

/** Steam locomotive, origin at rail-top level, centred, facing +Z. Length 9.4. */
export function buildLoco(mat: THREE.Material, glowMat: THREE.Material): CarModel {
  const g = new THREE.Group();
  const hi = q(0, 0, 1, 1) === 1;
  const ultra = q(0, 0, 0, 1) === 1;
  const parts: THREE.BufferGeometry[] = [
    // Frame, running boards and valances.
    box(2.3, 0.45, 8.2, BLACK, 0, 1.05, 0),
    box(2.7, 0.08, 6.2, BLACK, 0, 1.42, 1.1),
    box(0.06, 0.3, 6.2, RED, 1.35, 1.25, 1.1),
    box(0.06, 0.3, 6.2, RED, -1.35, 1.25, 1.1),
    // Boiler with bands, smokebox and its door.
    cylZ(0.88, 0.88, 4.8, RED, 0, 2.15, 1.3),
    cylZ(0.93, 0.93, 1.05, BLACK, 0, 2.15, 3.95),
    cylZ(0.8, 0.8, 0.08, '#303238', 0, 2.15, 4.5),
    // Chimney (flared), steam dome (brass) and sand dome.
    lathe([[0.3, 0], [0.26, 0.4], [0.26, 0.9], [0.42, 1.15], [0.46, 1.25], [0, 1.25]], BLACK, 0, 2.9, 3.85),
    lathe([[0.5, 0], [0.46, 0.15], [0.4, 0.35], [0.28, 0.55], [0, 0.62]], BRASS, 0, 2.9, 1.7),
    lathe([[0.42, 0], [0.38, 0.15], [0.3, 0.32], [0, 0.42]], RED, 0, 2.9, 0.3),
    // Firebox under the cab front.
    box(1.9, 1.4, 1.2, RED_DARK, 0, 1.95, -1.4),
    // Cylinders and steam chests on both sides at the front.
    cylZ(0.34, 0.34, 1.1, BLACK, 1.15, 1.3, 3.2),
    cylZ(0.34, 0.34, 1.1, BLACK, -1.15, 1.3, 3.2),
    box(0.4, 0.4, 0.9, BLACK, 1.1, 1.75, 3.2),
    box(0.4, 0.4, 0.9, BLACK, -1.1, 1.75, 3.2),
    // Buffer beam and buffers.
    box(2.5, 0.45, 0.2, RED, 0, 1.0, 4.7),
    cylZ(0.12, 0.12, 0.35, BLACK, 0.8, 1.0, 4.95),
    cylZ(0.12, 0.12, 0.35, BLACK, -0.8, 1.0, 4.95),
    cylZ(0.2, 0.2, 0.06, STEEL, 0.8, 1.0, 5.13),
    cylZ(0.2, 0.2, 0.06, STEEL, -0.8, 1.0, 5.13),
    // Cowcatcher.
    paint(new THREE.ConeGeometry(1.15, 1.0, 4).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 0.5, 0.9).translate(0, 0.45, 5.1), BLACK),
    // Open cab: floor, walls with window cut-outs, curved roof.
    box(2.6, 0.15, 2.7, BLACK, 0, 1.3, -2.55),
    box(2.6, 1.2, 0.12, RED, 0, 1.95, -1.25),
    box(0.12, 1.2, 2.7, RED, -1.24, 1.95, -2.55),
    box(0.12, 1.2, 2.7, RED, 1.24, 1.95, -2.55),
    box(0.25, 1.05, 0.12, RED, -1.17, 3.05, -1.25),
    box(0.25, 1.05, 0.12, RED, 1.17, 3.05, -1.25),
    box(0.12, 1.05, 0.25, RED, -1.24, 3.05, -3.8),
    box(0.12, 1.05, 0.25, RED, 1.24, 3.05, -3.8),
    box(2.6, 0.8, 0.12, RED, 0, 1.75, -3.85),
    box(2.6, 0.06, 0.06, GOLD, 0, 2.55, -1.2),
  ];
  // Roof: a shallow arc (smooth at high quality).
  const roofSeg = q(1, 3, 8, 12);
  if (roofSeg === 1) parts.push(box(2.9, 0.18, 3.1, BLACK, 0, 3.62, -2.55));
  else parts.push(paint(new THREE.CylinderGeometry(3.2, 3.2, 3.1, roofSeg * 2, 1, true, -0.45, 0.9).rotateX(Math.PI / 2).translate(0, 0.42, -2.55), BLACK));
  if (hi) {
    // Boiler bands, handrails, whistle, safety valves, headlamp bracket, sandpipes, cab spectacle windows.
    for (const z of [-0.6, 0.6, 2.0, 3.35]) parts.push(cylZ(0.9, 0.9, 0.1, GOLD, 0, 2.15, z));
    for (const s of [-1, 1]) {
      parts.push(rod(new THREE.Vector3(s * 0.95, 2.45, -1.0), new THREE.Vector3(s * 0.95, 2.45, 3.6), 0.025, BRASS));
      parts.push(rod(new THREE.Vector3(s * 0.55, 1.5, 0.3), new THREE.Vector3(s * 0.9, 0.6, 0.6), 0.03, BLACK));
      // Spectacle windows, kept low and small so they frame (not block) the driver's view.
      parts.push(paint(new THREE.TorusGeometry(0.2, 0.035, 5, 12).translate(s * 0.8, 2.7, -1.2), BRASS));
    }
    parts.push(lathe([[0.06, 0], [0.06, 0.35], [0.1, 0.4], [0, 0.45]], BRASS, 0.25, 3.0, -0.8));
    parts.push(lathe([[0.08, 0], [0.08, 0.25], [0.12, 0.3], [0, 0.32]], BRASS, -0.25, 3.0, -0.8));
    parts.push(box(0.3, 0.06, 0.3, BLACK, 0, 2.75, 4.45));
    // Door hinges on the smokebox.
    parts.push(box(0.6, 0.06, 0.04, STEEL, 0, 2.4, 4.55), box(0.6, 0.06, 0.04, STEEL, 0, 1.9, 4.55));
  }
  if (ultra) {
    // Cowcatcher slats and rivet rows.
    for (let i = -3; i <= 3; i++) parts.push(rod(new THREE.Vector3(i * 0.3, 0.95, 4.82), new THREE.Vector3(i * 0.12, 0.25, 5.55), 0.025, STEEL));
    for (let z = -0.2; z < 3.4; z += 0.25) for (const s of [-1, 1]) parts.push(paint(new THREE.SphereGeometry(0.025, 4, 3).translate(s * 0.9, 2.15, z), GOLD));
  }
  const body = new THREE.Mesh(merge(parts), mat);
  body.castShadow = true;
  g.add(body);
  g.add(new THREE.Mesh(cylZ(0.22, 0.26, 0.32, '#f3eee2', 0, 3.0, 4.5), glowMat));

  const wheels: THREE.Object3D[] = [];
  const drive = wheel(0.62, RED, true);
  addWheels(g, drive, mat, 0.62, [-1.6, -0.2, 1.2], wheels);
  addWheels(g, wheel(0.38, BLACK), mat, 0.38, [2.8, 3.7], wheels);

  // Coupling rods join the three driving wheels and circle with their cranks.
  let onWheel: CarModel['onWheel'];
  if (q(0, 1, 1, 1)) {
    const rods = [1, -1].map((side) => {
      const m = new THREE.Mesh(box(0.08, 0.14, 3.2, STEEL), mat);
      m.castShadow = true;
      g.add(m);
      return { m, side, phase: side > 0 ? 0 : Math.PI / 2 };
    });
    const crank = 0.62 * 0.45;
    onWheel = (a) => {
      for (const r of rods) {
        // Wheels rotate about +X by `a`: a crank pin at (0, crank, 0) moves to (0, cos, sin).
        r.m.position.set(r.side * 0.98, 0.62 + Math.cos(a + r.phase) * crank, -0.2 + Math.sin(a + r.phase) * crank);
      }
    };
  }
  return { group: g, length: 9.4, wheels, wheelRadius: 0.62, onWheel };
}

/** Tender with flared top, coal heap and water filler. Length 4.8. */
export function buildTender(mat: THREE.Material): CarModel {
  const g = new THREE.Group();
  const parts = [
    box(2.3, 0.4, 4.6, BLACK, 0, 1.0, 0),
    box(2.4, 1.5, 4.4, RED, 0, 1.95, 0),
    box(2.42, 0.1, 4.42, GOLD, 0, 2.45, 0),
    box(2.6, 0.12, 4.5, BLACK, 0, 2.76, 0),
    box(0.1, 0.4, 4.5, BLACK, 1.27, 2.95, 0),
    box(0.1, 0.4, 4.5, BLACK, -1.27, 2.95, 0),
  ];
  // Coal heap: lumpy at high quality.
  if (q(0, 0, 1, 1)) {
    const coal = new THREE.IcosahedronGeometry(1, q(0, 1, 2, 3)).scale(1.1, 0.4, 1.7);
    const p = coal.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const k = 1 + (Math.sin(i * 12.9898) * 43758.5453 - Math.floor(Math.sin(i * 12.9898) * 43758.5453) - 0.5) * 0.25;
      p.setXYZ(i, p.getX(i) * k, Math.max(0, p.getY(i) * k), p.getZ(i) * k);
    }
    parts.push(paint(coal.translate(0, 2.8, 0.6), '#1d1d1f'));
    parts.push(lathe([[0.3, 0], [0.3, 0.2], [0.34, 0.24], [0, 0.26]], BLACK, 0, 2.82, -1.6));
    for (const s of [-1, 1]) parts.push(rod(new THREE.Vector3(s * 1.25, 1.1, -2.25), new THREE.Vector3(s * 1.25, 2.6, -2.25), 0.03, BRASS));
  } else {
    parts.push(box(2.0, 0.4, 3.4, '#1d1d1f', 0, 2.95, 0.2));
  }
  const body = new THREE.Mesh(merge(parts), mat);
  body.castShadow = true;
  g.add(body);
  const wheels: THREE.Object3D[] = [];
  addWheels(g, wheel(0.45, BLACK), mat, 0.45, [-1.4, 1.4], wheels);
  return { group: g, length: 4.8, wheels, wheelRadius: 0.45 };
}

/** Passenger coach with arched roof, panelling, end platforms and bogies. Length 9.6. */
export function buildCoach(mat: THREE.Material, glowMat: THREE.Material, colorHex: string): CarModel {
  const g = new THREE.Group();
  const L = 9.6;
  const body = L - 1.2; // leaves open platforms at both ends
  const hi = q(0, 0, 1, 1) === 1;
  const parts = [
    box(2.3, 0.35, L - 0.2, BLACK, 0, 1.0, 0),
    box(2.6, 1.0, body, colorHex, 0, 1.7, 0),
    box(2.6, 0.9, body, '#efe4c8', 0, 2.6, 0),
    box(2.62, 0.12, body, GOLD, 0, 2.18, 0),
    box(2.6, 0.3, body, colorHex, 0, 3.2, 0),
    // End platforms.
    box(2.4, 0.1, 0.65, '#6b4a37', 0, 1.22, L / 2 - 0.32),
    box(2.4, 0.1, 0.65, '#6b4a37', 0, 1.22, -L / 2 + 0.32),
  ];
  // Roof: arched (smooth at high quality) with an overhang over the platforms.
  const seg = q(2, 4, 10, 14);
  parts.push(
    paint(
      new THREE.CylinderGeometry(2.2, 2.2, L + 0.1, seg * 2, 1, false, -0.68, 1.36).rotateX(Math.PI / 2).scale(1, 0.55, 1).translate(0, 2.3, 0),
      '#5b5e66',
    ),
  );
  // Window posts.
  for (let z = -body / 2 + 0.7; z < body / 2; z += 1.3) for (const x of [-1.31, 1.31]) parts.push(box(0.04, 0.8, 0.2, colorHex, x, 2.62, z));
  if (hi) {
    // Panel lines, door at each end, railings, steps, roof vents, bogie frames with springs.
    for (let z = -body / 2 + 0.7; z < body / 2; z += 1.3) for (const x of [-1.31, 1.31]) parts.push(box(0.03, 0.75, 0.04, GOLD, x, 1.7, z));
    for (const s of [-1, 1]) {
      parts.push(box(1.0, 1.9, 0.06, '#6b4a37', 0, 2.15, s * (body / 2 + 0.03)));
      parts.push(box(0.4, 0.5, 0.07, '#2b3340', 0, 2.6, s * (body / 2 + 0.04)));
      for (const x of [-1.15, 1.15]) {
        parts.push(rod(new THREE.Vector3(x, 1.25, s * (L / 2 - 0.05)), new THREE.Vector3(x, 2.25, s * (L / 2 - 0.05)), 0.025, BRASS));
        parts.push(rod(new THREE.Vector3(x, 2.25, s * (body / 2)), new THREE.Vector3(x, 2.25, s * (L / 2 - 0.05)), 0.025, BRASS));
        parts.push(box(0.4, 0.06, 0.3, BLACK, x, 0.75, s * (L / 2 - 0.3)));
      }
      parts.push(rod(new THREE.Vector3(-1.15, 2.25, s * (L / 2 - 0.05)), new THREE.Vector3(1.15, 2.25, s * (L / 2 - 0.05)), 0.025, BRASS));
      // Bogie frame + leaf springs.
      parts.push(box(2.0, 0.22, 2.4, BLACK, 0, 0.62, s * 3.1));
      for (const x of [-0.9, 0.9]) parts.push(box(0.12, 0.12, 1.2, '#3b3d44', x, 0.85, s * 3.1));
    }
    for (let z = -body / 2 + 1; z < body / 2; z += 1.6) parts.push(lathe([[0.12, 0], [0.12, 0.12], [0.18, 0.16], [0, 0.18]], '#5b5e66', 0, 3.55, z));
  }
  const mesh = new THREE.Mesh(merge(parts), mat);
  mesh.castShadow = true;
  g.add(mesh);
  // Windows: dark glass by day, warm at night.
  g.add(new THREE.Mesh(box(2.64, 0.62, body - 0.6, '#2b3340', 0, 2.62, 0), glowMat));
  const wheels: THREE.Object3D[] = [];
  addWheels(g, wheel(0.42, BLACK), mat, 0.42, [-3.6, -2.6, 2.6, 3.6], wheels);
  return { group: g, length: L, wheels, wheelRadius: 0.42 };
}
