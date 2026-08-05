/**
 * Widens a literal type to its base primitive, leaving everything else alone.
 *
 * Needed because {@link AppConfig.get}'s `defaultValue` infers as a literal: its
 * constraint (`NonNullable<T[K]>`, which is `{}` for a loosely-typed config)
 * admits primitives, and TypeScript preserves literal types when inferring to
 * such a parameter. Without this, `get('KEY', '')` would be typed `''` rather
 * than `string`, and every later assignment to it would fail.
 *
 * Only applied on the loosely-typed branch. A typed config returns
 * `NonNullable<T[K]> | D`, where the declared value type already supplies the
 * precision (`get('mode', 'a')` on `{ mode: 'a' | 'b' }` stays `'a' | 'b'`).
 */
type WidenLiteral<D> = D extends string ? string : D extends number ? number : D extends boolean ? boolean : D extends bigint ? bigint : D;

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
   * Returns the backing config object. For a plain config this is a constant;
   * for a supplier-backed config (see the constructor) it is re-evaluated on
   * every read, so all accessors below transparently observe the latest value.
   */
  private readonly read: () => T;

  /**
   * Creates a new AppConfig instance.
   *
   * Pass a config object for the usual immutable container. Pass a *supplier*
   * (`() => T`) to make every read resolve against whatever the supplier returns
   * at call time — the basis for a live view over a reloadable
   * {@link import('./options/app.config.store.js').AppConfigStore} (see
   * `AppConfigStore.toLiveConfig`). Because every accessor funnels through the
   * supplier, both current and future getters observe a reload with no extra
   * wiring.
   *
   * @param config - The configuration object to wrap, or a supplier returning it.
   */
  constructor(config: T | (() => T)) {
    this.read = typeof config === 'function' ? (config as () => T) : () => config;
  }

  /**
   * Returns the backing configuration object.
   *
   * For a supplier-backed instance this is the current snapshot. Used to seed a
   * fresh {@link AppConfig} from another's live value; mutating the returned
   * object mutates the backing config, so treat it as read-only.
   *
   * @returns The configuration object currently in effect.
   */
  toObject(): T {
    return this.read();
  }

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
    const value = this.read()[key];
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
   * default value's type widened to its base primitive (see
   * {@link WidenLiteral}) — so `get('KEY', 'fallback')` yields `string` rather
   * than `{}` or the literal `'fallback'`.
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
   * // Loosely-typed config: the default value's type carries the result.
   * const env = new AppConfig<Record<string, unknown>>({});
   * const issuer = env.get('OIDC_ISSUER', 'https://accounts.google.com'); // typed as string
   * const secret = env.get('JWT_PRIVATE_KEY', ''); // typed as string, not ''
   * ```
   */
  get<K extends keyof T>(key: K): T[K];
  get<K extends keyof T, D extends NonNullable<T[K]> = NonNullable<T[K]>>(
    key: K,
    defaultValue: D,
  ): unknown extends T[K] ? WidenLiteral<D> : NonNullable<T[K]> | D;
  get<K extends keyof T>(key: K, defaultValue?: unknown): unknown {
    const value = this.read()[key];
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
    return this.read()[key] as U;
  }
}
