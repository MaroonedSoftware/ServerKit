---
'@maroonedsoftware/authentication': minor
---

Refactor `MfaOrchestrator` to a pure state machine. `issueOrChallenge` and
`completeMfa` now return data (`IssueOrChallengeResult`, `CompleteMfaResult`)
instead of a wire-shaped `AuthenticationTokenResponse`; session minting and
response shaping move to the consumer. Removes the
`AuthenticationSessionService` dependency from the orchestrator and drops the
`claims` / `sessionExpiration` parameters. The removed types
`MfaRequiredResponse` and `AuthenticationTokenResponse` are no longer exported.

This is an API change to `MfaOrchestrator`'s public surface, shipped as a
minor bump because no published consumer has adopted the orchestrator yet.
`MfaChallengeService`, `DefaultMfaRequiredPolicy`, and the per-factor services
are unaffected — only direct callers of `MfaOrchestrator` need to migrate.

Migration: replace `result.result === 'token'` with `result.kind === 'allow'`
and mint the session yourself; replace `result.result === 'mfa_required'`
with `result.kind === 'challenge'` and shape your own response from
`result.challenge`.
