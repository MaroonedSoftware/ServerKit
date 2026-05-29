// Deterministic raceless cartoon "blob" face avatar. The abstract head color is
// never a skin tone, so it implies no ethnicity. Every feature (face shape,
// eyes, brows, mouth, topper) is indexed off a distinct byte of the seed hash.

import {
  AvatarPaletteOptions,
  AvatarSizeOptions,
  DEFAULT_LINE_COLOR,
  DEFAULT_MOUTH_COLOR,
  DEFAULT_TONGUE_COLOR,
  DEFAULT_TOPPER_COLORS,
  derivePalette,
  digest,
  join,
  star,
  wrapSvg,
} from './shared.js';

/** Options for {@link generateFaceAvatarSvg}. All default to the original hand-tuned values. */
export interface FaceAvatarOptions extends AvatarSizeOptions, AvatarPaletteOptions {
  /** Outline/stroke color. Default {@link DEFAULT_LINE_COLOR}. */
  lineColor?: string;
  /** Mouth color. Default {@link DEFAULT_MOUTH_COLOR}. */
  mouthColor?: string;
  /** Tongue color. Default {@link DEFAULT_TONGUE_COLOR}. */
  tongueColor?: string;
  /** Accent palette for hats/hairdos. Default {@link DEFAULT_TOPPER_COLORS}. */
  topperColors?: string[];
}

/**
 * Deterministic raceless cartoon-face avatar for `seed`. Returns a standalone
 * SVG string; the same seed always yields the same SVG. Passing no `options`
 * reproduces the original output exactly.
 *
 * @param seed - Stable identifier to seed the avatar (e.g. an entity id).
 * @param options - Optional color/size overrides.
 * @returns A standalone `<svg>` string on a `0 0 100 100` viewBox.
 *
 * @example
 * ```typescript
 * generateFaceAvatarSvg('user-123');
 * generateFaceAvatarSvg('user-123', { size: 256, lineColor: '#111' });
 * ```
 */
export const generateFaceAvatarSvg = (seed: string, options: FaceAvatarOptions = {}): string => {
  const h = digest(seed);
  const size = options.size ?? 100;
  const cornerRadius = options.cornerRadius ?? 50;
  const LINE = options.lineColor ?? DEFAULT_LINE_COLOR;
  const MOUTH = options.mouthColor ?? DEFAULT_MOUTH_COLOR;
  const TONGUE = options.tongueColor ?? DEFAULT_TONGUE_COLOR;
  const TOPPER_COLORS = options.topperColors ?? DEFAULT_TOPPER_COLORS;

  const { fc, faceD, bg, HC } = derivePalette(h, options);
  const hat = TOPPER_COLORS[h[8]! % TOPPER_COLORS.length]!;

  const eyeV = h[1]! % 5;
  const mV = h[2]! % 8;
  const shapeV = h[3]! % 3;
  const blush = h[4]! % 2 === 0;
  const topV = h[5]! % 16;
  const showTop = h[7]! % 5 > 0;
  const browV = h[6]! % 2;

  const { rx, ry } = [
    { rx: 31, ry: 31 },
    { rx: 28, ry: 33 },
    { rx: 34, ry: 29 },
  ][shapeV]!;
  const cx = 50;
  const cy = 53;
  const topY = cy - ry;

  const hs = ` fill="${HC}" stroke="${LINE}" stroke-width="2"`;
  const hatS = ` fill="${hat}" stroke="${LINE}" stroke-width="2"`;

  let s = '';

  // Ears (same abstract head color).
  s += `<circle cx="${cx - rx + 2}" cy="${cy + 3}" r="5" fill="${fc}" stroke="${LINE}" stroke-width="2"/>`;
  s += `<circle cx="${cx + rx - 2}" cy="${cy + 3}" r="5" fill="${fc}" stroke="${LINE}" stroke-width="2"/>`;

  // Topper (drawn behind the head so it tucks under the crown).
  if (showTop) {
    if (topV === 0)
      s +=
        `<g stroke="${HC}" stroke-width="3" stroke-linecap="round" fill="none"><path d="${join('M44', topY + 5, 'L40', topY - 9)}"/><path d="${join('M56', topY + 5, 'L60', topY - 9)}"/></g>` +
        `<circle cx="40" cy="${topY - 10}" r="3.2" fill="${HC}" stroke="${LINE}" stroke-width="1"/><circle cx="60" cy="${topY - 10}" r="3.2" fill="${HC}" stroke="${LINE}" stroke-width="1"/>`;
    else if (topV === 1)
      s += `<path d="${join('M', cx - 20, topY + 9, 'L', cx - 15, topY - 8, 'L', cx - 9, topY + 4, 'L', cx - 3, topY - 13, 'L', cx + 3, topY + 3, 'L', cx + 9, topY - 10, 'L', cx + 15, topY + 5, 'L', cx + 20, topY - 6, 'L', cx + 21, topY + 9, 'Z')}"${hs}/>`;
    else if (topV === 2)
      s += `<path d="${join('M', cx - 7, topY + 10, 'L', cx - 3, topY - 18, 'L', cx, topY + 2, 'L', cx + 3, topY - 18, 'L', cx + 7, topY + 10, 'Z')}"${hs}/>`;
    else if (topV === 3)
      s += `<path d="${join('M', cx, topY + 4, 'q -3', -14, '9', -14, 'q 9 0 3 9')}" fill="none" stroke="${HC}" stroke-width="3.4" stroke-linecap="round"/>`;
    else if (topV === 4)
      s +=
        `<path d="${join('M', cx - 13, topY + 6, 'L', cx - 20, topY - 9, 'L', cx - 7, topY + 1, 'Z')}"${hs}/>` +
        `<path d="${join('M', cx + 13, topY + 6, 'L', cx + 20, topY - 9, 'L', cx + 7, topY + 1, 'Z')}"${hs}/>`;
    else if (topV === 5)
      s += `<path d="${join('M', cx - 19, topY + 8, 'a8 8 0 0 1 6 -13', 'a9 9 0 0 1 13 -4', 'a9 9 0 0 1 13 4', 'a8 8 0 0 1 6 13', 'Z')}"${hs}/>`;
    else if (topV === 6)
      s += `<g stroke="${LINE}" stroke-width="1.6"><path d="${join('M50', topY + 2, 'L50', topY - 9)}"/><path d="${join('M50', topY - 8, 'q9 -3 11 -11', 'q-10 1 -11 9 Z')}" fill="hsl(140 50% 52%)"/></g>`;
    else if (topV === 7) s += `<circle cx="${cx - 15}" cy="${topY + 1}" r="7"${hs}/><circle cx="${cx + 15}" cy="${topY + 1}" r="7"${hs}/>`;
    else if (topV === 8)
      s +=
        `<path d="${join('M', cx - rx + 3, topY + 12, 'Q', cx, topY - 12, cx + rx - 3, topY + 12, 'Z')}"${hatS}/>` +
        `<rect x="${cx - rx + 3}" y="${topY + 9}" width="${2 * rx - 6}" height="6" rx="3"${hatS}/>` +
        `<circle cx="${cx}" cy="${topY - 11}" r="4"${hatS}/>`;
    else if (topV === 9)
      s +=
        `<rect x="${cx - 12}" y="${topY - 16}" width="24" height="22" rx="2" fill="#2b2b2b" stroke="${LINE}" stroke-width="2"/>` +
        `<rect x="${cx - 12}" y="${topY - 2}" width="24" height="5" fill="${hat}"/>` +
        `<ellipse cx="${cx}" cy="${topY + 7}" rx="${rx - 6}" ry="4" fill="#2b2b2b" stroke="${LINE}" stroke-width="2"/>`;
    else if (topV === 10)
      s +=
        `<path d="${join('M', cx - 18, topY + 9, 'a18 16 0 0 1 36 0', 'Z')}"${hatS}/>` +
        `<path d="${join('M', cx + 2, topY + 9, 'q22 0 25 6', 'q-13 3 -25 -1', 'Z')}"${hatS}/>` +
        `<circle cx="${cx}" cy="${topY - 6}" r="2.5" fill="${LINE}"/>`;
    else if (topV === 11)
      s +=
        `<path d="${join('M', cx, topY - 19, 'L', cx - 12, topY + 9, 'L', cx + 12, topY + 9, 'Z')}"${hatS}/>` +
        `<circle cx="${cx}" cy="${topY - 20}" r="3" fill="#fff" stroke="${LINE}" stroke-width="1.5"/>` +
        `<circle cx="${cx - 4}" cy="${topY - 2}" r="1.8" fill="#fff"/><circle cx="${cx + 5}" cy="${topY + 4}" r="1.8" fill="#fff"/>`;
    else if (topV === 12)
      s +=
        `<path d="${join('M', cx - 16, topY + 9, 'L', cx - 16, topY - 4, 'L', cx - 8, topY + 2, 'L', cx, topY - 9, 'L', cx + 8, topY + 2, 'L', cx + 16, topY - 4, 'L', cx + 16, topY + 9, 'Z')}" fill="#E8B84B" stroke="${LINE}" stroke-width="2"/>` +
        `<circle cx="${cx}" cy="${topY - 2}" r="2" fill="#E0533D"/>`;
    else if (topV === 13)
      s +=
        `<path d="${join('M', cx - 21, cy - 2, 'a21 21 0 0 1 42 0')}" fill="none" stroke="${hat}" stroke-width="4"/>` +
        `<rect x="${cx - 25}" y="${cy - 4}" width="7" height="12" rx="3"${hatS}/><rect x="${cx + 18}" y="${cy - 4}" width="7" height="12" rx="3"${hatS}/>`;
    else if (topV === 14) {
      const fx = cx - 12;
      const fy = topY + 2;
      for (let i = 0; i < 5; i++) {
        const a = (i * 2 * Math.PI) / 5;
        s += `<circle cx="${(fx + 5 * Math.cos(a)).toFixed(1)}" cy="${(fy + 5 * Math.sin(a)).toFixed(1)}" r="3.4" fill="${hat}" stroke="${LINE}" stroke-width="1.2"/>`;
      }
      s += `<circle cx="${fx}" cy="${fy}" r="3" fill="#F4D03F" stroke="${LINE}" stroke-width="1"/>`;
    } else
      s +=
        `<path d="${join('M', cx, topY + 5, 'L', cx - 12, topY - 2, 'L', cx - 12, topY + 12, 'Z')}"${hatS}/>` +
        `<path d="${join('M', cx, topY + 5, 'L', cx + 12, topY - 2, 'L', cx + 12, topY + 12, 'Z')}"${hatS}/>` +
        `<circle cx="${cx}" cy="${topY + 5}" r="3.2"${hatS}/>`;
  }

  // Head + subtle top highlight.
  s += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fc}" stroke="${LINE}" stroke-width="2.5"/>`;
  s += `<path d="${join('M', cx - rx + 6, topY + 10, 'q', rx, -15, 2 * rx - 12, 0)}" stroke="#fff" stroke-width="3" fill="none" opacity="0.18" stroke-linecap="round"/>`;
  if (blush)
    s +=
      `<ellipse cx="${cx - 15}" cy="${cy + 10}" rx="5" ry="3" fill="${faceD}" opacity="0.7"/>` +
      `<ellipse cx="${cx + 15}" cy="${cy + 10}" rx="5" ry="3" fill="${faceD}" opacity="0.7"/>`;

  // Brows.
  if (browV === 0)
    s +=
      `<path d="M35 43 q5 -2 10 0" stroke="${LINE}" stroke-width="2" fill="none" stroke-linecap="round"/>` +
      `<path d="M55 43 q5 -2 10 0" stroke="${LINE}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  else
    s +=
      `<path d="M35 41 h10" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>` +
      `<path d="M55 41 h10" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>`;

  // Eyes (positive-leaning).
  if (eyeV === 0)
    s +=
      `<circle cx="40" cy="50" r="4.2" fill="#fff" stroke="${LINE}" stroke-width="1.5"/><circle cx="40.6" cy="50.6" r="2" fill="${LINE}"/><circle cx="39.4" cy="49" r="0.9" fill="#fff"/>` +
      `<circle cx="60" cy="50" r="4.2" fill="#fff" stroke="${LINE}" stroke-width="1.5"/><circle cx="60.6" cy="50.6" r="2" fill="${LINE}"/><circle cx="59.4" cy="49" r="0.9" fill="#fff"/>`;
  else if (eyeV === 1)
    s +=
      `<path d="M36 51 Q40 45 44 51" stroke="${LINE}" stroke-width="2.6" fill="none" stroke-linecap="round"/>` +
      `<path d="M56 51 Q60 45 64 51" stroke="${LINE}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
  else if (eyeV === 2) s += `<circle cx="40" cy="50" r="3" fill="${LINE}"/><circle cx="60" cy="50" r="3" fill="${LINE}"/>`;
  else if (eyeV === 3)
    s +=
      `<circle cx="40" cy="50" r="5" fill="#fff" stroke="${LINE}" stroke-width="1.5"/><circle cx="40" cy="50.5" r="2.4" fill="${LINE}"/>` +
      `<circle cx="60" cy="50" r="5" fill="#fff" stroke="${LINE}" stroke-width="1.5"/><circle cx="60" cy="50.5" r="2.4" fill="${LINE}"/>`;
  else
    s += `<path d="${star(40, 50, 4.5)}" fill="#F4C430" stroke="${LINE}" stroke-width="1"/><path d="${star(60, 50, 4.5)}" fill="#F4C430" stroke="${LINE}" stroke-width="1"/>`;

  // Mouth — mapped so the flat mouth is only 1/8; everything else is a smile.
  const mouth = [0, 1, 2, 0, 3, 4, 0, 9][mV]!;
  if (mouth === 0) s += `<path d="M41 64 Q50 71 59 64" stroke="${MOUTH}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
  if (mouth === 1) s += `<path d="M41 63 Q50 74 59 63 Z" fill="${MOUTH}"/>`;
  if (mouth === 2) s += `<path d="M40 63 Q50 75 60 63 Z" fill="${MOUTH}"/><path d="M43 64 Q50 69 57 64 Z" fill="#fff"/>`;
  if (mouth === 3)
    s +=
      `<path d="M41 63 Q50 72 59 63" stroke="${MOUTH}" stroke-width="2.8" fill="none" stroke-linecap="round"/>` +
      `<path d="M47 67 q3 5 6 0 Z" fill="${TONGUE}" stroke="${LINE}" stroke-width="0.8"/>`;
  if (mouth === 4) s += `<path d="M38 62 Q50 78 62 62 Q50 68 38 62 Z" fill="${MOUTH}"/><path d="M42 63 Q50 67 58 63 Z" fill="#fff"/>`;
  if (mouth === 9) s += `<path d="M44 66 H56" stroke="${MOUTH}" stroke-width="2.8" stroke-linecap="round"/>`;

  return wrapSvg(size, cornerRadius, bg, s);
};
