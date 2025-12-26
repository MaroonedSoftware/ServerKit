import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { AppConfigSourceJson } from '../../src/sources/app.config.source.json.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('AppConfigSourceJson', () => {
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `appconfig-test-${Date.now()}`);
    testFile = join(testDir, 'config.json');
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

  describe('constructor', () => {
    it('should create instance with file path', () => {
      const source = new AppConfigSourceJson(testFile);
      expect(source).toBeInstanceOf(AppConfigSourceJson);
    });

    it('should create instance with file path and options', () => {
      const source = new AppConfigSourceJson(testFile, {
        ignoreMissingFile: false,
        encoding: 'utf8',
      });
      expect(source).toBeInstanceOf(AppConfigSourceJson);
    });

    it('should use default options when not provided', () => {
      const source = new AppConfigSourceJson(testFile);
      // Defaults: ignoreMissingFile: true, encoding: 'utf8'
      expect(source).toBeInstanceOf(AppConfigSourceJson);
    });
  });

  describe('load()', () => {
    it('should load JSON from file', async () => {
      const configData = { key: 'value', number: 42 };
      writeFileSync(testFile, JSON.stringify(configData), 'utf8');
      const source = new AppConfigSourceJson(testFile);
      const config = await source.load();
      expect(config).toEqual(configData);
    });

    it('should handle nested objects', async () => {
      const configData = {
        database: {
          host: 'localhost',
          port: 5432,
        },
      };
      writeFileSync(testFile, JSON.stringify(configData), 'utf8');
      const source = new AppConfigSourceJson(testFile);
      const config = await source.load();
      expect(config).toEqual(configData);
    });

    it('should handle arrays', async () => {
      const configData = {
        items: [1, 2, 3],
        tags: ['a', 'b', 'c'],
      };
      writeFileSync(testFile, JSON.stringify(configData), 'utf8');
      const source = new AppConfigSourceJson(testFile);
      const config = await source.load();
      expect(config).toEqual(configData);
    });

    it('should return empty object when file does not exist and ignoreMissingFile is true', async () => {
      const source = new AppConfigSourceJson(testFile, {
        ignoreMissingFile: true,
      });
      const config = await source.load();
      expect(config).toEqual({});
    });

    it('should throw error when file does not exist and ignoreMissingFile is false', async () => {
      const source = new AppConfigSourceJson(testFile, {
        ignoreMissingFile: false,
      });
      await expect(source.load()).rejects.toThrow();
    });

    it('should handle different encodings', async () => {
      const configData = { key: 'value' };
      writeFileSync(testFile, JSON.stringify(configData), 'utf8');
      const source = new AppConfigSourceJson(testFile, { encoding: 'utf8' });
      const config = await source.load();
      expect(config).toEqual(configData);
    });

    it('should throw error for invalid JSON', async () => {
      writeFileSync(testFile, '{ invalid json }', 'utf8');
      const source = new AppConfigSourceJson(testFile);
      await expect(source.load()).rejects.toThrow();
    });

    it('should handle empty JSON object', async () => {
      writeFileSync(testFile, '{}', 'utf8');
      const source = new AppConfigSourceJson(testFile);
      const config = await source.load();
      expect(config).toEqual({});
    });

    it('should handle empty JSON array', async () => {
      writeFileSync(testFile, '[]', 'utf8');
      const source = new AppConfigSourceJson(testFile);
      const config = await source.load();
      expect(config).toEqual([]);
    });

    it('should handle JSON with null values', async () => {
      const configData = { key: null, value: 'test' };
      writeFileSync(testFile, JSON.stringify(configData), 'utf8');
      const source = new AppConfigSourceJson(testFile);
      const config = await source.load();
      expect(config).toEqual(configData);
    });

    it('should handle JSON with boolean values', async () => {
      const configData = { enabled: true, disabled: false };
      writeFileSync(testFile, JSON.stringify(configData), 'utf8');
      const source = new AppConfigSourceJson(testFile);
      const config = await source.load();
      expect(config).toEqual(configData);
    });

    it('should handle JSON with numeric values', async () => {
      const configData = { integer: 42, float: 3.14, negative: -10 };
      writeFileSync(testFile, JSON.stringify(configData), 'utf8');
      const source = new AppConfigSourceJson(testFile);
      const config = await source.load();
      expect(config).toEqual(configData);
    });

    it('should handle complex nested structures', async () => {
      const configData = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
              array: [1, 2, { nested: 'object' }],
            },
          },
        },
      };
      writeFileSync(testFile, JSON.stringify(configData), 'utf8');
      const source = new AppConfigSourceJson(testFile);
      const config = await source.load();
      expect(config).toEqual(configData);
    });

    it('should return a promise', () => {
      const source = new AppConfigSourceJson(testFile);
      const result = source.load();
      expect(result).toBeInstanceOf(Promise);
    });
  });
});
