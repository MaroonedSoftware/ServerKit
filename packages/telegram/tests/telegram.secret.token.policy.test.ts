import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  TelegramSecretTokenPolicy,
  TELEGRAM_SECRET_TOKEN_POLICY,
  type TelegramSecretTokenOptions,
  type TelegramSecretTokenPolicyContext,
} from '../src/telegram.secret.token.policy.js';
import { TELEGRAM_SECRET_TOKEN_HEADER, type TelegramSecretTokenFailureReason } from '../src/telegram.secret.token.js';
import { isPolicyResultAllowed, isPolicyResultDenied, type PolicyEnvelope } from '@maroonedsoftware/policies';

const SECRET = 'super-secret-token';
const OPTIONS: TelegramSecretTokenOptions = { secretToken: SECRET };
const envelope: PolicyEnvelope = { now: DateTime.fromSeconds(1_700_000_000, { zone: 'utc' }) };

const makeContext = (headerValue: string | undefined): TelegramSecretTokenPolicyContext => ({
  getHeader: name => (name === TELEGRAM_SECRET_TOKEN_HEADER ? (headerValue ?? '') : ''),
  options: OPTIONS,
});

const evaluate = (headerValue: string | undefined) => new TelegramSecretTokenPolicy().evaluate(makeContext(headerValue), envelope);

const expectDenied = async (result: Awaited<ReturnType<typeof evaluate>>, reason: TelegramSecretTokenFailureReason) => {
  expect(isPolicyResultDenied(result)).toBe(true);
  if (isPolicyResultDenied(result)) {
    expect(result.reason).toBe(reason);
  }
};

describe('TelegramSecretTokenPolicy', () => {
  it('is registered under the expected name', () => {
    expect(TELEGRAM_SECRET_TOKEN_POLICY).toBe('telegram.secret.token.valid');
  });

  it('allows when the header matches', async () => {
    expect(isPolicyResultAllowed(await evaluate(SECRET))).toBe(true);
  });

  it('denies a wrong token', async () => {
    await expectDenied(await evaluate('wrong'), 'invalid_secret_token');
  });

  it('denies a missing header', async () => {
    await expectDenied(await evaluate(undefined), 'missing_secret_token');
  });

  it('keeps the secret token out of the denial diagnostics', async () => {
    const result = await evaluate('wrong');
    expect(isPolicyResultDenied(result)).toBe(true);
    if (isPolicyResultDenied(result)) {
      expect(JSON.stringify(result.internalDetails)).not.toContain(SECRET);
    }
  });
});
