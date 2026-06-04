---
'@maroonedsoftware/policies': minor
---

`PolicyService.assert` (and `BasePolicyService.assert`) now accept an optional `statusCode` (defaulting to `403`), so a denial can be raised as a different HTTP status — e.g. `401` for an unauthenticated request-signature check. The denial's `details`, `internalDetails`, and `headers` are still surfaced on the thrown `HttpError`. Existing two-argument calls are unaffected.
