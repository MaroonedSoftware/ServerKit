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

The examples below validate a request payload. On Koa that is `ctx.parsedBody`, populated by the
route's `bodyParserMiddleware`; Koa's own `ctx.request.body` is never populated by ServerKit, so a
route that reads it hands `undefined` to `parseAndValidate` and gets a 400 listing every field as
missing. On Fastify it is the ordinary `request.body`, populated by `bodyParserPlugin` for the
content types the route declares in its `config.body`, and
[`@maroonedsoftware/fastify/zod`](../fastify/README.md) can run the schema as the route's schema
instead of in the handler.

```typescript
router.post('/users', bodyParserMiddleware(['application/json']), async ctx => {
  const body = await parseAndValidate(ctx.parsedBody, CreateUser);
  ctx.body = await users.create(body);
});
```

## API Reference

### `parseAndValidate(data, schema, statusCode?)`

Parses and validates `data` against a Zod schema, returning the typed result on success.

On failure, throws an `HttpError` — `400` by default, or `statusCode` when supplied — carrying a map of field paths to human-readable error messages. Field paths use dot notation (e.g. `"user.email"`). Root-level errors are keyed as `"_root"`. When a field has multiple violations, the value is a string array.

Where that map lands depends on the status. Below `500` it goes on `details`, which `errorMiddleware` renders into the response body. At `500` and above it goes on `internalDetails` instead, which is logged but never sent to a client — a server-side failure should not tell the caller which of its own fields the server disagreed with, so a 5xx response body carries no `details` at all.

```typescript
const body = await parseAndValidate(
  ctx.parsedBody,
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
- `statusCode` - Optional status for the thrown `HttpError`. Defaults to `400`; pass e.g. `422` when the payload is syntactically fine but semantically rejected. A value `>= 500` also diverts the field map from `details` to `internalDetails`.

```typescript
// Reject a well-formed but semantically invalid payload as 422 instead of 400
const body = await parseAndValidate(ctx.parsedBody, schema, 422);

// Validating something the client did not send — a failure is the server's fault, and the
// field map is logged rather than returned
const row = await parseAndValidate(upstreamPayload, schema, 502);
// thrown: statusCode 502, details undefined, internalDetails { ... }
```

**Returns:** `Promise<z.infer<T>>` — the parsed and transformed output.

**Throws:** `HttpError` with `statusCode` (default `400`), carrying the field map on `details` below `500` and on `internalDetails` at `500` and above.

---

### `zodErrorDetails(error)`

Flattens a `ZodError` into the same field map `parseAndValidate` attaches to the error it throws:
dot-notation paths to messages, `'_root'` for root-level issues, and an array when one field has
several violations.

Use it when the schema has already been run and only the formatting is needed, which is what a
synchronous validator has to do. `@maroonedsoftware/fastify/zod` builds Fastify's validator
compiler on it, so a schema failure there renders exactly as one from `parseAndValidate`.

```typescript
const result = CreateInvoice.safeParse(input);
if (!result.success) {
  throw httpError(400).withDetails(zodErrorDetails(result.error));
}
```

**Parameters**

- `error` - The Zod error to format.

### `parseAndValidateArray(data, schema, statusCode?)`

Parses and validates every element of `data` against a Zod schema, returning the typed array on success. `schema` describes a single **element**, not the array.

Error handling matches `parseAndValidate`, with detail keys prefixed by the element index. A `data` that is not an array fails with a `"_root"` detail, so an unexpected request body shape stays a client error rather than becoming a 500.

```typescript
const users = await parseAndValidateArray(
  ctx.parsedBody,
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
- `statusCode` - Optional status for the thrown `HttpError`. Defaults to `400`. Applies to a non-array input as well as to element-level failures, and a value `>= 500` diverts the field map to `internalDetails` exactly as in `parseAndValidate`.

**Returns:** `Promise<z.infer<T>[]>` — the parsed and transformed elements, in input order.

**Throws:** `HttpError` with `statusCode` (default `400`), carrying the index-prefixed field map on `details` below `500` and on `internalDetails` at `500` and above.

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

---

### `compileSerializer(schema, options?)` — `@maroonedsoftware/zod/serializer`

Compiles a Zod schema into a `fast-json-stringify` serializer for the schema's **output** type — straight-line string building specialized to the schema's exact shape, typically 2-3× faster than `JSON.stringify`'s generic walk. This is the same technique Fastify uses for response serialization. Requires the optional peer dependency `fast-json-stringify`:

```bash
pnpm add fast-json-stringify
```

Compile once at startup and reuse the returned function; compilation is expensive. Pair with `sendJson` from `@maroonedsoftware/koa` to write the result with the correct content type:

```typescript
import { compileSerializer } from '@maroonedsoftware/zod/serializer';

const serializeUser = compileSerializer(User);

router.get('/users/:id', async ctx => {
  const user = await service.getById(ctx.params.id);
  sendJson(ctx, serializeUser(user));
});
```

**The returned function performs no validation.** A non-conforming value is silently coerced or has unknown properties dropped — only serialize values that came out of the schema or are otherwise known-conforming.

Schema nodes with no JSON Schema equivalent — transforms, `z.custom` (including Luxon `DateTime` customs), `z.date`, `z.bigint` — throw at compile time rather than serializing wrongly at request time. Model output datetimes as `z.iso.datetime()` strings, or map the node yourself with `options.override`; `options.unrepresentable: 'any'` accepts them as unconstrained values at your own risk.

## License

MIT — see [LICENSE](./LICENSE).
