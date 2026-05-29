import { describe, it, expect } from 'vitest';
import { generateAvatar } from '../../src/avatar/generate.avatar.js';
import { generateFaceAvatarSvg } from '../../src/avatar/face.js';
import { generateIdenticonSvg } from '../../src/avatar/identicon.js';
import { generateGeometricSvg } from '../../src/avatar/geometric.js';
import { generateGradientSwirlSvg } from '../../src/avatar/gradient.js';
import { generateSmileyAvatarSvg } from '../../src/avatar/smiley.js';
import { toDataUri } from '../../src/avatar/data.uri.js';

describe('generateAvatar', () => {
  it('defaults to the face style', () => {
    expect(generateAvatar('user-123')).toBe(generateFaceAvatarSvg('user-123'));
    expect(generateAvatar('user-123', { style: 'face' })).toBe(generateFaceAvatarSvg('user-123'));
  });

  it('routes each style to its matching generator with the same options', () => {
    expect(generateAvatar('s', { style: 'identicon', grid: 7 })).toBe(generateIdenticonSvg('s', { grid: 7 }));
    expect(generateAvatar('s', { style: 'geometric', shapeCount: 4 })).toBe(generateGeometricSvg('s', { shapeCount: 4 }));
    expect(generateAvatar('s', { style: 'gradient', gradientType: 'radial' })).toBe(generateGradientSwirlSvg('s', { gradientType: 'radial' }));
    expect(generateAvatar('s', { style: 'smiley', hue: 45 })).toBe(generateSmileyAvatarSvg('s', { hue: 45 }));
  });

  it('is deterministic', () => {
    expect(generateAvatar('s', { style: 'geometric' })).toBe(generateAvatar('s', { style: 'geometric' }));
  });
});

describe('toDataUri', () => {
  it('prefixes a base64 svg data uri that round-trips back to the source svg', () => {
    const svg = generateAvatar('user-123');
    const uri = toDataUri(svg);
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const decoded = Buffer.from(uri.slice('data:image/svg+xml;base64,'.length), 'base64').toString();
    expect(decoded).toBe(svg);
  });
});
