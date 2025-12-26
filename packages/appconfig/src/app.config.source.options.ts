/**
 * Options for configuring AppConfigSourceFile behavior.
 */
export interface AppConfigSourceFileOptions {
  /**
   * If `true`, returns an empty object when the file doesn't exist instead of throwing.
   * Defaults to `true`.
   */
  ignoreMissingFile?: boolean;
  /**
   * The file encoding to use when reading the file.
   * Defaults to `'utf8'`.
   */
  encoding?: BufferEncoding;
}
