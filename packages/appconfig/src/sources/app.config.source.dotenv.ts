import { AppConfigSource } from '../app.config.source.js';
import dotenv from 'dotenv';

/**
 * Configuration source that loads environment variables from a `.env` file.
 *
 * This source uses the `dotenv` package to load environment variables from a `.env` file.
 * If no file path is provided, it will look for a `.env` file in the current working directory.
 * All values are strings as provided by the environment file.
 *
 * @example
 * ```typescript
 * // Load from default .env file
 * const source1 = new AppConfigSourceDotenv();
 * const config1 = await source1.load();
 *
 * // Load from custom path
 * const source2 = new AppConfigSourceDotenv('./config/.env.local');
 * const config2 = await source2.load();
 * ```
 */
export class AppConfigSourceDotenv implements AppConfigSource {
  /**
   * Creates a new AppConfigSourceDotenv instance.
   *
   * @param filePath - Optional path to the `.env` file. If not provided, `dotenv` will
   *   look for a `.env` file in the current working directory.
   */
  constructor(private readonly filePath?: string) {}

  /**
   * Loads environment variables from the `.env` file.
   *
   * Uses `dotenv.config()` to parse the file and load variables into the returned object.
   * If the file doesn't exist or there's an error, an error will be thrown.
   *
   * @returns A promise that resolves to an object containing the parsed environment variables.
   * @throws {Error} If there's an error reading or parsing the `.env` file.
   */
  async load(): Promise<Record<string, unknown>> {
    const result = dotenv.config({ path: this.filePath, quiet: true });
    if (result.error) {
      throw result.error;
    }
    return Promise.resolve(result.parsed ?? {});
  }
}
