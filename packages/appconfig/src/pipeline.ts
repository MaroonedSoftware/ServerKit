import { deepmerge } from 'deepmerge-ts';
import { AppConfigResolver } from './app.config.resolver.js';
import { resolveValues } from './resolve.js';
import { resolveReferences } from './references.js';

/**
 * The core configuration pipeline: deep-merge source snapshots, resolve `${…}` references
 * through the resolvers, then (optionally) resolve intra-config `${ref:…}` references.
 *
 * Pure and stateless — it takes already-loaded source snapshots rather than loading them —
 * so it is shared by {@link import('./app.config.builder.js').AppConfigBuilder} (one-shot
 * `build`) and {@link import('./options/app.config.store.js').AppConfigStore} (each reload)
 * without either owning the others' state.
 *
 * @param snapshots - The loaded source layers, in priority order (later wins on merge).
 * @param resolvers - The resolvers applied to the merged tree, in priority order.
 * @param resolveRefs - When `true`, run the {@link resolveReferences} pass after resolvers.
 * @returns The fully merged and resolved configuration object.
 */
export async function buildConfigObject(
  snapshots: Record<string, unknown>[],
  resolvers: AppConfigResolver[],
  resolveRefs: boolean,
): Promise<Record<string, unknown>> {
  // `deepmerge` with zero arguments returns `undefined`, which would crash every
  // downstream consumer; a misconfigured builder should still yield a usable empty object.
  const merged = (snapshots.length === 0 ? {} : deepmerge(...snapshots)) as Record<string, unknown>;

  await resolveValues(merged, resolvers);

  if (resolveRefs) {
    resolveReferences(merged);
  }

  return merged;
}
