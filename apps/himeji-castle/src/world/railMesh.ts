import * as THREE from 'three';
import { envMaterial, haloTexture, lowpoly } from '@g2/engine';
import { PALETTE } from '../palette';
import { WATER_Y, type RailData, type ValleyData } from './ValleyGen';

export const GAUGE = 1.44;
/** Height of the top chord of the bridge trusses above the rails. */
const TRUSS_TOP = 5.4;
/** Tunnel vault: half width and the height where the arch starts (crown ≈ 6.1 m). */
const TUNNEL_R = 3.2;
const TUNNEL_SPRING = 2.9;

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Local frame of the track at sample i: X along the track, Z to the side, Y up-ish. */
function frame(rail: RailData, i: number, out: THREE.Matrix4, origin: THREE.Vector3): THREE.Matrix4 {
  const n = rail.count;
  const a = (i - 1 + n) % n;
  const b = (i + 1) % n;
  _x.set(rail.xs[b] - rail.xs[a], rail.ys[b] - rail.ys[a], rail.zs[b] - rail.zs[a]).normalize();
  _z.crossVectors(_x, UP).normalize();
  _y.crossVectors(_z, _x).normalize();
  return out.makeBasis(_x, _y, _z).setPosition(origin);
}

/** An oriented box at sample i: `along`, `up`, `side` sizes; offset in the local frame. */
function trackBox(
  rail: RailData,
  i: number,
  size: [number, number, number],
  offset: [number, number, number],
  color: string,
): THREE.BufferGeometry {
  _p.set(rail.xs[i], rail.ys[i], rail.zs[i]);
  frame(rail, i, _m, _p);
  const g = new THREE.BoxGeometry(...size).translate(...offset);
  return lowpoly.paint(g.applyMatrix4(_m), color);
}

export interface Bridge {
  /** First and last sample of the span. */
  start: number;
  end: number;
  /** Middle of the span (world) and its side direction (for bridge cameras). */
  center: THREE.Vector3;
  side: THREE.Vector3;
}

/** Contiguous bridge spans of the loop (a span may wrap past sample 0). */
export function findBridges(rail: RailData): Bridge[] {
  return findSpans(rail, rail.bridge);
}

/** Contiguous spans where `flags` is set (a span may wrap past sample 0). */
export function findSpans(rail: RailData, flags: Uint8Array): Bridge[] {
  const n = rail.count;
  // Start scanning at an unflagged sample so wrapping spans stay in one piece.
  let s0 = 0;
  while (s0 < n && flags[s0]) s0++;
  const spans: Bridge[] = [];
  let start = -1;
  for (let k = 1; k <= n; k++) {
    const i = (s0 + k) % n;
    if (flags[i] && start < 0) start = i;
    if (!flags[i] && start >= 0) {
      const end = (i - 1 + n) % n;
      const len = (end - start + n) % n;
      const mid = (start + Math.floor(len / 2)) % n;
      _p.set(rail.xs[mid], rail.ys[mid], rail.zs[mid]);
      frame(rail, mid, _m, _p);
      spans.push({ start, end, center: _p.clone(), side: _z.clone() });
      start = -1;
    }
  }
  return spans;
}

/**
 * Rails, sleepers, ballast and red steel truss bridges with stone piers.
 * Returns the meshes plus the bridge spans.
 */
export function buildRailway(v: ValleyData): { group: THREE.Group; bridges: Bridge[] } {
  const rail = v.rail;
  const n = rail.count;
  const group = new THREE.Group();
  group.name = 'railway';
  const parts: THREE.BufferGeometry[] = [];

  for (let i = 0; i < n; i++) {
    for (const side of [-GAUGE / 2, GAUGE / 2]) parts.push(trackBox(rail, i, [1.02, 0.16, 0.1], [0, -0.08, side], PALETTE.rail));
  }

  // Ballast shoulders where the track is on the ground.
  const ballast: number[] = [];
  const bc = new THREE.Color(PALETTE.ballast);
  const colors: number[] = [];
  const profile: Array<[number, number]> = [
    [-2.7, -1.1],
    [-1.9, -0.36],
    [1.9, -0.36],
    [2.7, -1.1],
  ];
  const ring = (i: number) => {
    _p.set(rail.xs[i], rail.ys[i], rail.zs[i]);
    frame(rail, i, _m, _p);
    return profile.map(([s, h]) => new THREE.Vector3(0, h, s).applyMatrix4(_m));
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (rail.bridge[i] || rail.bridge[j]) continue;
    const a = ring(i);
    const b = ring(j);
    for (let k = 0; k < profile.length - 1; k++) {
      // Winding chosen so the faces point up / outwards.
      for (const p of [a[k], a[k + 1], b[k], a[k + 1], b[k + 1], b[k]]) {
        ballast.push(p.x, p.y, p.z);
        colors.push(bc.r, bc.g, bc.b);
      }
    }
  }
  const ballastGeo = new THREE.BufferGeometry();
  ballastGeo.setAttribute('position', new THREE.Float32BufferAttribute(ballast, 3));
  ballastGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  ballastGeo.computeVertexNormals();
  parts.push(ballastGeo);

  // Bridges: deck, two red trusses and stone piers down to the ground or the river bed.
  const bridges = findBridges(rail);
  for (const b of bridges) {
    const len = (b.end - b.start + n) % n;
    for (let k = 0; k <= len; k++) {
      const i = (b.start + k) % n;
      parts.push(trackBox(rail, i, [1.02, 0.35, 3.4], [0, -0.55, 0], PALETTE.woodDark));
      for (const side of [-1.85, 1.85]) {
        parts.push(trackBox(rail, i, [1.02, 0.28, 0.22], [0, -0.75, side], PALETTE.bridgeRed));
        // Through truss tall enough for the train (≈4.2 m incl. chimney) to pass underneath.
        parts.push(trackBox(rail, i, [1.02, 0.26, 0.24], [0, TRUSS_TOP, side], PALETTE.bridgeRed));
        if (k % 4 === 0) parts.push(trackBox(rail, i, [0.26, TRUSS_TOP + 0.75, 0.24], [0, (TRUSS_TOP - 0.75) / 2, side], PALETTE.bridgeRed));
        if (k % 4 === 2) {
          // Diagonal brace across the 4-unit panel.
          _p.set(rail.xs[i], rail.ys[i], rail.zs[i]);
          frame(rail, i, _m, _p);
          const h = TRUSS_TOP + 0.75;
          const g = new THREE.BoxGeometry(Math.hypot(4, h), 0.2, 0.2)
            .rotateZ((k % 8 === 2 ? 1 : -1) * Math.atan2(h, 4))
            .translate(0, (TRUSS_TOP - 0.75) / 2, side);
          parts.push(lowpoly.paint(g.applyMatrix4(_m), PALETTE.bridgeRed));
        }
      }
      // Overhead cross beams and X sway bracing, well above the train.
      if (k % 4 === 0) parts.push(trackBox(rail, i, [0.22, 0.24, 3.94], [0, TRUSS_TOP, 0], PALETTE.bridgeRed));
      if (k % 8 === 4) {
        _p.set(rail.xs[i], rail.ys[i], rail.zs[i]);
        frame(rail, i, _m, _p);
        for (const a of [1, -1]) {
          const g = new THREE.BoxGeometry(Math.hypot(8, 3.7), 0.12, 0.12).rotateY(a * Math.atan2(3.7, 8)).translate(0, TRUSS_TOP + 0.05, 0);
          parts.push(lowpoly.paint(g.applyMatrix4(_m), PALETTE.bridgeRed));
        }
      }
      if (k % 14 === 7 || k === 0 || k === len) {
        const x = rail.xs[i];
        const z = rail.zs[i];
        const ground = Math.min(v.heightAt(x, z), WATER_Y - 2.4);
        const top = rail.ys[i] - 0.8;
        const h = Math.max(0.5, top - ground);
        parts.push(trackBox(rail, i, [2.2, h, 3.0], [0, -0.8 - h / 2, 0], PALETTE.pier));
        parts.push(trackBox(rail, i, [2.8, 0.4, 3.6], [0, -0.9, 0], PALETTE.stoneDark));
      }
    }
  }

  // Tunnel portals: a stone face with an arched opening at each end of every tunnel.
  for (const t of findSpans(rail, rail.tunnel)) {
    for (const [i, dir] of [
      [t.start, -1],
      [t.end, 1],
    ] as const) {
      const out = (i + dir * 2 + n) % n;
      parts.push(...portal(rail, out, dir));
    }
  }

  // Tunnel lining: a stone vault along every tunnel so riding through one stays inside the hill.
  const lining: THREE.BufferGeometry[] = [];
  for (const t of findSpans(rail, rail.tunnel)) lining.push(tunnelTube(rail, t.start, t.end));
  if (lining.length) {
    group.add(tunnelLamps(rail));
    const tube = new THREE.Mesh(lowpoly.merge(lining), envMaterial({ vertexColors: true, side: THREE.DoubleSide }, { snow: false, wet: false }));
    tube.receiveShadow = true;
    group.add(tube);
  }

  const mesh = new THREE.Mesh(lowpoly.merge(parts), envMaterial({ vertexColors: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // Sleepers.
  const count = Math.floor(rail.length / 0.75);
  const sleepers = new THREE.InstancedMesh(
    lowpoly.paint(new THREE.BoxGeometry(0.26, 0.14, 2.3), PALETTE.sleeper),
    envMaterial({ vertexColors: true }),
    count,
  );
  for (let k = 0; k < count; k++) {
    const s = k * 0.75;
    const i = Math.floor(s) % n;
    const j = (i + 1) % n;
    const f = s - Math.floor(s);
    _p.set(
      THREE.MathUtils.lerp(rail.xs[i], rail.xs[j], f),
      THREE.MathUtils.lerp(rail.ys[i], rail.ys[j], f) - 0.22,
      THREE.MathUtils.lerp(rail.zs[i], rail.zs[j], f),
    );
    frame(rail, i, _m, _p);
    sleepers.setMatrixAt(k, _m);
  }
  sleepers.receiveShadow = true;
  sleepers.computeBoundingSphere();
  group.add(sleepers);
  return { group, bridges };
}

/** Stone tunnel portal at sample i; the opening faces along -dir·tangent (out of the tunnel). */
function portal(rail: RailData, i: number, dir: 1 | -1): THREE.BufferGeometry[] {
  _p.set(rail.xs[i], rail.ys[i], rail.zs[i]);
  frame(rail, i, _m, _p);
  const out: THREE.BufferGeometry[] = [];
  const stone = '#8f887b';
  const dark = '#6f695f';
  const place = (g: THREE.BufferGeometry, color: string) => out.push(lowpoly.paint(g.applyMatrix4(_m), color));
  // Wall face across the track (local X = along the track, Z = sideways).
  const x = dir * 0.2;
  // Opening matches the tunnel vault: walls at ±TUNNEL_R, arch centred at TUNNEL_SPRING.
  const half = TUNNEL_R + 1.2;
  place(new THREE.BoxGeometry(0.9, 9, 2.4).translate(x, 3.3, -half), stone);
  place(new THREE.BoxGeometry(0.9, 9, 2.4).translate(x, 3.3, half), stone);
  place(new THREE.BoxGeometry(0.9, 2.4, half * 2 + 2.4).translate(x, TUNNEL_SPRING + TUNNEL_R + 1.4, 0), stone);
  const arch = new THREE.TorusGeometry(TUNNEL_R + 0.25, 0.5, 5, 14, Math.PI).rotateY(Math.PI / 2).translate(x, TUNNEL_SPRING, 0);
  place(arch, dark);
  place(new THREE.BoxGeometry(1, 0.8, 0.7).translate(x, TUNNEL_SPRING + TUNNEL_R + 0.4, 0), dark);
  place(new THREE.BoxGeometry(1.2, 0.4, half * 2 + 3).translate(x, TUNNEL_SPRING + TUNNEL_R + 2.8, 0), dark);
  return out;
}

/** Vaulted tube from sample `a` to `b` (extending a little past both portals). */
function tunnelTube(rail: RailData, a: number, b: number): THREE.BufferGeometry {
  const n = rail.count;
  const len = ((b - a + n) % n) + 6;
  // Profile: wall up from below the ballast, then a half-circle vault.
  const R = TUNNEL_R;
  const S = TUNNEL_SPRING;
  const prof: Array<[number, number]> = [[-R, -1.2], [-R, S]];
  for (let k = 1; k < 9; k++) {
    const ang = Math.PI - (k / 9) * Math.PI;
    prof.push([Math.cos(ang) * R, S + Math.sin(ang) * R]);
  }
  prof.push([R, S], [R, -1.2]);
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const ring = (i: number) => {
    _p.set(rail.xs[i], rail.ys[i], rail.zs[i]);
    frame(rail, i, _m, _p);
    return prof.map(([side, up]) => new THREE.Vector3(0, up, side).applyMatrix4(_m));
  };
  let prev = ring((a - 3 + n) % n);
  for (let k = 1; k <= len; k++) {
    const i = (a - 3 + k + n) % n;
    const cur = ring(i);
    // Darker stone, with a lighter rib every few metres.
    c.set(k % 6 === 0 ? '#5a554d' : '#3a3632');
    for (let j = 0; j < prof.length - 1; j++) {
      for (const p of [prev[j], cur[j], cur[j + 1], prev[j], cur[j + 1], prev[j + 1]]) {
        pos.push(p.x, p.y, p.z);
        col.push(c.r, c.g, c.b);
      }
    }
    prev = cur;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Wall lamps along both sides of every tunnel, every ~16 m: a bright fitting plus a soft warm
 * glow on the wall around it. Unlit materials, so they shine regardless of the time of day.
 */
function tunnelLamps(rail: RailData): THREE.Group {
  const n = rail.count;
  const fittings: THREE.BufferGeometry[] = [];
  const spots: THREE.Matrix4[] = [];
  for (const t of findSpans(rail, rail.tunnel)) {
    const len = (t.end - t.start + n) % n;
    for (let k = 6; k < len - 3; k += 16) {
      const i = (t.start + k) % n;
      _p.set(rail.xs[i], rail.ys[i], rail.zs[i]);
      frame(rail, i, _m, _p);
      for (const side of [-1, 1]) {
        const z = side * (TUNNEL_R - 0.12);
        fittings.push(lowpoly.paint(new THREE.BoxGeometry(0.35, 0.28, 0.16).translate(0, TUNNEL_SPRING - 0.2, z).applyMatrix4(_m), '#ffd28a'));
        // Glow quad facing into the tunnel.
        const g = new THREE.Matrix4().makeRotationY(side > 0 ? Math.PI : 0).setPosition(0, TUNNEL_SPRING - 0.2, z - side * 0.05);
        spots.push(g.premultiply(_m.clone()));
      }
    }
  }
  const group = new THREE.Group();
  group.name = 'tunnel-lamps';
  if (!fittings.length) return group;
  group.add(new THREE.Mesh(lowpoly.merge(fittings), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
  const glow = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(3.2, 2.6),
    new THREE.MeshBasicMaterial({ map: haloTexture(), color: '#ffb35c', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    spots.length,
  );
  spots.forEach((m, k) => glow.setMatrixAt(k, m));
  glow.computeBoundingSphere();
  group.add(glow);
  return group;
}
