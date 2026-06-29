import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { WhatsAppConfig } from './whatsapp.config.js';
import { IsWhatsAppError } from './whatsapp.error.js';
import { verifyWhatsAppSignature, WHATSAPP_SIGNATURE_HEADER, type WhatsAppSignatureFailureReason } from './whatsapp.signature.js';

/**
 * Policy name under which {@link WhatsAppSignaturePolicy} is registered. Use as
 * the key when wiring your `PolicyRegistryMap`, and pass to `PolicyService.check`.
 */
export const WHATSAPP_SIGNATURE_POLICY = 'whatsapp.signature.valid' as const;

/**
 * Configuration the {@link WhatsAppSignaturePolicy} reads. A structural subset of
 * {@link WhatsAppConfig}, so a `WhatsAppConfig` value satisfies it directly — e.g.
 * `requireSignature<WhatsAppSignatureOptions>('whatsapp')` with the WhatsApp
 * config stored under that `AppConfig` key.
 */
export type WhatsAppSignatureOptions = Pick<WhatsAppConfig, 'appSecret'>;

/**
 * Context for {@link WhatsAppSignaturePolicy}: the raw request bytes, a
 * case-insensitive header accessor, and the {@link WhatsAppSignatureOptions}.
 *
 * Structurally compatible with `@maroonedsoftware/koa`'s
 * `SignaturePolicyContext<WhatsAppSignatureOptions>`, so the koa
 * `requireSignature` middleware can drive this policy without the whatsapp
 * package depending on koa.
 */
export interface WhatsAppSignaturePolicyContext {
  /** Raw, unparsed request body — exactly as Meta sent it (from `ctx.rawBody`). */
  rawBody: string | Uint8Array;
  /** Case-insensitive request header accessor (Koa's `ctx.get`); returns `''` when absent. */
  getHeader: (name: string) => string;
  /** WhatsApp signing configuration. */
  options: WhatsAppSignatureOptions;
}

/**
 * Policy form of {@link verifyWhatsAppSignature}: verifies a WhatsApp webhook
 * request against the app secret (HMAC-SHA256 over the raw body, `sha256=`-prefixed).
 *
 * Delegates to {@link verifyWhatsAppSignature} so the crypto logic has a single
 * source of truth, but answers as a {@link PolicyResult} rather than throwing:
 * allows on success, denies on failure with the helper's
 * {@link WhatsAppSignatureFailureReason} as the denial `reason` — never the app
 * secret on the wire.
 *
 * Registered by default under {@link WHATSAPP_SIGNATURE_POLICY}.
 *
 * @example
 * ```ts
 * const result = await policyService.check(WHATSAPP_SIGNATURE_POLICY, {
 *   rawBody: ctx.rawBody,
 *   getHeader: name => ctx.get(name),
 *   options: ctx.container.get(WhatsAppConfig),
 * });
 * if (isPolicyResultDenied(result)) throw httpError(401);
 * ```
 */
@Injectable()
export class WhatsAppSignaturePolicy extends Policy<WhatsAppSignaturePolicyContext> {
  async evaluate(context: WhatsAppSignaturePolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    const { rawBody, getHeader, options } = context;

    // Meta signs the raw text body; `ctx.rawBody` may arrive as a Buffer.
    const body = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString('utf8');

    try {
      verifyWhatsAppSignature({ appSecret: options.appSecret, rawBody: body, signature: getHeader(WHATSAPP_SIGNATURE_HEADER) });
      return this.allow();
    } catch (error) {
      if (!IsWhatsAppError(error)) throw error;

      const internalDetails = error.internalDetails ?? {};
      const reason = typeof internalDetails.reason === 'string' ? internalDetails.reason : ('invalid_signature' satisfies WhatsAppSignatureFailureReason);
      return this.deny(reason, undefined, { message: error.message, ...internalDetails });
    }
  }
}
