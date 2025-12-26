import { IncomingMessage } from 'node:http';
import { FileHandler, MultipartData } from './types.js';
import { Readable, Writable } from 'node:stream';
import { httpError } from '@maroonedsoftware/errors';

/**
 * Extended Readable stream interface for multipart/related file parts.
 *
 * Provides additional metadata about the stream state including whether
 * the stream was truncated due to size limits and the total bytes read.
 */
export interface MultipartRelatedFileStream extends Readable {
  /** Whether the file stream was truncated due to size limits */
  truncated: boolean;
  /** The number of bytes that have been read from the stream so far */
  bytesRead: number;
}

/**
 * Parser for multipart/related content type requests.
 *
 * The multipart/related content type is used when multiple related parts
 * need to be processed together, such as email messages with inline attachments
 * or SOAP messages with MIME attachments.
 *
 * This parser extends Writable to act as a stream destination for the incoming
 * request body, parsing parts as they arrive and invoking handlers for files.
 *
 * @extends Writable
 *
 * @example
 * ```typescript
 * import { IncomingMessage } from 'node:http';
 * import { MultipartRelatedParser } from './multipart.related.parser.js';
 *
 * async function handleRelatedContent(req: IncomingMessage) {
 *   const parser = new MultipartRelatedParser(req);
 *
 *   const parts = await parser.parse(async (fieldname, stream, filename) => {
 *     // Process each related part
 *     const content = await streamToBuffer(stream);
 *     console.log(`Received ${filename}: ${content.length} bytes`);
 *   });
 * }
 * ```
 */
export class MultipartRelatedParser extends Writable {
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
   * Creates a new MultipartRelatedParser instance.
   *
   * @param req - The incoming HTTP request containing multipart/related data
   */
  constructor(private readonly req: IncomingMessage) {
    super();
  }

  /**
   * Parses the multipart/related request body.
   *
   * @param fileHandler - A callback function to handle file parts as they are received.
   *                      Each file part triggers the handler with the field name, stream,
   *                      filename, encoding, and MIME type.
   * @returns A promise that resolves to a Map of field names to their parsed data.
   *          If multiple values exist for a field name, they are stored as an array.
   *
   * @throws {HttpError} 413 error if parts, files, or fields limits are exceeded
   *
   * @example
   * ```typescript
   * const parts = await parser.parse(async (fieldname, stream, filename) => {
   *   const chunks: Buffer[] = [];
   *   for await (const chunk of stream) {
   *     chunks.push(chunk);
   *   }
   *   // Process the complete content
   *   processContent(Buffer.concat(chunks));
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
  private onFile(fieldname: string, stream: MultipartRelatedFileStream, filename: string, encoding: string, mimeType: string) {
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
