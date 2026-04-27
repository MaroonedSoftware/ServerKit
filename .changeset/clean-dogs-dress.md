---
'@maroonedsoftware/authentication': minor
---

refactor: update email verification to email challenge

- Renamed methods and types related to email verification to reflect a challenge-based approach, enhancing clarity in the authentication flow.
- Updated documentation and comments to align with the new terminology, including changes from `createEmailVerification` to `issueEmailChallenge` and `verifyEmailVerification` to `verifyEmailChallenge`.
- Adjusted caching mechanisms and payload structures to support the new challenge system.
- Enhanced unit tests to validate the updated challenge functionality and ensure proper behavior in various scenarios.
