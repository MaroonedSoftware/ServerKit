import { describe, it, expect } from 'vitest';
import { verifyWhatsAppSignature, type WhatsAppSignatureFailureReason } from '../src/whatsapp.signature.js';
import { WhatsAppError } from '../src/whatsapp.error.js';
import { signBody } from './helpers.js';

const SECRET = 'app-secret';

const expectFailure = (fn: () => void, reason: WhatsAppSignatureFailureReason) => {
  try {
    fn();
    throw new Error(`expected WhatsAppError with reason "${reason}"`);
  } catch (err) {
    expect(err).toBeInstanceOf(WhatsAppError);
    expect((err as WhatsAppError).internalDetails?.reason).toBe(reason);
  }
};

describe('verifyWhatsAppSignature', () => {
  it('passes when the signature matches the body', () => {
    const rawBody = '{"object":"whatsapp_business_account"}';
    expect(() => verifyWhatsAppSignature({ appSecret: SECRET, rawBody, signature: signBody(rawBody, SECRET) })).not.toThrow();
  });

  it('rejects when the body has been tampered with', () => {
    const sigForOriginal = signBody('original', SECRET);
    expectFailure(() => verifyWhatsAppSignature({ appSecret: SECRET, rawBody: 'tampered', signature: sigForOriginal }), 'invalid_signature');
  });

  it('rejects when signed with a different secret', () => {
    const rawBody = 'payload';
    expectFailure(() => verifyWhatsAppSignature({ appSecret: SECRET, rawBody, signature: signBody(rawBody, 'other-secret') }), 'invalid_signature');
  });

  it('rejects a missing signature', () => {
    expectFailure(() => verifyWhatsAppSignature({ appSecret: SECRET, rawBody: 'x', signature: undefined }), 'missing_signature');
  });

  it('rejects an empty-string signature', () => {
    expectFailure(() => verifyWhatsAppSignature({ appSecret: SECRET, rawBody: 'x', signature: '' }), 'missing_signature');
  });

  it('rejects a signature of differing length without throwing from crypto', () => {
    expectFailure(() => verifyWhatsAppSignature({ appSecret: SECRET, rawBody: 'x', signature: 'sha256=short' }), 'invalid_signature');
  });
});
