import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';

/**
 * The SP's own key pair for encrypted assertions. The private key decrypts; the certificate
 * is published in the SP metadata so the IdP knows what to encrypt to.
 */
export type SamlSpDecryption = {
  /** PEM-encoded private key. */
  privateKey: string;
  /** PEM (or bare base64 DER) certificate for `privateKey`, advertised as `use="encryption"`. */
  certificate: string;
};

/**
 * Configuration for one SAML 2.0 identity provider, as seen from this service provider.
 *
 * One entry per connection: a multi-tenant app lists one provider per organization, each with
 * its own `name`. The IdP fields usually come from {@link parseIdpMetadata}.
 */
export type SamlProviderConfig = {
  /**
   * Stable identifier used to look up this provider (e.g. `"acme.okta"`). It is the consumer's
   * slug and is stored on every factor created through the provider, so renaming it orphans
   * those factors.
   */
  name: string;
  /** This SP's entity id. Sent as the AuthnRequest `Issuer` and required as the assertion's `Audience`. */
  spEntityId: string;
  /** Assertion Consumer Service URL (HTTP-POST binding). Required as the response's `Destination` and `Recipient`. */
  acsUrl: URL;
  /** The IdP's entity id. Required as the response and assertion `Issuer`. */
  idpEntityId: string;
  /** The IdP's HTTP-Redirect binding SingleSignOnService URL, where AuthnRequests are sent. */
  idpSsoUrl: URL;
  /**
   * The IdP's signing certificates, PEM or bare base64 DER. A signature from any of them is
   * accepted, so list the outgoing and incoming certificates together during a rotation.
   * Must not be empty: certificates are only ever taken from here, never from a message's `KeyInfo`.
   */
  idpSigningCertificates: readonly string[];
  /** The SP's decryption key pair. Omit to accept unencrypted assertions only. */
  spDecryption?: SamlSpDecryption;
  /**
   * Accepted `AuthnContextClassRef` values (e.g.
   * `urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport`). Requested from the IdP and
   * checked on the assertion. Omit or leave empty to accept any.
   */
  acceptedAuthnContexts?: readonly string[];
  /**
   * The `NameIDFormat` requested and advertised in the SP metadata. Defaults to
   * {@link DEFAULT_SAML_NAME_ID_FORMAT}.
   */
  nameIdFormat?: string;
};

/** The NameID format used when a provider sets none: `emailAddress`, which Okta, Entra ID and Google all issue. */
export const DEFAULT_SAML_NAME_ID_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';

/**
 * Where {@link SamlProviderRegistry} reads its providers from, and the DI token for it.
 *
 * The registry calls {@link SamlProviderSource.list} on **every** lookup, so a source backed by
 * a database or a settings store makes providers appear, change (a rotated certificate), and
 * disappear without a restart. Keep `list()` cheap: cache the expensive part inside the source
 * if it matters.
 *
 * {@link SamlProviderRegistryConfig} is the static implementation.
 *
 * @example
 * ```ts
 * registry.register(SamlProviderSource).useClass(OrgSamlProviderSource).asSingleton();
 * ```
 */
@Injectable()
export abstract class SamlProviderSource {
  /** Every provider currently configured. Names must be unique; the first entry wins on a duplicate. */
  abstract list(): Promise<readonly SamlProviderConfig[]> | readonly SamlProviderConfig[];
}

/**
 * A fixed provider list, built once at bootstrap.
 *
 * Register it under the {@link SamlProviderSource} token:
 * `registry.register(SamlProviderSource).useValue(new SamlProviderRegistryConfig([...]))`.
 */
@Injectable()
export class SamlProviderRegistryConfig extends SamlProviderSource {
  constructor(public readonly providers: SamlProviderConfig[] = []) {
    super();
  }

  list(): readonly SamlProviderConfig[] {
    return this.providers;
  }
}

/**
 * Resolves providers by name from a {@link SamlProviderSource}. Every lookup consults the
 * source, so nothing is cached here: a changed certificate list takes effect on the next lookup.
 */
@Injectable()
export class SamlProviderRegistry {
  constructor(private readonly source: SamlProviderSource) {}

  /**
   * The configuration of one provider, as the source lists it now.
   *
   * @throws HTTP 404 when the source does not list `name`.
   */
  async getConfig(name: string): Promise<SamlProviderConfig> {
    const providers = await this.source.list();
    const config = providers.find(provider => provider.name === name);
    if (!config) {
      throw httpError(404).withDetails({ provider: 'unknown provider' });
    }
    return config;
  }

  /** The names of every provider the source lists now. */
  async listProviders(): Promise<string[]> {
    const providers = await this.source.list();
    return [...new Set(providers.map(provider => provider.name))];
  }
}
