---
'@maroonedsoftware/authentication': minor
---

Add `OidcFactorService.stashAuthenticatedExchange` / `redeemAuthenticatedExchange` for post-completion handoffs (e.g. OIDC + MFA gates), so consumers don't need to invent their own cache key and serialization. The stash carries `{ actorId, factorId, isNewUser? }` under a one-time `exchangeId` with a 2-minute TTL by default (configurable via the new `authenticatedExchangeExpiration` option). Mirrors the single-use redeem semantics of `MfaChallengeService.redeem`.

Add `kind: AuthenticationFactorKind` to `MfaEligibleFactor` and thread it through `MfaChallengeService.serialize/deserialize`. SPAs can now filter against step-up `acceptableKinds` / `excludeKinds` hints without re-joining against enrolled factors, and `DefaultMfaRequiredPolicy` preserves `kind` on the eligible list rather than stripping it. `AuthMfaRequiredPolicyFactor` is now a structural alias for `MfaEligibleFactor`. The wire format keeps `kind` optional on read and defaults missing values to `'possession'` so in-flight challenges from the prior version still deserialize across the upgrade.
