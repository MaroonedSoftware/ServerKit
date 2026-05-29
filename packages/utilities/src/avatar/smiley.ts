// Deterministic minimal smiley avatar: a seeded solid face with simple dot/arc
// eyes and a positive-leaning smile. Lighter weight than the full blob face.

import { AvatarPaletteOptions, AvatarSizeOptions, DEFAULT_LINE_COLOR, derivePalette, digest, wrapSvg } from './shared.js';

/** Options for {@link generateSmileyAvatarSvg}. */
export interface SmileyAvatarOptions extends AvatarSizeOptions, AvatarPaletteOptions {
  /** Color of the eyes and smile. Default {@link DEFAULT_LINE_COLOR}. */
  lineColor?: string;
}

/**
 * Deterministic minimal smiley avatar for `seed`. Returns a standalone SVG
 * string; the same seed always yields the same SVG.
 *
 * @param seed - Stable identifier to seed the avatar.
 * @param options - Optional color/size overrides.
 * @returns A standalone `<svg>` string on a `0 0 100 100` viewBox.
 *
 * @example
 * ```typescript
 * generateSmileyAvatarSvg('hello');
 * generateSmileyAvatarSvg('hello', { hue: 45, lineColor: '#222' });
 * ```
 */
export const generateSmileyAvatarSvg = (seed: string, options: SmileyAvatarOptions = {}): string => {
  const h = digest(seed);
  const size = options.size ?? 100;
  const cornerRadius = options.cornerRadius ?? 50;
  const LINE = options.lineColor ?? DEFAULT_LINE_COLOR;
  const { fc, bg } = derivePalette(h, options);

  let body = `<circle cx="50" cy="50" r="34" fill="${fc}" stroke="${LINE}" stroke-width="2.5"/>`;

  // Eyes.
  const eyeV = h[1]! % 3;
  if (eyeV === 0) body += `<circle cx="40" cy="44" r="3.5" fill="${LINE}"/><circle cx="60" cy="44" r="3.5" fill="${LINE}"/>`;
  else if (eyeV === 1)
    body +=
      `<path d="M36 45 Q40 40 44 45" stroke="${LINE}" stroke-width="2.6" fill="none" stroke-linecap="round"/>` +
      `<path d="M56 45 Q60 40 64 45" stroke="${LINE}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
  else
    body +=
      `<circle cx="40" cy="44" r="4.5" fill="#fff" stroke="${LINE}" stroke-width="1.5"/><circle cx="40" cy="44.5" r="2.2" fill="${LINE}"/>` +
      `<circle cx="60" cy="44" r="4.5" fill="#fff" stroke="${LINE}" stroke-width="1.5"/><circle cx="60" cy="44.5" r="2.2" fill="${LINE}"/>`;

  // Smile — curvature seeded, always positive-leaning.
  const depth = [8, 12, 16][h[2]! % 3]!;
  body += `<path d="M38 60 Q50 ${60 + depth} 62 60" stroke="${LINE}" stroke-width="3" fill="none" stroke-linecap="round"/>`;

  return wrapSvg(size, cornerRadius, bg, body);
};
