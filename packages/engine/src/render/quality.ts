/**
 * Global model quality, 0 (low) … 3 (ultra). Procedural builders read it to decide how many
 * segments and extra details to add; change it, then rebuild the meshes.
 */
let quality = 1;

export function setQuality(q: number): void {
  quality = Math.max(0, Math.min(3, Math.round(q)));
}

export function getQuality(): number {
  return quality;
}

/** Picks a value by quality: q(low, medium, high, ultra). */
export function q<T>(low: T, medium: T, high: T, ultra: T): T {
  return [low, medium, high, ultra][quality];
}
