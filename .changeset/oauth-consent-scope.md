---
'@maroonedsoftware/authentication': minor
---

A consent can grant a scope of its own.

`AuthorizationConsent` gains an optional `scope`: what the user granted, when a consent page lets them choose rather than simply allowing what the client asked for. RFC 6749 §3.3 lets the authorization server issue a different scope on the resource owner's instructions, so it may name any scope in `scopesSupported`, whatever was requested.

- `approve` issues the code for the request as granted, so the grant, the session's `oauth` claim and the token response's `scope` all carry the user's choice.
- A value outside `scopesSupported` is an HTTP 400, checked before the request is taken, so the request can still be answered with a corrected scope.
- Each value is granted once, in the order given.
- The `oauth.authorization.approved` audit event records the granted `scope`, plus `requestedScope` when the two differ.

Omitting `scope` grants the request as asked, exactly as before.
