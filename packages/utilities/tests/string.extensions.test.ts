import { describe, it, expect } from 'vitest';
import '../src/string.extensions.js';

describe('String.prototype.isNullOrUndefinedOrWhitespace', () => {
  it('returns true for an empty string', () => {
    expect(''.isNullOrUndefinedOrWhitespace()).toBe(true);
  });

  it('returns true for whitespace-only strings', () => {
    expect('   '.isNullOrUndefinedOrWhitespace()).toBe(true);
    expect('\t\n  '.isNullOrUndefinedOrWhitespace()).toBe(true);
  });

  it('returns false for strings with non-whitespace content', () => {
    expect('a'.isNullOrUndefinedOrWhitespace()).toBe(false);
    expect('  hi  '.isNullOrUndefinedOrWhitespace()).toBe(false);
  });
});

describe('String.prototype.hasValue', () => {
  it('returns false for empty or whitespace-only strings', () => {
    expect(''.hasValue()).toBe(false);
    expect('   '.hasValue()).toBe(false);
  });

  it('returns true for strings with non-whitespace content', () => {
    expect('x'.hasValue()).toBe(true);
    expect('  hi  '.hasValue()).toBe(true);
  });
});

describe('String.prototype.mask', () => {
  it('keeps the first two and last two characters by default', () => {
    expect('password123'.mask()).toBe('pa*******23');
  });

  it('returns the string unchanged when unmasked windows cover its length', () => {
    expect('abcd'.mask()).toBe('abcd');
    expect('abc'.mask()).toBe('abc');
  });

  it('honors custom unmasked window sizes', () => {
    expect('1234567890'.mask(4, 2)).toBe('1234****90');
  });

  it('uses the supplied mask character', () => {
    expect('abcdef'.mask(1, 1, '#')).toBe('a####f');
  });

  it('clamps negative window sizes to zero', () => {
    expect('abcde'.mask(-1, -1)).toBe('*****');
  });
});

describe('String.prototype.maskExceptLastFour', () => {
  it('masks everything except the trailing four characters', () => {
    expect('4111111111111234'.maskExceptLastFour()).toBe('************1234');
  });

  it('uses the supplied mask character', () => {
    expect('4111111111111234'.maskExceptLastFour('#')).toBe('############1234');
  });

  it('returns the string unchanged when it is four characters or shorter', () => {
    expect('1234'.maskExceptLastFour()).toBe('1234');
    expect('12'.maskExceptLastFour()).toBe('12');
  });
});

describe('String.prototype.maskEmail', () => {
  it('masks the local part and middle of the domain by default', () => {
    expect('user@example.com'.maskEmail()).toBe('us*@ex*e.com');
  });

  it('skips trim collapsing when trim is false', () => {
    expect('user@example.com'.maskEmail(false)).toBe('us**@ex****e.com');
  });

  it('uses the supplied mask character', () => {
    expect('user@example.com'.maskEmail(true, '#')).toBe('us#@ex#e.com');
  });
});

describe('prototype installs', () => {
  it('marks extension methods as non-enumerable', () => {
    for (const name of ['hasValue', 'isNullOrUndefinedOrWhitespace', 'mask', 'maskEmail', 'maskExceptLastFour']) {
      const descriptor = Object.getOwnPropertyDescriptor(String.prototype, name);
      expect(descriptor?.enumerable, `${name} should be non-enumerable`).toBe(false);
    }
  });
});
