---
'@maroonedsoftware/servercore': patch
'@maroonedsoftware/koa': patch
'@maroonedsoftware/fastify': patch
---

A chunked request body (sent with `Transfer-Encoding` and no `Content-Length`) now counts as a body. The body gate decided from `Content-Length` alone, so a route that requires a body answered 411 to a valid HTTP/1.1 request, which is what Node's streamed `fetch` and OpenTelemetry's OTLP exporters send, and a route that forbids one let it through. `BodyGateRequest` gains `chunked`, which both adapters fill in from the request's headers.
