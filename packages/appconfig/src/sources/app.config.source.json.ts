import { existsSync } from 'node:fs';
import { AppConfigSource } from '../app.config.source.js';
import { readFile } from 'node:fs/promises';
import { AppConfigSourceFileOptions } from '../app.config.source.options.js';

/**
 * Configuration source that loads configuration from a JSON file.
 *
 * This source reads a JSON file from the filesystem and parses it as a configuration object.
 * By default, it will return an empty object if the file doesn't exist instead of throwing an error.
 *
 * @example
 * ```typescript
 * // Load from JSON file, ignore if missing
 * const source1 = new AppConfigSourceJson('./config.json');
 *
 * // Load from JSON file, throw error if missing
 * const source2 = new AppConfigSourceJson('./config.json', {
 *   ignoreMissingFile: false
 * });
 *
 * // Load with custom encoding
 * const source3 = new AppConfigSourceJson('./config.json', {
 *   encoding: 'utf16le'
 * });
 * ```
 */
export class AppConfigSourceJson implements AppConfigSource {
  private readonly options: AppConfigSourceFileOptions;

  /**
   * Creates a new AppConfigSourceJson instance.
   *
   * @param filePath - The path to the JSON file to load.
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
   * Loads configuration from the JSON file.
   *
   * If the file doesn't exist and `ignoreMissingFile` is `true`, returns an empty object.
   * Otherwise, reads and parses the JSON file.
   *
   * @returns A promise that resolves to the parsed JSON configuration object.
   * @throws {Error} If the file doesn't exist and `ignoreMissingFile` is `false`,
   *   or if the file contains invalid JSON.
   */
  async load(): Promise<Record<string, unknown>> {
    if (!existsSync(this.filePath) && this.options.ignoreMissingFile) {
      return {};
    }

    const file = await readFile(this.filePath, {
      encoding: this.options.encoding,
    });
    return JSON.parse(file.toString());
  }
}
