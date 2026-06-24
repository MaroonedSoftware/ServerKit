import { Injectable } from 'injectkit';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { ServerkitError } from '@maroonedsoftware/errors';
import { AppConfigSourceFetch, AppConfigSourceFetchOptions } from './app.config.source.fetch.js';
import { tryParseJson } from '../helpers.js';

/**
 * Options for {@link AppConfigSourceGcpSecrets}. Extends the shared
 * {@link AppConfigSourceFetchOptions} with GCP specifics.
 *
 * @property filter - A filter expression passed to `listSecrets` when discovering secrets —
 *   e.g. `'name:app-prod-'`. Ignored when `ids` is supplied.
 */
export interface AppConfigSourceGcpSecretsOptions extends AppConfigSourceFetchOptions {
  filter?: string;
}

// gRPC status code for NOT_FOUND.
const NOT_FOUND = 5;

/**
 * Configuration source that loads a set of GCP Secret Manager secrets as a config layer.
 *
 * The GCP implementation of {@link AppConfigSourceFetch}: it supplies the Secret Manager
 * I/O (`get` / `discover`) and inherits the bulk-load assembly. The bulk-load counterpart to
 * {@link import('../resolvers/app.config.resolver.gcp.secrets.js').AppConfigResolverGcpSecrets},
 * which it also backs via `get`. Secret ids are the short name, not the full resource path.
 *
 * @example
 * ```typescript
 * const config = await new AppConfigBuilder()
 *   .addSource(new AppConfigSourceGcpSecrets('my-project', {
 *     ids: ['app.database', 'app.port'],
 *     stripPrefix: 'app.',
 *     nameSeparator: '.',
 *   }))
 *   .buildSnapshot();
 * ```
 */
@Injectable()
export class AppConfigSourceGcpSecrets extends AppConfigSourceFetch {
  private readonly client = new SecretManagerServiceClient();
  private readonly filter?: string;

  /**
   * @param projectId - The GCP project id where secrets are stored.
   * @param options - The secrets to load and how their ids map to config keys.
   */
  constructor(
    private readonly projectId: string,
    options: AppConfigSourceGcpSecretsOptions = {},
  ) {
    super(options);
    this.filter = options.filter;
  }

  /**
   * Fetches and parses a single secret's latest version by id.
   *
   * @param secretId - The short secret id (not the full resource path).
   * @returns The JSON-parsed value (raw string when not JSON), or `undefined` when the secret
   *   is missing and `ignoreMissing` is set.
   * @throws {ServerkitError} When the secret cannot be accessed (and `ignoreMissing` is
   *   not set), or when the version carries no payload (a present-but-empty secret is a fault).
   */
  protected async fetch(secretId: string): Promise<unknown> {
    let secret;
    try {
      [secret] = await this.client.accessSecretVersion({
        name: `projects/${this.projectId}/secrets/${secretId}/versions/latest`,
      });
    } catch (error) {
      if ((error as { code?: number }).code === NOT_FOUND && this.options.ignoreMissing) {
        return undefined;
      }
      // Surface failures loudly: silently dropping a secret lets services boot without part of
      // their config, which is far worse than a hard failure here.
      throw new ServerkitError(`AppConfigSourceGcpSecrets: failed to resolve secret "${secretId}" in project "${this.projectId}"`)
        .withCause(error as Error)
        .withInternalDetails({ secretId, projectId: this.projectId });
    }

    const data = secret.payload?.data;
    if (data === null || data === undefined) {
      // Present but no payload — anomalous; fail loud rather than substitute an empty value.
      throw new ServerkitError(
        `AppConfigSourceGcpSecrets: secret "${secretId}" in project "${this.projectId}" returned no value`,
      ).withInternalDetails({
        secretId,
        projectId: this.projectId,
      });
    }
    return tryParseJson(data.toString());
  }

  /**
   * Lists secret ids via `listSecrets` (which auto-paginates), narrowed by `filter`.
   *
   * @returns The short ids of every matching secret.
   * @throws {ServerkitError} When the list request is rejected.
   */
  protected async discover(): Promise<string[]> {
    try {
      const [secrets] = await this.client.listSecrets({ parent: `projects/${this.projectId}`, filter: this.filter });
      // `secret.name` is the full resource path `projects/{project}/secrets/{id}`.
      return secrets.map(secret => secret.name?.split('/').pop()).filter((id): id is string => !!id);
    } catch (error) {
      throw new ServerkitError(`AppConfigSourceGcpSecrets: failed to list secrets in project "${this.projectId}"`)
        .withCause(error as Error)
        .withInternalDetails({ projectId: this.projectId, filter: this.filter });
    }
  }
}
