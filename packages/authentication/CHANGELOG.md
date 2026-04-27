# @maroonedsoftware/authentication

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
