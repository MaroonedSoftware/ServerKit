# @maroonedsoftware/zod

## 0.7.1

### Patch Changes

- Updated dependencies [97a75be]
  - @maroonedsoftware/errors@1.9.1

## 0.7.0

### Minor Changes

- f2c5b2a: New `@maroonedsoftware/zod/serializer` subpath exporting `compileSerializer`, which turns a Zod schema into a `fast-json-stringify` serializer for the schema's output type — the compiled-serialization technique Fastify uses, typically 2-3× faster than `JSON.stringify` for a known shape. The conversion goes through zod's native `z.toJSONSchema` targeting draft-07, and nodes with no JSON Schema equivalent (transforms, `z.custom`, `z.date`, `z.bigint`) fail at compile time — startup, not per request — unless mapped via `override` or admitted with `unrepresentable: 'any'`. The returned function performs no validation; fast-json-stringify silently coerces or drops non-conforming input, so only serialize values that came out of the schema. `fast-json-stringify` is a new optional peer dependency loaded only by the subpath — the root barrel is unchanged and stays dependency-light. The package also gains an `exports` map (previously it had none), so deep imports into `dist/` no longer resolve; import from the package root or the `/serializer` subpath.

### Patch Changes

- 8b5bf70: `parseAndValidate` and `parseAndValidateArray` now complete fully synchronous schemas without a promise round-trip per parse. Previously every call went through `safeParseAsync`, which unconditionally awaits even when the schema contains nothing asynchronous — a microtask-queue tick per validation, and a generated route handler validates params, query, headers, and body separately. The functions now run zod's internal parse directly in async mode, which returns synchronously for sync schemas and a Promise only when the schema actually contains async refinements or transforms; issues are finalized through the same path `safeParseAsync` uses, so error shapes, detail keys, custom error maps, and the 4xx/5xx `details`/`internalDetails` split are all unchanged, as are both function signatures. Async refinements and transforms behave exactly as before, including a rejecting refinement surfacing as the call's own rejection.

## 0.6.1

### Patch Changes

- 34f26bf: Stop `parseAndValidate` and `parseAndValidateArray` leaking field-level validation details in a 5xx response. When `statusCode` is `500` or above the field map now lands on the error's `internalDetails` instead of `details`, so it stays on the log path — `errorMiddleware` copies `details` into the response body for every `HttpError` regardless of status, so a server-side validation failure was previously telling the caller which of the server's own fields failed. Calls that omit `statusCode` or pass a 4xx are unchanged.

## 0.6.0

### Minor Changes

- 5134562: Add an optional `statusCode` argument to `parseAndValidate` and `parseAndValidateArray`, so a validation failure can be rendered as something other than `400` (e.g. `422` for a well-formed but semantically rejected payload). Existing two-argument calls are unaffected and still throw `400`.

## 0.5.6

### Patch Changes

- Updated dependencies [e2e968d]
  - @maroonedsoftware/errors@1.9.0

## 0.5.5

### Patch Changes

- be035ce: Ship the MIT LICENSE file in the published package tarball, and link to it from the README.
- Updated dependencies [be035ce]
  - @maroonedsoftware/errors@1.8.5

## 0.5.4

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/errors@1.8.4

## 0.5.3

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/errors@1.8.3

## 0.5.2

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/errors@1.8.2

## 0.5.1

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/errors@1.8.1

## 0.5.0

### Minor Changes

- b1cc306: Add `parseAndValidateArray` for validating every element of an array against a single element schema. Reports violations across all failing elements at once, prefixes detail keys with the element index (`"1.email"`), and rejects a non-array input as a `400` keyed `"_root"` instead of throwing.

## 0.4.4

### Patch Changes

- dfe5304: Security and robustness hardening across the workspace.

  - **appconfig**: reject `__proto__`/`constructor`/`prototype` key segments in `nestKeys` (prototype-pollution guard), isolate config-change listener errors so one throwing listener can't abort a reload, replace arrays on deep-merge (last-wins) instead of concatenating, and make secret/env resolver prefixes non-greedy and always global.
  - **authentication**: atomically claim the refresh-token `jti` (via the new `CacheProvider.add`) to close a refresh-reuse race, pin JWT verification to `RS256`, bound failed OTP/code attempts on the authenticator/email/phone factors (new `maxValidationAttempts`/`maxVerificationAttempts` options, HTTP 429 when exceeded), and split Basic credentials on the first colon only.
  - **cache**: add `CacheProvider.add` (atomic set-if-absent claim primitive) and make `update` apply `XX` so an expired key is not resurrected without a TTL.
  - **discord/slack/telegram/whatsapp**: add a per-request `requestTimeoutMs` (default 10s), redact secret tokens from REST-client logs, and neutralize `@everyone`/`@here`/broadcast mentions in outgoing text. Discord additionally acks multi-reply interactions out of band.
  - **koa**: reject `origin: '*'` combined with `credentials: true`, honor an inbound `X-Request-Id`, bound the binary parser body (new `BinaryParserOptions`, 20MB default, HTTP 413), and resolve wildcard media-type registrations (e.g. `application/*+json`).
  - **multipart**: bound field/parts counts by default (`MAX_FIELDS`/`MAX_PARTS`) so a field flood cannot exhaust memory.
  - **errors**: map Postgres foreign-key violations (23503) to HTTP 409 Conflict instead of 404.
  - **scim**: enforce `userName` required and unique on user PATCH (400/409).
  - **permissions-dsl**: reject reserved namespace names (JS keywords, permission builders, the `model` export) that would otherwise generate uncompilable output.
  - **utilities**: accept UUID versions 6/7/8 in `isUuid`.
  - **storage**: write files atomically (temp file + rename) so a mid-write crash can't leave a truncated file readable as complete.
  - **jobbroker**: reject the pg-boss work handler when a job in the batch fails so retry/dead-letter policies actually apply.
  - **johnny5**: strip dotenv inline comments on unquoted values without corrupting quoted ones.
  - **zod**: fall back to a stable message for issue codes that carry none.

- Updated dependencies [dfe5304]
  - @maroonedsoftware/errors@1.8.0

## 0.4.3

### Patch Changes

- Updated dependencies [b00d9b4]
  - @maroonedsoftware/errors@1.7.1

## 0.4.2

### Patch Changes

- Updated dependencies [108c1d4]
  - @maroonedsoftware/errors@1.7.0

## 0.4.1

### Patch Changes

- db220a1: chore: bump kysely, zod patch versions
- 9e2c2de: chore: update package versions for dependencies and devDependencies
  - @maroonedsoftware/errors@1.6.0

## 0.4.0

### Minor Changes

- c48adc0: fix: use issue message for invalid_union with no branch errors
  - Updated the error handling in the processIssue function to utilize the specific issue message when an invalid_union has no associated branch errors.
  - Added a test case to ensure that the correct message is returned in this scenario.

## 0.3.1

### Patch Changes

- Updated dependencies [7624166]
  - @maroonedsoftware/errors@1.6.0

## 0.3.0

### Minor Changes

- 0ef3fb0: feat: enhance error formatting in Zod validation
  - Introduced detailed error descriptions for various validation issues, including type mismatches, size constraints, and custom messages.
  - Refactored error processing logic to improve clarity and maintainability.
  - Added comprehensive unit tests to ensure accurate error formatting and handling for different validation scenarios.

## 0.2.1

### Patch Changes

- Updated dependencies [4e9ccf4]
  - @maroonedsoftware/errors@1.5.0

## 0.2.0

### Minor Changes

- b1005f4: adding jsdocs and updating readme

## 0.1.0

### Minor Changes

- b9940cc: initial release
