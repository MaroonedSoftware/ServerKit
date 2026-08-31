---
'@maroonedsoftware/zod': patch
---

Stop `parseAndValidate` and `parseAndValidateArray` leaking field-level validation details in a 5xx response. When `statusCode` is `500` or above the field map now lands on the error's `internalDetails` instead of `details`, so it stays on the log path — `errorMiddleware` copies `details` into the response body for every `HttpError` regardless of status, so a server-side validation failure was previously telling the caller which of the server's own fields failed. Calls that omit `statusCode` or pass a 4xx are unchanged.
