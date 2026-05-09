# @maroonedsoftware/authentication

Authentication utilities for ServerKit. Provides scheme-based handler dispatch, session management, JWT issuance, OTP generation, password strength checking, password factor flows, email factor flows, authenticator app (TOTP/HOTP) factor flows, phone number factor flows, FIDO2/WebAuthn factor flows, OpenID Connect SSO (Google, Microsoft, LinkedIn, Apple, …), and OAuth 2.0 SSO (GitHub, Discord, Twitter/X, …) — all with full dependency injection support via [injectkit](https://www.npmjs.com/package/injectkit).

## Installation

```bash
pnpm add @maroonedsoftware/authentication
```

## Features

- **Scheme-based dispatch** — register a handler per `Authorization` scheme (`Bearer`, `Basic`, or any custom scheme) and the right one is called automatically
- **`AuthenticationSession`** — a typed session object carrying subject, session token, satisfied MFA factors, and arbitrary credential claims
- **Safe defaults** — `invalidAuthenticationSession` is a well-typed sentinel for unauthenticated state that can be safely checked without null handling
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
- **OpenID Connect factors** — sign-in, account linking, and refresh-token rotation via `OidcFactorService` (built on [`openid-client`](https://www.npmjs.com/package/openid-client)) with public-client support and verified-email auto-linking
- **OAuth 2.0 factors** — non-OIDC sign-in (GitHub, Discord, Twitter/X, …) via `OAuth2FactorService` with an adapter interface that pairs cleanly with [`arctic`](https://www.npmjs.com/package/arctic)
- **DI-friendly** — all classes are decorated with `@Injectable()` and designed for an injectkit container

## Usage

### Scheme-based dispatch

#### 1. Implement a handler for your scheme

```typescript
import { Injectable } from 'injectkit';
import { AuthenticationHandler, AuthenticationSession, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { DateTime } from 'luxon';

@Injectable()
class MyJwtHandler implements AuthenticationHandler {
  async authenticate(scheme: string, value: string): Promise<AuthenticationSession> {
    const payload = await verifyJwt(value); // your JWT verification logic

    return {
      subject: payload.sub,
      sessionToken: payload.jti,
      issuedAt: DateTime.fromSeconds(payload.iat),
      lastAccessedAt: DateTime.now(),
      expiresAt: DateTime.fromSeconds(payload.exp),
      factors: [{
        method: 'password',
        methodId: payload.factorId,
        kind: 'knowledge',
        issuedAt: DateTime.fromSeconds(payload.iat),
        authenticatedAt: DateTime.fromSeconds(payload.iat),
      }],
      claims: payload,
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

#### 3. Resolve the authentication session

```typescript
const schemeHandler = container.get(AuthenticationSchemeHandler);

const session = await schemeHandler.handle('Bearer eyJhbGci...');
console.log(session.subject);  // 'user-123'
console.log(session.claims);   // { sub: 'user-123', ... }

// Missing or malformed header
const empty = await schemeHandler.handle(undefined);
console.log(empty === invalidAuthenticationSession); // true
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
  async parse(payload: JwtPayload): Promise<AuthenticationSession> {
    // Verify signature, expiry, audience, etc.
    return { subject: payload.sub!, sessionToken: payload.jti!, ... };
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
  async verify(username: string, password: string): Promise<AuthenticationSession> {
    const user = await db.users.findByUsername(username);
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      return invalidAuthenticationSession;
    }
    return { subject: user.id, sessionToken: crypto.randomUUID(), ... };
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

For local development and integration tests, register `OtpProviderMock` in place of `OtpProvider`. It overrides `generate` to always return `'000000'` and `validate` to always return `true`, and logs a warning on every call so it can't slip into production unnoticed. Never wire it into a production container.

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
const factor = await passwordFactors.createPasswordFactor(user.id, password);

// Verify on sign-in (rate-limited; throws 401 on bad credentials, 429 if rate-limited).
// Returns the verified factor (use `.id` to record which factor satisfied authentication).
const verified = await passwordFactors.verifyPassword(user.id, submittedPassword);

// Replace the password (validates strength, rejects reuse of the last 10)
const updated = await passwordFactors.updatePasswordFactor(user.id, newPassword);

// Change password and clear the `needsReset` flag
const changed = await passwordFactors.changePassword(user.id, newPassword);

// Remove the factor
await passwordFactors.deleteFactor(user.id);
```

For sign-up flows that collect a password before the actor record exists, use the two-step registration flow instead. `registerPasswordFactor` validates strength, hashes the password, and stages it in the cache for 10 minutes; `createPasswordFactorFromRegistration` binds it to an actor:

```typescript
// Step 1: stage the password (e.g. while the user is also verifying their email).
// Idempotent — `alreadyRegistered` is true when a pending registration was
// already cached for the same password.
const { registrationId, expiresAt, alreadyRegistered } = await passwordFactors.registerPasswordFactor(password);

// Step 2: once the actor record exists, bind the cached hash to it.
const factor = await passwordFactors.createPasswordFactorFromRegistration(user.id, registrationId);
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

// --- Challenge (sign-in) ---

// Step 1: send a challenge. Idempotent — `alreadyIssued` is true when a pending
// challenge was already cached, so the caller can skip re-sending the email.
const { email, challengeId, code, alreadyIssued } = await emailFactors.issueEmailChallenge(user.id, factor.id, 'code');
if (!alreadyIssued) {
  await mailer.sendOtp(email, code);
}

// Step 2: user submits the code. Returns the verified factor; throws 401 if the
// factor has been deleted or deactivated since the challenge was issued.
const verifiedFactor = await emailFactors.verifyEmailChallenge(challengeId, submittedCode);
```

`registerEmailFactor` rejects the request before issuing a code when:
- the email format is invalid (HTTP 400),
- the email is rejected by the `email.allowed` policy via `PolicyService` (HTTP 400 — invalid format or domain on the configured deny list, e.g. disposable mail providers),
- `EmailFactorRepository.isDomainInviteOnly(domain)` returns `true` (HTTP 403 — implement this to gate registration to allow-listed domains, e.g. workspaces that require an invite),
- an active factor already exists for the email (HTTP 409).

For the magic link flow, after the server has verified the link, return the page produced by `getRedirectHtml(redirectUrl)` instead of an HTTP redirect. The inline script defers navigation until `window.onload`, which sidesteps mail-client URL pre-fetchers that would otherwise burn the one-time token before the user clicks. The returned `nonce` must be echoed in a `Content-Security-Policy: script-src 'nonce-<nonce>'` header on the same response.

```typescript
const { html, nonce } = emailFactors.getRedirectHtml(new URL('https://app.example.com/welcome'));
ctx.set('Content-Security-Policy', `script-src 'nonce-${nonce}'`);
ctx.body = html;
```

---

### Authenticator app factors (TOTP/HOTP)

`AuthenticatorFactorService` manages the full lifecycle of authenticator app (TOTP/HOTP) factors. The secret is stored encrypted via `EncryptionProvider` and is never persisted in plaintext.

#### Registration

```typescript
import { AuthenticatorFactorService } from '@maroonedsoftware/authentication';

const authenticatorFactors = container.get(AuthenticatorFactorService);

// Step 1: generate a secret and QR code, cache the pending registration.
// Idempotent — `alreadyRegistered` is true when a pending registration was
// already cached for the actor (or the supplied registrationId), in which
// case the cached secret/uri/qrCode are returned so the same QR code can
// be re-rendered without invalidating the secret the user may have scanned.
const { registrationId, secret, uri, qrCode, expiresAt, alreadyRegistered } = await authenticatorFactors.registerAuthenticatorFactor(user.id);
// Display qrCode (a data URL) to the user so they can scan it into their authenticator app.
// secret is also returned for manual entry.

// Step 2: user enters the code from their app; verify it and persist the factor
const factor = await authenticatorFactors.createAuthenticatorFactorFromRegistration(
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
// Returns the verified factor. Throws HTTP 401 when the factor doesn't exist,
// is inactive, or the code is invalid.
const factor = await authenticatorFactors.validateFactor(user.id, factorId, submittedCode);
```

#### Deletion

```typescript
await authenticatorFactors.deleteFactor(user.id, factorId);
```

---

### Phone number factors

`PhoneFactorService` handles two-step phone number factor registration and sign-in challenges. Each step generates a TOTP `code` that your application sends out-of-band (e.g. via SMS) — the service returns the code so the caller can hand it to its SMS provider. The actor is bound at registration completion time, not at registration start, so the same flow drives sign-up (no actor exists yet), profile updates, and recovery. Both registration and sign-in challenges are idempotent: re-calling them returns the existing pending payload with `alreadyRegistered`/`alreadyIssued: true` so the caller can skip a duplicate SMS send.

```typescript
import { PhoneFactorService } from '@maroonedsoftware/authentication';

const phoneFactors = container.get(PhoneFactorService);

// --- Registration ---

// Step 1: cache a pending registration and get a code to SMS. `alreadyRegistered`
// is true when a pending registration was already cached — skip the SMS to avoid duplicates.
const { registrationId, code, alreadyRegistered } = await phoneFactors.registerPhoneFactor('+12025550123');
if (!alreadyRegistered) {
  await sms.send('+12025550123', `Your code is ${code}`);
}

// Step 2: user submits the code; verify it, bind to an actor, and persist the factor
const factor = await phoneFactors.createPhoneFactorFromRegistration(user.id, registrationId, submittedCode);

// --- Sign-in challenge ---

// Step 1: emit a fresh code for an existing active factor
const { phone, challengeId, code: signInCode, alreadyIssued } = await phoneFactors.issuePhoneChallenge(user.id, factor.id);
if (!alreadyIssued) {
  await sms.send(phone, `Your sign-in code is ${signInCode}`);
}

// Step 2: verify the code the user submitted; returns the verified factor
const verifiedFactor = await phoneFactors.verifyPhoneChallenge(challengeId, submittedCode);
```

---

### FIDO2 / WebAuthn factors

`FidoFactorService` handles passkey and security-key flows on top of [`fido2-lib`](https://www.npmjs.com/package/fido2-lib). Relying party identifiers (`rpId`, `rpOrigin`, `rpName`, `rpIcon`) come from `FidoFactorServiceOptions` by default and can be overridden per call, so a single service instance serves a primary host out of the box and still fronts multiple hosts when callers supply overrides. Both registration and sign-in are two-step: the server emits a challenge, caches the expectations for `FidoFactorServiceOptions.timeout` (5 minutes by default), and verifies the browser's response in step two.

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
const factor = await fidoFactors.createFidoFactorFromRegistration(user.id, credential);

// --- Authorization (sign-in) ---

// Step 1: emit an assertion challenge — `allowCredentials` is populated from
// the actor's active factors, so the browser only prompts for ones they have
const assertion = await fidoFactors.createFidoAuthorizationChallenge(user.id, {
  rpId: 'example.com',
  rpOrigin: 'https://example.com',
});
// Client decodes the challenge and each allowCredentials[].id to ArrayBuffers,
// calls navigator.credentials.get({ publicKey: ... }), and posts back.

// Step 2: verify the signature and bump the stored counter. Returns the verified factor.
const verifiedFactor = await fidoFactors.verifyFidoAuthorizationChallenge(user.id, credential);
```

Failed attestations and assertions throw HTTP 401 with a `WWW-Authenticate: Bearer error="invalid_credentials"` header (or `"invalid_registration"` when no pending registration is cached). When the credential id submitted at sign-in does not match a known factor for the actor — or the matching factor has been deactivated — `verifyFidoAuthorizationChallenge` throws HTTP 401 with `error="invalid_factor"` instead. The original `fido2-lib` error is attached as the cause and the raw inputs as internal details for logging.

---

### OpenID Connect factors

`OidcFactorService` orchestrates SSO sign-in, account linking, and refresh-token rotation against any OpenID Connect provider — Google, Microsoft, LinkedIn, Apple, etc. The id_token is validated end-to-end (signature against the provider's JWKS, `iss` / `aud` / `exp`, `nonce`, and PKCE) by `openid-client`.

Register one or more providers via `OidcProviderRegistry`. Discovery (`.well-known/openid-configuration`) is lazy and cached per provider per process. Public clients (mobile, SPA) are supported by omitting `clientSecret` — PKCE is mandatory in that mode.

```typescript
import {
  OidcFactorService,
  OidcProviderRegistry,
  OidcProviderRegistryConfig,
  OidcActorEmailLookup,
} from '@maroonedsoftware/authentication';

// Wire providers via DI (sourced from AppConfig — keep clientSecret out of code)
registry.registerValue(OidcProviderRegistryConfig, new OidcProviderRegistryConfig([
  {
    name: 'google',
    issuer: new URL('https://accounts.google.com'),
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    scopes: ['openid', 'profile', 'email'],
    redirectUri: new URL('https://app.example.com/auth/google/callback'),
    authorizeParams: { access_type: 'offline', prompt: 'consent' }, // needed for Google to issue a refresh token
    persistRefreshToken: true,
  },
]));
registry.register(OidcProviderRegistry).useClass(OidcProviderRegistry).asSingleton();
registry.register(OidcFactorService).useClass(OidcFactorService).asSingleton();

// Bridge OIDC sign-in to your existing account store. The lookup decides what
// counts as an "existing account with this email" — typically your email-factor
// table — and returns the actorId so OidcFactorService can auto-link.
@Injectable()
class MyEmailLookup extends OidcActorEmailLookup {
  constructor(private readonly emails: EmailFactorRepository) { super(); }
  async findActorByEmail(email: string) {
    const factor = await this.emails.lookupFactor(email);
    return factor?.active ? factor.actorId : undefined;
  }
}
registry.register(OidcActorEmailLookup).useClass(MyEmailLookup).asSingleton();

const oidc = container.get(OidcFactorService);

// Step 1 — redirect the browser to the IdP
const { url } = await oidc.beginAuthorization({
  provider: 'google',
  intent: 'sign-in',
  redirectAfter: '/welcome',
});
ctx.redirect(url.toString());

// Step 2 — handle the callback
const result = await oidc.completeAuthorization({ callbackUrl: new URL(ctx.href) });
switch (result.kind) {
  case 'signed-in':
  case 'linked':
    // Issue a session for result.actorId
    break;
  case 'new-user':
    if (result.emailConflict) {
      // An account with this email already exists but the IdP didn't claim it
      // verified — show "sign in to your existing account first to link this provider".
      break;
    }
    // Show a sign-up form, then call createFactorFromAuthorization with the new actorId.
    await oidc.createFactorFromAuthorization(newActorId, result.authorizationId);
    break;
}
```

**Account linking.** Pass `intent: 'link'` and an existing `actorId` on `beginAuthorization` to attach an additional provider to a signed-in user.

**Auto-link by verified email.** When sign-in finds no `(provider, subject)` mapping but the IdP returns a verified email matching an existing actor (via `OidcActorEmailLookup`), the service auto-creates the factor on that actor and returns `kind: 'linked'`. Unverified-email matches do **not** auto-link — they return `kind: 'new-user'` with `emailConflict` set so the UI can require sign-in to the existing account before linking.

**Refresh tokens.** Set `persistRefreshToken: true` on the provider config to envelope-encrypt and persist the refresh token (via `@maroonedsoftware/encryption`). Call `oidc.refreshAccessToken(actorId, factorId)` later for a fresh access token; rotated refresh tokens are re-encrypted automatically. Refresh tokens are dropped for public clients regardless of the flag, since safe handling requires DPoP or a backend proxy that this package doesn't implement.

---

### OAuth 2.0 factors (non-OIDC)

`OAuth2FactorService` covers providers that expose OAuth 2.0 but not full OpenID Connect — GitHub, Discord, Twitter/X, etc. The public surface mirrors the OIDC service so callback handling can be shared, but the underlying provider client is supplied as an adapter (typically wrapping an [`arctic`](https://www.npmjs.com/package/arctic) provider) plus a provider-specific `fetchProfile` that resolves the access token to a normalized profile.

```typescript
import { GitHub } from 'arctic';
import {
  OAuth2FactorService,
  OAuth2ProviderRegistry,
  OAuth2ProviderRegistryConfig,
  OAuth2ProviderClient,
  OAuth2Tokens,
  OAuth2ActorEmailLookup,
} from '@maroonedsoftware/authentication';

// Adapt an arctic provider to OAuth2ProviderClient
const github = new GitHub(config.github.clientId, config.github.clientSecret, 'https://app.example.com/auth/github/callback');
const githubClient: OAuth2ProviderClient = {
  createAuthorizationURL: (state, _codeVerifier, scopes) => github.createAuthorizationURL(state, scopes),
  validateAuthorizationCode: async (code) => {
    const tokens = await github.validateAuthorizationCode(code);
    return {
      accessToken: tokens.accessToken(),
      refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : undefined,
      expiresAt: tokens.hasRefreshToken() ? tokens.accessTokenExpiresAt() : undefined,
    } satisfies OAuth2Tokens;
  },
};

registry.registerValue(OAuth2ProviderRegistryConfig, new OAuth2ProviderRegistryConfig([
  {
    name: 'github',
    client: githubClient,
    scopes: ['read:user', 'user:email'],
    usesPKCE: false, // GitHub does not support PKCE
    fetchProfile: async (accessToken) => {
      const [user, emails] = await Promise.all([
        fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${accessToken}` } }).then((r) => r.json()),
        fetch('https://api.github.com/user/emails', { headers: { Authorization: `Bearer ${accessToken}` } }).then((r) => r.json()),
      ]);
      const primary = emails.find((e: { primary: boolean }) => e.primary);
      return {
        subject: String(user.id),
        email: primary?.email,
        emailVerified: primary?.verified === true,
        name: user.name ?? user.login,
        picture: user.avatar_url,
        rawProfile: { user, emails },
      };
    },
  },
]));
registry.register(OAuth2ProviderRegistry).useClass(OAuth2ProviderRegistry).asSingleton();
registry.register(OAuth2FactorService).useClass(OAuth2FactorService).asSingleton();

const oauth2 = container.get(OAuth2FactorService);
const { url } = await oauth2.beginAuthorization({ provider: 'github', intent: 'sign-in' });
// ...callback handling identical in shape to the OIDC service above.
```

**PKCE.** Set `usesPKCE: true` for providers that support it (Google in OAuth-2.0-only mode, Twitter/X, etc.) and the service generates a verifier per request, passing it to both `createAuthorizationURL` and `validateAuthorizationCode`. Set `false` for providers that don't (GitHub).

**Email verification semantics.** Unlike OIDC, most OAuth 2.0 providers don't expose an `email_verified` flag — the adapter is responsible for resolving it (e.g. GitHub's `/user/emails` returns a `verified` boolean per address). Default `emailVerified: false` rather than `undefined` if the provider gives no signal; the auto-link rules treat anything other than explicit `true` as unverified.

**Refresh tokens.** Same opt-in mechanism as OIDC: set `persistRefreshToken: true` and provide a `refreshAccessToken` method on the adapter. Rotated tokens are re-encrypted automatically.

---

## API Reference

### `AuthenticationSession`

The resolved session produced by a successful authentication check, and the
authoritative server-side record stored in cache. JWTs issued from this
session are short-lived signed references — revoke the session to invalidate
all tokens derived from it.

| Property          | Type                            | Description                                              |
| ----------------- | ------------------------------- | -------------------------------------------------------- |
| `subject`         | `string`                        | Subject identifier (typically a user id)                 |
| `sessionToken`    | `string`                        | Opaque random token used as the cache key and embedded in JWTs |
| `issuedAt`        | `DateTime`                      | When the session was originally issued                   |
| `lastAccessedAt`  | `DateTime`                      | When the session was last accessed                       |
| `expiresAt`       | `DateTime`                      | When the session expires                                 |
| `factors`         | `AuthenticationSessionFactor[]` | MFA factors satisfied in this session                    |
| `claims`          | `Record<string, unknown>`       | Arbitrary key/value claims to embed in tokens issued from this session |

### `AuthenticationSessionFactor`

Describes a single satisfied authentication factor within a session.

| Property            | Type                          | Description                                                       |
| ------------------- | ----------------------------- | ----------------------------------------------------------------- |
| `method`            | `AuthenticationFactorMethod`  | Verification method used (e.g. `"password"`, `"authenticator"`, `"fido"`) |
| `methodId`          | `string`                      | Stable identifier for the specific factor record (e.g. a DB row id) |
| `kind`              | `AuthenticationFactorKind`    | MFA category: `"knowledge"`, `"possession"`, or `"biometric"`     |
| `issuedAt`          | `DateTime`                    | When this factor entry was first added to the session             |
| `authenticatedAt`   | `DateTime`                    | When the factor was most recently re-verified                     |

### `AuthenticationFactorMethod`

```typescript
type AuthenticationFactorMethod = 'phone' | 'password' | 'authenticator' | 'email' | 'fido';
```

### `AuthenticationFactorKind`

```typescript
type AuthenticationFactorKind = 'knowledge' | 'possession' | 'biometric';
```

| Value        | Meaning              | Examples                        |
| ------------ | -------------------- | ------------------------------- |
| `knowledge`  | Something you know   | Password, PIN                   |
| `possession` | Something you have   | TOTP app, hardware security key |
| `biometric`  | Something you are    | Fingerprint, face ID            |

### `invalidAuthenticationSession`

A sentinel `AuthenticationSession` value representing an unauthenticated or failed state. All `DateTime` fields are invalid Luxon instances.

```typescript
import { invalidAuthenticationSession } from '@maroonedsoftware/authentication';

if (session === invalidAuthenticationSession) {
  throw httpError(401);
}
```

### `AuthenticationSchemeHandler`

| Method                         | Returns                          | Description                                                                             |
| ------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------- |
| `handle(authorizationHeader?)` | `Promise<AuthenticationSession>` | Parses the `Authorization` header and returns the resolved session, or `invalidAuthenticationSession` |

Returns `invalidAuthenticationSession` when the header is absent, malformed, or no handler is registered for the scheme.

### `AuthenticationHandlerMap`

An injectable `Map<AuthorizationScheme, AuthenticationHandler>`. Register one entry per scheme.

### `AuthenticationHandler`

```typescript
interface AuthenticationHandler {
  authenticate(scheme: string, value: string): Promise<AuthenticationSession>;
}
```

### `AuthorizationScheme`

```typescript
type AuthorizationScheme = 'bearer' | 'basic' | string;
```

### `JwtAuthenticationHandler`

Handles `bearer` tokens by decoding the JWT, extracting the `iss` claim, and delegating to the matching `JwtAuthenticationIssuer`.

### `JwtAuthenticationIssuer`

Abstract base class. Implement `parse(payload: JwtPayload): Promise<AuthenticationSession>` to validate tokens from a specific issuer. Register instances in `JwtAuthenticationIssuerMap` keyed by the `iss` claim value.

### `BasicAuthenticationHandler`

Handles `basic` tokens by base64-decoding the credential, splitting on `:`, and delegating to `BasicAuthenticationIssuer`.

### `BasicAuthenticationIssuer`

Abstract base class. Implement `verify(username: string, password: string): Promise<AuthenticationSession>`.

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

### `OtpProviderMock`

Drop-in replacement for `OtpProvider` for local development and integration tests. `generate` always returns `'000000'`, `validate` always returns `true`, and each call logs a `WARN` via the injected `Logger`. Never register in production.

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

### Policies (`email.allowed`, `phone.allowed`)

Email and phone validation are dispatched through `PolicyService` from [`@maroonedsoftware/policies`](../policies/README.md). The bundled `EmailFactorService` and `PhoneFactorService` call `policyService.check('email.allowed', { value })` and `policyService.check('phone.allowed', { value })` respectively, then map the machine-readable `reason` on a denial to a user-facing HTTP 400 (`{ value: <message> }`).

This package ships two `Policy` implementations you can register against those names — or subclass / replace to add stricter rules (regional phone filtering, dynamic deny lists, MX record probing, etc.) without modifying the factor services.

#### `EmailAllowedPolicy`

Rejects malformed email addresses and addresses whose domain is on the configured deny list.

Denial reasons: `'invalid_format'`, `'deny_list'`.

`EmailAllowedPolicyOptions`:

| Option                 | Type       | Default | Description                                                                                       |
| ---------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------- |
| `emailDomainDenyList`  | `string[]` | `[]`    | Sorted list of email domains to reject (checked via binary search; e.g. disposable mail providers) |

#### `PhoneAllowedPolicy`

Rejects phone numbers that are not in E.164 format. Denial reason: `'invalid_format'`.

#### Wiring

```ts
import {
  BasePolicyService,
  type PolicyEnvelope,
  PolicyRegistryMap,
  PolicyService,
} from '@maroonedsoftware/policies';
import {
  EmailAllowedPolicy,
  EmailAllowedPolicyOptions,
  PhoneAllowedPolicy,
} from '@maroonedsoftware/authentication';

type AuthPolicies = {
  'email.allowed': { value: string };
  'phone.allowed': { value: string };
};

@Injectable()
class AuthPolicyService extends BasePolicyService<AuthPolicies> {
  protected async buildEnvelope(): Promise<PolicyEnvelope> {
    return { now: DateTime.utc() };
  }
}

registry.register(EmailAllowedPolicyOptions).useValue(new EmailAllowedPolicyOptions(['disposable.com', 'tempmail.org']));
registry.register(EmailAllowedPolicy).useClass(EmailAllowedPolicy).asSingleton();
registry.register(PhoneAllowedPolicy).useClass(PhoneAllowedPolicy).asSingleton();
registry.register(PolicyRegistryMap).useFactory(() => {
  const map = new PolicyRegistryMap();
  map.set('email.allowed', EmailAllowedPolicy);
  map.set('phone.allowed', PhoneAllowedPolicy);
  return map;
});
registry.register(PolicyService).useClass(AuthPolicyService).asSingleton();
```

### `PasswordFactorService`

Manages password factors with PBKDF2-SHA512 hashing, password-reuse prevention, and rate-limited verification. Strength checks are delegated to an injected `PasswordStrengthProvider`. Requires that provider, a `RateLimiterCompatibleAbstract` (from `rate-limiter-flexible`), and a `CacheProvider` (used by the staged-registration flow) registered in the DI container.

| Method                                                              | Returns                                                                              | Description                                                                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `createPasswordFactor(actorId, password, needsReset?)`              | `Promise<PasswordFactor>`                                                            | Validate strength via `PasswordStrengthProvider` and persist a new factor; throws HTTP 409 if one already exists. Returns the new factor     |
| `registerPasswordFactor(password, registrationId?)`                 | `Promise<{ registrationId, expiresAt: DateTime, issuedAt: DateTime, alreadyRegistered: boolean }>` | Validate strength and stage a hashed registration in the cache for 10 minutes (idempotent — `alreadyRegistered` is `true` on a cache hit)    |
| `createPasswordFactorFromRegistration(actorId, registrationId)`     | `Promise<PasswordFactor>`                                                            | Complete a staged registration; throws HTTP 404 when the registration is missing or expired                                                  |
| `hasPendingRegistration(registrationId)`                            | `Promise<boolean>`                                                                   | Check whether a staged registration is still cached and unexpired                                                                            |
| `updatePasswordFactor(actorId, password, needsReset?)`              | `Promise<PasswordFactor>`                                                            | Replace the password after strength check and reuse check against the last 10 passwords. Returns the updated factor                          |
| `verifyPassword(actorId, password)`                                 | `Promise<PasswordFactor>`                                                            | Verify against the stored hash with rate limiting; throws HTTP 401 on bad credentials, HTTP 429 if rate-limited. Returns the verified factor |
| `changePassword(actorId, password)`                                 | `Promise<PasswordFactor>`                                                            | Set a new password and clear the `needsReset` flag. Returns the updated factor                                                               |
| `checkPasswordStrength(password, ...userInputs)`                    | `Promise<{ valid: boolean, score: number, feedback }>`                               | Pass-through to `PasswordStrengthProvider.checkStrength` for live strength feedback (e.g. a sign-up form meter)                              |
| `ensurePasswordStrength(password, ...userInputs)`                   | `Promise<void>`                                                                      | Pass-through to `PasswordStrengthProvider.ensureStrength`; throws HTTP 400 when the password is below the strength threshold                 |
| `clearRateLimit(actorId)`                                           | `Promise<void>`                                                                      | Reset the verify-password rate-limiter counter for an actor (e.g. after an out-of-band recovery)                                             |
| `deleteFactor(actorId)`                                             | `Promise<void>`                                                                      | Permanently remove the actor's password factor                                                                                               |

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
| `registerEmailFactor(value, verificationMethod, registrationId?)`   | `Promise<{ registrationId, code, expiresAt: DateTime, issuedAt: DateTime, alreadyRegistered: boolean }>` | Initiate email factor registration (idempotent — `alreadyRegistered` is `true` on a cache hit) |
| `createEmailFactorFromRegistration(actorId, registrationId, code)`  | `Promise<EmailFactor>`                                      | Complete registration                   |
| `hasPendingRegistration(registrationId)`                            | `Promise<boolean>`                                          | Check whether a registration is still cached and unexpired |
| `issueEmailChallenge(actorId, factorId, issueMethod)`               | `Promise<{ email, challengeId, code, expiresAt: DateTime, issuedAt: DateTime, alreadyIssued: boolean }>` | Initiate a sign-in challenge (idempotent — `alreadyIssued` is `true` on a cache hit) |
| `verifyEmailChallenge(challengeId, code)`                           | `Promise<EmailFactor>`                                      | Complete a sign-in challenge; re-checks the factor is active and returns it (HTTP 401 if it has been deleted or deactivated since the challenge was issued) |
| `hasPendingChallenge(challengeId)`                                  | `Promise<boolean>`                                          | Check whether a challenge is still cached and unexpired    |
| `getRedirectHtml(redirectUrl: URL)`                                 | `{ html, nonce }`                                           | Build a magic-link landing page that redirects to `redirectUrl` via a CSP-nonce-gated inline script (rejects non-`http(s):` URLs with HTTP 400) |

`EmailFactorServiceOptions`:

| Option                | Type       | Default    | Description                                                                              |
| --------------------- | ---------- | ---------- | ---------------------------------------------------------------------------------------- |
| `otpExpiration`       | `Duration` | 10 minutes | How long an OTP-code registration or sign-in challenge stays valid                       |
| `magiclinkExpiration` | `Duration` | 30 minutes | How long a magic link token stays valid                                                  |
| `tokenLength`         | `number`   | `6`        | Length, in digits, of the generated OTP code (ignored for the `magiclink` method)        |

Email format validation and the disposable-domain deny list are dispatched through `PolicyService` under the [`email.allowed` policy](#policies-emailallowed-phoneallowed) — configure them via `EmailAllowedPolicyOptions`.

### `EmailFactorRepository`

Abstract base class. Extend and register a concrete implementation so that `EmailFactorService` can resolve it at runtime.

| Method                              | Returns                  | Description                                          |
| ----------------------------------- | ------------------------ | ---------------------------------------------------- |
| `createFactor(actorId, value)`      | `Promise<EmailFactor>`   | Persist a new email factor                           |
| `lookupFactor(value)`               | `Promise<EmailFactor \| undefined>` | Look up an email factor by email address             |
| `isDomainInviteOnly(domain)`        | `Promise<boolean>`       | Check whether a domain is invite-only (gates registration) |
| `getFactor(actorId, factorId)`      | `Promise<EmailFactor>`   | Retrieve a factor by id                              |
| `deleteFactor(actorId, factorId)`   | `Promise<void>`          | Remove a factor                                      |

`EmailFactor`: `{ id: string; actorId: string; active: boolean; value: string }` where `value` is the verified email address.

### `AuthenticatorFactorService`

Manages TOTP/HOTP authenticator app factors. Requires an `AuthenticatorFactorServiceOptions` object with at minimum an `issuer` string.

| Method                                                                            | Returns                                                                                                                                       | Description                                                                                                              |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `registerAuthenticatorFactor(actorId, options?, registrationId?)`                 | `Promise<{ registrationId, secret, uri, qrCode, expiresAt: DateTime, issuedAt: DateTime, alreadyRegistered: boolean }>`                       | Generate a secret, QR code, and cache the pending registration (idempotent — `alreadyRegistered` is `true` on a cache hit) |
| `createAuthenticatorFactorFromRegistration(actorId, registrationId, code)`        | `Promise<AuthenticatorFactor>`                                                                                                                | Verify the first OTP code and persist the factor                                                                          |
| `hasPendingRegistration(registrationId)`                                          | `Promise<boolean>`                                                                                                                            | Check whether a registration is still cached and unexpired                                                                |
| `validateFactor(actorId, factorId, code)`                                         | `Promise<AuthenticatorFactor>`                                                                                                                | Verify a TOTP/HOTP code and return the verified factor; throws HTTP 401 on failure                                        |
| `deleteFactor(actorId, factorId)`                                                 | `Promise<void>`                                                                                                                               | Remove a factor                                                                                                          |

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

Manages phone number factor registration and sign-in challenges. Requires a `PhoneFactorServiceOptions` object.

| Method                                                              | Returns                                                                                                       | Description                                                                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerPhoneFactor(value, registrationId?)`                       | `Promise<{ registrationId, code, expiresAt: DateTime, issuedAt: DateTime, alreadyRegistered: boolean }>`      | Validate the E.164 number, generate a code, and cache a pending registration (idempotent — `alreadyRegistered` is `true` on a cache hit)                   |
| `createPhoneFactorFromRegistration(actorId, registrationId, code)`  | `Promise<PhoneFactor>`                                                                                        | Verify the code, bind the cached phone number to `actorId`, and persist the factor                                                                          |
| `hasPendingRegistration(registrationId)`                            | `Promise<boolean>`                                                                                            | Check whether a registration is still cached and unexpired                                                                                                  |
| `issuePhoneChallenge(actorId, factorId)`                            | `Promise<{ phone, challengeId, code, expiresAt: DateTime, issuedAt: DateTime, alreadyIssued: boolean }>`      | Initiate a sign-in challenge for an active factor (idempotent — `alreadyIssued` is `true` on a cache hit)                                                   |
| `verifyPhoneChallenge(challengeId, code)`                           | `Promise<PhoneFactor>`                                                                                        | Complete a sign-in challenge; re-checks the factor is active and returns it (HTTP 401 if it has been deleted or deactivated since the challenge was issued) |
| `hasPendingChallenge(challengeId)`                                  | `Promise<boolean>`                                                                                            | Check whether a challenge is still cached and unexpired                                                                                                     |

`PhoneFactorServiceOptions`:

| Option          | Type       | Default    | Description                                                            |
| --------------- | ---------- | ---------- | ---------------------------------------------------------------------- |
| `otpExpiration` | `Duration` | 10 minutes | How long a pending registration or sign-in challenge stays valid       |
| `tokenLength`   | `number`   | `6`        | Length, in digits, of the generated OTP code                           |

`registerPhoneFactor` rejects invalid phone numbers via the [`phone.allowed` policy](#policies-emailallowed-phoneallowed) on `PolicyService` (HTTP 400 for non-E.164 input). `createPhoneFactorFromRegistration` throws HTTP 404 when the registration has expired and HTTP 400 when the submitted code is invalid. `verifyPhoneChallenge` throws HTTP 404 for an expired/missing challenge, HTTP 401 (`WWW-Authenticate: Bearer error="invalid_factor"`) when the factor has been deactivated since the challenge was issued, and HTTP 400 for an invalid code. The actor is bound at registration completion time, so callers that need to enforce uniqueness against existing factors should do so themselves before calling `createPhoneFactorFromRegistration`.

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
| `createFidoFactorFromRegistration(actorId, credential)`        | `Promise<FidoFactor>`                                  | Verify the attestation and persist the factor; returns the new factor                |
| `createFidoAuthorizationChallenge(actorId, options)`           | `Promise<{ challenge, allowCredentials, ... }>`        | Emit an assertion challenge (`allowCredentials` from the actor's active factors)     |
| `verifyFidoAuthorizationChallenge(actorId, credential)`        | `Promise<FidoFactor>`                                  | Verify the assertion signature, bump the stored counter, and return the factor       |

`FidoFactorServiceOptions`:

| Option      | Type       | Default                | Description                                                                                              |
| ----------- | ---------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `timeout`   | `Duration` | 5 minutes              | How long a pending registration or authorization challenge stays valid (also forwarded to the browser)   |
| `rpId`      | `string`   | `'localhost'`          | Default relying party id when not overridden per call                                                    |
| `rpName`    | `string`   | `'Localhost'`          | Default human-readable relying party name when not overridden per call                                   |
| `rpOrigin`  | `string`   | `'http://localhost'`   | Default relying party origin when not overridden per call                                                |
| `rpIcon`    | `string?`  | —                      | Default icon URL when not overridden per call                                                            |

`RegisterFidoFactorOptions`: `{ rpId?, rpName?, rpOrigin?, rpIcon?, userName, userDisplayName }`. The `rp*` fields all fall back to the corresponding `FidoFactorServiceOptions` defaults.

`AuthorizeFidoFactorOptions`: `{ rpId?, rpOrigin? }`. Both fields fall back to the corresponding `FidoFactorServiceOptions` defaults; the `options` argument to `createFidoAuthorizationChallenge` may also be omitted entirely.

`createFidoFactorFromRegistration` throws HTTP 401 with `WWW-Authenticate: Bearer error="invalid_registration"` when no pending registration is cached, or `error="invalid_credentials"` on attestation failure. `createFidoAuthorizationChallenge` throws HTTP 404 when the actor has no active factors. `verifyFidoAuthorizationChallenge` throws HTTP 401 with `error="invalid_credentials"` when the challenge is missing/expired or the signature is invalid, and with `error="invalid_factor"` when the credential id is unknown for the actor or the matching factor has been deactivated.

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

### `OidcProviderRegistry`

Holds the configured OIDC providers and lazily resolves an `openid-client` `Configuration` per provider on first use. Constructed from an injected `OidcProviderRegistryConfig`.

| Method                       | Returns                                | Description                                                                              |
| ---------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `getConfig(name)`            | `OidcProviderConfig`                   | Look up the static config; throws HTTP 404 for unknown providers                         |
| `isPublicClient(name)`       | `boolean`                              | `true` when the provider has no `clientSecret`                                           |
| `getConfiguration(name)`     | `Promise<openid-client.Configuration>` | Lazy-resolve and cache the discovery-backed Configuration; deduplicates concurrent calls |
| `listProviders()`            | `string[]`                             | Names of all registered providers                                                        |

`OidcProviderConfig`: `{ name; issuer: URL; clientId; clientSecret?; scopes: string[]; redirectUri: URL; authorizeParams?: Record<string, string>; persistRefreshToken?: boolean }`. Omit `clientSecret` for public (mobile/SPA) clients — the registry uses `openid-client.None()` and PKCE becomes mandatory.

### `OidcFactorService`

| Method                                                  | Returns                                                          | Description                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `beginAuthorization({ provider, intent, actorId?, redirectAfter? })` | `Promise<{ url: URL; state; expiresAt: DateTime }>`                | Build the IdP authorize URL and cache the round-trip state record (state, nonce, PKCE verifier)                   |
| `completeAuthorization({ callbackUrl })`                | `Promise<OidcAuthorizationResult>`                               | Exchange the auth code, validate the id_token, fetch userinfo, and resolve to a factor                            |
| `createFactorFromAuthorization(actorId, authorizationId)` | `Promise<OidcFactor>`                                          | Complete the `new-user` branch by attaching the cached profile to a freshly created actor                         |
| `refreshAccessToken(actorId, factorId)`                 | `Promise<{ accessToken; expiresAt: DateTime \| null; scope?; idToken? }>` | Rotate the access token using the persisted refresh token; re-encrypts a rotated refresh token automatically      |
| `hasPendingAuthorization(authorizationId)`              | `Promise<boolean>`                                               | Check whether a `new-user` pending authorization is still cached and unconsumed                                   |

`OidcAuthorizationResult` is a discriminated union with `kind` ∈ `'signed-in' | 'linked' | 'new-user'`. The `'new-user'` branch carries `authorizationId` and an optional `emailConflict: { actorId; reason: 'unverified-email' }` when the IdP-claimed email matches an existing actor but is unverified.

`OidcFactorServiceOptions`:

| Option                            | Type       | Default    | Description                                                                                          |
| --------------------------------- | ---------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `stateExpiration`                 | `Duration` | 10 minutes | How long a state record (the round-trip between authorize and callback) lives                        |
| `pendingAuthorizationExpiration`  | `Duration` | 30 minutes | How long a `new-user` pending authorization survives before the caller must complete it              |

### `OidcActorEmailLookup`

Abstract bridge from a verified email to an actor id. Used by the auto-link flow. Return `undefined` for ambiguity to force the caller through the explicit new-user / link path.

| Method                       | Returns                          | Description                                                       |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| `findActorByEmail(email)`    | `Promise<string \| undefined>`   | Resolve an email to an actor id; `undefined` when no match exists |

### `OidcFactorRepository`

Abstract base class. Implementations should enforce uniqueness on `(provider, subject)`.

| Method                                              | Returns                                | Description                                                                                       |
| --------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `createFactor({ actorId, provider, subject, email?, encryptedRefreshToken?, encryptedRefreshTokenDek?, refreshTokenExpiresAt? })` | `Promise<OidcFactor>`                  | Persist a new factor                                                                              |
| `lookupFactor(provider, subject)`                   | `Promise<OidcFactor \| undefined>`     | Look up by provider-side identity                                                                 |
| `lookupFactorsByEmail(email)`                       | `Promise<OidcFactor[]>`                | Look up by last-seen email — used by the auto-link flow                                           |
| `getFactor(actorId, factorId)`                      | `Promise<OidcFactor>`                  | Retrieve a factor by id, scoped to the owning actor                                               |
| `listFactorsForActor(actorId)`                      | `Promise<OidcFactor[]>`                | List active factors for an actor (account-settings UI)                                            |
| `updateRefreshToken(factorId, { encryptedRefreshToken, encryptedRefreshTokenDek, refreshTokenExpiresAt? })` | `Promise<void>`         | Update the persisted refresh token after rotation                                                 |
| `updateEmail(factorId, email)`                      | `Promise<void>`                        | Update the last-seen email                                                                        |
| `deleteFactor(actorId, factorId)`                   | `Promise<void>`                        | Remove a factor                                                                                   |

`OidcFactor`: `{ id; actorId; active; provider; subject; email?; encryptedRefreshToken?; encryptedRefreshTokenDek?; refreshTokenExpiresAt?: Date | null }`.

### `OAuth2ProviderRegistry`

Holds OAuth-2.0-only provider adapters. No discovery step — adapters are constructed at app boot and looked up by name.

| Method                | Returns                  | Description                                          |
| --------------------- | ------------------------ | ---------------------------------------------------- |
| `getConfig(name)`     | `OAuth2ProviderConfig`   | Look up the config; throws HTTP 404 when unknown     |
| `listProviders()`     | `string[]`               | Names of all registered providers                    |

`OAuth2ProviderConfig`: `{ name; client: OAuth2ProviderClient; scopes: string[]; usesPKCE: boolean; fetchProfile: (accessToken) => Promise<Omit<OAuth2Profile, 'provider'>>; persistRefreshToken?: boolean }`.

`OAuth2ProviderClient`: adapter interface — `createAuthorizationURL(state, codeVerifier | null, scopes)`, `validateAuthorizationCode(code, codeVerifier | null)`, optional `refreshAccessToken(refreshToken)`. Wrap a provider-specific client (typically an [`arctic`](https://www.npmjs.com/package/arctic) provider).

### `OAuth2FactorService`

Mirrors `OidcFactorService`'s public surface. Same method names, same result shape (`OAuth2AuthorizationResult` with `'signed-in' | 'linked' | 'new-user'`), same `emailConflict` discriminant. See the [Usage section](#oauth-20-factors-non-oidc) for example wiring.

| Method                                                  | Returns                                                          | Description                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `beginAuthorization({ provider, intent, actorId?, redirectAfter? })` | `Promise<{ url: URL; state; expiresAt: DateTime }>`                | Build the provider authorize URL and cache the round-trip state record                                            |
| `completeAuthorization({ callbackUrl })`                | `Promise<OAuth2AuthorizationResult>`                             | Exchange the auth code, fetch the provider profile, and resolve to a factor                                       |
| `createFactorFromAuthorization(actorId, authorizationId)` | `Promise<OAuth2Factor>`                                        | Complete the `new-user` branch                                                                                    |
| `refreshAccessToken(actorId, factorId)`                 | `Promise<{ accessToken; expiresAt: Date \| null; scopes?; idToken? }>` | Rotate the access token via the adapter's `refreshAccessToken`; throws HTTP 400 when the adapter doesn't implement it |
| `hasPendingAuthorization(authorizationId)`              | `Promise<boolean>`                                               | Check whether a pending authorization is still cached                                                             |

`OAuth2FactorServiceOptions`: same shape as `OidcFactorServiceOptions` (`stateExpiration` 10 min, `pendingAuthorizationExpiration` 30 min by default).

### `OAuth2ActorEmailLookup`

Same contract as `OidcActorEmailLookup` — separate type so the two factor services can be wired up independently.

### `OAuth2FactorRepository`

Abstract base class with the same surface as `OidcFactorRepository`. Stored in a separate table from OIDC factors — the trust model differs (userinfo vs signed id_token) and `(provider, subject)` uniqueness lives in a different namespace.

`OAuth2Factor`: same shape as `OidcFactor`.

## License

MIT
