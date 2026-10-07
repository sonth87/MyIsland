export type DeviceTier = 'low' | 'medium' | 'high';

export interface DeviceInfo {
  /** Touch is the main input (phones and tablets). */
  touch: boolean;
  /** A phone or a small tablet. */
  mobile: boolean;
  ios: boolean;
  /** Short side of the screen in CSS pixels. */
  shortSide: number;
  cores: number;
  /** Approximate RAM in GB (Chrome only), 0 if unknown. */
  memory: number;
  /** The quality the device can probably sustain. */
  tier: DeviceTier;
  /** Can the page go fullscreen (iPhone Safari can't)? */
  fullscreen: boolean;
}

let cached: DeviceInfo | null = null;

/**
 * What kind of device this is. Add `?device=phone|tablet|desktop` to the URL to pretend
 * (handy for testing), or `?quality=low|medium|high` to force the tier.
 */
export function detectDevice(): DeviceInfo {
  if (cached) return cached;
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  const ua = nav?.userAgent ?? '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav?.platform === 'MacIntel' && (nav?.maxTouchPoints ?? 0) > 1);
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const shortSide = typeof screen === 'undefined' ? 1000 : Math.min(screen.width, screen.height);
  const cores = nav?.hardwareConcurrency ?? 4;
  const memory = (nav as unknown as { deviceMemory?: number } | null)?.deviceMemory ?? 0;

  let touch = coarse || ((nav?.maxTouchPoints ?? 0) > 0 && /Android|Mobile|iPhone|iPad/.test(ua));
  let mobile = touch && shortSide <= 900;
  const forced = params.get('device');
  if (forced === 'phone') {
    touch = true;
    mobile = true;
  } else if (forced === 'tablet') {
    touch = true;
    mobile = false;
  } else if (forced === 'desktop') {
    touch = false;
    mobile = false;
  }

  let tier: DeviceTier = 'high';
  if (mobile) tier = (memory > 0 && memory <= 3) || cores <= 4 ? 'low' : 'medium';
  else if (touch) tier = 'medium';
  else if ((memory > 0 && memory <= 4) || cores <= 4) tier = 'medium';
  const q = params.get('quality');
  if (q === 'low' || q === 'medium' || q === 'high') tier = q;

  cached = {
    touch,
    mobile,
    ios,
    shortSide,
    cores,
    memory,
    tier,
    fullscreen: typeof document !== 'undefined' && !!document.documentElement.requestFullscreen,
  };
  return cached;
}
