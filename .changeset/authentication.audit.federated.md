---
'@maroonedsoftware/authentication': minor
---

Emit audit events for FIDO2/WebAuthn, OpenID Connect, and OAuth 2.0, completing the audit surface.
Every security-relevant operation in the package now reports itself.

`oidc.linked.auto` and `oauth2.linked.auto` are the ones to watch. The package links a provider
identity to a pre-existing local account on a verified-email match alone, so anyone who can get an
identity provider to assert an address gains that account. Both are recorded with the provider, the
subject, and the email so the join can be reviewed after the fact. The OAuth 2.0 case is weaker
still, since a plain provider's verified claim is whatever its userinfo endpoint says with no
id_token binding it.

Two failures are alarms rather than user errors. `fido.verification.failed` with `missing_counter`
means a stored credential has no replay counter, so the library would accept any value and replay
protection is silently off. `oidc.authorization.failed` with `issuer_mismatch` is RFC 9207 mix-up
detection: an attacker splicing one provider's response onto another provider's flow.

No access token, refresh token, assertion blob, or public key reaches an event.
