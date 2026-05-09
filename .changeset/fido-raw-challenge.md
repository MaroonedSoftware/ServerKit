---
'@maroonedsoftware/authentication': minor
---

`createFidoAuthorizationChallenge` now also returns `assertion.rawChallenge` — the same value as `assertion.challenge` but as a raw `Buffer` instead of a base64 string — for callers that want to forward the bytes to the WebAuthn client without decoding.
