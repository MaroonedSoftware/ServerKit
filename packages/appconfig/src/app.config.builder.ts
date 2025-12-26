import { deepmerge } from 'deepmerge-ts';
import { AppConfig } from './app.config.js';
import { AppConfigProvider } from './app.config.provider.js';
import { AppConfigSource } from './app.config.source.js';
import { objectVisitor, ObjectVisitorMeta } from './object.visitor.js';

/**
 * Builder for constructing AppConfig instances from multiple sources with value transformation.
 *
 * The builder allows you to:
 * - Load configuration from multiple sources (files, environment variables, etc.)
 * - Merge configurations with later sources overriding earlier ones
 * - Transform string values using providers (e.g., resolving environment variable references)
 *
 * @example
 * ```typescript
 * const config = await new AppConfigBuilder()
 *   .addSource(new AppConfigSourceJson('./config.json'))
 *   .addSource(new AppConfigSourceDotenv())
 *   .addProvider(new AppConfigProviderDotenv())
 *   .build();
 * ```
 */
export class AppConfigBuilder {
  private readonly sources: AppConfigSource[] = [];
  private readonly providers: AppConfigProvider[] = [];

  /**
   * Adds a configuration source to the builder.
   *
   * Sources are loaded in the order they are added, and later sources override earlier ones
   * when merging configurations.
   *
   * @param source - The configuration source to add.
   * @returns The builder instance for method chaining.
   *
   * @example
   * ```typescript
   * builder
   *   .addSource(new AppConfigSourceJson('./default.json'))
   *   .addSource(new AppConfigSourceJson('./local.json'));
   * ```
   */
  addSource(source: AppConfigSource) {
    this.sources.push(source);
    return this;
  }

  /**
   * Adds a provider to transform string values during configuration building.
   *
   * Providers are applied to all string values found in the merged configuration.
   * The first provider that can parse a value will be used to transform it.
   *
   * @param provider - The provider to add.
   * @returns The builder instance for method chaining.
   *
   * @example
   * ```typescript
   * builder.addProvider(new AppConfigProviderDotenv());
   * ```
   */
  addProvider(provider: AppConfigProvider) {
    this.providers.push(provider);
    return this;
  }

  /**
   * Builds the AppConfig instance by loading all sources, merging them, and applying providers.
   *
   * The build process:
   * 1. Loads all sources in parallel
   * 2. Merges configurations (later sources override earlier ones)
   * 3. Traverses the merged configuration and applies providers to string values
   * 4. Returns the final AppConfig instance
   *
   * @template T - The type of the configuration object. Defaults to `Record<string, unknown>`.
   * @returns A promise that resolves to the built AppConfig instance.
   *
   * @example
   * ```typescript
   * const config = await builder.build<MyConfigType>();
   * const value = config.get('someKey');
   * ```
   */
  async build<T = Record<string, unknown>>(): Promise<AppConfig<T>> {
    const sourceTasks = await Promise.all(this.sources.map(x => x.load()));
    const mergedConfig = deepmerge(...sourceTasks) as T;

    const tasks: Promise<void>[] = [];
    const parse = (value: unknown, meta: ObjectVisitorMeta) => {
      if (typeof value === 'string') {
        const provider = this.providers.find(x => x.canParse(value));
        if (provider) {
          tasks.push(provider.parse(value, meta));
        }
      }
    };

    objectVisitor(mergedConfig, parse);
    await Promise.all(tasks);

    return new AppConfig<T>(mergedConfig);
  }
}
