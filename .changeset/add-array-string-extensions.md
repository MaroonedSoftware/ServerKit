---
'@maroonedsoftware/utilities': minor
---

Add `Array` and `String` prototype extensions (`unique`, `cast`, `deleteProperties`, `intersect`, `compare`, `binarySearch`, `takeWhile`, `takeWhileAggregate`, `isNullOrUndefinedOrWhitespace`, `hasValue`, `mask`, `maskExceptLastFour`, `maskEmail`), the `joinNonEmpty` helper, and nullable-safe free functions `hasValue` / `isNullOrUndefinedOrWhitespace`.

The extensions ship as an opt-in side-effect import — `import '@maroonedsoftware/utilities/extensions'` — so importing the main entry no longer touches global prototypes. Installed methods are defined non-enumerable so they do not leak into `for…in` loops or `Object.keys`.

`Array.prototype.intersect` preserves duplicates from the receiver when called without a comparer and now correctly keeps falsy matches (`0`, `''`, `false`, `null`) when called with one. `Array.prototype.deleteProperties` returns a new array of shallow copies instead of mutating its receiver.
