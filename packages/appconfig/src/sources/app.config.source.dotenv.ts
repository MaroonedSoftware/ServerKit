import { AppConfigSource } from '../app.config.source.js';
import { nestKeys } from '../helpers.js';
import dotenv from 'dotenv';

/**
 * Options for {@link AppConfigSourceDotenv}.
 */
export interface AppConfigSourceDotenvOptions {
  /**
   * When set, keys containing this separator are split into nested objects.
   *
   * For example, with `groupSeparator: '__'` the key `WEBHOOK__secret` becomes
   * `{ WEBHOOK: { secret: '...' } }`. Supports arbitrary nesting depth.
   *
   * @example
   * ```typescript
   * // .env
   * // WEBHOOK__secret=abc
   * // WEBHOOK__header=X-Sig
   * // DATABASE_URL=postgres://localhost/db
   *
   * const source = new AppConfigSourceDotenv('./.env', { groupSeparator: '__' });
   * await source.load();
   * // → { WEBHOOK: { secret: 'abc', header: 'X-Sig' }, DATABASE_URL: 'postgres://localhost/db' }
   * ```
   */
  groupSeparator?: string;
}

/**
 * Configuration source that loads environment variables from a `.env` file.
 *
 * This source uses the `dotenv` package to load environment variables from a `.env` file.
 * If no file path is provided, it will look for a `.env` file in the current working directory.
 * All values are strings as provided by the environment file.
 *
 * When the `groupSeparator` option is set, keys that contain the separator are automatically
 * collapsed into nested objects. This is useful for grouping related env vars under a shared
 * prefix (e.g. `WEBHOOK__secret` and `WEBHOOK__header` → `{ WEBHOOK: { secret, header } }`).
 *
 * @example
 * ```typescript
 * // Load from default .env file
 * const source1 = new AppConfigSourceDotenv();
 * const config1 = await source1.load();
 *
 * // Load from custom path
 * const source2 = new AppConfigSourceDotenv('./config/.env.local');
 * const config2 = await source2.load();
 *
 * // Group keys with __ separator into nested objects
 * const source3 = new AppConfigSourceDotenv('./.env', { groupSeparator: '__' });
 * const config3 = await source3.load();
 * ```
 */
export class AppConfigSourceDotenv implements AppConfigSource {
  /**
   * Creates a new AppConfigSourceDotenv instance.
   *
   * @param filePath - Optional path to the `.env` file. If not provided, `dotenv` will
   *   look for a `.env` file in the current working directory.
   * @param options  - Optional configuration options.
   */
  constructor(
    private readonly filePath?: string,
    private readonly options?: AppConfigSourceDotenvOptions,
  ) {}

  /**
   * Loads environment variables from the `.env` file.
   *
   * Uses `dotenv.config()` to parse the file and load variables into the returned object.
   * If `options.groupSeparator` is set the flat keys are transformed into a nested object
   * before being returned.
   *
   * @returns A promise that resolves to an object containing the parsed environment variables.
   * @throws {Error} If there's an error reading or parsing the `.env` file.
   */
  async load(): Promise<Record<string, unknown>> {
    const result = dotenv.config({ path: this.filePath, quiet: true });
    if (result.error) {
      throw result.error;
    }
    const parsed = result.parsed ?? {};

    if (this.options?.groupSeparator) {
      return nestKeys(parsed, this.options.groupSeparator);
    }

    return parsed;
  }
}
