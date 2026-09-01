import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { compileSerializer } from '../src/serializer.js';

describe('compileSerializer', () => {
  const user = z.object({
    id: z.number().int(),
    name: z.string(),
    email: z.email().optional(),
    active: z.boolean(),
    role: z.enum(['admin', 'member']),
    tags: z.array(z.string()),
    nickname: z.string().nullable(),
  });

  it('round-trips a conforming value', () => {
    const serialize = compileSerializer(user);
    const value = { id: 1, name: 'Alice', email: 'a@example.com', active: true, role: 'member' as const, tags: ['a', 'b'], nickname: null };

    expect(JSON.parse(serialize(value))).toEqual(value);
  });

  it('omits an absent optional field', () => {
    const serialize = compileSerializer(user);
    const value = { id: 1, name: 'Alice', active: false, role: 'admin' as const, tags: [], nickname: 'Al' };

    const parsed = JSON.parse(serialize(value));
    expect(parsed).toEqual(value);
    expect('email' in parsed).toBe(false);
  });

  it('drops keys the schema does not declare', () => {
    // This documents the contract: the serializer validates nothing — a non-conforming value
    // is silently reshaped. Only serialize values that came out of the schema.
    const serialize = compileSerializer(z.object({ a: z.string() }));

    expect(serialize({ a: 'kept', b: 'dropped' } as never)).toBe('{"a":"kept"}');
  });

  it('serializes nested objects and arrays of objects', () => {
    const order = z.object({
      id: z.uuid(),
      lines: z.array(z.object({ sku: z.string(), quantity: z.number().int() })),
      shipping: z.object({ city: z.string(), country: z.string() }),
    });
    const serialize = compileSerializer(order);
    const value = {
      id: 'c8a7d0d8-3f3b-4b1a-9a6e-3a2d6a1a5e0f',
      lines: [
        { sku: 'A-1', quantity: 2 },
        { sku: 'B-2', quantity: 1 },
      ],
      shipping: { city: 'Wellington', country: 'NZ' },
    };

    expect(JSON.parse(serialize(value))).toEqual(value);
  });

  it('handles a reused registered sub-schema through draft-07 definitions', () => {
    // A schema referenced twice is extracted into `definitions` with `$ref`s under the
    // draft-07 target — the dialect fast-json-stringify expects.
    const point = z.object({ x: z.number(), y: z.number() }).meta({ id: 'Point' });
    const segment = z.object({ from: point, to: point });
    const serialize = compileSerializer(segment);
    const value = { from: { x: 0, y: 0 }, to: { x: 3, y: 4 } };

    expect(JSON.parse(serialize(value))).toEqual(value);
  });

  it('escapes strings correctly', () => {
    const serialize = compileSerializer(z.object({ s: z.string() }));
    const value = { s: 'quote " backslash \\ newline \n unicode  ' };

    expect(JSON.parse(serialize(value))).toEqual(value);
  });

  it('throws at compile time for a z.date field', () => {
    expect(() => compileSerializer(z.object({ at: z.date() }))).toThrow('Date cannot be represented in JSON Schema');
  });

  it('throws at compile time for a transform', () => {
    expect(() => compileSerializer(z.object({ t: z.string().transform(v => v.trim()) }))).toThrow(
      'Transforms cannot be represented in JSON Schema',
    );
  });

  it('throws at compile time for a z.custom field', () => {
    expect(() => compileSerializer(z.object({ c: z.custom<Date>(v => v instanceof Date) }))).toThrow(
      'Custom types cannot be represented in JSON Schema',
    );
  });

  it('compiles an otherwise-unrepresentable schema with unrepresentable: any', () => {
    const serialize = compileSerializer(z.object({ c: z.custom<string>(v => typeof v === 'string') }), { unrepresentable: 'any' });

    expect(JSON.parse(serialize({ c: 'passes through' }))).toEqual({ c: 'passes through' });
  });

  it('honours an override for a node the automatic conversion rejects', () => {
    const schema = z.object({ c: z.custom<string>(v => typeof v === 'string') });
    const serialize = compileSerializer(schema, {
      override: ctx => {
        if (ctx.zodSchema._zod.def.type === 'custom') {
          ctx.jsonSchema.type = 'string';
        }
      },
      unrepresentable: 'any',
    });

    expect(serialize({ c: 'typed as string' })).toBe('{"c":"typed as string"}');
  });

  it('returns a string, not a Buffer or object', () => {
    const serialize = compileSerializer(z.object({ n: z.number() }));

    expect(typeof serialize({ n: 42 })).toBe('string');
  });
});
