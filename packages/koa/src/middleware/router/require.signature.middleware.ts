import { createHmac, BinaryToTextEncoding } from 'node:crypto';
import { ServerKitRouterMiddleware } from '../../serverkit.middleware.js';
import { httpError } from '@maroonedsoftware/errors';
import { AppConfig } from '@maroonedsoftware/appconfig';

/**
 * Configuration for {@link requireSignature}.
 *
 * Stored in `AppConfig` and retrieved by key at request time, so the values
 * can be loaded from any AppConfig source (JSON, `.env`, GCP secrets, etc.).
 */
export type SignatureOptions = {
  /** Name of the request header that carries the HMAC signature (e.g. `'X-Signature'`). */
  header: string;
  /** Secret key used to compute the HMAC. */
  secret: string;
  /** HMAC algorithm passed to `crypto.createHmac` (e.g. `'sha256'`, `'sha512'`). */
  algorithm: string;
  /** Output encoding for `hmac.digest()` (e.g. `'hex'`, `'base64'`). */
  digest: BinaryToTextEncoding;
};

/**
 * Router middleware that verifies a request signature against an HMAC of `ctx.rawBody`.
 *
 * Reads {@link SignatureOptions} from `AppConfig` using `optionsKey`, then:
 * - Computes `HMAC(algorithm, secret).update(ctx.rawBody).digest(digest)`
 * - Reads the expected signature from the request header named `options.header`
 * - Throws HTTP 401 (with internal diagnostics) if the signatures do not match
 * - Calls `next()` otherwise
 *
 * Requires `ctx.rawBody` to be populated before this middleware runs — use
 * {@link bodyParserMiddleware} upstream to ensure the raw bytes are captured.
 *
 * @param optionsKey - Key used to retrieve {@link SignatureOptions} from `AppConfig` via `getAs`.
 * @returns A {@link ServerKitRouterMiddleware} that guards the route.
 *
 * @example
 * ```typescript
 * // config.json
 * // { "webhook": { "header": "X-Hub-Signature-256", "secret": "${env:WEBHOOK_SECRET}", "algorithm": "sha256", "digest": "hex" } }
 *
 * router.post('/webhooks/github', requireSignature('webhook'), handler);
 * ```
 */
export const requireSignature = (optionsKey: string): ServerKitRouterMiddleware => {
  return async (ctx, next) => {
    const options = ctx.container.get(AppConfig).getAs<SignatureOptions>(optionsKey);

    const { header, secret, algorithm, digest } = options;

    const hmac = createHmac(algorithm, secret).update(ctx.rawBody);

    const signature = ctx.get(header);
    const computedSignature = hmac.digest(digest);
    if (computedSignature !== signature) {
      throw httpError(401).withInternalDetails({
        message: 'Invalid signature',
        header,
        computedSignature,
        signature,
        algorithm,
        digest,
      });
    }

    await next();
  };
};
