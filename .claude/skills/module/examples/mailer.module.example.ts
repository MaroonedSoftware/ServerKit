import { requireConfigString } from '@maroonedsoftware/appconfig';
import type { ServerKitModule } from '@maroonedsoftware/koa'; // Also exported by @maroonedsoftware/fastify.
import { Logger } from '@maroonedsoftware/logger';
import { Injectable } from 'injectkit';

/** The typed section the service asks for, used as its own DI token. */
export class MailerConfig {
  constructor(readonly apiKey: string) {}
}

@Injectable()
export class MailerConnection {
  constructor(
    readonly config: MailerConfig,
    private readonly logger: Logger,
  ) {}

  subscribeToBounces(): void {
    this.logger.info('Listening for bounces');
  }

  async warmTemplates(signal: AbortSignal): Promise<void> {
    await fetch('https://mail.example.com/templates', { headers: { authorization: this.config.apiKey }, signal });
  }

  async close(): Promise<void> {
    this.logger.info('Mailer closed');
  }
}

/**
 * Add this to the array passed to builder.setup. Hooks run in array order, and shutdown runs in
 * reverse, so list a module after the modules it depends on.
 */
export const mailerModule: ServerKitModule = {
  // Set a name: the builder logs it at each phase.
  name: 'mailer',

  // Before the container exists: register bindings here, and resolve nothing.
  async setup(registry, config) {
    registry.register(MailerConfig).useInstance(new MailerConfig(requireConfigString(config, 'MAILER_API_KEY')));
    registry.register(MailerConnection).useClass(MailerConnection).asSingleton();
  },

  // Socket listening, and awaited in turn: anything slow here delays every module after it.
  async start(container) {
    container.get(MailerConnection).subscribeToBounces();
  },

  // Background work. By default a failure here is logged and boot carries on.
  async ready(container, signal) {
    await container.get(MailerConnection).warmTemplates(signal);
  },

  // A failure here is logged, and the remaining modules still shut down.
  async shutdown(container) {
    await container.get(MailerConnection).close();
  },
};
