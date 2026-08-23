import { AppConfigSource } from '../app.config.source.js';
import { nestKeys } from '../helpers.js';

/**
 * Options for {@link AppConfigSourceEnv}.
 */
export interface AppConfigSourceEnvOptions {
  /**
   * When set, keys containing this separator are split into nested objects.
   *
   * The same option {@link AppConfigSourceDotenv} takes, and worth setting to the same value, so
   * that `A__B` means one thing whichever layer it arrives through rather than two.
   *
   * @example
   * ```typescript
   * // WEBHOOK__secret=abc WEBHOOK__header=X-Sig
   * const source = new AppConfigSourceEnv({ groupSeparator: '__' });
   * await source.load();
   * // → { WEBHOOK: { secret: 'abc', header: 'X-Sig' } }
   * ```
   */
  groupSeparator?: string;

  /**
   * The environment to read. Defaults to `process.env`.
   *
   * Mostly for tests, but also for the case where the variables have been collected from
   * somewhere other than this process.
   */
  environment?: NodeJS.ProcessEnv;

  /**
   * Whether to capture the environment once, when the source is constructed.
   *
   * Defaults to `true`, which is almost always what you want: see the note on the class about
   * what reading it live costs you.
   */
  snapshot?: boolean;
}

/**
 * Configuration source that reads the process environment.
 *
 * The counterpart to {@link AppConfigSourceDotenv}: that one reads a `.env` FILE, which is how a
 * developer sets a value, while this one reads the variables the process was started with, which
 * is the only way anything is configured in a container. An application that has only the dotenv
 * source silently ignores `docker run -e` and falls through to its defaults in code.
 *
 * Note this is a **source** and not the same thing as {@link AppConfigResolverEnv}, which is a
 * resolver: the resolver rewrites `${env:KEY}` tokens found INSIDE values, so it can only fill in
 * a placeholder somebody already wrote. This contributes the variables themselves as a layer.
 *
 * Order it after the file sources — an environment variable is the more specific statement of a
 * value, and later sources win the merge.
 *
 * By default the environment is captured ONCE, when the source is constructed, and every later
 * `load()` answers with that same copy. This matters more than it looks. An application that
 * removes secrets from `process.env` after boot — a common and good practice, since it stops a
 * child process or a crash dump carrying them — will otherwise find that the next reload, hours
 * later, resolves those same keys to nothing, because reload re-runs the whole pipeline. Set
 * `snapshot: false` only when the process genuinely mutates its own environment and you want the
 * later value.
 *
 * @example
 * ```typescript
 * const config = await new AppConfigBuilder()
 *   .addSource(new AppConfigSourceJson('./config.json'))
 *   .addSource(new AppConfigSourceDotenv('./.env', { groupSeparator: '__' }))
 *   .addSource(new AppConfigSourceEnv({ groupSeparator: '__' }))
 *   .addResolver(new AppConfigResolverEnv())
 *   .buildSnapshot();
 * ```
 */
export class AppConfigSourceEnv implements AppConfigSource {
  private readonly groupSeparator?: string;
  private readonly environment: NodeJS.ProcessEnv | undefined;
  private readonly captured?: Record<string, unknown>;

  /**
   * Creates a new AppConfigSourceEnv instance.
   *
   * @param options - Grouping, the environment to read, and whether to capture it up front.
   */
  constructor(options?: AppConfigSourceEnvOptions) {
    this.groupSeparator = options?.groupSeparator;
    this.environment = options?.environment;

    if (options?.snapshot ?? true) {
      this.captured = this.read();
    }
  }

  /**
   * Reads the environment as a configuration layer.
   *
   * @returns The variables, nested on `groupSeparator` when one was given.
   */
  async load(): Promise<Record<string, unknown>> {
    return this.captured ?? this.read();
  }

  /**
   * Fetches a single variable.
   *
   * @param key - The variable name, or a top-level group name when grouping is on.
   * @returns The value, or `undefined` when the variable is not set.
   */
  async get(key: string): Promise<unknown> {
    return (this.captured ?? this.read())[key];
  }

  /**
   * Watches nothing: the environment a process was started with does not change underneath it.
   *
   * @returns A disposer that does nothing.
   */
  watch(): () => void {
    return () => {};
  }

  /**
   * Copies the environment into a plain record, dropping the variables that are not set.
   *
   * `process.env` reports an unset variable as `undefined`, and carrying that through would put a
   * key into the merged config whose only effect is to shadow the value a lower layer had set.
   */
  private read(): Record<string, unknown> {
    const source = this.environment ?? process.env;
    const flat: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) flat[key] = value;
    }

    return this.groupSeparator ? nestKeys(flat, this.groupSeparator) : flat;
  }
}
