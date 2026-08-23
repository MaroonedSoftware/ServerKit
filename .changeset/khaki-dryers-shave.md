---
'@maroonedsoftware/appconfig': minor
---

Add `AppConfigSourceEnv`, which reads the process environment as a configuration layer.

`AppConfigSourceDotenv` reads a `.env` FILE and `AppConfigResolverEnv` only rewrites `${env:…}` tokens inside values somebody already wrote, so an application configured the way a container configures one — variables on the process — had no layer that read them. It fell through to its defaults in code, silently, and only in the deployment where nobody had written a `.env`.

The environment is captured when the source is constructed, so an application that scrubs its secrets out of `process.env` after boot does not lose them at the next reload. Pass `snapshot: false` for the older behaviour of reading it every time. `groupSeparator` matches the dotenv source's, so `A__B` nests the same way whichever layer it arrives through.
