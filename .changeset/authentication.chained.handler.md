---
'@maroonedsoftware/authentication': minor
---

Add `ChainedAuthenticationHandler` and `AuthenticationHandlerChain`, so several handlers can share
one `Authorization` scheme.

`AuthenticationHandlerMap` holds exactly one handler per scheme, but a scheme can carry more than one
kind of credential. `Bearer` is the case that matters: a session JWT for end users alongside a static
token for a machine client such as an MCP server. Until now the two could not coexist, since both
want the `'bearer'` slot.

Register `ChainedAuthenticationHandler` for the scheme and list the real handlers in an
`AuthenticationHandlerChain` (an injectkit array, so members are added by token with
`useArray(…).push(…)` and registration order is try order):

```ts
registry.register(AuthenticationHandlerChain).useArray(AuthenticationHandlerChain).push(McpAuthenticationHandler).push(JwtAuthenticationHandler);
registry.register(ChainedAuthenticationHandler).useClass(ChainedAuthenticationHandler).asSingleton();
registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap).set('bearer', ChainedAuthenticationHandler);
```

Handlers are tried in order and the first session that is not `invalidAuthenticationSession` wins.
This relies on the contract every bundled handler already follows: decline by returning the sentinel,
throw only for misconfiguration. A sentinel moves to the next handler; a throw stops the chain and
propagates, so an operator error is not swallowed by the next handler declining.
