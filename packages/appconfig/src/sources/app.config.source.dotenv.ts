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
 * ```
 */
export class AppConfigSourceDotenv extends AppConfigSourceFile {
  private readonly groupSeparator?: string;

  /**
   * Creates a new AppConfigSourceDotenv instance.
   *
   * @param filePath - Path to the `.env` file. Defaults to `.env` in the current working directory.
   * @param options - Missing-file/encoding behavior plus the optional `groupSeparator`.
   */
  constructor(filePath = '.env', options?: AppConfigSourceDotenvOptions) {
    super(filePath, options);
    this.groupSeparator = options?.groupSeparator;
  }

  /**
   * Parses the file contents with `dotenv.parse`, optionally nesting keys on `groupSeparator`.
   *
   * @param text - The file contents.
   * @returns The parsed (and optionally nested) configuration object.
   */
  protected parse(text: string): Record<string, unknown> {
    const parsed = dotenv.parse(text);
    return this.groupSeparator ? nestKeys(parsed, this.groupSeparator) : parsed;
  }
}
