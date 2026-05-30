import { Injectable } from 'injectkit';
import { AppConfigProvider } from '../app.config.provider.js';
import { ObjectVisitorMeta } from '../object.visitor.js';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { ServerkitError } from '@maroonedsoftware/errors';
import { tryParseJson } from '../helpers.js';

/**
 * Provider that resolves AWS Secrets Manager references in configuration values.
 *
 * This provider matches string values using a regex pattern and replaces them with
 * secrets fetched from AWS Secrets Manager. The default pattern matches `${aws:SECRET_ID}`
 * and extracts the secret id (a name or ARN) to look up in Secrets Manager.
 *
 * After retrieval, the secret value is attempted to be parsed as JSON. If parsing succeeds,
 * the parsed value is used; otherwise, the string value is used.
 *
 * @remarks
 * This provider requires valid AWS credentials to be configured. It uses the
 * `@aws-sdk/client-secrets-manager` package and resolves credentials and region from the
 * standard AWS provider chain (environment variables, shared config/credentials files,
 * instance/task roles). The region can be passed explicitly to override the chain.
 *
 * @example
 * ```typescript
 * // With default pattern /\$\{aws:(.+)\}/g
 * // Value: "${aws:DATABASE_PASSWORD}"
 * // Fetches the latest version of the "DATABASE_PASSWORD" secret
 *
 * const config = await new AppConfigBuilder()
 *   .addSource(new AppConfigSourceJson('./config.json'))
 *   .addProvider(new AppConfigProviderAwsSecrets('us-east-1'))
 *   .build();
 * ```
 */
@Injectable()
export class AppConfigProviderAwsSecrets implements AppConfigProvider {
  private readonly secretsManagerClient: SecretsManagerClient;
  private readonly prefix: RegExp;

  /**
   * Creates a new AppConfigProviderAwsSecrets instance.
   *
   * @param region - The AWS region where secrets are stored. If omitted, the region is
   *   resolved from the standard AWS provider chain (e.g. `AWS_REGION`).
   * @param prefix - A regex pattern or string to match secret references.
   *   If a string is provided, it will be converted to a RegExp. The regex must have
   *   at least one capture group that extracts the secret id.
   *   Defaults to `/\$\{aws:(.+)\}/g` which matches `${aws:SECRET_ID}` patterns.
   *
   * @example
   * ```typescript
   * // Default pattern, region from the AWS provider chain
   * const provider1 = new AppConfigProviderAwsSecrets();
   *
   * // Explicit region
   * const provider2 = new AppConfigProviderAwsSecrets('us-east-1');
   *
   * // Custom regex pattern
   * const provider3 = new AppConfigProviderAwsSecrets('us-east-1', /\$\{secret:([^}]+)\}/g);
   * ```
   */
  constructor(
    private readonly region?: string,
    prefix: string | RegExp = /\$\{aws:(.+)\}/g,
  ) {
    this.secretsManagerClient = new SecretsManagerClient(region ? { region } : {});
    this.prefix = typeof prefix === 'string' ? new RegExp(prefix) : prefix;
  }

  /**
   * Checks if this provider can parse the given value.
   *
   * @param value - The string value to check.
   * @returns `true` if the value matches the provider's regex pattern, `false` otherwise.
   */
  canParse(value: string): boolean {
    // `.test()` with a `/g`-flagged regex advances `lastIndex`, which can cause a
    // false negative on a subsequent call against the same string. Reset before
    // testing so behavior is independent of call order.
    this.prefix.lastIndex = 0;
    return this.prefix.test(value);
  }

  /**
   * Fetches a secret from AWS Secrets Manager.
   *
   * @param secretId - The id (name or ARN) of the secret to fetch.
   * @returns A promise that resolves to the secret value.
   * @throws {ServerkitError} When Secrets Manager rejects the access request (e.g. missing
   *   secret, IAM denial, network failure). The original error is attached via `withCause`
   *   and the failing `secretId` / `region` are recorded in `internalDetails`. Surfacing
   *   the failure prevents callers booting with an empty password / API key.
   * @internal
   */
  private async getSecret(secretId: string): Promise<string> {
    try {
      const response = await this.secretsManagerClient.send(new GetSecretValueCommand({ SecretId: secretId }));
      if (response.SecretString !== undefined) {
        return response.SecretString;
      }
      // Binary secrets are returned as a Uint8Array; decode to UTF-8 so JSON parsing
      // and string assignment behave the same as for `SecretString`.
      return response.SecretBinary ? Buffer.from(response.SecretBinary).toString('utf-8') : '';
    } catch (error) {
      // Surface failures loudly: silently returning `''` lets services boot with
      // an empty password / API key, which is far worse than a hard failure here.
      throw new ServerkitError(`AppConfigProviderAwsSecrets: failed to resolve secret "${secretId}" in region "${this.region ?? 'default'}"`)
        .withCause(error as Error)
        .withInternalDetails({ secretId, region: this.region });
    }
  }

  /**
   * Parses the value by replacing AWS secret references with actual secret values.
   *
   * The method:
   * 1. Finds all matches of the regex pattern in the value
   * 2. Fetches each secret from AWS Secrets Manager in parallel
   * 3. Attempts to parse each result as JSON
   * 4. Updates the configuration object with the final value
   *
   * @param value - The string value containing AWS secret references.
   * @param meta - Metadata about the value's location in the configuration object.
   * @returns A promise that resolves when all secrets have been fetched and the
   *   transformation is complete.
   * @throws {ServerkitError} Propagated from {@link getSecret} when any referenced secret
   *   cannot be resolved. The build call site is expected to fail loud and stop boot.
   *
   * @example
   * ```typescript
   * // If AWS secret "API_KEY" contains "sk-abc123"
   * // Value: "${aws:API_KEY}"
   * // Result: "sk-abc123"
   *
   * // If AWS secret "CONFIG" contains '{"retries": 3}'
   * // Value: "${aws:CONFIG}"
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
