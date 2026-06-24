import { existsSync, watch as fsWatch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { AppConfigSource } from '../app.config.source.js';
import { getByPath } from '../helpers.js';

/**
 * Options for configuring AppConfigSourceFile behavior.
 *
 * @property ignoreMissingFile - When `true` (the default), a missing file yields an empty
 *   layer instead of throwing.
 * @property encoding - Encoding used to read the file. Defaults to `utf8`.
 */
export interface AppConfigSourceFileOptions {
  ignoreMissingFile?: boolean;
  encoding?: BufferEncoding;
}

/**
 * Base class for configuration sources backed by a **single document file** — JSON, YAML, and
 * `.env` today (vs {@link import('./app.config.source.fetch.js').AppConfigSourceFetch}, which
 * fetches each value by key from a remote store).
 *
 * Owns everything those sources share — the read-with-tolerated-missing-file behavior, the
 * load-snapshot cache, dotted-path {@link AppConfigSourceFile.get}, and directory-based
 * {@link AppConfigSourceFile.watch} — and delegates only the text-to-object step to
 * {@link AppConfigSourceFile.parse}.
 *
 * Implements {@link AppConfigSource} — bulk `load` plus single `get` — so the same instance
 * backs both bulk loading and `${ref:…}` reference resolution, and a `get` for a document the
 * source already loaded is projected from the cache rather than re-read.
 */
export abstract class AppConfigSourceFile implements AppConfigSource {
  private cache?: Record<string, unknown>;
  protected readonly ignoreMissingFile: boolean;
  protected readonly encoding: BufferEncoding;

  /**
   * @param filePath - Path to the file to read and watch.
   * @param options - Missing-file and encoding behavior. Defaults to `{ ignoreMissingFile: true, encoding: 'utf8' }`.
   */
  constructor(
    protected readonly filePath: string,
    options: AppConfigSourceFileOptions = {},
  ) {
    this.ignoreMissingFile = options.ignoreMissingFile ?? true;
    this.encoding = options.encoding ?? 'utf8';
  }

  /**
   * Reads and parses the file, caching the result for {@link AppConfigSourceFile.get}.
   *
   * If the file is missing and `ignoreMissingFile` is `true`, returns an empty object;
   * otherwise reads it with the configured encoding and hands the text to {@link parse}.
   *
   * @returns A promise resolving to the parsed configuration object.
   * @throws {Error} If the file is missing and `ignoreMissingFile` is `false`, or if `parse` throws.
   */
  async load(): Promise<Record<string, unknown>> {
    const document = await this.read();
    this.cache = document;
    return document;
  }

  /**
   * Fetches a single value by dot-separated path (e.g. `database.host`) — the keyed-`get`
   * for document sources.
   *
   * Projects into the last {@link AppConfigSourceFile.load} document when present (so a
   * reference to a file already loaded as a source adds no re-read), otherwise reads the file
   * fresh. The fresh read is **not** cached — only `load` populates the cache — so a
   * resolver-only source always reflects the current file and a reload is never served stale.
   *
   * @param key - A dot-separated path into the parsed document.
   * @returns The value at the path, or `undefined` when the path is absent.
   */
  async get(key: string): Promise<unknown> {
    const document = this.cache ?? (await this.read());
    return getByPath(document, key);
  }

  /**
   * Reads and parses the file (or returns `{}` for a tolerated-missing file).
   *
   * @returns The parsed document.
   * @internal
   */
  private async read(): Promise<Record<string, unknown>> {
    if (!existsSync(this.filePath) && this.ignoreMissingFile) {
      return {};
    }

    const file = await readFile(this.filePath, { encoding: this.encoding });
    return this.parse(file.toString());
  }

  /**
   * Watches the file and invokes `onChange` whenever it is written, created, or replaced, so
   * an {@link import('../options/app.config.store.js').AppConfigStore} can hot-reload it.
   *
   * Watches the file's *directory* (filtered to the basename) rather than the file itself, so
   * it survives the rename-replace pattern editors and atomic writers use — and picks up a
   * not-yet-existing file when it is first created. Watcher errors are swallowed; the
   * consequences of a failed reload surface where the reload is driven (the store).
   *
   * @param onChange - Invoked on each change to the file.
   * @returns A disposer that stops watching and releases the underlying watcher.
   */
  watch(onChange: () => void): () => void {
    const absolute = resolve(this.filePath);
    const file = basename(absolute);
    const watcher = fsWatch(dirname(absolute), (_event, changed) => {
      // `changed` is null on some platforms; treat that as "something changed" and reload.
      if (changed === null || changed === file) {
        onChange();
      }
    });
    watcher.on('error', () => {});
    return () => watcher.close();
  }

  /**
   * Parses the file's text into a configuration object.
   *
   * @param text - The file contents.
   * @returns The parsed configuration object.
   */
  protected abstract parse(text: string): Record<string, unknown>;
}
