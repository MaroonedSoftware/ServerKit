// Deterministic gradient-swirl avatar: a seeded two-stop gradient background
// with translucent rotated arc overlays for a soft, modern look.

import { AvatarSizeOptions, digest, gradientId, hsl, hueFromHash, join, wrapSvg } from './shared.js';

/** Options for {@link generateGradientSwirlSvg}. */
export interface GradientSwirlOptions extends AvatarSizeOptions {
  /** Pin the base hue (0–360). Default: derived from the first hash byte. */
  hue?: number;
  /** Degrees between the two gradient stops. Default `70`. */
  hueSpread?: number;
  /** Gradient saturation. Default `70`. */
  saturation?: number;
  /** Gradient lightness. Default `58`. */
  lightness?: number;
  /** Gradient geometry. Default: seeded by a hash byte. */
  gradientType?: 'linear' | 'radial';
}

/**
 * Deterministic gradient-swirl avatar for `seed`. Returns a standalone SVG
 * string; the same seed always yields the same SVG. Gradient element ids are
 * seed-derived, so multiple gradient avatars can be inlined on one page without
 * colliding.
 *
 * @param seed - Stable identifier to seed the avatar.
 * @param options - Optional color/size/gradient overrides.
 * @returns A standalone `<svg>` string on a `0 0 100 100` viewBox.
 *
 * @example
 * ```typescript
 * generateGradientSwirlSvg('proj-42');
 * generateGradientSwirlSvg('proj-42', { gradientType: 'radial', hue: 280 });
 * ```
 */
export const generateGradientSwirlSvg = (seed: string, options: GradientSwirlOptions = {}): string => {
  const h = digest(seed);
  const size = options.size ?? 100;
  const cornerRadius = options.cornerRadius ?? 50;
  const hue = options.hue ?? hueFromHash(h);
  const hueSpread = options.hueSpread ?? 70;
  const saturation = options.saturation ?? 70;
  const lightness = options.lightness ?? 58;
  const gradientType = options.gradientType ?? (h[1]! % 2 === 0 ? 'linear' : 'radial');
  const id = gradientId(h);

  const c1 = hsl(hue, saturation, lightness);
  const c2 = hsl((hue + hueSpread) % 360, saturation, Math.max(0, lightness - 8));

  const angle = h[2]! % 360;
  const defs =
    gradientType === 'linear'
      ? `<defs><linearGradient id="${id}" gradientTransform="rotate(${angle} 0.5 0.5)"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs>`
      : `<defs><radialGradient id="${id}" cx="${(30 + (h[3]! / 255) * 40).toFixed(0)}%" cy="${(30 + (h[4]! / 255) * 40).toFixed(0)}%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></radialGradient></defs>`;

  // Translucent arc overlays in a lighter accent tint for the "swirl".
  const accent = hsl((hue + hueSpread / 2) % 360, saturation, Math.min(100, lightness + 22));
  let body = '';
  for (let i = 0; i < 3; i++) {
    const o = 5 + i * 3;
    const rot = h[o]! % 360;
    const rr = 24 + (h[o + 1]! / 255) * 30;
    const sweep = h[o + 2]! % 2;
    body += `<path d="${join('M', 50, 50, 'm', (-rr).toFixed(1), 0, 'a', rr.toFixed(1), rr.toFixed(1), 0, 0, sweep, (rr * 2).toFixed(1), 0)}" fill="none" stroke="${accent}" stroke-width="${4 + (h[o]! % 6)}" stroke-linecap="round" opacity="0.35" transform="rotate(${rot} 50 50)"/>`;
  }

  return wrapSvg(size, cornerRadius, `url(#${id})`, body, defs);
};
