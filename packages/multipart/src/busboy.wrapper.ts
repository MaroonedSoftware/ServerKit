import { IncomingMessage } from 'node:http';
import { Busboy, BusboyFileStream, BusboyHeaders } from '@fastify/busboy';
import { Writable } from 'node:stream';
import { httpError } from '@maroonedsoftware/errors';
import { FileHandler, MultipartData, MultipartLimits } from './types.js';

/**
 * A wrapper around the Busboy multipart parser that provides a promise-based API
 * for parsing multipart/form-data requests.
 *
 * This class handles both file and field parsing, automatically managing the lifecycle
 * of streams and cleanup of resources. It enforces configurable limits on file sizes,
 * field counts, and other parameters to prevent resource exhaustion.
 *
 * @extends Busboy
 *
 * @example
 * ```typescript
 * import { IncomingMessage } from 'node:http';
 * import { BusboyWrapper } from './busboy.wrapper.js';
 *
 * async function handleUpload(req: IncomingMessage) {
 *   const parser = new BusboyWrapper(req, { fileSize: 10 * 1024 * 1024 });
 *
 *   const fields = await parser.parse(async (fieldname, stream, filename) => {
 *     // Handle file upload
 *     await pipeline(stream, fs.createWriteStream(`./uploads/${filename}`));
 *   });
 *
 *   // Access parsed fields
 *   const name = fields.get('name');
 * }
 * ```
 */
export class BusboyWrapper extends Busboy {
  /** The incoming HTTP request being parsed */
  private readonly req: IncomingMessage;

  /** Map storing parsed fields and files keyed by field name */
  private readonly fields = new Map<string, MultipartData | MultipartData[]>();

  /** Optional handler for processing file uploads */
  private fileHandler?: FileHandler;

  /** A null stream used to drain file streams when errors occur */
  private readonly nullStream = new Writable({
    write(_chunk, _encding, callback) {
      setImmediate(callback);
    },
  });

  /**
   * Creates a new BusboyWrapper instance.
   *
   * @param req - The incoming HTTP request containing multipart data
   * @param limits - Optional limits configuration for parsing
   */
  constructor(req: IncomingMessage, limits?: MultipartLimits) {
    super({ headers: req.headers as BusboyHeaders, limits });

    this.req = req;
    this.req.on('close', () => this.cleanup);

    this.on('field', this.onField)
      .on('file', this.onFile)
      .on('finish', this.onEnd)
      .on('error', this.onEnd)
      .on('partsLimit', this.onPartsLimit)
      .on('filesLimit', this.onFilesLimit)
      .on('fieldsLimit', this.onFieldsLimit);
  }

  /**
   * Parses the multipart request body.
   *
   * @param fileHandler - A callback function to handle file uploads as they are received
   * @returns A promise that resolves to a Map of field names to their parsed data.
   *          If multiple values exist for a field name, they are stored as an array.
   *
   * @throws {HttpError} 413 error if parts, files, or fields limits are exceeded
   *
   * @example
   * ```typescript
   * const fields = await parser.parse(async (fieldname, stream, filename) => {
   *   const chunks: Buffer[] = [];
   *   for await (const chunk of stream) {
   *     chunks.push(chunk);
   *   }
   *   await fs.writeFile(`./uploads/${filename}`, Buffer.concat(chunks));
   * });
   * ```
   */
  parse(fileHandler: FileHandler) {
    return new Promise<Map<string, MultipartData | MultipartData[]>>((resolve, reject) => {
      this.fileHandler = fileHandler;
      this.resolve = resolve;
      this.reject = reject;
      this.req.pipe(this);
    });
  }

  /**
   * Stores parsed data in the fields map, handling multiple values for the same field.
   *
   * @param name - The field name
   * @param data - The parsed field or file data
   */
  private setData(name: string, data: MultipartData) {
    const prev = this.fields.get(name);
    if (prev == null) {
      this.fields.set(name, data);
    } else if (Array.isArray(prev)) {
      prev.push(data);
    } else {
      this.fields.set(name, [prev, data]);
    }
  }

  /**
   * Handler for parsed form fields.
   */
  private onField(name: string, value: string, nameTruncated: boolean, valueTruncated: boolean, encoding: string, mimeType: string) {
    this.setData(name, {
      value,
      nameTruncated,
      valueTruncated,
      encoding,
      mimeType,
    });
  }

  /**
   * Handler for parsed file uploads.
   */
  private onFile(fieldname: string, stream: BusboyFileStream, filename: string, encoding: string, mimeType: string) {
    this.setData(fieldname, { stream, filename, encoding, mimeType });
    if (this.fileHandler) {
      this.fileHandler(fieldname, stream, filename, encoding, mimeType)
        .then(() => {
          this.onEnd();
        })
        .catch(reason => {
          stream.pipe(this.nullStream);
          this.onEnd(reason);
        });
    }
  }

  private resolve(_: Map<string, MultipartData | MultipartData[]>) {}
  private reject(_?: Error) {}

  /**
   * Handler called when parsing completes or an error occurs.
   */
  private onEnd(err?: Error) {
    this.cleanup();
    if (err) {
      this.reject(err);
    } else {
      this.resolve(this.fields);
    }
  }

  /**
   * Handler for when the parts limit is exceeded.
   */
  private onPartsLimit() {
    const err = httpError(413).withInternalDetails({
      reason: 'Reached parts limit',
    });
    this.onEnd(err);
  }

  /**
   * Handler for when the files limit is exceeded.
   */
  private onFilesLimit() {
    const err = httpError(413).withInternalDetails({
      reason: 'Reached files limit',
    });
    this.onEnd(err);
  }

  /**
   * Handler for when the fields limit is exceeded.
   */
  private onFieldsLimit() {
    const err = httpError(413).withInternalDetails({
      reason: 'Reached fields limit',
    });
    this.onEnd(err);
  }

  /**
   * Cleans up event listeners to prevent memory leaks.
   */
  private cleanup() {
    this.req.removeListener('close', this.cleanup);
    this.removeListener('field', this.onField);
    this.removeListener('file', this.onFile);
    this.removeListener('error', this.onEnd);
    this.removeListener('partsLimit', this.onPartsLimit);
    this.removeListener('filesLimit', this.onFilesLimit);
    this.removeListener('fieldsLimit', this.onFieldsLimit);
    this.removeListener('finish', this.onEnd);
  }
}
