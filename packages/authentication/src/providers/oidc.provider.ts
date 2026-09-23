import crypto from 'node:crypto';
import { Injectable } from 'injectkit';
import * as openidClient from 'openid-client';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';

/**
 * Static configuration for a single OpenID Connect provider (Google, LinkedIn, Microsoft, etc.).
 *
 * Public clients (mobile, SPA) omit `clientSecret`; the registry will configure
 * the underlying {@link openidClient.Configuration} with no client authentication
 * and PKCE becomes mandatory at the service layer.
 */
export type OidcProviderConfig = {
  /**
   * Stable identifier used to look up this provider (e.g. `"google"`). Lowercase by convention.
   *
   * It is the consumer's slug, and it is stored on every factor created through the
   * provider. Renaming a provider orphans those factors: they no longer resolve to a
   * registered provider, so their owners can no longer sign in through them.
   */
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
  /**
   * Permit an `http://` issuer URL by passing `openid-client`'s
   * `allowInsecureRequests` execute hook to discovery. Intended for local
   * development against a stub IdP (e.g. a docker-compose Keycloak on
   * `http://localhost`). When the issuer is `https://`, this flag has no
   * effect on transport but still emits a warning so it isn't left enabled
   * by accident. **Never set in production.**
   */
  allowInsecureIssuer?: boolean;
};

/**
 * Where {@link OidcProviderRegistry} reads its providers from, and the DI token for it.
 *
 * The registry calls {@link OidcProviderSource.list} on **every** lookup, so a source
 * backed by a database or a settings store makes providers appear, change, and
 * disappear without a restart. Keep `list()` cheap: cache the expensive part (a query,
 * a secret decryption) inside the source if it matters. The registry's own discovery
 * cache is keyed by a fingerprint of each provider's issuer and credentials, so a
 * rotated client secret triggers a fresh discovery on the next lookup.
 *
 * {@link OidcProviderRegistryConfig} is the static implementation and the default.
 *
 * @example
 * ```ts
 * registry.register(OidcProviderSource).useClass(SettingsOidcProviderSource).asSingleton();
 * ```
 */
@Injectable()
export abstract class OidcProviderSource {
  /** Every provider currently configured. Names must be unique; the first entry wins on a duplicate. */
  abstract list(): Promise<readonly OidcProviderConfig[]> | readonly OidcProviderConfig[];
}

/**
 * A fixed provider list, built once at bootstrap. The default {@link OidcProviderSource}.
 *
 * Register it under the {@link OidcProviderSource} token:
 * `registry.register(OidcProviderSource).useValue(new OidcProviderRegistryConfig([...]))`.
 */
@Injectable()
export class OidcProviderRegistryConfig extends OidcProviderSource {
  constructor(public readonly providers: OidcProviderConfig[] = []) {
    super();
  }

  list(): readonly OidcProviderConfig[] {
    return this.providers;
  }
}

/** A discovery in flight or done, and the credentials it was made with. */
type ResolvedConfiguration = {
  fingerprint: string;
  configuration: Promise<openidClient.Configuration>;
};

/**
 * Resolves providers from an {@link OidcProviderSource} and caches one discovered
 * {@link openidClient.Configuration} per provider.
 *
 * Every lookup consults the source, so the registry is async throughout. Discovery
 * (`.well-known/openid-configuration` + JWKS) is cached per provider name together
 * with a fingerprint of the issuer, client id, client secret, and `allowInsecureIssuer`.
 * A lookup whose fingerprint differs from the cached one discards the entry and
 * rediscovers; a provider no longer listed loses its entry and answers 404.
 *
 * Concurrent lookups for the same provider and fingerprint share a single discovery.
 * A rejected discovery is evicted so the next lookup retries it.
 *
 * Dependencies: an {@link OidcProviderSource} and a {@link Logger} (used to warn when a
 * provider sets `allowInsecureIssuer`).
 */
@Injectable()
export class OidcProviderRegistry {
  private readonly resolved = new Map<string, ResolvedConfiguration>();

  constructor(
    private readonly source: OidcProviderSource,
    private readonly logger: Logger,
  ) {}

  /**
   * The configuration of one provider, as the source lists it now.
   *
   * @throws HTTP 404 when the source does not list `name`.
   */
  async getConfig(name: string): Promise<OidcProviderConfig> {
    return await this.resolveConfig(name);
  }

  /** `true` when the provider is a public client (no `clientSecret`). */
  async isPublicClient(name: string): Promise<boolean> {
    return (await this.resolveConfig(name)).clientSecret === undefined;
  }

  /**
   * The discovered `openid-client` configuration for a provider. Discovery runs once
   * per provider and credential set; a changed issuer, client id, or client secret
   * rediscovers.
   *
   * @throws HTTP 404 when the source does not list `name`.
   */
  async getConfiguration(name: string): Promise<openidClient.Configuration> {
    const config = await this.resolveConfig(name);
    const fingerprint = this.fingerprint(config);

    const cached = this.resolved.get(name);
    if (cached && cached.fingerprint === fingerprint) {
      return cached.configuration;
    }

    // A different fingerprint orphans the old discovery: callers already holding it
    // finish their one request against the old configuration.
    const configuration = this.discover(config).catch(error => {
      // Evict by identity, so a late failure of an orphaned discovery cannot drop the
      // entry that replaced it. Dropping the rejected promise lets the next lookup retry.
      if (this.resolved.get(name)?.configuration === configuration) {
        this.resolved.delete(name);
      }
      throw error;
    });
    this.resolved.set(name, { fingerprint, configuration });
    return configuration;
  }

  /** The names of every provider the source lists now. */
  async listProviders(): Promise<string[]> {
    const providers = await this.source.list();
    return [...new Set(providers.map(provider => provider.name))];
  }

  private async resolveConfig(name: string): Promise<OidcProviderConfig> {
    const providers = await this.source.list();
    const config = providers.find(provider => provider.name === name);
    if (!config) {
      this.resolved.delete(name);
      throw httpError(404).withDetails({ provider: 'unknown provider' });
    }
    return config;
  }

  private fingerprint(config: OidcProviderConfig): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify([config.issuer.href, config.clientId, config.clientSecret ?? '', String(config.allowInsecureIssuer ?? false)]))
      .digest('hex');
  }

  private async discover(config: OidcProviderConfig): Promise<openidClient.Configuration> {
    const allowInsecureIssuer = config.issuer.protocol === 'http:' && config.allowInsecureIssuer;

    if (config.allowInsecureIssuer) {
      this.logger.warn(`OIDC provider "${config.name}" has allowInsecureIssuer=true — http issuer URLs are permitted. Do NOT enable in production.`);
    }

    const options = allowInsecureIssuer ? { execute: [openidClient.allowInsecureRequests] } : undefined;

    if (config.clientSecret === undefined) {
      return openidClient.discovery(config.issuer, config.clientId, undefined, openidClient.None(), options);
    }
    // Match upstream's shorthand: pass clientSecret as the `metadata` arg (3rd) so
    // openid-client wires up its default client authentication.
    return openidClient.discovery(config.issuer, config.clientId, config.clientSecret, undefined, options);
  }
}
