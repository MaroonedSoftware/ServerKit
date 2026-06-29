import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { TelegramConfig } from './telegram.config.js';
import { IsTelegramError } from './telegram.error.js';
import { verifyTelegramSecretToken, TELEGRAM_SECRET_TOKEN_HEADER, type TelegramSecretTokenFailureReason } from './telegram.secret.token.js';

/**
 * Policy name under which {@link TelegramSecretTokenPolicy} is registered. Use as
 * the key when wiring your `PolicyRegistryMap`, and pass to `PolicyService.check`.
 */
export const TELEGRAM_SECRET_TOKEN_POLICY = 'telegram.secret.token.valid' as const;

/**
 * Configuration the {@link TelegramSecretTokenPolicy} reads. A structural subset
 * of {@link TelegramConfig}, so a `TelegramConfig` value satisfies it directly.
 */
export type TelegramSecretTokenOptions = Pick<TelegramConfig, 'secretToken'>;

/**
 * Context for {@link TelegramSecretTokenPolicy}: a case-insensitive header
 * accessor and the {@link TelegramSecretTokenOptions}.
 *
 * `rawBody` is accepted but unused (Telegram does not sign payloads) so the
 * context stays structurally compatible with `@maroonedsoftware/koa`'s
 * `SignaturePolicyContext<TelegramSecretTokenOptions>` and the koa
 * `requireSignature` middleware can drive this policy.
 */
export interface TelegramSecretTokenPolicyContext {
  /** Unused — present for structural compatibility with koa's signature policy context. */
  rawBody?: string | Uint8Array;
  /** Case-insensitive request header accessor (Koa's `ctx.get`); returns `''` when absent. */
  getHeader: (name: string) => string;
  /** Telegram secret-token configuration. */
  options: TelegramSecretTokenOptions;
}

/**
 * Policy form of {@link verifyTelegramSecretToken}: verifies the
 * `X-Telegram-Bot-Api-Secret-Token` header against the configured secret token.
 *
 * Delegates to {@link verifyTelegramSecretToken} so the comparison logic has a
 * single source of truth, but answers as a {@link PolicyResult} rather than
 * throwing: allows on success, denies on failure with the helper's
 * {@link TelegramSecretTokenFailureReason} as the denial `reason` — never the
 * secret token on the wire.
 *
 * Registered by default under {@link TELEGRAM_SECRET_TOKEN_POLICY}.
 *
 * @example
 * ```ts
 * const result = await policyService.check(TELEGRAM_SECRET_TOKEN_POLICY, {
 *   getHeader: name => ctx.get(name),
 *   options: ctx.container.get(TelegramConfig),
 * });
 * if (isPolicyResultDenied(result)) throw httpError(401);
 * ```
 */
@Injectable()
export class TelegramSecretTokenPolicy extends Policy<TelegramSecretTokenPolicyContext> {
  async evaluate(context: TelegramSecretTokenPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    const { getHeader, options } = context;

    try {
      verifyTelegramSecretToken({ secretToken: options.secretToken ?? '', headerValue: getHeader(TELEGRAM_SECRET_TOKEN_HEADER) });
      return this.allow();
    } catch (error) {
      if (!IsTelegramError(error)) throw error;

      const internalDetails = error.internalDetails ?? {};
      const reason = typeof internalDetails.reason === 'string' ? internalDetails.reason : ('invalid_secret_token' satisfies TelegramSecretTokenFailureReason);
      return this.deny(reason, undefined, { message: error.message, ...internalDetails });
    }
  }
}
