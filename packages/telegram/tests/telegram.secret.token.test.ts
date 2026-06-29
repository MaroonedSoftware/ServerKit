import { describe, it, expect } from 'vitest';
import { verifyTelegramSecretToken, type TelegramSecretTokenFailureReason } from '../src/telegram.secret.token.js';
import { TelegramError } from '../src/telegram.error.js';

const SECRET = 'super-secret-token';

const expectFailure = (fn: () => void, reason: TelegramSecretTokenFailureReason) => {
  try {
    fn();
    throw new Error(`expected TelegramError with reason "${reason}"`);
  } catch (err) {
    expect(err).toBeInstanceOf(TelegramError);
    expect((err as TelegramError).internalDetails?.reason).toBe(reason);
  }
};

describe('verifyTelegramSecretToken', () => {
  it('passes when the header matches the configured token', () => {
    expect(() => verifyTelegramSecretToken({ secretToken: SECRET, headerValue: SECRET })).not.toThrow();
  });

  it('rejects when the header does not match', () => {
    expectFailure(() => verifyTelegramSecretToken({ secretToken: SECRET, headerValue: 'wrong' }), 'invalid_secret_token');
  });

  it('rejects a missing header', () => {
    expectFailure(() => verifyTelegramSecretToken({ secretToken: SECRET, headerValue: undefined }), 'missing_secret_token');
  });

  it('rejects an empty-string header', () => {
    expectFailure(() => verifyTelegramSecretToken({ secretToken: SECRET, headerValue: '' }), 'missing_secret_token');
  });

  it('rejects a header of differing length without throwing from crypto', () => {
    expectFailure(() => verifyTelegramSecretToken({ secretToken: SECRET, headerValue: 'short' }), 'invalid_secret_token');
  });
});
