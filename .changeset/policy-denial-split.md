---
'@maroonedsoftware/policies': minor
---

Split policy denial results into client-facing vs operator-only payloads so
hint data reaches the wire.

- `PolicyResultDenied` gains an optional `internalDetails` field alongside
  `details`. `details` is now explicitly the client-facing payload; rendered
  to the HTTP response body by `BasePolicyService.assert`. `internalDetails`
  carries operator/log-only context and is attached to the thrown error's
  `internalDetails`, never on the wire.
- `Policy.deny(reason, details?, internalDetails?)` gains the third positional
  parameter so policy authors can choose per-call which bucket each piece of
  data lives in.
- `BasePolicyService.assert` now maps `result.details` → `HttpError.details`
  (so the koa error middleware renders it) and merges `result.internalDetails`
  with the framework's `{ policyName, reason, kind: 'policy_violation' }` under
  `HttpError.internalDetails`. Previously every denial — including step-up,
  MFA-required, and password-strength hints — was buried under
  `internalDetails` and never reached the client.

Behavior change for downstream policies: any policy that already calls
`denyStepUp(...)` or `deny(reason, payload)` will start surfacing `payload`
to clients on 403 responses. This matches the documented contract for
`PolicyResultDenied.details` and unblocks clients that need to drive
re-auth modals, MFA factor pickers, or password-strength UI from the 403
response.
