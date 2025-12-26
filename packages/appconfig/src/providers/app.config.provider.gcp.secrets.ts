import { Injectable } from 'injectkit';
import { AppConfigProvider } from '../app.config.provider.js';
import { ObjectVisitorMeta } from '../object.visitor.js';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { tryParseJson } from '../helpers.js';

/**
 * Provider that resolves Google Cloud Platform Secret Manager references in configuration values.
 *
 * This provider matches string values using a regex pattern and replaces them with
 * secrets fetched from GCP Secret Manager. The default pattern matches `${gcp:SECRET_NAME}`
 * and extracts the secret name to look up in Secret Manager.
 *
 * After retrieval, the secret value is attempted to be parsed as JSON. If parsing succeeds,
 * the parsed value is used; otherwise, the string value is used.
 *
 * @remarks
 * This provider requires valid GCP credentials to be configured. It uses the
 * `@google-cloud/secret-manager` package and will use Application Default Credentials (ADC).
 *
 * @example
 * ```typescript
 * // With default pattern /\$\{gcp:(.+)\}/g
 * // Value: "${gcp:DATABASE_PASSWORD}"
 * // Fetches: projects/{projectId}/secrets/DATABASE_PASSWORD/versions/latest
 *
 * const config = await new AppConfigBuilder()
 *   .addSource(new AppConfigSourceJson('./config.json'))
 *   .addProvider(new AppConfigProviderGcpSecrets('my-gcp-project'))
 *   .build();
 * ```
 */
@Injectable()
export class AppConfigProviderGcpSecrets implements AppConfigProvider {
  private readonly secretmanagerClient = new SecretManagerServiceClient();
  private readonly prefix: RegExp;

  /**
   * Creates a new AppConfigProviderGcpSecrets instance.
   *
   * @param projectId - The GCP project ID where secrets are stored.
   * @param prefix - A regex pattern or string to match secret references.
   *   If a string is provided, it will be converted to a RegExp. The regex must have
   *   at least one capture group that extracts the secret name.
   *   Defaults to `/\$\{gcp:(.+)\}/g` which matches `${gcp:SECRET_NAME}` patterns.
   *
   * @example
   * ```typescript
   * // Default pattern
   * const provider1 = new AppConfigProviderGcpSecrets('my-project');
   *
   * // Custom regex pattern
   * const provider2 = new AppConfigProviderGcpSecrets('my-project', /\$\{secret:([^}]+)\}/g);
   * ```
   */
  constructor(
    private readonly projectId: string,
    prefix: string | RegExp = /\$\{gcp:(.+)\}/g,
  ) {
    this.prefix = typeof prefix === 'string' ? new RegExp(prefix) : prefix;
  }

  /**
   * Checks if this provider can parse the given value.
   *
   * @param value - The string value to check.
   * @returns `true` if the value matches the provider's regex pattern, `false` otherwise.
   */
  canParse(value: string): boolean {
    return this.prefix.test(value);
  }

  /**
   * Fetches a secret from GCP Secret Manager.
   *
   * @param secretId - The name of the secret to fetch.
   * @returns A promise that resolves to the secret value, or an empty string if the secret
   *   couldn't be fetched.
   * @internal
   */
  private async getSecret(secretId: string): Promise<string> {
    try {
      const [secret] = await this.secretmanagerClient.accessSecretVersion({
        name: `projects/${this.projectId}/secrets/${secretId}/versions/latest`,
      });
      return secret.payload?.data?.toString() ?? '';
    } catch (error) {
      console.error(error);
      return '';
    }
  }

  /**
   * Parses the value by replacing GCP secret references with actual secret values.
   *
   * The method:
   * 1. Finds all matches of the regex pattern in the value
   * 2. Fetches each secret from GCP Secret Manager in parallel
   * 3. Attempts to parse each result as JSON
   * 4. Updates the configuration object with the final value
   *
   * @param value - The string value containing GCP secret references.
   * @param meta - Metadata about the value's location in the configuration object.
   * @returns A promise that resolves when all secrets have been fetched and the
   *   transformation is complete.
   *
   * @example
   * ```typescript
   * // If GCP secret "API_KEY" contains "sk-abc123"
   * // Value: "${gcp:API_KEY}"
   * // Result: "sk-abc123"
   *
   * // If GCP secret "CONFIG" contains '{"retries": 3}'
   * // Value: "${gcp:CONFIG}"
   * // Result: { retries: 3 } (parsed as JSON object)
   * ```
   */
  async parse(value: string, meta: ObjectVisitorMeta): Promise<void> {
    const tasks: Promise<void>[] = [];
    const matches = value.matchAll(this.prefix);

    for (const [, key] of matches) {
      const task = this.getSecret(key!).then(value => {
        if (meta.arrayIndex !== undefined && Array.isArray(meta.owner)) {
          meta.owner[meta.arrayIndex] = tryParseJson(value);
        } else {
          (meta.owner as Record<string, unknown>)[meta.propertyPath] = tryParseJson(value);
        }
      });
      tasks.push(task);
    }

    await Promise.all(tasks);
  }
}
