import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppConfigSourceFile, type AppConfigSourceFileOptions } from '../../src/sources/app.config.source.file.js';

// Note: `watch()` is intentionally not unit-tested here. It binds `fs.watch`, and mocking the
// `node:fs` module leaks across the shared module cache under this package's `isolate: false`
// vitest config (poisoning sibling file-IO tests). The watch-triggered reload path is covered
// end-to-end through fake sources in tests/options/app.config.store.test.ts instead.

/**
 * Minimal concrete subclass so the abstract base can be exercised directly. The parse hook is
 * trivial (line-oriented `key=value`) and records each call so tests can assert that `read`
 * delegates text-to-object conversion to `parse`, and how often.
 */
class AppConfigSourceFileTest extends AppConfigSourceFile {
  public readonly parseCalls: string[] = [];

  constructor(filePath: string, options?: AppConfigSourceFileOptions) {
    super(filePath, options);
  }

  protected parse(text: string): Record<string, unknown> {
    this.parseCalls.push(text);
    const result: Record<string, unknown> = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      result[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return result;
  }
}

describe('AppConfigSourceFile', () => {
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `appconfig-file-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    testFile = join(testDir, 'config.txt');
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testFile)) {
      unlinkSync(testFile);
    }
    if (existsSync(testDir)) {
      rmdirSync(testDir);
    }
  });

  describe('load()', () => {
    it('reads the file and converts it via the subclass parse hook', async () => {
      writeFileSync(testFile, 'host=localhost\nport=5432', 'utf8');
      const source = new AppConfigSourceFileTest(testFile);

      const config = await source.load();

      expect(config).toEqual({ host: 'localhost', port: '5432' });
      expect(source.parseCalls).toEqual(['host=localhost\nport=5432']);
    });

    it('caches the loaded document so get() projects from the snapshot without re-parsing', async () => {
      writeFileSync(testFile, 'a=1', 'utf8');
      const source = new AppConfigSourceFileTest(testFile);
      await source.load();

      // Change the file after load; get() must serve the cached snapshot, not re-read.
      writeFileSync(testFile, 'a=2', 'utf8');

      expect(await source.get('a')).toBe('1');
      expect(source.parseCalls).toHaveLength(1); // only load() parsed
    });
  });

  describe('missing file', () => {
    it('returns an empty object when the file is missing and ignoreMissingFile defaults to true', async () => {
      const source = new AppConfigSourceFileTest(testFile);

      const config = await source.load();

      expect(config).toEqual({});
      expect(source.parseCalls).toEqual([]); // parse is never reached for a tolerated-missing file
    });

    it('returns an empty object when ignoreMissingFile is explicitly true', async () => {
      const source = new AppConfigSourceFileTest(testFile, { ignoreMissingFile: true });

      expect(await source.load()).toEqual({});
    });

    it('throws when the file is missing and ignoreMissingFile is false', async () => {
      const source = new AppConfigSourceFileTest(testFile, { ignoreMissingFile: false });

      await expect(source.load()).rejects.toThrow();
    });
  });

  describe('encoding option', () => {
    it('reads the file using the configured encoding before handing text to parse', async () => {
      // Latin-1 byte 0xE9 is "é"; reading it as latin1 yields that char, which the parse hook preserves.
      writeFileSync(testFile, Buffer.from('name=caf\xe9', 'latin1'));
      const source = new AppConfigSourceFileTest(testFile, { encoding: 'latin1' });

      const config = await source.load();

      expect(config).toEqual({ name: 'café' });
    });

    it('defaults to utf8 when no encoding is supplied', async () => {
      writeFileSync(testFile, 'name=café', 'utf8');
      const source = new AppConfigSourceFileTest(testFile);

      const config = await source.load();

      expect(config).toEqual({ name: 'café' });
    });
  });

  describe('get()', () => {
    it('reads fresh from disk on every call when load() was never invoked', async () => {
      writeFileSync(testFile, 'a=1', 'utf8');
      const source = new AppConfigSourceFileTest(testFile);

      expect(await source.get('a')).toBe('1');
      writeFileSync(testFile, 'a=2', 'utf8');
      expect(await source.get('a')).toBe('2');
      expect(source.parseCalls).toHaveLength(2); // no cache → one parse per get
    });

    it('returns undefined for an absent path', async () => {
      writeFileSync(testFile, 'a=1', 'utf8');
      const source = new AppConfigSourceFileTest(testFile);

      expect(await source.get('missing')).toBeUndefined();
    });

    it('returns undefined for a missing tolerated file', async () => {
      const source = new AppConfigSourceFileTest(testFile);

      expect(await source.get('anything')).toBeUndefined();
    });
  });
});
