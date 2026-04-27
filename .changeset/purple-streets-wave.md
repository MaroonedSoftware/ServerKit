---
'@maroonedsoftware/authentication': minor
---

refactor: enhance email and phone factor services with idempotency and cache management

- Updated `createEmailVerification` and `registerPhoneFactor` methods to support idempotency, returning existing verifications and registrations when applicable.
- Improved cache management by deleting cached entries after successful registrations and verifications to prevent replay attacks.
- Adjusted return types in method documentation to reflect new properties, including `alreadyIssued` for email verifications and `value` for phone registrations.
- Enhanced unit tests to cover new functionality and ensure proper cache behavior.
