# @maroonedsoftware/authentication

Authentication utilities for ServerKit. Provides scheme-based handler dispatch, session management, JWT issuance, OTP generation, password strength checking, password factor flows, email factor flows, authenticator app (TOTP/HOTP) factor flows, phone number factor flows, and FIDO2/WebAuthn factor flows — all with full dependency injection support via [injectkit](https://www.npmjs.com/package/injectkit).

## Installation

```bash
pnpm add @maroonedsoftware/authentication
```

## Features

- **Scheme-based dispatch** — register a handler per `Authorization` scheme (`Bearer`, `Basic`, or any custom scheme) and the right one is called automatically
- **`AuthenticationContext`** — a typed context object carrying session metadata, satisfied MFA factors, and arbitrary credential claims
- **Safe defaults** — `invalidAuthenticationContext` is a well-typed sentinel for unauthenticated state that can be safely checked without null handling
- **Server-side sessions** — `AuthenticationSessionService` manages session lifecycle in any cache backend, with JWT issuance and revocation support
- **Built-in JWT support** — `JwtAuthenticationHandler` and `JwtAuthenticationIssuer` for multi-issuer Bearer token validation
- **Built-in Basic support** — `BasicAuthenticationHandler` and `BasicAuthenticationIssuer` for username/password flows
- **OTP/TOTP** — RFC 4226/6238 compliant HOTP and TOTP generation and validation, plus `otpauth://` URI generation for QR codes
- **Password strength** — zxcvbn-ts powered strength checking with HaveIBeenPwned integration
- **Password factors** — strength-validated, PBKDF2-hashed, rate-limited password factor lifecycle via `PasswordFactorService`
- **Email factors** — two-step email factor registration and verification via OTP code or magic link
- **Authenticator app factors** — TOTP/HOTP registration with QR code provisioning via `AuthenticatorFactorService`
- **Phone number factors** — two-step phone factor registration via `PhoneFactorService` (send the OTP out-of-band via SMS)
- **FIDO2/WebAuthn factors** — passkey/security-key registration and sign-in via `FidoFactorService` (built on [`fido2-lib`](https://www.npmjs.com/package/fido2-lib))
- **DI-friendly** — all classes are decorated with `@Injectable()` and designed for an injectkit container

## Usage

### Scheme-based dispatch

#### 1. Implement a handler for your scheme

```typescript
import { Injectable } from 'injectkit';
import { AuthenticationHandler, AuthenticationContext, invalidAuthenticationContext } from '@maroonedsoftware/authentication';
import { DateTime } from 'luxon';

@Injectable()
class MyJwtHandler implements AuthenticationHandler {
  async authenticate(scheme: string, value: string): Promise<AuthenticationContext> {
    const payload = await verifyJwt(value); // your JWT verification logic

    return {
      actorId: payload.sub,
      actorType: 'user',
      issuedAt: DateTime.fromSeconds(payload.iat),
      lastAccessedAt: DateTime.now(),
      expiresAt: DateTime.fromSeconds(payload.exp),
      factors: [{ method: 'password', lastAuthenticated: DateTime.fromSeconds(payload.iat), kind: 'knowledge' }],
      claims: payload,
      roles: [],
    };
  }
}
```

#### 2. Register the handler map in your DI container

```typescript
import { AuthenticationHandlerMap, AuthenticationSchemeHandler } from '@maroonedsoftware/authentication';

registry.register(AuthenticationHandlerMap).useMap().set('bearer', MyJwtHandler);
registry.register(MyJwtHandler).useClass(MyJwtHandler).asSingleton();
registry.register(AuthenticationSchemeHandler).useClass(AuthenticationSchemeHandler).asSingleton();
```

#### 3. Resolve the authentication context

```typescript
const schemeHandler = container.get(AuthenticationSchemeHandler);

const ctx = await schemeHandler.handle('Bearer eyJhbGci...');
console.log(ctx.actorId);  // 'user-123'
console.log(ctx.claims);   // { sub: 'user-123', ... }

// Missing or malformed header
const ctx = await schemeHandler.handle(undefined);
console.log(ctx === invalidAuthenticationContext); // true
```

---

### JWT authentication (multi-issuer Bearer)

Use `JwtAuthenticationHandler` when you want the package to handle Bearer token dispatch, with per-issuer validation logic plugged in via `JwtAuthenticationIssuer`.

```typescript
import {
  JwtAuthenticationHandler,
  JwtAuthenticationIssuerMap,
  JwtAuthenticationIssuer,
} from '@maroonedsoftware/authentication';
import type { JwtPayload } from 'jsonwebtoken';

@Injectable()
class MyIssuer extends JwtAuthenticationIssuer {
  async parse(payload: JwtPayload): Promise<AuthenticationContext> {
    // Verify signature, expiry, audience, etc.
    return { actorId: payload.sub!, actorType: 'user', ... };
  }
}

// Register in DI
registry.register(JwtAuthenticationIssuerMap).useMap().set('https://auth.example.com', MyIssuer);
registry.register(JwtAuthenticationHandler).useClass(JwtAuthenticationHandler).asSingleton();

// Register as the bearer handler
registry.register(AuthenticationHandlerMap).useMap().set('bearer', JwtAuthenticationHandler);
```

---

### Basic authentication

```typescript
import { BasicAuthenticationHandler, BasicAuthenticationIssuer } from '@maroonedsoftware/authentication';

@Injectable()
class MyBasicIssuer extends BasicAuthenticationIssuer {
  async verify(username: string, password: string): Promise<AuthenticationContext> {
    const user = await db.users.findByUsername(username);
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      return invalidAuthenticationContext;
    }
    return { actorId: user.id, actorType: 'user', ... };
  }
}

registry.register(MyBasicIssuer).useClass(MyBasicIssuer).asSingleton();
registry.register(BasicAuthenticationHandler).useClass(BasicAuthenticationHandler).asSingleton();
registry.register(AuthenticationHandlerMap).useMap().set('basic', BasicAuthenticationHandler);
```

---

### Session management

`AuthenticationSessionService` stores sessions in a cache and issues JWTs that reference them. Revoking a session invalidates all tokens derived from it.

```typescript
import { AuthenticationSessionService } from '@maroonedsoftware/authentication';
import { DateTime } from 'luxon';

const sessionService = container.get(AuthenticationSessionService);

// Create a session after the user authenticates
const now = DateTime.utc();
const session = await sessionService.createSession(
  user.id,
  { plan: 'pro' },
  { issuedAt: now, authenticatedAt: now, method: 'password', methodId: user.passwordFactorId, kind: 'knowledge' },
);

// Issue a signed JWT
const token = await sessionService.issueTokenForSession(session.sessionToken);
// token.accessToken → "eyJhbGci..."

// Validate a JWT and retrieve the session on subsequent requests
const { session, jwtPayload } = await sessionService.lookupSessionFromJwt(incomingJwt);

// Revoke (logout)
await sessionService.deleteSession(session.sessionToken);
```

---

### OTP / TOTP

```typescript
import { OtpProvider } from '@maroonedsoftware/authentication';

const otp = container.get(OtpProvider);

// Generate a secret for a user's authenticator app
const secret = otp.createSecret();

// Produce a QR-code URI
const uri = otp.generateURI(secret, { type: 'totp', algorithm: 'SHA1', periodSeconds: 30, tokenLength: 6, counter: 0 }, { issuer: 'MyApp', label: user.email });

// Validate a code submitted by the user
const valid = otp.validate(submittedCode, secret, { type: 'totp', periodSeconds: 30 });
```

---

### Password strength

`PasswordStrengthProvider` wraps [zxcvbn-ts](https://zxcvbn-ts.github.io/zxcvbn/) with the English dictionary, common adjacency graphs, and a [HaveIBeenPwned](https://haveibeenpwned.com/) leak matcher. Scores range from 0 (very weak) to 4 (very strong); a score of 3 or higher is considered acceptable.

```typescript
import { PasswordStrengthProvider } from '@maroonedsoftware/authentication';

const strength = container.get(PasswordStrengthProvider);

// Non-throwing check — pass user-specific context (email, name, etc.) so zxcvbn
// can penalise obvious substitutions like "alice123" for user "alice".
const result = await strength.checkStrength(password, user.email, user.name);
// result.valid    → boolean (score >= 3)
// result.score    → 0–4
// result.feedback → { warning: string, suggestions: string[] }

// Throwing check — throws HTTP 400 with
// { password: feedback.warning, suggestions: feedback.suggestions } when score < 3
await strength.ensureStrength(password, user.email);
```

To override the policy (e.g. raise the threshold or swap the matcher), subclass `PasswordStrengthProvider` and register your subclass in the DI container — `PasswordFactorService` resolves the base class.

---

### PKCE state storage

`PkceProvider` is cache-backed storage for the OAuth 2.0 [PKCE](https://datatracker.ietf.org/doc/html/rfc7636) flow. It binds an arbitrary string `value` (a redirect URL, upstream auth params, a transaction id, etc.) to the code challenge a client sent at the start of an authorization flow, so the matching verifier can later retrieve it at the token endpoint. Entries are namespaced under the `pkce_` cache key prefix and expire automatically via the cache TTL.

Each method comes in two forms — `*Challenge` takes the SHA-256/base64url challenge, `*Verifier` takes the verifier and derives the challenge for you (using `pkceCreateChallenge` from `@maroonedsoftware/encryption`).

```typescript
import { PkceProvider } from '@maroonedsoftware/authentication';
import { pkceCreateChallenge, pkceCreateVerifier } from '@maroonedsoftware/encryption';
import { Duration } from 'luxon';

const pkce = container.get(PkceProvider);

// --- Authorization step (client → /authorize) ---
// The client generates a verifier and challenge, sends the challenge to us
const codeChallenge = ctx.query.code_challenge;
await pkce.storeChallenge(codeChallenge, JSON.stringify({ redirectUrl, scope }), Duration.fromObject({ minutes: 10 }));

// --- Token step (client → /token) ---
// The client sends back the verifier
const stateJson = await pkce.getVerifier(ctx.body.code_verifier);
if (!stateJson) throw httpError(400);
await pkce.deleteVerifier(ctx.body.code_verifier); // single-use
```

If you control both halves of the pair (e.g. issuing your own download links), use `storeVerifier` / `getVerifier` / `deleteVerifier` and skip the manual `pkceCreateChallenge` call.

---

### Password factors

`PasswordFactorService` handles the full lifecycle of password-based factors: PBKDF2-SHA512 hashing, reuse prevention against the last 10 passwords, and rate-limited verification (via an injected `RateLimiterCompatibleAbstract`). Strength validation is delegated to an injected `PasswordStrengthProvider` (zxcvbn + HaveIBeenPwned by default) — register your own implementation to override the policy.

```typescript
import { PasswordFactorService } from '@maroonedsoftware/authentication';

const passwordFactors = container.get(PasswordFactorService);

// Create a new factor (validates strength, throws 409 if one already exists)
const factorId = await passwordFactors.createPasswordFactor(user.id, password);

// Verify on sign-in (rate-limited; throws 401 on bad credentials, 429 if rate-limited)
await passwordFactors.verifyPassword(user.id, submittedPassword);

// Replace the password (validates strength, rejects reuse of the last 10)
await passwordFactors.updatePasswordFactor(user.id, newPassword);

// Change password and clear the `needsReset` flag
await passwordFactors.changePassword(user.id, newPassword);

// Remove the factor
await passwordFactors.deleteFactor(user.id);
```

---

### Email factors

```typescript
import { EmailFactorService } from '@maroonedsoftware/authentication';

const emailFactors = container.get(EmailFactorService);

// --- Registration ---

// Step 1: generate a code and cache the registration. Idempotent — `alreadyRegistered`
// is true when a pending registration was already cached, so the caller can skip
// re-sending the email and avoid spamming the user during the registration window.
const { registrationId, code, expiresAt, alreadyRegistered } = await emailFactors.registerEmailFactor(
  'user@example.com',
  'code', // or 'magiclink'
);
if (!alreadyRegistered) {
  await mailer.sendOtp(user.email, code);
}

// Step 2: user submits the code; persist the factor
const factor = await emailFactors.createEmailFactorFromRegistration(user.id, registrationId, submittedCode);

// --- Verification (sign-in) ---

// Step 1: send a challenge
const { email, verificationId, code } = await emailFactors.createEmailVerification(user.id, factor.id, 'code');
await mailer.sendOtp(email, code);

// Step 2: user submits the code
const { actorId, factorId } = await emailFactors.verifyEmailVerification(verificationId, submittedCode);
```

`registerEmailFactor` rejects the request before issuing a code when:
- the email format is invalid (HTTP 400),
- the domain is on `denyList` (HTTP 400, e.g. disposable mail providers),
- `EmailFactorRepository.isDomainInviteOnly(domain)` returns `true` (HTTP 403 — implement this to gate registration to allow-listed domains, e.g. workspaces that require an invite),
- an active factor already exists for the email (HTTP 409).

---

### Authenticator app factors (TOTP/HOTP)

`AuthenticatorFactorService` manages the full lifecycle of authenticator app (TOTP/HOTP) factors. The secret is stored encrypted via `EncryptionProvider` and is never persisted in plaintext.

#### Registration

```typescript
import { AuthenticatorFactorService } from '@maroonedsoftware/authentication';

const authenticatorFactors = container.get(AuthenticatorFactorService);

// Step 1: generate a secret and QR code, cache the pending registration
const { registrationId, secret, uri, qrCode, expiresAt } = await authenticatorFactors.registerAuthenticatorFactor(user.id);
// Display qrCode (a data URL) to the user so they can scan it into their authenticator app.
// secret is also returned for manual entry.

// Step 2: user enters the code from their app; verify it and persist the factor
const factorId = await authenticatorFactors.createAuthenticatorFactorFromRegistration(
  user.id,
  registrationId,
  submittedCode,
);
```

You can override OTP algorithm defaults per registration:

```typescript
await authenticatorFactors.registerAuthenticatorFactor(user.id, {
  type: 'totp',
  algorithm: 'SHA256',
  periodSeconds: 60,
  tokenLength: 8,
  counter: 0,
});
```

#### Verification (sign-in)

```typescript
// Throws HTTP 401 when the factor doesn't exist, is inactive, or the code is invalid
await authenticatorFactors.validateFactor(user.id, factorId, submittedCode);
```

#### Deletion

```typescript
await authenticatorFactors.deleteFactor(user.id, factorId);
```

---

### Phone number factors

`PhoneFactorService` handles two-step phone number factor registration. It caches a pending registration and returns a `registrationId` — your application is responsible for sending an OTP to that number out-of-band (e.g. via SMS). Registration is idempotent: calling `registerPhoneFactor` again with the same actor and number returns the existing pending registration with `alreadyRegistered: true` so the caller can skip a duplicate SMS send.

```typescript
import { PhoneFactorService } from '@maroonedsoftware/authentication';

const phoneFactors = container.get(PhoneFactorService);

// --- Registration ---

// Step 1: cache a pending registration and get the registrationId. `alreadyRegistered`
// is true when a pending registration was already cached — skip the SMS to avoid duplicates.
const { registrationId, expiresAt, alreadyRegistered } = await phoneFactors.registerPhoneFactor(user.id, '+12025550123');
if (!alreadyRegistered) {
  await sms.sendOtp('+12025550123', registrationId);
}

// Step 2: user confirms their number; persist the factor
const factorId = await phoneFactors.createPhoneFactorFromRegistration(user.id, registrationId);
```

---

### FIDO2 / WebAuthn factors

`FidoFactorService` handles passkey and security-key flows on top of [`fido2-lib`](https://www.npmjs.com/package/fido2-lib). Relying party identifiers (`rpId`, `rpOrigin`, `rpName`) are passed per call rather than configured statically, so a single service can serve multiple hosts. Both registration and sign-in are two-step: the server emits a challenge, caches the expectations for `FidoFactorServiceOptions.timeout` (5 minutes by default), and verifies the browser's response in step two.

```typescript
import { FidoFactorService } from '@maroonedsoftware/authentication';

const fidoFactors = container.get(FidoFactorService);

// --- Registration ---

// Step 1: emit an attestation challenge to the browser
const attestation = await fidoFactors.registerFidoFactor(user.id, {
  rpId: 'example.com',
  rpName: 'Example',
  rpOrigin: 'https://example.com',
  userName: user.email,
  userDisplayName: user.name,
});
// Send `attestation` to the browser; client decodes `challenge` and `user.id`
// from base64 to ArrayBuffers, calls navigator.credentials.create({ publicKey: ... }),
// and posts the resulting credential back.

// Step 2: verify the attestation and persist the factor
const factorId = await fidoFactors.createFidoFactorFromRegistration(user.id, credential);

// --- Authorization (sign-in) ---

// Step 1: emit an assertion challenge — `allowCredentials` is populated from
// the actor's active factors, so the browser only prompts for ones they have
const assertion = await fidoFactors.createFidoAuthorizationChallenge(user.id, {
  rpId: 'example.com',
  rpOrigin: 'https://example.com',
});
// Client decodes the challenge and each allowCredentials[].id to ArrayBuffers,
// calls navigator.credentials.get({ publicKey: ... }), and posts back.

// Step 2: verify the signature and bump the stored counter
const { actorId, factorId } = await fidoFactors.verifyFidoAuthorizationChallenge(user.id, credential);
```

Failed attestations and assertions both throw HTTP 401 with a `WWW-Authenticate: Bearer error="invalid_credentials"` header (or `"invalid_registration"` when no pending registration is cached). The original `fido2-lib` error is attached as the cause and the raw inputs as internal details for logging.

---

## API Reference

### `AuthenticationContext`

The resolved context produced by a successful authentication check.

| Property          | Type                      | Description                                              |
| ----------------- | ------------------------- | -------------------------------------------------------- |
| `actorId`         | `string`                  | Unique identifier for the authenticated actor            |
| `actorType`       | `string`                  | Type of the actor (e.g. `"user"`, `"service"`)           |
| `issuedAt`        | `DateTime`                | When the session was originally issued                   |
| `lastAccessedAt`  | `DateTime`                | When the session was last accessed                       |
| `expiresAt`       | `DateTime`                | When the session expires                                 |
| `factors`         | `AuthenticationFactor[]`  | MFA factors satisfied in this session                    |
| `claims`          | `Record<string, unknown>` | Arbitrary key/value claims extracted from the credential |
| `roles`           | `string[]`                | Roles assigned to the authenticated actor                |

### `AuthenticationFactor`

Describes a single satisfied authentication factor.

| Property            | Type                       | Description                                                       |
| ------------------- | -------------------------- | ----------------------------------------------------------------- |
| `method`            | `string`                   | Specific method used (e.g. `"password"`, `"totp"`, `"webauthn"`) |
| `lastAuthenticated` | `DateTime`                 | When this factor was last successfully authenticated              |
| `kind`              | `AuthenticationFactorKind` | MFA category: `"knowledge"`, `"possession"`, or `"biometric"`     |

### `AuthenticationFactorKind`

```typescript
type AuthenticationFactorKind = 'knowledge' | 'possession' | 'biometric';
```

| Value        | Meaning              | Examples                        |
| ------------ | -------------------- | ------------------------------- |
| `knowledge`  | Something you know   | Password, PIN                   |
| `possession` | Something you have   | TOTP app, hardware security key |
| `biometric`  | Something you are    | Fingerprint, face ID            |

### `invalidAuthenticationContext`

A sentinel `AuthenticationContext` value representing an unauthenticated or failed state. All `DateTime` fields are invalid Luxon instances.

```typescript
import { invalidAuthenticationContext } from '@maroonedsoftware/authentication';

if (ctx === invalidAuthenticationContext) {
  throw httpError(401);
}
```

### `AuthenticationSchemeHandler`

| Method                         | Returns                          | Description                                                                             |
| ------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------- |
| `handle(authorizationHeader?)` | `Promise<AuthenticationContext>` | Parses the `Authorization` header and returns the resolved context, or `invalidAuthenticationContext` |

Returns `invalidAuthenticationContext` when the header is absent, malformed, or no handler is registered for the scheme.

### `AuthenticationHandlerMap`

An injectable `Map<AuthorizationScheme, AuthenticationHandler>`. Register one entry per scheme.

### `AuthenticationHandler`

```typescript
interface AuthenticationHandler {
  authenticate(scheme: string, value: string): Promise<AuthenticationContext>;
}
```

### `AuthorizationScheme`

```typescript
type AuthorizationScheme = 'bearer' | 'basic' | string;
```

### `JwtAuthenticationHandler`

Handles `bearer` tokens by decoding the JWT, extracting the `iss` claim, and delegating to the matching `JwtAuthenticationIssuer`.

### `JwtAuthenticationIssuer`

Abstract base class. Implement `parse(payload: JwtPayload): Promise<AuthenticationContext>` to validate tokens from a specific issuer. Register instances in `JwtAuthenticationIssuerMap` keyed by the `iss` claim value.

### `BasicAuthenticationHandler`

Handles `basic` tokens by base64-decoding the credential, splitting on `:`, and delegating to `BasicAuthenticationIssuer`.

### `BasicAuthenticationIssuer`

Abstract base class. Implement `verify(username: string, password: string): Promise<AuthenticationContext>`.

### `AuthenticationSessionService`

| Method                                                              | Returns                                           | Description                                                |
| ------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| `createSession(subject, claims, factors, expiration?)`              | `Promise<AuthenticationSession>`                  | Create and cache a new session                             |
| `updateSession(token, subject, expiration?, claims?, factor?)`      | `Promise<AuthenticationSession>`                  | Merge claims/factors and extend session expiry             |
| `createOrUpdateSession(token?, subject, claims, factor, expiration?)` | `Promise<AuthenticationSession>`                | Create or update depending on whether the token resolves   |
| `lookupSessionFromJwt(jwt, ignoreExpiration?)`                      | `Promise<{ session, jwtPayload }>`               | Validate a JWT and retrieve its session                    |
| `getSession(token)`                                                 | `Promise<AuthenticationSession \| undefined>`    | Retrieve a session by token                                |
| `getSessionsForSubject(subject)`                                    | `Promise<AuthenticationSession[]>`               | Get all active sessions for a subject                      |
| `issueTokenForSession(sessionToken)`                                | `Promise<AuthenticationToken>`                   | Issue a signed JWT for an existing session                 |
| `deleteSession(token)`                                              | `Promise<void>`                                  | Revoke a session                                           |

### `AuthenticationSession`

Server-side session record stored in cache. Time fields are Luxon `DateTime` instances in your code; the service serializes them to Unix integers at the cache boundary.

| Field            | Type                              | Description                                                              |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `sessionToken`   | `string`                          | Opaque session token, also embedded in issued JWTs as `sessionToken`.    |
| `subject`        | `string`                          | Subject identifier (typically a user id).                                |
| `issuedAt`       | `DateTime`                        | When the session was originally created.                                 |
| `expiresAt`      | `DateTime`                        | When the session expires.                                                |
| `lastAccessedAt` | `DateTime`                        | When the session was most recently accessed.                             |
| `factors`        | `AuthenticationSessionFactor[]`   | Factors satisfied during this session.                                   |
| `claims`         | `Record<string, unknown>`         | Arbitrary claims to embed in tokens issued from this session.            |

### `AuthenticationSessionFactor`

| Field             | Type                                                            | Description                                            |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| `issuedAt`        | `DateTime`                                                      | When this factor entry was first added to the session. |
| `authenticatedAt` | `DateTime`                                                      | When the factor was most recently re-verified.         |
| `method`          | `'phone' \| 'password' \| 'authenticator' \| 'email' \| 'fido'` | The verification method used.                          |
| `methodId`        | `string`                                                        | Stable identifier for the specific factor record.      |
| `kind`            | `AuthenticationFactorKind`                                      | MFA category.                                          |

### `AuthenticationToken`

OAuth 2.0-style Bearer token response returned by `issueTokenForSession`.

| Field          | Type     | Description                                                                                                                          |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `accessToken`  | `string` | The signed JWT to send as a `Bearer` credential.                                                                                     |
| `tokenType`    | `string` | Always `"Bearer"`.                                                                                                                   |
| `expiresIn`    | `number` | Unix timestamp (seconds) at which the access token expires — taken directly from the JWT's `exp` claim, **not** seconds-from-now.    |
| `refreshToken` | `string` (optional) | A refresh token, when issued.                                                                                             |
| `scope`        | `string` | Space-separated list of granted scopes.                                                                                              |

### `CacheProvider`

Abstract base class. Implement `get`, `set`, `update`, and `delete` to plug in any cache backend (Redis, in-memory, etc.).

### `JwtProvider`

| Method                                                 | Returns                       | Description                          |
| ------------------------------------------------------ | ----------------------------- | ------------------------------------ |
| `create(payload, subject, issuer, audience, expiresIn)` | `{ token, decoded }`         | Sign an RS256 JWT                    |
| `decode(token, issuer, ignoreExpiration?, reThrow?)`   | `JwtPayload \| undefined`    | Verify and decode an RS256 JWT       |

### `OtpProvider`

| Method                                                                     | Returns   | Description                                              |
| -------------------------------------------------------------------------- | --------- | -------------------------------------------------------- |
| `createSecret(numBytes?)`                                                  | `string`  | Generate a base32-encoded random secret                  |
| `generate(secret, options)`                                                | `string`  | Generate an HOTP or TOTP value (RFC 4226/6238)           |
| `validate(otp, secret, options, window?)`                                  | `boolean` | Validate an HOTP or TOTP value                           |
| `generateURI(secret, options, urlOptions)`                                 | `string`  | Build an `otpauth://` provisioning URI                   |

`options` is an `OtpOptions` object with `type: 'hotp' | 'totp'`, plus `algorithm`, `counter` (HOTP), `periodSeconds` (TOTP), and `tokenLength`. `urlOptions` accepts `issuer` and an optional `label`.

### `PasswordStrengthProvider`

Evaluates password strength via zxcvbn-ts with the HaveIBeenPwned matcher enabled. Subclass and register your subclass in the DI container to override the policy.

| Method                                      | Returns                                                                   | Description                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `checkStrength(password, ...userInputs)`    | `Promise<{ valid: boolean, score: 0–4, feedback: { warning, suggestions } }>` | Evaluate strength without throwing. `valid` is `true` when `score >= 3`                                      |
| `ensureStrength(password, ...userInputs)`   | `Promise<void>`                                                           | Throw HTTP 400 with `{ password: warning, suggestions }` when `score < 3`                                    |

`userInputs` are extra strings or numbers (name, email, date of birth, etc.) that zxcvbn penalises if they appear in the password.

### `PkceProvider`

Cache-backed storage for PKCE state (RFC 7636). Wraps an injected `CacheProvider`; entries are namespaced under the `pkce_` key prefix and expire on the cache TTL.

| Method                                                       | Returns                  | Description                                                                  |
| ------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------- |
| `storeChallenge(codeChallenge, value, expiration: Duration)` | `Promise<void>`          | Bind `value` to a code challenge for `expiration`                            |
| `storeVerifier(codeVerifier, value, expiration: Duration)`   | `Promise<void>`          | Same as `storeChallenge`, but derives the challenge from the verifier        |
| `getChallenge(codeChallenge)`                                | `Promise<string \| null>` | Look up the stored value for a challenge; `null` when missing/expired        |
| `getVerifier(codeVerifier)`                                  | `Promise<string \| null>` | Look up the value for the verifier-derived challenge — the standard PKCE op  |
| `deleteChallenge(codeChallenge)`                             | `Promise<void>`          | Remove the entry — call after a successful exchange for single-use semantics |
| `deleteVerifier(codeVerifier)`                               | `Promise<void>`          | Same as `deleteChallenge`, but derives the challenge from the verifier       |

### `PasswordFactorService`

Manages password factors with PBKDF2-SHA512 hashing, password-reuse prevention, and rate-limited verification. Strength checks are delegated to an injected `PasswordStrengthProvider`. Requires both that provider and a `RateLimiterCompatibleAbstract` (from `rate-limiter-flexible`) registered in the DI container.

| Method                                                | Returns           | Description                                                                                  |
| ----------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| `createPasswordFactor(actorId, password, needsReset?)` | `Promise<string>` | Validate strength via `PasswordStrengthProvider` and persist a new factor; throws HTTP 409 if one already exists. Returns `factorId` |
| `updatePasswordFactor(actorId, password, needsReset?)` | `Promise<string>` | Replace the password after strength check and reuse check against the last 10 passwords. Returns `factorId` |
| `verifyPassword(actorId, password)`                   | `Promise<string>` | Verify against the stored hash with rate limiting; throws HTTP 401 on bad credentials, HTTP 429 if rate-limited. Returns `factorId` |
| `changePassword(actorId, password)`                   | `Promise<string>` | Set a new password and clear the `needsReset` flag                                           |
| `deleteFactor(actorId)`                               | `Promise<void>`   | Permanently remove the actor's password factor                                               |

### `PasswordFactorRepository`

Abstract base class. Extend and register a concrete implementation so that `PasswordFactorService` can resolve it at runtime.

| Method                                                  | Returns                          | Description                                              |
| ------------------------------------------------------- | -------------------------------- | -------------------------------------------------------- |
| `createFactor(subject, value, needsReset)`              | `Promise<PasswordFactor>`        | Persist a new password factor                            |
| `updateFactor(actorId, value, needsReset)`              | `Promise<PasswordFactor>`        | Replace the actor's current password factor value        |
| `getFactor(actorId)`                                    | `Promise<PasswordFactor>`        | Retrieve the active password factor for the actor        |
| `listPreviousPasswords(actorId, limit)`                 | `Promise<PasswordValue[]>`       | Return the most recent `limit` historical password hashes |
| `deleteFactor(actorId)`                                 | `Promise<void>`                  | Permanently remove the actor's password factor           |

`PasswordFactor`: `{ id: string; actorId: string; active: boolean; value: PasswordValue; needsReset: boolean }`. `PasswordValue`: `{ hash: string; salt: string }` — both base64-encoded.

### `EmailFactorService`

| Method                                                              | Returns                                                     | Description                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| `registerEmailFactor(value, verificationMethod)`                    | `Promise<{ registrationId, code, expiresAt: DateTime, issuedAt: DateTime, alreadyRegistered: boolean }>` | Initiate email factor registration (idempotent — `alreadyRegistered` is `true` on a cache hit) |
| `createEmailFactorFromRegistration(actorId, registrationId, code)`  | `Promise<EmailFactor>`                                      | Complete registration                   |
| `createEmailVerification(actorId, factorId, verificationMethod)`    | `Promise<{ email, verificationId, code, expiresAt: DateTime }>`      | Initiate a sign-in challenge            |
| `verifyEmailVerification(verificationId, code)`                     | `Promise<{ actorId, factorId }>`                            | Complete a sign-in challenge            |

`EmailFactorServiceOptions`:

| Option                | Type       | Default    | Description                                                                              |
| --------------------- | ---------- | ---------- | ---------------------------------------------------------------------------------------- |
| `denyList`            | `string[]` | `[]`       | Sorted list of email domains to reject (checked via binary search; e.g. disposable mail) |
| `otpExpiration`       | `Duration` | 10 minutes | How long an OTP-code registration or verification challenge stays valid                  |
| `magiclinkExpiration` | `Duration` | 30 minutes | How long a magic link token stays valid                                                  |

### `EmailFactorRepository`

Abstract base class. Extend and register a concrete implementation so that `EmailFactorService` can resolve it at runtime.

| Method                              | Returns                  | Description                                          |
| ----------------------------------- | ------------------------ | ---------------------------------------------------- |
| `createFactor(actorId, value)`      | `Promise<EmailFactor>`   | Persist a new email factor                           |
| `doesEmailExist(value)`             | `Promise<boolean>`       | Check whether an email address is already registered |
| `isDomainInviteOnly(domain)`        | `Promise<boolean>`       | Check whether a domain is invite-only (gates registration) |
| `getFactor(actorId, factorId)`      | `Promise<EmailFactor>`   | Retrieve a factor by id                              |
| `deleteFactor(actorId, factorId)`   | `Promise<void>`          | Remove a factor                                      |

`EmailFactor`: `{ id: string; actorId: string; active: boolean; value: string }` where `value` is the verified email address.

### `AuthenticatorFactorService`

Manages TOTP/HOTP authenticator app factors. Requires an `AuthenticatorFactorServiceOptions` object with at minimum an `issuer` string.

| Method                                                                   | Returns                                                           | Description                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| `registerAuthenticatorFactor(actorId, options?)`                         | `Promise<{ registrationId, secret, uri, qrCode, expiresAt: DateTime }>`   | Generate a secret, QR code, and cache the pending registration |
| `createAuthenticatorFactorFromRegistration(actorId, registrationId, code)` | `Promise<string>`                                               | Verify the first OTP code and persist the factor; returns `factorId` |
| `validateFactor(actorId, factorId, code)`                                | `Promise<void>`                                                  | Verify a TOTP/HOTP code; throws HTTP 401 on failure            |
| `deleteFactor(actorId, factorId)`                                        | `Promise<void>`                                                  | Remove a factor                                                |

`AuthenticatorFactorServiceOptions`:

| Option                   | Type       | Default    | Description                                              |
| ------------------------ | ---------- | ---------- | -------------------------------------------------------- |
| `issuer`                 | `string`   | —          | Issuer name shown in the authenticator app               |
| `registrationExpiration` | `Duration` | 30 minutes | How long a pending registration stays valid              |
| `factorExpiration`       | `Duration` | 4 hours    | How long a validated factor session remains cached       |
| `defaults`               | `OtpOptions` | TOTP SHA1 30s 6-digit | Default OTP options used when none are supplied per-call |

### `AuthenticatorFactorRepository`

Abstract base class. Extend and register a concrete implementation (e.g. backed by a PostgreSQL table) so that `AuthenticatorFactorService` can resolve it at runtime.

| Method                                          | Returns                                      | Description                                 |
| ----------------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| `createFactor(actorId, options)`                | `Promise<AuthenticatorFactor>`               | Persist a new factor for an actor           |
| `getFactor(actorId, factorId)`                  | `Promise<AuthenticatorFactor \| undefined>`  | Retrieve a factor by id                     |
| `deleteFactor(actorId, factorId)`               | `Promise<void>`                              | Remove a factor                             |

`AuthenticatorFactor` extends `OtpOptions` with `id: string`, `actorId: string`, `active: boolean`, and `secretHash: string` (the encrypted OTP secret).

### `PhoneFactorService`

Manages phone number factor registration. Requires a `PhoneFactorServiceOptions` object with an `otpExpiration` duration.

| Method                                               | Returns                              | Description                                                                |
| ---------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `registerPhoneFactor(actorId, value)`                | `Promise<{ registrationId, expiresAt: DateTime, issuedAt: DateTime, alreadyRegistered: boolean }>` | Validate the E.164 number and cache a pending registration (idempotent — `alreadyRegistered` is `true` on a cache hit) |
| `createPhoneFactorFromRegistration(actorId, registrationId)` | `Promise<string>`            | Persist the factor; returns `factorId`                                     |

`PhoneFactorServiceOptions`:

| Option          | Type       | Description                                           |
| --------------- | ---------- | ----------------------------------------------------- |
| `otpExpiration` | `Duration` | How long a pending registration stays valid           |

`registerPhoneFactor` throws HTTP 400 for invalid E.164 numbers and HTTP 409 when the number is already registered as a factor for the actor. `createPhoneFactorFromRegistration` throws HTTP 404 when the registration has expired and HTTP 400 when the `actorId` does not match.

### `PhoneFactorRepository`

Abstract base class. Extend and register a concrete implementation so that `PhoneFactorService` can resolve it at runtime.

| Method                              | Returns                               | Description                                       |
| ----------------------------------- | ------------------------------------- | ------------------------------------------------- |
| `createFactor(actorId, value)`      | `Promise<PhoneFactor>`                | Persist a new factor for an actor                 |
| `findFactor(actorId, value)`        | `Promise<PhoneFactor \| undefined>`   | Look up a factor by actor and phone number        |
| `getFactor(actorId, factorId)`      | `Promise<PhoneFactor \| undefined>`   | Look up a factor by id                            |
| `deleteFactor(actorId, factorId)`   | `Promise<void>`                       | Remove a factor                                   |

`PhoneFactor`: `{ id: string; actorId: string; active: boolean; value: string }` where `value` is the E.164-formatted phone number.

### `FidoFactorService`

Manages FIDO2/WebAuthn factors. Wraps `fido2-lib` and accepts relying party identifiers per call.

| Method                                                         | Returns                                                | Description                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `registerFidoFactor(actorId, options)`                         | `Promise<FidoAttestation>`                             | Generate an attestation challenge and cache the expectations                         |
| `createFidoFactorFromRegistration(actorId, credential)`        | `Promise<string>`                                      | Verify the attestation and persist the factor; returns `factorId`                    |
| `createFidoAuthorizationChallenge(actorId, options)`           | `Promise<{ challenge, allowCredentials, ... }>`        | Emit an assertion challenge (`allowCredentials` from the actor's active factors)     |
| `verifyFidoAuthorizationChallenge(actorId, credential)`        | `Promise<{ actorId, factorId }>`                       | Verify the assertion signature and bump the stored counter                           |

`FidoFactorServiceOptions`:

| Option    | Type       | Default   | Description                                                                                              |
| --------- | ---------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `timeout` | `Duration` | 5 minutes | How long a pending registration or authorization challenge stays valid (also forwarded to the browser)   |

`RegisterFidoFactorOptions`: `{ rpId, rpName, rpOrigin, rpIcon?, userName, userDisplayName }`.

`AuthorizeFidoFactorOptions`: `{ rpId, rpOrigin }`.

`createFidoFactorFromRegistration` throws HTTP 401 with `WWW-Authenticate: Bearer error="invalid_registration"` when no pending registration is cached, or `error="invalid_credentials"` on attestation failure. `createFidoAuthorizationChallenge` throws HTTP 404 when the actor has no active factors. `verifyFidoAuthorizationChallenge` throws HTTP 401 with `error="invalid_credentials"` when the challenge is missing/expired, the credential id is unknown, or the signature is invalid.

### `FidoFactorRepository`

Abstract base class. Extend and register a concrete implementation so that `FidoFactorService` can resolve it at runtime.

| Method                                                                | Returns                              | Description                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `createFactor(actorId, publicKey, publicKeyId, counter, active)`      | `Promise<FidoFactor>`                | Persist a new factor                                                                              |
| `listFactors(actorId, active)`                                        | `Promise<FidoFactor[]>`              | List the actor's factors, used to populate `allowCredentials`                                     |
| `getFactor(actorId, factorId)`                                        | `Promise<FidoFactor \| undefined>`   | Look up a factor by credential id (the `id` field of `PublicKeyCredential`)                       |
| `updateFactorCounter(actorId, factorId, counter)`                     | `Promise<void>`                      | Persist the latest signature counter; must be strictly increasing (regression = cloned authenticator) |
| `deleteFactor(actorId, factorId)`                                     | `Promise<void>`                      | Remove a factor                                                                                   |

`FidoFactor`: `{ id: string; actorId: string; active: boolean; publicKey: string; publicKeyId: string; counter: number }`.

## License

MIT
