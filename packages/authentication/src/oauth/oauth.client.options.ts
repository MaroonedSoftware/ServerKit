import { Injectable } from 'injectkit';
import { Duration } from 'luxon';

/**
 * Settings shared by everything that creates or resolves OAuth clients:
 * {@link DynamicClientRegistrationService} and {@link OAuthClientResolver}.
 */
@Injectable()
export class OAuthClientOptions {
  constructor(
    /**
     * How long a dynamic client lives after it was registered or last used.
     * Claude registers a new client per connection, so an unused one must
     * eventually go; a used one is extended on every token issued to it.
     */
    public readonly dynamicClientLifetime: Duration = Duration.fromObject({ days: 90 }),
    /** Prefix for generated dynamic client ids, as `{prefix}_{random}`. */
    public readonly dynamicClientIdPrefix: string = 'dyn',
    /** Most redirect URIs one client may register or declare. */
    public readonly maxRedirectUris: number = 10,
  ) {}
}
