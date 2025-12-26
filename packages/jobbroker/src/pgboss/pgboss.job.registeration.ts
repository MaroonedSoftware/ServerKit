import { Identifier, Injectable } from 'injectkit';
import { Job } from '../job.js';

/**
 * Configuration for a scheduled job registration.
 *
 * Use this type when you need to register a job that runs on a schedule
 * rather than being triggered manually.
 *
 * @example
 * ```typescript
 * const scheduledJob: PgBossJobRegistration = {
 *   job: DailyReportJob,
 *   cron: '0 9 * * *' // Every day at 9 AM
 * };
 * ```
 */
export type PgBossJobRegistration = {
  /** The job class identifier to instantiate when the job runs. */
  job: Identifier<Job>;
  /** A cron expression defining when the job should run. */
  cron: string;
};

/**
 * Registry map for PgBoss job registrations.
 *
 * This map holds all job registrations, mapping job names to either:
 * - A job class identifier (for on-demand jobs)
 * - A {@link PgBossJobRegistration} object (for scheduled jobs)
 *
 * The registry is used by both {@link PgBossJobBroker} and {@link PgBossJobRunner}
 * to validate job names and resolve job handlers.
 *
 * @example
 * ```typescript
 * const registry = new PgBossJobRegistryMap();
 *
 * // Register an on-demand job
 * registry.set('send-email', SendEmailJob);
 *
 * // Register a scheduled job
 * registry.set('daily-cleanup', {
 *   job: CleanupJob,
 *   cron: '0 0 * * *'
 * });
 *
 * // Use with dependency injection
 * container.bind(PgBossJobRegistryMap).toValue(registry);
 * ```
 */
@Injectable()
export class PgBossJobRegistryMap extends Map<string, Identifier<Job> | PgBossJobRegistration> {}
