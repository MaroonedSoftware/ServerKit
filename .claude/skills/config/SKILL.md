---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate AppConfig setup with sources and providers for configuration management
argument-hint: [sources...] [--file <path>]
---

# /config - Generate AppConfig Setup

Generate AppConfig setup code with sources and providers for configuration management.

## Arguments

1. `sources` (optional): Space-separated list of source types - json, yaml, dotenv, gcp
2. `--file` (optional): Output file path (defaults to `src/config/app.config.ts`)

If no sources specified, defaults to `json dotenv`.

## What This Skill Does

1. Creates a complete config setup file with:
   - AppConfigBuilder with requested sources
   - Appropriate providers (env vars, GCP secrets)
   - Type-safe config interface template
   - Export ready to use
   - Usage example in comments

## Examples

Generate basic config with defaults (JSON + dotenv):
```
/config
```

Generate config with all sources:
```
/config json yaml dotenv gcp
```

Generate config at specific path:
```
/config json dotenv --file src/config/app.config.ts
```

## Implementation Pattern

The generated config will follow this pattern:

```typescript
import {
  AppConfigBuilder,
  AppConfigSourceJson,
  AppConfigSourceYaml,
  AppConfigSourceDotenv,
  AppConfigProviderDotenv,
  AppConfigProviderGcpSecrets
} from '@maroonedsoftware/appconfig';

// Define your config type
interface AppConfig {
  // TODO: Define your configuration structure
  server: {
    port: number;
    host: string;
  };
  database: {
    url: string;
  };
}

export const loadConfig = async (): Promise<AppConfig> => {
  return await new AppConfigBuilder()
    .addSource(new AppConfigSourceJson('./config.json'))
    .addSource(new AppConfigSourceYaml('./config.yaml'))
    .addSource(new AppConfigSourceDotenv('.env'))
    .addProvider(new AppConfigProviderDotenv())
    .addProvider(new AppConfigProviderGcpSecrets())
    .build<AppConfig>();
};

// Usage:
// const config = await loadConfig();
// console.log(config.server.port);
```

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract source types (json, yaml, dotenv, gcp) from arguments
   - Look for --file flag for custom output path
   - Default to json and dotenv if no sources specified
   - Default to `src/config/app.config.ts` if no file specified

2. **Determine imports:**
   - Always import AppConfigBuilder
   - Import sources based on arguments:
     - json → AppConfigSourceJson
     - yaml → AppConfigSourceYaml
     - dotenv → AppConfigSourceDotenv
   - Import providers:
     - If dotenv source → AppConfigProviderDotenv
     - If gcp source → AppConfigProviderGcpSecrets

3. **Generate config interface:**
   - Create AppConfig interface with TODO comments
   - Include common config sections (server, database, logging)
   - Add placeholder values

4. **Generate builder chain:**
   - Create loadConfig async function
   - Add sources in order specified
   - For JSON: use './config.json'
   - For YAML: use './config.yaml'
   - For dotenv: use '.env' or no argument
   - Add providers after sources
   - Call .build<AppConfig>()

5. **Add usage comments:**
   - Show how to import and use loadConfig
   - Show how to access config properties
   - Explain config merging (last wins)
   - Explain provider resolution (${env:VAR}, ${gcp:secret})

6. **Config file examples:**
   - If json source, add comment showing config.json structure
   - If yaml source, add comment showing config.yaml structure
   - If dotenv source, add comment showing .env format
   - Show provider syntax examples

7. **Write file:**
   - Create the complete config file
   - Ensure proper formatting

8. **Confirm to user:**
   - Show the file path where config was created
   - List sources and providers included
   - Provide usage example
