---
'@maroonedsoftware/saml': patch
'@maroonedsoftware/authentication': patch
---

Document what apps must enforce around `SamlFactorService` and `OidcFactorService`.

- New "Caller responsibilities" sections: bind the `requestId` (SAML) or `state` (OIDC) returned by `beginAuthorization` to the browser that started the flow and refuse a callback it did not start, check `result.actorId` against the current session on `linked` and `stepped-up` results, and allow-list `redirectAfter`, which is returned unvalidated.
- `SamlProfile.subject` no longer claims to be stable per end-user: under the default `emailAddress` NameID format a reassigned mailbox inherits the old factor. The README recommends the `persistent` format.
