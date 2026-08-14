# AGENTS.md — @maroonedsoftware/multipart

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Streaming `multipart/form-data` parsing over `@fastify/busboy`, with defaults chosen so an
unbounded upload cannot exhaust memory and with limit violations surfaced as `HttpError(413)`
rather than as a hung request. Files reach you as a `Readable` you must consume; fields come back
in a `Map`.

Reach for `MultipartBody` when handling an upload. In a Koa app you usually will not construct it
yourself — `bodyParserMiddleware` from `@maroonedsoftware/koa` does that and puts the result on the
context.

## Install

```bash
pnpm add @maroonedsoftware/multipart
```

Runtime dependencies: `@maroonedsoftware/errors`, `@fastify/busboy`. Node-only (`node:http`,
`node:stream`).

## Position in the graph

- **Depends on:** `errors`.
- **Depended on by:** `koa`.
- **Subpath exports:** none. The package has no `exports` map at all.

## API surface

| Export                 | Kind       | Shape                                                                                                            | Notes                                                                                          |
| ---------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `MultipartBody`        | class      | `new MultipartBody(req: IncomingMessage, _limits?: MultipartLimits)`                                             | Default limits: `{ files: 1, fileSize: MAX_FILE_SIZE, fields: MAX_FIELDS, parts: MAX_PARTS }`. |
| `MultipartBody#parse`  | method     | `(fileHandler: FileHandler, limits?: MultipartLimits) => Promise<Map<string, MultipartData \| MultipartData[]>>` | Per-call `limits` are merged over the instance defaults and win.                               |
| `MAX_FILE_SIZE`        | constant   | `20 * 1024 * 1024`                                                                                               | 20 MB.                                                                                         |
| `MAX_FIELDS`           | constant   | `1000`                                                                                                           | busboy's own default is `Infinity`.                                                            |
| `MAX_PARTS`            | constant   | `1010`                                                                                                           | Slightly above `MAX_FIELDS` to leave headroom for file parts.                                  |
| `FileHandler`          | type       | `(fieldname, stream: Readable, filename, encoding, mimeType) => Promise<void>`                                   | Called once per file. Must consume the stream.                                                 |
| `FieldData`            | type       | `{ value, nameTruncated, valueTruncated, encoding, mimeType }`                                                   | —                                                                                              |
| `FileData`             | type       | `{ stream: Readable, filename, encoding, mimeType }`                                                             | —                                                                                              |
| `MultipartData`        | type       | `FieldData \| FileData`                                                                                          | —                                                                                              |
| `isMultipartFieldData` | type guard | `(data: MultipartData) => data is FieldData`                                                                     | Checks for `'value' in data`.                                                                  |
| `isMultipartFileData`  | type guard | `(data: MultipartData) => data is FileData`                                                                      | Checks for `'stream' in data`.                                                                 |
| `MultipartLimits`      | interface  | `{ fieldNameSize?, fieldSize?, fields?, fileSize?, files?, parts?, headerPairs?, headerSize? }`                  | Passed through to busboy.                                                                      |

**Not exported:** `BusboyWrapper` (`src/busboy.wrapper.ts`) is internal. Use `MultipartBody`.

### Errors thrown

| Condition                                                                | Error                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| parts / files / fields limit exceeded, or a file truncated at `fileSize` | `HttpError(413)` with the reason in `internalDetails`                                      |
| client disconnects before the body completes                             | `HttpError(400)`, `internalDetails.reason = 'client aborted upload before body completed'` |
| `parse()` called twice on one instance                                   | `ServerkitError`, thrown **synchronously**                                                 |

### Limit defaults

`MultipartLimits` documents busboy's defaults, but `MultipartBody` overrides four of them:

| Limit           | busboy default | `MultipartBody` default |
| --------------- | -------------- | ----------------------- |
| `files`         | `Infinity`     | `1`                     |
| `fileSize`      | `Infinity`     | `MAX_FILE_SIZE` (20 MB) |
| `fields`        | `Infinity`     | `MAX_FIELDS` (1000)     |
| `parts`         | `Infinity`     | `MAX_PARTS` (1010)      |
| `fieldNameSize` | `100`          | unchanged               |
| `fieldSize`     | 1 MB           | unchanged               |
| `headerPairs`   | `2000`         | unchanged               |
| `headerSize`    | `81920`        | unchanged               |

## Canonical usage

```typescript
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { MultipartBody, MAX_FILE_SIZE, isMultipartFieldData } from '@maroonedsoftware/multipart';

const multipart = new MultipartBody(ctx.req);

const parts = await multipart.parse(
  async (fieldname, stream, filename, encoding, mimeType) => {
    await pipeline(stream, createWriteStream(`./uploads/${filename}`));
  },
  { fileSize: 50 * 1024 * 1024 }, // override for this request only
);

const description = parts.get('description');
if (description && !Array.isArray(description) && isMultipartFieldData(description)) {
  console.log(description.value);
}
```

Inside Koa, use `bodyParserMiddleware` instead of constructing this by hand. See
[.claude/skills/multipart-upload](../../.claude/skills/multipart-upload).

## Rules for generated code

- **Always consume the stream** in `FileHandler`, even when rejecting the file. An unconsumed
  stream stalls the parse. To discard, pipe to `/dev/null` or call `stream.resume()`.
- Return a promise from `FileHandler` that resolves only when the file is fully written. Returning
  early lets the parse finish while the write is still in flight.
- Never build a destination path from `filename` without sanitising it. The value comes from the
  client and can contain `../`.
- Call `parse()` exactly once per request. A second call throws synchronously, because the body has
  already been consumed.
- Raise `fileSize` deliberately and per request, not by changing the constructor default. The 20 MB
  default is the safety net.
- Check `nameTruncated` / `valueTruncated` on a `FieldData` before trusting `value` — truncation is
  reported, not thrown.
- Every `Map` value can be `MultipartData` **or** `MultipartData[]`. Handle the array case; a
  repeated field name produces one.
- Never buffer the whole file into memory to "make it simpler". Streaming is the point.

## Gotchas

- **`parse()` throws `ServerkitError` synchronously on a second call**, not a rejected promise. A
  `.catch()` alone will not catch it; the call is outside the promise chain.
- **`fields` and `parts` are capped by `MultipartBody`, but `fieldSize` and `fieldNameSize` are
  not.** They fall back to busboy's defaults (1 MB and 100 bytes), which is fine, but if you pass
  your own `limits` object you replace the whole default set for those keys you specify — the merge
  is `{ ...instanceDefaults, ...perCall }`, so a per-call `{ fileSize }` keeps the other defaults
  but a per-call `{ files: 5 }` does _not_ reset `fileSize`.
- **A truncated file is a 413, not a partial file.** The `'limit'` event on the file stream
  rejects the whole parse, so anything already written by your handler is orphaned. Clean up in a
  `catch`.
- **A client disconnect is a 400, not a 499 or a silent abort.** That is deliberate so the error
  path is uniform, but it will show up in 4xx dashboards as a client error.
- **Limit reasons live in `internalDetails`, not `details`.** The client gets a bare 413 with no
  explanation of which limit it hit. That is intentional (it does not leak your limits); if you
  want to tell the client, catch and re-throw with `details`.
- **This is Node-only** and takes an `IncomingMessage`. It cannot parse a `Request`/`FormData` from
  the web platform.

## Working inside this package

```
src/
  types.ts           FileHandler, FieldData, FileData, MultipartData, guards, MultipartLimits
  multipart.body.ts  MultipartBody, MAX_FILE_SIZE, MAX_FIELDS, MAX_PARTS
  busboy.wrapper.ts  BusboyWrapper — internal; owns the busboy event wiring, limit handlers,
                     stream cleanup, and the 413/400 mapping
  index.ts           Barrel (exports types.ts and multipart.body.ts only)
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- The default limits are a security control, not a convenience. Loosening `files`, `fileSize`,
  `fields`, or `parts` in the constructor default is a security change.
- Every error path must destroy the request stream and detach listeners, or a rejected parse leaks
  a socket. That cleanup lives in `BusboyWrapper`.
- `BusboyWrapper` stays out of the barrel. `MultipartBody` is the only supported entry point, which
  is what makes the once-per-request guard enforceable.
- `errors` and `@fastify/busboy` are the only dependencies.

User-visible changes need a changeset in `.changeset/`.
