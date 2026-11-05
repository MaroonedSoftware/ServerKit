import { requireConfigString } from '@maroonedsoftware/appconfig';
import { Job, JobBroker, JobRunner, PermanentJobError } from '@maroonedsoftware/jobbroker';
import { PgBossConnectionProvider, PgBossJobBroker, PgBossJobRegistryMap, PgBossJobRunner } from '@maroonedsoftware/jobbroker/pgboss';
import type { ServerKitModule } from '@maroonedsoftware/koa'; // Also exported by @maroonedsoftware/fastify.
import { Logger } from '@maroonedsoftware/logger';
import { Injectable } from 'injectkit';
import { PgBoss } from 'pg-boss';

export interface SendEmailJobPayload {
  to: string;
  subject: string;
  body: string;
}

/**
 * Sends an email. The job's name is not on the class: it is the key in PgBossJobRegistryMap, below.
 */
@Injectable()
export class SendEmailJob extends Job<SendEmailJobPayload> {
  // Job's own constructor takes nothing, so this is a bare super().
  constructor(private readonly logger: Logger) {
    super();
  }

  async run(payload: SendEmailJobPayload, signal?: AbortSignal): Promise<void> {
    if (!payload.to.includes('@')) {
      // No retry will fix this input: skip the retries and go straight to the dead-letter queue.
      throw new PermanentJobError('Invalid recipient').withDetails({ to: payload.to });
    }

    this.logger.info('Sending email', { to: payload.to, subject: payload.subject });

    // Forward the signal to async work, so cancellation and shutdown can interrupt it.
    // await this.emailService.send(payload, { signal });
    signal?.throwIfAborted();

    // Anything else thrown here counts as transient: the job goes back on the queue and retries.
  }
}

/** Wires the broker, the runner, and the job into the server's lifecycle. */
export const jobsModule: ServerKitModule = {
  name: 'jobs',

  async setup(registry, config) {
    const jobs = new PgBossJobRegistryMap();
    jobs.set('email.send', SendEmailJob);

    registry.register(PgBossJobRegistryMap).useInstance(jobs);
    registry.register(PgBoss).useInstance(new PgBoss(requireConfigString(config, 'DATABASE_URL')));
    registry.register(PgBossConnectionProvider).useClass(PgBossConnectionProvider).asSingleton();
    registry.register(JobBroker).useClass(PgBossJobBroker).asSingleton();
    registry.register(JobRunner).useClass(PgBossJobRunner).asSingleton();

    // The runner resolves the job from a fresh scope per execution, so it has to be registered too.
    registry.register(SendEmailJob).useClass(SendEmailJob).asScoped();
  },

  // JobRunner.start also starts pg-boss, which JobBroker.send needs, so this goes in `start`.
  async start(container) {
    await container.get(JobRunner).start();
  },

  async shutdown(container) {
    await container.get(JobRunner).stop();
  },
};

/** Enqueues the job. JobBroker.send throws if the name is not in the registry map. */
@Injectable()
export class WelcomeService {
  constructor(private readonly broker: JobBroker) {}

  async welcome(to: string): Promise<string> {
    const payload: SendEmailJobPayload = { to, subject: 'Welcome!', body: 'Thanks for signing up.' };
    return await this.broker.send('email.send', payload);
  }
}
