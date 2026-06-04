---
'@maroonedsoftware/koa': minor
---

`requireSignature` now verifies the request HMAC through the new `request.signature.valid` policy (`DefaultSignaturePolicy`) resolved via `PolicyService`, instead of computing the comparison inline — mirroring how `requirePolicy` is backed by `DefaultMfaSatisfiedPolicy`. The middleware, its `requireSignature(optionsKey)` signature, `SignatureOptions`, and the 401-on-mismatch behaviour are unchanged.

The verification rule is now swappable: subclass `DefaultSignaturePolicy` and re-register it under `REQUIRE_SIGNATURE_POLICY` to change the behaviour (e.g. accept a rotated secret during a key rollover) without touching the middleware. The policy receives `SignaturePolicyContext<TOptions>` — the raw body, a case-insensitive `getHeader` accessor, and the resolved options — so a custom rule can read whichever header(s) its scheme needs rather than a single pre-extracted signature. The context (and `requireSignature<TOptions>(optionsKey)`) are generic over the options shape, defaulting to `SignatureOptions`; a custom policy can declare a richer config (e.g. a Slack signing secret plus a replay window) and be driven through the same middleware.

`requireSignature(optionsKey, policy?)` now takes an optional policy name (defaulting to `REQUIRE_SIGNATURE_POLICY`), so a different registered policy can verify a different scheme through the same middleware — e.g. `SLACK_SIGNATURE_POLICY` from `@maroonedsoftware/slack`.

**Action required:** register the policy in your `PolicyRegistryMap` (`registry.set(REQUIRE_SIGNATURE_POLICY, DefaultSignaturePolicy)`). Routes using `requireSignature` will otherwise fail to resolve the policy at request time.
