import { AppConfigResolver } from '../app.config.resolver.js';
import { ObjectVisitorMeta } from '../object.visitor.js';
import { tryParseJson } from '../helpers.js';

/**
 * Resolver that resolves environment variable references in configuration values.
 *
 * Matches string values against a regex pattern and replaces each match with the
 * corresponding value from `process.env`. The default pattern matches `${env:KEY}` and
 * extracts `KEY`. Unlike the secret resolvers, this one *interpolates within the string*:
 * `${env:HOST}:${env:PORT}` composes into one value, with each reference spliced in. After
 * substitution the result is JSON-parsed where possible (so `${env:PORT}` can yield a number).
 *
 * @example
 * ```typescript
 * // With default pattern /\$\{env:(.+)\}/g
 * // Value: "${env:DATABASE_URL}"  → process.env.DATABASE_URL
 *
 * const config = await new AppConfigBuilder()
 *   .addSource(new AppConfigSourceJson('./config.json'))
 *   .addResolver(new AppConfigResolverEnv())
 *   .buildSnapshot();
 * ```
 */
export class AppConfigResolverEnv implements AppConfigResolver {
  private readonly prefix: RegExp;

  /**
   * Creates a new AppConfigResolverEnv instance.
   *
   * @param prefix - A regex pattern or string to match environment variable references.
   *   If a string is provided, it will be converted to a RegExp. The regex must have at
   *   least one capture group that extracts the environment variable key. Defaults to
   *   `/\$\{env:([^}]+)\}/g` which matches `${env:KEY}` patterns. The capture is non-greedy
   *   (`[^}]+`, not `.+`) so composed references like `${env:HOST}:${env:PORT}` match each
   *   reference separately instead of one greedy span with a garbage key. The pattern is
   *   always compiled with the `g` flag (required by `matchAll`).
   *
   * @example
   * ```typescript
   * const resolver1 = new AppConfigResolverEnv();
   * const resolver2 = new AppConfigResolverEnv(/\$\{([^}]+)\}/g); // ${KEY}
   * ```
   */
  constructor(prefix: string | RegExp = /\$\{env:([^}]+)\}/g) {
    const regex = typeof prefix === 'string' ? new RegExp(prefix) : prefix;
    // `resolve` uses `matchAll`, which throws on a non-global regex — always ensure `g`.
    this.prefix = regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`);
  }

  /**
   * Checks if this resolver can handle the given value.
   *
   * @param value - The string value to check.
   * @returns `true` if the value matches the resolver's regex pattern.
   */
  canResolve(value: string): boolean {
    this.prefix.lastIndex = 0;
    return this.prefix.test(value);
  }

  /**
   * Replaces environment variable references with their values and writes the result back.
   *
   * @param value - The string value containing environment variable references.
   * @param meta - Metadata about the value's location in the configuration object.
   * @returns A promise that resolves when the transformation is complete.
   *
   * @example
   * ```typescript
   * // process.env.PORT = "3000"; Value "${env:PORT}" → 3000 (parsed as JSON number)
   * ```
   */
  async resolve(value: string, meta: ObjectVisitorMeta): Promise<void> {
    // Reset first: a prior `canResolve` `.test()` advances `lastIndex` on this shared `/g`
    // regex, and `matchAll` seeds from it — which would skip the match in the pipeline.
    this.prefix.lastIndex = 0;
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
