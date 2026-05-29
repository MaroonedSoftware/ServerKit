// Unified dispatcher over the avatar styles. Each style keeps its own typed
// options via a discriminated union on `style`; the default style is `face`.

import { FaceAvatarOptions, generateFaceAvatarSvg } from './face.js';
import { GeometricAvatarOptions, generateGeometricSvg } from './geometric.js';
import { GradientSwirlOptions, generateGradientSwirlSvg } from './gradient.js';
import { IdenticonOptions, generateIdenticonSvg } from './identicon.js';
import { SmileyAvatarOptions, generateSmileyAvatarSvg } from './smiley.js';

/** Supported avatar styles. */
export type AvatarStyle = 'face' | 'identicon' | 'geometric' | 'gradient' | 'smiley';

/** Style selector plus the options for the selected style. Defaults to `face`. */
export type AvatarSpec =
  | ({ style?: 'face' } & FaceAvatarOptions)
  | ({ style: 'identicon' } & IdenticonOptions)
  | ({ style: 'geometric' } & GeometricAvatarOptions)
  | ({ style: 'gradient' } & GradientSwirlOptions)
  | ({ style: 'smiley' } & SmileyAvatarOptions);

/**
 * Generate a deterministic avatar SVG for `seed` in the requested style. The
 * same seed and spec always yield the same SVG. Omitting `style` produces a
 * `face` avatar, equivalent to {@link generateFaceAvatarSvg}.
 *
 * @param seed - Stable identifier to seed the avatar.
 * @param spec - Style selector and that style's options.
 * @returns A standalone `<svg>` string on a `0 0 100 100` viewBox.
 *
 * @example
 * ```typescript
 * generateAvatar('user-123');
 * generateAvatar('acme-inc', { style: 'identicon', grid: 7 });
 * generateAvatar('proj-42', { style: 'gradient', gradientType: 'radial' });
 * ```
 */
export const generateAvatar = (seed: string, spec: AvatarSpec = {}): string => {
  switch (spec.style) {
    case 'identicon':
      return generateIdenticonSvg(seed, spec);
    case 'geometric':
      return generateGeometricSvg(seed, spec);
    case 'gradient':
      return generateGradientSwirlSvg(seed, spec);
    case 'smiley':
      return generateSmileyAvatarSvg(seed, spec);
    case 'face':
    default:
      return generateFaceAvatarSvg(seed, spec);
  }
};
