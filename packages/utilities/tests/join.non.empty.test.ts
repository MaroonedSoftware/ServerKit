import { describe, it, expect } from 'vitest';
import { joinNonEmpty } from '../src/join.non.empty.js';

describe('joinNonEmpty', () => {
  it('joins non-empty strings with the separator', () => {
    expect(joinNonEmpty(', ', 'a', 'b', 'c')).toBe('a, b, c');
  });

  it('drops empty strings before joining', () => {
    expect(joinNonEmpty('-', 'a', '', 'b', '', 'c')).toBe('a-b-c');
  });

  it('returns an empty string when all values are empty', () => {
    expect(joinNonEmpty(', ', '', '')).toBe('');
  });

  it('returns a single value with no separator applied', () => {
    expect(joinNonEmpty(', ', 'only')).toBe('only');
  });

  it('uses the default join separator when undefined is passed', () => {
    expect(joinNonEmpty(undefined, 'a', 'b')).toBe('a,b');
  });
});
