---
'@maroonedsoftware/appconfig': patch
---

Widen a literal `defaultValue` to its base primitive in `AppConfig.get` for loosely-typed configs.

`get('JWT_PRIVATE_KEY', '')` on a `Record<string, unknown>` config was typed `''` rather than `string`, so any later assignment of a real value failed. The default value's type parameter is constrained by `NonNullable<T[K]>`, which is `{}` for a loose config, and TypeScript preserves literal types when inferring to a parameter whose constraint admits primitives.

Widening applies only to the loosely-typed branch. A typed config still returns its declared value type, so `get('mode', 'a')` on `{ mode: 'a' | 'b' }` remains `'a' | 'b'`. Use `getAs<U>(key)` if you want a literal type back from a loose config.
