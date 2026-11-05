import { ConsoleLogger, Logger } from '@maroonedsoftware/logger';
import { Injectable, InjectKitRegistry } from 'injectkit';

/**
 * On a server, make the logger and hand it to the builder. builder.setup registers it against the
 * Logger token itself, so a module should not register Logger a second time.
 *
 * const builder = new ServerKitServerBuilder();
 * await builder.setup(config, createLogger(), modules);
 */
export const createLogger = (): Logger => new ConsoleLogger();

/**
 * With no server builder, in a worker or a script, register it on your own registry instead.
 *
 * const registry = new InjectKitRegistry();
 * configureLogger(registry);
 * const container = registry.build();
 */
export const configureLogger = (registry: InjectKitRegistry): void => {
  registry.register(Logger).useClass(ConsoleLogger).asSingleton();
};

/**
 * Logger is an abstract class used as a DI token, so a constructor can ask for it by type. Inside a
 * request the same logger is ctx.logger on Koa and request.logger on Fastify.
 */
@Injectable()
export class UserService {
  constructor(private readonly logger: Logger) {}

  async createUser(data: { name: string; email: string }) {
    this.logger.info('Creating user', { email: data.email });

    try {
      const user = { id: 'not.implemented', ...data };
      this.logger.debug('User created', { userId: user.id });
      return user;
    } catch (error) {
      // The first argument is `unknown`, so the error itself can go there.
      this.logger.error(error, { email: data.email });
      throw error;
    }
  }
}

/**
 * To log somewhere else, implement all five methods, then pass an instance to builder.setup, or
 * register the class against the Logger token. ConsoleLogger writes to the console and adds nothing,
 * so request IDs and redaction are the caller's job, or a custom logger's.
 */
export class JsonLogger implements Logger {
  private write(level: string, message: unknown, optionalParams: unknown[]): void {
    process.stdout.write(`${JSON.stringify({ level, message: message instanceof Error ? message.message : message, data: optionalParams })}\n`);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  info(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  trace(message: unknown, ...optionalParams: unknown[]): void {
    this.write('trace', message, optionalParams);
  }
}
