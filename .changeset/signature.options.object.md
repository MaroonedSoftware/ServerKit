---
'@maroonedsoftware/koa': minor
---

`requireSignature` now takes an optional options object as its second argument instead of a positional policy name: `requireSignature(optionsKey, { policy })`. Adds the `RequireSignatureOptions` type. Update call sites passing a policy name positionally — e.g. `requireSignature('slack', SLACK_SIGNATURE_POLICY)` becomes `requireSignature('slack', { policy: SLACK_SIGNATURE_POLICY })`.
