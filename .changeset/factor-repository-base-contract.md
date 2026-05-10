---
'@maroonedsoftware/authentication': minor
---

Unify factor repositories under a shared `FactorRepository<TFactor, CreateValue, LookupValue>` base contract. Every factor repository (email, password, phone, authenticator, fido, oidc, oauth2) now extends the same base interface from `@maroonedsoftware/authentication`'s new `Factor` / `FactorRepository` types, gaining a uniform `createFactor` / `listFactors` / `lookupFactor` / `findFactor?` / `getFactor` / `deleteFactor` surface.

The base contract distinguishes per-actor scoped lookups from global ones:

- `lookupFactor(actorId, value)` — required. Scoped: "does this actor have this value?".
- `findFactor?(value)` — optional. Global: "who has this value?". Email, OAuth2, and OIDC narrow it to required because their lookup values (email address, `(provider, subject)`) are unique system-wide.

Breaking changes for repository implementers:

- `PasswordFactorRepository`: `createFactor(actorId, value, needsReset)` → `createFactor(actorId, value)` (with `needsReset` moved onto `PasswordValue`); same for `updateFactor`. `getFactor(actorId)` and `deleteFactor(actorId)` now take `(actorId, factorId)` — pass `actorId` for both since password factors are one-per-actor. New required `listFactors`.
- `PhoneFactorRepository`: `findFactor(actorId, value)` renamed to `lookupFactor(actorId, value)`. New required `listFactors`.
- `EmailFactorRepository`: global `lookupFactor(value)` renamed to `findFactor(value)`. New required per-actor `lookupFactor(actorId, value)` and `listFactors`.
- `AuthenticatorFactorRepository` / `FidoFactorRepository`: new required `listFactors` (and `lookupFactor` for authenticator).
- `OidcFactorRepository` / `OAuth2FactorRepository`: `createFactor(args: { actorId, ... })` → `createFactor(actorId, value)`. `lookupFactor(provider, subject)` renamed to `findFactor({ provider, subject })`. `listFactorsForActor(actorId)` renamed to `listFactors(actorId, active?)`. `OidcFactor` / `OAuth2Factor` now extend the shared `Factor` type rather than redeclaring `id` / `actorId` / `active`.

Service-layer consequences:

- `EmailFactorService.lookupFactor(value)` renamed to `findFactor(value)`.
- `OidcFactorService.lookupFactor(provider, subject)` and `OAuth2FactorService.lookupFactor(provider, subject)` renamed to `findFactor(provider, subject)`.
- Each factor service now exposes uniform `getFactor`, `listFactors`, `lookupFactor`, and `deleteFactor` passthroughs for account-management UIs.
- `EmailFactorService` adds `createFactor(actorId, value)` for trusted callers (invite flows, admin tools) that need to skip OTP/magic-link verification but keep policy and invite-only-domain checks.

Also fixes a `clearRateLimit` typo in `PasswordFactorService` that double-awaited the rate-limiter delete.
