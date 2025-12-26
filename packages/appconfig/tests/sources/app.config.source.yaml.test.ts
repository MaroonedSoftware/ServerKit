import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { AppConfigSourceYaml } from '../../src/sources/app.config.source.yaml.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('AppConfigSourceYaml', () => {
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `appconfig-yaml-test-${Date.now()}`);
    testFile = join(testDir, 'config.yaml');
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
      const source = new AppConfigSourceYaml(testFile);
      expect(source).toBeInstanceOf(AppConfigSourceYaml);
    });

    it('should create instance with file path and options', () => {
      const source = new AppConfigSourceYaml(testFile, {
        ignoreMissingFile: false,
        encoding: 'utf8',
      });
      expect(source).toBeInstanceOf(AppConfigSourceYaml);
    });

    it('should use default options when not provided', () => {
      const source = new AppConfigSourceYaml(testFile);
      // Defaults: ignoreMissingFile: true, encoding: 'utf8'
      expect(source).toBeInstanceOf(AppConfigSourceYaml);
    });
  });

  describe('load()', () => {
    it('should load YAML from file', async () => {
      const yamlContent = 'key: value\nnumber: 42';
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config).toEqual({ key: 'value', number: 42 });
    });

    it('should handle nested objects', async () => {
      const yamlContent = `database:
  host: localhost
  port: 5432`;
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config).toEqual({
        database: {
          host: 'localhost',
          port: 5432,
        },
      });
    });

    it('should handle arrays', async () => {
      const yamlContent = `items:
  - 1
  - 2
  - 3
tags:
  - a
  - b
  - c`;
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config).toEqual({
        items: [1, 2, 3],
        tags: ['a', 'b', 'c'],
      });
    });

    it('should return empty object when file does not exist and ignoreMissingFile is true', async () => {
      const source = new AppConfigSourceYaml(testFile, {
        ignoreMissingFile: true,
      });
      const config = await source.load();
      expect(config).toEqual({});
    });

    it('should throw error when file does not exist and ignoreMissingFile is false', async () => {
      const source = new AppConfigSourceYaml(testFile, {
        ignoreMissingFile: false,
      });
      await expect(source.load()).rejects.toThrow();
    });

    it('should handle different encodings', async () => {
      const yamlContent = 'key: value';
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile, { encoding: 'utf8' });
      const config = await source.load();
      expect(config).toEqual({ key: 'value' });
    });

    it('should throw error for invalid YAML', async () => {
      // Tabs are not allowed as indentation in YAML
      writeFileSync(testFile, 'key:\n\t- invalid', 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      await expect(source.load()).rejects.toThrow();
    });

    it('should handle empty YAML file', async () => {
      writeFileSync(testFile, '', 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config).toBeNull();
    });

    it('should handle YAML with only comments', async () => {
      writeFileSync(testFile, '# This is a comment\n# Another comment', 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config).toBeNull();
    });

    it('should handle YAML with null values', async () => {
      const yamlContent = 'key: null\nvalue: test';
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config).toEqual({ key: null, value: 'test' });
    });

    it('should handle YAML with boolean values', async () => {
      const yamlContent = 'enabled: true\ndisabled: false';
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config).toEqual({ enabled: true, disabled: false });
    });

    it('should handle YAML with numeric values', async () => {
      const yamlContent = 'integer: 42\nfloat: 3.14\nnegative: -10';
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config).toEqual({ integer: 42, float: 3.14, negative: -10 });
    });

    it('should handle complex nested structures', async () => {
      const yamlContent = `level1:
  level2:
    level3:
      value: deep
      array:
        - 1
        - 2
        - nested: object`;
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config).toEqual({
        level1: {
          level2: {
            level3: {
              value: 'deep',
              array: [1, 2, { nested: 'object' }],
            },
          },
        },
      });
    });

    it('should return a promise', () => {
      const source = new AppConfigSourceYaml(testFile);
      const result = source.load();
      expect(result).toBeInstanceOf(Promise);
    });

    it('should handle YAML multiline strings with literal block scalar', async () => {
      const yamlContent = `message: |
  This is a
  multiline string`;
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config.message).toBe('This is a\nmultiline string\n');
    });

    it('should handle YAML multiline strings with folded block scalar', async () => {
      const yamlContent = `message: >
  This is a
  folded string`;
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config.message).toBe('This is a folded string\n');
    });

    it('should handle YAML anchors and aliases', async () => {
      const yamlContent = `defaults: &defaults
  host: localhost
  port: 3000

development:
  name: dev
  settings: *defaults`;
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config).toEqual({
        defaults: { host: 'localhost', port: 3000 },
        development: { name: 'dev', settings: { host: 'localhost', port: 3000 } },
      });
    });

    it('should handle .yml extension', async () => {
      const ymlFile = join(testDir, 'config.yml');
      const yamlContent = 'key: value';
      writeFileSync(ymlFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(ymlFile);
      const config = await source.load();
      expect(config).toEqual({ key: 'value' });
      unlinkSync(ymlFile);
    });

    it('should handle inline arrays', async () => {
      const yamlContent = 'tags: [alpha, beta, gamma]';
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config).toEqual({ tags: ['alpha', 'beta', 'gamma'] });
    });

    it('should handle inline objects', async () => {
      const yamlContent = 'person: {name: John, age: 30}';
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config).toEqual({ person: { name: 'John', age: 30 } });
    });

    it('should handle quoted strings', async () => {
      const yamlContent = `single: 'single quoted'
double: "double quoted"
special: "value with: colon"`;
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      expect(config).toEqual({
        single: 'single quoted',
        double: 'double quoted',
        special: 'value with: colon',
      });
    });

    it('should handle date-like strings as strings', async () => {
      const yamlContent = 'date: 2024-01-15';
      writeFileSync(testFile, yamlContent, 'utf8');
      const source = new AppConfigSourceYaml(testFile);
      const config = await source.load();
      // yaml library parses date-like strings as strings by default
      expect(config.date).toBe('2024-01-15');
    });
  });
});

