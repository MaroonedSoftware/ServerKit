---
'@maroonedsoftware/servercore': minor
'@maroonedsoftware/fastify': patch
'@maroonedsoftware/koa': patch
---

Scrub the `Authorization` credential from `rawHeaders` too, closing a leak in both adapters'
authentication step.

`authenticationPlugin` (fastify) and `authenticationMiddleware` (koa) delete the header after handing
it to `AuthenticationSchemeHandler`, so it cannot be captured by downstream logging. But
`IncomingMessage.rawHeaders` is a separate array Node fills at parse time and never keeps in sync
with `headers`, so `delete req.headers.authorization` left the token sitting in `req.rawHeaders`.
Anything serializing that array — a request logger, an error reporter, a proxy replaying headers —
still captured it, which is precisely what the delete was there to prevent.

Both adapters now also call the new `stripRawAuthorizationHeader` from `@maroonedsoftware/servercore`,
which removes every `Authorization` pair from the array in place. It matches the name
case-insensitively, only ever at an even index (so a header whose *value* reads `"authorization"`
survives), and handles duplicates, including adjacent ones.

No API change for consumers. Code that was reaching into `rawHeaders` to recover the credential after
the authentication step will now find nothing there — that was never a supported way to read it, and
the supported one is an `AuthenticationHandler` registered for the scheme.
