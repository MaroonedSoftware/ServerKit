---
'@maroonedsoftware/authentication': patch
'@maroonedsoftware/discord': patch
'@maroonedsoftware/koa': patch
'@maroonedsoftware/mcp': patch
'@maroonedsoftware/slack': patch
'@maroonedsoftware/telegram': patch
'@maroonedsoftware/whatsapp': patch
---

Fix handler-map wiring examples to use `useMap` instead of resolving handlers from a container that
does not exist yet.

The examples built each map eagerly — `map.set('key', container.get(Handler))` followed by
`registry.register(Map).useValue(map)` — which reads as if a built container were available inside
the composition root, before `build()` has been called. They now use injectkit's `useMap`, which
takes handler _tokens_ and resolves them when the container is built:

```ts
registry.register(SearchDocsTool).useClass(SearchDocsTool).asSingleton();
registry.register(McpToolHandlerMap).useMap(McpToolHandlerMap).set('search_docs', SearchDocsTool);
```

The examples now also register each handler class explicitly. Auto-registration of `@Injectable()`
classes is off by default, so omitting that step fails the build with
`Missing dependencies for <Map>: <Handler>` — a step the old `container.get` form hid.

Also corrects `.useMap()` to `.useMap(MapClass)` and `.add(key, token)` to `.set(key, token)` in the
`koa` and `authentication` examples, switches the `PolicyRegistryMap` example to `useFactory` (it
maps to policy _tokens_, so `useMap` does not apply), and lowercases the `AuthenticationHandlerMap`
key in koa's example, since the scheme handler lowercases before lookup and `'Bearer'` never matched.

Docs only, no runtime change.
