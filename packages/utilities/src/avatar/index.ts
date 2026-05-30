// Public surface of the avatar generators. The drawing helpers in `shared.ts`
// stay internal to this folder; only the styles, options, and shared defaults
// are re-exported.

export {
  DEFAULT_LINE_COLOR,
  DEFAULT_MOUTH_COLOR,
  DEFAULT_TONGUE_COLOR,
  DEFAULT_TOPPER_COLORS,
  type AvatarPaletteOptions,
  type AvatarSizeOptions,
} from './shared.js';
export * from './cityscape.js';
export * from './face.js';
export * from './identicon.js';
export * from './geometric.js';
export * from './gradient.js';
export * from './smiley.js';
export * from './generate.avatar.js';
export * from './data.uri.js';
