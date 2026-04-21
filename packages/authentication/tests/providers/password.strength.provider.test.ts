import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@zxcvbn-ts/core', () => ({
  zxcvbnAsync: vi.fn(),
  zxcvbnOptions: {
    setOptions: vi.fn(),
    matchers: {},
    addMatcher: vi.fn(),
  },
}));

vi.mock('@zxcvbn-ts/language-common', () => ({
  adjacencyGraphs: {},
  dictionary: {},
}));

vi.mock('@zxcvbn-ts/language-en', () => ({
  translations: {},
  dictionary: {},
}));

vi.mock('@zxcvbn-ts/matcher-pwned', () => ({
  matcherPwnedFactory: vi.fn().mockReturnValue({}),
}));

import { zxcvbnAsync } from '@zxcvbn-ts/core';
import { PasswordStrengthProvider } from '../../src/providers/password.strength.provider.js';

const makeZxcvbnResult = (score: 0 | 1 | 2 | 3 | 4, warning = '', suggestions: string[] = []) => ({
  score,
  feedback: { warning, suggestions },
});

describe('PasswordStrengthProvider', () => {
  let provider: PasswordStrengthProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new PasswordStrengthProvider();
  });

  describe('checkStrength', () => {
    it('returns valid: true when the score is 3', async () => {
      vi.mocked(zxcvbnAsync).mockResolvedValue(makeZxcvbnResult(3) as Awaited<ReturnType<typeof zxcvbnAsync>>);
      const result = await provider.checkStrength('correct-horse-battery');
      expect(result.valid).toBe(true);
      expect(result.score).toBe(3);
    });

    it('returns valid: true when the score is 4', async () => {
      vi.mocked(zxcvbnAsync).mockResolvedValue(makeZxcvbnResult(4) as Awaited<ReturnType<typeof zxcvbnAsync>>);
      const result = await provider.checkStrength('correct-horse-battery-staple');
      expect(result.valid).toBe(true);
    });

    it('returns valid: false when the score is below 3', async () => {
      vi.mocked(zxcvbnAsync).mockResolvedValue(makeZxcvbnResult(2) as Awaited<ReturnType<typeof zxcvbnAsync>>);
      const result = await provider.checkStrength('password123');
      expect(result.valid).toBe(false);
      expect(result.score).toBe(2);
    });

    it('returns the feedback from zxcvbn', async () => {
      vi.mocked(zxcvbnAsync).mockResolvedValue(
        makeZxcvbnResult(1, 'Use a longer password', ['Add more words', 'Avoid common phrases']) as Awaited<ReturnType<typeof zxcvbnAsync>>,
      );
      const result = await provider.checkStrength('password');
      expect(result.feedback.warning).toBe('Use a longer password');
      expect(result.feedback.suggestions).toEqual(['Add more words', 'Avoid common phrases']);
    });

    it('passes user inputs to zxcvbn', async () => {
      vi.mocked(zxcvbnAsync).mockResolvedValue(makeZxcvbnResult(3) as Awaited<ReturnType<typeof zxcvbnAsync>>);
      await provider.checkStrength('mypassword', 'alice', 1990);
      expect(zxcvbnAsync).toHaveBeenCalledWith('mypassword', ['alice', 1990]);
    });
  });

  describe('ensureStrength', () => {
    it('resolves without throwing for a strong password', async () => {
      vi.mocked(zxcvbnAsync).mockResolvedValue(makeZxcvbnResult(4) as Awaited<ReturnType<typeof zxcvbnAsync>>);
      await expect(provider.ensureStrength('correct-horse-battery-staple')).resolves.toBeUndefined();
    });

    it('throws an HTTP 400 error for a weak password', async () => {
      vi.mocked(zxcvbnAsync).mockResolvedValue(
        makeZxcvbnResult(1, 'Too guessable', ['Use more words']) as Awaited<ReturnType<typeof zxcvbnAsync>>,
      );
      await expect(provider.ensureStrength('password')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('includes feedback in the 400 error details', async () => {
      vi.mocked(zxcvbnAsync).mockResolvedValue(
        makeZxcvbnResult(0, 'Too common', ['Try a passphrase']) as Awaited<ReturnType<typeof zxcvbnAsync>>,
      );
      await expect(provider.ensureStrength('123456')).rejects.toMatchObject({
        details: { password: ['Too common', 'Try a passphrase'] },
      });
    });
  });
});
