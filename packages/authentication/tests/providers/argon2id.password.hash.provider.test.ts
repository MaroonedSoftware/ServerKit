import { describe, it, expect } from 'vitest';
import { Argon2idPasswordHashProvider, ARGON2ID_DEFAULTS } from '../../src/providers/argon2id.password.hash.provider.js';

describe('Argon2idPasswordHashProvider', () => {
  const provider = new Argon2idPasswordHashProvider();

  it('round-trips: a freshly hashed password verifies', async () => {
    const { hash, salt } = await provider.hash('correct-horse-battery-staple');
    await expect(provider.verify('correct-horse-battery-staple', hash, salt)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const { hash, salt } = await provider.hash('correct-horse-battery-staple');
    await expect(provider.verify('wrong-password', hash, salt)).resolves.toBe(false);
  });

  it('returns false (not throw) when the stored hash is malformed', async () => {
    await expect(provider.verify('whatever', 'not-a-phc-string', '')).resolves.toBe(false);
  });

  it('produces a different PHC string on each call (random salt)', async () => {
    const a = await provider.hash('same-password');
    const b = await provider.hash('same-password');
    expect(a.hash).not.toBe(b.hash);
  });

  it('hash output starts with the canonical Argon2id PHC prefix using the current defaults', async () => {
    const { hash } = await provider.hash('any-password');
    expect(hash).toMatch(
      new RegExp(`^\\$argon2id\\$v=\\d+\\$m=${ARGON2ID_DEFAULTS.memoryCost},t=${ARGON2ID_DEFAULTS.timeCost},p=${ARGON2ID_DEFAULTS.parallelism}\\$`),
    );
  });

  it('returns an empty salt — Argon2id PHC embeds its own salt', async () => {
    const { salt } = await provider.hash('any-password');
    expect(salt).toBe('');
  });
});
