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
      expect(details).toHaveProperty('role');
    }
  });

  it('should apply schema transforms on success', async () => {
    const schema = z.object({ id: z.string().transform(s => parseInt(s, 10)) });
    const result = await parseAndValidate({ id: '42' }, schema);
    expect(result.id).toBe(42);
  });
});
