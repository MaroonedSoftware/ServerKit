# @maroonedsoftware/zod

Zod utilities for ServerKit — schema validation with HTTP error integration and BigInt support.

## Installation

```bash
pnpm add @maroonedsoftware/zod
```

## Usage

```typescript
import { parseAndValidate, zBigint } from '@maroonedsoftware/zod';
```

## API Reference

### `parseAndValidate(data, schema)`

Parses and validates `data` against a Zod schema, returning the typed result on success.

On failure, throws an `HttpError` with status `400` whose `details` map field paths to human-readable error messages. Field paths use dot notation (e.g. `"user.email"`). Root-level errors are keyed as `"_root"`. When a field has multiple violations, the value is a string array.

```typescript
const body = await parseAndValidate(ctx.request.body, z.object({
  email: z.string().email(),
  age: z.number().min(0),
}));
// body is typed as { email: string; age: number }
```

**Error details shape:**

```typescript
// Single violation
{ email: 'Invalid email' }

// Multiple violations on one field
{ password: ['Must be at least 8', 'Invalid string: must match pattern /\\d/'] }

// Unrecognized key (z.strictObject)
{ extra: 'Unrecognized key' }

// Root-level error (non-object schema)
{ _root: 'Expected string' }
```

**Parameters:**

- `data` - The unknown input to validate.
- `schema` - The Zod schema to validate against.

**Returns:** `Promise<z.infer<T>>` — the parsed and transformed output.

**Throws:** `HttpError` 400 with field-level `details` when validation fails.

---

### `zBigint()`

A Zod schema that accepts a bigint string (e.g. `"100n"`) and transforms it to a native `bigint`. Use this instead of `z.bigint()` for JSON request/response schemas, since JSON cannot represent `bigint` natively.

Works with the `bigIntReplacer` / `bigIntReviver` utilities from `@maroonedsoftware/utilities` for end-to-end bigint serialization.

```typescript
const schema = z.object({ id: zBigint() });
const result = await schema.parseAsync({ id: '9007199254740993n' });
// result.id === 9007199254740993n
```

**Accepts:** strings matching `/^-?\d+n$/` (e.g. `"0n"`, `"123n"`, `"-42n"`).

**Rejects:** plain numbers, floats, bare number strings, non-string inputs.

## License

MIT
