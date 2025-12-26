import { ObjectVisitorMeta } from './object.visitor.js';

/**
 * Interface for providers that transform string values in configuration.
 *
 * Providers are used by AppConfigBuilder to transform string values found in the
 * configuration. For example, a provider might resolve environment variable references
 * or perform other string transformations.
 *
 * @example
 * ```typescript
 * class MyProvider implements AppConfigProvider {
 *   canParse(value: string): boolean {
 *     return value.startsWith('custom:');
 *   }
 *
 *   async parse(value: string, meta: ObjectVisitorMeta): Promise<void> {
 *     // Transform the value
 *     meta.owner[meta.propertyPath] = transformedValue;
 *   }
 * }
 * ```
 */
export interface AppConfigProvider {
  /**
   * Determines whether this provider can parse the given string value.
   *
   * @param value - The string value to check.
   * @returns `true` if this provider can parse the value, `false` otherwise.
   */
  canParse(value: string): boolean;

  /**
   * Parses and transforms the given string value.
   *
   * The provider should update the value in the configuration object using
   * the provided metadata.
   *
   * @param value - The string value to parse and transform.
   * @param meta - Metadata about the value's location in the configuration object.
   * @returns A promise that resolves when the transformation is complete.
   */
  parse(value: string, meta: ObjectVisitorMeta): Promise<void>;
}
