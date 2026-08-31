import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { HttpError } from '@maroonedsoftware/errors';
import { parseAndValidate, parseAndValidateArray } from '../src/validator.js';

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

  it('never yields an undefined detail value for an unhandled issue code', async () => {
    // The default branch of describeIssue returns issue.message; for an issue code it does
    // not explicitly handle this could be undefined, violating the
    // Record<string, string | string[]> contract. Assert every detail value is a defined
    // string (or string[]) regardless of code.
    const schema = z.object({
      value: z.string().superRefine((_val, ctx) => {
        ctx.addIssue({ code: 'unknown_future_code', path: [] } as never);
      }),
    });
    try {
      await parseAndValidate({ value: 'anything' }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      const values = Object.values(details);
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) {
        expect(v).not.toBeUndefined();
        expect(typeof v === 'string' || Array.isArray(v)).toBe(true);
      }
    }
  });

  it('should apply schema transforms on success', async () => {
    const schema = z.object({ id: z.string().transform(s => parseInt(s, 10)) });
    const result = await parseAndValidate({ id: '42' }, schema);
    expect(result.id).toBe(42);
  });

  it('should throw with the supplied status code instead of 400', async () => {
    const schema = z.object({ name: z.string() });
    try {
      await parseAndValidate({ name: 123 }, schema, 422);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(422);
    }
  });

  it('should keep field-level details when a status code is supplied', async () => {
    const schema = z.object({ email: z.string().email() });
    try {
      await parseAndValidate({ email: 'not-an-email' }, schema, 422);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as HttpError).statusCode).toBe(422);
      expect((err as HttpError).details).toHaveProperty('email', 'Invalid email');
    }
  });

  it('should default to 400 when no status code is supplied', async () => {
    const schema = z.object({ name: z.string() });
    try {
      await parseAndValidate({ name: 123 }, schema);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as HttpError).statusCode).toBe(400);
    }
  });

  it('should ignore the status code on success', async () => {
    const schema = z.object({ name: z.string() });
    const result = await parseAndValidate({ name: 'Alice' }, schema, 422);
    expect(result).toEqual({ name: 'Alice' });
  });
});

describe('parseAndValidateArray', () => {
  const userSchema = z.object({ email: z.string().email(), age: z.number().min(0) });

  it('should return every parsed element for a valid array', async () => {
    const result = await parseAndValidateArray(
      [
        { email: 'a@example.com', age: 30 },
        { email: 'b@example.com', age: 40 },
      ],
      userSchema,
    );
    expect(result).toEqual([
      { email: 'a@example.com', age: 30 },
      { email: 'b@example.com', age: 40 },
    ]);
  });

  it('should preserve input order', async () => {
    const result = await parseAndValidateArray(['c', 'a', 'b'], z.string());
    expect(result).toEqual(['c', 'a', 'b']);
  });

  it('should return an empty array for an empty input', async () => {
    const result = await parseAndValidateArray([], userSchema);
    expect(result).toEqual([]);
  });

  it('should validate each element against the schema, not the array itself', async () => {
    const result = await parseAndValidateArray(['x', 'y'], z.string());
    expect(result).toEqual(['x', 'y']);
  });

  it('should apply schema transforms to every element', async () => {
    const schema = z.object({ id: z.string().transform(s => parseInt(s, 10)) });
    const result = await parseAndValidateArray([{ id: '42' }, { id: '7' }], schema);
    expect(result).toEqual([{ id: 42 }, { id: 7 }]);
  });

  it('should throw HttpError 400 when an element is invalid', async () => {
    const promise = parseAndValidateArray([{ email: 'nope', age: 30 }], userSchema);
    await expect(promise).rejects.toBeInstanceOf(HttpError);

    try {
      await parseAndValidateArray([{ email: 'nope', age: 30 }], userSchema);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as HttpError).statusCode).toBe(400);
    }
  });

  it('should prefix detail keys with the failing element index', async () => {
    try {
      await parseAndValidateArray(
        [
          { email: 'a@example.com', age: 30 },
          { email: 'not-an-email', age: 40 },
        ],
        userSchema,
      );
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details).toEqual({ '1.email': 'Invalid email' });
    }
  });

  it('should report violations from every failing element, not just the first', async () => {
    try {
      await parseAndValidateArray(
        [
          { email: 'a@example.com', age: 30 },
          { email: 'bad', age: 40 },
          { email: 'c@example.com', age: -1 },
        ],
        userSchema,
      );
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['1.email']).toBe('Invalid email');
      expect(details['2.age']).toBe('Must be at least 0');
    }
  });

  it('should report every violation within a single element', async () => {
    try {
      await parseAndValidateArray([{ email: 'bad', age: -1 }], userSchema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['0.email']).toBe('Invalid email');
      expect(details['0.age']).toBe('Must be at least 0');
    }
  });

  it('should key errors by bare index for a primitive element schema', async () => {
    try {
      await parseAndValidateArray(['ok', 123], z.string());
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['1']).toBe('Expected string');
    }
  });

  it('should accumulate multiple messages on one element field as an array', async () => {
    const schema = z.object({
      value: z.string().superRefine((_val, ctx) => {
        ctx.addIssue({ code: 'custom', message: 'Error one' });
        ctx.addIssue({ code: 'custom', message: 'Error two' });
      }),
    });
    try {
      await parseAndValidateArray([{ value: 'hi' }], schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['0.value']).toEqual(['Error one', 'Error two']);
    }
  });

  it('should reject a non-array input as a 400 rather than throwing a TypeError', async () => {
    try {
      await parseAndValidateArray({ email: 'a@example.com', age: 30 }, userSchema);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(400);
      expect((err as HttpError).details).toHaveProperty('_root', 'Expected array');
    }
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not-an-array'],
    ['a number', 42],
  ])('should reject %s as a 400', async (_label, input) => {
    try {
      await parseAndValidateArray(input, userSchema);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(400);
      expect((err as HttpError).details).toHaveProperty('_root');
    }
  });

  it('should report enum violations with the allowed values', async () => {
    const schema = z.object({ role: z.enum(['admin', 'user']) });
    try {
      await parseAndValidateArray([{ role: 'admin' }, { role: 'guest' }], schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['1.role']).toBe("Expected one of 'admin, user'");
    }
  });

  it('should report nested paths within an element', async () => {
    const schema = z.object({ user: z.object({ email: z.string() }) });
    try {
      await parseAndValidateArray([{ user: { email: 123 } }], schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['0.user.email']).toBe('Expected string');
    }
  });

  it('should support async refinements and report every element regardless of resolution order', async () => {
    // A Promise.all-per-element implementation surfaces whichever element rejects first in wall
    // clock time, silently dropping the others. The slow element must still be reported here.
    const schema = z.string().superRefine(async (val, ctx) => {
      await new Promise(resolve => setTimeout(resolve, val === 'slow' ? 30 : 1));
      ctx.addIssue({ code: 'custom', message: `bad:${val}` });
    });
    try {
      await parseAndValidateArray(['slow', 'fast'], schema);
      expect.fail('should have thrown');
    } catch (err) {
      const details = (err as HttpError).details!;
      expect(details['0']).toBe('bad:slow');
      expect(details['1']).toBe('bad:fast');
    }
  });

  it('should resolve async refinements that pass', async () => {
    const schema = z.string().refine(async val => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return val.length > 1;
    });
    const result = await parseAndValidateArray(['ok', 'fine'], schema);
    expect(result).toEqual(['ok', 'fine']);
  });

  it('should throw an element failure with the supplied status code', async () => {
    try {
      await parseAndValidateArray([{ email: 'nope', age: 30 }], userSchema, 422);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(422);
      expect((err as HttpError).details).toHaveProperty('0.email', 'Invalid email');
    }
  });

  it('should apply the supplied status code to a non-array input', async () => {
    try {
      await parseAndValidateArray('not-an-array', userSchema, 422);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(422);
      expect((err as HttpError).details).toHaveProperty('_root', 'Expected array');
    }
  });

  it('should ignore the status code on success', async () => {
    const result = await parseAndValidateArray([{ email: 'a@example.com', age: 30 }], userSchema, 422);
    expect(result).toEqual([{ email: 'a@example.com', age: 30 }]);
  });
});
