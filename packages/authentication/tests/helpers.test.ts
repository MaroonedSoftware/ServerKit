import { describe, it, expect } from 'vitest';
import { DateTime, Duration } from 'luxon';
import { isFactorRecent, matchesFactorConstraints } from '../src/helpers.js';
import type { AuthenticationSessionFactor } from '../src/types.js';

const baseFactor = (overrides: Partial<AuthenticationSessionFactor> = {}): AuthenticationSessionFactor => ({
  method: 'password',
  methodId: 'factor-1',
  kind: 'knowledge',
  issuedAt: DateTime.fromISO('2026-01-01T00:00:00Z', { zone: 'utc' }),
  authenticatedAt: DateTime.fromISO('2026-01-01T00:00:00Z', { zone: 'utc' }),
  ...overrides,
});

describe('matchesFactorConstraints', () => {
  it('matches every factor when no constraints are set', () => {
    expect(matchesFactorConstraints(baseFactor(), {})).toBe(true);
  });

  it("rejects factors whose method is in 'excludeMethods'", () => {
    expect(matchesFactorConstraints(baseFactor({ method: 'email' }), { excludeMethods: ['email'] })).toBe(false);
  });

  it("requires the factor's method to be in 'anyOfMethods' when set", () => {
    expect(matchesFactorConstraints(baseFactor({ method: 'phone' }), { anyOfMethods: ['fido', 'authenticator'] })).toBe(false);
    expect(matchesFactorConstraints(baseFactor({ method: 'fido' }), { anyOfMethods: ['fido', 'authenticator'] })).toBe(true);
  });

  it("requires the factor's kind to be in 'anyOfKinds' when set", () => {
    expect(matchesFactorConstraints(baseFactor({ kind: 'knowledge' }), { anyOfKinds: ['possession'] })).toBe(false);
    expect(matchesFactorConstraints(baseFactor({ kind: 'possession' }), { anyOfKinds: ['possession'] })).toBe(true);
  });

  it('checks excludeMethods before anyOf* (an excluded method always rejects)', () => {
    const factor = baseFactor({ method: 'email', kind: 'possession' });
    expect(
      matchesFactorConstraints(factor, {
        excludeMethods: ['email'],
        anyOfMethods: ['email', 'phone'],
        anyOfKinds: ['possession'],
      }),
    ).toBe(false);
  });
});

describe('isFactorRecent', () => {
  const now = DateTime.fromISO('2026-01-01T01:00:00Z', { zone: 'utc' });

  it('returns true when the factor was authenticated inside the window', () => {
    const factor = baseFactor({ authenticatedAt: now.minus({ minutes: 4 }) });
    expect(isFactorRecent(factor, now, Duration.fromObject({ minutes: 5 }))).toBe(true);
  });

  it('returns false when the factor was authenticated before the window', () => {
    const factor = baseFactor({ authenticatedAt: now.minus({ minutes: 10 }) });
    expect(isFactorRecent(factor, now, Duration.fromObject({ minutes: 5 }))).toBe(false);
  });

  it('treats authentication exactly at the window boundary as recent', () => {
    const within = Duration.fromObject({ minutes: 5 });
    const factor = baseFactor({ authenticatedAt: now.minus(within) });
    expect(isFactorRecent(factor, now, within)).toBe(true);
  });
});
