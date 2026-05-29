// Deterministic abstract geometric avatar: a tinted background overlaid with a
// seeded set of translucent triangles, squares, and circles. Non-figurative.

import { AvatarSizeOptions, digest, hsl, hueFromHash, join, wrapSvg } from './shared.js';

/** Options for {@link generateGeometricSvg}. */
export interface GeometricAvatarOptions extends AvatarSizeOptions {
  /** Pin the base hue (0–360). Default: derived from the first hash byte. */
  hue?: number;
  /** Degrees spanned across the shape palette as shapes are added. Default `90`. */
  hueSpread?: number;
  /** Shape saturation. Default `58`. */
  saturation?: number;
  /** Shape lightness. Default `55`. */
  lightness?: number;
  /** Background lightness. Default `90`. */
  backgroundLightness?: number;
  /** Number of overlaid shapes. Default `5`. */
  shapeCount?: number;
  /** Explicit color palette for the shapes; overrides the hue-derived tints. */
  palette?: string[];
}

/**
 * Deterministic abstract geometric avatar for `seed`. Returns a standalone SVG
 * string; the same seed always yields the same SVG.
 *
 * @param seed - Stable identifier to seed the avatar.
 * @param options - Optional color/size/shape overrides.
 * @returns A standalone `<svg>` string on a `0 0 100 100` viewBox.
 *
 * @example
 * ```typescript
 * generateGeometricSvg('team-7');
 * generateGeometricSvg('team-7', { shapeCount: 7, palette: ['#1d4ed8', '#9333ea'] });
 * ```
 */
export const generateGeometricSvg = (seed: string, options: GeometricAvatarOptions = {}): string => {
  const h = digest(seed);
  const size = options.size ?? 100;
  const cornerRadius = options.cornerRadius ?? 12;
  const hue = options.hue ?? hueFromHash(h);
  const hueSpread = options.hueSpread ?? 90;
  const saturation = options.saturation ?? 58;
  const lightness = options.lightness ?? 55;
  const backgroundLightness = options.backgroundLightness ?? 90;
  const shapeCount = options.shapeCount ?? 5;
  const palette = options.palette;
  const bg = hsl(hue, saturation, backgroundLightness);

  const byte = (n: number): number => h[n % h.length]!;

  let body = '';
  for (let i = 0; i < shapeCount; i++) {
    const o = i * 4;
    const fill =
      palette && palette.length > 0
        ? palette[byte(o) % palette.length]!
        : hsl(Math.round((hue + (i / shapeCount) * hueSpread) % 360), saturation, lightness);
    const opacity = (0.55 + (byte(o + 1) / 255) * 0.4).toFixed(2);
    const cx = 18 + (byte(o + 2) / 255) * 64;
    const cy = 18 + (byte(o + 3) / 255) * 64;
    const r = 14 + (byte(o) / 255) * 22;
    const kind = byte(o + 1) % 3;
    const rot = byte(o + 2) % 360;

    if (kind === 0) {
      body += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" opacity="${opacity}"/>`;
    } else if (kind === 1) {
      body += `<path d="${join('M', cx.toFixed(1), (cy - r).toFixed(1), 'L', (cx + r).toFixed(1), (cy + r).toFixed(1), 'L', (cx - r).toFixed(1), (cy + r).toFixed(1), 'Z')}" fill="${fill}" opacity="${opacity}" transform="rotate(${rot} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`;
    } else {
      body += `<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" rx="3" fill="${fill}" opacity="${opacity}" transform="rotate(${rot} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`;
    }
  }
  return wrapSvg(size, cornerRadius, bg, body);
};
