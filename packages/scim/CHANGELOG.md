# @maroonedsoftware/scim

## 0.1.17

### Patch Changes

- Updated dependencies [09f3f3b]
  - @maroonedsoftware/authentication@4.22.2
  - @maroonedsoftware/koa@2.2.8

## 0.1.16

### Patch Changes

- Updated dependencies [d494e15]
  - @maroonedsoftware/utilities@1.8.0
  - @maroonedsoftware/authentication@4.22.1
  - @maroonedsoftware/koa@2.2.7

## 0.1.15

### Patch Changes

- Updated dependencies [7629ec6]
  - @maroonedsoftware/authentication@4.22.0
  - @maroonedsoftware/koa@2.2.6

## 0.1.14

### Patch Changes

- a167ee3: Bump runtime dependencies (notably `injectkit` to 1.4.1) and relax the pgboss job registration type guard so it accepts the updated `Identifier` shape.
- Updated dependencies [a167ee3]
  - @maroonedsoftware/authentication@4.21.2
  - @maroonedsoftware/koa@2.2.5
  - @maroonedsoftware/logger@1.1.1

## 0.1.13

### Patch Changes

- Updated dependencies [db65060]
  - @maroonedsoftware/authentication@4.21.1
  - @maroonedsoftware/koa@2.2.4

## 0.1.12

### Patch Changes

- 108c1d4: Cross-package security and correctness audit.
  - **authentication**: `JwtAuthenticationIssuer.parse` now receives both the raw `token` and the decoded `payload` (was just `payload`) — implementations **must** verify the signature against trusted key material because the payload is unverified. `JwtProvider` accepts an optional `pemPublicKey` and now verifies tokens with the public key (derived from the private PEM when not supplied) so verification paths never have to hold the signing key. `updateSession` resets `expiresAt` to `now + expiration` (absolute) instead of stacking it on top of the existing expiry — a chatty client can no longer extend a session past its configured lifetime. FIDO assertion verification rejects factors that are missing their replay counter instead of silently degrading to "no counter check". Magic-link redirect HTML now embeds the URL via `JSON.stringify` so the assignment string cannot be escaped. Authorization-header parsing splits on the first space only, preserving multi-token credentials such as `Digest username="…", nonce="…"`.
  - **encryption**: `EncryptionProvider.createKey` is now `async` and derives keys with **Argon2id** (the OWASP-recommended memory-hard KDF, shared with `Argon2idPasswordHashProvider` via the new `ARGON2ID_DEFAULTS` export) instead of PBKDF2-HMAC-SHA512 at 65 535 iterations. Callers must `await` and any keys previously derived from a passphrase will no longer match — re-derive and re-encrypt. The per-id lock chain inside `InMemoryKmsProvider` was rewritten with `async`/`await`, fixing a `prev.then(fn, fn)` bug that broke serialisation when a queued operation rejected. Removed an unreachable `KeyRetiredError` guard on the encrypt path. `kms/in-memory.kms.provider.ts` renamed to `kms/in.memory.kms.provider.ts` to match the project's dot-separated filename convention — deep imports must update the path.
  - **errors**: The `@OnError` decorator now **rethrows** the original error after invoking the handler. Handlers that map errors continue to work (they throw their replacement, which short-circuits the rethrow); handlers that only logged and swallowed will start propagating errors. `isPostgresError` is stricter — it requires `code` to be a string in the 5-character SQLSTATE shape, so generic Node errors (`ENOENT`, axios errors with a `code`, etc.) are no longer mis-routed through the Postgres mapper.
  - **appconfig**: `AppConfigProviderGcpSecrets.getSecret` now throws a `ServerkitError` (with the original error attached as `cause` and `secretId` / `projectId` in `internalDetails`) when Secret Manager rejects, instead of silently substituting `''` and booting the service with empty passwords / API keys. `canParse` resets the regex's `lastIndex` before testing, fixing a stateful-`/g`-flag bug that returned `false` for matching strings on subsequent calls. `AppConfigBuilder.build()` now returns an empty config when no sources are registered instead of crashing on `deepmerge()` of zero arguments. Added a workspace dependency on `@maroonedsoftware/errors`.
  - **jobbroker**: `PgBossJobRunner` now `await`s `pgboss.work(...)` and wraps the per-batch job execution in `Promise.allSettled`, so pg-boss no longer marks a batch complete before the jobs have actually finished. Each job in a batch now resolves its own `Job` instance from the DI container, matching the documented "resolved for each execution" contract.
  - **koa**: `requireSignature` middleware compares HMAC digests with `crypto.timingSafeEqual` (with a length guard for missing/short signatures) instead of `!==`, removing a timing-attack vector on webhook signatures.
  - **scim**: `ScimUserService` and `ScimGroupService` use Luxon `DateTime.utc().toISO()` for `meta.created` / `meta.lastModified` instead of native `Date#toISOString()`, matching the project-wide Luxon convention.

- Updated dependencies [108c1d4]
  - @maroonedsoftware/authentication@4.21.0
  - @maroonedsoftware/errors@1.7.0
  - @maroonedsoftware/koa@2.2.3

## 0.1.11

### Patch Changes

- @maroonedsoftware/koa@2.2.2

## 0.1.10

### Patch Changes

- Updated dependencies [8232ee3]
  - @maroonedsoftware/authentication@4.20.0
  - @maroonedsoftware/koa@2.2.1

## 0.1.9

### Patch Changes

- Updated dependencies [b506f37]
  - @maroonedsoftware/authentication@4.19.0
  - @maroonedsoftware/koa@2.2.0

## 0.1.8

### Patch Changes

- @maroonedsoftware/authentication@4.18.1
- @maroonedsoftware/koa@2.1.21

## 0.1.7

### Patch Changes

- Updated dependencies [d84fc17]
  - @maroonedsoftware/authentication@4.18.0
  - @maroonedsoftware/koa@2.1.20

## 0.1.6

### Patch Changes

- Updated dependencies [e840690]
- Updated dependencies [b6e5df2]
  - @maroonedsoftware/authentication@4.17.0
  - @maroonedsoftware/koa@2.1.19

## 0.1.5

### Patch Changes

- Updated dependencies [0825138]
- Updated dependencies [2ec28e2]
- Updated dependencies [92b1420]
  - @maroonedsoftware/authentication@4.16.0
  - @maroonedsoftware/koa@2.1.18

## 0.1.4

### Patch Changes

- Updated dependencies [54dbb7c]
  - @maroonedsoftware/authentication@4.15.0
  - @maroonedsoftware/koa@2.1.17

## 0.1.3

### Patch Changes

- Updated dependencies [f8a0156]
  - @maroonedsoftware/authentication@4.14.0
  - @maroonedsoftware/koa@2.1.16

## 0.1.2

### Patch Changes

- Updated dependencies [47c201a]
- Updated dependencies [4f12151]
  - @maroonedsoftware/authentication@4.13.0
  - @maroonedsoftware/koa@2.1.15

## 0.1.1

### Patch Changes

- Updated dependencies [33fa7b0]
  - @maroonedsoftware/authentication@4.12.0
  - @maroonedsoftware/koa@2.1.14

## 0.1.0

### Minor Changes

- c5f98a6: Add `@maroonedsoftware/scim`, a SCIM 2.0 (RFC 7643/7644) server toolkit. Ships User, Group, and EnterpriseUser schemas, a typed filter parser, a PATCH applier, the SCIM error envelope, abstract `ScimUserRepository` / `ScimGroupRepository` contracts, and a `createScimRouter` factory that mounts the standard `/Users`, `/Groups`, `/Schemas`, `/ResourceTypes`, and `/ServiceProviderConfig` endpoints. Endpoint authentication integrates with `@maroonedsoftware/authentication` via a `requireScimScope(scope)` guard.
