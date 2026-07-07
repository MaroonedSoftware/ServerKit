import { Injectable } from 'injectkit';
import { AppConfigKeyedResolver } from './app.config.resolver.keyed.js';
import { AppConfigSourceAwsSecrets } from '../sources/app.config.source.aws.secrets.js';

/**
 * Resolver that resolves AWS Secrets Manager references (`${aws:SECRET_ID}`) in
 * configuration values.
 *
 * A thin wrapper over {@link AppConfigKeyedResolver}: the Secrets Manager I/O —
 * client/region resolution, `SecretString`/`SecretBinary` decoding, JSON parsing — lives in
 * {@link AppConfigSourceAwsSecrets}, which this resolver delegates to via `get`. Pass a
 * region (a default source is built for you) or share a pre-configured source instance so
 * one client backs both bulk loading and reference resolution.
 *
 * @remarks
 * Requires valid AWS credentials. The underlying source uses `@aws-sdk/client-secrets-manager`
 * and resolves credentials/region from the standard AWS provider chain unless a region is
 * passed explicitly.
 *
 * @example
 * ```typescript
 * const config = await new AppConfigBuilder()
 *   .addSource(new AppConfigSourceJson('./config.json'))
 *   .addResolver(new AppConfigResolverAwsSecrets('us-east-1'))
 *   .buildSnapshot();
 * ```
 */
@Injectable()
export class AppConfigResolverAwsSecrets extends AppConfigKeyedResolver {
  /**
   * Creates a new AppConfigResolverAwsSecrets instance.
   *
   * @param source - Either the AWS region (a default {@link AppConfigSourceAwsSecrets} is
   *   built for it), or an existing source instance to share its client/configuration. When
   *   a region is omitted it is resolved from the standard AWS provider chain.
   * @param prefix - A regex pattern or string to match secret references. Must have at least
   *   one capture group extracting the secret id. Defaults to `/\$\{aws:([^}]+)\}/g` (the
   *   non-greedy `[^}]+` keeps composed references from matching one greedy span).
   *
   * @example
   * ```typescript
   * new AppConfigResolverAwsSecrets();                       // region from the AWS chain
   * new AppConfigResolverAwsSecrets('us-east-1');            // explicit region
   * const source = new AppConfigSourceAwsSecrets({ region: 'us-east-1' });
   * new AppConfigResolverAwsSecrets(source);                 // share one client
   * new AppConfigResolverAwsSecrets('us-east-1', /\$\{secret:([^}]+)\}/g);
   * ```
   */
  constructor(source?: string | AppConfigSourceAwsSecrets, prefix: string | RegExp = /\$\{aws:([^}]+)\}/g) {
    super(source instanceof AppConfigSourceAwsSecrets ? source : new AppConfigSourceAwsSecrets({ region: source }), prefix);
  }
}
