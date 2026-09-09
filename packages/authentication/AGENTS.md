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

| Export                         | Kind      | Shape                                                                                                             | Notes                                                                                             |
| ------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `AuthenticationSession`        | interface | `{ sessionToken, subject, issuedAt, expiresAt, lastAccessedAt, factors, claims, familyId? }`                      | All timestamps are Luxon `DateTime`.                                                              |
| `AuthenticationSessionFactor`  | interface | `{ issuedAt, authenticatedAt, method, methodId, kind }`                                                           | `authenticatedAt` is what recency policies read.                                                  |
| `AuthenticationFactorKind`     | type      | `'knowledge' \| 'possession' \| 'biometric'`                                                                      | Classic MFA taxonomy.                                                                             |
| `AuthenticationFactorMethod`   | type      | `'phone' \| 'password' \| 'authenticator' \| 'email' \| 'fido' \| 'oidc' \| 'apikey'`                             | **Note: no `'oauth2'`.** See Gotchas. `'apikey'` is a machine credential, not an enrolled factor. |
| `invalidAuthenticationSession` | constant  | Sentinel with empty strings and `DateTime.invalid('invalid')` fields                                              | Compare by **identity**; that is what `requirePolicy` does.                                       |
| `SessionRevocationReason`      | type      | `'logout' \| 'rotate' \| 'theft' \| 'expiry'`                                                                     | —                                                                                                 |
| `AuthenticationSessionHooks`   | interface | `onSessionCreated?`, `onSessionRefreshed?`, `onSessionRevoked?`, `onValidationFailed?`, `onRefreshReuseDetected?` | **Deprecated** — bind an `AuditSink`. Still fires. Errors logged, never propagated.               |
| `AuthenticationToken`          | type      | `{ accessToken, tokenType, expiresIn, … }`                                                                        | OAuth 2.0-shaped response.                                                                        |

### Scheme dispatch

| Export                         | Kind           | Shape                                                                   | Notes                                                                    |
| ------------------------------ | -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `AuthorizationScheme`          | type           | `'bearer' \| 'basic' \| string`                                         | Open for custom schemes.                                                 |
| `AuthenticationHandler`        | interface      | `authenticate(scheme, value): Promise<AuthenticationSession>`           | —                                                                        |
| `AuthenticationHandlerMap`     | class          | `@Injectable() extends Map<AuthorizationScheme, AuthenticationHandler>` | Keys must be **lowercase** — see Gotchas.                                |
| `AuthenticationSchemeHandler`  | class          | `@Injectable()`. `handle(authorizationHeader?)`                         | Splits on the **first** space only, so `Digest a="x", b="y"` survives.   |
| `ChainedAuthenticationHandler` | class          | `@Injectable() implements AuthenticationHandler`                        | Tries an `AuthenticationHandlerChain` in order; first non-sentinel wins. |
| `AuthenticationHandlerChain`   | class          | `@Injectable() extends Array<AuthenticationHandler>`                    | Register with `useArray(…).push(…)`; registration order is try order.    |
| `JwtAuthenticationHandler`     | class          | `implements AuthenticationHandler`                                      | Bearer.                                                                  |
| `JwtAuthenticationIssuer`      | abstract class | Per-issuer JWT validation                                               | —                                                                        |
| `JwtAuthenticationIssuerMap`   | class          | `extends Map<string, JwtAuthenticationIssuer>`                          | Multi-issuer bearer support.                                             |
| `BasicAuthenticationHandler`   | class          | `implements AuthenticationHandler`                                      | —                                                                        |
| `BasicAuthenticationIssuer`    | abstract class | —                                                                       | —                                                                        |
| `ApiKeyAuthenticationHandler`  | class          | `implements AuthenticationHandler`                                      | Put it **first** in a chain: declines on prefix with no I/O.             |

### Sessions

| Export                                                         | Kind   | Shape                                                                             | Notes                                                   |
| -------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `AuthenticationSessionServiceOptions`                          | class  | `(issuer, audience, expiresIn: Duration, refreshExpiresIn = 30 days, hooks = {})` | A class so it is an InjectKit token.                    |
| `AuthenticationSessionService`                                 | class  | `@Injectable()`                                                                   | Backed by a `CacheProvider`.                            |
| `#createSession` / `#updateSession` / `#createOrUpdateSession` | method | —                                                                                 | —                                                       |
| `#getSession` / `#getSessionsForSubject`                       | method | —                                                                                 | Read paths; `#revokeAllForSubject` does the revoking.   |
| `#revokeAllForSubject`                                         | method | `(subject: string, reason?: SessionRevocationReason) => Promise<number>`          | Revokes every session for a subject; returns the count. |
| `#lookupSessionFromJwt`                                        | method | `(jwt: string, ignoreJwtExpiration?: boolean)`                                    | —                                                       |
| `#deleteSession`                                               | method | `(sessionToken, reason: SessionRevocationReason = 'logout')`                      | —                                                       |
| `#issueTokenForSession`                                        | method | `(sessionToken) => Promise<AuthenticationToken>`                                  | —                                                       |
| `#rotateSession`                                               | method | `(sessionToken, claimOverrides?, expiration?)`                                    | For privilege changes. Carries `familyId` forward.      |
| `#refreshSession`                                              | method | `(refreshToken) => Promise<AuthenticationToken>`                                  | Rotation with replay detection.                         |

### Factors

Every factor follows the same shape: a `<Name>FactorService` (+ usually a `<Name>FactorServiceOptions`
class) and an abstract `<Name>FactorRepository` you implement.

| Factor          | Service                      | Repository                      | Notes                                                                                                                             |
| --------------- | ---------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Password        | `PasswordFactorService`      | `PasswordFactorRepository`      | Types: `PasswordFactor`, `PasswordValue`.                                                                                         |
| Email           | `EmailFactorService`         | `EmailFactorRepository`         | OTP and magic link, one pending challenge slot each. Type: `EmailFactor`.                                                         |
| Phone           | `PhoneFactorService`         | `PhoneFactorRepository`         | OTP. Type: `PhoneFactor`.                                                                                                         |
| Authenticator   | `AuthenticatorFactorService` | `AuthenticatorFactorRepository` | TOTP/HOTP. Types: `AuthenticatorFactor`, `AuthenticatorFactorOptions`. The repository must implement `updateFactorCounter`.       |
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

| Export                                                    | Kind           | Notes                                                                                                                                                                                                      |
| --------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PasswordHashProvider`                                    | abstract class | The DI token.                                                                                                                                                                                              |
| `Argon2idPasswordHashProvider`                            | class          | Uses `ARGON2ID_DEFAULTS` from `@maroonedsoftware/encryption`. Result type `PasswordHashResult`.                                                                                                            |
| `PasswordStrengthProvider`                                | class          | zxcvbn-ts (English dictionary + adjacency graphs) **plus a live HaveIBeenPwned check**. Score 0–4; `ensureStrength` requires ≥ 3.                                                                          |
| `JwtProvider`                                             | class          | —                                                                                                                                                                                                          |
| `OtpProvider`                                             | class          | `validate` returns a boolean; `validateWithCounter` returns the matching step. Types: `OtpType`, `OtpOptions`, `TotpOptions`, `HotpOptions`, `OtpUrlOptions`, `OtpValidationOptions`, `defaultOtpOptions`. |
| `OtpProviderMock`                                         | class          | `extends OtpProvider`. Tests only.                                                                                                                                                                         |
| `PkceProvider`                                            | class          | —                                                                                                                                                                                                          |
| `OidcProviderRegistry` / `OidcProviderRegistryConfig`     | class          | Types: `OidcProviderConfig`.                                                                                                                                                                               |
| `OAuth2ProviderRegistry` / `OAuth2ProviderRegistryConfig` | class          | Types: `OAuth2ProviderConfig`, `OAuth2ProviderClient`.                                                                                                                                                     |
| `HtmlRedirectProvider`                                    | class          | —                                                                                                                                                                                                          |

### Policies

| Policy name                             | Class                              | Context type                              |
| --------------------------------------- | ---------------------------------- | ----------------------------------------- |
| `auth.factor.email.allowed`             | `EmailAllowedPolicy`               | `EmailAllowedPolicyContext`               |
| `auth.factor.phone.allowed`             | `PhoneAllowedPolicy`               | `PhoneAllowedPolicyContext`               |
| `auth.factor.password.allowed`          | `PasswordAllowedPolicy`            | `PasswordAllowedPolicyContext`            |
| `auth.factor.oidc.profile.allowed`      | `OidcProfileAllowedPolicy`         | `OidcProfileAllowedPolicyContext`         |
| `auth.factor.oauth2.profile.allowed`    | `OAuth2ProfileAllowedPolicy`       | `OAuth2ProfileAllowedPolicyContext`       |
| `auth.session.mfa.required`             | `DefaultMfaRequiredPolicy`         | `AuthMfaRequiredPolicyContext`            |
| `auth.session.mfa.satisfied`            | `DefaultMfaSatisfiedPolicy`        | `AuthMfaSatisfiedPolicyContext`           |
| `auth.session.recent.factor`            | `DefaultRecentFactorPolicy`        | `AuthRecentFactorPolicyContext`           |
| `auth.session.assurance.level`          | `DefaultAssuranceLevelPolicy`      | `AuthAssuranceLevelPolicyContext`         |
| `auth.recovery.allowed`                 | `RecoveryAllowedPolicy`            | `RecoveryAllowedPolicyContext`            |
| `auth.support.verification.allowed`     | `SupportVerificationAllowedPolicy` | `SupportVerificationAllowedPolicyContext` |
| `auth.api.key.allowed`                  | `ApiKeyAllowedPolicy`              | `ApiKeyAllowedPolicyContext`              |
| `auth.session.api.key`                  | `ApiKeySessionPolicy`              | `ApiKeySessionPolicyContext`              |
| `auth.session.mfa.satisfied.or.api.key` | `MfaSatisfiedOrApiKeyPolicy`       | `AuthMfaSatisfiedPolicyContext`           |

| Export                         | Kind     | Shape                                                    | Notes                                                           |
| ------------------------------ | -------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| `AuthenticationPolicyNames`    | type     | Union of the fourteen names above                        | —                                                               |
| `AuthenticationPolicyMappings` | constant | `Record<AuthenticationPolicyNames, Constructor<Policy>>` | Spread into your `PolicyRegistryMap`.                           |
| `AuthenticationPolicyContexts` | type     | `Record<AuthenticationPolicyNames, …Context>`            | Intersect with your own `Policies` map for `BasePolicyService`. |
| `MFA_SATISFIED_POLICY`         | constant | `'auth.session.mfa.satisfied'`                           | The one policy name exported as a constant — see below.         |

`auth.session.mfa.satisfied` is the default `requirePolicy()` gate in `@maroonedsoftware/koa` and
`@maroonedsoftware/fastify`, and it is the only name of the eleven exported as a constant,
`MFA_SATISFIED_POLICY`. Reference it rather than the literal wherever code mirrors that HTTP
default off the route path — a `@maroonedsoftware/mcp` tool passing it to `requireMcpPolicy`, say
— so the two cannot drift. The other ten are still spelled as literals.

### Orchestrators

| Export                                                               | Kind              | Shape                                                                                                                                                                                                                                                                                                                            | Notes                                 |
| -------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `MfaOrchestrator`                                                    | class             | `issueOrChallenge`, `issueFactorChallenge`, `completeMfa`                                                                                                                                                                                                                                                                        | Consults `auth.session.mfa.required`. |
| `MfaChallengeService` / `…Options`                                   | class             | Stashes and redeems challenges; `lockForCompletion` / `releaseCompletionLock` bound one in-flight completion                                                                                                                                                                                                                     | Challenges are single-use.            |
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

### API keys (`src/apikey/`)

| Export                                                                   | Kind           | Notes                                                                                   |
| ------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------- |
| `ApiKeyService` (+ `…Options`)                                           | class          | Issue, validate, rotate, revoke. `authenticate(token)` mints the session.               |
| `API_KEY_SESSION_POLICY`, `MFA_SATISFIED_OR_API_KEY_POLICY`              | constants      | Policy names for machine routes. `requirePolicy()`'s default rejects key sessions.      |
| `getApiKeyClaim`                                                         | function       | `(session) => ApiKeySessionClaim \| undefined`. How a rule spots a machine caller.      |
| `ApiKeyRepository`                                                       | abstract class | `secretHash` needs a **unique index**; it is the hot-path lookup key.                   |
| `ApiKey`, `ApiKeyCreateInput`, `ApiKeyUpdate`, `ApiKeyIssued`            | interfaces     | `ApiKeyIssued.token` is the only place the plaintext token exists.                      |
| `ApiKeyValidation`, `ApiKeyRejectionReason`                              | types          | Discriminated result, never a throw — a handler that throws stops the chain.            |
| `ApiKeySessionClaim`                                                     | interface      | Placed at `session.claims.apiKey`. Its presence is how a policy spots a machine caller. |
| `formatApiKeyToken`, `parseApiKeyToken`, `hashApiKeyToken`, `apiKeyHint` | functions      | `{prefix}_{type}_{body}{crc32}`. Parse is checksum-verified and does no I/O.            |
| `encodeBase62`, `crc32`                                                  | functions      | Pure codec pieces. `encodeBase62` pads to a constant width — see Gotchas.               |

### Audit (`src/audit/`)

| Export                                                      | Kind           | Notes                                                                                       |
| ----------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `AuditSink`                                                 | abstract class | The consumer's seam. `record(event)`. Unbound, nothing is recorded.                         |
| `AuditRecorder` (+ `AuditOptions`)                          | class          | Stamps `occurredAt` and applies the failure policy. Services inject **this**, not the sink. |
| `NoopAuditSink`, `LoggingAuditSink`, `CompositeAuditSink`   | classes        | Composite offers the event to every member, then rethrows what failed.                      |
| `AuditEvent`, `AuthenticationAuditEvent`, `AuditEventInput` | types          | `AuditEvent<TType, TData>` is how a domain declares its events.                             |
| `SessionAuditEvent`, `ApiKeyAuditEvent`                     | types          | The domains emitting today; `AuthenticationAuditEvent` unions them.                         |
| `AuditSessionData`, `AuditApiKeyData`, `AuditSessionFactor` | interfaces     | Event payloads. `AuditSessionData.claims` passes through whole — see Gotchas.               |
| `AuditEventBase`, `AuditEventContext`                       | interfaces     | `context` is filled by the app's sink, never by this package. See Gotchas.                  |
| `AuditEventCategory`, `AuditOutcome`                        | types          | `'failure'` always means a credential verdict, never an infrastructure fault.               |
| `AUDIT_SINK_FAILED_EVENT`                                   | constant       | Logged when a sink throws outside strict mode. **Alert on it.**                             |

### Helpers (`src/helpers.ts`)

| Export                     | Kind     | Shape                                                                               | Notes                                                   |
| -------------------------- | -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `matchesFactorConstraints` | function | Matches a session factor against a `StepUpRequirement`-style constraint set         | Used by the recency and assurance policies.             |
| `isFactorRecent`           | function | `(factor: AuthenticationSessionFactor, now: DateTime, within: Duration) => boolean` | —                                                       |
| `maskEmail`                | function | `(value: string) => string` — `jordan@example.com` → `j*****@example.com`           | Used for pre-auth channel labels.                       |
| `maskPhone`                | function | `(value: string) => string` — `+12025550123` → `•••• 23`                            | Used for pre-auth channel labels.                       |
| `timingSafeCompare`        | function | `(a: string, b: string) => boolean` — constant-time secret comparison               | Compares byte lengths, so multibyte input cannot throw. |

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
registry.register(JwtAuthenticationHandler).useClass(JwtAuthenticationHandler).asSingleton();

registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap).set('bearer', JwtAuthenticationHandler);
registry.register(AuthenticationSchemeHandler).useClass(AuthenticationSchemeHandler);

// Two kinds of credential on one scheme: chain them, most specific first.
// registry.register(AuthenticationHandlerChain).useArray(AuthenticationHandlerChain)
//   .push(McpAuthenticationHandler)
//   .push(JwtAuthenticationHandler);
// registry.register(ChainedAuthenticationHandler).useClass(ChainedAuthenticationHandler).asSingleton();
// registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap).set('bearer', ChainedAuthenticationHandler);

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
- **A handler declines by returning the sentinel, and throws only for misconfiguration.**
  `ChainedAuthenticationHandler` relies on that split: a sentinel moves to the next handler, a
  throw stops the chain. A handler that threw on a bad credential would make one member of a
  chain able to reject a credential meant for another.
- **One handler per scheme.** To put two kinds of credential on `bearer` (a session JWT and a
  service's static token, say), register `ChainedAuthenticationHandler` for the scheme and put the
  real handlers in an `AuthenticationHandlerChain`, most specific first.
- Implement `FactorRepository` methods per factor. Implement `findFactor` only when the lookup value
  is genuinely globally unique (email, OIDC `sub`, FIDO credential id) — see Gotchas.
- The orchestrators do **not** deliver codes. `issueFactorChallenge` returns the code and recipient
  for `phone` and `email`; sending it via SMS or email is yours.
- **An email factor holds one pending challenge slot per verification method.** `alreadyIssued` is
  answered per method, so a pending OTP never suppresses a magic link send (or the reverse), and
  redeeming one method leaves the other's challenge pending. Pass the expected method as the third
  argument to `verifyEmailChallenge` (or as `issueMethod` on an email `FactorChallengeProof` /
  `RecoveryProof`) on any route that serves only one flow: a mismatch is refused with a 404 before
  the code is checked, so a magic link callback cannot be used to guess at an OTP.
- The orchestrators do **not** mint sessions. Call `createSession` / `issueTokenForSession` yourself
  from the returned data.
- **Authenticator codes are single-use, and the repository has to help.** `validateFactor` advances
  an HOTP factor's stored `counter` past the matching step via
  `AuthenticatorFactorRepository.updateFactorCounter`, and marks a consumed TOTP step in cache under
  `authenticator_factor_consumed_{actorId}_{factorId}_{step}`. A repository that no-ops
  `updateFactorCounter` leaves HOTP codes valid forever.
- **`completeMfa` checks eligibility twice, on purpose.** The method (and, for an authenticator
  proof, the `methodId`) is checked before the proof reaches a factor service, so an ineligible
  proof cannot spend the single-use sub-challenge behind it; the full `methodId` check runs again
  after verification, because challenge-based proofs only resolve to a factor at that point. One
  completion runs at a time: a concurrent second call gets a 409, and the lock is released when a
  proof fails so a typo does not strand the challenge.
- **`RecoveryOrchestrator` revokes sessions only when it was given the session service.**
  `resetPassword` and `fullRecovery` call `revokeAllForSubject(actorId, 'recovery')` when an
  `AuthenticationSessionService` was passed to the constructor (bind it in DI and this is the
  default). Construct the orchestrator without one and prior tokens keep working until the caller
  revokes them.
- **Bind an `AuditSink` for audit.** It covers the whole package, carries a common envelope, and
  attributes an `actorId` the session hooks cannot. `AuthenticationSessionHooks` is the deprecated
  predecessor and still fires; wire `onRefreshReuseDetected` to a real alert either way, since it is
  a token-theft signal.
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
- **API keys are hashed with SHA-256, not Argon2id.** A 32-byte random token cannot be guessed, so
  a memory-hard KDF on the authentication hot path buys nothing and costs a denial-of-service
  vector. The single digest is also what makes `secretHash` an index key, so validation is one read
  rather than a scan-and-verify over every active hash. Do not "upgrade" it to a password hash.
- **An API key session has one factor, so `requirePolicy()` rejects it.** That is deliberate: a
  machine credential must not reach an MFA-gated route by accident. Machine routes opt in with
  `API_KEY_SESSION_POLICY`, or `MFA_SATISFIED_OR_API_KEY_POLICY` for a route serving both.
- **Nothing revokes an API key when its owner is deleted.** This package does not know your account
  lifecycle. Call `ApiKeyService.revokeAllForOwner` from your own block and delete flows.
- **`'auth.api.key.allowed'` runs on every machine request** with `operation: 'validate'`. Keep any
  override cheap and cache anything that needs I/O.
- **`PasswordStrengthProvider` makes a live network call.** The HaveIBeenPwned matcher is wired to
  `fetch` in the constructor, so every strength check hits an external API. That means latency on
  your signup path, and a hard dependency on outbound network in tests. Stub the provider in tests.
- **`ensureStrength` requires a score of 3 or higher** out of 4. That is stricter than many products
  expect and it throws rather than returning a result.
- **Hooks are fire-and-forget from the caller's perspective.** They run after the cache commits, are
  awaited sequentially, and their errors are logged but never propagated. A hook that silently fails
  is invisible unless you watch logs.
- **An audit sink failure is swallowed by default, but it is logged.** `AuditRecorder` catches, logs
  `AUDIT_SINK_FAILED_EVENT` at `error`, and lets the operation continue, so an audit store outage
  cannot become a login outage. Alert on that event or the outage is invisible. `AuditOptions.strict`
  inverts it: a sink failure aborts the operation, which is what some compliance regimes require and
  which makes a sink outage a login outage. Choose deliberately.
- **`AuditSessionData.claims` passes through whole.** An app that stamps `loginIp` / `loginUserAgent`
  onto a session at login needs them back on a later revoke, which happens on a different request
  where the live context describes the wrong caller. So whatever you put in `claims` reaches your
  sink: do not store a secret there.
- **`session.rotated` is one event, not two.** The hooks fire `onSessionCreated` + `onSessionRevoked`
  for a rotation and leave the consumer to correlate them. The event names both tokens.
- **`password.verify.rate_limited` is its own event, not a `verify.failed` reason.** A wrong password
  is one person mistyping; a burst of rate-limit refusals is the lockout signal. Collapsing them
  hides the burst in the counts.
- **`recovery.initiated` with no `actorId` is a probe.** The package deliberately issues a challenge
  for an unknown identifier so a caller cannot enumerate accounts, so an event with no actor means
  someone testing addresses. Alert on the rate.
- **`recovery.channel.rejected` with `sub_challenge_mismatch` is an attack, not a user error.** It
  means a proof issued against one account was presented on another account's challenge. Same for
  `mfa.failed` with `post_verification_mismatch`, which is a defence-in-depth trip.
- **`recovery.sessions_not_revoked` is a misconfiguration alarm.** It fires when the orchestrator has
  no `AuthenticationSessionService` bound, which silently leaves every pre-recovery token working.
- **The package never fills `AuditEventContext`.** It sits at L2 alongside the HTTP adapters, so it
  cannot reach a request. Fill `correlationId`, `ipAddress`, and the rest in your own request-scoped
  sink.
- **`outcome: 'failure'` is always a credential verdict.** Events are emitted at the decision point,
  never from a catch block, so a cache outage or a mailer 503 produces no event rather than a false
  failure. Keep it that way when adding one: an operator's audit feed must not fill with their own
  downtime.
- **`FactorRepository.findFactor` is optional.** A service path that needs global lookup against a
  repository that did not implement it fails at runtime, not at compile time.
- **Recovery deliberately cannot be used to probe for account existence.** An unknown identifier
  still returns a challenge, with an empty `eligibleChannels` list. Do not "fix" that by returning
  a 404. For the same reason `eligibleChannels[].label` is masked via `maskEmail` / `maskPhone`;
  the unmasked recipient is only returned by `issueChannelChallenge`.
- **`verifyChannel` binds the proof to the parent challenge.** Email and phone proofs must carry
  the `channelChallengeId` stitched on by `issueChannelChallenge`, and the verified factor must be
  on the challenge's eligible list. Without both, a sub-challenge issued against the caller's own
  factor could be redeemed against another actor's recovery challenge.
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
  chained.authentication.handler.ts ChainedAuthenticationHandler, AuthenticationHandlerChain
  authentication.session.service.ts Sessions, rotation, refresh + theft detection
  helpers.ts                      matchesFactorConstraints, isFactorRecent, maskEmail, maskPhone, timingSafeCompare
  jwt/                            JwtAuthenticationHandler, JwtAuthenticationIssuer(+Map)
  basic/                          BasicAuthenticationHandler, BasicAuthenticationIssuer
  factors/
    factor.repository.ts          Factor, FactorRepository
    authorization.callback.types.ts
    password/ email/ phone/ authenticator/ fido/ oidc/ oauth2/ recovery/
                                  each: <name>.factor.service.ts + <name>.factor.repository.ts
  providers/                      argon2id.password.hash, password.hash, password.strength, jwt,
                                  otp (+ mock), pkce, oidc, oauth2, html.redirect
  policies/                       fourteen policies + policy.mappings.ts
  mfa/                            types, mfa.challenge.service, mfa.orchestrator
  recovery/                       types, recovery.challenge.service, recovery.session.service,
                                  recovery.orchestrator
  support/                        types, support.verification.secret.repository,
                                  support.verification.code.service
  apikey/                         types, api.key.token (codec), api.key.repository,
                                  api.key.service, api.key.authentication.handler
  audit/                          types, audit.sink, audit.recorder, audit.event,
                                  session/api.key/password/mfa/recovery .audit.event
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
