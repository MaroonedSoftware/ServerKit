---
'@maroonedsoftware/authentication': minor
---

feat: add getRedirectHtml helper for email magic link flow

- Returns an HTML landing page that defers redirection to window.onload to defeat mail-client URL pre-fetchers, paired with a CSP nonce the caller echoes in a script-src header. Non-http(s) schemes are rejected with 400.
