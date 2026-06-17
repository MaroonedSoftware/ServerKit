/**
 * Configuration container that provides type-safe access to configuration values.
 *
 * @template T - The type of the configuration object. Defaults to `Record<string, unknown>`.
 *
 * @example
 * ```typescript
 * const config = new AppConfig({
 *   database: { host: 'localhost', port: 5432 },
 *   api: { timeout: 5000 }
 * });
 *
 * const host = config.get('database').host; // Type-safe access
 * ```
 */
export class AppConfig<T = Record<string, unknown>> {
  /**
   * Creates a new AppConfig instance with the provided configuration.
   *
   * @param config - The configuration object to wrap.
   */
  constructor(private readonly config: T) {}

  /**
   * Checks whether a configuration value is present for a given key.
   *
   * Returns `false` when the value is `undefined` or `null`. Because keys are
   * deep-merged from multiple sources, a statically-typed key may still be
   * absent at runtime — use this to distinguish "missing" from "falsy".
   *
   * @param key - The configuration key to check.
   * @returns `true` if the value is neither `undefined` nor `null`.
   *
   * @example
   * ```typescript
   * const config = new AppConfig({ port: 3000, host: undefined });
   * config.has('port'); // true
   * config.has('host'); // false
   * ```
   */
  has(key: keyof T): boolean {
    const value = this.config[key];
    return value !== undefined && value !== null;
  }

  /**
   * Retrieves a configuration value by key.
   *
   * When a `defaultValue` is supplied, it is returned only when the stored
   * value is missing (`undefined` or `null`) — not when it is merely falsy
   * (e.g. `0`, `''`, `false`).
   *
   * The result is typed precisely: for a typed config the return is
   * `NonNullable<T[K]> | D`, and for a loosely-typed config (where `T[K]` is
   * `unknown`, e.g. the default `Record<string, unknown>`) the return is the
   * default value's type `D` — so `get('KEY', 'fallback')` yields `string`
   * rather than `{}`.
   *
   * @template K - The key type, must be a key of T.
   * @template D - The default value's type, inferred from `defaultValue`.
   * @param key - The configuration key to retrieve.
   * @param defaultValue - Value to return when the stored value is missing.
   * @returns The configuration value for the given key, or `defaultValue`.
   *
   * @example
   * ```typescript
   * const config = new AppConfig({ port: 3000, host: 'localhost' });
   * const port = config.get('port'); // Returns 3000, typed as number
   * const retries = config.get('retries', 3); // Falls back to 3 when missing
   *
   * // Loosely-typed config: the default value's type is preserved.
   * const env = new AppConfig<Record<string, unknown>>({});
   * const issuer = env.get('OIDC_ISSUER', 'https://accounts.google.com'); // typed as string
   * ```
   */
  get<K extends keyof T>(key: K): T[K];
  get<K extends keyof T, D extends NonNullable<T[K]> = NonNullable<T[K]>>(
    key: K,
    defaultValue: D,
  ): unknown extends T[K] ? D : NonNullable<T[K]> | D;
  get<K extends keyof T>(key: K, defaultValue?: unknown): unknown {
    const value = this.config[key];
    if (arguments.length < 2) {
      return value;
    }
    return value === undefined || value === null ? defaultValue : value;
  }

  /**
   * Retrieves a configuration value cast to a specific type.
   *
   * Unlike `get()`, which returns `T[keyof T]`, this method lets you cast the
   * value to an arbitrary type `U`. Use this when the TypeScript type of the
   * stored value differs from what you need at the call site — for example,
   * when reading a nested object as a typed interface.
   *
   * @template U - The type to cast the value to.
   * @param key - The configuration key to retrieve.
   * @returns The configuration value cast to `U`.
   *
   * @example
   * ```typescript
   * interface DbConfig { host: string; port: number }
   *
   * const config = new AppConfig({ database: { host: 'localhost', port: 5432 } });
   * const db = config.getAs<DbConfig>('database');
   * console.log(db.host); // 'localhost'
   * ```
   */
  getAs<U>(key: keyof T): U {
    return this.config[key] as U;
  }

  /**
   * Retrieves a configuration value as a string.
   *
   * The value is converted to a string using `String()`. This is useful when
   * you need to ensure a value is a string regardless of its original type.
   *
   * @param key - The configuration key to retrieve.
   * @returns The configuration value converted to a string.
   *
   * @example
   * ```typescript
   * const config = new AppConfig({ port: 3000, enabled: true });
   * const portStr = config.getString('port'); // Returns "3000"
   * const enabledStr = config.getString('enabled'); // Returns "true"
   * ```
   */
  getString(key: keyof T): string {
    return String(this.get(key));
  }

  /**
   * Retrieves a configuration value as a number.
   *
   * The value is converted to a number using `Number()`. This is useful when
   * you need to ensure a value is a number regardless of its original type.
   * Note: Invalid conversions will result in `NaN`.
   *
   * @param key - The configuration key to retrieve.
   * @returns The configuration value converted to a number.
   *
   * @example
   * ```typescript
   * const config = new AppConfig({ port: '3000', timeout: '5000' });
   * const port = config.getNumber('port'); // Returns 3000
   * const timeout = config.getNumber('timeout'); // Returns 5000
   * ```
   */
  getNumber(key: keyof T): number {
    return Number(this.config[key]);
  }

  /**
   * Retrieves a configuration value as a boolean.
   *
   * The value is converted to a boolean using `Boolean()`. This is useful when
   * you need to ensure a value is a boolean regardless of its original type.
   * Note: Only falsy values (false, 0, '', null, undefined, NaN) become false.
   *
   * @param key - The configuration key to retrieve.
   * @returns The configuration value converted to a boolean.
   *
   * @example
   * ```typescript
   * const config = new AppConfig({ enabled: 'true', debug: 1 });
   * const enabled = config.getBoolean('enabled'); // Returns true
   * const debug = config.getBoolean('debug'); // Returns true
   * ```
   */
  getBoolean(key: keyof T): boolean {
    return Boolean(this.config[key]);
  }

  /**
   * Retrieves a configuration value as an object.
   *
   * The value is cast to an object type. This is useful when you know a value
   * is an object and want to access it with object methods.
   *
   * @param key - The configuration key to retrieve.
   * @returns The configuration value cast as an object.
   *
   * @example
   * ```typescript
   * const config = new AppConfig({
   *   database: { host: 'localhost', port: 5432 }
   * });
   * const db = config.getObject('database'); // Returns { host: 'localhost', port: 5432 }
   * ```
   */
  getObject(key: keyof T): object {
    return this.config[key] as object;
  }
}
