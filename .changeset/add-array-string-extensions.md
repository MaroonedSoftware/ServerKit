---
'@maroonedsoftware/utilities': minor
---

Add `Array` and `String` prototype extensions (`uniqueBy`, `cast`, `deleteProperties`, `intersect`, `arrayEquals`, `binarySearch`, `takeWhile`, `takeWhileAggregate`, `isNullOrUndefinedOrWhitespace`, `hasValue`, `mask`, `maskExceptLastFour`, `maskEmail`), the `joinNonEmpty` helper, and nullable-safe free functions `hasValue` / `isNullOrUndefinedOrWhitespace`.

The extensions ship as an opt-in side-effect import — `import '@maroonedsoftware/utilities/extensions'` — so importing the main entry no longer touches global prototypes. Installed methods are defined non-enumerable so they do not leak into `for…in` loops or `Object.keys`. When a name is already present on the target prototype (e.g. a future Node release or another library installed it), the install is skipped and a single `console.warn` is emitted per colliding name.

The two most generically-named methods are deliberately namespaced — `arrayEquals` (rather than `equals`/`compare`) and `uniqueBy` (rather than `unique`) — to leave room for TC39 additions. `uniqueBy` accepts any `(t: T) => unknown` selector so callers can dedup by computed or composed keys, not just by a property of `T`.

`Array.prototype.intersect` preserves duplicates from the receiver when called without a comparer and correctly keeps falsy matches (`0`, `''`, `false`, `null`) when called with one. `Array.prototype.deleteProperties` returns a new array of shallow copies instead of mutating its receiver.
