# AGENTS.md — @maroonedsoftware/authentication

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Authentication primitives, not an auth server. Six things:

1. **Scheme dispatch** — `AuthenticationSchemeHandler` parses `Authorization`, looks up a handler by
   scheme, and returns an `AuthenticationSession`. Bearer (multi-issuer JWT) and Basic ship built in.
2. **Sessions** — `AuthenticationSessionService` owns server-side sessions in a `CacheProvider`.
   A JWT is a short-lived signed _reference_ to a session; revoke the session and every token dies.
   Includes refresh-token rotation with family-based theft detection.
3. **Factors** — password, email (OTP / magic link), phone (OTP), authenticator (TOTP/HOTP),
   FIDO2/WebAuthn, OIDC, OAuth2, and single-use recovery codes. Each is a service plus an abstract
   repository you implement over your datastore.
4. **Providers** — Argon2id hashing, zxcvbn + HaveIBeenPwned strength checks, JWT, OTP, PKCE, OIDC
   and OAuth2 client registries.
5. **Policies** — eleven `@maroonedsoftware/policies` rules covering factor eligibility, MFA
   required/satisfied, recency, and assurance level.
6. **Orchestrators** — `MfaOrchestrator` and `RecoveryOrchestrator`, pure state machines over the
   factor services.

The orchestrators and services return **structured data**. They do not mint HTTP responses, do not
deliver OTP codes, and do not decide your wire contract. That is deliberate: you own the routes.

## Install

```bash
pnpm add @maroonedsoftware/authentication
```

Everything is a hard dependency — there are no optional peers. Internal: `cache`, `encryption`,
`errors`, `logger`, `policies`, `utilities`. External: `@node-rs/argon2`, `@zxcvbn-ts/*`, `arctic`,
`deepmerge-ts`, `fido2-lib`, `injectkit`, `jsonwebtoken`, `luxon`, `openid-client`, `qrcode`,
`rate-limiter-flexible`, `zxcvbn-ts`.

## Position in the graph

- **Depends on:** `cache`, `encryption`, `errors`, `logger`, `policies`, `utilities`.
- **Depended on by:** `koa` (`authenticationMiddleware`, `requirePolicy`, `ServerKitContext.authenticationSession`),
  `scim` (bearer-scope guard).
- **Subpath exports:** none. The package has no `exports` map at all — everything ships from the
  root barrel, which is large.

## API surface

This is the biggest package in the repo (~8.4k LOC, 60 files). The tables below cover every export
by area; type aliases for provider-specific payload shapes are grouped rather than enumerated.

### Session model (`src/types.ts`)

| Export                         | Kind      | Shape                                                                                                             | Notes                                                                    |
| ------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `AuthenticationSession`        | interface | `{ sessionToken, subject, issuedAt, expiresAt, lastAccessedAt, factors, claims, familyId? }`                      | All timestamps are Luxon `DateTime`.                                     |
| `AuthenticationSessionFactor`  | interface | `{ issuedAt, authenticatedAt, method, methodId, kind }`                                                           | `authenticatedAt` is what recency policies read.                         |
| `AuthenticationFactorKind`     | type      | `'knowledge' \| 'possession' \| 'biometric'`                                                                      | Classic MFA taxonomy.                                                    |
| `AuthenticationFactorMethod`   | type      | `'phone' \| 'password' \| 'authenticator' \| 'email' \| 'fido' \| 'oidc'`                                         | **Note: no `'oauth2'`.** See Gotchas.                                    |
| `invalidAuthenticationSession` | constant  | Sentinel with empty strings and `DateTime.invalid('invalid')` fields                                              | Compare by **identity**; that is what `requirePolicy` does.              |
| `SessionRevocationReason`      | type      | `'logout' \| 'rotate' \| 'theft' \| 'expiry'`                                                                     | —                                                                        |
| `AuthenticationSessionHooks`   | interface | `onSessionCreated?`, `onSessionRefreshed?`, `onSessionRevoked?`, `onValidationFailed?`, `onRefreshReuseDetected?` | Fire **after** the cache write commits. Errors logged, never propagated. |
| `AuthenticationToken`          | type      | `{ accessToken, tokenType, expiresIn, … }`                                                                        | OAuth 2.0-shaped response.                                               |

### Scheme dispatch

| Export                        | Kind           | Shape                                                                   | Notes                                                                  |
| ----------------------------- | -------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `AuthorizationScheme`         | type           | `'bearer' \| 'basic' \| string`                                         | Open for custom schemes.                                               |
| `AuthenticationHandler`       | interface      | `authenticate(scheme, value): Promise<AuthenticationSession>`           | —                                                                      |
| `AuthenticationHandlerMap`    | class          | `@Injectable() extends Map<AuthorizationScheme, AuthenticationHandler>` | Keys must be **lowercase** — see Gotchas.                              |
| `AuthenticationSchemeHandler` | class          | `@Injectable()`. `handle(authorizationHeader?)`                         | Splits on the **first** space only, so `Digest a="x", b="y"` survives. |
| `JwtAuthenticationHandler`    | class          | `implements AuthenticationHandler`                                      | Bearer.                                                                |
| `JwtAuthenticationIssuer`     | abstract class | Per-issuer JWT validation                                               | —                                                                      |
| `JwtAuthenticationIssuerMap`  | class          | `extends Map<string, JwtAuthenticationIssuer>`                          | Multi-issuer bearer support.                                           |
| `BasicAuthenticationHandler`  | class          | `implements AuthenticationHandler`                                      | —                                                                      |
| `BasicAuthenticationIssuer`   | abstract class | —                                                                       | —                                                                      |

### Sessions

| Export                                                         | Kind   | Shape                                                                             | Notes                                                  |
| -------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `AuthenticationSessionServiceOptions`                          | class  | `(issuer, audience, expiresIn: Duration, refreshExpiresIn = 30 days, hooks = {})` | A class so it is an InjectKit token.                   |
| `AuthenticationSessionService`                                 | class  | `@Injectable()`                                                                   | Backed by a `CacheProvider`.                           |
| `#createSession` / `#updateSession` / `#createOrUpdateSession` | method | —                                                                                 | —                                                      |
| `#getSession` / `#getSessionsForSubject`                       | method | —                                                                                 | The second is how you revoke every session for a user. |
| `#lookupSessionFromJwt`                                        | method | `(jwt: string, ignoreJwtExpiration?: boolean)`                                    | —                                                      |
| `#deleteSession`                                               | method | `(sessionToken, reason: SessionRevocationReason = 'logout')`                      | —                                                      |
| `#issueTokenForSession`                                        | method | `(sessionToken) => Promise<AuthenticationToken>`                                  | —                                                      |
| `#rotateSession`                                               | method | `(sessionToken, claimOverrides?, expiration?)`                                    | For privilege changes. Carries `familyId` forward.     |
| `#refreshSession`                                              | method | `(refreshToken) => Promise<AuthenticationToken>`                                  | Rotation with replay detection.                        |

### Factors

Every factor follows the same shape: a `<Name>FactorService` (+ usually a `<Name>FactorServiceOptions`
class) and an abstract `<Name>FactorRepository` you implement.

| Factor          | Service                      | Repository                      | Notes                                                                                                                             |
| --------------- | ---------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Password        | `PasswordFactorService`      | `PasswordFactorRepository`      | Types: `PasswordFactor`, `PasswordValue`.                                                                                         |
| Email           | `EmailFactorService`         | `EmailFactorRepository`         | OTP and magic link. Type: `EmailFactor`.                                                                                          |
| Phone           | `PhoneFactorService`         | `PhoneFactorRepository`         | OTP. Type: `PhoneFactor`.                                                                                                         |
| Authenticator   | `AuthenticatorFactorService` | `AuthenticatorFactorRepository` | TOTP/HOTP. Types: `AuthenticatorFactor`, `AuthenticatorFactorOptions`.                                                            |
| FIDO / WebAuthn | `FidoFactorService`          | `FidoFactorRepository`          | Types: `FidoFactor`, `PublicKeyCredential*`, `AuthenticatorTransport`, `RegisterFidoFactorOptions`, `AuthorizeFidoFactorOptions`. |
| OIDC            | `OidcFactorService`          | `OidcFactorRepository`          | Plus `OidcActorEmailLookup`, `OidcProfile`, `OidcAuthorizationResult`, `OidcAuthenticatedExchange`.                               |
| OAuth2          | `OAuth2FactorService`        | `OAuth2FactorRepository`        | Plus `OAuth2ActorEmailLookup`, `OAuth2Profile`, `OAuth2Tokens`.                                                                   |
| Recovery codes  | `RecoveryFactorService`      | `RecoveryCodeFactorRepository`  | Single-use. Types: `RecoveryCodeFactor`, `RecoveryCodeValue`.                                                                     |

| Export                                                | Kind      | Shape                                                                                     | Notes                                       |
| ----------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- | ------------------------------------------- |
| `Factor`                                              | interface | `{ id, actorId, active }`                                                                 | The base every factor extends.              |
| `FactorRepository<TFactor, CreateValue, LookupValue>` | interface | `createFactor`, `listFactors`, `lookupFactor`, `findFactor?`, `getFactor`, `deleteFactor` | `findFactor` is **optional** — see Gotchas. |
| `AuthorizationCallbackParams`                         | type      | OAuth/OIDC callback query shape                                                           | —                                           |

### Providers

| Export                                                    | Kind           | Notes                                                                                                                             |
| --------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `PasswordHashProvider`                                    | abstract class | The DI token.                                                                                                                     |
| `Argon2idPasswordHashProvider`                            | class          | Uses `ARGON2ID_DEFAULTS` from `@maroonedsoftware/encryption`. Result type `PasswordHashResult`.                                   |
| `PasswordStrengthProvider`                                | class          | zxcvbn-ts (English dictionary + adjacency graphs) **plus a live HaveIBeenPwned check**. Score 0–4; `ensureStrength` requires ≥ 3. |
| `JwtProvider`                                             | class          | —                                                                                                                                 |
| `OtpProvider`                                             | class          | Types: `OtpType`, `OtpOptions`, `TotpOptions`, `HotpOptions`, `OtpUrlOptions`, `OtpValidationOptions`, `defaultOtpOptions`.       |
| `OtpProviderMock`                                         | class          | `extends OtpProvider`. Tests only.                                                                                                |
| `PkceProvider`                                            | class          | —                                                                                                                                 |
| `OidcProviderRegistry` / `OidcProviderRegistryConfig`     | class          | Types: `OidcProviderConfig`.                                                                                                      |
| `OAuth2ProviderRegistry` / `OAuth2ProviderRegistryConfig` | class          | Types: `OAuth2ProviderConfig`, `OAuth2ProviderClient`.                                                                            |
| `HtmlRedirectProvider`                                    | class          | —                                                                                                                                 |

### Policies

| Policy name                          | Class                              | Context type                              |
| ------------------------------------ | ---------------------------------- | ----------------------------------------- |
| `auth.factor.email.allowed`          | `EmailAllowedPolicy`               | `EmailAllowedPolicyContext`               |
| `auth.factor.phone.allowed`          | `PhoneAllowedPolicy`               | `PhoneAllowedPolicyContext`               |
| `auth.factor.password.allowed`       | `PasswordAllowedPolicy`            | `PasswordAllowedPolicyContext`            |
| `auth.factor.oidc.profile.allowed`   | `OidcProfileAllowedPolicy`         | `OidcProfileAllowedPolicyContext`         |
| `auth.factor.oauth2.profile.allowed` | `OAuth2ProfileAllowedPolicy`       | `OAuth2ProfileAllowedPolicyContext`       |
| `auth.session.mfa.required`          | `DefaultMfaRequiredPolicy`         | `AuthMfaRequiredPolicyContext`            |
| `auth.session.mfa.satisfied`         | `DefaultMfaSatisfiedPolicy`        | `AuthMfaSatisfiedPolicyContext`           |
| `auth.session.recent.factor`         | `DefaultRecentFactorPolicy`        | `AuthRecentFactorPolicyContext`           |
| `auth.session.assurance.level`       | `DefaultAssuranceLevelPolicy`      | `AuthAssuranceLevelPolicyContext`         |
| `auth.recovery.allowed`              | `RecoveryAllowedPolicy`            | `RecoveryAllowedPolicyContext`            |
| `auth.support.verification.allowed`  | `SupportVerificationAllowedPolicy` | `SupportVerificationAllowedPolicyContext` |

| Export                         | Kind     | Shape                                                    | Notes                                                           |
| ------------------------------ | -------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| `AuthenticationPolicyNames`    | type     | Union of the eleven names above                          | —                                                               |
| `AuthenticationPolicyMappings` | constant | `Record<AuthenticationPolicyNames, Constructor<Policy>>` | Spread into your `PolicyRegistryMap`.                           |
| `AuthenticationPolicyContexts` | type     | `Record<AuthenticationPolicyNames, …Context>`            | Intersect with your own `Policies` map for `BasePolicyService`. |

`auth.session.mfa.satisfied` is the default `requirePolicy()` gate in `@maroonedsoftware/koa`.

### Orchestrators

| Export                                                               | Kind              | Shape                                                                                                                                                                                                                                                                                                                            | Notes                                 |
| -------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `MfaOrchestrator`                                                    | class             | `issueOrChallenge`, `issueFactorChallenge`, `completeMfa`                                                                                                                                                                                                                                                                        | Consults `auth.session.mfa.required`. |
| `MfaChallengeService` / `…Options`                                   | class             | Stashes and redeems challenges                                                                                                                                                                                                                                                                                                   | Challenges are single-use.            |
| MFA types                                                            | —                 | `MfaChallengePayload`, `MfaEligibleFactor`, `IssueOrChallengeResult`, `CompleteMfaResult`, `FactorChallengeStartRequest`, `FactorChallengeStartResponse`, `FactorChallengeProof`, `TargetActor`                                                                                                                                  | —                                     |
| `RecoveryOrchestrator`                                               | class             | `initiateRecovery`, `issueChannelChallenge`, `verifyChannel`, `completeRecovery`                                                                                                                                                                                                                                                 | Consults `auth.recovery.allowed`.     |
| `RecoveryChallengeService` / `RecoverySessionService` (+ `…Options`) | class             | —                                                                                                                                                                                                                                                                                                                                | —                                     |
| `RecoveryOrchestratorHooks` / `RecoveryOrchestratorHooksProvider`    | interface / class | —                                                                                                                                                                                                                                                                                                                                | —                                     |
| Recovery types                                                       | —                 | `RecoveryReason`, `RecoveryChannel`, `RecoveryAction`, `RecoveryActionKind`, `RecoveryIdentifier`, `RecoveryProof`, `RecoveryEligibleChannel`, `InitiateRecoveryInput/Result`, `VerifyChannelResult`, `CompleteRecoveryResult`, `RecoverySessionPayload`, `RecoveryChallengePayload`, `RecoveryChannelChallengeRequest/Response` | —                                     |

### Support verification

| Export                                                                                           | Kind           | Notes                                                 |
| ------------------------------------------------------------------------------------------------ | -------------- | ----------------------------------------------------- |
| `SupportVerificationCodeService` (+ `…Options`)                                                  | class          | Verify a caller's identity in a support conversation. |
| `SupportVerificationSecretRepository`                                                            | abstract class | —                                                     |
| `SupportVerificationSecret`, `SupportVerificationIssueResult`, `SupportVerificationVerifyResult` | interfaces     | —                                                     |

### Helpers (`src/helpers.ts`)

| Export                     | Kind     | Shape                                                                               | Notes                                       |
| -------------------------- | -------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| `matchesFactorConstraints` | function | Matches a session factor against a `StepUpRequirement`-style constraint set         | Used by the recency and assurance policies. |
| `isFactorRecent`           | function | `(factor: AuthenticationSessionFactor, now: DateTime, within: Duration) => boolean` | —                                           |

## Canonical usage

```typescript
import {
  AuthenticationSchemeHandler,
  AuthenticationHandlerMap,
  JwtAuthenticationHandler,
  JwtAuthenticationIssuerMap,
  AuthenticationSessionService,
  AuthenticationSessionServiceOptions,
  AuthenticationPolicyMappings,
  type AuthenticationPolicyContexts,
} from '@maroonedsoftware/authentication';
import { Duration } from 'luxon';

// Scheme dispatch — keys MUST be lowercase
const handlers = new AuthenticationHandlerMap();
handlers.set('bearer', container.get(JwtAuthenticationHandler));

registry.register(AuthenticationHandlerMap).useValue(handlers);
registry.register(AuthenticationSchemeHandler).useClass(AuthenticationSchemeHandler);

// Sessions
registry.register(AuthenticationSessionServiceOptions).useValue(
  new AuthenticationSessionServiceOptions(
    'https://auth.example.com',
    ['https://api.example.com'],
    Duration.fromObject({ minutes: 15 }),
    Duration.fromObject({ days: 30 }),
    {
      onRefreshReuseDetected: async ({ familyId, jti }) => alerts.refreshTokenReplay(familyId, jti),
    },
  ),
);

// Policies — bundled mappings spread into your registry
const policies = new PolicyRegistryMap();
for (const [name, cls] of Object.entries(AuthenticationPolicyMappings)) policies.set(name, cls);

type AppPolicies = AuthenticationPolicyContexts & { 'billing.active': { subject: string } };
```

The MFA flow — the orchestrator is a state machine, you own delivery and token minting:

```typescript
// 1. Primary factor succeeded
const result = await mfa.issueOrChallenge(actor, primaryFactor);

if (result.kind === 'allow') {
  const session = await sessions.createSession(actor.id, claims, primaryFactor);
  return sessions.issueTokenForSession(session.sessionToken);
}

// 2. Client picked a method — you deliver the code out of band
const challenge = await mfa.issueFactorChallenge(result.mfaChallengeId, { method: 'phone' });
if (challenge.code) await sms.send(challenge.recipient, challenge.code);

// 3. Client submitted the proof
const completed = await mfa.completeMfa(result.mfaChallengeId, { method: 'phone', code });
const session = await sessions.createSession(completed.actor.id, claims, completed.primaryFactor, completed.secondaryFactor);
```

## Rules for generated code

- **Register `AuthenticationHandlerMap` keys in lowercase.** The scheme handler lowercases the
  inbound scheme before lookup, so a `'Bearer'` key never matches.
- Compare against `invalidAuthenticationSession` by identity (`===`), not by inspecting fields.
- Implement `FactorRepository` methods per factor. Implement `findFactor` only when the lookup value
  is genuinely globally unique (email, OIDC `sub`, FIDO credential id) — see Gotchas.
- The orchestrators do **not** deliver codes. `issueFactorChallenge` returns the code and recipient
  for `phone` and `email`; sending it via SMS or email is yours.
- The orchestrators do **not** mint sessions. Call `createSession` / `issueTokenForSession` yourself
  from the returned data.
- **`RecoveryOrchestrator` does not invalidate existing sessions.** After `resetPassword` or
  `fullRecovery`, enumerate `getSessionsForSubject(actorId)` and delete each one, or prior tokens
  keep working.
- Register `AuthenticationSessionHooks` for audit and alerting rather than wrapping the service.
  Wire `onRefreshReuseDetected` to a real alert — it is a token-theft signal.
- Spread `AuthenticationPolicyMappings` into your `PolicyRegistryMap` rather than listing eleven
  bindings, and intersect `AuthenticationPolicyContexts` into your `Policies` type.
- Use `requirePolicy()` from `@maroonedsoftware/koa` on routes rather than reading
  `ctx.authenticationSession` and branching by hand.
- Never log a session token, refresh token, OTP code, or password.
- Use Luxon `Duration` for every lifetime.
- Rotate rather than mutate: `rotateSession` on a privilege change, so `familyId` and theft
  detection stay intact.

## Gotchas

- **`AuthenticationFactorMethod` has no `'oauth2'` member**, despite `OAuth2FactorService` existing.
  An OAuth2 login has to be recorded under one of the six listed methods (`'oidc'` is the usual
  choice). Do not assume the factor list and the service list line up.
- **`PasswordStrengthProvider` makes a live network call.** The HaveIBeenPwned matcher is wired to
  `fetch` in the constructor, so every strength check hits an external API. That means latency on
  your signup path, and a hard dependency on outbound network in tests. Stub the provider in tests.
- **`ensureStrength` requires a score of 3 or higher** out of 4. That is stricter than many products
  expect and it throws rather than returning a result.
- **Hooks are fire-and-forget from the caller's perspective.** They run after the cache commits, are
  awaited sequentially, and their errors are logged but never propagated — deliberately, so a
  failing audit sink cannot break login. A hook that silently fails is invisible unless you watch
  logs.
- **`FactorRepository.findFactor` is optional.** A service path that needs global lookup against a
  repository that did not implement it fails at runtime, not at compile time.
- **Recovery deliberately cannot be used to probe for account existence.** An unknown identifier
  still returns a challenge, with an empty `eligibleChannels` list. Do not "fix" that by returning
  a 404.
- **`invalidAuthenticationSession` has `DateTime.invalid(...)` fields.** Any arithmetic on them
  yields invalid `DateTime`s rather than throwing, so a missed identity check propagates silently.
- **The scheme handler splits on the first space only**, so schemes with space-separated parameters
  reach the handler intact. A handler that splits again on spaces will corrupt them.
- **Session tokens are the revocation unit, JWTs are not.** A JWT stays cryptographically valid
  until its own `exp`; what makes revocation work is that `lookupSessionFromJwt` checks the cache.
  A validation path that only verifies the signature bypasses revocation entirely.
- **`ARGON2ID_DEFAULTS` is shared with `@maroonedsoftware/encryption`.** Changing the parameters
  there invalidates every existing password hash here.
- **The root barrel is very large** and re-exports 60 files. Import what you need; do not
  `import * as auth`.

## Working inside this package

```
src/
  types.ts                        Session model, factor kinds/methods, hooks, sentinel, token shape
  authentication.handler.ts       AuthenticationHandler, AuthorizationScheme
  authentication.scheme.handler.ts  AuthenticationHandlerMap, AuthenticationSchemeHandler
  authentication.session.service.ts Sessions, rotation, refresh + theft detection
  helpers.ts                      matchesFactorConstraints, isFactorRecent
  jwt/                            JwtAuthenticationHandler, JwtAuthenticationIssuer(+Map)
  basic/                          BasicAuthenticationHandler, BasicAuthenticationIssuer
  factors/
    factor.repository.ts          Factor, FactorRepository
    authorization.callback.types.ts
    password/ email/ phone/ authenticator/ fido/ oidc/ oauth2/ recovery/
                                  each: <name>.factor.service.ts + <name>.factor.repository.ts
  providers/                      argon2id.password.hash, password.hash, password.strength, jwt,
                                  otp (+ mock), pkce, oidc, oauth2, html.redirect
  policies/                       eleven policies + policy.mappings.ts
  mfa/                            types, mfa.challenge.service, mfa.orchestrator
  recovery/                       types, recovery.challenge.service, recovery.session.service,
                                  recovery.orchestrator
  support/                        types, support.verification.secret.repository,
                                  support.verification.code.service
  index.ts                        Barrel
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **The orchestrators stay pure state machines.** No HTTP shapes, no session minting, no code
  delivery. That separation is what lets one orchestrator serve every app's wire contract.
- Sessions are authoritative and JWTs are references. Any validation path must consult the session
  store, or revocation stops working.
- Refresh-token family tracking is a security control: replaying a consumed token must revoke the
  whole family before `onRefreshReuseDetected` fires.
- Hook failures must stay non-propagating.
- `AuthenticationPolicyMappings` and `AuthenticationPolicyContexts` must stay in sync with
  `AuthenticationPolicyNames`. All three live in `policy.mappings.ts` for exactly that reason.
- Recovery must not leak account existence.
- Password hashing parameters are shared with `@maroonedsoftware/encryption`; changing them is a
  data migration, not a tuning change.
- `cache`, `encryption`, `errors`, `logger`, `policies`, and `utilities` are the internal
  dependencies. `koa` must not become one — the arrow points the other way.

User-visible changes need a changeset in `.changeset/`.
