// Shared building blocks for the deterministic, dependency-free SVG avatar
// generators. Every generator seeds its features off bytes of the SHA-256 of
// the input string, so the same seed always yields the same SVG, and draws on a
// fixed `0 0 100 100` viewBox so `size` only changes the rendered width/height.

import { createHash } from 'node:crypto';

/**
 * Bright, deliberately non-natural accent colors used for the face style's
 * hats/hairdos. Exported so callers can extend or replace the palette.
 */
export const DEFAULT_TOPPER_COLORS = ['#E0533D', '#3E8E7E', '#3D6FB4', '#E0A03D', '#8E5BB5', '#D14B8F', '#2BA0A0'];

/** Default outline/stroke color shared by the face and smiley styles. */
export const DEFAULT_LINE_COLOR = '#2E2A26';

/** Default mouth color for the face style. */
export const DEFAULT_MOUTH_COLOR = '#7a2f24';

/** Default tongue color for the face style. */
export const DEFAULT_TONGUE_COLOR = '#E06A8B';

/** Size and corner-radius options common to every avatar style. */
export interface AvatarSizeOptions {
  /** Rendered `width`/`height` in pixels. The viewBox stays `0 0 100 100`, so this only scales the output. Default `100`. */
  size?: number;
  /** Background rectangle corner radius, in viewBox units. Per-style default. */
  cornerRadius?: number;
}

/**
 * Palette-derivation options shared by the face-based styles (`face`, `smiley`).
 * Each value defaults to the original hand-tuned constant, so omitting all of
 * them reproduces the original output.
 */
export interface AvatarPaletteOptions {
  /** Pin the hue (0–360). Default: derived from the first hash byte. */
  hue?: number;
  /** Face fill saturation. Default `52`. */
  faceSaturation?: number;
  /** Face fill lightness. Default `63`. */
  faceLightness?: number;
  /** Darker face accent (blush) saturation. Default `48`. */
  faceDarkSaturation?: number;
  /** Darker face accent (blush) lightness. Default `54`. */
  faceDarkLightness?: number;
  /** Background saturation. Default `42`. */
  backgroundSaturation?: number;
  /** Background lightness. Default `92`. */
  backgroundLightness?: number;
  /** Hue offset (degrees) for the accent color used by hairdos/toppers. Default `170`. */
  accentHueOffset?: number;
  /** Accent color saturation. Default `72`. */
  accentSaturation?: number;
  /** Accent color lightness. Default `58`. */
  accentLightness?: number;
}

/** SHA-256 digest of the seed; each generator indexes distinct bytes off it. */
export const digest = (seed: string): Buffer => createHash('sha256').update(seed).digest();

/** Map the first digest byte to a hue in [0, 360]. */
export const hueFromHash = (h: Buffer): number => Math.round((h[0]! / 255) * 360);

/** Build an HSL color string using the space-separated CSS Color 4 syntax. */
export const hsl = (h: number, s: number, l: number): string => `hsl(${h} ${s}% ${l}%)`;

/**
 * A short, seed-derived id for `<defs>` gradients, so multiple gradient avatars
 * inlined on the same page don't collide on a shared element id.
 */
export const gradientId = (h: Buffer): string => `a${h[0]!}${h[1]!}${h[2]!}`;

/** Join SVG path/value parts with spaces. */
export const join = (...parts: Array<string | number>): string => parts.join(' ');

/** A five-pointed star path centered at (cx, cy) with outer radius r. */
export const star = (cx: number, cy: number, r: number): string => {
  let p = '';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const a2 = a + Math.PI / 5;
    p +=
      (i ? ' L' : 'M') +
      `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}` +
      ` L${(cx + r * 0.45 * Math.cos(a2)).toFixed(1)} ${(cy + r * 0.45 * Math.sin(a2)).toFixed(1)}`;
  }
  return `${p} Z`;
};

/** The per-seed palette for the face-based styles. */
export interface AvatarPalette {
  /** Resolved hue (0–360). */
  hue: number;
  /** Face fill color. */
  fc: string;
  /** Darker face accent (blush) color. */
  faceD: string;
  /** Background color. */
  bg: string;
  /** Accent color for hairdos/toppers. */
  HC: string;
}

/** Derive the face-style palette from the digest, honoring palette overrides. */
export const derivePalette = (h: Buffer, opts: AvatarPaletteOptions = {}): AvatarPalette => {
  const hue = opts.hue ?? hueFromHash(h);
  return {
    hue,
    fc: hsl(hue, opts.faceSaturation ?? 52, opts.faceLightness ?? 63),
    faceD: hsl(hue, opts.faceDarkSaturation ?? 48, opts.faceDarkLightness ?? 54),
    bg: hsl(hue, opts.backgroundSaturation ?? 42, opts.backgroundLightness ?? 92),
    HC: hsl((hue + (opts.accentHueOffset ?? 170)) % 360, opts.accentSaturation ?? 72, opts.accentLightness ?? 58),
  };
};

/**
 * Wrap drawing `body` in the standard rounded-rect SVG envelope. Drawing always
 * happens on the `0 0 100 100` viewBox; `size` only sets the rendered dimensions.
 * Optional `defs` are emitted before the background rect (used by gradients).
 */
export const wrapSvg = (size: number, cornerRadius: number, background: string, body: string, defs = ''): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">${defs}<rect width="100" height="100" rx="${cornerRadius}" fill="${background}"/>${body}</svg>`;
