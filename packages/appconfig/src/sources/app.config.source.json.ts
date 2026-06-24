import { AppConfigSourceFile } from './app.config.source.file.js';

/**
 * Configuration source that loads configuration from a JSON file.
 *
 * Reads a JSON file from the filesystem and parses it as a configuration object. By default
 * it returns an empty object if the file doesn't exist instead of throwing, and it is
 * watchable (see {@link AppConfigSourceFile}).
 *
 * @example
 * ```typescript
 * // Load from JSON file, ignore if missing
 * const source1 = new AppConfigSourceJson('./config.json');
 *
 * // Throw if missing
 * const source2 = new AppConfigSourceJson('./config.json', { ignoreMissingFile: false });
 *
 * // Custom encoding
 * const source3 = new AppConfigSourceJson('./config.json', { encoding: 'utf16le' });
 * ```
 */
export class AppConfigSourceJson extends AppConfigSourceFile {
  /**
   * Parses the file contents as JSON.
   *
   * @param text - The file contents.
   * @returns The parsed configuration object.
   */
  protected parse(text: string): Record<string, unknown> {
    return JSON.parse(text);
  }
}
