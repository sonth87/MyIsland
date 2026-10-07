import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SADO } from '../data/sado';
import { PlanetShape } from '../planet/PlanetShape';
import { spawnDir } from '../planet/scatter';
import { SpherePlayer } from './SpherePlayer';

const DT = 1 / 60;

describe('SpherePlayer', () => {
  it('walks a full great circle on a smooth sphere (over both poles) and returns to start', () => {
    const R = 10;
    const player = new SpherePlayer({ waterLevel: 0, heightAt: () => R });
    const start = new Vector3(1, 0, 0);
    player.spawn(start, new Vector3(0, 1, 0));
    player.walkSpeed = 2;

    const steps = Math.round((2 * Math.PI * R) / (player.walkSpeed * DT));
    // Let speed ramp up: measure distance actually travelled instead of assuming constant speed.
    let travelled = 0;
    const wish = new Vector3();
    for (let i = 0; travelled < 2 * Math.PI * R && i < steps * 2; i++) {
      wish.copy(player.forward);
      player.step(DT, wish, false);
      travelled += player.position.distanceTo(player.prevPosition);

      expect(Math.abs(player.position.length() - R)).toBeLessThan(1e-9);
      expect(Math.abs(player.forward.dot(player.up()))).toBeLessThan(1e-9);
      expect(Math.abs(player.forward.length() - 1)).toBeLessThan(1e-9);
    }
    expect(player.position.distanceTo(start.clone().multiplyScalar(R))).toBeLessThan(0.1);
  });

  it('stays glued to the generated terrain and never enters water', () => {
    const shape = new PlanetShape(SADO);
    const player = new SpherePlayer(shape);
    player.spawn(spawnDir(shape, SADO));
    const wish = new Vector3();
    for (let i = 0; i < 3000; i++) {
      // Wander: slowly rotate the wish direction.
      wish.copy(player.forward).applyAxisAngle(player.up(), Math.sin(i * 0.01) * 0.05);
      player.step(DT, wish, i % 500 < 250);
      const dir = player.up();
      expect(Math.abs(player.position.length() - shape.heightAt(dir))).toBeLessThan(1e-6);
      expect(shape.heightAt(dir)).toBeGreaterThan(shape.waterLevel);
    }
  });
});
