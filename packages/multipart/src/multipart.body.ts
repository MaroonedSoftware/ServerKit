import { IncomingMessage } from 'node:http';
import { BusboyWrapper } from './busboy.wrapper.js';
import { FileHandler, MultipartData } from './types.js';
import { MultipartLimits } from './types.js';

/** Default maximum file size: 20 MB */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * High-level API for parsing multipart/form-data request bodies.
 *
 * This class provides a simple interface for handling file uploads and form fields
 * from HTTP requests. It wraps the lower-level BusboyWrapper with sensible defaults
 * and allows per-request limit overrides.
 *
 * @example
 * ```typescript
 * import { IncomingMessage } from 'node:http';
 * import { MultipartBody } from '@maroonedsoftware/multipart';
 *
 * async function handleRequest(req: IncomingMessage) {
 *   const multipart = new MultipartBody(req);
 *
 *   const fields = await multipart.parse(async (fieldname, stream, filename) => {
 *     // Save the file
 *     await pipeline(stream, fs.createWriteStream(`./uploads/${filename}`));
 *   });
 *
 *   // Access form fields
 *   const description = fields.get('description');
 * }
 * ```
 */
export class MultipartBody {
  /**
   * Creates a new MultipartBody instance.
   *
   * @param req - The incoming HTTP request containing multipart data
   * @param _limits - Default limits applied to all parse operations.
   *                  Defaults to 1 file maximum and 20MB file size limit.
   */
  constructor(
    private readonly req: IncomingMessage,
    private readonly _limits: MultipartLimits = {
      files: 1,
      fileSize: MAX_FILE_SIZE,
    },
  ) {}

  /**
   * Parses the multipart request body and processes any file uploads.
   *
   * @param fileHandler - A callback function invoked for each file in the request.
   *                      The callback receives the field name, file stream, filename,
   *                      encoding, and MIME type. It should return a promise that
   *                      resolves when the file has been fully processed.
   * @param limits - Optional per-request limits that override the instance defaults.
   *                 These are merged with the default limits (per-request takes precedence).
   * @returns A promise that resolves to a Map containing all parsed fields and files.
   *          Field names are keys, and values are either a single MultipartData object
   *          or an array if multiple values were submitted for the same field name.
   *
   * @throws {HttpError} 413 error if configured limits are exceeded
   *
   * @example
   * ```typescript
   * // Parse with custom file size limit for this request
   * const fields = await multipart.parse(
   *   async (fieldname, stream, filename) => {
   *     await saveFile(stream, filename);
   *   },
   *   { fileSize: 50 * 1024 * 1024 } // 50MB for this request
   * );
   * ```
   */
  parse(fileHandler: FileHandler, limits?: MultipartLimits): Promise<Map<string, MultipartData | MultipartData[]>> {
    const busboy = new BusboyWrapper(this.req, { ...this._limits, ...limits });

    return busboy.parse(fileHandler);
  }
}
