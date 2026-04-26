import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import crypto from 'node:crypto';
import { PasswordStrengthProvider } from '../../src/providers/password.strength.provider.js';

// `matcher-pwned` captures the global `fetch` reference at provider-construction
// time and registers itself once on zxcvbn's global matchers map. We stub fetch
// for the whole suite so the captured reference points to a controllable mock,
// then reset per-test.
const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

const emptyHibpResponse = () =>
  new Response('', { status: 200, headers: { 'content-type': 'text/plain' } });

const hibpResponseFor = (matches: { sha1: string; count: number }[]) => {
  const body = matches.map(m => `${m.sha1.slice(5).toUpperCase()}:${m.count}`).join('\r\n');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
};

const sha1 = (input: string) => crypto.createHash('sha1').update(input).digest('hex');

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('PasswordStrengthProvider', () => {
  let provider: PasswordStrengthProvider;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => emptyHibpResponse());
    provider = new PasswordStrengthProvider();
  });

  describe('checkStrength', () => {
    it('flags a top-100 password as weak', async () => {
      const result = await provider.checkStrength('password');

      expect(result.valid).toBe(false);
      expect(result.score).toBeLessThan(3);
      expect(result.feedback).toMatchObject({
        warning: expect.any(String),
        suggestions: expect.any(Array),
      });
    });

    it('flags a short trivial password as weak', async () => {
      const result = await provider.checkStrength('123456');

      expect(result.valid).toBe(false);
      expect(result.score).toBeLessThan(3);
    });

    it('accepts a long random-looking passphrase', async () => {
      const result = await provider.checkStrength('correct horse battery staple plus 7 unrelated tokens');

      expect(result.valid).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(3);
    });

    it('penalises a password that matches the user’s own context', async () => {
      // zxcvbn's userInputs feature treats supplied tokens as cheap guesses.
      const baselineResult = await provider.checkStrength('Eustace1995');
      const penalisedResult = await provider.checkStrength('Eustace1995', 'Eustace', 1995);

      // Score is non-increasing once we tell zxcvbn this is the user's name + birth year.
      expect(penalisedResult.score).toBeLessThanOrEqual(baselineResult.score);
      expect(penalisedResult.valid).toBe(false);
    });

    it('queries the HIBP range API with the SHA1 prefix of the password', async () => {
      await provider.checkStrength('moderately-tricky-passphrase-9z');

      const expectedPrefix = sha1('moderately-tricky-passphrase-9z').slice(0, 5).toUpperCase();
      const calls = fetchMock.mock.calls.map(c => String(c[0]));
      const hibpCall = calls.find(url => url.includes('pwnedpasswords.com'));
      expect(hibpCall).toBeDefined();
      expect(hibpCall).toContain(`/range/${expectedPrefix}`);
    });

    it('penalises a password the HIBP matcher reports as breached', async () => {
      const breached = 'moderate-passphrase-2024-fall';

      // Baseline: HIBP returns no matches → zxcvbn scores normally.
      const baseline = await provider.checkStrength(breached);

      // Now make HIBP report this exact password as breached many times.
      fetchMock.mockImplementation(async () => hibpResponseFor([{ sha1: sha1(breached), count: 1_000_000 }]));
      const penalised = await provider.checkStrength(breached);

      expect(penalised.score).toBeLessThan(baseline.score);
    });
  });

  describe('ensureStrength', () => {
    it('resolves for a strong passphrase', async () => {
      await expect(
        provider.ensureStrength('correct horse battery staple plus 7 unrelated tokens'),
      ).resolves.toBeUndefined();
    });

    it('throws HTTP 400 with feedback details for a weak password', async () => {
      const error = await provider.ensureStrength('password').catch(e => e);

      expect(error).toMatchObject({
        statusCode: 400,
        details: {
          password: expect.any(String),
          suggestions: expect.any(Array),
        },
      });
    });
  });
});
