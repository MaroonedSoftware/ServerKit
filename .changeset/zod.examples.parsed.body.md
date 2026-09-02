---
'@maroonedsoftware/zod': patch
---

Fix the README and JSDoc examples, which fed `ctx.request.body` to `parseAndValidate` and `parseAndValidateArray`. ServerKit never populates that field, so the examples validated `undefined` and threw a 400 listing every field as missing. They now read `ctx.parsedBody`, and the README explains where it comes from.
