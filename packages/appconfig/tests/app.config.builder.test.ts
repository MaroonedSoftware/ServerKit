import { describe, it, expect, vi } from 'vitest';
import { AppConfigBuilder } from '../src/app.config.builder.js';
import { AppConfigSource } from '../src/app.config.source.js';
import { AppConfigProvider } from '../src/app.config.provider.js';
import { ObjectVisitorMeta } from '../src/object.visitor.js';

describe('AppConfigBuilder', () => {
  describe('addSource()', () => {
    it('should add a source and return the builder for chaining', () => {
      const builder = new AppConfigBuilder();
      const source: AppConfigSource = {
        load: vi.fn().mockResolvedValue({}),
      };
      const result = builder.addSource(source);
      expect(result).toBe(builder);
    });

    it('should allow chaining multiple sources', () => {
      const builder = new AppConfigBuilder();
      const source1: AppConfigSource = {
        load: vi.fn().mockResolvedValue({ key1: 'value1' }),
      };
      const source2: AppConfigSource = {
        load: vi.fn().mockResolvedValue({ key2: 'value2' }),
      };
      builder.addSource(source1).addSource(source2);
      expect(builder).toBeInstanceOf(AppConfigBuilder);
    });
  });

  describe('addProvider()', () => {
    it('should add a provider and return the builder for chaining', () => {
      const builder = new AppConfigBuilder();
      const provider: AppConfigProvider = {
        canParse: vi.fn().mockReturnValue(false),
        parse: vi.fn().mockResolvedValue(undefined),
      };
      const result = builder.addProvider(provider);
      expect(result).toBe(builder);
    });

    it('should allow chaining multiple providers', () => {
      const builder = new AppConfigBuilder();
      const provider1: AppConfigProvider = {
        canParse: vi.fn().mockReturnValue(false),
        parse: vi.fn().mockResolvedValue(undefined),
      };
      const provider2: AppConfigProvider = {
        canParse: vi.fn().mockReturnValue(false),
        parse: vi.fn().mockResolvedValue(undefined),
      };
      builder.addProvider(provider1).addProvider(provider2);
      expect(builder).toBeInstanceOf(AppConfigBuilder);
    });
  });

  describe('build()', () => {
    it('should build config from a single source', async () => {
      const builder = new AppConfigBuilder();
      const source: AppConfigSource = {
        load: vi.fn().mockResolvedValue({ key: 'value' }),
      };
      builder.addSource(source);
      const config = await builder.build();
      expect(config.get('key')).toBe('value');
    });

    it('should merge multiple sources', async () => {
      const builder = new AppConfigBuilder();
      const source1: AppConfigSource = {
        load: vi.fn().mockResolvedValue({ key1: 'value1', shared: 'source1' }),
      };
      const source2: AppConfigSource = {
        load: vi.fn().mockResolvedValue({ key2: 'value2', shared: 'source2' }),
      };
      builder.addSource(source1).addSource(source2);
      const config = await builder.build();
      expect(config.get('key1')).toBe('value1');
      expect(config.get('key2')).toBe('value2');
      // Later sources should override earlier ones
      expect(config.get('shared')).toBe('source2');
    });

    it('should handle nested object merging', async () => {
      const builder = new AppConfigBuilder();
      const source1: AppConfigSource = {
        load: vi.fn().mockResolvedValue({
          database: {
            host: 'localhost',
            port: 5432,
          },
        }),
      };
      const source2: AppConfigSource = {
        load: vi.fn().mockResolvedValue({
          database: {
            port: 3306,
            name: 'mydb',
          },
        }),
      };
      builder.addSource(source1).addSource(source2);
      const config = await builder.build();
      const database = config.get('database') as Record<string, unknown>;
      expect(database.host).toBe('localhost');
      expect(database.port).toBe(3306);
      expect(database.name).toBe('mydb');
    });

    it('should apply providers to string values', async () => {
      const builder = new AppConfigBuilder();
      const source: AppConfigSource = {
        load: vi.fn().mockResolvedValue({
          value: 'env:TEST_KEY',
        }),
      };
      const provider: AppConfigProvider = {
        canParse: vi.fn((value: string) => value.startsWith('env:')),
        parse: vi.fn(async (value: string, meta: ObjectVisitorMeta) => {
          const key = value.slice(4);
          meta.owner[meta.propertyPath] = `resolved_${key}`;
        }),
      };
      builder.addSource(source).addProvider(provider);
      const config = await builder.build();
      expect(config.get('value')).toBe('resolved_TEST_KEY');
      expect(provider.canParse).toHaveBeenCalledWith('env:TEST_KEY');
      expect(provider.parse).toHaveBeenCalled();
    });

    it('should apply providers to nested string values', async () => {
      const builder = new AppConfigBuilder();
      const source: AppConfigSource = {
        load: vi.fn().mockResolvedValue({
          database: {
            host: 'env:DB_HOST',
            port: 5432,
          },
        }),
      };
      const provider: AppConfigProvider = {
        canParse: vi.fn((value: string) => value.startsWith('env:')),
        parse: vi.fn(async (value: string, meta: ObjectVisitorMeta) => {
          const key = value.slice(4);
          meta.owner[meta.propertyPath] = `resolved_${key}`;
        }),
      };
      builder.addSource(source).addProvider(provider);
      const config = await builder.build();
      const database = config.get('database') as Record<string, unknown>;
      expect(database.host).toBe('resolved_DB_HOST');
      expect(database.port).toBe(5432);
    });

    it('should apply providers to array string values', async () => {
      const builder = new AppConfigBuilder();
      const source: AppConfigSource = {
        load: vi.fn().mockResolvedValue({
          items: ['env:ITEM1', 'env:ITEM2', 'static'],
        }),
      };
      const provider: AppConfigProvider = {
        canParse: vi.fn((value: string) => value.startsWith('env:')),
        parse: vi.fn(async (value: string, meta: ObjectVisitorMeta) => {
          const key = value.slice(4);
          // For arrays, we need to extract the index from propertyPath
          // propertyPath will be like 'items[0]', so we need to parse it
          if (Array.isArray(meta.owner) && meta.arrayIndex !== undefined) {
            meta.owner[meta.arrayIndex] = `resolved_${key}`;
          } else {
            // For objects, use propertyPath directly
            (meta.owner as Record<string, unknown>)[meta.propertyPath] = `resolved_${key}`;
          }
        }),
      };
      builder.addSource(source).addProvider(provider);
      const config = await builder.build();
      const items = config.get('items') as string[];
      expect(items[0]).toBe('resolved_ITEM1');
      expect(items[1]).toBe('resolved_ITEM2');
      expect(items[2]).toBe('static');
    });

    it('should use first matching provider', async () => {
      const builder = new AppConfigBuilder();
      const source: AppConfigSource = {
        load: vi.fn().mockResolvedValue({
          value: 'env:TEST',
        }),
      };
      const provider1: AppConfigProvider = {
        canParse: vi.fn((value: string) => value.startsWith('env:')),
        parse: vi.fn(async (value: string, meta: ObjectVisitorMeta) => {
          meta.owner[meta.propertyPath] = 'provider1';
        }),
      };
      const provider2: AppConfigProvider = {
        canParse: vi.fn((value: string) => value.startsWith('env:')),
        parse: vi.fn(async (value: string, meta: ObjectVisitorMeta) => {
          meta.owner[meta.propertyPath] = 'provider2';
        }),
      };
      builder.addSource(source).addProvider(provider1).addProvider(provider2);
      const config = await builder.build();
      expect(config.get('value')).toBe('provider1');
      expect(provider1.parse).toHaveBeenCalled();
      expect(provider2.parse).not.toHaveBeenCalled();
    });

    it('should not apply providers to non-string values', async () => {
      const builder = new AppConfigBuilder();
      const source: AppConfigSource = {
        load: vi.fn().mockResolvedValue({
          number: 42,
          boolean: true,
          nullValue: null,
        }),
      };
      const provider: AppConfigProvider = {
        canParse: vi.fn().mockReturnValue(true),
        parse: vi.fn().mockResolvedValue(undefined),
      };
      builder.addSource(source).addProvider(provider);
      const config = await builder.build();
      expect(config.get('number')).toBe(42);
      expect(config.get('boolean')).toBe(true);
      expect(provider.parse).not.toHaveBeenCalled();
    });

    it('should handle empty sources', async () => {
      const builder = new AppConfigBuilder();
      const source: AppConfigSource = {
        load: vi.fn().mockResolvedValue({}),
      };
      builder.addSource(source);
      const config = await builder.build();
      expect(config).toBeInstanceOf(Object);
    });

    it('should handle no sources', async () => {
      const builder = new AppConfigBuilder();
      const config = await builder.build();
      expect(config).toBeInstanceOf(Object);
    });

    it('should handle async source loading', async () => {
      const builder = new AppConfigBuilder();
      const source: AppConfigSource = {
        load: vi.fn().mockImplementation(() => {
          return new Promise(resolve => {
            setTimeout(() => resolve({ key: 'value' }), 10);
          });
        }),
      };
      builder.addSource(source);
      const config = await builder.build();
      expect(config.get('key')).toBe('value');
    });

    it('should handle async provider parsing', async () => {
      const builder = new AppConfigBuilder();
      const source: AppConfigSource = {
        load: vi.fn().mockResolvedValue({
          value: 'env:TEST',
        }),
      };
      const provider: AppConfigProvider = {
        canParse: vi.fn().mockReturnValue(true),
        parse: vi.fn().mockImplementation(async (value: string, meta: ObjectVisitorMeta) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          meta.owner[meta.propertyPath] = 'resolved';
        }),
      };
      builder.addSource(source).addProvider(provider);
      const config = await builder.build();
      expect(config.get('value')).toBe('resolved');
    });
  });
});
