import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppConfigSourceDotenv } from '../../src/sources/app.config.source.dotenv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('AppConfigSourceDotenv', () => {
  const originalEnv = process.env;
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    testDir = join(__dirname, `.tmp-dotenv-test-${Date.now()}`);
    testFile = join(testDir, '.env');
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create instance without file path', () => {
      const source = new AppConfigSourceDotenv();
      expect(source).toBeInstanceOf(AppConfigSourceDotenv);
    });

    it('should create instance with file path', () => {
      const source = new AppConfigSourceDotenv('./.env');
      expect(source).toBeInstanceOf(AppConfigSourceDotenv);
    });
  });

  describe('load()', () => {
    it('should load environment variables from .env file', async () => {
      writeFileSync(testFile, 'TEST_KEY1=value1\nTEST_KEY2=value2\n', 'utf8');
      const source = new AppConfigSourceDotenv(testFile);
      const config = await source.load();
      expect(config.TEST_KEY1).toBe('value1');
      expect(config.TEST_KEY2).toBe('value2');
    });

    it('should return an object', async () => {
      writeFileSync(testFile, 'KEY=value\n', 'utf8');
      const source = new AppConfigSourceDotenv(testFile);
      const config = await source.load();
      expect(config).toBeInstanceOf(Object);
    });

    it('should handle empty .env file', async () => {
      writeFileSync(testFile, '', 'utf8');
      const source = new AppConfigSourceDotenv(testFile);
      const config = await source.load();
      expect(config).toEqual({});
    });

    it('should handle numeric string values', async () => {
      writeFileSync(testFile, 'PORT=3000\nTIMEOUT=5000\n', 'utf8');
      const source = new AppConfigSourceDotenv(testFile);
      const config = await source.load();
      expect(config.PORT).toBe('3000');
      expect(config.TIMEOUT).toBe('5000');
    });

    it('should handle boolean string values', async () => {
      writeFileSync(testFile, 'DEBUG=true\nPRODUCTION=false\n', 'utf8');
      const source = new AppConfigSourceDotenv(testFile);
      const config = await source.load();
      expect(config.DEBUG).toBe('true');
      expect(config.PRODUCTION).toBe('false');
    });

    it('should handle special characters in values', async () => {
      // Quote the value to prevent $ from being interpreted as variable reference
      writeFileSync(testFile, 'SPECIAL="value with spaces and !@#$%^&*()"\n', 'utf8');
      const source = new AppConfigSourceDotenv(testFile);
      const config = await source.load();
      expect(config.SPECIAL).toBe('value with spaces and !@#$%^&*()');
    });

    it('should handle quoted values', async () => {
      writeFileSync(testFile, 'QUOTED="quoted value"\nSINGLE=\'single quoted\'\n', 'utf8');
      const source = new AppConfigSourceDotenv(testFile);
      const config = await source.load();
      expect(config.QUOTED).toBe('quoted value');
      expect(config.SINGLE).toBe('single quoted');
    });

    it('should handle multiline values', async () => {
      writeFileSync(testFile, 'MULTILINE="line1\\nline2\\nline3"\n', 'utf8');
      const source = new AppConfigSourceDotenv(testFile);
      const config = await source.load();
      expect(config.MULTILINE).toContain('line1');
    });

    it('should throw error for non-existent file when path is provided', async () => {
      const source = new AppConfigSourceDotenv('./nonexistent.env');
      await expect(source.load()).rejects.toThrow();
    });

    it('should throw error when file does not exist and no path provided', async () => {
      // When no path is provided, dotenv looks for .env in cwd
      // If it doesn't exist, dotenv.config() returns an error which we throw
      const source = new AppConfigSourceDotenv();
      await expect(source.load()).rejects.toThrow();
    });

    it('should return a promise', () => {
      writeFileSync(testFile, 'KEY=value\n', 'utf8');
      const source = new AppConfigSourceDotenv(testFile);
      const result = source.load();
      expect(result).toBeInstanceOf(Promise);
    });
  });
});
