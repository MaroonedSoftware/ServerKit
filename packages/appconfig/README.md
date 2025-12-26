# @maroonedsoftware/appconfig

A flexible, type-safe configuration management library with support for multiple sources and value transformation.

## Features

- **Type-safe access** - Full TypeScript support with generics
- **Multiple sources** - Load configuration from JSON files, YAML files, `.env` files, and more
- **Value transformation** - Resolve environment variables and GCP secrets in configuration values
- **Deep merging** - Combine configurations from multiple sources with predictable override behavior
- **Extensible** - Create custom sources and providers for your specific needs

## Installation

```bash
pnpm add @maroonedsoftware/appconfig
```

## Usage

### Basic Usage

```typescript
import { AppConfig } from '@maroonedsoftware/appconfig';

const config = new AppConfig({
  database: { host: 'localhost', port: 5432 },
  api: { timeout: 5000 },
});

const host = config.get('database').host; // Type-safe access
const port = config.getNumber('port'); // Returns as number
```

### Using the Builder

The `AppConfigBuilder` allows you to load configuration from multiple sources and apply transformations:

```typescript
import {
  AppConfigBuilder,
  AppConfigSourceJson,
  AppConfigSourceYaml,
  AppConfigSourceDotenv,
  AppConfigProviderDotenv,
} from '@maroonedsoftware/appconfig';

const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .addSource(new AppConfigSourceYaml('./config.yaml'))
  .addSource(new AppConfigSourceDotenv('.env'))
  .addProvider(new AppConfigProviderDotenv())
  .build<MyConfigType>();
```

### Environment Variable Resolution

Use `${env:VAR_NAME}` syntax in your JSON config files to reference environment variables:

**config.json:**

```json
{
  "database": {
    "host": "${env:DB_HOST}",
    "port": "${env:DB_PORT}",
    "url": "${env:DATABASE_URL}"
  }
}
```

**.env:**

```
DB_HOST=localhost
DB_PORT=5432
DATABASE_URL=postgres://localhost:5432/mydb
```

**app.ts:**

```typescript
const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .addSource(new AppConfigSourceDotenv('.env'))
  .addProvider(new AppConfigProviderDotenv())
  .build();

// Values are resolved from environment variables
// Numeric values like DB_PORT are automatically parsed as numbers
```

### GCP Secret Manager Integration

Use `${gcp:SECRET_NAME}` syntax to resolve secrets from Google Cloud Platform Secret Manager:

**config.json:**

```json
{
  "database": {
    "password": "${gcp:DB_PASSWORD}",
    "connectionString": "${gcp:DATABASE_CONNECTION_STRING}"
  },
  "api": {
    "key": "${gcp:API_SECRET_KEY}"
  }
}
```

**app.ts:**

```typescript
import { AppConfigBuilder, AppConfigSourceJson, AppConfigProviderGcpSecrets } from '@maroonedsoftware/appconfig';

const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .addProvider(new AppConfigProviderGcpSecrets('my-gcp-project-id'))
  .build();

// Secrets are fetched from GCP Secret Manager
// The provider fetches: projects/my-gcp-project-id/secrets/DB_PASSWORD/versions/latest
```

> **Note:** The GCP secrets provider requires valid GCP credentials. It uses Application Default Credentials (ADC), so ensure you have authenticated via `gcloud auth application-default login` or have set up a service account.

## API

### AppConfig

The configuration container providing type-safe access to configuration values.

| Method            | Description                                         |
| ----------------- | --------------------------------------------------- |
| `get(key)`        | Returns the value for the key with full type safety |
| `getString(key)`  | Returns the value converted to a string             |
| `getNumber(key)`  | Returns the value converted to a number             |
| `getBoolean(key)` | Returns the value converted to a boolean            |
| `getObject(key)`  | Returns the value cast as an object                 |

### AppConfigBuilder

Builder for constructing `AppConfig` instances from multiple sources.

| Method                  | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `addSource(source)`     | Adds a configuration source (later sources override earlier) |
| `addProvider(provider)` | Adds a provider to transform string values                   |
| `build<T>()`            | Builds and returns the `AppConfig` instance                  |

### Sources

#### AppConfigSourceJson

Loads configuration from a JSON file.

```typescript
// Basic usage (ignores missing file by default)
const source = new AppConfigSourceJson('./config.json');

// Throw error if file is missing
const source = new AppConfigSourceJson('./config.json', {
  ignoreMissingFile: false,
});

// Custom encoding
const source = new AppConfigSourceJson('./config.json', {
  encoding: 'utf16le',
});
```

#### AppConfigSourceYaml

Loads configuration from a YAML file. Supports both `.yaml` and `.yml` extensions.

```typescript
// Basic usage (ignores missing file by default)
const source = new AppConfigSourceYaml('./config.yaml');

// Throw error if file is missing
const source = new AppConfigSourceYaml('./config.yaml', {
  ignoreMissingFile: false,
});

// Custom encoding
const source = new AppConfigSourceYaml('./config.yaml', {
  encoding: 'utf16le',
});
```

YAML files support all standard YAML features including nested objects, arrays, multiline strings, and anchors:

```yaml
# config.yaml
database:
  host: localhost
  port: 5432
  credentials:
    username: admin
    password: ${env:DB_PASSWORD}

features:
  - feature1
  - feature2

description: |
  This is a multiline
  string value
```

#### AppConfigSourceDotenv

Loads environment variables from a `.env` file.

```typescript
// Load from default .env file
const source = new AppConfigSourceDotenv();

// Load from custom path
const source = new AppConfigSourceDotenv('./config/.env.local');
```

### Providers

#### AppConfigProviderDotenv

Resolves environment variable references in configuration values.

```typescript
// Default pattern: ${env:VAR_NAME}
const provider = new AppConfigProviderDotenv();

// Custom regex pattern
const provider = new AppConfigProviderDotenv(/\$\{([^}]+)\}/g);
```

The provider automatically attempts to parse resolved values as JSON, so numeric and boolean environment variables are converted to their proper types.

#### AppConfigProviderGcpSecrets

Resolves GCP Secret Manager references in configuration values.

```typescript
// Default pattern: ${gcp:SECRET_NAME}
const provider = new AppConfigProviderGcpSecrets('my-project-id');

// Custom regex pattern
const provider = new AppConfigProviderGcpSecrets('my-project-id', /\$\{secret:([^}]+)\}/g);
```

| Parameter   | Type               | Description                                                            |
| ----------- | ------------------ | ---------------------------------------------------------------------- |
| `projectId` | `string`           | The GCP project ID where secrets are stored                            |
| `prefix`    | `string \| RegExp` | Optional regex pattern to match secret references. Default: `${gcp:*}` |

The provider:

- Fetches secrets from GCP Secret Manager using the latest version
- Automatically attempts to parse secret values as JSON
- Requires valid GCP credentials (uses Application Default Credentials)
- Is decorated with `@Injectable()` for dependency injection support

## Custom Sources and Providers

### Creating a Custom Source

```typescript
import { AppConfigSource } from '@maroonedsoftware/appconfig';

class MyCustomSource implements AppConfigSource {
  async load(): Promise<Record<string, unknown>> {
    // Load configuration from your custom source
    return { key: 'value' };
  }
}
```

### Creating a Custom Provider

```typescript
import { AppConfigProvider, ObjectVisitorMeta } from '@maroonedsoftware/appconfig';

class MyCustomProvider implements AppConfigProvider {
  canParse(value: string): boolean {
    return value.startsWith('custom:');
  }

  async parse(value: string, meta: ObjectVisitorMeta): Promise<void> {
    const transformed = value.replace('custom:', '');
    (meta.owner as Record<string, unknown>)[meta.propertyPath] = transformed;
  }
}
```

## Configuration Merging

When using multiple sources, configurations are deep-merged in the order they are added. Later sources override earlier ones:

```typescript
const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./defaults.json')) // Base config
  .addSource(new AppConfigSourceYaml('./config.yaml')) // Overrides defaults
  .addSource(new AppConfigSourceJson('./local.json')) // Overrides both
  .addSource(new AppConfigSourceDotenv()) // Overrides all
  .build();
```

## License

MIT
