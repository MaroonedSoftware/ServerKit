import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  WhatsAppSignaturePolicy,
  WHATSAPP_SIGNATURE_POLICY,
  type WhatsAppSignatureOptions,
  type WhatsAppSignaturePolicyContext,
} from '../src/whatsapp.signature.policy.js';
import { WHATSAPP_SIGNATURE_HEADER } from '../src/whatsapp.signature.js';
import { isPolicyResultAllowed, isPolicyResultDenied, type PolicyEnvelope } from '@maroonedsoftware/policies';
import type { WhatsAppSignatureFailureReason } from '../src/whatsapp.signature.js';
import { signBody } from './helpers.js';

const SECRET = 'app-secret';
const OPTIONS: WhatsAppSignatureOptions = { appSecret: SECRET };
const envelope: PolicyEnvelope = { now: DateTime.fromSeconds(1_700_000_000, { zone: 'utc' }) };

const makeContext = (rawBody: WhatsAppSignaturePolicyContext['rawBody'], signature: string | undefined): WhatsAppSignaturePolicyContext => ({
  rawBody,
  getHeader: name => (name === WHATSAPP_SIGNATURE_HEADER ? (signature ?? '') : ''),
  options: OPTIONS,
});

const evaluate = (rawBody: WhatsAppSignaturePolicyContext['rawBody'], signature: string | undefined) =>
  new WhatsAppSignaturePolicy().evaluate(makeContext(rawBody, signature), envelope);

const expectDenied = async (result: Awaited<ReturnType<typeof evaluate>>, reason: WhatsAppSignatureFailureReason) => {
  expect(isPolicyResultDenied(result)).toBe(true);
  if (isPolicyResultDenied(result)) {
    expect(result.reason).toBe(reason);
  }
};

describe('WhatsAppSignaturePolicy', () => {
  it('is registered under the expected name', () => {
    expect(WHATSAPP_SIGNATURE_POLICY).toBe('whatsapp.signature.valid');
  });

  it('allows when the signature matches', async () => {
    const rawBody = '{"object":"whatsapp_business_account"}';
    const result = await evaluate(rawBody, signBody(rawBody, SECRET));
    expect(isPolicyResultAllowed(result)).toBe(true);
  });

  it('accepts a Buffer raw body (converted to UTF-8 text)', async () => {
    const rawBody = '{"object":"whatsapp_business_account"}';
    const result = await evaluate(Buffer.from(rawBody, 'utf8'), signBody(rawBody, SECRET));
    expect(isPolicyResultAllowed(result)).toBe(true);
  });

  it('denies a tampered body with reason invalid_signature', async () => {
    const result = await evaluate('tampered', signBody('original', SECRET));
    await expectDenied(result, 'invalid_signature');
  });

  it('denies a missing signature header', async () => {
    const result = await evaluate('x', undefined);
    await expectDenied(result, 'missing_signature');
  });

  it('keeps the app secret out of the denial diagnostics', async () => {
    const result = await evaluate('tampered', signBody('original', SECRET));
    expect(isPolicyResultDenied(result)).toBe(true);
    if (isPolicyResultDenied(result)) {
      expect(JSON.stringify(result.internalDetails)).not.toContain(SECRET);
    }
  });
});
