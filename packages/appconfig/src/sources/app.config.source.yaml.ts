import YAML from 'yaml';
import { AppConfigSourceFile } from './app.config.source.file.js';

/**
 * Configuration source that loads configuration from a YAML file.
 *
 * Reads a YAML file from the filesystem and parses it as a configuration object (supports
 * `.yaml` and `.yml`). By default it returns an empty object if the file doesn't exist
 * instead of throwing, and it is watchable (see {@link AppConfigSourceFile}).
 *
 * @example
 * ```typescript
 * // Load from YAML file, ignore if missing
 * const source1 = new AppConfigSourceYaml('./config.yaml');
 *
 * // Throw if missing
 * const source2 = new AppConfigSourceYaml('./config.yaml', { ignoreMissingFile: false });
 *
 * // Custom encoding
 * const source3 = new AppConfigSourceYaml('./config.yaml', { encoding: 'utf16le' });
 * ```
 */
export class AppConfigSourceYaml extends AppConfigSourceFile {
  /**
   * Parses the file contents as YAML.
   *
   * @param text - The file contents.
   * @returns The parsed configuration object.
   */
  protected parse(text: string): Record<string, unknown> {
    return YAML.parse(text);
  }
}
