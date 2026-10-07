import * as THREE from 'three';
import type { Rng, SpatialHash } from '@g2/engine';
import type { CharacterConfig } from '../data/characters';
import type { PlanetShape } from '../planet/PlanetShape';
import type { PlanetCollider } from '../planet/scatter';
import { CharacterView } from '@g2/engine';
import { SpherePlayer, type Obstacle } from './SpherePlayer';

type BrainState = 'idle' | 'walk' | 'greet';

const _wish = new THREE.Vector3();
const _to = new THREE.Vector3();
const _up = new THREE.Vector3();
const _head = new THREE.Vector3();

/** A person on the planet: kinematic controller + procedural view + a small wandering brain. */
export class Character {
  readonly controller: SpherePlayer;
  readonly view: CharacterView;
  readonly renderPos = new THREE.Vector3();
  readonly renderQuat = new THREE.Quaternion();
  /** Controlled by the player (brain paused). */
  possessed = false;
  /** Sitting on a bench: movement disabled until the character stands up. */
  seated = false;
  /** Set when the NPC greets the player; the game shows a bubble and clears it. */
  greeted = false;
  home: THREE.Vector3;
  private state: BrainState = 'idle';
  private timer: number;
  private readonly target = new THREE.Vector3();
  private greetCooldown = 0;
  private readonly obstacleQuery;

  constructor(
    readonly config: CharacterConfig,
    private readonly shape: PlanetShape,
    colliders: SpatialHash<PlanetCollider>,
    others: () => Character[],
    homeDir: THREE.Vector3,
    private readonly rng: Rng,
  ) {
    // Static colliders plus every other character as a small moving obstacle.
    this.obstacleQuery = {
      query: (p: THREE.Vector3, radius: number, fn: (o: Obstacle) => void) => {
        colliders.query(p, radius, fn);
        for (const c of others()) {
          if (c !== this && c.controller.position.distanceToSquared(p) < radius * radius) {
            fn({ position: c.controller.position, radius: 0.3 * c.view.height });
          }
        }
      },
    };
    this.controller = new SpherePlayer(shape, this.obstacleQuery);
    this.controller.walkSpeed = 3.6 * Math.max(0.8, config.outfit.height ?? 1);
    this.view = new CharacterView(config.outfit);
    this.view.root.name = config.id;
    this.view.root.userData.character = this;
    this.home = homeDir.clone();
    this.controller.spawn(homeDir, new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5));
    this.timer = 1 + rng() * 3;
  }

  get name(): string {
    return this.config.name;
  }

  /** World position of the top of the head (for speech bubbles and look-at). */
  headPosition(out = new THREE.Vector3()): THREE.Vector3 {
    _up.copy(this.renderPos).normalize();
    return out.copy(this.renderPos).addScaledVector(_up, 1.75 * this.view.height);
  }

  /** Re-anchors the wander area where the character currently stands (after being controlled). */
  settle(): void {
    this.home.copy(this.controller.position).normalize();
    this.state = 'idle';
    this.timer = 1.5;
  }

  sitOn(position: THREE.Vector3, facing: THREE.Vector3): void {
    this.controller.spawn(_to.copy(position).normalize(), facing);
    this.seated = true;
    this.view.play('sit');
  }

  standUp(): void {
    if (!this.seated) return;
    this.seated = false;
    this.view.stop();
  }

  /** NPC step (fixed rate). `player` is the possessed character, if any. */
  think(dt: number, player: Character | null): void {
    const c = this.controller;
    if (this.seated) {
      c.step(dt, _wish.set(0, 0, 0), false);
      return;
    }
    this.greetCooldown -= dt;
    const near = player && player.controller.position.distanceTo(c.position) < 3.4;

    if (near && player) {
      // Stop, turn to the player, maybe wave.
      if (this.state !== 'greet') {
        this.state = 'greet';
        if (this.greetCooldown <= 0) {
          this.view.play('wave');
          this.greeted = true;
          this.greetCooldown = 25;
        }
      }
      c.step(dt, _wish.set(0, 0, 0), false);
      c.face(_to.subVectors(player.controller.position, c.position), dt);
      return;
    }
    if (this.state === 'greet') {
      this.state = 'idle';
      this.timer = 1 + this.rng() * 2;
    }

    if (this.state === 'idle') {
      c.step(dt, _wish.set(0, 0, 0), false);
      this.timer -= dt;
      if (this.timer <= 0 && this.pickTarget()) this.state = 'walk';
      else if (this.timer <= 0) this.timer = 1;
      return;
    }

    // walk
    _up.copy(c.position).normalize();
    _to.copy(this.target).addScaledVector(_up, -this.target.dot(_up));
    const dist = this.target.angleTo(_up) * c.position.length();
    if (dist < 0.6 || c.stuckTime > 0.8) {
      this.state = 'idle';
      this.timer = 2 + this.rng() * 5;
      c.step(dt, _wish.set(0, 0, 0), false);
      return;
    }
    c.step(dt, _wish.copy(_to).normalize().multiplyScalar(dist < 2 ? 0.5 : 0.75), false);
  }

  /** Updates the render transform and animation (per frame). */
  sync(dt: number, alpha: number, lookTarget: THREE.Vector3 | null): void {
    const c = this.controller;
    c.pose(alpha, this.renderPos, this.renderQuat);
    this.view.root.position.copy(this.renderPos);
    this.view.root.quaternion.copy(this.renderQuat);
    this.view.setAirborne(!c.grounded, c.landImpact);
    if (c.grounded) c.landImpact = 0;
    this.view.lookAt(lookTarget);
    this.view.animate(dt, c.grounded ? c.speed : 0);
  }

  /** Look target for this NPC's head: the player when close. */
  interestFor(player: Character | null): THREE.Vector3 | null {
    if (!player || player === this) return null;
    if (player.controller.position.distanceTo(this.controller.position) > 6) return null;
    return player.headPosition(_head).clone();
  }

  private pickTarget(): boolean {
    const r = this.config.roam;
    const R = this.shape.radius;
    for (let i = 0; i < 10; i++) {
      const a = this.rng() * Math.PI * 2;
      const d = (0.3 + this.rng() * 0.7) * r;
      _up.copy(this.home);
      const t1 = _to.set(0, 1, 0).cross(_up);
      if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
      t1.normalize();
      const t2 = new THREE.Vector3().crossVectors(_up, t1);
      const dir = _up
        .clone()
        .multiplyScalar(R)
        .addScaledVector(t1, Math.cos(a) * d)
        .addScaledVector(t2, Math.sin(a) * d)
        .normalize();
      if (this.shape.isWater(dir, 0.3) || this.shape.slopeAt(dir) > 0.6) continue;
      this.target.copy(dir);
      return true;
    }
    return false;
  }
}
