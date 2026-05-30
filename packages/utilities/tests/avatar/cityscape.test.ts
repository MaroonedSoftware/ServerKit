import { describe, it, expect } from 'vitest';
import { generateCityscapeSvg } from '../../src/avatar/cityscape.js';

describe('generateCityscapeSvg', () => {
  it('is deterministic for a given seed', () => {
    expect(generateCityscapeSvg('acme-inc')).toBe(generateCityscapeSvg('acme-inc'));
  });

  it('produces different output for different seeds', () => {
    expect(generateCityscapeSvg('acme-inc')).not.toBe(generateCityscapeSvg('acme-llc'));
  });

  it('is a well-formed single-root svg', () => {
    const svg = generateCityscapeSvg('acme-inc');
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg.match(/<svg /g)).toHaveLength(1);
    expect(svg).toContain('viewBox="0 0 100 100"');
  });

  it('honors the time-of-day preset', () => {
    expect(generateCityscapeSvg('acme-inc', { timeOfDay: 'day' })).not.toBe(generateCityscapeSvg('acme-inc', { timeOfDay: 'night' }));
  });

  it('emits front-row buildings plus a matching back row', () => {
    const svg = generateCityscapeSvg('acme-inc', { buildingCount: 5, celestialBody: false });
    // Distant blocks carry opacity="0.7"; one per requested building.
    expect(svg.match(/opacity="0\.7"/g)).toHaveLength(5);
  });

  it('omits the sun/moon when disabled', () => {
    // The sun/moon adds a soft halo gradient + blur filter to <defs>; nothing else does.
    const withBody = generateCityscapeSvg('acme-inc', { timeOfDay: 'day', celestialBody: true });
    const withoutBody = generateCityscapeSvg('acme-inc', { timeOfDay: 'day', celestialBody: false });
    expect(withBody).toContain('<radialGradient');
    expect(withBody).toContain('<filter');
    expect(withoutBody).not.toContain('<radialGradient');
    expect(withoutBody).not.toContain('<filter');
  });

  it('cycles moon phases and draws stars at night', () => {
    const full = generateCityscapeSvg('acme-inc', { timeOfDay: 'night', moonPhase: 'full' });
    const crescent = generateCityscapeSvg('acme-inc', { timeOfDay: 'night', moonPhase: 'waxingCrescent' });
    expect(full).toContain('<path d="M'); // moon silhouette path
    expect(full).not.toBe(crescent); // phase changes the silhouette
    // Stars on at night by default, off when disabled.
    expect(generateCityscapeSvg('acme-inc', { timeOfDay: 'night' })).toContain('hsl(210 40% 96%)');
    expect(generateCityscapeSvg('acme-inc', { timeOfDay: 'night', stars: false })).not.toContain('hsl(210 40% 96%)');
  });

  it('varies the sun/moon glow softness', () => {
    const opts = { timeOfDay: 'day' as const };
    const sharp = generateCityscapeSvg('acme-inc', { ...opts, celestialGlow: 'sharp' });
    const hazy = generateCityscapeSvg('acme-inc', { ...opts, celestialGlow: 'hazy' });
    expect(sharp).not.toBe(hazy);
    // Hazier glow uses a larger blur stdDeviation than the sharp setting.
    expect(sharp).toContain('stdDeviation="0.15"');
    expect(hazy).toContain('stdDeviation="1.6"');
  });

  it('draws clouds by default and omits them when disabled', () => {
    const cloudFill = 'fill="hsl(0 0% 100%)"'; // daytime cloud color
    expect(generateCityscapeSvg('acme-inc', { timeOfDay: 'day' })).toContain(cloudFill);
    expect(generateCityscapeSvg('acme-inc', { timeOfDay: 'day', clouds: false })).not.toContain(cloudFill);
  });

  it('uses a seed-derived gradient id so inlined avatars do not collide', () => {
    const a = generateCityscapeSvg('acme-inc');
    const b = generateCityscapeSvg('globex');
    const idOf = (s: string) => s.match(/linearGradient id="([^"]+)"/)?.[1];
    expect(idOf(a)).not.toBe(idOf(b));
  });

  it('never repeats a landmark within a mixed skyline', () => {
    // The modern (Shanghai Tower) glass body fill (hsl(196 32% …)) is unique to
    // it and appears exactly once per tower, so it is a reliable per-building marker.
    const marker = /hsl\(196 32%/g;
    for (const seed of ['acme-inc', 'globex', 'initech', 'umbrella', 'hooli', 'stark']) {
      const svg = generateCityscapeSvg(seed, { buildingCount: 8 });
      expect((svg.match(marker) ?? []).length).toBeLessThanOrEqual(1);
    }
  });

  it('repeats a landmark only when the style is explicitly forced', () => {
    const forced = generateCityscapeSvg('acme-inc', { buildingStyle: 'modern', buildingCount: 6 });
    expect((forced.match(/hsl\(196 32%/g) ?? []).length).toBeGreaterThan(1);
  });

  it('supports the plain filler style', () => {
    const plain = generateCityscapeSvg('acme-inc', { buildingStyle: 'plain' });
    const gothic = generateCityscapeSvg('acme-inc', { buildingStyle: 'gothic' });
    expect(plain).not.toBe(gothic);
    // Plain boxes never use the gothic tower's gold crown.
    expect(plain).not.toContain('hsl(44 80% 56%)');
  });

  it('renders a distinct perspective layout', () => {
    const flat = generateCityscapeSvg('acme-inc', { view: 'flat' });
    const perspective = generateCityscapeSvg('acme-inc', { view: 'perspective' });
    expect(perspective).not.toBe(flat);
    // Two-point perspective renders buildings as polygon faces (no axis-aligned
    // <rect> facades like the flat view's foreground buildings).
    expect(perspective).toContain('<polygon');
    expect((perspective.match(/<polygon/g) ?? []).length).toBeGreaterThan(5);
    expect(perspective).toContain('viewBox="0 0 100 100"');
  });

  it('perspective view is deterministic', () => {
    const opts = { view: 'perspective' as const, timeOfDay: 'night' as const };
    expect(generateCityscapeSvg('acme-inc', opts)).toBe(generateCityscapeSvg('acme-inc', opts));
  });

  it('size only changes width/height', () => {
    const svg = generateCityscapeSvg('acme-inc', { size: 64 });
    expect(svg).toContain('width="64" height="64"');
    expect(svg).toContain('viewBox="0 0 100 100"');
  });
});
