---
'@maroonedsoftware/appconfig': minor
---

Move the Postgres, YAML, and AWS/GCP secret-manager backends behind subpath exports so importing the core no longer statically loads `pg`, `yaml`, or the cloud SDKs. Previously importing anything from `@maroonedsoftware/appconfig` eagerly required all four, forcing every consumer to install them even to read a JSON or dotenv file; they are now optional peer dependencies.

Breaking: import these from their subpaths instead of the package root —

- `@maroonedsoftware/appconfig/postgres` — `AppConfigSourcePostgres`, `AppConfigResolverPostgres`
- `@maroonedsoftware/appconfig/yaml` — `AppConfigSourceYaml`
- `@maroonedsoftware/appconfig/aws` — `AppConfigSourceAwsSecrets`, `AppConfigResolverAwsSecrets`
- `@maroonedsoftware/appconfig/gcp` — `AppConfigSourceGcpSecrets`, `AppConfigResolverGcpSecrets`

The core entry (file/JSON/dotenv/fetch sources, the env resolver, live-config wiring) is unchanged.
