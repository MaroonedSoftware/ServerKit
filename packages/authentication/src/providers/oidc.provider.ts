import { Injectable } from 'injectkit';
import * as openidClient from 'openid-client';
import { httpError } from '@maroonedsoftware/errors';

/**
 * Static configuration for a single OpenID Connect provider (Google, LinkedIn, Microsoft, etc.).
 *
 * Public clients (mobile, SPA) omit `clientSecret`; the registry will configure
 * the underlying {@link openidClient.Configuration} with no client authentication
 * and PKCE becomes mandatory at the service layer.
 */
export type OidcProviderConfig = {
  /** Stable identifier used to look up this provider (e.g. `"google"`). Lowercase by convention. */
  name: string;
  /** Base URL of the OIDC issuer used for `.well-known/openid-configuration` discovery. */
  issuer: URL;
  /** OAuth 2.0 client id registered with the provider. */
  clientId: string;
  /**
   * OAuth 2.0 client secret. Omit for public clients (mobile/SPA). Required for
   * confidential clients; some providers (e.g. Google web) reject requests without one.
   */
  clientSecret?: string;
  /** Scopes to request. `"openid"` should be present; defaults handled at the service layer if empty. */
  scopes: string[];
  /** Redirect URI registered with the provider. Must match exactly. */
  redirectUri: URL;
  /**
   * Extra query parameters appended to the authorization request — e.g.
   * `{ access_type: 'offline', prompt: 'consent' }` for Google to issue a refresh token.
   */
  authorizeParams?: Record<string, string>;
  /**
   * Persist the upstream refresh token (envelope-encrypted) on the factor so the app can
   * call provider APIs later or silently refresh access tokens. Defaults to `false`.
   * Ignored for public clients — public-client refresh tokens require DPoP/proxying which
   * this package does not implement, so they are dropped on the floor.
   */
  persistRefreshToken?: boolean;
};

/** Injection token holding the user-supplied list of OIDC providers. */
@Injectable()
export class OidcProviderRegistryConfig {
  constructor(public readonly providers: OidcProviderConfig[] = []) {}
}

/**
 * Lazily resolves and caches one {@link openidClient.Configuration} per registered provider.
 *
 * Discovery (`.well-known/openid-configuration` + JWKS) hits the network exactly
 * once per provider per process; subsequent calls return the cached `Configuration`.
 *
 * Thread-safety: in-flight discoveries are deduped via a promise cache so concurrent
 * lookups for the same provider share a single network request.
 */
@Injectable()
export class OidcProviderRegistry {
  private readonly configs: Map<string, OidcProviderConfig>;
  private readonly resolved = new Map<string, Promise<openidClient.Configuration>>();

  constructor(registry: OidcProviderRegistryConfig) {
    this.configs = new Map(registry.providers.map((p) => [p.name, p]));
  }

  /**
   * Look up the static config for a provider.
   * @throws HTTP 404 when no provider is registered under `name`.
   */
  getConfig(name: string): OidcProviderConfig {
    const config = this.configs.get(name);
    if (!config) {
      throw httpError(404).withDetails({ provider: 'unknown provider' });
    }
    return config;
  }

  /** `true` when `clientSecret` was omitted from the static config. */
  isPublicClient(name: string): boolean {
    return this.getConfig(name).clientSecret === undefined;
  }

  /**
   * Resolve (and cache) the openid-client `Configuration` for a provider. Performs
   * OIDC discovery on first call.
   */
  async getConfiguration(name: string): Promise<openidClient.Configuration> {
    const cached = this.resolved.get(name);
    if (cached) return cached;

    const config = this.getConfig(name);
    const promise = this.discover(config).catch((error) => {
      // Drop the rejected promise so a transient failure doesn't poison the cache.
      this.resolved.delete(name);
      throw error;
    });
    this.resolved.set(name, promise);
    return promise;
  }

  /** Names of all providers registered at construction time. */
  listProviders(): string[] {
    return [...this.configs.keys()];
  }

  private async discover(config: OidcProviderConfig): Promise<openidClient.Configuration> {
    if (config.clientSecret === undefined) {
      return openidClient.discovery(config.issuer, config.clientId, undefined, openidClient.None());
    }
    return openidClient.discovery(config.issuer, config.clientId, config.clientSecret);
  }
}
