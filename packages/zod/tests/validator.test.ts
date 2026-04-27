import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { HttpError } from '@maroonedsoftware/errors';
import { parseAndValidate } from '../src/validator.js';

describe('parseAndValidate', () => {
  it('should return parsed data for valid input', async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = await parseAndValidate({ name: 'Alice', age: 30 }, schema);
    expect(result).toEqual({ name: 'Alice', age: 30 });
  });

  it('should throw HttpError 400 for invalid input', async () => {
    const schema = z.object({ name: z.string() });
    await expect(parseAndValidate({ name: 123 }, schema)).rejects.toBeInstanceOf(HttpError);

    try {
      await parseAndValidate({ name: 123 }, schema);
    } catch (err) {
      expect((err as HttpError).statusCode).toBe(400);
    }
  });

  it('should include field-level error details', async () => {
    const schema = z.object({ email: z.string().email() });
    try {
      await parseAndValidate({ email: 'not-an-email' }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).details).toHaveProperty('email');
    }
  });

  it('should include multiple field errors', async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    try {
      await parseAndValidate({ name: 123, age: 'old' }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const details = (err as HttpError).details!;
      expect(details).toHaveProperty('name');
      expect(details).toHaveProperty('age');
    }
  });

  it('should accumulate multiple errors on the same field as an array', async () => {
    const schema = z.object({
      value: z.string().superRefine((val, ctx) => {
        ctx.addIssue({ code: 'custom', message: 'Error one' });
        ctx.addIssue({ code: 'custom', message: 'Error two' });
      }),
    });
    try {
      await parseAndValidate({ value: 'hi' }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const details = (err as HttpError).details!;
      expect(Array.isArray(details['value'])).toBe(true);
      expect(details['value']).toEqual(['Error one', 'Error two']);
    }
  });

  it('should map unrecognized keys to details', async () => {
    const schema = z.strictObject({ name: z.string() });
    try {
      await parseAndValidate({ name: 'Alice', extra: 'field' }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const details = (err as HttpError).details!;
      expect(details).toHaveProperty('extra', 'Unrecognized key');
    }
  });

  it('should use _root key for root-level errors', async () => {
    const schema = z.string();
    try {
      await parseAndValidate(123, schema);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const details = (err as HttpError).details!;
      expect(details).toHaveProperty('_root');
    }
  });

  it('should handle enum validation errors', async () => {
    const schema = z.object({ role: z.enum(['admin', 'user']) });
    try {
      await parseAndValidate({ role: 'guest' }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const details = (err as HttpError).details!;
      expect(details['role']).toBe("Expected one of 'admin, user'");
    }
  });

  it('should format invalid_type errors with the expected type', async () => {
    const schema = z.object({ name: z.string() });
    try {
      await parseAndValidate({ name: 123 }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['name']).toBe('Expected string');
    }
  });

  it('should format too_big with inclusive maximum', async () => {
    const schema = z.object({ age: z.number().max(10) });
    try {
      await parseAndValidate({ age: 100 }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['age']).toBe('Must be at most 10');
    }
  });

  it('should format too_big with exclusive maximum', async () => {
    const schema = z.object({ age: z.number().lt(10) });
    try {
      await parseAndValidate({ age: 100 }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['age']).toBe('Must be less than 10');
    }
  });

  it('should format too_small with inclusive minimum', async () => {
    const schema = z.object({ age: z.number().min(0) });
    try {
      await parseAndValidate({ age: -1 }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['age']).toBe('Must be at least 0');
    }
  });

  it('should format too_small with exclusive minimum', async () => {
    const schema = z.object({ age: z.number().gt(0) });
    try {
      await parseAndValidate({ age: 0 }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['age']).toBe('Must be greater than 0');
    }
  });

  it('should format invalid_format errors with the format name', async () => {
    const schema = z.object({ email: z.string().email() });
    try {
      await parseAndValidate({ email: 'not-an-email' }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['email']).toBe('Invalid email');
    }
  });

  it('should format not_multiple_of errors with the divisor', async () => {
    const schema = z.object({ count: z.number().multipleOf(5) });
    try {
      await parseAndValidate({ count: 7 }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['count']).toBe('Must be a multiple of 5');
    }
  });

  it('should format custom errors using their message', async () => {
    const schema = z.object({
      value: z.string().refine(() => false, { message: 'Custom failure' }),
    });
    try {
      await parseAndValidate({ value: 'anything' }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['value']).toBe('Custom failure');
    }
  });

  it('should recurse invalid_union into each branch with combined paths', async () => {
    const schema = z.object({
      value: z.union([z.object({ kind: z.literal('a'), n: z.number() }), z.object({ kind: z.literal('b'), s: z.string() })]),
    });
    try {
      await parseAndValidate({ value: { kind: 'a', n: 'oops' } }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['value.n']).toBe('Expected number');
      expect(details['value.kind']).toBe("Expected one of 'b'");
    }
  });

  it('should use the issue message when invalid_union has no branch errors', async () => {
    const schema = z.object({
      value: z.string().superRefine((_val, ctx) => {
        ctx.addIssue({ code: 'invalid_union', errors: [], message: 'No matching variant' });
      }),
    });
    try {
      await parseAndValidate({ value: 'anything' }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['value']).toBe('No matching variant');
    }
  });

  it('should deduplicate identical messages from union branches', async () => {
    const schema = z.object({
      value: z.union([z.object({ id: z.string() }), z.object({ id: z.string(), extra: z.number() })]),
    });
    try {
      await parseAndValidate({ value: { id: 123 } }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['value.id']).toBe('Expected string');
    }
  });

  it('should recurse invalid_key for record key validation', async () => {
    const schema = z.object({ map: z.record(z.string().regex(/^[a-z]+$/), z.number()) });
    try {
      await parseAndValidate({ map: { '123': 1 } }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(Object.keys(details).some(k => k.startsWith('map'))).toBe(true);
    }
  });

  it('should recurse invalid_element for set element validation', async () => {
    const schema = z.object({ tags: z.set(z.string()) });
    try {
      await parseAndValidate({ tags: new Set([1, 2]) }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(Object.keys(details).some(k => k.startsWith('tags'))).toBe(true);
    }
  });

  it('should apply schema transforms on success', async () => {
    const schema = z.object({ id: z.string().transform(s => parseInt(s, 10)) });
    const result = await parseAndValidate({ id: '42' }, schema);
    expect(result.id).toBe(42);
  });
});
