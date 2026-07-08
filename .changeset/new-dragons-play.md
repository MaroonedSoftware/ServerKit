---
'@maroonedsoftware/appconfig': minor
---

feat(dotenv): add options to control process.env population and overriding behavior

- Introduced `populateProcessEnv` option to determine if parsed environment variables should be added to `process.env`, defaulting to `true`.
- Added `overrideProcessEnv` option to control whether existing `process.env` variables should be overridden, also defaulting to `true`.
- Updated tests to verify the behavior of these new options, ensuring correct handling of environment variable mutations.
