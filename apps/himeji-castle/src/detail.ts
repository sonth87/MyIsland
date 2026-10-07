export type DetailLevel = 'low' | 'medium' | 'high' | 'ultra';

/** Model quality (0..3) used by the procedural builders for each detail level. */
export const QUALITY: Record<DetailLevel, number> = { low: 0, medium: 1, high: 2, ultra: 3 };
export type ViewLevel = 'near' | 'medium' | 'far' | 'ultra';

export interface DetailPreset {
  label: string;
  description: string;
  terrainSegments: number;
  /** Fraction of the grass / flowers / rice. */
  grass: number;
  /** Trees closer than this use their detailed mesh. */
  treeNear: number;
  shadowMap: number;
  maxPixelRatio: number;
}

export const DETAIL: Record<DetailLevel, DetailPreset> = {
  low: { label: 'Thấp', description: 'Cây đơn giản, ít cỏ, bóng thô. Nhẹ nhất.', terrainSegments: 100, grass: 0.3, treeNear: 30, shadowMap: 1024, maxPixelRatio: 1 },
  medium: { label: 'Vừa', description: 'Cân bằng giữa đẹp và mượt.', terrainSegments: 140, grass: 0.55, treeNear: 55, shadowMap: 2048, maxPixelRatio: 1.5 },
  high: { label: 'Cao', description: 'Cây chi tiết ở tầm trung, cỏ dày.', terrainSegments: 180, grass: 0.8, treeNear: 85, shadowMap: 2048, maxPixelRatio: 2 },
  ultra: { label: 'Rất cao', description: 'Mọi thứ chi tiết nhất, bóng sắc nét. Nặng nhất.', terrainSegments: 220, grass: 1, treeNear: 130, shadowMap: 4096, maxPixelRatio: 2 },
};

/** How far things are drawn; fog closes in so the cut-off isn't visible. */
export const VIEW: Record<ViewLevel, { label: string; distance: number }> = {
  near: { label: 'Gần', distance: 150 },
  medium: { label: 'Vừa', distance: 230 },
  far: { label: 'Xa', distance: 340 },
  ultra: { label: 'Rất xa', distance: 520 },
};
