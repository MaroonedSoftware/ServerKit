---
'@maroonedsoftware/authentication': major
'@maroonedsoftware/koa': major
---

Rename `AuthenticationContext` to `AuthenticationSession`, drop the legacy `actorId` / `actorType` / `roles` shape, and consolidate the type export point.

Breaking changes:

- `AuthenticationContext` → `AuthenticationSession`. The interface fields are now `subject` (replaces `actorId` / `actorType`), `sessionToken`, `issuedAt`, `lastAccessedAt`, `expiresAt`, `factors`, and `claims`.
- `invalidAuthenticationContext` → `invalidAuthenticationSession`.
- `AuthenticationFactor` → `AuthenticationSessionFactor`. Each factor now carries `methodId`, `issuedAt`, and `authenticatedAt`; the old `lastAuthenticated` field is renamed to `authenticatedAt`. `method` is now typed as `AuthenticationFactorMethod` (`'phone' | 'password' | 'authenticator' | 'email' | 'fido'`).
- `roles` has been removed from the session shape. `requireSecurity` no longer enforces role membership and only checks that an authenticated session is present; the `roles` option on `SecurityOptions` is reserved for future use but currently inert.
- `ctx.authenticationContext` on `ServerKitContext` (from `@maroonedsoftware/koa`) → `ctx.authenticationSession`.
- The `authentication.context.ts` module has been removed; its exports now live in `types.ts`. Existing top-level imports from `@maroonedsoftware/authentication` continue to work under the new names.

Migration: rename `AuthenticationContext` → `AuthenticationSession`, `invalidAuthenticationContext` → `invalidAuthenticationSession`, `ctx.authenticationContext` → `ctx.authenticationSession`. Replace `actorId` / `actorType` with `subject` and remove any reads of `roles` from sessions; if you depended on `requireSecurity({ roles })` for authorization, gate routes on session claims instead until the role check is reintroduced.
