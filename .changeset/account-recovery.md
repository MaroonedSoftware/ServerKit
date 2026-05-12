---
'@maroonedsoftware/authentication': minor
---

Adds an account recovery surface as a pure state machine parallel to
`MfaOrchestrator`. Covers the four recovery scenarios — forgot password,
MFA / lost second factor, account unlock, and full account recovery — and
introduces recovery codes as a new factor.

- **`RecoveryCodeFactorService`** — generates a batch of single-use,
  high-entropy backup codes per actor, hashed via the bundled
  `PasswordHashProvider` (Argon2id). Plaintext is returned exactly once at
  generation time; verification is rate-limited (`recovery:{actorId}`) and
  consumes a code single-use. New `RecoveryCodeFactorRepository` for storage.
- **`RecoveryOrchestrator`** — state machine with `initiateRecovery`,
  `issueChannelChallenge`, `verifyChannel`, and `completeRecovery`. Reuses
  existing email/phone factor `issue*Challenge` paths for delivery and
  delegates password reset / unlock to `PasswordFactorService.changePassword`
  and `clearRateLimit`. Unknown identifiers return an empty-channels
  challenge to prevent user enumeration. The orchestrator returns structured
  data and lets consumers shape wire responses and invalidate auth sessions.
- **`RecoverySessionService`** — short-lived, opaque, single-use session
  with **no JWT issuance path** and a distinct cache key prefix
  (`recovery_session_*`). Structurally cannot be resolved via
  `AuthenticationSessionService.getSession`, so a recovery token can never
  authorise application endpoints.
- **`RecoveryAllowedPolicy`** (`'recovery.allowed'`) — registered in
  `AuthenticationPolicyMappings`. Default: allow when at least one eligible
  channel exists for the reason; full recovery requires either a recovery
  code or an admin-approval flag.
- **`RecoveryChannelChallengeRequest`** and friends in `recovery/types.ts`
  for compile-time discriminated-union handling of the email / phone /
  recoveryCode channels.

**Breaking-flavoured rename**: `MfaOrchestrator.startFactorChallenge` is
renamed to `MfaOrchestrator.issueFactorChallenge` to match the per-factor
`issueEmailChallenge` / `issuePhoneChallenge` family it delegates to (and the
new `RecoveryOrchestrator.issueChannelChallenge`). Update call sites.
