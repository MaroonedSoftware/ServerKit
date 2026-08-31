---
'@maroonedsoftware/zod': minor
---

Add an optional `statusCode` argument to `parseAndValidate` and `parseAndValidateArray`, so a validation failure can be rendered as something other than `400` (e.g. `422` for a well-formed but semantically rejected payload). Existing two-argument calls are unaffected and still throw `400`.
