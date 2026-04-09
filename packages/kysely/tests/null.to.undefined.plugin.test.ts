import { describe, it, expect } from 'vitest';
import { NullToUndefinedPlugin } from '../src/plugins/null.to.undefined.plugin.js';
import type { PluginTransformQueryArgs, PluginTransformResultArgs } from 'kysely';

describe('NullToUndefinedPlugin', () => {
  const plugin = new NullToUndefinedPlugin();

  describe('transformQuery', () => {
    it('should return args.node unchanged', () => {
      const mockNode = { kind: 'SelectQueryNode' } as PluginTransformQueryArgs['node'];
      const args = { node: mockNode } as PluginTransformQueryArgs;
      const result = plugin.transformQuery(args);
      expect(result).toBe(mockNode);
    });
  });

  describe('transformResult', () => {
    it('should convert null values to undefined in rows', async () => {
      const args = {
        result: { rows: [{ a: null, b: 1, c: 'hello' }] },
      } as unknown as PluginTransformResultArgs;
      const result = await plugin.transformResult(args);
      expect(result.rows[0]).toEqual({ a: undefined, b: 1, c: 'hello' });
    });

    it('should preserve non-null values', async () => {
      const args = {
        result: { rows: [{ a: 1, b: 'hello', c: true }] },
      } as unknown as PluginTransformResultArgs;
      const result = await plugin.transformResult(args);
      expect(result.rows[0]).toEqual({ a: 1, b: 'hello', c: true });
    });

    it('should handle empty rows array', async () => {
      const args = {
        result: { rows: [] },
      } as unknown as PluginTransformResultArgs;
      const result = await plugin.transformResult(args);
      expect(result.rows).toEqual([]);
    });

    it('should handle multiple rows', async () => {
      const args = {
        result: {
          rows: [
            { a: null, b: 1 },
            { a: 2, b: null },
          ],
        },
      } as unknown as PluginTransformResultArgs;
      const result = await plugin.transformResult(args);
      expect(result.rows[0]).toEqual({ a: undefined, b: 1 });
      expect(result.rows[1]).toEqual({ a: 2, b: undefined });
    });

    it('should preserve other result properties alongside rows', async () => {
      const args = {
        result: {
          rows: [],
          insertId: BigInt(1),
          numAffectedRows: BigInt(0),
        },
      } as unknown as PluginTransformResultArgs;
      const result = await plugin.transformResult(args);
      expect((result as any).insertId).toBe(BigInt(1));
      expect((result as any).numAffectedRows).toBe(BigInt(0));
    });

    it('should convert all null fields in a row with mixed values', async () => {
      const args = {
        result: {
          rows: [{ id: 1, name: null, email: null, active: true }],
        },
      } as unknown as PluginTransformResultArgs;
      const result = await plugin.transformResult(args);
      expect(result.rows[0]).toEqual({ id: 1, name: undefined, email: undefined, active: true });
    });
  });
});
