import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zBigint } from '../src/bigint.js';

describe('zBigint', () => {
  it('should parse a positive bigint string', async () => {
    const result = await zBigint().parseAsync('100n');
    expect(result).toBe(100n);
  });

  it('should parse a negative bigint string', async () => {
    const result = await zBigint().parseAsync('-42n');
    expect(result).toBe(-42n);
  });

  it('should parse zero bigint string', async () => {
    const result = await zBigint().parseAsync('0n');
    expect(result).toBe(0n);
  });

  it('should parse a large bigint string', async () => {
    const result = await zBigint().parseAsync('9007199254740993n');
    expect(result).toBe(9007199254740993n);
  });

  it('should reject a plain number string', async () => {
    await expect(zBigint().parseAsync('100')).rejects.toThrow();
  });

  it('should reject an empty string', async () => {
    await expect(zBigint().parseAsync('')).rejects.toThrow();
  });

  it('should reject a non-numeric string', async () => {
    await expect(zBigint().parseAsync('abc')).rejects.toThrow();
  });

  it('should reject a float string', async () => {
    await expect(zBigint().parseAsync('1.5n')).rejects.toThrow();
  });

  it('should reject a non-string input', async () => {
    await expect(zBigint().parseAsync(100)).rejects.toThrow();
    await expect(zBigint().parseAsync(null)).rejects.toThrow();
  });

  it('should be usable inside a zod object schema', async () => {
    const schema = z.object({ id: zBigint() });
    const result = await schema.parseAsync({ id: '123n' });
    expect(result.id).toBe(123n);
  });
});
