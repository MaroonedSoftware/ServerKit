import { describe, it, expect } from 'vitest';
import { PgBossJobRegistryMap, PgBossJobRegistration } from '../../src/pgboss/pgboss.job.registeration.js';
import { Job } from '../../src/job.js';

class TestJob extends Job<{ message: string }> {
  async run(payload: { message: string }): Promise<void> {
    console.log(payload.message);
  }
}

class AnotherJob extends Job<{ count: number }> {
  async run(payload: { count: number }): Promise<void> {
    console.log(payload.count);
  }
}

describe('PgBossJobRegistryMap', () => {
  describe('constructor', () => {
    it('should create an empty registry map', () => {
      const registry = new PgBossJobRegistryMap();
      expect(registry).toBeInstanceOf(PgBossJobRegistryMap);
      expect(registry).toBeInstanceOf(Map);
      expect(registry.size).toBe(0);
    });
  });

  describe('set and get', () => {
    it('should store and retrieve job identifier', () => {
      const registry = new PgBossJobRegistryMap();
      registry.set('test-job', TestJob);

      expect(registry.get('test-job')).toBe(TestJob);
    });

    it('should store and retrieve job registration with cron', () => {
      const registry = new PgBossJobRegistryMap();
      const registration: PgBossJobRegistration = {
        job: TestJob,
        cron: '0 0 * * *',
      };
      registry.set('cron-job', registration);

      const retrieved = registry.get('cron-job') as PgBossJobRegistration;
      expect(retrieved.job).toBe(TestJob);
      expect(retrieved.cron).toBe('0 0 * * *');
    });

    it('should handle multiple registrations', () => {
      const registry = new PgBossJobRegistryMap();
      registry.set('job-1', TestJob);
      registry.set('job-2', AnotherJob);
      registry.set('job-3', { job: TestJob, cron: '*/5 * * * *' });

      expect(registry.size).toBe(3);
      expect(registry.get('job-1')).toBe(TestJob);
      expect(registry.get('job-2')).toBe(AnotherJob);
      expect((registry.get('job-3') as PgBossJobRegistration).cron).toBe('*/5 * * * *');
    });
  });

  describe('has', () => {
    it('should return true for registered jobs', () => {
      const registry = new PgBossJobRegistryMap();
      registry.set('test-job', TestJob);

      expect(registry.has('test-job')).toBe(true);
    });

    it('should return false for unregistered jobs', () => {
      const registry = new PgBossJobRegistryMap();

      expect(registry.has('non-existent-job')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should remove a registered job', () => {
      const registry = new PgBossJobRegistryMap();
      registry.set('test-job', TestJob);

      expect(registry.has('test-job')).toBe(true);
      registry.delete('test-job');
      expect(registry.has('test-job')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all registered jobs', () => {
      const registry = new PgBossJobRegistryMap();
      registry.set('job-1', TestJob);
      registry.set('job-2', AnotherJob);

      expect(registry.size).toBe(2);
      registry.clear();
      expect(registry.size).toBe(0);
    });
  });

  describe('iteration', () => {
    it('should iterate over entries', () => {
      const registry = new PgBossJobRegistryMap();
      registry.set('job-1', TestJob);
      registry.set('job-2', AnotherJob);

      const entries: Array<[string, unknown]> = [];
      for (const entry of registry.entries()) {
        entries.push(entry);
      }

      expect(entries.length).toBe(2);
      expect(entries.some(([name]) => name === 'job-1')).toBe(true);
      expect(entries.some(([name]) => name === 'job-2')).toBe(true);
    });

    it('should iterate using forEach', () => {
      const registry = new PgBossJobRegistryMap();
      registry.set('job-1', TestJob);
      registry.set('job-2', AnotherJob);

      const names: string[] = [];
      registry.forEach((_, name) => {
        names.push(name);
      });

      expect(names).toContain('job-1');
      expect(names).toContain('job-2');
    });
  });
});

describe('PgBossJobRegistration type', () => {
  it('should correctly type a job registration object', () => {
    const registration: PgBossJobRegistration = {
      job: TestJob,
      cron: '0 0 * * *',
    };

    expect(registration.job).toBe(TestJob);
    expect(registration.cron).toBe('0 0 * * *');
  });

  it('should support various cron expressions', () => {
    const registrations: PgBossJobRegistration[] = [
      { job: TestJob, cron: '* * * * *' },
      { job: TestJob, cron: '0 * * * *' },
      { job: TestJob, cron: '0 0 * * *' },
      { job: TestJob, cron: '0 0 * * 0' },
      { job: TestJob, cron: '0 0 1 * *' },
      { job: TestJob, cron: '0 0 1 1 *' },
      { job: TestJob, cron: '*/5 * * * *' },
      { job: TestJob, cron: '0 */2 * * *' },
    ];

    registrations.forEach(reg => {
      expect(reg.job).toBe(TestJob);
      expect(typeof reg.cron).toBe('string');
    });
  });
});
