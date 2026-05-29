// Deterministic, horizontally-mirrored geometric identicon — well suited to
// organizations/businesses. Cells are toggled by bits of the seed hash and
// mirrored across the vertical axis for a balanced, logo-like glyph.

import { AvatarSizeOptions, digest, hsl, hueFromHash, wrapSvg } from './shared.js';

/** Options for {@link generateIdenticonSvg}. All default to the original hand-tuned values. */
export interface IdenticonOptions extends AvatarSizeOptions {
  /** Outer margin around the cell grid, in viewBox units. Default `12.5`. */
  margin?: number;
  /** Cell size (and spacing), in viewBox units. Default `15`. */
  cell?: number;
  /** Number of rows; columns mirror across the vertical axis to this width. Default `5`. */
  grid?: number;
  /** Pin the hue (0–360). Default: derived from the first hash byte. */
  hue?: number;
  /** Foreground (cell) saturation. Default `55`. */
  foregroundSaturation?: number;
  /** Foreground (cell) lightness. Default `46`. */
  foregroundLightness?: number;
  /** Background saturation. Default `25`. */
  backgroundSaturation?: number;
  /** Background lightness. Default `93`. */
  backgroundLightness?: number;
}

/**
 * Deterministic geometric identicon for `seed`. Returns a standalone SVG string;
 * the same seed always yields the same SVG. Passing no `options` reproduces the
 * original output exactly.
 *
 * @param seed - Stable identifier to seed the identicon (e.g. an entity id).
 * @param options - Optional color/size/grid overrides.
 * @returns A standalone `<svg>` string on a `0 0 100 100` viewBox.
 *
 * @example
 * ```typescript
 * generateIdenticonSvg('acme-inc');
 * generateIdenticonSvg('acme-inc', { grid: 7, hue: 210 });
 * ```
 */
export const generateIdenticonSvg = (seed: string, options: IdenticonOptions = {}): string => {
  const h = digest(seed);
  const size = options.size ?? 100;
  const cornerRadius = options.cornerRadius ?? 12;
  const margin = options.margin ?? 12.5;
  const grid = options.grid ?? 5;
  const cell = options.cell ?? 15;
  const hue = options.hue ?? hueFromHash(h);
  const fg = hsl(hue, options.foregroundSaturation ?? 55, options.foregroundLightness ?? 46);
  const bg = hsl(hue, options.backgroundSaturation ?? 25, options.backgroundLightness ?? 93);

  // Only the left half (plus a center column for odd grids) is generated; the
  // rest is mirrored. Default grid=5 reproduces the original 15-cell pattern.
  const cols = Math.ceil(grid / 2);
  const center = grid % 2 === 1 ? (grid - 1) / 2 : -1;

  let rects = '';
  for (let n = 0; n < cols * grid; n++) {
    if (((h[1 + (n >> 3)]! >> (n & 7)) & 1) === 0) continue;
    const col = Math.floor(n / grid);
    const row = n % grid;
    const columns = col === center ? [col] : [col, grid - 1 - col];
    for (const c of columns) {
      rects += `<rect x="${(margin + c * cell).toFixed(1)}" y="${(margin + row * cell).toFixed(1)}" width="${cell}" height="${cell}" rx="2"/>`;
    }
  }
  return wrapSvg(size, cornerRadius, bg, `<g fill="${fg}">${rects}</g>`);
};
