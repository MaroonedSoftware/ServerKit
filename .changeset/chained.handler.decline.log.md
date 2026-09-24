---
'@maroonedsoftware/authentication': minor
---

`ChainedAuthenticationHandler` now injects a `Logger` and logs once, at `debug`, when no handler in the chain accepts the credential. Chain members no longer need to log their own declines, which fire on every request that another member accepts. DI resolution is unchanged if `Logger` is registered; code that constructs the handler by hand must pass a logger as the second argument.
