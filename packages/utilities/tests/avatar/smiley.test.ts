import { describe, it, expect } from 'vitest';
import { generateSmileyAvatarSvg } from '../../src/avatar/smiley.js';
import { DEFAULT_LINE_COLOR } from '../../src/avatar/shared.js';

describe('generateSmileyAvatarSvg', () => {
  it('is deterministic for a given seed', () => {
    expect(generateSmileyAvatarSvg('hello')).toBe(generateSmileyAvatarSvg('hello'));
  });

  it('produces different output for different seeds', () => {
    expect(generateSmileyAvatarSvg('hello')).not.toBe(generateSmileyAvatarSvg('world'));
  });

  it('is a well-formed single-root svg with a face and smile', () => {
    const svg = generateSmileyAvatarSvg('hello');
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg.match(/<svg /g)).toHaveLength(1);
    expect(svg).toContain(DEFAULT_LINE_COLOR);
  });

  it('honors lineColor and a pinned hue', () => {
    const svg = generateSmileyAvatarSvg('hello', { lineColor: '#000000', hue: 45 });
    expect(svg).toContain('#000000');
    expect(svg).toContain('hsl(45 ');
    expect(svg).not.toContain(DEFAULT_LINE_COLOR);
  });
});
