---
'@maroonedsoftware/permissions': minor
---

`check`, `checkDetailed`, `explain`, and `lookupObjects` take an optional `CheckOptions` bag as their last argument: `{ sink?, maxDepth? }`. `maxDepth` replaces the fixed recursion cap of 32 (still the default), so a model with long chains such as a reporting line can raise it; a value that is not a positive integer throws `RangeError`. `sink` moves the metrics sink into the bag. Passing a bare `CheckMetricsSink` as the 6th argument of `check` or `checkDetailed`, the 0.3.0 form, still works but is deprecated.
