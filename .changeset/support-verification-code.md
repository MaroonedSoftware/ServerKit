---
'@maroonedsoftware/authentication': minor
---

Adds a support-verification code surface — a rotating TOTP an authenticated
user displays in their app and reads aloud to a customer-support agent so the
agent can confirm they're speaking with the account holder.

- **`SupportVerificationCodeService`** — issues and verifies a per-actor
  rotating 6-digit TOTP. Secrets are generated lazily on first
  `issueCode`, stored encrypted via `EncryptionProvider`, and rotate every
  30s. `verifyCode` accepts the current period ±1 (drift window) and records
  consumed counters in cache so the same code cannot be replayed within the
  verifier's drift window. Verification is rate-limited via the injected
  `RateLimiterCompatibleAbstract` keyed `support_verification:{actorId}`,
  and issuance/success/failure are emitted via the injected `Logger`. New
  `SupportVerificationSecretRepository` for storage.
- **`SupportVerificationAllowedPolicy`** (`'support.verification.allowed'`) —
  registered in `AuthenticationPolicyMappings`. Default: allow when an
  authenticated actor is present, deny otherwise. Subclass to layer org-wide
  feature flags or tenant-level disablement.

This is **not** an authentication factor: it grants no access on its own
and never appears in `AuthenticationSessionFactor`. It is an out-of-band
identity assertion for the support-call use case.
