import { Injectable } from 'injectkit';
import type { Duration } from 'luxon';

/** How the authorization server describes itself, and what it serves. Shared by the token endpoint and the facade. */
@Injectable()
export class OAuthAuthorizationServerOptions {
  constructor(
    /** The issuer identifier: an `https:` URL, usually the origin. Sent as `iss` on every authorization response. */
    public readonly issuer: string,
    /** The consumer's consent page, where clients send users. */
    public readonly authorizationEndpoint: string,
    /** The consumer's token route. */
    public readonly tokenEndpoint: string,
    /** Every resource tokens may be issued for. A token is bound to exactly one. */
    public readonly resources: readonly string[],
    /** Scopes advertised and echoed. Nothing in the package authorizes on them. */
    public readonly scopesSupported: readonly string[],
    /** The consumer's registration route. Dynamic Client Registration is on exactly when this is set. */
    public readonly registrationEndpoint?: string,
    /** Lifetime of a session minted for a client. Defaults to the session service's. */
    public readonly sessionExpiration?: Duration,
  ) {}
}
