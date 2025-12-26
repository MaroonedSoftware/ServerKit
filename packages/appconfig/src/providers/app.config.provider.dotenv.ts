import { AppConfigProvider } from '../app.config.provider.js';
import { ObjectVisitorMeta } from '../object.visitor.js';
import { tryParseJson } from '../helpers.js';

/**
 * Provider that resolves environment variable references in configuration values.
 *
 * This provider matches string values using a regex pattern and replaces them with
 * values from `process.env`. The default pattern matches `${env:KEY}` and extracts
 * the key part to look up in the environment.
 *
 * After replacement, the result is attempted to be parsed as JSON. If parsing succeeds,
 * the parsed value is used; otherwise, the string value is used.
 *
 * @example
 * ```typescript
 * // With default pattern /\$\{env:(.+)\}/g
 * // Value: "${env:DATABASE_URL}"
 * // Looks up: process.env.DATABASE_URL
 *
 * // Custom pattern
 * const provider = new AppConfigProviderDotenv(/\$\{([^}]+)\}/g);
 * // Value: "${DATABASE_URL}"
 * // Looks up: process.env.DATABASE_URL
 * ```
 */
export class AppConfigProviderDotenv implements AppConfigProvider {
  private readonly prefix: RegExp;

  /**
   * Creates a new AppConfigProviderDotenv instance.
   *
   * @param prefix - A regex pattern or string to match environment variable references.
   *   If a string is provided, it will be converted to a RegExp. The regex must have
   *   at least one capture group that extracts the environment variable key.
   *   Defaults to `/\$\{env:(.+)\}/g` which matches `${env:KEY}` patterns.
   *
   * @example
   * ```typescript
   * // Default pattern
   * const provider1 = new AppConfigProviderDotenv();
   *
   * // Custom regex pattern
   * const provider2 = new AppConfigProviderDotenv(/\$\{([^}]+)\}/g);
   *
   * // String pattern (converted to RegExp)
   * const provider3 = new AppConfigProviderDotenv('env:');
   * ```
   */
  constructor(prefix: string | RegExp = /\$\{env:(.+)\}/g) {
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
   * Parses the value by replacing environment variable references with actual values.
   *
   * The method:
   * 1. Finds all matches of the regex pattern in the value
   * 2. Replaces each match with the corresponding value from `process.env`
   * 3. Attempts to parse the result as JSON
   * 4. Updates the configuration object with the final value
   *
   * @param value - The string value containing environment variable references.
   * @param meta - Metadata about the value's location in the configuration object.
   * @returns A promise that resolves when the transformation is complete.
   *
   * @example
   * ```typescript
   * // If process.env.DATABASE_URL = "postgres://localhost/db"
   * // Value: "${env:DATABASE_URL}"
   * // Result: "postgres://localhost/db"
   *
   * // If process.env.PORT = "3000"
   * // Value: "${env:PORT}"
   * // Result: 3000 (parsed as JSON number)
   * ```
   */
  async parse(value: string, meta: ObjectVisitorMeta): Promise<void> {
    const matches = value.matchAll(this.prefix);

    let result = value;
    for (const [found, key] of matches) {
      result = result.replaceAll(found, process.env[key!] ?? '');
    }

    if (meta.arrayIndex !== undefined && Array.isArray(meta.owner)) {
      meta.owner[meta.arrayIndex] = tryParseJson(result ?? '');
    } else {
      (meta.owner as Record<string, unknown>)[meta.propertyPath] = tryParseJson(result ?? '');
    }
  }
}
