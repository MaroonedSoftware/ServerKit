import { ObjectVisitorMeta } from './object.visitor.js';

/**
 * Interface for resolvers that transform `${scheme:…}` reference tokens in configuration
 * string values into their resolved values.
 *
 * Resolvers are applied by {@link import('./resolve.js').resolveValues} over the merged
 * configuration tree (and by sources that need to resolve their own inputs before acting).
 * A resolver matches a string value (e.g. `${env:PORT}`, `${aws:DB_PASSWORD}`) and rewrites
 * it in place via the value's {@link ObjectVisitorMeta}.
 *
 * > Naming note: this is what other configuration libraries sometimes call a "provider".
 * > In ServerKit a *source* loads configuration and a *resolver* substitutes references, so
 * > the two concerns stay distinct.
 *
 * @example
 * ```typescript
 * class MyResolver implements AppConfigResolver {
 *   canResolve(value: string): boolean {
 *     return value.startsWith('custom:');
 *   }
 *
 *   async resolve(value: string, meta: ObjectVisitorMeta): Promise<void> {
 *     (meta.owner as Record<string, unknown>)[meta.propertyPath] = transformedValue;
 *   }
 * }
 * ```
 */
export interface AppConfigResolver {
  /**
   * Determines whether this resolver can handle the given string value.
   *
   * @param value - The string value to check.
   * @returns `true` if this resolver recognises the value, `false` otherwise.
   */
  canResolve(value: string): boolean;

  /**
   * Resolves and transforms the given string value, writing the result back through the
   * provided metadata.
   *
   * @param value - The string value to resolve.
   * @param meta - Metadata about the value's location in the configuration object.
   * @returns A promise that resolves when the transformation is complete.
   */
  resolve(value: string, meta: ObjectVisitorMeta): Promise<void>;
}
