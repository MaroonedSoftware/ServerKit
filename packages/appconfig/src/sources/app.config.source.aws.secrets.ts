import { Injectable } from 'injectkit';
import { BatchGetSecretValueCommand, GetSecretValueCommand, ListSecretsCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { Filter } from '@aws-sdk/client-secrets-manager';
import { ServerkitError } from '@maroonedsoftware/errors';
import { AppConfigSourceFetch, AppConfigSourceFetchOptions } from './app.config.source.fetch.js';
import { tryParseJson } from '../helpers.js';

// `BatchGetSecretValue` accepts at most 20 ids per call.
const BATCH_SIZE = 20;

/** Splits an array into chunks of at most `size`. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Decodes a Secrets Manager payload (string or binary) to a JSON-parsed value. */
function decode(secretId: string, payload: { SecretString?: string; SecretBinary?: Uint8Array }): unknown {
  if (payload.SecretString !== undefined) {
    return tryParseJson(payload.SecretString);
  }
  if (payload.SecretBinary) {
    // Binary secrets are returned as a Uint8Array; decode to UTF-8 so JSON parsing behaves
    // the same as for `SecretString`.
    return tryParseJson(Buffer.from(payload.SecretBinary).toString('utf-8'));
  }
  // Present but no payload — anomalous; fail loud rather than substitute an empty value.
  throw new ServerkitError(`AppConfigSourceAwsSecrets: secret "${secretId}" returned no value`).withInternalDetails({ secretId });
}

/**
 * Options for {@link AppConfigSourceAwsSecrets}. Extends the shared
 * {@link AppConfigSourceFetchOptions} with AWS specifics.
 *
 * @property region - The AWS region where the secrets live. If omitted, the region is
 *   resolved from the standard AWS provider chain (e.g. `AWS_REGION`).
 * @property filters - Filters passed to `ListSecrets` when discovering secrets — e.g.
 *   `[{ Key: 'name', Values: ['app/'] }]`. Ignored when `ids` is supplied.
 */
export interface AppConfigSourceAwsSecretsOptions extends AppConfigSourceFetchOptions {
  region?: string;
  filters?: Filter[];
}

const RESOURCE_NOT_FOUND = 'ResourceNotFoundException';

/**
 * Configuration source that loads a set of AWS Secrets Manager secrets as a config layer.
 *
 * The AWS implementation of {@link AppConfigSourceFetch}: it supplies the Secrets Manager
 * I/O (`get` / `discover`) and inherits the bulk-load assembly. The bulk-load counterpart to
 * {@link import('../resolvers/app.config.resolver.aws.secrets.js').AppConfigResolverAwsSecrets},
 * which it also backs via `get`.
 *
 * @example
 * ```typescript
 * // Explicit list:
 * const config = await new AppConfigBuilder()
 *   .addSource(new AppConfigSourceAwsSecrets({
 *     region: 'us-east-1',
 *     ids: ['app/prod/database', 'app/prod/port'],
 *     stripPrefix: 'app/prod/',
 *     nameSeparator: '/',
 *   }))
 *   .buildSnapshot();
 *
 * // Or discover by filter:
 * new AppConfigSourceAwsSecrets({ filters: [{ Key: 'name', Values: ['app/prod/'] }], stripPrefix: 'app/prod/', nameSeparator: '/' });
 * ```
 */
@Injectable()
export class AppConfigSourceAwsSecrets extends AppConfigSourceFetch {
  private readonly client: SecretsManagerClient;
  private readonly filters?: Filter[];

  /**
   * @param options - Region, the secrets to load (explicit list or discovery filters), and
   *   how their names map to config keys.
   */
  constructor(options: AppConfigSourceAwsSecretsOptions = {}) {
    super(options);
    this.client = new SecretsManagerClient(options.region ? { region: options.region } : {});
    this.filters = options.filters;
  }

  /**
   * Fetches and parses a single secret from AWS Secrets Manager.
   *
   * @param secretId - The id (name or ARN) of the secret to fetch.
   * @returns The JSON-parsed value (raw string when not JSON), or `undefined` when the secret
   *   is missing and `ignoreMissing` is set.
   * @throws {ServerkitError} When Secrets Manager rejects the request for any reason other than
   *   a tolerated `ResourceNotFoundException`, or when the response carries neither
   *   `SecretString` nor `SecretBinary` (a present-but-empty secret is a fault, not a miss).
   */
  protected async fetch(secretId: string): Promise<unknown> {
    let response;
    try {
      response = await this.client.send(new GetSecretValueCommand({ SecretId: secretId }));
    } catch (error) {
      if ((error as { name?: string }).name === RESOURCE_NOT_FOUND && this.options.ignoreMissing) {
        return undefined;
      }
      // Surface failures loudly: silently dropping a secret lets services boot without part of
      // their config, which is far worse than a hard failure here.
      throw new ServerkitError(`AppConfigSourceAwsSecrets: failed to load secret "${secretId}"`)
        .withCause(error as Error)
        .withInternalDetails({ secretId });
    }

    return decode(secretId, response);
  }

  /**
   * Bulk-fetches secrets via `BatchGetSecretValue` (up to 20 per call) instead of one
   * `GetSecretValue` each — fewer round trips, faster cold boot. Chunks of 20 run bounded by
   * `concurrency`. Requires the `secretsmanager:BatchGetSecretValue` IAM permission.
   *
   * @param ids - The secret ids (names or ARNs) to fetch.
   * @returns A map of id → value (`undefined` for a tolerated `ResourceNotFoundException`).
   * @throws {ServerkitError} On a batch request failure, a non-tolerated per-secret error, or a
   *   secret with no payload.
   */
  protected async fetchMany(ids: string[]): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();

    await this.mapLimit(chunk(ids, BATCH_SIZE), async batch => {
      let response;
      try {
        response = await this.client.send(new BatchGetSecretValueCommand({ SecretIdList: batch }));
      } catch (error) {
        throw new ServerkitError('AppConfigSourceAwsSecrets: failed to batch-load secrets')
          .withCause(error as Error)
          .withInternalDetails({ ids: batch });
      }

      for (const value of response.SecretValues ?? []) {
        // The response echoes Name/ARN, not the exact id we sent — match it back.
        const id = batch.find(x => x === value.Name || x === value.ARN);
        if (id !== undefined) {
          result.set(id, decode(id, value));
        }
      }
      for (const err of response.Errors ?? []) {
        if (err.SecretId === undefined) {
          continue;
        }
        if (err.ErrorCode === RESOURCE_NOT_FOUND && this.options.ignoreMissing) {
          // Tolerated miss — cache as undefined so `get` doesn't re-fetch it.
          result.set(err.SecretId, undefined);
          continue;
        }
        throw new ServerkitError(`AppConfigSourceAwsSecrets: failed to load secret "${err.SecretId}"`).withInternalDetails({
          secretId: err.SecretId,
          errorCode: err.ErrorCode,
        });
      }
    });

    return result;
  }

  /**
   * Lists secret names via `ListSecrets`, following pagination to completion.
   *
   * @returns Every secret name matching the configured `filters`.
   * @throws {ServerkitError} When the list request is rejected.
   */
  protected async discover(): Promise<string[]> {
    const names: string[] = [];
    let nextToken: string | undefined;
    try {
      do {
        const response = await this.client.send(new ListSecretsCommand({ Filters: this.filters, NextToken: nextToken }));
        for (const secret of response.SecretList ?? []) {
          if (secret.Name) {
            names.push(secret.Name);
          }
        }
        nextToken = response.NextToken;
      } while (nextToken);
    } catch (error) {
      throw new ServerkitError('AppConfigSourceAwsSecrets: failed to list secrets')
        .withCause(error as Error)
        .withInternalDetails({ filters: this.filters });
    }
    return names;
  }
}
