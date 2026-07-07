import { AppConfigResolver } from '../app.config.resolver.js';
import { AppConfigSource } from '../app.config.source.js';
import { ObjectVisitorMeta } from '../object.visitor.js';

/**
 * Generic resolver that resolves `${scheme:KEY}` reference tokens by delegating the lookup
 * to an {@link AppConfigSource.get}.
 *
 * This is the reusable core behind {@link import('./app.config.resolver.aws.secrets.js').AppConfigResolverAwsSecrets}
 * and {@link import('./app.config.resolver.gcp.secrets.js').AppConfigResolverGcpSecrets}: a
 * resolver is just a reference pattern plus a value source. It does *whole-value*
 * replacement — when a value matches, the resolved value (which may be a JSON object,
 * number, etc.) replaces it by identity rather than being interpolated into a string. Use a
 * dedicated string-interpolating resolver (e.g. {@link import('./app.config.resolver.env.js').AppConfigResolverEnv})
 * when you need `${a}-${b}` style composition.
 *
 * Construct it directly to resolve references against any keyed backend:
 *
 * ```typescript
 * const resolver = new AppConfigKeyedResolver(new MyVaultSource(), /\$\{vault:(.+)\}/g);
 * ```
 */
export class AppConfigKeyedResolver implements AppConfigResolver {
  private readonly prefix: RegExp;

  /**
   * Creates a new AppConfigKeyedResolver.
   *
   * @param source - The value source references are resolved against (via its `get`).
   * @param prefix - A regex (or string compiled to one) matching the reference tokens. Must
   *   carry at least one capture group that extracts the key. Should be `/g`-flagged so a
   *   value may contain more than one reference.
   */
  constructor(
    private readonly source: AppConfigSource,
    prefix: string | RegExp,
  ) {
    const regex = typeof prefix === 'string' ? new RegExp(prefix) : prefix;
    // `resolve` uses `matchAll`, which throws on a non-global regex — always ensure `g`.
    this.prefix = regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`);
  }

  /**
   * Checks whether the value contains a reference this resolver handles.
   *
   * @param value - The string value to check.
   * @returns `true` if the value matches the reference pattern.
   */
  canResolve(value: string): boolean {
    // `.test()` with a `/g`-flagged regex advances `lastIndex`, which can cause a false
    // negative on a subsequent call against the same string. Reset before testing so
    // behavior is independent of call order.
    this.prefix.lastIndex = 0;
    return this.prefix.test(value);
  }

  /**
   * Resolves each reference in the value through the source and writes the result back.
   *
   * @param value - The string value containing reference(s).
   * @param meta - Metadata about the value's location in the configuration object.
   * @returns A promise that resolves once every referenced value has been fetched and written.
   * @throws Propagated from the source when a referenced value cannot be resolved.
   */
  async resolve(value: string, meta: ObjectVisitorMeta): Promise<void> {
    const tasks: Promise<void>[] = [];
    // Reset first: a prior `canResolve` `.test()` advances `lastIndex` on this shared `/g`
    // regex, and `matchAll` seeds from it — which would skip the match in the pipeline.
    this.prefix.lastIndex = 0;
    const matches = value.matchAll(this.prefix);

    for (const [, key] of matches) {
      const task = this.source.get(key!).then(resolved => {
        // `undefined` only arises when the source is configured to ignore a missing value;
        // leave the original reference untouched rather than blanking it.
        if (resolved === undefined) {
          return;
        }
        if (meta.arrayIndex !== undefined && Array.isArray(meta.owner)) {
          meta.owner[meta.arrayIndex] = resolved;
        } else {
          (meta.owner as Record<string, unknown>)[meta.propertyPath] = resolved;
        }
      });
      tasks.push(task);
    }

    await Promise.all(tasks);
  }
}
