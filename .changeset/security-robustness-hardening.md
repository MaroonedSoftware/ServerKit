---
'@maroonedsoftware/appconfig': minor
'@maroonedsoftware/authentication': minor
'@maroonedsoftware/cache': minor
'@maroonedsoftware/discord': minor
'@maroonedsoftware/errors': minor
'@maroonedsoftware/koa': minor
'@maroonedsoftware/multipart': minor
'@maroonedsoftware/permissions-dsl': minor
'@maroonedsoftware/scim': minor
'@maroonedsoftware/slack': minor
'@maroonedsoftware/telegram': minor
'@maroonedsoftware/utilities': minor
'@maroonedsoftware/whatsapp': minor
'@maroonedsoftware/jobbroker': patch
'@maroonedsoftware/johnny5': patch
'@maroonedsoftware/storage': patch
'@maroonedsoftware/zod': patch
---

Security and robustness hardening across the workspace.

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
