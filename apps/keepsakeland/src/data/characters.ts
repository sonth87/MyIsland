import type { Outfit } from '@g2/engine';

export interface CharacterConfig {
  id: string;
  name: string;
  outfit: Outfit;
  /** Where they hang around: a zone type (+ index) or the player spawn. */
  home: { zone: 'spawn' | 'rice' | 'village' | 'lake' | 'mountain'; index?: number; offset?: [number, number] };
  /** Wander radius (world units) around home. */
  roam: number;
  /** Starts seated on the nearest bench (e.g. fishing by the lake). */
  seated?: boolean;
  lines: string[];
}

// Placeholder cast — rename and rewrite their lines to fit your own memories.
export const CAST: CharacterConfig[] = [
  {
    id: 'traveler',
    name: 'Lữ khách',
    outfit: { skin: '#f2d3b8', hair: '#1f1f26', shirt: '#eef0ea', pants: '#2c3653', shoes: '#3b3b3b', accessory: 'camera' },
    home: { zone: 'spawn' },
    roam: 8,
    lines: ['Đẹp quá… phải chụp một tấm mới được.', 'Hôm nay đi đâu tiếp nhỉ?', 'Gió ở đây dễ chịu thật.'],
  },
  {
    id: 'farmer',
    name: 'Bác nông dân',
    outfit: {
      skin: '#e3b894',
      hair: '#5b5b5b',
      shirt: '#7d93a8',
      pants: '#4a4f5c',
      shoes: '#3d2f26',
      hat: { type: 'straw', color: '#d9c084' },
      accessory: 'basket',
    },
    home: { zone: 'rice', offset: [2, -3] },
    roam: 10,
    lines: [
      'Năm nay lúa chín vàng sớm lắm cháu ạ.',
      'Gặt xong thì phơi lên giàn hasa cho khô.',
      'Mưa xuống là ruộng được nước, mừng lắm.',
    ],
  },
  {
    id: 'kid',
    name: 'Bé Hana',
    outfit: {
      skin: '#f5d6bd',
      hair: '#2b211d',
      shirt: '#f2c94c',
      pants: '#d0573f',
      shoes: '#f4f0e6',
      accessory: 'bag',
      height: 0.72,
    },
    home: { zone: 'village', offset: [-3, 2] },
    roam: 9,
    lines: ['Anh chị chơi đuổi bắt không?', 'Tối nay có đèn lồng đẹp lắm đó!', 'Em vừa thấy một con chuồn chuồn đỏ!'],
  },
  {
    id: 'fisher',
    name: 'Ông câu cá',
    outfit: {
      skin: '#d9a77f',
      hair: '#c9c9c9',
      shirt: '#3f6e5a',
      pants: '#5a4a3a',
      shoes: '#2e2e2e',
      hat: { type: 'cap', color: '#2f4a6b' },
      accessory: 'rod',
    },
    home: { zone: 'lake', index: 0 },
    roam: 5,
    seated: true,
    lines: ['Suỵt… cá sắp cắn câu rồi.', 'Hoàng hôn ở hồ này đẹp nhất đảo.', 'Hồ bên kia còn một chiếc ghế trống, ra đó ngắm hoàng hôn đi.'],
  },
  {
    id: 'postman',
    name: 'Người đưa thư',
    outfit: {
      skin: '#eac2a0',
      hair: '#3a2a20',
      shirt: '#c0503c',
      pants: '#2c3653',
      shoes: '#3b3b3b',
      hat: { type: 'cap', color: '#c0503c' },
      accessory: 'bag',
    },
    home: { zone: 'village', offset: [3, -2] },
    roam: 16,
    lines: ['Hôm nay có ba lá thư cho làng bên hồ.', 'Trời nổi gió là thư bay mất, phải giữ chặt!', 'Bạn có muốn gửi thư cho ai không?'],
  },
];
