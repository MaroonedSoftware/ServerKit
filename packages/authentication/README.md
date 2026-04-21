# @maroonedsoftware/authentication

Authentication utilities for ServerKit. Provides scheme-based handler dispatch, session management, JWT issuance, OTP generation, password strength checking, email factor flows, authenticator app (TOTP/HOTP) factor flows, and phone number factor flows — all with full dependency injection support via [injectkit](https://www.npmjs.com/package/injectkit).

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
- **Email factors** — two-step email factor registration and verification via OTP code or magic link
- **Authenticator app factors** — TOTP/HOTP registration with QR code provisioning via `AuthenticatorFactorService`
- **Phone number factors** — two-step phone factor registration via `PhoneFactorService` (send the OTP out-of-band via SMS)
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
  async authenticate(scheme: string, token: string): Promise<AuthenticationContext> {
    const payload = await verifyJwt(token); // your JWT verification logic

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
import { Duration } from 'luxon';

const sessionService = container.get(AuthenticationSessionService);

// Create a session after the user authenticates
const session = await sessionService.createSession(
  user.id,
  { plan: 'pro' },
  { issuedAt: now, authenticatedAt: now, method: 'password', methodId: user.passwordFactorId, kind: 'knowledge' },
);

// Issue a signed JWT
const token = await sessionService.generateAuthToken(session.token);
// token.accessToken → "eyJhbGci..."

// Validate a JWT and retrieve the session on subsequent requests
const { session, jwtPayload } = await sessionService.lookupSessionFromJwt(incomingJwt);

// Revoke (logout)
await sessionService.deleteSession(session.token);
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

```typescript
import { PasswordStrengthProvider } from '@maroonedsoftware/authentication';

const strength = container.get(PasswordStrengthProvider);

// Non-throwing check
const result = await strength.checkStrength(password, user.email, user.name);
// result.valid → boolean, result.score → 0–4, result.feedback → { warning, suggestions }

// Throwing check — throws HTTP 400 with feedback details if score < 3
await strength.ensureStrength(password, user.email);
```

---

### Email factors

```typescript
import { EmailFactorService } from '@maroonedsoftware/authentication';

const emailFactors = container.get(EmailFactorService);

// --- Registration ---

// Step 1: generate a code and cache the registration
const { registrationId, code, expiresAt } = await emailFactors.registerEmailFactor(
  'user@example.com',
  'code', // or 'magiclink'
);
await mailer.sendOtp(user.email, code);

// Step 2: user submits the code; persist the factor
const factor = await emailFactors.createEmailFactorFromRegistration(user.id, registrationId, submittedCode);

// --- Verification (sign-in) ---

// Step 1: send a challenge
const { email, verificationId, code } = await emailFactors.createEmailVerification(user.id, factor.id, 'code');
await mailer.sendOtp(email, code);

// Step 2: user submits the code
const { actorId, factorId } = await emailFactors.verifyEmailVerification(verificationId, submittedCode);
```

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

`PhoneFactorService` handles two-step phone number factor registration. It caches a pending registration and returns a `registrationId` — your application is responsible for sending an OTP to that number out-of-band (e.g. via SMS). Registration is idempotent: calling `registerPhoneFactor` again with the same actor and number returns the existing pending registration.

```typescript
import { PhoneFactorService } from '@maroonedsoftware/authentication';

const phoneFactors = container.get(PhoneFactorService);

// --- Registration ---

// Step 1: cache a pending registration and get the registrationId
const { registrationId, expiresAt } = await phoneFactors.registerPhoneFactor(user.id, '+12025550123');
// Send an OTP to the phone number via your SMS provider, referencing registrationId

// Step 2: user confirms their number; persist the factor
const factorId = await phoneFactors.createPhoneFactorFromRegistration(user.id, registrationId);
```

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
| `generateAuthToken(token)`                                          | `Promise<AuthenticationToken>`                   | Issue a signed JWT for an existing session                 |
| `deleteSession(token)`                                              | `Promise<void>`                                  | Revoke a session                                           |

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

| Method                                      | Returns                                           | Description                                      |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| `checkStrength(password, ...userInputs)`    | `Promise<{ valid, score, feedback }>`            | Evaluate strength without throwing               |
| `ensureStrength(password, ...userInputs)`   | `Promise<void>`                                  | Throw HTTP 400 if score < 3                      |

### `EmailFactorService`

| Method                                                              | Returns                                                     | Description                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| `registerEmailFactor(value, verificationMethod, ignoreExisting?)`   | `Promise<{ registrationId, code, expiresAt }>`             | Initiate email factor registration      |
| `createEmailFactorFromRegistration(actorId, registrationId, code)`  | `Promise<EmailFactor>`                                      | Complete registration                   |
| `createEmailVerification(actorId, factorId, verificationMethod)`    | `Promise<{ email, verificationId, code, expiresAt }>`      | Initiate a sign-in challenge            |
| `verifyEmailVerification(verificationId, code)`                     | `Promise<{ actorId, factorId }>`                            | Complete a sign-in challenge            |

### `AuthenticatorFactorService`

Manages TOTP/HOTP authenticator app factors. Requires an `AuthenticatorFactorServiceOptions` object with at minimum an `issuer` string.

| Method                                                                   | Returns                                                           | Description                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| `registerAuthenticatorFactor(actorId, options?)`                         | `Promise<{ registrationId, secret, uri, qrCode, expiresAt }>`   | Generate a secret, QR code, and cache the pending registration |
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

`AuthenticatorFactor` extends `OtpOptions` with `id: string`, `active: boolean`, and `secretHash: string` (the encrypted OTP secret).

### `PhoneFactorService`

Manages phone number factor registration. Requires a `PhoneFactorServiceOptions` object with an `otpExpiration` duration.

| Method                                               | Returns                              | Description                                                                |
| ---------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `registerPhoneFactor(actorId, value)`                | `Promise<{ registrationId, expiresAt }>` | Validate the E.164 number and cache a pending registration (idempotent) |
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

`PhoneFactor`: `{ id: string; active: boolean; value: string }` where `value` is the E.164-formatted phone number.

## License

MIT
