import { describe, it, expect } from 'vitest';
import { generateGradientSwirlSvg } from '../../src/avatar/gradient.js';

describe('generateGradientSwirlSvg', () => {
  it('is deterministic for a given seed', () => {
    expect(generateGradientSwirlSvg('proj-42')).toBe(generateGradientSwirlSvg('proj-42'));
  });

  it('produces different output for different seeds', () => {
    expect(generateGradientSwirlSvg('proj-42')).not.toBe(generateGradientSwirlSvg('proj-43'));
  });

  it('is a well-formed single-root svg with a gradient definition', () => {
    const svg = generateGradientSwirlSvg('proj-42');
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg.match(/<svg /g)).toHaveLength(1);
    expect(svg).toMatch(/<(linear|radial)Gradient /);
  });

  it('honors an explicit gradient type', () => {
    expect(generateGradientSwirlSvg('proj-42', { gradientType: 'radial' })).toContain('<radialGradient ');
    expect(generateGradientSwirlSvg('proj-42', { gradientType: 'linear' })).toContain('<linearGradient ');
  });

  it('uses distinct gradient ids for different seeds (no collision when inlined together)', () => {
    const idOf = (svg: string): string => svg.match(/id="([^"]+)"/)![1]!;
    expect(idOf(generateGradientSwirlSvg('proj-42'))).not.toBe(idOf(generateGradientSwirlSvg('proj-99')));
  });

  it('references its own gradient id as the background fill', () => {
    const svg = generateGradientSwirlSvg('proj-42');
    const id = svg.match(/id="([^"]+)"/)![1]!;
    expect(svg).toContain(`fill="url(#${id})"`);
  });
});
