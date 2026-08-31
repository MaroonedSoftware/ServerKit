# @maroonedsoftware/zod

Zod utilities for ServerKit — schema validation with HTTP error integration and BigInt support.

## Installation

```bash
pnpm add @maroonedsoftware/zod
```

## Usage

```typescript
import { parseAndValidate, parseAndValidateArray, zBigint } from '@maroonedsoftware/zod';
```

## API Reference

### `parseAndValidate(data, schema, statusCode?)`

Parses and validates `data` against a Zod schema, returning the typed result on success.

On failure, throws an `HttpError` — `400` by default, or `statusCode` when supplied — whose `details` map field paths to human-readable error messages. Field paths use dot notation (e.g. `"user.email"`). Root-level errors are keyed as `"_root"`. When a field has multiple violations, the value is a string array.

```typescript
const body = await parseAndValidate(
  ctx.request.body,
  z.object({
    email: z.string().email(),
    age: z.number().min(0),
  }),
);
// body is typed as { email: string; age: number }
```

**Error details shape:**

```typescript
// Single violation
{
  email: 'Invalid email';
}

// Multiple violations on one field
{
  password: ['Must be at least 8', 'Invalid string: must match pattern /\\d/'];
}

// Unrecognized key (z.strictObject)
{
  extra: 'Unrecognized key';
}

// Root-level error (non-object schema)
{
  _root: 'Expected string';
}
```

**Parameters:**

- `data` - The unknown input to validate.
- `schema` - The Zod schema to validate against.
- `statusCode` - Optional status for the thrown `HttpError`. Defaults to `400`; pass e.g. `422` when the payload is syntactically fine but semantically rejected.

```typescript
// Reject a well-formed but semantically invalid payload as 422 instead of 400
const body = await parseAndValidate(ctx.request.body, schema, 422);
```

**Returns:** `Promise<z.infer<T>>` — the parsed and transformed output.

**Throws:** `HttpError` with `statusCode` (default `400`) and field-level `details` when validation fails.

---

### `parseAndValidateArray(data, schema, statusCode?)`

Parses and validates every element of `data` against a Zod schema, returning the typed array on success. `schema` describes a single **element**, not the array.

Error handling matches `parseAndValidate`, with detail keys prefixed by the element index. A `data` that is not an array fails with a `"_root"` detail, so an unexpected request body shape stays a client error rather than becoming a 500.

```typescript
const users = await parseAndValidateArray(
  ctx.request.body,
  z.object({
    email: z.string().email(),
    age: z.number().min(0),
  }),
);
// users is typed as { email: string; age: number }[]
```

**Error details shape:**

```typescript
// Violations are reported across every failing element, not just the first
{
  '1.email': 'Invalid email',
  '2.age': 'Must be at least 0',
}

// Primitive element schema — keys are bare indices
{
  '1': 'Expected string';
}

// Input was not an array
{
  _root: 'Expected array';
}
```

**Parameters:**

- `data` - The unknown input to validate. Must be an array to pass.
- `schema` - The Zod schema each element is validated against.
- `statusCode` - Optional status for the thrown `HttpError`. Defaults to `400`. Applies to a non-array input as well as to element-level failures.

**Returns:** `Promise<z.infer<T>[]>` — the parsed and transformed elements, in input order.

**Throws:** `HttpError` with `statusCode` (default `400`) and index-prefixed `details` when validation fails.

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

MIT — see [LICENSE](./LICENSE).
