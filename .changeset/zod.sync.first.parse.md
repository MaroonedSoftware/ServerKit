---
'@maroonedsoftware/zod': patch
---

`parseAndValidate` and `parseAndValidateArray` now complete fully synchronous schemas without a promise round-trip per parse. Previously every call went through `safeParseAsync`, which unconditionally awaits even when the schema contains nothing asynchronous — a microtask-queue tick per validation, and a generated route handler validates params, query, headers, and body separately. The functions now run zod's internal parse directly in async mode, which returns synchronously for sync schemas and a Promise only when the schema actually contains async refinements or transforms; issues are finalized through the same path `safeParseAsync` uses, so error shapes, detail keys, custom error maps, and the 4xx/5xx `details`/`internalDetails` split are all unchanged, as are both function signatures. Async refinements and transforms behave exactly as before, including a rejecting refinement surfacing as the call's own rejection.
