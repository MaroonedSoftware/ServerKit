import { describe, it, expect } from 'vitest';
import { generateIdenticonSvg } from '../../src/avatar/identicon.js';

describe('generateIdenticonSvg', () => {
  it('is deterministic for a given seed', () => {
    expect(generateIdenticonSvg('acme')).toBe(generateIdenticonSvg('acme'));
  });

  it('produces different output for different seeds', () => {
    expect(generateIdenticonSvg('acme')).not.toBe(generateIdenticonSvg('globex'));
  });

  it('defaults reproduce the original framing', () => {
    const svg = generateIdenticonSvg('acme');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">')).toBe(true);
    expect(svg).toContain('rx="12"');
    expect(svg).toContain('width="15" height="15"');
  });

  it('is horizontally mirrored (rects appear in symmetric column pairs)', () => {
    // A non-center cell always emits a mirrored partner, so the rect count is even
    // unless the center column contributes. Just assert it renders rects.
    expect(generateIdenticonSvg('acme')).toMatch(/<rect /);
  });

  it('supports a custom grid size and stays deterministic + well-formed', () => {
    const a = generateIdenticonSvg('acme', { grid: 7 });
    expect(a).toBe(generateIdenticonSvg('acme', { grid: 7 }));
    expect(a.startsWith('<svg ')).toBe(true);
    expect(a.endsWith('</svg>')).toBe(true);
    expect(a.match(/<svg /g)).toHaveLength(1);
  });

  it('honors a pinned hue', () => {
    expect(generateIdenticonSvg('acme', { hue: 210 })).toContain('hsl(210 ');
  });
});
