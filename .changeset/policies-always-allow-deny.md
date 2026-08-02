---
'@maroonedsoftware/policies': minor
---

Add `AlwaysAllowPolicy` and `AlwaysDenyPolicy` test doubles. Bind either under an existing policy name in the `PolicyRegistryMap` to bypass or force that rule for every call site that resolves it through `PolicyService`, without adding seams to the code under test. `AlwaysDenyPolicy` denies with `reason: 'always_deny'` and no `details`, `internalDetails`, or `headers`.
