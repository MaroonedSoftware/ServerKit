import { describe, it, expect } from 'vitest';
import { generateGeometricSvg } from '../../src/avatar/geometric.js';

describe('generateGeometricSvg', () => {
  it('is deterministic for a given seed', () => {
    expect(generateGeometricSvg('team-7')).toBe(generateGeometricSvg('team-7'));
  });

  it('produces different output for different seeds', () => {
    expect(generateGeometricSvg('team-7')).not.toBe(generateGeometricSvg('team-8'));
  });

  it('is a well-formed single-root svg', () => {
    const svg = generateGeometricSvg('team-7');
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg.match(/<svg /g)).toHaveLength(1);
    expect(svg).toContain('viewBox="0 0 100 100"');
  });

  it('emits the requested number of shapes', () => {
    const svg = generateGeometricSvg('team-7', { shapeCount: 6 });
    const shapes = svg.match(/<(circle|rect|path)\b/g) ?? [];
    // One background <rect> from the envelope, plus one node per shape.
    expect(shapes).toHaveLength(7);
  });

  it('uses an explicit palette when provided', () => {
    const svg = generateGeometricSvg('team-7', { palette: ['#123456'], shapeCount: 3 });
    expect(svg).toContain('#123456');
  });

  it('size only changes width/height', () => {
    const svg = generateGeometricSvg('team-7', { size: 64 });
    expect(svg).toContain('width="64" height="64"');
    expect(svg).toContain('viewBox="0 0 100 100"');
  });
});
