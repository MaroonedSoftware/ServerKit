---
'@maroonedsoftware/koa': minor
'@maroonedsoftware/fastify': minor
---

Log HTTP errors with the request they came from. The builder's `error`/`warn` listeners now forward the Koa `ctx` that `errorMiddleware` emits, and log `method`, `path`, `status`, `requestId`, and `correlationId` alongside the error. The path never includes the query string, which can carry credentials; for the same reason the synthesised 404 body emitted for logging drops the query string (the response body still echoes the full URL). A 4xx `HttpError` (401, 404, 409, 429, …) is now logged at `warn` instead of `error`, since it is the caller's fault rather than the server's; 5xx and non-HTTP errors stay at `error`.

`@maroonedsoftware/fastify` had the same gap and gets the same fix: `errorPlugin` logs thrown errors and synthesised 404s with the request fields, logs anything that renders as a 4xx (including Fastify's own validation and parse errors) at `warn`, and keeps the query string out of the logged 404 body.
