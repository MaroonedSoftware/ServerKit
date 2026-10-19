---
'@maroonedsoftware/authentication': minor
---

OIDC providers can vouch for their users' email addresses.

- New `OidcProviderConfig.trustEmail?: (profile: OidcProfile) => boolean | Promise<boolean>`. When a provider sets it, `OidcFactorService.completeAuthorization` asks it, in place of `email_verified === true`, whether a new identity's address may auto-link to the account holding that email, and whether a matching account counts as an `emailConflict`. Useful for IdPs such as Entra ID that omit `email_verified`. A hook that throws fails the authorization.
- `oidc.linked.auto` and `oidc.link.rejected` (`unverified_email`) audit records gain `emailTrust: 'provider' | 'email_verified'` (type `FederatedEmailTrust`), saying which rule decided.

Providers without the hook behave exactly as before.
