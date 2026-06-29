import { describe, it, expect } from 'vitest';
import { verifyWhatsAppWebhook, type WhatsAppVerificationFailureReason } from '../src/whatsapp.webhook.js';
import { WhatsAppError } from '../src/whatsapp.error.js';

const VERIFY_TOKEN = 'my-verify-token';

const expectFailure = (fn: () => void, reason: WhatsAppVerificationFailureReason) => {
  try {
    fn();
    throw new Error(`expected WhatsAppError with reason "${reason}"`);
  } catch (err) {
    expect(err).toBeInstanceOf(WhatsAppError);
    expect((err as WhatsAppError).internalDetails?.reason).toBe(reason);
  }
};

describe('verifyWhatsAppWebhook', () => {
  it('returns the challenge when mode and token match', () => {
    const challenge = verifyWhatsAppWebhook({ verifyToken: VERIFY_TOKEN, mode: 'subscribe', token: VERIFY_TOKEN, challenge: '1234567890' });
    expect(challenge).toBe('1234567890');
  });

  it('rejects when the mode is not subscribe', () => {
    expectFailure(() => verifyWhatsAppWebhook({ verifyToken: VERIFY_TOKEN, mode: undefined, token: VERIFY_TOKEN, challenge: 'c' }), 'invalid_mode');
  });

  it('rejects when the verify token does not match', () => {
    expectFailure(() => verifyWhatsAppWebhook({ verifyToken: VERIFY_TOKEN, mode: 'subscribe', token: 'wrong', challenge: 'c' }), 'invalid_verify_token');
  });

  it('rejects when the verify token is missing', () => {
    expectFailure(() => verifyWhatsAppWebhook({ verifyToken: VERIFY_TOKEN, mode: 'subscribe', token: undefined, challenge: 'c' }), 'invalid_verify_token');
  });

  it('rejects when the challenge is missing', () => {
    expectFailure(() => verifyWhatsAppWebhook({ verifyToken: VERIFY_TOKEN, mode: 'subscribe', token: VERIFY_TOKEN, challenge: undefined }), 'missing_challenge');
  });
});
