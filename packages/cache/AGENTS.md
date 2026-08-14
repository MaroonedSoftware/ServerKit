# AGENTS.md — @maroonedsoftware/cache

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

A minimal string-keyed cache interface (`CacheProvider`) with an atomic set-if-absent primitive,
plus `IdempotencyStore` — an at-most-once wrapper built on that primitive for de-duplicating
at-least-once deliveries (webhooks, queue messages, retried commands), including a poison-event
dead-letter cap.

Reach for `CacheProvider` when you need a TTL'd key-value store, and for `IdempotencyStore` at
every webhook or queue-consumer entry point. Do **not** expect a general cache library: values are
`string` only, there is no serialisation, no namespacing, no `mget`, no tags, and no invalidation
beyond `delete`.

## Install

```bash
pnpm add @maroonedsoftware/cache
pnpm add ioredis   # only if you use the ./ioredis backend
```

Runtime dependencies: `injectkit`, `luxon`. Optional peer: `ioredis`.

## Position in the graph

- **Depends on:** nothing internal. This is an L1 package with no ServerKit dependencies at all —
  keep it that way (see Gotchas).
- **Depended on by:** `authentication`, `discord`, `mcp`, `slack`, `telegram`, `whatsapp`.
- **Subpath exports:**
  - `.` — `CacheProvider`, `IdempotencyStore`, `CacheIdempotencyStore`. Backend-agnostic; loads no
    Redis client.
  - `./ioredis` — `IoRedisCacheProvider`. Importing it pulls in the optional `ioredis` peer. It is
    a subpath precisely so that a consumer using a different backend never loads `ioredis`.

## API surface

### `.` — core

| Export                  | Kind           | Shape                                                                                                      | Notes                                                                                                    |
| ----------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `CacheProvider`         | abstract class | `@Injectable()`. `get`, `set`, `add`, `update`, `delete`                                                   | The DI token. Values are `string`.                                                                       |
| `CacheProvider#get`     | method         | `(key: string) => Promise<string \| null>`                                                                 | `null` when missing or expired.                                                                          |
| `CacheProvider#set`     | method         | `(key: string, value: string, ttl: Duration) => Promise<void>`                                             | TTL is **required**. Unconditional write.                                                                |
| `CacheProvider#add`     | method         | `(key: string, value: string, options?: { ttl?: Duration }) => Promise<boolean>`                           | **Atomic set-if-absent.** `true` when created, `false` when the key already existed. The lock primitive. |
| `CacheProvider#update`  | method         | `(key: string, value: string, ttl?: Duration) => Promise<void>`                                            | Overwrites an existing entry. Without `ttl`, preserves the original expiry.                              |
| `CacheProvider#delete`  | method         | `(key: string) => Promise<string \| null>`                                                                 | Returns the key, or `null` if absent.                                                                    |
| `IdempotencyStore`      | abstract class | `@Injectable()`. `deduplicate<T>(key, work, options?) => Promise<IdempotencyOutcome<T>>`                   | The DI token.                                                                                            |
| `CacheIdempotencyStore` | class          | `@Injectable({ deps: [CacheProvider] }) new CacheIdempotencyStore(cache: CacheProvider)`                   | The default implementation. Keys are namespaced `idempotency:`.                                          |
| `IdempotencyOutcome<T>` | type           | `{ status: 'processed'; result: T } \| { status: 'duplicate' } \| { status: 'dropped'; attempts: number }` | —                                                                                                        |
| `IdempotencyOptions`    | interface      | `{ inFlightTtl?: Duration; retentionTtl?: Duration; maxAttempts?: number }`                                | Defaults: 5 minutes, 24 hours, 5.                                                                        |

### `./ioredis`

| Export                 | Kind  | Shape                                                  | Notes                                                                      |
| ---------------------- | ----- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `IoRedisCacheProvider` | class | `@Injectable() new IoRedisCacheProvider(redis: Redis)` | Implements `CacheProvider` over `SET` with `EX` / `NX` / `XX` / `KEEPTTL`. |

TTLs are converted with `Math.max(1, Math.ceil(ttl.as('seconds')))` — rounded up and clamped to at
least 1, because Redis rejects `EX 0`.

### `deduplicate` semantics

| Outcome     | Meaning                                                                                        | What the caller should do                                  |
| ----------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `processed` | This call won the claim and ran `work`. `result` is its return value.                          | Ack success.                                               |
| `duplicate` | The key was already claimed — in-flight, completed, or dead-lettered. `work` did **not** run.  | Ack success, so the source stops redelivering.             |
| `dropped`   | `work` has now failed `maxAttempts` times. The key is dead-lettered and will never be retried. | Ack success (stop the retry storm) and alert on `dropped`. |

On a `work` failure below the attempt cap, the claim is **released** so the source's next
redelivery legitimately reprocesses. The attempt counter lives at a separate `…:attempts` key that
survives claim releases, which is what enforces the cap across redeliveries.

## Canonical usage

```typescript
import { Redis } from 'ioredis';
import { CacheProvider, IdempotencyStore, CacheIdempotencyStore } from '@maroonedsoftware/cache';
import { IoRedisCacheProvider } from '@maroonedsoftware/cache/ioredis';

// Composition root
registry.register(Redis).useValue(new Redis(config.redisUrl));
registry.register(CacheProvider).useClass(IoRedisCacheProvider).asSingleton();
registry.register(IdempotencyStore).useClass(CacheIdempotencyStore).asSingleton();

// Webhook handler
const outcome = await store.deduplicate(`slack:event:${tenantId}:${event.event_id}`, async () => handleSlackEvent(event), {
  retentionTtl: Duration.fromObject({ hours: 2 }),
});

if (outcome.status === 'dropped') logger.error('slack event dead-lettered', { attempts: outcome.attempts });
ctx.status = 200; // ack in every case
```

## Rules for generated code

- Import `IoRedisCacheProvider` from `@maroonedsoftware/cache/ioredis`, never from the root. The
  root barrel does not export it, and the split is what keeps `ioredis` optional.
- Register and inject the abstract `CacheProvider` / `IdempotencyStore`, not the concrete classes.
- Use `add()` for claims and locks. `get()` followed by `set()` is not atomic and two concurrent
  callers will both win.
- Give `set()` a TTL you actually want — it is required, and there is no "no expiry" option through
  this interface.
- Serialise before storing. Values are `string`; `JSON.stringify` on the way in and parse on the
  way out is the caller's job.
- Namespace idempotency keys with a tenant or bot scope. A raw provider event id is rarely globally
  unique across workspaces.
- Ack the source on `duplicate` and `dropped` as well as `processed`. Treating them as failures
  re-triggers redelivery, which is exactly what this store exists to stop.
- Size `retentionTtl` to at least the source platform's redelivery window (Slack ~1 hour;
  WhatsApp and Telegram, hours).
- Size `inFlightTtl` comfortably above the slowest expected `work`. See Gotchas.
- Use Luxon `Duration`, never a number of milliseconds.

## Gotchas

- **`inFlightTtl` shorter than `work` allows double-processing.** If the claim expires while `work`
  is still running, a concurrent redelivery can re-claim the key and run `work` a second time. The
  5-minute default is not a guarantee — size it against your slowest handler.
- **`duplicate` is returned for completed and dead-lettered keys too**, not just in-flight ones.
  The caller cannot distinguish "someone else is doing it right now" from "this was done yesterday"
  from "this was dead-lettered". If you need that, do not use this store.
- **The completed marker is written with `set`, not `update`**, deliberately: it must land even if
  the in-flight claim already expired.
- **`update()` without a `ttl` uses `KEEPTTL` combined with `XX`.** A key that has since expired is
  not resurrected — the write silently does nothing. Do not use `update` to create.
- **Sub-second TTLs round up to 1 second** in the Redis backend. `Duration.fromMillis(50)` is a
  1-second TTL.
- **There is no rate limiting in this package.** Older docs listed it here; it actually lives in
  `@maroonedsoftware/koa` (`rateLimiterMiddleware` and the `RateLimiter` DI token). `cache` used to
  declare `rate-limiter-flexible` as a dependency without importing it, which made the manifest
  read as though it belonged here — that entry has been removed.

## Working inside this package

```
src/
  index.ts                   Root barrel — cache.provider + idempotency.store only
  cache.provider.ts          CacheProvider abstract token
  idempotency.store.ts       IdempotencyOutcome, IdempotencyOptions, IdempotencyStore,
                             CacheIdempotencyStore, and the inflight/completed/dead state machine
  ioredis.ts                 Subpath entry for ./ioredis
  ioredis.cache.provider.ts  IoRedisCacheProvider, toExpirySeconds (module-private)
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **Nothing reachable from `src/index.ts` may import `ioredis`.** That is the whole reason for the
  `./ioredis` entry, and a stray import would make an optional peer mandatory.
- **No internal dependencies.** `injectkit` and `luxon` are the only runtime deps. Six packages
  depend on this one, so anything added here lands in all of their installs — and a dependency on
  `errors` or `utilities` would be a real arrow in the graph, not a formality.
- `add()` must be atomic in every backend. `CacheIdempotencyStore` is built entirely on that
  guarantee; a non-atomic implementation silently breaks de-duplication under concurrency.
- The attempt counter must outlive claim releases, or the poison-event cap stops working across
  redeliveries.
- A new backend goes in its own `src/<backend>.ts` entry with a matching `exports` entry, a tsup
  entry in the `build` script, and an optional peer in `peerDependenciesMeta`.

User-visible changes need a changeset in `.changeset/`.
