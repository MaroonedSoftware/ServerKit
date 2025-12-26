import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { AppConfigSource } from '../app.config.source.js';
import { AppConfigSourceFileOptions } from '../app.config.source.options.js';

/**
 * Configuration source that loads configuration from a YAML file.
 *
 * This source reads a YAML file from the filesystem and parses it as a configuration object.
 * By default, it will return an empty object if the file doesn't exist instead of throwing an error.
 * Supports both `.yaml` and `.yml` file extensions.
 *
 * @example
 * ```typescript
 * // Load from YAML file, ignore if missing
 * const source1 = new AppConfigSourceYaml('./config.yaml');
 *
 * // Load from YAML file, throw error if missing
 * const source2 = new AppConfigSourceYaml('./config.yaml', {
 *   ignoreMissingFile: false
 * });
 *
 * // Load with custom encoding
 * const source3 = new AppConfigSourceYaml('./config.yaml', {
 *   encoding: 'utf16le'
 * });
 * ```
 */
export class AppConfigSourceYaml implements AppConfigSource {
  private readonly options: AppConfigSourceFileOptions;

  /**
   * Creates a new AppConfigSourceYaml instance.
   *
   * @param filePath - The path to the YAML file to load.
   * @param options - Optional configuration for the source behavior.
   */
  constructor(
    private readonly filePath: string,
    options?: AppConfigSourceFileOptions,
  ) {
    this.options = {
      ignoreMissingFile: true,
      encoding: 'utf8',
      ...(options ?? {}),
    };
  }

  /**
   * Loads configuration from the YAML file.
   *
   * If the file doesn't exist and `ignoreMissingFile` is `true`, returns an empty object.
   * Otherwise, reads and parses the YAML file.
   *
   * @returns A promise that resolves to the parsed YAML configuration object.
   * @throws {Error} If the file doesn't exist and `ignoreMissingFile` is `false`,
   *   or if the file contains invalid YAML.
   */
  async load(): Promise<Record<string, unknown>> {
    if (!existsSync(this.filePath) && this.options.ignoreMissingFile) {
      return {};
    }

    const file = await readFile(this.filePath, {
      encoding: this.options.encoding,
    });
    return YAML.parse(file.toString());
  }
}
