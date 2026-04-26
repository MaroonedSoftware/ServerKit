---
'@maroonedsoftware/koa': minor
---

feat: enhance error handling in errorMiddleware to support ServerkitError

- Updated errorMiddleware to handle ServerkitError, returning a 500 status with message and details.
- Added unit tests for ServerkitError handling, including cases for bare errors, subclass errors, and preference for HttpError.
- Improved error response structure for better clarity in error handling.
