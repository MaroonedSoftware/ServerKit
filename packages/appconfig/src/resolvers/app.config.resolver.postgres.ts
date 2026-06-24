import { Injectable } from 'injectkit';
import { AppConfigKeyedResolver } from './app.config.resolver.keyed.js';
import { AppConfigSourcePostgres } from '../sources/app.config.source.postgres.js';

/**
 * Resolver that resolves Postgres settings-table references (`${pg:KEY}`) in configuration
 * values.
 *
 * A thin wrapper over {@link AppConfigKeyedResolver}: it delegates to
 * {@link AppConfigSourcePostgres}'s `get`, which reads from the source's **bulk-loaded
 * snapshot** rather than querying per reference. Add the same source to the builder too, so
 * its one `load()` (and hot reload) populates the snapshot that every `${pg:…}` reference
 * then reads — resolving references adds no extra round-trips. A `${pg:…}` reference to a
 * key absent from the snapshot throws (the source's `get` is strict), so a misconfigured
 * reference fails loud.
 *
 * Because the source needs a logger and connection options, always pass a constructed
 * {@link AppConfigSourcePostgres} (there is no region/id shorthand as with AWS/GCP).
 *
 * @example
 * ```typescript
 * const pg = new AppConfigSourcePostgres(logger, { connection });
 * const config = await new AppConfigBuilder()
 *   .addSource(new AppConfigSourceJson('./config.json'))
 *   .addSource(pg) // one bulk load + hot reload populates the snapshot
 *   .addResolver(new AppConfigResolverPostgres(pg)) // ${pg:…} reads that snapshot
 *   .buildSnapshot();
 * ```
 */
@Injectable()
export class AppConfigResolverPostgres extends AppConfigKeyedResolver {
  /**
   * Creates a new AppConfigResolverPostgres instance.
   *
   * @param source - The Postgres source whose `get` resolves each reference.
   * @param prefix - A regex pattern or string to match references. Must have at least one
   *   capture group extracting the key. Defaults to `/\$\{pg:(.+)\}/g`.
   */
  constructor(source: AppConfigSourcePostgres, prefix: string | RegExp = /\$\{pg:(.+)\}/g) {
    super(source, prefix);
  }
}
