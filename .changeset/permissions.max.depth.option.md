---
'@maroonedsoftware/permissions': minor
---

`check`, `checkDetailed`, and `explain` take an optional `CheckOptions` argument. `maxDepth` replaces the fixed recursion cap of 32 (still the default), so a model with long chains such as a reporting line can raise it. A value that is not a positive integer throws `RangeError`.
