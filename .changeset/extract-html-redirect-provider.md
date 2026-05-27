---
'@maroonedsoftware/authentication': minor
---

Extract `getRedirectHtml` from `EmailFactorService` into a new standalone `HtmlRedirectProvider`. Use it anywhere you want to land the browser somewhere after a non-idempotent side effect without exposing the destination to a crawler — the email magic link flow, an OIDC `completeAuthorization` handler, etc.

**Breaking change.** `EmailFactorService.getRedirectHtml` is removed. Replace `emailFactors.getRedirectHtml(url)` with `htmlRedirect.getRedirectHtml(url)` where `htmlRedirect` is an injected `HtmlRedirectProvider`:

```typescript
import { HtmlRedirectProvider } from '@maroonedsoftware/authentication';
registry.register(HtmlRedirectProvider).useClass(HtmlRedirectProvider).asSingleton();

const { html, nonce } = container.get(HtmlRedirectProvider).getRedirectHtml(new URL('https://app.example.com/welcome'));
```

Behavior, return shape, and error semantics are unchanged.
