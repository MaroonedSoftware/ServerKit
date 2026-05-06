# @maroonedsoftware/koa

## 1.17.10

### Patch Changes

- Updated dependencies [2620573]
  - @maroonedsoftware/authentication@3.0.0

## 1.17.9

### Patch Changes

- Updated dependencies [5bb6817]
  - @maroonedsoftware/authentication@2.3.0

## 1.17.8

### Patch Changes

- 9e2c2de: chore: update package versions for dependencies and devDependencies
- Updated dependencies [9e2c2de]
  - @maroonedsoftware/authentication@2.2.1
  - @maroonedsoftware/appconfig@1.4.1
  - @maroonedsoftware/errors@1.6.0
  - @maroonedsoftware/logger@1.1.0
  - @maroonedsoftware/multipart@1.1.2
  - @maroonedsoftware/utilities@1.7.0

## 1.17.7

### Patch Changes

- Updated dependencies [e57e48a]
  - @maroonedsoftware/authentication@2.2.0

## 1.17.6

### Patch Changes

- Updated dependencies [ea5521d]
  - @maroonedsoftware/authentication@2.1.0

## 1.17.5

### Patch Changes

- Updated dependencies [0ca3ef5]
  - @maroonedsoftware/authentication@2.0.0

## 1.17.4

### Patch Changes

- Updated dependencies [8802197]
  - @maroonedsoftware/authentication@1.1.0

## 1.17.3

### Patch Changes

- Updated dependencies [0a3a7d5]
- Updated dependencies [bf8f78e]
  - @maroonedsoftware/authentication@1.0.0

## 1.17.2

### Patch Changes

- Updated dependencies [afaa0af]
  - @maroonedsoftware/authentication@0.23.0

## 1.17.1

### Patch Changes

- Updated dependencies [f7eaa33]
- Updated dependencies [f7eaa33]
  - @maroonedsoftware/authentication@0.22.0

## 1.17.0

### Minor Changes

- 65e60f5: Expose `ServerKitContext` as an injectkit token. `serverKitContextMiddleware` now registers the live Koa context against it in the request-scoped container, so request-scoped services can declare `ServerKitContext` as a constructor dependency.

## 1.16.6

### Patch Changes

- Updated dependencies [28b3a92]
  - @maroonedsoftware/authentication@0.21.0

## 1.16.5

### Patch Changes

- Updated dependencies [951a245]
  - @maroonedsoftware/authentication@0.20.0

## 1.16.4

### Patch Changes

- Updated dependencies [fab17af]
  - @maroonedsoftware/authentication@0.19.0

## 1.16.3

### Patch Changes

- Updated dependencies [c81ebcb]
  - @maroonedsoftware/authentication@0.18.0

## 1.16.2

### Patch Changes

- Updated dependencies [82ce3aa]
  - @maroonedsoftware/authentication@0.17.0

## 1.16.1

### Patch Changes

- Updated dependencies [e111278]
  - @maroonedsoftware/authentication@0.16.0

## 1.16.0

### Minor Changes

- 69ef4b3: feat: enhance error handling in errorMiddleware to support ServerkitError
  - Updated errorMiddleware to handle ServerkitError, returning a 500 status with message and details.
  - Added unit tests for ServerkitError handling, including cases for bare errors, subclass errors, and preference for HttpError.
  - Improved error response structure for better clarity in error handling.

### Patch Changes

- Updated dependencies [7624166]
- Updated dependencies [1d79133]
  - @maroonedsoftware/errors@1.6.0
  - @maroonedsoftware/authentication@0.15.0
  - @maroonedsoftware/multipart@1.1.2

## 1.15.6

### Patch Changes

- @maroonedsoftware/authentication@0.14.1

## 1.15.5

### Patch Changes

- Updated dependencies [5151eac]
  - @maroonedsoftware/authentication@0.14.0

## 1.15.4

### Patch Changes

- Updated dependencies [b07bec3]
  - @maroonedsoftware/authentication@0.13.0

## 1.15.3

### Patch Changes

- Updated dependencies [f988d31]
  - @maroonedsoftware/authentication@0.12.0

## 1.15.2

### Patch Changes

- Updated dependencies [bc92b8e]
- Updated dependencies [ef3b5b1]
  - @maroonedsoftware/authentication@0.11.0

## 1.15.1

### Patch Changes

- Updated dependencies [d1270bb]
  - @maroonedsoftware/authentication@0.10.0

## 1.15.0

### Minor Changes

- 4e9ccf4: Update error handling and type overrides
  - Updated Kysely type overrides to include custom parsers for `INTERVAL` and `TINTERVAL`, improving PostgreSQL type handling.
  - Renamed `withErrors(errors)` to `withDetails(details)` in the errors package documentation for clarity.
  - Added a class decorator `OnPostgresError` to automatically map PostgreSQL errors to HTTP errors, enhancing error handling in services.
  - Enhanced tests for Kysely type overrides to cover new interval parsing functionality.
  - Added documentation for E.164 international phone number format in the utilities package.

### Patch Changes

- Updated dependencies [4e9ccf4]
  - @maroonedsoftware/utilities@1.7.0
  - @maroonedsoftware/errors@1.5.0
  - @maroonedsoftware/authentication@0.9.1
  - @maroonedsoftware/multipart@1.1.1

## 1.14.1

### Patch Changes

- Updated dependencies [60870fc]
  - @maroonedsoftware/authentication@0.9.0

## 1.14.0

### Minor Changes

- 687c984: Implement cache provider for authentication services
  - Introduced a new `@maroonedsoftware/cache` package with a `CacheProvider` interface and an `IoRedisCacheProvider` implementation using ioredis.
  - Updated authentication services to utilize the new cache provider, replacing direct cache provider imports with the new package.
  - Removed the old cache provider implementation from the authentication package.
  - Added tests for the new cache provider to ensure functionality and reliability.
  - Updated README and documentation for the cache package to guide usage and implementation.

### Patch Changes

- Updated dependencies [687c984]
  - @maroonedsoftware/authentication@0.8.0
  - @maroonedsoftware/utilities@1.6.0

## 1.13.5

### Patch Changes

- Updated dependencies [f9aa6d6]
  - @maroonedsoftware/authentication@0.7.0

## 1.13.4

### Patch Changes

- Updated dependencies [7b70566]
  - @maroonedsoftware/authentication@0.6.0

## 1.13.3

### Patch Changes

- Updated dependencies [5c4756a]
- Updated dependencies [79fde38]
  - @maroonedsoftware/utilities@1.5.0
  - @maroonedsoftware/authentication@0.5.0

## 1.13.2

### Patch Changes

- Updated dependencies [66949c3]
  - @maroonedsoftware/authentication@0.4.0

## 1.13.1

### Patch Changes

- Updated dependencies [6fe8bc4]
  - @maroonedsoftware/authentication@0.3.0

## 1.13.0

### Minor Changes

- beef958: Expose client ipAddress on ServerKitContext and adjust middleware to: read user-agent via ctx.get (no default), set ipAddress from ctx.ip, read X-Correlation-Id from ctx.headers (handling array values) and always generate a new requestId (instead of honoring an incoming header). Update response headers accordingly.

## 1.12.0

### Minor Changes

- 320673a: Normalize response header names to lowercase in the rate limiter middleware. The middleware now emits 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', and 'x-ratelimit-reset' instead of their PascalCase equivalents; no functional behavior changes to rate limiting logic.

## 1.11.0

### Minor Changes

- 5004488: adding optional name to serverkit module

## 1.10.2

### Patch Changes

- Updated dependencies [b1005f4]
  - @maroonedsoftware/utilities@1.4.0

## 1.10.1

### Patch Changes

- Updated dependencies [b9940cc]
  - @maroonedsoftware/utilities@1.3.0

## 1.10.0

### Minor Changes

- fff5f18: added rate limit headers

## 1.9.0

### Minor Changes

- 922f585: upgrading to typescript 6

### Patch Changes

- Updated dependencies [922f585]
  - @maroonedsoftware/authentication@0.2.0
  - @maroonedsoftware/appconfig@1.4.0
  - @maroonedsoftware/multipart@1.1.0
  - @maroonedsoftware/utilities@1.2.0
  - @maroonedsoftware/errors@1.4.0
  - @maroonedsoftware/logger@1.1.0

## 1.8.0

### Minor Changes

- 97d5ffc: adding serverkit module

## 1.7.0

### Minor Changes

- 42973b6: update requireSecurity options role to be string array

## 1.6.2

### Patch Changes

- Updated dependencies [64fdc6c]
  - @maroonedsoftware/appconfig@1.3.0

## 1.6.0

### Minor Changes

- 5ded700: adding require signature middleware

### Patch Changes

- Updated dependencies [5ded700]
- Updated dependencies [5ded700]
  - @maroonedsoftware/errors@1.3.0
  - @maroonedsoftware/appconfig@1.2.0
  - @maroonedsoftware/multipart@1.0.3

## 1.5.0

### Minor Changes

- e5dc109: adding router security middleware

### Patch Changes

- Updated dependencies [e5dc109]
  - @maroonedsoftware/authentication@0.1.0

## 1.4.0

### Minor Changes

- 75d121c: fix auth middleware bug

## 1.3.0

### Minor Changes

- fe1ea8f: updating how body parsers work

## 1.2.0

### Minor Changes

- dc9e6d1: update packages
- 337289b: adding authentication package and middleware, this is mostly stubs to prep for future work

### Patch Changes

- Updated dependencies [0eea499]
  - @maroonedsoftware/utilities@1.1.0
  - @maroonedsoftware/authentication@0.0.0
  - @maroonedsoftware/errors@1.2.0
  - @maroonedsoftware/logger@1.0.0
  - @maroonedsoftware/multipart@1.0.2

## 1.1.1

### Patch Changes

- Updated dependencies [3f636dd]
  - @maroonedsoftware/errors@1.2.0
  - @maroonedsoftware/multipart@1.0.2

## 1.1.0

### Minor Changes

- 8fe2ab5: added cors, rate limit, and context middleware
  removed injectkit middleware as it's superseded by context

### Patch Changes

- Updated dependencies [8ab564a]
  - @maroonedsoftware/errors@1.1.0
  - @maroonedsoftware/multipart@1.0.1

## 1.0.0

### Major Changes

- fd930ff: adding koa package with types and middleware
