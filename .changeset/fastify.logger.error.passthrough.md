---
'@maroonedsoftware/fastify': patch
---

`createFastifyLogger` now keeps an `Error` passed as the first argument (`request.log.error(err)`, `log.error(err, 'message')`). It used to spread the error into a plain object, which dropped its non-enumerable `message` and `stack`, so the logged record lost the error. The error now reaches the `Logger` intact, with any child bindings (such as `reqId`) following it as a separate parameter.
