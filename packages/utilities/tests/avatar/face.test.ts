import { describe, it, expect } from 'vitest';
import { generateFaceAvatarSvg } from '../../src/avatar/face.js';
import { DEFAULT_LINE_COLOR } from '../../src/avatar/shared.js';

describe('generateFaceAvatarSvg', () => {
  it('is deterministic for a given seed', () => {
    expect(generateFaceAvatarSvg('alice')).toBe(generateFaceAvatarSvg('alice'));
  });

  it('produces different output for different seeds', () => {
    expect(generateFaceAvatarSvg('alice')).not.toBe(generateFaceAvatarSvg('bob'));
  });

  it('defaults reproduce the original framing and outline color', () => {
    const svg = generateFaceAvatarSvg('alice');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain(DEFAULT_LINE_COLOR);
    expect(svg).toContain('rx="50"');
  });

  it('size only changes width/height; the viewBox stays 0 0 100 100', () => {
    const svg = generateFaceAvatarSvg('alice', { size: 256 });
    expect(svg).toContain('width="256" height="256"');
    expect(svg).toContain('viewBox="0 0 100 100"');
  });

  it('honors lineColor, replacing the default outline', () => {
    const svg = generateFaceAvatarSvg('alice', { lineColor: '#000000' });
    expect(svg).toContain('#000000');
    expect(svg).not.toContain(DEFAULT_LINE_COLOR);
  });

  it('honors a pinned hue', () => {
    expect(generateFaceAvatarSvg('alice', { hue: 200 })).toContain('hsl(200 ');
  });

  it('is a single-root svg element', () => {
    const svg = generateFaceAvatarSvg('charlie');
    expect(svg.match(/<svg /g)).toHaveLength(1);
  });
});
