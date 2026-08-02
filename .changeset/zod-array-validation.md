---
'@maroonedsoftware/zod': minor
---

Add `parseAndValidateArray` for validating every element of an array against a single element schema. Reports violations across all failing elements at once, prefixes detail keys with the element index (`"1.email"`), and rejects a non-array input as a `400` keyed `"_root"` instead of throwing.
