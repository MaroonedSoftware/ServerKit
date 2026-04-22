# @maroonedsoftware/authentication

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
