/**
 * Interface for configuration sources that can load configuration data.
 *
 * Sources are used by AppConfigBuilder to load configuration from various places
 * such as files, environment variables, remote APIs, etc.
 *
 * @example
 * ```typescript
 * class MySource implements AppConfigSource {
 *   async load(): Promise<Record<string, unknown>> {
 *     // Load configuration from somewhere
 *     return { key: 'value' };
 *   }
 * }
 * ```
 */
export interface AppConfigSource {
  /**
   * Loads configuration data from the source.
   *
   * @returns A promise that resolves to the configuration object.
   */
  load(): Promise<Record<string, unknown>>;
}
