# AGENTS.md — @maroonedsoftware/zod

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Two things: a validate-or-throw bridge that turns a Zod parse failure into an `HttpError(400)` whose
`details` map dotted field paths to human-readable messages, and a `zBigint()` schema for carrying
bigints through JSON.

Reach for `parseAndValidate` at every request boundary. Do **not** use it for internal invariants —
a failure there is a 500, not a 400, and this always throws 400.

## Install

```bash
pnpm add @maroonedsoftware/zod zod
```

Runtime dependencies: `@maroonedsoftware/errors`, `zod` (v4).

## Position in the graph

- **Depends on:** `errors`.
- **Depended on by:** nothing internal. It is a leaf that applications use directly.
- **Subpath exports:** none. The package has no `exports` map at all.

## API surface

| Export                  | Kind     | Shape                                                                           | Notes                                                                       |
| ----------------------- | -------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `parseAndValidate`      | function | `<T extends ZodType>(data: unknown, schema: T) => Promise<z.infer<T>>`          | Uses `safeParseAsync`. Throws `httpError(400).withDetails(...)` on failure. |
| `parseAndValidateArray` | function | `<T extends ZodType>(data: unknown, schema: T) => Promise<z.infer<T>[]>`        | `schema` describes one **element**, not the array.                          |
| `zBigint`               | function | `() => ZodType` — a `z.string()` matching `/^-?\d+n$/`, transformed to `bigint` | Accepts `"100n"`, yields `100n`.                                            |

### Detail-key format

`details` is a `Record<string, string | string[]>`:

| Situation                               | Key                        | Value                       |
| --------------------------------------- | -------------------------- | --------------------------- |
| Nested field                            | dotted path (`user.email`) | message                     |
| Root-level failure                      | `_root`                    | message                     |
| Array element (`parseAndValidateArray`) | index-prefixed (`2.email`) | message                     |
| Multiple violations on one field        | that field's key           | `string[]`, deduplicated    |
| `z.strictObject` extra key              | the offending key itself   | `'Unrecognized key'`        |
| Enum violation                          | field key                  | `Expected one of 'a, b, c'` |

Messages are derived per issue code: `invalid_type` → `Expected <type>`, `too_big` / `too_small` →
`Must be at most/at least <n>` (or `less than` / `greater than` when exclusive), `invalid_format` →
`Invalid <format>`, `not_multiple_of` → `Must be a multiple of <n>`, anything else falls back to the
issue's own message or `'Invalid value'`. Union errors are flattened: every branch's issues land
under the same path.

## Canonical usage

```typescript
import { z } from 'zod';
import { parseAndValidate, parseAndValidateArray, zBigint } from '@maroonedsoftware/zod';

const CreateInvoice = z.strictObject({
  customerId: z.string().uuid(),
  amountCents: zBigint(),
  dueOn: z.iso.date(),
});

router.post('/invoices', bodyParserMiddleware(['application/json']), async ctx => {
  const body = await parseAndValidate(ctx.parsedBody, CreateInvoice);
  // body.amountCents is a bigint
  ctx.body = await invoices.create(body);
});

// Bulk endpoint — schema describes one element
const rows = await parseAndValidateArray(ctx.parsedBody, CreateInvoice);
```

A failure produces `400` with, for example,
`{ "customerId": "Invalid uuid", "1.amountCents": "Expected a bigint string (e.g. \"100n\")" }`.

## Rules for generated code

- Always `await`. Both functions are async because they use `safeParseAsync`; a forgotten `await`
  gives you a `Promise` that types as the parsed value only if you also ignore the return type.
- Pass the **element** schema to `parseAndValidateArray`. Wrapping it in `z.array()` yourself gives
  you an array-of-arrays schema.
- Use `z.strictObject` for request bodies so unexpected keys are reported rather than silently
  dropped.
- Use `zBigint()` in any JSON-facing schema that carries a bigint. `z.bigint()` cannot survive
  `JSON.parse`. Pair it with `bigIntReplacer` from `@maroonedsoftware/utilities` on the way out.
- Do not catch the thrown `HttpError` to reshape it. `errorMiddleware` already renders `details`.
- Do not use these for internal invariants or config validation — the 400 is baked in. Validate
  config with a plain `schema.parse` and let it throw at bootstrap.

## Gotchas

- **The status is always 400.** There is no option to change it. If you need a different status,
  call `schema.safeParseAsync` yourself.
- **`_root` is the key for path-less failures**, including "this is not an array" from
  `parseAndValidateArray`. A client that only reads named fields will show nothing.
- **Union errors are flattened onto one key.** Every branch of a `z.union` contributes its issues
  at the same path, so a three-branch union produces an array of three competing messages that can
  read as contradictory.
- **Messages are English literals generated here, not from Zod's `message` option** for the codes
  listed above. Setting a custom `message` on a `min()`/`max()`/type check does not change the
  output for those codes — only `custom` issues and unhandled codes use the issue's own message.
- **`zBigint()` requires the trailing `n`.** `"100"` fails; `"100n"` succeeds. Clients have to
  agree on that convention.
- **Zod v4 issue codes.** The formatter switches on v4 codes (`invalid_format`, `invalid_value`,
  `invalid_key`, `invalid_element`, `not_multiple_of`). A downgrade to Zod v3 silently falls
  through to the default branch for most issues.

## Working inside this package

```
src/
  validator.ts  parseAndValidate, parseAndValidateArray, and the internal issue formatter
                (describeIssue, addDetail, processIssue, formatZodErrors — all module-private)
  bigint.ts     zBigint
  index.ts      Barrel
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- `details` is `Record<string, string | string[]>` and never contains `undefined`. `describeIssue`
  has a fallback for exactly this reason.
- `addDetail` deduplicates repeated messages on the same key and promotes a second distinct message
  to an array. Preserve both behaviours — clients render either shape.
- The detail-key format (dotted path, `_root`, index prefixes) is what client-side form binding
  depends on. Changing it is breaking even though no type moves.
- `errors` and `zod` are the only dependencies.

User-visible changes need a changeset in `.changeset/`.
