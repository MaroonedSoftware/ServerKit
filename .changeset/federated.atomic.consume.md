---
'@maroonedsoftware/authentication': patch
'@maroonedsoftware/saml': patch
---

Consume single-use cache entries atomically in the OIDC and SAML factors. The OIDC state record, the SAML request record, the pending `new-user` authorization (`createFactorFromAuthorization`), and the authenticated exchange (`redeemAuthenticatedExchange`) are now read with `CacheProvider.take` instead of a `get` followed by a `delete`, so two concurrent requests can no longer both redeem the same entry. Requires a `CacheProvider` that implements `take` (Redis 6.2+ for `IoRedisCacheProvider`).
