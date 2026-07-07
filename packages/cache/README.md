# @maroonedsoftware/cache

Cache abstraction for ServerKit. Provides a DI-friendly `CacheProvider` interface, a production-ready ioredis implementation, and an `IdempotencyStore` for de-duplicating at-least-once deliveries.

## Installation

```bash
pnpm add @maroonedsoftware/cache ioredis
```

`ioredis` is an optional peer dependency — install it only if you use the bundled
backend. The `ioredis` backend lives behind a subpath export so importing the core
(`@maroonedsoftware/cache`) never loads it:

| Import | Contents | Pulls in |
|--------|----------|----------|
| `@maroonedsoftware/cache` | `CacheProvider` | nothing extra |
| `@maroonedsoftware/cache/ioredis` | `IoRedisCacheProvider` | `ioredis` |

## Usage

### 1. Bind the provider in your DI container

```typescript
import { Redis } from 'ioredis';
import { CacheProvider } from '@maroonedsoftware/cache';
import { IoRedisCacheProvider } from '@maroonedsoftware/cache/ioredis';

container.bind(Redis).toConstantValue(new Redis(process.env.REDIS_URL));
container.bind(CacheProvider).to(IoRedisCacheProvider);
```

### 2. Inject and use

```typescript
import { Injectable } from 'injectkit';
import { Duration } from 'luxon';
import { CacheProvider } from '@maroonedsoftware/cache';

@Injectable()
class SessionService {
  constructor(private readonly cache: CacheProvider) {}

  async store(sessionId: string, data: string) {
    await this.cache.set(sessionId, data, Duration.fromObject({ hours: 1 }));
  }

  async load(sessionId: string) {
    return await this.cache.get(sessionId);
  }

  async refresh(sessionId: string, data: string) {
    // Overwrites the value but keeps the original TTL
    await this.cache.update(sessionId, data);
  }

  async revoke(sessionId: string) {
    await this.cache.delete(sessionId);
  }
}
```

## API

### `CacheProvider` (abstract)

Base class to extend when implementing a custom cache backend.

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `(key: string) => Promise<string \| null>` | Returns the stored value or `null` if absent/expired. |
| `set` | `(key: string, value: string, ttl: Duration) => Promise<void>` | Stores a value with an explicit TTL. |
| `add` | `(key: string, value: string, options?: { ttl?: Duration }) => Promise<boolean>` | Atomic set-if-absent claim primitive; returns `true` if the key was created, `false` if it already existed. |
| `update` | `(key: string, value: string, ttl?: Duration) => Promise<void>` | Overwrites an existing value; omit `ttl` to preserve the original expiry. Will not resurrect an expired key. |
| `delete` | `(key: string) => Promise<string \| null>` | Removes the entry and returns the key, or `null` if it didn't exist. |

### `IoRedisCacheProvider`

Concrete `CacheProvider` backed by [ioredis](https://github.com/redis/ioredis). Requires an `ioredis` `Redis` instance injected via the DI container.

- Uses Redis `EX` for TTL-bearing writes (TTLs are clamped to a minimum of 1 whole second, since `EX` is integer-only).
- `add` uses `SET … NX` so the claim is atomic across concurrent callers.
- `update` without a new TTL uses `SET … KEEPTTL XX`, so an entry that has since expired is not resurrected without an expiry.

### `IdempotencyStore` (abstract) and `CacheIdempotencyStore`

De-duplicates at-least-once deliveries (webhooks, retried queue messages) keyed by a stable, source-provided id. `CacheIdempotencyStore` is the default implementation, backed by `CacheProvider.add` as its atomic claim primitive.

```typescript
import { CacheProvider, IdempotencyStore, CacheIdempotencyStore } from '@maroonedsoftware/cache';

container.bind(CacheProvider).to(IoRedisCacheProvider);
container.bind(IdempotencyStore).to(CacheIdempotencyStore);

// Run side-effecting work at most once per key, across processes.
const outcome = await store.deduplicate(`slack:event:${eventId}`, async () => {
  await processEvent();
});

switch (outcome.status) {
  case 'processed': /* ran; outcome.result holds the return value */ break;
  case 'duplicate': /* already claimed elsewhere — skip, still ack the source */ break;
  case 'dropped':   /* dead-lettered after repeated failures — ack + alert */ break;
}
```

`deduplicate(key, work, options?)` claims the key (short-lived in-flight marker via `add`), runs `work`, then records a completed marker retained for `retentionTtl`. If `work` throws, the claim is released so the source's next redelivery can retry — until the failure count reaches `maxAttempts`, at which point the key is dead-lettered (`dropped`) rather than reprocessed forever.

| Option | Default | Purpose |
|--------|---------|---------|
| `inFlightTtl` | 5 minutes | Lifetime of the in-flight claim; must exceed the slowest `work`. |
| `retentionTtl` | 24 hours | How long the completed/dead marker is kept; size to the source's redelivery window. |
| `maxAttempts` | 5 | Failures before an event is dead-lettered. |

## Custom implementations

Extend `CacheProvider` to add your own backend (in-memory, Memcached, etc.):

```typescript
import { Injectable } from 'injectkit';
import { Duration } from 'luxon';
import { CacheProvider } from '@maroonedsoftware/cache';

@Injectable()
export class InMemoryCacheProvider extends CacheProvider {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.value;
  }

  async set(key: string, value: string, ttl: Duration) {
    this.store.set(key, { value, expiresAt: Date.now() + ttl.as('milliseconds') });
  }

  async update(key: string, value: string, ttl?: Duration) {
    const existing = this.store.get(key);
    const expiresAt = ttl
      ? Date.now() + ttl.as('milliseconds')
      : (existing?.expiresAt ?? Date.now());
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string) {
    return this.store.delete(key) ? key : null;
  }
}
```
