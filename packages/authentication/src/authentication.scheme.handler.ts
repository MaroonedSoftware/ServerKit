import { Injectable } from 'injectkit';
import type { AuthenticationHandler, AuthorizationScheme } from './authentication.handler.js';
import { Logger } from '@maroonedsoftware/logger';
import { invalidAuthenticationSession } from './types.js';

/**
 * Injectable map of authorization scheme → {@link AuthenticationHandler}.
 * Register handlers here via DI before the server starts.
 */
@Injectable()
export class AuthenticationHandlerMap extends Map<AuthorizationScheme, AuthenticationHandler> {}

/**
 * Parses the `Authorization` request header, looks up the matching
 * {@link AuthenticationHandler} from {@link AuthenticationHandlerMap}, and
 * delegates validation to it.
 *
 * Returns {@link invalidAuthenticationSession} when:
 * - No `Authorization` header is present
 * - The header is malformed (missing scheme or value)
 * - No handler is registered for the scheme
 */
@Injectable()
export class AuthenticationSchemeHandler {
  constructor(
    private readonly handlers: AuthenticationHandlerMap,
    private readonly logger: Logger,
  ) {}

  /**
   * Resolve an {@link AuthenticationSession} from the raw `Authorization` header value.
   *
   * Splits the header on the first space only — the value passed to the handler retains
   * any subsequent spaces, so schemes with space-separated parameters (e.g.
   * `Digest username="x", nonce="y"`) reach the handler intact.
   *
   * @param authorizationHeader - The full `Authorization` header string (e.g. `"Bearer <token>"`),
   *   or `undefined` if the header was absent.
   * @returns The resolved {@link AuthenticationSession}, or {@link invalidAuthenticationSession}
   *   if the header is absent, malformed, or no handler is registered for the scheme.
   */
  async handle(authorizationHeader?: string) {
    if (authorizationHeader) {
      // Split only on the first space so schemes with space-separated parameters
      // (e.g. `Digest username="x", nonce="y"`) retain their full value.
      const separator = authorizationHeader.indexOf(' ');
      const scheme = separator === -1 ? '' : authorizationHeader.slice(0, separator);
      const value = separator === -1 ? '' : authorizationHeader.slice(separator + 1);
      if (!scheme || !value) {
        this.logger.warn('Invalid authorization header');
        return invalidAuthenticationSession;
      }
      const normalizedScheme = scheme.toLowerCase();
      const handler = this.handlers.get(normalizedScheme);
      if (!handler) {
        this.logger.warn('No authentication handler found for scheme', { scheme: normalizedScheme });
        return invalidAuthenticationSession;
      }
      return await handler.authenticate(normalizedScheme, value);
    }
    return invalidAuthenticationSession;
  }
}
