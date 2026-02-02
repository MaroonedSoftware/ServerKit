---
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob
description: Generate logger registration and configuration for dependency injection
argument-hint: [file]
---

# /logger-setup - Generate Logger DI Setup

Generate logger registration and configuration for dependency injection with InjectKit.

## Arguments

1. `file` (optional): Output file path (defaults to `src/config/logger.config.ts`)

## What This Skill Does

1. Creates a complete logger config file with:
   - InjectKit registry setup
   - Logger interface registration to ConsoleLogger
   - Singleton configuration
   - Export for use in application bootstrap
   - Usage example in comments

## Examples

Generate logger setup with defaults:
```
/logger-setup
```

Generate at specific path:
```
/logger-setup src/config/logger.config.ts
```

## Implementation Pattern

The generated logger setup will follow this pattern:

```typescript
import { InjectKitRegistry } from 'injectkit';
import { Logger, ConsoleLogger } from '@maroonedsoftware/logger';

/**
 * Logger configuration for dependency injection
 */
export const configureLogger = (registry: InjectKitRegistry): void => {
  // Register Logger interface to use ConsoleLogger implementation
  registry.register(Logger).useClass(ConsoleLogger).asSingleton();
};

// Usage in application bootstrap:
//
// import { InjectKitRegistry } from 'injectkit';
// import { configureLogger } from './config/logger.config';
//
// const registry = new InjectKitRegistry();
// configureLogger(registry);
//
// const container = registry.build();
//
// // Now you can inject Logger in your classes:
// @Injectable()
// class MyService {
//   constructor(private readonly logger: Logger) {}
//
//   doWork() {
//     this.logger.info('Working...', { data: 'example' });
//   }
// }
```

## Instructions for Claude

When this skill is invoked:

1. **Parse arguments:**
   - Extract file path (optional)
   - Default to `src/config/logger.config.ts` if not specified

2. **Generate logger config file:**
   - Import InjectKitRegistry from 'injectkit'
   - Import Logger and ConsoleLogger from '@maroonedsoftware/logger'
   - Create configureLogger function that takes registry parameter
   - Register Logger interface to ConsoleLogger class
   - Configure as singleton (one instance shared across application)

3. **Add JSDoc documentation:**
   - Document the configureLogger function
   - Explain that Logger is registered to ConsoleLogger
   - Mention singleton pattern

4. **Add usage comments:**
   - Show how to import and use configureLogger
   - Show how to create registry and container
   - Show example Injectable class with Logger injection
   - Show logger methods: info, warn, error, debug

5. **Include logger usage examples:**
   - Show structured logging with data objects
   - Show error logging with error objects
   - Show different log levels
   - Mention that ConsoleLogger outputs to console (can be replaced with custom implementation)

6. **Add advanced notes:**
   - Explain that Logger is an interface, ConsoleLogger is implementation
   - Can be replaced with custom logger (e.g., PinoLogger, WinstonLogger)
   - Logger is automatically scoped in ServerKit context middleware

7. **Write file:**
   - Create the complete logger config file
   - Ensure proper formatting

8. **Confirm to user:**
   - Show the file path where config was created
   - Explain how to use it in application bootstrap
   - Mention that Logger can now be injected in any class
