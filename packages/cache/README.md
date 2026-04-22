# @maroonedsoftware/cache

Cache abstraction for ServerKit. Provides a DI-friendly `CacheProvider` interface and a production-ready ioredis implementation.

## Installation

```bash
pnpm add @maroonedsoftware/cache ioredis
```

## Usage

### 1. Bind the provider in your DI container

```typescript
import { Redis } from 'ioredis';
import { CacheProvider, IoRedisCacheProvider } from '@maroonedsoftware/cache';

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
| `update` | `(key: string, value: string, ttl?: Duration) => Promise<void>` | Overwrites a value; omit `ttl` to preserve the original expiry. |
| `delete` | `(key: string) => Promise<string \| null>` | Removes the entry and returns the key, or `null` if it didn't exist. |

### `IoRedisCacheProvider`

Concrete `CacheProvider` backed by [ioredis](https://github.com/redis/ioredis). Requires an `ioredis` `Redis` instance injected via the DI container.

- Uses Redis `EX` for TTL-bearing writes.
- Uses Redis `KEEPTTL` when updating without a new TTL.

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
