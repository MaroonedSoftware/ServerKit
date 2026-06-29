import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { DiscordConfig } from './discord.config.js';
import { IsDiscordError } from './discord.error.js';
import { verifyDiscordSignature, type DiscordSignatureFailureReason } from './discord.signature.js';

/**
 * Policy name under which {@link DiscordSignaturePolicy} is registered. Use as
 * the key when wiring your `PolicyRegistryMap`, and pass to `PolicyService.check`.
 */
export const DISCORD_SIGNATURE_POLICY = 'discord.signature.valid' as const;

/** Header carrying the request timestamp Discord signs into the Ed25519 signature. */
export const DISCORD_SIGNATURE_TIMESTAMP_HEADER = 'X-Signature-Timestamp';
/** Header carrying the hex-encoded Ed25519 request signature. */
export const DISCORD_SIGNATURE_HEADER = 'X-Signature-Ed25519';

/**
 * Configuration the {@link DiscordSignaturePolicy} reads. A structural subset of
 * {@link DiscordConfig}, so a `DiscordConfig` value satisfies it directly — e.g.
 * `requireSignature<DiscordSignatureOptions>('discord')` with the Discord config
 * stored under that `AppConfig` key.
 */
export type DiscordSignatureOptions = Pick<DiscordConfig, 'publicKey' | 'signatureMaxAgeSeconds'>;

/**
 * Context for {@link DiscordSignaturePolicy}: the raw request bytes, a
 * case-insensitive header accessor, and the {@link DiscordSignatureOptions}.
 *
 * Structurally compatible with `@maroonedsoftware/koa`'s
 * `SignaturePolicyContext<DiscordSignatureOptions>`, so the koa `requireSignature`
 * middleware can drive this policy without the discord package depending on koa —
 * register `DiscordSignaturePolicy` under the signature policy name and point the
 * middleware at the `AppConfig` key holding the Discord config.
 */
export interface DiscordSignaturePolicyContext {
  /** Raw, unparsed request body — exactly as Discord sent it (from `ctx.rawBody`). */
  rawBody: string | Uint8Array;
  /**
   * Case-insensitive request header accessor (Koa's `ctx.get`); returns `''`
   * when the header is absent.
   */
  getHeader: (name: string) => string;
  /** Discord signing configuration. */
  options: DiscordSignatureOptions;
}

/**
 * Policy form of {@link verifyDiscordSignature}: verifies a Discord interaction
 * request against the application's Ed25519 public key (signature over
 * `timestamp + rawBody`, with optional timestamp replay protection).
 *
 * Delegates to {@link verifyDiscordSignature} so the crypto/timestamp logic has a
 * single source of truth, but answers as a {@link PolicyResult} rather than
 * throwing: allows on success, denies on failure with the helper's
 * {@link DiscordSignatureFailureReason} as the denial `reason` and its
 * diagnostics on `internalDetails` — never the public key on the wire. The
 * replay window (when configured) is anchored to `envelope.now` so all policies
 * in an evaluation share one clock.
 *
 * Registered by default under {@link DISCORD_SIGNATURE_POLICY}.
 *
 * @example
 * ```ts
 * // Direct evaluation in a route handler:
 * const result = await policyService.check(DISCORD_SIGNATURE_POLICY, {
 *   rawBody: ctx.rawBody,
 *   getHeader: name => ctx.get(name),
 *   options: ctx.container.get(DiscordConfig),
 * });
 * if (isPolicyResultDenied(result)) throw httpError(401);
 * ```
 */
@Injectable()
export class DiscordSignaturePolicy extends Policy<DiscordSignaturePolicyContext> {
  async evaluate(context: DiscordSignaturePolicyContext, envelope: PolicyEnvelope): Promise<PolicyResult> {
    const { rawBody, getHeader, options } = context;

    // Discord signs the raw text body; `ctx.rawBody` may arrive as a Buffer.
    const body = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString('utf8');

    try {
      verifyDiscordSignature({
        publicKey: options.publicKey,
        rawBody: body,
        timestamp: getHeader(DISCORD_SIGNATURE_TIMESTAMP_HEADER),
        signature: getHeader(DISCORD_SIGNATURE_HEADER),
        maxAgeSeconds: options.signatureMaxAgeSeconds,
        now: Math.floor(envelope.now.toSeconds()),
      });
      return this.allow();
    } catch (error) {
      if (!IsDiscordError(error)) throw error;

      const internalDetails = error.internalDetails ?? {};
      const reason = typeof internalDetails.reason === 'string' ? internalDetails.reason : ('invalid_signature' satisfies DiscordSignatureFailureReason);
      return this.deny(reason, undefined, { message: error.message, ...internalDetails });
    }
  }
}
