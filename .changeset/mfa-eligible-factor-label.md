---
'@maroonedsoftware/authentication': minor
---

Add optional `label` to `MfaEligibleFactor`

`MfaEligibleFactor` now carries an optional `label?: string | null` field, surfaced through `DefaultMfaRequiredPolicy`, `MfaChallengePayload`, and `MfaRequiredResponse`. This lets factor-picker UIs (web, native) receive a human-readable name per eligible factor — e.g. "iPhone 15 Pro", "+1·····1234" — without having to re-join the eligible list to the actor's enrolled factors.

Non-breaking and additive. Consumers that don't supply `label` on `AuthMfaRequiredPolicyFactor` get the existing behaviour (no `label` key on the output). Consumers that don't read `label` from the response are unaffected.

To take advantage, populate `label` on the `availableFactors` you hand to `MfaOrchestrator.issueOrChallenge`; the policy preserves it and the orchestrator surfaces it on `MfaRequiredResponse.eligibleFactors`.
