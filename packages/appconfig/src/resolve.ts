import { AppConfigResolver } from './app.config.resolver.js';
import { objectVisitor, ObjectVisitorMeta } from './object.visitor.js';

/**
 * Resolves every string value in an object tree through a set of resolvers,
 * mutating the object in place.
 *
 * This is the transformation pass shared by {@link import('./app.config.builder.js').AppConfigBuilder}
 * (which runs it over the merged config) and any source that needs to resolve
 * `${env:…}` / `${gcp:…}` / `${aws:…}` references in its own inputs *before* it
 * can act on them — for example {@link import('./sources/app.config.source.postgres.js').AppConfigSourcePostgres}
 * resolving its connection password from a secret manager before connecting.
 *
 * For each string value, the first resolver whose `canResolve` matches transforms
 * it (writing the result back via the value's {@link ObjectVisitorMeta}). Resolutions
 * run concurrently and are awaited together. Non-string values are left
 * untouched, and an empty resolver list is a no-op.
 *
 * @param target - The object whose string values are resolved in place.
 * @param resolvers - The resolvers to apply, in priority order.
 * @returns A promise that resolves once every transformation has completed.
 */
export async function resolveValues(target: object, resolvers: AppConfigResolver[]): Promise<void> {
  if (resolvers.length === 0) {
    return;
  }

  const tasks: Promise<void>[] = [];
  objectVisitor(target, (value: unknown, meta: ObjectVisitorMeta) => {
    if (typeof value === 'string') {
      const resolver = resolvers.find(x => x.canResolve(value));
      if (resolver) {
        tasks.push(resolver.resolve(value, meta));
      }
    }
  });
  await Promise.all(tasks);
}
