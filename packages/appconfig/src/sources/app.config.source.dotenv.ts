import dotenv from 'dotenv';
import { AppConfigSourceFile, AppConfigSourceFileOptions } from './app.config.source.file.js';
import { nestKeys } from '../helpers.js';

/**
 * Options for {@link AppConfigSourceDotenv}.
 *
 * Extends the shared file options ({@link AppConfigSourceFileOptions}) with dotenv-specific
 * grouping.
 */
export interface AppConfigSourceDotenvOptions extends AppConfigSourceFileOptions {
  /**
   * When set, keys containing this separator are split into nested objects.
   *
   * For example, with `groupSeparator: '__'` the key `WEBHOOK__secret` becomes
   * `{ WEBHOOK: { secret: '...' } }`. Supports arbitrary nesting depth.
   *
   * @example
   * ```typescript
   * // .env: WEBHOOK__secret=abc / WEBHOOK__header=X-Sig / DATABASE_URL=postgres://localhost/db
   * const source = new AppConfigSourceDotenv('./.env', { groupSeparator: '__' });
   * await source.load();
   * // → { WEBHOOK: { secret: 'abc', header: 'X-Sig' }, DATABASE_URL: 'postgres://localhost/db' }
   * ```
   */
  groupSeparator?: string;

  /**
   * When set, the parsed environment variables are populated into `process.env`.
   *
   * Defaults to `true`.
   *
   * @example
   * ```typescript
   * const source = new AppConfigSourceDotenv('./.env', { populateProcessEnv: true });
   * await source.load();
   * // → process.env.WEBHOOK_SECRET = 'abc'
   * ```
   */
  populateProcessEnv?: boolean;

  /**
   * When set, the parsed environment variables override existing `process.env` variables.
   *
   * Defaults to `true`.
   *
   * @example
   * ```typescript
   * const source = new AppConfigSourceDotenv('./.env', { overrideProcessEnv: true });
   * await source.load();
   * // → process.env.WEBHOOK_SECRET = 'abc'
   */
  overrideProcessEnv?: boolean;
}

/**
 * Configuration source that loads environment variables from a `.env` file.
 *
 * Reads the file and parses it with `dotenv.parse`, returning the variables as a
 * configuration layer. Unlike a bare `dotenv.config()` call, this does **not** mutate
 * `process.env` — the source is pure, contributing only to the merged config. Like the
 * other file sources it ignores a missing file by default and is watchable (see
 * {@link AppConfigSourceFile}); the default path is `.env` in the current working directory.
 *
 * When `groupSeparator` is set, keys containing the separator are collapsed into nested
 * objects (e.g. `WEBHOOK__secret` → `{ WEBHOOK: { secret } }`).
 *
 * @example
 * ```typescript
 * const source1 = new AppConfigSourceDotenv();                              // ./.env
 * const source2 = new AppConfigSourceDotenv('./config/.env.local');         // custom path
 * const source3 = new AppConfigSourceDotenv('./.env', { groupSeparator: '__' });
 * const source4 = new AppConfigSourceDotenv('./.env', { populateProcessEnv: false });
 * const source5 = new AppConfigSourceDotenv('./.env', { populateProcessEnv: true, overrideProcessEnv: false });
 * ```
 */
export class AppConfigSourceDotenv extends AppConfigSourceFile {
  private readonly groupSeparator?: string;
  private readonly populateProcessEnv: boolean;
  private readonly overrideProcessEnv: boolean;

  /**
   * Creates a new AppConfigSourceDotenv instance.
   *
   * @param filePath - Path to the `.env` file. Defaults to `.env` in the current working directory.
   * @param options - Missing-file/encoding behavior plus the optional `groupSeparator`.
   */
  constructor(filePath = '.env', options?: AppConfigSourceDotenvOptions) {
    super(filePath, options);
    this.groupSeparator = options?.groupSeparator;
    this.populateProcessEnv = options?.populateProcessEnv ?? true;
    this.overrideProcessEnv = options?.overrideProcessEnv ?? true;
  }

  /**
   * Parses the file contents with `dotenv.parse`, optionally nesting keys on `groupSeparator`.
   *
   * @param text - The file contents.
   * @returns The parsed (and optionally nested) configuration object.
   */
  protected parse(text: string): Record<string, unknown> {
    const parsed = dotenv.parse(text);
    if (this.populateProcessEnv) {
      dotenv.populate(process.env, parsed, {
        override: this.overrideProcessEnv,
      });
    }
    return this.groupSeparator ? nestKeys(parsed, this.groupSeparator) : parsed;
  }
}
