---
'@maroonedsoftware/slack': minor
---

Add `SlackSignaturePolicy` — a `@maroonedsoftware/policies` form of `verifySlackSignature`, registered under `SLACK_SIGNATURE_POLICY` (`'slack.signature.valid'`). It delegates to the existing helper so the v0 HMAC + replay-window logic stays a single source of truth, but answers as a `PolicyResult` (denying with the helper's `SlackSignatureFailureReason` as the denial reason) and anchors the replay window to the evaluation's `envelope.now`.

The policy context (`rawBody` + a case-insensitive `getHeader` + `SlackSignatureOptions`) is structurally compatible with `@maroonedsoftware/koa`'s generic `SignaturePolicyContext<SlackSignatureOptions>`, so the koa `requireSignature` middleware can drive it once registered — without this package depending on koa. Adds a runtime dependency on `@maroonedsoftware/policies`.
