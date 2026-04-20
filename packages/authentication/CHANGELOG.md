# @maroonedsoftware/authentication

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
