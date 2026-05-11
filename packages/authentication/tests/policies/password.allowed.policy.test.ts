import { describe, it, expect, vi } from 'vitest';
import { DateTime } from 'luxon';
import { PasswordAllowedPolicy } from '../../src/policies/password.allowed.policy.js';
import type { PasswordStrengthProvider } from '../../src/providers/password.strength.provider.js';
import type { PasswordHashProvider } from '../../src/providers/password.hash.provider.js';

const envelope = { now: DateTime.utc() };

const makeStrengthProvider = (overrides: Partial<{ valid: boolean; warning: string; suggestions: string[] }> = {}) =>
  ({
    checkStrength: vi.fn().mockResolvedValue({
      valid: overrides.valid ?? true,
      score: overrides.valid === false ? 1 : 4,
      feedback: { warning: overrides.warning ?? '', suggestions: overrides.suggestions ?? [] },
    }),
    ensureStrength: vi.fn().mockResolvedValue(undefined),
  }) as unknown as PasswordStrengthProvider;

const makeHashProvider = (matches: ReadonlyArray<string> = []) =>
  ({
    hash: vi.fn(),
    verify: vi.fn(async (password: string, hash: string) => matches.includes(`${password}:${hash}`)),
  }) as unknown as PasswordHashProvider;

describe('PasswordAllowedPolicy', () => {
  it('allows a strong password when no previous passwords are supplied', async () => {
    const policy = new PasswordAllowedPolicy(makeStrengthProvider(), makeHashProvider());
    await expect(policy.evaluate({ password: 'correct-horse-battery-staple' }, envelope)).resolves.toEqual({ allowed: true });
  });

  it("denies with reason 'weak_password' and includes feedback details", async () => {
    const policy = new PasswordAllowedPolicy(
      makeStrengthProvider({ valid: false, warning: 'too common', suggestions: ['add symbols'] }),
      makeHashProvider(),
    );
    await expect(policy.evaluate({ password: 'password' }, envelope)).resolves.toEqual({
      allowed: false,
      reason: 'weak_password',
      details: { warning: 'too common', suggestions: ['add symbols'] },
    });
  });

  it("denies with reason 'reused_password' when previousPasswords contains a match", async () => {
    const policy = new PasswordAllowedPolicy(makeStrengthProvider(), makeHashProvider(['correct-horse-battery-staple:old-hash']));
    const result = await policy.evaluate(
      { password: 'correct-horse-battery-staple', previousPasswords: [{ hash: 'old-hash', salt: 'old-salt' }] },
      envelope,
    );
    expect(result).toEqual({ allowed: false, reason: 'reused_password', details: undefined });
  });

  it('allows when previousPasswords is supplied but none match', async () => {
    const policy = new PasswordAllowedPolicy(makeStrengthProvider(), makeHashProvider());
    await expect(
      policy.evaluate(
        { password: 'correct-horse-battery-staple', previousPasswords: [{ hash: 'a', salt: 'a' }, { hash: 'b', salt: 'b' }] },
        envelope,
      ),
    ).resolves.toEqual({ allowed: true });
  });

  it('skips reuse evaluation when previousPasswords is omitted, even if the password would otherwise match history', async () => {
    const hashProvider = makeHashProvider(['correct-horse-battery-staple:old-hash']);
    const policy = new PasswordAllowedPolicy(makeStrengthProvider(), hashProvider);
    await expect(policy.evaluate({ password: 'correct-horse-battery-staple' }, envelope)).resolves.toEqual({ allowed: true });
    expect(hashProvider.verify).not.toHaveBeenCalled();
  });

  it('short-circuits on weak password without invoking the hash provider', async () => {
    const hashProvider = makeHashProvider();
    const policy = new PasswordAllowedPolicy(makeStrengthProvider({ valid: false }), hashProvider);
    await policy.evaluate(
      { password: 'password', previousPasswords: [{ hash: 'a', salt: 'a' }] },
      envelope,
    );
    expect(hashProvider.verify).not.toHaveBeenCalled();
  });
});
