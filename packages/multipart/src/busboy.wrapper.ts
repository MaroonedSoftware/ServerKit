import { IncomingMessage } from 'node:http';
import { Busboy, BusboyFileStream, BusboyHeaders } from '@fastify/busboy';
import { Writable } from 'node:stream';
import { httpError, ServerkitError } from '@maroonedsoftware/errors';
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

  /** Tracks the number of pending file handler operations */
  private pendingFiles = 0;

  /** Whether busboy has finished parsing the request */
  private finished = false;

  /** Whether parse() has been invoked. The wrapper is single-shot. */
  private started = false;

  /** A null stream used to drain file streams when errors occur */
  private readonly nullStream = new Writable({
    write(_chunk, _encding, callback) {
      setImmediate(callback);
    },
  });

  /**
   * Creates a new BusboyWrapper instance. Listener wiring is deferred to `parse()`
   * so that events fired before parsing begins cannot be silently dropped by the
   * placeholder `resolve` / `reject` slots.
   *
   * @param req - The incoming HTTP request containing multipart data
   * @param limits - Optional limits configuration for parsing
   */
  constructor(req: IncomingMessage, limits?: MultipartLimits) {
    super({ headers: req.headers as BusboyHeaders, limits });
    this.req = req;
  }

  /**
   * Parses the multipart request body. May be called at most once per instance.
   *
   * @param fileHandler - A callback function to handle file uploads as they are received
   * @returns A promise that resolves to a Map of field names to their parsed data.
   *          If multiple values exist for a field name, they are stored as an array.
   *
   * @throws {HttpError} 413 if the parts, files, fields, or per-file size limit is exceeded.
   * @throws {HttpError} 400 if the client disconnects before the request body completes.
   * @throws {ServerkitError} synchronously if called more than once on the same instance.
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
    if (this.started) {
      throw new ServerkitError('BusboyWrapper.parse() may only be called once per instance');
    }
    this.started = true;

    return new Promise<Map<string, MultipartData | MultipartData[]>>((resolve, reject) => {
      this.fileHandler = fileHandler;
      this.resolve = resolve;
      this.reject = reject;

      this.req.on('close', this.onRequestClose);
      this.on('field', this.onField)
        .on('file', this.onFile)
        .on('finish', this.onEnd)
        .on('error', this.onEnd)
        .on('partsLimit', this.onPartsLimit)
        .on('filesLimit', this.onFilesLimit)
        .on('fieldsLimit', this.onFieldsLimit);

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
   * Handler for parsed file uploads. Attaches a `'limit'` listener to each file
   * stream so that per-file size truncation surfaces as a 413 rejection instead
   * of being silently delivered to the user's handler as a partial file.
   */
  private onFile(fieldname: string, stream: BusboyFileStream, filename: string, encoding: string, mimeType: string) {
    this.setData(fieldname, { stream, filename, encoding, mimeType });

    stream.once('limit', () => {
      this.onEnd(
        httpError(413).withInternalDetails({
          reason: 'Reached file size limit',
          fieldname,
          filename,
        }),
      );
    });

    if (this.fileHandler) {
      this.pendingFiles++;
      this.fileHandler(fieldname, stream, filename, encoding, mimeType)
        .then(() => {
          this.pendingFiles--;
          this.tryResolve();
        })
        .catch(reason => {
          stream.pipe(this.nullStream);
          this.onEnd(reason);
        });
    }
  }

  /**
   * Resolves the parse promise only when busboy has finished AND all file handlers have completed.
   */
  private tryResolve() {
    if (this.finished && this.pendingFiles === 0) {
      this.finalize();
    }
  }

  private resolve(_: Map<string, MultipartData | MultipartData[]>) {}
  private reject(_?: Error) {}

  /**
   * Handler called when parsing completes or an error occurs. On error, unpipes
   * the request from busboy so the rest of the body is not silently drained
   * after the promise has already been rejected.
   */
  private onEnd(err?: Error) {
    if (err) {
      this.req.unpipe(this);
      this.cleanup();
      this.reject(err);
    } else {
      this.finished = true;
      this.tryResolve();
    }
  }

  /**
   * Performs final cleanup and resolves the parse promise with collected fields.
   */
  private finalize() {
    this.cleanup();
    this.resolve(this.fields);
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
   * Surface a premature client disconnect as an abort error. `req.complete === true`
   * means the body arrived intact and busboy is still draining buffered data —
   * in that case let `finalize()` handle cleanup once `'finish'` fires.
   */
  private readonly onRequestClose = () => {
    if (this.finished || this.req.complete) return;
    this.onEnd(httpError(400).withInternalDetails({ reason: 'client aborted upload before body completed' }));
  };

  /**
   * Cleans up event listeners to prevent memory leaks.
   */
  private cleanup() {
    this.req.removeListener('close', this.onRequestClose);
    this.removeListener('field', this.onField);
    this.removeListener('file', this.onFile);
    this.removeListener('error', this.onEnd);
    this.removeListener('partsLimit', this.onPartsLimit);
    this.removeListener('filesLimit', this.onFilesLimit);
    this.removeListener('fieldsLimit', this.onFieldsLimit);
    this.removeListener('finish', this.onEnd);
  }
}
