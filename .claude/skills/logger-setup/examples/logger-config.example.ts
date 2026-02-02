import { InjectKitRegistry } from 'injectkit';
import { Logger, ConsoleLogger } from '@maroonedsoftware/logger';

/**
 * Logger configuration for dependency injection
 *
 * Registers the Logger interface to use ConsoleLogger implementation as a singleton.
 * The same logger instance will be shared across the application.
 */
export const configureLogger = (registry: InjectKitRegistry): void => {
  // Register Logger interface to use ConsoleLogger implementation
  registry.register(Logger).useClass(ConsoleLogger).asSingleton();
};

// Usage in application bootstrap (src/index.ts):
//
// import Koa from 'koa';
// import { InjectKitRegistry } from 'injectkit';
// import { configureLogger } from './config/logger.config';
// import { serverKitContextMiddleware } from '@maroonedsoftware/koa';
//
// const registry = new InjectKitRegistry();
// configureLogger(registry);
//
// // Register other services...
// // registry.register(UserService).useClass(UserService).asScoped();
//
// const container = registry.build();
//
// const app = new Koa();
// app.use(serverKitContextMiddleware(container));
//
// // Now Logger is available in:
// // 1. Request context: ctx.logger
// // 2. Injected classes: constructor(private logger: Logger)

// Example service using Logger injection:
//
// import { Injectable } from 'injectkit';
// import { Logger } from '@maroonedsoftware/logger';
//
// @Injectable()
// export class UserService {
//   constructor(private readonly logger: Logger) {}
//
//   async createUser(data: { name: string; email: string }) {
//     this.logger.info('Creating user', {
//       email: data.email,
//       timestamp: new Date().toISOString()
//     });
//
//     try {
//       // Create user logic...
//       const user = { id: '123', ...data };
//
//       this.logger.info('User created successfully', {
//         userId: user.id,
//         email: user.email
//       });
//
//       return user;
//     } catch (error) {
//       this.logger.error('Failed to create user', {
//         email: data.email,
//         error: error instanceof Error ? error.message : 'Unknown error',
//         stack: error instanceof Error ? error.stack : undefined
//       });
//       throw error;
//     }
//   }
//
//   async getUserById(id: string) {
//     this.logger.debug('Fetching user by ID', { userId: id });
//
//     // Fetch user logic...
//     return { id, name: 'Example User', email: 'user@example.com' };
//   }
// }

// Logger methods available:
// - logger.info(message, data?)    - Informational messages
// - logger.warn(message, data?)    - Warning messages
// - logger.error(message, data?)   - Error messages
// - logger.debug(message, data?)   - Debug messages (verbose)

// Note: ConsoleLogger outputs to console.log, console.warn, console.error, console.debug.
// In production, you might want to use a custom logger implementation that:
// - Sends logs to a logging service (e.g., CloudWatch, Datadog)
// - Formats logs as JSON for structured logging
// - Filters sensitive data from logs
// - Adds request tracing IDs
//
// To use a custom logger, create a class that implements the Logger interface:
//
// import { Logger } from '@maroonedsoftware/logger';
//
// export class CustomLogger implements Logger {
//   info(message: string, data?: unknown): void {
//     // Custom implementation
//   }
//   warn(message: string, data?: unknown): void {
//     // Custom implementation
//   }
//   error(message: string, data?: unknown): void {
//     // Custom implementation
//   }
//   debug(message: string, data?: unknown): void {
//     // Custom implementation
//   }
// }
//
// Then register it:
// registry.register(Logger).useClass(CustomLogger).asSingleton();
