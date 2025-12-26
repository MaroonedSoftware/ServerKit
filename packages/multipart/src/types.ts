import { Readable } from 'node:stream';

/**
 * Callback function for handling file uploads during multipart parsing.
 *
 * @param fieldname - The name of the form field
 * @param stream - A readable stream containing the file data
 * @param filename - The original filename from the upload
 * @param encoding - The encoding of the file (e.g., '7bit', 'binary')
 * @param mimeType - The MIME type of the file (e.g., 'image/png')
 * @returns A promise that resolves when the file has been fully processed
 *
 * @example
 * ```typescript
 * const handler: FileHandler = async (fieldname, stream, filename, encoding, mimeType) => {
 *   const writeStream = fs.createWriteStream(`./uploads/${filename}`);
 *   await pipeline(stream, writeStream);
 * };
 * ```
 */
export type FileHandler = (fieldname: string, stream: Readable, filename: string, encoding: string, mimeType: string) => Promise<void>;

/**
 * Represents parsed form field data from a multipart request.
 */
export type FieldData = {
  /** The string value of the field */
  value: string;
  /** Whether the field name was truncated due to limits */
  nameTruncated: boolean;
  /** Whether the field value was truncated due to limits */
  valueTruncated: boolean;
  /** The encoding of the field value */
  encoding: string;
  /** The MIME type of the field */
  mimeType: string;
};

/**
 * Represents parsed file data from a multipart request.
 */
export type FileData = {
  /** A readable stream containing the file data */
  stream: Readable;
  /** The original filename from the upload */
  filename: string;
  /** The encoding of the file */
  encoding: string;
  /** The MIME type of the file */
  mimeType: string;
};

/**
 * Union type representing either field data or file data from a multipart request.
 */
export type MultipartData = FieldData | FileData;

/**
 * Type guard to check if the multipart data is field data.
 *
 * @param data - The multipart data to check
 * @returns True if the data is field data, false otherwise
 *
 * @example
 * ```typescript
 * if (isMultipartFieldData(data)) {
 *   console.log(data.value); // TypeScript knows this is FieldData
 * }
 * ```
 */
export const isMultipartFieldData = (data: MultipartData): data is FieldData => {
  return 'value' in data;
};

/**
 * Type guard to check if the multipart data is file data.
 *
 * @param data - The multipart data to check
 * @returns True if the data is file data, false otherwise
 *
 * @example
 * ```typescript
 * if (isMultipartFileData(data)) {
 *   data.stream.pipe(destination); // TypeScript knows this is FileData
 * }
 * ```
 */
export const isMultipartFileData = (data: MultipartData): data is FileData => {
  return 'stream' in data;
};

/**
 * Configuration options for limiting multipart request sizes.
 * Used to prevent resource exhaustion from malicious or oversized uploads.
 *
 * @see https://github.com/fastify/busboy/blob/main/lib/main.d.ts#L104
 */
export interface MultipartLimits {
  /**
   * Maximum field name size in bytes.
   * @default 100
   */
  fieldNameSize?: number | undefined;
  /**
   * Maximum field value size in bytes.
   * @default 1048576 (1MB)
   */
  fieldSize?: number | undefined;
  /**
   * Maximum number of non-file fields.
   * @default Infinity
   */
  fields?: number | undefined;
  /**
   * Maximum file size in bytes for multipart forms.
   * @default Infinity
   */
  fileSize?: number | undefined;
  /**
   * Maximum number of file fields for multipart forms.
   * @default Infinity
   */
  files?: number | undefined;
  /**
   * Maximum number of parts (fields + files) for multipart forms.
   * @default Infinity
   */
  parts?: number | undefined;
  /**
   * Maximum number of header key-value pairs to parse for multipart forms.
   * @default 2000
   */
  headerPairs?: number | undefined;
  /**
   * Maximum size of a header part in bytes for multipart forms.
   * @default 81920
   */
  headerSize?: number | undefined;
}
