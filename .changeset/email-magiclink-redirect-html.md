---
'@maroonedsoftware/authentication': minor
---

Add `EmailFactorService.getRedirectHtml(redirectUrl)` for the magic link flow. Returns a minimal HTML page that defers navigation to `window.onload` (sidestepping mail-client URL pre-fetchers that would otherwise burn the one-time token) along with a freshly generated CSP nonce to echo in a `script-src 'nonce-…'` header. URLs that aren't `http:` or `https:` are rejected with HTTP 400.
