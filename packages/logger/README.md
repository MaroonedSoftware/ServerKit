# @maroonedsoftware/logger

A simple, dependency injection friendly logging abstraction with multiple log levels.

## Installation

```bash
pnpm add @maroonedsoftware/logger
```

## Usage

### Basic Usage

```typescript
import { ConsoleLogger } from '@maroonedsoftware/logger';

const logger = new ConsoleLogger();

logger.error('Something went wrong', { details: 'error context' });
logger.warn('This might be a problem');
logger.info('Application started');
logger.debug('Processing request', requestData);
logger.trace('Entering function');
```

### With Dependency Injection

The `Logger` abstract class is decorated with `@Injectable()` from [injectkit](https://www.npmjs.com/package/injectkit), making it easy to use with DI containers:

```typescript
import 'reflect-metadata';
import { InjectKitRegistry } from 'injectkit';
import { Logger, ConsoleLogger } from '@maroonedsoftware/logger';

// Set up dependency injection registry
const diRegistry = new InjectKitRegistry();
diRegistry.register(Logger).useClass(ConsoleLogger).asSingleton();

// Build the container
const container = diRegistry.build();

// Resolve the logger
const logger = container.get(Logger);
logger.info('Application started');
```

In your services, use constructor injection:

```typescript
import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';

@Injectable()
class MyService {
  constructor(private logger: Logger) {}

  doSomething() {
    this.logger.info('Doing something');
  }
}
```

## API

### Logger

`Logger` is exported both as an interface and as an `@Injectable()` abstract class with the same shape, so it can be used as either a type or a DI token.

| Method                              | Description                   |
| ----------------------------------- | ----------------------------- |
| `error(message, ...optionalParams)` | Logs an error message         |
| `warn(message, ...optionalParams)`  | Logs a warning message        |
| `info(message, ...optionalParams)`  | Logs an informational message |
| `debug(message, ...optionalParams)` | Logs a debug message          |
| `trace(message, ...optionalParams)` | Logs a trace message          |

All parameters are typed as `unknown`/`unknown[]` and methods return `void`.

### ConsoleLogger

A concrete implementation that outputs to the standard console. Accepts an optional `Console` instance in the constructor for custom console implementations.

```typescript
// Use global console (default)
const logger = new ConsoleLogger();

// Use custom console
const customConsole = { ... };
const logger = new ConsoleLogger(customConsole);
```

## License

MIT
