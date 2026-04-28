import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';

/**
 * Tokens returned by an OAuth 2.0 token endpoint, normalized across providers.
 *
 * `expiresAt` is computed from `expires_in` at validation time; downstream code
 * should treat it as authoritative rather than recomputing from `expires_in` later.
 */
export type OAuth2Tokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  /** Some non-OIDC providers (notably Google when `openid` scope is requested) still issue an id_token. */
  idToken?: string;
  scopes?: string[];
};

/**
 * Normalized profile pulled from a provider-specific user-info endpoint.
 *
 * `subject` is whatever the provider considers a stable per-user id — `id` from
 * GitHub, `id` from Discord, `sub` from Google's userinfo, etc. Always coerce
 * to a string so the (provider, subject) factor key has consistent shape.
 */
export type OAuth2Profile = {
  provider: string;
  subject: string;
  email?: string;
  /**
   * `true` only when the provider explicitly tells us the email is verified
   * (e.g. GitHub's primary verified email). Default `false` is safer for the
   * auto-link decision than `undefined`.
   */
  emailVerified?: boolean;
  name?: string;
  picture?: string;
  /** Raw provider response. Apps can read provider-specific fields from here. */
  rawProfile: Record<string, unknown>;
};

/**
 * Adapter consumed by {@link OAuth2FactorService}. Wraps a provider-specific
 * OAuth 2.0 client (e.g. an [arctic](https://github.com/pilcrowonpaper/arctic)
 * provider instance) behind a uniform interface.
 *
 * `codeVerifier` is `null` when the provider doesn't use PKCE — the registry's
 * `usesPKCE` flag drives whether the service generates one.
 */
export interface OAuth2ProviderClient {
  /** Build the authorize URL the browser should be redirected to. */
  createAuthorizationURL(state: string, codeVerifier: string | null, scopes: string[]): URL;

  /**
   * Exchange the authorization code for tokens. Throws on validation failure.
   *
   * Adapter is responsible for raising on a `state` mismatch or token-endpoint error;
   * the service does not see the raw HTTP response.
   */
  validateAuthorizationCode(code: string, codeVerifier: string | null): Promise<OAuth2Tokens>;

  /**
   * Optional. Provided when the adapter supports the refresh-token grant.
   * Service-level {@link OAuth2FactorService.refreshAccessToken} requires this.
   */
  refreshAccessToken?(refreshToken: string): Promise<OAuth2Tokens>;
}

/**
 * Static configuration for a single OAuth 2.0 provider (GitHub, Twitter/X, Discord, …).
 *
 * `client` should be constructed once at app boot and reused — adapters typically
 * hold the `clientSecret` internally. `fetchProfile` is provider-specific (GitHub's
 * `/user` + `/user/emails`, Discord's `/users/@me`, etc.).
 */
export type OAuth2ProviderConfig = {
  name: string;
  client: OAuth2ProviderClient;
  scopes: string[];
  /** When true, the service generates a PKCE pair and passes the verifier through. */
  usesPKCE: boolean;
  /** Resolve the user's profile from an access token. Implementation is provider-specific. */
  fetchProfile: (accessToken: string) => Promise<Omit<OAuth2Profile, 'provider'>>;
  /**
   * Persist the refresh token (envelope-encrypted) on the factor. Defaults to `false`.
   * Ignored when the adapter doesn't implement `refreshAccessToken`.
   */
  persistRefreshToken?: boolean;
};

/** Injection token holding the user-supplied list of OAuth 2.0 providers. */
@Injectable()
export class OAuth2ProviderRegistryConfig {
  constructor(public readonly providers: OAuth2ProviderConfig[] = []) {}
}

/**
 * Registry of OAuth 2.0 (non-OIDC) providers. Unlike {@link OidcProviderRegistry}
 * there's no discovery step — adapters are constructed at app boot and looked up
 * by name.
 */
@Injectable()
export class OAuth2ProviderRegistry {
  private readonly configs: Map<string, OAuth2ProviderConfig>;

  constructor(registry: OAuth2ProviderRegistryConfig) {
    this.configs = new Map(registry.providers.map((p) => [p.name, p]));
  }

  /**
   * Look up the config for a provider.
   * @throws HTTP 404 when no provider is registered under `name`.
   */
  getConfig(name: string): OAuth2ProviderConfig {
    const config = this.configs.get(name);
    if (!config) {
      throw httpError(404).withDetails({ provider: 'unknown provider' });
    }
    return config;
  }

  /** Names of all providers registered at construction time. */
  listProviders(): string[] {
    return [...this.configs.keys()];
  }
}
