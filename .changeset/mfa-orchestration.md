---
'@maroonedsoftware/authentication': minor
---

Add MFA orchestration on top of the per-factor services.

- New: `MfaChallengeService` issues, peeks, and redeems short-lived MFA challenges in cache. Default TTL is 5 minutes; redemption deletes the entry so a challenge id can be used at most once.
- New: `MfaOrchestrator` runs the primary → challenge → secondary handoff. `issueOrChallenge` consults the `'auth.mfa.required'` policy; on allow it mints a session and returns `{ status: 'token' }`, on deny it stashes a challenge and returns `{ status: 'mfa_required' }`. `startFactorChallenge` dispatches to the matching factor service and surfaces the recipient and one-time `code` on its `phone` and `email` responses — the caller is responsible for delivery (SMS provider, transactional email, …), matching the convention used directly by the per-factor services. `completeMfa` peeks the challenge, validates the proof via the matching factor service, redeems the challenge on success, and mints a session that records both factors.
- New: `DefaultMfaRequiredPolicy` (registered under `'auth.mfa.required'` via `AuthenticationPolicyMappings`) — requires MFA when at least one of the actor's `availableFactors` is not a knowledge factor and not `'oidc'` or `'email'`. Subclass to layer org-level overrides or risk scoring.
- New types: `TargetActor<K>`, `MfaEligibleFactor`, `MfaChallengePayload`, `MfaRequiredResponse`, `AuthenticationTokenResponse`, `FactorChallengeStartRequest`/`Response`, `FactorChallengeProof`.
