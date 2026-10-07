import * as THREE from 'three';
import { createRng, Critters, Pond, type App, type PadSpot, type Rng } from '@g2/engine';
import type { Environment } from '../env/Environment';
import { anyTangent, planetSurface, type PlanetShape } from '../planet/PlanetShape';
import { randomDir } from '../planet/surface';

const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();

/** Random point on the planet within `radius` (world units) of `center`. */
function near(shape: PlanetShape, center: THREE.Vector3, radius: number, rng: Rng): THREE.Vector3 {
  const up = center.clone().normalize();
  anyTangent(up, _t1);
  _t2.crossVectors(up, _t1);
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * radius;
  return up.multiplyScalar(shape.radius).addScaledVector(_t1, Math.cos(a) * r).addScaledVector(_t2, Math.sin(a) * r).normalize();
}

/** Butterflies, dragonflies and swallows near the player; lily pads and leaping fish in the lakes. */
export function createWildlife(app: App, shape: PlanetShape, seed: string) {
  const surface = planetSurface(shape);
  const critters = new Critters(
    surface,
    (kind, center, radius, rng) => {
      for (let i = 0; i < 12; i++) {
        const dir = near(shape, center, radius, rng);
        const s = shape.sample(dir);
        const wet = s.weights.lake > 0.3 || s.weights.rice > 0.4;
        if (shape.isWater(dir, 0.3) && kind !== 'dragonfly') continue;
        if (kind === 'dragonfly' && !wet) continue;
        return dir.multiplyScalar(Math.max(s.height, shape.waterLevel));
      }
      return null;
    },
    createRng(`${seed}:critters`),
  );

  // Lily pads in shallow lake water.
  const rng = createRng(`${seed}:pads`);
  const pads: PadSpot[] = [];
  for (let i = 0; i < 6000 && pads.length < 90; i++) {
    const dir = randomDir(rng);
    const h = shape.heightAt(dir);
    if (h > shape.waterLevel - 0.25 || h < shape.waterLevel - 1.6) continue;
    if (shape.sample(dir).weights.lake < 0.3) continue;
    const cluster = 2 + Math.floor(rng() * 4);
    for (let c = 0; c < cluster; c++) {
      const d = near(shape, dir.clone().multiplyScalar(shape.radius), 1.4, rng);
      if (shape.heightAt(d) > shape.waterLevel - 0.15) continue;
      pads.push({ position: d.multiplyScalar(shape.waterLevel + 0.02), scale: 0.6 + rng() * 0.6, flower: rng() < 0.2 });
    }
  }
  const pond = new Pond(
    surface,
    pads,
    (center, radius, r) => {
      for (let i = 0; i < 20; i++) {
        const dir = near(shape, center, radius, r);
        if (shape.heightAt(dir) < shape.waterLevel - 0.8) return dir.multiplyScalar(shape.waterLevel);
      }
      return null;
    },
    createRng(`${seed}:fish`),
  );
  app.scene.add(critters.group, pond.group);
  return {
    noOutline: [critters.group, ...pond.noOutline],
    update(dt: number, focus: THREE.Vector3, env: Environment, enabled: boolean) {
      const w = env.weather;
      critters.group.visible = enabled;
      if (enabled) critters.update(dt, focus, env.daylight * (1 - w.rain) * (1 - w.snow));
      pond.update(dt, focus, 1 - w.snowCover);
    },
  };
}
