---
'@maroonedsoftware/authentication': minor
---

feat: integrate FIDO2/WebAuthn support into authentication package

- Added FIDO2/WebAuthn factors to the authentication utilities, enabling passkey and security-key registration and sign-in via `FidoFactorService`.
- Updated README to include FIDO2/WebAuthn usage details and examples.
- Enhanced email factor service to check for invite-only domains during registration.
- Refactored password strength validation to utilize a dedicated `PasswordStrengthProvider`.
- Introduced unit tests for new FIDO factor service and updated email factor service tests to cover new domain checks.
