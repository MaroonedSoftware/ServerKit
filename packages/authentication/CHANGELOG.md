# @maroonedsoftware/authentication

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
