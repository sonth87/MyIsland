import * as THREE from 'three';
import { CharacterView, randRange, type Outfit, type Rng } from '@g2/engine';
import type { ValleyLayout } from '../world/scatter';

const ROBES = [
  ['#c8504a', '#f2d06b'],
  ['#3f6e8a', '#e8e2d6'],
  ['#e2a2b5', '#7a3b55'],
  ['#5a7a4f', '#e1bf55'],
  ['#7a5a8e', '#f3eee2'],
  ['#2f3b52', '#d24a32'],
  ['#f1e7d6', '#3f6e8a'],
];
const SHIRTS = ['#eef0ea', '#7d93a8', '#c0503c', '#f2c94c', '#3f6e5a'];
const SKIN = ['#f2d3b8', '#e3b894', '#d9a77f', '#f5d6bd'];
const HAIR = ['#1f1f26', '#3a2a20', '#5b5b5b', '#2b211d', '#c9c9c9'];

export const LINES = {
  day: [
    'Hoa anh đào nở rồi kìa! 🌸',
    'いい天気ですね — Trời đẹp ghê!',
    'Tàu sắp vào ga đấy.',
    'Lâu đài trên đồi đẹp thật.',
    'Chiều nay đi ngắm sông nhé?',
    'Lúa năm nay vàng ươm.',
    'さくらがきれい！',
    'Ra công viên ngắm hoa đi!',
  ],
  rain: ['Mưa rồi, về nhà thôi!', '雨だ… Quên mang ô mất rồi.', 'Mưa xuân mát quá.'],
  snow: ['Tuyết rơi kìa! ❄️', '寒いね — Lạnh quá!'],
  night: ['Đèn lồng sáng rồi.', 'おやすみなさい — Chúc ngủ ngon.', 'Trăng hôm nay tròn quá.'],
  train: ['Tàu đến rồi! 🚂', '電車が来たよ！'],
};

function outfit(rng: Rng): Outfit {
  const pick = <T>(l: T[]) => l[Math.floor(rng() * l.length)];
  const robe = rng() < 0.6 ? pick(ROBES) : null;
  const r = rng();
  return {
    skin: pick(SKIN),
    hair: pick(HAIR),
    shirt: pick(SHIRTS),
    pants: robe ? '#2c2c30' : rng() < 0.5 ? '#2c3653' : '#5a4a3a',
    shoes: '#3b3532',
    hairStyle: r < 0.3 ? 'bun' : r < 0.5 ? 'ponytail' : 'short',
    robe: robe ? { color: robe[0], obi: robe[1] } : undefined,
    hat: rng() < 0.2 ? { type: 'straw', color: '#d9c084' } : undefined,
    height: randRange(rng, 0.88, 1.05) * (rng() < 0.12 ? 0.72 : 1),
  };
}

interface Villager {
  view: CharacterView;
  area: number;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  heading: number;
  speed: number;
  wait: number;
}

const _d = new THREE.Vector3();

/** Villagers strolling along the street, the platform, the park; pausing, looking about, talking. */
export class People {
  readonly group = new THREE.Group();
  readonly villagers: Villager[] = [];

  constructor(
    private readonly layout: ValleyLayout,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly rng: Rng,
  ) {
    for (const p of layout.people) {
      const view = new CharacterView(outfit(rng));
      this.group.add(view.root);
      this.villagers.push({
        view,
        area: p.area,
        pos: p.position.clone(),
        target: p.position.clone(),
        heading: p.facing,
        speed: 0,
        wait: rng() * 6,
      });
    }
  }

  /** Makes villager `i` gesture while talking. */
  talk(i: number): void {
    this.villagers[i]?.view.play('talk');
  }

  update(dt: number, lookAt: THREE.Vector3): void {
    for (const v of this.villagers) {
      const area = this.layout.areas[v.area];
      if (v.wait > 0) {
        v.wait -= dt;
        v.speed = THREE.MathUtils.damp(v.speed, 0, 6, dt);
        if (v.wait <= 0) this.pickTarget(v);
      } else {
        _d.subVectors(v.target, v.pos).setY(0);
        const dist = _d.length();
        if (dist < 0.3) {
          v.wait = randRange(this.rng, 2, 8);
        } else {
          const want = Math.atan2(_d.x, _d.z);
          const diff = Math.atan2(Math.sin(want - v.heading), Math.cos(want - v.heading));
          v.heading += diff * Math.min(1, dt * 5);
          v.speed = THREE.MathUtils.damp(v.speed, Math.min(1.35, dist * 1.5), 4, dt);
          v.pos.x += Math.sin(v.heading) * v.speed * dt;
          v.pos.z += Math.cos(v.heading) * v.speed * dt;
        }
      }
      v.pos.y = area?.fixedY ?? this.heightAt(v.pos.x, v.pos.z);
      v.view.root.position.copy(v.pos);
      v.view.root.rotation.set(0, v.heading, 0);
      v.view.root.updateMatrixWorld();
      v.view.lookAt(v.pos.distanceTo(lookAt) < 12 ? lookAt : null);
      v.view.animate(dt, v.speed);
    }
  }

  head(i: number, out: THREE.Vector3): THREE.Vector3 {
    const v = this.villagers[i];
    return out.copy(v.pos).setY(v.pos.y + 1.95 * v.view.height);
  }

  private pickTarget(v: Villager): void {
    const a = this.layout.areas[v.area];
    if (!a) return;
    const f = this.rng();
    v.target.copy(a.a).lerp(a.b, f);
    const ang = this.rng() * Math.PI * 2;
    const r = Math.sqrt(this.rng()) * a.width;
    v.target.x += Math.cos(ang) * r;
    v.target.z += Math.sin(ang) * r;
  }
}
