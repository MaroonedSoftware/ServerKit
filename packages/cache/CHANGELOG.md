# @maroonedsoftware/cache

## 0.1.4

### Patch Changes

- 4814eff: Round TTL seconds to the nearest integer in `IoRedisCacheProvider`. Redis `EX` only accepts integer seconds, so fractional `Duration` values (e.g. `1500ms`) previously caused ioredis to reject the command.

## 0.1.3

### Patch Changes

- 9e2c2de: chore: update package versions for dependencies and devDependencies
  - @maroonedsoftware/errors@1.6.0
  - @maroonedsoftware/logger@1.1.0
  - @maroonedsoftware/utilities@1.7.0

## 0.1.2

### Patch Changes

- Updated dependencies [7624166]
  - @maroonedsoftware/errors@1.6.0

## 0.1.1

### Patch Changes

- Updated dependencies [4e9ccf4]
  - @maroonedsoftware/utilities@1.7.0
  - @maroonedsoftware/errors@1.5.0

## 0.1.0

### Minor Changes

- 687c984: Implement cache provider for authentication services
  - Introduced a new `@maroonedsoftware/cache` package with a `CacheProvider` interface and an `IoRedisCacheProvider` implementation using ioredis.
  - Updated authentication services to utilize the new cache provider, replacing direct cache provider imports with the new package.
  - Removed the old cache provider implementation from the authentication package.
  - Added tests for the new cache provider to ensure functionality and reliability.
  - Updated README and documentation for the cache package to guide usage and implementation.

### Patch Changes

- Updated dependencies [687c984]
  - @maroonedsoftware/utilities@1.6.0
