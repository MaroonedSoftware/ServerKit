---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate AppConfig loading for a ServerKit app with @maroonedsoftware/appconfig, layering JSON, YAML, dotenv, and environment sources with env and secret-manager resolvers
argument-hint: [sources...] [--file <path>]
---

# /config - Generate AppConfig Setup

Generate AppConfig setup code with sources and resolvers for configuration management.

## Arguments

1. `sources` (optional): Space-separated list of source types - json, yaml, dotenv, env, gcp, aws
2. `--file` (optional): Output file path (defaults to `src/config/app.config.ts`)

If no sources specified, defaults to `json dotenv`.

## What This Skill Does

1. Creates a complete config setup file with:
   - AppConfigBuilder with the requested sources
   - The resolvers that fill in placeholders (`${env:KEY}`, secret managers)
   - Type-safe config shape
   - Export ready to use
   - Usage example in comments

## Examples

Generate basic config with defaults (JSON + dotenv):
```
/config
```

Generate config with all sources:
```
/config json yaml dotenv env gcp
```

Generate config at specific path:
```
/config json dotenv --file src/config/app.config.ts
```

## Implementation Pattern

The generated config will follow this pattern:

```typescript
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv, AppConfigSourceJson } from '@maroonedsoftware/appconfig';
// Only when asked for: each of these subpaths needs an optional peer dependency.
import { AppConfigSourceYaml } from '@maroonedsoftware/appconfig/yaml'; // yaml
import { AppConfigResolverGcpSecrets } from '@maroonedsoftware/appconfig/gcp'; // @google-cloud/secret-manager

// A type alias, not an interface, so AppConfig<ApplicationConfig> can be passed to builder.setup.
export type ApplicationConfig = {
  // TODO: Define your configuration structure
  server: {
    port: number;
    host: string;
  };
  database: {
    url: string;
  };
};

export const loadConfig = () =>
  new AppConfigBuilder()
    .addSource(new AppConfigSourceJson('./config.json'))
    .addSource(new AppConfigSourceYaml('./config.yaml'))
    .addSource(new AppConfigSourceDotenv('.env'))
    .addResolver(new AppConfigResolverEnv())
    .addResolver(new AppConfigResolverGcpSecrets('my-project-id'))
    .buildSnapshot<ApplicationConfig>();

// Usage:
// const config = await loadConfig();
// console.log(config.get('server').port);
// await builder.setup(config, logger, modules);
```

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract source types (json, yaml, dotenv, env, gcp, aws) from arguments
   - Look for --file flag for custom output path
   - Default to json and dotenv if no sources specified
   - Default to `src/config/app.config.ts` if no file specified

2. **Determine imports:**
   - Always import `AppConfigBuilder` and `AppConfigResolverEnv` from `@maroonedsoftware/appconfig`
   - Import sources based on arguments:
     - json → `AppConfigSourceJson` from the root
     - dotenv → `AppConfigSourceDotenv` from the root
     - env → `AppConfigSourceEnv` from the root
     - yaml → `AppConfigSourceYaml` from `@maroonedsoftware/appconfig/yaml`
   - Import resolvers based on arguments:
     - gcp → `AppConfigResolverGcpSecrets` from `@maroonedsoftware/appconfig/gcp`
     - aws → `AppConfigResolverAwsSecrets` from `@maroonedsoftware/appconfig/aws`
   - Tell the user which optional peer each subpath needs: `yaml`, `@google-cloud/secret-manager`, `@aws-sdk/client-secrets-manager`

3. **Generate config type:**
   - Create an `ApplicationConfig` type alias with TODO comments. Do not name it `AppConfig`, which is the package's class
   - Include common config sections (server, database, logging)
   - Add placeholder values

4. **Generate builder chain:**
   - Create a `loadConfig` function
   - Add sources in the order specified. Later sources win the deep merge, and arrays are replaced rather than concatenated
   - For JSON: `new AppConfigSourceJson('./config.json')`. For YAML: `new AppConfigSourceYaml('./config.yaml')`
   - For dotenv: `new AppConfigSourceDotenv('.env')`
   - For env: `new AppConfigSourceEnv({ groupSeparator: '__' })`, so `SERVER__port` nests as `server.port`. Keys are not case folded
   - Add resolvers after sources. There is no `addProvider`
   - For gcp: `new AppConfigResolverGcpSecrets(projectId)`. For aws: `new AppConfigResolverAwsSecrets(region)`, where `region` is optional
   - End with `.buildSnapshot<ApplicationConfig>()`. There is no `build`
   - Use `.buildStore<ApplicationConfig>(logger)` only if the user wants runtime reload. Then point them to the
     `AppConfigSection` model in `packages/appconfig/AGENTS.md`

5. **Add usage comments:**
   - Show how to import and use `loadConfig`, and pass the result to `builder.setup`
   - Show how to read values: `config.get('server')`, `config.get('server', fallback)`, `config.getAs<T>('server')`
   - For a flat key that must be present, show `requireConfigString(config, 'KEY')`, plus `optionalConfigString`, `configNumber`, and `configBoolean`
   - Explain config merging (last wins)
   - Explain placeholders: `${env:KEY}`, `${gcp:SECRET_ID}`, `${aws:SECRET_ID}`, and `${ref:some.path}` when `.resolveReferences()` is on

6. **Warn about the sharp edges in comments:**
   - A dotenv key lands at the top level under its own name. `PORT=8080` does not set `server.port`: reference it as `${env:PORT}`, or give `groupSeparator`
   - The dotenv source copies `.env` into `process.env`, overwriting existing values unless `{ overrideProcessEnv: false }`
   - A missing file yields an empty layer unless `{ ignoreMissingFile: false }`
   - `${env:KEY}` with the variable unset becomes an empty string, not an error

7. **Config file examples:**
   - If json source, add comment showing config.json structure
   - If yaml source, add comment showing config.yaml structure
   - If dotenv source, add comment showing .env format
   - Show placeholder syntax examples

8. **Keep AppConfig out of services:** a service takes its typed section in its constructor. Wire that in a module's `setup` hook (see `/module`), e.g. `registry.register(MailerConfig).useInstance(config.getAs<MailerConfig>('email'))`

9. **Write file:**
   - Create the complete config file
   - Ensure proper formatting

10. **Confirm to user:**
    - Show the file path where config was created
    - List sources and resolvers included, and any optional peers to install
    - Provide usage example
