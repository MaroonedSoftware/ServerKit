---
'@maroonedsoftware/koa': major
---

Take `@maroonedsoftware/authentication` as a required peer dependency rather than bundling it.

`authenticationMiddleware` resolves `AuthenticationSchemeHandler` out of the DI container by class
identity, so the class this package holds has to be the same object the consuming app registered. A
direct dependency could not promise that — `workspace:*` publishes as an exact pin, so an app on any
other version got a second copy installed under this package and every request failed with
`Registration for AuthenticationSchemeHandler not found`, at runtime, on every route, with nothing
wrong at the type level. koa@3.2.4 pinned authentication@4.32.0 and did exactly that to an app on
`^5.0.0`.

The range is `workspace:^`, which publishes as `^<version>` rather than an exact pin, so a patch
release of `authentication` is not a fresh peer conflict.

**Upgrading:** add `@maroonedsoftware/authentication` to your own dependencies if it is not there
already. Apps that already depend on it directly — which is every app that registers an
`AuthenticationSchemeHandler` — need no change beyond reinstalling, and should check that only one
copy resolves afterwards.
