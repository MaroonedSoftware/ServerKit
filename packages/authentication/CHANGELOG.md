# @maroonedsoftware/authentication

## 4.10.0

### Minor Changes

- 058fe78: `createFidoAuthorizationChallenge` now also returns `assertion.rawChallenge` — the same value as `assertion.challenge` but as a raw `Buffer` instead of a base64 string — for callers that want to forward the bytes to the WebAuthn client without decoding.

## 4.9.0

### Minor Changes

- e3f1419: `FidoFactorService` registration and challenge results now nest the WebAuthn payload under a single `attestation`/`assertion` key so callers can forward it directly to `navigator.credentials.create`/`get` without spreading.
  - `registerFidoFactor` now returns `{ registrationId, attestation: { rp, user, challenge, pubKeyCredParams, timeout, attestation }, expiresAt, issuedAt, alreadyRegistered }`. The previous `attestationOptions` / top-level `user` / `challenge` / `attestation` (conveyance) fields are gone.
  - `createFidoAuthorizationChallenge` now returns `{ challengeId, assertion: { ...assertionOptions, challenge, allowCredentials }, expiresAt, issuedAt, alreadyIssued }`. The previous `assertionOptions` / top-level `challenge` / `allowCredentials` fields are gone.

  Migration: replace `result.attestationOptions` / `result.user` / `result.challenge` / `result.attestation` with `result.attestation.<field>`, and `result.assertionOptions` / `result.challenge` / `result.allowCredentials` with `result.assertion.<field>`.

## 4.8.0

### Minor Changes

- 2502e3d: Authenticator and FIDO factors gain an optional `label` field so callers can attach a human-readable name (e.g. "Personal phone", "MacBook Touch ID") to each factor.
  - `AuthenticatorFactorService.registerAuthenticatorFactor` signature is now `(actorId, label?, options?, registrationId?)` — `label` is inserted as the second argument. Migration: existing calls of the form `registerAuthenticatorFactor(actorId, options)` must become `registerAuthenticatorFactor(actorId, undefined, options)`.
  - `FidoFactorService.registerFidoFactor`'s `options.label` is forwarded to the new factor.
  - `FidoFactorRepository.createFactor(actorId, options)` now takes a single `FidoFactorOptions` object instead of positional `(publicKey, publicKeyId, counter, active)` arguments. The `active` parameter is removed; implementations should default new factors to active. A new exported `FidoFactorOptions` type captures the persisted shape.
  - `AuthenticatorFactor` and `FidoFactor` both gain an optional `label?: string` field.

  The previously-stale `FidoAttestation` export has been removed.

- 915681d: `FidoFactorService` now mirrors the registration/sign-in shape of the email and phone services, with idempotent flows keyed by ids:
  - `registerFidoFactor` returns `{ registrationId, attestationOptions, user, challenge, attestation, expiresAt, issuedAt, alreadyRegistered }` instead of a `FidoAttestation`, and accepts an optional caller-supplied `registrationId`. Calling it again for the same actor (or the same `registrationId`) returns the cached payload with `alreadyRegistered: true`.
  - `createFidoFactorFromRegistration(actorId, registrationId, credential)` now requires `registrationId` and throws HTTP 404 (was HTTP 401 `invalid_registration`) when the registration is missing or expired.
  - `createFidoAuthorizationChallenge(actorId, factorId, options?)` takes a new `factorId` parameter. When provided, the challenge is scoped to that single factor and the verifier enforces that the credential belongs to it. When omitted, all of the actor's active factors are eligible. The return shape is now `{ challengeId, assertionOptions, challenge, allowCredentials, expiresAt, issuedAt, alreadyIssued }`, and back-to-back calls for the same `(actorId, factorId)` return the cached challenge.
  - `verifyFidoAuthorizationChallenge(challengeId, credential)` is keyed by `challengeId` (was `actorId`). It now throws HTTP 404 when the challenge is missing/expired, and HTTP 401 with `error="invalid_factor"` when the credential does not belong to the scoped factor.
  - New `hasPendingRegistration(registrationId)` and `hasPendingChallenge(challengeId)` helpers.
  - `FidoFactorRepository` adds a new `lookupFactor(actorId, credentialId)` method (the credential-id lookup that `getFactor` previously did); `getFactor(actorId, factorId)` is now keyed by the factor row id.

  Migration: thread the new `registrationId` and `challengeId` values through your client/server roundtrip, pass `factorId` (or `undefined`) to `createFidoAuthorizationChallenge`, and add `lookupFactor` to your `FidoFactorRepository` implementation.

## 4.7.0

### Minor Changes

- 42a3ee3: `FidoFactorServiceOptions` gains optional `rpId`, `rpName`, `rpOrigin`, and `rpIcon` defaults (defaulting to `localhost`/`Localhost`/`http://localhost`). The corresponding fields on `RegisterFidoFactorOptions` and `AuthorizeFidoFactorOptions` are now optional and fall back to those defaults, and `createFidoAuthorizationChallenge` may be called without an `options` argument. Existing callers that pass `rpId`/`rpName`/`rpOrigin` per call continue to work unchanged.

## 4.6.0

### Minor Changes

- af5cb70: `PhoneFactorService` now generates and verifies OTP codes for phone factor registration and adds a sign-in challenge flow that mirrors `EmailFactorService`. `registerPhoneFactor` now returns a `code` (the OTP to SMS to the user) and no longer returns `value`; `createPhoneFactorFromRegistration` now requires a third `code` argument and throws HTTP 400 when the code is invalid. New methods `issuePhoneChallenge`, `verifyPhoneChallenge`, and `hasPendingChallenge` provide a sign-in flow for existing active phone factors. The constructor now requires an `OtpProvider` dependency, and both `PhoneFactorServiceOptions` and `EmailFactorServiceOptions` gain an optional `tokenLength` (default `6`) that controls the length of generated OTP codes.

  Migration: pass an `OtpProvider` to `PhoneFactorService`, drop the `value` from `registerPhoneFactor`'s destructure (the phone number is whatever you passed in), and forward the user-submitted code as the third argument to `createPhoneFactorFromRegistration`.

## 4.5.1

### Patch Changes

- Updated dependencies [4814eff]
  - @maroonedsoftware/cache@0.1.4

## 4.5.0

### Minor Changes

- 87792a2: Rename the bundled policy names from `'email_allowed'` / `'phone_allowed'` to `'email.allowed'` / `'phone.allowed'` to use a dotted naming convention that reads better as a namespace and matches the convention `AuthenticationPolicyMappings` will use going forward. `EmailFactorService` and `PhoneFactorService` now call `policyService.check('email.allowed', ...)` and `policyService.check('phone.allowed', ...)` respectively.

  Migration: in your `PolicyRegistryMap` setup, change `map.set('email_allowed', EmailAllowedPolicy)` to `map.set('email.allowed', EmailAllowedPolicy)` and `map.set('phone_allowed', PhoneAllowedPolicy)` to `map.set('phone.allowed', PhoneAllowedPolicy)`. If you depend on `AuthenticationPolicyNames` / `AuthenticationPolicyContexts` directly, the keys in those types change accordingly.

## 4.4.1

### Patch Changes

- Updated dependencies [ae918b6]
  - @maroonedsoftware/policies@0.2.0

## 4.4.0

### Minor Changes

- 82bac7f: Rename `PolicyMappings`, `PolicyNames`, and `PolicyContexts` to `AuthenticationPolicyMappings`, `AuthenticationPolicyNames`, and `AuthenticationPolicyContexts` so they don't collide when an application bundles policy mappings from multiple `@maroonedsoftware/*` packages.

  Migration: rename references at every import site. The runtime values and context shapes are unchanged.

## 4.3.0

### Minor Changes

- b82c093: Extract email/phone allow rules into the new `@maroonedsoftware/policies` package.

  The new package introduces a small DI-friendly policy framework: a `Policy` base class with `allow()` / `deny(reason, details?)` / `denyStepUp(reason, requirement)` helpers, a discriminated `PolicyResult`, and a typed `PolicyService` (`check` / `assert`) that resolves named policies through a `PolicyRegistryMap`. Subclass `BasePolicyService` to supply a per-evaluation `PolicyEnvelope` (at minimum `now: DateTime`).

  Breaking changes in `@maroonedsoftware/authentication`:
  - `AllowlistProvider` and `AllowlistProviderOptions` are removed. Email/phone validation is now dispatched through `PolicyService` from `@maroonedsoftware/policies`.
  - `EmailFactorService` and `PhoneFactorService` constructors now take `PolicyService` (replacing `AllowlistProvider`).
  - New `EmailAllowedPolicy` (with `EmailAllowedPolicyOptions.emailDomainDenyList`) and `PhoneAllowedPolicy` ship in this package; register them under the policy names `'email_allowed'` and `'phone_allowed'` respectively. Bundled factor services call `policyService.check('email_allowed', { value })` and `policyService.check('phone_allowed', { value })`, then map the `reason` on a denial to HTTP 400 (same external behaviour as before for default consumers).

  Migration: replace the `AllowlistProvider` registration with bindings for `EmailAllowedPolicy` and `PhoneAllowedPolicy` plus a `PolicyService` (typically a `BasePolicyService` subclass) and a `PolicyRegistryMap` that maps `'email_allowed'` and `'phone_allowed'` to those policies. Move any `emailDomainDenyList` configuration from `AllowlistProviderOptions` to `EmailAllowedPolicyOptions`. Custom subclasses that returned non-default `reason` strings continue to work — the factor services pass unknown reasons through unchanged.

  Also exports `matchesFactorConstraints` and `isFactorRecent` helpers (groundwork for step-up policies).

### Patch Changes

- Updated dependencies [b82c093]
  - @maroonedsoftware/policies@0.1.0

## 4.2.0

### Minor Changes

- b2fbd4f: Add `OtpProviderMock`, a drop-in replacement for `OtpProvider` for local development and integration tests. `generate` always returns `'000000'`, `validate` always returns `true`, and every call logs a warning to the injected `Logger`. Never register in production.
- 1cea32d: Reshape `AllowlistProvider` to return a result instead of throwing. Methods are renamed `ensureEmailIsAllowed` → `checkEmailIsAllowed` and `ensurePhoneIsAllowed` → `checkPhoneIsAllowed`, and now return `Promise<AllowListResult>` (`{ allowed: true } | { allowed: false, reason?: 'invalid_format' | 'deny_list' | string }`). The bundled `EmailFactorService` and `PhoneFactorService` translate a failed check into HTTP 400 with `{ value: reason }`, so the externally observable behaviour for default consumers is unchanged. Subclasses can now report rejections without committing to an HTTP-shaped error. The `AllowListResult` type is exported.

## 4.1.0

### Minor Changes

- 164a27e: Extract email and phone factor allow/deny rules into a new injectable `AllowlistProvider`. `EmailFactorServiceOptions` no longer accepts a `denyList`; configure `AllowlistProviderOptions` with `emailDomainDenyList` instead. `EmailFactorService` and `PhoneFactorService` constructors now take a required `AllowlistProvider`. Subclass `AllowlistProvider` to plug in stricter validation (regional phone filtering, dynamic deny lists, MX checks, etc.) without touching the factor services.

## 4.0.0

### Major Changes

- 24450df: Rename `AuthenticationContext` to `AuthenticationSession`, drop the legacy `actorId` / `actorType` / `roles` shape, and consolidate the type export point.

  Breaking changes:
  - `AuthenticationContext` → `AuthenticationSession`. The interface fields are now `subject` (replaces `actorId` / `actorType`), `sessionToken`, `issuedAt`, `lastAccessedAt`, `expiresAt`, `factors`, and `claims`.
  - `invalidAuthenticationContext` → `invalidAuthenticationSession`.
  - `AuthenticationFactor` → `AuthenticationSessionFactor`. Each factor now carries `methodId`, `issuedAt`, and `authenticatedAt`; the old `lastAuthenticated` field is renamed to `authenticatedAt`. `method` is now typed as `AuthenticationFactorMethod` (`'phone' | 'password' | 'authenticator' | 'email' | 'fido'`).
  - `roles` has been removed from the session shape. `requireSecurity` no longer enforces role membership and only checks that an authenticated session is present; the `roles` option on `SecurityOptions` is reserved for future use but currently inert.
  - `ctx.authenticationContext` on `ServerKitContext` (from `@maroonedsoftware/koa`) → `ctx.authenticationSession`.
  - The `authentication.context.ts` module has been removed; its exports now live in `types.ts`. Existing top-level imports from `@maroonedsoftware/authentication` continue to work under the new names.

  Migration: rename `AuthenticationContext` → `AuthenticationSession`, `invalidAuthenticationContext` → `invalidAuthenticationSession`, `ctx.authenticationContext` → `ctx.authenticationSession`. Replace `actorId` / `actorType` with `subject` and remove any reads of `roles` from sessions; if you depended on `requireSecurity({ roles })` for authorization, gate routes on session claims instead until the role check is reintroduced.

## 3.0.0

### Major Changes

- 2620573: Factor service verify/create/update/change methods now return the full factor object instead of just an id or `{ actorId, factorId }` pair. `EmailFactorService.verifyEmailChallenge` and `FidoFactorService.verifyFidoAuthorizationChallenge` also re-check that the matching factor is still active and throw HTTP 401 with `WWW-Authenticate: Bearer error="invalid_factor"` when it has been deleted or deactivated since the challenge was issued.

  Affected methods:
  - `AuthenticatorFactorService.validateFactor` now returns `AuthenticatorFactor` (was `void`).
  - `EmailFactorService.verifyEmailChallenge` now returns `EmailFactor` (was `{ actorId, factorId }`).
  - `FidoFactorService.createFidoFactorFromRegistration` now returns `FidoFactor` (was `string`).
  - `FidoFactorService.verifyFidoAuthorizationChallenge` now returns `FidoFactor` (was `{ actorId, factorId }`); the unknown-credential branch now throws `error="invalid_factor"` instead of `error="invalid_credentials"`.
  - `PasswordFactorService.createPasswordFactor`, `updatePasswordFactor`, `verifyPassword`, and `changePassword` now return `PasswordFactor` (was `string`).

## 2.3.0

### Minor Changes

- 5bb6817: Export `AuthenticationFactorMethod`, the union of built-in factor method names (`'phone' | 'password' | 'authenticator' | 'email' | 'fido'`) previously inlined on `AuthenticationSessionFactor.method`.

## 2.2.1

### Patch Changes

- 9e2c2de: chore: update package versions for dependencies and devDependencies
- Updated dependencies [9e2c2de]
  - @maroonedsoftware/cache@0.1.3
  - @maroonedsoftware/encryption@0.4.0
  - @maroonedsoftware/errors@1.6.0
  - @maroonedsoftware/logger@1.1.0
  - @maroonedsoftware/utilities@1.7.0

## 2.2.0

### Minor Changes

- e57e48a: `AuthenticationSessionService.issueTokenForSession` now embeds session claims under a single nested `claims` object inside the JWT payload instead of spreading them onto the top-level payload. This avoids accidental collisions with reserved JWT fields, but consumers that decode the token directly and read claim keys off `jwtPayload.<claim>` must move to `jwtPayload.claims.<claim>`. Internal usage via `lookupSessionFromJwt` and `AuthenticationContext.claims` is unaffected (claims are read from the session, not the token).

## 2.1.0

### Minor Changes

- ea5521d: Add `PasswordFactorService.clearRateLimit(actorId)` to reset the verify-password rate-limiter counter for an actor — useful after an out-of-band recovery (magic-link sign-in, admin unlock) so the next password attempt isn't blocked by accumulated 429s.

## 2.0.0

### Major Changes

- 0ca3ef5: Rename `PasswordFactorService.checkStrength` to `checkPasswordStrength` for parallelism with `ensurePasswordStrength`. Callers on 1.1.0 must rename their call sites.

## 1.1.0

### Minor Changes

- 8802197: Add `hasPendingRegistration`, `checkStrength`, and `ensurePasswordStrength` to `PasswordFactorService`. `hasPendingRegistration` mirrors the email/phone/authenticator factor services for staged-registration UI flows. `checkStrength` and `ensurePasswordStrength` are pass-throughs to the injected `PasswordStrengthProvider` so callers can surface live strength feedback (e.g. a sign-up form meter) without taking a separate dependency on the provider.

## 1.0.0

### Major Changes

- 0a3a7d5: Align registration flows across factor services and decouple registration from actor binding.
  - `PhoneFactorService.registerPhoneFactor` no longer takes `actorId` (only `value` and an optional caller-supplied `registrationId`). Phone registrations are now keyed by phone number alone; the actor is bound at completion time. The "already registered as a factor" 409 check has been removed — callers that need uniqueness should enforce it before completing the registration.
  - `AuthenticatorFactorService.registerAuthenticatorFactor` is now idempotent: repeat calls for the same actor (or supplied `registrationId`) return the cached secret/uri/qrCode and `alreadyRegistered: true`. The return type now includes `issuedAt` and `alreadyRegistered`.
  - `AuthenticatorFactorService.createAuthenticatorFactorFromRegistration`, `PhoneFactorService.createPhoneFactorFromRegistration` now return the persisted factor instead of just the factor id, and clear their cached registration entries on success. `PhoneFactor`'s registration-mismatch 400 has been removed (the registration no longer tracks the actor).
  - `EmailFactorService.registerEmailFactor` and `PasswordFactorService.registerPasswordFactor` accept an optional caller-supplied `registrationId` for deterministic idempotent retries.

### Minor Changes

- bf8f78e: Add a staged registration flow to `PasswordFactorService`. New methods `registerPasswordFactor(password)` and `createPasswordFactorFromRegistration(actorId, registrationId)` let callers stage a strength-checked, hashed password in the cache before the actor record exists, then bind it to the actor in a second step. Mirrors the existing email factor registration shape. The constructor now requires a `CacheProvider` (resolved automatically by the DI container).

## 0.23.0

### Minor Changes

- afaa0af: Add OpenID Connect and OAuth 2.0 authentication factors.

  The new `OidcFactorService` (backed by `openid-client`) and `OAuth2FactorService` (adapter-based, recommended pairing with `arctic`) cover SSO sign-in, account linking, and refresh-token rotation:
  - Single-step `beginAuthorization` / `completeAuthorization` flow that mirrors the email-factor pattern.
  - Per-provider config via `OidcProviderRegistry` / `OAuth2ProviderRegistry` (Google, LinkedIn, Microsoft for OIDC; GitHub, Discord, Twitter/X for OAuth 2.0).
  - Public-client support — omit `clientSecret` and the OIDC service falls back to `None()` client auth with mandatory PKCE.
  - Optional refresh-token persistence (envelope-encrypted via `@maroonedsoftware/encryption`), opt-in per provider with `persistRefreshToken: true`.
  - Auto-link by verified email via the `OidcActorEmailLookup` / `OAuth2ActorEmailLookup` interfaces apps implement to bridge to their existing account store. Unverified email matches surface as `kind: 'new-user'` with an `emailConflict` discriminant so UIs can require sign-in to the existing account before linking.

## 0.22.0

### Minor Changes

- f7eaa33: Add `EmailFactorService.getRedirectHtml(redirectUrl)` for the magic link flow. Returns a minimal HTML page that defers navigation to `window.onload` (sidestepping mail-client URL pre-fetchers that would otherwise burn the one-time token) along with a freshly generated CSP nonce to echo in a `script-src 'nonce-…'` header. URLs that aren't `http:` or `https:` are rejected with HTTP 400.
- f7eaa33: feat: add getRedirectHtml helper for email magic link flow
  - Returns an HTML landing page that defers redirection to window.onload to defeat mail-client URL pre-fetchers, paired with a CSP nonce the caller echoes in a script-src header. Non-http(s) schemes are rejected with 400.

## 0.21.0

### Minor Changes

- 28b3a92: feat: add pending registration and challenge checks for authentication factors
  - Introduced `hasPendingRegistration` method in Authenticator, Email, and Phone factor services to verify if a registration is cached and unexpired.
  - Added `hasPendingChallenge` method in Email factor service to check for cached challenges.
  - Updated documentation to reflect new methods and their usage.
  - Enhanced unit tests to cover the new functionality for pending registrations and challenges across all factor services.

## 0.20.0

### Minor Changes

- 951a245: refactor: update email verification to email challenge
  - Renamed methods and types related to email verification to reflect a challenge-based approach, enhancing clarity in the authentication flow.
  - Updated documentation and comments to align with the new terminology, including changes from `createEmailVerification` to `issueEmailChallenge` and `verifyEmailVerification` to `verifyEmailChallenge`.
  - Adjusted caching mechanisms and payload structures to support the new challenge system.
  - Enhanced unit tests to validate the updated challenge functionality and ensure proper behavior in various scenarios.

## 0.19.0

### Minor Changes

- fab17af: refactor: enhance email and phone factor services with idempotency and cache management
  - Updated `createEmailVerification` and `registerPhoneFactor` methods to support idempotency, returning existing verifications and registrations when applicable.
  - Improved cache management by deleting cached entries after successful registrations and verifications to prevent replay attacks.
  - Adjusted return types in method documentation to reflect new properties, including `alreadyIssued` for email verifications and `value` for phone registrations.
  - Enhanced unit tests to cover new functionality and ensure proper cache behavior.

## 0.18.0

### Minor Changes

- c81ebcb: refactor: rename doesEmailExist to lookupFactor in EmailFactorRepository
  - Updated the method name from `doesEmailExist` to `lookupFactor` for clarity in the EmailFactorRepository interface.
  - Adjusted the corresponding service and test files to reflect the new method name and updated return type documentation.
  - Enhanced README documentation to describe the new method functionality.

## 0.17.0

### Minor Changes

- 82ce3aa: refactor: update authentication session handling to use Luxon DateTime and rename session token handling in authentication package
  - Changed session and factor timestamps from Unix integers to Luxon DateTime instances for improved date handling.
  - Updated serialization and deserialization methods to convert DateTime to Unix integers at the cache boundary.
  - Enhanced README documentation to reflect changes in session structure and data types.
  - Adjusted unit tests to accommodate new DateTime handling in session management.
  - Updated the naming of session token properties from `token` to `sessionToken` for clarity and consistency across the authentication module.
  - Adjusted methods and documentation to reflect the new naming convention, including `issueTokenForSession` and related session management functions.
  - Modified unit tests to ensure compatibility with the updated session token structure.

## 0.16.0

### Minor Changes

- e111278: feat: implement PKCE support in authentication package
  - Introduced `PkceProvider` for cache-backed storage of PKCE state, enabling OAuth 2.0 PKCE flows.
  - Updated `EmailFactorService` and `PhoneFactorService` to return `alreadyRegistered` flag for pending registrations, improving user experience by preventing duplicate notifications.
  - Enhanced README documentation with PKCE usage examples and details.
  - Added unit tests for `PkceProvider` and updated existing tests for email and phone factor services to cover new functionality.

### Patch Changes

- Updated dependencies [e111278]
  - @maroonedsoftware/encryption@0.4.0

## 0.15.0

### Minor Changes

- 1d79133: feat: integrate FIDO2/WebAuthn support into authentication package
  - Added FIDO2/WebAuthn factors to the authentication utilities, enabling passkey and security-key registration and sign-in via `FidoFactorService`.
  - Updated README to include FIDO2/WebAuthn usage details and examples.
  - Enhanced email factor service to check for invite-only domains during registration.
  - Refactored password strength validation to utilize a dedicated `PasswordStrengthProvider`.
  - Introduced unit tests for new FIDO factor service and updated email factor service tests to cover new domain checks.

### Patch Changes

- Updated dependencies [7624166]
- Updated dependencies [e9a18b6]
  - @maroonedsoftware/errors@1.6.0
  - @maroonedsoftware/encryption@0.3.0
  - @maroonedsoftware/cache@0.1.2

## 0.14.1

### Patch Changes

- Updated dependencies [4996c32]
  - @maroonedsoftware/encryption@0.2.0

## 0.14.0

### Minor Changes

- 5151eac: refactor: convert expiresAt to DateTime in Email and Phone factor services
  - Updated the EmailFactorService and PhoneFactorService to return expiresAt as a DateTime object instead of a raw timestamp.
  - Adjusted unit tests for both services to validate the type of expiresAt and ensure it matches the expected value.

## 0.13.0

### Minor Changes

- b07bec3: fix: correct email existence check in EmailFactorService
  - Updated the condition in the registerEmailFactor method to throw a 409 error when an email already exists.
  - Adjusted the corresponding unit test to reflect the change in logic, ensuring it now tests for the correct scenario where an email is already registered.

## 0.12.0

### Minor Changes

- f988d31: feat: implement injectable abstract classes for authentication factors
  - Added @Injectable() decorator to AuthenticatorFactorRepository, EmailFactorRepository, PasswordFactorRepository, and PhoneFactorRepository, enabling dependency injection.
  - Updated the structure of the repository classes to support better integration with the dependency injection framework.

## 0.11.0

### Minor Changes

- bc92b8e: feat: add actorId to authentication factors
  - Added actorId property to AuthenticatorFactor, EmailFactor, PasswordFactor, and PhoneFactor interfaces to associate factors with their respective actors.
  - Updated createFactor method in EmailFactorRepository to remove the verificationMethod parameter.
  - Adjusted related tests to reflect these changes, ensuring consistency across the authentication factors.

- ef3b5b1: feat: normalize email input in registerEmailFactor

## 0.10.0

### Minor Changes

- d1270bb: feat: introduce TypeScript configuration and refactor repository interfaces
  - Added a new TypeScript configuration file for tests in the authentication package.
  - Refactored repository classes for authenticator, email, password, and phone factors to use interfaces instead of abstract classes, improving clarity and flexibility.
  - Updated import statements to use type imports where applicable, enhancing type safety and reducing unnecessary runtime overhead.
  - Added unit tests for the password factor service to ensure functionality and robustness.

## 0.9.1

### Patch Changes

- Updated dependencies [4e9ccf4]
  - @maroonedsoftware/utilities@1.7.0
  - @maroonedsoftware/errors@1.5.0
  - @maroonedsoftware/cache@0.1.1
  - @maroonedsoftware/encryption@0.1.1

## 0.9.0

### Minor Changes

- 60870fc: chore - release

## 0.8.0

### Minor Changes

- 687c984: Implement cache provider for authentication services
  - Introduced a new `@maroonedsoftware/cache` package with a `CacheProvider` interface and an `IoRedisCacheProvider` implementation using ioredis.
  - Updated authentication services to utilize the new cache provider, replacing direct cache provider imports with the new package.
  - Removed the old cache provider implementation from the authentication package.
  - Added tests for the new cache provider to ensure functionality and reliability.
  - Updated README and documentation for the cache package to guide usage and implementation.

### Patch Changes

- Updated dependencies [687c984]
  - @maroonedsoftware/utilities@1.6.0
  - @maroonedsoftware/cache@0.1.0

## 0.7.0

### Minor Changes

- f9aa6d6: Updated cache retrieval methods in AuthenticationSessionService, AuthenticatorFactorService, EmailFactorService, and PhoneFactorService to remove generic type parameters for improved clarity.

## 0.6.0

### Minor Changes

- 7b70566: - Updated EmailFactorServiceOptions, PhoneFactorServiceOptions, and AuthenticatorFactorServiceOptions to use class-based structure for better type safety and immutability.

## 0.5.0

### Minor Changes

- 79fde38: Introduce server-side session management and a suite of MFA features. Adds AuthenticationSessionService and related types (AuthenticationSession, AuthenticationSessionFactor, AuthenticationToken), authenticator/email/phone factor repositories and services, OTP/JWT/cache/password-strength providers, and encryption dependency.

### Patch Changes

- Updated dependencies [5c4756a]
- Updated dependencies [bcbdcb8]
  - @maroonedsoftware/utilities@1.5.0
  - @maroonedsoftware/encryption@0.1.0

## 0.4.0

### Minor Changes

- 66949c3: Replace the session-centric authenticationId with actorId and actorType in the authentication context and invalidAuthenticationContext. Export basic authentication handler and issuer from the package index.

## 0.3.0

### Minor Changes

- 6fe8bc4: Introduce HTTP Basic auth support: add BasicAuthenticationHandler that base64-decodes the credential, validates the scheme (must be exactly "basic"), splits username:password, and delegates verification to a DI-resolved BasicAuthenticationIssuer. Add an abstract BasicAuthenticationIssuer with an async verify(username, password) contract returning an AuthenticationContext.

## 0.2.0

### Minor Changes

- 922f585: upgrading to typescript 6

### Patch Changes

- Updated dependencies [922f585]
  - @maroonedsoftware/logger@1.1.0

## 0.1.0

### Minor Changes

- e5dc109: added jwt authentication handler
