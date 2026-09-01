---
'@maroonedsoftware/policies': patch
---

`Policy.allow()` now returns a shared frozen constant instead of allocating a fresh `{ allowed: true }` object on every evaluation — an allow result carries no per-decision data, and this method runs on the happy path of every policy-gated request. The result is `Object.freeze`n, so code that mutated a returned allow result (which was never supported, and would previously have silently leaked state between decisions) now throws in strict mode. Denials are unchanged and still build a fresh `PolicyDenialBuilder` per call.
