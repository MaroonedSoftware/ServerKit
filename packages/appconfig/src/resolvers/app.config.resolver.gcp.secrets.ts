import { Injectable } from 'injectkit';
import { AppConfigKeyedResolver } from './app.config.resolver.keyed.js';
import { AppConfigSourceGcpSecrets } from '../sources/app.config.source.gcp.secrets.js';

/**
 * Resolver that resolves Google Cloud Secret Manager references (`${gcp:SECRET_NAME}`) in
 * configuration values.
 *
 * A thin wrapper over {@link AppConfigKeyedResolver}: the Secret Manager I/O — client
 * setup, version access, payload decoding, JSON parsing — lives in
 * {@link AppConfigSourceGcpSecrets}, which this resolver delegates to via `get`. Pass a
 * project id (a default source is built for you) or share a pre-configured source instance
 * so one client backs both bulk loading and reference resolution.
 *
 * @remarks
 * Requires valid GCP credentials (Application Default Credentials) via
 * `@google-cloud/secret-manager`.
 *
 * @example
 * ```typescript
 * const config = await new AppConfigBuilder()
 *   .addSource(new AppConfigSourceJson('./config.json'))
 *   .addResolver(new AppConfigResolverGcpSecrets('my-gcp-project'))
 *   .buildSnapshot();
 * ```
 */
@Injectable()
export class AppConfigResolverGcpSecrets extends AppConfigKeyedResolver {
  /**
   * Creates a new AppConfigResolverGcpSecrets instance.
   *
   * @param source - Either the GCP project id (a default {@link AppConfigSourceGcpSecrets}
   *   is built for it), or an existing source instance to share its client/configuration.
   * @param prefix - A regex pattern or string to match secret references. Must have at least
   *   one capture group extracting the secret name. Defaults to `/\$\{gcp:(.+)\}/g`.
   *
   * @example
   * ```typescript
   * new AppConfigResolverGcpSecrets('my-project');
   * const source = new AppConfigSourceGcpSecrets('my-project');
   * new AppConfigResolverGcpSecrets(source);                 // share one client
   * new AppConfigResolverGcpSecrets('my-project', /\$\{secret:([^}]+)\}/g);
   * ```
   */
  constructor(source: string | AppConfigSourceGcpSecrets, prefix: string | RegExp = /\$\{gcp:(.+)\}/g) {
    super(typeof source === 'string' ? new AppConfigSourceGcpSecrets(source) : source, prefix);
  }
}
