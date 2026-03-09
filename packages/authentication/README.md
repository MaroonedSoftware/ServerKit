# @maroonedsoftware/authentication

Authentication utilities for ServerKit. Provides a scheme-based handler dispatch model for resolving `Authorization` request headers into typed `AuthenticationContext` objects, with full dependency injection support via [injectkit](https://www.npmjs.com/package/injectkit).

## Installation

```bash
pnpm add @maroonedsoftware/authentication
```

## Features

- **Scheme-based dispatch** — register a handler per `Authorization` scheme (`Bearer`, `Basic`, or any custom scheme) and the right one is called automatically
- **`AuthenticationContext`** — a typed context object carrying session metadata, satisfied MFA factors, and arbitrary credential claims
- **Safe defaults** — `invalidAuthenticationContext` is a well-typed sentinel for unauthenticated state that can be safely checked without null handling
- **DI-friendly** — all classes are decorated with `@Injectable()` and designed to be registered in an injectkit container

## Usage

### 1. Implement a handler for your scheme

```typescript
import { Injectable } from 'injectkit';
import { AuthenticationHandler, AuthenticationContext } from '@maroonedsoftware/authentication';
import { DateTime } from 'luxon';

@Injectable()
class JwtAuthenticationHandler implements AuthenticationHandler {
  async authenticate(scheme: string, token: string): Promise<AuthenticationContext> {
    const payload = verifyJwt(token); // your JWT verification logic

    return {
      authenticationId: payload.jti,
      issuedAt: DateTime.fromSeconds(payload.iat),
      lastAccessedAt: DateTime.now(),
      expiresAt: DateTime.fromSeconds(payload.exp),
      factors: [
        {
          method: 'password',
          type: 'password',
          lastAuthenticated: DateTime.fromSeconds(payload.iat),
          kind: 'knowledge',
        },
      ],
      claims: payload,
    };
  }
}
```

### 2. Register the handler map in your DI container

```typescript
import { InjectKitRegistry } from 'injectkit';
import {
  AuthenticationHandlerMap,
  AuthenticationSchemeHandler,
} from '@maroonedsoftware/authentication';

const registry = new InjectKitRegistry();

registry
  .register(AuthenticationHandlerMap)
  .useMap(AuthenticationHandlerMap)
  .set('Bearer', JwtAuthenticationHandler);

registry.register(JwtAuthenticationHandler).useClass(JwtAuthenticationHandler).asSingleton();
registry.register(AuthenticationSchemeHandler).useClass(AuthenticationSchemeHandler).asSingleton();
```

### 3. Resolve the authentication context

`AuthenticationSchemeHandler.handle()` parses the raw `Authorization` header, looks up the registered handler for the scheme, and returns the resolved context. It returns `invalidAuthenticationContext` when no header is present, the header is malformed, or no handler is registered for the scheme.

```typescript
const schemeHandler = container.get(AuthenticationSchemeHandler);

// With a valid Bearer token
const ctx = await schemeHandler.handle('Bearer eyJhbGci...');
console.log(ctx.authenticationId); // 'abc-123'
console.log(ctx.claims);           // { sub: 'user-1', ... }

// With no header
const ctx = await schemeHandler.handle(undefined);
console.log(ctx === invalidAuthenticationContext); // true
```

### 4. With the ServerKit Koa middleware

When using `@maroonedsoftware/koa`, the `authenticationMiddleware` handles all of this automatically and attaches the resolved context to `ctx.authenticationContext` on every request:

```typescript
import { authenticationMiddleware } from '@maroonedsoftware/koa';

app.use(authenticationMiddleware());

// In a route handler:
router.get('/me', async (ctx) => {
  const { authenticationContext } = ctx;

  if (authenticationContext === invalidAuthenticationContext) {
    throw httpError(401);
  }

  ctx.body = { userId: authenticationContext.claims.sub };
});
```

## API Reference

### `AuthenticationContext`

The resolved context produced by a successful authentication check.

| Property           | Type                      | Description                                              |
| ------------------ | ------------------------- | -------------------------------------------------------- |
| `authenticationId` | `string`                  | Unique identifier for this authentication session        |
| `issuedAt`         | `DateTime`                | When the session was originally issued                   |
| `lastAccessedAt`   | `DateTime`                | When the session was last accessed                       |
| `expiresAt`        | `DateTime`                | When the session expires                                 |
| `factors`          | `AuthenticationFactor[]`  | MFA factors satisfied in this session                    |
| `claims`           | `Record<string, unknown>` | Arbitrary key/value claims extracted from the credential |

### `AuthenticationFactor`

Describes a single satisfied authentication factor.

| Property            | Type                       | Description                                                       |
| ------------------- | -------------------------- | ----------------------------------------------------------------- |
| `method`            | `string`                   | Specific method used (e.g. `"password"`, `"totp"`, `"webauthn"`) |
| `type`              | `string`                   | Broader type grouping (e.g. `"otp"`, `"passkey"`)                 |
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

A sentinel `AuthenticationContext` value representing an unauthenticated or failed state. All `DateTime` fields are invalid Luxon instances. Use this as a safe default before authentication resolves, or as a guard value:

```typescript
import { invalidAuthenticationContext } from '@maroonedsoftware/authentication';

if (ctx.authenticationContext === invalidAuthenticationContext) {
  throw httpError(401);
}
```

### `AuthenticationSchemeHandler`

Parses the `Authorization` header and dispatches to the registered handler for the scheme.

| Method                         | Returns                          | Description                                                                            |
| ------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------- |
| `handle(authorizationHeader?)` | `Promise<AuthenticationContext>` | Resolves the header to a context, or returns `invalidAuthenticationContext` on failure |

Returns `invalidAuthenticationContext` when:
- No `Authorization` header is present
- The header is malformed (missing scheme or value)
- No handler is registered for the scheme

### `AuthenticationHandlerMap`

An injectable `Map<AuthorizationScheme, AuthenticationHandler>`. Register one entry per scheme you want to support.

### `AuthenticationHandler`

Interface for scheme-specific credential validators.

```typescript
interface AuthenticationHandler {
  authenticate(scheme: string, value: string): Promise<AuthenticationContext>;
}
```

### `AuthorizationScheme`

```typescript
type AuthorizationScheme = 'bearer' | 'basic' | string;
```

Accepts any string so custom schemes can be registered alongside the built-in hints.

## License

MIT
